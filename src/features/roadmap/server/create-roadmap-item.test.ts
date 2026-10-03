import { describe, expect, it, vi } from "vitest";
import {
  createRoadmapItem,
  type CreateRoadmapItemDeps,
  type CreateRoadmapStore,
  type CreateRoadmapTx,
} from "./create-roadmap-item";

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
const REF = (n: number) => `${String(n).padStart(2, "0")}bbbbbbbbbbbbbbbbbbbbbbbb`;

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

const progress = (treeId = "tree-1", current: string | null = "node-0", extra: Record<string, unknown> = {}) => ({
  teamId: "team-1",
  treeId,
  currentNodeId: current,
  updatedAt: T0,
  updatedBy: "admin-x",
  ...extra,
});

const member = (uid: string, n: number, extra: Record<string, unknown> = {}) => ({
  uid,
  teamId: "team-1",
  createdAt: T0,
  grantedBy: "admin-secret",
  memberRef: REF(n),
  ...extra,
});

interface World {
  teams: Record<string, unknown>;
  memberships: Record<string, unknown>;
  progress: Record<string, unknown>;
  trees: Record<string, unknown>;
  roadmap: Record<string, unknown>;
  teamMembers: unknown[];
  failRead?: keyof CreateRoadmapTx;
}

function baseWorld(): World {
  return {
    teams: { "team-1": "active" },
    memberships: { "user-1__team-1": member("user-1", 1) },
    progress: { "team-1__tree-1": progress() },
    trees: { "tree-1": TREE, "tree-2": { ...TREE, name: "Other", nodes: [...TREE.nodes, { nodeId: "node-3", label: "Kun annen", order: 3 }] } },
    roadmap: {},
    teamMembers: [member("user-1", 1), member("user-2", 2)],
  };
}

const valid = { treeId: "tree-1", targetNodeId: "node-2" };

type Write = { docId: string; data: Record<string, unknown> };

function build(world: World, uid = "user-1", email = `${uid}@example.com`) {
  const writes: Write[] = [];
  const reads: string[] = [];
  let membershipQueries = 0;

  const makeTx = (pending: Write[]): CreateRoadmapTx => {
    const read = <T>(name: keyof CreateRoadmapTx, value: () => T) => {
      reads.push(name);
      if (pending.length > 0) throw new Error("read after write");
      if (world.failRead === name) throw new Error("secret internal detail");
      return value();
    };
    return {
      getTeamStatus: async (teamId) => read("getTeamStatus", () => world.teams[teamId]),
      getMembership: async (u, teamId) => read("getMembership", () => world.memberships[`${u}__${teamId}`]),
      getSkillProgress: async (id) => read("getSkillProgress", () => world.progress[id]),
      getSkillTree: async (id) => read("getSkillTree", () => world.trees[id]),
      getRoadmapItem: async (id) => read("getRoadmapItem", () => world.roadmap[id]),
      listMemberships: async (_t, limit) =>
        read("listMemberships", () => {
          membershipQueries += 1;
          return world.teamMembers.slice(0, limit);
        }),
      create: (docId, data) => {
        pending.push({ docId, data });
      },
    };
  };

  const store: CreateRoadmapStore = {
    async runTransaction(fn) {
      // Optimistic-concurrency fake: a commit that finds its slot taken re-runs the callback.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const pending: Write[] = [];
        const result = await fn(makeTx(pending));
        await Promise.resolve();
        if (pending.some((w) => w.docId in world.roadmap)) continue;
        for (const w of pending) {
          world.roadmap[w.docId] = w.data;
          writes.push(w);
        }
        return result;
      }
      throw new Error("aborted");
    },
  };
  const deps: CreateRoadmapItemDeps = {
    verifyToken: vi.fn().mockResolvedValue({ uid, email, email_verified: true }),
    store,
    now: () => NOW,
    profileReader: {
      async readBatch(uids) {
        return uids.map((u) => ({ uid: u, data: { displayName: `Navn ${u.length}`, createdAt: T0, updatedAt: T0 } }));
      },
    },
  };
  return { deps, writes, reads, membershipQueries: () => membershipQueries };
}

async function create(world: World, body: unknown, uid = "user-1", email?: string) {
  const ctx = build(world, uid, email);
  const result = await createRoadmapItem("token", "team-1", body, ctx.deps);
  return { result, ...ctx };
}

