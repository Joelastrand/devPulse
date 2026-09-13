import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { CloseSurveyDb, CloseSurveyDeps, CloseSurveyTransaction } from "./close-survey";
import { closeSurvey } from "./close-survey";
import type { OpenSurveyDb } from "./open-survey";
import { openSurvey } from "./open-survey";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-42";
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

function surveyDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdBy: "some-admin",
    ...overrides,
  };
}

type PendingWrite = { kind: "set"; data: Record<string, unknown> } | { kind: "update"; data: Record<string, unknown> };

/**
 * An in-memory transactional Firestore fake modeling real Firestore
 * transaction semantics — mirrors `open-survey.test.ts`'s fake exactly
 * (every document read during an attempt is versioned; a commit is
 * rejected and the whole callback retried with fresh reads if any read
 * document's version changed since). Structurally satisfies both
 * `CloseSurveyDb` and `OpenSurveyDb` (identical shape), so the same store
 * can be shared by a `closeSurvey`-vs-`openSurvey` concurrency test to
 * prove both operations serialize against the same `teamSurveyState`
 * document.
 */
function createInMemoryFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, { data: Record<string, unknown>; version: number }>();
  for (const [path, data] of Object.entries(seed)) {
    store.set(path, { data, version: 1 });
  }
  let totalAttempts = 0;
  let totalCommittedWrites = 0;
  // One entry per successfully committed transaction attempt, listing the
  // paths written in that single commit — lets a test assert that two
  // mutations landed in the *same* transaction boundary, not just that both
  // were eventually written.
  const commits: string[][] = [];

  const db: CloseSurveyDb = {
    async runTransaction(fn) {
      const MAX_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        totalAttempts += 1;
        const reads = new Map<string, number>();
        const writes = new Map<string, PendingWrite>();

        const tx: CloseSurveyTransaction = {
          async get(path) {
            // Real Firestore transactions throw if `.get()` is called after
            // `.set()`/`.update()` has already been issued in the same
            // attempt — this fake enforces the same rule, rather than
            // silently allowing an ordering a live backend would reject
            // (the exact defect discovered in `closeSurvey` during TASK-006).
            if (writes.size > 0) {
              throw new Error(
                `Firestore transactions require all reads to be executed before all writes (attempted to read "${path}" after staging a write).`,
              );
            }
            const existing = store.get(path);
            reads.set(path, existing?.version ?? 0);
            return { exists: existing !== undefined, data: () => existing?.data };
          },
          set(path, data) {
            writes.set(path, { kind: "set", data });
          },
          update(path, data) {
            writes.set(path, { kind: "update", data });
          },
        };

        const result = await fn(tx);

        let conflict = false;
        for (const [path, seenVersion] of reads) {
          if ((store.get(path)?.version ?? 0) !== seenVersion) {
            conflict = true;
            break;
          }
        }

        if (!conflict) {
          for (const [path, write] of writes) {
            const current = store.get(path);
            const nextData =
              write.kind === "set" ? write.data : { ...(current?.data ?? {}), ...write.data };
            store.set(path, { data: nextData, version: (current?.version ?? 0) + 1 });
            totalCommittedWrites += 1;
          }
          if (writes.size > 0) {
            commits.push([...writes.keys()]);
          }
          return result;
        }
        // Conflict: discard this attempt's buffered writes and retry with fresh reads.
      }
      throw new Error("transaction retry limit exceeded");
    },
  };

  return {
    db,
    store,
    commits,
    get totalAttempts() {
      return totalAttempts;
    },
    get totalCommittedWrites() {
      return totalCommittedWrites;
    },
  };
}

function baseDeps(db: CloseSurveyDb, overrides: Partial<CloseSurveyDeps> = {}): CloseSurveyDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    now: NOW,
    db,
    ...overrides,
  };
}

