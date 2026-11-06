import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { isValidTeamStatus } from "../domain/team";
import { isValidMembershipFor, membershipDocId, type MembershipRole } from "../domain/team-membership";
import { requireAppAdmin } from "./require-app-admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { assertNoErasureRecordInTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** Marks a membership field for deletion in `RoleTransaction.update` (maps to `FieldValue.delete()`). */
export const REMOVE_FIELD = Symbol("remove-field");

/**
 * The reads/writes one role change may perform, all inside a single
 * transaction and scoped to exactly one (uid, teamId) membership. Reads are
 * raw and unvalidated; `setTeamMemberRole` validates them before trusting
 * them. `update` only ever targets the existing membership document — it can
 * never create one.
 */
export interface RoleTransaction {
  getMembership(): Promise<unknown>;
  getTeamStatus(): Promise<unknown>;
  update(fields: Record<string, Date | string | typeof REMOVE_FIELD>): void;
}

/**
 * The transactional seam this operation depends on, satisfied in production
 * by one Firestore transaction and by an in-memory fake in tests. The
 * membership read, the team-status read and the write all happen inside one
 * `run`, so the decision and the write are never separated.
 */
export interface SetTeamMemberRoleCollection {
  run<T>(uid: string, teamId: string, work: (tx: RoleTransaction) => Promise<T>): Promise<T>;
}

/** The acting admin's uid fences the role update in the same transaction (TASK-035, W-17). */
function getDefaultCollection(actorUid: string): SetTeamMemberRoleCollection {
  return {
    async run(uid, teamId, work) {
      const db = getFirestoreDb();
      const membershipRef = db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId));
      const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId);

      return db.runTransaction(async (tx) => {
        await assertNoErasureRecordInTransaction(db, tx, actorUid);
        // Firestore requires every read before the first write; `work` reads
        // lazily and writes last, and `update` is only queued here.
        let pendingUpdate: Record<string, unknown> | undefined;
        const result = await work({
          async getMembership() {
            const snapshot = await tx.get(membershipRef);
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async getTeamStatus() {
            const snapshot = await tx.get(teamRef);
            return snapshot.exists ? snapshot.data()?.status : undefined;
          },
          update(fields) {
            pendingUpdate = Object.fromEntries(
              Object.entries(fields).map(([key, value]) => [key, value === REMOVE_FIELD ? FieldValue.delete() : value]),
            );
          },
        });
        if (pendingUpdate) {
          tx.update(membershipRef, pendingUpdate);
        }
        return result;
      });
    },
  };
}

type RoleOutcome = "updated" | "not_a_member" | "team_disabled";

export type SetTeamMemberRoleResult =
  | { ok: true; role: MembershipRole }
  | {
      ok: false;
      error: AuthRefusal | "forbidden" | "invalid_input" | "not_a_member" | "team_disabled" | "persistence_failed";
    };

export interface SetTeamMemberRoleDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  collection?: SetTeamMemberRoleCollection;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("/");
}

/**
 * Grants or revokes the teamadmin role of a current team member, or returns them to an ordinary
 * member (docs/features/member-identity-and-team-roles/SPEC.md — BR-16,
 * BR-18 through BR-23). App-admin-only via `requireAppAdmin`; the caller's
 * role and the team's status are never client-supplied.
 *
 * One Firestore transaction reads the membership, validates it with
 * `isValidMembershipFor` (a missing or mismatched document is `not_a_member`
 * and nothing is created — the write is an `update`, which cannot create a
 * document) and, **only when assigning `"teamadmin"`**, reads `teams/{teamId}` and
 * requires its status to be exactly `"active"` — a disabled, missing or
 * malformed status is `team_disabled` with zero writes, even when the member
 * is already a teamadmin. Revoking `"teamadmin"` is allowed on any team
 * status and only removes the `role` field. Both directions record the last
 * actor/time (`roleUpdatedBy`/`roleUpdatedAt`). Idempotent. Multiple teamadmins
 * per team are allowed; nothing here touches any other membership. Removing
 * a membership elsewhere (`removeTeamMember`, unchanged) ends the teamadmin role
 * because the role lives on that document.
 */
export async function setTeamMemberRole(
  idToken: string,
  teamId: string,
  uid: string,
  role: unknown,
  deps: SetTeamMemberRoleDeps = {},
): Promise<SetTeamMemberRoleResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  if ((role !== "teamadmin" && role !== "member") || !isSafeId(teamId) || !isSafeId(uid)) {
    return { ok: false, error: "invalid_input" };
  }

  const collection = deps.collection ?? getDefaultCollection(admin.identity.uid);
  const now = deps.now ?? new Date();

  try {
    const outcome = await collection.run(uid, teamId, async (tx): Promise<RoleOutcome> => {
      if (!isValidMembershipFor(await tx.getMembership(), { uid, teamId })) {
        return "not_a_member";
      }

      if (role === "teamadmin") {
        const status = await tx.getTeamStatus();
        if (!isValidTeamStatus(status) || status !== "active") {
          return "team_disabled";
        }
      }

      tx.update({
        role: role === "teamadmin" ? "teamadmin" : REMOVE_FIELD,
        roleUpdatedAt: now,
        roleUpdatedBy: admin.identity.uid,
      });
      return "updated";
    });

    return outcome === "updated" ? { ok: true, role } : { ok: false, error: outcome };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}
