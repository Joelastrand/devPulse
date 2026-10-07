import { describe, expect, it, vi } from "vitest";
import { skillNeedDocId, SKILL_NEED_PERSISTED_KEYS } from "../domain/skill-need";
import { deleteSkillNeed } from "./delete-skill-need";
import type { SkillNeedWriteStore, SkillNeedWriteTx } from "./skill-needs-store";
import { upsertSkillNeed } from "./upsert-skill-need";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const TEAM = "team-1";
const TREE = "tree-1";
const DOC = skillNeedDocId(TEAM, TREE);
const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-06-15T10:00:00Z");
const ADMIN_EMAIL = "admin@example.com";

type Caller = "lead" | "leadAdmin" | "member" | "memberAdmin" | "nonMemberAdmin" | "unrelated" | "otherTeamLead";

const CALLERS: Record<Caller, { uid: string; email: string; membership?: Record<string, unknown>; teamId?: string }> = {
  lead: { uid: "u-lead", email: "lead@example.com", membership: { role: "lead" } },
  leadAdmin: { uid: "u-ladmin", email: ADMIN_EMAIL, membership: { role: "lead" } },
  member: { uid: "u-member", email: "member@example.com", membership: { role: "member" } },
  memberAdmin: { uid: "u-madmin", email: ADMIN_EMAIL, membership: {} },
  nonMemberAdmin: { uid: "u-nadmin", email: ADMIN_EMAIL },
  unrelated: { uid: "u-other", email: "other@example.com" },
  otherTeamLead: { uid: "u-olead", email: "olead@example.com", membership: { role: "lead" }, teamId: "team-2" },
};

const tree = (name = "Testing") => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: T0,
  createdBy: "admin",
});

