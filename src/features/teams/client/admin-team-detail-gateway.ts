/**
 * Client gateways for the `/admin/teams/[teamId]` detail page
 * (docs/features/team-management/SPEC.md — TASK-010). Each function is a
 * thin `fetch` wrapper around an existing, unchanged admin API route
 * (`app/api/admin/teams/[teamId]/{members,invitations,access-requests}`) —
 * no new server logic is introduced here. Every parser trusts the
 * response body's own semantic shape over the transport status code,
 * mirroring `admin-teams-gateway.ts`'s established principle, and fails
 * safely to a generic `"read_failed"`/`"unknown"` rather than fabricating
 * or partially rendering untrusted data.
 */

/**
 * One team member row — email resolved live server-side, never persisted;
 * `displayName` is the member's self-set name (`null` when none, never an
 * e-mail fallback); `role` is the **stored** team role, `"member"` for
 * anything but exactly `"lead"`. Admin-only shape (it carries the `uid`
 * admin operations need) — unrelated to the member-facing roster.
 */
export interface AdminTeamMemberEntry {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: "lead" | "member";
}

/** One pending invitation row (BR-30). */
export interface AdminPendingInvitationEntry {
  email: string;
  invitedBy: string;
  createdAt: string;
}

/** One pending access-request row — email resolved live server-side (BR-30). */
export interface AdminPendingAccessRequestEntry {
  uid: string;
  email: string | null;
  createdAt: string;
}

type ListErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

const KNOWN_LIST_ERRORS = new Set<ListErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);

function isKnownListError(value: unknown): value is ListErrorStatus {
  return typeof value === "string" && KNOWN_LIST_ERRORS.has(value as ListErrorStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// --- Members -----------------------------------------------------------

export type FetchTeamMembersResult =
  | { status: "ok"; members: AdminTeamMemberEntry[] }
  | { status: ListErrorStatus };

/**
 * Parses one member row defensively. `uid`/`email` keep their existing strict
 * validation. The additive fields fail safe rather than failing the row: a
 * missing/malformed `displayName` is `null`, and a missing/unknown `role` is
 * `"member"` — never `"lead"` — so an older response shape stays readable.
 */
function parseAdminTeamMemberEntry(value: unknown): AdminTeamMemberEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { uid, email, displayName, role } = value as Record<string, unknown>;
  if (!isNonEmptyString(uid) || !isNullableString(email)) {
    return null;
  }
  return {
    uid,
    email,
    displayName: isNonEmptyString(displayName) ? displayName : null,
    role: role === "lead" ? "lead" : "member",
  };
}

function parseFetchTeamMembersResponse(body: unknown): FetchTeamMembersResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.members)) {
      const members = record.members.map(parseAdminTeamMemberEntry);
      if (members.every((member): member is AdminTeamMemberEntry => member !== null)) {
        return { status: "ok", members };
      }
    }
    if (isKnownListError(record.error)) {
      return { status: record.error };
    }
  }
  return { status: "read_failed" };
}

export interface FetchTeamMembersGateway {
  fetchTeamMembers(idToken: string, teamId: string): Promise<FetchTeamMembersResult>;
}

