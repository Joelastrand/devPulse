/**
 * Client calls for superadmin user management. The server re-authorizes every call and applies the disable rules; this module
 * never decides admin status. Responses are untrusted: only fully shaped bodies are accepted, anything else is a neutral failure.
 */

export interface AuthUserEntry {
  readonly uid: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
  readonly createdAt: string | null;
  readonly lastSignInAt: string | null;
}

export interface TeamEntry {
  readonly teamId: string;
  readonly role: "teamadmin" | "member";
}

export type ListAuthUsersClientResult =
  | { readonly ok: true; readonly users: readonly AuthUserEntry[]; readonly nextPageToken: string | null }
  | { readonly ok: false; readonly error: string };

export type AuthUserDetailClientResult =
  | { readonly ok: true; readonly user: AuthUserEntry; readonly teams: readonly TeamEntry[] }
  | { readonly ok: false; readonly error: string };

export type DisableClientResult = { readonly ok: true; readonly uid: string; readonly disabled: boolean } | { readonly ok: false; readonly error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isAuthUserEntry(value: unknown): value is AuthUserEntry {
  return (
    isRecord(value) &&
    typeof value.uid === "string" &&
    (typeof value.email === "string" || value.email === null) &&
    typeof value.emailVerified === "boolean" &&
    typeof value.disabled === "boolean" &&
    (typeof value.createdAt === "string" || value.createdAt === null) &&
    (typeof value.lastSignInAt === "string" || value.lastSignInAt === null)
  );
}

function isTeamEntry(value: unknown): value is TeamEntry {
  return isRecord(value) && typeof value.teamId === "string" && (value.role === "teamadmin" || value.role === "member");
}

async function errorCodeOf(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => undefined);
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : "persistence_failed";
}

export async function fetchAuthUsers(
  idToken: string,
  query: { readonly pageToken?: string | null; readonly email?: string } = {},
): Promise<ListAuthUsersClientResult> {
  const params = new URLSearchParams({ limit: "25" });
  if (query.pageToken) params.set("pageToken", query.pageToken);
  if (query.email) params.set("email", query.email);
  try {
    const response = await fetch(`/api/admin/users?${params.toString()}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!response.ok) return { ok: false, error: await errorCodeOf(response) };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.users) || !body.users.every(isAuthUserEntry)) {
      return { ok: false, error: "read_failed" };
    }
    const nextPageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
    return { ok: true, users: body.users, nextPageToken };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

export async function fetchAuthUserDetail(idToken: string, uid: string): Promise<AuthUserDetailClientResult> {
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!response.ok) return { ok: false, error: await errorCodeOf(response) };
    const body: unknown = await response.json();
    if (!isRecord(body) || !isAuthUserEntry(body.user) || !Array.isArray(body.teams) || !body.teams.every(isTeamEntry)) {
      return { ok: false, error: "read_failed" };
    }
    return { ok: true, user: body.user, teams: body.teams };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

/** Disabling must pass `confirm: true`; the server refuses a disable without it. Re-enabling needs no confirmation. */
export async function setAuthUserDisabled(idToken: string, uid: string, disabled: boolean): Promise<DisableClientResult> {
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(disabled ? { disabled: true, confirm: true } : { disabled: false }),
    });
    if (!response.ok) return { ok: false, error: await errorCodeOf(response) };
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.uid !== "string" || typeof body.disabled !== "boolean") {
      return { ok: false, error: "persistence_failed" };
    }
    return { ok: true, uid: body.uid, disabled: body.disabled };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
