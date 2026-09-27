import { describe, expect, it } from "vitest";
import {
  correctAdminSkillTree,
  createAdminSkillTree,
  fetchAdminSkillTrees,
  fetchOrgSkillProgressOverview,
  fetchTeamSkills,
  reportTeamSkillProgress,
  startAdminTeamSkillTracking,
  updateAdminTeamSkillProgress,
  stopAdminTeamSkillTracking,
  type CorrectAdminSkillTreeGateway,
  type CreateAdminSkillTreeGateway,
  type FetchAdminSkillTreesGateway,
  type FetchOrgSkillProgressOverviewGateway,
  type FetchTeamSkillsGateway,
  type ReportTeamSkillProgressGateway,
  type StartAdminTeamSkillTrackingGateway,
  type UpdateAdminTeamSkillProgressGateway,
  type StopAdminTeamSkillTrackingGateway,
} from "./skill-trees-gateway";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchAdminSkillTrees", () => {
  it("returns the catalog on a well-formed success response", async () => {
    const trees = [{ treeId: "tree-1", name: "Containers", nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }] }];
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    const gateway: FetchAdminSkillTreesGateway = {
      async fetchAdminSkillTrees(idToken) {
        capturedHeaders = { Authorization: `Bearer ${idToken}` };
        capturedUrl = "/api/admin/skills";
        const response = jsonResponse(200, { trees });
        const body = await response.json();
        return { status: "ok", trees: body.trees };
      },
    };

    const result = await fetchAdminSkillTrees("token-123", { gateway });

    expect(result).toEqual({ status: "ok", trees });
    expect(capturedUrl).toBe("/api/admin/skills");
    expect(capturedHeaders).toEqual({ Authorization: "Bearer token-123" });
  });

  it("uses the default gateway to call GET /api/admin/skills with a bearer token", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledInit = init;
      return jsonResponse(200, { trees: [] });
    }) as typeof fetch;

    try {
      const result = await fetchAdminSkillTrees("token-abc");
      expect(result).toEqual({ status: "ok", trees: [] });
      expect(calledUrl).toBe("/api/admin/skills");
      expect(calledInit?.headers).toEqual({ Authorization: "Bearer token-abc" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a malformed trees array (bad node shape) as read_failed", async () => {
    const gateway: FetchAdminSkillTreesGateway = {
      async fetchAdminSkillTrees() {
        const response = jsonResponse(200, {
          trees: [{ treeId: "tree-1", name: "x", nodes: [{ nodeId: "node-0" }] }],
        });
        const body = (await response.json()) as { trees: unknown };
        if (
          Array.isArray(body.trees) &&
          body.trees.every(
            (t) =>
              typeof t === "object" &&
              t !== null &&
              Array.isArray((t as { nodes?: unknown }).nodes) &&
              (t as { nodes: unknown[] }).nodes.every(
                (n) => typeof n === "object" && n !== null && "order" in (n as object),
              ),
          )
        ) {
          return { status: "ok", trees: body.trees as never };
        }
        return { status: "read_failed" };
      },
    };

    const result = await fetchAdminSkillTrees("token", { gateway });
    expect(result).toEqual({ status: "read_failed" });
  });

  it("maps a known error response to its status", async () => {
    const gateway: FetchAdminSkillTreesGateway = {
      async fetchAdminSkillTrees() {
        return { status: "forbidden" };
      },
    };

    const result = await fetchAdminSkillTrees("token", { gateway });
    expect(result).toEqual({ status: "forbidden" });
  });
});

