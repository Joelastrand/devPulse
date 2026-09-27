import { afterEach, describe, expect, it, vi } from "vitest";

const getTeamSkillProgressMock = vi.fn();

vi.mock("../../../../../src/features/skill-trees/server/get-team-skill-progress", () => ({
  getTeamSkillProgress: getTeamSkillProgressMock,
}));

const { GET } = await import("./route");

function getRequest(header?: string, teamId = "team-1"): Request {
  return new Request(`http://localhost/api/teams/${teamId}/skills`, {
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/teams/[teamId]/skills", () => {
  afterEach(() => {
    getTeamSkillProgressMock.mockReset();
  });

  it("returns the team-scoped skill list for an authorized member", async () => {
    const skills = [
      {
        treeId: "tree-1",
        name: "Containers",
        nodes: [
          { nodeId: "node-0", label: "Fundamentals", order: 0 },
          { nodeId: "node-1", label: "Pilot", order: 1 },
        ],
        currentNodeId: "node-0",
      },
    ];
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills, canReportProgress: true });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", skills, canReportProgress: true });
  });

  it("passes through canReportProgress: true exactly as getTeamSkillProgress returned it", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills: [], canReportProgress: true });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(payload.canReportProgress).toBe(true);
  });

  it("passes through canReportProgress: false exactly as getTeamSkillProgress returned it (docs/features/skill-progress-self-report/SPEC.md — 'Permission-UI correction')", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills: [], canReportProgress: false });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(payload.canReportProgress).toBe(false);
  });

  it("returns the team-scoped skill list for an authorized app admin (authorizeTeamAccess behavior delegated unchanged)", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills: [] });

    const response = await GET(getRequest("Bearer admin-token"), params("team-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", skills: [] });
    expect(getTeamSkillProgressMock).toHaveBeenCalledWith("admin-token", "team-1");
  });

  it("always calls getTeamSkillProgress with the route-scoped teamId, never a body override", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills: [] });

    await GET(getRequest("Bearer valid-token", "team-42"), params("team-42"));

    expect(getTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-42");
    expect(getTeamSkillProgressMock).toHaveBeenCalledTimes(1);
  });

  it("maps unauthenticated to 401", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(getRequest(), params());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ status: "unauthenticated" });
  });

  it("rejects a Team A caller requesting Team B's skills as forbidden (cross-team isolation)", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(getRequest("Bearer team-a-member-token"), params("team-b"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
    expect(getTeamSkillProgressMock).toHaveBeenCalledWith("team-a-member-token", "team-b");
  });

  it("maps a read_failed infrastructure error to 500 without leaking detail", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("treats a missing Authorization header as an empty token, never crashing", async () => {
    getTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await GET(getRequest(undefined), params());

    expect(getTeamSkillProgressMock).toHaveBeenCalledWith("", "team-1");
  });

  it("allows an authorized read of a disabled team's existing skill progress (no team-status gate in the route)", async () => {
    const skills = [
      {
        treeId: "tree-1",
        name: "Containers",
        nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
        currentNodeId: null,
      },
    ];
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills });

    const response = await GET(getRequest("Bearer valid-token"), params("disabled-team"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", skills });
  });

  it("never exposes createdBy/updatedBy/createdAt/updatedAt, exactly what getTeamSkillProgress returned", async () => {
    const skills = [
      {
        treeId: "tree-1",
        name: "Containers",
        nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
        currentNodeId: null,
      },
    ];
    getTeamSkillProgressMock.mockResolvedValue({ ok: true, skills });

    const response = await GET(getRequest("Bearer valid-token"), params());
    const payload = await response.json();

    expect(Object.keys(payload.skills[0])).toEqual(["treeId", "name", "nodes", "currentNodeId"]);
  });

  it("exposes no other HTTP method (no mutation behavior) — module exports only GET", async () => {
    const routeModule = (await import("./route")) as Record<string, unknown>;
    expect(routeModule.POST).toBeUndefined();
    expect(routeModule.PATCH).toBeUndefined();
    expect(routeModule.DELETE).toBeUndefined();
  });
});
