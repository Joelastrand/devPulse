/**
 * One stage within a SkillTree's fixed, linear order (docs/features/
 * team-skill-tree/SPEC.md — "Terminology"). `nodeId` is assigned at tree
 * creation as `node-<zero-based index>` and is permanently stable —
 * `order` always equals that same index. Neither ever changes after
 * creation, including during a later cosmetic correction (SPEC — "Cosmetic
 * tree correction"), which may only replace `label` text.
 */
export interface SkillNode {
  nodeId: string;
  label: string;
  order: number;
}

/**
 * The canonical, persisted `skillTrees/{treeId}` document shape (docs/
 * features/team-skill-tree/SPEC.md — "Data model"). `treeId` itself is not
 * part of this record — it is the Firestore document ID, resolved by the
 * caller, never a stored field.
 *
 * `updatedAt`/`updatedBy` are a paired-optional pair, mirroring
 * `Challenge`'s `resolvedAt`/`resolvedBy` convention
 * (`src/features/challenges/domain/challenge.ts`): a tree that has never
 * been cosmetically corrected has neither field; a tree corrected at least
 * once has both, reflecting only the most recent correction.
 *
 * Deliberately carries no member/user identity field of any kind — a
 * SkillTree is org-wide reference data, never scoped to a team or a person
 * (SPEC — "Purpose"). `createdBy`/`updatedBy` are the *acting admin's* uid,
 * persisted for internal accountability only, never returned by any API
 * response.
 */
export interface SkillTreeRecord {
  name: string;
  nodes: SkillNode[];
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
  updatedBy?: string;
}

/**
 * A SkillTree's `nodes` array must contain at least this many entries
 * (docs/features/team-skill-tree/SPEC.md — "Data model": "2-20 entries").
 */
export const SKILL_TREE_MIN_NODES = 2;

/**
 * A SkillTree's `nodes` array must contain no more than this many entries.
 */
export const SKILL_TREE_MAX_NODES = 20;

/**
 * Fail-closed runtime validator for a candidate `SkillTreeRecord` — the
 * guard every later Firestore-reading task must go through before treating
 * raw document data as a `SkillTreeRecord`, instead of an unchecked cast
 * (`.claude/rules/typescript.md`). Callers are expected to have already
 * mapped a raw Firestore document into this candidate shape (`Timestamp`
 * fields → `Date`, exactly as this codebase's existing Firestore-read call
 * sites already do) — this module has no Firestore/I/O dependency of its
 * own.
 *
 * Returns `false` (never throws) for a missing/non-object candidate, a
 * missing/blank `name`, a missing/wrong-typed `createdAt`/`createdBy`, a
 * `nodes` array outside `[SKILL_TREE_MIN_NODES, SKILL_TREE_MAX_NODES]`, any
 * node whose `nodeId`/`order` don't match its own array position
 * (`node-<index>`, `order === index`) or whose `label` is missing/blank,
 * and a candidate with exactly one of `updatedAt`/`updatedBy` present (the
 * pair must appear together or not at all — a well-formed candidate with
 * *neither* field is equally valid, representing a never-corrected tree).
 */
export function isValidSkillTree(data: unknown): data is SkillTreeRecord {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;

  return (
    isNonEmptyString(record.name) &&
    isValidNodesArray(record.nodes) &&
    isValidDate(record.createdAt) &&
    isNonEmptyString(record.createdBy) &&
    isValidUpdatedPair(record.updatedAt, record.updatedBy)
  );
}

function isValidNodesArray(value: unknown): value is SkillNode[] {
  if (!Array.isArray(value)) {
    return false;
  }

  if (value.length < SKILL_TREE_MIN_NODES || value.length > SKILL_TREE_MAX_NODES) {
    return false;
  }

  return value.every((node, index) => isValidNodeAtPosition(node, index));
}

function isValidNodeAtPosition(node: unknown, index: number): boolean {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return false;
  }

  const record = node as Record<string, unknown>;

  return (
    record.nodeId === `node-${index}` &&
    isNonEmptyString(record.label) &&
    record.order === index
  );
}

/**
 * `updatedAt`/`updatedBy` must appear together or not at all — one present
 * without the other is a malformed record, never partially trusted.
 */
function isValidUpdatedPair(updatedAt: unknown, updatedBy: unknown): boolean {
  if (updatedAt === undefined && updatedBy === undefined) {
    return true;
  }

  return isValidDate(updatedAt) && isNonEmptyString(updatedBy);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
