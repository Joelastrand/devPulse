import { describe, expect, it, vi } from "vitest";
import {
  assignCompetenceArea,
  listCompetenceAreas,
  reorderCompetenceAreas,
  setCompetenceAreaStatus,
  type CompetenceAreaDeps,
  type CompetenceAreaWriteTx,
  type RawAreaDoc,
} from "./manage-competence-areas";
import { COMPETENCE_AREAS_PER_TEAM_MAX, competenceAreaDocId, type CompetenceAreaRecord } from "../domain/competence-area";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-01T09:00:00Z");
const EARLIER = new Date("2026-05-01T09:00:00Z");

const TREE_A = "tree-alpha";
const TREE_B = "tree-beta";
const TREE_C = "tree-gamma";
const TREE_BAD = "tree-broken";

function skillTree(name: string, nodes = 2) {
  return {
    name,
    nodes: Array.from({ length: nodes }, (_, i) => ({ nodeId: `node-${i}`, label: `N${i}`, order: i })),
    createdAt: EARLIER,
    createdBy: "admin",
  };
}

const CATALOG: Record<string, unknown> = {
  [TREE_A]: skillTree("Arkitektur"),
  [TREE_B]: skillTree("Testing"),
  [TREE_C]: skillTree("Sikkerhet"),
  [TREE_BAD]: skillTree("Ugyldig", 0),
};

function area(team: string, treeId: string, extra: Partial<CompetenceAreaRecord> = {}): RawAreaDoc {
  const record: CompetenceAreaRecord = {
    teamId: team,
    treeId,
    status: "active",
    sortOrder: 0,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...extra,
  };
  return { id: competenceAreaDocId(team, treeId), data: record };
}

const TEAMS: Record<string, unknown> = { "team-1": "active", "team-2": "active", "team-off": "disabled" };
const MEMBERSHIPS: Array<Record<string, unknown>> = [
  { uid: "uid-lead", teamId: "team-1", memberRef: "0123456789abcdefghjkmnpqrs", createdAt: EARLIER, role: "teamadmin" },
  { uid: "uid-member", teamId: "team-1", memberRef: "tvwxyz0123456789abcdefghjk", createdAt: EARLIER, role: "member" },
  { uid: "uid-lead-2", teamId: "team-2", memberRef: "mnpqrstvwxyz0123456789abcd", createdAt: EARLIER, role: "teamadmin" },
  { uid: "uid-lead-off", teamId: "team-off", memberRef: "0123456789abcdefghjkmnpqrs", createdAt: EARLIER, role: "teamadmin" },
];

interface World {
  areas?: RawAreaDoc[];
  teams?: Record<string, unknown>;
}

interface Writes {
  puts: Array<{ id: string; data: CompetenceAreaRecord }>;
}

function build(world: World = {}, callerUid = "uid-lead") {
  const areas = new Map<string, unknown>((world.areas ?? []).map((doc) => [doc.id, doc.data]));
  const writes: Writes = { puts: [] };
  const teams = world.teams ?? TEAMS;

  const tx: CompetenceAreaWriteTx = {
    async getTeamStatus(teamId) {
      return teams[teamId];
    },
    async getMembership(uid, teamId) {
      return MEMBERSHIPS.find((m) => m.uid === uid && m.teamId === teamId);
    },
    async getSkillTree(treeId) {
      return CATALOG[treeId] === undefined ? undefined : CATALOG[treeId];
    },
    async listAreas(teamId, limit) {
      return [...areas.entries()]
        .filter(([, data]) => (data as { teamId?: string })?.teamId === teamId)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data }));
    },
    async getArea(docId) {
      return areas.get(docId);
    },
    putArea(docId, record) {
      writes.puts.push({ id: docId, data: record });
      areas.set(docId, record);
    },
  };

  const deps: CompetenceAreaDeps = {
    verifyToken: vi.fn().mockResolvedValue({ uid: callerUid, email: `${callerUid}@example.test`, email_verified: true }),
    isSuperadmin: async () => false,
    roleDeps: {
      isSuperadmin: async () => false,
      collection: {
        async getTeamStatus(teamId: string) {
          return teams[teamId];
        },
        async getMembership(uid: string, teamId: string) {
          return MEMBERSHIPS.find((m) => m.uid === uid && m.teamId === teamId);
        },
      },
    },
    catalog: {
      getSkillTree: async (treeId: string) => CATALOG[treeId],
    },
    readStore: {
      async listByTeam(teamId, limit) {
        return [...areas.entries()]
          .filter(([, data]) => (data as { teamId?: string })?.teamId === teamId)
          .slice(0, limit)
          .map(([id, data]) => ({ id, data }));
      },
    },
    writeStore: {
      async runTransaction(fn) {
        return fn(tx);
      },
    },
    now: () => NOW,
  };
  return { deps, writes, areas };
}

