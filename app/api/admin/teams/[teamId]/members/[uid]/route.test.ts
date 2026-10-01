import { afterEach, describe, expect, it, vi } from "vitest";

const removeTeamMemberMock = vi.fn();
const setTeamMemberRoleMock = vi.fn();

vi.mock(
  "../../../../../../../src/features/teams/server/remove-team-member",
  () => ({
    removeTeamMember: removeTeamMemberMock,
  }),
);

vi.mock(
  "../../../../../../../src/features/teams/server/set-team-member-role",
  () => ({
    setTeamMemberRole: setTeamMemberRoleMock,
  }),
);

const { DELETE, PATCH } = await import("./route");

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

function patchRequest(header: string | undefined, body: unknown): Request {
  return new Request("http://localhost/api/admin/teams/team-1/members/user-1", {
    method: "PATCH",
    headers: {
      ...(header ? { authorization: header } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/admin/teams/[teamId]/members/[uid]", () => {
  afterEach(() => {
    setTeamMemberRoleMock.mockReset();
    removeTeamMemberMock.mockReset();
  });

  it("sets the role for an app admin and returns exactly {ok, role}", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: true, role: "lead" });

    const response = await PATCH(patchRequest("Bearer abc.def", { role: "lead" }), params("team-42", "user-99"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, role: "lead" });
    expect(setTeamMemberRoleMock).toHaveBeenCalledWith("abc.def", "team-42", "user-99", "lead");
  });

  it("supports returning a lead to member", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: true, role: "member" });

    const response = await PATCH(patchRequest("Bearer t", { role: "member" }), params());

    expect(await response.json()).toEqual({ ok: true, role: "member" });
  });

  it("returns 401 when unauthenticated (missing header passes an empty token)", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PATCH(patchRequest(undefined, { role: "lead" }), params());

    expect(response.status).toBe(401);
    expect(setTeamMemberRoleMock).toHaveBeenCalledWith("", "team-1", "user-1", "lead");
  });

  it("returns 403 for an authenticated non-admin", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PATCH(patchRequest("Bearer t", { role: "lead" }), params());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("maps an unknown role value (rejected by the operation) to 400", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PATCH(patchRequest("Bearer t", { role: "admin" }), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
  });

  it("maps team_disabled to 400, consistent with the other admin routes that gate a write on team status", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await PATCH(patchRequest("Bearer t", { role: "lead" }), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "team_disabled" });
  });

  it("maps not_a_member to 404", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: false, error: "not_a_member" });

    const response = await PATCH(patchRequest("Bearer t", { role: "lead" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 500 with only a generic code on a persistence failure", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await PATCH(patchRequest("Bearer t", { role: "lead" }), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });

  it.each([
    ["an extra key", { role: "lead", teamStatus: "active" }],
    ["an extra uid key", { role: "lead", uid: "someone-else" }],
    ["a missing role key", {}],
    ["a wrong key", { isLead: true }],
    ["an array body", ["lead"]],
    ["a null body", "null"],
    ["malformed JSON", "{not json"],
  ])("rejects %s with 400 before calling the operation", async (_label, body) => {
    const response = await PATCH(patchRequest("Bearer t", body), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(setTeamMemberRoleMock).not.toHaveBeenCalled();
  });

  it("does not call removeTeamMember: PATCH never removes a membership", async () => {
    setTeamMemberRoleMock.mockResolvedValue({ ok: true, role: "member" });

    await PATCH(patchRequest("Bearer t", { role: "member" }), params());

    expect(removeTeamMemberMock).not.toHaveBeenCalled();
  });
});
