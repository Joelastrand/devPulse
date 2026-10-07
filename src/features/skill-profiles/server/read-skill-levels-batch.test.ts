import { describe, expect, it, vi } from "vitest";
import { TEAM_SKILL_COHORT_SCAN_MAX } from "../../team-skills/domain/skill-coverage-policy";
import { createFakeSkillProfileStore } from "./fake-skill-profile-store";
import { readSkillLevelsBatch, SKILL_LEVELS_BATCH_MAX_TREES, SKILL_LEVELS_BATCH_MAX_UIDS } from "./read-skill-levels-batch";
import { getDefaultSkillProfileStore } from "./skill-profile-store";

type RawProfile = Record<string, unknown> | undefined;

/** Injected raw reader over a fixed uid → document map; records what it was asked for. */
function rawReaderOver(docs: Record<string, RawProfile>) {
  const requested: string[][] = [];
  const reader = vi.fn(async (uids: readonly string[]) => {
    requested.push([...uids]);
    return uids.map((uid) => docs[uid]);
  });
  return { reader, requested };
}

async function levelsFor(docs: Record<string, RawProfile>, uids: string[], treeIds: string[]) {
  const { reader } = rawReaderOver(docs);
  const result = await readSkillLevelsBatch(uids, treeIds, { readRaw: reader });
  if (!result.ok) throw new Error("expected ok");
  return result.levelsByTree;
}

describe("readSkillLevelsBatch — output shape", () => {
  it("returns sorted ascending integer arrays per requested tree", async () => {
    const docs = {
      "uid-zeta": { levels: { "tree-a": 4, "tree-b": 2 } },
      "uid-alpha": { levels: { "tree-a": 1, "tree-b": 3 } },
      "uid-mid": { levels: { "tree-a": 3 } },
    };
    const out = await levelsFor(docs, ["uid-zeta", "uid-alpha", "uid-mid"], ["tree-a", "tree-b"]);
    expect(out.get("tree-a")).toEqual([1, 3, 4]);
    expect(out.get("tree-b")).toEqual([2, 3]);
  });

  it("is independent of input uid order", async () => {
    const docs = {
      "uid-1": { levels: { "tree-a": 4 } },
      "uid-2": { levels: { "tree-a": 1 } },
      "uid-3": { levels: { "tree-a": 2 } },
    };
    const a = await levelsFor(docs, ["uid-1", "uid-2", "uid-3"], ["tree-a"]);
    const b = await levelsFor(docs, ["uid-3", "uid-1", "uid-2"], ["tree-a"]);
    expect(a).toEqual(b);
    expect(a.get("tree-a")).toEqual([1, 2, 4]);
  });

  it("contains only arrays of plain integers — no uid, document or other object", async () => {
    const docs = {
      "sentinel-uid-7f3a": { levels: { "tree-a": 2 }, email: "x@example.com", createdAt: new Date(), futureField: { a: 1 } },
      "sentinel-uid-91bc": { levels: { "tree-a": 3, "tree-other": 4 }, updatedAt: new Date() },
    };
    const out = await levelsFor(docs, ["sentinel-uid-7f3a", "sentinel-uid-91bc"], ["tree-a"]);
    expect([...out.keys()]).toEqual(["tree-a"]);
    for (const values of out.values()) {
      expect(Array.isArray(values)).toBe(true);
      expect(values.every((v) => Number.isInteger(v))).toBe(true);
    }
    const serialized = JSON.stringify([...out.entries()]);
    expect(serialized).not.toContain("sentinel-uid");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("futureField");
  });

  it("includes every requested tree, empty when nobody assessed it", async () => {
    const out = await levelsFor({ "uid-1": { levels: { "tree-a": 2 } } }, ["uid-1"], ["tree-a", "tree-b"]);
    expect(out.get("tree-b")).toEqual([]);
  });

  it("ignores trees that were not requested", async () => {
    const out = await levelsFor({ "uid-1": { levels: { "tree-a": 2, "tree-secret": 4 } } }, ["uid-1"], ["tree-a"]);
    expect(out.has("tree-secret")).toBe(false);
  });
});

