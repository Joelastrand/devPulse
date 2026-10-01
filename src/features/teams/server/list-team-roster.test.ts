import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizeTeamAccessCollection } from "./authorize-team-access";
import {
  TEAM_ROSTER_MAX_MEMBERS,
  listTeamRoster,
  type ListTeamRosterDeps,
  type TeamRosterStore,
} from "./list-team-roster";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use — the roster must never look up Auth users");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const ADMIN_EMAIL = "admin@example.com";
const T0 = new Date("2026-01-01T00:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function tokenFor(uid: string, email = `${uid}@example.com`) {
  return vi.fn().mockResolvedValue({ uid, email, email_verified: true });
}

function member(uid: string, createdAt: Date, extra: Record<string, unknown> = {}) {
  return { uid, teamId: "team-1", createdAt, createdVia: "invitation", grantedBy: "admin-secret", ...extra };
}

interface World {
  teams?: Record<string, unknown>;
  memberships?: Record<string, Record<string, unknown>>; // key `${uid}__${teamId}`
  profiles?: Record<string, unknown>; // by uid
  rosterDocs?: Record<string, unknown[]>; // teamId -> raw membership docs (defaults to all memberships of that team)
  failAuthStatus?: boolean;
  failList?: boolean;
  failProfiles?: boolean;
}

function build(world: World) {
  const log = { listLimit: [] as number[], profileBatches: [] as string[][], statusReads: 0 };

  const collection: AuthorizeTeamAccessCollection = {
    async getTeamStatus(teamId) {
      if (world.failAuthStatus) throw new Error("secret internal detail");
      return world.teams?.[teamId];
    },
    async getMembership(uid, teamId) {
      return world.memberships?.[`${uid}__${teamId}`];
    },
  };

  const store: TeamRosterStore = {
    async listMemberships(teamId, limit) {
      log.listLimit.push(limit);
      if (world.failList) throw new Error("secret internal detail");
      const docs =
        world.rosterDocs?.[teamId] ??
        Object.values(world.memberships ?? {}).filter((doc) => doc.teamId === teamId);
      return docs.slice(0, limit);
    },
    async getTeamStatus(teamId) {
      log.statusReads += 1;
      return world.teams?.[teamId];
    },
  };

  const deps: ListTeamRosterDeps = {
    verifyToken: tokenFor("user-1"),
    allowList: [ADMIN_EMAIL],
    collection,
    store,
    profileReader: {
      async readBatch(uids) {
        log.profileBatches.push([...uids]);
        if (world.failProfiles) throw new Error("secret internal detail");
        return uids.map((uid) => ({ uid, data: world.profiles?.[uid] }));
      },
    },
  };
  return { deps, log };
}

const profile = (displayName: string) => ({ displayName, createdAt: T0, updatedAt: T0 });

function teamWorld(): World {
  return {
    teams: { "team-1": "active", "team-2": "active" },
    memberships: {
      "user-1__team-1": member("user-1", day(1)),
      "user-2__team-1": member("user-2", day(2), { role: "lead", roleUpdatedAt: day(9), roleUpdatedBy: "admin-secret" }),
      "user-3__team-1": member("user-3", day(3)),
      "user-9__team-2": { ...member("user-9", day(1)), teamId: "team-2" },
    },
    profiles: {
      "user-1": profile("Anna Berg"),
      "user-2": profile("Cecilia Dahl"),
      "user-9": profile("Only In Team Two"),
    },
  };
}

