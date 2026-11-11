import "server-only";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { parseStoredRoleDefinition } from "../domain/role-definition";
import {
  isAddressableUid,
  parseStoredRoleAssignment,
  ROLE_ASSIGNMENT_LOOKUP_MAX,
  validateRoleAssignmentDraft,
  type OwnRoleAssignmentDto,
  type RoleAssignmentAdminDto,
} from "../domain/role-assignment";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";
import { getDefaultRoleAssignmentStore, type RoleAssignmentWriteStore } from "./role-assignment-store";

/**
 * Formal organizational role assignment operations (role-profiles SPEC, "Formal role assignment"). An assignment is
 * organizational information only. Nothing here grants application permission, and no authorization path reads it.
 *
 * Rules enforced here, in order, before any write:
 * - Only an app administrator (`requireAppAdmin`, the superadmin registry) may assign, change, remove or look up.
 * - A user cannot assign or remove their own role (`self_assignment`).
 * - The role must exist, be a readable role document, and not be archived (`role_archived`). An archived role never
 *   receives a new assignment.
 */

export interface RoleAssignmentDeps extends RequireAppAdminDeps {
  assignments?: RoleAssignmentWriteStore;
  roles?: RoleStore;
  now?: () => Date;
}

export type AssignRoleResult =
  | { ok: true; assignment: RoleAssignmentAdminDto; created: boolean }
  | {
      ok: false;
      error:
        | AuthRefusal
        | "forbidden"
        | "invalid_input"
        | "self_assignment"
        | "role_not_found"
        | "role_archived"
        | "erasure_in_progress"
        | "persistence_failed";
    };

export type RemoveRoleAssignmentResult =
  | { ok: true; removed: boolean }
  | { ok: false; error: AuthRefusal | "forbidden" | "invalid_input" | "self_assignment" | "erasure_in_progress" | "persistence_failed" };

export type LookupRoleAssignmentsResult =
  | { ok: true; assignments: Array<{ uid: string; roleId: string | null }> }
  | { ok: false; error: AuthRefusal | "forbidden" | "invalid_input" | "persistence_failed" };

export type OwnRoleAssignmentResult = { ok: true; assignment: OwnRoleAssignmentDto } | { ok: false; error: AuthRefusal | "persistence_failed" };

/** Reads a role for a new assignment. Returns the role, or the refusal to report. */
async function readRoleForAssignment(
  roles: RoleStore,
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: "role_not_found" | "role_archived" }> {
  const raw = await roles.get(roleId);
  const parsed = raw === undefined ? undefined : parseStoredRoleDefinition(raw);
  if (!parsed?.ok) return { ok: false, error: "role_not_found" };
  if (parsed.role.archivedAt !== undefined) return { ok: false, error: "role_archived" };
  return { ok: true };
}

/**
 * Admin assign or change. One document per uid, so a change replaces the previous role reference. The target is the
 * route's uid; the body carries only `{ roleId }`.
 */
export async function assignRoleToUser(
  idToken: string,
  targetUid: unknown,
  input: unknown,
  deps: RoleAssignmentDeps = {},
): Promise<AssignRoleResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin, readFence: deps.readFence });
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!isAddressableUid(targetUid)) return { ok: false, error: "invalid_input" };
  if (targetUid === admin.identity.uid) return { ok: false, error: "self_assignment" };

  const validated = validateRoleAssignmentDraft(input);
  if (!validated.ok) return { ok: false, error: "invalid_input" };

  try {
    const roles = deps.roles ?? getDefaultRoleStore();
    const role = await readRoleForAssignment(roles, validated.draft.roleId);
    if (!role.ok) return { ok: false, error: role.error };

    const assignments = deps.assignments ?? getDefaultRoleAssignmentStore();
    const { created } = await assignments.assign(targetUid, validated.draft.roleId, admin.identity.uid, (deps.now ?? (() => new Date()))());
    return { ok: true, assignment: { roleId: validated.draft.roleId }, created };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/** Admin removal of one user's assignment. Removing an absent assignment is an idempotent success with `removed: false`. */
export async function removeRoleAssignment(
  idToken: string,
  targetUid: unknown,
  deps: RoleAssignmentDeps = {},
): Promise<RemoveRoleAssignmentResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin, readFence: deps.readFence });
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!isAddressableUid(targetUid)) return { ok: false, error: "invalid_input" };
  if (targetUid === admin.identity.uid) return { ok: false, error: "self_assignment" };

  try {
    const assignments = deps.assignments ?? getDefaultRoleAssignmentStore();
    const { removed } = await assignments.remove(targetUid);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/**
 * Admin batch read of the role reference for each uid (bounded by `ROLE_ASSIGNMENT_LOOKUP_MAX`). Malformed stored
 * documents are reported as `null`, never repaired and never shown as another role.
 */
export async function lookupRoleAssignments(
  idToken: string,
  uids: unknown,
  deps: RoleAssignmentDeps = {},
): Promise<LookupRoleAssignmentsResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin, readFence: deps.readFence });
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!Array.isArray(uids) || uids.length > ROLE_ASSIGNMENT_LOOKUP_MAX || !uids.every(isAddressableUid)) {
    return { ok: false, error: "invalid_input" };
  }
  const uidList: string[] = uids;

  try {
    const assignments = deps.assignments ?? getDefaultRoleAssignmentStore();
    const raws = await assignments.getMany(uidList);
    return {
      ok: true,
      assignments: uidList.map((uid, index) => {
        const raw = raws[index];
        const parsed = raw === undefined ? undefined : parseStoredRoleAssignment(raw);
        return { uid, roleId: parsed?.ok ? parsed.assignment.roleId : null };
      }),
    };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * The signed-in person's own assignment (`/me/skills?vy=rolle`). The subject is the verified token's uid only. Shows the
 * title and description of an active role. An archived or unreadable role is reported as `none`: the assignment is kept
 * as stored, and the person is not shown a different role.
 */
export async function getOwnRoleAssignment(
  idToken: string,
  deps: { verifyToken?: VerifyIdTokenDeps["verifyToken"]; readFence?: VerifyIdTokenDeps["readFence"]; assignments?: RoleAssignmentWriteStore; roles?: RoleStore } = {},
): Promise<OwnRoleAssignmentResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken, readFence: deps.readFence });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const none: OwnRoleAssignmentDto = { status: "none" };
  try {
    const assignments = deps.assignments ?? getDefaultRoleAssignmentStore();
    const raw = await assignments.get(verified.identity.uid);
    const parsed = raw === undefined ? undefined : parseStoredRoleAssignment(raw);
    if (!parsed?.ok) return { ok: true, assignment: none };

    const roles = deps.roles ?? getDefaultRoleStore();
    const roleRaw = await roles.get(parsed.assignment.roleId);
    const role = roleRaw === undefined ? undefined : parseStoredRoleDefinition(roleRaw);
    if (!role?.ok || role.role.archivedAt !== undefined) return { ok: true, assignment: none };

    const assignment: OwnRoleAssignmentDto = { status: "assigned", title: role.role.name };
    if (role.role.description !== undefined) assignment.description = role.role.description;
    return { ok: true, assignment };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
