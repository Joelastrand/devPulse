import { describe, expect, it, vi } from "vitest";
import { skillNeedDocId, type SkillNeedRecord } from "../domain/skill-need";
import { listSkillNeeds, type ListSkillNeedsDeps } from "./list-skill-needs";
import type { SkillNeedCatalogReader } from "./skill-need-catalog";
import { getDefaultSkillNeedsStore, type SkillNeedsReader } from "./skill-needs-store";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const TEAM = "team-1";
const ADMIN_EMAIL = "admin@example.com";
const WHEN = new Date("2026-02-01T00:00:00Z");

type Caller = "member" | "lead" | "memberAdmin" | "leadAdmin" | "nonMemberAdmin" | "unrelated";

const CALLERS: Record<Caller, { uid: string; email: string; membership?: Record<string, unknown> }> = {
  member: { uid: "u-member", email: "member@example.com", membership: { role: "member" } },
  lead: { uid: "u-lead", email: "lead@example.com", membership: { role: "lead" } },
  memberAdmin: { uid: "u-madmin", email: ADMIN_EMAIL, membership: {} },
  leadAdmin: { uid: "u-ladmin", email: ADMIN_EMAIL, membership: { role: "lead" } },
  nonMemberAdmin: { uid: "u-nadmin", email: ADMIN_EMAIL },
  unrelated: { uid: "u-other", email: "other@example.com" },
};

function validTree(name: string) {
  return {
    name,
    nodes: [
      { nodeId: "node-0", label: "A", order: 0 },
      { nodeId: "node-1", label: "B", order: 1 },
    ],
    createdAt: WHEN,
    createdBy: "admin",
  };
}

function needDoc(treeId: string, overrides: Record<string, unknown> = {}, teamId = TEAM) {
  const data: SkillNeedRecord = {
    teamId,
    treeId,
    requiredLevel: 3,
    requiredCoverage: 2,
    createdAt: WHEN,
    updatedAt: WHEN,
  };
  return { id: skillNeedDocId(teamId, treeId), data: { ...data, ...overrides } as unknown };
}

interface Setup {
  caller: Caller | "signedOut";
  teamStatus?: unknown;
  needs?: Array<{ id: string; data: unknown }>;
  trees?: Record<string, unknown>;
  failNeeds?: boolean;
  failTree?: boolean;
  failCatalog?: boolean;
  failMembership?: boolean;
  failTeam?: boolean;
  catalogDocs?: Array<{ id: string; data: unknown }>;
}

function setup(s: Setup) {
  const writes = vi.fn();
  const caller = s.caller === "signedOut" ? undefined : CALLERS[s.caller];
  const teamStatus = "teamStatus" in s ? s.teamStatus : "active";
  const accessReads = {
    async getTeamStatus() {
      if (s.failTeam) throw new Error("boom");
      return teamStatus;
    },
    async getMembership(uid: string, teamId: string) {
      if (s.failMembership) throw new Error("boom");
      const entry = Object.values(CALLERS).find((c) => c.uid === uid);
      return entry?.membership ? { uid, teamId, ...entry.membership } : undefined;
    },
  };
  const reader: SkillNeedsReader = {
    async listByTeam(_teamId, limit) {
      if (s.failNeeds) throw new Error("boom");
      return (s.needs ?? []).slice(0, limit);
    },
  };
  const catalogReader: SkillNeedCatalogReader = {
    async listOrderedByCreatedAt(limit) {
      if (s.failCatalog) throw new Error("boom");
      return (s.catalogDocs ?? []).slice(0, limit);
    },
    async getSkillTree(treeId) {
      if (s.failTree) throw new Error("boom");
      return s.trees?.[treeId];
    },
  };
  const deps: ListSkillNeedsDeps = {
    verifyToken: vi.fn(async () => {
      if (!caller) throw new Error("bad token");
      return { uid: caller.uid, email: caller.email, email_verified: true } as never;
    }),
    allowList: [ADMIN_EMAIL],
    collection: accessReads,
    reads: accessReads,
    store: getDefaultSkillNeedsStore(reader),
    catalogReader,
  };
  return { deps, writes };
}

