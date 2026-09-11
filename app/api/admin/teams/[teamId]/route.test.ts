import { afterEach, describe, expect, it, vi } from "vitest";

const setTeamStatusMock = vi.fn();

vi.mock("../../../../../src/features/teams/server/set-team-status", () => ({
  setTeamStatus: setTeamStatusMock,
}));

const { PATCH } = await import("./route");

function patchRequest(
  body: unknown,
  header = "Bearer valid-token",
): Request {
  return new Request("http://localhost/api/admin/teams/team-1", {
    method: "PATCH",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("PATCH /api/admin/teams/[teamId]", () => {
  afterEach(() => {
    setTeamStatusMock.mockReset();
  });

  it("returns 200 for a valid admin status change", async () => {
    setTeamStatusMock.mockResolvedValue({ ok: true });

    const response = await PATCH(patchRequest({ status: "disabled" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token, teamId, and status through to setTeamStatus", async () => {
    setTeamStatusMock.mockResolvedValue({ ok: true });

    await PATCH(
      patchRequest({ status: "active" }, "Bearer abc.def.ghi"),
      params("team-42"),
    );

    expect(setTeamStatusMock).toHaveBeenCalledWith(
      "abc.def.ghi",
      "team-42",
      "active",
    );
  });

  it("returns a generic 400 and never calls setTeamStatus for an invalid status value", async () => {
    const response = await PATCH(
      patchRequest({ status: "deleted" }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(setTeamStatusMock).not.toHaveBeenCalled();
  });

  it("returns a generic 4xx and never calls setTeamStatus for a malformed body", async () => {
    const request = new Request("http://localhost/api/admin/teams/team-1", {
      method: "PATCH",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await PATCH(request, params());

    expect(response.status).toBe(400);
    expect(setTeamStatusMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    setTeamStatusMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PATCH(patchRequest({ status: "disabled" }, ""), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller, never changing status", async () => {
    setTeamStatusMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PATCH(patchRequest({ status: "disabled" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 500, not a partial success, on a persistence failure", async () => {
    setTeamStatusMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await PATCH(patchRequest({ status: "disabled" }), params());

    expect(response.status).toBe(500);
  });
});
