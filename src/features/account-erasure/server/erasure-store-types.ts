/**
 * Types and the strict record parser for `accountErasures/{uid}` (TASK-007). Pure: no Firestore import, so the
 * fake store and the Admin SDK store share one contract.
 *
 * Transaction contract: every read that decides a write goes through `ErasureTransaction.get`, which the Admin SDK
 * implements with `tx.get`. A plain document read inside a transaction callback is not a transactional fence read.
 */

import {
  isErasureRecordErrorCode,
  isErasureStatus,
  isErasureStep,
  type ErasureRecordErrorCode,
  type ErasureStatus,
  type ErasureStep,
} from "../domain/erasure-state";

/** The only keys a stored record may contain (AE-SI-5). Nothing else is ever written. */
export const ERASURE_RECORD_KEYS = [
  "status",
  "step",
  "startedAt",
  "updatedAt",
  "completedAt",
  "expireAt",
  "errorCode",
] as const;

export interface ErasureRecord {
  readonly status: ErasureStatus;
  readonly step: ErasureStep;
  readonly startedAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
  readonly expireAt?: Date;
  readonly errorCode?: ErasureRecordErrorCode;
}

/** The state a writer sees when it reads the fence inside its own transaction. */
export type FenceState = "none" | "in_progress" | "auth_deleted" | "completed" | "malformed";

/** Store failures. None of them carries content or identifiers. */
export type StoreError = "malformed" | "store_unavailable" | "not_found" | "invalid_transition";

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

/** Reads and writes inside one Firestore transaction. Reads must precede writes in the same attempt. */
export interface ErasureTransaction {
  /** Raw document data (Dates already converted), or `undefined` when the record does not exist. */
  get(uid: string): Promise<unknown>;
  create(uid: string, data: Record<string, unknown>): void;
  update(uid: string, patch: Record<string, unknown>): void;
}

export interface ErasureStorePort {
  runTransaction<T>(work: (tx: ErasureTransaction) => Promise<T>): Promise<T>;
}

/**
 * Parses raw stored data strictly. Returns `undefined` for anything that is not exactly a valid record: unknown keys,
 * a wrong type, an unknown status or step, or a `completed` record without its terminal fields. A malformed record is
 * never coerced into a valid one.
 */
export function parseErasureRecord(raw: unknown): ErasureRecord | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const data = raw as Record<string, unknown>;

  for (const key of Object.keys(data)) {
    if (!(ERASURE_RECORD_KEYS as readonly string[]).includes(key)) return undefined;
  }

  if (!isErasureStatus(data.status) || !isErasureStep(data.step)) return undefined;
  if (!isValidDate(data.startedAt) || !isValidDate(data.updatedAt)) return undefined;
  if (data.completedAt !== undefined && !isValidDate(data.completedAt)) return undefined;
  if (data.expireAt !== undefined && !isValidDate(data.expireAt)) return undefined;
  if (data.errorCode !== undefined && !isErasureRecordErrorCode(data.errorCode)) return undefined;

  if (data.status === "completed" && (data.completedAt === undefined || data.expireAt === undefined)) {
    return undefined;
  }

  return {
    status: data.status,
    step: data.step,
    startedAt: data.startedAt,
    updatedAt: data.updatedAt,
    ...(data.completedAt !== undefined ? { completedAt: data.completedAt as Date } : {}),
    ...(data.expireAt !== undefined ? { expireAt: data.expireAt as Date } : {}),
    ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
  };
}

/** Builds the persisted document. Only `ERASURE_RECORD_KEYS` can appear, and unset optional fields are omitted. */
export function toStoredErasureRecord(record: ErasureRecord): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    status: record.status,
    step: record.step,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  };
  if (record.completedAt !== undefined) stored.completedAt = record.completedAt;
  if (record.expireAt !== undefined) stored.expireAt = record.expireAt;
  if (record.errorCode !== undefined) stored.errorCode = record.errorCode;
  return stored;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