describe("assignCompetenceArea — lead-only assignment", () => {
  it("lets a lead of an active team assign a catalog area, last in order, as active", async () => {
    const { deps, writes } = build({ areas: [area("team-1", TREE_B, { sortOrder: 0 })] });
    const result = await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, deps);

    expect(result).toEqual({
      ok: true,
      area: { treeId: TREE_A, name: "Arkitektur", status: "active", sortOrder: 1 },
    });
    expect(writes.puts).toEqual([
      { id: competenceAreaDocId("team-1", TREE_A), data: expect.objectContaining({ teamId: "team-1", treeId: TREE_A, status: "active", sortOrder: 1 }) },
    ]);
  });

  it("stores no uid or actor on the assignment", async () => {
    const { deps, writes } = build();
    await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, deps);
    expect(Object.keys(writes.puts[0].data).sort()).toEqual(["createdAt", "sortOrder", "status", "teamId", "treeId", "updatedAt"]);
  });

  it("refuses a plain member, and a lead of another team", async () => {
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, build({}, "uid-member").deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, build({}, "uid-lead-2").deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a lead on a disabled team with team_disabled, with no write", async () => {
    const { deps, writes } = build({}, "uid-lead-off");
    expect(await assignCompetenceArea("t", "team-off", { treeId: TREE_A }, deps)).toEqual({ ok: false, error: "team_disabled" });
    expect(writes.puts).toHaveLength(0);
  });

  it("refuses an area that is missing or invalid in the catalog", async () => {
    const { deps, writes } = build();
    expect(await assignCompetenceArea("t", "team-1", { treeId: "tree-missing" }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_BAD }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(writes.puts).toHaveLength(0);
  });

  it("rejects an unknown body key as invalid_request and a malformed id as invalid_input", async () => {
    const { deps } = build();
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_A, name: "x" }, deps)).toEqual({ ok: false, error: "invalid_request" });
    expect(await assignCompetenceArea("t", "team-1", { treeId: "../etc" }, deps)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses to re-assign an active or inactive area, and an archived area is terminal", async () => {
    const { deps, writes } = build({
      areas: [area("team-1", TREE_A, { status: "inactive" }), area("team-1", TREE_B, { status: "archived" })],
    });
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, deps)).toEqual({ ok: false, error: "already_assigned" });
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_B }, deps)).toEqual({ ok: false, error: "area_archived" });
    expect(writes.puts).toHaveLength(0);
  });

  it("refuses at the per-team maximum with limit_reached", async () => {
    const full = Array.from({ length: COMPETENCE_AREAS_PER_TEAM_MAX }, (_, i) => area("team-1", `tree-fill-${i}`, { sortOrder: i }));
    const { deps, writes } = build({ areas: full });
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, deps)).toEqual({ ok: false, error: "limit_reached" });
    expect(writes.puts).toHaveLength(0);
  });

  it("fails closed on a malformed stored assignment and writes nothing", async () => {
    const bad = { id: competenceAreaDocId("team-1", TREE_B), data: { teamId: "team-1", treeId: TREE_B, status: "maybe", sortOrder: 0, createdAt: EARLIER, updatedAt: EARLIER } };
    const { deps, writes } = build({ areas: [bad] });
    expect(await assignCompetenceArea("t", "team-1", { treeId: TREE_A }, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(writes.puts).toHaveLength(0);
  });
});

