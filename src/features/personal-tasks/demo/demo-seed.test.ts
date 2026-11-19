import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PersonalTask } from "../domain/task";
import {
  DEMO_PRESENTER_UID,
  DEMO_PROJECT_ID,
  DEMO_REFERENCE_DATE,
  DEMO_TASK_ID_PREFIX,
  DEMO_TASK_SPECS,
  demoTaskId,
  isDemoTaskId,
  toDemoPersonalTask,
} from "./demo-dataset";
import { buildDemoPlan, computeDemoDigest, gateDemoRun, type StoredDemoState } from "./demo-plan";
import { runDemoSeed, type DemoStorage, type DemoStorageView } from "./demo-storage";

// The seed tests are synthetic. The "live" project and presenter uid are constants of the tool; no Firebase connection
// is made here. Write-path tests use an in-memory storage port that follows the same contract as the Firestore adapter.

const WRONG_PROJECT = "some-other-project";
const WRONG_UID = "not-the-presenter";

describe("demo dataset", () => {
  it("prepares 24 fictional tasks in the requested distribution: 10 backlog, 6 doing, 3 blocked, 5 done", () => {
    const count = (status: string) => DEMO_TASK_SPECS.filter((spec) => spec.status === status).length;
    expect(DEMO_TASK_SPECS).toHaveLength(24);
    expect({ backlog: count("backlog"), doing: count("doing"), blocked: count("blocked"), done: count("done") }).toEqual({
      backlog: 10,
      doing: 6,
      blocked: 3,
      done: 5,
    });
  });

  it("has unique keys and ids in the reserved demo namespace", () => {
    const keys = DEMO_TASK_SPECS.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const spec of DEMO_TASK_SPECS) {
      expect(demoTaskId(spec.key).startsWith(DEMO_TASK_ID_PREFIX)).toBe(true);
      expect(isDemoTaskId(demoTaskId(spec.key))).toBe(true);
    }
    expect(isDemoTaskId("3f2a9c1e-ordinary-uuid")).toBe(false);
  });

  it("has completion timestamps exactly on done tasks, with a history split at the seven-day window", () => {
    const reference = Date.parse(`${DEMO_REFERENCE_DATE}T00:00:00.000Z`);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    for (const spec of DEMO_TASK_SPECS) {
      expect(spec.completedAt !== null).toBe(spec.status === "done");
    }
    const done = DEMO_TASK_SPECS.filter((spec) => spec.status === "done");
    const recent = done.filter((spec) => reference - Date.parse(spec.completedAt ?? "") < sevenDays);
    const history = done.filter((spec) => reference - Date.parse(spec.completedAt ?? "") >= sevenDays);
    expect(recent).toHaveLength(3);
    expect(history).toHaveLength(2);
  });

  it("includes an overdue active task, tasks with and without descriptions, notes, due dates and priorities", () => {
    const reference = DEMO_REFERENCE_DATE;
    expect(DEMO_TASK_SPECS.some((spec) => spec.status !== "done" && spec.dueDate !== null && spec.dueDate < reference)).toBe(true);
    expect(DEMO_TASK_SPECS.some((spec) => spec.description === null)).toBe(true);
    expect(DEMO_TASK_SPECS.some((spec) => spec.description !== null)).toBe(true);
    expect(DEMO_TASK_SPECS.some((spec) => spec.notes !== null)).toBe(true);
    expect(DEMO_TASK_SPECS.some((spec) => spec.notes === null)).toBe(true);
    expect(new Set(DEMO_TASK_SPECS.map((spec) => spec.priority))).toEqual(new Set(["low", "normal", "high", null]));
  });

  it("keeps every title inside the task limit and every text fictional and free of links, credentials or contact details", () => {
    const text = DEMO_TASK_SPECS.flatMap((spec) => [spec.title, spec.description ?? "", spec.notes ?? ""]).join("\n");
    for (const spec of DEMO_TASK_SPECS) expect(spec.title.length).toBeLessThanOrEqual(160);
    expect(text).not.toMatch(/https?:\/\/|www\.|@|password|passord|token|secret|hemmelig/i);
  });

  it("maps every spec to a valid domain task with the demo id", () => {
    for (const spec of DEMO_TASK_SPECS) {
      const task = toDemoPersonalTask(spec);
      expect(task.id).toBe(demoTaskId(spec.key));
      expect(task.completedAt === null).toBe(spec.status !== "done");
    }
  });
});