describe("listTeamRoster — access", () => {
  it("returns the roster to a member of the team", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok).toBe(true);
  });

  it("rejects an invalid token as unauthenticated without touching storage", async () => {
    const { deps, log } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: vi.fn().mockRejectedValue(new Error("bad")) });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(log.listLimit).toEqual([]);
  });

  it("denies a signed-in non-member with forbidden and reads no memberships or names", async () => {
    const { deps, log } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("stranger") });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(log.listLimit).toEqual([]);
    expect(log.profileBatches).toEqual([]);
  });

  it("denies a member of Team 2 access to Team 1's roster, and never returns Team 2 names to a Team 1 call", async () => {
    const { deps } = build(teamWorld());

    const crossTeam = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("user-9") });
    expect(crossTeam).toEqual({ ok: false, error: "forbidden" });

    const own = await listTeamRoster("token", "team-1", deps);
    expect(JSON.stringify(own)).not.toContain("Only In Team Two");
  });

  it("denies a removed member on the very next call", async () => {
    const world = teamWorld();
    const { deps } = build(world);
    expect((await listTeamRoster("token", "team-1", deps)).ok).toBe(true);

    delete world.memberships?.["user-1__team-1"];

    expect(await listTeamRoster("token", "team-1", deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("allows an app admin who is not a member to read any existing team's roster", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("admin-1", ADMIN_EMAIL) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.members.every((entry) => entry.isSelf === false)).toBe(true);
    }
  });

  it("still serves a disabled team's roster to its members and to admins", async () => {
    const world = teamWorld();
    world.teams = { ...world.teams, "team-1": "disabled" };
    const { deps } = build(world);

    expect((await listTeamRoster("token", "team-1", deps)).ok).toBe(true);
    expect((await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("admin-1", ADMIN_EMAIL) })).ok).toBe(true);
  });

  it("denies a nonexistent team or one with a malformed status, even to an admin", async () => {
    const world = teamWorld();
    world.teams = { "team-1": "archived" };
    const { deps } = build(world);

    expect(await listTeamRoster("token", "team-1", deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await listTeamRoster("token", "team-404", { ...deps, verifyToken: tokenFor("admin-1", ADMIN_EMAIL) })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("reports read_failed — never forbidden — when the authorization read fails", async () => {
    const { deps } = build({ ...teamWorld(), failAuthStatus: true });

    expect(await listTeamRoster("token", "team-1", deps)).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports read_failed when the membership or profile reads fail, without echoing the cause", async () => {
    for (const fail of [{ failList: true }, { failProfiles: true }]) {
      const { deps } = build({ ...teamWorld(), ...fail });

      const result = await listTeamRoster("token", "team-1", deps);

      expect(result).toEqual({ ok: false, error: "read_failed" });
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
});

describe("listTeamRoster — entries", () => {
  it("returns exactly {displayName, isLead, isSelf} per member, for the caller's team only", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result).toEqual({
      ok: true,
      truncated: false,
      members: [
        { displayName: "Cecilia Dahl", isLead: true, isSelf: false },
        { displayName: "Anna Berg", isLead: false, isSelf: true },
        { displayName: null, isLead: false, isSelf: false },
      ],
    });
  });

  it("marks only the caller's own entry as isSelf", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("user-3") });

    expect(result.ok && result.members.filter((entry) => entry.isSelf)).toEqual([
      { displayName: null, isLead: false, isSelf: true },
    ]);
  });

  it("works when nobody has a profile — every entry is nameless, no failure", async () => {
    const world = teamWorld();
    world.profiles = {};
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.map((entry) => entry.displayName)).toEqual([null, null, null]);
  });

  it("works when everybody has a profile", async () => {
    const world = teamWorld();
    world.profiles = { "user-1": profile("Anna Berg"), "user-2": profile("Cecilia Dahl"), "user-3": profile("Bo Lind") };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.map((entry) => entry.displayName)).toEqual(["Cecilia Dahl", "Anna Berg", "Bo Lind"]);
  });

  it("never falls back to e-mail, uid or an Auth lookup for a nameless member", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("user-3", "bo.lind@example.com") });

    const text = JSON.stringify(result);
    expect(text).not.toContain("bo.lind");
    expect(text).not.toContain("user-3");
  });

  it("treats a corrupt profile as nameless without failing or leaking its other fields", async () => {
    const world = teamWorld();
    world.profiles = {
      "user-1": { displayName: "Anna Berg", createdAt: T0, updatedAt: T0, email: "anna@example.com", note: "secret note" },
      "user-2": { displayName: 7, createdAt: T0, updatedAt: T0 },
      "user-3": "garbage",
    };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.map((entry) => entry.displayName)).toEqual([null, "Anna Berg", null]);
    const text = JSON.stringify(result);
    expect(text).not.toContain("anna@example.com");
    expect(text).not.toContain("secret note");
  });

  it("shows two members with the same name as two entries (names are not identifiers)", async () => {
    const world = teamWorld();
    world.profiles = { "user-1": profile("Anna Berg"), "user-2": profile("Anna Berg"), "user-3": profile("Anna Berg") };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members).toHaveLength(3);
  });

  it("skips malformed membership documents instead of failing the roster", async () => {
    const world = teamWorld();
    world.rosterDocs = {
      "team-1": [
        member("user-1", day(1)),
        { teamId: "team-1", createdAt: day(2) },
        { uid: "", teamId: "team-1" },
        { uid: "user-x", teamId: "team-2" },
        "garbage",
        null,
      ],
    };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members).toEqual([{ displayName: "Anna Berg", isLead: false, isSelf: true }]);
  });
});

