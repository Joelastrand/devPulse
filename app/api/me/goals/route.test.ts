import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOAL_DTO_KEYS, GOAL_LIST_RESPONSE_KEYS } from "../../../../src/features/personal-goals/domain/goal-constants";

const verifyIdTokenMock = vi.fn();
const getPersonalGoalsMock = vi.fn();
const createPersonalGoalMock = vi.fn();

vi.mock("../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../src/features/personal-goals/server/get-personal-goals", () => ({
  getPersonalGoals: getPersonalGoalsMock,
}));
vi.mock("../../../../src/features/personal-goals/server/create-personal-goal", () => ({
  createPersonalGoal: createPersonalGoalMock,
}));

const routeModule = await import("./route");

const OWNER_A = "owner-a-uid-7731";
const OWNER_B = "owner-b-uid-4402";

const goalDto = {
  id: "goal0000000000000001",
  title: "Lær Rust",
  status: "active",
  treeId: "tree1",
  areaName: "Testning",
  areaAvailable: true,
  targetDate: "2026-12-31",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

const url = "http://localhost/api/me/goals";
const get = (headers: Record<string, string> = { authorization: "Bearer good.token" }, query = "") =>
  new Request(url + query, { method: "GET", headers });
const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer good.token" }) =>
  new Request(url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const verifiedAs = (uid: string) =>
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid, email: "x@example.test", emailVerified: true } });

beforeEach(() => verifiedAs(OWNER_A));
afterEach(() => {
  verifyIdTokenMock.mockReset();
  getPersonalGoalsMock.mockReset();
  createPersonalGoalMock.mockReset();
  vi.restoreAllMocks();
});

const expectNoStore = (response: Response) => expect(response.headers.get("cache-control")).toBe("no-store");

