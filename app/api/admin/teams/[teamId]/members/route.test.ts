import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamMembersMock = vi.fn();

vi.mock("../../../../../../src/features/teams/server/list-team-members", () => ({
  listTeamMembers: listTeamMembersMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/members", {
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/admin/teams/[teamId]/members", () => {
  afterEach(() => {
    listTeamMembersMock.mockReset();
  });

  it("returns the member list for an app admin", async () => {
    const members = [{ uid: "user-1", email: "one@example.com" }];
    listTeamMembersMock.mockResolvedValue({ ok: true, members });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ members });
  });

  it("passes the bearer token and teamId through to listTeamMembers", async () => {
    listTeamMembersMock.mockResolvedValue({ ok: true, members: [] });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(listTeamMembersMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns 401 when unauthenticated", async () => {
    listTeamMembersMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(listTeamMembersMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns 403 for a non-admin caller, never a member list", async () => {
    listTeamMembersMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("returns 500 on a read failure, not a partial list", async () => {
    listTeamMembersMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
