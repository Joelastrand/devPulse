import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamChallengesForMemberMock = vi.fn();
const submitChallengeMock = vi.fn();

vi.mock("../../../../../src/features/challenges/server/list-team-challenges", () => ({
  listTeamChallengesForMember: listTeamChallengesForMemberMock,
}));

vi.mock("../../../../../src/features/challenges/server/submit-challenge", () => ({
  submitChallenge: submitChallengeMock,
}));

const { GET, POST } = await import("./route");

function getRequest(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/challenges", {
    headers: header ? { authorization: header } : {},
  });
}

function postRequest(body: unknown, header = "Bearer valid-token"): Request {
  return new Request("http://localhost/api/teams/team-1/challenges", {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/teams/[teamId]/challenges", () => {
  afterEach(() => {
    listTeamChallengesForMemberMock.mockReset();
  });

  it("returns the member-scoped challenge list for an authorized caller", async () => {
    const challenges = [
      { challengeId: "c1", text: "Deploy process needs an owner", status: "open", submittedAt: "2026-01-10" },
    ];
    listTeamChallengesForMemberMock.mockResolvedValue({ ok: true, challenges });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", challenges });
  });

  it("always calls listTeamChallengesForMember, never an admin-scoped operation", async () => {
    listTeamChallengesForMemberMock.mockResolvedValue({ ok: true, challenges: [] });

    await GET(getRequest("Bearer valid-token"), params("team-42"));

    expect(listTeamChallengesForMemberMock).toHaveBeenCalledWith("valid-token", "team-42");
    expect(listTeamChallengesForMemberMock).toHaveBeenCalledTimes(1);
  });

  it("maps unauthenticated to 401", async () => {
    listTeamChallengesForMemberMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(getRequest(), params());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ status: "unauthenticated" });
  });

  it("maps forbidden (non-member) to 403", async () => {
    listTeamChallengesForMemberMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("maps a read_failed infrastructure error to 500 without leaking detail", async () => {
    listTeamChallengesForMemberMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("treats a missing Authorization header as an empty token, never crashing", async () => {
    listTeamChallengesForMemberMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await GET(getRequest(undefined), params());

    expect(listTeamChallengesForMemberMock).toHaveBeenCalledWith("", "team-1");
  });
});

describe("POST /api/teams/[teamId]/challenges", () => {
  afterEach(() => {
    submitChallengeMock.mockReset();
  });

  it("submits successfully and returns 201 with a minimal body", async () => {
    submitChallengeMock.mockResolvedValue({ ok: true });

    const response = await POST(postRequest({ text: "Code review takes too long" }), params());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ ok: true });
  });

  it("forwards exactly the token, teamId, and text field to submitChallenge", async () => {
    submitChallengeMock.mockResolvedValue({ ok: true });

    await POST(postRequest({ text: "Some challenge text" }, "Bearer tok-1"), params("team-9"));

    expect(submitChallengeMock).toHaveBeenCalledWith("tok-1", "team-9", "Some challenge text");
  });

  it("never forwards extra request-body fields (uid/teamId override/status) to submitChallenge", async () => {
    submitChallengeMock.mockResolvedValue({ ok: true });

    await POST(
      postRequest({
        text: "Legit challenge text",
        uid: "attacker-uid",
        teamId: "attacker-team",
        status: "resolved",
      }),
      params("team-9"),
    );

    expect(submitChallengeMock).toHaveBeenCalledWith("valid-token", "team-9", "Legit challenge text");
  });

  it("maps sign_in_required to 401", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "sign_in_required" });

    const response = await POST(postRequest({ text: "x".repeat(10) }), params());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "sign_in_required" });
  });

  it("maps invalid_input to 400", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await POST(postRequest({ text: "no" }), params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_input" });
  });

  it("maps forbidden (non-member) to 403", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest({ text: "x".repeat(10) }), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("maps team_disabled to 400", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(postRequest({ text: "x".repeat(10) }), params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "team_disabled" });
  });

  it("maps team_not_found to 404", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "team_not_found" });

    const response = await POST(postRequest({ text: "x".repeat(10) }), params());
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "team_not_found" });
  });

  it("maps encryption_failed to a generic 500 without leaking detail", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "encryption_failed" });

    const response = await POST(postRequest({ text: "x".repeat(10) }), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "encryption_failed" });
  });

  it("maps persistence_failed to a generic 500 without leaking detail", async () => {
    submitChallengeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest({ text: "x".repeat(10) }), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "persistence_failed" });
  });

  it("rejects a malformed JSON body as invalid_input without calling submitChallenge", async () => {
    const request = new Request("http://localhost/api/teams/team-1/challenges", {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not json",
    });

    const response = await POST(request, params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_input" });
    expect(submitChallengeMock).not.toHaveBeenCalled();
  });

  it("never echoes the submitted text or a generated id back to the caller", async () => {
    submitChallengeMock.mockResolvedValue({ ok: true });

    const response = await POST(postRequest({ text: "Some fairly specific challenge text" }), params());
    const payload = await response.json();

    expect(Object.keys(payload)).toEqual(["ok"]);
  });
});
