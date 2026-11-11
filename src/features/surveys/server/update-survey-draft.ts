import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { validateCreateSurveyInput, type ValidateCreateSurveyInputResult } from "../domain/create-survey-input";
import {
  CONFIGURABLE_QUESTION_SET_VERSION,
  effectiveLifecycle,
  isValidSurvey,
  resolveSurveyQuestions,
  type Survey,
} from "../domain/survey";
import type { SurveyQuestion } from "../domain/question-definitions";
import { toCandidateSurvey } from "./survey-candidate";

const SURVEYS_COLLECTION = "surveys";

/**
 * Editable fields of an unpublished draft (team-survey-builder SPEC —
 * "Freezing"). `null` clears an optional field. `accessMode` and
 * `minimumResponses` are deliberately absent: both are fixed at creation
 * (managed-surveys BR-3 and "Per-survey result threshold").
 */
export interface SurveyDraftPatch {
  title?: string | null;
  description?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  questions?: unknown;
}

const EDITABLE_KEYS = new Set(["title", "description", "startAt", "endAt", "questions"]);
const IMMUTABLE_KEYS = new Set(["accessMode", "minimumResponses"]);

export type UpdateSurveyDraftError =
  | AuthRefusal
  | "forbidden"
  | "invalid_input"
  | "immutable_field"
  | "survey_not_found"
  | "not_editable"
  | "persistence_failed"
  | Extract<ValidateCreateSurveyInputResult, { ok: false }>["error"];

/**
 * The write seam, satisfied in production by a fenced Firestore transaction
 * and by an in-memory fake in tests. `mutate` sees the document as stored
 * (inside the transaction) and returns the full replacement document, or a
 * refusal. Writing the whole document keeps the read and the write atomic.
 */
export interface SurveyDraftStore {
  runUpdate(
    surveyId: string,
    actorUid: string,
    mutate: (
      raw: unknown,
    ) =>
      | { ok: true; document: Record<string, unknown> }
      | { ok: false; error: UpdateSurveyDraftError },
  ): Promise<{ ok: true } | { ok: false; error: UpdateSurveyDraftError }>;
}

export function getDefaultSurveyDraftStore(): SurveyDraftStore {
  return {
    async runUpdate(surveyId, actorUid, mutate) {
      const db = getFirestoreDb();
      const ref = db.collection(SURVEYS_COLLECTION).doc(surveyId);
      return runFencedTransaction(db, actorUid, async (tx) => {
        const snapshot = await tx.get(ref);
        const outcome = mutate(snapshot.exists ? snapshot.data() : undefined);
        if (!outcome.ok) {
          return outcome;
        }
        tx.set(ref, outcome.document);
        return { ok: true as const };
      });
    },
  };
}

/**
 * The only fields that stay editable after publication (team-survey-builder
 * SPEC — "Published metadata"). Question definitions, option identities, dates,
 * access mode and the threshold are frozen once a survey has been opened.
 */
const PUBLISHED_EDITABLE_KEYS = new Set(["title", "description"]);

export type ParseSurveyDraftPatchResult =
  | { ok: true; patch: SurveyDraftPatch }
  | { ok: false; error: "invalid_input" | "immutable_field" };

/** Validates the shape of an untrusted draft patch. Field-level rules run later against the merged survey. */
export function parseSurveyDraftPatch(input: unknown): ParseSurveyDraftPatchResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "invalid_input" };
  }

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (IMMUTABLE_KEYS.has(key)) {
      return { ok: false, error: "immutable_field" };
    }
    if (!EDITABLE_KEYS.has(key)) {
      return { ok: false, error: "invalid_input" };
    }
  }

  for (const key of ["title", "description", "startAt", "endAt"]) {
    const value = record[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { ok: false, error: "invalid_input" };
    }
  }

  return { ok: true, patch: record as SurveyDraftPatch };
}

/**
 * Computes the full stored document for a draft after applying `patch`.
 * Reuses the create validator on the merged result, so title, description,
 * dates and question rules cannot diverge between create and edit. A legacy
 * draft (no stored questions) is upgraded here to the configurable format.
 * It has no responses, because it has never been opened.
 */
