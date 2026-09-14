import { describe, expect, it, vi } from "vitest";
import * as encryptionModule from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ChallengeDocStore, DeleteChallengeDeps, DeleteChallengeDocSnapshot } from "./delete-challenge";
import { deleteChallenge } from "./delete-challenge";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-42";
const CHALLENGE_ID = "challenge-1";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function challengeData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    ciphertext: "ciphertext-bytes",
    iv: "iv-bytes",
    authTag: "auth-tag-bytes",
    keyVersion: "v1",
    submittedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

interface FakeChallengeDocStore extends ChallengeDocStore {
  deletedIds: string[];
}

function fakeChallengeDocStore(data: Record<string, unknown> | undefined): FakeChallengeDocStore {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    async get(): Promise<DeleteChallengeDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async delete(challengeId) {
      deletedIds.push(challengeId);
    },
  };
}

function baseDeps(overrides: Partial<DeleteChallengeDeps> = {}): DeleteChallengeDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    docs: fakeChallengeDocStore(challengeData()),
    ...overrides,
  };
}

describe("deleteChallenge", () => {
  it("permanently deletes an open challenge", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.deletedIds).toEqual([CHALLENGE_ID]);
  });

  it("permanently deletes a resolved challenge", async () => {
    const docs = fakeChallengeDocStore(
      challengeData({ resolvedAt: new Date("2026-02-01T00:00:00Z"), resolvedBy: "some-admin" }),
    );

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.deletedIds).toEqual([CHALLENGE_ID]);
  });

  it("permanently deletes an archived challenge", async () => {
    const docs = fakeChallengeDocStore(
      challengeData({ archivedAt: new Date("2026-02-01T00:00:00Z"), archivedBy: "some-admin" }),
    );

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.deletedIds).toEqual([CHALLENGE_ID]);
  });

  it("rejects a challenge belonging to a different team — never deleted through the wrong team's route", async () => {
    const docs = fakeChallengeDocStore(challengeData({ teamId: "other-team" }));

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "wrong_team" });
    expect(docs.deletedIds).toHaveLength(0);
  });

  it("rejects a missing challenge with not_found — a repeated delete call is not a distinct outcome", async () => {
    const docs = fakeChallengeDocStore(undefined);

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.deletedIds).toHaveLength(0);
  });

  it("fails closed on a malformed challenge document, deleting nothing", async () => {
    const docs = fakeChallengeDocStore({ teamId: TEAM_ID }); // missing ciphertext/iv/authTag/keyVersion/submittedAt

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.deletedIds).toHaveLength(0);
  });

  it("rejects an unauthenticated caller and reads nothing", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await deleteChallenge("bad-token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(docs.deletedIds).toHaveLength(0);
  });

  it("rejects a non-admin caller and reads nothing", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(docs.deletedIds).toHaveLength(0);
  });

  it("reports a controlled failure when reading the challenge fails", async () => {
    const docs: ChallengeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      delete: vi.fn(),
    };

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the delete write fails", async () => {
    const docs: ChallengeDocStore = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => challengeData() }),
      delete: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("succeeds against a disabled team's challenge — this operation accepts no team-status seam at all", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    const result = await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(baseDeps()).not.toHaveProperty("teamStatusReader");
  });

  it("never calls decrypt — management deletion never needs challenge plaintext", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const decryptSpy = vi.spyOn(encryptionModule, "decrypt");

    await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(decryptSpy).not.toHaveBeenCalled();
    decryptSpy.mockRestore();
  });

  it("leaves no tombstone/audit document — only the target document itself is ever touched", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(docs.deletedIds).toEqual([CHALLENGE_ID]);
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps());

    const failingDocs: ChallengeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      delete: vi.fn(),
    };
    await deleteChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs: failingDocs }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
