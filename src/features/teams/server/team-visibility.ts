import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { verifyIdToken, type VerifiedIdentity, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";
import { canAdministerTeam, effectiveTeamVisibility, isTeamVisibility, type TeamVisibility } from "../domain/team-authority";
import { isValidTeamStatus } from "../domain/team";
import { membershipDocId } from "../domain/team-membership";
import { resolveTeamRole, type ResolveTeamRoleDeps } from "./resolve-team-role";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** Raw, unvalidated reads for one visibility decision (both from the same transaction or snapshot). */
export interface VisibilityReads {
  team: unknown;
  membership: unknown;
}

/** The outcome of one decision: either a single team-document update, a no-op, or a refusal. */
export type VisibilityDecision =
  | { kind: "write"; visibility: TeamVisibility }
  | { kind: "noop"; visibility: TeamVisibility }
  | { kind: "refused"; error: "not_found" | "forbidden" | "team_disabled" };

/**
 * The transactional seam: one read of the team and the caller's membership, then at most one
 * `teams/{teamId}` update, all inside one fenced transaction. Satisfied in production by Firestore
 * and by an in-memory fake in tests.
 */
export interface TeamVisibilityCollection {
  run(uid: string, teamId: string, decide: (reads: VisibilityReads) => VisibilityDecision, now: Date): Promise<VisibilityDecision>;
}

function getDefaultCollection(): TeamVisibilityCollection {
  return {
    async run(uid, teamId, decide, now) {
      const db = getFirestoreDb();
      const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId);
      const membershipRef = db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId));
      return runFencedTransaction(db, uid, async (tx) => {
        const teamSnap = await tx.get(teamRef);
        const membershipSnap = await tx.get(membershipRef);
        const decision = decide({
          team: teamSnap.exists ? teamSnap.data() : undefined,
          membership: membershipSnap.exists ? membershipSnap.data() : undefined,
        });
        if (decision.kind === "write") {
          tx.update(teamRef, { visibility: decision.visibility, visibilityUpdatedAt: now });
        }
        return decision;
      });
    },
  };
}

/**
 * The visibility decision, pure and shared by production and tests. Order: a missing or malformed team is `not_found`
 * (for everyone, including a superadmin); a caller who may not administer the team is `forbidden` (before any status
 * detail is revealed); a non-active team is `team_disabled`; an equal visibility is a `noop` (idempotent, no write).
 */
export function decideTeamVisibility(args: {
  reads: VisibilityReads;
  isSuperadmin: boolean;
  uid: string;
  teamId: string;
  visibility: TeamVisibility;
}): VisibilityDecision {
  const teamData = args.reads.team;
  if (typeof teamData !== "object" || teamData === null || !isValidTeamStatus((teamData as Record<string, unknown>).status)) {
    return { kind: "refused", error: "not_found" };
  }
  if (!canAdministerTeam({ isSuperadmin: args.isSuperadmin, uid: args.uid, teamId: args.teamId, membership: args.reads.membership })) {
    return { kind: "refused", error: "forbidden" };
  }
  if ((teamData as Record<string, unknown>).status !== "active") {
    return { kind: "refused", error: "team_disabled" };
  }
  const current = effectiveTeamVisibility((teamData as Record<string, unknown>).visibility);
  if (current === args.visibility) return { kind: "noop", visibility: current };
  return { kind: "write", visibility: args.visibility };
}

export interface TeamVisibilityDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  collection?: TeamVisibilityCollection;
  roleDeps?: ResolveTeamRoleDeps;
  /** Test seam for the raw team document read used by the settings view. */
  teamReader?: (teamId: string) => Promise<Record<string, unknown> | undefined>;
}

export type SetTeamVisibilityResult =
  | { ok: true; visibility: TeamVisibility; changed: boolean }
  | { ok: false; error: AuthRefusal | "invalid_input" | "not_found" | "forbidden" | "team_disabled" | "erasure_in_progress" | "persistence_failed" };

/**
 * Changes a team's public/private visibility (docs/archive/features/teamadmin-and-team-visibility/SPEC.md). Authorized server-side
 * from the verified identity: a superadmin, or a genuine `teamadmin` of the same team, on an `active` team. The caller
 * never supplies a role. Writes only `visibility` and `visibilityUpdatedAt`; no actor uid is stored, so the write
 * creates no new linkage for account erasure.
 */
export async function setTeamVisibility(
  idToken: string,
  teamId: string,
  visibility: unknown,
  deps: TeamVisibilityDeps = {},
): Promise<SetTeamVisibilityResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  if (!isTeamVisibility(visibility) || typeof teamId !== "string" || teamId.length === 0 || teamId.includes("/")) {
    return { ok: false, error: "invalid_input" };
  }

  const identity: VerifiedIdentity = verified.identity;
  const collection = deps.collection ?? getDefaultCollection();
  const now = deps.now ?? new Date();

  try {
    // Resolved before the transaction: the registry read is outside the write callback, and the decision stays pure.
    const isSuperadmin = await isAppAdmin(identity, { isSuperadmin: deps.isSuperadmin });
    const decision = await collection.run(
      identity.uid,
      teamId,
      (reads) => decideTeamVisibility({
        reads,
        isSuperadmin,
        uid: identity.uid,
        teamId,
        visibility,
      }),
      now,
    );
    if (decision.kind === "refused") return { ok: false, error: decision.error };
    return { ok: true, visibility: decision.visibility, changed: decision.kind === "write" };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

export type TeamVisibilitySettingsResult =
  | { ok: true; visibility: TeamVisibility; canAdminister: boolean }
  | { ok: false; error: AuthRefusal | "not_found" | "forbidden" | "read_failed" };

/**
 * The settings view for a caller who is already a member or superadmin of this team. Anyone else (including a signed-in
 * non-member of a public team) gets `forbidden`; the public read path is separate and projects its own fields.
 */
export async function readTeamVisibilitySettings(
  idToken: string,
  teamId: string,
  deps: TeamVisibilityDeps = {},
): Promise<TeamVisibilitySettingsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const role = await resolveTeamRole(verified.identity, teamId, { isSuperadmin: deps.isSuperadmin, ...deps.roleDeps });
  if (!role.ok) return { ok: false, error: "read_failed" };
  if (role.role === "denied") return { ok: false, error: "forbidden" };

  const team = await readTeamRaw(teamId, deps);
  if (!team.ok) return { ok: false, error: "read_failed" };
  if (team.raw === undefined) return { ok: false, error: "not_found" };
  return { ok: true, visibility: effectiveTeamVisibility(team.raw.visibility), canAdminister: role.canAdminister };
}

async function readTeamRaw(
  teamId: string,
  deps: TeamVisibilityDeps,
): Promise<{ ok: true; raw: Record<string, unknown> | undefined } | { ok: false }> {
  try {
    const raw = deps.teamReader ? await deps.teamReader(teamId) : await readTeamDocument(teamId);
    return { ok: true, raw };
  } catch {
    return { ok: false };
  }
}

async function readTeamDocument(teamId: string): Promise<Record<string, unknown> | undefined> {
  const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
  return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;
}