async function expectDenied(world: World, body: unknown, error: string, uid = "user-1") {
  const { result, writes } = await create(world, body, uid);
  expect(result).toEqual({ ok: false, error });
  expect(writes).toEqual([]);
  expect(world.roadmap).toEqual({});
}

describe("createRoadmapItem — authorization", () => {
  it("lets an active ordinary member create", async () => {
    const { result, writes } = await create(baseWorld(), valid);
    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("gives a lead exactly the same capability", async () => {
    const world = baseWorld();
    world.memberships["user-1__team-1"] = member("user-1", 1, { role: "lead" });
    const { result } = await create(world, valid);
    expect(result.ok).toBe(true);
  });

  it("denies a non-member", async () => {
    await expectDenied(baseWorld(), valid, "forbidden", "stranger");
  });

  it("denies an app admin who is not a member", async () => {
    await expectDenied(baseWorld(), valid, "forbidden", "admin-1");
  });

  it("lets an app admin who is also a genuine active member create (via membership)", async () => {
    const world = baseWorld();
    world.memberships["admin-1__team-1"] = member("admin-1", 3);
    const { result } = await create(world, valid, "admin-1", "admin@example.com");
    expect(result.ok).toBe(true);
  });

  it("rejects a membership whose stored uid/teamId do not match (canonical identity)", async () => {
    const wrongUid = baseWorld();
    wrongUid.memberships["user-1__team-1"] = member("someone-else", 1);
    await expectDenied(wrongUid, valid, "forbidden");
    const wrongTeam = baseWorld();
    wrongTeam.memberships["user-1__team-1"] = member("user-1", 1, { teamId: "team-9" });
    await expectDenied(wrongTeam, valid, "forbidden");
  });

  it.each([["disabled"], ["bogus"], [undefined]])("denies team status %s with team_disabled", async (status) => {
    const world = baseWorld();
    world.teams["team-1"] = status;
    await expectDenied(world, valid, "team_disabled");
  });

  it("denies a missing team with team_disabled", async () => {
    const world = baseWorld();
    delete world.teams["team-1"];
    await expectDenied(world, valid, "team_disabled");
  });

  it("returns unauthenticated for a bad token", async () => {
    const world = baseWorld();
    const ctx = build(world);
    ctx.deps.verifyToken = vi.fn().mockRejectedValue(new Error("bad"));
    expect(await createRoadmapItem("", "team-1", valid, ctx.deps)).toEqual({ ok: false, error: "unauthenticated" });
    expect(ctx.writes).toEqual([]);
  });

  it.each(["getMembership", "getTeamStatus", "getSkillProgress", "getSkillTree", "getRoadmapItem"] as const)(
    "fails closed with persistence_failed when %s throws",
    async (failRead) => {
      const world = baseWorld();
      world.failRead = failRead;
      const { result, writes } = await create(world, valid);
      expect(result).toEqual({ ok: false, error: "persistence_failed" });
      expect(writes).toEqual([]);
    },
  );
});

describe("createRoadmapItem — request validation", () => {
  it.each([undefined, null, "x", 3, [], [valid]])("rejects non-object body %j as invalid_request", async (body) => {
    await expectDenied(baseWorld(), body, "invalid_request");
  });

  it.each([
    "teamId",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "completedAt",
    "archivedAt",
    "archivedBy",
    "targetReached",
    "overdue",
    "tracking",
    "areaName",
    "targetLabel",
    "archived",
    "owner",
    "uid",
  ])("rejects server-owned/unknown key %s as invalid_request", async (key) => {
    await expectDenied(baseWorld(), { ...valid, [key]: "x" }, "invalid_request");
  });

  it.each([
    [{ treeId: "" }],
    [{ treeId: 4 }],
    [{ treeId: "a/b" }],
    [{ targetNodeId: "" }],
    [{ targetNodeId: 3 }],
    [{ priority: "urgent" }],
    [{ priority: null }],
    [{ status: "archived" }],
    [{ startDate: "2026-06-1" }],
    [{ targetDate: "2026-02-30" }],
    [{ startDate: "2019-12-31" }],
    [{ targetDate: "2101-01-01" }],
    [{ startDate: "2026-07-01", targetDate: "2026-06-01" }],
  ])("rejects malformed field %j as invalid_input", async (patch) => {
    await expectDenied(baseWorld(), { ...valid, ...patch }, "invalid_input");
  });

  it("accepts valid optional dates (start equal to target allowed)", async () => {
    const { result, writes } = await create(baseWorld(), {
      ...valid,
      startDate: "2026-07-01",
      targetDate: "2026-07-01",
    });
    expect(result.ok).toBe(true);
    expect(writes[0].data).toMatchObject({ startDate: "2026-07-01", targetDate: "2026-07-01" });
  });
});

describe("createRoadmapItem — tracking and target", () => {
  it("rejects an untracked area with not_tracked and never starts tracking", async () => {
    const world = baseWorld();
    world.progress = {};
    await expectDenied(world, valid, "not_tracked");
    expect(world.progress).toEqual({});
  });

  it.each([
    ["malformed", { teamId: "team-1", treeId: "tree-1" }],
    ["cross-team", progress("tree-1", "node-0", { teamId: "team-2" })],
    ["cross-tree", progress("tree-2")],
  ])("fails closed on %s SkillProgress", async (_name, doc) => {
    const world = baseWorld();
    world.progress = { "team-1__tree-1": doc };
    await expectDenied(world, valid, "not_tracked");
  });

  it("rejects a missing/invalid tree with tree_not_found", async () => {
    const missing = baseWorld();
    delete missing.trees["tree-1"];
    await expectDenied(missing, valid, "tree_not_found");
    const broken = baseWorld();
    broken.trees["tree-1"] = { name: "x" };
    await expectDenied(broken, valid, "tree_not_found");
  });

  it("compares stage order, not node ids", async () => {
    const ahead = baseWorld();
    ahead.progress = { "team-1__tree-1": progress("tree-1", "node-1") };
    expect((await create(ahead, valid)).result.ok).toBe(true);
    const behind = baseWorld();
    behind.progress = { "team-1__tree-1": progress("tree-1", "node-2") };
    await expectDenied(behind, { ...valid, targetNodeId: "node-1" }, "target_not_ahead");
  });

  it("accepts any node when tracked with a null current stage", async () => {
    const world = baseWorld();
    world.progress = { "team-1__tree-1": progress("tree-1", null) };
    expect((await create(world, { ...valid, targetNodeId: "node-0" })).result.ok).toBe(true);
  });

  it("rejects target equal to current with target_not_ahead", async () => {
    await expectDenied(baseWorld(), { ...valid, targetNodeId: "node-0" }, "target_not_ahead");
  });

  it.each(["node-3", "missing"])("rejects target %s (other tree / stale) as invalid_input", async (target) => {
    await expectDenied(baseWorld(), { ...valid, targetNodeId: target }, "invalid_input");
  });

  it("fails closed (not_tracked) on a stale current stage", async () => {
    const world = baseWorld();
    world.progress = { "team-1__tree-1": progress("tree-1", "gone") };
    await expectDenied(world, valid, "not_tracked");
  });

  it("reads everything inside the transaction before the single write", async () => {
    const { reads, writes } = await create(baseWorld(), valid);
    expect(reads).toEqual(["getMembership", "getTeamStatus", "getSkillProgress", "getSkillTree", "getRoadmapItem"]);
    expect(writes).toHaveLength(1);
  });
});

describe("createRoadmapItem — owner", () => {
  it("creates an unassigned plan without reading memberships", async () => {
    const { result, writes, membershipQueries } = await create(baseWorld(), valid);
    expect(result.ok && result.item.owner).toBeNull();
    expect(writes[0].data).not.toHaveProperty("ownerRef");
    expect(membershipQueries()).toBe(0);
  });

  it("assigns another current member, persisting only the ref", async () => {
    const { result, writes, membershipQueries } = await create(baseWorld(), { ...valid, ownerRef: REF(2) });
    expect(membershipQueries()).toBe(1);
    expect(writes[0].data.ownerRef).toBe(REF(2));
    expect(result.ok && result.item.owner).toMatchObject({ state: "current", memberRef: REF(2) });
    const serialized = JSON.stringify(writes[0].data);
    for (const leak of ["user-2", "example.com", "Navn", "ordinal", "team-1__user"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(Object.keys(writes[0].data).sort()).toEqual(
      ["createdAt", "createdBy", "ownerRef", "priority", "status", "targetNodeId", "teamId", "treeId", "updatedAt", "updatedBy"],
    );
  });

  it("allows the caller to be the owner", async () => {
    const { result } = await create(baseWorld(), { ...valid, ownerRef: REF(1) });
    expect(result.ok && result.item.owner).toMatchObject({ state: "current", isSelf: true });
  });

  it.each([
    ["stale", REF(7)],
    ["malformed", "not-a-ref"],
    ["non-string", 5],
    ["null", null],
    ["empty", ""],
  ])("rejects a %s ownerRef as invalid_owner", async (_name, ownerRef) => {
    await expectDenied(baseWorld(), { ...valid, ownerRef }, "invalid_owner");
  });

  it("rejects another team's ref and a duplicate-match ref", async () => {
    const other = baseWorld();
    other.teamMembers = [member("user-1", 1), member("user-9", 5, { teamId: "team-2" })];
    await expectDenied(other, { ...valid, ownerRef: REF(5) }, "invalid_owner");
    const dup = baseWorld();
    dup.teamMembers = [member("user-1", 1), member("user-2", 2), member("user-3", 2)];
    await expectDenied(dup, { ...valid, ownerRef: REF(2) }, "invalid_owner");
  });

  it("does not materialize a missing memberRef; such an owner is invalid_owner", async () => {
    const world = baseWorld();
    const legacy = member("user-3", 3) as Record<string, unknown>;
    delete legacy.memberRef;
    world.teamMembers = [member("user-1", 1), legacy];
    const before = JSON.stringify(world.teamMembers);
    await expectDenied(world, { ...valid, ownerRef: REF(3) }, "invalid_owner");
    expect(JSON.stringify(world.teamMembers)).toBe(before);
  });
});

describe("createRoadmapItem — slot and persisted shape", () => {
  const stored = (extra: Record<string, unknown> = {}) => ({
    teamId: "team-1",
    treeId: "tree-1",
    targetNodeId: "node-1",
    priority: "low",
    status: "active",
    createdAt: T0,
    createdBy: "c",
    updatedAt: T0,
    updatedBy: "u",
    ...extra,
  });

  it("rejects an existing active plan without overwriting it", async () => {
    const world = baseWorld();
    const existing = stored();
    world.roadmap = { "team-1__tree-1": existing };
    const { result, writes } = await create(world, valid);
    expect(result).toEqual({ ok: false, error: "already_planned" });
    expect(writes).toEqual([]);
    expect(world.roadmap["team-1__tree-1"]).toBe(existing);
  });

  it("reports an archived plan as plan_archived and neither overwrites nor restores it", async () => {
    const world = baseWorld();
    const archived = stored({ archivedAt: T0, archivedBy: "u" });
    world.roadmap = { "team-1__tree-1": archived };
    const { result, writes } = await create(world, valid);
    expect(result).toEqual({ ok: false, error: "plan_archived" });
    expect(writes).toEqual([]);
    expect(world.roadmap["team-1__tree-1"]).toBe(archived);
  });

  it("treats a mismatching/corrupt occupant as already_planned, no write", async () => {
    const world = baseWorld();
    world.roadmap = { "team-1__tree-1": { teamId: "team-2", treeId: "tree-1" } };
    const { result, writes } = await create(world, valid);
    expect(result).toEqual({ ok: false, error: "already_planned" });
    expect(writes).toEqual([]);
  });

  it("writes the deterministic id with explicit teamId/treeId, defaults and server audit fields", async () => {
    const { writes } = await create(baseWorld(), valid);
    expect(writes).toEqual([
      {
        docId: "team-1__tree-1",
        data: {
          teamId: "team-1",
          treeId: "tree-1",
          targetNodeId: "node-2",
          priority: "medium",
          status: "planned",
          createdAt: NOW,
          createdBy: "user-1",
          updatedAt: NOW,
          updatedBy: "user-1",
        },
      },
    ]);
  });

  it.each(["high", "medium", "low"])("stores explicit priority %s", async (priority) => {
    const { writes } = await create(baseWorld(), { ...valid, priority });
    expect(writes[0].data.priority).toBe(priority);
  });

  it("never sets archive fields; sets completedAt only for a completed initial status", async () => {
    const active = await create(baseWorld(), { ...valid, status: "active" });
    for (const key of ["completedAt", "archivedAt", "archivedBy"]) {
      expect(active.writes[0].data).not.toHaveProperty(key);
    }
    const done = await create(baseWorld(), { ...valid, status: "completed" });
    expect(done.writes[0].data).toMatchObject({ status: "completed", completedAt: NOW });
    expect(done.writes[0].data).not.toHaveProperty("archivedAt");
  });

  it("does not mutate progress, memberships or teams", async () => {
    const world = baseWorld();
    const snapshot = JSON.stringify([world.progress, world.memberships, world.teams, world.teamMembers]);
    await create(world, { ...valid, ownerRef: REF(2) });
    expect(JSON.stringify([world.progress, world.memberships, world.teams, world.teamMembers])).toBe(snapshot);
  });

  it("returns exactly the TASK-005 DTO keys and no identity or audit fields", async () => {
    const { result } = await create(baseWorld(), { ...valid, ownerRef: REF(2), targetDate: "2026-06-01" });
    if (!result.ok) throw new Error("expected ok");
    expect(Object.keys(result.item).sort()).toEqual(
      [
        "archived", "areaName", "createdAt", "overdue", "owner", "priority", "startDate", "status",
        "targetAvailable", "targetDate", "targetLabel", "targetNodeId", "targetReached", "tracking",
        "treeId", "updatedAt",
      ].sort(),
    );
    expect(result.item).toMatchObject({
      areaName: "Testing",
      targetLabel: "Avansert",
      targetAvailable: true,
      tracking: { state: "tracked", currentNodeId: "node-0" },
      targetReached: false,
      overdue: true,
      archived: false,
      createdAt: NOW.toISOString(),
    });
    const json = JSON.stringify(result);
    for (const leak of ["createdBy", "updatedBy", "user-1", "user-2", "@example.com"]) {
      expect(json).not.toContain(leak);
    }
  });
});

describe("createRoadmapItem — concurrency", () => {
  it("lets exactly one of two concurrent creates win; the loser gets already_planned", async () => {
    const world = baseWorld();
    world.memberships["user-2__team-1"] = member("user-2", 2);
    const a = build(world, "user-1");
    const b = build(world, "user-2");
    const [ra, rb] = await Promise.all([
      createRoadmapItem("t", "team-1", valid, a.deps),
      createRoadmapItem("t", "team-1", valid, b.deps),
    ]);
    const outcomes = [ra, rb].map((r) => (r.ok ? "ok" : r.error)).sort();
    expect(outcomes).toEqual(["already_planned", "ok"]);
    expect(Object.keys(world.roadmap)).toEqual(["team-1__tree-1"]);
  });

  it("returns persistence_failed without leaking detail when the commit fails", async () => {
    const world = baseWorld();
    const ctx = build(world);
    ctx.deps.store = {
      async runTransaction() {
        throw new Error("secret internal detail");
      },
    };
    const result = await createRoadmapItem("t", "team-1", valid, ctx.deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(world.roadmap).toEqual({});
  });

  it("returns 201-shaped success from the transaction snapshot when every post-commit read would fail", async () => {
    const world = baseWorld();
    const ctx = build(world);
    const inner = ctx.deps.store!;
    let commits = 0;
    ctx.deps.store = {
      async runTransaction(fn) {
        const result = await inner.runTransaction(fn);
        commits += 1;
        // Committed. Anything re-read now is gone/changed: tracking stopped, tree deleted, owner left.
        world.progress = {};
        world.trees = {};
        world.teamMembers = [];
        world.memberships = {};
        return result;
      },
    };
    ctx.deps.profileReader = {
      async readBatch() {
        throw new Error("secret profile outage");
      },
    };
    const result = await createRoadmapItem("t", "team-1", { ...valid, ownerRef: REF(2) }, ctx.deps);
    expect(commits).toBe(1);
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(result.item).toMatchObject({
      areaName: "Testing",
      targetLabel: "Avansert",
      targetAvailable: true,
      tracking: { state: "tracked", currentNodeId: "node-0" },
      targetReached: false,
      owner: { state: "unavailable" },
    });
    const json = JSON.stringify(result);
    for (const leak of ["user-2", "example.com", "secret profile outage", REF(2)]) {
      expect(json).not.toContain(leak);
    }
    expect(Object.keys(world.roadmap)).toEqual(["team-1__tree-1"]);
    expect(ctx.writes).toHaveLength(1);
  });

  it("still resolves the owner (with display name) when profile reads succeed", async () => {
    const { result } = await create(baseWorld(), { ...valid, ownerRef: REF(2) });
    expect(result.ok && result.item.owner).toMatchObject({ state: "current", memberRef: REF(2), isSelf: false });
  });

  it("returns persistence_failed when a transaction-time read fails before commit", async () => {
    const world = baseWorld();
    world.failRead = "getSkillTree";
    const { result, writes } = await create(world, valid);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(writes).toEqual([]);
    expect(world.roadmap).toEqual({});
  });
});