const run = (s: Setup) => listSkillNeeds("token", TEAM, setup(s).deps);

describe("need read authorization", () => {
  it.each(["member", "lead", "memberAdmin", "leadAdmin", "nonMemberAdmin"] as const)(
    "%s may read on an active team",
    async (caller) => {
      expect((await run({ caller })).ok).toBe(true);
    },
  );

  it.each(["member", "lead", "nonMemberAdmin"] as const)("%s may read on a disabled team", async (caller) => {
    expect((await run({ caller, teamStatus: "disabled" })).ok).toBe(true);
  });

  it.each(["active", "disabled"])("an unrelated user is forbidden on a %s team", async (teamStatus) => {
    expect(await run({ caller: "unrelated", teamStatus })).toEqual({ ok: false, error: "forbidden" });
  });

  it("a signed-out caller is unauthenticated", async () => {
    expect(await run({ caller: "signedOut" })).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("a non-existent team or invalid status is forbidden for everyone, admins included", async () => {
    expect(await run({ caller: "member", teamStatus: undefined })).toEqual({ ok: false, error: "forbidden" });
    expect(await run({ caller: "nonMemberAdmin", teamStatus: "weird" })).toEqual({ ok: false, error: "forbidden" });
  });

  it("a stored membership of another team or uid is not accepted (no memberRef/e-mail proof)", async () => {
    const { deps } = setup({ caller: "unrelated" });
    const forged = {
      async getTeamStatus() {
        return "active";
      },
      async getMembership() {
        return { uid: "someone-else", teamId: TEAM, role: "lead", memberRef: "m-1", email: "other@example.com" };
      },
    };
    const result = await listSkillNeeds("token", TEAM, { ...deps, collection: forged, reads: forged });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it.each(["failTeam", "failMembership"] as const)("%s ⇒ read_failed, never forbidden", async (flag) => {
    expect(await run({ caller: "member", [flag]: true })).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("viewer hints", () => {
  const viewerOf = async (s: Setup) => {
    const result = await run(s);
    if (!result.ok) throw new Error("expected ok");
    return result.viewer;
  };

  it("lead on an active team can manage and read coverage", async () => {
    expect(await viewerOf({ caller: "lead" })).toEqual({ canManageNeeds: true, canReadCoverage: true });
  });
  it("lead on a disabled team gets neither", async () => {
    expect(await viewerOf({ caller: "lead", teamStatus: "disabled" })).toEqual({ canManageNeeds: false, canReadCoverage: false });
  });
  it("ordinary member can read coverage only", async () => {
    expect(await viewerOf({ caller: "member" })).toEqual({ canManageNeeds: false, canReadCoverage: true });
  });
  it("member + app admin stays a member", async () => {
    expect(await viewerOf({ caller: "memberAdmin" })).toEqual({ canManageNeeds: false, canReadCoverage: true });
  });
  it("admin-only caller gets both false", async () => {
    expect(await viewerOf({ caller: "nonMemberAdmin" })).toEqual({ canManageNeeds: false, canReadCoverage: false });
  });
  it("lead + app admin keeps the lead hints", async () => {
    expect(await viewerOf({ caller: "leadAdmin" })).toEqual({ canManageNeeds: true, canReadCoverage: true });
  });
});

describe("need listing", () => {
  it("returns an empty successful list distinguishably from a failure", async () => {
    const result = await run({ caller: "member" });
    expect(result).toMatchObject({ ok: true, needs: [], catalog: [], needsTruncated: false, catalogTruncated: false });
  });

  it("a need-read failure is read_failed, not an empty success", async () => {
    expect(await run({ caller: "member", failNeeds: true })).toEqual({ ok: false, error: "read_failed" });
  });

  it("a tree-read failure is read_failed (not an unavailable area)", async () => {
    expect(await run({ caller: "member", needs: [needDoc("t1")], failTree: true })).toEqual({
      ok: false,
      error: "read_failed",
    });
  });

  it("a catalog-read failure is read_failed", async () => {
    expect(await run({ caller: "member", failCatalog: true })).toEqual({ ok: false, error: "read_failed" });
  });

  it("maps valid needs with live area names and sorts by name, unavailable last", async () => {
    const result = await run({
      caller: "lead",
      needs: [needDoc("t-zeta"), needDoc("t-gone", { requiredLevel: 4 }), needDoc("t-alfa", { requiredCoverage: 7 })],
      trees: { "t-zeta": validTree("Zeta"), "t-alfa": validTree("Alfa"), "t-gone": { name: "x", nodes: [] } },
    });

    expect(result).toMatchObject({
      ok: true,
      needs: [
        { treeId: "t-alfa", areaName: "Alfa", areaAvailable: true, requiredLevel: 3, requiredCoverage: 7 },
        { treeId: "t-zeta", areaName: "Zeta", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 },
        { treeId: "t-gone", areaName: null, areaAvailable: false, requiredLevel: 4, requiredCoverage: 2 },
      ],
    });
  });

  it("a missing tree is areaAvailable:false", async () => {
    const result = await run({ caller: "member", needs: [needDoc("t1")], trees: {} });
    expect(result).toMatchObject({ ok: true, needs: [{ treeId: "t1", areaName: null, areaAvailable: false }] });
  });

  it("skips malformed and foreign-team needs; raw content never reaches the result", async () => {
    const result = await run({
      caller: "member",
      needs: [
        needDoc("t1"),
        needDoc("t2", { requiredLevel: 1, secretNote: "leak-me" }),
        needDoc("t3", { requiredCoverage: 0 }),
        needDoc("t4", {}, "team-2"),
      ],
      trees: { t1: validTree("One"), t2: validTree("Two"), t3: validTree("Three"), t4: validTree("Four") },
    });

    expect(result.ok && result.needs.map((n) => n.treeId)).toEqual(["t1"]);
    expect(JSON.stringify(result)).not.toContain("leak-me");
  });

  it("flags needs truncation on a 501st raw document", async () => {
    const needs = Array.from({ length: 501 }, (_, i) => needDoc(`t${i}`));
    const result = await run({ caller: "member", needs });
    expect(result.ok && result.needs.length).toBe(500);
    expect(result.ok && result.needsTruncated).toBe(true);
  });

  it("returns the catalog with truncation flag", async () => {
    const catalogDocs = Array.from({ length: 501 }, (_, i) => ({
      id: `c${String(i).padStart(3, "0")}`,
      data: validTree(`Area ${i}`),
    }));
    const result = await run({ caller: "member", catalogDocs });
    expect(result.ok && result.catalog.length).toBe(500);
    expect(result.ok && result.catalogTruncated).toBe(true);
  });

  it("result carries only the approved keys and no personal data", async () => {
    const result = await run({
      caller: "lead",
      needs: [needDoc("t1")],
      trees: { t1: validTree("One") },
      catalogDocs: [{ id: "t1", data: validTree("One") }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(
      ["catalog", "catalogTruncated", "needs", "needsTruncated", "ok", "viewer"].sort(),
    );
    expect(Object.keys(result.needs[0]).sort()).toEqual(
      ["areaAvailable", "areaName", "requiredCoverage", "requiredLevel", "treeId"].sort(),
    );
    expect(Object.keys(result.catalog[0]).sort()).toEqual(["name", "treeId"]);
    const json = JSON.stringify(result);
    for (const forbidden of ["u-lead", "lead@example.com", "memberRef", "createdAt", "createdBy", "covered", "contributor"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
