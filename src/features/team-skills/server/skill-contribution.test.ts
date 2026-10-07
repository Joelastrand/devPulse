import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_CONTRIBUTION_FIELD } from "../domain/skill-contribution";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "../domain/skill-coverage-policy";

type Doc = Record<string, unknown>;

/**
 * Minimal in-memory Firestore (same approach as `membership-role-regression.test.ts`):
 * the production default store, grant and remove code run unchanged. A transaction
 * commits its queued writes at the end and `update` on a missing document throws,
 * like Firestore. No real Firebase is contacted.
 */
const db = new Map<string, Doc>();
const updateLog: Array<{ path: string; fields: Doc }> = [];

function snapshot(path: string) {
  const data = db.get(path);
  return { exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
}

function applyUpdate(path: string, fields: Doc) {
  const existing = db.get(path);
  if (!existing) throw new Error("NOT_FOUND");
  const next = { ...existing };
  for (const [field, value] of Object.entries(fields)) {
    if (value instanceof FieldValue) delete next[field];
    else next[field] = value;
  }
  db.set(path, next);
}

function docRef(collection: string, id: string) {
  const path = `${collection}/${id}`;
  return {
    path,
    get: async () => snapshot(path),
    set: async (data: Doc) => void db.set(path, { ...data }),
    delete: async () => void db.delete(path),
    update: async (fields: Doc) => applyUpdate(path, fields),
  };
}

function query(collection: string, filters: Array<[string, unknown]>, max = Infinity) {
  return {
    limit: (count: number) => query(collection, filters, count),
    async get() {
      const docs = [...db.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .slice(0, max)
        .map(([path, data]) => ({ id: path.split("/")[1], data: () => ({ ...data }) }));
      return { docs };
    },
  };
}

const fakeDb = {
  collection: (name: string) => ({
    doc: (id: string) => docRef(name, id),
    where: (field: string, _op: string, value: unknown) => query(name, [[field, value]]),
  }),
  async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const tx = {
      get: async (ref: { path: string }) => snapshot(ref.path),
      set: (ref: { path: string }, data: Doc) => void writes.push(() => void db.set(ref.path, { ...data })),
      update: (ref: { path: string }, fields: Doc) => {
        updateLog.push({ path: ref.path, fields });
        writes.push(() => applyUpdate(ref.path, fields));
      },
    };
    const result = await work(tx);
    writes.forEach((write) => write());
    return result;
  },
};

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => fakeDb,
  getAdminAuth: () => ({}),
}));

const { getOwnSkillContribution } = await import("./get-own-skill-contribution");
const { setOwnSkillContribution } = await import("./set-own-skill-contribution");
const { withdrawOwnSkillContribution } = await import("./withdraw-own-skill-contribution");
const { getDefaultSkillContributionStore } = await import("./skill-contribution-store");
const { grantTeamMembership } = await import("../../teams/server/grant-team-membership");
const { removeTeamMember } = await import("../../teams/server/remove-team-member");
const { setTeamMemberRole } = await import("../../teams/server/set-team-member-role");
const { materializeMemberRefs } = await import("../../teams/server/materialize-member-refs");

const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-10-01T00:00:00Z");
const CONSENT_TIME = new Date("2026-10-05T12:00:00Z");
const TEAM = "team-1";
const VERSION = SKILL_CONTRIBUTION_NOTICE_VERSION;
const PATH = (uid: string, teamId = TEAM) => `teamMemberships/${uid}__${teamId}`;

const verifyAs = (uid: string, email = `${uid}@example.com`) =>
  vi.fn().mockResolvedValue({ uid, email, email_verified: true });
const adminOps = {
  verifyToken: verifyAs("admin-1", ADMIN_EMAIL),
  allowList: [ADMIN_EMAIL],
  now: NOW,
};

function membership(uid: string, extra: Doc = {}, teamId = TEAM): Doc {
  return {
    uid,
    teamId,
    createdAt: NOW,
    createdVia: "admin_direct",
    grantedBy: "admin-0",
    memberRef: "0123456789abcdefghjkmnpqrs",
    futureField: { keep: true },
    ...extra,
  };
}

