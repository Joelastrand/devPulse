import { describe, expect, it, vi } from "vitest";
import { TEAM_SYSTEM_LIMITS } from "../domain/team-system";
import { writeTeamSystem, type WriteTeamSystemDeps, type WriteTeamSystemTx } from "./write-team-system";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

// The erasure fence is a Firestore transaction read; the fake store below does not exercise it.
vi.mock("../../auth/server/erasure-write-fence", () => ({
  runFencedTransaction: vi.fn(),
  writeRefusalFor: () => "persistence_failed",
}));

const NOW = new Date("2026-06-01T09:00:00Z");
const EARLIER = new Date("2026-05-01T09:00:00Z");
const REF = (n: number) => `${String(n).padStart(2, "0")}bbbbbbbbbbbbbbbbbbbbbbbb`;

interface World {
  teams?: Record<string, unknown>;
  memberships?: Array<Record<string, unknown>>;
  systems?: Record<string, Record<string, unknown>>;
  systemCount?: number;
}

interface Writes {
  created: Array<{ id: string; data: Record<string, unknown> }>;
  set: Array<{ id: string; data: Record<string, unknown> }>;
  touched: Array<{ uid: string; teamId: string; memberRef: string }>;
}

function membership(uid: string, n: number, teamId = "team-1") {
  return { uid, teamId, memberRef: REF(n), createdAt: EARLIER };
}

