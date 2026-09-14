/**
 * Client gateway for `/admin/teams/[teamId]`'s Anonymous Challenges
 * management section (docs/features/anonymous-challenges/SPEC.md —
 * TASK-006). Thin `fetch` wrappers around the admin-only
 * `app/api/admin/teams/[teamId]/challenges/...` routes, mirroring
 * `admin-survey-gateway.ts`'s established shape-validation-before-trust
 * convention — a malformed or unexpected response body always falls back to
 * a controlled `read_failed`/`unknown`, never rendered as if valid. No
 * authorization/lifecycle logic lives here.
 *
 * **Deliberately separate from `challenges-gateway.ts`** (TASK-005's
 * member-facing gateway) — the two must never be interchangeable, since
 * this gateway's list call may return `archived` challenges the member
 * gateway must structurally reject (SPEC — "Authorization model").
 *
 * The list parser reconstructs every item field-by-field into a fresh
 * object containing only the four approved display fields — never the
 * parsed value itself, however well-formed — so an extra
 * identity/crypto/audit-shaped field on the raw payload (`uid`, `email`,
 * `resolvedBy`, `archivedBy`, `ciphertext`, `iv`, `authTag`, `keyVersion`)
 * can never ride along to the component even if a future server bug ever
 * emitted one alongside otherwise-valid fields.
 */

export type AdminChallengeStatus = "open" | "resolved" | "archived";

/** The approved admin-visible fields only — never `resolvedBy`/`archivedBy`/`resolvedAt`/`archivedAt`, never an encrypted field, never a submitter identity field (BR-11, BR-13). */
export interface AdminChallengeView {
  challengeId: string;
  text: string;
  status: AdminChallengeStatus;
  submittedAt: string;
}

type ReadErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

export type FetchAdminChallengesResult =
  | { status: "ok"; challenges: AdminChallengeView[] }
  | { status: ReadErrorStatus };

const KNOWN_READ_ERRORS = new Set<ReadErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);
const ADMIN_CHALLENGE_STATUSES = new Set<AdminChallengeStatus>(["open", "resolved", "archived"]);

function isKnownReadError(value: unknown): value is ReadErrorStatus {
  return typeof value === "string" && KNOWN_READ_ERRORS.has(value as ReadErrorStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Validates one raw list item and, if valid, rebuilds it as a fresh object
 * containing *only* the four approved fields — see module doc.
 */
function toAdminChallengeView(value: unknown): AdminChallengeView | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyString(record.challengeId) ||
    typeof record.text !== "string" ||
    typeof record.status !== "string" ||
    !ADMIN_CHALLENGE_STATUSES.has(record.status as AdminChallengeStatus) ||
    !isNonEmptyString(record.submittedAt)
  ) {
    return undefined;
  }
  return {
    challengeId: record.challengeId,
    text: record.text,
    status: record.status as AdminChallengeStatus,
    submittedAt: record.submittedAt,
  };
}

/**
 * Validates and rebuilds an untrusted parsed response body. Any single
 * malformed item invalidates the whole response as `read_failed`, rather
 * than silently dropping just that item — mirrors
 * `challenges-gateway.ts`'s fail-closed convention.
 */
function parseFetchAdminChallengesResult(value: unknown): FetchAdminChallengesResult {
  if (typeof value !== "object" || value === null) {
    return { status: "read_failed" };
  }
  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    if (!Array.isArray(record.challenges)) {
      return { status: "read_failed" };
    }
    const challenges: AdminChallengeView[] = [];
    for (const item of record.challenges) {
      const view = toAdminChallengeView(item);
      if (!view) {
        return { status: "read_failed" };
      }
      challenges.push(view);
    }
    return { status: "ok", challenges };
  }
  return isKnownReadError(record.status) ? { status: record.status } : { status: "read_failed" };
}

export interface AdminChallengesReadGateway {
  fetchAdminChallenges(idToken: string, teamId: string): Promise<FetchAdminChallengesResult>;
}