const optIn = (uid: string, body: unknown = { noticeVersion: VERSION }, teamId = TEAM, email?: string) =>
  setOwnSkillContribution("t", teamId, body, { verifyToken: verifyAs(uid, email), now: () => CONSENT_TIME });
const withdraw = (uid: string, teamId = TEAM, email?: string) =>
  withdrawOwnSkillContribution("t", teamId, { verifyToken: verifyAs(uid, email) });
const read = (uid: string, teamId = TEAM, email?: string) =>
  getOwnSkillContribution("t", teamId, { verifyToken: verifyAs(uid, email) });

const stored = { noticeVersion: VERSION, consentedAt: new Date("2026-09-01T00:00:00Z") };

beforeEach(() => {
  db.clear();
  updateLog.length = 0;
  db.set("teams/team-1", { name: "Team One", status: "active" });
  db.set("teams/team-2", { name: "Team Two", status: "active" });
});

describe("opt-in (setOwnSkillContribution)", () => {
  it.each([
    ["ordinary member", {}],
    ["lead", { role: "lead" }],
  ])("a genuine %s opts in with exactly the canonical object, preserving every other field", async (_label, extra) => {
    const before = membership("u1", extra);
    db.set(PATH("u1"), before);

    const result = await optIn("u1");

    expect(result).toEqual({ ok: true, contributing: true });
    const after = db.get(PATH("u1"));
    expect(after?.[SKILL_CONTRIBUTION_FIELD]).toEqual({ noticeVersion: VERSION, consentedAt: CONSENT_TIME });
    expect(Object.keys(after?.[SKILL_CONTRIBUTION_FIELD] as Doc).sort()).toEqual(["consentedAt", "noticeVersion"]);
    const rest = { ...after };
    delete rest[SKILL_CONTRIBUTION_FIELD];
    expect(rest).toEqual(before);
    expect(updateLog).toHaveLength(1);
    expect(Object.keys(updateLog[0].fields)).toEqual([SKILL_CONTRIBUTION_FIELD]);
  });

  it("works for member+admin and lead+admin (admin status is irrelevant) but not for a non-member admin", async () => {
    db.set(PATH("m-admin"), membership("m-admin"));
    db.set(PATH("l-admin"), membership("l-admin", { role: "lead" }));

    expect(await optIn("m-admin", undefined, TEAM, ADMIN_EMAIL)).not.toMatchObject({ ok: false });
    expect(await optIn("l-admin", undefined, TEAM, ADMIN_EMAIL)).not.toMatchObject({ ok: false });
    expect(db.get(PATH("l-admin"))?.role).toBe("lead");

    const outsider = await optIn("n-admin", undefined, TEAM, ADMIN_EMAIL);
    expect(outsider).toEqual({ ok: false, error: "forbidden" });
    expect(db.has(PATH("n-admin"))).toBe(false);
  });

  it("an unrelated user, a wrong-team member and a malformed/foreign membership are forbidden and nothing is written", async () => {
    db.set(PATH("other-team", "team-2"), membership("other-team", {}, "team-2"));
    db.set(PATH("wrong-uid"), membership("someone-else"));
    db.set(PATH("wrong-team"), membership("wrong-team", {}, "team-2"));
    db.set(PATH("junk"), { nonsense: true });

    for (const uid of ["stranger", "other-team", "wrong-uid", "wrong-team", "junk"]) {
      expect(await optIn(uid)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(updateLog).toEqual([]);
    expect(db.has(PATH("stranger"))).toBe(false);
  });

  it("is signed-out 401 without any read of the team", async () => {
    const result = await setOwnSkillContribution("t", TEAM, { noticeVersion: VERSION }, {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("a disabled team refuses opt-in with team_disabled for a member, but a non-member only sees forbidden", async () => {
    db.set("teams/team-1", { name: "Team One", status: "disabled" });
    db.set(PATH("u1"), membership("u1"));

    expect(await optIn("u1")).toEqual({ ok: false, error: "team_disabled" });
    expect(await optIn("stranger")).toEqual({ ok: false, error: "forbidden" });
    expect(db.get(PATH("u1"))).not.toHaveProperty(SKILL_CONTRIBUTION_FIELD);
  });

  it.each([
    ["stale/other version", { noticeVersion: VERSION + 1 }, "notice_outdated"],
    ["zero", { noticeVersion: 0 }, "notice_outdated"],
    ["string version", { noticeVersion: String(VERSION) }, "invalid_input"],
    ["fractional", { noticeVersion: VERSION + 0.5 }, "invalid_input"],
    ["missing version", {}, "invalid_input"],
    ["extra keys", { noticeVersion: VERSION, uid: "x" }, "invalid_input"],
    ["array body", [VERSION], "invalid_input"],
    ["null body", null, "invalid_input"],
    ["non-object body", "nope", "invalid_input"],
  ])("rejects %s without writing", async (_label, body, error) => {
    db.set(PATH("u1"), membership("u1"));
    expect(await optIn("u1", body)).toEqual({ ok: false, error });
    expect(updateLog).toEqual([]);
  });

  it("re-opt-in overwrites with a fresh server timestamp; a stale or malformed object is replaced by the canonical one", async () => {
    for (const previous of [stored, { noticeVersion: VERSION + 1, consentedAt: NOW }, { noticeVersion: "1" }, "garbage"]) {
      db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: previous }));
      expect(await optIn("u1")).toEqual({ ok: true, contributing: true });
      expect(db.get(PATH("u1"))?.[SKILL_CONTRIBUTION_FIELD]).toEqual({ noticeVersion: VERSION, consentedAt: CONSENT_TIME });
    }
  });

  it("ignores a client-supplied uid/team in the body: the subject is always the token's uid", async () => {
    db.set(PATH("u1"), membership("u1"));
    db.set(PATH("victim"), membership("victim"));

    const result = await optIn("u1", { noticeVersion: VERSION, uid: "victim" });

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(db.get(PATH("victim"))).not.toHaveProperty(SKILL_CONTRIBUTION_FIELD);
  });

  it("multi-team independence: opting in to Team A leaves Team B absent", async () => {
    db.set(PATH("u1"), membership("u1"));
    db.set(PATH("u1", "team-2"), membership("u1", {}, "team-2"));

    await optIn("u1");

    expect(await read("u1", "team-1")).toEqual({ ok: true, contributing: true, canOptIn: true });
    expect(await read("u1", "team-2")).toEqual({ ok: true, contributing: false, canOptIn: true });
  });

  it("never recreates a membership removed concurrently (commit fails, nothing resurrected)", async () => {
    db.set(PATH("u1"), membership("u1"));
    const real = getDefaultSkillContributionStore();
    const racing = {
      ...real,
      runTransaction: <T>(fn: Parameters<typeof real.runTransaction<T>>[0]) =>
        real.runTransaction((tx) =>
          fn({
            ...tx,
            setField(uid, teamId, record) {
              db.delete(PATH(uid, teamId)); // removal lands between the read and the write
              tx.setField(uid, teamId, record);
            },
          }),
        ),
    };

    const result = await setOwnSkillContribution("t", TEAM, { noticeVersion: VERSION }, {
      verifyToken: verifyAs("u1"),
      store: racing,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(db.has(PATH("u1"))).toBe(false);
  });

  it("a read failure is persistence_failed, never forbidden", async () => {
    const failing = {
      runTransaction: () => Promise.reject(new Error("boom")),
      listMembershipsForCoverage: () => Promise.resolve([]),
    };
    expect(await setOwnSkillContribution("t", TEAM, { noticeVersion: VERSION }, { verifyToken: verifyAs("u1"), store: failing })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });
});

describe("withdrawal (withdrawOwnSkillContribution)", () => {
  it("physically deletes the field and nothing else, writing no negative state", async () => {
    const base = membership("u1", { role: "lead" });
    db.set(PATH("u1"), { ...base, [SKILL_CONTRIBUTION_FIELD]: stored });

    expect(await withdraw("u1")).toEqual({ ok: true, contributing: false });

    expect(db.get(PATH("u1"))).toEqual(base);
    expect(db.get(PATH("u1"))).not.toHaveProperty(SKILL_CONTRIBUTION_FIELD);
    expect(JSON.stringify(updateLog)).not.toMatch(/enabled|revokedAt|false|null/);
  });

  it("deletes a stale or malformed object too", async () => {
    for (const previous of [{ noticeVersion: VERSION + 1, consentedAt: NOW }, { noticeVersion: "x" }, 7]) {
      db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: previous }));
      expect(await withdraw("u1")).toEqual({ ok: true, contributing: false });
      expect(db.get(PATH("u1"))).not.toHaveProperty(SKILL_CONTRIBUTION_FIELD);
    }
  });

  it("is idempotent: an absent field succeeds with no write", async () => {
    db.set(PATH("u1"), membership("u1"));
    expect(await withdraw("u1")).toEqual({ ok: true, contributing: false });
    expect(await withdraw("u1")).toEqual({ ok: true, contributing: false });
    expect(updateLog).toEqual([]);
  });

  it("still succeeds on a disabled team", async () => {
    db.set("teams/team-1", { name: "Team One", status: "disabled" });
    db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: stored }));
    expect(await withdraw("u1")).toEqual({ ok: true, contributing: false });
    expect(db.get(PATH("u1"))).not.toHaveProperty(SKILL_CONTRIBUTION_FIELD);
  });

  it("forbids non-members including a non-member admin, and malformed or foreign memberships", async () => {
    db.set(PATH("junk"), { nonsense: true });
    db.set(PATH("wrong-uid"), membership("someone-else", { [SKILL_CONTRIBUTION_FIELD]: stored }));
    for (const [uid, email] of [["stranger", undefined], ["n-admin", ADMIN_EMAIL], ["junk", undefined], ["wrong-uid", undefined]] as const) {
      expect(await withdraw(uid, TEAM, email)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(updateLog).toEqual([]);
    expect(db.get(PATH("wrong-uid"))).toHaveProperty(SKILL_CONTRIBUTION_FIELD);
  });

  it("another member cannot withdraw the caller's participation (no subject input exists)", async () => {
    db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: stored }));
    db.set(PATH("u2"), membership("u2"));

    await withdraw("u2");

    expect(db.get(PATH("u1"))).toHaveProperty(SKILL_CONTRIBUTION_FIELD);
  });
});