const storedNeed = (overrides: Record<string, unknown> = {}) => ({
  teamId: TEAM,
  treeId: TREE,
  requiredLevel: 2,
  requiredCoverage: 1,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

interface World {
  caller: Caller | "signedOut";
  teamStatus?: unknown;
  trees?: Record<string, unknown>;
  needs?: Record<string, unknown>;
  failRead?: "team" | "membership" | "tree" | "need";
  failCommit?: boolean;
}

function setup(w: World) {
  const needs: Record<string, unknown> = { ...(w.needs ?? {}) };
  const caller = w.caller === "signedOut" ? undefined : CALLERS[w.caller];
  const teamStatus = "teamStatus" in w ? w.teamStatus : "active";
  const trees = w.trees ?? { [TREE]: tree() };
  const commits: Array<{ op: "put" | "delete"; docId: string }> = [];
  let queue: Promise<unknown> = Promise.resolve();

  const store: SkillNeedWriteStore = {
    runTransaction(fn) {
      // Serialised like Firestore's retried transactions: each decides on the committed state.
      const run = queue.then(async () => {
        const pending: Array<() => void> = [];
        const read = <T,>(failKey: World["failRead"], value: () => T): T => {
          if (pending.length > 0) throw new Error("read after write");
          if (w.failRead === failKey) throw new Error("secret detail");
          return value();
        };
        const tx: SkillNeedWriteTx = {
          reads: {
            getTeamStatus: async () => read("team", () => teamStatus),
            getMembership: async (uid, teamId) =>
              read("membership", () => {
                const entry = Object.values(CALLERS).find((c) => c.uid === uid);
                return entry?.membership ? { uid, teamId: entry.teamId ?? teamId, ...entry.membership } : undefined;
              }),
          },
          getSkillTree: async (id) => read("tree", () => trees[id]),
          getNeed: async (id) => read("need", () => needs[id]),
          putNeed: (id, record) => {
            pending.push(() => {
              needs[id] = record;
              commits.push({ op: "put", docId: id });
            });
          },
          deleteNeed: (id) => {
            pending.push(() => {
              delete needs[id];
              commits.push({ op: "delete", docId: id });
            });
          },
        };
        const result = await fn(tx);
        if (w.failCommit && pending.length > 0) throw new Error("commit failed");
        for (const apply of pending) apply();
        return result;
      });
      queue = run.catch(() => undefined);
      return run as never;
    },
  };

  const verifyToken = vi.fn(async () => {
    if (!caller) throw new Error("bad token");
    return { uid: caller.uid, email: caller.email, email_verified: true } as never;
  });
  return { needs, commits, deps: { verifyToken, store, now: () => NOW } };
}

const BODY = { requiredLevel: 3, requiredCoverage: 4 };
const put = (w: World, ...args: [body?: unknown, treeId?: string]) => {
  // Explicit `undefined` must stay `undefined` (the route's unparsable-JSON case).
  const body = args.length > 0 ? args[0] : BODY;
  const treeId = args[1] ?? TREE;
  const s = setup(w);
  return upsertSkillNeed("token", TEAM, treeId, body, s.deps).then((result) => ({ result, ...s }));
};
const del = (w: World, treeId = TREE) => {
  const s = setup(w);
  return deleteSkillNeed("token", TEAM, treeId, s.deps).then((result) => ({ result, ...s }));
};

describe("need write authorization", () => {
  it.each(["lead", "leadAdmin"] as const)("%s (genuine lead) may create a need", async (caller) => {
    const { result, needs } = await put({ caller });
    expect(result).toEqual({
      ok: true,
      need: { treeId: TREE, areaName: "Testing", areaAvailable: true, requiredLevel: 3, requiredCoverage: 4 },
    });
    expect(needs[DOC]).toEqual({ ...storedNeed(), requiredLevel: 3, requiredCoverage: 4, createdAt: NOW, updatedAt: NOW });
  });

  it.each(["member", "memberAdmin", "nonMemberAdmin", "unrelated", "otherTeamLead"] as const)(
    "%s is forbidden to put and delete and nothing is written",
    async (caller) => {
      const existing = { [DOC]: storedNeed() };
      const p = await put({ caller, needs: existing });
      const d = await del({ caller, needs: existing });
      expect(p.result).toEqual({ ok: false, error: "forbidden" });
      expect(d.result).toEqual({ ok: false, error: "forbidden" });
      expect(p.commits).toEqual([]);
      expect(d.commits).toEqual([]);
    },
  );

  it("signed-out callers get unauthenticated and the store is never opened", async () => {
    const s = setup({ caller: "signedOut" });
    const runTransaction = vi.spyOn(s.deps.store, "runTransaction");
    expect(await upsertSkillNeed("token", TEAM, TREE, BODY, s.deps)).toEqual({ ok: false, error: "unauthenticated" });
    expect(await deleteSkillNeed("token", TEAM, TREE, s.deps)).toEqual({ ok: false, error: "unauthenticated" });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("a disabled-team lead gets team_disabled, an ordinary member gets forbidden (role before status)", async () => {
    expect((await put({ caller: "lead", teamStatus: "disabled" })).result).toEqual({ ok: false, error: "team_disabled" });
    expect((await del({ caller: "lead", teamStatus: "disabled" })).result).toEqual({ ok: false, error: "team_disabled" });
    expect((await put({ caller: "member", teamStatus: "disabled" })).result).toEqual({ ok: false, error: "forbidden" });
    expect((await put({ caller: "nonMemberAdmin", teamStatus: "disabled" })).result).toEqual({ ok: false, error: "forbidden" });
  });

  it("a missing or invalid team fails closed as forbidden", async () => {
    expect((await put({ caller: "lead", teamStatus: undefined })).result).toEqual({ ok: false, error: "forbidden" });
    expect((await put({ caller: "lead", teamStatus: "bogus" })).result).toEqual({ ok: false, error: "forbidden" });
    expect((await del({ caller: "lead", teamStatus: undefined })).result).toEqual({ ok: false, error: "forbidden" });
  });

  it("authorization precedes input and tree checks", async () => {
    expect((await put({ caller: "member" }, { nonsense: true })).result).toEqual({ ok: false, error: "forbidden" });
    expect((await put({ caller: "member", trees: {} })).result).toEqual({ ok: false, error: "forbidden" });
    expect((await put({ caller: "lead", teamStatus: "disabled" }, undefined)).result).toEqual({
      ok: false,
      error: "team_disabled",
    });
  });
});

describe("need put input and tree validation", () => {
  it.each([
    ["level 1", { requiredLevel: 1, requiredCoverage: 2 }, "invalid_input"],
    ["level 5", { requiredLevel: 5, requiredCoverage: 2 }, "invalid_input"],
    ["level string", { requiredLevel: "3", requiredCoverage: 2 }, "invalid_input"],
    ["level fractional", { requiredLevel: 2.5, requiredCoverage: 2 }, "invalid_input"],
    ["coverage 0", { requiredLevel: 3, requiredCoverage: 0 }, "invalid_input"],
    ["coverage 21", { requiredLevel: 3, requiredCoverage: 21 }, "invalid_input"],
    ["coverage fractional", { requiredLevel: 3, requiredCoverage: 2.5 }, "invalid_input"],
    ["extra key", { requiredLevel: 3, requiredCoverage: 2, teamId: "team-9" }, "invalid_request"],
    ["missing key", { requiredLevel: 3 }, "invalid_request"],
    ["array body", [], "invalid_request"],
    ["null body", null, "invalid_request"],
    ["unparsable body", undefined, "invalid_request"],
  ])("rejects %s without writing", async (_name, body, error) => {
    const { result, commits } = await put({ caller: "lead" }, body);
    expect(result).toEqual({ ok: false, error });
    expect(commits).toEqual([]);
  });

  it.each([
    [2, 1],
    [4, 20],
  ])("accepts the boundary level %i / coverage %i", async (requiredLevel, requiredCoverage) => {
    expect((await put({ caller: "lead" }, { requiredLevel, requiredCoverage })).result.ok).toBe(true);
  });

  it("accepts a requirement larger than any current cohort (no team-size dependency)", async () => {
    expect((await put({ caller: "lead" }, { requiredLevel: 3, requiredCoverage: 20 })).result.ok).toBe(true);
  });

  it.each([
    ["missing tree", {}],
    ["malformed tree", { [TREE]: { name: 42 } }],
  ])("a %s is skill_unavailable and writes nothing", async (_name, trees) => {
    const { result, commits } = await put({ caller: "lead", trees });
    expect(result).toEqual({ ok: false, error: "skill_unavailable" });
    expect(commits).toEqual([]);
  });

  it("a malformed treeId is skill_unavailable for put and a silent success for delete", async () => {
    expect((await put({ caller: "lead" }, BODY, "a/b")).result).toEqual({ ok: false, error: "skill_unavailable" });
    expect((await del({ caller: "lead" }, "a/b")).result).toEqual({ ok: true });
  });

  it("validates the tree by direct lookup, independent of any catalog window", async () => {
    const far = "tree-far-outside-window";
    const { result, needs } = await put({ caller: "lead", trees: { [far]: tree("Far") } }, BODY, far);
    expect(result.ok).toBe(true);
    expect(needs[skillNeedDocId(TEAM, far)]).toBeDefined();
  });
});

describe("need put create/replace semantics", () => {
  it("creates exactly the six approved keys with server time and no actor", async () => {
    const { needs } = await put({ caller: "lead" });
    const stored = needs[DOC] as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(Object.keys(SKILL_NEED_PERSISTED_KEYS).sort());
    expect(stored.createdAt).toEqual(NOW);
    expect(stored.updatedAt).toEqual(NOW);
  });

  it("replace keeps createdAt, changes only the mutable values and refreshes updatedAt", async () => {
    const { needs, commits } = await put({ caller: "lead", needs: { [DOC]: storedNeed() } });
    expect(needs[DOC]).toEqual({ ...storedNeed(), requiredLevel: 3, requiredCoverage: 4, updatedAt: NOW });
    expect(commits).toEqual([{ op: "put", docId: DOC }]);
  });

  it("repeated writes use the same deterministic slot", async () => {
    const { needs, commits } = await put({ caller: "lead" });
    const second = await upsertSkillNeed("token", TEAM, TREE, { requiredLevel: 4, requiredCoverage: 2 }, {
      ...setup({ caller: "lead", needs }).deps,
    });
    expect(second.ok).toBe(true);
    expect(commits.map((c) => c.docId)).toEqual([DOC]);
    expect(Object.keys(needs)).toEqual([DOC]);
  });

  it.each([
    ["wrong shape", { teamId: TEAM, treeId: TREE, requiredLevel: 9 }],
    ["extra key", storedNeed({ createdBy: "someone" })],
    ["foreign identity", storedNeed({ teamId: "team-9" })],
    ["bad timestamp", storedNeed({ createdAt: "yesterday" })],
  ])("a corrupt existing document (%s) is replaced wholesale with a fresh createdAt", async (_name, corrupt) => {
    const { needs } = await put({ caller: "lead", needs: { [DOC]: corrupt } });
    expect(needs[DOC]).toEqual({ ...storedNeed(), requiredLevel: 3, requiredCoverage: 4, createdAt: NOW, updatedAt: NOW });
  });

  it("concurrent puts leave one valid document, last write wins, createdAt stable", async () => {
    const s = setup({ caller: "lead", needs: { [DOC]: storedNeed() } });
    await Promise.all([
      upsertSkillNeed("t", TEAM, TREE, { requiredLevel: 3, requiredCoverage: 3 }, s.deps),
      upsertSkillNeed("t", TEAM, TREE, { requiredLevel: 4, requiredCoverage: 5 }, s.deps),
    ]);
    expect(Object.keys(s.needs)).toEqual([DOC]);
    expect(s.needs[DOC]).toEqual({ ...storedNeed(), requiredLevel: 4, requiredCoverage: 5, updatedAt: NOW });
  });

  it("a team without a lead cannot write (no admin bypass)", async () => {
    expect((await put({ caller: "nonMemberAdmin" })).result).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("need delete semantics", () => {
  it("hard-deletes the slot, leaving no tombstone", async () => {
    const { result, needs, commits } = await del({ caller: "lead", needs: { [DOC]: storedNeed() } });
    expect(result).toEqual({ ok: true });
    expect(needs).toEqual({});
    expect(commits).toEqual([{ op: "delete", docId: DOC }]);
  });

  it("is idempotent: an absent slot succeeds without a write", async () => {
    const { result, commits } = await del({ caller: "lead" });
    expect(result).toEqual({ ok: true });
    expect(commits).toEqual([]);
  });

  it("deletes for a stale area (no valid tree needed) and for a corrupt document", async () => {
    const stale = await del({ caller: "lead", trees: {}, needs: { [DOC]: storedNeed() } });
    expect(stale.needs).toEqual({});
    const corrupt = await del({ caller: "leadAdmin", needs: { [DOC]: { junk: true } } });
    expect(corrupt.needs).toEqual({});
  });

  it("only touches the addressed team and tree slot", async () => {
    const other = skillNeedDocId(TEAM, "tree-2");
    const { needs } = await del({ caller: "lead", needs: { [DOC]: storedNeed(), [other]: storedNeed({ treeId: "tree-2" }) } });
    expect(Object.keys(needs)).toEqual([other]);
  });
});

describe("failures", () => {
  it.each(["team", "membership", "tree", "need"] as const)("a failed %s read is persistence_failed, nothing written", async (failRead) => {
    const p = await put({ caller: "lead", failRead });
    expect(p.result).toEqual({ ok: false, error: "persistence_failed" });
    expect(p.commits).toEqual([]);
    expect(JSON.stringify(p.result)).not.toContain("secret");
  });

  it("a failed commit is persistence_failed and nothing is partially written", async () => {
    const p = await put({ caller: "lead", failCommit: true });
    expect(p.result).toEqual({ ok: false, error: "persistence_failed" });
    expect(p.needs).toEqual({});
    const d = await del({ caller: "lead", failCommit: true, needs: { [DOC]: storedNeed() } });
    expect(d.result).toEqual({ ok: false, error: "persistence_failed" });
    expect(Object.keys(d.needs)).toEqual([DOC]);
  });

  it("a failed membership read on delete is persistence_failed, never forbidden", async () => {
    expect((await del({ caller: "lead", failRead: "membership" })).result).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });
});
