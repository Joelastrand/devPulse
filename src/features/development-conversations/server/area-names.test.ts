import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAreaNames, toTreeCandidate, type SkillTreeNameReader } from "./area-names";

/** A valid stored SkillTree as a raw Firestore read returns it, with timestamps already `Date`s. */
function treeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Kodekvalitet",
    nodes: [
      { nodeId: "node-0", label: "Start", order: 0 },
      { nodeId: "node-1", label: "Mål", order: 1 },
    ],
    createdAt: new Date("2026-08-01T08:00:00.000Z"),
    createdBy: "admin-1",
    ...overrides,
  };
}

/**
 * Test-local catalog reader. It records every point read so tests can prove the bound and deduplication. It does not
 * import the D1 catalog seam.
 */
function fakeCatalog(trees: Record<string, unknown> = {}) {
  const reads: string[] = [];
  let failNext = false;
  const reader: SkillTreeNameReader = {
    async getSkillTree(treeId) {
      reads.push(treeId);
      if (failNext) {
        failNext = false;
        throw new Error("simulated Firestore failure with a secret path");
      }
      return trees[treeId] === undefined ? undefined : structuredClone(trees[treeId]);
    },
  };
  return {
    reader,
    reads,
    failNextRead() {
      failNext = true;
    },
  };
}

describe("resolveAreaNames", () => {
  it("returns the catalog name for a valid tree", async () => {
    const catalog = fakeCatalog({ "tree-a": treeData() });

    const result = await resolveAreaNames(["tree-a"], catalog.reader);

    expect(result).toEqual({ ok: true, names: new Map([["tree-a", "Kodekvalitet"]]) });
  });

  it("returns null for a missing tree", async () => {
    const catalog = fakeCatalog({});

    const result = await resolveAreaNames(["tree-missing"], catalog.reader);

    expect(result).toEqual({ ok: true, names: new Map([["tree-missing", null]]) });
  });

  it("returns null for a stored tree with an invalid shape and never leaks partial content", async () => {
    const catalog = fakeCatalog({
      "tree-bad": treeData({ nodes: [{ nodeId: "node-0", label: "Only one", order: 0 }] }),
      "tree-blank-name": treeData({ name: "   " }),
    });

    const result = await resolveAreaNames(["tree-bad", "tree-blank-name"], catalog.reader);

    expect(result).toEqual({
      ok: true,
      names: new Map([
        ["tree-bad", null],
        ["tree-blank-name", null],
      ]),
    });
  });

  it("reads each unique tree id once and maps every requested id", async () => {
    const catalog = fakeCatalog({ "tree-a": treeData(), "tree-b": treeData({ name: "Samarbeid" }) });

    const result = await resolveAreaNames(["tree-a", "tree-b", "tree-a"], catalog.reader);

    expect(catalog.reads).toEqual(["tree-a", "tree-b"]);
    expect(result).toEqual({
      ok: true,
      names: new Map([
        ["tree-a", "Kodekvalitet"],
        ["tree-b", "Samarbeid"],
      ]),
    });
  });

  it("performs no reads for an empty selection", async () => {
    const catalog = fakeCatalog({});

    const result = await resolveAreaNames([], catalog.reader);

    expect(catalog.reads).toEqual([]);
    expect(result).toEqual({ ok: true, names: new Map() });
  });

  it("rejects more than five distinct tree ids before any read", async () => {
    const catalog = fakeCatalog({});
    const ids = ["t1", "t2", "t3", "t4", "t5", "t6"];

    const result = await resolveAreaNames(ids, catalog.reader);

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(catalog.reads).toEqual([]);
  });

  it("treats a tree id that cannot name a document as absent, without reading it", async () => {
    const catalog = fakeCatalog({ "tree-a": treeData() });

    const result = await resolveAreaNames(["tree-a", "a/b", "", "..", "__reserved__"], catalog.reader);

    expect(catalog.reads).toEqual(["tree-a"]);
    expect(result).toEqual({
      ok: true,
      names: new Map([
        ["tree-a", "Kodekvalitet"],
        ["a/b", null],
        ["", null],
        ["..", null],
        ["__reserved__", null],
      ]),
    });
  });

  it("maps a mixed set of valid, missing and invalid trees per id, reading a duplicate missing id once", async () => {
    const catalog = fakeCatalog({
      "tree-a": treeData(),
      "tree-bad": treeData({ nodes: [{ nodeId: "node-0", label: "Only one", order: 0 }] }),
    });

    const result = await resolveAreaNames(["tree-a", "tree-missing", "tree-bad", "tree-missing"], catalog.reader);

    expect(catalog.reads).toEqual(["tree-a", "tree-missing", "tree-bad"]);
    expect(result).toEqual({
      ok: true,
      names: new Map([
        ["tree-a", "Kodekvalitet"],
        ["tree-missing", null],
        ["tree-bad", null],
      ]),
    });
  });

  it("reports a read failure as persistence_failed, never as an unavailable area", async () => {
    const catalog = fakeCatalog({ "tree-a": treeData() });
    catalog.failNextRead();

    const result = await resolveAreaNames(["tree-a"], catalog.reader);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
  });

  it("returns persistence_failed with no partial names when a later read fails after an earlier success", async () => {
    const catalog = fakeCatalog({ "tree-a": treeData(), "tree-b": treeData({ name: "Samarbeid" }) });
    const reader: SkillTreeNameReader = {
      async getSkillTree(treeId) {
        if (treeId === "tree-b") {
          throw new Error("simulated Firestore failure on the second read");
        }
        return catalog.reader.getSkillTree(treeId);
      },
    };

    const result = await resolveAreaNames(["tree-a", "tree-b"], reader);

    expect(catalog.reads).toEqual(["tree-a"]);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(result).not.toHaveProperty("names");
  });
});

describe("toTreeCandidate", () => {
  it("maps Firestore Timestamp-like createdAt and updatedAt values to Date before validation", () => {
    const createdAt = new Date("2026-08-01T08:00:00.000Z");
    const timestampLike = { toDate: () => createdAt };

    const candidate = toTreeCandidate({ ...treeData(), createdAt: timestampLike });

    expect(candidate).toMatchObject({ name: "Kodekvalitet", createdAt });
  });

  it("returns undefined for a non-object document", () => {
    expect(toTreeCandidate(undefined)).toBeUndefined();
    expect(toTreeCandidate("tree")).toBeUndefined();
  });
});

describe("area-names seam boundaries", () => {
  it("is read-only: it contains no Firestore write call and no skill-trees server import", () => {
    const source = readFileSync(new URL("./area-names.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/\.(update|create|delete|add)\(|\b(runTransaction|batch)\(|\.doc\([^)]*\)\.set\(/);
    expect(source).not.toMatch(/from\s+["'][^"']*skill-trees\/server/);
  });
});
