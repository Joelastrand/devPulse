import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedPayload } from "../../../lib/encryption/encryption";
import { decrypt, encrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import * as listTeamChallengesModule from "./list-team-challenges";
import type {
  ChallengesReader,
  ListTeamChallengesForAdminDeps,
  ListTeamChallengesForMemberDeps,
  RawChallengeDoc,
} from "./list-team-challenges";
import { listTeamChallengesForAdmin, listTeamChallengesForMember } from "./list-team-challenges";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const MEMBER_UID = "member-1";
const ADMIN_EMAIL = "admin@example.com";
const OPEN_TEXT = "Deploys have no clear owner and this causes delays.";
const RESOLVED_TEXT = "Code review regularly takes more than two days.";
const ARCHIVED_CANARY_TEXT = `ARCHIVED-CANARY-${randomBytes(8).toString("hex")}`;

function memberIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return memberIdentity({ email: ADMIN_EMAIL, ...overrides });
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function encryptedFields(text: string): EncryptedPayload {
  return encrypt(text);
}

function challengeDoc(
  id: string,
  text: string | undefined,
  overrides: Record<string, unknown> = {},
): RawChallengeDoc {
  const encoded = text !== undefined ? encryptedFields(text) : undefined;
  return {
    id,
    data: {
      teamId: TEAM_ID,
      submittedAt: new Date("2026-08-01T00:00:00Z"),
      ...(encoded ?? {
        ciphertext: "not-used",
        iv: "not-used",
        authTag: "not-used",
        keyVersion: "v1",
      }),
      ...overrides,
    },
  };
}

function fakeReader(
  docs: RawChallengeDoc[],
  options: { ignoreTeamFilter?: boolean } = {},
): ChallengesReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listRawForTeam(teamId) {
      calls.push(teamId);
      if (options.ignoreTeamFilter) {
        return docs;
      }
      return docs.filter((doc) => (doc.data as Record<string, unknown>).teamId === teamId);
    },
  };
}

function failingReader(): ChallengesReader {
  return {
    listRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
  };
}

function fakeAuthCollection(state: {
  teamStatus?: Record<string, unknown>;
  memberships?: Record<string, unknown>;
}): AuthorizeTeamAccessCollection {
  const teamStatus = state.teamStatus ?? {};
  const memberships = state.memberships ?? {};
  return {
    async getTeamStatus(teamId) {
      return teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      return memberships[`${uid}__${teamId}`];
    },
  };
}

function spyDecrypt(): ((payload: EncryptedPayload) => string) & { calls: EncryptedPayload[] } {
  const calls: EncryptedPayload[] = [];
  const fn = ((payload: EncryptedPayload) => {
    calls.push(payload);
    return decrypt(payload);
  }) as ((payload: EncryptedPayload) => string) & { calls: EncryptedPayload[] };
  fn.calls = calls;
  return fn;
}

function memberBaseDeps(
  overrides: Partial<ListTeamChallengesForMemberDeps> = {},
): ListTeamChallengesForMemberDeps {
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    authCollection: fakeAuthCollection({
      teamStatus: { [TEAM_ID]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
    }),
    reader: fakeReader([]),
    ...overrides,
  };
}

function adminBaseDeps(
  overrides: Partial<ListTeamChallengesForAdminDeps> = {},
): ListTeamChallengesForAdminDeps {
  return {
    verifyToken: verifyTokenReturning(adminIdentity()),
    allowList: [ADMIN_EMAIL],
    reader: fakeReader([]),
    ...overrides,
  };
}

