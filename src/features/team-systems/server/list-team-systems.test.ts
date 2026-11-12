import { sealedProfileFixture } from "../../profiles/domain/user-profile-test-fixtures";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import { MEMBER_REF_LOOKUP_CHUNK_SIZE } from "../domain/team-system";
import { listTeamSystems, type ListTeamSystemsDeps, type RawDoc, type TeamSystemsReadStore } from "./list-team-systems";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const T0 = new Date("2026-01-01T00:00:00Z");
const REF = (n: number) => `${String(n).padStart(2, "0")}bbbbbbbbbbbbbbbbbbbbbbbb`;

function membership(uid: string, n: number, teamId = "team-1") {
  return { uid, teamId, createdAt: T0, memberRef: REF(n), grantedBy: "uid-admin-secret" };
}

function system(name: string, extra: Record<string, unknown> = {}, teamId = "team-1"): RawDoc {
  const assessment = { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null };
  return {
    id: `sys-${name.toLowerCase()}`,
    data: {
      teamId,
      name,
      description: null,
      backstageUrl: null,
      availability: assessment,
      maintainability: assessment,
      security: assessment,
      knowledgeMemberRefs: [],
      createdAt: T0,
      createdBy: "uid-creator-secret",
      updatedAt: T0,
      updatedBy: "uid-updater-secret",
      ...extra,
    },
  };
}

interface World {
  teams?: Record<string, unknown>;
  memberships?: unknown[];
  systems?: RawDoc[];
  profiles?: Record<string, string>;
}

function build(world: World, callerUid = "uid-user-1", options: { verifyFails?: boolean } = {}) {
  const collection: AuthorizeTeamAccessCollection = {
    async getTeamStatus(teamId) {
      return world.teams?.[teamId];
    },
    async getMembership(uid, teamId) {
      return (world.memberships ?? []).find(
        (m) => (m as { uid: string; teamId: string }).uid === uid && (m as { teamId: string }).teamId === teamId,
      );
    },
  };
  const store: TeamSystemsReadStore = {
    async listSystems(teamId, limit) {
      return (world.systems ?? []).filter((doc) => (doc.data as { teamId: string }).teamId === teamId).slice(0, limit);
    },
    async listMembershipsByRefs(teamId, refs) {
      return (world.memberships ?? []).filter(
        (m) => (m as { teamId: string; memberRef: string }).teamId === teamId && refs.includes((m as { memberRef: string }).memberRef),
      );
    },
    async getMembership(uid, teamId) {
      return collection.getMembership(uid, teamId);
    },
    async getTeamStatus(teamId) {
      return collection.getTeamStatus(teamId);
    },
  };
  const deps: ListTeamSystemsDeps = {
    verifyToken: options.verifyFails
      ? vi.fn().mockRejectedValue(new Error("bad token"))
      : vi.fn().mockResolvedValue({ uid: callerUid, email: callerUid === "uid-admin" ? "admin@example.test" : `${callerUid}@example.test`, email_verified: true }),
    isSuperadmin: async (uid: string) => uid === "uid-admin",
    collection,
    store,
    profileReader: {
      async readBatch(uids) {
        return uids.map((uid) => ({ uid, data: world.profiles?.[uid] ? sealedProfileFixture(uid, { displayName: world.profiles[uid], createdAt: T0, updatedAt: T0 }) : undefined }));
      },
    },
  };
  return deps;
}

const activeTeamWorld = (extra: World = {}): World => ({
  teams: { "team-1": "active", "team-2": "active" },
  memberships: [membership("uid-user-1", 1), membership("uid-user-2", 2)],
  ...extra,
});

