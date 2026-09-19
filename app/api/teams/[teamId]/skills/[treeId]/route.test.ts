import { afterEach, describe, expect, it, vi } from "vitest";

const reportTeamSkillProgressMock = vi.fn();

vi.mock("../../../../../../src/features/skill-trees/server/report-team-skill-progress", () => ({
  reportTeamSkillProgress: reportTeamSkillProgressMock,
}));

const { PATCH } = await import("./route");

function params(teamId = "team-1", treeId = "tree-1") {
  return { params: Promise.resolve({ teamId, treeId }) };
}

function patchRequest(header: string | undefined, body: unknown): Request {
  return new Request("http://localhost/api/teams/team-1/skills/tree-1", {
    method: "PATCH",
    headers: {
      ...(header ? { authorization: header } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/teams/[teamId]/skills/[treeId]", () => {
  afterEach(() => {
    reportTeamSkillProgressMock.mockReset();
  });

  it("reports progress for a genuine member", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: true });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params("team-1", "tree-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(reportTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1", "node-1");
  });

  it("uses the route-param teamId/treeId, never any other source", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: true });

    await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params("real-team", "real-tree"));

    expect(reportTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "real-team", "real-tree", "node-1");
  });

  it("rejects a body-supplied teamId/treeId/updatedBy override as an extra field, calling the operation with route params only", async () => {
    const response = await PATCH(
      patchRequest("Bearer valid-token", {
        nodeId: "node-1",
        teamId: "attacker-team",
        treeId: "attacker-tree",
        updatedBy: "attacker-uid",
      }),
      params("real-team", "real-tree"),
    );

    // The whitelist rejects the whole request outright rather than silently
    // dropping the extra keys — a caller-supplied scope/audit override is
    // never partially honored.
    expect(response.status).toBe(400);
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("accepts a backward-moving nodeId the same way as any other", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: true });

    await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-0" }), params());

    expect(reportTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1", "node-0");
  });

  it("returns 400 on malformed JSON without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "{not-json"), params());

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({ error: "invalid_request" });
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-object body without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "null"), params());

    expect(response.status).toBe(400);
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("returns 400 on an array body without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "[]"), params());

    expect(response.status).toBe(400);
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing nodeId, without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", {}), params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_request" });
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an extra/unapproved body field, without calling the operation", async () => {
    const response = await PATCH(
      patchRequest("Bearer valid-token", { nodeId: "node-1", updatedBy: "attacker-uid" }),
      params(),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_request" });
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("forwards a non-string nodeId to the operation, which rejects it (route/domain split)", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: 42 }), params());
    const payload = await response.json();

    expect(reportTeamSkillProgressMock).toHaveBeenCalledWith("valid-token", "team-1", "tree-1", 42);
    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "invalid_input" });
  });

  it("returns 401 when unauthenticated", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PATCH(patchRequest(undefined, { nodeId: "node-1" }), params());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "unauthenticated" });
  });

  it("returns 403 for a non-member/non-admin caller", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("returns 400 for a disabled team (team_disabled)", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "team_disabled" });
  });

  it("returns 404 for a not-yet-tracked pair", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "not_tracked" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a missing tree", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "tree_not_found" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 400 for an unknown/foreign nodeId", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "foreign-node" }), params());

    expect(response.status).toBe(400);
  });

  it("returns 500 on a persistence failure, without leaking backend error detail", async () => {
    reportTeamSkillProgressMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await PATCH(patchRequest("Bearer valid-token", { nodeId: "node-1" }), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "persistence_failed" });
    expect(JSON.stringify(payload)).not.toMatch(/firestore|firebase/i);
  });

  it("exposes no other HTTP method — a member can never start/stop tracking via this route", async () => {
    const routeModule = (await import("./route")) as Record<string, unknown>;
    expect(routeModule.GET).toBeUndefined();
    expect(routeModule.POST).toBeUndefined();
    expect(routeModule.DELETE).toBeUndefined();
  });
});
