/** The owner's target as the GET/PUT routes return it (PG-3). Only `selected` carries a role. */
export type RoleTargetView =
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "selected"; target: { roleId: string; name: string; archived: boolean } };

/** One role in the active catalog (PG-8 allow-list). `selectable` is false without a valid, available expectation (PG-2). */
export interface CatalogRoleView {
  roleId: string;
  name: string;
  selectable: boolean;
  expectations: Array<{ treeId: string; treeName: string | null; expectedLevel: number }>;
}

export type FetchRoleTargetResult =
  | { status: "ok"; view: RoleTargetView }
  | { status: "unauthenticated" }
  | { status: "read_failed" };

export type FetchCatalogResult =
  | { status: "ok"; roles: CatalogRoleView[]; truncated: boolean }
  | { status: "unauthenticated" }
  | { status: "read_failed" };

export type RoleTargetWriteResult = { ok: true; view: RoleTargetView } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isRoleTargetView(value: unknown): value is RoleTargetView {
  if (!isRecord(value)) return false;
  if (value.status === "none" || value.status === "unavailable") return true;
  if (value.status !== "selected" || !isRecord(value.target)) return false;
  return (
    typeof value.target.roleId === "string" &&
    typeof value.target.name === "string" &&
    typeof value.target.archived === "boolean"
  );
}

function isCatalogRole(value: unknown): value is CatalogRoleView {
  return (
    isRecord(value) &&
    typeof value.roleId === "string" &&
    typeof value.name === "string" &&
    typeof value.selectable === "boolean" &&
    Array.isArray(value.expectations)
  );
}

/** One comparison row as the route returns it (PG-4): the five allow-listed fields, in the role's expectation order. */
export interface ComparisonRowView {
  treeId: string;
  treeName: string | null;
  expectedLevel: number;
  status: "meets" | "development_opportunity" | "not_assessed" | "area_unavailable";
  ownLevel: number | null;
}

/** The owner's comparison state (PG-4). Rows exist only in the `available` state. */
export type ComparisonView =
  | { state: "no_target" }
  | { state: "target_unavailable"; reason: "no_expectations" | "unavailable" }
  | { state: "available"; target: { roleId: string; name: string }; rows: ComparisonRowView[] };

export type FetchComparisonResult =
  | { status: "ok"; view: ComparisonView }
  | { status: "unauthenticated" }
  | { status: "read_failed" };

const COMPARISON_STATUSES: ReadonlySet<unknown> = new Set(["meets", "development_opportunity", "not_assessed", "area_unavailable"]);

function isComparisonRow(value: unknown): value is ComparisonRowView {
  return (
    isRecord(value) &&
    typeof value.treeId === "string" &&
    (typeof value.treeName === "string" || value.treeName === null) &&
    typeof value.expectedLevel === "number" &&
    COMPARISON_STATUSES.has(value.status) &&
    (typeof value.ownLevel === "number" || value.ownLevel === null)
  );
}

function isComparisonView(value: unknown): value is ComparisonView {
  if (!isRecord(value)) return false;
  if (value.state === "no_target") return true;
  if (value.state === "target_unavailable") {
    return value.reason === "no_expectations" || value.reason === "unavailable";
  }
  return (
    value.state === "available" &&
    isRecord(value.target) &&
    typeof value.target.roleId === "string" &&
    typeof value.target.name === "string" &&
    Array.isArray(value.rows) &&
    value.rows.every(isComparisonRow)
  );
}

/** Reads the owner's comparison via `GET /api/me/role-comparison`. A malformed body is a read failure, never a state. */
export async function fetchRoleComparison(idToken: string): Promise<FetchComparisonResult> {
  try {
    const response = await fetch("/api/me/role-comparison", { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401) return { status: "unauthenticated" };
    if (!response.ok) return { status: "read_failed" };
    const body: unknown = await response.json();
    return isComparisonView(body) ? { status: "ok", view: body } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

/** Reads the owner's target via `GET /api/me/role-target`. A malformed body is a read failure, never a guessed state. */
export async function fetchOwnRoleTarget(idToken: string): Promise<FetchRoleTargetResult> {
  try {
    const response = await fetch("/api/me/role-target", { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401) return { status: "unauthenticated" };
    if (!response.ok) return { status: "read_failed" };
    const body: unknown = await response.json();
    return isRoleTargetView(body) ? { status: "ok", view: body } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

/** Reads the active role catalog via `GET /api/roles`. The UI offers only roles with `selectable: true`. */
export async function fetchRoleCatalog(idToken: string): Promise<FetchCatalogResult> {
  try {
    const response = await fetch("/api/roles", { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401) return { status: "unauthenticated" };
    if (!response.ok) return { status: "read_failed" };
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.roles) || typeof body.truncated !== "boolean") {
      return { status: "read_failed" };
    }
    if (!body.roles.every(isCatalogRole)) return { status: "read_failed" };
    return { status: "ok", roles: body.roles, truncated: body.truncated };
  } catch {
    return { status: "read_failed" };
  }
}

async function readStatusResponse(response: Response): Promise<RoleTargetWriteResult> {
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok && isRoleTargetView(body)) return { ok: true, view: body };
  const error = isRecord(body) && typeof body.error === "string" ? body.error : "persistence_failed";
  return { ok: false, error };
}

/** Selects a target via `PUT /api/me/role-target` with `{ roleId }` only. Returns the stored status on success. */
export async function setOwnRoleTarget(idToken: string, roleId: string): Promise<RoleTargetWriteResult> {
  try {
    const response = await fetch("/api/me/role-target", {
      method: "PUT",
      headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ roleId }),
    });
    return await readStatusResponse(response);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/** Clears the target via `DELETE /api/me/role-target` (idempotent `204`). */
export async function clearOwnRoleTarget(idToken: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/me/role-target", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.status === 204) return { ok: true };
    const body: unknown = await response.json().catch(() => undefined);
    const error = isRecord(body) && typeof body.error === "string" ? body.error : "persistence_failed";
    return { ok: false, error };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
