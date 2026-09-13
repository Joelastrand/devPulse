import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type {
  SubmitSurveyResponseClock,
  SubmitSurveyResponseDb,
  SubmitSurveyResponseDeps,
  SubmitSurveyResponseTransaction,
} from "./submit-survey-response";
import { submitSurveyResponse } from "./submit-survey-response";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const SURVEY_ID = "survey-1";
const MEMBER_UID = "member-1";
const OTHER_UID = "member-2";
const APP_ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");
const VALID_ANSWERS = [3, 4, 5];

function surveyDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdBy: "some-admin",
    openedAt: new Date("2026-08-15T00:00:00Z"),
    ...overrides,
  };
}

function teamDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "active", name: "Team Rocket", ...overrides };
}

function membershipDoc(uid: string, teamId: string): Record<string, unknown> {
  return {
    uid,
    teamId,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdVia: "admin_direct",
    grantedBy: "admin",
  };
}

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function verifyTokenReturning(verified: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: verified.uid,
    email: verified.email,
    email_verified: verified.emailVerified,
  });
}

type HookMap = Record<string, () => Record<string, unknown> | undefined>;

/**
 * An in-memory transactional Firestore fake modeling real Firestore
 * transaction semantics (mirrors `open-survey.test.ts`/`close-survey.
 * test.ts`'s own fake): every document read during an attempt is
 * versioned; a commit is rejected and the whole callback retried with
 * fresh reads if any read document's version changed since. `onFirstRead`
 * additionally lets a test inject a concurrent external mutation
 * (simulating another admin action landing mid-flight) the first time a
 * given path is read across the whole `runTransaction` call — the read
 * that triggers it still observes the pre-mutation snapshot (a genuine
 * "stale pre-read"), but the version bump it causes forces that attempt's
 * commit to conflict and retry with fresh reads, which then observe the
 * mutated state.
 */
