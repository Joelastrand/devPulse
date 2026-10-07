import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_CONTRIBUTION_FIELD } from "../domain/skill-contribution";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "../domain/skill-coverage-policy";

type Doc = Record<string, unknown>;

/**
 * Participation non-exposure regression (C2 TASK-007, BR-10, BR-22).
 *
 * Real route handlers and real default Firestore reads run over a minimal in-memory
 * Firestore (same approach as `skill-contribution.test.ts`); only token verification and
 * the Auth e-mail lookup are stubbed. Memberships carry adversarial participation data
 * (valid, stale version, malformed shape, sentinel consent time, extra future field) and
 * every membership-derived response a non-owner can reach is checked for it.
 *
 * What this proves: the *current* responses of these routes contain no participation data
 * and are byte-identical whether or not any participation exists. What it does not prove:
 * that a future route stays clean — that is the C2 static guard (TASK-017). No Firebase is
 * contacted.
 */
const db = new Map<string, Doc>();

function snapshot(path: string) {
  const data = db.get(path);
  return { exists: data !== undefined, id: path.split("/")[1], data: () => (data === undefined ? undefined : { ...data }) };
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
  const self = {
    where: (field: string, _op: string, value: unknown) => query(collection, [...filters, [field, value]], max),
    orderBy: () => self,
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
  return self;
}

const fakeDb = {
  collection: (name: string) => ({
    doc: (id: string) => docRef(name, id),
    where: (field: string, op: string, value: unknown) => query(name, []).where(field, op, value),
    orderBy: () => query(name, []),
    limit: (count: number) => query(name, [], count),
  }),
  getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const tx = {
      get: async (ref: { path?: string } & ReturnType<typeof query>) =>
        ref.path !== undefined ? snapshot(ref.path) : ref.get(),
      set: (ref: { path: string }, data: Doc) => void writes.push(() => void db.set(ref.path, { ...data })),
      update: (ref: { path: string }, fields: Doc) => void writes.push(() => applyUpdate(ref.path, fields)),
      delete: (ref: { path: string }) => void writes.push(() => void db.delete(ref.path)),
    };
    const result = await work(tx);
    writes.forEach((write) => write());
    return result;
  },
};

const ADMIN_EMAIL = "admin@example.com";
const TEAM = "team-1";
const NOW = new Date("2026-10-01T00:00:00Z");
const CONSENT_SENTINEL = new Date("2031-02-03T04:05:06Z");
const VERSION = SKILL_CONTRIBUTION_NOTICE_VERSION;

const identities: Record<string, { uid: string; email: string; email_verified: boolean }> = {
  "t-anna": { uid: "anna", email: "anna@example.com", email_verified: true },
  "t-bo": { uid: "bo", email: "bo@example.com", email_verified: true },
  "t-lead": { uid: "lead", email: "lead@example.com", email_verified: true },
  "t-stale": { uid: "stale", email: "stale@example.com", email_verified: true },
  "t-admin": { uid: "admin", email: ADMIN_EMAIL, email_verified: true },
};

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => fakeDb,
  getAdminAuth: () => ({
    verifyIdToken: async (token: string) => {
      const identity = identities[token];
      if (!identity) throw new Error("bad token");
      return identity;
    },
    getUser: async (uid: string) => ({ email: `${uid}@example.com` }),
  }),
}));

const rosterRoute = await import("../../../../app/api/teams/[teamId]/members/route");
const assignableRoute = await import("../../../../app/api/teams/[teamId]/assignable-members/route");
const adminMembersRoute = await import("../../../../app/api/admin/teams/[teamId]/members/route");
const adminAccessRequestsRoute = await import("../../../../app/api/admin/teams/[teamId]/access-requests/route");
const adminInvitationsRoute = await import("../../../../app/api/admin/teams/[teamId]/invitations/route");
const adminMemberRefsRoute = await import("../../../../app/api/admin/teams/[teamId]/member-refs/route");
const needsRoute = await import("../../../../app/api/teams/[teamId]/skill-needs/route");
const ownRoute = await import("../../../../app/api/teams/[teamId]/skill-contribution/route");
const { setTeamMemberRole } = await import("../../teams/server/set-team-member-role");
const { materializeMemberRefs } = await import("../../teams/server/materialize-member-refs");

const params = { params: Promise.resolve({ teamId: TEAM }) };
const call = (handler: (r: Request, c: typeof params) => Promise<Response>, token: string, url = "http://localhost/x") =>
  handler(new Request(url, { method: "GET", headers: { authorization: `Bearer ${token}` } }), params);

async function json(response: Response): Promise<unknown> {
  return response.json();
}