function getDefaultFetchMembersGateway(): FetchTeamMembersGateway {
  return {
    async fetchTeamMembers(idToken, teamId) {
      try {
        const response = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}/members`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseFetchTeamMembersResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamMembersDeps {
  gateway?: FetchTeamMembersGateway;
}

export async function fetchTeamMembers(
  idToken: string,
  teamId: string,
  deps: FetchTeamMembersDeps = {},
): Promise<FetchTeamMembersResult> {
  const gateway = deps.gateway ?? getDefaultFetchMembersGateway();
  return gateway.fetchTeamMembers(idToken, teamId);
}

export type RemoveAdminTeamMemberResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" | "unknown" };

const KNOWN_REMOVE_MEMBER_ERRORS = new Set(["unauthenticated", "forbidden", "persistence_failed"]);

function parseRemoveMemberResponse(status: number, body: unknown): RemoveAdminTeamMemberResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }
  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_REMOVE_MEMBER_ERRORS.has(error)) {
      return { ok: false, error: error as "unauthenticated" | "forbidden" | "persistence_failed" };
    }
  }
  return { ok: false, error: "unknown" };
}

export interface RemoveAdminTeamMemberGateway {
  removeAdminTeamMember(
    idToken: string,
    teamId: string,
    uid: string,
  ): Promise<RemoveAdminTeamMemberResult>;
}

function getDefaultRemoveMemberGateway(): RemoveAdminTeamMemberGateway {
  return {
    async removeAdminTeamMember(idToken, teamId, uid) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseRemoveMemberResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface RemoveAdminTeamMemberDeps {
  gateway?: RemoveAdminTeamMemberGateway;
}

/** Removes a member's `teamMemberships` document via the existing, unchanged TASK-002 endpoint. */
export async function removeAdminTeamMember(
  idToken: string,
  teamId: string,
  uid: string,
  deps: RemoveAdminTeamMemberDeps = {},
): Promise<RemoveAdminTeamMemberResult> {
  const gateway = deps.gateway ?? getDefaultRemoveMemberGateway();
  return gateway.removeAdminTeamMember(idToken, teamId, uid);
}

// --- Member role ---------------------------------------------------------

export type SetAdminTeamMemberRoleError =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_a_member"
  | "team_disabled"
  | "persistence_failed"
  | "unknown";

export type SetAdminTeamMemberRoleResult =
  | { ok: true; role: "lead" | "member" }
  | { ok: false; error: SetAdminTeamMemberRoleError };

const KNOWN_SET_ROLE_ERRORS = new Set<string>([
  "unauthenticated",
  "forbidden",
  "invalid_input",
  "not_a_member",
  "team_disabled",
  "persistence_failed",
]);

function parseSetRoleResponse(body: unknown): SetAdminTeamMemberRoleResult {
  if (typeof body === "object" && body !== null) {
    const { ok, role, error } = body as Record<string, unknown>;
    if (ok === true && (role === "lead" || role === "member")) {
      return { ok: true, role };
    }
    if (typeof error === "string" && KNOWN_SET_ROLE_ERRORS.has(error)) {
      return { ok: false, error: error as SetAdminTeamMemberRoleError };
    }
  }
  return { ok: false, error: "unknown" };
}

export interface SetAdminTeamMemberRoleGateway {
  setAdminTeamMemberRole(
    idToken: string,
    teamId: string,
    uid: string,
    role: "lead" | "member",
  ): Promise<SetAdminTeamMemberRoleResult>;
}

function getDefaultSetMemberRoleGateway(): SetAdminTeamMemberRoleGateway {
  return {
    async setAdminTeamMemberRole(idToken, teamId, uid, role) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
          },
        );
        return parseSetRoleResponse(await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface SetAdminTeamMemberRoleDeps {
  gateway?: SetAdminTeamMemberRoleGateway;
}

/**
 * Sets a member's stored team role through the admin PATCH endpoint. The
 * server stays the only authority (app-admin check, membership check and the
 * active-team gate for promotion); nothing here is an authorization decision.
 */
export async function setAdminTeamMemberRole(
  idToken: string,
  teamId: string,
  uid: string,
  role: "lead" | "member",
  deps: SetAdminTeamMemberRoleDeps = {},
): Promise<SetAdminTeamMemberRoleResult> {
  const gateway = deps.gateway ?? getDefaultSetMemberRoleGateway();
  return gateway.setAdminTeamMemberRole(idToken, teamId, uid, role);
}

// --- Invitations ---------------------------------------------------------

export type FetchTeamInvitationsResult =
  | { status: "ok"; invitations: AdminPendingInvitationEntry[] }
  | { status: ListErrorStatus };

function isAdminPendingInvitationEntry(value: unknown): value is AdminPendingInvitationEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { email, invitedBy, createdAt } = value as Record<string, unknown>;
  return isNonEmptyString(email) && isNonEmptyString(invitedBy) && isNonEmptyString(createdAt);
}

function parseFetchTeamInvitationsResponse(body: unknown): FetchTeamInvitationsResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (
      Array.isArray(record.invitations) &&
      record.invitations.every(isAdminPendingInvitationEntry)
    ) {
      return { status: "ok", invitations: record.invitations };
    }
    if (isKnownListError(record.error)) {
      return { status: record.error };
    }
  }
  return { status: "read_failed" };
}

export interface FetchTeamInvitationsGateway {
  fetchTeamInvitations(idToken: string, teamId: string): Promise<FetchTeamInvitationsResult>;
}

function getDefaultFetchInvitationsGateway(): FetchTeamInvitationsGateway {
  return {
    async fetchTeamInvitations(idToken, teamId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/invitations`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseFetchTeamInvitationsResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamInvitationsDeps {
  gateway?: FetchTeamInvitationsGateway;
}

export async function fetchTeamInvitations(
  idToken: string,
  teamId: string,
  deps: FetchTeamInvitationsDeps = {},
): Promise<FetchTeamInvitationsResult> {
  const gateway = deps.gateway ?? getDefaultFetchInvitationsGateway();
  return gateway.fetchTeamInvitations(idToken, teamId);
}

export type InviteTeamMemberOutcome =
  | "membership_created"
  | "invitation_created"
  | "invitation_already_pending"
  | "already_member";

export type InviteTeamMemberResult =
  | { ok: true; outcome: InviteTeamMemberOutcome }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "invalid_email"
        | "team_not_found"
        | "team_disabled"
        | "lookup_failed"
        | "persistence_failed"
        | "unknown";
    };

const KNOWN_INVITE_OUTCOMES = new Set<InviteTeamMemberOutcome>([
  "membership_created",
  "invitation_created",
  "invitation_already_pending",
  "already_member",
]);
const KNOWN_INVITE_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "invalid_email",
  "team_not_found",
  "team_disabled",
  "lookup_failed",
  "persistence_failed",
]);

