import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { runFencedTransaction } from "../../auth/server/erasure-write-fence";
import { isTaskId, TASK_LIMITS, type PersonalTask } from "../domain/task";
import { personalTasksCollection, toFirestoreTask, toPersonalTask } from "../server/task-store";
import { DEMO_TASK_SPECS, demoTaskId, isDemoTaskId, toDemoPersonalTask } from "./demo-dataset";
import { buildDemoPlan, gateDemoRun, type DemoGateReason, type DemoPlan, type StoredDemoState } from "./demo-plan";

/**
 * Storage port for the demo seed and its runner (server-only). The Firestore adapter reads and writes exactly the
 * presenter's personal task collection (the same path builder as ordinary tasks), through the same codec. The runner only
 * ever calls `create`. Nothing here touches Firebase Auth, memberships, consent or any other collection.
 */
export interface DemoStorageView {
  /** Stored state of each demo id that exists in the presenter's collection. Absent ids are not in the map. */
  readonly existing: ReadonlyMap<string, StoredDemoState>;
  /** Count of the presenter's ordinary (non-demo) tasks. Their content is never read or changed by the seed. */
  readonly ordinaryCount: number;
  /** Creates one task, failing if the document already exists (no overwrite). */
  create(task: PersonalTask): void;
}

export interface DemoStorage {
  read(): Promise<Omit<DemoStorageView, "create">>;
  transact<T>(work: (view: DemoStorageView) => T): Promise<T>;
}

/** Maps the presenter's stored demo documents into the plan's input. Unreadable documents become `unreadable`. */
function demoStateFrom(owner: string, docs: readonly { id: string; data: () => Record<string, unknown> | undefined }[]) {
  const existing = new Map<string, StoredDemoState>();
  let ordinaryCount = 0;
  for (const doc of docs) {
    if (!isDemoTaskId(doc.id)) {
      ordinaryCount += 1;
      continue;
    }
    try {
      existing.set(doc.id, toPersonalTask(owner, doc.id, doc.data() ?? {}));
    } catch {
      existing.set(doc.id, "unreadable");
    }
  }
  return { existing, ordinaryCount };
}

export function getDemoPresenterStorage(owner: string): DemoStorage {
  if (!isTaskId(owner)) throw new Error("invalid owner");
  return {
    async read() {
      const snapshot = await personalTasksCollection(owner).limit(TASK_LIMITS.maxTasks + 1).get();
      if (snapshot.size > TASK_LIMITS.maxTasks) throw new Error("board over limit");
      return demoStateFrom(owner, snapshot.docs);
    },

    async transact(work) {
      return runFencedTransaction(getFirestoreDb(), owner, async (tx) => {
        const refs = DEMO_TASK_SPECS.map((spec) => personalTasksCollection(owner).doc(demoTaskId(spec.key)));
        const demoSnapshots = await tx.getAll(...refs);
        const ordinary = await tx.get(personalTasksCollection(owner).limit(TASK_LIMITS.maxTasks + 1));
        if (ordinary.size > TASK_LIMITS.maxTasks) throw new Error("board over limit");
        const demoDocs = demoSnapshots.map((snapshot) => ({ id: snapshot.id, data: () => snapshot.data(), exists: snapshot.exists }));
        const present = demoDocs.filter((doc) => doc.exists);
        const state = demoStateFrom(owner, present);
        return work({
          existing: state.existing,
          ordinaryCount: ordinary.docs.filter((doc) => !isDemoTaskId(doc.id)).length,
          create(task) {
            tx.create(personalTasksCollection(owner).doc(task.id), toFirestoreTask(owner, task));
          },
        });
      });
    },
  };
}

export type DemoRunMode = "preflight" | "write";

export interface DemoRunOptions {
  mode: DemoRunMode;
  project: string;
  owner: string;
  confirm: string | undefined;
}

export type DemoRunReport =
  | { outcome: "refused"; reason: DemoGateReason | "argument-mismatch"; plan?: DemoPlan }
  | { outcome: "preflight"; plan: DemoPlan; ordinaryCount: number; blocked: boolean }
  | { outcome: "written"; plan: DemoPlan; created: number }
  | { outcome: "no_changes"; plan: DemoPlan }
  | { outcome: "post_write_verification_failed"; plan: DemoPlan }
  | { outcome: "storage_failed" };

/**
 * Runs the seed in preflight (read-only) or write mode. Write mode: refused without a confirmation before any read;
 * otherwise the plan is rebuilt inside the transaction, checked against the confirmed digest, and only missing records
 * are created. After the commit the store is read again and every planned record must now be `skip`.
 */
export async function runDemoSeed(storage: DemoStorage, options: DemoRunOptions): Promise<DemoRunReport> {
  if (options.mode === "write" && options.confirm === undefined) {
    return { outcome: "refused", reason: "confirmation-required" };
  }
  try {
    if (options.mode === "preflight") {
      const view = await storage.read();
      const plan = buildDemoPlan(view.existing, { project: options.project, owner: options.owner });
      const gate = gateDemoRun({ ...options, mode: "preflight", plan });
      if (!gate.ok) return { outcome: "refused", reason: gate.reason, plan };
      return { outcome: "preflight", plan, ordinaryCount: view.ordinaryCount, blocked: plan.counts.conflict > 0 };
    }

    const result = await storage.transact((view) => {
      const plan = buildDemoPlan(view.existing, { project: options.project, owner: options.owner });
      const gate = gateDemoRun({ ...options, mode: "write", plan });
      if (!gate.ok) return { refused: gate.reason as DemoGateReason | "argument-mismatch", plan } as const;
      if (plan.counts.create === 0) return { refused: undefined, plan, created: 0 } as const;
      for (const entry of plan.entries) {
        if (entry.action !== "create") continue;
        const spec = DEMO_TASK_SPECS.find((item) => demoTaskId(item.key) === entry.id);
        if (!spec) throw new Error("planned record without a spec");
        view.create(toDemoPersonalTask(spec));
      }
      return { refused: undefined, plan, created: plan.counts.create } as const;
    });

    if (result.refused !== undefined) return { outcome: "refused", reason: result.refused, plan: result.plan };
    if (result.created === 0) return { outcome: "no_changes", plan: result.plan };

    // Post-write verification: every planned record must now match exactly (skip). Anything else is reported.
    const after = await storage.read();
    const verified = buildDemoPlan(after.existing, { project: options.project, owner: options.owner });
    // The digest changes once the creates are applied, so verification checks the resulting state, not the digest.
    if (verified.counts.skip !== DEMO_TASK_SPECS.length || verified.counts.conflict > 0) {
      return { outcome: "post_write_verification_failed", plan: verified };
    }
    return { outcome: "written", plan: result.plan, created: result.created };
  } catch {
    return { outcome: "storage_failed" };
  }
}