describe("listTeamChallengesForMember", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects an unauthenticated caller, without ever calling the reader", async () => {
    const reader = fakeReader([challengeDoc("c1", OPEN_TEXT)]);
    const deps = memberBaseDeps({
      verifyToken: vi.fn().mockRejectedValue(new Error("invalid token")),
      reader,
    });

    const result = await listTeamChallengesForMember("bad-token", TEAM_ID, deps);

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(reader.calls).toHaveLength(0);
  });

  it("rejects a non-member/non-admin as forbidden, without calling the reader", async () => {
    const reader = fakeReader([challengeDoc("c1", OPEN_TEXT)]);
    const deps = memberBaseDeps({
      authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" }, memberships: {} }),
      reader,
    });

    const result = await listTeamChallengesForMember("token", TEAM_ID, deps);

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(reader.calls).toHaveLength(0);
  });

  it("returns read_failed, distinct from forbidden, when the authorization check itself fails", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      getMembership: vi.fn(),
    };
    const result = await listTeamChallengesForMember(
      "token",
      TEAM_ID,
      memberBaseDeps({ authCollection }),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("returns an authorized member's open and resolved challenges, decrypted", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT, { submittedAt: new Date("2026-08-02T10:00:00Z") }),
      challengeDoc("resolved-1", RESOLVED_TEXT, {
        submittedAt: new Date("2026-08-01T00:00:00Z"),
        resolvedAt: new Date("2026-08-03T00:00:00Z"),
        resolvedBy: "some-admin",
      }),
    ]);

    const result = await listTeamChallengesForMember("token", TEAM_ID, memberBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges).toHaveLength(2);
    expect(result.challenges.map((c) => c.status).sort()).toEqual(["open", "resolved"]);
    expect(result.challenges.find((c) => c.challengeId === "open-1")?.text).toBe(OPEN_TEXT);
    expect(result.challenges.find((c) => c.challengeId === "resolved-1")?.text).toBe(RESOLVED_TEXT);
  });

  it("never includes an archived challenge, even when one exists for the team", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      challengeDoc("archived-1", "archived plaintext", {
        archivedAt: new Date("2026-08-05T00:00:00Z"),
        archivedBy: "some-admin",
      }),
    ]);

    const result = await listTeamChallengesForMember("token", TEAM_ID, memberBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["open-1"]);
  });

  it("returns the identical member-scoped result for an app admin reading via this operation", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      challengeDoc("archived-1", "archived plaintext", { archivedAt: new Date("2026-08-05T00:00:00Z"), archivedBy: "x" }),
    ]);
    const deps = memberBaseDeps({
      verifyToken: verifyTokenReturning(adminIdentity()),
      authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" }, memberships: {} }),
      reader,
    });

    const result = await listTeamChallengesForMember("token", TEAM_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["open-1"]);
  });

  it("rejects listing Team B's challenges via a Team A member/admin identity (cross-team)", async () => {
    const reader = fakeReader([challengeDoc("b-1", OPEN_TEXT, { teamId: OTHER_TEAM_ID })]);
    const deps = memberBaseDeps({
      authCollection: fakeAuthCollection({
        teamStatus: { [OTHER_TEAM_ID]: "active" },
        memberships: {},
      }),
      reader,
    });

    const result = await listTeamChallengesForMember("token", OTHER_TEAM_ID, deps);

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("continues to list a disabled team's existing challenges for an existing member", async () => {
    const reader = fakeReader([challengeDoc("open-1", OPEN_TEXT)]);
    const deps = memberBaseDeps({
      authCollection: fakeAuthCollection({
        teamStatus: { [TEAM_ID]: "disabled" },
        memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
      }),
      reader,
    });

    const result = await listTeamChallengesForMember("token", TEAM_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges).toHaveLength(1);
  });

  it("excludes a malformed record without failing the whole call", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      { id: "malformed-1", data: { teamId: TEAM_ID } }, // missing ciphertext/iv/authTag/submittedAt
    ]);

    const result = await listTeamChallengesForMember("token", TEAM_ID, memberBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["open-1"]);
  });

  it("excludes a record whose ciphertext fails to decrypt, without failing the whole call or logging detail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      challengeDoc("corrupt-1", RESOLVED_TEXT, { ciphertext: "corrupted-not-real-ciphertext==" }),
    ]);

    const result = await listTeamChallengesForMember("token", TEAM_ID, memberBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["open-1"]);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns an empty list, not an error, for a team with no challenges", async () => {
    const result = await listTeamChallengesForMember(
      "token",
      TEAM_ID,
      memberBaseDeps({ reader: fakeReader([]) }),
    );

    expect(result).toEqual({ ok: true, challenges: [] });
  });

  it("returns read_failed, not an empty list, when the underlying query fails", async () => {
    const result = await listTeamChallengesForMember(
      "token",
      TEAM_ID,
      memberBaseDeps({ reader: failingReader() }),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("sorts challenges newest-first", async () => {
    const reader = fakeReader([
      challengeDoc("oldest", OPEN_TEXT, { submittedAt: new Date("2026-08-01T00:00:00Z") }),
      challengeDoc("newest", OPEN_TEXT, { submittedAt: new Date("2026-08-03T00:00:00Z") }),
      challengeDoc("middle", OPEN_TEXT, { submittedAt: new Date("2026-08-02T00:00:00Z") }),
    ]);

    const result = await listTeamChallengesForMember("token", TEAM_ID, memberBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["newest", "middle", "oldest"]);
  });

  it("never exposes uid, resolvedBy, archivedBy, resolvedAt, archivedAt, iv, authTag, keyVersion, or a full timestamp", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      challengeDoc("resolved-1", RESOLVED_TEXT, {
        resolvedAt: new Date("2026-08-03T12:34:56Z"),
        resolvedBy: MEMBER_UID,
      }),
    ]);

    const result = await listTeamChallengesForMember("token", TEAM_ID, memberBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const view of result.challenges) {
      expect(Object.keys(view).sort()).toEqual(["challengeId", "status", "submittedAt", "text"]);
      expect(view.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MEMBER_UID);
    expect(serialized).not.toContain("resolvedBy");
    expect(serialized).not.toContain("archivedBy");
    expect(serialized).not.toContain("resolvedAt");
    expect(serialized).not.toContain("archivedAt");
    expect(serialized).not.toContain('"iv"');
    expect(serialized).not.toContain("authTag");
    expect(serialized).not.toContain("keyVersion");
    expect(serialized).not.toContain("12:34:56");
  });

  it("ignores a client-supplied includeArchived-shaped field — output is unaffected", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      challengeDoc("archived-1", "archived plaintext", { archivedAt: new Date("2026-08-05T00:00:00Z"), archivedBy: "x" }),
    ]);
    const deps = { ...memberBaseDeps({ reader }), includeArchived: true, allowedStatuses: ["open", "resolved", "archived"] };

    const result = await listTeamChallengesForMember(
      "token",
      TEAM_ID,
      deps as ListTeamChallengesForMemberDeps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["open-1"]);
  });

  describe("critical regression: archived canary is excluded before decryption", () => {
    it("never appears in the serialized response, and its ciphertext is never passed to decrypt", async () => {
      const decryptSpy = spyDecrypt();
      const archivedDoc = challengeDoc("archived-canary", ARCHIVED_CANARY_TEXT, {
        archivedAt: new Date("2026-08-05T00:00:00Z"),
        archivedBy: "some-admin",
      });
      const reader = fakeReader([
        challengeDoc("open-1", OPEN_TEXT),
        challengeDoc("resolved-1", RESOLVED_TEXT, {
          resolvedAt: new Date("2026-08-03T00:00:00Z"),
          resolvedBy: "some-admin",
        }),
        archivedDoc,
      ]);

      const result = await listTeamChallengesForMember(
        "token",
        TEAM_ID,
        memberBaseDeps({ reader, decryptText: decryptSpy }),
      );

      expect(result.ok).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(ARCHIVED_CANARY_TEXT);
      expect(serialized).not.toContain("archived-canary");

      const archivedCiphertext = (archivedDoc.data as { ciphertext: string }).ciphertext;
      expect(decryptSpy.calls.some((call) => call.ciphertext === archivedCiphertext)).toBe(false);
    });
  });
});