describe("setCompetenceAreaStatus — activate, deactivate, archive", () => {
  it("deactivates an active area and keeps its order slot", async () => {
    const { deps, writes } = build({ areas: [area("team-1", TREE_A, { sortOrder: 2 })] });
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "inactive" }, deps)).toEqual({
      ok: true,
      area: { treeId: TREE_A, name: "Arkitektur", status: "inactive", sortOrder: 2 },
    });
    expect(writes.puts[0].data).toMatchObject({ status: "inactive", sortOrder: 2 });
  });

  it("archives an area by keeping the document: no delete is ever issued", async () => {
    const { deps, writes, areas } = build({ areas: [area("team-1", TREE_A)] });
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "archived" }, deps)).toMatchObject({
      ok: true,
      area: { status: "archived" },
    });
    expect(areas.has(competenceAreaDocId("team-1", TREE_A))).toBe(true);
    expect(writes.puts).toHaveLength(1);
  });

  it("refuses any change to an archived area with area_archived", async () => {
    const { deps, writes } = build({ areas: [area("team-1", TREE_A, { status: "archived" })] });
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "active" }, deps)).toEqual({ ok: false, error: "area_archived" });
    expect(writes.puts).toHaveLength(0);
  });

  it("performs no write when the status is unchanged", async () => {
    const { deps, writes } = build({ areas: [area("team-1", TREE_A)] });
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "active" }, deps)).toMatchObject({ ok: true });
    expect(writes.puts).toHaveLength(0);
  });

  it("reports not_found for an area the team has not assigned", async () => {
    const { deps } = build({ areas: [] });
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "inactive" }, deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("never changes another team's assignment of the same catalog area (team isolation)", async () => {
    const { deps, writes } = build({ areas: [area("team-2", TREE_A)] }, "uid-lead");
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "archived" }, deps)).toEqual({ ok: false, error: "not_found" });
    expect(writes.puts).toHaveLength(0);
  });

  it("refuses a member and a lead of another team", async () => {
    const areas = [area("team-1", TREE_A)];
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "inactive" }, build({ areas }, "uid-member").deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await setCompetenceAreaStatus("t", "team-1", TREE_A, { status: "inactive" }, build({ areas }, "uid-lead-2").deps)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("reorderCompetenceAreas", () => {
  const seeded = () => [
    area("team-1", TREE_A, { sortOrder: 0 }),
    area("team-1", TREE_B, { sortOrder: 1 }),
    area("team-1", TREE_C, { sortOrder: 2, status: "archived" }),
  ];

  it("rewrites the order of the non-archived set and writes only the changed assignments", async () => {
    const { deps, writes } = build({ areas: seeded() });
    expect(await reorderCompetenceAreas("t", "team-1", { order: [TREE_B, TREE_A] }, deps)).toEqual({ ok: true, order: [TREE_B, TREE_A] });
    expect(writes.puts.map((p) => [p.data.treeId, p.data.sortOrder])).toEqual([
      [TREE_B, 0],
      [TREE_A, 1],
    ]);
    expect(writes.puts.every((p) => p.data.status !== "archived")).toBe(true);
  });

  it("refuses an order that omits or adds an assignment (order_mismatch) and writes nothing", async () => {
    const { deps, writes } = build({ areas: seeded() });
    expect(await reorderCompetenceAreas("t", "team-1", { order: [TREE_A] }, deps)).toEqual({ ok: false, error: "order_mismatch" });
    expect(await reorderCompetenceAreas("t", "team-1", { order: [TREE_A, TREE_B, TREE_C] }, deps)).toEqual({ ok: false, error: "order_mismatch" });
    expect(writes.puts).toHaveLength(0);
  });

  it("rejects duplicate ids as invalid_input", async () => {
    const { deps } = build({ areas: seeded() });
    expect(await reorderCompetenceAreas("t", "team-1", { order: [TREE_A, TREE_A] }, deps)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses a member", async () => {
    const { deps } = build({ areas: seeded() }, "uid-member");
    expect(await reorderCompetenceAreas("t", "team-1", { order: [TREE_A, TREE_B] }, deps)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("listCompetenceAreas — member-readable, no ratings", () => {
  it("lets a member read the team's areas in order, without edit rights and without archived areas", async () => {
    const { deps } = build({
      areas: [area("team-1", TREE_B, { sortOrder: 1 }), area("team-1", TREE_A, { sortOrder: 0 }), area("team-1", TREE_C, { status: "archived", sortOrder: 2 })],
    });
    const result = await listCompetenceAreas("t", "team-1", {}, { ...deps, verifyToken: vi.fn().mockResolvedValue({ uid: "uid-member", email: "m@example.test", email_verified: true }) });
    expect(result).toEqual({
      ok: true,
      canEdit: false,
      truncated: false,
      areas: [
        { treeId: TREE_A, name: "Arkitektur", status: "active", sortOrder: 0 },
        { treeId: TREE_B, name: "Testing", status: "active", sortOrder: 1 },
      ],
    });
  });

  it("reports canEdit for a lead of an active team and shows archived areas only on request", async () => {
    const { deps } = build({ areas: [area("team-1", TREE_A), area("team-1", TREE_C, { status: "archived", sortOrder: 1 })] });
    const all = await listCompetenceAreas("t", "team-1", { includeArchived: true }, deps);
    expect(all).toMatchObject({ ok: true, canEdit: true });
    expect(all.ok && all.areas.map((a) => a.treeId)).toEqual([TREE_A, TREE_C]);
  });

  it("returns name null for an area whose catalog entry is now invalid, rather than guessing", async () => {
    const { deps } = build({ areas: [area("team-1", TREE_BAD)] });
    expect(await listCompetenceAreas("t", "team-1", {}, deps)).toMatchObject({ ok: true, areas: [{ treeId: TREE_BAD, name: null }] });
  });

  it("returns only allow-listed keys, with no rating, level, count or member data", async () => {
    const { deps } = build({ areas: [area("team-1", TREE_A)] });
    const result = await listCompetenceAreas("t", "team-1", {}, deps);
    expect(result.ok && Object.keys(result.areas[0]).sort()).toEqual(["name", "sortOrder", "status", "treeId"]);
  });

  it("refuses a caller with no membership and a stored assignment of another team", async () => {
    const { deps } = build({ areas: [area("team-2", TREE_A)] });
    expect(await listCompetenceAreas("t", "team-1", {}, { ...deps, verifyToken: vi.fn().mockResolvedValue({ uid: "uid-x", email: "x@example.test", email_verified: true }) })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await listCompetenceAreas("t", "team-1", {}, deps)).toEqual({ ok: true, areas: [], canEdit: true, truncated: false });
  });

  it("fails the read when a stored assignment is malformed, rather than skipping it", async () => {
    const bad = { id: competenceAreaDocId("team-1", TREE_B), data: { teamId: "team-1", treeId: TREE_B, status: "active", sortOrder: -1, createdAt: EARLIER, updatedAt: EARLIER } };
    const { deps } = build({ areas: [area("team-1", TREE_A), bad] });
    expect(await listCompetenceAreas("t", "team-1", {}, deps)).toEqual({ ok: false, error: "read_failed" });
  });
});
