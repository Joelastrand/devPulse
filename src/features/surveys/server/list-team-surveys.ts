import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import {
  effectiveLifecycle,
  isValidSurvey,
  type Survey,
  type SurveyAccessMode,
  type SurveyLifecycle,
} from "../domain/survey";

const SURVEYS_COLLECTION = "surveys";

/**
 * One survey row for `/admin/teams/[teamId]`'s survey-management section
 * (docs/features/managed-surveys/SPEC.md — BR-33). Deliberately excludes
 * `archivedAt` itself (a plain `archived` boolean is all the UI needs to
 * split "active" from "archived"), and never includes encrypted payloads,
 * raw responses, or any `surveyParticipations` data — this task's list
 * doesn't compute response-count aggregates at all (TASK-011's job; see
 * TASKS.md's own note that this list may return no count until then).
 * `createdBy` is included for admin accountability, mirroring the existing
 * `invitedBy`/`grantedBy`/`resolvedBy` precedent (SPEC → "Response
 * minimization, made explicit"). `minimumResponses` is included — the
 * configured threshold is not sensitive the way a below-threshold response
 * count is (SPEC → "Per-survey result threshold"); a malformed/invalid
 * `minimumResponses` on a persisted document is treated exactly like any
 * other malformed survey — excluded from the list, never defaulted.
 */
export interface AdminSurveyListEntry {
  surveyId: string;
  title?: string;
  accessMode: SurveyAccessMode;
  minimumResponses: number;
  lifecycle: SurveyLifecycle;
  startAt?: Date;
  endAt?: Date;
  openedAt?: Date;
  closedAt?: Date;
  archived: boolean;
  createdBy: string;
  createdAt: Date;
}

/** One raw `surveys` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawSurveyDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests. Returns every raw
 * `surveys` document for the team regardless of validity —
 * `listTeamSurveys` validates and excludes malformed rows itself (fail
 * closed: excluded from the list, never fabricated, mirroring
 * `listTeamInvitations`'s established "invalid → excluded, not a hard
 * failure" convention).
 */
export interface TeamSurveysCollection {
  listRawForTeam(teamId: string): Promise<RawSurveyDoc[]>;
}

function getDefaultCollection(): TeamSurveysCollection {
  return {
    async listRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(SURVEYS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
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

function toListEntry(survey: Survey, now: Date): AdminSurveyListEntry {
  return {
    surveyId: survey.surveyId,
    ...(survey.title !== undefined ? { title: survey.title } : {}),
    accessMode: survey.accessMode,
    minimumResponses: survey.minimumResponses,
    lifecycle: effectiveLifecycle(survey, now),
    ...(survey.startAt !== undefined ? { startAt: survey.startAt } : {}),
    ...(survey.endAt !== undefined ? { endAt: survey.endAt } : {}),
    ...(survey.openedAt !== undefined ? { openedAt: survey.openedAt } : {}),
    ...(survey.closedAt !== undefined ? { closedAt: survey.closedAt } : {}),
    archived: survey.archivedAt !== undefined,
    createdBy: survey.createdBy,
    createdAt: survey.createdAt,
  };
}

export type ListTeamSurveysResult =
  | { ok: true; surveys: AdminSurveyListEntry[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListTeamSurveysDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamSurveysCollection;
}

/**
 * Lists a team's surveys for an app admin (docs/features/managed-surveys/
 * SPEC.md — BR-33). Only an app admin may call this successfully — reuses
 * `requireAppAdmin` unchanged. Returns every valid survey belonging to
 * `teamId` (newest-created first), each with its derived lifecycle
 * (TASK-001's `effectiveLifecycle`, never a separately stored status) — a
 * malformed persisted document is silently excluded, never surfaced as a
 * partial/fabricated row.
 */
export async function listTeamSurveys(
  idToken: string,
  teamId: string,
  deps: ListTeamSurveysDeps = {},
): Promise<ListTeamSurveysResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();

  let rawDocs: RawSurveyDoc[];
  try {
    rawDocs = await collection.listRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const now = deps.now ?? new Date();

  const surveys: AdminSurveyListEntry[] = rawDocs
    .map(({ id, data }): Survey | null => {
      const candidate = toCandidateSurvey(id, data);
      return isValidSurvey(candidate, { surveyId: id }) ? candidate : null;
    })
    .filter((survey): survey is Survey => survey !== null)
    .map((survey) => toListEntry(survey, now))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { ok: true, surveys };
}
