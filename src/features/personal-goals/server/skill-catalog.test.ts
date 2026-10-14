import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SKILL_TREE_READ_CHUNK_SIZE,
  getDefaultSkillCatalogReader,
  readSkillOptions,
  readSkillTreeName,
  resolveSkillNames,
  type RawCatalogDoc,
  type RawTreeRead,
  type SkillCatalogReader,
} from "./skill-catalog";

const db = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    if (!db.current) throw new Error("unexpected Firestore use");
    return db.current;
  },
}));

const BASE = new Date("2026-01-01T00:00:00Z").getTime();

function treeData(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    nodes: [
      { nodeId: "node-0", label: "A", order: 0 },
      { nodeId: "node-1", label: "B", order: 1 },
    ],
    createdAt: new Date(BASE),
    createdBy: "admin-secret-uid",
    ...overrides,
  };
}

const id = (index: number) => `t${String(index).padStart(4, "0")}`;
const valid = (index: number, name = `Skill ${id(index)}`): RawCatalogDoc => ({ id: id(index), data: treeData(name) });
const malformed = (index: number): RawCatalogDoc => ({ id: id(index), data: { name: "LEAKED-RAW", nodes: "x" } });

/** In-memory reader over an ordered raw list; records every call. */
function fakeReader(ordered: RawCatalogDoc[]) {
  const calls = { list: [] as number[], get: [] as string[], many: [] as string[][] };
  const find = (treeId: string): RawTreeRead => ({ id: treeId, data: ordered.find((d) => d.id === treeId)?.data });
  const reader: SkillCatalogReader = {
    async listOrderedByCreatedAt(limit) {
      calls.list.push(limit);
      return ordered.slice(0, limit);
    },
    async getById(treeId) {
      calls.get.push(treeId);
      return find(treeId);
    },
    async getManyByIds(treeIds) {
      calls.many.push([...treeIds]);
      return treeIds.map(find);
    },
  };
  return { reader, calls };
}

const failingReader: SkillCatalogReader = {
  listOrderedByCreatedAt: () => Promise.reject(new Error("boom: secret detail")),
  getById: () => Promise.reject(new Error("boom: secret detail")),
  getManyByIds: () => Promise.reject(new Error("boom: secret detail")),
};

describe("readSkillOptions — basics", () => {
  it("returns no options and no truncation for an empty catalog", async () => {
    const { reader } = fakeReader([]);
    expect(await readSkillOptions(reader)).toEqual({ ok: true, options: [], truncated: false });
  });

  it("returns exactly {treeId, name} for one valid tree, with no other data", async () => {
    const { reader } = fakeReader([{ id: "a", data: treeData("Testing", { updatedAt: new Date(BASE), updatedBy: "x" }) }]);
    const result = await readSkillOptions(reader);
    expect(result).toEqual({ ok: true, options: [{ treeId: "a", name: "Testing" }], truncated: false });
    if (result.ok) expect(Object.keys(result.options[0]).sort()).toEqual(["name", "treeId"]);
  });

  it("maps Firestore Timestamps to Dates before validating", async () => {
    const stamp = { toDate: () => new Date(BASE) };
    const { reader } = fakeReader([{ id: "a", data: treeData("Timestamped", { createdAt: stamp, updatedAt: stamp, updatedBy: "x" }) }]);
    expect(await readSkillOptions(reader)).toMatchObject({ options: [{ treeId: "a", name: "Timestamped" }] });
  });

  it("orders for presentation by name code point, then treeId, independent of query order", async () => {
    const { reader } = fakeReader([
      { id: "z", data: treeData("Beta") },
      { id: "b", data: treeData("Alpha") },
      { id: "a", data: treeData("Alpha") },
      { id: "c", data: treeData("alpha") },
      { id: "d", data: treeData("Ålpha") },
      { id: "e", data: treeData("\u{1F600}") },
      { id: "f", data: treeData("Ａ") },
    ]);
    const result = await readSkillOptions(reader);
    expect(result.ok && result.options.map((o) => o.treeId)).toEqual(["a", "b", "z", "c", "d", "f", "e"]);
  });
});

