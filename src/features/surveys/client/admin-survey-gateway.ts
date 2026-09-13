/**
 * Client gateways for `/admin/teams/[teamId]`'s survey-management section
 * (docs/features/managed-surveys/SPEC.md — TASK-009). Each function is a
 * thin `fetch` wrapper around a new, otherwise-unchanged admin API route
 * (`app/api/admin/teams/[teamId]/surveys/...`) — no lifecycle or
 * authorization logic lives here. Every parser trusts the response body's
 * own semantic shape over the transport status code, mirroring
 * `admin-team-detail-gateway.ts`'s established principle, and fails safely
 * to a generic `"read_failed"`/`"unknown"` rather than fabricating or
 * partially rendering untrusted data.
 */

export type SurveyAccessMode = "public" | "authenticated";
export type SurveyLifecycle = "scheduled" | "open" | "closed";

/** One survey row, as returned by `GET /api/admin/teams/[teamId]/surveys` — dates transported as ISO strings. */
export interface AdminSurveyEntry {
  surveyId: string;
  title?: string;
  accessMode: SurveyAccessMode;
  minimumResponses: number;
  lifecycle: SurveyLifecycle;
  startAt?: string;
  endAt?: string;
  openedAt?: string;
  closedAt?: string;
  archived: boolean;
  createdBy: string;
  createdAt: string;
}

type ReadErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

const KNOWN_READ_ERRORS = new Set<ReadErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);
const ACCESS_MODES = new Set<SurveyAccessMode>(["public", "authenticated"]);
const LIFECYCLES = new Set<SurveyLifecycle>(["scheduled", "open", "closed"]);

function isKnownReadError(value: unknown): value is ReadErrorStatus {
  return typeof value === "string" && KNOWN_READ_ERRORS.has(value as ReadErrorStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidMinimumResponses(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 3 && value <= 20;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isAdminSurveyEntry(value: unknown): value is AdminSurveyEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.surveyId) &&
    isOptionalString(record.title) &&
    typeof record.accessMode === "string" &&
    ACCESS_MODES.has(record.accessMode as SurveyAccessMode) &&
    isValidMinimumResponses(record.minimumResponses) &&
    typeof record.lifecycle === "string" &&
    LIFECYCLES.has(record.lifecycle as SurveyLifecycle) &&
    isOptionalString(record.startAt) &&
    isOptionalString(record.endAt) &&
    isOptionalString(record.openedAt) &&
    isOptionalString(record.closedAt) &&
    typeof record.archived === "boolean" &&
    isNonEmptyString(record.createdBy) &&
    isNonEmptyString(record.createdAt)
  );
}

// --- List -----------------------------------------------------------------

export type FetchAdminSurveysResult =
  | { status: "ok"; surveys: AdminSurveyEntry[] }
  | { status: ReadErrorStatus };

function parseFetchAdminSurveysResponse(body: unknown): FetchAdminSurveysResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.surveys) && record.surveys.every(isAdminSurveyEntry)) {
      return { status: "ok", surveys: record.surveys };
    }
    if (isKnownReadError(record.error)) {
      return { status: record.error };
    }
  }
  return { status: "read_failed" };
}

export interface FetchAdminSurveysGateway {
  fetchAdminSurveys(idToken: string, teamId: string): Promise<FetchAdminSurveysResult>;
}