function createInMemoryFirestore(
  seed: Record<string, Record<string, unknown>> = {},
  options: { onFirstRead?: HookMap } = {},
) {
  const store = new Map<string, { data: Record<string, unknown>; version: number }>();
  for (const [path, data] of Object.entries(seed)) {
    store.set(path, { data, version: 1 });
  }
  const triggered = new Set<string>();
  let totalAttempts = 0;
  let totalCommittedWrites = 0;
  let idCounter = 0;

  const db: SubmitSurveyResponseDb = {
    async runTransaction(fn) {
      const MAX_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        totalAttempts += 1;
        const reads = new Map<string, number>();
        const writes = new Map<string, Record<string, unknown>>();

        const tx: SubmitSurveyResponseTransaction = {
          async get(path) {
            const existing = store.get(path);
            reads.set(path, existing?.version ?? 0);
            const snapshot = { exists: existing !== undefined, data: () => existing?.data };

            const hook = options.onFirstRead?.[path];
            if (hook && !triggered.has(path)) {
              triggered.add(path);
              const newData = hook();
              const current = store.get(path);
              if (newData === undefined) {
                store.delete(path);
              } else {
                store.set(path, { data: newData, version: (current?.version ?? 0) + 1 });
              }
            }

            return snapshot;
          },
          set(path, data) {
            writes.set(path, data);
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
          for (const [path, data] of writes) {
            const current = store.get(path);
            store.set(path, { data, version: (current?.version ?? 0) + 1 });
            totalCommittedWrites += 1;
          }
          return result;
        }
        // Conflict: discard this attempt's buffered writes and retry with fresh reads.
      }
      throw new Error("transaction retry limit exceeded");
    },
    newResponseId() {
      idCounter += 1;
      return `response-${idCounter}`;
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

/**
 * A `SubmitSurveyResponseClock` that returns each of `values` in order, one
 * per call, then repeats the last value for any further calls. Used to
 * simulate real server time genuinely advancing between one Firestore
 * transaction attempt and the next (a fixed `Date` cannot express this —
 * that's the exact distinction the regression test below depends on).
 */
function sequencedClock(...values: Date[]): SubmitSurveyResponseClock {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

function baseDeps(
  db: SubmitSurveyResponseDb,
  overrides: Partial<SubmitSurveyResponseDeps> = {},
): SubmitSurveyResponseDeps {
  // `now` is a callable clock (`SubmitSurveyResponseClock`), not a fixed
  // `Date` — a plain function always returning the same fixed instant is
  // the deterministic-testing equivalent of "time doesn't move during this
  // test," while still exercising the real per-attempt-call code path.
  return { now: () => NOW, db, ...overrides };
}

function responseDocs(store: Map<string, { data: Record<string, unknown>; version: number }>) {
  return [...store.entries()]
    .filter(([path]) => path.startsWith("surveyResponses/"))
    .map(([, entry]) => entry.data);
}

function participationDocs(store: Map<string, { data: Record<string, unknown>; version: number }>) {
  return [...store.entries()]
    .filter(([path]) => path.startsWith("surveyParticipations/"))
    .map(([, entry]) => entry.data);
}

describe("submitSurveyResponse", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("public mode", () => {
    it("accepts a valid submission to an open survey and persists an encrypted, anonymous response", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: true });
      const responses = responseDocs(store);
      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({ surveyId: SURVEY_ID, teamId: TEAM_ID, submittedAt: NOW });
      expect(typeof responses[0].ciphertext).toBe("string");
      expect(typeof responses[0].iv).toBe("string");
      expect(typeof responses[0].authTag).toBe("string");
      expect(responses[0].keyVersion).toBe("v1");
    });

    it("never persists the raw answer values in plaintext", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });

      await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      const serialized = JSON.stringify(responseDocs(store));
      expect(serialized).not.toContain("3,4,5");
      expect(serialized).not.toMatch(/"answers"/);
    });

    it("persists no respondent identity, and no SurveyParticipation, for a public submission", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });

      await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      const responses = responseDocs(store);
      expect(Object.keys(responses[0]).sort()).toEqual(
        ["authTag", "ciphertext", "iv", "keyVersion", "submittedAt", "surveyId", "teamId"].sort(),
      );
      expect(participationDocs(store)).toHaveLength(0);
    });

    it("allows repeated submissions from the same visitor to all succeed independently", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });

      const first = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));
      const second = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(responseDocs(store)).toHaveLength(2);
    });

    it("rejects a submission to a closed survey and writes nothing", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ closedAt: new Date("2026-08-20T00:00:00Z") }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a submission after endAt has passed and writes nothing", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ endAt: new Date("2026-08-31T00:00:00Z") }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a submission to a scheduled (never-opened) survey", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ openedAt: undefined }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a submission for a disabled owning team and writes nothing", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc({ status: "disabled" }),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a submission for a missing/malformed owning team, folded into the same unavailable outcome", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a submission to a nonexistent survey identically to a malformed one, with no distinguishing detail", async () => {
      const { db: missingDb } = createInMemoryFirestore({});
      const { db: malformedDb } = createInMemoryFirestore({
        "surveys/survey-1": { teamId: TEAM_ID, accessMode: "public" }, // missing createdAt
      });

      const missingResult = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(missingDb));
      const malformedResult = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(malformedDb));

      expect(missingResult).toEqual({ ok: false, error: "invalid_submission" });
      expect(malformedResult).toEqual({ ok: false, error: "invalid_submission" });
    });

    it("rejects a structurally invalid answer payload before ever reading Firestore", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });
      const getSpy = vi.spyOn(db, "runTransaction");

      const result = await submitSurveyResponse(SURVEY_ID, [1, 6, 3], undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "invalid_submission" });
      expect(getSpy).not.toHaveBeenCalled();
      expect(responseDocs(store)).toHaveLength(0);
    });
  });

  describe("authenticated mode", () => {
    it("accepts a valid submission from an actual member, persisting both a response and a participation sharing no field", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: true });
      const responses = responseDocs(store);
      const participations = participationDocs(store);
      expect(responses).toHaveLength(1);
      expect(participations).toEqual([{ uid: MEMBER_UID, surveyId: SURVEY_ID }]);
      expect(Object.keys(participations[0]).sort()).toEqual(["surveyId", "uid"]);

      const responseKeys = new Set(Object.keys(responses[0]));
      const participationKeys = new Set(Object.keys(participations[0]));
      const sharedKeys = [...responseKeys].filter((key) => participationKeys.has(key) && key !== "surveyId");
      expect(sharedKeys).toEqual([]);
    });

    it("rejects a submission with no token", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "unauthenticated" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a submission with an invalid/revoked token, identically to no token", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "expired-token",
        baseDeps(db, { verifyToken: vi.fn().mockRejectedValue(new Error("revoked")) }),
      );

      expect(result).toEqual({ ok: false, error: "unauthenticated" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a signed-in identity with no membership at all", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a member of a different team (wrong-team membership)", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-99": membershipDoc(MEMBER_UID, OTHER_TEAM_ID),
      });

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects an app admin identity with no actual membership (BR-16)", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, {
          verifyToken: verifyTokenReturning(identity({ email: APP_ADMIN_EMAIL })),
        }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("rejects a client-supplied teamId/accessMode in the request, deriving both only from the persisted survey", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });

      // submitSurveyResponse takes no teamId/accessMode parameter at all —
      // this test documents that fact by calling it with only the
      // approved parameters and confirming the persisted teamId matches
      // the survey's own, never anything a caller could smuggle in.
      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: true });
      expect(responseDocs(store)[0].teamId).toBe(TEAM_ID);
    });

    it("rejects a second sequential submission from the same identity for the same survey", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });
      const deps = baseDeps(db, { verifyToken: verifyTokenReturning(identity()) });

      const first = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, "token", deps);
      const second = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, "token", deps);

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: false, error: "already_submitted" });
      expect(responseDocs(store)).toHaveLength(1);
    });

    it("never rejects one member's own submission because a different member already submitted", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
        "teamMemberships/member-2__team-42": membershipDoc(OTHER_UID, TEAM_ID),
      });

      const first = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token-1",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );
      const second = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token-2",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity({ uid: OTHER_UID })) }),
      );

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(responseDocs(store)).toHaveLength(2);
      expect(participationDocs(store)).toHaveLength(2);
    });

    it("simulates a lost-in-transit retry: a client retry after an uncertain network result never creates a second response", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });
      const deps = baseDeps(db, { verifyToken: verifyTokenReturning(identity()) });

      const originalCall = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, "token", deps);
      // The client never observed `originalCall`'s success (network timeout) and retries with the same answers.
      const retry = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, "token", deps);

      expect(originalCall).toEqual({ ok: true });
      expect(retry).toEqual({ ok: false, error: "already_submitted" });
      expect(responseDocs(store)).toHaveLength(1);
    });

    it("concurrency: two simultaneous submissions from the same uid never both succeed", async () => {
      const fake = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });
      const { db, store } = fake;
      const deps = baseDeps(db, { verifyToken: verifyTokenReturning(identity()) });

      const [first, second] = await Promise.all([
        submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, "token", deps),
        submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, "token", deps),
      ]);

      const results = [first, second];
      const successes = results.filter((r) => r.ok);
      const duplicateRejections = results.filter((r) => !r.ok && r.error === "already_submitted");

      expect(successes).toHaveLength(1);
      expect(duplicateRejections).toHaveLength(1);
      expect(responseDocs(store)).toHaveLength(1);
      expect(participationDocs(store)).toHaveLength(1);
      // Proves a genuine conflict-and-retry occurred (the losing call's
      // first attempt really did read the pre-conflict "no participation
      // yet" state), not merely two independent single-attempt calls.
      expect(fake.totalAttempts).toBeGreaterThan(2);
    });
  });

  describe("races", () => {
    it("submit-vs-close: a survey closed concurrently mid-transaction is never accepted", async () => {
      const fake = createInMemoryFirestore(
        {
          "surveys/survey-1": surveyDoc(),
          "teams/team-42": teamDoc(),
        },
        {
          onFirstRead: {
            "surveys/survey-1": () => surveyDoc({ closedAt: new Date("2026-08-31T12:00:00Z") }),
          },
        },
      );
      const { db, store } = fake;

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
      expect(fake.totalAttempts).toBeGreaterThan(1);
    });

    it("endAt-crossing-mid-flight: a transaction retry re-acquires server time, so a submission is rejected once endAt has genuinely passed by the retry — not the stale time from the first attempt", async () => {
      // Regression test for a defect discovered in review: `now` used to be
      // captured once outside `db.runTransaction`, so a retry (triggered by
      // any unrelated conflicting write) would reuse the *original*
      // pre-endAt instant instead of the server's actual, later time — this
      // is the one race of the five that a "call `submitSurveyResponse` once
      // with `now` already past `endAt`" test cannot prove, since it never
      // exercises a genuine multi-attempt retry at all.
      const endAt = new Date("2026-09-01T00:00:30Z");
      const beforeEndAt = new Date("2026-09-01T00:00:00Z"); // attempt 1's server time: still open
      const afterEndAt = new Date("2026-09-01T00:01:00Z"); // attempt 2 (retry)'s server time: past endAt

      const fake = createInMemoryFirestore(
        {
          "surveys/survey-1": surveyDoc({ endAt }),
          "teams/team-42": teamDoc(),
        },
        {
          onFirstRead: {
            // Forces a genuine version conflict on the survey document
            // after attempt 1's read — simulating some unrelated
            // concurrent write landing mid-flight (BR-6/BR-7 style
            // coordination writes are exactly this shape). The returned
            // data doesn't need to differ; only the resulting version bump
            // matters for provoking Firestore's own retry-with-fresh-reads
            // behavior.
            "surveys/survey-1": () => surveyDoc({ endAt }),
          },
        },
      );
      const { db, store } = fake;

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        undefined,
        baseDeps(db, { now: sequencedClock(beforeEndAt, afterEndAt) }),
      );

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
      expect(participationDocs(store)).toHaveLength(0);
      // Proves attempt 1 genuinely ran to completion (and would have
      // accepted the submission, since its own clock call returned
      // `beforeEndAt`) before conflicting and retrying — not that a single
      // attempt merely happened to receive a post-`endAt` time. This is
      // also exactly what would fail if `now`'s acquisition were ever
      // hoisted back outside `db.runTransaction` (a plain, single-call
      // clock would then feed the *same* `beforeEndAt` value to the retry
      // too, and this test's `survey_unavailable` expectation would fail
      // with `{ok: true}` and a committed response instead).
      expect(fake.totalAttempts).toBeGreaterThan(1);
    });

    it("team-disabled-mid-flight: a team disabled concurrently mid-transaction is never accepted", async () => {
      const fake = createInMemoryFirestore(
        {
          "surveys/survey-1": surveyDoc(),
          "teams/team-42": teamDoc({ status: "active" }),
        },
        {
          onFirstRead: {
            "teams/team-42": () => teamDoc({ status: "disabled" }),
          },
        },
      );
      const { db, store } = fake;

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "survey_unavailable" });
      expect(responseDocs(store)).toHaveLength(0);
      expect(fake.totalAttempts).toBeGreaterThan(1);
    });

    it("membership-removal-mid-flight: a membership revoked concurrently mid-transaction is never accepted", async () => {
      const fake = createInMemoryFirestore(
        {
          "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
          "teams/team-42": teamDoc(),
          "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
        },
        {
          onFirstRead: {
            "teamMemberships/member-1__team-42": () => undefined,
          },
        },
      );
      const { db, store } = fake;

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(responseDocs(store)).toHaveLength(0);
      expect(fake.totalAttempts).toBeGreaterThan(1);
    });
  });

  describe("failure cases", () => {
    it("reports persistence_failed, not a partial write, when the survey read fails", async () => {
      const db: SubmitSurveyResponseDb = {
        runTransaction: vi.fn(async (fn) =>
          fn({
            get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
            set: vi.fn(),
          }),
        ),
        newResponseId: () => "response-1",
      };

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
    });

    it("reports persistence_failed when the team read fails", async () => {
      let callCount = 0;
      const db: SubmitSurveyResponseDb = {
        runTransaction: vi.fn(async (fn) =>
          fn({
            get: vi.fn(async (path: string) => {
              callCount += 1;
              if (path === "surveys/survey-1") {
                return { exists: true, data: () => surveyDoc() };
              }
              throw new Error("simulated firestore outage");
            }),
            set: vi.fn(),
          }),
        ),
        newResponseId: () => "response-1",
      };

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
      expect(callCount).toBeGreaterThan(0);
    });

    it("reports persistence_failed when the membership read fails (authenticated mode)", async () => {
      const db: SubmitSurveyResponseDb = {
        runTransaction: vi.fn(async (fn) =>
          fn({
            get: vi.fn(async (path: string) => {
              if (path === "surveys/survey-1") {
                return { exists: true, data: () => surveyDoc({ accessMode: "authenticated" }) };
              }
              if (path === "teams/team-42") {
                return { exists: true, data: () => teamDoc() };
              }
              throw new Error("simulated firestore outage");
            }),
            set: vi.fn(),
          }),
        ),
        newResponseId: () => "response-1",
      };

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
    });

    it("fails closed with encryption_failed and writes nothing when ENCRYPTION_KEY is missing", async () => {
      vi.stubEnv("ENCRYPTION_KEY", "");
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "encryption_failed" });
      expect(responseDocs(store)).toHaveLength(0);
    });

    it("reports persistence_failed, not a thrown error, when the transaction itself throws", async () => {
      const db: SubmitSurveyResponseDb = {
        runTransaction: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
        newResponseId: () => "response-1",
      };

      const result = await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(db));

      expect(result).toEqual({ ok: false, error: "persistence_failed" });
    });
  });

  describe("privacy", () => {
    it("never includes uid, email, or a participation-shaped field in a persisted SurveyResponse", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });

      await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      const serialized = JSON.stringify(responseDocs(store));
      expect(serialized).not.toContain(MEMBER_UID);
      expect(serialized).not.toContain("dev@example.com");
      expect(responseDocs(store)[0]).not.toHaveProperty("uid");
      expect(responseDocs(store)[0]).not.toHaveProperty("email");
      expect(responseDocs(store)[0]).not.toHaveProperty("responseId");
    });

    it("never includes answers or a responseId in a persisted SurveyParticipation", async () => {
      const { db, store } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });

      await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      const participation = participationDocs(store)[0];
      expect(participation).not.toHaveProperty("answers");
      expect(participation).not.toHaveProperty("responseId");
      expect(participation).not.toHaveProperty("submittedAt");
      expect(participation).not.toHaveProperty("ciphertext");
    });

    it("never returns a generated document id in the success result", async () => {
      const { db } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });

      const result = await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(db, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: true });
      expect(Object.keys(result)).toEqual(["ok"]);
    });

    it("never logs on success, rejection, or failure paths", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { db: successDb } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
      });
      await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(successDb, { verifyToken: verifyTokenReturning(identity()) }),
      );

      const { db: duplicateDb } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc({ accessMode: "authenticated" }),
        "teams/team-42": teamDoc(),
        "teamMemberships/member-1__team-42": membershipDoc(MEMBER_UID, TEAM_ID),
        "surveyParticipations/member-1__survey-1": { uid: MEMBER_UID, surveyId: SURVEY_ID },
      });
      await submitSurveyResponse(
        SURVEY_ID,
        VALID_ANSWERS,
        "token",
        baseDeps(duplicateDb, { verifyToken: verifyTokenReturning(identity()) }),
      );

      vi.stubEnv("ENCRYPTION_KEY", "");
      const { db: encryptionFailDb } = createInMemoryFirestore({
        "surveys/survey-1": surveyDoc(),
        "teams/team-42": teamDoc(),
      });
      await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(encryptionFailDb));

      const failingDb: SubmitSurveyResponseDb = {
        runTransaction: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
        newResponseId: () => "response-1",
      };
      await submitSurveyResponse(SURVEY_ID, VALID_ANSWERS, undefined, baseDeps(failingDb));

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
