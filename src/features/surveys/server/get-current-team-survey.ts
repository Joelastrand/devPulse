import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { isValidTeamStatus } from "../../teams/domain/team";
import { effectiveLifecycle, isValidSurvey, type Survey, type SurveyAccessMode } from "../domain/survey";

const SURVEYS_COLLECTION = "surveys";
const TEAMS_COLLECTION = "teams";

/**
 * The team-page-safe view of a team's current survey
 * (docs/features/managed-surveys/SPEC.md — BR-30, BR-32). Deliberately
 * excludes `createdBy`, `archivedAt`, and anything `teamSurveyState`-shaped,
 * mirroring `resolveSurveyForParticipation`'s own `SafeSurveyParticipationView`
 * minimization discipline — this section never renders response/result
 * content, so no response-count-shaped field exists here at all.
 */
export interface CurrentTeamSurveyView {
  surveyId: string;
  title?: string;
  accessMode: SurveyAccessMode;
  lifecycle: "scheduled" | "open";
  startAt?: Date;
  endAt?: Date;
}

/** One raw `surveys` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawSurveyDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query plus a document get, and by an in-memory fake in tests.
 * Deliberately separate from TASK-009's admin-only `TeamSurveysCollection`
 * (`list-team-surveys.ts`) — this operation's authorization boundary is
 * "team member or admin," never admin-only, so it is not wired through that
 * module (docs/features/managed-surveys/SPEC.md — TASK-010).
 */