export function buildDraftDocument(
  raw: Record<string, unknown>,
  survey: Survey,
  patch: SurveyDraftPatch,
): { ok: true; document: Record<string, unknown> } | { ok: false; error: UpdateSurveyDraftError } {
  const title = patch.title !== undefined ? nullIfBlank(patch.title) : survey.title ?? null;
  const description =
    patch.description !== undefined ? nullIfBlank(patch.description) : survey.description ?? null;
  const startAt = patch.startAt !== undefined ? patch.startAt : survey.startAt ?? null;
  const endAt = patch.endAt !== undefined ? patch.endAt : survey.endAt ?? null;
  const questions: unknown =
    patch.questions !== undefined ? patch.questions : resolveSurveyQuestions(survey);

  const validated = validateCreateSurveyInput({
    accessMode: survey.accessMode,
    minimumResponses: survey.minimumResponses,
    title: title ?? undefined,
    description: description ?? undefined,
    startAt: startAt ?? undefined,
    endAt: endAt ?? undefined,
    questions,
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const { data } = validated;
  const document: Record<string, unknown> = { ...raw };
  setOrDelete(document, "title", data.title);
  setOrDelete(document, "description", data.description);
  setOrDelete(document, "startAt", data.startAt);
  setOrDelete(document, "endAt", data.endAt);
  document.questions = data.questions satisfies SurveyQuestion[];
  document.questionSetVersion = CONFIGURABLE_QUESTION_SET_VERSION;
  return { ok: true, document };
}

/**
 * Computes the stored document for a published survey after a metadata-only
 * patch. Only `title` and `description` are written. Questions, the question-set
 * version and the dates are left exactly as stored, so historical responses
 * keep their definitions and a legacy survey is never rewritten.
 */
export function buildPublishedMetadataDocument(
  raw: Record<string, unknown>,
  survey: Survey,
  patch: SurveyDraftPatch,
): { ok: true; document: Record<string, unknown> } | { ok: false; error: UpdateSurveyDraftError } {
  const title = patch.title !== undefined ? nullIfBlank(patch.title) : survey.title ?? null;
  const description =
    patch.description !== undefined ? nullIfBlank(patch.description) : survey.description ?? null;

  const validated = validateCreateSurveyInput({
    accessMode: survey.accessMode,
    minimumResponses: survey.minimumResponses,
    title: title ?? undefined,
    description: description ?? undefined,
    startAt: survey.startAt,
    endAt: survey.endAt,
    questions: resolveSurveyQuestions(survey),
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const document: Record<string, unknown> = { ...raw };
  setOrDelete(document, "title", validated.data.title);
  setOrDelete(document, "description", validated.data.description);
  return { ok: true, document };
}

function nullIfBlank(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

function setOrDelete(document: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    delete document[key];
  } else {
    document[key] = value;
  }
}

export interface UpdateSurveyDraftDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  store?: SurveyDraftStore;
}

export type UpdateSurveyDraftResult = { ok: true } | { ok: false; error: UpdateSurveyDraftError };

/**
 * Edits an unpublished draft (team-survey-builder SPEC — "Freezing"). Only an
 * app admin may call this (`requireAppAdmin`, unchanged). The survey must
 * belong to `teamId`, and it must still be `scheduled`: never opened, never
 * closed, never archived. A published or answered survey therefore cannot
 * have its questions changed, which protects historical responses.
 */
export async function updateSurveyDraft(
  idToken: string,
  teamId: string,
  surveyId: string,
  input: unknown,
  deps: UpdateSurveyDraftDeps = {},
): Promise<UpdateSurveyDraftResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const parsed = parseSurveyDraftPatch(input);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const store = deps.store ?? getDefaultSurveyDraftStore();
  const now = deps.now ?? new Date();

  try {
    return await store.runUpdate(surveyId, admin.identity.uid, (raw) => {
      const candidate = toCandidateSurvey(surveyId, raw);
      if (!isValidSurvey(candidate, { surveyId })) {
        return { ok: false, error: "survey_not_found" };
      }
      const survey: Survey = candidate;
      if (survey.teamId !== teamId) {
        return { ok: false, error: "survey_not_found" };
      }
      if (survey.archivedAt !== undefined) {
        return { ok: false, error: "not_editable" };
      }
      if (survey.openedAt !== undefined) {
        // Published: metadata only, and nothing that affects questions or dates.
        const metadataOnly = Object.keys(parsed.patch).every((key) => PUBLISHED_EDITABLE_KEYS.has(key));
        if (!metadataOnly) {
          return { ok: false, error: "not_editable" };
        }
        return buildPublishedMetadataDocument(raw as Record<string, unknown>, survey, parsed.patch);
      }
      if (effectiveLifecycle(survey, now) !== "scheduled") {
        return { ok: false, error: "not_editable" };
      }
      const built = buildDraftDocument(raw as Record<string, unknown>, survey, parsed.patch);
      if (!built.ok) {
        return built;
      }
      return { ok: true, document: built.document };
    });
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}
