import "server-only";
import {
  listSelectableEvidence,
  readOwnedEvidenceSource,
  type EvidenceSourceFields,
  type EvidenceSourceKind,
  type OwnedEvidenceSourceResult,
  type SelectableEvidenceList,
} from "../../personal-role-workspace/server/owned-evidence-source";
import type { ConversationErrorCode } from "../domain/errors";
import type { EvidenceSelection } from "../domain/evidence-selection";
import { parseSharedEvidenceSnapshot, type SharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";

/**
 * The only D2 module that reads personal source records (SPEC AD-2, BR-41, BR-60; SECURITY.md PR-SI-2 and Amendment B).
 * It is the single approved importer of the personal evidence source module, listed file-exact in the D2 and personal
 * guards. It returns allow-listed source fields and ids only for the owner's own selection list. It never takes a uid from a
 * request: the owner uid is the verified uid passed in by the operation.
 *
 * Each snapshot is built in the decrypted JSON form and validated by the D2 snapshot parser (allow-list, canonical text,
 * limits), so no source field reaches a stored snapshot unchecked. A source that fails validation is `invalid_evidence_selection`.
 */

export interface OwnedEvidenceReader {
  read(ownerUid: string, kind: EvidenceSourceKind, id: string): Promise<OwnedEvidenceSourceResult>;
  list(ownerUid: string): Promise<{ ok: true; list: SelectableEvidenceList } | { ok: false; error: "persistence_failed" }>;
}

export function productionOwnedEvidenceReader(): OwnedEvidenceReader {
  return {
    read: (ownerUid, kind, id) => readOwnedEvidenceSource(ownerUid, kind, id),
    list: (ownerUid) => listSelectableEvidence(ownerUid),
  };
}

export interface OwnedEvidenceSnapshotDeps {
  reader: OwnedEvidenceReader;
  /** Server time at capture. Injected so tests can fix it. */
  clock: () => Date;
}

export type OwnedEvidenceSnapshotsError = Extract<ConversationErrorCode, "invalid_evidence_selection" | "persistence_failed">;

export type OwnedEvidenceSnapshotsResult =
  | { ok: true; snapshots: SharedEvidenceSnapshot[] }
  | { ok: false; error: OwnedEvidenceSnapshotsError };

/** Maps source fields to the snapshot's JSON form (BR-43): allow-listed keys only, `capturedAt` as a canonical ISO string. */
function snapshotJson(fields: EvidenceSourceFields, capturedAt: string): Record<string, unknown> {
  if (fields.kind === "responsibility") {
    return {
      kind: "responsibility",
      title: fields.title,
      description: fields.description,
      status: fields.status,
      relationToRole: fields.relationToRole,
      period: { start: fields.startDate, end: fields.endDate },
      capturedAt,
    };
  }
  return {
    kind: "achievement",
    title: fields.title,
    description: fields.description,
    outcome: fields.outcome,
    period: { start: fields.periodStart, end: fields.periodEnd },
    relationToRole: fields.relationToRole,
    capturedAt,
  };
}

/**
 * Resolves the owner's selection into snapshots, responsibilities first, then achievements. The whole selection is
 * all-or-nothing: a foreign, unknown or invalid source rejects the call with `invalid_evidence_selection`, and a read or
 * key failure rejects with `persistence_failed`. Nothing is written by this function.
 */
export async function readOwnedEvidenceSnapshots(
  ownerUid: string,
  selection: EvidenceSelection,
  deps: OwnedEvidenceSnapshotDeps,
): Promise<OwnedEvidenceSnapshotsResult> {
  const capturedAt = deps.clock().toISOString();
  const kinded: Array<{ kind: EvidenceSourceKind; id: string }> = [
    ...selection.responsibilityIds.map((id) => ({ kind: "responsibility" as const, id })),
    ...selection.achievementIds.map((id) => ({ kind: "achievement" as const, id })),
  ];

  const snapshots: SharedEvidenceSnapshot[] = [];
  for (const { kind, id } of kinded) {
    let read: OwnedEvidenceSourceResult;
    try {
      read = await deps.reader.read(ownerUid, kind, id);
    } catch {
      return { ok: false, error: "persistence_failed" };
    }
    if (!read.ok) {
      return { ok: false, error: read.error === "persistence_failed" ? "persistence_failed" : "invalid_evidence_selection" };
    }
    const parsed = parseSharedEvidenceSnapshot(snapshotJson(read.fields, capturedAt));
    if (!parsed.ok) return { ok: false, error: "invalid_evidence_selection" };
    snapshots.push(parsed.value);
  }
  return { ok: true, snapshots };
}
