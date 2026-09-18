import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidSkillTree } from "../domain/skill-tree";
import { skillProgressDocId, type SkillProgressRecord } from "../domain/skill-progress";

const SKILL_TREES_COLLECTION = "skillTrees";
const TEAMS_COLLECTION = "teams";
const SKILL_PROGRESS_COLLECTION = "skillProgress";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface StartTeamSkillTrackingDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read-only seam for the referenced `skillTrees/{treeId}` document,
 * satisfied in production by a direct Firestore document read and by an
 * in-memory fake in tests. This operation only needs to confirm the tree
 * exists and is well-formed — it never reads or derives node identity from
 * it (that only matters to `updateTeamSkillProgress`).
 */
export interface SkillTreeReader {
  get(treeId: string): Promise<StartTeamSkillTrackingDocSnapshot>;
}

function getDefaultSkillTreeReader(): SkillTreeReader {
  return {
    async get(treeId) {
      const snapshot = await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSkillTree` expects. */
function toCandidateSkillTree(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    createdAt: toDateOrUndefined(record.createdAt),
    updatedAt: toDateOrUndefined(record.updatedAt),
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is (not a Date) so `isValidSkillTree`'s `isValidDate` check
  // fails closed on it, rather than silently coercing an unexpected shape.
  return value;
}

/**
 * The read-only seam for the owning team's fresh `status`, satisfied in
 * production by a Firestore document read and by an in-memory fake in
 * tests. Mirrors `submitChallenge`/`createSurvey`'s `TeamStatusReader`
 * exactly.
 */
export interface TeamStatusReader {
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultTeamStatusReader(): TeamStatusReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

/**
 * The read/write seam for the deterministic `skillProgress/{teamId}__
 * {treeId}` document, satisfied in production by direct Firestore document
 * calls (keyed by `skillProgressDocId`) and by an in-memory fake in tests.
 */
export interface SkillProgressStore {
  get(docId: string): Promise<StartTeamSkillTrackingDocSnapshot>;
  set(docId: string, record: SkillProgressRecord): Promise<void>;
}

function getDefaultSkillProgressStore(): SkillProgressStore {
  return {
    async get(docId) {
      const snapshot = await getFirestoreDb().collection(SKILL_PROGRESS_COLLECTION).doc(docId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async set(docId, record) {
      await getFirestoreDb().collection(SKILL_PROGRESS_COLLECTION).doc(docId).set(record);
    },
  };
}

export type StartTeamSkillTrackingResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "tree_not_found" | "team_not_found" | "team_disabled" | "persistence_failed";
    };

export interface StartTeamSkillTrackingDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  treeReader?: SkillTreeReader;
  teamStatusReader?: TeamStatusReader;
  progress?: SkillProgressStore;
}

/**
 * Starts tracking an existing SkillTree for a team (docs/features/
 * team-skill-tree/SPEC.md — BR-8 through BR-10, BR-33). Only an app admin
 * may call this successfully. `teamId`/`treeId` are always the caller's
 * trusted server/route scope — this function accepts no body-shaped field
 * capable of overriding either.
 *
 * Order, exactly as SPEC specifies: `requireAppAdmin` → fetch + runtime-
 * validate `skillTrees/{treeId}` (`tree_not_found` on missing/malformed) →
 * fetch `teams/{teamId}.status` fresh, validated via `isValidTeamStatus`
 * (reused unchanged from `src/features/teams/domain/team.ts`) — missing/
 * malformed → `team_not_found`; `"disabled"` → `team_disabled` (the one
 * skill-tracking write operation gated on team status, BR-33 — a
 * creation-shaped action, mirroring `submitChallenge`/`createSurvey`'s
 * identical disabled-team rejection); `"active"` → proceed → fetch
 * `skillProgress/{teamId}__{treeId}` (deterministic id via
 * `skillProgressDocId`); already exists → `{ok: true}` unchanged, no write
 * (BR-9, idempotent) → otherwise `.set()` a fresh record with
 * `currentNodeId: null` and server-derived `updatedAt`/`updatedBy`.
 */
export async function startTeamSkillTracking(
  idToken: string,
  teamId: string,
  treeId: string,
  deps: StartTeamSkillTrackingDeps = {},
): Promise<StartTeamSkillTrackingResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const treeReader = deps.treeReader ?? getDefaultSkillTreeReader();
  let treeSnapshot: StartTeamSkillTrackingDocSnapshot;
  try {
    treeSnapshot = await treeReader.get(treeId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const treeCandidate = toCandidateSkillTree(treeSnapshot.exists ? treeSnapshot.data() : undefined);
  if (!isValidSkillTree(treeCandidate)) {
    return { ok: false, error: "tree_not_found" };
  }

  const teamStatusReader = deps.teamStatusReader ?? getDefaultTeamStatusReader();
  let rawTeamStatus: unknown;
  try {
    rawTeamStatus = await teamStatusReader.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!isValidTeamStatus(rawTeamStatus)) {
    // Covers both "no such team" (Firestore returns `undefined`) and a
    // malformed/unrecognized status — fail closed, never assuming "active"
    // for an un-interpretable read.
    return { ok: false, error: "team_not_found" };
  }
  if (rawTeamStatus === "disabled") {
    return { ok: false, error: "team_disabled" };
  }

  const docId = skillProgressDocId(teamId, treeId);
  const progress = deps.progress ?? getDefaultSkillProgressStore();

  let progressSnapshot: StartTeamSkillTrackingDocSnapshot;
  try {
    progressSnapshot = await progress.get(docId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (progressSnapshot.exists) {
    return { ok: true };
  }

  const record: SkillProgressRecord = {
    teamId,
    treeId,
    currentNodeId: null,
    updatedAt: deps.now ?? new Date(),
    updatedBy: admin.identity.uid,
  };

  try {
    await progress.set(docId, record);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}
