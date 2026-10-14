import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";
import { SKILL_OPTIONS_WINDOW } from "../domain/goal-constants";
import type { SkillOptionDto } from "../domain/goal";

const SKILL_TREES_COLLECTION = "skillTrees";

/** Maximum document refs per Firestore `getAll` call (repository precedent: C1 profile batch read). */
export const SKILL_TREE_READ_CHUNK_SIZE = 100;

/** One raw `skillTrees` document with its Firestore id. */
export interface RawCatalogDoc {
  id: string;
  data: unknown;
}

/** A directly read document; `data` is `undefined` when the document does not exist. */
export interface RawTreeRead {
  id: string;
  data: unknown;
}

/**
 * Read-only seam over the `skillTrees` collection (SPEC BR-36, SI-8). Returns raw material, valid or not;
 * validation happens in the functions below. A rejected promise is a read failure, never "missing".
 */
export interface SkillCatalogReader {
  listOrderedByCreatedAt(limit: number): Promise<RawCatalogDoc[]>;
  getById(treeId: string): Promise<RawTreeRead>;
  /** At most {@link SKILL_TREE_READ_CHUNK_SIZE} ids per call. */
  getManyByIds(treeIds: readonly string[]): Promise<RawTreeRead[]>;
}

export function getDefaultSkillCatalogReader(): SkillCatalogReader {
  const trees = () => getFirestoreDb().collection(SKILL_TREES_COLLECTION);
  return {
    async listOrderedByCreatedAt(limit) {
      const snapshot = await trees().orderBy("createdAt", "asc").limit(limit).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async getById(treeId) {
      const snapshot = await trees().doc(treeId).get();
      return { id: snapshot.id, data: snapshot.exists ? snapshot.data() : undefined };
    },
    async getManyByIds(treeIds) {
      const db = getFirestoreDb();
      const snapshots = await db.getAll(...treeIds.map((id) => db.collection(SKILL_TREES_COLLECTION).doc(id)));
      return snapshots.map((snapshot) => ({ id: snapshot.id, data: snapshot.exists ? snapshot.data() : undefined }));
    },
  };
}

/** Typed read failure; the operation layer maps it to `persistence_failed` (BR-41). Carries no detail. */
export interface SkillCatalogFailure {
  ok: false;
}

/** D1-local copy of the C1 candidate mapping (BR-37): `Timestamp → Date`; unexpected shapes are left for the validator to reject. */
function toCandidateSkillTree(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  return { ...record, createdAt: toDateOrUndefined(record.createdAt), updatedAt: toDateOrUndefined(record.updatedAt) };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return value;
}

/** The validated tree name, or `null` when the document is absent or not a valid SkillTree. Never repairs. */
function validTreeName(data: unknown): string | null {
  const candidate = toCandidateSkillTree(data);
  return isValidSkillTree(candidate) ? candidate.name : null;
}

/** Code-point comparison (BR-36c); `<` on strings would compare UTF-16 code units. */
function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function compareOptions(a: SkillOptionDto, b: SkillOptionDto): number {
  return compareCodePoints(a.name, b.name) || compareCodePoints(a.treeId, b.treeId);
}

/**
 * A stored `treeId` only needs to be a non-empty string (BR-13), but Firestore throws on some strings when
 * building a document reference. Those can never name a SkillTree, so they resolve as unavailable without a read.
 */
function isReadableDocumentId(value: string): boolean {
  return (
    value !== "" &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    !/^__.*__$/.test(value) &&
    new TextEncoder().encode(value).length <= 1500
  );
}

export interface SkillOptionsResult {
  ok: true;
  options: SkillOptionDto[];
  truncated: boolean;
}

/**
 * Selector window (BR-36b/c). One query, `limit(501)`: the first 500 raw documents are the candidate window,
 * the 501st is only a truncation probe and is never examined or returned. An invalid window document is
 * dropped and keeps its slot (no refill). Presentation order is applied last and never affects membership.
 * The result says nothing about whether a tree exists (BR-36d).
 */
export async function readSkillOptions(
  reader: SkillCatalogReader = getDefaultSkillCatalogReader(),
): Promise<SkillOptionsResult | SkillCatalogFailure> {
  let raw: RawCatalogDoc[];
  try {
    raw = await reader.listOrderedByCreatedAt(SKILL_OPTIONS_WINDOW + 1);
  } catch {
    return { ok: false };
  }
  const options: SkillOptionDto[] = [];
  for (const { id, data } of raw.slice(0, SKILL_OPTIONS_WINDOW)) {
    const name = validTreeName(data);
    if (name !== null) options.push({ treeId: id, name });
  }
  options.sort(compareOptions);
  return { ok: true, options, truncated: raw.length > SKILL_OPTIONS_WINDOW };
}

export interface SkillTreeLookupResult {
  ok: true;
  /** The validated name, or `null` when the tree is missing or invalid (indistinguishable by design). */
  name: string | null;
}

/**
 * Direct validity read by document id for POST/PATCH (BR-38), independent of the selector window (BR-36d).
 */
export async function readSkillTreeName(
  treeId: string,
  reader: SkillCatalogReader = getDefaultSkillCatalogReader(),
): Promise<SkillTreeLookupResult | SkillCatalogFailure> {
  if (!isReadableDocumentId(treeId)) return { ok: true, name: null };
  try {
    const read = await reader.getById(treeId);
    return { ok: true, name: validTreeName(read.data) };
  } catch {
    return { ok: false };
  }
}

export interface SkillNamesResult {
  ok: true;
  /** One entry per distinct requested id, in first-request order; `null` = unavailable (BR-39). */
  names: Map<string, string | null>;
}

/**
 * Bounded batch name resolution for stored `treeId`s (BR-39): distinct ids, document-id `getAll` in chunks of
 * {@link SKILL_TREE_READ_CHUNK_SIZE}, never one read per goal. Independent of the selector window.
 */
export async function resolveSkillNames(
  treeIds: readonly string[],
  reader: SkillCatalogReader = getDefaultSkillCatalogReader(),
): Promise<SkillNamesResult | SkillCatalogFailure> {
  const distinct = [...new Set(treeIds)];
  const readable = distinct.filter(isReadableDocumentId);
  const chunks: string[][] = [];
  for (let start = 0; start < readable.length; start += SKILL_TREE_READ_CHUNK_SIZE) {
    chunks.push(readable.slice(start, start + SKILL_TREE_READ_CHUNK_SIZE));
  }
  let resolved: Map<string, string | null>;
  try {
    const reads = (await Promise.all(chunks.map((chunk) => reader.getManyByIds(chunk)))).flat();
    resolved = new Map(reads.map((read) => [read.id, validTreeName(read.data)]));
  } catch {
    return { ok: false };
  }
  return { ok: true, names: new Map(distinct.map((treeId) => [treeId, resolved.get(treeId) ?? null])) };
}