describe("readSkillOptions — raw window", () => {
  const list = (count: number) => Array.from({ length: count }, (_, i) => valid(i));

  it.each([
    [0, 0, false],
    [1, 1, false],
    [499, 499, false],
    [500, 500, false],
    [501, 500, true],
  ])("with %i raw documents offers %i options, truncated=%s", async (raw, offered, truncated) => {
    const { reader, calls } = fakeReader(list(raw));
    const result = await readSkillOptions(reader);
    expect(calls.list).toEqual([501]);
    expect(result.ok && result.options).toHaveLength(offered);
    expect(result.ok && result.truncated).toBe(truncated);
  });

  it("never offers the 501st probe, even when it is valid", async () => {
    const { reader } = fakeReader(list(501));
    const result = await readSkillOptions(reader);
    expect(result.ok && result.options.some((o) => o.treeId === id(500))).toBe(false);
  });

  it("drops malformed window documents, keeps their slot, and does not refill from beyond the window", async () => {
    const raw = list(502);
    raw[0] = malformed(0);
    raw[250] = malformed(250);
    raw[499] = malformed(499);
    const { reader } = fakeReader(raw);
    const result = await readSkillOptions(reader);
    expect(result.ok && result.options).toHaveLength(497);
    expect(result.ok && result.options.map((o) => o.treeId)).not.toContain(id(500));
    expect(result.ok && result.options.map((o) => o.treeId)).not.toContain(id(501));
    expect(result.ok && result.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain("LEAKED-RAW");
  });

  it("does not examine a malformed probe: it only decides truncation", async () => {
    const raw = list(501);
    raw[500] = malformed(500);
    const { reader } = fakeReader(raw);
    const result = await readSkillOptions(reader);
    expect(result.ok && result.options).toHaveLength(500);
    expect(result.ok && result.truncated).toBe(true);
  });

  it("fixes the window before validation: a window of only malformed documents yields no options but is truncated", async () => {
    const raw = list(501).map((_, i) => (i < 500 ? malformed(i) : valid(i)));
    const { reader } = fakeReader(raw);
    expect(await readSkillOptions(reader)).toEqual({ ok: true, options: [], truncated: true });
  });

  it("rejects representative malformed shapes without repairing them", async () => {
    const bad: unknown[] = [
      null,
      "string",
      [],
      treeData(""),
      treeData("N", { nodes: [] }),
      treeData("N", { createdAt: "2026-01-01" }),
      treeData("N", { updatedAt: new Date(BASE) }),
    ];
    const { reader } = fakeReader(bad.map((data, i) => ({ id: id(i), data })));
    expect(await readSkillOptions(reader)).toEqual({ ok: true, options: [], truncated: false });
  });

  it("returns a typed failure, not an empty catalog, when the read fails", async () => {
    const result = await readSkillOptions(failingReader);
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("direct resolution is independent of the selector window", () => {
  const many = Array.from({ length: 520 }, (_, i) => valid(i));

  it("a valid tree beyond the window is not offered but resolves directly and in batch", async () => {
    const { reader } = fakeReader(many);
    const options = await readSkillOptions(reader);
    expect(options.ok && options.options.some((o) => o.treeId === id(510))).toBe(false);
    expect(await readSkillTreeName(id(510), reader)).toEqual({ ok: true, name: `Skill ${id(510)}` });
    const batch = await resolveSkillNames([id(510)], reader);
    expect(batch.ok && batch.names.get(id(510))).toBe(`Skill ${id(510)}`);
  });

  it("a malformed window document is not offered yet an independent direct read of a valid one is unaffected", async () => {
    const { reader } = fakeReader([malformed(0), valid(1)]);
    expect(await readSkillTreeName(id(0), reader)).toEqual({ ok: true, name: null });
    expect(await readSkillTreeName(id(1), reader)).toEqual({ ok: true, name: `Skill ${id(1)}` });
  });
});

describe("readSkillTreeName", () => {
  it("is unavailable (not a failure) for a missing tree, a malformed tree and unreadable ids, without leaking raw data", async () => {
    const { reader, calls } = fakeReader([malformed(1)]);
    expect(await readSkillTreeName("missing", reader)).toEqual({ ok: true, name: null });
    const malformedResult = await readSkillTreeName(id(1), reader);
    expect(malformedResult).toEqual({ ok: true, name: null });
    expect(JSON.stringify(malformedResult)).not.toContain("LEAKED-RAW");
    for (const bad of ["", "a/b", ".", "..", "__x__"]) {
      expect(await readSkillTreeName(bad, reader)).toEqual({ ok: true, name: null });
    }
    expect(calls.get).toEqual(["missing", id(1)]);
  });

  it("distinguishes a read failure from an unavailable tree", async () => {
    expect(await readSkillTreeName("a", failingReader)).toEqual({ ok: false });
  });
});

describe("resolveSkillNames", () => {
  it("returns an empty map and performs no read for an empty request", async () => {
    const { reader, calls } = fakeReader([]);
    expect(await resolveSkillNames([], reader)).toEqual({ ok: true, names: new Map() });
    expect(calls.many).toEqual([]);
  });

  it("deduplicates, resolves mixed valid/missing/malformed deterministically, in a single batch call", async () => {
    const { reader, calls } = fakeReader([valid(1, "One"), malformed(2), valid(3, "Three")]);
    const result = await resolveSkillNames([id(3), id(1), id(3), id(2), "missing", id(1)], reader);
    expect(result.ok && [...result.names]).toEqual([
      [id(3), "Three"],
      [id(1), "One"],
      [id(2), null],
      ["missing", null],
    ]);
    expect(calls.many).toEqual([[id(3), id(1), id(2), "missing"]]);
    expect(calls.get).toEqual([]);
    expect(JSON.stringify([...(result.ok ? result.names : [])])).not.toContain("LEAKED-RAW");
  });

  it("chunks at the repository precedent size and never reads per id", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => id(i));
    const { reader, calls } = fakeReader(ids.map((_, i) => valid(i)));
    const result = await resolveSkillNames(ids, reader);
    expect(SKILL_TREE_READ_CHUNK_SIZE).toBe(100);
    expect(calls.many.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(result.ok && result.names.size).toBe(250);
  });

  it("marks unreadable ids unavailable without sending them to the reader", async () => {
    const { reader, calls } = fakeReader([valid(1, "One")]);
    const result = await resolveSkillNames(["a/b", id(1)], reader);
    expect(result.ok && [...result.names]).toEqual([
      ["a/b", null],
      [id(1), "One"],
    ]);
    expect(calls.many).toEqual([[id(1)]]);
  });

  it("returns a typed failure when any chunk read fails", async () => {
    expect(await resolveSkillNames(["a"], failingReader)).toEqual({ ok: false });
  });
});

describe("default Admin SDK reader — query shape (recording double, not proof of live Firestore)", () => {
  const log: string[] = [];
  const snapshot = (docId: string, data: unknown) => ({ id: docId, exists: data !== undefined, data: () => data });

  beforeEach(() => {
    log.length = 0;
    const query = {
      orderBy: (field: string, dir: string) => (log.push(`orderBy:${field}:${dir}`), query),
      limit: (n: number) => (log.push(`limit:${n}`), query),
      get: async () => (log.push("get"), { docs: [snapshot("a", treeData("A"))] }),
      doc: (docId: string) => (log.push(`doc:${docId}`), { path: docId, get: async () => snapshot(docId, undefined) }),
      where: () => {
        throw new Error("unexpected where");
      },
    };
    db.current = {
      collection: (name: string) => (log.push(`collection:${name}`), query),
      getAll: async (...refs: Array<{ path: string }>) => (log.push(`getAll:${refs.map((r) => r.path).join(",")}`), refs.map((r) => snapshot(r.path, treeData(r.path)))),
      runTransaction: () => {
        throw new Error("unexpected transaction");
      },
    };
  });

  it("lists with orderBy(createdAt, asc).limit(501) on skillTrees and nothing else", async () => {
    await getDefaultSkillCatalogReader().listOrderedByCreatedAt(501);
    expect(log).toEqual(["collection:skillTrees", "orderBy:createdAt:asc", "limit:501", "get"]);
  });

  it("reads a direct tree by document id in skillTrees", async () => {
    expect(await getDefaultSkillCatalogReader().getById("t1")).toEqual({ id: "t1", data: undefined });
    expect(log).toEqual(["collection:skillTrees", "doc:t1"]);
  });

  it("batch-reads exactly the requested document ids with one getAll", async () => {
    const result = await getDefaultSkillCatalogReader().getManyByIds(["x", "y"]);
    expect(result.map((r) => r.id)).toEqual(["x", "y"]);
    expect(log).toEqual(["collection:skillTrees", "doc:x", "collection:skillTrees", "doc:y", "getAll:x,y"]);
  });
});
