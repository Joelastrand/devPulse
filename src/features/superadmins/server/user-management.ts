import "server-only";
import { getAdminAuth, getFirestoreDb } from "../../../lib/firebase/admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { normalizeEmail } from "../../teams/domain/normalize-email";
import { readSuperadminActive } from "./superadmin-policy";

/**
 * Superadmin user management over Firebase Auth (docs/SECURITY.md, "Superadmin user management").
 *
 * Every operation authenticates the caller with `requireAppAdmin`: a verified, revocation-checked token, a live enabled
 * account with a verified NVE address (or an active registry record), and an active superadmin registry entry read on the
 * same request. Nothing here is cached, and no client flag is trusted.
 *
 * Deliberately not offered: admin-initiated account deletion. The erasure workflow is self-only (AE-SI-1, docs/SECURITY.md),
 * so an operator cannot start another person's erasure. Disabling is the operator's tool here.
 */

export type UserManagementError =
  | AuthRefusal
  | "forbidden"
  | "invalid_input"
  | "user_not_found"
  | "self_action_refused"
  | "target_is_superadmin"
  | "confirmation_required"
  | "persistence_failed";

/** The Auth fields the superadmin screen shows. The e-mail is shown to the operator only and is never stored by this module. */
export interface AuthUserView {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
  readonly createdAt: string | null;
  readonly lastSignInAt: string | null;
}

export interface TeamMembershipView {
  readonly teamId: string;
  readonly role: "teamadmin" | "member";
}

/** The narrow Admin Auth surface this module uses. Production: `getAdminAuth()`. Tests: an in-memory fake. */
export interface UserAdminPort {
  listUsers(maxResults: number, pageToken: string | undefined): Promise<{ users: AuthUserView[]; nextPageToken: string | null }>;
  getUserByEmail(email: string): Promise<AuthUserView | undefined>;
  getUser(uid: string): Promise<AuthUserView | undefined>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
}

export interface MembershipReaderPort {
  listForUid(uid: string): Promise<readonly TeamMembershipView[]>;
}

export interface UserManagementDeps extends Pick<VerifyIdTokenDeps, "verifyToken" | "readFence" | "loadAccount"> {
  /** Registry check for the caller and for a disable target. Production: the Firestore registry, read per call. */
  isSuperadmin?: (uid: string) => Promise<boolean>;
  userAdmin?: UserAdminPort;
  memberships?: MembershipReaderPort;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
const MAX_PAGE_TOKEN_LENGTH = 1024;
const MAX_EMAIL_LENGTH = 254;
const MAX_UID_LENGTH = 128;

export type ListAuthUsersResult =
  | { ok: true; users: readonly AuthUserView[]; nextPageToken: string | null }
  | { ok: false; error: UserManagementError };

export type AuthUserDetailResult =
  | { ok: true; user: AuthUserView; teams: readonly TeamMembershipView[] }
  | { ok: false; error: UserManagementError };

export type SetAuthUserDisabledResult =
  | { ok: true; uid: string; disabled: boolean }
  | { ok: false; error: UserManagementError };

export interface ListAuthUsersQuery {
  readonly limit?: unknown;
  readonly pageToken?: unknown;
  readonly email?: unknown;
}

/** Clamps the page size to 1..MAX_PAGE_SIZE. A malformed value falls back to the default, never to "all". */
export function parsePageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(value, MAX_PAGE_SIZE);
}

function parsePageToken(value: unknown): string | undefined | "invalid" {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_PAGE_TOKEN_LENGTH) return "invalid";
  return value;
}

function parseUid(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("/") || value.length > MAX_UID_LENGTH) {
    return undefined;
  }
  return value;
}

function parseEmail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_EMAIL_LENGTH) return undefined;
  const email = normalizeEmail(value);
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1 || /\s/.test(email)) return undefined;
  return email;
}

function authDeps(deps: UserManagementDeps) {
  return {
    verifyToken: deps.verifyToken,
    readFence: deps.readFence,
    loadAccount: deps.loadAccount,
    isSuperadmin: deps.isSuperadmin,
  };
}

/**
 * Lists Auth users one page at a time, or looks up one exact e-mail. Firebase Auth has no prefix search, so the search is an
 * exact, normalized match.
 */