describe("own state (getOwnSkillContribution)", () => {
  it("reports effective consent and canOptIn, writes nothing, and exposes only two booleans", async () => {
    db.set(PATH("u1"), membership("u1", { role: "lead", [SKILL_CONTRIBUTION_FIELD]: stored }));
    db.set(PATH("u2"), membership("u2"));

    expect(await read("u1")).toEqual({ ok: true, contributing: true, canOptIn: true });
    expect(await read("u2")).toEqual({ ok: true, contributing: false, canOptIn: true });
    expect(updateLog).toEqual([]);
  });

  it("a stale notice version is ineffective and is never auto-upgraded", async () => {
    const lapsed = { noticeVersion: VERSION + 1, consentedAt: NOW };
    db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: lapsed }));

    expect(await read("u1")).toEqual({ ok: true, contributing: false, canOptIn: true });
    expect(db.get(PATH("u1"))?.[SKILL_CONTRIBUTION_FIELD]).toEqual(lapsed);
    expect(updateLog).toEqual([]);
  });

  it.each([
    ["malformed version", { noticeVersion: "1", consentedAt: NOW }],
    ["malformed consentedAt", { noticeVersion: VERSION, consentedAt: "yesterday" }],
    ["extra key", { noticeVersion: VERSION, consentedAt: NOW, enabled: true }],
  ])("%s is never effective", async (_label, value) => {
    db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: value }));
    expect(await read("u1")).toMatchObject({ contributing: false });
  });

  it("on a disabled team canOptIn is false; non-members (admins too) are forbidden", async () => {
    db.set("teams/team-1", { name: "Team One", status: "disabled" });
    db.set(PATH("u1"), membership("u1", { [SKILL_CONTRIBUTION_FIELD]: stored }));

    expect(await read("u1")).toEqual({ ok: true, contributing: true, canOptIn: false });
    expect(await read("n-admin", TEAM, ADMIN_EMAIL)).toEqual({ ok: false, error: "forbidden" });
    expect(await read("stranger")).toEqual({ ok: false, error: "forbidden" });
  });

  it("never reveals other members' state", async () => {
    db.set(PATH("u1"), membership("u1"));
    db.set(PATH("u2"), membership("u2", { [SKILL_CONTRIBUTION_FIELD]: stored }));
    const result = await read("u1");
    expect(Object.keys(result).sort()).toEqual(["canOptIn", "contributing", "ok"]);
    expect(result).toMatchObject({ contributing: false });
  });
});

