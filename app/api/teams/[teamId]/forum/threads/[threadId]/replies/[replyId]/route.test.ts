import { afterEach, describe, expect, it, vi } from "vitest";

const deleteReplyMock = vi.fn();

vi.mock("../../../../../../../../../src/features/forum/server/delete-reply", () => ({
  deleteReply: deleteReplyMock,
}));

const { DELETE } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/forum/threads/thread-1/replies/reply-1", {
    method: "DELETE",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", threadId = "thread-1", replyId = "reply-1") {
  return { params: Promise.resolve({ teamId, threadId, replyId }) };
}

describe("DELETE /api/teams/[teamId]/forum/threads/[threadId]/replies/[replyId]", () => {
  afterEach(() => {
    deleteReplyMock.mockReset();
  });

  it("tombstones the reply for its own author, an app admin, or an idempotent retry", async () => {
    deleteReplyMock.mockResolvedValue({ ok: true });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("forwards the bearer token, teamId, threadId, and replyId", async () => {
    deleteReplyMock.mockResolvedValue({ ok: true });

    await DELETE(requestWithAuth("Bearer tok-1"), params("team-9", "thread-9", "reply-9"));

    expect(deleteReplyMock).toHaveBeenCalledWith("tok-1", "team-9", "thread-9", "reply-9");
  });

  it("maps sign_in_required to 401", async () => {
    deleteReplyMock.mockResolvedValue({ ok: false, error: "sign_in_required" });

    const response = await DELETE(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("maps not_found (wrong team/thread, or never existed) to 404", async () => {
    deleteReplyMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("maps forbidden (non-owner, non-admin, active reply) to 403", async () => {
    deleteReplyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("maps persistence_failed to a generic 500 without leaking detail", async () => {
    deleteReplyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
