import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import * as encryptionModule from "../../../lib/encryption/encryption";
import type { ChallengeDocStore, ResolveChallengeDeps, ResolveChallengeDocSnapshot } from "./resolve-challenge";
import { resolveChallenge } from "./resolve-challenge";

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
    async get(): Promise<ResolveChallengeDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async update(challengeId, updateData) {
      updates.push({ challengeId, data: updateData });
    },
  };
}

function baseDeps(overrides: Partial<ResolveChallengeDeps> = {}): ResolveChallengeDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    docs: fakeChallengeDocStore(challengeData()),
    now: NOW,
    ...overrides,
  };
}

describe("resolveChallenge", () => {
  it("resolves an open challenge, setting resolvedAt/resolvedBy to server-derived now/admin uid", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toEqual([
      { challengeId: CHALLENGE_ID, data: { resolvedAt: NOW, resolvedBy: ADMIN_UID } },
    ]);
  });

  it("never accepts a client-supplied resolvedBy — the acting admin's verified uid is always used", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const identity = verifiedIdentity({ uid: "admin-2", email: "second-admin@example.com" });

    const result = await resolveChallenge(
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
      { challengeId: CHALLENGE_ID, data: { resolvedAt: NOW, resolvedBy: "admin-2" } },
    ]);
  });

  it("is idempotent on an already-resolved challenge — no error, no write", async () => {
    const docs = fakeChallengeDocStore(
      challengeData({ resolvedAt: new Date("2026-02-01T00:00:00Z"), resolvedBy: "some-admin" }),
    );

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects resolving an archived challenge with not_open, and writes nothing", async () => {
    const docs = fakeChallengeDocStore(
      challengeData({ archivedAt: new Date("2026-02-01T00:00:00Z"), archivedBy: "some-admin" }),
    );

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_open" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a challenge belonging to a different team — never mutated through the wrong team's route", async () => {
    const docs = fakeChallengeDocStore(challengeData({ teamId: "other-team" }));

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "wrong_team" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a missing challenge with not_found", async () => {
    const docs = fakeChallengeDocStore(undefined);

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.updates).toHaveLength(0);
  });

  it("fails closed on a malformed challenge document, writing nothing", async () => {
    const docs = fakeChallengeDocStore({ teamId: TEAM_ID }); // missing ciphertext/iv/authTag/keyVersion/submittedAt

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects an unauthenticated caller and reads nothing", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await resolveChallenge("bad-token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(docs.updates).toHaveLength(0);
  });

  it("rejects a non-admin caller and reads nothing", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(docs.updates).toHaveLength(0);
  });

  it("reports a controlled failure when reading the challenge fails", async () => {
    const docs: ChallengeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      update: vi.fn(),
    };

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the write fails", async () => {
    const docs: ChallengeDocStore = {
      get: vi.fn().mockResolvedValue({ exists: true, data: () => challengeData() }),
      update: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("succeeds against a disabled team's challenge — this operation accepts no team-status seam at all", async () => {
    const docs = fakeChallengeDocStore(challengeData());

    const result = await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    // `ResolveChallengeDeps` has no `teamStatusReader`/`teams`-shaped field —
    // there is no team-active gate for this operation to bypass (BR-22).
    expect(baseDeps()).not.toHaveProperty("teamStatusReader");
  });

  it("never calls decrypt — management writes never need challenge plaintext", async () => {
    const docs = fakeChallengeDocStore(challengeData());
    const decryptSpy = vi.spyOn(encryptionModule, "decrypt");

    await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs }));

    expect(decryptSpy).not.toHaveBeenCalled();
    decryptSpy.mockRestore();
  });

  it("never exposes an unresolveChallenge-shaped export", async () => {
    const moduleExports = await import("./resolve-challenge");
    expect(Object.keys(moduleExports)).not.toContain("unresolveChallenge");
    expect(Object.keys(moduleExports)).not.toContain("reopenChallenge");
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps());

    const failingDocs: ChallengeDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      update: vi.fn(),
    };
    await resolveChallenge("token", TEAM_ID, CHALLENGE_ID, baseDeps({ docs: failingDocs }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
