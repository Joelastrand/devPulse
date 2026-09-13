import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { OpenSurveyDb, OpenSurveyDeps, OpenSurveyTransaction } from "./open-survey";
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
 * transaction semantics: every document read during an attempt is
 * versioned; at commit, if any read document's version has changed since
 * (a concurrent transaction committed a write to it first), the whole
 * attempt is discarded and the callback is re-invoked from scratch with
 * fresh reads (Firestore's own optimistic-concurrency-with-retry
 * behavior) — never a "last write wins" or a naive existence check. This
 * is what makes the concurrency test below a genuine proof of the
 * one-open-survey-per-team guarantee, not merely two sequential calls: a
 * losing transaction's *first* attempt really does read the pre-conflict
 * state (mirroring two admins racing in real tabs), and only the
 * retry-after-conflict step corrects it.
 */
function createInMemoryFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, { data: Record<string, unknown>; version: number }>();
  for (const [path, data] of Object.entries(seed)) {
    store.set(path, { data, version: 1 });
  }
  let totalAttempts = 0;
  let totalCommittedWrites = 0;

  const db: OpenSurveyDb = {
    async runTransaction(fn) {
      const MAX_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        totalAttempts += 1;
        const reads = new Map<string, number>();
        const writes = new Map<string, PendingWrite>();

        const tx: OpenSurveyTransaction = {
          async get(path) {
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
    get totalAttempts() {
      return totalAttempts;
    },
    get totalCommittedWrites() {
      return totalCommittedWrites;
    },
  };
}

function baseDeps(db: OpenSurveyDb, overrides: Partial<OpenSurveyDeps> = {}): OpenSurveyDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    now: NOW,
    db,
    ...overrides,
  };
}

