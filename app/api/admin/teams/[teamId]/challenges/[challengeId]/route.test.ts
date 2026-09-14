import { afterEach, describe, expect, it, vi } from "vitest";

const deleteChallengeMock = vi.fn();

vi.mock("../../../../../../../src/features/challenges/server/delete-challenge", () => ({
  deleteChallenge: deleteChallengeMock,
}));

const { DELETE } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/challenges/challenge-1", {
    method: "DELETE",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", challengeId = "challenge-1") {
  return { params: Promise.resolve({ teamId, challengeId }) };
}

describe("DELETE /api/admin/teams/[teamId]/challenges/[challengeId]", () => {
  afterEach(() => {
    deleteChallengeMock.mockReset();
  });

  it("deletes the challenge for an app admin, regardless of its status", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: true });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token, teamId, and challengeId through", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: true });

    await DELETE(requestWithAuth("Bearer abc.def.ghi"), params("team-42", "challenge-9"));

    expect(deleteChallengeMock).toHaveBeenCalledWith("abc.def.ghi", "team-42", "challenge-9");
  });

  it("returns 401 when unauthenticated", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await DELETE(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a missing challenge", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a challenge belonging to a different team", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: false, error: "wrong_team" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 500 on a persistence failure", async () => {
    deleteChallengeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