function parseInviteTeamMemberResponse(body: unknown): InviteTeamMemberResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (
      typeof record.outcome === "string" &&
      KNOWN_INVITE_OUTCOMES.has(record.outcome as InviteTeamMemberOutcome)
    ) {
      return { ok: true, outcome: record.outcome as InviteTeamMemberOutcome };
    }
    if (typeof record.error === "string" && KNOWN_INVITE_ERRORS.has(record.error)) {
      return {
        ok: false,
        error: record.error as
          | "unauthenticated"
          | "forbidden"
          | "invalid_email"
          | "team_not_found"
          | "team_disabled"
          | "lookup_failed"
          | "persistence_failed",
      };
    }
  }
  return { ok: false, error: "unknown" };
}

export interface InviteTeamMemberGateway {
  inviteTeamMember(idToken: string, teamId: string, email: string): Promise<InviteTeamMemberResult>;
}

function getDefaultInviteGateway(): InviteTeamMemberGateway {
  return {
    async inviteTeamMember(idToken, teamId, email) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/invitations`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
            body: JSON.stringify({ email }),
          },
        );
        return parseInviteTeamMemberResponse(await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface InviteTeamMemberDeps {
  gateway?: InviteTeamMemberGateway;
}

/** Invites an email to a team via the existing, unchanged TASK-004 endpoint. */
export async function inviteTeamMember(
  idToken: string,
  teamId: string,
  email: string,
  deps: InviteTeamMemberDeps = {},
): Promise<InviteTeamMemberResult> {
  const gateway = deps.gateway ?? getDefaultInviteGateway();
  return gateway.inviteTeamMember(idToken, teamId, email);
}

export type CancelTeamInvitationResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "invalid_email" | "persistence_failed" | "unknown" };

const KNOWN_CANCEL_ERRORS = new Set([
  "unauthenticated",
  "forbidden",
  "invalid_email",
  "persistence_failed",
]);

function parseCancelInvitationResponse(status: number, body: unknown): CancelTeamInvitationResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }
  if (typeof body === "object" && body !== null) {
    const { error } = body as { error: unknown };
    if (typeof error === "string" && KNOWN_CANCEL_ERRORS.has(error)) {
      return {
        ok: false,
        error: error as "unauthenticated" | "forbidden" | "invalid_email" | "persistence_failed",
      };
    }
  }
  return { ok: false, error: "unknown" };
}

export interface CancelTeamInvitationGateway {
  cancelTeamInvitation(
    idToken: string,
    teamId: string,
    email: string,
  ): Promise<CancelTeamInvitationResult>;
}

function getDefaultCancelInvitationGateway(): CancelTeamInvitationGateway {
  return {
    async cancelTeamInvitation(idToken, teamId, email) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/invitations`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
            body: JSON.stringify({ email }),
          },
        );
        return parseCancelInvitationResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface CancelTeamInvitationDeps {
  gateway?: CancelTeamInvitationGateway;
}

/** Cancels a pending invitation via the existing, unchanged TASK-004 endpoint. */
export async function cancelTeamInvitation(
  idToken: string,
  teamId: string,
  email: string,
  deps: CancelTeamInvitationDeps = {},
): Promise<CancelTeamInvitationResult> {
  const gateway = deps.gateway ?? getDefaultCancelInvitationGateway();
  return gateway.cancelTeamInvitation(idToken, teamId, email);
}

