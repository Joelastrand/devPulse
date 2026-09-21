import { afterEach, describe, expect, it, vi } from "vitest";

const getOrgSkillProgressOverviewMock = vi.fn();

vi.mock("../../../../../src/features/skill-trees/server/get-org-skill-progress-overview", () => ({
  getOrgSkillProgressOverview: getOrgSkillProgressOverviewMock,
}));

const routeModule = (await import("./route")) as Record<string, unknown>;
const GET = routeModule.GET as (request: Request) => Promise<Response>;

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/skills/overview", {
    headers: header ? { authorization: header } : {},
  });
}

describe("GET /api/admin/skills/overview", () => {
  afterEach(() => {
    getOrgSkillProgressOverviewMock.mockReset();
  });

  it("returns the overview for an app admin", async () => {
    const trees = [
      {
        treeId: "tree-1",
        name: "Containere",
        nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
        teams: [{ teamId: "team-1", teamName: "Alpha", teamStatus: "active", currentNodeId: "node-0" }],
      },
    ];
    getOrgSkillProgressOverviewMock.mockResolvedValue({ ok: true, trees });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ trees });
    expect(getOrgSkillProgressOverviewMock).toHaveBeenCalledWith("valid-token");
    expect(getOrgSkillProgressOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when unauthenticated", async () => {
    getOrgSkillProgressOverviewMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "unauthenticated" });
  });

  it("returns 403 for a non-admin caller", async () => {
    getOrgSkillProgressOverviewMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("returns 500 on a read failure, without leaking a raw error detail", async () => {
    getOrgSkillProgressOverviewMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "read_failed" });
  });

  it("calls the operation with only the extracted token — no other argument", async () => {
    getOrgSkillProgressOverviewMock.mockResolvedValue({ ok: true, trees: [] });

    await GET(requestWithAuth("Bearer only-this-token"));

    expect(getOrgSkillProgressOverviewMock).toHaveBeenCalledWith("only-this-token");
  });

  it("exports no POST/PATCH/PUT/DELETE handler from this route file", () => {
    expect(routeModule.POST).toBeUndefined();
    expect(routeModule.PATCH).toBeUndefined();
    expect(routeModule.PUT).toBeUndefined();
    expect(routeModule.DELETE).toBeUndefined();
  });
});
