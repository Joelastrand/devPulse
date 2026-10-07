import { afterEach, describe, expect, it, vi } from "vitest";

const listSkillNeedsMock = vi.fn();

vi.mock("../../../../../src/features/team-skills/server/list-skill-needs", () => ({
  listSkillNeeds: listSkillNeedsMock,
}));

const routeModule = await import("./route");
const { GET } = routeModule;

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWith(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/skill-needs", {
    headers: header ? { authorization: header } : {},
  });
}

afterEach(() => listSkillNeedsMock.mockReset());

describe("GET /api/teams/[teamId]/skill-needs", () => {
  it("returns exactly the allow-listed keys even if the operation result carries extras", async () => {
    listSkillNeedsMock.mockResolvedValue({
      ok: true,
      needs: [
        {
          treeId: "t1",
          areaName: "One",
          areaAvailable: true,
          requiredLevel: 3,
          requiredCoverage: 2,
          uid: "leak",
          email: "leak@example.com",
          memberRef: "leak",
          createdAt: "leak",
        },
      ],
      catalog: [{ treeId: "t1", name: "One", createdBy: "leak" }],
      catalogTruncated: false,
      needsTruncated: true,
      viewer: { canManageNeeds: true, canReadCoverage: false, uid: "leak" },
      uid: "leak",
    });

    const response = await GET(requestWith("Bearer abc.def"), params("team-42"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      needs: [{ treeId: "t1", areaName: "One", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 }],
      catalog: [{ treeId: "t1", name: "One" }],
      catalogTruncated: false,
      needsTruncated: true,
      viewer: { canManageNeeds: true, canReadCoverage: false },
    });
    expect(JSON.stringify(body)).not.toContain("leak");
    expect(listSkillNeedsMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["read_failed", 500],
  ])("maps %s to %i with an error code only", async (error, status) => {
    listSkillNeedsMock.mockResolvedValue({ ok: false, error });

    const response = await GET(requestWith("Bearer t"), params());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("passes an empty token when the header is missing or malformed", async () => {
    listSkillNeedsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await GET(requestWith(), params());
    await GET(requestWith("Basic abc"), params());

    expect(listSkillNeedsMock.mock.calls.map((call) => call[0])).toEqual(["", ""]);
  });

  it("exports only GET", () => {
    expect(Object.keys(routeModule).filter((key) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(key))).toEqual(["GET"]);
  });
});
