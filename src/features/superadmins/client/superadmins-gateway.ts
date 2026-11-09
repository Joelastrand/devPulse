/**
 * Client calls for the superadmin management routes. The server re-authorizes every call; this module never decides admin
 * status. Responses are untrusted: only a fully shaped body is accepted, anything else is a neutral failure.
 */

export interface SuperadminEntry {
  readonly uid: string;
  readonly grantedAt: string | null;
}

export type FetchSuperadminsResult =
  | { readonly ok: true; readonly superadmins: readonly SuperadminEntry[] }
  | { readonly ok: false; readonly error: string };

export type SuperadminWriteResult =
  | { readonly ok: true; readonly outcome: string; readonly uid: string }
  | { readonly ok: false; readonly error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isSuperadminEntry(value: unknown): value is SuperadminEntry {
  return (
    isRecord(value) &&
    typeof value.uid === "string" &&
    (typeof value.grantedAt === "string" || value.grantedAt === null)
  );
}

async function errorCodeOf(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => undefined);
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : "persistence_failed";
}

export async function fetchSuperadmins(idToken: string): Promise<FetchSuperadminsResult> {
  try {
    const response = await fetch("/api/admin/superadmins", { headers: { Authorization: `Bearer ${idToken}` } });
    if (!response.ok) return { ok: false, error: await errorCodeOf(response) };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.superadmins) || !body.superadmins.every(isSuperadminEntry)) {
      return { ok: false, error: "read_failed" };
    }
    return { ok: true, superadmins: body.superadmins };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

export async function grantSuperadmin(idToken: string, email: string): Promise<SuperadminWriteResult> {
  return sendWrite("/api/admin/superadmins", { method: "POST", body: JSON.stringify({ email }) }, idToken);
}

export async function revokeSuperadmin(idToken: string, uid: string): Promise<SuperadminWriteResult> {
  return sendWrite(`/api/admin/superadmins/${encodeURIComponent(uid)}`, { method: "DELETE" }, idToken);
}

async function sendWrite(url: string, init: { method: string; body?: string }, idToken: string): Promise<SuperadminWriteResult> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    });
    if (!response.ok) return { ok: false, error: await errorCodeOf(response) };
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.uid !== "string" || typeof body.outcome !== "string") {
      return { ok: false, error: "persistence_failed" };
    }
    return { ok: true, outcome: body.outcome, uid: body.uid };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