function existingSystem(teamId = "team-1", extra: Record<string, unknown> = {}) {
  const kept = { value: "god", note: "Stabil", assessedAt: EARLIER, assessedBy: "uid-old" };
  return {
    teamId,
    name: "Saksportalen",
    description: "Saksbehandling",
    backstageUrl: null,
    availability: kept,
    maintainability: { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    security: { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    knowledgeMemberRefs: [REF(1)],
    createdAt: EARLIER,
    createdBy: "uid-creator",
    updatedAt: EARLIER,
    updatedBy: "uid-old",
    ...extra,
  };
}

function build(world: World, callerUid = "uid-user-1", options: { verifyFails?: boolean } = {}) {
  const writes: Writes = { created: [], set: [], touched: [] };
  const tx: WriteTeamSystemTx = {
    async getMembership(uid, teamId) {
      return (world.memberships ?? []).find((m) => m.uid === uid && m.teamId === teamId);
    },
    async getTeamStatus(teamId) {
      return world.teams?.[teamId];
    },
    async listMembershipsByRefs(teamId, refs) {
      return (world.memberships ?? []).filter((m) => m.teamId === teamId && refs.includes(m.memberRef as string));
    },
    async countSystems() {
      return world.systemCount ?? Object.keys(world.systems ?? {}).length;
    },
    async getSystem(systemId) {
      return world.systems?.[systemId];
    },
    createSystem(id, data) {
      writes.created.push({ id, data });
    },
    setSystem(id, data) {
      writes.set.push({ id, data });
    },
    touchMembership(uid, teamId, memberRef) {
      writes.touched.push({ uid, teamId, memberRef });
    },
  };
  const deps: WriteTeamSystemDeps = {
    verifyToken: options.verifyFails
      ? vi.fn().mockRejectedValue(new Error("bad token"))
      : vi.fn().mockResolvedValue({ uid: callerUid, email: `${callerUid}@example.test`, email_verified: true }),
    store: {
      async runWriteTransaction(_actor, fn) {
        return fn(tx);
      },
    },
    now: () => NOW,
    newSystemId: () => "sys-new",
  };
  return { deps, writes };
}

const activeWorld = (extra: World = {}): World => ({
  teams: { "team-1": "active", "team-2": "active" },
  memberships: [membership("uid-user-1", 1), membership("uid-user-2", 2), membership("uid-other", 3, "team-2")],
  ...extra,
});

describe("writeTeamSystem — create authorization (BR-4)", () => {
  it("creates a system for a member on an active team with server-side defaults", async () => {
    const { deps, writes } = build(activeWorld());
    const result = await writeTeamSystem("token", "team-1", null, { name: " Saksportalen " }, deps);

    expect(result).toEqual({ ok: true, systemId: "sys-new" });
    expect(writes.created).toHaveLength(1);
    const data = writes.created[0].data;
    expect(data.teamId).toBe("team-1");
    expect(data.name).toBe("Saksportalen");
    expect(data.createdBy).toBe("uid-user-1");
    expect(data.availability).toEqual({ value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null });
  });

  it("refuses a non-member with forbidden and writes nothing", async () => {
    const { deps, writes } = build(activeWorld(), "uid-stranger");
    expect(await writeTeamSystem("token", "team-1", null, { name: "X" }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses an app admin who is not a member (admin has no write right)", async () => {
    const { deps, writes } = build(activeWorld(), "uid-admin");
    expect(await writeTeamSystem("token", "team-1", null, { name: "X" }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses a member of a disabled team with team_disabled", async () => {
    const { deps, writes } = build(activeWorld({ teams: { "team-1": "disabled" } }));
    expect(await writeTeamSystem("token", "team-1", null, { name: "X" }, deps)).toEqual({ ok: false, error: "team_disabled" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses an unverifiable token as unauthenticated", async () => {
    const { deps } = build(activeWorld(), "uid-user-1", { verifyFails: true });
    expect(await writeTeamSystem("bad", "team-1", null, { name: "X" }, deps)).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("refuses creation once the team is at its system limit", async () => {
    const { deps, writes } = build(activeWorld({ systemCount: TEAM_SYSTEM_LIMITS.systemsPerTeamMax }));
    expect(await writeTeamSystem("token", "team-1", null, { name: "X" }, deps)).toEqual({ ok: false, error: "limit_reached" });
    expect(writes.created).toHaveLength(0);
  });
});

describe("writeTeamSystem — body validation (BR-4, BR-8)", () => {
  it.each([
    ["unknown key", { name: "X", teamId: "team-2" }, "invalid_request"],
    ["uid smuggled as knowledge", { name: "X", knowledgeMemberRefs: ["uid-user-2"] }, "invalid_input"],
    ["plain http backstage link", { name: "X", backstageUrl: "http://backstage.example.test" }, "invalid_input"],
    ["javascript backstage link", { name: "X", backstageUrl: "javascript:alert(1)" }, "invalid_input"],
    ["missing name", { description: "x" }, "invalid_input"],
    ["unknown assessment attribute", { name: "X", assessments: { uptime: { value: "god" } } }, "invalid_input"],
    ["unknown assessment value", { name: "X", assessments: { security: { value: "100%" } } }, "invalid_input"],
    ["duplicate knowledge refs", { name: "X", knowledgeMemberRefs: [REF(1), REF(1)] }, "invalid_input"],
  ])("rejects %s", async (_label, body, error) => {
    const { deps, writes } = build(activeWorld());
    expect(await writeTeamSystem("token", "team-1", null, body, deps)).toEqual({ ok: false, error });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects a body that is not a JSON object", async () => {
    const { deps } = build(activeWorld());
    expect(await writeTeamSystem("token", "team-1", null, ["x"], deps)).toEqual({ ok: false, error: "invalid_request" });
  });
});

describe("writeTeamSystem — knowledge associations (BR-7)", () => {
  it("stores only refs that resolve to a current membership of this team", async () => {
    const { deps, writes } = build(activeWorld());
    const result = await writeTeamSystem("token", "team-1", null, { name: "X", knowledgeMemberRefs: [REF(2)] }, deps);

    expect(result.ok).toBe(true);
    expect(writes.created[0].data.knowledgeMemberRefs).toEqual([REF(2)]);
    expect(writes.touched).toEqual([{ uid: "uid-user-2", teamId: "team-1", memberRef: REF(2) }]);
  });

  it("rejects a ref that belongs to another team", async () => {
    const { deps, writes } = build(activeWorld());
    const result = await writeTeamSystem("token", "team-1", null, { name: "X", knowledgeMemberRefs: [REF(3)] }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_knowledge" });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects a ref that matches no membership", async () => {
    const { deps } = build(activeWorld());
    const result = await writeTeamSystem("token", "team-1", null, { name: "X", knowledgeMemberRefs: [REF(9)] }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_knowledge" });
  });

  it("refuses more than 50 associations", async () => {
    const refs = Array.from({ length: 51 }, (_, i) => `${String(i).padStart(26, "0")}`);
    const { deps } = build(activeWorld());
    expect(await writeTeamSystem("token", "team-1", null, { name: "X", knowledgeMemberRefs: refs }, deps)).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });
});

describe("writeTeamSystem — update (BR-5, BR-6)", () => {
  const worldWithSystem = () =>
    activeWorld({ systems: { "sys-1": existingSystem() as Record<string, unknown> } });

  it("keeps an unchanged assessment's time and assessor", async () => {
    const { deps, writes } = build(worldWithSystem());
    const result = await writeTeamSystem(
      "token",
      "team-1",
      "sys-1",
      { assessments: { availability: { value: "god", note: "Stabil" } } },
      deps,
    );

    expect(result).toEqual({ ok: true, systemId: "sys-1" });
    const data = writes.set[0].data;
    expect(data.availability).toEqual({ value: "god", note: "Stabil", assessedAt: EARLIER, assessedBy: "uid-old" });
  });

  it("stamps time and assessor when an assessment value changes", async () => {
    const { deps, writes } = build(worldWithSystem());
    await writeTeamSystem(
      "token",
      "team-1",
      "sys-1",
      { assessments: { availability: { value: "kritisk", note: "Stabil" } } },
      deps,
    );
    expect(writes.set[0].data.availability).toEqual({ value: "kritisk", note: "Stabil", assessedAt: NOW, assessedBy: "uid-user-1" });
  });

  it("keeps an erased creator as null on edit (A-13): the editing member is never stamped as creator", async () => {
    const erased = activeWorld({
      systems: { "sys-1": existingSystem("team-1", { createdBy: null, updatedBy: null }) as Record<string, unknown> },
    });
    const { deps, writes } = build(erased);

    const result = await writeTeamSystem("token", "team-1", "sys-1", { name: "Nytt navn" }, deps);

    expect(result).toEqual({ ok: true, systemId: "sys-1" });
    expect(writes.set[0].data).toMatchObject({ name: "Nytt navn", createdBy: null, updatedBy: "uid-user-1" });
  });

  it("keeps the original creator while recording the updater", async () => {
    const { deps, writes } = build(worldWithSystem());
    await writeTeamSystem("token", "team-1", "sys-1", { name: "Nytt navn" }, deps);
    expect(writes.set[0].data).toMatchObject({
      name: "Nytt navn",
      createdBy: "uid-creator",
      createdAt: EARLIER,
      updatedBy: "uid-user-1",
      updatedAt: NOW,
    });
  });

  it("does not let a member of team 1 update a system of team 2 (returns not_found)", async () => {
    const world = activeWorld({ systems: { "sys-1": existingSystem("team-2") as Record<string, unknown> } });
    const { deps, writes } = build(world);
    expect(await writeTeamSystem("token", "team-1", "sys-1", { name: "X" }, deps)).toEqual({ ok: false, error: "not_found" });
    expect(writes.set).toHaveLength(0);
  });

  it("returns not_found for an unknown system id", async () => {
    const { deps } = build(activeWorld());
    expect(await writeTeamSystem("token", "team-1", "missing", { name: "X" }, deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses an update by a non-member", async () => {
    const { deps, writes } = build(worldWithSystem(), "uid-stranger");
    expect(await writeTeamSystem("token", "team-1", "sys-1", { name: "X" }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.set).toHaveLength(0);
  });

  it("only touches memberships newly associated, not those already present", async () => {
    const { deps, writes } = build(worldWithSystem());
    await writeTeamSystem("token", "team-1", "sys-1", { knowledgeMemberRefs: [REF(1), REF(2)] }, deps);
    expect(writes.touched).toEqual([{ uid: "uid-user-2", teamId: "team-1", memberRef: REF(2) }]);
  });
});

describe("writeTeamSystem — knowledge refs beyond 501 memberships (no team-wide cap)", () => {
  const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
  const validRef = (index: number): string => {
    let value = index + 1;
    let out = "";
    for (let i = 0; i < 26; i += 1) {
      out = CROCKFORD[value % 32] + out;
      value = Math.floor(value / 32);
    }
    return out;
  };
  const bigTeam = (count: number): World => ({
    teams: { "team-1": "active" },
    memberships: Array.from({ length: count }, (_, index) => ({
      uid: index === 0 ? "uid-user-1" : `uid-m${index}`,
      teamId: "team-1",
      memberRef: validRef(index),
      createdAt: EARLIER,
    })),
  });

  it.each([1, 2, 500, 501, 600])("accepts a ref to the last of %i memberships and records the knowledge", async (count) => {
    const { deps, writes } = build(bigTeam(count));
    const result = await writeTeamSystem("token", "team-1", null, { name: "Stor", knowledgeMemberRefs: [validRef(count - 1)] }, deps);
    expect(result).toEqual({ ok: true, systemId: "sys-new" });
    expect(writes.created[0].data.knowledgeMemberRefs).toEqual([validRef(count - 1)]);
  });

  it("refuses an unknown ref in a team of more than 501 memberships (fails closed, no false acceptance)", async () => {
    const { deps, writes } = build(bigTeam(600));
    const result = await writeTeamSystem("token", "team-1", null, { name: "Stor", knowledgeMemberRefs: [validRef(900)] }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_knowledge" });
    expect(writes.created).toHaveLength(0);
  });

  it("accepts 50 refs spread across a team of 600 memberships, checked in chunks", async () => {
    const refs = Array.from({ length: 50 }, (_, i) => validRef(550 + i));
    const { deps, writes } = build(bigTeam(600));
    const result = await writeTeamSystem("token", "team-1", null, { name: "Mange", knowledgeMemberRefs: refs }, deps);
    expect(result.ok).toBe(true);
    expect(writes.created[0].data.knowledgeMemberRefs).toEqual(refs);
    expect(writes.touched.map((t) => t.memberRef).sort()).toEqual([...refs].sort());
  });
});
