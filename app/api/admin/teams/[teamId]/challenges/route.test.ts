import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamChallengesForAdminMock = vi.fn();
const listTeamChallengesForMemberMock = vi.fn();

vi.mock("../../../../../../src/features/challenges/server/list-team-challenges", () => ({
  listTeamChallengesForAdmin: listTeamChallengesForAdminMock,
  listTeamChallengesForMember: listTeamChallengesForMemberMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/challenges", {
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/admin/teams/[teamId]/challenges", () => {
  afterEach(() => {
    listTeamChallengesForAdminMock.mockReset();
    listTeamChallengesForMemberMock.mockReset();
  });

  it("returns the full admin challenge list (open/resolved/archived) for an app admin", async () => {
    const challenges = [
      { challengeId: "c-1", text: "Open one", status: "open", submittedAt: "2026-01-01" },
      { challengeId: "c-2", text: "Resolved one", status: "resolved", submittedAt: "2026-01-02" },
      { challengeId: "c-3", text: "Archived one", status: "archived", submittedAt: "2026-01-03" },
    ];
    listTeamChallengesForAdminMock.mockResolvedValue({ ok: true, challenges });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", challenges });
  });

  it("delegates to listTeamChallengesForAdmin only, never listTeamChallengesForMember", async () => {
    listTeamChallengesForAdminMock.mockResolvedValue({ ok: true, challenges: [] });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(listTeamChallengesForAdminMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
    expect(listTeamChallengesForMemberMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated, passing an empty token rather than trusting the header", async () => {
    listTeamChallengesForAdminMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(listTeamChallengesForAdminMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns 403 for a non-admin caller, including a plain team member, never a challenge list", async () => {
    listTeamChallengesForAdminMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns 500 on a read failure, not a partial list", async () => {
    listTeamChallengesForAdminMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
