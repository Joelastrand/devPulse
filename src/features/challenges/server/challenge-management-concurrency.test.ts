import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { effectiveChallengeStatus } from "../domain/challenge";
import type { ChallengeDocStore as ArchiveChallengeDocStore } from "./archive-challenge";
import { archiveChallenge } from "./archive-challenge";
import type { ChallengeDocStore as ResolveChallengeDocStore } from "./resolve-challenge";
import { resolveChallenge } from "./resolve-challenge";

/**
 * Models this feature's accepted concurrency posture (docs/features/
 * anonymous-challenges/SPEC.md — "Edge cases and failure behavior",
 * "Accepted residual risks" #7): `resolveChallenge`/`archiveChallenge` use
 * no Firestore transaction, so two concurrent calls can both read the
 * challenge's pre-write state before either call's `update()` lands. This
 * fake models exactly that — `get()` always returns the original,
 * never-mutated snapshot (as if both calls' reads happened before either
 * write), while every `update()` call is still recorded in order, so a
 * test can assert what a real plain (non-transactional) `update()` would
 * do: the last write to land determines the final `resolvedBy`/
 * `archivedBy`/timestamp, while the derived *status* stays correct
 * regardless of ordering.
 */
function fakeConcurrentStore(initialData: Record<string, unknown>) {
  const writes: { challengeId: string; data: Record<string, unknown> }[] = [];
  const store: ResolveChallengeDocStore & ArchiveChallengeDocStore = {
    async get() {
      return { exists: true, data: () => initialData };
    },
    async update(challengeId, data) {
      writes.push({ challengeId, data });
    },
  };
  return { store, writes };
}

const TEAM_ID = "team-42";
const CHALLENGE_ID = "challenge-1";

function identity(uid: string, email: string): VerifiedIdentity {
  return { uid, email, emailVerified: true };
}

function verifyTokenFor(id: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({ uid: id.uid, email: id.email, email_verified: id.emailVerified });
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

describe("concurrent challenge management", () => {
  it("two concurrent resolveChallenge calls on the same open challenge both succeed and leave it resolved", async () => {
    const admin1 = identity("admin-1", "admin1@example.com");
    const admin2 = identity("admin-2", "admin2@example.com");
    const { store, writes } = fakeConcurrentStore(challengeData());

    const [result1, result2] = await Promise.all([
      resolveChallenge("token-1", TEAM_ID, CHALLENGE_ID, {
        verifyToken: verifyTokenFor(admin1),
        allowList: [admin1.email, admin2.email],
        docs: store,
        now: new Date("2026-09-01T00:00:00Z"),
      }),
      resolveChallenge("token-2", TEAM_ID, CHALLENGE_ID, {
        verifyToken: verifyTokenFor(admin2),
        allowList: [admin1.email, admin2.email],
        docs: store,
        now: new Date("2026-09-01T00:00:05Z"),
      }),
    ]);

    expect(result1).toEqual({ ok: true });
    expect(result2).toEqual({ ok: true });

    // Both calls proceeded to write (mirrors the real, non-transactional
    // `update()` race SPEC accepts) — the derived status after applying
    // both writes in order is still deterministically "resolved" either
    // way, never "open" and never something outside the canonical
    // lifecycle.
    expect(writes).toHaveLength(2);
    const merged = writes.reduce<Record<string, unknown>>(
      (acc, write) => ({ ...acc, ...write.data }),
      challengeData(),
    );
    expect(effectiveChallengeStatus(merged as { resolvedAt?: Date; archivedAt?: Date })).toBe("resolved");
    // The last write to physically land is the one whose resolvedBy/
    // resolvedAt survive — an accepted imprecision (SPEC — "Accepted
    // residual risks" #7), never exposed by any API response (BR-13).
    expect(merged.resolvedBy).toBe(writes[writes.length - 1].data.resolvedBy);
  });

  it("a resolveChallenge and an archiveChallenge racing on the same challenge both commit and resolve to archived", async () => {
    const admin1 = identity("admin-1", "admin1@example.com");
    const admin2 = identity("admin-2", "admin2@example.com");
    const initial = challengeData();
    const resolveWrites: { challengeId: string; data: Record<string, unknown> }[] = [];
    const archiveWrites: { challengeId: string; data: Record<string, unknown> }[] = [];

    const resolveStore: ResolveChallengeDocStore = {
      async get() {
        return { exists: true, data: () => initial };
      },
      async update(challengeId, data) {
        resolveWrites.push({ challengeId, data });
      },
    };
    const archiveStore: ArchiveChallengeDocStore = {
      async get() {
        return { exists: true, data: () => initial };
      },
      async update(challengeId, data) {
        archiveWrites.push({ challengeId, data });
      },
    };

    const [resolveResult, archiveResult] = await Promise.all([
      resolveChallenge("token-1", TEAM_ID, CHALLENGE_ID, {
        verifyToken: verifyTokenFor(admin1),
        allowList: [admin1.email, admin2.email],
        docs: resolveStore,
        now: new Date("2026-09-01T00:00:00Z"),
      }),
      archiveChallenge("token-2", TEAM_ID, CHALLENGE_ID, {
        verifyToken: verifyTokenFor(admin2),
        allowList: [admin1.email, admin2.email],
        docs: archiveStore,
        now: new Date("2026-09-01T00:00:05Z"),
      }),
    ]);

    expect(resolveResult).toEqual({ ok: true });
    expect(archiveResult).toEqual({ ok: true });

    // The two writes touch disjoint field pairs (resolvedAt/resolvedBy vs.
    // archivedAt/archivedBy), so both commit without clobbering each
    // other — unlike two same-field writes, this race has no imprecision
    // at all. The merged result deterministically derives "archived"
    // (archived takes precedence over resolved, per "Lifecycle").
    const merged = {
      ...initial,
      ...resolveWrites[0]?.data,
      ...archiveWrites[0]?.data,
    };
    expect(effectiveChallengeStatus(merged as { resolvedAt?: Date; archivedAt?: Date })).toBe("archived");
  });
});
