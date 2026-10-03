import { afterEach, describe, expect, it, vi } from "vitest";

const updateRoadmapItemMock = vi.fn();

vi.mock("../../../../../../src/features/roadmap/server/update-roadmap-item", () => ({
  updateRoadmapItem: updateRoadmapItemMock,
}));

const routeModule = await import("./route");
const { PATCH } = routeModule;

const params = (teamId = "team-1", treeId = "tree-1") => ({ params: Promise.resolve({ teamId, treeId }) });

function request(body: string | undefined, header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/roadmap-items/tree-1", {
    method: "PATCH",
    headers: header ? { authorization: header } : {},
    body,
  });
}

afterEach(() => updateRoadmapItemMock.mockReset());

describe("PATCH /api/teams/[teamId]/roadmap-items/[treeId]", () => {
  it("delegates with token, route ids and body and returns { item }", async () => {
    updateRoadmapItemMock.mockResolvedValue({ ok: true, item: { treeId: "tree-1" } });
    const response = await PATCH(request('{"priority":"high"}', "Bearer abc.def"), params("team-42", "tree-7"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item: { treeId: "tree-1" } });
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("abc.def", "team-42", "tree-7", { priority: "high" });
  });

  it("passes an empty token without a bearer header", async () => {
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const response = await PATCH(request("{}"), params());
    expect(response.status).toBe(401);
    expect(updateRoadmapItemMock.mock.calls[0][0]).toBe("");
  });

  it("treats unparsable JSON as an undefined body", async () => {
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "invalid_request" });
    const response = await PATCH(request("{nope", "Bearer t"), params());
    expect(response.status).toBe(400);
    expect(updateRoadmapItemMock.mock.calls[0][3]).toBeUndefined();
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_request", 400],
    ["invalid_input", 400],
    ["target_not_ahead", 400],
    ["invalid_owner", 400],
    ["team_disabled", 400],
    ["not_tracked", 404],
    ["tree_not_found", 404],
    ["not_found", 404],
    ["archived", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i with an error code only", async (error, status) => {
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error });
    const response = await PATCH(request("{}", "Bearer t"), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("exports only PATCH", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["PATCH"]);
  });
});