describe("plan classification", () => {
  it("plans a create for every record when nothing is stored", () => {
    const plan = buildDemoPlan(new Map());
    expect(plan.counts).toEqual({ create: 24, skip: 0, conflict: 0 });
    expect(plan.project).toBe(DEMO_PROJECT_ID);
    expect(plan.owner).toBe(DEMO_PRESENTER_UID);
    expect(plan.historyCount).toBe(2);
  });

  it("skips records that are already identical, so a second run creates nothing", () => {
    const stored = new Map<string, StoredDemoState>(DEMO_TASK_SPECS.map((spec) => [demoTaskId(spec.key), toDemoPersonalTask(spec)]));
    const plan = buildDemoPlan(stored);
    expect(plan.counts).toEqual({ create: 0, skip: 24, conflict: 0 });
  });

  it("classifies a present but different record as a conflict, never as something to overwrite", () => {
    const first = DEMO_TASK_SPECS[0];
    const drifted: PersonalTask = { ...toDemoPersonalTask(first), title: "Endret av noen andre" };
    const plan = buildDemoPlan(new Map([[demoTaskId(first.key), drifted]]));
    expect(plan.entries.find((entry) => entry.id === demoTaskId(first.key))?.action).toBe("conflict");
    expect(plan.counts.conflict).toBe(1);
  });

  it("classifies an unreadable stored record as a conflict", () => {
    const plan = buildDemoPlan(new Map([[demoTaskId(DEMO_TASK_SPECS[1].key), "unreadable"]]));
    expect(plan.counts.conflict).toBe(1);
  });

  it("ignores stored records outside the demo namespace, which the seed must never touch", () => {
    const plan = buildDemoPlan(new Map());
    expect(plan.entries.every((entry) => isDemoTaskId(entry.id))).toBe(true);
  });

  it("changes the digest when any planned record changes, so the confirmation binds the exact batch", () => {
    const base = buildDemoPlan(new Map()).digest;
    const changed = DEMO_TASK_SPECS.map((spec, index) => (index === 0 ? { ...spec, title: `${spec.title} (ändrad)` } : spec));
    const entries = changed.map((spec) => ({ id: demoTaskId(spec.key), status: spec.status, action: "create" as const }));
    expect(computeDemoDigest(DEMO_PROJECT_ID, DEMO_PRESENTER_UID, changed, entries)).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("write gate", () => {
  const plan = buildDemoPlan(new Map());

  it("refuses a wrong project and a wrong presenter uid, for preflight and write alike", () => {
    expect(gateDemoRun({ mode: "preflight", project: WRONG_PROJECT, owner: DEMO_PRESENTER_UID, confirm: undefined, plan })).toEqual({
      ok: false,
      reason: "argument-mismatch",
    });
    expect(gateDemoRun({ mode: "write", project: DEMO_PROJECT_ID, owner: WRONG_UID, confirm: plan.digest, plan })).toEqual({
      ok: false,
      reason: "argument-mismatch",
    });
  });

  it("refuses a write without the confirmation digest", () => {
    expect(gateDemoRun({ mode: "write", project: DEMO_PROJECT_ID, owner: DEMO_PRESENTER_UID, confirm: undefined, plan })).toEqual({
      ok: false,
      reason: "confirmation-required",
    });
  });

  it("refuses a mismatched confirmation digest", () => {
    expect(gateDemoRun({ mode: "write", project: DEMO_PROJECT_ID, owner: DEMO_PRESENTER_UID, confirm: "0000000000000000", plan })).toEqual({
      ok: false,
      reason: "confirmation-mismatch",
    });
  });

  it("accepts a write only with the exact digest of the same batch", () => {
    expect(gateDemoRun({ mode: "write", project: DEMO_PROJECT_ID, owner: DEMO_PRESENTER_UID, confirm: plan.digest, plan })).toEqual({
      ok: true,
    });
  });

  it("refuses every write while a conflict exists, even with the right digest", () => {
    const conflicted = buildDemoPlan(new Map([[demoTaskId(DEMO_TASK_SPECS[0].key), "unreadable"]]));
    expect(
      gateDemoRun({ mode: "write", project: DEMO_PROJECT_ID, owner: DEMO_PRESENTER_UID, confirm: conflicted.digest, plan: conflicted }),
    ).toEqual({ ok: false, reason: "conflicts-present" });
  });
});

/** In-memory storage port with the same contract as the Firestore adapter. Records every mutation, so tests can prove the
 * seed only ever creates. */
function memoryStorage(initial: Map<string, PersonalTask | "unreadable"> = new Map(), ordinary = 0) {
  const docs = new Map<string, PersonalTask | "unreadable">(initial);
  const calls: string[] = [];
  let reads = 0;
  const storage: DemoStorage = {
    async read() {
      reads += 1;
      return { existing: new Map(docs), ordinaryCount: ordinary };
    },
    async transact<T>(work: (view: DemoStorageView) => T): Promise<T> {
      const pending: PersonalTask[] = [];
      const view: DemoStorageView = {
        existing: new Map(docs),
        ordinaryCount: ordinary,
        create(task) {
          pending.push(task);
        },
      };
      const result = work(view);
      // Commit: create-only. A duplicate id is an error, as Firestore's tx.create would be.
      for (const task of pending) {
        if (docs.has(task.id)) throw new Error("already exists");
        docs.set(task.id, task);
        calls.push(`create:${task.id}`);
      }
      return result;
    },
  };
  return { storage, docs, calls, reads: () => reads };
}

const OPTIONS = { project: DEMO_PROJECT_ID, owner: DEMO_PRESENTER_UID };

describe("seed runner", () => {
  it("refuses a write without a confirmation before reading anything", async () => {
    const { storage, calls, reads } = memoryStorage();
    const report = await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: undefined });
    expect(report).toEqual({ outcome: "refused", reason: "confirmation-required" });
    expect(reads()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("preflight is read-only: it reads, reports the plan, and writes nothing", async () => {
    const { storage, calls, docs } = memoryStorage(new Map(), 3);
    const report = await runDemoSeed(storage, { mode: "preflight", ...OPTIONS, confirm: undefined });
    expect(report.outcome).toBe("preflight");
    if (report.outcome !== "preflight") return;
    expect(report.plan.counts.create).toBe(24);
    expect(report.ordinaryCount).toBe(3);
    expect(report.blocked).toBe(false);
    expect(calls).toHaveLength(0);
    expect(docs.size).toBe(0);
  });

  it("writes exactly the 24 planned creates with the correct digest, and nothing else", async () => {
    const { storage, calls, docs } = memoryStorage();
    const digest = buildDemoPlan(new Map()).digest;
    const report = await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: digest });
    expect(report).toMatchObject({ outcome: "written", created: 24 });
    expect(calls).toHaveLength(24);
    expect(calls.every((call) => call.startsWith("create:kanban-demo-"))).toBe(true);
    expect(docs.size).toBe(24);
  });

  it("a second write does not duplicate records: it reports no changes", async () => {
    const { storage, calls } = memoryStorage();
    const digest = buildDemoPlan(new Map()).digest;
    await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: digest });
    const before = calls.length;
    // The confirmation for a second run comes from a fresh preflight of the current state, as an operator would do.
    const current = await storage.read();
    const again = await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: buildDemoPlan(current.existing, OPTIONS).digest });
    expect(again.outcome).toBe("no_changes");
    expect(calls.length).toBe(before);
  });

  it("a mismatched digest writes nothing", async () => {
    const { storage, calls, docs } = memoryStorage();
    const report = await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: "ffffffffffffffff" });
    expect(report).toEqual({ outcome: "refused", reason: "confirmation-mismatch", plan: expect.anything() });
    expect(calls).toHaveLength(0);
    expect(docs.size).toBe(0);
  });

  it("a conflicting record blocks the whole write, so no partial batch is created", async () => {
    const drifted = { ...toDemoPersonalTask(DEMO_TASK_SPECS[5]), notes: "Endret" };
    const { storage, calls } = memoryStorage(new Map([[drifted.id, drifted]]));
    const digest = buildDemoPlan(new Map([[drifted.id, drifted]])).digest;
    const report = await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: digest });
    expect(report).toMatchObject({ outcome: "refused", reason: "conflicts-present" });
    expect(calls).toHaveLength(0);
  });

  it("ordinary tasks of the owner are never overwritten, counted or changed", async () => {
    const ordinary = { ...toDemoPersonalTask(DEMO_TASK_SPECS[0]), id: "3f2a9c1e-ordinary" };
    const { storage, docs } = memoryStorage(new Map([[ordinary.id, ordinary]]), 1);
    const digest = buildDemoPlan(new Map()).digest;
    await runDemoSeed(storage, { mode: "write", ...OPTIONS, confirm: digest });
    expect(docs.get("3f2a9c1e-ordinary")).toBe(ordinary);
  });

  it("reports a storage failure without claiming the outcome", async () => {
    const storage: DemoStorage = {
      async read() {
        throw new Error("network");
      },
      async transact() {
        throw new Error("network");
      },
    };
    expect(await runDemoSeed(storage, { mode: "preflight", ...OPTIONS, confirm: undefined })).toEqual({ outcome: "storage_failed" });
  });
});

