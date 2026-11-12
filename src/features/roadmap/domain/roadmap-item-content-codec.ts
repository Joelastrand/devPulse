import "server-only";
import { blindIndex } from "../../../lib/encryption/blind-index";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of a team's roadmap plan in `roadmapItems/{teamId}__{treeId}`.
 *
 * Sealed business content: `targetNodeId` (the stage the team aims for), `priority`, `status`, `startDate`, `targetDate`,
 * `completedAt` and `ownerRef` (the member responsible). They state what the team plans and who owns it, so they are not
 * readable from storage. Dates are sealed as ISO strings and restored to `Date` on open.
 *
 * Plaintext, each with a reason: `teamId` and `treeId` (the team listing key and the identity the document id is built from),
 * `createdAt`, `updatedAt`, `archivedAt` (technical timestamps), `createdBy`, `updatedBy`, `archivedBy` (accountability and
 * account erasure sweeps, which match on these uids), and `ownerRefIndex`.
 *
 * `ownerRefIndex` is a keyed blind index of the owner handle, scoped to the team. Erasure finds the plans a member owns by
 * this index, so the handle itself is never stored in the clear and is never queryable without the index key.
 *
 * The envelope is bound to `roadmap-item:<teamId>:<treeId>`. Every change rewrites the whole content from the record that was
 * read in the same transaction, so no partial sealed update exists. Fail-closed: a document without a valid envelope, or whose
 * envelope fails authentication, opens as `null`, and the domain validator refuses it.
 */

export const ROADMAP_CONTENT_FIELD = "content";
export const ROADMAP_OWNER_INDEX_FIELD = "ownerRefIndex";
const SEALED_KEYS = ["targetNodeId", "priority", "status", "startDate", "targetDate", "completedAt", "ownerRef"] as const;
const SEALED_DATE_KEYS = ["completedAt"] as const;

export type SealRoadmapContent = (plaintext: string, context: string) => RecordEnvelope;
export type OpenRoadmapContent = (envelope: RecordEnvelope, context: string) => string;

export function roadmapContentContext(teamId: string, treeId: string): string {
  return `roadmap-item:${teamId}:${treeId}`;
}

/** The keyed lookup of a team's owner handle. Synchronous; throws when the index key is unavailable. */
export function roadmapOwnerIndex(teamId: string, ownerRef: string): string {
  return blindIndex("roadmap-owner-ref", `${teamId}\u0000${ownerRef}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Persisted shape of one plan: metadata plaintext, the business content sealed, and the owner index when there is an owner. */
export function toPersistedRoadmapItem(record: Record<string, unknown>, seal: SealRoadmapContent = encryptRecord): Record<string, unknown> {
  const { teamId, treeId } = record;
  // A plan without its team and tree cannot be sealed: its envelope context would be undefined.
  if (typeof teamId !== "string" || typeof treeId !== "string") throw new Error("roadmap_item_without_tree");
  const content: Record<string, unknown> = {};
  for (const key of SEALED_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    content[key] = value instanceof Date ? value.toISOString() : value;
  }
  const metadata = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== ROADMAP_OWNER_INDEX_FIELD && !(SEALED_KEYS as readonly string[]).includes(key)),
  );
  const persisted: Record<string, unknown> = {
    ...metadata,
    [ROADMAP_CONTENT_FIELD]: seal(JSON.stringify(content), roadmapContentContext(teamId, treeId)),
  };
  if (typeof record.ownerRef === "string") persisted[ROADMAP_OWNER_INDEX_FIELD] = roadmapOwnerIndex(teamId, record.ownerRef);
  return persisted;
}

/**
 * Opens a stored plan back to its domain shape. `undefined` for an absent document; `null` when the content cannot be opened,
 * when a plaintext business field is present, or when the owner index does not match the sealed owner.
 */
export function openRoadmapItemDocument(data: unknown, open: OpenRoadmapContent = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [ROADMAP_CONTENT_FIELD]: sealed, [ROADMAP_OWNER_INDEX_FIELD]: ownerIndex, ...metadata } = data;
  if (SEALED_KEYS.some((key) => Object.hasOwn(metadata, key))) return null;
  if (typeof metadata.teamId !== "string" || typeof metadata.treeId !== "string") return null;
  const envelope = readRecordEnvelope(sealed);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, roadmapContentContext(metadata.teamId, metadata.treeId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  const restored: Record<string, unknown> = { ...metadata };
  for (const key of SEALED_KEYS) {
    if (parsed[key] === undefined) continue;
    restored[key] = (SEALED_DATE_KEYS as readonly string[]).includes(key) && typeof parsed[key] === "string" ? new Date(parsed[key] as string) : parsed[key];
  }
  if (typeof restored.ownerRef === "string") {
    if (ownerIndex !== roadmapOwnerIndex(metadata.teamId, restored.ownerRef)) return null;
  } else if (ownerIndex !== undefined) {
    return null;
  }
  // Shape only: the domain validator decides whether the restored values are acceptable.
  return restored;
}

/**
 * The persisted form of a stored plan with its owner removed (account erasure, A-5). The plan is read and re-sealed as a
 * whole: the owner leaves the sealed content and the owner index, and every other field is kept. `null` when the stored
 * plan cannot be opened, or when its owner is not `memberRef` (the caller then leaves the document untouched).
 */
export function detachedRoadmapItem(
  data: unknown,
  memberRef: string,
  open: OpenRoadmapContent = decryptRecord,
  seal: SealRoadmapContent = encryptRecord,
): Record<string, unknown> | null {
  const opened = openRoadmapItemDocument(data, open);
  if (!isPlainRecord(opened) || opened.ownerRef !== memberRef) return null;
  const { ownerRef: _owner, ...rest } = opened;
  void _owner;
  return toPersistedRoadmapItem(rest, seal);
}
