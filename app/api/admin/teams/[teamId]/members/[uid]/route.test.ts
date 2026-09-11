import { afterEach, describe, expect, it, vi } from "vitest";

const removeTeamMemberMock = vi.fn();

vi.mock(
  "../../../../../../../src/features/teams/server/remove-team-member",
  () => ({
    removeTeamMember: removeTeamMemberMock,
  }),
);

const { DELETE } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/members/user-1", {
    method: "DELETE",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", uid = "user-1") {
  return { params: Promise.resolve({ teamId, uid }) };
}

describe("DELETE /api/admin/teams/[teamId]/members/[uid]", () => {
  afterEach(() => {
    removeTeamMemberMock.mockReset();
  });

  it("returns 200 for a valid admin removal", async () => {
    removeTeamMemberMock.mockResolvedValue({ ok: true });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token, teamId, and uid through to removeTeamMember", async () => {
    removeTeamMemberMock.mockResolvedValue({ ok: true });

    await DELETE(
      requestWithAuth("Bearer abc.def.ghi"),
      params("team-42", "user-99"),
    );

    expect(removeTeamMemberMock).toHaveBeenCalledWith(
      "abc.def.ghi",
      "team-42",
      "user-99",
    );
  });

  it("returns 401 when unauthenticated", async () => {
    removeTeamMemberMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await DELETE(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller, never removing a member", async () => {
    removeTeamMemberMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 500, not a partial success, on a persistence failure", async () => {
    removeTeamMemberMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