describe("listTeamSystems — authorization (BR-2)", () => {
  it("refuses an unverifiable token as unauthenticated", async () => {
    const result = await listTeamSystems("bad", "team-1", build(activeTeamWorld(), "uid-user-1", { verifyFails: true }));
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("refuses a signed-in non-member with forbidden and returns no systems", async () => {
    const result = await listTeamSystems(
      "token",
      "team-1",
      build(activeTeamWorld({ systems: [system("Saksportalen")] }), "uid-stranger"),
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a member of team 1 reading team 2 (cross-team isolation)", async () => {
    const result = await listTeamSystems("token", "team-2", build(activeTeamWorld({ systems: [system("Hemmelig", {}, "team-2")] })));
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("lets an app admin who is not a member read the list, but not write (canEdit false)", async () => {
    const world = activeTeamWorld({ systems: [system("Saksportalen")] });
    const result = await listTeamSystems("token", "team-1", build(world, "uid-admin"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.systems.map((s) => s.name)).toEqual(["Saksportalen"]);
      expect(result.canEdit).toBe(false);
    }
  });

  it("reports canEdit true for a member of an active team and false on a disabled team", async () => {
    const active = await listTeamSystems("token", "team-1", build(activeTeamWorld()));
    const disabled = await listTeamSystems(
      "token",
      "team-1",
      build(activeTeamWorld({ teams: { "team-1": "disabled" } })),
    );
    expect(active.ok && active.canEdit).toBe(true);
    expect(disabled.ok && disabled.canEdit).toBe(false);
  });
});

describe("listTeamSystems — isolation and validation", () => {
  it("returns only systems stored with the requested team", async () => {
    const world = activeTeamWorld({ systems: [system("Mine"), system("Other", {}, "team-2")] });
    const result = await listTeamSystems("token", "team-1", build(world));
    expect(result.ok && result.systems.map((s) => s.name)).toEqual(["Mine"]);
  });

  it("skips a malformed stored document without failing the whole list", async () => {
    const broken: RawDoc = { id: "sys-broken", data: { teamId: "team-1", name: "" } };
    const world = activeTeamWorld({ systems: [system("Fine"), broken] });
    const result = await listTeamSystems("token", "team-1", build(world));
    expect(result.ok && result.systems.map((s) => s.name)).toEqual(["Fine"]);
  });

  it("reports truncation when more than 500 systems exist", async () => {
    const many = Array.from({ length: 501 }, (_, i) => system(`S${i}`, {}, "team-1"));
    const result = await listTeamSystems("token", "team-1", build(activeTeamWorld({ systems: many })));
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.systems).toHaveLength(500);
  });
});

describe("listTeamSystems — views (BR-3, BR-9, BR-10)", () => {
  it("resolves knowledge only from current memberships and derives band and attention", async () => {
    const world = activeTeamWorld({
      profiles: { "uid-user-1": "Ada Testsen" },
      systems: [
        system("Dataplattform", {
          knowledgeMemberRefs: [REF(1), REF(9)], // REF(9) has no membership
          security: { value: "kritisk", note: "Eldre bibliotek", assessedAt: T0, assessedBy: "uid-x" },
        }),
      ],
    });
    const result = await listTeamSystems("token", "team-1", build(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [view] = result.systems;
    expect(view.knowledge).toEqual([{ memberRef: REF(1), displayName: "Ada Testsen", isSelf: true }]);
    expect(view.knowledgeRisk).toBe("high");
    expect(view.attention).toBe(true);
    expect(view.assessments.security).toEqual({ value: "kritisk", note: "Eldre bibliotek", assessedAt: T0.toISOString() });
  });

  it("never returns uids, e-mails, membership ids or audit uids", async () => {
    const world = activeTeamWorld({
      profiles: { "uid-user-2": "Ola Testmann" },
      systems: [system("Saksportalen", { knowledgeMemberRefs: [REF(2)], backstageUrl: "https://backstage.example.test/x" })],
    });
    const result = await listTeamSystems("token", "team-1", build(world));
    const json = JSON.stringify(result);
    expect(json).not.toContain("uid-");
    expect(json).not.toMatch(/@/);
    expect(json).not.toContain("createdBy");
    expect(json).not.toContain("uid-creator-secret");
    expect(json).not.toContain("uid-admin-secret");
    expect(json).not.toContain("teamMemberships");
  });

  it("shows a missing display name as null and still counts the member", async () => {
    const world = activeTeamWorld({ systems: [system("Plattform", { knowledgeMemberRefs: [REF(2)] })] });
    const result = await listTeamSystems("token", "team-1", build(world));
    if (!result.ok) throw new Error("expected ok");
    expect(result.systems[0].knowledge).toEqual([{ memberRef: REF(2), displayName: null, isSelf: false }]);
    expect(result.systems[0].knowledgeRisk).toBe("high");
  });

  it("does not mark a system as attention or good standing when nothing is assessed", async () => {
    const result = await listTeamSystems("token", "team-1", build(activeTeamWorld({ systems: [system("Ny")] })));
    if (!result.ok) throw new Error("expected ok");
    expect(result.systems[0].attention).toBe(false);
    expect(result.systems[0].knowledgeRisk).toBe("none");
  });
});

describe("listTeamSystems — after account erasure (TASK-039, A-13 and A-14)", () => {
  it("still lists a system whose creator, editor and assessor were anonymized to null (the record is kept)", async () => {
    const erasedAssessment = { value: "god", note: "Stabil", assessedAt: T0, assessedBy: null };
    const world = activeTeamWorld({
      systems: [system("Arkiv", { createdBy: null, updatedBy: null, availability: erasedAssessment })],
    });

    const result = await listTeamSystems("token", "team-1", build(world));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.systems.map((view) => view.name)).toEqual(["Arkiv"]);
    expect(result.systems[0].assessments.availability).toEqual({ value: "god", note: "Stabil", assessedAt: T0.toISOString() });
  });

  it("recalculates knowledge risk from the remaining refs once an erased member's ref is detached", async () => {
    const before = activeTeamWorld({
      profiles: { "uid-user-1": "Ada Testsen" },
      systems: [system("Dataplattform", { knowledgeMemberRefs: [REF(1)] })],
    });
    const after = activeTeamWorld({
      profiles: { "uid-user-1": "Ada Testsen" },
      systems: [system("Dataplattform", { knowledgeMemberRefs: [] })],
    });

    const beforeResult = await listTeamSystems("token", "team-1", build(before));
    const afterResult = await listTeamSystems("token", "team-1", build(after));

    expect(beforeResult.ok && beforeResult.systems[0].knowledgeRisk).toBe("high");
    expect(afterResult.ok && afterResult.systems[0].knowledge).toEqual([]);
    expect(afterResult.ok && afterResult.systems[0].knowledgeRisk).toBe("none");
  });

  it("drops a ref whose membership no longer exists, so a stale ref never counts as knowledge", async () => {
    const world = activeTeamWorld({
      profiles: { "uid-user-1": "Ada Testsen" },
      systems: [system("Dataplattform", { knowledgeMemberRefs: [REF(9)] })],
    });

    const result = await listTeamSystems("token", "team-1", build(world));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.systems[0].knowledge).toEqual([]);
    expect(result.systems[0].knowledgeRisk).toBe("none");
  });
});

describe("listTeamSystems — read failures", () => {
  it("returns read_failed without leaking the underlying error when the store throws", async () => {
    const deps = build(activeTeamWorld());
    deps.store = {
      async listSystems() {
        throw new Error("secret internal detail");
      },
      async listMembershipsByRefs() {
        return [];
      },
      async getMembership() {
        return undefined;
      },
      async getTeamStatus() {
        return "active";
      },
    };
    const result = await listTeamSystems("token", "team-1", deps);
    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
  });
});

describe("listTeamSystems — membership count boundaries (knowledge resolution without a team-wide cap)", () => {
  const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
  /** Valid 26-character member refs for any index (the REF helper above is only valid for two-digit indexes). */
  const validRef = (index: number): string => {
    let value = index + 1;
    let out = "";
    for (let i = 0; i < 26; i += 1) {
      out = CROCKFORD[value % 32] + out;
      value = Math.floor(value / 32);
    }
    return out;
  };
  const memberAt = (index: number) => ({
    uid: `uid-m${index}`,
    teamId: "team-1",
    createdAt: T0,
    memberRef: validRef(index),
    grantedBy: "uid-admin-secret",
  });
  const teamWith = (count: number, systems: RawDoc[]): World => ({
    teams: { "team-1": "active" },
    memberships: Array.from({ length: count }, (_, index) => memberAt(index)),
    systems,
  });

  async function readWith(world: World) {
    const deps = build(world, "uid-m0");
    const lookups: string[][] = [];
    const baseStore = deps.store as TeamSystemsReadStore;
    const store: TeamSystemsReadStore = {
      ...baseStore,
      async listMembershipsByRefs(teamId, refs) {
        lookups.push([...refs]);
        return baseStore.listMembershipsByRefs(teamId, refs);
      },
    };
    const result = await listTeamSystems("token", "team-1", { ...deps, store });
    return { result, lookups };
  }

  it("reports no knowledge when a system names no resolvable member (the caller is the only membership)", async () => {
    // A reader must be a member, so the smallest team is one membership: the caller. A ref to nobody resolves to nothing.
    const { result } = await readWith(teamWith(1, [system("Tom", { knowledgeMemberRefs: [validRef(7)] })]));
    expect(result.ok && result.systems[0].knowledge).toEqual([]);
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("none");
  });

  it("reports no knowledge for a system with no refs at all", async () => {
    const { result } = await readWith(teamWith(1, [system("Tom", { knowledgeMemberRefs: [] })]));
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("none");
  });

  it("counts a single existing member as high risk with 1 membership", async () => {
    const { result } = await readWith(teamWith(1, [system("Ett", { knowledgeMemberRefs: [validRef(0)] })]));
    expect(result.ok && result.systems[0].knowledge).toHaveLength(1);
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("high");
  });

  it("counts two members as elevated risk with 2 memberships", async () => {
    const { result } = await readWith(teamWith(2, [system("To", { knowledgeMemberRefs: [validRef(0), validRef(1)] })]));
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("elevated");
  });

  it("resolves every ref in a team of exactly 500 memberships", async () => {
    const { result } = await readWith(teamWith(500, [system("Femhundre", { knowledgeMemberRefs: [validRef(0), validRef(499)] })]));
    expect(result.ok && result.systems[0].knowledge.map((k) => k.memberRef)).toEqual([validRef(0), validRef(499)]);
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("elevated");
  });

  it("resolves a ref beyond the first 501 memberships in a team of exactly 501 (no false absence)", async () => {
    const { result } = await readWith(teamWith(501, [system("Femhundreogen", { knowledgeMemberRefs: [validRef(500)] })]));
    expect(result.ok && result.systems[0].knowledge.map((k) => k.memberRef)).toEqual([validRef(500)]);
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("high");
  });

  it("resolves refs at the end of a team with more than 501 memberships and classifies them correctly", async () => {
    const refs = [validRef(0), validRef(550), validRef(599)];
    const { result } = await readWith(teamWith(600, [system("Stor", { knowledgeMemberRefs: refs })]));
    expect(result.ok && result.systems[0].knowledge.map((k) => k.memberRef)).toEqual(refs);
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("lower");
  });

  it("looks up only the distinct refs, in chunks bounded by MEMBER_REF_LOOKUP_CHUNK_SIZE, never a team-wide scan", async () => {
    const shared = [validRef(0), ...Array.from({ length: 24 }, (_, i) => validRef(550 + i))];
    const systems = [system("A", { knowledgeMemberRefs: shared }), system("B", { knowledgeMemberRefs: shared })];
    const { result, lookups } = await readWith(teamWith(600, systems));
    const requested = lookups.flat();
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested.sort()).toEqual([...shared].sort());
    expect(lookups.every((chunk) => chunk.length <= MEMBER_REF_LOOKUP_CHUNK_SIZE)).toBe(true);
    expect(result.ok && result.systems.map((s) => s.knowledge.length)).toEqual([25, 25]);
  });

  it("drops a ref that resolves to two memberships rather than guessing (fails closed)", async () => {
    const world = teamWith(3, [system("Dobbel", { knowledgeMemberRefs: [validRef(1)] })]);
    world.memberships = [...(world.memberships as unknown[]), { ...memberAt(1), uid: "uid-dup" }];
    const { result } = await readWith(world);
    expect(result.ok && result.systems[0].knowledge).toEqual([]);
    expect(result.ok && result.systems[0].knowledgeRisk).toBe("none");
  });
});
