import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { verifyIdToken } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { effectiveLifecycle, isValidSurvey, type Survey } from "../domain/survey";

const SURVEYS_COLLECTION = "surveys";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The read seam this operation depends on, satisfied in production by three
 * Firestore document reads and by an in-memory fake in tests. Returns raw,
 * unvalidated data — `resolveSurveyForParticipation` is responsible for
 * validating everything before trusting it (mirrors `authorizeTeamAccess`'s
 * own convention).
 */
export interface ResolveSurveyForParticipationCollections {
  /** Raw `surveys/{surveyId}` document data, or `undefined` if it doesn't exist. */
  getSurvey(surveyId: string): Promise<unknown>;
  /** Raw `teams/{teamId}` document data, or `undefined` if it doesn't exist. */
  getTeam(teamId: string): Promise<unknown>;
  /** Raw `teamMemberships/{uid}__{teamId}` document data, or `undefined` if it doesn't exist. */
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

function getDefaultCollections(): ResolveSurveyForParticipationCollections {
  return {
    async getSurvey(surveyId) {
      const snapshot = await getFirestoreDb().collection(SURVEYS_COLLECTION).doc(surveyId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeam(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
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

/**
 * The owning team's answerability-relevant state, derived fail-closed from
 * a raw `teams/{teamId}` read: a missing document, a missing/malformed
 * `status` field, or any status other than `"active"` all resolve to
 * `active: false` — never distinguished from a genuinely `disabled` team in
 * the outcome this module returns (docs/features/managed-surveys/SPEC.md —
 * "Team disable semantics", BR-41). `name` is only populated when it can be
 * read as a genuine, non-empty string — a missing/malformed team document
 * never fabricates a display name.
 */
interface TeamContext {
  active: boolean;
  name?: string;
}

function resolveTeamContext(raw: unknown): TeamContext {
  if (typeof raw !== "object" || raw === null) {
    return { active: false };
  }

  const record = raw as Record<string, unknown>;
  const active = isValidTeamStatus(record.status) && record.status === "active";
  const name =
    typeof record.name === "string" && record.name.trim().length > 0 ? record.name : undefined;

  return { active, name };
}

/**
 * The minimal, privacy-safe metadata approved for exposure once a caller is
 * authorized to see it (docs/features/managed-surveys/SPEC.md — "Public
 * survey flow"/"Authenticated survey flow" → "What's safe to expose
 * pre-submission"). Deliberately excludes `createdBy`, `archivedAt`,
 * `accessMode`, and any `teamSurveyState` reference — none of the later
 * `/survey/{surveyId}` UI's rendering decisions need them, since the
 * outcome tag itself (see `ResolveSurveyForParticipationResult`) already
 * carries every distinction the UI must render differently.
 */
export interface SafeSurveyParticipationView {
  surveyId: string;
  title?: string;
  teamName?: string;
}

/**
 * A survey's participation-relevant availability, once a caller is
 * authorized to see it at all: `"scheduled"` (not yet answerable),
 * `"closed"` (no longer, or never made, answerable — this bucket also
 * covers an `open`-lifecycle survey whose owning team is currently
 * `disabled`/missing/malformed, per BR-41: never a distinguishable
 * "team disabled" signal), or `"answerable"` (currently `open` and the
 * owning team is `active`).
 */
function deriveAvailability(
  lifecycle: ReturnType<typeof effectiveLifecycle>,
  teamActive: boolean,
): "scheduled" | "closed" | "answerable" {
  if (lifecycle === "scheduled") {
    return "scheduled";
  }
  if (lifecycle === "open" && teamActive) {
    return "answerable";
  }
  return "closed";
}

function toSafeView(survey: Survey, team: TeamContext): SafeSurveyParticipationView {
  return {
    surveyId: survey.surveyId,
    ...(survey.title !== undefined ? { title: survey.title } : {}),
    ...(team.name !== undefined ? { teamName: team.name } : {}),
  };
}

export type ResolveSurveyForParticipationResult =
  | { ok: true; status: "not_found" }
  | { ok: true; status: "sign_in_required" }
  | { ok: true; status: "forbidden" }
  | { ok: true; status: "scheduled"; survey: SafeSurveyParticipationView }
  | { ok: true; status: "closed"; survey: SafeSurveyParticipationView }
  | { ok: true; status: "answerable"; survey: SafeSurveyParticipationView }
  | { ok: false; error: "read_failed" };

export interface ResolveSurveyForParticipationDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  collections?: ResolveSurveyForParticipationCollections;
}

/**
 * The single authoritative server-side read backing `/survey/{surveyId}`
 * for both access modes (docs/features/managed-surveys/SPEC.md — BR-10,
 * BR-12 through BR-16, BR-19's read half, BR-41's discovery half). Resolves
 * `surveyId` and an optional caller `idToken` into exactly one of six
 * outcomes; `teamId` and `accessMode` are derived only from the persisted,
 * validated survey record — never trusted from a caller-supplied value,
 * since this function accepts none.
 *
 * `public` and `authenticated` share one path up to the point their
 * authorization requirements diverge: `public` never checks identity at
 * all; `authenticated` returns `"sign_in_required"` immediately for a
 * missing or invalid/revoked token — revealing nothing about the survey
 * beyond that fact (BR-13) — and otherwise re-derives actual
 * `teamMemberships` for the survey's own `teamId` (never
 * `authorizeTeamAccess`, whose `"admin"` result would incorrectly grant an
 * app admin with no real membership eligibility to participate — BR-16).
 * Only once a caller is authorized (unconditionally for `public`, or an
 * actual member for `authenticated`) does this function read the owning
 * team's status/name and compute the survey's derived lifecycle
 * (`effectiveLifecycle`, reused unchanged) to decide between `"scheduled"`,
 * `"closed"`, and `"answerable"`.
 *
 * A Firestore read failure at any step is never collapsed into an
 * authorization/availability outcome — it resolves to `{ok: false, error:
 * "read_failed"}` instead, mirroring `authorizeTeamAccess`'s own
 * fail-distinctly convention.
 */
export async function resolveSurveyForParticipation(
  surveyId: string,
  idToken: string | undefined,
  deps: ResolveSurveyForParticipationDeps = {},
): Promise<ResolveSurveyForParticipationResult> {
  const collections = deps.collections ?? getDefaultCollections();
  const now = deps.now ?? new Date();

  let rawSurvey: unknown;
  try {
    rawSurvey = await collections.getSurvey(surveyId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const candidate = toCandidateSurvey(surveyId, rawSurvey);
  if (!isValidSurvey(candidate, { surveyId })) {
    return { ok: true, status: "not_found" };
  }
  const survey: Survey = candidate;

  if (survey.accessMode === "authenticated") {
    if (!idToken) {
      return { ok: true, status: "sign_in_required" };
    }

    const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
    if (!verified.ok) {
      return { ok: true, status: "sign_in_required" };
    }

    let rawMembership: unknown;
    try {
      rawMembership = await collections.getMembership(verified.identity.uid, survey.teamId);
    } catch {
      return { ok: false, error: "read_failed" };
    }

    const isMember = isValidMembershipFor(rawMembership, {
      uid: verified.identity.uid,
      teamId: survey.teamId,
    });
    if (!isMember) {
      return { ok: true, status: "forbidden" };
    }
  }

  let rawTeam: unknown;
  try {
    rawTeam = await collections.getTeam(survey.teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const team = resolveTeamContext(rawTeam);
  const lifecycle = effectiveLifecycle(survey, now);
  const status = deriveAvailability(lifecycle, team.active);

  return { ok: true, status, survey: toSafeView(survey, team) };
}