// --- Access requests -----------------------------------------------------

export type FetchTeamAccessRequestsResult =
  | { status: "ok"; requests: AdminPendingAccessRequestEntry[] }
  | { status: ListErrorStatus };

function isAdminPendingAccessRequestEntry(
  value: unknown,
): value is AdminPendingAccessRequestEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { uid, email, createdAt } = value as Record<string, unknown>;
  return isNonEmptyString(uid) && isNullableString(email) && isNonEmptyString(createdAt);
}

function parseFetchTeamAccessRequestsResponse(body: unknown): FetchTeamAccessRequestsResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.requests) && record.requests.every(isAdminPendingAccessRequestEntry)) {
      return { status: "ok", requests: record.requests };
    }
    if (isKnownListError(record.error)) {
      return { status: record.error };
    }
  }
  return { status: "read_failed" };
}

export interface FetchTeamAccessRequestsGateway {
  fetchTeamAccessRequests(idToken: string, teamId: string): Promise<FetchTeamAccessRequestsResult>;
}

function getDefaultFetchAccessRequestsGateway(): FetchTeamAccessRequestsGateway {
  return {
    async fetchTeamAccessRequests(idToken, teamId) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/access-requests`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseFetchTeamAccessRequestsResponse(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamAccessRequestsDeps {
  gateway?: FetchTeamAccessRequestsGateway;
}

export async function fetchTeamAccessRequests(
  idToken: string,
  teamId: string,
  deps: FetchTeamAccessRequestsDeps = {},
): Promise<FetchTeamAccessRequestsResult> {
  const gateway = deps.gateway ?? getDefaultFetchAccessRequestsGateway();
  return gateway.fetchTeamAccessRequests(idToken, teamId);
}

export type ResolveAccessRequestOutcome =
  | "approved"
  | "already_approved"
  | "rejected"
  | "already_rejected"
  | "not_pending"
  | "not_found";

export type ResolveAccessRequestResult =
  | { ok: true; outcome: ResolveAccessRequestOutcome }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" | "unknown" };

const KNOWN_RESOLVE_OUTCOMES = new Set<ResolveAccessRequestOutcome>([
  "approved",
  "already_approved",
  "rejected",
  "already_rejected",
  "not_pending",
  "not_found",
]);
const KNOWN_RESOLVE_ERRORS = new Set(["unauthenticated", "forbidden", "persistence_failed"]);

function parseResolveAccessRequestResponse(body: unknown): ResolveAccessRequestResult {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (
      typeof record.outcome === "string" &&
      KNOWN_RESOLVE_OUTCOMES.has(record.outcome as ResolveAccessRequestOutcome)
    ) {
      return { ok: true, outcome: record.outcome as ResolveAccessRequestOutcome };
    }
    if (typeof record.error === "string" && KNOWN_RESOLVE_ERRORS.has(record.error)) {
      return {
        ok: false,
        error: record.error as "unauthenticated" | "forbidden" | "persistence_failed",
      };
    }
  }
  return { ok: false, error: "unknown" };
}

export interface ResolveAccessRequestGateway {
  resolveAccessRequest(
    idToken: string,
    teamId: string,
    uid: string,
    status: "approved" | "rejected",
  ): Promise<ResolveAccessRequestResult>;
}

function getDefaultResolveAccessRequestGateway(): ResolveAccessRequestGateway {
  return {
    async resolveAccessRequest(idToken, teamId, uid, status) {
      try {
        const response = await fetch(
          `/api/admin/teams/${encodeURIComponent(teamId)}/access-requests/${encodeURIComponent(uid)}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
            body: JSON.stringify({ status }),
          },
        );
        return parseResolveAccessRequestResponse(await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface ResolveAccessRequestDeps {
  gateway?: ResolveAccessRequestGateway;
}

/** Approves or rejects a pending access request via the existing, unchanged TASK-005 endpoint. */
export async function resolveAccessRequest(
  idToken: string,
  teamId: string,
  uid: string,
  status: "approved" | "rejected",
  deps: ResolveAccessRequestDeps = {},
): Promise<ResolveAccessRequestResult> {
  const gateway = deps.gateway ?? getDefaultResolveAccessRequestGateway();
  return gateway.resolveAccessRequest(idToken, teamId, uid, status);
}
