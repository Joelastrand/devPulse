import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { toFirestoreTask, toPersonalTask, StoredTaskError } from "./task-store";
import type { PersonalTask } from "../domain/task";

// Synthetic fixtures. The owner uids and task text are fictional. No Firestore connection is used: the codec is pure.
const OWNER = "owner-uid-a";
const OTHER = "owner-uid-b";
const SECRET_TITLE = "Synthetic secret title 4711";
const SECRET_NOTES = "Synthetic private note 9182";
const CREATED = new Date("2026-11-10T09:00:00.000Z");
const UPDATED = new Date("2026-11-11T09:00:00.000Z");
const COMPLETED = new Date("2026-11-12T09:00:00.000Z");

function task(overrides: Partial<PersonalTask> = {}): PersonalTask {
  return {
    id: "task-1",
    title: SECRET_TITLE,
    description: null,
    notes: SECRET_NOTES,
    status: "backlog",
    priority: "high",
    dueDate: "2026-11-20",
    position: 1024,
    createdAt: CREATED,
    updatedAt: UPDATED,
    completedAt: null,
    ...overrides,
  };
}

describe("persisted task shape", () => {
  it("stores no plaintext business content: title, notes, status, priority, due date and position are sealed", () => {
    const stored = toFirestoreTask(OWNER, task());
    const serialised = JSON.stringify(stored);
    expect(serialised).not.toContain(SECRET_TITLE);
    expect(serialised).not.toContain(SECRET_NOTES);
    expect(serialised).not.toContain('"backlog"');
    expect(serialised).not.toContain('"2026-11-20"');
    expect(Object.keys(stored).sort()).toEqual(["content", "createdAt", "updatedAt"]);
  });

  it("writes the v2 envelope with a fresh IV and no key material", () => {
    const stored = toFirestoreTask(OWNER, task()) as { content: Record<string, unknown> };
    expect(stored.content).toMatchObject({ keyVersion: "v2", keyId: "k1" });
    expect(Object.keys(stored.content).sort()).toEqual(["authTag", "ciphertext", "iv", "keyId", "keyVersion"]);
  });

  it("round-trips a task through the codec, including a completed task with its completion time", () => {
    const done = task({ status: "done", completedAt: COMPLETED, priority: null, dueDate: null, notes: null });
    const restored = toPersonalTask(OWNER, done.id, toFirestoreTask(OWNER, done) as Record<string, unknown>);
    expect(restored).toEqual(done);
  });

  it("omits completedAt entirely for an active task", () => {
    const stored = toFirestoreTask(OWNER, task());
    expect("completedAt" in stored).toBe(false);
  });
});

describe("binding and tamper checks", () => {
  it("refuses a record moved to another owner (the AAD binds the owner uid)", () => {
    const stored = toFirestoreTask(OWNER, task()) as Record<string, unknown>;
    expect(() => toPersonalTask(OTHER, "task-1", stored)).toThrow(StoredTaskError);
  });

  it("refuses a record moved to another task id (the AAD binds the task id)", () => {
    const stored = toFirestoreTask(OWNER, task()) as Record<string, unknown>;
    expect(() => toPersonalTask(OWNER, "task-2", stored)).toThrow(StoredTaskError);
  });

  it("refuses a completion time that disagrees with the sealed status", () => {
    const active = toFirestoreTask(OWNER, task()) as Record<string, unknown>;
    expect(() => toPersonalTask(OWNER, "task-1", { ...active, completedAt: Timestamp.fromDate(COMPLETED) })).toThrow(
      StoredTaskError,
    );
  });

  it("refuses a value that is not a v2 envelope", () => {
    expect(() => toPersonalTask(OWNER, "task-1", { createdAt: Timestamp.fromDate(CREATED), updatedAt: Timestamp.fromDate(UPDATED), content: "plaintext" })).toThrow(
      StoredTaskError,
    );
  });
});