describe("lifecycle with production membership code", () => {
  const grant = (uid = "u1") =>
    grantTeamMembership({ uid, teamId: TEAM, createdAt: NOW, createdVia: "invitation", grantedBy: "admin-1" });

  it("removal destroys participation; a rejoin is a fresh membership that is not contributing", async () => {
    await grant();
    await optIn("u1");
    expect(await read("u1")).toMatchObject({ contributing: true });

    expect(await removeTeamMember("t", TEAM, "u1", adminOps)).toEqual({ ok: true });
    expect(db.has(PATH("u1"))).toBe(false);
    expect(await read("u1")).toEqual({ ok: false, error: "forbidden" });

    await grant();
    expect(db.get(PATH("u1"))).not.toHaveProperty(SKILL_CONTRIBUTION_FIELD);
    expect(await read("u1")).toEqual({ ok: true, contributing: false, canOptIn: true });
  });

  it("re-grant of an existing membership is a no-op that leaves participation", async () => {
    await grant();
    await optIn("u1");
    const before = db.get(PATH("u1"));

    expect(await grant()).toBe("already_member");

    expect(db.get(PATH("u1"))).toEqual(before);
    expect(await read("u1")).toMatchObject({ contributing: true });
  });

  it("lead assignment/demotion and memberRef preparation leave participation untouched; opt-in leaves role/memberRef/timestamps", async () => {
    await grant();
    const fresh = { ...db.get(PATH("u1")) };
    await optIn("u1");
    const optedIn = db.get(PATH("u1"));
    const { [SKILL_CONTRIBUTION_FIELD]: written, ...withoutField } = optedIn ?? {};
    expect(withoutField).toEqual(fresh);

    await setTeamMemberRole("t", TEAM, "u1", "lead", adminOps);
    expect(db.get(PATH("u1"))?.[SKILL_CONTRIBUTION_FIELD]).toEqual(written);
    await setTeamMemberRole("t", TEAM, "u1", "member", adminOps);
    expect(db.get(PATH("u1"))?.[SKILL_CONTRIBUTION_FIELD]).toEqual(written);

    db.set(PATH("legacy"), { ...membership("legacy", { [SKILL_CONTRIBUTION_FIELD]: stored }), memberRef: undefined });
    delete db.get(PATH("legacy"))?.memberRef;
    await materializeMemberRefs("t", TEAM, adminOps);
    expect(db.get(PATH("legacy"))?.[SKILL_CONTRIBUTION_FIELD]).toEqual(stored);
  });

  it("a participation role change (member to lead) never changes what participation allows", async () => {
    await grant();
    await setTeamMemberRole("t", TEAM, "u1", "lead", adminOps);
    expect(await optIn("u1")).toEqual({ ok: true, contributing: true });
    expect(db.get(PATH("u1"))?.role).toBe("lead");
  });
});

describe("store", () => {
  it("lists raw membership documents of one team with a limit and never other teams", async () => {
    db.set(PATH("u1"), membership("u1"));
    db.set(PATH("u2"), membership("u2"));
    db.set(PATH("u3", "team-2"), membership("u3", {}, "team-2"));

    const store = getDefaultSkillContributionStore();
    const all = await store.listMembershipsForCoverage(TEAM, 10);
    expect(all.map((entry) => entry.id).sort()).toEqual(["u1__team-1", "u2__team-1"]);
    expect(await store.listMembershipsForCoverage(TEAM, 1)).toHaveLength(1);
  });
});
