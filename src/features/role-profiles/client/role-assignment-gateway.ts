"use client";

/**
 * Admin client for formal role assignment (role-profiles SPEC, "Formal role assignment"). Every call is re-authorized by the
 * server; the UI never decides admin status and never sends a uid it did not receive from the team roster. Responses are
 * untrusted input and are shape-checked before use.
 */

export type LookupRoleAssignmentsResult =
  | { status: "ok"; roleIds: Record<string, string | null> }
  | { status: "unauthenticated" }
  | { status: "read_failed" };

export type AssignRoleResult = { ok: true; roleId: string } | { ok: false; error: string };
export type RemoveRoleResult = { ok: true } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseLookupBody(body: unknown): Record<string, string | null> | undefined {
  if (!isRecord(body) || !Array.isArray(body.assignments)) return undefined;
  const roleIds: Record<string, string | null> = {};
  for (const entry of body.assignments) {
    if (!isRecord(entry) || typeof entry.uid !== "string") return undefined;
    if (entry.roleId !== null && typeof entry.roleId !== "string") return undefined;
    roleIds[entry.uid] = entry.roleId;
  }
  return roleIds;
}

/** `POST /api/admin/role-assignments/lookup`: the assigned role id per uid (`null` when none). */
export async function lookupRoleAssignments(idToken: string, uids: readonly string[]): Promise<LookupRoleAssignmentsResult> {
  try {
    const response = await fetch("/api/admin/role-assignments/lookup", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ uids }),
      cache: "no-store",
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (!response.ok) return { status: "read_failed" };
    const roleIds = parseLookupBody(await response.json());
    return roleIds ? { status: "ok", roleIds } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

async function sendAssignmentRequest(
  method: "PUT" | "DELETE",
  idToken: string,
  uid: string,
  body: unknown,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/role-assignment`, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(payload)) return { ok: true, payload };
    const error = isRecord(payload) && typeof payload.error === "string" ? payload.error : "persistence_failed";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/** Assigns a role to a user, or changes the existing assignment (one role per user). */
export async function assignAdminRoleToUser(idToken: string, uid: string, roleId: string): Promise<AssignRoleResult> {
  const result = await sendAssignmentRequest("PUT", idToken, uid, { roleId });
  if (!result.ok) return result;
  return typeof result.payload.roleId === "string" ? { ok: true, roleId: result.payload.roleId } : { ok: false, error: "persistence_failed" };
}

/** Removes a user's role assignment. The shared role definition is not changed. */
export async function removeAdminRoleFromUser(idToken: string, uid: string): Promise<RemoveRoleResult> {
  const result = await sendAssignmentRequest("DELETE", idToken, uid, undefined);
  return result.ok ? { ok: true } : result;
}
