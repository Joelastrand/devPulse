import { afterEach, describe, expect, it, vi } from "vitest";

const archiveChallengeMock = vi.fn();

vi.mock("../../../../../../../../src/features/challenges/server/archive-challenge", () => ({
  archiveChallenge: archiveChallengeMock,
}));

const { POST } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/challenges/challenge-1/archive", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", challengeId = "challenge-1") {
  return { params: Promise.resolve({ teamId, challengeId }) };
}

describe("POST /api/admin/teams/[teamId]/challenges/[challengeId]/archive", () => {
  afterEach(() => {
    archiveChallengeMock.mockReset();
  });

  it("archives the challenge for an app admin", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: true });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token, teamId, and challengeId through — no body is ever read", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: true });

    await POST(requestWithAuth("Bearer abc.def.ghi"), params("team-42", "challenge-9"));

    expect(archiveChallengeMock).toHaveBeenCalledWith("abc.def.ghi", "team-42", "challenge-9");
    expect(archiveChallengeMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when unauthenticated", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a missing challenge", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a challenge belonging to a different team", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: false, error: "wrong_team" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 500 on a persistence failure", async () => {
    archiveChallengeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
