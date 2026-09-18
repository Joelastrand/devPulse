import { afterEach, describe, expect, it, vi } from "vitest";

const updateTeamSkillProgressMock = vi.fn();
const stopTeamSkillTrackingMock = vi.fn();

vi.mock("../../../../../../../src/features/skill-trees/server/update-team-skill-progress", () => ({
  updateTeamSkillProgress: updateTeamSkillProgressMock,
}));
vi.mock("../../../../../../../src/features/skill-trees/server/stop-team-skill-tracking", () => ({
  stopTeamSkillTracking: stopTeamSkillTrackingMock,
}));

const { PATCH, DELETE } = await import("./route");

function params(teamId = "team-1", treeId = "tree-1") {
  return { params: Promise.resolve({ teamId, treeId }) };
}

function patchRequest(header: string | undefined, body: unknown): Request {
  return new Request("http://localhost/api/admin/teams/team-1/skills/tree-1", {
    method: "PATCH",
    headers: {
      ...(header ? { authorization: header } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteRequest(header: string | undefined): Request {
  return new Request("http://localhost/api/admin/teams/team-1/skills/tree-1", {
    method: "DELETE",
    headers: header ? { authorization: header } : {},
  });
}

describe("PATCH /api/admin/teams/[teamId]/skills/[treeId]", () => {
  afterEach(() => {
    updateTeamSkillProgressMock.mockReset();
  });

  it("updates progress for an app admin", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: true });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params("team-1", "tree-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(updateTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1", "node-1");
  });

  it("uses the route-param teamId/treeId, not any body-supplied values", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: true });

    await PATCH(
      patchRequest("Bearer valid-token", { nodeId: "node-1", teamId: "attacker-team", treeId: "attacker-tree" }),
      params("real-team", "real-tree"),
    );

    expect(updateTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "real-team", "real-tree", "node-1");
  });

  it("passes only the whitelisted nodeId field — audit fields never reach the operation", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: true });

    await PATCH(
      patchRequest("Bearer valid-token", {
        nodeId: "node-1",
        updatedAt: "2020-01-01",
        updatedBy: "attacker-uid",
      }),
      params(),
    );

    expect(updateTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1", "node-1");
    expect(updateTeamSkillProgressMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a backward-moving nodeId the same way as any other", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: true });

    await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-0" }), params());

    expect(updateTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1", "node-0");
  });

  it("returns 400 on malformed JSON without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "{not-json"), params());

    expect(response.status).toBe(400);
    expect(updateTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-object body without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "null"), params());

    expect(response.status).toBe(400);
    expect(updateTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PATCH(patchRequest(undefined, { nodeId: "node-1" }), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a not-yet-tracked pair", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "not_tracked" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a missing tree", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "tree_not_found" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 400 for an unknown/foreign nodeId", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "foreign-node" }), params());

    expect(response.status).toBe(400);
  });

  it("returns 500 on a persistence failure", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(500);
  });

  it("delegates to updateTeamSkillProgress without any team-status check of its own (disabled-team update remains possible)", async () => {
    updateTeamSkillProgressMock.mockResolvedValue({ ok: true });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(200);
    expect(updateTeamSkillProgressMock).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/admin/teams/[teamId]/skills/[treeId]", () => {
  afterEach(() => {
    stopTeamSkillTrackingMock.mockReset();
  });

  it("stops tracking for an app admin", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    const response = await DELETE(deleteRequest("Bearer valid-token"), params("team-1", "tree-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(stopTeamSkillTrackingMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1");
  });

  it("uses the route-param teamId/treeId as the only scope (no body-driven scope exists for DELETE)", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    await DELETE(deleteRequest("Bearer valid-token"), params("real-team", "real-tree"));

    expect(stopTeamSkillTrackingMock).toHaveBeenCalledWith("valid-token", "real-team", "real-tree");
  });

  it("is idempotent on a repeated stop — a second call still succeeds", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    const first = await DELETE(deleteRequest("Bearer valid-token"), params());
    const second = await DELETE(deleteRequest("Bearer valid-token"), params());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stopTeamSkillTrackingMock).toHaveBeenCalledTimes(2);
  });

  it("returns 401 when unauthenticated", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await DELETE(deleteRequest(undefined), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(deleteRequest("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 500 on a persistence failure", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(deleteRequest("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });

  it("delegates to stopTeamSkillTracking without any team-status check of its own (disabled-team stop remains possible)", async () => {
    stopTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    const response = await DELETE(deleteRequest("Bearer valid-token"), params());

    expect(response.status).toBe(200);
    expect(stopTeamSkillTrackingMock).toHaveBeenCalledTimes(1);
  });
});
