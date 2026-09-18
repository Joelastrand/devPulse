import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { SkillTreeRecord } from "../domain/skill-tree";
import type { CreateSkillTreeDeps, SkillTreesCollection } from "./create-skill-tree";
import { createSkillTree } from "./create-skill-tree";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const NOW = new Date("2026-09-01T00:00:00Z");

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

function fakeCollection(): SkillTreesCollection & { writes: SkillTreeRecord[] } {
  const writes: SkillTreeRecord[] = [];
  return {
    writes,
    add: vi.fn(async (record: SkillTreeRecord) => {
      writes.push(record);
      return { id: `generated-${writes.length}` };
    }),
  };
}

function baseDeps(overrides: Partial<CreateSkillTreeDeps> = {}): CreateSkillTreeDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    collection: fakeCollection(),
    now: NOW,
    ...overrides,
  };
}

const TWO_LABELS = ["Container fundamentals", "Evaluate alternatives"];
const TWENTY_LABELS = Array.from({ length: 20 }, (_, i) => `Stage label ${i}`);

describe("createSkillTree", () => {
  it("creates a SkillTree for an app admin, with server-derived createdAt/createdBy and no updatedAt/updatedBy", async () => {
    const collection = fakeCollection();

    const result = await createSkillTree("token", "Container adoption", TWO_LABELS, baseDeps({ collection }));

    expect(result).toEqual({ ok: true, treeId: "generated-1" });
    expect(collection.writes).toEqual([
      {
        name: "Container adoption",
        nodes: [
          { nodeId: "node-0", label: "Container fundamentals", order: 0 },
          { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
        ],
        createdAt: NOW,
        createdBy: ADMIN_UID,
      },
    ]);
    expect(Object.keys(collection.writes[0])).toEqual(["name", "nodes", "createdAt", "createdBy"]);
  });

  it("creates a 20-node tree with deterministic, position-matching nodeIds", async () => {
    const collection = fakeCollection();

    const result = await createSkillTree("token", "Long tree", TWENTY_LABELS, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    expect(collection.writes[0].nodes).toHaveLength(20);
    expect(collection.writes[0].nodes[19]).toEqual({ nodeId: "node-19", label: "Stage label 19", order: 19 });
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await createSkillTree("bad-token", "Container adoption", TWO_LABELS, baseDeps({ collection, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await createSkillTree("token", "Container adoption", TWO_LABELS, baseDeps({ collection, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects an invalid name and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await createSkillTree("token", "ab", TWO_LABELS, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a single node (below the 2-node minimum) and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await createSkillTree("token", "Container adoption", ["Only one"], baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects 21 nodes (above the 20-node maximum) and attempts no write", async () => {
    const collection = fakeCollection();
    const tooMany = [...TWENTY_LABELS, "One too many"];

    const result = await createSkillTree("token", "Container adoption", tooMany, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects an invalid label and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await createSkillTree("token", "Container adoption", ["ok", "Evaluate alternatives"], baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("never lets the caller inject a treeId, nodeId, order, createdBy, updatedAt, or updatedBy", async () => {
    const collection = fakeCollection();
    const maliciousLabels = [
      { label: "Container fundamentals", nodeId: "node-999", order: 999 },
      "Evaluate alternatives",
    ] as unknown[];

    const result = await createSkillTree(
      "token",
      "Container adoption",
      maliciousLabels,
      baseDeps({ collection }),
    );

    // The label validator rejects a non-string entry outright — there is no
    // code path by which an injected object could ever reach persistence.
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("ignores extra request-shaped fields since the function signature has no parameter for them", async () => {
    const collection = fakeCollection();

    const result = await createSkillTree("token", "Container adoption", TWO_LABELS, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    // The persisted shape is exactly the four documented fields, nothing else.
    expect(Object.keys(collection.writes[0]).sort()).toEqual(["createdAt", "createdBy", "name", "nodes"]);
  });

  it("reports a controlled failure, not partial success, when the Firestore write fails", async () => {
    const collection: SkillTreesCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createSkillTree("token", "Container adoption", TWO_LABELS, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("creates independent trees with distinct ids on repeated calls", async () => {
    const collection = fakeCollection();

    const first = await createSkillTree("token", "Tree one", TWO_LABELS, baseDeps({ collection }));
    const second = await createSkillTree("token", "Tree two", TWO_LABELS, baseDeps({ collection }));

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.treeId).not.toBe(second.treeId);
    }
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await createSkillTree("token", "Container adoption", TWO_LABELS, baseDeps());

    const failingCollection: SkillTreesCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createSkillTree("token", "Container adoption", TWO_LABELS, baseDeps({ collection: failingCollection }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
