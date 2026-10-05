import { describe, expect, it, vi } from "vitest";
import { listSkillTrees, type RawSkillTreeDoc } from "../../skill-trees/server/list-skill-trees";
import { readSkillCatalog, SKILL_CATALOG_WINDOW, type RawCatalogDoc, type SkillCatalogReader } from "./skill-catalog";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const BASE = new Date("2026-01-01T00:00:00Z").getTime();

function treeData(createdAt: unknown, name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    nodes: [
      { nodeId: "node-0", label: "A", order: 0 },
      { nodeId: "node-1", label: "B", order: 1 },
    ],
    createdAt,
    createdBy: "admin",
    ...overrides,
  };
}

/** Valid doc `index` (0-based) whose createdAt rises with the index. */
function doc(
  index: number,
  overrides: { id?: string; name?: string; data?: Record<string, unknown> } = {},
): RawCatalogDoc {
  const id = overrides.id ?? `t${String(index).padStart(4, "0")}`;
  return {
    id,
    data: treeData(new Date(BASE + index * 1000), overrides.name ?? `Skill ${id}`, overrides.data),
  };
}

function invalidDoc(index: number): RawCatalogDoc {
  return doc(index, { data: { nodes: [] } });
}

/** Mirrors Firestore `orderBy("createdAt","asc").limit(n)`: docs are given in raw order. */
function fakeReader(docs: RawCatalogDoc[]) {
  const listOrderedByCreatedAt = vi.fn(async (limit: number) => docs.slice(0, limit));
  const reader: SkillCatalogReader = { listOrderedByCreatedAt };
  return { reader, listOrderedByCreatedAt };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("readSkillCatalog — raw window (BR-11)", () => {
  it("issues exactly one reader call with limit 501 and never refills", async () => {
    const { reader, listOrderedByCreatedAt } = fakeReader(range(600).map((i) => doc(i)));

    await readSkillCatalog(reader);

    expect(listOrderedByCreatedAt).toHaveBeenCalledTimes(1);
    expect(listOrderedByCreatedAt).toHaveBeenCalledWith(501);
    expect(SKILL_CATALOG_WINDOW).toBe(500);
  });

  it("(j) exactly 500 raw valid documents: 500 visible, truncated false", async () => {
    const { reader } = fakeReader(range(500).map((i) => doc(i)));

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toHaveLength(500);
    expect(catalog.truncated).toBe(false);
  });

  it("(d) fewer than 500 raw documents: truncated false", async () => {
    const { reader } = fakeReader(range(3).map((i) => doc(i)));

    expect((await readSkillCatalog(reader)).truncated).toBe(false);
  });

  it("(c) 501 valid raw documents: first 500 visible, the 501st excluded, truncated true", async () => {
    const { reader } = fakeReader(range(501).map((i) => doc(i)));

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toHaveLength(500);
    expect(catalog.skills.map((s) => s.treeId)).not.toContain("t0500");
    expect(catalog.truncated).toBe(true);
  });

  it("(a) invalid documents inside the window consume their slots; a valid 501st is not pulled in", async () => {
    const docs = range(501).map((i) => (i === 10 || i === 20 || i === 30 ? invalidDoc(i) : doc(i)));
    const { reader, listOrderedByCreatedAt } = fakeReader(docs);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toHaveLength(497);
    const ids = catalog.skills.map((s) => s.treeId);
    expect(ids).not.toContain("t0010");
    expect(ids).not.toContain("t0500");
    expect(catalog.truncated).toBe(true);
    expect(listOrderedByCreatedAt).toHaveBeenCalledTimes(1);
  });

  it("(a) exactly 500 raw with 3 invalid: 497 visible, truncated false", async () => {
    const docs = range(500).map((i) => (i < 3 ? invalidDoc(i) : doc(i)));
    const { reader } = fakeReader(docs);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toHaveLength(497);
    expect(catalog.truncated).toBe(false);
  });

  it("(b) an invalid 501st document still yields truncated true with every valid tree visible", async () => {
    const docs = [...range(500).map((i) => doc(i)), invalidDoc(500)];
    const { reader } = fakeReader(docs);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toHaveLength(500);
    expect(catalog.truncated).toBe(true);
  });

  it("(i) sorts by name (nb) with treeId tie-break after window selection, regardless of query order", async () => {
    const docs = [
      doc(0, { id: "z-late", name: "Åpen" }),
      doc(1, { id: "b-id", name: "Alfa" }),
      doc(2, { id: "a-id", name: "Alfa" }),
      doc(3, { id: "m-id", name: "Beta" }),
    ];
    const { reader } = fakeReader(docs);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toEqual([
      { treeId: "a-id", name: "Alfa" },
      { treeId: "b-id", name: "Alfa" },
      { treeId: "m-id", name: "Beta" },
      { treeId: "z-late", name: "Åpen" },
    ]);
  });

  it("(i) a 501st raw document that sorts first by name stays excluded (sorting never changes window membership)", async () => {
    const docs = [...range(500).map((i) => doc(i, { name: `Zeta ${i}` })), doc(500, { id: "aaa-first", name: "Aaa" })];
    const { reader } = fakeReader(docs);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills.map((s) => s.treeId)).not.toContain("aaa-first");
    expect(catalog.skills[0].name).toBe("Zeta 0");
    expect(catalog.truncated).toBe(true);
  });

  it("(e) equal createdAt values follow the reader's order (id order); window membership is not name-based", async () => {
    const same = new Date(BASE);
    const docs: RawCatalogDoc[] = range(501).map((i) => {
      const id = `id-${String(i).padStart(4, "0")}`;
      // The last id (501st raw) has the alphabetically-first name.
      return { id, data: treeData(same, i === 500 ? "Aaa" : `Name ${i}`) };
    });
    const { reader } = fakeReader(docs);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toHaveLength(500);
    expect(catalog.skills.map((s) => s.treeId)).not.toContain("id-0500");
    expect(catalog.truncated).toBe(true);
  });

  it("returns only treeId and name per skill (no nodes, creator or timestamps)", async () => {
    const { reader } = fakeReader([doc(0, { id: "tree-1", name: "TypeScript" })]);

    const catalog = await readSkillCatalog(reader);

    expect(catalog.skills).toEqual([{ treeId: "tree-1", name: "TypeScript" }]);
    expect(Object.keys(catalog.skills[0]).sort()).toEqual(["name", "treeId"]);
  });

  it("propagates a reader failure", async () => {
    const reader: SkillCatalogReader = {
      listOrderedByCreatedAt: vi.fn().mockRejectedValue(new Error("boom")),
    };

    await expect(readSkillCatalog(reader)).rejects.toThrow("boom");
  });
});

