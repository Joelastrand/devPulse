/**
 * Client gateway for `/teams/[teamId]`'s member-facing challenge section
 * (docs/features/anonymous-challenges/SPEC.md — TASK-005). Thin `fetch`
 * wrappers around `GET`/`POST /api/teams/[teamId]/challenges`, mirroring
 * `current-team-survey-gateway.ts`/`submit-survey-response-gateway.ts`'s
 * established shape-validation-before-trust convention — a malformed or
 * unexpected response body always falls back to a controlled `read_failed`,
 * never rendered as if valid. No authorization/lifecycle logic lives here.
 *
 * `MEMBER_CHALLENGE_STATUSES` intentionally accepts only `"open"`/
 * `"resolved"` — the two lifecycle states this operation's server contract
 * (`listTeamChallengesForMember`) ever returns (docs/features/
 * anonymous-challenges/SPEC.md — BR-9). Mirrors
 * `current-team-survey-gateway.ts`'s own narrower-than-the-domain `LIFECYCLES`
 * set: this is ordinary response-shape validation for *this* operation's
 * documented contract, not a security boundary — if a future server bug
 * ever returned an `"archived"` value here, this validator treats the whole
 * response as malformed (`read_failed`) rather than silently dropping just
 * that one item, so no archived content is ever rendered and no test can
 * mistake this for a privacy control standing in for TASK-003's server-side
 * guarantee.
 */

export type MemberChallengeStatus = "open" | "resolved";

/** The approved member-visible fields only — never `resolvedBy`/`archivedBy`/`resolvedAt`/`archivedAt`, never an encrypted field, never a submitter identity field (BR-11, BR-13). */
export interface MemberChallengeView {
  challengeId: string;
  text: string;
  status: MemberChallengeStatus;
  submittedAt: string;
}

type ReadErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

export type FetchTeamChallengesResult =
  | { status: "ok"; challenges: MemberChallengeView[] }
  | { status: ReadErrorStatus };

const KNOWN_READ_ERRORS = new Set<ReadErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);
const MEMBER_CHALLENGE_STATUSES = new Set<MemberChallengeStatus>(["open", "resolved"]);

function isKnownReadError(value: unknown): value is ReadErrorStatus {
  return typeof value === "string" && KNOWN_READ_ERRORS.has(value as ReadErrorStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validates one raw list item and, if valid, rebuilds it as a fresh object
 * containing *only* the four approved fields — never the parsed value
 * itself, however well-formed, so an extra identity/crypto/audit-shaped
 * field on the raw payload (`uid`, `email`, `resolvedBy`, `archivedBy`,
 * `ciphertext`, …) can never ride along to the component even if a future
 * server bug ever emitted one alongside otherwise-valid fields.
 */
function toMemberChallengeView(value: unknown): MemberChallengeView | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyString(record.challengeId) ||
    typeof record.text !== "string" ||
    typeof record.status !== "string" ||
    !MEMBER_CHALLENGE_STATUSES.has(record.status as MemberChallengeStatus) ||
    !isNonEmptyString(record.submittedAt)
  ) {
    return undefined;
  }
  return {
    challengeId: record.challengeId,
    text: record.text,
    status: record.status as MemberChallengeStatus,
    submittedAt: record.submittedAt,
  };
}

/**
 * Validates and rebuilds an untrusted parsed response body into
 * `FetchTeamChallengesResult`, never returning the parsed value verbatim on
 * the `"ok"` path (see `toMemberChallengeView`). Any single malformed item —
 * including one whose `status` is outside this operation's approved
 * `"open"`/`"resolved"` set — invalidates the whole response as
 * `read_failed`, rather than silently dropping just that item.
 */