describe("closeSurvey", () => {
  it("closes an open survey, setting closedAt to the server's own time", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.closedAt).toEqual(NOW);
  });

  it("clears a matching teamSurveyState pointer in the same transaction", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-1",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: null,
      updatedAt: NOW,
    });
  });

  it("commits the survey closedAt write and the teamSurveyState clear as one atomic transaction", async () => {
    // Regression test: proves the two mutations share a single transaction
    // boundary, not just that both eventually land in the store. Would fail
    // if `closeSurvey` were refactored from one `runTransaction` call into
    // two independent, non-transactional writes — that shape produces two
    // separate commit entries below (each containing only one of the two
    // paths), so no single entry would contain both.
    const { db, commits } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-1",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });

    const commitsTouchingEitherPath = commits.filter(
      (paths) => paths.includes("surveys/survey-1") || paths.includes("teamSurveyState/team-42"),
    );
    // Exactly one committed transaction touched these paths at all...
    expect(commitsTouchingEitherPath).toHaveLength(1);
    // ...and that single commit contains both writes together.
    expect(commitsTouchingEitherPath[0]).toEqual(
      expect.arrayContaining(["surveys/survey-1", "teamSurveyState/team-42"]),
    );
  });

  it("leaves a non-matching teamSurveyState pointer (a different survey for the same team) untouched", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-other",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: "survey-other",
      updatedAt: new Date("2026-08-15T00:00:00Z"),
    });
  });

  it("leaves a null teamSurveyState pointer untouched (no write attempted)", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": { activeSurveyId: null, updatedAt: new Date("2026-08-15T00:00:00Z") },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: null,
      updatedAt: new Date("2026-08-15T00:00:00Z"),
    });
  });

  it("fails closed on a malformed (non-string) activeSurveyId, never crashing and never repairing it", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": { activeSurveyId: 12345, updatedAt: new Date("2026-08-15T00:00:00Z") },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: 12345,
      updatedAt: new Date("2026-08-15T00:00:00Z"),
    });
  });

  it("leaves a dangling teamSurveyState pointer (references a nonexistent survey) untouched", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": { activeSurveyId: "ghost-survey", updatedAt: new Date("2026-08-15T00:00:00Z") },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("ghost-survey");
  });

  it("never reads or writes another team's teamSurveyState document", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/other-team": { activeSurveyId: "survey-1", updatedAt: new Date("2026-08-15T00:00:00Z") },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    // survey-1 belongs to team-42, not other-team — the coordination
    // lookup is keyed by the survey's own teamId, never any other team's.
    expect(store.get("teamSurveyState/other-team")?.data).toEqual({
      activeSurveyId: "survey-1",
      updatedAt: new Date("2026-08-15T00:00:00Z"),
    });
  });

  it("is idempotent when closing an already-explicitly-closed survey: no error, closedAt unchanged", async () => {
    const alreadyClosedAt = new Date("2026-08-20T00:00:00Z");
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({
        openedAt: new Date("2026-08-15T00:00:00Z"),
        closedAt: alreadyClosedAt,
      }),
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.closedAt).toEqual(alreadyClosedAt);
  });

  it("self-heals a stale teamSurveyState pointer even on an idempotent (already-closed) close", async () => {
    const alreadyClosedAt = new Date("2026-08-20T00:00:00Z");
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({
        openedAt: new Date("2026-08-15T00:00:00Z"),
        closedAt: alreadyClosedAt,
      }),
      "teamSurveyState/team-42": { activeSurveyId: "survey-1", updatedAt: new Date("2026-08-15T00:00:00Z") },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.closedAt).toEqual(alreadyClosedAt);
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: null,
      updatedAt: NOW,
    });
  });

  it("is idempotent for a survey effectively closed via a passed endAt with closedAt never explicitly set, without backfilling closedAt to now", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({
        openedAt: new Date("2026-08-01T00:00:00Z"),
        endAt: new Date("2026-08-20T00:00:00Z"),
      }),
      "teamSurveyState/team-42": { activeSurveyId: "survey-1", updatedAt: new Date("2026-08-01T00:00:00Z") },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    // closedAt is never written here — backfilling it (to endAt) is a
    // read-path concern for a later task, and writing `now` would record a
    // later, inaccurate instant than when the survey actually stopped
    // being answerable.
    expect(store.get("surveys/survey-1")?.data.closedAt).toBeUndefined();
    // The coordination pointer is still cleared, since it matches.
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: null,
      updatedAt: NOW,
    });
  });

  it("rejects closing a scheduled survey that was never opened, attempting no write", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "not_open" });
    expect(store.get("surveys/survey-1")?.data.closedAt).toBeUndefined();
  });

  it("rejects a nonexistent surveyId", async () => {
    const { db } = createInMemoryFirestore();

    const result = await closeSurvey("token", "no-such-survey", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("fails closed (survey_not_found) on a malformed survey record, e.g. missing createdAt", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": { teamId: TEAM_ID, accessMode: "public", createdBy: "admin-x" },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("closes a survey belonging to a disabled team (closing is not gated on team-active status)", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teams/team-42": { status: "disabled" },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.closedAt).toEqual(NOW);
  });

  it("rejects an unauthenticated caller and attempts no transaction", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
    });
    const runTransactionSpy = vi.spyOn(db, "runTransaction");
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await closeSurvey("token", "survey-1", baseDeps(db, { verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(runTransactionSpy).not.toHaveBeenCalled();
    expect(store.get("surveys/survey-1")?.data.closedAt).toBeUndefined();
  });

  it("rejects a non-admin caller and attempts no transaction", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
    });
    const runTransactionSpy = vi.spyOn(db, "runTransaction");
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await closeSurvey("token", "survey-1", baseDeps(db, { verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(runTransactionSpy).not.toHaveBeenCalled();
  });

  it("reports a controlled failure, not a thrown error, when the transaction fails", async () => {
    const db: CloseSurveyDb = {
      runTransaction: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs the token, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
    });
    await closeSurvey("token", "survey-1", baseDeps(db));

    const failingDb: CloseSurveyDb = {
      runTransaction: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await closeSurvey("token", "survey-1", baseDeps(failingDb));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("performs every Firestore read before any write (real-Firestore transaction ordering)", async () => {
    // Regression test for a defect discovered while implementing TASK-006:
    // `closeSurvey` used to call `tx.update` on the survey document before
    // a later `tx.get` on `teamSurveyState` within the same attempt. Real
    // Firestore transactions throw in that situation ("all reads must be
    // executed before all writes"); the in-memory fake below now enforces
    // the identical rule, so this test would fail immediately if that
    // ordering ever regressed — without relying solely on reading the
    // source to check the call order.
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-1",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await closeSurvey("token", "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.closedAt).toEqual(NOW);
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBeNull();
  });

  it("the fake itself rejects a read staged after a write, proving it would have caught the original write-then-read defect", async () => {
    // Directly exercises the fake's own ordering guard (not `closeSurvey`)
    // with the exact shape of the original bug: a write issued, then a
    // read attempted afterward in the same transaction attempt. This is
    // the evidence that hardening the fake actually changes its behavior,
    // rather than merely asserting the current (already-fixed) call order.
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-1",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    await expect(
      db.runTransaction(async (tx) => {
        tx.update("surveys/survey-1", { closedAt: NOW });
        await tx.get("teamSurveyState/team-42");
      }),
    ).rejects.toThrow(/reads to be executed before all writes/);
  });

  it("does not export a reopen operation", async () => {
    const closeSurveyModule: Record<string, unknown> = await import("./close-survey");

    expect(Object.keys(closeSurveyModule)).not.toContain("reopenSurvey");
    expect(typeof closeSurveyModule.closeSurvey).toBe("function");
  });

  it("participates in the same teamSurveyState serialization point as openSurvey: a concurrent close and open for the same team never leave a corrupted pointer", async () => {
    // survey-1 is genuinely open for team-42; survey-2 is a fresh
    // scheduled survey for the same team. Racing closeSurvey(survey-1)
    // against openSurvey(team-42, survey-2) exercises both operations
    // against the exact same teamSurveyState/team-42 document, proving
    // they serialize against each other rather than being independent
    // read-then-write paths.
    const fake = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "surveys/survey-2": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-1",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });
    const { store } = fake;
    // Both `CloseSurveyDb` and `OpenSurveyDb` are structurally identical
    // (path-keyed get/set/update) — the same fake store satisfies both.
    const closeDb = fake.db;
    const openDb = fake.db as unknown as OpenSurveyDb;

    const [closeResult, openResult] = await Promise.all([
      closeSurvey("token-close", "survey-1", baseDeps(closeDb)),
      openSurvey("token-open", TEAM_ID, "survey-2", { ...baseDeps(closeDb), db: openDb }),
    ]);

    // Closing survey-1 always succeeds — nothing about a concurrent open
    // attempt for the same team can block a close.
    expect(closeResult).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.closedAt).toEqual(NOW);

    if (openResult.ok) {
      // Open ran (and committed) after close's pointer-clear was visible:
      // the pointer now names survey-2, never survey-1.
      expect(store.get("surveys/survey-2")?.data.openedAt).toEqual(NOW);
      expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("survey-2");
    } else {
      // Open's read of the pointer happened before close's clear
      // committed, so it correctly saw survey-1 as still genuinely open
      // and was rejected — survey-2 was never opened, and the pointer
      // ends up cleared to null by close's own commit, never left
      // pointing at the now-closed survey-1.
      expect(openResult).toEqual({ ok: false, error: "team_already_has_open_survey" });
      expect(store.get("surveys/survey-2")?.data.openedAt).toBeUndefined();
      expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe(null);
    }

    // In neither outcome does the coordination pointer end up pointing at
    // the now-closed survey-1 — the invariant this task exists to prove.
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).not.toBe("survey-1");

    // Proves a genuine conflict-and-retry occurred against the shared
    // document, not two independent single-attempt transactions.
    expect(fake.totalAttempts).toBeGreaterThan(2);
  });
});
