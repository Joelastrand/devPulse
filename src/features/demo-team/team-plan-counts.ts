import { createHash } from "node:crypto";
import { buildDemoSeedPlan, type DemoSealRecord, type PlannedOperation } from "./plan";

/**
 * Document counts of the team seed, derived from the actual plan (not hard-coded). Test support only: the production
 * seeder never imports it. The seal is a deterministic, plaintext-free stand-in, so counts never depend on encryption.
 */
const deterministicSeal: DemoSealRecord = (plaintext) => ({
  ciphertext: createHash("sha256").update(plaintext).digest("base64"),
  iv: "aXYtZml4dHVyZQ==",
  authTag: "dGFnLWZpeHR1cmU=",
  keyVersion: "v2",
  keyId: "k1",
});

export interface TeamPlanCounts {
  /** Every planned team document. */
  total: number;
  /** Class `U` (upserted) documents. */
  updatable: number;
  /** Class `C` (create-only) documents. */
  createOnly: number;
  /** Planned documents per collection. */
  byCollection: Record<string, number>;
}

export function teamPlanCounts(asOf = new Date("2026-03-16T00:00:00.000Z")): TeamPlanCounts {
  const { operations } = buildDemoSeedPlan({ presenterUid: "count-fixture-uid", asOf, sealRecord: deterministicSeal });
  return summarize(operations);
}

function summarize(operations: readonly PlannedOperation[]): TeamPlanCounts {
  const byCollection: Record<string, number> = {};
  for (const op of operations) byCollection[op.collection] = (byCollection[op.collection] ?? 0) + 1;
  return {
    total: operations.length,
    updatable: operations.filter((op) => op.writeClass === "U").length,
    createOnly: operations.filter((op) => op.writeClass === "C").length,
    byCollection,
  };
}