describe("listTeamRoster — isLead", () => {
  it("is true only for a stored lead role on an active team", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.filter((entry) => entry.isLead)).toHaveLength(1);
  });

  it("is false for a stored lead while the team is disabled (same definition as resolveTeamRole)", async () => {
    const world = teamWorld();
    world.teams = { ...world.teams, "team-1": "disabled" };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.some((entry) => entry.isLead)).toBe(false);
  });

  it.each([
    ["an unknown string", "superuser"],
    ["a differently-cased string", "Lead"],
    ["a number", 1],
    ["an explicit member", "member"],
  ])("is false for a malformed or unknown role (%s)", async (_label, role) => {
    const world = teamWorld();
    world.memberships = { ...world.memberships, "user-2__team-1": member("user-2", day(2), { role }) };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.some((entry) => entry.isLead)).toBe(false);
  });

  it("supports several leads", async () => {
    const world = teamWorld();
    world.memberships = {
      ...world.memberships,
      "user-1__team-1": member("user-1", day(1), { role: "lead" }),
    };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.filter((entry) => entry.isLead)).toHaveLength(2);
  });

  it("does not read the team status again when nobody is a stored lead", async () => {
    const world = teamWorld();
    world.memberships = { ...world.memberships, "user-2__team-1": member("user-2", day(2)) };
    const { deps, log } = build(world);

    await listTeamRoster("token", "team-1", deps);

    expect(log.statusReads).toBe(0);
  });

  it("fails the roster rather than guessing when the lead re-check of the team status fails", async () => {
    const { deps } = build(teamWorld());
    const failing = { ...deps.store!, getTeamStatus: vi.fn().mockRejectedValue(new Error("secret internal detail")) };

    const result = await listTeamRoster("token", "team-1", { ...deps, store: failing });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("listTeamRoster — ordering", () => {
  it("orders leads first, then by name (case-insensitive, locale-aware, nameless last), then by join time", async () => {
    const world: World = {
      teams: { "team-1": "active" },
      memberships: {
        "user-1__team-1": member("user-1", day(5)),
        "user-2__team-1": member("user-2", day(4)),
        "user-3__team-1": member("user-3", day(3), { role: "lead" }),
        "user-4__team-1": member("user-4", day(2)),
        "user-5__team-1": member("user-5", day(1)),
        "user-6__team-1": member("user-6", day(6)),
        "user-7__team-1": member("user-7", day(7), { role: "lead" }),
      },
      profiles: {
        "user-1": profile("åse"),
        "user-2": profile("Bo"),
        "user-3": profile("Zed"),
        "user-4": profile("anna"),
        "user-7": profile("Yara"),
      },
    };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok && result.members.map((entry) => entry.displayName)).toEqual([
      "Yara",
      "Zed",
      "anna",
      "Bo",
      "åse",
      null,
      null,
    ]);
  });

  it("breaks name ties by the earlier join time", async () => {
    const world: World = {
      teams: { "team-1": "active" },
      memberships: {
        "user-1__team-1": member("user-1", day(9)),
        "user-2__team-1": member("user-2", day(1)),
        "user-3__team-1": member("user-3", day(5)),
      },
      profiles: { "user-1": profile("Sam"), "user-2": profile("Sam"), "user-3": profile("Sam") },
    };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("user-2") });

    expect(result.ok && result.members.map((entry) => entry.isSelf)).toEqual([true, false, false]);
  });
});

