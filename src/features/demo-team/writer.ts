import { assertAllowedEntry, assertManifestValid, type ManifestEntry, type PlannedOperation } from "./plan";

/**
 * Guarded single-batch writer (docs/features/demo-team/SPEC.md — "Atomicity",
 * "Explicit Forum exclusion", "Cleanup policy"). It only talks to an injected
 * batch seam; the real Admin SDK adapter is wired later. The seam has no
 * removal and no query method, so neither can be expressed through this module.
 */

/** Firestore allows 500 operations per batch; the seed asserts a stricter bound. */
export const MAX_BATCH_OPERATIONS = 400;

/** Minimal write-only batch seam. Paths are exact `{collection}/{docId}`. */
export interface DemoWriteBatch {
  /** Fails the whole batch at commit if the document already exists. */
  create(path: string, data: unknown): void;
  set(path: string, data: unknown): void;
  commit(): Promise<void>;
}

export type DemoWriteErrorCategory = "invalid_operations" | "too_many_operations" | "write_failed";

/** Carries a category only — never raw exception text or document data. */
export class DemoWriteError extends Error {
  readonly category: DemoWriteErrorCategory;

  constructor(category: DemoWriteErrorCategory) {
    super(`Demo seed write failed: ${category}`);
    this.name = "DemoWriteError";
    this.category = category;
  }
}

/** Every operation must be an allow-listed, manifest-owned path with matching collection/class; no duplicates. A subset of the manifest is fine (compatible `C` records are skipped upstream). */
function validateOperations(operations: readonly PlannedOperation[], manifest: readonly ManifestEntry[]): void {
  try {
    assertManifestValid(manifest);
    const byPath = new Map(manifest.map((m) => [m.path, m]));
    const seen = new Set<string>();

    for (const op of operations) {
      assertAllowedEntry(op);
      const owned = byPath.get(op.path);
      if (owned === undefined || owned.collection !== op.collection || owned.writeClass !== op.writeClass) {
        throw new Error("not in manifest");
      }
      if (seen.has(op.path)) {
        throw new Error("duplicate");
      }
      seen.add(op.path);
    }
  } catch {
    throw new DemoWriteError("invalid_operations");
  }
}

/**
 * Validates the entire operation list, then writes it through one batch:
 * class `C` → `create`, class `U` → `set`, a single `commit`. Any validation
 * failure throws before `createBatch` is even called. A failing commit leaves
 * nothing written (batch atomicity) and is reported as `write_failed`.
 */
export async function writeDemoOperations(input: {
  operations: readonly PlannedOperation[];
  manifest: readonly ManifestEntry[];
  createBatch: () => DemoWriteBatch;
}): Promise<{ written: number }> {
  const { operations, manifest, createBatch } = input;

  if (operations.length === 0) {
    throw new DemoWriteError("invalid_operations");
  }
  if (operations.length > MAX_BATCH_OPERATIONS) {
    throw new DemoWriteError("too_many_operations");
  }
  validateOperations(operations, manifest);

  try {
    const batch = createBatch();
    for (const op of operations) {
      if (op.writeClass === "C") {
        batch.create(op.path, op.data);
      } else {
        batch.set(op.path, op.data);
      }
    }
    await batch.commit();
  } catch {
    throw new DemoWriteError("write_failed");
  }

  return { written: operations.length };
}
