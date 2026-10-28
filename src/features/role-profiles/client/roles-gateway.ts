/** The admin role view as the admin route returns it: the allow-listed role fields, dates omitted (not shown here). */
export interface AdminRoleView {
  roleId: string;
  name: string;
  description?: string;
  archived: boolean;
  expectations: AdminRoleExpectationView[];
}

export interface AdminRoleExpectationView {
  treeId: string;
  treeName: string | null;
  expectedLevel: number;
}

export type FetchAdminRolesResult =
  | { status: "ok"; roles: AdminRoleView[]; truncated: boolean }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "read_failed" };

/** A role write: the admin DTO on success, otherwise the server's neutral error code (never role content). */
export type AdminRoleWriteResult = { ok: true; role: AdminRoleView } | { ok: false; error: string };

export interface AdminRoleExpectationInput {
  treeId: string;
  expectedLevel: number;
}

/** A create body: only the fields the operation accepts. Absent `description` means no description. */
export interface CreateAdminRoleInput {
  name: string;
  description?: string;
  expectations: AdminRoleExpectationInput[];
}

/** A PATCH body: only the changed fields. `description: ""` clears the stored description (PG-10). */
export interface UpdateAdminRoleInput {
  name?: string;
  description?: string;
  expectations?: AdminRoleExpectationInput[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isExpectation(value: unknown): value is AdminRoleExpectationView {
  return (
    isRecord(value) &&
    typeof value.treeId === "string" &&
    (typeof value.treeName === "string" || value.treeName === null) &&
    typeof value.expectedLevel === "number"
  );
}

/** Shape check for an untrusted admin role body; anything else is not treated as a role. */
export function isAdminRoleView(value: unknown): value is AdminRoleView {
  return (
    isRecord(value) &&
    typeof value.roleId === "string" &&
    typeof value.name === "string" &&
    (value.description === undefined || typeof value.description === "string") &&
    typeof value.archived === "boolean" &&
    Array.isArray(value.expectations) &&
    value.expectations.every(isExpectation)
  );
}

/** The response is untrusted input to the UI: only a fully shaped body is accepted, anything else is a read failure. */
function parseAdminRolesBody(body: unknown): { roles: AdminRoleView[]; truncated: boolean } | undefined {
  if (!isRecord(body) || !Array.isArray(body.roles) || typeof body.truncated !== "boolean") return undefined;
  if (!body.roles.every(isAdminRoleView)) return undefined;
  return { roles: body.roles, truncated: body.truncated };
}

/** Fetches the admin role list via `GET /api/admin/roles`. The server re-authorizes every call; the UI never decides admin status. */
export async function fetchAdminRoles(idToken: string): Promise<FetchAdminRolesResult> {
  try {
    const response = await fetch("/api/admin/roles", { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    if (!response.ok) return { status: "read_failed" };

    const parsed = parseAdminRolesBody(await response.json());
    return parsed ? { status: "ok", ...parsed } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

async function sendRoleWrite(
  method: "POST" | "PATCH",
  url: string,
  idToken: string,
  body: unknown,
): Promise<AdminRoleWriteResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok && isAdminRoleView(payload)) return { ok: true, role: payload };
    const error = isRecord(payload) && typeof payload.error === "string" ? payload.error : "persistence_failed";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/** `POST /api/admin/roles`. */
export function createAdminRole(idToken: string, input: CreateAdminRoleInput): Promise<AdminRoleWriteResult> {
  return sendRoleWrite("POST", "/api/admin/roles", idToken, input);
}

/** `PATCH /api/admin/roles/[roleId]`. */
export function updateAdminRole(
  idToken: string,
  roleId: string,
  input: UpdateAdminRoleInput,
): Promise<AdminRoleWriteResult> {
  return sendRoleWrite("PATCH", `/api/admin/roles/${encodeURIComponent(roleId)}`, idToken, input);
}

/** `POST /api/admin/roles/[roleId]/archive` with `{ archived }`: archive or restore (idempotent on the server). */
export function setAdminRoleArchived(
  idToken: string,
  roleId: string,
  archived: boolean,
): Promise<AdminRoleWriteResult> {
  return sendRoleWrite("POST", `/api/admin/roles/${encodeURIComponent(roleId)}/archive`, idToken, { archived });
}
