import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { isValidTeamStatus } from "../../teams/domain/team";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import {
  validateCreateSurveyInput,
  type ValidateCreateSurveyInputResult,
} from "../domain/create-survey-input";
import type { SurveyAccessMode } from "../domain/survey";

const SURVEYS_COLLECTION = "surveys";
const TEAMS_COLLECTION = "teams";

/** The persisted shape of one `surveys` document (docs/features/managed-surveys/SPEC.md — "Data model"). */
export interface SurveyRecord {
  teamId: string;
  title?: string;
  accessMode: SurveyAccessMode;
  minimumResponses: number;
  startAt?: Date;
  endAt?: Date;
  createdAt: Date;
  createdBy: string;
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` (whose `.add()` assigns the opaque,
 * auto-generated document ID that becomes `surveyId`) and by an in-memory
 * fake in tests.
 */
export interface SurveysCollection {
  add(record: SurveyRecord): Promise<{ id: string }>;
}

function getDefaultSurveysCollection(): SurveysCollection {
  return getFirestoreDb().collection(SURVEYS_COLLECTION);
}

/**
 * The read seam for the owning team's fresh `status`, satisfied in
 * production by a Firestore document read and by an in-memory fake in
 * tests. Returns raw, unvalidated field data — `createSurvey` is
 * responsible for validating it (via `isValidTeamStatus`) before trusting
 * it, exactly as `authorizeTeamAccess` already does for the same field.
 */
export interface TeamStatusReader {
  /** Raw `status` field of `teams/{teamId}`, or `undefined` if no such document exists. */
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultTeamStatusReader(): TeamStatusReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(TEAMS_COLLECTION)
        .doc(teamId)
        .get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

type InvalidInputError = Extract<ValidateCreateSurveyInputResult, { ok: false }>["error"];

export type CreateSurveyResult =
  | { ok: true; surveyId: string }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | InvalidInputError
        | "team_not_found"
        | "team_disabled"
        | "persistence_failed";
    };

export interface CreateSurveyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: SurveysCollection;
  teamStatusReader?: TeamStatusReader;
}

/**
 * Creates a new `scheduled` survey for `teamId` (docs/features/
 * managed-surveys/SPEC.md — BR-1 through BR-4). Only an app admin may call
 * this successfully (BR-2), reusing `requireAppAdmin` unchanged — never a
 * re-implemented admin check. `teamId` is always the caller's own trusted
 * server/route scope (e.g. the admin team page's own route param), never
 * taken from `input` — `CreateSurveyInput` (TASK-001) has no `teamId`
 * field at all, so there is nothing for a request body to override.
 *
 * The owning team's `status` is re-read fresh from Firestore and must be
 * `active`; a `disabled` or nonexistent/malformed-status team rejects
 * creation (BR-41's creation clause) — mirrors the existing "no new grants
 * into a disabled team" posture for invitations/access requests
 * (docs/features/team-management/SPEC.md).
 *
 * `minimumResponses` is required by `validateCreateSurveyInput` (TASK-001)
 * and persisted exactly as validated — this operation never assumes
 * `DEFAULT_MINIMUM_RESPONSES` for a missing/invalid value, and there is no
 * later operation anywhere in this feature that can change it once
 * created (docs/features/managed-surveys/SPEC.md — "Per-survey result
 * threshold": deliberately immutable).
 *
 * The persisted document carries no `openedAt`/`closedAt`/`archivedAt`
 * field (TASK-001's `effectiveLifecycle` reads their absence as
 * `scheduled`) — a survey is never created in any other lifecycle state.
 * `surveyId` is Firestore's auto-generated document ID (never derived from
 * `title`/`teamId`, never client-supplied); `createdAt`/`createdBy` are
 * always server-derived (the server's own clock and the verified admin's
 * `uid`), never accepted from the request.
 */
export async function createSurvey(
  idToken: string,
  teamId: string,
  input: unknown,
  deps: CreateSurveyDeps = {},
): Promise<CreateSurveyResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const validated = validateCreateSurveyInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const teamStatusReader = deps.teamStatusReader ?? getDefaultTeamStatusReader();
  let rawTeamStatus: unknown;
  try {
    rawTeamStatus = await teamStatusReader.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!isValidTeamStatus(rawTeamStatus)) {
    // Covers both "no such team" (Firestore returns `undefined`) and a
    // malformed/unrecognized status — fail closed exactly like
    // `authorizeTeamAccess` does for the same field, never assuming
    // "active" for an un-interpretable read.
    return { ok: false, error: "team_not_found" };
  }

  if (rawTeamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }

  const { accessMode, minimumResponses, title, startAt, endAt } = validated.data;
  const record: SurveyRecord = {
    teamId,
    accessMode,
    minimumResponses,
    ...(title !== undefined ? { title } : {}),
    ...(startAt !== undefined ? { startAt } : {}),
    ...(endAt !== undefined ? { endAt } : {}),
    createdAt: deps.now ?? new Date(),
    createdBy: admin.identity.uid,
  };

  const collection = deps.collection ?? getDefaultSurveysCollection();

  try {
    const { id } = await collection.add(record);
    return { ok: true, surveyId: id };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