describe("static guards on the seed code", () => {
  const files = ["demo-dataset.ts", "demo-plan.ts", "demo-storage.ts", "demo-cli.ts"].map((name) =>
    readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8"),
  );
  const source = files.join("\n");

  it("never imports or calls Firebase Auth, so no user is created, enabled or changed", () => {
    expect(source).not.toMatch(/getAdminAuth|firebase-admin\/auth|\.updateUser\(|\.createUser\(|\.deleteUser\(/);
  });

  it("never deletes or overwrites a document: the only write path is tx.create through the approved codec", () => {
    const storage = readFileSync(fileURLToPath(new URL("./demo-storage.ts", import.meta.url)), "utf8");
    // Firestore write verbs only: a local Map.set is fine. The seed may create, never set, update or delete.
    expect(storage).not.toMatch(/\btx\.(set|update|delete)\(|\.delete\(|\.update\(/);
    expect(storage).toContain("tx.create(");
    expect(storage).toContain("toFirestoreTask(");
  });

  it("targets only the fixed project and presenter uid", () => {
    expect(DEMO_PROJECT_ID).toBe("devpulse-nve");
    expect(DEMO_PRESENTER_UID).toBe("koEwzQcj5Uc0hnjTgZBLithgkYB3");
    expect(source).not.toMatch(/8yB2bS8Jav69TCfDETON|demo-member-\d/);
  });
});
