import { afterEach, describe, expect, it, vi } from "vitest";

const listSkillTreesMock = vi.fn();
const createSkillTreeMock = vi.fn();

vi.mock("../../../../src/features/skill-trees/server/list-skill-trees", () => ({
  listSkillTrees: listSkillTreesMock,
}));
vi.mock("../../../../src/features/skill-trees/server/create-skill-tree", () => ({
  createSkillTree: createSkillTreeMock,
}));

const { GET, POST } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/skills", {
    headers: header ? { authorization: header } : {},
  });
}

function postRequest(header: string | undefined, body: unknown): Request {
  return new Request("http://localhost/api/admin/skills", {
    method: "POST",
    headers: {
      ...(header ? { authorization: header } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/admin/skills", () => {
  afterEach(() => {
    listSkillTreesMock.mockReset();
  });

  it("returns the catalog for an app admin", async () => {
    const trees = [{ treeId: "tree-1", name: "Containers", nodes: [] }];
    listSkillTreesMock.mockResolvedValue({ ok: true, trees });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ trees });
    expect(listSkillTreesMock).toHaveBeenCalledWith("valid-token");
  });

  it("returns 401 when unauthenticated", async () => {
    listSkillTreesMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    listSkillTreesMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"));

    expect(response.status).toBe(403);
  });

  it("returns 500 on a read failure", async () => {
    listSkillTreesMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"));

    expect(response.status).toBe(500);
  });
});

describe("POST /api/admin/skills", () => {
  afterEach(() => {
    createSkillTreeMock.mockReset();
  });

  it("creates a SkillTree for an app admin", async () => {
    createSkillTreeMock.mockResolvedValue({ ok: true, treeId: "tree-1" });

    const response = await POST(postRequest("Bearer valid-token", {
      name: "Containers",
      nodeLabels: ["Fundamentals", "Pilot"],
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ treeId: "tree-1" });
    expect(createSkillTreeMock).toHaveBeenCalledWith(
      "valid-token",
      "Containers",
      ["Fundamentals", "Pilot"],
    );
  });

  it("passes only the whitelisted name/nodeLabels fields — no other field reaches the operation", async () => {
    createSkillTreeMock.mockResolvedValue({ ok: true, treeId: "tree-1" });

    await POST(postRequest("Bearer valid-token", {
      name: "Containers",
      nodeLabels: ["Fundamentals", "Pilot"],
      treeId: "attacker-supplied",
      createdBy: "attacker-uid",
      createdAt: "2020-01-01",
      updatedAt: "2020-01-01",
      updatedBy: "attacker-uid",
      nodes: [{ nodeId: "node-9", label: "x", order: 9 }],
    }));

    expect(createSkillTreeMock).toHaveBeenCalledWith(
      "valid-token",
      "Containers",
      ["Fundamentals", "Pilot"],
    );
    expect(createSkillTreeMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 on malformed JSON without calling the operation", async () => {
    const response = await POST(postRequest("Bearer valid-token", "{not-json"));

    expect(response.status).toBe(400);
    expect(createSkillTreeMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-object body without calling the operation", async () => {
    const response = await POST(postRequest("Bearer valid-token", "[]"));

    expect(response.status).toBe(400);
    expect(createSkillTreeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    createSkillTreeMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(postRequest("Bearer valid-token", { name: "x", nodeLabels: [] }));

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    createSkillTreeMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest("Bearer valid-token", { name: "x", nodeLabels: [] }));

    expect(response.status).toBe(403);
  });

  it("returns 400 for invalid input", async () => {
    createSkillTreeMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await POST(postRequest("Bearer valid-token", { name: "x", nodeLabels: [] }));

    expect(response.status).toBe(400);
  });

  it("returns 500 on a persistence failure", async () => {
    createSkillTreeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest("Bearer valid-token", {
      name: "Containers",
      nodeLabels: ["a", "b"],
    }));

    expect(response.status).toBe(500);
  });
});
