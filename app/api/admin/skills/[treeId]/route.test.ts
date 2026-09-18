import { afterEach, describe, expect, it, vi } from "vitest";

const updateSkillTreeMock = vi.fn();

vi.mock("../../../../../src/features/skill-trees/server/update-skill-tree", () => ({
  updateSkillTree: updateSkillTreeMock,
}));

const { PATCH } = await import("./route");

function params(treeId = "tree-1") {
  return { params: Promise.resolve({ treeId }) };
}

function patchRequest(header: string | undefined, body: unknown): Request {
  return new Request("http://localhost/api/admin/skills/tree-1", {
    method: "PATCH",
    headers: {
      ...(header ? { authorization: header } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/admin/skills/[treeId]", () => {
  afterEach(() => {
    updateSkillTreeMock.mockReset();
  });

  it("corrects the SkillTree for an app admin", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: true });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "Containers", nodeLabels: ["a", "b"] }),
      params("tree-1"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(updateSkillTreeMock).toHaveBeenCalledWith("valid-token", "tree-1", "Containers", ["a", "b"]);
  });

  it("uses the route-param treeId, not any body-supplied treeId", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: true });

    await PATCH(
      patchRequest("Bearer valid-token", {
        name: "Containers",
        nodeLabels: ["a", "b"],
        treeId: "attacker-supplied",
      }),
      params("real-tree-id"),
    );

    expect(updateSkillTreeMock).toHaveBeenCalledWith(
      "valid-token",
      "real-tree-id",
      "Containers",
      ["a", "b"],
    );
  });

  it("passes only the whitelisted name/nodeLabels fields — audit/structural fields never reach the operation", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: true });

    await PATCH(
      patchRequest("Bearer valid-token", {
        name: "Containers",
        nodeLabels: ["a", "b"],
        nodes: [{ nodeId: "node-0", label: "hacked", order: 0 }],
        createdAt: "2020-01-01",
        createdBy: "attacker-uid",
        updatedAt: "2020-01-01",
        updatedBy: "attacker-uid",
      }),
      params("tree-1"),
    );

    expect(updateSkillTreeMock).toHaveBeenCalledWith("valid-token", "tree-1", "Containers", ["a", "b"]);
    expect(updateSkillTreeMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 on malformed JSON without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "{not-json"), params());

    expect(response.status).toBe(400);
    expect(updateSkillTreeMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-object body without calling the operation", async () => {
    const response = await PATCH(patchRequest("Bearer valid-token", "null"), params());

    expect(response.status).toBe(400);
    expect(updateSkillTreeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "x", nodeLabels: ["a", "b"] }),
      params(),
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "x", nodeLabels: ["a", "b"] }),
      params(),
    );

    expect(response.status).toBe(403);
  });

  it("returns 404 for a missing tree", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: false, error: "tree_not_found" });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "x", nodeLabels: ["a", "b"] }),
      params(),
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid input", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "x", nodeLabels: ["a", "b"] }),
      params(),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for a node-count mismatch", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: false, error: "node_count_mismatch" });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "x", nodeLabels: ["a", "b", "c"] }),
      params(),
    );

    expect(response.status).toBe(400);
  });

  it("returns 500 on a persistence failure", async () => {
    updateSkillTreeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await PATCH(
      patchRequest("Bearer valid-token", { name: "x", nodeLabels: ["a", "b"] }),
      params(),
    );

    expect(response.status).toBe(500);
  });
});
