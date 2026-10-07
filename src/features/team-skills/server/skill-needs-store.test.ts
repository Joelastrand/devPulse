import { beforeEach, describe, expect, it, vi } from "vitest";
import { skillNeedDocId } from "../domain/skill-need";

const calls: Array<{ op: string; arg: unknown }> = [];
let queryResult: Array<{ id: string; data: () => unknown }> = [];
let failQuery = false;

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => ({
    collection: (name: string) => {
      calls.push({ op: "collection", arg: name });
      const query = {
        where: (field: string, op: string, value: unknown) => {
          calls.push({ op: "where", arg: [field, op, value] });
          return query;
        },
        limit: (n: number) => {
          calls.push({ op: "limit", arg: n });
          return query;
        },
        orderBy: () => {
          throw new Error("an orderBy would need a composite index");
        },
        get: async () => {
          if (failQuery) throw new Error("boom");
          return { docs: queryResult };
        },
      };
      return query;
    },
  }),
}));

import { getDefaultSkillNeedsStore, SKILL_NEEDS_LIST_MAX, type SkillNeedsReader } from "./skill-needs-store";

const WHEN = new Date("2026-02-01T00:00:00Z");
const ts = (date: Date) => ({ toDate: () => date });

function need(teamId: string, treeId: string, overrides: Record<string, unknown> = {}) {
  return {
    teamId,
    treeId,
    requiredLevel: 3,
    requiredCoverage: 2,
    createdAt: WHEN,
    updatedAt: WHEN,
    ...overrides,
  };
}

function rawDoc(teamId: string, treeId: string, overrides: Record<string, unknown> = {}) {
  return { id: skillNeedDocId(teamId, treeId), data: need(teamId, treeId, overrides) };
}

function readerOf(docs: Array<{ id: string; data: unknown }>) {
  const listByTeam = vi.fn(async (_teamId: string, limit: number) => docs.slice(0, limit));
  const reader: SkillNeedsReader = { listByTeam };
  return { reader, listByTeam };
}

beforeEach(() => {
  calls.length = 0;
  queryResult = [];
  failQuery = false;
});

describe("default Firestore reader", () => {
  it("reads exactly teamSkillNeeds with a single-field where and limit 501 (no orderBy, no composite index)", async () => {
    queryResult = [{ id: skillNeedDocId("team-1", "t1"), data: () => need("team-1", "t1", { createdAt: ts(WHEN), updatedAt: ts(WHEN) }) }];

    const listed = await getDefaultSkillNeedsStore().listNeeds("team-1");

    expect(calls).toEqual([
      { op: "collection", arg: "teamSkillNeeds" },
      { op: "where", arg: ["teamId", "==", "team-1"] },
      { op: "limit", arg: 501 },
    ]);
    expect(listed.needs).toHaveLength(1);
    expect(listed.needs[0].createdAt).toEqual(WHEN);
  });

  it("rejects when the query fails instead of returning an empty list", async () => {
    failQuery = true;

    await expect(getDefaultSkillNeedsStore().listNeeds("team-1")).rejects.toThrow("boom");
  });
});

describe("listNeeds validation", () => {
  it("returns an empty, untruncated result for a successful read with no documents", async () => {
    const { reader } = readerOf([]);

    expect(await getDefaultSkillNeedsStore(reader).listNeeds("team-1")).toEqual({ needs: [], truncated: false });
  });

  it("skips malformed documents without repairing or returning them", async () => {
    const { reader } = readerOf([
      rawDoc("team-1", "ok"),
      rawDoc("team-1", "level-one", { requiredLevel: 1 }),
      rawDoc("team-1", "bad-coverage", { requiredCoverage: 21 }),
      rawDoc("team-1", "bad-time", { updatedAt: "yesterday" }),
      rawDoc("team-1", "extra-key", { createdBy: "someone" }),
      // stored teamId differs from the id's team
      { id: skillNeedDocId("team-1", "wrong-team"), data: need("team-2", "wrong-team") },
      // stored treeId differs from the document id
      { id: skillNeedDocId("team-1", "wrong-tree"), data: need("team-1", "other-tree") },
      { id: skillNeedDocId("team-1", "garbage"), data: "garbage" },
    ]);

    const listed = await getDefaultSkillNeedsStore(reader).listNeeds("team-1");

    expect(listed.needs.map((n) => n.treeId)).toEqual(["ok"]);
    expect(listed.truncated).toBe(false);
  });

  it("never surfaces another team's valid need, even when the query returns it", async () => {
    const { reader } = readerOf([rawDoc("team-2", "t1"), rawDoc("team-1", "t2")]);

    const listed = await getDefaultSkillNeedsStore(reader).listNeeds("team-1");

    expect(listed.needs.map((n) => `${n.teamId}/${n.treeId}`)).toEqual(["team-1/t2"]);
  });

  it("uses the first 500 raw documents as the window; a 501st only sets truncated (even if invalid)", async () => {
    const docs = Array.from({ length: 500 }, (_, i) => rawDoc("team-1", `t${i}`));
    const { reader, listByTeam } = readerOf([...docs, { id: "junk", data: null }]);

    const listed = await getDefaultSkillNeedsStore(reader).listNeeds("team-1");

    expect(listByTeam).toHaveBeenCalledWith("team-1", SKILL_NEEDS_LIST_MAX + 1);
    expect(listed.needs).toHaveLength(500);
    expect(listed.truncated).toBe(true);
  });

  it("exactly 500 raw documents is not truncated", async () => {
    const { reader } = readerOf(Array.from({ length: 500 }, (_, i) => rawDoc("team-1", `t${i}`)));

    expect((await getDefaultSkillNeedsStore(reader).listNeeds("team-1")).truncated).toBe(false);
  });

  it("exposes no mutation method", () => {
    expect(Object.keys(getDefaultSkillNeedsStore(readerOf([]).reader))).toEqual(["listNeeds"]);
  });
});