describe("openSurvey", () => {
  it("opens a scheduled survey, setting openedAt to the server's own time", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
      "teams/team-42": { status: "active" },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("surveys/survey-1")?.data.openedAt).toEqual(NOW);
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: "survey-1",
      updatedAt: NOW,
    });
  });

  it("rejects opening while the team already has another genuinely open survey, without writing anything", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-open": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "surveys/survey-2": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-open",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-2", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "team_already_has_open_survey" });
    expect(store.get("surveys/survey-2")?.data.openedAt).toBeUndefined();
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("survey-open");
  });

  it("resolves two concurrent open attempts for the same team to exactly one success (genuine race, not sequential calls)", async () => {
    const fake = createInMemoryFirestore({
      "surveys/survey-A": surveyDoc(),
      "surveys/survey-B": surveyDoc(),
      "teams/team-42": { status: "active" },
    });
    const { db, store } = fake;

    const [resultA, resultB] = await Promise.all([
      openSurvey("token-A", TEAM_ID, "survey-A", baseDeps(db)),
      openSurvey("token-B", TEAM_ID, "survey-B", baseDeps(db)),
    ]);

    const results = [resultA, resultB];
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ok: false, error: "team_already_has_open_survey" });

    const openedSurveyIds = ["survey-A", "survey-B"].filter(
      (id) => store.get(`surveys/${id}`)?.data.openedAt !== undefined,
    );
    expect(openedSurveyIds).toHaveLength(1);
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe(openedSurveyIds[0]);

    // Proves an actual conflict-and-retry happened, not two independent
    // single-attempt transactions: the losing call needed at least one
    // extra attempt after its first read observed the pre-conflict state.
    expect(fake.totalAttempts).toBeGreaterThan(2);
  });

  it("self-corrects a stale pointer to a survey that expired via endAt without being explicitly closed", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-expired": surveyDoc({
        openedAt: new Date("2026-08-01T00:00:00Z"),
        endAt: new Date("2026-08-20T00:00:00Z"),
      }),
      "surveys/survey-new": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-expired",
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-new", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("survey-new");
  });

  it("self-corrects a dangling pointer to a nonexistent survey", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-new": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "ghost-survey",
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-new", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("survey-new");
  });

  it("fails closed to 'no conflict' on a malformed (non-string) activeSurveyId, never throwing", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-new": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": { activeSurveyId: 12345, updatedAt: new Date("2026-08-01T00:00:00Z") },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-new", baseDeps(db));

    expect(result).toEqual({ ok: true });
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("survey-new");
  });

  it("fails closed to invalid_coordination_state when activeSurveyId references a valid survey belonging to a different team, writing nothing", async () => {
    const fake = createInMemoryFirestore({
      // A structurally valid, genuinely open survey — but it belongs to
      // "other-team", not TEAM_ID. teamSurveyState/team-42 should never
      // legitimately point at it; this models external/corrupted data,
      // since openSurvey itself is the only writer and always confirms
      // this exact match before ever setting the pointer.
      "surveys/survey-other-team": surveyDoc({
        teamId: "other-team",
        openedAt: new Date("2026-08-15T00:00:00Z"),
      }),
      "surveys/survey-new": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-other-team",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });
    const { db, store } = fake;

    const result = await openSurvey("token", TEAM_ID, "survey-new", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "invalid_coordination_state" });
    // The requested survey was never opened.
    expect(store.get("surveys/survey-new")?.data.openedAt).toBeUndefined();
    // The coordination pointer was neither cleared nor repointed.
    expect(store.get("teamSurveyState/team-42")?.data).toEqual({
      activeSurveyId: "survey-other-team",
      updatedAt: new Date("2026-08-15T00:00:00Z"),
    });
    // Neither the requested survey nor the cross-team survey was mutated.
    expect(store.get("surveys/survey-other-team")?.data).toEqual(
      surveyDoc({ teamId: "other-team", openedAt: new Date("2026-08-15T00:00:00Z") }),
    );
    // No document was written at all — not a self-heal, not a repair.
    expect(fake.totalCommittedWrites).toBe(0);
  });

  it("fails closed to invalid_coordination_state when the cross-team referenced survey is itself only scheduled (not open)", async () => {
    // The mismatch alone is the corruption signal — this must fail closed
    // regardless of the wrongly-referenced survey's own lifecycle, not
    // only when it happens to be "open".
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-other-team": surveyDoc({ teamId: "other-team" }),
      "surveys/survey-new": surveyDoc(),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-other-team",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-new", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "invalid_coordination_state" });
    expect(store.get("surveys/survey-new")?.data.openedAt).toBeUndefined();
    expect(store.get("teamSurveyState/team-42")?.data.activeSurveyId).toBe("survey-other-team");
  });

  it("rejects opening for a disabled team, attempting no write", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
      "teams/team-42": { status: "disabled" },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(store.get("surveys/survey-1")?.data.openedAt).toBeUndefined();
    expect(store.has("teamSurveyState/team-42")).toBe(false);
  });

  it("fails closed to team_not_found for a nonexistent/malformed team status", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
      // no teams/team-42 document at all
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "team_not_found" });
  });

  it("rejects a nonexistent surveyId", async () => {
    const { db } = createInMemoryFirestore({
      "teams/team-42": { status: "active" },
    });

    const result = await openSurvey("token", TEAM_ID, "no-such-survey", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("fails closed (survey_not_found) on a malformed survey record, e.g. missing createdAt", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": { teamId: TEAM_ID, accessMode: "public", createdBy: "admin-x" },
      "teams/team-42": { status: "active" },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("rejects opening a survey that belongs to a different team than the route-scoped teamId", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ teamId: "other-team" }),
      "teams/team-42": { status: "active" },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "wrong_team" });
    expect(store.get("surveys/survey-1")?.data.openedAt).toBeUndefined();
  });

  it("rejects opening a survey that is already open", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z") }),
      "teams/team-42": { status: "active" },
      "teamSurveyState/team-42": {
        activeSurveyId: "survey-1",
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "not_scheduled" });
  });

  it("rejects opening a survey that is already closed", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc({
        openedAt: new Date("2026-08-01T00:00:00Z"),
        closedAt: new Date("2026-08-15T00:00:00Z"),
      }),
      "teams/team-42": { status: "active" },
    });

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "not_scheduled" });
  });

  it("rejects an unauthenticated caller and attempts no transaction", async () => {
    const { db, store } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
      "teams/team-42": { status: "active" },
    });
    const runTransactionSpy = vi.spyOn(db, "runTransaction");
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db, { verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(runTransactionSpy).not.toHaveBeenCalled();
    expect(store.get("surveys/survey-1")?.data.openedAt).toBeUndefined();
  });

  it("rejects a non-admin caller and attempts no transaction", async () => {
    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
      "teams/team-42": { status: "active" },
    });
    const runTransactionSpy = vi.spyOn(db, "runTransaction");
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db, { verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(runTransactionSpy).not.toHaveBeenCalled();
  });

  it("reports a controlled failure, not a thrown error, when the transaction fails", async () => {
    const db: OpenSurveyDb = {
      runTransaction: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs the token, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { db } = createInMemoryFirestore({
      "surveys/survey-1": surveyDoc(),
      "teams/team-42": { status: "active" },
    });
    await openSurvey("token", TEAM_ID, "survey-1", baseDeps(db));

    const failingDb: OpenSurveyDb = {
      runTransaction: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await openSurvey("token", TEAM_ID, "survey-1", baseDeps(failingDb));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