function getDefaultFetchAdminSurveysGateway(): FetchAdminSurveysGateway {
  return {
    async fetchAdminSurveys(idToken, teamId) {
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/surveys`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseFetchAdminSurveysResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchAdminSurveysDeps {
  gateway?: FetchAdminSurveysGateway;
}

export async function fetchAdminSurveys(
  idToken: string,
  teamId: string,
  deps: FetchAdminSurveysDeps = {},
): Promise<FetchAdminSurveysResult> {
  const gateway = deps.gateway ?? getDefaultFetchAdminSurveysGateway();
  return gateway.fetchAdminSurveys(idToken, teamId);
}

// --- Create -----------------------------------------------------------------

export interface CreateAdminSurveyInput {
  accessMode: SurveyAccessMode;
  minimumResponses: number;
  title?: string;
  startAt?: string;
  endAt?: string;
}

export type CreateAdminSurveyResult =
  | { ok: true; surveyId: string }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "invalid_input"
        | "invalid_access_mode"
        | "invalid_minimum_responses"
        | "invalid_title"
        | "invalid_start_at"
        | "invalid_end_at"
        | "invalid_date_range"
        | "team_not_found"
        | "team_disabled"
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_CREATE_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "invalid_input",
  "invalid_access_mode",
  "invalid_minimum_responses",
  "invalid_title",
  "invalid_start_at",
  "invalid_end_at",
  "invalid_date_range",
  "team_not_found",
  "team_disabled",
  "persistence_failed",
]);

type CreateAdminSurveyErrorCode = Extract<CreateAdminSurveyResult, { ok: false }>["error"];

function parseCreateAdminSurveyResponse(body: unknown): CreateAdminSurveyResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (isNonEmptyString(record.surveyId)) {
      return { ok: true, surveyId: record.surveyId };
    }
    if (typeof record.error === "string" && KNOWN_CREATE_ERRORS.has(record.error)) {
      return { ok: false, error: record.error as CreateAdminSurveyErrorCode };
    }
  }
  return { ok: false, error: "unknown" };
}

export interface CreateAdminSurveyGateway {
  createAdminSurvey(
    idToken: string,
    teamId: string,
    input: CreateAdminSurveyInput,
  ): Promise<CreateAdminSurveyResult>;
}

function getDefaultCreateAdminSurveyGateway(): CreateAdminSurveyGateway {
  return {
    async createAdminSurvey(idToken, teamId, input) {
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/surveys`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        return parseCreateAdminSurveyResponse(await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface CreateAdminSurveyDeps {
  gateway?: CreateAdminSurveyGateway;
}

export async function createAdminSurvey(
  idToken: string,
  teamId: string,
  input: CreateAdminSurveyInput,
  deps: CreateAdminSurveyDeps = {},
): Promise<CreateAdminSurveyResult> {
  const gateway = deps.gateway ?? getDefaultCreateAdminSurveyGateway();
  return gateway.createAdminSurvey(idToken, teamId, input);
}

// --- Open / close -----------------------------------------------------------

export type SurveyLifecycleActionResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "conflict" | "not_found" | "persistence_failed" | "unknown" };

function parseLifecycleActionResponse(status: number, body: unknown): SurveyLifecycleActionResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }
  if (status === 401) return { ok: false, error: "unauthenticated" };
  if (status === 403) return { ok: false, error: "forbidden" };
  if (status === 404) return { ok: false, error: "not_found" };
  if (status === 409) return { ok: false, error: "conflict" };
  if (status === 500) return { ok: false, error: "persistence_failed" };
  return { ok: false, error: "unknown" };
}

export interface OpenAdminSurveyGateway {
  openAdminSurvey(
    idToken: string,
    teamId: string,
    surveyId: string,
  ): Promise<SurveyLifecycleActionResult>;
}

function getDefaultOpenAdminSurveyGateway(): OpenAdminSurveyGateway {
  return {
    async openAdminSurvey(idToken, teamId, surveyId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}/open`,
          { method: "POST", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseLifecycleActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface OpenAdminSurveyDeps {
  gateway?: OpenAdminSurveyGateway;
}

export async function openAdminSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: OpenAdminSurveyDeps = {},
): Promise<SurveyLifecycleActionResult> {
  const gateway = deps.gateway ?? getDefaultOpenAdminSurveyGateway();
  return gateway.openAdminSurvey(idToken, teamId, surveyId);
}

export interface CloseAdminSurveyGateway {
  closeAdminSurvey(
    idToken: string,
    teamId: string,
    surveyId: string,
  ): Promise<SurveyLifecycleActionResult>;
}

function getDefaultCloseAdminSurveyGateway(): CloseAdminSurveyGateway {
  return {
    async closeAdminSurvey(idToken, teamId, surveyId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}/close`,
          { method: "POST", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseLifecycleActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface CloseAdminSurveyDeps {
  gateway?: CloseAdminSurveyGateway;
}

export async function closeAdminSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: CloseAdminSurveyDeps = {},
): Promise<SurveyLifecycleActionResult> {
  const gateway = deps.gateway ?? getDefaultCloseAdminSurveyGateway();
  return gateway.closeAdminSurvey(idToken, teamId, surveyId);
}

// --- Delete / archive ---------------------------------------------------------

export type DeleteOrArchiveAdminSurveyResult =
  | { ok: true; outcome: "deleted" | "archived" }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "not_found" | "conflict" | "persistence_failed" | "unknown";
    };

function parseDeleteOrArchiveResponse(status: number, body: unknown): DeleteOrArchiveAdminSurveyResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { outcome } = body as { outcome: unknown };
    if (outcome === "deleted" || outcome === "archived") {
      return { ok: true, outcome };
    }
  }
  if (status === 401) return { ok: false, error: "unauthenticated" };
  if (status === 403) return { ok: false, error: "forbidden" };
  if (status === 404) return { ok: false, error: "not_found" };
  if (status === 409) return { ok: false, error: "conflict" };
  if (status === 500) return { ok: false, error: "persistence_failed" };
  return { ok: false, error: "unknown" };
}

export interface DeleteOrArchiveAdminSurveyGateway {
  deleteOrArchiveAdminSurvey(
    idToken: string,
    teamId: string,
    surveyId: string,
  ): Promise<DeleteOrArchiveAdminSurveyResult>;
}

function getDefaultDeleteOrArchiveAdminSurveyGateway(): DeleteOrArchiveAdminSurveyGateway {
  return {
    async deleteOrArchiveAdminSurvey(idToken, teamId, surveyId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseDeleteOrArchiveResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface DeleteOrArchiveAdminSurveyDeps {
  gateway?: DeleteOrArchiveAdminSurveyGateway;
}

export async function deleteOrArchiveAdminSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: DeleteOrArchiveAdminSurveyDeps = {},
): Promise<DeleteOrArchiveAdminSurveyResult> {
  const gateway = deps.gateway ?? getDefaultDeleteOrArchiveAdminSurveyGateway();
  return gateway.deleteOrArchiveAdminSurvey(idToken, teamId, surveyId);
}