function getDefaultReadGateway(): AdminChallengesReadGateway {
  return {
    async fetchAdminChallenges(idToken, teamId) {
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/challenges`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed = await parseJson(response);
        return parseFetchAdminChallengesResult(parsed);
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchAdminChallengesDeps {
  gateway?: AdminChallengesReadGateway;
}

/**
 * Fetches every admin-visible challenge (`open`/`resolved`/`archived`) for
 * `teamId`, via `listTeamChallengesForAdmin` (TASK-003). `idToken` is
 * forwarded only for the server to verify — never treated as authorization
 * by this client code itself (`.claude/rules/security.md`).
 */
export async function fetchAdminChallenges(
  idToken: string,
  teamId: string,
  deps: FetchAdminChallengesDeps = {},
): Promise<FetchAdminChallengesResult> {
  const gateway = deps.gateway ?? getDefaultReadGateway();
  return gateway.fetchAdminChallenges(idToken, teamId);
}

// --- Resolve / archive / delete --------------------------------------------

export type ChallengeManagementActionResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "not_found"
        | "conflict"
        | "persistence_failed"
        | "unknown";
    };

function parseManagementActionResponse(status: number, body: unknown): ChallengeManagementActionResult {
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

export interface ResolveAdminChallengeGateway {
  resolveAdminChallenge(
    idToken: string,
    teamId: string,
    challengeId: string,
  ): Promise<ChallengeManagementActionResult>;
}

function getDefaultResolveGateway(): ResolveAdminChallengeGateway {
  return {
    async resolveAdminChallenge(idToken, teamId, challengeId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/challenges/${encodeURIComponent(challengeId)}/resolve`,
          { method: "POST", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseManagementActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface ResolveAdminChallengeDeps {
  gateway?: ResolveAdminChallengeGateway;
}

/** Resolves an `open` challenge. No lifecycle/audit field is ever sent — the server derives both (BR-13, BR-17). */
export async function resolveAdminChallenge(
  idToken: string,
  teamId: string,
  challengeId: string,
  deps: ResolveAdminChallengeDeps = {},
): Promise<ChallengeManagementActionResult> {
  const gateway = deps.gateway ?? getDefaultResolveGateway();
  return gateway.resolveAdminChallenge(idToken, teamId, challengeId);
}

export interface ArchiveAdminChallengeGateway {
  archiveAdminChallenge(
    idToken: string,
    teamId: string,
    challengeId: string,
  ): Promise<ChallengeManagementActionResult>;
}

function getDefaultArchiveGateway(): ArchiveAdminChallengeGateway {
  return {
    async archiveAdminChallenge(idToken, teamId, challengeId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/challenges/${encodeURIComponent(challengeId)}/archive`,
          { method: "POST", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseManagementActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface ArchiveAdminChallengeDeps {
  gateway?: ArchiveAdminChallengeGateway;
}

/** Archives an `open` or `resolved` challenge. No lifecycle/audit field is ever sent — the server derives both (BR-13, BR-18). */
export async function archiveAdminChallenge(
  idToken: string,
  teamId: string,
  challengeId: string,
  deps: ArchiveAdminChallengeDeps = {},
): Promise<ChallengeManagementActionResult> {
  const gateway = deps.gateway ?? getDefaultArchiveGateway();
  return gateway.archiveAdminChallenge(idToken, teamId, challengeId);
}

export interface DeleteAdminChallengeGateway {
  deleteAdminChallenge(
    idToken: string,
    teamId: string,
    challengeId: string,
  ): Promise<ChallengeManagementActionResult>;
}

function getDefaultDeleteGateway(): DeleteAdminChallengeGateway {
  return {
    async deleteAdminChallenge(idToken, teamId, challengeId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/challenges/${encodeURIComponent(challengeId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseManagementActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface DeleteAdminChallengeDeps {
  gateway?: DeleteAdminChallengeGateway;
}

/** Permanently deletes a challenge, regardless of its current status (BR-20). No confirmation/identity data is sent — the confirmation step is a UI-only gate before this call fires. */
export async function deleteAdminChallenge(
  idToken: string,
  teamId: string,
  challengeId: string,
  deps: DeleteAdminChallengeDeps = {},
): Promise<ChallengeManagementActionResult> {
  const gateway = deps.gateway ?? getDefaultDeleteGateway();
  return gateway.deleteAdminChallenge(idToken, teamId, challengeId);
}
