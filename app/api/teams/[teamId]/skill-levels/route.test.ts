import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const levelsMock = vi.fn();

vi.mock("../../../../../src/features/team-skills/server/get-team-skill-coverage", () => ({
  getTeamSkillLevels: levelsMock,
}));

const routeModule = await import("./route");
const { GET } = routeModule;

const params = (teamId = "team-1") => ({ params: Promise.resolve({ teamId }) });

function request(auth?: string, query = ""): Request {
  return new Request(`http://localhost/api/teams/team-1/skill-levels${query}`, {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

afterEach(() => levelsMock.mockReset());

describe("/api/teams/[teamId]/skill-levels", () => {
  it("exports only GET", () => {
    expect(Object.keys(routeModule)).toEqual(["GET"]);
  });

  it("delegates with exactly (token, path teamId)", async () => {
    levelsMock.mockResolvedValue({ ok: true, availability: "available", rows: [] });
    await GET(request("Bearer abc.def"), params("team-42"));
    expect(levelsMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it("ignores the query string: no threshold or level can be requested", async () => {
    levelsMock.mockResolvedValue({ ok: true, availability: "available", rows: [] });
    await GET(request("Bearer t", "?minContributors=1&level=4"), params());
    expect(levelsMock).toHaveBeenCalledWith("t", "team-1");
  });

  it("passes no token when the header is missing or not a bearer token", async () => {
    levelsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    await GET(request(), params());
    expect(levelsMock).toHaveBeenCalledWith("", "team-1");
  });

  it.each([
    ["unauthenticated", 401],
    ["erasure_in_progress", 403],
    ["auth_unavailable", 503],
    ["forbidden", 403],
    ["team_disabled", 409],
    ["read_failed", 500],
  ])("maps the %s refusal to HTTP %i with no rows and no-store caching", async (error, status) => {
    levelsMock.mockResolvedValue({ ok: false, error });
    const response = await GET(request("Bearer t"), params());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error });
  });

  it("returns only the allow-listed fields, even when the operation returns extra ones", async () => {
    levelsMock.mockResolvedValue({
      ok: true,
      availability: "available",
      rows: [
        {
          treeId: "t1",
          areaName: "Alpha",
          targetLevel: 3,
          state: "value",
          level: 2,
          contributorCount: 5,
          uid: "uid-leak",
          requiredCoverage: 2,
        },
      ],
    });
    const response = await GET(request("Bearer t"), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      availability: "available",
      rows: [{ treeId: "t1", areaName: "Alpha", targetLevel: 3, state: "value", level: 2 }],
    });
    expect(JSON.stringify(body)).not.toMatch(/contributorCount|uid-leak|requiredCoverage/);
  });

  it("returns an incomplete scan with no rows", async () => {
    levelsMock.mockResolvedValue({ ok: true, availability: "incomplete", rows: [] });
    const response = await GET(request("Bearer t"), params());
    expect(await response.json()).toEqual({ availability: "incomplete", rows: [] });
  });

  it("imports nothing from the client or from the collection-name layer", () => {
    const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/features\/[^"]*\/client/);
    expect(source).not.toMatch(/firebase-admin|collection\(/);
  });
});
