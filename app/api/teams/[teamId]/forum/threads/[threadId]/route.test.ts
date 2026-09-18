import { afterEach, describe, expect, it, vi } from "vitest";

const getThreadWithRepliesMock = vi.fn();
const deleteThreadMock = vi.fn();

vi.mock("../../../../../../../src/features/forum/server/get-thread-with-replies", () => ({
  getThreadWithReplies: getThreadWithRepliesMock,
}));

vi.mock("../../../../../../../src/features/forum/server/delete-thread", () => ({
  deleteThread: deleteThreadMock,
}));

const { GET, DELETE } = await import("./route");

function request(method: string, header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/forum/threads/thread-1", {
    method,
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", threadId = "thread-1") {
  return { params: Promise.resolve({ teamId, threadId }) };
}

describe("GET /api/teams/[teamId]/forum/threads/[threadId]", () => {
  afterEach(() => {
    getThreadWithRepliesMock.mockReset();
  });

  it("returns the thread and its replies for an authorized caller", async () => {
    const thread = { threadId: "thread-1", title: "T", body: "B", authorTag: "48D73D", isOwnThread: true, createdAt: "2026-01-10T10:00:00.000Z" };
    const replies = [{ replyId: "r1", isDeleted: false, body: "Svar", authorTag: "AA11BB", isOwnReply: false, createdAt: "2026-01-10T11:00:00.000Z" }];
    getThreadWithRepliesMock.mockResolvedValue({ ok: true, thread, replies });

    const response = await GET(request("GET", "Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", thread, replies });
  });

  it("forwards the bearer token, teamId, and threadId", async () => {
    getThreadWithRepliesMock.mockResolvedValue({ ok: true, thread: {}, replies: [] });

    await GET(request("GET", "Bearer valid-token"), params("team-9", "thread-9"));

    expect(getThreadWithRepliesMock).toHaveBeenCalledWith("valid-token", "team-9", "thread-9");
  });

  it("maps unauthenticated to 401", async () => {
    getThreadWithRepliesMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(request("GET"), params());

    expect(response.status).toBe(401);
  });

  it("maps forbidden to 403", async () => {
    getThreadWithRepliesMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(request("GET", "Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("maps not_found (cross-team, deleted, or never-existed) to 404", async () => {
    getThreadWithRepliesMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await GET(request("GET", "Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("maps read_failed to a generic 500 without leaking detail", async () => {
    getThreadWithRepliesMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(request("GET", "Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/teams/[teamId]/forum/threads/[threadId]", () => {
  afterEach(() => {
    deleteThreadMock.mockReset();
  });

  it("deletes the thread for its own author or an app admin", async () => {
    deleteThreadMock.mockResolvedValue({ ok: true });

    const response = await DELETE(request("DELETE", "Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("forwards the bearer token, teamId, and threadId", async () => {
    deleteThreadMock.mockResolvedValue({ ok: true });

    await DELETE(request("DELETE", "Bearer tok-1"), params("team-9", "thread-9"));

    expect(deleteThreadMock).toHaveBeenCalledWith("tok-1", "team-9", "thread-9");
  });

  it("maps sign_in_required to 401", async () => {
    deleteThreadMock.mockResolvedValue({ ok: false, error: "sign_in_required" });

    const response = await DELETE(request("DELETE"), params());

    expect(response.status).toBe(401);
  });

  it("maps not_found to 404", async () => {
    deleteThreadMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await DELETE(request("DELETE", "Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("maps forbidden (non-owner, non-admin) to 403", async () => {
    deleteThreadMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(request("DELETE", "Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("maps persistence_failed to a generic 500 without leaking detail", async () => {
    deleteThreadMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(request("DELETE", "Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