export interface GetCurrentTeamSurveyCollections {
  listRawForTeam(teamId: string): Promise<RawSurveyDoc[]>;
  /** Raw `status` field of `teams/{teamId}`, or `undefined` if no such document exists. */
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultCollections(): GetCurrentTeamSurveyCollections {
  return {
    async listRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(SURVEYS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSurvey` expects. */
function toCandidateSurvey(surveyId: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    surveyId,
    startAt: toDateOrUndefined(record.startAt),
    endAt: toDateOrUndefined(record.endAt),
    openedAt: toDateOrUndefined(record.openedAt),
    closedAt: toDateOrUndefined(record.closedAt),
    archivedAt: toDateOrUndefined(record.archivedAt),
    createdAt: toDateOrUndefined(record.createdAt),
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is (not a Date) so `isValidSurvey`'s `isValidDate` check fails
  // closed on it, rather than silently coercing an unexpected shape.
  return value;
}

function toView(survey: Survey, lifecycle: "scheduled" | "open"): CurrentTeamSurveyView {
  return {
    surveyId: survey.surveyId,
    ...(survey.title !== undefined ? { title: survey.title } : {}),
    accessMode: survey.accessMode,
    lifecycle,
    ...(survey.startAt !== undefined ? { startAt: survey.startAt } : {}),
    ...(survey.endAt !== undefined ? { endAt: survey.endAt } : {}),
  };
}

/**
 * Deterministic ascending comparator: primary instant, then `createdAt`,
 * then `surveyId` (a stable, arbitrary-but-total final tie-break — never
 * itself product-meaningful). Used by `pickCurrentSurvey` so its result
 * never depends on `listRawForTeam`'s (Firestore's) unspecified return
 * order, for either the approved "multiple `scheduled` surveys" case or the
 * defensive "multiple `open` surveys" case below.
 */
function compareByInstant(
  primary: (survey: Survey) => Date,
): (a: { survey: Survey }, b: { survey: Survey }) => number {
  return (a, b) => {
    const primaryDiff = primary(a.survey).getTime() - primary(b.survey).getTime();
    if (primaryDiff !== 0) {
      return primaryDiff;
    }
    const createdAtDiff = a.survey.createdAt.getTime() - b.survey.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }
    return a.survey.surveyId.localeCompare(b.survey.surveyId);
  };
}

/**
 * Picks the one survey to show as "current" when more than one candidate is
 * `scheduled`/`open`. An `open` survey always wins over any `scheduled` one
 * (it's the one actually answerable right now).
 *
 * By BR-6's one-open-survey-per-team invariant, at most one `open` survey
 * can ever exist for a team in valid state — but this is a read path, not
 * the transactional write path that enforces that invariant, so it must
 * still behave definedly rather than crash or vary with query order if
 * persisted state is ever corrupted into having two. This is purely
 * defensive handling of an invalid state, not a new product rule: among
 * multiple `open` candidates, the earliest `openedAt` (falling back to the
 * earliest `createdAt`, then `surveyId`) wins — the same deterministic
 * tie-break shape as the approved `scheduled` case below, so the result
 * never depends on `listRawForTeam`'s unspecified return order.
 *
 * Multiple `scheduled` surveys are explicitly allowed (SPEC — "One open
 * survey per team": "an admin can freely create several ahead of time");
 * among those, this picks the one with the earliest `startAt` (falling back
 * to the earliest `createdAt`, then `surveyId`) as "next up" — a
 * deterministic tie-break SPEC leaves to implementation, not a new domain
 * rule, since no behavioral requirement specifies one.
 */
function pickCurrentSurvey(
  surveys: readonly Survey[],
  now: Date,
): { survey: Survey; lifecycle: "scheduled" | "open" } | null {
  const candidates = surveys
    .map((survey) => ({ survey, lifecycle: effectiveLifecycle(survey, now) }))
    .filter(
      (candidate): candidate is { survey: Survey; lifecycle: "scheduled" | "open" } =>
        candidate.lifecycle !== "closed",
    );

  const open = candidates.filter((candidate) => candidate.lifecycle === "open");
  if (open.length > 0) {
    return open.sort(compareByInstant((survey) => survey.openedAt ?? survey.createdAt))[0];
  }

  const scheduled = candidates.filter((candidate) => candidate.lifecycle === "scheduled");
  if (scheduled.length === 0) {
    return null;
  }

  return scheduled.sort(compareByInstant((survey) => survey.startAt ?? survey.createdAt))[0];
}

export type GetCurrentTeamSurveyResult =
  | { ok: true; survey: CurrentTeamSurveyView | null }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface GetCurrentTeamSurveyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  collections?: GetCurrentTeamSurveyCollections;
}

/**
 * Resolves `/teams/[teamId]`'s "Pågående undersøkelse" section for an
 * authorized caller (docs/features/managed-surveys/SPEC.md — BR-30, BR-31,
 * BR-32, BR-41's discovery half). Authorization reuses `authorizeTeamAccess`
 * unchanged — the same "team member or admin" boundary `getTeamSurveyResults`
 * already uses for viewing results, never `requireAppAdmin` (TASK-009's
 * `listTeamSurveys` is a separate, admin-only operation) and never the
 * narrower "actual membership for participation" check TASK-005/TASK-006
 * use (that boundary answers "may I answer this survey," not "may I view
 * this team's page").
 *
 * A `disabled` team's survey is never shown as current (BR-41): once
 * authorization passes, this re-reads the team's own `status` fresh and, if
 * it isn't a validly-read `"active"`, returns `{ok: true, survey: null}` —
 * the same non-sensitive empty state as "no survey exists," never a
 * distinguishable "team disabled" signal, and without ever querying
 * `surveys` for that team.
 */
export async function getCurrentTeamSurvey(
  idToken: string,
  teamId: string,
  deps: GetCurrentTeamSurveyDeps = {},
): Promise<GetCurrentTeamSurveyResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const authResult = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.authCollection,
  });
  if (!authResult.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authResult.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const collections = deps.collections ?? getDefaultCollections();

  let rawStatus: unknown;
  try {
    rawStatus = await collections.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const teamActive = isValidTeamStatus(rawStatus) && rawStatus === "active";
  if (!teamActive) {
    return { ok: true, survey: null };
  }

  let rawDocs: RawSurveyDoc[];
  try {
    rawDocs = await collections.listRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const now = deps.now ?? new Date();

  // The `listRawForTeam` query is expected to already scope by `teamId` —
  // but that scoping is never trusted as the *only* protection: a
  // structurally valid `Survey` whose own persisted `teamId` doesn't match
  // the requested `teamId` (a corrupted read seam, a future query-shape
  // bug, or a reused collection abstraction) is excluded here exactly like
  // a malformed document, never surfaced as eligible and never causing the
  // rest of this team's genuinely-scoped surveys to fail to load — mirrors
  // `listTeamSurveys`'s established "invalid → excluded, not a hard
  // failure" convention, extended to a cross-team mismatch specifically.
  const surveys: Survey[] = rawDocs
    .map(({ id, data }): Survey | null => {
      const candidate = toCandidateSurvey(id, data);
      return isValidSurvey(candidate, { surveyId: id }) ? candidate : null;
    })
    .filter((survey): survey is Survey => survey !== null)
    .filter((survey) => survey.teamId === teamId);

  const picked = pickCurrentSurvey(surveys, now);

  return { ok: true, survey: picked ? toView(picked.survey, picked.lifecycle) : null };
}
