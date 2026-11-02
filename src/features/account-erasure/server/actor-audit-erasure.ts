import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";
import { ACTOR_AUDIT_TARGETS } from "./inventory";

/**
 * The `actor_audit` erasure step for the catalogue, survey and challenge actor fields (TASK-023; SPEC BR-12, D5, AE-SI-7,
 * AE-SI-8, A-1, A-2, A-3, A-7). Each actor field that holds the erased uid is set to `null`. The record and every other field
 * are kept, including challenge content, which is anonymous and preserved.
 *
 * The targets are an exact, closed list. One document per batch: the first target with a document still naming the uid is
 * handled in a transaction that re-reads it, checks that the field equals the uid, and clears only that field. A document
 * whose field no longer matches fails closed as `verification_failed`. `done` only when no target has a document left.
 * No replacement value is derived from the uid (AE-SI-7): the field becomes `null`.
 */

export type ActorAuditTarget = (typeof ACTOR_AUDIT_TARGETS)[number];

export interface ActorAuditTransaction {
  getDocument(target: ActorAuditTarget, documentId: string): Promise<Record<string, unknown> | undefined>;
  /** Sets only `target.field` to null. Nothing else in the document changes. */
  clearActorField(target: ActorAuditTarget, documentId: string): void;
}

export interface ActorAuditErasurePort {
  runTransaction<T>(work: (tx: ActorAuditTransaction) => Promise<T>): Promise<T>;
  /** The id of one document in `target.collection` whose `target.field` equals the uid, or `undefined`. */
  findActorReference(uid: string, target: ActorAuditTarget): Promise<string | undefined>;
}

export interface ActorAuditStepDeps {
  readonly port: ActorAuditErasurePort;
}

export function createActorAuditStepHandler(deps: ActorAuditStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runActorAuditBatch(deps, uid, maxWrites),
  };
}

export async function runActorAuditBatch(deps: ActorAuditStepDeps, uid: string, maxWrites: number): Promise<BatchResult> {
  // A zero budget could report "done" while a reference remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");
  const { port } = deps;

  for (const target of ACTOR_AUDIT_TARGETS) {
    const documentId = await port.findActorReference(uid, target);
    if (documentId === undefined) continue;

    await port.runTransaction(async (tx) => {
      const raw = await tx.getDocument(target, documentId);
      // A listed document that no longer reads back is inconsistent with the listing: fail closed, change nothing.
      if (raw === undefined) throw new ErasureStepFailure("verification_failed");
      if (raw[target.field] !== uid) throw new ErasureStepFailure("verification_failed");
      tx.clearActorField(target, documentId);
    });
    return "more";
  }

  return "done";
}
