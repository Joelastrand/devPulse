import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamRosterMock = vi.fn();

vi.mock("../../../../../src/features/teams/server/list-team-roster", () => ({
  listTeamRoster: listTeamRosterMock,
}));

const { GET } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/members", {
    headers: header ? { authorization: header } : {},
  });
}

afterEach(() => {
  listTeamRosterMock.mockReset();
});

describe("GET /api/teams/[teamId]/members", () => {
  it("returns the roster with exactly status, members and truncated", async () => {
    listTeamRosterMock.mockResolvedValue({
      ok: true,
      truncated: false,
      members: [
        { displayName: "Anna Berg", isLead: true, isSelf: false },
        { displayName: null, isLead: false, isSelf: true },
      ],
    });

    const response = await GET(requestWithAuth("Bearer abc.def"), params("team-42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      members: [
        { displayName: "Anna Berg", isLead: true, isSelf: false },
        { displayName: null, isLead: false, isSelf: true },
      ],
      truncated: false,
    });
    expect(listTeamRosterMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it("serialises only the three public keys even if the operation result carries extra fields", async () => {
    // Defence in depth: a future accidental object spread in the operation
    // must not reach the wire. A uid here would make a Forum authorTag
    // (SHA-256(teamId:authorUid)) computable for any member.
    listTeamRosterMock.mockResolvedValue({
      ok: true,
      truncated: false,
      members: [
        {
          displayName: "Anna Berg",
          isLead: false,
          isSelf: false,
          uid: "user-secret-uid",
          email: "anna@example.com",
          grantedBy: "admin-secret-uid",
          teamId: "team-1",
          roleUpdatedBy: "admin-secret-uid",
        },
      ],
    });

    const response = await GET(requestWithAuth("Bearer t"), params());
    const text = JSON.stringify(await response.json());

    expect(text).not.toContain("secret-uid");
    expect(text).not.toContain("anna@example.com");
    expect(text).not.toContain("roleUpdatedBy");
    expect(text).not.toContain("grantedBy");
    const payload = JSON.parse(text) as { members: Array<Record<string, unknown>> };
    expect(Object.keys(payload.members[0]).sort()).toEqual(["displayName", "isLead", "isSelf"]);
  });

  it("reports truncation", async () => {
    listTeamRosterMock.mockResolvedValue({ ok: true, members: [], truncated: true });

    const response = await GET(requestWithAuth("Bearer t"), params());

    expect((await response.json()).truncated).toBe(true);
  });

  it("returns 401 when unauthenticated, passing an empty token for a missing header", async () => {
    listTeamRosterMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "unauthenticated" });
    expect(listTeamRosterMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns 403 for a caller without access, with no member data", async () => {
    listTeamRosterMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer t"), params());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: "forbidden" });
  });

  it("returns 500 with only a generic status on a read failure — never 403", async () => {
    listTeamRosterMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer t"), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "read_failed" });
  });

  it("takes the team only from the route, ignoring any query-string team or uid", async () => {
    listTeamRosterMock.mockResolvedValue({ ok: true, members: [], truncated: false });

    await GET(
      new Request("http://localhost/api/teams/team-1/members?teamId=team-2&uid=someone", {
        headers: { authorization: "Bearer t" },
      }),
      params("team-1"),
    );

    expect(listTeamRosterMock).toHaveBeenCalledWith("t", "team-1");
  });

  it("exports no method other than GET (read-only endpoint)", async () => {
    const routeModule = await import("./route");

    expect(Object.keys(routeModule).sort()).toEqual(["GET"]);
  });
});
