import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "./fixtures";
import { toPersistedUserProfile } from "../../profiles/domain/user-profile-content-codec";
import { listTeamMembers, type TeamMembersCollection } from "../../teams/server/list-team-members";
import { verifyIdToken, type LiveAccount } from "../../auth/server/verify-identity";

// The auth preamble is stubbed: this test is about the read model. The disabled-account rejection below uses the real verifyIdToken.
vi.mock("../../teams/server/require-app-admin", () => ({
  requireAppAdmin: async () => ({ ok: true, identity: { uid: "koEwzQcj5Uc0hnjTgZBLithgkYB3", email: "admin@nve.no", emailVerified: true } }),
}));

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: vi.fn(), getUser: vi.fn() }),
  getFirestoreDb: () => ({}),
}));

const TEAM = "8yB2bS8Jav69TCfDETON";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const PRESENTER_EMAIL = "admin@nve.no";
const AS_OF = new Date("2026-11-14T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
afterEach(() => vi.unstubAllEnvs());

const noErasure = async () => ({ kind: "none" as const });
const notSuperadmin = async () => false;

describe("fictional members in the existing team member list", () => {
  it("lists disabled fictional members with their display names and team membership, and keeps the presenter as teamadmin", async () => {
    const memberships = [
      { uid: PRESENTER, teamId: TEAM, role: "teamadmin" },
      ...DEMO_MEMBER_IDENTITIES.map((i) => buildIdentityMembership(i, TEAM, AS_OF)),
    ];
    const collection: TeamMembersCollection = { listRawForTeam: async () => memberships };
    const accounts = new Map<string, { email: string; disabled: boolean }>([
      [PRESENTER, { email: PRESENTER_EMAIL, disabled: false }],
      ...DEMO_MEMBER_IDENTITIES.map((i) => [i.uid, { email: i.email, disabled: true }] as const),
    ]);
    const sealed = new Map(
      DEMO_MEMBER_IDENTITIES.map((i) => [
        i.uid,
        toPersistedUserProfile(i.uid, { displayName: i.fullName, createdAt: AS_OF, updatedAt: AS_OF }, demoCrypto.sealRecord),
      ]),
    );

    const result = await listTeamMembers("token", TEAM, {
      collection,
      getUser: async (uid) => {
        const account = accounts.get(uid);
        if (account === undefined) throw new Error("no such user");
        return { email: account.email };
      },
      profileReader: {
        readBatch: async (uids) => uids.map((uid) => ({ uid, data: sealed.has(uid) ? { ...(sealed.get(uid) as object) } : undefined })),
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.members).toHaveLength(11);
    const presenter = result.members.find((m) => m.uid === PRESENTER);
    expect(presenter?.role).toBe("teamadmin");
    const first = result.members.find((m) => m.uid === "demo-member-01");
    expect(first).toMatchObject({ displayName: "Ingrid Solberg", email: "ingrid.solberg@example.com", role: "member" });
  });
});

describe("disabled fictional accounts cannot authenticate", () => {
  it("rejects a valid-looking token whose live Auth account is disabled", async () => {
    const live: LiveAccount = {
      uid: "demo-member-01",
      email: "ingrid.solberg@example.com",
      emailVerified: true,
      disabled: true,
    };
    const result = await verifyIdToken("token", {
      verifyToken: vi.fn().mockResolvedValue({ uid: live.uid, email: live.email, email_verified: true }),
      readFence: noErasure,
      loadAccount: async () => live,
      isSuperadmin: notSuperadmin,
    });
    expect(result).toEqual({ ok: false, error: "invalid_token" });
  });
});
