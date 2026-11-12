import "server-only";
import { ENVELOPE_MAX_BYTES } from "../domain/constants";
import type { RecordCollection, RecordSchema } from "../domain/record-schema";
import { checkStoredKey, decodeSourceRecord, encodeSourceRecord, readEnvelope, sourceRecordContext, type SourceEnvelope } from "./source-record-codec";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import type { PersonalRecordStore, RawRecord, RecordTransaction } from "./personal-record-store";

/**
 * Generic engine for the two personal record types (SECURITY.md PR-SI-5, SECURITY-REVIEW §11.1). It is the one place that
 * applies the failure classes, so responsibilities and achievements cannot diverge.
 *
 * Rules enforced here:
 * - A key failure (`key_unavailable`, `key_mismatch`) never becomes a `malformed` or `unavailable` item. A list fails as a whole.
 * - Only a structurally invalid record is `malformed`, and only that is delete-only for the owner (`{ id }`).
 * - An authenticated-decryption failure is `unavailable`: no id, no content, no delete action.
 * - Create checks the key against every existing record before writing. Update decrypts the current record first and never
 *   writes from partial data. Delete works by path and never decrypts.
 */

export type RecordError =
  | "invalid_input"
  | "not_found"
  | "record_limit"
  | "invalid_reference"
  | "record_unavailable"
  | "payload_too_large"
  | "persistence_failed"
  | "erasure_in_progress";

/** Links must reference records the owner already has (BR-60). Returns `false` for any unknown or foreign reference. */
export type LinkChecker<C> = (ownerUid: string, content: C) => Promise<boolean>;

export interface RecordEngineDeps<C> {
  store: PersonalRecordStore;
  checkLinks: LinkChecker<C>;
  clock: () => Date;
}

export type RecordListItem<DTO> =
  | { kind: "record"; dto: DTO }
  | { kind: "malformed"; id: string }
  | { kind: "unavailable" };

export interface RecordListResult<DTO> {
  items: RecordListItem<DTO>[];
  truncated: boolean;
}

/** Classification of one stored document. Internal: never returned to a caller in this shape. */
type StoredRead<C> =
  | { kind: "ok"; content: C; createdAt: Date; updatedAt: Date; envelope: SourceEnvelope }
  | { kind: "malformed" }
  | { kind: "unavailable" }
  | { kind: "key"; error: "key_unavailable" | "key_mismatch" };

const TIMESTAMP_KEYS = ["createdAt", "updatedAt"] as const;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** Classifies one raw document in the fixed order: envelope shape, key, authenticated decryption, plaintext, schema. */
export function readStoredRecord<C>(raw: RawRecord, schema: RecordSchema<C>, ownerUid: string): StoredRead<C> {
  const { data } = raw;
  const envelope = readEnvelope(data);
  if (envelope === null) return { kind: "malformed" };

  const expectedKeys = [...Object.keys(envelope), ...schema.plainKeys, ...TIMESTAMP_KEYS];
  if (Object.keys(data).some((key) => !expectedKeys.includes(key))) return { kind: "malformed" };
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;
  if (!(createdAt instanceof Date) || !(updatedAt instanceof Date)) return { kind: "malformed" };

  const decoded = decodeSourceRecord(envelope, sourceRecordContext(ownerUid, schema.collection, raw.id));
  if (!decoded.ok) {
    if (decoded.error === "key_unavailable" || decoded.error === "key_mismatch") return { kind: "key", error: decoded.error };
    if (decoded.error === "payload_unauthenticated") return { kind: "unavailable" };
    return { kind: "malformed" };
  }

  const json = decoded.json;
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { kind: "malformed" };
  const payload = json as Record<string, unknown>;
  if (!exactKeys(payload, schema.payloadKeys)) return { kind: "malformed" };

  const plain = Object.fromEntries(schema.plainKeys.map((key) => [key, data[key]]));
  const parsed = schema.fromInput({ ...payload, ...plain });
  if (!parsed.ok) return { kind: "malformed" };
  return { kind: "ok", content: parsed.value, createdAt, updatedAt, envelope };
}

