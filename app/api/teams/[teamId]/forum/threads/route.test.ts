import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamThreadsMock = vi.fn();
const createThreadMock = vi.fn();

vi.mock("../../../../../../src/features/forum/server/list-team-threads", () => ({
  listTeamThreads: listTeamThreadsMock,
}));

vi.mock("../../../../../../src/features/forum/server/create-thread", () => ({
  createThread: createThreadMock,
}));

const { GET, POST } = await import("./route");

function getRequest(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/forum/threads", {
    headers: header ? { authorization: header } : {},
  });
}

function postRequest(body: unknown, header = "Bearer valid-token"): Request {
  return new Request("http://localhost/api/teams/team-1/forum/threads", {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/teams/[teamId]/forum/threads", () => {
  afterEach(() => {
    listTeamThreadsMock.mockReset();
  });

  it("returns the thread list for an authorized caller", async () => {
    const threads = [
      { threadId: "t1", title: "Hva synes dere om CI-tiden?", authorTag: "48D73D", isOwnThread: false, createdAt: "2026-01-10T10:00:00.000Z" },
    ];
    listTeamThreadsMock.mockResolvedValue({ ok: true, threads });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", threads });
  });

  it("forwards the bearer token and teamId to listTeamThreads", async () => {
    listTeamThreadsMock.mockResolvedValue({ ok: true, threads: [] });

    await GET(getRequest("Bearer valid-token"), params("team-42"));

    expect(listTeamThreadsMock).toHaveBeenCalledWith("valid-token", "team-42");
    expect(listTeamThreadsMock).toHaveBeenCalledTimes(1);
  });

  it("maps unauthenticated to 401", async () => {
    listTeamThreadsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(getRequest(), params());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ status: "unauthenticated" });
  });

  it("maps forbidden (non-member/non-admin) to 403", async () => {
    listTeamThreadsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("maps a read_failed infrastructure error to 500 without leaking detail", async () => {
    listTeamThreadsMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("treats a missing Authorization header as an empty token, never crashing", async () => {
    listTeamThreadsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await GET(getRequest(undefined), params());

    expect(listTeamThreadsMock).toHaveBeenCalledWith("", "team-1");
  });
});

describe("POST /api/teams/[teamId]/forum/threads", () => {
  afterEach(() => {
    createThreadMock.mockReset();
  });

  it("creates a thread and returns 201 with the generated threadId", async () => {
    createThreadMock.mockResolvedValue({ ok: true, threadId: "thread-9" });

    const response = await POST(
      postRequest({ title: "Har noen løst dette?", body: "Beskrivelse av problemet mitt." }),
      params(),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ ok: true, threadId: "thread-9" });
  });

  it("forwards exactly the token, teamId, title, and body to createThread", async () => {
    createThreadMock.mockResolvedValue({ ok: true, threadId: "thread-1" });

    await POST(postRequest({ title: "En tittel", body: "En body-tekst" }, "Bearer tok-1"), params("team-9"));

    expect(createThreadMock).toHaveBeenCalledWith("tok-1", "team-9", "En tittel", "En body-tekst");
  });

  it("never forwards extra request-body fields (authorUid/teamId override/threadId/deletedAt) to createThread", async () => {
    createThreadMock.mockResolvedValue({ ok: true, threadId: "thread-1" });

    await POST(
      postRequest({
        title: "En tittel",
        body: "En body-tekst",
        authorUid: "attacker-uid",
        teamId: "attacker-team",
        threadId: "attacker-thread",
        deletedAt: "2026-01-01T00:00:00.000Z",
      }),
      params("team-9"),
    );

    expect(createThreadMock).toHaveBeenCalledWith("valid-token", "team-9", "En tittel", "En body-tekst");
  });

  it("maps sign_in_required to 401", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "sign_in_required" });

    const response = await POST(postRequest({ title: "x".repeat(10), body: "x".repeat(10) }), params());

    expect(response.status).toBe(401);
  });

  it("maps invalid_input to 400", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await POST(postRequest({ title: "no", body: "no" }), params());

    expect(response.status).toBe(400);
  });

  it("maps forbidden (app-admin-without-membership) to 403", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest({ title: "x".repeat(10), body: "x".repeat(10) }), params());

    expect(response.status).toBe(403);
  });

  it("maps team_not_found to 404", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "team_not_found" });

    const response = await POST(postRequest({ title: "x".repeat(10), body: "x".repeat(10) }), params());

    expect(response.status).toBe(404);
  });

  it("maps team_disabled to 400", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(postRequest({ title: "x".repeat(10), body: "x".repeat(10) }), params());

    expect(response.status).toBe(400);
  });

  it("maps encryption_failed to a generic 500 without leaking detail", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "encryption_failed" });

    const response = await POST(postRequest({ title: "x".repeat(10), body: "x".repeat(10) }), params());

    expect(response.status).toBe(500);
  });

  it("maps persistence_failed to a generic 500 without leaking detail", async () => {
    createThreadMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest({ title: "x".repeat(10), body: "x".repeat(10) }), params());

    expect(response.status).toBe(500);
  });

  it("rejects a malformed JSON body as invalid_input without calling createThread", async () => {
    const request = new Request("http://localhost/api/teams/team-1/forum/threads", {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not json",
    });

    const response = await POST(request, params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_input" });
    expect(createThreadMock).not.toHaveBeenCalled();
  });

  it("never echoes the submitted title/body back to the caller", async () => {
    createThreadMock.mockResolvedValue({ ok: true, threadId: "thread-1" });

    const response = await POST(postRequest({ title: "A specific title", body: "A specific body" }), params());
    const payload = await response.json();

    expect(Object.keys(payload).sort()).toEqual(["ok", "threadId"]);
  });
});
