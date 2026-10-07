import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";
import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";
import {
  isValidSkillNeed,
  parseSkillNeedInput,
  skillNeedDocId,
  type SkillNeedRecord,
} from "../domain/skill-need";
import { requireGenuineLead } from "./genuine-team-membership";
import type { SkillNeedView } from "./list-skill-needs";
import { toCandidateSkillTree } from "./skill-need-catalog";
import { getDefaultSkillNeedWriteStore, type SkillNeedWriteStore } from "./skill-needs-store";

export type UpsertSkillNeedError =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "skill_unavailable"
  | "persistence_failed";

export type UpsertSkillNeedResult =
  | { ok: true; need: SkillNeedView }
  | { ok: false; error: UpsertSkillNeedError };

export interface UpsertSkillNeedDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillNeedWriteStore;
  now?: () => Date;
}

type TxOutcome = { ok: true; need: SkillNeedView } | { ok: false; error: UpsertSkillNeedError };

/**
 * Create or replace the need for (team, tree) (SPEC BR-5). The one lead-only
 * capability: a genuine lead of an `active` team — app-admin status is never
 * consulted. One transaction re-reads everything it decides on, in BR-5 order:
 * team → membership → lead → active → body → tree; the body is parsed only after
 * authorization so callers learn nothing about validation before being allowed.
 * `teamId`/`treeId` come from the route. `createdAt` survives a replace of a valid
 * document; an absent or corrupt document is (re)written wholesale with a fresh one.
 * The stored shape is exactly the six approved keys, no actor.
 */
export async function upsertSkillNeed(
  idToken: string,
  teamId: string,
  treeId: string,
  body: unknown,
  deps: UpsertSkillNeedDeps = {},
): Promise<UpsertSkillNeedResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };
  const identity = verified.identity;

  const store = deps.store ?? getDefaultSkillNeedWriteStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction(async (tx): Promise<TxOutcome> => {
      const lead = await requireGenuineLead(identity, teamId, { reads: tx.reads });
      if (!lead.ok) return { ok: false, error: lead.error === "read_failed" ? "persistence_failed" : lead.error };

      const input = parseSkillNeedInput(body);
      if (!input.ok) return input;
      // Malformed ids can never name a valid tree (and `/` would break the slot path).
      if (!isWellFormedTreeId(treeId)) return { ok: false, error: "skill_unavailable" };

      const docId = skillNeedDocId(teamId, treeId);
      const tree = toCandidateSkillTree(await tx.getSkillTree(treeId));
      if (!isValidSkillTree(tree)) return { ok: false, error: "skill_unavailable" };
      const existing = await tx.getNeed(docId);

      const createdAt =
        isValidSkillNeed(existing, { docId }) && existing.teamId === teamId ? existing.createdAt : now;
      const record: SkillNeedRecord = {
        teamId,
        treeId,
        requiredLevel: input.requiredLevel,
        requiredCoverage: input.requiredCoverage,
        createdAt,
        updatedAt: now,
      };
      tx.putNeed(docId, record);

      return {
        ok: true,
        need: {
          treeId,
          areaName: tree.name,
          areaAvailable: true,
          requiredLevel: record.requiredLevel,
          requiredCoverage: record.requiredCoverage,
        },
      };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