function parseFetchTeamChallengesResult(value: unknown): FetchTeamChallengesResult {
  if (typeof value !== "object" || value === null) {
    return { status: "read_failed" };
  }
  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    if (!Array.isArray(record.challenges)) {
      return { status: "read_failed" };
    }
    const challenges: MemberChallengeView[] = [];
    for (const item of record.challenges) {
      const view = toMemberChallengeView(item);
      if (!view) {
        return { status: "read_failed" };
      }
      challenges.push(view);
    }
    return { status: "ok", challenges };
  }
  return isKnownReadError(record.status) ? { status: record.status } : { status: "read_failed" };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export interface ChallengesReadGateway {
  fetchTeamChallenges(idToken: string, teamId: string): Promise<FetchTeamChallengesResult>;
}

function getDefaultReadGateway(): ChallengesReadGateway {
  return {
    async fetchTeamChallenges(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/challenges`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed = await parseJson(response);
        return parseFetchTeamChallengesResult(parsed);
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamChallengesDeps {
  gateway?: ChallengesReadGateway;
}

/**
 * Fetches the member-visible challenge list for `teamId`, for an already
 * authenticated caller. `idToken` is forwarded only for the server to
 * verify — never treated as authorization by this client code itself
 * (`.claude/rules/security.md`).
 */
export async function fetchTeamChallenges(
  idToken: string,
  teamId: string,
  deps: FetchTeamChallengesDeps = {},
): Promise<FetchTeamChallengesResult> {
  const gateway = deps.gateway ?? getDefaultReadGateway();
  return gateway.fetchTeamChallenges(idToken, teamId);
}

/**
 * The shape `POST /api/teams/[teamId]/challenges` returns, mirroring
 * `submitChallenge`'s own `SubmitChallengeResult` one-for-one. Never carries
 * a generated `challengeId` or echoed text (BR-2).
 */
export type SubmitChallengeFetchResult =
  | { status: "ok" }
  | {
      status:
        | "invalid_input"
        | "sign_in_required"
        | "forbidden"
        | "team_not_found"
        | "team_disabled"
        | "encryption_failed"
        | "persistence_failed"
        | "read_failed";
    };

const KNOWN_SUBMIT_ERRORS = new Set([
  "invalid_input",
  "sign_in_required",
  "forbidden",
  "team_not_found",
  "team_disabled",
  "encryption_failed",
  "persistence_failed",
]);

export interface ChallengeSubmitGateway {
  submitChallenge(idToken: string, teamId: string, text: string): Promise<SubmitChallengeFetchResult>;
}

function getDefaultSubmitGateway(): ChallengeSubmitGateway {
  return {
    async submitChallenge(idToken, teamId, text) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/challenges`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          // Only the free-text body is ever sent — no uid/email/displayName/
          // membershipId/admin-state field of any kind (BR-2, BR-33). The
          // server derives identity and team eligibility on its own.
          body: JSON.stringify({ text }),
        });

        if (response.status === 201) {
          return { status: "ok" };
        }

        const parsed = await parseJson(response);
        const error =
          typeof parsed === "object" && parsed !== null && "error" in parsed
            ? (parsed as { error: unknown }).error
            : undefined;

        return typeof error === "string" && KNOWN_SUBMIT_ERRORS.has(error)
          ? { status: error as Exclude<SubmitChallengeFetchResult["status"], "ok" | "read_failed"> }
          : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface SubmitChallengeDeps {
  gateway?: ChallengeSubmitGateway;
}

/**
 * Submits one anonymous challenge for `teamId` via the thin
 * `POST /api/teams/[teamId]/challenges` route. `idToken` is forwarded only
 * for the server to verify; no authorization/eligibility decision is made
 * here — the server always re-derives everything fresh.
 */
export async function submitChallenge(
  idToken: string,
  teamId: string,
  text: string,
  deps: SubmitChallengeDeps = {},
): Promise<SubmitChallengeFetchResult> {
  const gateway = deps.gateway ?? getDefaultSubmitGateway();
  return gateway.submitChallenge(idToken, teamId, text);
}
