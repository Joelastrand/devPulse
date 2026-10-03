import { afterEach, describe, expect, it, vi } from "vitest";

const listAssignableMembersMock = vi.fn();

vi.mock("../../../../../src/features/teams/server/list-assignable-members", () => ({
  listAssignableMembers: listAssignableMembersMock,
}));

const { GET } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/assignable-members", {
    headers: header ? { authorization: header } : {},
  });
}

afterEach(() => {
  listAssignableMembersMock.mockReset();
});

describe("GET /api/teams/[teamId]/assignable-members", () => {
  it("returns exactly members, unavailableCount and truncated", async () => {
    listAssignableMembersMock.mockResolvedValue({
      ok: true,
      truncated: false,
      unavailableCount: 2,
      members: [{ memberRef: "ref-a", displayName: "Alex", ordinal: 1, isSelf: true }],
    });

    const response = await GET(requestWithAuth("Bearer abc.def"), params("team-42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      members: [{ memberRef: "ref-a", displayName: "Alex", ordinal: 1, isSelf: true }],
      unavailableCount: 2,
      truncated: false,
    });
    expect(listAssignableMembersMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it("serialises only the four public member keys even if the operation result carries extra fields", async () => {
    listAssignableMembersMock.mockResolvedValue({
      ok: true,
      truncated: false,
      unavailableCount: 0,
      members: [
        {
          memberRef: "ref-a",
          displayName: "Alex",
          ordinal: null,
          isSelf: false,
          uid: "user-secret-uid",
          email: "alex@example.com",
          createdAt: "2026-01-01",
          role: "lead",
          hasMemberRef: true,
          authorTag: "tag-secret",
        },
      ],
      uid: "top-secret-uid",
    });

    const response = await GET(requestWithAuth("Bearer t"), params());
    const payload = await response.json();
    const text = JSON.stringify(payload);

    expect(Object.keys(payload).sort()).toEqual(["members", "truncated", "unavailableCount"]);
    expect(Object.keys(payload.members[0]).sort()).toEqual(["displayName", "isSelf", "memberRef", "ordinal"]);
    for (const secret of ["secret", "alex@example.com", "createdAt", "role", "hasMemberRef", "authorTag"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("returns 401 when unauthenticated, passing an empty token for a missing header", async () => {
    listAssignableMembersMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "unauthenticated" });
    expect(listAssignableMembersMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns 403 with no member data", async () => {
    listAssignableMembersMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer t"), params());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: "forbidden" });
  });

  it("returns 500 with only a generic status on a read failure", async () => {
    listAssignableMembersMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer t"), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "read_failed" });
  });

  it("takes the team only from the route, ignoring any query-string team or uid", async () => {
    listAssignableMembersMock.mockResolvedValue({ ok: true, members: [], unavailableCount: 0, truncated: false });

    await GET(
      new Request("http://localhost/api/teams/team-1/assignable-members?teamId=team-2&uid=someone", {
        headers: { authorization: "Bearer t" },
      }),
      params("team-1"),
    );

    expect(listAssignableMembersMock).toHaveBeenCalledWith("t", "team-1");
  });

  it("exports no method other than GET (read-only endpoint)", async () => {
    const routeModule = await import("./route");

    expect(Object.keys(routeModule).sort()).toEqual(["GET"]);
  });
});
