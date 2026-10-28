import type { RawSkillTreeReader } from "./skill-tree-seam-types";
import type { RawRoleData } from "./role-store-types";

/** The target written by a selection: exactly the stored keys (AD-2). */
export interface RoleTargetWrite {
  roleId: string;
  updatedAt: Date;
}

/**
 * What a selection transaction can do (PG-7). Reads must all happen before the single write; a read after the write
 * is rejected by Firestore and by the in-memory fake.
 */
export interface RoleSelectionScope {
  /** Transaction-bound raw role read. Absence is `undefined`; a failed read rejects. */
  readRole(roleId: string): Promise<RawRoleData | undefined>;
  /** Transaction-bound SkillTree reader for the referenced `treeId`s only. */
  trees: RawSkillTreeReader;
  /** The single write of the transaction, replacing any existing or malformed target (last write wins). */
  writeTarget(target: RoleTargetWrite): void;
}

/**
 * Persistence contract for the owner's target role (TASK-010, TASK-011; AD-2). The subject is always the verified uid
 * supplied by the caller; no operation accepts any other uid (BR-10). No history is kept.
 */
export interface RoleTargetStore {
  /** Raw stored data with Timestamps mapped to `Date`, or `undefined` when absent. Never validated here. */
  get(subjectUid: string): Promise<RawRoleData | undefined>;
  /** Hard-deletes the target document. Deleting an absent document succeeds. No history is kept. */
  delete(subjectUid: string): Promise<void>;
  /**
   * Runs the selection work in one Firestore transaction (PG-7). `work` may be re-run by the transaction and must
   * have no side effects outside the scope.
   */
  runSelection<T>(subjectUid: string, work: (scope: RoleSelectionScope) => Promise<T>): Promise<T>;
}

/** A uid the store refuses to build a path from. Carries no uid and no content. */
export class InvalidRoleTargetKeyError extends Error {
  constructor() {
    super("invalid role target key");
    this.name = "InvalidRoleTargetKeyError";
  }
}

/** A path segment must be non-empty, slash-free and not a path-reserved or Firestore-reserved id. */
export function isAddressableSubjectUid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    !/^__.*__$/.test(value)
  );
}

export function assertSubjectUidSegment(value: unknown): asserts value is string {
  if (!isAddressableSubjectUid(value)) {
    throw new InvalidRoleTargetKeyError();
  }
}