describe("GET /api/me/goals", () => {
  const envelope = {
    goals: [goalDto],
    recoveryItems: [{ goalId: "badgoal1" }],
    truncated: true,
    skillOptions: [{ treeId: "tree1", name: "Testning" }],
    skillOptionsTruncated: false,
  };

  it("lists the goals of the verified subject only and returns the exact five-key envelope", async () => {
    getPersonalGoalsMock.mockResolvedValue({ ok: true, dto: envelope });
    const response = await routeModule.GET(get());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toEqual(envelope);
    expect(Object.keys(body)).toEqual([...GOAL_LIST_RESPONSE_KEYS]);
    expect(Object.keys(body.goals[0])).toEqual([...GOAL_DTO_KEYS]);
    expect(Object.keys(body.recoveryItems[0])).toEqual(["goalId"]);
    expect(verifyIdTokenMock).toHaveBeenCalledWith("good.token");
    expect(getPersonalGoalsMock).toHaveBeenCalledTimes(1);
    expect(getPersonalGoalsMock).toHaveBeenCalledWith(OWNER_A);
  });

  it("re-allow-lists the response: stray fields from the operation never reach the client", async () => {
    getPersonalGoalsMock.mockResolvedValue({
      ok: true,
      dto: {
        ...envelope,
        goals: [{ ...goalDto, ownerUid: OWNER_A, email: "x@example.test", nodes: ["leak"] }],
        recoveryItems: [{ goalId: "badgoal1", title: "LEAK" }],
        skillOptions: [{ treeId: "tree1", name: "Testning", level: 3 }],
        extra: "leak",
      },
    });
    const text = await (await routeModule.GET(get())).text();
    expect(JSON.parse(text)).toEqual(envelope);
    for (const leaked of ["LEAK", "leak", OWNER_A, "example.test"]) expect(text).not.toContain(leaked);
  });

  it("ignores every query parameter: another owner cannot be selected", async () => {
    getPersonalGoalsMock.mockResolvedValue({ ok: true, dto: envelope });
    await routeModule.GET(get(undefined, `?uid=${OWNER_B}&ownerUid=${OWNER_B}&teamId=t1`));
    expect(getPersonalGoalsMock).toHaveBeenCalledWith(OWNER_A);
    expect(JSON.stringify(getPersonalGoalsMock.mock.calls)).not.toContain(OWNER_B);
  });

  it("does not read a request body", async () => {
    getPersonalGoalsMock.mockResolvedValue({ ok: true, dto: envelope });
    const request = new Request(url, {
      method: "GET",
      headers: { authorization: "Bearer good.token" },
    });
    const text = vi.spyOn(request, "text");
    const json = vi.spyOn(request, "json");
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");
    await routeModule.GET(request);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing header", {}],
    ["a non-bearer scheme", { authorization: "Basic abc" }],
    ["a bare Bearer", { authorization: "Bearer" }],
  ])("returns 401 for %s without verifying or listing", async (_name, headers) => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.GET(get(headers));
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(verifyIdTokenMock).toHaveBeenCalledWith("");
    expect(getPersonalGoalsMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an unverifiable token without exposing the verifier error", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.GET(get());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(getPersonalGoalsMock).not.toHaveBeenCalled();
  });

  it("maps persistence_failed to 500 with no partial body", async () => {
    getPersonalGoalsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const response = await routeModule.GET(get());
    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("POST /api/me/goals — success", () => {
  it("creates for the verified subject from a minimal body and returns 201 with the exact DTO", async () => {
    createPersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    const response = await routeModule.POST(post({ title: "Lær Rust" }));
    expect(response.status).toBe(201);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toEqual(goalDto);
    expect(Object.keys(body)).toEqual([...GOAL_DTO_KEYS]);
    expect(createPersonalGoalMock).toHaveBeenCalledTimes(1);
    expect(createPersonalGoalMock).toHaveBeenCalledWith(OWNER_A, { title: "Lær Rust" });
    expect(Object.keys(createPersonalGoalMock.mock.calls[0][1])).toEqual(["title"]);
  });

  it("forwards treeId and targetDate unchanged, with no selector or catalog check in the route", async () => {
    createPersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    await routeModule.POST(post({ title: "x", treeId: "tree-outside-first-500", targetDate: "2026-12-31" }));
    expect(createPersonalGoalMock).toHaveBeenCalledWith(OWNER_A, {
      title: "x",
      treeId: "tree-outside-first-500",
      targetDate: "2026-12-31",
    });
  });

  it.each(["treeId", "targetDate"])("omits a null %s before calling the operation (null means absent on POST)", async (key) => {
    createPersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    await routeModule.POST(post({ title: "x", [key]: null }));
    const input = createPersonalGoalMock.mock.calls[0][1];
    expect(input).toEqual({ title: "x" });
    expect(Object.keys(input)).toEqual(["title"]);
  });

  it("passes a whitespace-only title through: the operation owns title validity", async () => {
    createPersonalGoalMock.mockResolvedValue({ ok: false, error: "invalid_title" });
    const response = await routeModule.POST(post({ title: "   " }));
    expect(createPersonalGoalMock).toHaveBeenCalledWith(OWNER_A, { title: "   " });
    expect(response.status).toBe(400);
  });

  it("re-allow-lists the created DTO", async () => {
    createPersonalGoalMock.mockResolvedValue({ ok: true, dto: { ...goalDto, ownerUid: OWNER_A, extra: "leak" } });
    const text = await (await routeModule.POST(post({ title: "x" }))).text();
    expect(JSON.parse(text)).toEqual(goalDto);
    expect(text).not.toContain(OWNER_A);
  });
});

describe("POST /api/me/goals — operation errors (BR-23)", () => {
  it.each([
    ["invalid_title", 400],
    ["invalid_target_date", 400],
    ["skill_not_found", 404],
    ["goal_limit", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i with only { error }", async (error, status) => {
    createPersonalGoalMock.mockResolvedValue({ ok: false, error });
    const response = await routeModule.POST(post({ title: "SECRET-TITLE", treeId: "SECRET-TREE" }));
    expect(response.status).toBe(status);
    expectNoStore(response);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error });
    expect(text).not.toMatch(/SECRET|\/goals\//);
  });
});

describe("POST /api/me/goals — request shape (BR-22)", () => {
  it.each([
    ["uid", { title: "x", uid: OWNER_B }],
    ["ownerUid", { title: "x", ownerUid: OWNER_B }],
    ["status", { title: "x", status: "completed" }],
    ["teamId", { title: "x", teamId: "t1" }],
    ["memberRef", { title: "x", memberRef: "m1" }],
    ["email", { title: "x", email: "x@example.test" }],
    ["an arbitrary extra key", { title: "x", extra: 1 }],
  ])("rejects unknown key %s with 400 invalid_request and never calls the operation", async (_name, body) => {
    const response = await routeModule.POST(post(body));
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(createPersonalGoalMock).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{title:"],
    ["an empty body", ""],
    ["null", "null"],
    ["an array", '[{"title":"x"}]'],
    ["a primitive", "42"],
    ["a missing title", "{}"],
    ["a non-string title", '{"title":5}'],
    ["a wrongly typed treeId", '{"title":"x","treeId":5}'],
    ["a wrongly typed targetDate", '{"title":"x","targetDate":20260101}'],
    ["an oversize body", JSON.stringify({ title: "x".repeat(5000) })],
  ])("rejects %s with 400 invalid_request, not 500", async (_name, body) => {
    const response = await routeModule.POST(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(createPersonalGoalMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/me/goals — authentication and subject binding (BR-1, BR-5, SI-2)", () => {
  it.each([
    ["a missing header", {}],
    ["a non-bearer scheme", { authorization: "Basic abc" }],
    ["a bare Bearer", { authorization: "Bearer" }],
  ])("returns 401 for %s before reading the body or calling the operation", async (_name, headers) => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const request = post({ title: "x" }, headers);
    const text = vi.spyOn(request, "text");
    const response = await routeModule.POST(request);
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(text).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(createPersonalGoalMock).not.toHaveBeenCalled();
  });

  it("authenticates before body validation: an unverifiable token with a bad body is 401, not 400", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.POST(post("not json"));
    expect(response.status).toBe(401);
    expect(createPersonalGoalMock).not.toHaveBeenCalled();
  });

  it("never lets a body select another owner: an owner selector is rejected and the next valid request uses the token subject", async () => {
    const attempt = await routeModule.POST(post({ title: "x", ownerUid: OWNER_B, uid: OWNER_B }));
    expect(attempt.status).toBe(400);
    expect(createPersonalGoalMock).not.toHaveBeenCalled();

    createPersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    await routeModule.POST(post({ title: "x" }));
    expect(createPersonalGoalMock).toHaveBeenCalledTimes(1);
    expect(createPersonalGoalMock.mock.calls[0][0]).toBe(OWNER_A);
    expect(JSON.stringify(createPersonalGoalMock.mock.calls)).not.toContain(OWNER_B);
  });

  it.each([
    ["an app-admin", "admin-uid-1"],
    ["a team lead", "lead-uid-1"],
    ["a teammate", "teammate-uid-1"],
  ])("treats %s like any other user: only the token uid reaches the operations", async (_name, uid) => {
    verifiedAs(uid);
    getPersonalGoalsMock.mockResolvedValue({
      ok: true,
      dto: { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false },
    });
    createPersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    await routeModule.GET(get());
    await routeModule.POST(post({ title: "x" }));
    expect(getPersonalGoalsMock.mock.calls).toEqual([[uid]]);
    expect(createPersonalGoalMock.mock.calls.map(([owner]) => owner)).toEqual([uid]);
  });
});

describe("/api/me/goals — logging and surface", () => {
  it("logs nothing on success, auth failure, body errors or operation failures", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    getPersonalGoalsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    createPersonalGoalMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    await routeModule.GET(get());
    await routeModule.POST(post({ title: "SECRET-TITLE" }));
    await routeModule.POST(post("{SECRET"));
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    await routeModule.GET(get());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("exports only GET and POST handlers", () => {
    const handlers = Object.keys(routeModule).filter((key) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(key));
    expect(handlers.sort()).toEqual(["GET", "POST"]);
  });
});
