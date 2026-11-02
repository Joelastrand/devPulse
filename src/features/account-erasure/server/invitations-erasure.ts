import { invitationBelongsToErasedPerson } from "./invitation-match";
import { normalizeEmail } from "../../teams/domain/normalize-email";
import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The invitations and access-requests erasure step (TASK-017; SPEC BR-13, AE-SI-9, I-10, I-11, A-9, A-10). Pure logic
 * over an injected port. Each batch handles one target, so the step is bounded and retry-safe.
 *
 * Categories, in order (the first with a match is handled; `done` only when none has a match):
 *   1. `teamAccessRequests` owned by the uid (uid field, or the legacy `uid__` document-id prefix): deleted (I-10);
 *   2. `teamInvitations` whose stored email normalizes to the erased person's normalized email, or whose `resolvedUid` is
 *      the uid, in any status: deleted (I-11);
 *   3. others' `teamAccessRequests.resolvedBy === uid`: set to null, the record is kept (A-9);
 *   4. others' `teamInvitations.invitedBy === uid`: set to null, the record is kept (A-10).
 *
 * The erased person's normalized email is not in the runner's input. It is resolved by an injected dependency (in
 * production, from the Auth record, which still exists before `auth_delete`). A failure to resolve it fails closed.
 *
 * Each target is re-read inside its transaction, and the predicate is checked again before any write. A record that
 * does not match, or a stored value that contradicts its query, fails closed as `verification_failed`.
 */

export interface InvitationRaw {
  readonly id: string;
  readonly data: unknown;
}

export interface InvitationTransaction {
  getAccessRequest(id: string): Promise<unknown>;
  getInvitation(id: string): Promise<unknown>;
  deleteAccessRequest(id: string): void;
  deleteInvitation(id: string): void;
  clearAccessRequestResolvedBy(id: string): void;
  clearInvitationInvitedBy(id: string): void;
}

export interface InvitationsErasurePort {
  runTransaction<T>(work: (tx: InvitationTransaction) => Promise<T>): Promise<T>;
  /** Access-request ids owned by the uid (uid field, or legacy `uid__` id prefix), at most `limit`. */
  accessRequestIdsFor(uid: string, limit: number): Promise<string[]>;
  /**
   * Invitation ids whose stored email equals `normalizedEmail`, whose document id ends in `__${normalizedEmail}`, or whose
   * `resolvedUid` is the uid. The production adapter (TASK-038) must cover the document-id match without inventing a
   * `normalizedEmail` field; the step does not rely on the query for that match, it checks the id itself.
   */
  invitationIdsFor(normalizedEmail: string, uid: string, limit: number): Promise<string[]>;
  /** Access-request ids whose `resolvedBy` is the uid, at most `limit`. */
  accessRequestIdsResolvedBy(uid: string, limit: number): Promise<string[]>;
  /** Invitation ids whose `invitedBy` is the uid, at most `limit`. */
  invitationIdsInvitedBy(uid: string, limit: number): Promise<string[]>;
}

export interface InvitationsStepDeps {
  readonly port: InvitationsErasurePort;
  /** The erased person's normalized email, resolved while the Auth record still exists. */
  readonly normalizedEmailOf: (uid: string) => Promise<string>;
}

export function createInvitationsStepHandler(deps: InvitationsStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runInvitationsBatch(deps, uid, maxWrites),
  };
}

