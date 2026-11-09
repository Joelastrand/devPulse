import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  COMPLETED_RECORD_TTL_MS,
} from "../domain/erasure-constants";
import {
  isAllowedStatusTransition,
  isAllowedStepTransition,
  type ErasureRecordErrorCode,
  type ErasureStep,
} from "../domain/erasure-state";
import {
  ERASURE_RECORD_KEYS,
  parseErasureRecord,
  toStoredErasureRecord,
  type ErasureRecord,
  type ErasureStorePort,
  type ErasureTransaction,
  type FenceState,
  type StoreResult,
} from "./erasure-store-types";

export const ERASURE_COLLECTION = "accountErasures";

/**
 * Reads the fence record through the transaction's own `get`. Writers call this inside the transaction that performs
 * their write (SPEC BR-4(b)). A malformed record is reported as `malformed`, not as `none`. A read failure is an
 * error, so the caller fails closed.
 */
export async function readErasureForFence(
  tx: ErasureTransaction,
  uid: string,
): Promise<StoreResult<FenceState>> {
  const record = await readRecordInTransaction(tx, uid);
  if (!record.ok) {
    return record.error === "malformed" ? { ok: true, value: "malformed" } : record;
  }
  return { ok: true, value: record.value === undefined ? "none" : record.value.status };
}

/** Starts the erasure record at `forum`, or returns the existing record. Never creates a second one. */
export async function createErasureInTransaction(
  port: ErasureStorePort,
  uid: string,
  now: Date,
): Promise<StoreResult<{ created: boolean; record: ErasureRecord }>> {
  return runOperation(port, async (tx): Promise<StoreResult<{ created: boolean; record: ErasureRecord }>> => {
    const current = await readRecordInTransaction(tx, uid);
    if (!current.ok) return current;
    if (current.value !== undefined) return { ok: true, value: { created: false, record: current.value } };

    const record: ErasureRecord = { status: "in_progress", step: "forum", startedAt: now, updatedAt: now };
    tx.create(uid, toStoredErasureRecord(record));
    return { ok: true, value: { created: true, record } };
  });
}

/** Moves the step forward while the record is `in_progress`. Never backward (BR-15). */
export async function advanceErasureStep(
  port: ErasureStorePort,
  uid: string,
  toStep: ErasureStep,
  now: Date,
): Promise<StoreResult<void>> {
  return runOperation(port, async (tx) => {
    const current = await readExistingRecord(tx, uid);
    if (!current.ok) return current;
    // `final_sweep` is reached only from `auth_deleted` (SPEC transitions). `in_progress` advances one step at a time;
    // a move into `final_sweep` while `in_progress` would strand the record, since `auth_deleted` is set only from
    // `auth_delete`.
    const statusAllowsStep =
      (current.value.status === "in_progress" && toStep !== "final_sweep") ||
      (current.value.status === "auth_deleted" && toStep === "final_sweep");
    if (!statusAllowsStep) return { ok: false, error: "invalid_transition" };
    if (!isAllowedStepTransition(current.value.step, toStep)) return { ok: false, error: "invalid_transition" };

    tx.update(uid, { step: toStep, updatedAt: now });
    return { ok: true, value: undefined };
  });
}

/** `in_progress` at `auth_delete` becomes `auth_deleted` (SPEC transitions). */
export async function markErasureAuthDeleted(
  port: ErasureStorePort,
  uid: string,
  now: Date,
): Promise<StoreResult<void>> {
  return runOperation(port, async (tx) => {
    const current = await readExistingRecord(tx, uid);
    if (!current.ok) return current;
    // Require the exact source status. The transition table also allows `auth_deleted -> auth_deleted`, which must
    // not restamp a record that has already passed Auth deletion.
    if (current.value.status !== "in_progress" || current.value.step !== "auth_delete") {
      return { ok: false, error: "invalid_transition" };
    }
    if (!isAllowedStatusTransition(current.value.status, "auth_deleted")) {
      return { ok: false, error: "invalid_transition" };
    }

    tx.update(uid, { status: "auth_deleted", updatedAt: now });
    return { ok: true, value: undefined };
  });
}

/**
 * Terminal write: `auth_deleted` at `final_sweep` becomes `completed`, with `completedAt` and `expireAt` (BR-17).
 * `expireAt` is `now` plus the completed-record TTL.
 */