describe("readSkillLevelsBatch — unusable data is silently skipped", () => {
  it("absent, unreadable and invalid entries contribute nothing and never become a level", async () => {
    const docs: Record<string, RawProfile> = {
      "uid-ok": { levels: { "tree-a": 3 } },
      "uid-absent": undefined,
      "uid-null-levels": { levels: null },
      "uid-array-levels": { levels: [1, 2, 3] },
      "uid-string-levels": { levels: "3" },
      "uid-unassessed": { levels: { "tree-b": 2 } },
      "uid-zero": { levels: { "tree-a": 0 } },
      "uid-five": { levels: { "tree-a": 5 } },
      "uid-string": { levels: { "tree-a": "3" } },
      "uid-fraction": { levels: { "tree-a": 2.5 } },
      "uid-null": { levels: { "tree-a": null } },
      "uid-undefined": { levels: { "tree-a": undefined } },
      "uid-inherited": { levels: {} },
    };
    const out = await levelsFor(docs, Object.keys(docs), ["tree-a", "constructor"]);
    expect(out.get("tree-a")).toEqual([3]);
    expect(out.get("constructor")).toEqual([]);
  });

  it("an invalid entry in one tree does not discard the profile's other valid trees", async () => {
    const out = await levelsFor({ "uid-1": { levels: { "tree-a": 9, "tree-b": 2 } } }, ["uid-1"], ["tree-a", "tree-b"]);
    expect(out.get("tree-a")).toEqual([]);
    expect(out.get("tree-b")).toEqual([2]);
  });

  it("counts a level exactly as a readable profile would, with no count of skipped profiles exposed", async () => {
    const out = await levelsFor(
      { "uid-1": { levels: { "tree-a": 2 } }, "uid-2": undefined, "uid-3": { levels: null } },
      ["uid-1", "uid-2", "uid-3"],
      ["tree-a"],
    );
    expect(out.get("tree-a")).toEqual([2]);
  });
});

describe("readSkillLevelsBatch — requested ids only, bounds, failure", () => {
  it("passes only the supplied uids to the raw reader, de-duplicated, so a person is counted once", async () => {
    const { reader, requested } = rawReaderOver({ "uid-1": { levels: { "tree-a": 2 } }, "uid-2": { levels: { "tree-a": 4 } } });
    const result = await readSkillLevelsBatch(["uid-1", "uid-2", "uid-1", "uid-1"], ["tree-a", "tree-a"], { readRaw: reader });
    expect(requested).toEqual([["uid-1", "uid-2"]]);
    expect(result).toEqual({ ok: true, levelsByTree: new Map([["tree-a", [2, 4]]]) });
  });

  it("does not call the raw reader for an empty uid set", async () => {
    const { reader } = rawReaderOver({});
    const result = await readSkillLevelsBatch([], ["tree-a"], { readRaw: reader });
    expect(reader).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, levelsByTree: new Map([["tree-a", []]]) });
  });

  it("pins its bounds to the cohort scan bound and the catalog window", () => {
    expect(SKILL_LEVELS_BATCH_MAX_UIDS).toBe(TEAM_SKILL_COHORT_SCAN_MAX);
    expect(SKILL_LEVELS_BATCH_MAX_TREES).toBe(500);
  });

  it("accepts exactly the maximum and fails closed above it, without reading", async () => {
    const uids = (n: number) => Array.from({ length: n }, (_, i) => `uid-${i}`);
    const trees = (n: number) => Array.from({ length: n }, (_, i) => `tree-${i}`);

    const ok = rawReaderOver({});
    expect((await readSkillLevelsBatch(uids(500), trees(500), { readRaw: ok.reader })).ok).toBe(true);

    const tooManyUids = rawReaderOver({});
    expect(await readSkillLevelsBatch(uids(501), ["tree-a"], { readRaw: tooManyUids.reader })).toEqual({ ok: false });
    expect(tooManyUids.reader).not.toHaveBeenCalled();

    const tooManyTrees = rawReaderOver({});
    expect(await readSkillLevelsBatch(["uid-1"], trees(501), { readRaw: tooManyTrees.reader })).toEqual({ ok: false });
    expect(tooManyTrees.reader).not.toHaveBeenCalled();
  });

  it("duplicates do not count towards the bound", async () => {
    const { reader } = rawReaderOver({});
    const dupes = Array.from({ length: 800 }, () => "uid-1");
    expect((await readSkillLevelsBatch(dupes, ["tree-a"], { readRaw: reader })).ok).toBe(true);
  });

  it("returns only { ok: false } on a read failure — no reason, no partial data", async () => {
    const reader = vi.fn().mockRejectedValue(new Error("boom: uid-1 secret"));
    const result = await readSkillLevelsBatch(["uid-1"], ["tree-a"], { readRaw: reader });
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("never writes or repairs: the stored documents are unchanged after a read, malformed ones included", async () => {
    const docs: Record<string, RawProfile> = {
      "uid-1": { levels: { "tree-a": 9, "tree-b": 2 }, futureField: "x", createdAt: "not-a-date" },
      "uid-2": { levels: [1] },
    };
    const before = structuredClone(docs);
    const writeTrap = new Proxy(
      {},
      {
        get() {
          throw new Error("write API must not be used");
        },
      },
    );
    const reader = vi.fn(async (uids: readonly string[]) => {
      void writeTrap;
      return uids.map((uid) => docs[uid]);
    });
    await readSkillLevelsBatch(["uid-1", "uid-2"], ["tree-a", "tree-b"], { readRaw: reader });
    expect(docs).toEqual(before);
  });
});

describe("batch reader isolation from the owner store seam", () => {
  it("the owner store interface, default store and fake expose no batch capability", () => {
    const names = (o: object) => Object.keys(o).sort();
    expect(names(getDefaultSkillProfileStore())).toEqual(["delete", "read", "runTransaction"]);
    expect(names(createFakeSkillProfileStore().store)).toEqual(["delete", "read", "runTransaction"]);
  });
});
