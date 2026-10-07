import { describe, expect, it, vi } from "vitest";
import { skillNeedDocId } from "../domain/skill-need";

const log: Array<[string, string, unknown?]> = [];
const docs: Record<string, unknown> = {};
const ts = (date: Date) => ({ toDate: () => date });

vi.mock("../../../lib/firebase/admin", () => {
  const ref = (collection: string, id: string) => ({ collection, id });
  const db = {
    collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (r: { collection: string; id: string }) => {
          log.push(["get", `${r.collection}/${r.id}`]);
          const data = docs[`${r.collection}/${r.id}`];
          return { exists: data !== undefined, data: () => data };
        },
        set: (r: { collection: string; id: string }, data: unknown) => log.push(["set", `${r.collection}/${r.id}`, data]),
        delete: (r: { collection: string; id: string }) => log.push(["delete", `${r.collection}/${r.id}`]),
      }),
  };
  return { getFirestoreDb: () => db };
});

import { getDefaultSkillNeedWriteStore } from "./skill-needs-store";

describe("default need write store", () => {
  it("targets the deterministic teamSkillNeeds slot, maps timestamps and replaces whole documents", async () => {
    const when = new Date("2026-02-01T00:00:00Z");
    const docId = skillNeedDocId("team-1", "tree-1");
    docs[`teamSkillNeeds/${docId}`] = { createdAt: ts(when), updatedAt: ts(when), requiredLevel: 2 };

    const record = {
      teamId: "team-1",
      treeId: "tree-1",
      requiredLevel: 3 as const,
      requiredCoverage: 2,
      createdAt: when,
      updatedAt: when,
    };
    await getDefaultSkillNeedWriteStore().runTransaction(async (tx) => {
      const existing = (await tx.getNeed(docId)) as { createdAt: unknown };
      expect(existing.createdAt).toEqual(when);
      expect(await tx.getNeed("team-1__absent")).toBeUndefined();
      tx.putNeed(docId, record);
      tx.deleteNeed(docId);
    });

    expect(log.filter(([op]) => op === "set")).toEqual([["set", `teamSkillNeeds/${docId}`, record]]);
    expect(log.filter(([op]) => op === "delete")).toEqual([["delete", `teamSkillNeeds/${docId}`]]);
  });

  it("reads team, membership and tree documents inside the transaction", async () => {
    log.length = 0;
    docs["teams/team-1"] = { status: "active" };
    docs["teamMemberships/u1__team-1"] = { uid: "u1", teamId: "team-1" };
    docs["skillTrees/tree-1"] = { name: "T" };
    await getDefaultSkillNeedWriteStore().runTransaction(async (tx) => {
      expect(await tx.reads.getTeamStatus("team-1")).toBe("active");
      expect(await tx.reads.getMembership("u1", "team-1")).toEqual({ uid: "u1", teamId: "team-1" });
      expect(await tx.getSkillTree("tree-1")).toEqual({ name: "T" });
      expect(await tx.reads.getTeamStatus("missing")).toBeUndefined();
    });
    expect(log.every(([op]) => op === "get")).toBe(true);
  });
});