describe("listTeamRoster — bounds and batching", () => {
  function bigWorld(count: number): World {
    const memberships: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < count; i += 1) {
      memberships[`user-${i}__team-1`] = member(`user-${i}`, day(i));
    }
    return { teams: { "team-1": "active" }, memberships: { ...memberships, "viewer__team-1": member("viewer", day(0)) } };
  }

  it("caps memberships at 500 by asking for one extra to detect truncation", async () => {
    expect(TEAM_ROSTER_MAX_MEMBERS).toBe(500);
    const { deps, log } = build(bigWorld(3));

    await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("viewer") });

    expect(log.listLimit).toEqual([501]);
  });

  it("returns at most 500 entries and flags truncated when the team is larger", async () => {
    const { deps } = build(bigWorld(600));

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("viewer") });

    expect(result.ok && result.members).toHaveLength(500);
    expect(result.ok && result.truncated).toBe(true);
  });

  it("does not flag truncation at exactly 500 members", async () => {
    const world = bigWorld(499); // 499 + viewer = 500
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("viewer") });

    expect(result.ok && result.members).toHaveLength(500);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("reads profiles in batches of at most 100 — five batches at the 500-member maximum", async () => {
    const { deps, log } = build(bigWorld(600));

    await listTeamRoster("token", "team-1", { ...deps, verifyToken: tokenFor("viewer") });

    expect(log.profileBatches.map((batch) => batch.length)).toEqual([100, 100, 100, 100, 100]);
  });
});

describe("listTeamRoster — privacy contract (member-visible response)", () => {
  /**
   * WHY THIS MATTERS: a forum author's pseudonym is
   * `authorTag = SHA-256(`${teamId}:${authorUid}`)` (src/features/forum/
   * domain/author-tag.ts). Anyone who learns a member's Firebase uid *and*
   * the teamId can compute that member's authorTag and de-anonymise their
   * forum posts. So no member-visible response may carry a uid, a value
   * derived from one, an e-mail, or the `{uid}__{teamId}` membership id.
   * This test enforces the information boundary — it does not try to break
   * SHA-256.
   */
  const SECRETS = [
    "user-1",
    "user-2",
    "user-3",
    "admin-secret",
    "invitation",
    "user-1@example.com",
    "user-2@example.com",
    "user-1__team-1",
    "user-2__team-1",
    "roleUpdatedBy",
    "roleUpdatedAt",
    "grantedBy",
    "createdVia",
    "createdAt",
    "teamId",
  ];

  it("contains exactly the keys displayName, isLead and isSelf per entry, plus only members and truncated at the top level", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(["members", "ok", "truncated"]);
    for (const entry of result.members) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "isLead", "isSelf"]);
    }
  });

  it("carries no uid, e-mail, membership id, audit field or authTag-computable value anywhere in the serialised response", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", deps);

    const serialised = JSON.stringify(result);
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("does not contain any forum authorTag of a member (nor the SHA-256 of teamId:uid) in the response", async () => {
    const { deps } = build(teamWorld());

    const result = await listTeamRoster("token", "team-1", deps);

    const serialised = JSON.stringify(result).toUpperCase();
    for (const uid of ["user-1", "user-2", "user-3"]) {
      const digest = createHash("sha256").update(`team-1:${uid}`).digest("hex").toUpperCase();
      expect(serialised).not.toContain(digest.slice(0, 6));
    }
  });

  it("is unaffected by extra fields on membership documents — only allow-listed keys are ever constructed", async () => {
    const world = teamWorld();
    world.memberships = {
      ...world.memberships,
      "user-3__team-1": member("user-3", day(3), { email: "leak@example.com", displayName: "From Membership", secretNote: "x" }),
    };
    const { deps } = build(world);

    const result = await listTeamRoster("token", "team-1", deps);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("leak@example.com");
    expect(serialised).not.toContain("From Membership");
    expect(serialised).not.toContain("secretNote");
  });
});
