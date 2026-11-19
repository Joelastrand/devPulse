import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { decryptRecord, encryptRecord, readRecordEnvelope, RecordEnvelopeError } from "../../../lib/encryption/record-envelope";
import { runFencedTransaction } from "../../auth/server/erasure-write-fence";
import {
  DEFAULT_COMPLETED_VISIBILITY,
  isCompletedVisibility,
  isTaskId,
  parseStoredTaskContent,
  TASK_LIMITS,
  type PersonalTask,
} from "../domain/task";
import type { PersonalTaskStore } from "./task-store-types";

/**
 * Firestore layout (docs/PERSONAL-TASKS.md, docs/DATA-MODEL.md §5):
 * - `userDevelopment/{uid}/personalTasks/{taskId}`: plaintext lifecycle `createdAt`, `updatedAt`, `completedAt` (present
 *   only while the task is completed); the business fields (title, description, notes, status, priority, due date,
 *   position) are one v2 envelope in `content`, bound to `personal-task:<uid>:<taskId>`.
 * - `userDevelopment/{uid}/taskSettings/board`: one encrypted envelope with the completed-task preference, bound to
 *   `personal-task-settings:<uid>`.
 *
 * Every path is built from the verified owner uid passed in by the operation layer. There is no query across owners.
 */
const USER_DEVELOPMENT = "userDevelopment";
const TASKS = "personalTasks";
const SETTINGS = "taskSettings";
const BOARD_SETTINGS_DOC = "board";
const CONTENT_FIELD = "content";

/** A stored task that cannot be opened or validated. Content-free message; the operation maps it to persistence_failed. */
export class StoredTaskError extends Error {
  constructor() {
    super("stored task is unreadable");
    this.name = "StoredTaskError";
  }
}

function assertOwner(uid: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new StoredTaskError();
}

/** The owner's personal task collection. Shared with the demo seed so there is one path builder. */
export function personalTasksCollection(ownerUid: string) {
  assertOwner(ownerUid);
  return getFirestoreDb().collection(USER_DEVELOPMENT).doc(ownerUid).collection(TASKS);
}

function taskRef(ownerUid: string, taskId: string) {
  if (!isTaskId(taskId)) throw new StoredTaskError();
  return personalTasksCollection(ownerUid).doc(taskId);
}

function taskContext(ownerUid: string, taskId: string): string {
  return `personal-task:${ownerUid}:${taskId}`;
}

function settingsContext(ownerUid: string): string {
  return `personal-task-settings:${ownerUid}`;
}

function openContent(context: string, value: unknown): unknown {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) throw new StoredTaskError();
  try {
    return JSON.parse(decryptRecord(envelope, context));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && (error.code === "key_unavailable" || error.code === "unknown_key_id")) {
      throw error;
    }
    throw new StoredTaskError();
  }
}

function timestampToDate(value: unknown): Date {
  if (!(value instanceof Timestamp)) throw new StoredTaskError();
  return value.toDate();
}

/** Builds the persisted document for one task. Optional lifecycle fields are omitted, never null. */
export function toFirestoreTask(ownerUid: string, task: PersonalTask): Record<string, unknown> {
  const content = {
    title: task.title,
    description: task.description,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    position: task.position,
  };
  return {
    createdAt: Timestamp.fromDate(task.createdAt),
    updatedAt: Timestamp.fromDate(task.updatedAt),
    ...(task.completedAt !== null ? { completedAt: Timestamp.fromDate(task.completedAt) } : {}),
    [CONTENT_FIELD]: encryptRecord(JSON.stringify(content), taskContext(ownerUid, task.id)),
  };
}

/**
 * Opens and validates one stored task. Refuses (throws) anything that is not exactly the shape the writer produces,
 * including a `completedAt` that disagrees with the status. A wrong key surfaces as a configuration error, not as data.
 */
export function toPersonalTask(ownerUid: string, taskId: string, data: Record<string, unknown>): PersonalTask {
  const parsed = parseStoredTaskContent(openContent(taskContext(ownerUid, taskId), data[CONTENT_FIELD]));
  if (parsed === null) throw new StoredTaskError();
  const createdAt = timestampToDate(data.createdAt);
  const updatedAt = timestampToDate(data.updatedAt);
  const completedAt = data.completedAt === undefined ? null : timestampToDate(data.completedAt);
  if ((parsed.status === "done") !== (completedAt !== null)) throw new StoredTaskError();
  return { id: taskId, ...parsed, createdAt, updatedAt, completedAt };
}

function settingsRef(ownerUid: string) {
  assertOwner(ownerUid);
  return getFirestoreDb().collection(USER_DEVELOPMENT).doc(ownerUid).collection(SETTINGS).doc(BOARD_SETTINGS_DOC);
}

/** The Admin SDK implementation of {@link PersonalTaskStore}. Server-only. */
export function getDefaultPersonalTaskStore(): PersonalTaskStore {
  return {
    async list(ownerUid) {
      const snapshot = await personalTasksCollection(ownerUid).limit(TASK_LIMITS.maxTasks + 1).get();
      if (snapshot.size > TASK_LIMITS.maxTasks) throw new StoredTaskError();
      return snapshot.docs.map((doc) => toPersonalTask(ownerUid, doc.id, doc.data()));
    },

    async transact(ownerUid, work) {
      const collection = personalTasksCollection(ownerUid);
      // The fence read comes first in the same transaction; a refused write performs no write (AE-SI-3).
      return runFencedTransaction(getFirestoreDb(), ownerUid, async (tx) => {
        const snapshot = await tx.get(collection.limit(TASK_LIMITS.maxTasks + 1));
        if (snapshot.size > TASK_LIMITS.maxTasks) throw new StoredTaskError();
        const board = snapshot.docs.map((doc) => toPersonalTask(ownerUid, doc.id, doc.data()));
        const plan = work(board);
        if (!plan.ok) return { ok: false, error: plan.error };
        for (const task of plan.writes) {
          tx.set(taskRef(ownerUid, task.id), toFirestoreTask(ownerUid, task));
        }
        for (const taskId of plan.deletes) {
          tx.delete(taskRef(ownerUid, taskId));
        }
        return { ok: true, result: plan.result };
      });
    },

    async getPreferences(ownerUid) {
      const snapshot = await settingsRef(ownerUid).get();
      if (!snapshot.exists) return { completedVisibility: DEFAULT_COMPLETED_VISIBILITY };
      const content = openContent(settingsContext(ownerUid), (snapshot.data() ?? {})[CONTENT_FIELD]);
      const visibility = typeof content === "object" && content !== null ? (content as Record<string, unknown>).completedVisibility : undefined;
      if (!isCompletedVisibility(visibility)) throw new StoredTaskError();
      return { completedVisibility: visibility };
    },

    async setPreferences(ownerUid, preferences) {
      const ref = settingsRef(ownerUid);
      await runFencedTransaction(getFirestoreDb(), ownerUid, async (tx) => {
        tx.set(ref, {
          [CONTENT_FIELD]: encryptRecord(
            JSON.stringify({ completedVisibility: preferences.completedVisibility }),
            settingsContext(ownerUid),
          ),
        });
      });
    },
  };
}
