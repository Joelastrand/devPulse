import { describe, expect, it, vi } from "vitest";
import * as encryptionModule from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ArchiveChallengeDeps, ArchiveChallengeDocSnapshot, ChallengeDocStore } from "./archive-challenge";
import { archiveChallenge } from "./archive-challenge";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-42";
const CHALLENGE_ID = "challenge-1";
const NOW = new Date("2026-09-01T00:00:00Z");

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
  updates: { challengeId: string; data: Record<string, unknown> }[];
}

function fakeChallengeDocStore(data: Record<string, unknown> | undefined): FakeChallengeDocStore {
  const updates: { challengeId: string; data: Record<string, unknown> }[] = [];
  return {
    updates,
    async get(): Promise<ArchiveChallengeDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async update(challengeId, updateData) {
      updates.push({ challengeId, data: updateData });
    },
  };
}

function baseDeps(overrides: Partial<ArchiveChallengeDeps> = {}): ArchiveChallengeDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    docs: fakeChallengeDocStore(challengeData()),
    now: NOW,
    ...overrides,
  };
}

describe("archiveChallenge", () => {
  it("archives an open challenge, setting archivedAt/archivedBy to server-derived now/admin uid", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toEqual([
      { challengeId: CHALLENGE_ID, data: { archivedAt: NOW, archivedBy: ADMIN_UID } },
    ]);
  });

  it("archives an already-resolved challenge, preserving its resolvedAt/resolvedBy untouched", async () => {
    const resolvedAt = new Date("2026-02-01T00:00:00Z");
    const docs = fakeChallengeDocStore(challengeData({ resolvedAt, resolvedBy: "some-admin" }));

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toEqual([
      { challengeId: CHALLENGE_ID, data: { archivedAt: NOW, archivedBy: ADMIN_UID } },
    ]);
    // Only archivedAt/archivedBy were written — resolvedAt/resolvedBy were
    // never part of this write (SPEC — "Persisted fields per transition").
    expect(docs.updates[0].data).not.toHaveProperty("resolvedAt");
    expect(docs.updates[0].data).not.toHaveProperty("resolvedBy");
  });

  it("never accepts a client-supplied archivedBy — the acting admin's verified uid is always used", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const identity = verifiedIdentity({ uid: "admin-2", email: "second-admin@example.com" });

    const result = await archiveChallenge(
      "token",
      TEAM_ID,
      CHALLENGE_ID,
      baseDeps({
        docs,
        verifyToken: verifyTokenReturning(identity),
        allowList: [ADMIN_EMAIL, "second-admin@example.com"],
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toEqual([
      { challengeId: CHALLENGE_ID, data: { archivedAt: NOW, archivedBy: "admin-2" } },
    ]);
  });

  it("is idempotent on an already-archived challenge — no error, no write", async () => {
    const docs = fakeChallengeDocStore(
      challengeData({ archivedAt: new Date("2026-02-01T00:00:00Z"), archivedBy: "some-admin" }),
    );

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a challenge belonging to a different team — never mutated through the wrong team's route", async () => {
    const docs = fakeChallengeDocStore(challengeData({ teamId: "other-team" }));

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "wrong_team" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a missing challenge with not_found", async () => {
    const docs = fakeChallengeDocStore(undefined);

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.updates).toHaveLength(0);
  });

  it("fails closed on a malformed challenge document, writing nothing", async () => {
    const docs = fakeChallengeDocStore({ teamId: TEAM_ID }); // missing ciphertext/iv/authTag/keyVersion/submittedAt

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects an unauthenticated caller and reads nothing", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await archiveChallenge("bad-token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a non-admin caller and reads nothing", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(docs.updates).toHaveLength(0);
  });

  it("reports a controlled failure when reading the challenge fails", async () => {
    const docs: ChallengeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      update: vi.fn(),
    };

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the write fails", async () => {
    const docs: ChallengeDocStore = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => challengeData() }),
      update: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("succeeds against a disabled team's challenge — this operation accepts no team-status seam at all", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    const result = await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(baseDeps()).not.toHaveProperty("teamStatusReader");
  });

  it("never calls decrypt — management writes never need challenge plaintext", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const decryptSpy = vi.spyOn(encryptionModule, "decrypt");

    await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(decryptSpy).not.toHaveBeenCalled();
    decryptSpy.mockRestore();
  });

  it("never exposes an unarchiveChallenge-shaped export", async () => {
    const moduleExports = await import("./archive-challenge");
    expect(Object.keys(moduleExports)).not.toContain("unarchiveChallenge");
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps());

    const failingDocs: ChallengeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      update: vi.fn(),
    };
    await archiveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs: failingDocs }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