export async function completeErasure(
  port: ErasureStorePort,
  uid: string,
  now: Date,
): Promise<StoreResult<void>> {
  return runOperation(port, async (tx) => {
    const current = await readExistingRecord(tx, uid);
    if (!current.ok) return current;
    // Require the exact source status: the table allows `completed -> completed`, which must never re-stamp
    // `completedAt` or move `expireAt`.
    if (current.value.status !== "auth_deleted" || current.value.step !== "final_sweep") {
      return { ok: false, error: "invalid_transition" };
    }
    if (!isAllowedStatusTransition(current.value.status, "completed")) {
      return { ok: false, error: "invalid_transition" };
    }

    tx.update(uid, {
      status: "completed",
      updatedAt: now,
      completedAt: now,
      expireAt: new Date(now.getTime() + COMPLETED_RECORD_TTL_MS),
    });
    return { ok: true, value: undefined };
  });
}

/** The full record, or `not_found`. Used by the runner to resume from the stored step. */
export async function readErasureRecord(port: ErasureStorePort, uid: string): Promise<StoreResult<ErasureRecord>> {
  return runOperation(port, (tx) => readExistingRecord(tx, uid));
}

/** Records the last failure code only. The code comes from the closed enum; no message is stored. */
export async function recordErasureError(
  port: ErasureStorePort,
  uid: string,
  code: ErasureRecordErrorCode,
  now: Date,
): Promise<StoreResult<void>> {
  return runOperation(port, async (tx) => {
    const current = await readExistingRecord(tx, uid);
    if (!current.ok) return current;
    if (current.value.status === "completed") return { ok: false, error: "invalid_transition" };

    tx.update(uid, { errorCode: code, updatedAt: now });
    return { ok: true, value: undefined };
  });
}

/** Admin SDK adapter. Reads use `tx.get`; writes use `tx.create` and `tx.update`. Timestamps become Dates. */
export function getDefaultErasureStorePort(): ErasureStorePort {
  return {
    runTransaction(work) {
      const db = getFirestoreDb();
      const ref = (uid: string) => db.collection(ERASURE_COLLECTION).doc(uid);
      return db.runTransaction((tx) =>
        work({
          async get(uid) {
            const snapshot = await tx.get(ref(uid));
            return snapshot.exists ? toRawErasureData(snapshot.data()) : undefined;
          },
          create(uid, data) {
            tx.create(ref(uid), data);
          },
          update(uid, patch) {
            tx.update(ref(uid), patch);
          },
        }),
      );
    },
  };
}

/** Runs one store operation. Any thrown error (Firestore unavailable, a rejected write) is `store_unavailable`. */
async function runOperation<T>(
  port: ErasureStorePort,
  work: (tx: ErasureTransaction) => Promise<StoreResult<T>>,
): Promise<StoreResult<T>> {
  try {
    return await port.runTransaction(work);
  } catch {
    return { ok: false, error: "store_unavailable" };
  }
}

async function readRecordInTransaction(
  tx: ErasureTransaction,
  uid: string,
): Promise<StoreResult<ErasureRecord | undefined>> {
  let raw: unknown;
  try {
    raw = await tx.get(uid);
  } catch {
    return { ok: false, error: "store_unavailable" };
  }
  if (raw === undefined) return { ok: true, value: undefined };

  const parsed = parseErasureRecord(raw);
  if (parsed === undefined) return { ok: false, error: "malformed" };
  return { ok: true, value: parsed };
}

async function readExistingRecord(tx: ErasureTransaction, uid: string): Promise<StoreResult<ErasureRecord>> {
  const record = await readRecordInTransaction(tx, uid);
  if (!record.ok) return record;
  if (record.value === undefined) return { ok: false, error: "not_found" };
  return { ok: true, value: record.value };
}

/**
 * Converts Firestore Timestamp fields to Dates. Anything else is left as it is, so the strict parser sees the real
 * shape and an unexpected key still makes the record malformed.
 */
export function toRawErasureData(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const record = data as Record<string, unknown>;
  const converted: Record<string, unknown> = { ...record };
  for (const key of ERASURE_RECORD_KEYS) {
    const value = record[key];
    if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
      converted[key] = (value as { toDate(): Date }).toDate();
    }
  }
  return converted;
}
