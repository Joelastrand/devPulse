import { createHash } from "node:crypto";
import type { PersonalTask, TaskStatus } from "../domain/task";
import {
  DEMO_PRESENTER_UID,
  DEMO_PROJECT_ID,
  DEMO_TASK_SPECS,
  demoTaskId,
  toDemoPersonalTask,
  type DemoTaskSpec,
} from "./demo-dataset";

/**
 * Pure planning and gating for the demo-task seed (no Firestore, no encryption). The plan classifies every planned demo
 * record against what is stored: `create` (absent), `skip` (already identical), or `conflict` (present but different, or
 * unreadable). The seed never updates or deletes. A conflict blocks every write.
 */
export type DemoAction = "create" | "skip" | "conflict";

export interface DemoPlanEntry {
  id: string;
  status: TaskStatus;
  action: DemoAction;
}

export interface DemoPlan {
  project: string;
  owner: string;
  entries: DemoPlanEntry[];
  counts: { create: number; skip: number; conflict: number };
  statusCounts: Record<TaskStatus, number>;
  /** Completed tasks that fall outside the seven-day board window at the reference date (history only). */
  historyCount: number;
  /** Deterministic over the project, owner and each planned record. A write must quote it exactly. */
  digest: string;
}

export type StoredDemoState = PersonalTask | "unreadable";

function sameTime(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** Field-for-field equality of a stored record with its planned form. Any difference is a conflict, never an overwrite. */
export function isSameDemoRecord(stored: PersonalTask, planned: PersonalTask): boolean {
  return (
    stored.title === planned.title &&
    stored.description === planned.description &&
    stored.notes === planned.notes &&
    stored.status === planned.status &&
    stored.priority === planned.priority &&
    stored.dueDate === planned.dueDate &&
    stored.position === planned.position &&
    sameTime(stored.createdAt, planned.createdAt) &&
    sameTime(stored.updatedAt, planned.updatedAt) &&
    sameTime(stored.completedAt, planned.completedAt)
  );
}

function classify(spec: DemoTaskSpec, stored: StoredDemoState | undefined): DemoAction {
  if (stored === undefined) return "create";
  if (stored === "unreadable") return "conflict";
  return isSameDemoRecord(stored, toDemoPersonalTask(spec)) ? "skip" : "conflict";
}

/** The digest over the exact batch: project, owner, and each planned record's id, action and full spec in order. */
export function computeDemoDigest(project: string, owner: string, specs: readonly DemoTaskSpec[], entries: readonly DemoPlanEntry[]): string {
  const material = {
    project,
    owner,
    records: specs.map((spec, index) => ({ spec, action: entries[index].action })),
  };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex").slice(0, 16);
}

/**
 * Builds the plan from the stored demo records (keyed by demo task id; only demo ids are passed in). `project` and `owner`
 * are recorded in the plan and in its digest; the gate rejects any other values.
 */
export function buildDemoPlan(
  stored: ReadonlyMap<string, StoredDemoState>,
  options: { project?: string; owner?: string; specs?: readonly DemoTaskSpec[] } = {},
): DemoPlan {
  const project = options.project ?? DEMO_PROJECT_ID;
  const owner = options.owner ?? DEMO_PRESENTER_UID;
  const specs = options.specs ?? DEMO_TASK_SPECS;
  const entries: DemoPlanEntry[] = specs.map((spec) => ({
    id: demoTaskId(spec.key),
    status: spec.status,
    action: classify(spec, stored.get(demoTaskId(spec.key))),
  }));
  const counts = { create: 0, skip: 0, conflict: 0 };
  for (const entry of entries) counts[entry.action] += 1;
  const statusCounts: Record<TaskStatus, number> = { backlog: 0, doing: 0, blocked: 0, done: 0 };
  for (const spec of specs) statusCounts[spec.status] += 1;
  const historyCount = specs.filter((spec) => spec.status === "done" && isOutsideBoardWindow(spec)).length;
  return {
    project,
    owner,
    entries,
    counts,
    statusCounts,
    historyCount,
    digest: computeDemoDigest(project, owner, specs, entries),
  };
}

const REFERENCE_MS = Date.parse("2026-11-18T00:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isOutsideBoardWindow(spec: DemoTaskSpec): boolean {
  if (spec.completedAt === null) return false;
  return REFERENCE_MS - Date.parse(spec.completedAt) >= SEVEN_DAYS_MS;
}

export type DemoGateReason =
  | "argument-mismatch"
  | "conflicts-present"
  | "confirmation-required"
  | "confirmation-mismatch";

/**
 * The write gate. Checked before any write, and before any read when no confirmation was given:
 * - the project and the presenter uid must be the fixed values (a wrong project or uid is refused);
 * - any conflict refuses the run;
 * - a write needs `--confirm` with exactly the plan's digest; a missing or different digest is refused.
 * A preflight never writes, so it passes the gate whenever there are no conflicts and the target is correct.
 */
export function gateDemoRun(input: {
  mode: "preflight" | "write";
  project: string;
  owner: string;
  confirm: string | undefined;
  plan: DemoPlan;
}): { ok: true } | { ok: false; reason: DemoGateReason } {
  if (input.project !== DEMO_PROJECT_ID || input.owner !== DEMO_PRESENTER_UID) return { ok: false, reason: "argument-mismatch" };
  if (input.plan.project !== DEMO_PROJECT_ID || input.plan.owner !== DEMO_PRESENTER_UID) {
    return { ok: false, reason: "argument-mismatch" };
  }
  if (input.plan.counts.conflict > 0) return { ok: false, reason: "conflicts-present" };
  if (input.mode === "preflight") return { ok: true };
  if (input.confirm === undefined) return { ok: false, reason: "confirmation-required" };
  if (input.confirm !== input.plan.digest) return { ok: false, reason: "confirmation-mismatch" };
  return { ok: true };
}