export async function listRecords<C, DTO>(
  deps: RecordEngineDeps<C>,
  ownerUid: string,
  schema: RecordSchema<C>,
  toDto: (id: string, content: C, createdAt: Date, updatedAt: Date) => DTO,
): Promise<{ ok: true; result: RecordListResult<DTO> } | { ok: false; error: "persistence_failed" }> {
  let raw: RawRecord[];
  try {
    raw = await deps.store.list(ownerUid, schema.collection, schema.cap + 1);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  const truncated = raw.length > schema.cap;
  const items: RecordListItem<DTO>[] = [];
  for (const record of raw.slice(0, schema.cap)) {
    const read = readStoredRecord(record, schema, ownerUid);
    if (read.kind === "key") return { ok: false, error: "persistence_failed" };
    if (read.kind === "malformed") items.push({ kind: "malformed", id: record.id });
    else if (read.kind === "unavailable") items.push({ kind: "unavailable" });
    else items.push({ kind: "record", dto: toDto(record.id, read.content, read.createdAt, read.updatedAt) });
  }
  return { ok: true, result: { items, truncated } };
}

export async function createRecord<C, DTO>(
  deps: RecordEngineDeps<C>,
  ownerUid: string,
  schema: RecordSchema<C>,
  raw: Record<string, unknown>,
  toDto: (id: string, content: C, createdAt: Date, updatedAt: Date) => DTO,
): Promise<{ ok: true; dto: DTO } | { ok: false; error: RecordError }> {
  const parsed = schema.fromInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid_input" };

  if (!(await deps.checkLinks(ownerUid, parsed.value))) return { ok: false, error: "invalid_reference" };

  let existing: RawRecord[];
  try {
    existing = await deps.store.list(ownerUid, schema.collection, schema.cap);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  if (existing.length >= schema.cap) return { ok: false, error: "record_limit" };
  for (const record of existing) {
    const envelope = readEnvelope(record.data);
    if (envelope === null) continue;
    if (checkStoredKey(envelope) !== "ok") return { ok: false, error: "persistence_failed" };
  }

  const { payload, plain } = schema.split(parsed.value);
  const now = deps.clock();
  try {
    type Created = { ok: true; id: string } | { ok: false; error: RecordError };
    const created = await deps.store.runFenced<Created>(ownerUid, async (tx) => {
      // The id is reserved before sealing: the record is bound to its own document by AAD (PR-SI-5).
      const newId = tx.newId(schema.collection);
      const encoded = encodeSourceRecord(payload, sourceRecordContext(ownerUid, schema.collection, newId));
      if (!encoded.ok) return { ok: false, error: "persistence_failed" };
      const document = { ...encoded.envelope, ...plain };
      if (envelopeBytes(document) > ENVELOPE_MAX_BYTES) return { ok: false, error: "payload_too_large" };
      tx.set(schema.collection, newId, { ...document, createdAt: now, updatedAt: now });
      return { ok: true, id: newId };
    });
    if (!created.ok) return created;
    return { ok: true, dto: toDto(created.id, parsed.value, now, now) };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

export async function updateRecord<C, DTO>(
  deps: RecordEngineDeps<C>,
  ownerUid: string,
  schema: RecordSchema<C>,
  id: string,
  patch: Record<string, unknown>,
  toDto: (id: string, content: C, createdAt: Date, updatedAt: Date) => DTO,
): Promise<{ ok: true; dto: DTO } | { ok: false; error: RecordError }> {
  type Outcome = { ok: true; dto: DTO } | { ok: false; error: RecordError };
  const now = deps.clock();
  try {
    return await deps.store.runFenced<Outcome>(ownerUid, async (tx) => updateInTransaction(deps, ownerUid, schema, tx, id, patch, now, toDto));
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

async function updateInTransaction<C, DTO>(
  deps: RecordEngineDeps<C>,
  ownerUid: string,
  schema: RecordSchema<C>,
  tx: RecordTransaction,
  id: string,
  patch: Record<string, unknown>,
  now: Date,
  toDto: (id: string, content: C, createdAt: Date, updatedAt: Date) => DTO,
): Promise<{ ok: true; dto: DTO } | { ok: false; error: RecordError }> {
  const current = await tx.get(schema.collection, id);
  if (current === undefined) return { ok: false, error: "not_found" };

  const read = readStoredRecord({ id, data: current }, schema, ownerUid);
  if (read.kind === "key") return { ok: false, error: "persistence_failed" };
  if (read.kind !== "ok") return { ok: false, error: "record_unavailable" };

  const existing = schema.split(read.content);
  const parsed = schema.fromInput({ ...existing.payload, ...existing.plain, ...patch });
  if (!parsed.ok) return { ok: false, error: "invalid_input" };
  if (!(await deps.checkLinks(ownerUid, parsed.value))) return { ok: false, error: "invalid_reference" };

  const { payload, plain } = schema.split(parsed.value);
  const encoded = encodeSourceRecord(payload, sourceRecordContext(ownerUid, schema.collection, id));
  if (!encoded.ok) return { ok: false, error: "persistence_failed" };
  const document = { ...encoded.envelope, ...plain };
  if (envelopeBytes(document) > ENVELOPE_MAX_BYTES) return { ok: false, error: "payload_too_large" };

  tx.set(schema.collection, id, { ...document, createdAt: read.createdAt, updatedAt: now });
  return { ok: true, dto: toDto(id, parsed.value, read.createdAt, now) };
}

/** Deletes one record by path. Never decrypts, so a key failure cannot block or alter a deletion (PR-SI-5). */
export async function deleteRecord(
  store: PersonalRecordStore,
  ownerUid: string,
  collection: RecordCollection,
  id: string,
): Promise<{ ok: true } | { ok: false; error: RecordError }> {
  try {
    return await store.runFenced<{ ok: true } | { ok: false; error: RecordError }>(ownerUid, async (tx) => {
      const current = await tx.get(collection, id);
      if (current === undefined) return { ok: false, error: "not_found" };
      tx.delete(collection, id);
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/** Length in UTF-8 bytes of the stored document, as JSON (an upper bound for the Firestore field encoding). */
function envelopeBytes(document: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(document)).length;
}
