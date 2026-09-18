import { afterEach, describe, expect, it, vi } from "vitest";

const startTeamSkillTrackingMock = vi.fn();

vi.mock("../../../../../../src/features/skill-trees/server/start-team-skill-tracking", () => ({
  startTeamSkillTracking: startTeamSkillTrackingMock,
}));

const { POST } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function postRequest(header: string | undefined, body: unknown): Request {
  return new Request("http://localhost/api/admin/teams/team-1/skills", {
    method: "POST",
    headers: {
      ...(header ? { authorization: header } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/admin/teams/[teamId]/skills", () => {
  afterEach(() => {
    startTeamSkillTrackingMock.mockReset();
  });

  it("starts tracking for an app admin", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    const response = await POST(postRequest("Bearer valid-token", { treeId: "tree-1" }), params("team-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(startTeamSkillTrackingMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1");
  });

  it("uses the route-param teamId, not any body-supplied teamId", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    await POST(
      postRequest("Bearer valid-token", { treeId: "tree-1", teamId: "attacker-supplied" }),
      params("real-team-id"),
    );

    expect(startTeamSkillTrackingMock).toHaveBeenCalledWith("valid-token", "real-team-id", "tree-1");
  });

  it("passes only the whitelisted treeId field — audit/scope injection fields never reach the operation", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    await POST(
      postRequest("Bearer valid-token", {
        treeId: "tree-1",
        currentNodeId: "node-9",
        updatedAt: "2020-01-01",
        updatedBy: "attacker-uid",
        teamId: "attacker-supplied",
      }),
      params("team-1"),
    );

    expect(startTeamSkillTrackingMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1");
    expect(startTeamSkillTrackingMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 on malformed JSON without calling the operation", async () => {
    const response = await POST(postRequest("Bearer valid-token", "{not-json"), params());

    expect(response.status).toBe(400);
    expect(startTeamSkillTrackingMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-object body without calling the operation", async () => {
    const response = await POST(postRequest("Bearer valid-token", "[]"), params());

    expect(response.status).toBe(400);
    expect(startTeamSkillTrackingMock).not.toHaveBeenCalled();
  });

  it("passes an empty treeId when the body's treeId is not a string, rather than throwing", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "tree_not_found" });

    const response = await POST(postRequest("Bearer valid-token", { treeId: 42 }), params("team-1"));

    expect(startTeamSkillTrackingMock).toHaveBeenCalledWith("valid-token", "team-1", "");
    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(postRequest(undefined, { treeId: "tree-1" }), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller, before any write", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest("Bearer valid-token", { treeId: "tree-1" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a nonexistent tree", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "tree_not_found" });

    const response = await POST(postRequest("Bearer valid-token", { treeId: "tree-1" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a nonexistent team", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "team_not_found" });

    const response = await POST(postRequest("Bearer valid-token", { treeId: "tree-1" }), params());

    expect(response.status).toBe(404);
  });

  it("surfaces team_disabled distinctly (400), not a generic error", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(postRequest("Bearer valid-token", { treeId: "tree-1" }), params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "team_disabled" });
  });

  it("returns 500 on a persistence failure", async () => {
    startTeamSkillTrackingMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest("Bearer valid-token", { treeId: "tree-1" }), params());

    expect(response.status).toBe(500);
  });
});
