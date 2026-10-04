import { describe, expect, it, vi } from "vitest";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import {
  ROADMAP_ITEMS_MAX,
  listRoadmapItems,
  type ListRoadmapItemsDeps,
  type RawDoc,
  type RoadmapReadStore,
} from "./list-roadmap-items";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-06-15T10:00:00Z"); // 2026-06-15 in Oslo
const T0 = new Date("2026-01-01T00:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
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

function plan(treeId: string, extra: Record<string, unknown> = {}) {
  return {
    teamId: "team-1",
    treeId,
    targetNodeId: "node-2",
    priority: "medium",
    status: "planned",
    createdAt: T0,
    createdBy: "creator-secret",
    updatedAt: T0,
    updatedBy: "updater-secret",
    ...extra,
  };
}

function doc(treeId: string, extra: Record<string, unknown> = {}, id = `team-1__${treeId}`): RawDoc {
  return { id, data: plan(treeId, extra) };
}

function progress(treeId: string, currentNodeId: string | null, extra: Record<string, unknown> = {}): RawDoc {
  return {
    id: `team-1__${treeId}`,
    data: { teamId: "team-1", treeId, currentNodeId, updatedAt: T0, updatedBy: "admin-x", ...extra },
  };
}

function member(uid: string, n: number, extra: Record<string, unknown> = {}) {
  return { uid, teamId: "team-1", createdAt: day(n), grantedBy: "admin-secret", memberRef: REF(n), ...extra };
}

interface World {
  teams?: Record<string, unknown>;
  memberships?: Record<string, Record<string, unknown>>;
  plans?: RawDoc[];
  progress?: RawDoc[];
  trees?: Record<string, unknown>;
  teamMembers?: unknown[];
  profiles?: Record<string, unknown>;
  failAuthStatus?: boolean;
  failPlans?: boolean;
}

function build(world: World, callerUid = "user-1") {
  const log = {
    planLimit: [] as number[],
    planTeamIds: [] as string[],
    membershipListCalls: 0,
  };
  const collection: AuthorizeTeamAccessCollection = {
    async getTeamStatus(teamId) {
      if (world.failAuthStatus) throw new Error("secret internal detail");
      return world.teams?.[teamId];
    },
    async getMembership(uid, teamId) {
      return world.memberships?.[`${uid}__${teamId}`];
    },
  };
  const store: RoadmapReadStore = {
    async listRoadmapItems(teamId, limit) {
      log.planTeamIds.push(teamId);
      log.planLimit.push(limit);
      if (world.failPlans) throw new Error("secret internal detail");
      return (world.plans ?? []).slice(0, limit);
    },
    async listSkillProgress() {
      return world.progress ?? [];
    },
    async getSkillTree(treeId) {
      return world.trees?.[treeId];
    },
    async listMemberships(_teamId, limit) {
      log.membershipListCalls += 1;
      return (world.teamMembers ?? []).slice(0, limit);
    },
    async getMembership(uid, teamId) {
      return world.memberships?.[`${uid}__${teamId}`];
    },
    async getTeamStatus(teamId) {
      return world.teams?.[teamId];
    },
  };
  const deps: ListRoadmapItemsDeps = {
    verifyToken: vi
      .fn()
      .mockResolvedValue({ uid: callerUid, email: callerUid === "admin-1" ? ADMIN_EMAIL : `${callerUid}@example.com`, email_verified: true }),
    allowList: [ADMIN_EMAIL],
    collection,
    store,
    now: () => NOW,
    profileReader: {
      async readBatch(uids) {
        return uids.map((uid) => ({ uid, data: world.profiles?.[uid] }));
      },
    },
  };
  return { deps, log };
}

const profile = (name: string) => ({ displayName: name, createdAt: T0, updatedAt: T0 });
const memberWorld = (extra: World = {}): World => ({
  teams: { "team-1": "active" },
  memberships: { "user-1__team-1": member("user-1", 1) },
  trees: { "tree-a": TREE },
  ...extra,
});

async function read(world: World, opts: { includeArchived?: boolean } = {}, caller = "user-1") {
  const { deps, log } = build(world, caller);
  const result = await listRoadmapItems("tok", "team-1", opts, deps);
  return { result, log };
}

async function items(world: World, opts: { includeArchived?: boolean } = {}, caller = "user-1") {
  const { result } = await read(world, opts, caller);
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
}

describe("listRoadmapItems — authorization", () => {
  it("reads for an active-team member and derives canEdit true", async () => {
    const r = await items(memberWorld({ plans: [doc("tree-a")], progress: [progress("tree-a", "node-0")] }));
    expect(r.items).toHaveLength(1);
    expect(r.canEdit).toBe(true);
  });

  it("gives a lead no extra capability (same result as a member)", async () => {
    const r = await items(
      memberWorld({
        memberships: { "user-1__team-1": member("user-1", 1, { role: "lead" }) },
        plans: [doc("tree-a")],
      }),
    );
    expect(r.canEdit).toBe(true);
    expect(r.items).toHaveLength(1);
  });

  it("lets an app admin who is not a member read, with canEdit false", async () => {
    const r = await items(memberWorld({ memberships: {}, plans: [doc("tree-a")] }), {}, "admin-1");
    expect(r.items).toHaveLength(1);
    expect(r.canEdit).toBe(false);
  });

  it("denies a non-member with forbidden and reads no plans", async () => {
    const { result, log } = await read(memberWorld({ memberships: {}, plans: [doc("tree-a")] }), {}, "stranger");
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(log.planLimit).toEqual([]);
  });

  it("denies an invalid team", async () => {
    const { result } = await read(memberWorld({ teams: {}, plans: [doc("tree-a")] }));
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns unauthenticated for a rejected token", async () => {
    const { deps } = build(memberWorld());
    deps.verifyToken = vi.fn().mockRejectedValue(new Error("bad"));
    expect(await listRoadmapItems("bad", "team-1", {}, deps)).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("fails closed with read_failed when authorization cannot be read", async () => {
    const { result } = await read(memberWorld({ failAuthStatus: true, plans: [doc("tree-a")] }));
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("returns read_failed without detail when the plan read throws", async () => {
    const { result } = await read(memberWorld({ failPlans: true }));
    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("still reads a disabled team for a member, with canEdit false", async () => {
    const r = await items(memberWorld({ teams: { "team-1": "disabled" }, plans: [doc("tree-a")] }));
    expect(r.items).toHaveLength(1);
    expect(r.canEdit).toBe(false);
  });
});

describe("listRoadmapItems — persisted validation", () => {
  it("queries only the requested team, limit 501", async () => {
    const { log } = await read(memberWorld());
    expect(log.planTeamIds).toEqual(["team-1"]);
    expect(log.planLimit).toEqual([ROADMAP_ITEMS_MAX + 1]);
  });

  it("skips stored teamId mismatches, treeId/doc-id mismatches and malformed docs", async () => {
    const r = await items(
      memberWorld({
        trees: { "tree-a": TREE, "tree-b": TREE, "tree-c": TREE },
        plans: [
          doc("tree-a"),
          doc("tree-b", { teamId: "team-2" }), // stored team mismatch (id looks right)
          doc("tree-c", {}, "team-1__tree-other"), // doc id mismatch
          { id: "team-1__tree-d", data: plan("tree-e") }, // stored tree mismatch
          { id: "team-1__tree-f", data: { teamId: "team-1" } }, // malformed
        ],
      }),
    );
    expect(r.items.map((i) => i.treeId)).toEqual(["tree-a"]);
  });

  it("truncates at 500 and never emits the 501st", async () => {
    const plans = Array.from({ length: 501 }, (_, i) => doc(`t${i}`));
    const r = await items(memberWorld({ plans }));
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(500);
    expect(r.items.map((i) => i.treeId)).not.toContain("t500");
  });

  it("is not truncated at exactly 500", async () => {
    const r = await items(memberWorld({ plans: Array.from({ length: 500 }, (_, i) => doc(`t${i}`)) }));
    expect(r.truncated).toBe(false);
    expect(r.items).toHaveLength(500);
  });
});

describe("listRoadmapItems — derived presentation", () => {
  it("derives area, target label, tracking and targetReached from tree and progress", async () => {
    const r = await items(memberWorld({ plans: [doc("tree-a")], progress: [progress("tree-a", "node-1")] }));
    expect(r.items[0]).toMatchObject({
      areaName: "Testing",
      targetLabel: "Avansert",
      targetAvailable: true,
      tracking: { state: "tracked", currentNodeId: "node-1" },
      targetReached: false,
    });
  });

  it("reports targetReached true without changing status", async () => {
    const r = await items(memberWorld({ plans: [doc("tree-a")], progress: [progress("tree-a", "node-2")] }));
    expect(r.items[0].targetReached).toBe(true);
    expect(r.items[0].status).toBe("planned");
  });

  it("treats a null current stage as tracked and not reached", async () => {
    const r = await items(memberWorld({ plans: [doc("tree-a")], progress: [progress("tree-a", null)] }));
    expect(r.items[0].tracking).toEqual({ state: "tracked", currentNodeId: null });
    expect(r.items[0].targetReached).toBe(false);
  });

  it("omits the targetReached key when the current stage is not a node of the tree", async () => {
    const r = await items(
      memberWorld({ plans: [doc("tree-a", { targetDate: "2026-01-01" })], progress: [progress("tree-a", "node-9")] }),
    );
    expect("targetReached" in r.items[0]).toBe(false);
    expect(r.items[0].overdue).toBe(true);
    expect(JSON.parse(JSON.stringify(r.items[0]))).not.toHaveProperty("targetReached");
  });

  it("keeps a plan without SkillProgress as not_tracked with no currentNodeId/targetReached", async () => {
    const r = await items(memberWorld({ plans: [doc("tree-a", { targetDate: "2026-01-01" })] }));
    const item = r.items[0];
    expect(item.tracking).toEqual({ state: "not_tracked" });
    expect("targetReached" in item).toBe(false);
    expect(item.overdue).toBe(true);
    expect(item.targetLabel).toBe("Avansert");
  });

  it("ignores a progress record whose id or team disagrees", async () => {
    const r = await items(
      memberWorld({
        plans: [doc("tree-a")],
        progress: [
          { id: "team-1__other", data: progress("tree-a", "node-2").data },
          progress("tree-a", "node-2", { teamId: "team-2" }),
        ],
      }),
    );
    expect(r.items[0].tracking).toEqual({ state: "not_tracked" });
  });

  it("marks a stale target unavailable: no label, no targetReached key, overdue still derived", async () => {
    const r = await items(
      memberWorld({
        plans: [doc("tree-a", { targetNodeId: "node-99", targetDate: "2026-01-01" })],
        progress: [progress("tree-a", "node-0")],
      }),
    );
    expect(r.items[0]).toMatchObject({ targetAvailable: false, targetLabel: null, overdue: true });
    expect("targetReached" in r.items[0]).toBe(false);
    expect(r.items[0].areaName).toBe("Testing");
  });

  it("keeps the plan when the tree is missing or malformed, guessing nothing", async () => {
    const r = await items(
      memberWorld({
        trees: { "tree-b": { name: "" } },
        plans: [doc("tree-a", { targetDate: "2026-01-01" }), doc("tree-b", { targetDate: "2026-01-01" })],
        progress: [progress("tree-a", "node-0")],
      }),
    );
    expect(r.items).toHaveLength(2);
    for (const item of r.items) {
      expect(item).toMatchObject({ areaName: null, targetLabel: null, targetAvailable: false, overdue: true });
      expect("targetReached" in item).toBe(false);
    }
  });

  it("sorts plans with an unresolved (null) area name after named areas", async () => {
    const r = await items(
      memberWorld({
        trees: { "tree-b": { ...TREE, name: "Zebra" } },
        plans: [doc("tree-a"), doc("tree-b")],
      }),
    );
    expect(r.items.map((i) => [i.treeId, i.areaName])).toEqual([
      ["tree-b", "Zebra"],
      ["tree-a", null],
    ]);
  });

  it("derives overdue and keeps exact keys for a not_tracked plan with an unavailable target", async () => {
    const r = await items(
      memberWorld({ plans: [doc("tree-a", { targetNodeId: "node-99", targetDate: "2026-01-01" })] }),
    );
    expect(r.items[0].overdue).toBe(true);
    expect(Object.keys(r.items[0])).not.toContain("targetReached");
    expect(Object.keys(r.items[0])).toContain("overdue");
  });

  it("derives overdue from the Oslo date, never for completed plans", async () => {
    const r = await items(
      memberWorld({
        trees: { "tree-a": TREE, "tree-b": TREE, "tree-c": TREE },
        plans: [
          doc("tree-a", { targetDate: "2026-06-14" }),
          doc("tree-b", { targetDate: "2026-06-15" }),
          doc("tree-c", { targetDate: "2026-06-14", status: "completed", completedAt: T0 }),
        ],
      }),
    );
    const by = Object.fromEntries(r.items.map((i) => [i.treeId, i.overdue]));
    expect(by).toEqual({ "tree-a": true, "tree-b": false, "tree-c": false });
  });
});

describe("listRoadmapItems — archive and sort", () => {
  const archived = { archivedAt: T0, archivedBy: "archiver-secret" };
  const world = () =>
    memberWorld({
      trees: { "tree-a": TREE, "tree-b": { ...TREE, name: "Arkitektur" } },
      plans: [doc("tree-a", archived), doc("tree-b")],
    });

  it("excludes archived plans by default", async () => {
    expect((await items(world())).items.map((i) => i.treeId)).toEqual(["tree-b"]);
  });

  it("includes archived plans when requested, last, keeping their status", async () => {
    const r = await items(world(), { includeArchived: true });
    expect(r.items.map((i) => [i.treeId, i.archived, i.status])).toEqual([
      ["tree-b", false, "planned"],
      ["tree-a", true, "planned"],
    ]);
    expect(JSON.stringify(r)).not.toContain("archiver-secret");
  });

  it("sorts by status then priority — never by owner", async () => {
    const r = await items(
      memberWorld({
        trees: { "tree-a": TREE, "tree-b": TREE, "tree-c": TREE },
        plans: [
          doc("tree-a", { priority: "low" }),
          doc("tree-b", { status: "active" }),
          doc("tree-c", { priority: "high" }),
        ],
      }),
    );
    expect(r.items.map((i) => i.treeId)).toEqual(["tree-b", "tree-c", "tree-a"]);
  });
});

describe("listRoadmapItems — owner resolution", () => {
  const withOwner = (ownerRef: unknown, extra: World = {}) =>
    memberWorld({
      plans: [doc("tree-a", { ownerRef })],
      teamMembers: [member("user-1", 1), member("user-2", 2)],
      profiles: { "user-1": profile("Kari"), "user-2": profile("Ola") },
      ...extra,
    });

  it("reads no memberships when no plan has an owner, and reports owner null", async () => {
    const { result, log } = await read(memberWorld({ plans: [doc("tree-a")] }));
    expect(log.membershipListCalls).toBe(0);
    expect(result.ok && result.items[0].owner).toBeNull();
  });

  it("resolves a current member to name, ordinal and isSelf only", async () => {
    const r = await items(withOwner(REF(2)));
    expect(r.items[0].owner).toEqual({
      state: "current",
      memberRef: REF(2),
      displayName: "Ola",
      ordinal: null,
      isSelf: false,
    });
    const self = await items(withOwner(REF(1)));
    expect(self.items[0].owner).toMatchObject({ isSelf: true, displayName: "Kari" });
  });

  it("uses a null display name when the profile is missing (no e-mail/uid fallback)", async () => {
    const r = await items(withOwner(REF(2), { profiles: {} }));
    expect(r.items[0].owner).toMatchObject({ state: "current", displayName: null });
    expect(JSON.stringify(r)).not.toContain("user-2");
    expect(JSON.stringify(r)).not.toContain("@example.com");
  });

  it("gives duplicate-name owners the same ordinal as the selector", async () => {
    const r = await items(withOwner(REF(2), { profiles: { "user-1": profile("Ola"), "user-2": profile("Ola") } }));
    expect(r.items[0].owner).toMatchObject({ ordinal: 2 });
  });

  it("marks a stale ref unavailable but keeps the plan", async () => {
    const r = await items(withOwner(REF(9)));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].owner).toEqual({ state: "unavailable" });
  });

  it("marks a malformed string ref unavailable, plan survives", async () => {
    const r = await items(withOwner("not-a-ref!"));
    expect(r.items[0].owner).toEqual({ state: "unavailable" });
  });

  it("treats a non-string ownerRef as unassigned (null), unlike an unresolvable string", async () => {
    for (const bad of [12345, true, {}, ["x"]]) {
      expect((await items(withOwner(bad))).items[0].owner).toBeNull();
    }
    expect((await items(withOwner("not-a-ref!"))).items[0].owner).toEqual({ state: "unavailable" });
  });

  it("fails closed to unavailable on a duplicate ref", async () => {
    const r = await items(
      withOwner(REF(2), { teamMembers: [member("user-1", 1), member("user-3", 2), member("user-2", 2)] }),
    );
    expect(r.items[0].owner).toEqual({ state: "unavailable" });
  });

  it("never resolves a ref belonging to another team's membership", async () => {
    const r = await items(
      withOwner(REF(7), { teamMembers: [member("user-1", 1), member("user-9", 7, { teamId: "team-2" })] }),
    );
    expect(r.items[0].owner).toEqual({ state: "unavailable" });
  });

  it("does not use ownerRef as authorization", async () => {
    const { result } = await read(withOwner(REF(2), { memberships: {} }), {}, "user-2");
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("listRoadmapItems — completedAt", () => {
  const DONE = new Date("2026-03-04T10:00:00.000Z");

  it("maps a completed plan's completedAt to an ISO string and other plans to null", async () => {
    const r = await items(
      memberWorld({
        trees: { "tree-a": TREE, "tree-b": TREE, "tree-c": TREE },
        plans: [
          doc("tree-a", { status: "completed", completedAt: DONE }),
          doc("tree-b", { status: "active" }),
          doc("tree-c", { status: "planned" }),
        ],
      }),
    );
    const by = Object.fromEntries(r.items.map((i) => [i.treeId, i.completedAt]));
    expect(by).toEqual({ "tree-a": "2026-03-04T10:00:00.000Z", "tree-b": null, "tree-c": null });
  });

  it.each([
    ["absent", {}],
    ["null", { completedAt: null }],
  ])("keeps a legacy completed plan with %s completedAt readable and undated", async (_label, extra) => {
    const r = await items(memberWorld({ plans: [doc("tree-a", { status: "completed", ...extra })] }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ status: "completed", completedAt: null, overdue: false });
    expect(r.items[0].updatedAt).toBe(T0.toISOString());
  });

  it("still skips a plan whose completedAt is present but malformed", async () => {
    const r = await items(memberWorld({ plans: [doc("tree-a", { status: "completed", completedAt: "x" })] }));
    expect(r.items).toEqual([]);
  });

  it("exposes no actor, history or presentation extras", async () => {
    const r = await items(
      memberWorld({ plans: [doc("tree-a", { status: "completed", completedAt: DONE, completedBy: "done-secret" })] }),
    );
    const keys = Object.keys(r.items[0]);
    for (const key of ["currentLabel", "today", "updatedBy", "completedBy", "archivedBy", "createdBy"]) {
      expect(keys).not.toContain(key);
    }
    expect(JSON.stringify(r)).not.toContain("done-secret");
  });
});

describe("listRoadmapItems — response shape and read-only behaviour", () => {
  it("returns exactly the approved keys and no identity/audit data", async () => {
    const r = await items(
      memberWorld({
        plans: [doc("tree-a", { ownerRef: REF(2), startDate: "2026-02-01", targetDate: "2026-12-01" })],
        progress: [progress("tree-a", "node-0")],
        teamMembers: [member("user-1", 1), member("user-2", 2)],
        profiles: { "user-2": profile("Ola") },
      }),
    );
    expect(Object.keys(r).sort()).toEqual(["canEdit", "items", "ok", "truncated"]);
    expect(Object.keys(r.items[0]).sort()).toEqual(
      [
        "areaName", "archived", "createdAt", "overdue", "owner", "priority", "startDate", "status",
        "targetAvailable", "targetDate", "targetLabel", "targetNodeId", "targetReached", "tracking",
        "treeId", "updatedAt", "completedAt",
      ].sort(),
    );
    expect(Object.keys(r.items[0].owner as object).sort()).toEqual([
      "displayName", "isSelf", "memberRef", "ordinal", "state",
    ]);
    const text = JSON.stringify(r);
    for (const secret of ["creator-secret", "updater-secret", "admin-secret", "user-2", "@example.com", "authorTag", "team-1__"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("depends on a store with no write method", async () => {
    const { deps } = build(memberWorld({ plans: [doc("tree-a")] }));
    await listRoadmapItems("tok", "team-1", {}, deps);
    const methods = Object.keys(deps.store as object);
    expect(methods.filter((k) => /^(set|create|update|delete|write|add)/i.test(k))).toEqual([]);
  });
});