describe("listTeamChallengesForAdmin", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects an unauthenticated caller, without calling the reader", async () => {
    const reader = fakeReader([challengeDoc("c1", OPEN_TEXT)]);
    const result = await listTeamChallengesForAdmin(
      "bad-token",
      TEAM_ID,
      adminBaseDeps({ verifyToken: vi.fn().mockRejectedValue(new Error("invalid token")), reader }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(reader.calls).toHaveLength(0);
  });

  it("rejects a non-admin, including a plain team member, without calling the reader", async () => {
    const reader = fakeReader([challengeDoc("c1", OPEN_TEXT)]);
    const result = await listTeamChallengesForAdmin(
      "token",
      TEAM_ID,
      adminBaseDeps({ verifyToken: verifyTokenReturning(memberIdentity()), reader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(reader.calls).toHaveLength(0);
  });

  it("returns exactly open, resolved, and archived challenges for an app admin, in one call", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      challengeDoc("resolved-1", RESOLVED_TEXT, {
        resolvedAt: new Date("2026-08-03T00:00:00Z"),
        resolvedBy: "some-admin",
      }),
      challengeDoc("archived-canary", ARCHIVED_CANARY_TEXT, {
        archivedAt: new Date("2026-08-05T00:00:00Z"),
        archivedBy: "some-admin",
      }),
    ]);

    const result = await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.status).sort()).toEqual(["archived", "open", "resolved"]);
    expect(result.challenges.find((c) => c.challengeId === "archived-canary")?.text).toBe(
      ARCHIVED_CANARY_TEXT,
    );
  });

  it("rejects cross-team listing via a different team's route scope", async () => {
    const reader = fakeReader([challengeDoc("b-1", OPEN_TEXT, { teamId: OTHER_TEAM_ID })]);
    // Non-admin identity attempting Team B — must still be rejected forbidden
    // regardless of teamId, proving the boundary is `requireAppAdmin`, not
    // team membership.
    const result = await listTeamChallengesForAdmin(
      "token",
      OTHER_TEAM_ID,
      adminBaseDeps({ verifyToken: verifyTokenReturning(memberIdentity()), reader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("never leaks a corrupted cross-team record even if the reader seam ignores team scoping", async () => {
    const reader = fakeReader(
      [challengeDoc("cross-team-1", OPEN_TEXT, { teamId: OTHER_TEAM_ID })],
      { ignoreTeamFilter: true },
    );

    const result = await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges).toHaveLength(0);
  });

  it("continues to list a disabled team's existing challenges", async () => {
    // requireAppAdmin never reads team status at all — there is no gate to
    // bypass; this test documents that continuity, mirroring BR-14/BR-22.
    const reader = fakeReader([challengeDoc("open-1", OPEN_TEXT)]);
    const result = await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges).toHaveLength(1);
  });

  it("excludes a malformed or undecryptable record without failing the whole call", async () => {
    const reader = fakeReader([
      challengeDoc("open-1", OPEN_TEXT),
      { id: "malformed-1", data: { teamId: TEAM_ID } },
      challengeDoc("corrupt-1", RESOLVED_TEXT, { ciphertext: "corrupted-not-real-ciphertext==" }),
    ]);

    const result = await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual(["open-1"]);
  });

  it("returns read_failed when the underlying query fails", async () => {
    const result = await listTeamChallengesForAdmin(
      "token",
      TEAM_ID,
      adminBaseDeps({ reader: failingReader() }),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never exposes uid, resolvedBy, archivedBy, resolvedAt, archivedAt, or encrypted fields", async () => {
    const reader = fakeReader([
      challengeDoc("archived-1", "archived text", {
        archivedAt: new Date("2026-08-05T00:00:00Z"),
        archivedBy: ADMIN_EMAIL,
      }),
    ]);

    const result = await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const view of result.challenges) {
      expect(Object.keys(view).sort()).toEqual(["challengeId", "status", "submittedAt", "text"]);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("archivedBy");
    expect(serialized).not.toContain("archivedAt");
    expect(serialized).not.toContain('"iv"');
    expect(serialized).not.toContain("authTag");
    expect(serialized).not.toContain("keyVersion");
  });

  it("sorts challenges newest-first, including the archived-canary record", async () => {
    const reader = fakeReader([
      challengeDoc("oldest", OPEN_TEXT, { submittedAt: new Date("2026-08-01T00:00:00Z") }),
      challengeDoc("archived-canary", ARCHIVED_CANARY_TEXT, {
        submittedAt: new Date("2026-08-03T00:00:00Z"),
        archivedAt: new Date("2026-08-04T00:00:00Z"),
        archivedBy: "some-admin",
      }),
      challengeDoc("middle", OPEN_TEXT, { submittedAt: new Date("2026-08-02T00:00:00Z") }),
    ]);

    const result = await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenges.map((c) => c.challengeId)).toEqual([
      "archived-canary",
      "middle",
      "oldest",
    ]);
  });

  it("never logs across success, rejection, and failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader: fakeReader([challengeDoc("c1", OPEN_TEXT)]) }));
    await listTeamChallengesForAdmin(
      "token",
      TEAM_ID,
      adminBaseDeps({ verifyToken: verifyTokenReturning(memberIdentity()) }),
    );
    await listTeamChallengesForAdmin("token", TEAM_ID, adminBaseDeps({ reader: failingReader() }));
    await listTeamChallengesForAdmin(
      "token",
      TEAM_ID,
      adminBaseDeps({
        reader: fakeReader([challengeDoc("corrupt-1", RESOLVED_TEXT, { ciphertext: "corrupted==" })]),
      }),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("module surface", () => {
  it("exports only the two documented public read operations", () => {
    expect(Object.keys(listTeamChallengesModule).sort()).toEqual([
      "listTeamChallengesForAdmin",
      "listTeamChallengesForMember",
    ]);
  });
});
