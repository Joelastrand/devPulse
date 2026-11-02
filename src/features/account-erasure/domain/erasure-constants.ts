/**
 * Erasure defaults (SPEC BR-2, BR-3, BR-14, BR-17). Code constants only, defined once here.
 *
 * These defaults are adjustable under the TASKS.md ground rule: a change must be recorded in the SPEC decision log,
 * covered by tests, and must not weaken recent authentication or resumability. Do not change one silently; the
 * constant-value test in erasure-constants.test.ts fails on any change.
 */

/** BR-3: a fresh `auth_time` is required to start an erasure. */
export const RECENT_AUTH_WINDOW_SECONDS = 300;

/** BR-14: at most this many Firestore batches per request. */
export const MAX_BATCHES_PER_REQUEST = 10;

/** BR-14: at most this many writes per batch. */
export const WRITES_PER_BATCH = 100;

/** BR-14: wall-clock budget for one request. */
export const REQUEST_WALL_BUDGET_MS = 20_000;

/** BR-17: the completed record expires this long after completion (TTL on `accountErasures.expireAt`). */
export const COMPLETED_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/** Value written in place of an erased actor uid in audit fields (SPEC actor audit). Never a uid or e-mail. */
export const ERASED_ACTOR_MARKER = "erased";
