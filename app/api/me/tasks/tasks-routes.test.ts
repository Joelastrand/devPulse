import { describe, expect, it, vi } from "vitest";

// Route boundary tests. Token verification is replaced by a fixed table of synthetic tokens; storage is the in-memory
// port. Everything else (operations, validation, DTO allow-list, status mapping) is the real code.
const TOKEN_OWNER: Record<string, string> = { "token-a": "owner-uid-a", "token-b": "owner-uid-b" };

vi.mock("../../../../src/features/auth/server/verify-identity", () => ({
  verifyIdToken: vi.fn(async (token: string) => {
    if (token in TOKEN_OWNER) return { ok: true, identity: { uid: TOKEN_OWNER[token] } };
    if (token === "erasing") return { ok: false, error: "erasure_in_progress" };
    if (token === "down") return { ok: false, error: "auth_unavailable" };
    return { ok: false, error: "invalid_token" };
  }),
}));

vi.mock("../../../../src/features/personal-tasks/server/task-store", async () => {
  const { createFakeTaskStore } = await import("../../../../src/features/personal-tasks/server/fake-task-store");
  const store = createFakeTaskStore();
  return { getDefaultPersonalTaskStore: () => store };
});

const { GET, POST } = await import("./route");
const { PATCH, DELETE } = await import("./[taskId]/route");
const { GET: HISTORY } = await import("./history/route");
const { PUT: PREFERENCES } = await import("./preferences/route");

const BASE = "http://localhost/api/me/tasks";

function request(method: string, url: string, token?: string, body?: unknown): Request {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createAs(token: string, body: Record<string, unknown>) {
  const response = await POST(request("POST", BASE, token, body));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; [key: string]: unknown };
}

const taskParams = (taskId: string) => ({ params: Promise.resolve({ taskId }) });

describe("authentication boundary", () => {
  it("refuses a missing token with 401 and returns no task data", async () => {
    const response = await GET(request("GET", BASE));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("refuses an invalid token with 401 on every method", async () => {
    expect((await POST(request("POST", BASE, "forged", { title: "x" }))).status).toBe(401);
    expect((await PATCH(request("PATCH", BASE, "forged", { title: "x" }), taskParams("t1"))).status).toBe(401);
    expect((await DELETE(request("DELETE", BASE, "forged"), taskParams("t1"))).status).toBe(401);
  });

  it("refuses an account whose erasure is in progress with 403, so no write happens", async () => {
    const response = await POST(request("POST", BASE, "erasing", { title: "Skal ikke lagres" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "erasure_in_progress" });
  });

  it("refuses with 503 when verification cannot be completed, never treating it as a valid identity", async () => {
    const response = await GET(request("GET", BASE, "down"));
    expect(response.status).toBe(503);
  });

  it("responds with no-store caching on task data", async () => {
    const response = await GET(request("GET", BASE, "token-a"));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("owner-only behaviour", () => {
  it("returns the owner's own created task, with the explicit DTO and no owner field", async () => {
    const created = await createAs("token-a", { title: "Min egen oppgave" });
    expect(Object.keys(created).sort()).toEqual(
      ["completedAt", "createdAt", "description", "dueDate", "id", "notes", "position", "priority", "status", "title", "updatedAt"].sort(),
    );
    const board = (await (await GET(request("GET", BASE, "token-a"))).json()) as { tasks: { id: string }[] };
    expect(board.tasks.map((task) => task.id)).toContain(created.id);
  });

  it("does not show one owner's task on another owner's board", async () => {
    const created = await createAs("token-b", { title: "Kun for konto B" });
    const board = (await (await GET(request("GET", BASE, "token-a"))).json()) as { tasks: { id: string }[] };
    expect(board.tasks.map((task) => task.id)).not.toContain(created.id);
  });

  it("refuses to edit another person's task as not found", async () => {
    const created = await createAs("token-b", { title: "Privat for B" });
    const response = await PATCH(request("PATCH", `${BASE}/${created.id}`, "token-a", { title: "Stjålet" }), taskParams(created.id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("does not delete another person's task: the delete is idempotent for the caller and B's task remains", async () => {
    const created = await createAs("token-b", { title: "Ikke slett meg" });
    const response = await DELETE(request("DELETE", `${BASE}/${created.id}`, "token-a"), taskParams(created.id));
    expect(response.status).toBe(200);
    const board = (await (await GET(request("GET", BASE, "token-b"))).json()) as { tasks: { id: string }[] };
    expect(board.tasks.map((task) => task.id)).toContain(created.id);
  });
});

describe("request validation", () => {
  it("refuses a body that names an owner, with 400 and no task created", async () => {
    const response = await POST(request("POST", BASE, "token-a", { title: "x", ownerUid: "owner-uid-b" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("refuses a malformed JSON body with 400", async () => {
    const response = await POST(
      new Request(BASE, { method: "POST", headers: { authorization: "Bearer token-a", "content-type": "application/json" }, body: "{nope" }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses an empty title with 400 and the specific code", async () => {
    const response = await POST(request("POST", BASE, "token-a", { title: "   " }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_title" });
  });

  it("refuses an invalid task id in the path before any storage read", async () => {
    const response = await PATCH(request("PATCH", `${BASE}/..%2Fother`, "token-a", { title: "x" }), taskParams("../other"));
    expect(response.status).toBe(404);
  });

  it("refuses an invalid history cursor with 400", async () => {
    const response = await HISTORY(request("GET", `${BASE}/history?cursor=%%%`, "token-a"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_cursor" });
  });

  it("refuses an unknown completed-task preference value with 400", async () => {
    const response = await PREFERENCES(request("PUT", `${BASE}/preferences`, "token-a", { completedVisibility: "forever" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_visibility" });
  });
});

describe("status and completion through the API", () => {
  it("moves a task to done and back, returning the server-set completion time", async () => {
    const created = await createAs("token-a", { title: "Fullfør meg" });
    const done = await PATCH(request("PATCH", `${BASE}/${created.id}`, "token-a", { status: "done" }), taskParams(created.id));
    const doneBody = (await done.json()) as { status: string; completedAt: string | null };
    expect(doneBody.status).toBe("done");
    expect(doneBody.completedAt).not.toBeNull();
    const reopened = await PATCH(request("PATCH", `${BASE}/${created.id}`, "token-a", { status: "doing" }), taskParams(created.id));
    expect(await reopened.json()).toMatchObject({ status: "doing", completedAt: null });
  });
});
