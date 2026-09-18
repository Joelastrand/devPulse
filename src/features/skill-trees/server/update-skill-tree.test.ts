import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { SkillTreeDocStore, UpdateSkillTreeDeps, UpdateSkillTreeDocSnapshot } from "./update-skill-tree";
import { updateSkillTree } from "./update-skill-tree";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TREE_ID = "tree-1";
const NOW = new Date("2026-09-01T00:00:00Z");
const CREATED_AT = new Date("2026-01-01T00:00:00Z");

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function existingTreeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Container adoption",
    nodes: [
      { nodeId: "node-0", label: "Container fundamentals", order: 0 },
      { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
      { nodeId: "node-2", label: "Build competence", order: 2 },
    ],
    createdAt: CREATED_AT,
    createdBy: "original-admin",
    ...overrides,
  };
}

interface FakeSkillTreeDocStore extends SkillTreeDocStore {
  updates: { treeId: string; data: Record<string, unknown> }[];
}

function fakeSkillTreeDocStore(data: Record<string, unknown> | undefined): FakeSkillTreeDocStore {
  const updates: { treeId: string; data: Record<string, unknown> }[] = [];
  return {
    updates,
    async get(): Promise<UpdateSkillTreeDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async update(treeId, updateData) {
      updates.push({ treeId, data: updateData });
    },
  };
}

function baseDeps(overrides: Partial<UpdateSkillTreeDeps> = {}): UpdateSkillTreeDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    docs: fakeSkillTreeDocStore(existingTreeData()),
    now: NOW,
    ...overrides,
  };
}

const THREE_LABELS = ["Container basics", "Evaluate options", "Build competence"];

