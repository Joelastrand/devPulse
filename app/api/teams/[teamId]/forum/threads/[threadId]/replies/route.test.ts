import { afterEach, describe, expect, it, vi } from "vitest";

const createReplyMock = vi.fn();

vi.mock("../../../../../../../../src/features/forum/server/create-reply", () => ({
  createReply: createReplyMock,
}));

const { POST } = await import("./route");

function postRequest(body: unknown, header = "Bearer valid-token"): Request {
  return new Request("http://localhost/api/teams/team-1/forum/threads/thread-1/replies", {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(teamId = "team-1", threadId = "thread-1") {
  return { params: Promise.resolve({ teamId, threadId }) };
}

describe("POST /api/teams/[teamId]/forum/threads/[threadId]/replies", () => {
  afterEach(() => {
    createReplyMock.mockReset();
  });

  it("creates a reply and returns 201", async () => {
    createReplyMock.mockResolvedValue({ ok: true });

    const response = await POST(postRequest({ body: "Et svar på tråden." }), params());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ ok: true });
  });

  it("forwards exactly the token, teamId, threadId, and body to createReply", async () => {
    createReplyMock.mockResolvedValue({ ok: true });

    await POST(postRequest({ body: "Svar-tekst" }, "Bearer tok-1"), params("team-9", "thread-9"));

    expect(createReplyMock).toHaveBeenCalledWith("tok-1", "team-9", "thread-9", "Svar-tekst");
  });

  it("never forwards extra request-body fields (authorUid/teamId/threadId override/deletedAt) to createReply", async () => {
    createReplyMock.mockResolvedValue({ ok: true });

    await POST(
      postRequest({
        body: "Legitimt svar",
        authorUid: "attacker-uid",
        teamId: "attacker-team",
        threadId: "attacker-thread",
        replyId: "attacker-reply",
        deletedAt: "2026-01-01T00:00:00.000Z",
      }),
      params("team-9", "thread-9"),
    );

    expect(createReplyMock).toHaveBeenCalledWith("valid-token", "team-9", "thread-9", "Legitimt svar");
  });

  it("maps sign_in_required to 401", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "sign_in_required" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(401);
  });

  it("maps invalid_input to 400", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await POST(postRequest({ body: "no" }), params());

    expect(response.status).toBe(400);
  });

  it("maps forbidden to 403", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(403);
  });

  it("maps not_found (deleted/cross-team/nonexistent thread) to 404", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(404);
  });

  it("maps team_disabled to 400", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(400);
  });

  it("maps thread_full to 400", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "thread_full" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(400);
  });

  it("maps encryption_failed to a generic 500 without leaking detail", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "encryption_failed" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(500);
  });

  it("maps persistence_failed to a generic 500 without leaking detail", async () => {
    createReplyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest({ body: "x".repeat(10) }), params());

    expect(response.status).toBe(500);
  });

  it("rejects a malformed JSON body as invalid_input without calling createReply", async () => {
    const request = new Request("http://localhost/api/teams/team-1/forum/threads/thread-1/replies", {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not json",
    });

    const response = await POST(request, params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_input" });
    expect(createReplyMock).not.toHaveBeenCalled();
  });

  it("never echoes the submitted body back to the caller", async () => {
    createReplyMock.mockResolvedValue({ ok: true });

    const response = await POST(postRequest({ body: "A fairly specific reply body" }), params());
    const payload = await response.json();

    expect(Object.keys(payload)).toEqual(["ok"]);
  });
});
