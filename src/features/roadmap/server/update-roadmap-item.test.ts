import { describe, expect, it, vi } from "vitest";
import { parseRoadmapItem } from "../domain/roadmap-item";
import {
  updateRoadmapItem,
  type PresentationState,
  type RoadmapPatch,
  type UpdateRoadmapItemDeps,
  type UpdateRoadmapStore,
  type UpdateRoadmapTx,
} from "./update-roadmap-item";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-15T10:00:00Z");
const T0 = new Date("2026-01-01T00:00:00Z");
const DONE_AT = new Date("2026-03-01T00:00:00Z");
const REF = (n: number) => `${String(n).padStart(2, "0")}bbbbbbbbbbbbbbbbbbbbbbbb`;
const DOC = "team-1__tree-1";

const TREE = {
  name: "Testing",
  nodes: [
    { nodeId: "node-0", label: "Basis", order: 0 },
    { nodeId: "node-1", label: "Middels", order: 1 },
    { nodeId: "node-2", label: "Avansert", order: 2 },
  ],
  createdAt: T0,
  createdBy: "admin-secret",
};

const progress = (current: string | null = "node-0") => ({
  teamId: "team-1",
  treeId: "tree-1",
  currentNodeId: current,
  updatedAt: T0,
  updatedBy: "admin-x",
});

const member = (uid: string, n: number, extra: Record<string, unknown> = {}) => ({
  uid,
  teamId: "team-1",
  createdAt: T0,
  grantedBy: "admin-secret",
  memberRef: REF(n),
  ...extra,
});

const plan = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  teamId: "team-1",
  treeId: "tree-1",
  targetNodeId: "node-2",
  priority: "medium",
  status: "planned",
  createdAt: T0,
  createdBy: "creator-1",
  updatedAt: T0,
  updatedBy: "creator-1",
  ...extra,
});

interface World {
  teams: Record<string, unknown>;
  memberships: Record<string, unknown>;
  progress: Record<string, unknown>;
  trees: Record<string, unknown>;
  roadmap: Record<string, unknown>;
  teamMembers: unknown[];
  failRead?: keyof UpdateRoadmapTx;
  failPresentation?: boolean;
}

function baseWorld(item: Record<string, unknown> | null = plan()): World {
  return {
    teams: { "team-1": "active" },
    memberships: { "user-1__team-1": member("user-1", 1) },
    progress: { "team-1__tree-1": progress() },
    trees: { "tree-1": TREE },
    roadmap: item === null ? {} : { [DOC]: item },
    teamMembers: [member("user-1", 1), member("user-2", 2)],
  };
}

type Write = { docId: string; patch: RoadmapPatch };

function build(world: World, uid = "user-1") {
  const writes: Write[] = [];
  const reads: string[] = [];

  const makeTx = (pending: Write[]): UpdateRoadmapTx => {
    const read = <T>(name: keyof UpdateRoadmapTx, value: () => T) => {
      reads.push(name);
      if (pending.length > 0) throw new Error("read after write");
      if (world.failRead === name) throw new Error("secret internal detail");
      return value();
    };
    return {
      getTeamStatus: async (teamId) => read("getTeamStatus", () => world.teams[teamId]),
      getMembership: async (u, teamId) => read("getMembership", () => world.memberships[`${u}__${teamId}`]),
      getRoadmapItem: async (id) => read("getRoadmapItem", () => world.roadmap[id]),
      getSkillProgress: async (id) => read("getSkillProgress", () => world.progress[id]),
      getSkillTree: async (id) => read("getSkillTree", () => world.trees[id]),
      listMemberships: async (_t, limit) => read("listMemberships", () => world.teamMembers.slice(0, limit)),
      update: (docId, patch) => {
        pending.push({ docId, patch });
      },
    };
  };

  const store: UpdateRoadmapStore = {
    async runTransaction(fn) {
      const pending: Write[] = [];
      const result = await fn(makeTx(pending));
      for (const w of pending) {
        // Real field-delete semantics: `remove` drops the key, `set` merges.
        const stored = { ...(world.roadmap[w.docId] as Record<string, unknown>), ...w.patch.set };
        for (const field of w.patch.remove) delete stored[field];
        world.roadmap[w.docId] = stored;
        writes.push(w);
      }
      return result;
    },
    async readPresentation(): Promise<PresentationState> {
      reads.push("readPresentation");
      if (world.failPresentation) throw new Error("secret presentation failure");
      return { progress: world.progress["team-1__tree-1"], tree: world.trees["tree-1"], memberships: world.teamMembers };
    },
  };
  const deps: UpdateRoadmapItemDeps = {
    verifyToken: vi.fn().mockResolvedValue({ uid, email: `${uid}@example.com`, email_verified: true }),
    store,
    now: () => NOW,
    profileReader: {
      async readBatch(uids) {
        return uids.map((u) => ({ uid: u, data: { displayName: `Navn ${u.length}`, createdAt: T0, updatedAt: T0 } }));
      },
    },
  };
  return { deps, writes, reads };
}

