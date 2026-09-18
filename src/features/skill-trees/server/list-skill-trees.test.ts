import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ListSkillTreesDeps, RawSkillTreeDoc, SkillTreesReader } from "./list-skill-trees";
import { LIST_SKILL_TREES_LIMIT, listSkillTrees } from "./list-skill-trees";

const ADMIN_EMAIL = "admin@example.com";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function treeData(id: string, createdAt: Date, overrides: Record<string, unknown> = {}): RawSkillTreeDoc {
  return {
    id,
    data: {
      name: `Tree ${id}`,
      nodes: [
        { nodeId: "node-0", label: "Stage A", order: 0 },
        { nodeId: "node-1", label: "Stage B", order: 1 },
      ],
      createdAt,
      createdBy: "some-admin",
      ...overrides,
    },
  };
}

/**
 * Mirrors what a real Firestore `.orderBy("createdAt", "asc").limit(limit)`
 * query would return, so the ordering/bound assertions below exercise the
 * actual contract rather than a fake that trivially passes through.
 */
function fakeReader(docs: RawSkillTreeDoc[]): SkillTreesReader {
  return {
    async listOrderedByCreatedAt(limit) {
      const createdAtOf = (doc: RawSkillTreeDoc): number => {
        const value = (doc.data as { createdAt?: unknown } | null)?.createdAt;
        return value instanceof Date ? value.getTime() : 0;
      };
      const sorted = [...docs].sort((a, b) => createdAtOf(a) - createdAtOf(b));
      return sorted.slice(0, limit);
    },
  };
}

function baseDeps(overrides: Partial<ListSkillTreesDeps> = {}): ListSkillTreesDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    reader: fakeReader([]),
    ...overrides,
  };
}

describe("listSkillTrees", () => {
  it("returns an empty catalog when no trees exist", async () => {
    const result = await listSkillTrees("token", baseDeps({ reader: fakeReader([]) }));

    expect(result).toEqual({ ok: true, trees: [] });
  });

  it("returns a single tree mapped to the exact DTO whitelist", async () => {
    const reader = fakeReader([treeData("tree-1", new Date("2026-01-01T00:00:00Z"))]);

    const result = await listSkillTrees("token", baseDeps({ reader }));

    expect(result).toEqual({
      ok: true,
      trees: [
        {
          treeId: "tree-1",
          name: "Tree tree-1",
          nodes: [
            { nodeId: "node-0", label: "Stage A", order: 0 },
            { nodeId: "node-1", label: "Stage B", order: 1 },
          ],
        },
      ],
    });
  });

  it("returns multiple trees ordered createdAt ascending", async () => {
    const reader = fakeReader([
      treeData("newer", new Date("2026-03-01T00:00:00Z")),
      treeData("oldest", new Date("2026-01-01T00:00:00Z")),
      treeData("middle", new Date("2026-02-01T00:00:00Z")),
    ]);

    const result = await listSkillTrees("token", baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trees.map((t) => t.treeId)).toEqual(["oldest", "middle", "newer"]);
    }
  });

  it("rejects a non-admin caller", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await listSkillTrees("token", baseDeps({ verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects an unauthenticated caller", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await listSkillTrees("bad-token", baseDeps({ verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("excludes a malformed tree document without failing the whole call", async () => {
    const malformed: RawSkillTreeDoc = { id: "malformed", data: { name: "Broken" } };
    const reader = fakeReader([treeData("ok", new Date("2026-01-01T00:00:00Z")), malformed]);

    const result = await listSkillTrees("token", baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trees).toHaveLength(1);
      expect(result.trees[0].treeId).toBe("ok");
    }
  });

  it("returns exactly the 500 oldest-created when 501 trees exist, in ascending order", async () => {
    const docs: RawSkillTreeDoc[] = Array.from({ length: 501 }, (_, i) =>
      treeData(`tree-${i}`, new Date(2026, 0, 1 + i)),
    );
    const reader = fakeReader(docs);

    const result = await listSkillTrees("token", baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trees).toHaveLength(LIST_SKILL_TREES_LIMIT);
      expect(result.trees[0].treeId).toBe("tree-0");
      expect(result.trees[result.trees.length - 1].treeId).toBe("tree-499");
      // tree-500 (the 501st, newest-created) must be silently omitted.
      expect(result.trees.some((t) => t.treeId === "tree-500")).toBe(false);
    }
  });

  it("requests exactly LIST_SKILL_TREES_LIMIT from the reader", async () => {
    const listOrderedByCreatedAt = vi.fn().mockResolvedValue([]);
    const reader: SkillTreesReader = { listOrderedByCreatedAt };

    await listSkillTrees("token", baseDeps({ reader }));

    expect(listOrderedByCreatedAt).toHaveBeenCalledWith(LIST_SKILL_TREES_LIMIT);
    expect(LIST_SKILL_TREES_LIMIT).toBe(500);
  });

  it("never includes createdAt, createdBy, updatedAt, or updatedBy in the returned DTO", async () => {
    const reader = fakeReader([
      treeData("corrected", new Date("2026-01-01T00:00:00Z"), {
        updatedAt: new Date("2026-02-01T00:00:00Z"),
        updatedBy: "some-admin",
      }),
    ]);

    const result = await listSkillTrees("token", baseDeps({ reader }));

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("createdAt");
    expect(JSON.stringify(result)).not.toContain("createdBy");
    expect(JSON.stringify(result)).not.toContain("updatedAt");
    expect(JSON.stringify(result)).not.toContain("updatedBy");
    expect(JSON.stringify(result)).not.toContain("some-admin");
  });

  it("reports a controlled read failure on a query/read error", async () => {
    const reader: SkillTreesReader = {
      listOrderedByCreatedAt: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listSkillTrees("token", baseDeps({ reader }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never exposes a deleteSkillTree-shaped export from this module", async () => {
    const moduleExports = await import("./list-skill-trees");
    expect(Object.keys(moduleExports)).not.toContain("deleteSkillTree");
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await listSkillTrees("token", baseDeps());

    const failingReader: SkillTreesReader = {
      listOrderedByCreatedAt: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await listSkillTrees("token", baseDeps({ reader: failingReader }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
