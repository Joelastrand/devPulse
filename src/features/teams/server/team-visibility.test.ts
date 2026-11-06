import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideTeamVisibility,
  setTeamVisibility,
  type TeamVisibilityCollection,
  type VisibilityDecision,
  type VisibilityReads,
} from "./team-visibility";

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
const NOW = new Date("2026-11-01T00:00:00Z");

const teamDoc = (overrides: Record<string, unknown> = {}) => ({ name: "Team Alfa", status: "active", visibility: "private", ...overrides });
const membershipDoc = (uid: string, role?: string) => ({ uid, teamId: TEAM, createdVia: "invitation", ...(role ? { role } : {}) });

function tokenFor(uid: string, email = `${uid}@example.com`) {
  return vi.fn().mockResolvedValue({ uid, email, email_verified: true });
}

/** Applies one decision against a fixed snapshot and records the single write it would make. */
function fakeCollection(reads: VisibilityReads) {
  const log = { writes: [] as Array<Record<string, unknown>> };
  const collection: TeamVisibilityCollection = {
    async run(_uid, _teamId, decide, now) {
      const decision: VisibilityDecision = decide(reads);
      if (decision.kind === "write") log.writes.push({ visibility: decision.visibility, visibilityUpdatedAt: now });
      return decision;
    },
  };
  return { collection, log };
}

describe("decideTeamVisibility", () => {
  const base = { teamId: TEAM, visibility: "public" as const };

  it("lets a teamadmin of an active team change visibility", () => {
    const d = decideTeamVisibility({ ...base, isSuperadmin: false, uid: "t1", reads: { team: teamDoc(), membership: membershipDoc("t1", "teamadmin") } });
    expect(d).toEqual({ kind: "write", visibility: "public" });
  });

  it("lets a superadmin change visibility of a team they are not a member of", () => {
    const d = decideTeamVisibility({ ...base, isSuperadmin: true, uid: "admin-1", reads: { team: teamDoc(), membership: undefined } });
    expect(d).toEqual({ kind: "write", visibility: "public" });
  });

  it("refuses an ordinary member and a legacy lead, with no write", () => {
    for (const membership of [membershipDoc("m1"), membershipDoc("m1", "lead")]) {
      const d = decideTeamVisibility({ ...base, isSuperadmin: false, uid: "m1", reads: { team: teamDoc(), membership } });
      expect(d).toEqual({ kind: "refused", error: "forbidden" });
    }
  });

  it("refuses a teamadmin of another team", () => {
    const foreign = { ...membershipDoc("t2", "teamadmin"), teamId: "team-2" };
    const d = decideTeamVisibility({ ...base, isSuperadmin: false, uid: "t2", reads: { team: teamDoc(), membership: foreign } });
    expect(d).toEqual({ kind: "refused", error: "forbidden" });
  });

  it("refuses any change on a disabled team, even for a superadmin", () => {
    const d = decideTeamVisibility({ ...base, isSuperadmin: true, uid: "admin-1", reads: { team: teamDoc({ status: "disabled" }), membership: undefined } });
    expect(d).toEqual({ kind: "refused", error: "team_disabled" });
  });

  it("reports a missing or malformed team as not_found", () => {
    expect(decideTeamVisibility({ ...base, isSuperadmin: true, uid: "admin-1", reads: { team: undefined, membership: undefined } })).toEqual({ kind: "refused", error: "not_found" });
    expect(decideTeamVisibility({ ...base, isSuperadmin: true, uid: "admin-1", reads: { team: teamDoc({ status: "bogus" }), membership: undefined } })).toEqual({ kind: "refused", error: "not_found" });
  });

  it("makes an equal visibility a no-op (idempotent)", () => {
    const d = decideTeamVisibility({ ...base, visibility: "private", isSuperadmin: true, uid: "admin-1", reads: { team: teamDoc(), membership: undefined } });
    expect(d).toEqual({ kind: "noop", visibility: "private" });
  });

  it("treats a team with no visibility field as private", () => {
    const legacy = { name: "Team Alfa", status: "active" };
    const d = decideTeamVisibility({ ...base, visibility: "private", isSuperadmin: true, uid: "admin-1", reads: { team: legacy, membership: undefined } });
    expect(d).toEqual({ kind: "noop", visibility: "private" });
  });
});

describe("setTeamVisibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid visibility value before any write", async () => {
    const { collection, log } = fakeCollection({ team: teamDoc(), membership: membershipDoc("t1", "teamadmin") });
    const result = await setTeamVisibility("tok", TEAM, "shared", { collection, verifyToken: tokenFor("t1"), isSuperadmin: async (uid: string) => uid === "admin-1" });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(log.writes).toHaveLength(0);
  });

  it("refuses an unverifiable token before reading any team state", async () => {
    const { collection, log } = fakeCollection({ team: teamDoc(), membership: undefined });
    const result = await setTeamVisibility("", TEAM, "public", { collection, verifyToken: vi.fn().mockRejectedValue(new Error("x")), isSuperadmin: async (uid: string) => uid === "admin-1" });
    expect(result.ok).toBe(false);
    expect(log.writes).toHaveLength(0);
  });

  it("writes only visibility and the timestamp for a teamadmin, and stores no actor uid", async () => {
    const { collection, log } = fakeCollection({ team: teamDoc(), membership: membershipDoc("t1", "teamadmin") });
    const result = await setTeamVisibility("tok", TEAM, "public", { collection, verifyToken: tokenFor("t1"), now: NOW, isSuperadmin: async (uid: string) => uid === "admin-1" });
    expect(result).toEqual({ ok: true, visibility: "public", changed: true });
    expect(log.writes).toEqual([{ visibility: "public", visibilityUpdatedAt: NOW }]);
    expect(JSON.stringify(log.writes)).not.toContain("t1");
  });

  it("allows a superadmin identified through the app-admin allow-list", async () => {
    const { collection } = fakeCollection({ team: teamDoc(), membership: undefined });
    const result = await setTeamVisibility("tok", TEAM, "public", {
      collection,
      verifyToken: tokenFor("admin-1", ADMIN_EMAIL),
      isSuperadmin: async (uid: string) => uid === "admin-1",
      now: NOW,
    });
    expect(result).toEqual({ ok: true, visibility: "public", changed: true });
  });

  it("returns forbidden for an ordinary member with no write", async () => {
    const { collection, log } = fakeCollection({ team: teamDoc(), membership: membershipDoc("m1") });
    const result = await setTeamVisibility("tok", TEAM, "public", { collection, verifyToken: tokenFor("m1"), isSuperadmin: async (uid: string) => uid === "admin-1" });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(log.writes).toHaveLength(0);
  });
});