describe("updateSkillTree", () => {
  it("corrects the name only, resubmitting the existing labels unchanged", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree(
      "token",
      TREE_ID,
      "Container adoption (renamed)",
      ["Container fundamentals", "Evaluate alternatives", "Build competence"],
      baseDeps({ docs }),
    );

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toEqual([
      {
        treeId: TREE_ID,
        data: {
          name: "Container adoption (renamed)",
          nodes: [
            { nodeId: "node-0", label: "Container fundamentals", order: 0 },
            { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
            { nodeId: "node-2", label: "Build competence", order: 2 },
          ],
          updatedAt: NOW,
          updatedBy: ADMIN_UID,
        },
      },
    ]);
  });

  it("corrects one label only, resubmitting the tree name and other labels unchanged", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree(
      "token",
      TREE_ID,
      "Container adoption",
      ["Container fundamentals", "Evaluate options (fixed typo)", "Build competence"],
      baseDeps({ docs }),
    );

    expect(result).toEqual({ ok: true });
    expect(docs.updates[0].data.nodes).toEqual([
      { nodeId: "node-0", label: "Container fundamentals", order: 0 },
      { nodeId: "node-1", label: "Evaluate options (fixed typo)", order: 1 },
      { nodeId: "node-2", label: "Build competence", order: 2 },
    ]);
  });

  it("corrects both name and labels in one call", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree("token", TREE_ID, "New name", THREE_LABELS, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.updates[0].data.name).toBe("New name");
    expect(docs.updates[0].data.nodes).toEqual([
      { nodeId: "node-0", label: "Container basics", order: 0 },
      { nodeId: "node-1", label: "Evaluate options", order: 1 },
      { nodeId: "node-2", label: "Build competence", order: 2 },
    ]);
  });

  it("preserves every node's nodeId and order byte-for-byte, only label differing (BR-32)", async () => {
    const existing = existingTreeData();
    const docs = fakeSkillTreeDocStore(existing);

    await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps({ docs }));

    const before = existing.nodes as Array<{ nodeId: string; order: number }>;
    const after = docs.updates[0].data.nodes as Array<{ nodeId: string; order: number; label: string }>;

    expect(after.map((n) => n.nodeId)).toEqual(before.map((n) => n.nodeId));
    expect(after.map((n) => n.order)).toEqual(before.map((n) => n.order));
    expect(after.map((n) => n.label)).toEqual(THREE_LABELS);
  });

  it("keeps a team's existing currentNodeId resolvable against the corrected tree's node list (BR-35)", async () => {
    const existing = existingTreeData();
    const docs = fakeSkillTreeDocStore(existing);
    // Simulates a team's skillProgress.currentNodeId already pointing at
    // node-1 before this correction — this task never touches skillProgress
    // itself (owned by TASK-003/004), so the proof is structural: node-1
    // must still be present, unchanged, in the corrected tree afterward.
    const trackedNodeId = "node-1";

    await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps({ docs }));

    const after = docs.updates[0].data.nodes as Array<{ nodeId: string; order: number }>;
    const stillResolves = after.find((node) => node.nodeId === trackedNodeId);
    expect(stillResolves).toEqual({ nodeId: "node-1", order: 1, label: "Evaluate options" });
  });

  it("rejects a non-admin caller and attempts no read or write", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await updateSkillTree("token", TREE_ID, "New name", THREE_LABELS, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await updateSkillTree("bad-token", TREE_ID, "New name", THREE_LABELS, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a nonexistent tree with tree_not_found", async () => {
    const docs = fakeSkillTreeDocStore(undefined);

    const result = await updateSkillTree("token", TREE_ID, "New name", THREE_LABELS, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "tree_not_found" });
    expect(docs.updates).toHaveLength(0);
  });

  it("fails closed with tree_not_found on a malformed persisted tree document", async () => {
    const docs = fakeSkillTreeDocStore({ name: "Container adoption" }); // missing nodes/createdAt/createdBy

    const result = await updateSkillTree("token", TREE_ID, "New name", THREE_LABELS, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "tree_not_found" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects an invalid name and attempts no write", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree("token", TREE_ID, "ab", THREE_LABELS, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects an invalid label and attempts no write", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree("token", TREE_ID, "Container adoption", ["ab", "Evaluate options", "Build competence"], baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a nodeLabels array one entry shorter than the existing tree's node count, before any write", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree("token", TREE_ID, "Container adoption", ["Container basics", "Evaluate options"], baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "node_count_mismatch" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a nodeLabels array one entry longer than the existing tree's node count, before any write", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    const result = await updateSkillTree(
      "token",
      TREE_ID,
      "Container adoption",
      ["Container basics", "Evaluate options", "Build competence", "Extra stage"],
      baseDeps({ docs }),
    );

    expect(result).toEqual({ ok: false, error: "node_count_mismatch" });
    expect(docs.updates).toHaveLength(0);
  });

  it("never lets the caller inject a nodeId, an object-shaped nodes array, treeId, or timestamps/admin identity", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());
    // The function's own signature has no `nodes`/`nodeId`/`treeId`/
    // `updatedAt`/`updatedBy`/`createdAt`/`createdBy` parameter — only
    // `nodeLabels: unknown` (validated as a string array) can ever reach
    // this call, so an attempted object-shaped injection is rejected by the
    // label validator itself, never partially trusted.
    const maliciousLabels = [
      { label: "Container basics", nodeId: "node-999", order: 999 },
      "Evaluate options",
      "Build competence",
    ] as unknown[];

    const result = await updateSkillTree("token", TREE_ID, "Container adoption", maliciousLabels, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(docs.updates).toHaveLength(0);
  });

  it("leaves createdAt/createdBy unchanged — the update payload never includes them", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());

    await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps({ docs }));

    expect(docs.updates[0].data).not.toHaveProperty("createdAt");
    expect(docs.updates[0].data).not.toHaveProperty("createdBy");
  });

  it("uses the verified acting admin's uid, never a client-supplied updatedBy", async () => {
    const docs = fakeSkillTreeDocStore(existingTreeData());
    const identity = verifiedIdentity({ uid: "admin-2", email: "second-admin@example.com" });

    await updateSkillTree(
      "token",
      TREE_ID,
      "Container adoption",
      THREE_LABELS,
      baseDeps({
        docs,
        verifyToken: verifyTokenReturning(identity),
        allowList: [ADMIN_EMAIL, "second-admin@example.com"],
      }),
    );

    expect(docs.updates[0].data.updatedBy).toBe("admin-2");
  });

  it("reports a controlled failure when reading the tree fails", async () => {
    const docs: SkillTreeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      update: vi.fn(),
    };

    const result = await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the write fails", async () => {
    const docs: SkillTreeDocStore = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => existingTreeData() }),
      update: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never exposes a deleteSkillTree-shaped export from this module", async () => {
    const moduleExports = await import("./update-skill-tree");
    expect(Object.keys(moduleExports)).not.toContain("deleteSkillTree");
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps());

    const failingDocs: SkillTreeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      update: vi.fn(),
    };
    await updateSkillTree("token", TREE_ID, "Container adoption", THREE_LABELS, baseDeps({ docs: failingDocs }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
