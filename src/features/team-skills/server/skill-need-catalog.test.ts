import { describe, expect, it, vi } from "vitest";
import { listSkillTrees, type RawSkillTreeDoc } from "../../skill-trees/server/list-skill-trees";
import {
  readSkillNeedCatalog,
  readValidSkillTree,
  SKILL_NEED_CATALOG_WINDOW,
  type RawTreeDoc,
  type SkillNeedCatalogReader,
} from "./skill-need-catalog";

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

function doc(index: number, overrides: { id?: string; name?: string; data?: Record<string, unknown> } = {}): RawTreeDoc {
  const id = overrides.id ?? `t${String(index).padStart(4, "0")}`;
  return { id, data: treeData(new Date(BASE + index * 1000), overrides.name ?? `Skill ${id}`, overrides.data) };
}

const invalidDoc = (index: number) => doc(index, { data: { nodes: [] } });

function fakeReader(docs: RawTreeDoc[]) {
  const listOrderedByCreatedAt = vi.fn(async (limit: number) => docs.slice(0, limit));
  const reader: SkillNeedCatalogReader = { listOrderedByCreatedAt, getSkillTree: vi.fn() };
  return { reader, listOrderedByCreatedAt };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("readSkillNeedCatalog — raw window", () => {
  it("issues exactly one query with limit 501 and never refills", async () => {
    const { reader, listOrderedByCreatedAt } = fakeReader(range(600).map((i) => doc(i)));

    await readSkillNeedCatalog(reader);

    expect(listOrderedByCreatedAt).toHaveBeenCalledTimes(1);
    expect(listOrderedByCreatedAt).toHaveBeenCalledWith(501);
    expect(SKILL_NEED_CATALOG_WINDOW).toBe(500);
  });

  it("up to 500 raw documents: all visible, not truncated", async () => {
    const { reader } = fakeReader(range(500).map((i) => doc(i)));

    const result = await readSkillNeedCatalog(reader);

    expect(result.catalog).toHaveLength(500);
    expect(result.truncated).toBe(false);
  });

  it("a 501st raw document sets truncated and is not visible", async () => {
    const { reader } = fakeReader(range(501).map((i) => doc(i)));

    const result = await readSkillNeedCatalog(reader);

    expect(result.catalog).toHaveLength(500);
    expect(result.catalog.map((s) => s.treeId)).not.toContain("t0500");
    expect(result.truncated).toBe(true);
  });

  it("invalid documents consume slots and are not refilled by the valid 501st", async () => {
    const docs = range(501).map((i) => (i === 10 || i === 20 || i === 30 ? invalidDoc(i) : doc(i)));
    const { reader } = fakeReader(docs);

    const result = await readSkillNeedCatalog(reader);

    expect(result.catalog).toHaveLength(497);
    expect(result.catalog.map((s) => s.treeId)).not.toContain("t0500");
    expect(result.truncated).toBe(true);
  });

  it("an invalid 501st document still means truncated", async () => {
    const { reader } = fakeReader([...range(500).map((i) => doc(i)), invalidDoc(500)]);

    const result = await readSkillNeedCatalog(reader);

    expect(result.catalog).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });

  it("sorts visible trees by name after window selection; a 501st that sorts first stays excluded", async () => {
    const docs = [...range(500).map((i) => doc(i, { name: `Zeta ${i}` })), doc(500, { id: "aaa-first", name: "Aaa" })];
    const { reader } = fakeReader(docs);

    const result = await readSkillNeedCatalog(reader);

    expect(result.catalog.map((s) => s.treeId)).not.toContain("aaa-first");
    expect(result.catalog[0].name).toBe("Zeta 0");
  });

  it("sorts by name (nb) with treeId tie-break", async () => {
    const { reader } = fakeReader([
      doc(0, { id: "z-late", name: "Åpen" }),
      doc(1, { id: "b-id", name: "Alfa" }),
      doc(2, { id: "a-id", name: "Alfa" }),
    ]);

    expect((await readSkillNeedCatalog(reader)).catalog).toEqual([
      { treeId: "a-id", name: "Alfa" },
      { treeId: "b-id", name: "Alfa" },
      { treeId: "z-late", name: "Åpen" },
    ]);
  });

  it("returns only treeId and name per entry", async () => {
    const { reader } = fakeReader([doc(0, { id: "tree-1", name: "TypeScript" })]);

    const { catalog } = await readSkillNeedCatalog(reader);

    expect(Object.keys(catalog[0]).sort()).toEqual(["name", "treeId"]);
  });

  it("propagates a reader failure", async () => {
    const reader: SkillNeedCatalogReader = {
      listOrderedByCreatedAt: vi.fn().mockRejectedValue(new Error("boom")),
      getSkillTree: vi.fn(),
    };

    await expect(readSkillNeedCatalog(reader)).rejects.toThrow("boom");
  });
});

describe("readValidSkillTree", () => {
  const readerFor = (value: unknown): SkillNeedCatalogReader => ({
    listOrderedByCreatedAt: vi.fn(),
    getSkillTree: vi.fn(async () => value),
  });

  it("returns a valid tree, null for missing or invalid, and rejects on read failure", async () => {
    const when = new Date("2026-03-01T00:00:00Z");
    expect((await readValidSkillTree(readerFor(treeData({ toDate: () => when }, "A")), "t"))?.name).toBe("A");
    expect(await readValidSkillTree(readerFor(undefined), "t")).toBeNull();
    expect(await readValidSkillTree(readerFor(treeData(when, "A", { nodes: [] })), "t")).toBeNull();
    const failing: SkillNeedCatalogReader = {
      listOrderedByCreatedAt: vi.fn(),
      getSkillTree: vi.fn().mockRejectedValue(new Error("boom")),
    };
    await expect(readValidSkillTree(failing, "t")).rejects.toThrow("boom");
  });
});

describe("parity with listSkillTrees candidate mapping", () => {
  const timestampLike = (date: Date) => ({ toDate: () => date });
  const when = new Date("2026-03-01T00:00:00Z");

  const fixtures: Array<{ id: string; data: unknown }> = [
    { id: "valid-date", data: treeData(when, "A") },
    { id: "valid-ts", data: treeData(timestampLike(when), "B") },
    { id: "valid-updated", data: treeData(when, "C", { updatedAt: timestampLike(when), updatedBy: "admin" }) },
    { id: "no-created", data: treeData(undefined, "D") },
    { id: "null-created", data: treeData(null, "D2") },
    { id: "bad-created", data: treeData("2026-01-01", "E") },
    { id: "invalid-date", data: treeData(new Date("nope"), "F") },
    { id: "invalid-ts", data: treeData(timestampLike(new Date("nope")), "G") },
    { id: "half-updated", data: treeData(when, "H", { updatedAt: timestampLike(when) }) },
    { id: "bad-updated", data: treeData(when, "I", { updatedAt: "x", updatedBy: "admin" }) },
    { id: "few-nodes", data: treeData(when, "J", { nodes: [] }) },
    { id: "blank-name", data: treeData(when, "  ") },
    { id: "not-object", data: "garbage" },
    { id: "null-data", data: null },
  ];

  it("accepts and rejects exactly the same fixture documents", async () => {
    const own = await readSkillNeedCatalog(fakeReader(fixtures).reader);
    const admin = await listSkillTrees("token", {
      verifyToken: vi.fn().mockResolvedValue({ uid: "a", email: "admin@example.com", email_verified: true }),
      allowList: ["admin@example.com"],
      reader: { listOrderedByCreatedAt: async (limit) => fixtures.slice(0, limit) as RawSkillTreeDoc[] },
    });

    expect(admin.ok).toBe(true);
    const adminIds = admin.ok ? admin.trees.map((t) => t.treeId).sort() : [];
    expect(own.catalog.map((s) => s.treeId).sort()).toEqual(adminIds);
    expect(adminIds.length).toBeGreaterThan(0);
    expect(adminIds.length).toBeLessThan(fixtures.length);
  });
});
