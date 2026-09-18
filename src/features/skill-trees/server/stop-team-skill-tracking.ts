import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { skillProgressDocId } from "../domain/skill-progress";

const SKILL_PROGRESS_COLLECTION = "skillProgress";

/**
 * The write-only seam for the deterministic `skillProgress/{teamId}__
 * {treeId}` document, satisfied in production by a direct Firestore
 * document delete (keyed by `skillProgressDocId`) and by an in-memory fake
 * in tests. **This interface has no `teams`-status-reading seam, and no
 * read seam of any kind** — stopping is an unconditional delete-by-id, never
 * gated on the document's own content or the owning team's status (SPEC —
 * Owner decision 5).
 */
export interface SkillProgressDocStore {
  delete(docId: string): Promise<void>;
}

function getDefaultSkillProgressDocStore(): SkillProgressDocStore {
  return {
    async delete(docId) {
      await getFirestoreDb().collection(SKILL_PROGRESS_COLLECTION).doc(docId).delete();
    },
  };
}

export type StopTeamSkillTrackingResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" };

export interface StopTeamSkillTrackingDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  progress?: SkillProgressDocStore;
}

/**
 * Stops tracking a SkillTree for a team (docs/features/team-skill-tree/
 * SPEC.md — BR-14 through BR-16). Only an app admin may call this
 * successfully. `teamId`/`treeId` are always the caller's trusted
 * server/route scope — this function accepts no body-shaped field capable
 * of overriding either, and the deterministic id
 * (`skillProgressDocId(teamId, treeId)`) means this call can never delete a
 * different team's or a different tree's record.
 *
 * `.delete()` `skillProgress/{teamId}__{treeId}` unconditionally —
 * idempotent by construction (BR-15): a not-currently-tracked pair simply
 * has no document at that id, and Firestore's `delete()` on a nonexistent
 * document succeeds the same way a delete of an existing one does, so no
 * separate "already stopped" branch or read is needed. No tombstone or
 * replacement record is ever written.
 *
 * **Deliberately performs no `teams/{teamId}` read, and no `skillProgress`
 * read either** — stopping remains available regardless of the owning
 * team's `active`/`disabled` status (SPEC — Owner decision 5, BR-16) and
 * regardless of whether the existing record (if any) is well-formed. This
 * function's own dependency seam (`StopTeamSkillTrackingDeps`) has no
 * team-status-reading or `skillProgress`-reading field at all, making that
 * omission structural, not merely a code-path choice.
 *
 * A later `startTeamSkillTracking` for the same pair always creates a fresh
 * record with `currentNodeId: null` — the identical initial state as the
 * very first time that pair was ever tracked (no history is retained
 * anywhere in this feature).
 */
export async function stopTeamSkillTracking(
  idToken: string,
  teamId: string,
  treeId: string,
  deps: StopTeamSkillTrackingDeps = {},
): Promise<StopTeamSkillTrackingResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const docId = skillProgressDocId(teamId, treeId);
  const progress = deps.progress ?? getDefaultSkillProgressDocStore();

  try {
    await progress.delete(docId);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
