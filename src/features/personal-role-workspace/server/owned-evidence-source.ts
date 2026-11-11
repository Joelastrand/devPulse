import "server-only";
import { achievementSchema } from "../domain/achievement";
import type { RecordCollection } from "../domain/record-schema";
import { responsibilitySchema } from "../domain/responsibility";
import { getDefaultPersonalRecordStore, type PersonalRecordStore } from "./personal-record-store";
import { readStoredRecord } from "./record-engine";

/**
 * The one owner-scoped read that feeds conversation evidence selection (SPEC BR-41, BR-60; SECURITY-REVIEW §11.2, Amendment B).
 * It returns the allow-listed source fields of one of the owner's own records, decrypted and validated, and never an id.
 * The owner uid is always the verified uid passed in by the D2 seam; nothing here reads a uid from a request.
 *
 * Failure classes follow SECURITY-REVIEW §11.1. A key failure is `persistence_failed` (classes B and C). A missing, malformed
 * or unauthenticated record is `not_found` (neutral, so a selection cannot probe what is stored). Nothing is written.
 */

export type EvidenceSourceKind = "responsibility" | "achievement";

/** Source fields as the snapshot needs them. Dates are `YYYY-MM-DD` or `null`; the D2 seam maps them to a period. */
export type EvidenceSourceFields =
  | {
      kind: "responsibility";
      title: string;
      description: string | null;
      status: "active" | "completed";
      relationToRole: "within" | "beyond" | "unspecified";
      startDate: string | null;
      endDate: string | null;
    }
  | {
      kind: "achievement";
      title: string;
      description: string;
      outcome: string | null;
      relationToRole: "within" | "beyond" | "unspecified";
      periodStart: string | null;
      periodEnd: string | null;
    };

export type OwnedEvidenceSourceResult = { ok: true; fields: EvidenceSourceFields } | { ok: false; error: "not_found" | "persistence_failed" };

const COLLECTION_OF: Record<EvidenceSourceKind, RecordCollection> = {
  responsibility: "responsibilities",
  achievement: "achievements",
};

/** One selectable record for the owner's picker. It carries the source id, which only the owner ever receives. */
export type SelectableEvidenceItem = { kind: EvidenceSourceKind; id: string; title: string; status: "active" | "completed" | null };

export type SelectableEvidenceList = { items: SelectableEvidenceItem[]; truncated: boolean };

/**
 * Lists the owner's responsibilities and achievements that decrypt and validate, up to each collection's cap (OD-4). Records
 * that are malformed or unavailable are not offered for selection. No link lookup runs here, so the cost is one bounded
 * collection read and one decryption per record. A key failure fails the whole list.
 */
export async function listSelectableEvidence(
  ownerUid: string,
  store: PersonalRecordStore = getDefaultPersonalRecordStore(),
): Promise<{ ok: true; list: SelectableEvidenceList } | { ok: false; error: "persistence_failed" }> {
  try {
    const responsibilities = await store.list(ownerUid, "responsibilities", responsibilitySchema.cap + 1);
    const achievements = await store.list(ownerUid, "achievements", achievementSchema.cap + 1);
    const items: SelectableEvidenceItem[] = [];
    for (const raw of responsibilities.slice(0, responsibilitySchema.cap)) {
      const read = readStoredRecord(raw, responsibilitySchema);
      if (read.kind === "key") return { ok: false, error: "persistence_failed" };
      if (read.kind === "ok") items.push({ kind: "responsibility", id: raw.id, title: read.content.title, status: read.content.status });
    }
    for (const raw of achievements.slice(0, achievementSchema.cap)) {
      const read = readStoredRecord(raw, achievementSchema);
      if (read.kind === "key") return { ok: false, error: "persistence_failed" };
      if (read.kind === "ok") items.push({ kind: "achievement", id: raw.id, title: read.content.title, status: null });
    }
    return {
      ok: true,
      list: {
        items,
        truncated: responsibilities.length > responsibilitySchema.cap || achievements.length > achievementSchema.cap,
      },
    };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

export async function readOwnedEvidenceSource(
  ownerUid: string,
  kind: EvidenceSourceKind,
  id: string,
  store: PersonalRecordStore = getDefaultPersonalRecordStore(),
): Promise<OwnedEvidenceSourceResult> {
  let raw: Awaited<ReturnType<PersonalRecordStore["get"]>>;
  try {
    raw = await store.get(ownerUid, COLLECTION_OF[kind], id);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  if (raw === undefined) return { ok: false, error: "not_found" };

  if (kind === "responsibility") {
    const read = readStoredRecord(raw, responsibilitySchema);
    if (read.kind === "key") return { ok: false, error: "persistence_failed" };
    if (read.kind !== "ok") return { ok: false, error: "not_found" };
    const c = read.content;
    return {
      ok: true,
      fields: {
        kind,
        title: c.title,
        description: c.description,
        status: c.status,
        relationToRole: c.relationToRole,
        startDate: c.startDate,
        endDate: c.endDate,
      },
    };
  }

  const read = readStoredRecord(raw, achievementSchema);
  if (read.kind === "key") return { ok: false, error: "persistence_failed" };
  if (read.kind !== "ok") return { ok: false, error: "not_found" };
  const c = read.content;
  return {
    ok: true,
    fields: {
      kind,
      title: c.title,
      description: c.description,
      outcome: c.outcome,
      relationToRole: c.relationToRole,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
    },
  };
}