export async function runInvitationsBatch(
  deps: InvitationsStepDeps,
  uid: string,
  maxWrites: number,
): Promise<BatchResult> {
  const { port } = deps;
  // A zero budget could report "done" while a target remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");

  const normalizedEmail = await resolveNormalizedEmail(deps, uid);

  const [ownRequest] = await port.accessRequestIdsFor(uid, 1);
  if (ownRequest !== undefined) {
    await port.runTransaction(async (tx) => {
      const raw = await tx.getAccessRequest(ownRequest);
      if (raw === undefined) return;
      const record = parseRecord(raw);
      if (record === undefined) throw new ErasureStepFailure("verification_failed");
      const owner = record.uid ?? (ownRequest.startsWith(`${uid}__`) ? uid : undefined);
      if (owner !== uid) throw new ErasureStepFailure("verification_failed");
      tx.deleteAccessRequest(ownRequest);
    });
    return "more";
  }

  const [matchingInvitation] = await port.invitationIdsFor(normalizedEmail, uid, 1);
  if (matchingInvitation !== undefined) {
    await port.runTransaction(async (tx) => {
      const raw = await tx.getInvitation(matchingInvitation);
      if (raw === undefined) return;
      const record = parseRecord(raw);
      if (record === undefined) throw new ErasureStepFailure("verification_failed");
      // One rule decides ownership (invitation-match.ts): a matching stored e-mail, an exact `${teamId}__${normalizedEmail}`
      // id only when no e-mail field is stored, or a resolvedUid of this uid. A stored e-mail that differs never matches by
      // id suffix, so another person's invitation is never deleted (TASK-038 finding 2).
      if (!invitationBelongsToErasedPerson(matchingInvitation, raw as Record<string, unknown>, normalizedEmail, uid)) {
        throw new ErasureStepFailure("verification_failed");
      }
      tx.deleteInvitation(matchingInvitation);
    });
    return "more";
  }

  const [resolvedRequest] = await port.accessRequestIdsResolvedBy(uid, 1);
  if (resolvedRequest !== undefined) {
    await port.runTransaction(async (tx) => {
      const raw = await tx.getAccessRequest(resolvedRequest);
      if (raw === undefined) return;
      const record = parseRecord(raw);
      if (record === undefined || record.resolvedBy !== uid) throw new ErasureStepFailure("verification_failed");
      tx.clearAccessRequestResolvedBy(resolvedRequest);
    });
    return "more";
  }

  const [invitedRecord] = await port.invitationIdsInvitedBy(uid, 1);
  if (invitedRecord !== undefined) {
    await port.runTransaction(async (tx) => {
      const raw = await tx.getInvitation(invitedRecord);
      if (raw === undefined) return;
      const record = parseRecord(raw);
      if (record === undefined || record.invitedBy !== uid) throw new ErasureStepFailure("verification_failed");
      tx.clearInvitationInvitedBy(invitedRecord);
    });
    return "more";
  }

  return "done";
}

async function resolveNormalizedEmail(deps: InvitationsStepDeps, uid: string): Promise<string> {
  try {
    const email = await deps.normalizedEmailOf(uid);
    if (email.trim().length === 0) throw new ErasureStepFailure("auth_unavailable");
    return normalizeEmail(email);
  } catch {
    throw new ErasureStepFailure("auth_unavailable");
  }
}

interface ParsedRecord {
  readonly uid?: string;
  readonly email?: string;
  readonly resolvedUid?: string;
  readonly resolvedBy?: string;
  readonly invitedBy?: string;
}

/** Reads the fields the step needs. A present field of the wrong type is malformed, so the step fails closed. */
function parseRecord(raw: unknown): ParsedRecord | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const fields = {
    uid: optionalString(record.uid),
    email: optionalString(record.email),
    resolvedUid: optionalString(record.resolvedUid),
    // An actor field cleared to `null` by an earlier erasure step (A-9, A-10) is the preserved state, not corruption.
    resolvedBy: optionalActor(record.resolvedBy),
    invitedBy: optionalActor(record.invitedBy),
  };
  if (Object.values(fields).includes(null)) return undefined;
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as ParsedRecord;
}

/** `undefined` when absent, the string when a non-empty string, `null` when present but not a non-empty string. */
function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * An actor field (`resolvedBy`, `invitedBy`). Absent or an explicit `null` both read as "no actor" (the cleared state);
 * a non-empty string is the actor; anything else is malformed.
 */
function optionalActor(value: unknown): string | undefined | null {
  if (value === null) return undefined;
  return optionalString(value);
}
