import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";
import { skillNeedDocId } from "../domain/skill-need";
import { requireGenuineLead } from "./genuine-team-membership";
import { getDefaultSkillNeedWriteStore, type SkillNeedWriteStore } from "./skill-needs-store";

export type DeleteSkillNeedError = "unauthenticated" | "forbidden" | "team_disabled" | "persistence_failed";

export type DeleteSkillNeedResult = { ok: true } | { ok: false; error: DeleteSkillNeedError };

export interface DeleteSkillNeedDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillNeedWriteStore;
}

/**
 * Hard-delete the need for (team, tree) (SPEC BR-5). Same genuine-lead +
 * `active`-team decision as the upsert, made inside the transaction. Idempotent:
 * an absent slot succeeds without a write; an existing slot is physically
 * deleted whatever its content or tree validity (a stale area may only be
 * deleted). No body is read, no tombstone or archive is left.
 */
export async function deleteSkillNeed(
  idToken: string,
  teamId: string,
  treeId: string,
  deps: DeleteSkillNeedDeps = {},
): Promise<DeleteSkillNeedResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };
  const identity = verified.identity;

  const store = deps.store ?? getDefaultSkillNeedWriteStore();

  try {
    return await store.runTransaction(async (tx): Promise<DeleteSkillNeedResult> => {
      const lead = await requireGenuineLead(identity, teamId, { reads: tx.reads });
      if (!lead.ok) return { ok: false, error: lead.error === "read_failed" ? "persistence_failed" : lead.error };

      // A malformed id cannot name a slot, so there is nothing to delete.
      if (!isWellFormedTreeId(treeId)) return { ok: true };
      const docId = skillNeedDocId(teamId, treeId);
      if ((await tx.getNeed(docId)) !== undefined) tx.deleteNeed(docId);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