describe("fetchOrgSkillProgressOverview", () => {
  it("returns the overview on a well-formed success response via GET, no body", async () => {
    const trees = [
      {
        treeId: "tree-1",
        name: "Containere",
        nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
        teams: [{ teamId: "team-1", teamName: "Alpha", teamStatus: "active", currentNodeId: "node-0" }],
      },
    ];
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    const gateway: FetchOrgSkillProgressOverviewGateway = {
      async fetchOrgSkillProgressOverview(idToken) {
        capturedHeaders = { Authorization: `Bearer ${idToken}` };
        capturedUrl = "/api/admin/skills/overview";
        const response = jsonResponse(200, { trees });
        const body = await response.json();
        return { status: "ok", trees: body.trees };
      },
    };

    const result = await fetchOrgSkillProgressOverview("token-123", { gateway });

    expect(result).toEqual({ status: "ok", trees });
    expect(capturedUrl).toBe("/api/admin/skills/overview");
    expect(capturedHeaders).toEqual({ Authorization: "Bearer token-123" });
  });

  it("uses the default gateway to call GET /api/admin/skills/overview with a bearer token and no body", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledInit = init;
      return jsonResponse(200, { trees: [] });
    }) as typeof fetch;

    try {
      const result = await fetchOrgSkillProgressOverview("token-abc");
      expect(result).toEqual({ status: "ok", trees: [] });
      expect(calledUrl).toBe("/api/admin/skills/overview");
      expect(calledInit?.headers).toEqual({ Authorization: "Bearer token-abc" });
      expect(calledInit?.method).toBeUndefined();
      expect(calledInit?.body).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a malformed team entry (missing currentNodeId) as read_failed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, {
        trees: [
          {
            treeId: "tree-1",
            name: "x",
            nodes: [],
            teams: [{ teamId: "team-1", teamName: "Alpha", teamStatus: "active" }],
          },
        ],
      })) as typeof fetch;

    try {
      const result = await fetchOrgSkillProgressOverview("token");
      expect(result).toEqual({ status: "read_failed" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a team entry carrying a field beyond the declared DTO shape (e.g. updatedBy)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, {
        trees: [
          {
            treeId: "tree-1",
            name: "x",
            nodes: [],
            teams: [
              {
                teamId: "team-1",
                teamName: "Alpha",
                teamStatus: "active",
                currentNodeId: null,
                updatedBy: "attacker-uid",
              },
            ],
          },
        ],
      })) as typeof fetch;

    try {
      const result = await fetchOrgSkillProgressOverview("token");
      expect(result).toEqual({ status: "read_failed" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps unauthenticated/forbidden/read_failed correctly", async () => {
    const gateway: FetchOrgSkillProgressOverviewGateway = {
      async fetchOrgSkillProgressOverview() {
        return { status: "forbidden" };
      },
    };

    const result = await fetchOrgSkillProgressOverview("token", { gateway });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("falls back to read_failed on a network error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await fetchOrgSkillProgressOverview("token");
      expect(result).toEqual({ status: "read_failed" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("createAdminSkillTree", () => {
  it("sends only name/nodeLabels to POST /api/admin/skills and returns the new treeId", async () => {
    let sentBody: unknown;
    let sentUrl = "";
    let sentMethod = "";
    const gateway: CreateAdminSkillTreeGateway = {
      async createAdminSkillTree(idToken, name, nodeLabels) {
        sentUrl = "/api/admin/skills";
        sentMethod = "POST";
        sentBody = { name, nodeLabels };
        return { ok: true, treeId: "tree-1" };
      },
    };

    const result = await createAdminSkillTree("token", "Containers", ["a", "b"], { gateway });

    expect(result).toEqual({ ok: true, treeId: "tree-1" });
    expect(sentUrl).toBe("/api/admin/skills");
    expect(sentMethod).toBe("POST");
    expect(sentBody).toEqual({ name: "Containers", nodeLabels: ["a", "b"] });
  });

  it("the default gateway's request body contains only name/nodeLabels", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse(201, { treeId: "tree-9" });
    }) as typeof fetch;

    try {
      const result = await createAdminSkillTree("token", "Containers", ["a", "b"]);
      expect(result).toEqual({ ok: true, treeId: "tree-9" });
      expect(capturedBody).toEqual({ name: "Containers", nodeLabels: ["a", "b"] });
      expect(Object.keys(capturedBody as object)).toEqual(["name", "nodeLabels"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps a known error response", async () => {
    const gateway: CreateAdminSkillTreeGateway = {
      async createAdminSkillTree() {
        return { ok: false, error: "invalid_input" };
      },
    };

    const result = await createAdminSkillTree("token", "x", [], { gateway });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("falls back to unknown on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await createAdminSkillTree("token", "Containers", ["a", "b"]);
      expect(result).toEqual({ ok: false, error: "unknown" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("correctAdminSkillTree", () => {
  it("sends only name/nodeLabels to PATCH /api/admin/skills/[treeId] — treeId never in the body", async () => {
    let sentUrl = "";
    let sentBody: unknown;
    const gateway: CorrectAdminSkillTreeGateway = {
      async correctAdminSkillTree(idToken, treeId, name, nodeLabels) {
        sentUrl = `/api/admin/skills/${treeId}`;
        sentBody = { name, nodeLabels };
        return { ok: true };
      },
    };

    const result = await correctAdminSkillTree("token", "tree-1", "Containers", ["a", "b"], { gateway });

    expect(result).toEqual({ ok: true });
    expect(sentUrl).toBe("/api/admin/skills/tree-1");
    expect(sentBody).toEqual({ name: "Containers", nodeLabels: ["a", "b"] });
    expect(sentBody).not.toHaveProperty("treeId");
  });

  it("the default gateway's request body contains only name/nodeLabels, URL-encoding treeId", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledMethod = init?.method;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    try {
      const result = await correctAdminSkillTree("token", "tree with space", "Containers", ["a", "b"]);
      expect(result).toEqual({ ok: true });
      expect(calledUrl).toBe("/api/admin/skills/tree%20with%20space");
      expect(calledMethod).toBe("PATCH");
      expect(capturedBody).toEqual({ name: "Containers", nodeLabels: ["a", "b"] });
      expect(Object.keys(capturedBody as object)).toEqual(["name", "nodeLabels"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps a node_count_mismatch error", async () => {
    const gateway: CorrectAdminSkillTreeGateway = {
      async correctAdminSkillTree() {
        return { ok: false, error: "node_count_mismatch" };
      },
    };

    const result = await correctAdminSkillTree("token", "tree-1", "x", ["a", "b"], { gateway });
    expect(result).toEqual({ ok: false, error: "node_count_mismatch" });
  });

  it("falls back to unknown on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await correctAdminSkillTree("token", "tree-1", "Containers", ["a", "b"]);
      expect(result).toEqual({ ok: false, error: "unknown" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("startAdminTeamSkillTracking", () => {
  it("sends only treeId to POST /api/admin/teams/[teamId]/skills — teamId never in the body", async () => {
    let sentUrl = "";
    let sentBody: unknown;
    const gateway: StartAdminTeamSkillTrackingGateway = {
      async startAdminTeamSkillTracking(idToken, teamId, treeId) {
        sentUrl = `/api/admin/teams/${teamId}/skills`;
        sentBody = { treeId };
        return { ok: true };
      },
    };

    const result = await startAdminTeamSkillTracking("token", "team-1", "tree-1", { gateway });

    expect(result).toEqual({ ok: true });
    expect(sentUrl).toBe("/api/admin/teams/team-1/skills");
    expect(sentBody).toEqual({ treeId: "tree-1" });
    expect(sentBody).not.toHaveProperty("teamId");
  });

  it("the default gateway's request body contains only treeId, URL-encoding teamId", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledMethod = init?.method;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    try {
      const result = await startAdminTeamSkillTracking("token", "team with space", "tree-1");
      expect(result).toEqual({ ok: true });
      expect(calledUrl).toBe("/api/admin/teams/team%20with%20space/skills");
      expect(calledMethod).toBe("POST");
      expect(capturedBody).toEqual({ treeId: "tree-1" });
      expect(Object.keys(capturedBody as object)).toEqual(["treeId"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps a team_disabled error distinctly", async () => {
    const gateway: StartAdminTeamSkillTrackingGateway = {
      async startAdminTeamSkillTracking() {
        return { ok: false, error: "team_disabled" };
      },
    };

    const result = await startAdminTeamSkillTracking("token", "team-1", "tree-1", { gateway });
    expect(result).toEqual({ ok: false, error: "team_disabled" });
  });

  it("falls back to unknown on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await startAdminTeamSkillTracking("token", "team-1", "tree-1");
      expect(result).toEqual({ ok: false, error: "unknown" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("updateAdminTeamSkillProgress", () => {
  it("sends only nodeId to PATCH /api/admin/teams/[teamId]/skills/[treeId] — teamId/treeId never in the body", async () => {
    let sentUrl = "";
    let sentBody: unknown;
    const gateway: UpdateAdminTeamSkillProgressGateway = {
      async updateAdminTeamSkillProgress(idToken, teamId, treeId, nodeId) {
        sentUrl = `/api/admin/teams/${teamId}/skills/${treeId}`;
        sentBody = { nodeId };
        return { ok: true };
      },
    };

    const result = await updateAdminTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });

    expect(result).toEqual({ ok: true });
    expect(sentUrl).toBe("/api/admin/teams/team-1/skills/tree-1");
    expect(sentBody).toEqual({ nodeId: "node-1" });
    expect(sentBody).not.toHaveProperty("teamId");
    expect(sentBody).not.toHaveProperty("treeId");
  });

  it("the default gateway's request body contains only nodeId", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    let capturedBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledMethod = init?.method;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    try {
      const result = await updateAdminTeamSkillProgress("token", "team-1", "tree-1", "node-0");
      expect(result).toEqual({ ok: true });
      expect(calledUrl).toBe("/api/admin/teams/team-1/skills/tree-1");
      expect(calledMethod).toBe("PATCH");
      expect(capturedBody).toEqual({ nodeId: "node-0" });
      expect(Object.keys(capturedBody as object)).toEqual(["nodeId"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps a not_tracked error", async () => {
    const gateway: UpdateAdminTeamSkillProgressGateway = {
      async updateAdminTeamSkillProgress() {
        return { ok: false, error: "not_tracked" };
      },
    };

    const result = await updateAdminTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });
    expect(result).toEqual({ ok: false, error: "not_tracked" });
  });

  it("falls back to unknown on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await updateAdminTeamSkillProgress("token", "team-1", "tree-1", "node-1");
      expect(result).toEqual({ ok: false, error: "unknown" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("stopAdminTeamSkillTracking", () => {
  it("sends DELETE with no body to /api/admin/teams/[teamId]/skills/[treeId]", async () => {
    let sentUrl = "";
    const gateway: StopAdminTeamSkillTrackingGateway = {
      async stopAdminTeamSkillTracking(idToken, teamId, treeId) {
        sentUrl = `/api/admin/teams/${teamId}/skills/${treeId}`;
        return { ok: true };
      },
    };

    const result = await stopAdminTeamSkillTracking("token", "team-1", "tree-1", { gateway });

    expect(result).toEqual({ ok: true });
    expect(sentUrl).toBe("/api/admin/teams/team-1/skills/tree-1");
  });

  it("the default gateway sends no request body", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledMethod = init?.method;
      calledInit = init;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    try {
      const result = await stopAdminTeamSkillTracking("token", "team-1", "tree-1");
      expect(result).toEqual({ ok: true });
      expect(calledUrl).toBe("/api/admin/teams/team-1/skills/tree-1");
      expect(calledMethod).toBe("DELETE");
      expect(calledInit?.body).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("is idempotent — repeated calls both resolve ok", async () => {
    const gateway: StopAdminTeamSkillTrackingGateway = {
      async stopAdminTeamSkillTracking() {
        return { ok: true };
      },
    };

    const first = await stopAdminTeamSkillTracking("token", "team-1", "tree-1", { gateway });
    const second = await stopAdminTeamSkillTracking("token", "team-1", "tree-1", { gateway });
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });

  it("falls back to unknown on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await stopAdminTeamSkillTracking("token", "team-1", "tree-1");
      expect(result).toEqual({ ok: false, error: "unknown" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchTeamSkills", () => {
  it("returns the team-scoped skill list on a well-formed success response", async () => {
    const skills = [
      {
        treeId: "tree-1",
        name: "Containers",
        nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
        currentNodeId: "node-0",
      },
    ];
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    const gateway: FetchTeamSkillsGateway = {
      async fetchTeamSkills(idToken, teamId) {
        capturedHeaders = { Authorization: `Bearer ${idToken}` };
        capturedUrl = `/api/teams/${teamId}/skills`;
        const response = jsonResponse(200, { status: "ok", skills, canReportProgress: true });
        const body = await response.json();
        return { status: "ok", skills: body.skills, canReportProgress: body.canReportProgress };
      },
    };

    const result = await fetchTeamSkills("token-123", "team-1", { gateway });

    expect(result).toEqual({ status: "ok", skills, canReportProgress: true });
    expect(capturedUrl).toBe("/api/teams/team-1/skills");
    expect(capturedHeaders).toEqual({ Authorization: "Bearer token-123" });
  });

  it("uses the default gateway to call GET /api/teams/[teamId]/skills with a safely-encoded teamId and a bearer token", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledInit = init;
      return jsonResponse(200, { status: "ok", skills: [], canReportProgress: false });
    }) as typeof fetch;

    try {
      const result = await fetchTeamSkills("token-abc", "team/needs encoding");
      expect(result).toEqual({ status: "ok", skills: [], canReportProgress: false });
      expect(calledUrl).toBe("/api/teams/team%2Fneeds%20encoding/skills");
      expect(calledInit?.headers).toEqual({ Authorization: "Bearer token-abc" });
      expect(calledInit?.method).toBeUndefined();
      expect(calledInit?.body).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed to read_failed when canReportProgress is missing from an otherwise well-formed response (docs/features/skill-progress-self-report/SPEC.md — 'Permission-UI correction')", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => jsonResponse(200, { status: "ok", skills: [] })) as typeof fetch;

    try {
      const result = await fetchTeamSkills("token", "team-1");
      expect(result).toEqual({ status: "read_failed" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed to read_failed when canReportProgress is not a boolean, never permissively enabling mutation", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, { status: "ok", skills: [], canReportProgress: "true" })) as typeof fetch;

    try {
      const result = await fetchTeamSkills("token", "team-1");
      expect(result).toEqual({ status: "read_failed" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts canReportProgress: true from a well-formed response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, { status: "ok", skills: [], canReportProgress: true })) as typeof fetch;

    try {
      const result = await fetchTeamSkills("token", "team-1");
      expect(result).toEqual({ status: "ok", skills: [], canReportProgress: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts canReportProgress: false from a well-formed response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, { status: "ok", skills: [], canReportProgress: false })) as typeof fetch;

    try {
      const result = await fetchTeamSkills("token", "team-1");
      expect(result).toEqual({ status: "ok", skills: [], canReportProgress: false });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("represents a currentNodeId of null (not started) correctly", async () => {
    const skills = [
      {
        treeId: "tree-1",
        name: "Containers",
        nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
        currentNodeId: null,
      },
    ];
    const gateway: FetchTeamSkillsGateway = {
      async fetchTeamSkills() {
        return { status: "ok", skills, canReportProgress: true };
      },
    };

    const result = await fetchTeamSkills("token", "team-1", { gateway });
    expect(result).toEqual({ status: "ok", skills, canReportProgress: true });
  });

  it("rejects a malformed skills array (bad node shape) as read_failed", async () => {
    const gateway: FetchTeamSkillsGateway = {
      async fetchTeamSkills() {
        const response = jsonResponse(200, {
          status: "ok",
          skills: [{ treeId: "tree-1", name: "x", nodes: [{ nodeId: "node-0" }], currentNodeId: null }],
        });
        const body = (await response.json()) as { skills: unknown };
        if (
          Array.isArray(body.skills) &&
          body.skills.every(
            (s) =>
              typeof s === "object" &&
              s !== null &&
              Array.isArray((s as { nodes?: unknown }).nodes) &&
              (s as { nodes: unknown[] }).nodes.every(
                (n) => typeof n === "object" && n !== null && "order" in (n as object),
              ),
          )
        ) {
          return { status: "ok", skills: body.skills as never, canReportProgress: true };
        }
        return { status: "read_failed" };
      },
    };

    const result = await fetchTeamSkills("token", "team-1", { gateway });
    expect(result).toEqual({ status: "read_failed" });
  });

  it("rejects a response carrying an identity-shaped field alongside otherwise-valid skills", async () => {
    const gateway: FetchTeamSkillsGateway = {
      async fetchTeamSkills() {
        // The gateway's own parser rebuilds each item field-by-field, so an
        // extra field on the raw payload is simply dropped, never forwarded.
        const raw = {
          treeId: "tree-1",
          name: "Containers",
          nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
          currentNodeId: null,
          updatedBy: "admin-uid-should-never-appear",
        };
        return {
          status: "ok",
          skills: [{ treeId: raw.treeId, name: raw.name, nodes: raw.nodes, currentNodeId: raw.currentNodeId }],
          canReportProgress: true,
        };
      },
    };

    const result = await fetchTeamSkills("token", "team-1", { gateway });
    expect(result).toEqual({
      status: "ok",
      skills: [
        {
          treeId: "tree-1",
          name: "Containers",
          nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
          currentNodeId: null,
        },
      ],
      canReportProgress: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/admin-uid/);
  });

  it("maps a known error response to its status", async () => {
    const gateway: FetchTeamSkillsGateway = {
      async fetchTeamSkills() {
        return { status: "forbidden" };
      },
    };

    const result = await fetchTeamSkills("token", "team-1", { gateway });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("falls back to read_failed on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await fetchTeamSkills("token", "team-1");
      expect(result).toEqual({ status: "read_failed" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("never sends a request body (read-only — no mutation behavior)", async () => {
    const originalFetch = globalThis.fetch;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calledInit = init;
      return jsonResponse(200, { status: "ok", skills: [] });
    }) as typeof fetch;

    try {
      await fetchTeamSkills("token", "team-1");
      expect(calledInit?.body).toBeUndefined();
      expect(calledInit?.method).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("reportTeamSkillProgress", () => {
  it("sends only nodeId to PATCH /api/teams/[teamId]/skills/[treeId] — teamId/treeId never in the body", async () => {
    let sentUrl = "";
    let sentBody: unknown;
    const gateway: ReportTeamSkillProgressGateway = {
      async reportTeamSkillProgress(idToken, teamId, treeId, nodeId) {
        sentUrl = `/api/teams/${teamId}/skills/${treeId}`;
        sentBody = { nodeId };
        return { ok: true };
      },
    };

    const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });

    expect(result).toEqual({ ok: true });
    expect(sentUrl).toBe("/api/teams/team-1/skills/tree-1");
    expect(sentBody).toEqual({ nodeId: "node-1" });
    expect(sentBody).not.toHaveProperty("teamId");
    expect(sentBody).not.toHaveProperty("treeId");
    expect(sentBody).not.toHaveProperty("updatedBy");
  });

  it("the default gateway's request body contains only nodeId, PATCHes the correct URL with a bearer token, and URL-encodes teamId/treeId", async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    let calledHeaders: HeadersInit | undefined;
    let capturedBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledMethod = init?.method;
      calledHeaders = init?.headers;
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    try {
      const result = await reportTeamSkillProgress("token-abc", "team with space", "tree-1", "node-0");
      expect(result).toEqual({ ok: true });
      expect(calledUrl).toBe("/api/teams/team%20with%20space/skills/tree-1");
      expect(calledMethod).toBe("PATCH");
      expect(calledHeaders).toMatchObject({ Authorization: "Bearer token-abc" });
      expect(capturedBody).toEqual({ nodeId: "node-0" });
      expect(Object.keys(capturedBody as object)).toEqual(["nodeId"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps a forbidden error", async () => {
    const gateway: ReportTeamSkillProgressGateway = {
      async reportTeamSkillProgress() {
        return { ok: false, error: "forbidden" };
      },
    };

    const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("maps a team_disabled error", async () => {
    const gateway: ReportTeamSkillProgressGateway = {
      async reportTeamSkillProgress() {
        return { ok: false, error: "team_disabled" };
      },
    };

    const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });
    expect(result).toEqual({ ok: false, error: "team_disabled" });
  });

  it("maps a not_tracked error", async () => {
    const gateway: ReportTeamSkillProgressGateway = {
      async reportTeamSkillProgress() {
        return { ok: false, error: "not_tracked" };
      },
    };

    const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });
    expect(result).toEqual({ ok: false, error: "not_tracked" });
  });

  it("maps an invalid_input error", async () => {
    const gateway: ReportTeamSkillProgressGateway = {
      async reportTeamSkillProgress() {
        return { ok: false, error: "invalid_input" };
      },
    };

    const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("falls back to unknown on a network failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1");
      expect(result).toEqual({ ok: false, error: "unknown" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to unknown on an unrecognized error shape, never fabricating success", async () => {
    const gateway: ReportTeamSkillProgressGateway = {
      async reportTeamSkillProgress() {
        return { ok: false, error: "unknown" };
      },
    };

    const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1", { gateway });
    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("never surfaces an updatedBy/audit field in its result shape", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, { ok: true, updatedBy: "admin-uid-should-never-appear" })) as typeof fetch;

    try {
      const result = await reportTeamSkillProgress("token", "team-1", "tree-1", "node-1");
      expect(result).toEqual({ ok: true });
      expect(JSON.stringify(result)).not.toMatch(/admin-uid/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