describe("(k) duplicated-reader parity with listSkillTrees", () => {
  const timestampLike = (date: Date) => ({ toDate: () => date });
  const when = new Date("2026-03-01T00:00:00Z");

  const fixtures: Array<{ label: string; id: string; data: unknown }> = [
    { label: "valid, Date", id: "valid-date", data: treeData(when, "A") },
    { label: "valid, Timestamp-like", id: "valid-ts", data: treeData(timestampLike(when), "B") },
    {
      label: "valid, Timestamp-like updatedAt with updatedBy",
      id: "valid-updated",
      data: treeData(when, "C", { updatedAt: timestampLike(when), updatedBy: "admin" }),
    },
    { label: "missing createdAt", id: "no-created", data: treeData(undefined, "D") },
    { label: "null createdAt", id: "null-created", data: treeData(null, "D2") },
    { label: "invalid createdAt string", id: "bad-created", data: treeData("2026-01-01", "E") },
    { label: "invalid Date", id: "invalid-date", data: treeData(new Date("nope"), "F") },
    { label: "invalid Timestamp-like", id: "invalid-ts", data: treeData(timestampLike(new Date("nope")), "G") },
    {
      label: "updatedAt without updatedBy",
      id: "half-updated",
      data: treeData(when, "H", { updatedAt: timestampLike(when) }),
    },
    {
      label: "invalid updatedAt",
      id: "bad-updated",
      data: treeData(when, "I", { updatedAt: "x", updatedBy: "admin" }),
    },
    { label: "too few nodes", id: "few-nodes", data: treeData(when, "J", { nodes: [] }) },
    { label: "blank name", id: "blank-name", data: treeData(when, "  ") },
    { label: "non-object data", id: "not-object", data: "garbage" },
    { label: "null data", id: "null-data", data: null },
  ];

  it("accepts and rejects exactly the same fixture documents", async () => {
    const docs = fixtures.map(({ id, data }) => ({ id, data }));
    const c1 = await readSkillCatalog(fakeReader(docs).reader);
    const admin = await listSkillTrees("token", {
      verifyToken: vi.fn().mockResolvedValue({ uid: "a", email: "admin@example.com", email_verified: true }),
      allowList: ["admin@example.com"],
      reader: { listOrderedByCreatedAt: async (limit) => docs.slice(0, limit) as RawSkillTreeDoc[] },
    });

    expect(admin.ok).toBe(true);
    const adminIds = admin.ok ? admin.trees.map((t) => t.treeId).sort() : [];
    expect(c1.skills.map((s) => s.treeId).sort()).toEqual(adminIds);
    // Guard against a vacuous comparison: both accept and reject something.
    expect(adminIds.length).toBeGreaterThan(0);
    expect(adminIds.length).toBeLessThan(fixtures.length);
  });
});