async function patch(world: World, body: unknown, uid = "user-1", treeId = "tree-1") {
  const ctx = build(world, uid);
  const result = await updateRoadmapItem("token", "team-1", treeId, body, ctx.deps);
  return { result, ...ctx };
}

const stored = (world: World) => world.roadmap[DOC] as Record<string, unknown>;

async function expectDenied(world: World, body: unknown, error: string, uid = "user-1") {
  const before = JSON.stringify(world.roadmap);
  const { result, writes } = await patch(world, body, uid);
  expect(result).toEqual({ ok: false, error });
  expect(writes).toEqual([]);
  expect(JSON.stringify(world.roadmap)).toBe(before);
}

describe("updateRoadmapItem — authorization", () => {
  it("lets an active ordinary member update", async () => {
    const world = baseWorld();
    const { result, writes } = await patch(world, { priority: "high" });
    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(stored(world).priority).toBe("high");
  });

  it("gives a lead the same rights", async () => {
    const world = baseWorld();
    world.memberships["user-1__team-1"] = member("user-1", 1, { role: "lead" });
    expect((await patch(world, { priority: "low" })).result.ok).toBe(true);
  });

  it("denies an admin without membership", async () => {
    const world = baseWorld();
    await expectDenied(world, { priority: "high" }, "forbidden", "admin-1");
  });

  it("allows an admin who is a genuine member", async () => {
    const world = baseWorld();
    world.memberships["admin-1__team-1"] = member("admin-1", 3);
    expect((await patch(world, { priority: "high" }, "admin-1")).result.ok).toBe(true);
  });

  it("denies a non-member", async () => {
    await expectDenied(baseWorld(), { priority: "high" }, "forbidden", "stranger");
  });

  it.each([
    ["uid mismatch", member("someone-else", 1)],
    ["team mismatch", member("user-1", 1, { teamId: "team-9" })],
    ["malformed", { nonsense: true }],
  ])("fails closed on a %s membership", async (_name, doc) => {
    const world = baseWorld();
    world.memberships["user-1__team-1"] = doc;
    await expectDenied(world, { priority: "high" }, "forbidden");
  });

  it.each(["disabled", "weird", undefined])("blocks every write on a %s team", async (status) => {
    for (const body of [
      { priority: "high" },
      { ownerRef: null },
      { archived: true },
      { archived: false },
      { status: "active" },
    ]) {
      const world = baseWorld();
      world.teams["team-1"] = status;
      await expectDenied(world, body, "team_disabled");
    }
  });

  it("maps unauthenticated tokens", async () => {
    const ctx = build(baseWorld());
    ctx.deps.verifyToken = vi.fn().mockRejectedValue(new Error("bad"));
    expect(await updateRoadmapItem("token", "team-1", "tree-1", { priority: "high" }, ctx.deps)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(ctx.writes).toEqual([]);
  });
});

describe("updateRoadmapItem — document integrity", () => {
  it("returns not_found for a missing plan", async () => {
    await expectDenied(baseWorld(null), { priority: "high" }, "not_found");
  });

  it.each([
    ["stored teamId mismatch", { teamId: "team-9" }],
    ["stored treeId mismatch", { treeId: "tree-9" }],
    ["corrupt priority", { priority: "urgent" }],
    ["completed without completedAt", { status: "completed" }],
    ["literal completedAt null", { completedAt: null }],
  ])("fails closed on %s", async (_name, extra) => {
    await expectDenied(baseWorld(plan(extra)), { priority: "high" }, "not_found");
  });

  it("rejects a treeId that would be a sub-path", async () => {
    const world = baseWorld();
    const { result, writes } = await patch(world, { priority: "high" }, "user-1", "a/b");
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(writes).toEqual([]);
  });

  it("does not touch the item for another tree", async () => {
    const world = baseWorld();
    const { result } = await patch(world, { priority: "high" }, "user-1", "tree-2");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("updateRoadmapItem — request contract", () => {
  it.each([
    [undefined],
    [null],
    [[]],
    ["x"],
    [{}],
    [{ teamId: "team-9" }],
    [{ treeId: "tree-2" }],
    [{ createdAt: "x" }],
    [{ createdBy: "x" }],
    [{ updatedAt: "x" }],
    [{ updatedBy: "x" }],
    [{ completedAt: "x" }],
    [{ archivedAt: "x" }],
    [{ archivedBy: "x" }],
    [{ areaName: "x" }],
    [{ overdue: true }],
    [{ targetReached: true }],
    [{ owner: { uid: "user-2" } }],
    [{ archived: true, priority: "high" }],
  ])("rejects %j as invalid_request without reading", async (body) => {
    const world = baseWorld();
    const { result, reads, writes } = await patch(world, body);
    expect(result).toEqual({ ok: false, error: "invalid_request" });
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });

  it.each([
    [{ priority: "urgent" }],
    [{ priority: null }],
    [{ status: "archived" }],
    [{ status: null }],
    [{ targetNodeId: "" }],
    [{ targetNodeId: null }],
    [{ startDate: "2026-02-30" }],
    [{ startDate: "2019-01-01" }],
    [{ targetDate: "2101-01-01" }],
    [{ targetDate: "15.06.2026" }],
    [{ archived: "true" }],
    [{ archived: null }],
  ])("rejects %j as invalid_input", async (body) => {
    await expectDenied(baseWorld(), body, "invalid_input");
  });
});

describe("updateRoadmapItem — fields", () => {
  it.each(["high", "medium", "low"])("updates priority to %s", async (priority) => {
    const world = baseWorld();
    await patch(world, { priority });
    expect(stored(world).priority).toBe(priority);
  });

  it("updates only supplied fields and preserves creation audit", async () => {
    const world = baseWorld(plan({ startDate: "2026-07-01", ownerRef: REF(2) }));
    const { writes } = await patch(world, { priority: "low" });
    expect(Object.keys(writes[0].patch.set).sort()).toEqual(["priority", "updatedAt", "updatedBy"]);
    expect(writes[0].patch.remove).toEqual([]);
    expect(stored(world)).toMatchObject({
      createdAt: T0,
      createdBy: "creator-1",
      updatedAt: NOW,
      updatedBy: "user-1",
      startDate: "2026-07-01",
      ownerRef: REF(2),
    });
  });

  it("sets and clears dates", async () => {
    const world = baseWorld();
    await patch(world, { startDate: "2026-07-01", targetDate: "2026-09-01" });
    expect(stored(world)).toMatchObject({ startDate: "2026-07-01", targetDate: "2026-09-01" });
    await patch(world, { startDate: null });
    expect("startDate" in stored(world)).toBe(false);
    expect(stored(world).targetDate).toBe("2026-09-01");
    await patch(world, { targetDate: null });
    expect("targetDate" in stored(world)).toBe(false);
    expect(parseRoadmapItem(stored(world))).not.toBeNull();
  });

  it("validates the merged date state, not only supplied fields", async () => {
    const world = baseWorld(plan({ startDate: "2026-07-01", targetDate: "2026-09-01" }));
    await expectDenied(world, { targetDate: "2026-06-01" }, "invalid_input");
    await expectDenied(world, { startDate: "2026-10-01" }, "invalid_input");
    const ok = await patch(world, { startDate: "2026-09-01" });
    expect(ok.result.ok).toBe(true);
    const cleared = await patch(world, { startDate: null, targetDate: "2026-06-01" });
    expect(cleared.result.ok).toBe(true);
  });
});

describe("updateRoadmapItem — owner", () => {
  it("assigns a valid owner, persisting only ownerRef", async () => {
    const world = baseWorld();
    const { result, writes, reads } = await patch(world, { ownerRef: REF(2) });
    expect(result.ok).toBe(true);
    expect(reads).toContain("listMemberships");
    expect(writes[0].patch.set.ownerRef).toBe(REF(2));
    expect(JSON.stringify(stored(world))).not.toMatch(/user-2|@example|Navn/);
    expect(Object.keys(stored(world)).sort()).toEqual(
      ["createdAt", "createdBy", "ownerRef", "priority", "status", "targetNodeId", "teamId", "treeId", "updatedAt", "updatedBy"].sort(),
    );
  });

  it.each([
    ["unknown", REF(9)],
    ["malformed", "not-a-ref"],
    ["non-string", 42],
    ["empty", ""],
  ])("rejects a %s owner", async (_n, ownerRef) => {
    await expectDenied(baseWorld(), { ownerRef }, "invalid_owner");
  });

  it("rejects a stale owner whose membership was removed", async () => {
    const world = baseWorld();
    world.teamMembers = [member("user-1", 1)];
    await expectDenied(world, { ownerRef: REF(2) }, "invalid_owner");
  });

  it("rejects an other-team ref and a duplicate ref", async () => {
    const other = baseWorld();
    other.teamMembers = [member("user-1", 1), member("user-2", 2, { teamId: "team-9" })];
    await expectDenied(other, { ownerRef: REF(2) }, "invalid_owner");

    const dup = baseWorld();
    dup.teamMembers = [member("user-1", 1), member("user-2", 2), member("user-3", 2)];
    await expectDenied(dup, { ownerRef: REF(2) }, "invalid_owner");
  });

  it("does not re-validate an unchanged (possibly unavailable) owner", async () => {
    const world = baseWorld(plan({ ownerRef: REF(7) }));
    world.teamMembers = [member("user-1", 1)];
    const { result, reads } = await patch(world, { ownerRef: REF(7), priority: "high" });
    expect(result.ok).toBe(true);
    expect(reads).not.toContain("listMemberships");
    expect(stored(world).ownerRef).toBe(REF(7));
  });

  it("clears an owner without reading memberships, even when unavailable", async () => {
    const world = baseWorld(plan({ ownerRef: REF(7) }));
    const { result, reads } = await patch(world, { ownerRef: null });
    expect(result.ok).toBe(true);
    expect(reads).not.toContain("listMemberships");
    expect("ownerRef" in stored(world)).toBe(false);
    if (result.ok) expect(result.item.owner).toBeNull();
  });

  it("does not materialize memberRefs or write memberships", async () => {
    const world = baseWorld();
    const snapshot = JSON.stringify([world.memberships, world.teamMembers, world.progress, world.teams]);
    await patch(world, { ownerRef: REF(2) });
    expect(JSON.stringify([world.memberships, world.teamMembers, world.progress, world.teams])).toBe(snapshot);
  });
});

describe("updateRoadmapItem — status and completedAt", () => {
  it.each(["planned", "active"])("%s -> completed creates completedAt at transition time", async (from) => {
    const world = baseWorld(plan({ status: from }));
    await patch(world, { status: "completed" });
    expect(stored(world).completedAt).toEqual(NOW);
    expect(stored(world).status).toBe("completed");
  });

  it("completed -> completed preserves the existing completedAt", async () => {
    const world = baseWorld(plan({ status: "completed", completedAt: DONE_AT }));
    const { writes } = await patch(world, { status: "completed" });
    expect(stored(world).completedAt).toEqual(DONE_AT);
    expect("completedAt" in writes[0].patch.set).toBe(false);
    expect(writes[0].patch.remove).toEqual([]);
  });

  it.each(["active", "planned"])("completed -> %s DELETES the completedAt field", async (to) => {
    const world = baseWorld(plan({ status: "completed", completedAt: DONE_AT }));
    const { writes } = await patch(world, { status: to });
    expect(writes[0].patch.remove).toContain("completedAt");
    expect(writes[0].patch.set).not.toHaveProperty("completedAt");
    expect("completedAt" in stored(world)).toBe(false);
    expect(Object.values(stored(world))).not.toContain(null);
    expect(parseRoadmapItem(stored(world))?.status).toBe(to);
  });

  it("never introduces completedAt on a non-completed edit", async () => {
    const world = baseWorld();
    await patch(world, { status: "active" });
    await patch(world, { status: "planned" });
    await patch(world, { priority: "high" });
    expect("completedAt" in stored(world)).toBe(false);
  });

  it("does not write completedAt on edits that do not change status", async () => {
    const world = baseWorld(plan({ status: "completed", completedAt: DONE_AT }));
    await patch(world, { priority: "low" });
    expect(stored(world).completedAt).toEqual(DONE_AT);
  });

  it("does not write progress, and reaching the target does not complete", async () => {
    const world = baseWorld(plan({ status: "active" }));
    world.progress["team-1__tree-1"] = progress("node-2");
    const before = JSON.stringify(world.progress);
    await patch(world, { priority: "high" });
    expect(stored(world).status).toBe("active");
    expect(JSON.stringify(world.progress)).toBe(before);
  });
});

describe("updateRoadmapItem — retarget and untracked rules (D13)", () => {
  it("retargets a tracked plan strictly ahead of the current stage", async () => {
    const world = baseWorld(plan({ targetNodeId: "node-1" }));
    const { result, reads } = await patch(world, { targetNodeId: "node-2" });
    expect(result.ok).toBe(true);
    expect(reads).toEqual(expect.arrayContaining(["getSkillProgress", "getSkillTree"]));
    expect(stored(world).targetNodeId).toBe("node-2");
  });

  it.each([
    ["equal to current", "node-1", "target_not_ahead"],
    ["behind current", "node-0", "target_not_ahead"],
    ["unknown/stale", "node-gone", "invalid_input"],
    ["from another tree", "node-3", "invalid_input"],
  ])("rejects a target %s", async (_n, targetNodeId, error) => {
    const world = baseWorld(plan({ targetNodeId: "node-2" }));
    world.progress["team-1__tree-1"] = progress("node-1");
    await expectDenied(world, { targetNodeId }, error);
  });

  it("rejects a missing tree and invalid progress", async () => {
    const noTree = baseWorld(plan({ targetNodeId: "node-1" }));
    delete noTree.trees["tree-1"];
    await expectDenied(noTree, { targetNodeId: "node-2" }, "tree_not_found");

    const badProgress = baseWorld(plan({ targetNodeId: "node-1" }));
    badProgress.progress["team-1__tree-1"] = { ...progress(), teamId: "team-9" };
    await expectDenied(badProgress, { targetNodeId: "node-2" }, "not_tracked");
  });

  describe("while untracked", () => {
    const untracked = () => {
      const world = baseWorld(plan({ targetNodeId: "node-1", ownerRef: REF(2) }));
      world.progress = {};
      return world;
    };

    it("rejects an actual target change with not_tracked", async () => {
      await expectDenied(untracked(), { targetNodeId: "node-2" }, "not_tracked");
    });

    it("accepts an unchanged target without reading tracking", async () => {
      const world = untracked();
      const { result, reads } = await patch(world, { targetNodeId: "node-1", priority: "high" });
      expect(result.ok).toBe(true);
      expect(reads).not.toContain("getSkillProgress");
      expect(reads).not.toContain("getSkillTree");
    });

    it("keeps priority, status, dates, owner, archive and restore editable", async () => {
      const world = untracked();
      for (const body of [
        { priority: "low" },
        { status: "active" },
        { status: "completed" },
        { startDate: "2026-07-01", targetDate: "2026-08-01" },
        { startDate: null },
        { ownerRef: REF(1) },
        { ownerRef: null },
        { archived: true },
        { archived: false },
      ]) {
        const { result } = await patch(world, body);
        expect(result.ok, JSON.stringify(body)).toBe(true);
      }
      expect(stored(world).targetNodeId).toBe("node-1");
      const view = await patch(world, { priority: "medium" });
      expect(view.result.ok && view.result.item.tracking).toEqual({ state: "not_tracked" });
    });
  });
});

describe("updateRoadmapItem — archive and restore", () => {
  it("archives, retaining status and slot, with server-owned metadata", async () => {
    const world = baseWorld(plan({ status: "active" }));
    const { result, writes } = await patch(world, { archived: true });
    expect(result.ok && result.item.archived).toBe(true);
    expect(stored(world)).toMatchObject({ status: "active", archivedAt: NOW, archivedBy: "user-1", updatedAt: NOW, updatedBy: "user-1" });
    expect(writes[0].docId).toBe(DOC);
    expect(Object.keys(world.roadmap)).toEqual([DOC]);
  });

  it("restores by deleting archive metadata and keeping status", async () => {
    const world = baseWorld(plan({ status: "completed", completedAt: DONE_AT, archivedAt: T0, archivedBy: "x" }));
    const { result, writes } = await patch(world, { archived: false });
    expect(result.ok && result.item.archived).toBe(false);
    expect(writes[0].patch.remove).toEqual(["archivedAt", "archivedBy"]);
    expect("archivedAt" in stored(world)).toBe(false);
    expect("archivedBy" in stored(world)).toBe(false);
    expect(Object.values(stored(world))).not.toContain(null);
    expect(stored(world)).toMatchObject({ status: "completed", completedAt: DONE_AT });
    expect(Object.keys(world.roadmap)).toEqual([DOC]);
  });

  it("makes repeated archive and restore successful no-ops without a write", async () => {
    const archived = baseWorld(plan({ archivedAt: T0, archivedBy: "x" }));
    const a = await patch(archived, { archived: true });
    expect(a.result.ok).toBe(true);
    expect(a.writes).toEqual([]);
    expect(stored(archived).updatedAt).toEqual(T0);

    const active = baseWorld();
    const b = await patch(active, { archived: false });
    expect(b.result.ok).toBe(true);
    expect(b.writes).toEqual([]);
    expect(stored(active).updatedAt).toEqual(T0);
  });

  it.each([
    [{ priority: "high" }],
    [{ status: "active" }],
    [{ targetNodeId: "node-1" }],
    [{ startDate: "2026-07-01" }],
    [{ ownerRef: null }],
  ])("accepts only restore on an archived plan: %j => archived", async (body) => {
    await expectDenied(baseWorld(plan({ archivedAt: T0, archivedBy: "x" })), body, "archived");
  });

  it("still reports invalid_request/input before archived", async () => {
    const world = baseWorld(plan({ archivedAt: T0, archivedBy: "x" }));
    await expectDenied(world, { priority: "bad" }, "invalid_input");
  });
});

describe("updateRoadmapItem — response and reliability", () => {
  it("returns the exact view keys with no identity or audit fields", async () => {
    const world = baseWorld(plan({ ownerRef: REF(2), startDate: "2026-07-01" }));
    const { result } = await patch(world, { priority: "high" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.item).sort()).toEqual(
      [
        "archived",
        "areaName",
        "createdAt",
        "overdue",
        "owner",
        "priority",
        "startDate",
        "status",
        "targetAvailable",
        "targetDate",
        "targetLabel",
        "targetNodeId",
        "targetReached",
        "tracking",
        "treeId",
        "updatedAt",
      ].sort(),
    );
    expect(result.item).toMatchObject({ areaName: "Testing", targetLabel: "Avansert", tracking: { state: "tracked", currentNodeId: "node-0" } });
    expect(result.item.owner).toMatchObject({ state: "current", memberRef: REF(2) });
    expect(JSON.stringify(result)).not.toMatch(/user-2|creator-1|admin-secret|@example|createdBy|updatedBy|archivedBy/);
  });

  it("builds the response from the transaction snapshot when retargeting", async () => {
    const world = baseWorld(plan({ targetNodeId: "node-1" }));
    const { result, reads } = await patch(world, { targetNodeId: "node-2" });
    expect(result.ok && result.item.targetLabel).toBe("Avansert");
    expect(reads).not.toContain("readPresentation");
  });

  it("does not turn a committed write into persistence_failed when presentation reads fail", async () => {
    const world = baseWorld(plan({ ownerRef: REF(2) }));
    world.failPresentation = true;
    const { result } = await patch(world, { priority: "high" });
    expect(result.ok).toBe(true);
    expect(stored(world).priority).toBe("high");
    if (result.ok) expect(result.item.owner).toEqual({ state: "unavailable" });
  });

  it("degrades to unavailable owner when display names fail", async () => {
    const world = baseWorld();
    const ctx = build(world);
    ctx.deps.profileReader = {
      async readBatch() {
        throw new Error("profiles down");
      },
    };
    const result = await updateRoadmapItem("token", "team-1", "tree-1", { ownerRef: REF(2) }, ctx.deps);
    expect(result.ok && result.item.owner).toEqual({ state: "unavailable" });
    expect(stored(world).ownerRef).toBe(REF(2));
  });

  it("maps a transaction read failure to persistence_failed without a write or leak", async () => {
    for (const name of ["getMembership", "getTeamStatus", "getRoadmapItem"] as const) {
      const world = baseWorld();
      world.failRead = name;
      const { result, writes } = await patch(world, { priority: "high" });
      expect(result).toEqual({ ok: false, error: "persistence_failed" });
      expect(writes).toEqual([]);
    }
    const world = baseWorld(plan({ targetNodeId: "node-1" }));
    world.failRead = "getSkillTree";
    expect((await patch(world, { targetNodeId: "node-2" })).result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reads everything before its single write and writes nothing on validation failure", async () => {
    const world = baseWorld();
    const { writes } = await patch(world, { ownerRef: REF(2), priority: "high" });
    expect(writes).toHaveLength(1);
    await expectDenied(baseWorld(), { priority: "high", ownerRef: REF(9) }, "invalid_owner");
  });
});