export async function listAuthUsers(
  idToken: string,
  query: ListAuthUsersQuery = {},
  deps: UserManagementDeps = {},
): Promise<ListAuthUsersResult> {
  const admin = await requireAppAdmin(idToken, authDeps(deps));
  if (!admin.ok) return { ok: false, error: admin.error };

  const port = deps.userAdmin ?? defaultUserAdminPort();
  try {
    if (query.email !== undefined && query.email !== null && query.email !== "") {
      const email = parseEmail(query.email);
      if (email === undefined) return { ok: false, error: "invalid_input" };
      const user = await port.getUserByEmail(email);
      return { ok: true, users: user ? [user] : [], nextPageToken: null };
    }

    const pageToken = parsePageToken(query.pageToken);
    if (pageToken === "invalid") return { ok: false, error: "invalid_input" };
    const page = await port.listUsers(parsePageSize(query.limit), pageToken);
    return { ok: true, users: page.users, nextPageToken: page.nextPageToken };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/** One account plus its team memberships, for the operator's detail view. */
export async function getAuthUserDetail(
  idToken: string,
  rawUid: unknown,
  deps: UserManagementDeps = {},
): Promise<AuthUserDetailResult> {
  const admin = await requireAppAdmin(idToken, authDeps(deps));
  if (!admin.ok) return { ok: false, error: admin.error };

  const uid = parseUid(rawUid);
  if (uid === undefined) return { ok: false, error: "invalid_input" };

  const port = deps.userAdmin ?? defaultUserAdminPort();
  const memberships = deps.memberships ?? defaultMembershipReader();
  try {
    const user = await port.getUser(uid);
    if (user === undefined) return { ok: false, error: "user_not_found" };
    const teams = await memberships.listForUid(uid);
    return { ok: true, user, teams };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Disables or re-enables one account. Disabling requires `confirm === true` (the explicit confirmation of a destructive
 * action) and revokes the account's refresh tokens, so existing sessions stop at the next token check. Re-enabling does not
 * revoke anything. Refused: the operator's own account; any active superadmin (revoke the superadmin record first, which
 * keeps the last-superadmin rule in one place); an unknown uid.
 */
export async function setAuthUserDisabled(
  idToken: string,
  rawUid: unknown,
  disabled: unknown,
  confirm: unknown,
  deps: UserManagementDeps = {},
): Promise<SetAuthUserDisabledResult> {
  const admin = await requireAppAdmin(idToken, authDeps(deps));
  if (!admin.ok) return { ok: false, error: admin.error };

  const uid = parseUid(rawUid);
  if (uid === undefined || typeof disabled !== "boolean") return { ok: false, error: "invalid_input" };
  if (disabled && confirm !== true) return { ok: false, error: "confirmation_required" };
  if (uid === admin.identity.uid) return { ok: false, error: "self_action_refused" };

  const port = deps.userAdmin ?? defaultUserAdminPort();
  const isSuperadmin = deps.isSuperadmin ?? readSuperadminActive;
  try {
    const user = await port.getUser(uid);
    if (user === undefined) return { ok: false, error: "user_not_found" };
    if (disabled && (await isSuperadmin(uid))) return { ok: false, error: "target_is_superadmin" };

    await port.setDisabled(uid, disabled);
    if (disabled) await port.revokeRefreshTokens(uid);
    return { ok: true, uid, disabled };
  } catch {
    // Fail closed without detail: the caller learns only that the change did not complete.
    return { ok: false, error: "persistence_failed" };
  }
}

/** Production Admin Auth adapter. Only the members listed in `UserAdminPort` are used. */
export function defaultUserAdminPort(): UserAdminPort {
  return {
    async listUsers(maxResults, pageToken) {
      const page = await getAdminAuth().listUsers(maxResults, pageToken);
      return { users: page.users.map(toView), nextPageToken: page.pageToken ?? null };
    },
    async getUserByEmail(email) {
      try {
        return toView(await getAdminAuth().getUserByEmail(email));
      } catch (error) {
        if (isUserNotFound(error)) return undefined;
        throw error;
      }
    },
    async getUser(uid) {
      try {
        return toView(await getAdminAuth().getUser(uid));
      } catch (error) {
        if (isUserNotFound(error)) return undefined;
        throw error;
      }
    },
    async setDisabled(uid, disabled) {
      await getAdminAuth().updateUser(uid, { disabled });
    },
    async revokeRefreshTokens(uid) {
      await getAdminAuth().revokeRefreshTokens(uid);
    },
  };
}

/** Production membership reader: `teamMemberships` documents carry the `uid` and `teamId` fields (docs/DATA-MODEL.md). */
export function defaultMembershipReader(): MembershipReaderPort {
  return {
    async listForUid(uid) {
      const snapshot = await getFirestoreDb().collection("teamMemberships").where("uid", "==", uid).get();
      return snapshot.docs.flatMap((doc) => {
        const data = doc.data() as { teamId?: unknown; role?: unknown };
        if (typeof data.teamId !== "string") return [];
        const role: TeamMembershipView["role"] = data.role === "teamadmin" ? "teamadmin" : "member";
        return [{ teamId: data.teamId, role }];
      });
    },
  };
}

interface AdminUserRecordLike {
  readonly uid: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
  readonly metadata: { readonly creationTime?: string; readonly lastSignInTime?: string };
}

function toView(user: AdminUserRecordLike): AuthUserView {
  return {
    uid: user.uid,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    createdAt: user.metadata.creationTime ?? null,
    lastSignInAt: user.metadata.lastSignInTime ?? null,
  };
}

function isUserNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "auth/user-not-found";
}