function membership(uid: string, extra: Doc = {}): Doc {
  return {
    uid,
    teamId: TEAM,
    createdAt: NOW,
    createdVia: "admin_direct",
    grantedBy: "admin-0",
    memberRef: `ref-sentinel-${uid}`,
    ...extra,
  };
}

const validContribution = { noticeVersion: VERSION, consentedAt: CONSENT_SENTINEL };

function seed({ withParticipation }: { withParticipation: boolean }) {
  db.clear();
  db.set(`teams/${TEAM}`, { name: "Team One", status: "active" });
  const p = (value: Doc) => (withParticipation ? { [SKILL_CONTRIBUTION_FIELD]: value } : {});
  db.set(`teamMemberships/anna__${TEAM}`, membership("anna", p(validContribution)));
  db.set(`teamMemberships/bo__${TEAM}`, membership("bo"));
  db.set(`teamMemberships/lead__${TEAM}`, membership("lead", { role: "lead", ...p(validContribution) }));
  // Stale version, plus malformed shape with a sentinel future field.
  db.set(`teamMemberships/stale__${TEAM}`, membership("stale", p({ noticeVersion: 999, consentedAt: CONSENT_SENTINEL, extra: "SENTINEL-FUTURE" })));
  for (const uid of ["anna", "bo", "lead", "stale"]) {
    db.set(`userProfiles/${uid}`, { displayName: `Name ${uid}`, createdAt: NOW, updatedAt: NOW });
  }
  db.set(`teamSkillNeeds/${TEAM}__tree-1`, {
    teamId: TEAM,
    treeId: "tree-1",
    requiredLevel: 3,
    requiredCoverage: 2,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

const FORBIDDEN_FRAGMENTS = [
  "skillContribution",
  "noticeVersion",
  "consentedAt",
  "contributing",
  "contributor",
  "participant",
  "optedIn",
  "consent",
  "SENTINEL-FUTURE",
  "2031-02-03",
];

function expectNoParticipation(body: unknown): void {
  const text = JSON.stringify(body);
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    expect(text.toLowerCase()).not.toContain(fragment.toLowerCase());
  }
}

type Handler = (r: Request, c: typeof params) => Promise<Response>;
const NON_OWNER_SURFACES: Array<[string, Handler, string[]]> = [
  ["GET /api/teams/[teamId]/members", rosterRoute.GET, ["t-anna", "t-bo", "t-lead", "t-admin"]],
  ["GET /api/teams/[teamId]/assignable-members", assignableRoute.GET, ["t-anna", "t-bo", "t-lead", "t-admin"]],
  ["GET /api/teams/[teamId]/skill-needs", needsRoute.GET, ["t-anna", "t-bo", "t-lead", "t-admin"]],
  ["GET /api/admin/teams/[teamId]/members", adminMembersRoute.GET, ["t-admin"]],
  ["GET /api/admin/teams/[teamId]/access-requests", adminAccessRequestsRoute.GET, ["t-admin"]],
  ["GET /api/admin/teams/[teamId]/invitations", adminInvitationsRoute.GET, ["t-admin"]],
];

beforeEach(() => {
  vi.stubEnv("APP_ADMIN_EMAILS", ADMIN_EMAIL);
  seed({ withParticipation: true });
});

describe("no membership-derived response exposes participation (BR-10)", () => {
  it.each(NON_OWNER_SURFACES)("%s carries no participation data for any caller", async (_name, handler, tokens) => {
    for (const token of tokens) {
      const response = await call(handler, token);
      expect(response.status).toBe(200);
      expectNoParticipation(await json(response));
    }
  });

  it.each(NON_OWNER_SURFACES)("%s is identical with and without participation seeded", async (_name, handler, tokens) => {
    const withParticipation: unknown[] = [];
    for (const token of tokens) withParticipation.push(await json(await call(handler, token)));

    seed({ withParticipation: false });
    const without: unknown[] = [];
    for (const token of tokens) without.push(await json(await call(handler, token)));

    expect(withParticipation).toEqual(without);
  });

  it("the member roster keeps exactly its F0 public keys", async () => {
    const body = (await json(await call(rosterRoute.GET, "t-bo"))) as { status: string; members: Array<Record<string, unknown>>; truncated: boolean };
    expect(Object.keys(body).sort()).toEqual(["members", "status", "truncated"]);
    for (const member of body.members) {
      expect(Object.keys(member).sort()).toEqual(["displayName", "isLead", "isSelf"]);
    }
  });

  it("the admin member list keeps exactly its approved keys", async () => {
    const body = (await json(await call(adminMembersRoute.GET, "t-admin"))) as { members: Array<Record<string, unknown>> };
    expect(body.members).toHaveLength(4);
    for (const member of body.members) {
      expect(Object.keys(member).sort()).toEqual(["displayName", "email", "hasMemberRef", "role", "uid"]);
    }
  });

  it("the assignable-members list keeps exactly its approved keys", async () => {
    const body = (await json(await call(assignableRoute.GET, "t-bo"))) as { members: Array<Record<string, unknown>> };
    for (const member of body.members) {
      expect(Object.keys(member).sort()).toEqual(["displayName", "isSelf", "memberRef", "ordinal"]);
    }
  });

  it("the need read keeps exactly its approved top-level keys", async () => {
    const body = (await json(await call(needsRoute.GET, "t-lead"))) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["catalog", "catalogTruncated", "needs", "needsTruncated", "viewer"]);
    expect(Object.keys(body.viewer as object).sort()).toEqual(["canManageNeeds", "canReadCoverage"]);
  });

  it("the admin member-ref preparation response carries no participation and preserves the field", async () => {
    const response = await call(adminMemberRefsRoute.POST as Handler, "t-admin");
    const body = await json(response);
    expect(Object.keys(body as object).sort()).toEqual(["alreadyHad", "materialized", "truncated"]);
    expectNoParticipation(body);
    expect(db.get(`teamMemberships/anna__${TEAM}`)?.[SKILL_CONTRIBUTION_FIELD]).toEqual(validContribution);
  });

  it("role change and member-ref preparation operations preserve the stored field", async () => {
    const adminOps = { verifyToken: vi.fn().mockResolvedValue(identities["t-admin"]), allowList: [ADMIN_EMAIL], now: NOW };
    db.set(`teamMemberships/anna__${TEAM}`, membership("anna", { memberRef: "bad", [SKILL_CONTRIBUTION_FIELD]: validContribution }));

    await setTeamMemberRole("t", TEAM, "anna", "lead", adminOps);
    await materializeMemberRefs("t", TEAM, adminOps);
    await setTeamMemberRole("t", TEAM, "anna", "member", adminOps);

    expect(db.get(`teamMemberships/anna__${TEAM}`)?.[SKILL_CONTRIBUTION_FIELD]).toEqual(validContribution);
  });
});

describe("participation is readable only by its owner through the single own-state endpoint", () => {
  it("returns each caller only their own booleans, with exactly the approved keys", async () => {
    const anna = await call(ownRoute.GET, "t-anna");
    const bo = await call(ownRoute.GET, "t-bo");
    const stale = await call(ownRoute.GET, "t-stale");

    expect(await json(anna)).toEqual({ contributing: true, canOptIn: true });
    expect(await json(bo)).toEqual({ contributing: false, canOptIn: true });
    // A stale version is simply "not contributing" — no per-person diagnostic.
    expect(await json(stale)).toEqual({ contributing: false, canOptIn: true });
  });

  it("ignores a client-supplied uid/user/member in the query: the subject is always the verified caller", async () => {
    const response = await call(
      ownRoute.GET,
      "t-bo",
      "http://localhost/x?uid=anna&userId=anna&memberRef=ref-sentinel-anna&member=anna",
    );
    expect(await json(response)).toEqual({ contributing: false, canOptIn: true });
  });

  it("a lead sees only their own state, never another member's", async () => {
    expect(await json(await call(ownRoute.GET, "t-lead"))).toEqual({ contributing: true, canOptIn: true });
    // The lead's call carries no information about anna, bo or stale.
    expect(JSON.stringify(await json(await call(ownRoute.GET, "t-lead")))).not.toMatch(/anna|bo|stale/);
  });

  it("a nonmember app admin cannot read any participation (403, no state)", async () => {
    const response = await call(ownRoute.GET, "t-admin");
    expect(response.status).toBe(403);
    expectNoParticipation(await json(response));
  });

  it("an unauthenticated caller gets 401 with no state", async () => {
    const response = await call(ownRoute.GET, "unknown-token");
    expect(response.status).toBe(401);
    expectNoParticipation(await json(response));
  });

  it("the own-state route never returns the consent timestamp or any membership field", async () => {
    const text = JSON.stringify(await json(await call(ownRoute.GET, "t-anna")));
    for (const fragment of ["consentedAt", "noticeVersion", "2031", "uid", "memberRef", "role", "anna"]) {
      expect(text).not.toContain(fragment);
    }
  });

  it("the own-state route exports only GET, PUT and DELETE", () => {
    expect(Object.keys(ownRoute).filter((name) => /^[A-Z]+$/.test(name)).sort()).toEqual(["DELETE", "GET", "PUT"]);
  });
});
