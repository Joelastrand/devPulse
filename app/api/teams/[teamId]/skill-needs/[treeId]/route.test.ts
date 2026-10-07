import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("../../../../../../src/features/team-skills/server/upsert-skill-need", () => ({
  upsertSkillNeed: upsertMock,
}));
vi.mock("../../../../../../src/features/team-skills/server/delete-skill-need", () => ({
  deleteSkillNeed: deleteMock,
}));

const routeModule = await import("./route");
const { PUT, DELETE } = routeModule;

const params = (teamId = "team-1", treeId = "tree-1") => ({ params: Promise.resolve({ teamId, treeId }) });

function request(method: string, body?: string, auth?: string): Request {
  return new Request("http://localhost/api/teams/team-1/skill-needs/tree-1", {
    method,
    headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" },
    body,
  });
}

afterEach(() => {
  upsertMock.mockReset();
  deleteMock.mockReset();
});

describe("PUT/DELETE /api/teams/[teamId]/skill-needs/[treeId]", () => {
  it("exports only PUT and DELETE", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["DELETE", "PUT"]);
  });

  it("PUT passes token, path ids and body, ignoring uid/team/role in the body", async () => {
    upsertMock.mockResolvedValue({
      ok: true,
      need: { treeId: "tree-9", areaName: "N", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2, uid: "leak" },
    });
    const body = { requiredLevel: 3, requiredCoverage: 2, uid: "x", teamId: "other", role: "lead" };
    const response = await PUT(request("PUT", JSON.stringify(body), "Bearer abc.def"), params("team-42", "tree-9"));

    expect(upsertMock).toHaveBeenCalledWith("abc.def", "team-42", "tree-9", body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      need: { treeId: "tree-9", areaName: "N", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 },
    });
  });

  it("PUT passes unparsable JSON as undefined and a missing header as an empty token", async () => {
    upsertMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const response = await PUT(request("PUT", "{not json"), params());
    expect(upsertMock).toHaveBeenCalledWith("", "team-1", "tree-1", undefined);
    expect(response.status).toBe(401);
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_request", 400],
    ["invalid_input", 400],
    ["skill_unavailable", 404],
    ["team_disabled", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i on PUT and body only carries the code", async (error, status) => {
    upsertMock.mockResolvedValue({ ok: false, error });
    const response = await PUT(request("PUT", "{}", "Bearer t"), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["team_disabled", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i on DELETE", async (error, status) => {
    deleteMock.mockResolvedValue({ ok: false, error });
    const response = await DELETE(request("DELETE", undefined, "Bearer t"), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("DELETE succeeds with { ok: true } and never reads a body", async () => {
    deleteMock.mockResolvedValue({ ok: true });
    const req = request("DELETE", undefined, "Bearer abc");
    const json = vi.spyOn(req, "json");
    const response = await DELETE(req, params("team-3", "tree-4"));
    expect(deleteMock).toHaveBeenCalledWith("abc", "team-3", "tree-4");
    expect(json).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true });
  });

  it("the route file names no Firestore collection and no admin/authorize helper", () => {
    const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/teamSkillNeeds|authorizeTeamAccess|resolveTeamRole|isAppAdmin|firebase/);
  });
});
