import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveSkillTreeReferences,
  SKILL_TREE_READ_CHUNK_SIZE,
  type RawSkillTreeRead,
  type RawSkillTreeReader,
} from "./skill-tree-seam-types";

const validTree = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
    { nodeId: "node-2", label: "Expert", order: 2 },
  ],
  createdAt: new Date("2026-10-01T10:00:00Z"),
  createdBy: "admin-uid",
};

/** Recording in-memory reader: `docs` maps a treeId to its raw data; absent ids read as missing. */
function recordingReader(docs: Record<string, unknown>, failOn?: string) {
  const calls: string[][] = [];
  const reader: RawSkillTreeReader = {
    async getMany(treeIds) {
      calls.push([...treeIds]);
      if (failOn !== undefined && treeIds.includes(failOn)) {
        throw new Error("transient read failure");
      }
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: docs[id] }));
    },
  };
  return { reader, calls };
}

describe("resolveSkillTreeReferences", () => {
  it("classifies a valid tree with its name", async () => {
    const { reader } = recordingReader({ api: validTree });
    const references = await resolveSkillTreeReferences(["api"], reader);
    expect(references.get("api")).toEqual({ status: "valid", treeId: "api", name: "API design" });
  });

  it("classifies an absent tree as missing", async () => {
    const { reader } = recordingReader({});
    const references = await resolveSkillTreeReferences(["gone"], reader);
    expect(references.get("gone")).toEqual({ status: "missing", treeId: "gone" });
  });

  it("classifies a malformed tree as invalid", async () => {
    const { reader } = recordingReader({ broken: { ...validTree, name: "   " } });
    const references = await resolveSkillTreeReferences(["broken"], reader);
    expect(references.get("broken")).toEqual({ status: "invalid", treeId: "broken" });
  });

  it("reads only the referenced ids, each once", async () => {
    const { reader, calls } = recordingReader({ api: validTree });
    await resolveSkillTreeReferences(["api", "api", "other"], reader);
    expect(calls).toEqual([["api", "other"]]);
  });

  it("reads in chunks of at most 100 ids", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `tree-${index}`);
    const { reader, calls } = recordingReader({});
    const references = await resolveSkillTreeReferences(ids, reader);
    expect(SKILL_TREE_READ_CHUNK_SIZE).toBe(100);
    expect(calls.map((call) => call.length)).toEqual([100, 100, 50]);
    expect(references.size).toBe(250);
  });

  it("rejects when a read fails, and never classifies the failed id as missing", async () => {
    const { reader } = recordingReader({ api: validTree }, "api");
    await expect(resolveSkillTreeReferences(["api"], reader)).rejects.toThrow("transient read failure");
  });
});

describe("skill tree seam source constraints (SI-8, PG-7)", () => {
  const SEAM_FILES = ["skill-tree-seam-types.ts", "skill-tree-seam.ts"];
  // Firestore write surface. Checked on the Firestore reader only: `Map.set` in the pure module is not a write.
  const FIRESTORE_WRITE_CALL = /\.(set|update|create|delete|commit)\(|\bbatch\(|runTransaction\(/;
  const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");

  it("the Firestore reader performs no write call", () => {
    expect(read("skill-tree-seam.ts")).not.toMatch(FIRESTORE_WRITE_CALL);
  });

  it("the pure seam module imports nothing from Firebase", () => {
    expect(read("skill-tree-seam-types.ts")).not.toMatch(/firebase/);
  });

  it.each(SEAM_FILES)("%s does not import from skill-trees/server", (name) => {
    expect(read(name)).not.toMatch(/skill-trees\/server/);
  });
});
