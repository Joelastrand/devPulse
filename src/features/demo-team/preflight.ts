import { openRoadmapItemDocument } from "../roadmap/domain/roadmap-item-content-codec";
import { openSkillProgressDocument } from "../skill-trees/server/skill-progress-content-codec";
import { openTeamDocument } from "../teams/domain/team-content-codec";
import { openSkillTreeDocument } from "../skill-trees/domain/skill-tree-content-codec";
import { openSurveyDocument } from "../surveys/server/survey-content-codec";
import { readRecordEnvelope, type RecordEnvelope } from "../../lib/encryption/record-envelope";
import { validateChallengeText } from "../challenges/domain/challenge-text";
import { challengeContext, isValidChallenge } from "../challenges/domain/challenge";
import { surveyResponseContext } from "../surveys/domain/response-context";
import { parseRoadmapItem, roadmapItemDocId } from "../roadmap/domain/roadmap-item";
import { isValidSkillProgress } from "../skill-trees/domain/skill-progress";
import { isValidSkillTree } from "../skill-trees/domain/skill-tree";
import { validateSurveyAnswers } from "../surveys/domain/answers";
import { isValidSurvey } from "../surveys/domain/survey";
import { isValidTeamStatus } from "../teams/domain/team";
import { isValidMembershipFor } from "../teams/domain/team-membership";
import type { DemoSeedConfig } from "./config";
import { DEMO_AUDIT_ACTOR, DEMO_MINIMUM_RESPONSES, DEMO_TEAM_ID } from "./fixtures";
import {
  ALLOWED_COLLECTIONS,
  assertManifestValid,
  assertOperationsMatchManifest,
  type DemoCollection,
  type ManifestEntry,
  type PlannedOperation,
  type WriteClass,
} from "./plan";

/**
 * Preflight, manifest classification and dry-run model (docs/archive/features/
 * demo-team/SPEC.md — "Manifest classification and conflict handling",
 * "Encryption", "Dry-run semantics"; BR-4–BR-6, BR-12, BR-21, BR-23–BR-29,
 * BR-31). Everything external is injected: the crypto pair, a `get(path)`-only
 * reader and an existence-only presenter lookup. This module never writes —
 * it does not import the writer — and never reads anything but manifest paths.
 *
 * Reader contract: `data` is the persisted document with Firestore
 * `Timestamp`s already mapped to `Date` (the real adapter's job, TASK-005).
 *
 * Nothing here prints or returns key material, ciphertext, decrypted
 * plaintext, the presenter email or raw exception text: failures are fixed
 * categories only.
 */

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export type DemoReadResult = { exists: false } | { exists: true; data: unknown };

/** Read-only, by exact path. No query, list or removal method exists. */
export interface DemoReader {
  get(path: string): Promise<DemoReadResult>;
}

/**
 * Existence checks for the presenter uid. Both return a boolean only, so the user record (and its email) and the erasure
 * record's content can never reach this module. `hasErasureRecord` refuses a uid that is erasing or erased (TASK-036, BR-20).
 */
export interface DemoPresenterLookup {
  userExists(uid: string): Promise<boolean>;
  hasErasureRecord(uid: string): Promise<boolean>;
}

export interface DemoCrypto {
  sealRecord(plaintext: string, context: string): RecordEnvelope;
  openRecord(envelope: RecordEnvelope, context: string): string;
}

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

export type ClassificationState = "ABSENT" | "COMPATIBLE" | "CONFLICT";

export type ConflictReason =
  | "malformed-shape"
  | "scope-mismatch"
  | "foreign-creator"
  | "team-disabled"
  | "membership-mismatch"
  | "structure-mismatch"
  | "undecryptable";

/** `create`: absent path; `set`: compatible upsert; `skip`: compatible create-only; `blocked`: conflict. */
export type PathAction = "create" | "set" | "skip" | "blocked";

export interface ClassifiedPath {
  path: string;
  collection: DemoCollection;
  writeClass: WriteClass;
  state: ClassificationState;
  action: PathAction;
  reason?: ConflictReason;
}

export type PreflightErrorCategory =
  | "crypto-failed"
  | "adapters-missing"
  | "presenter-not-found"
  | "presenter-erasure-record"
  | "presenter-lookup-failed"
  | "read-failed"
  | "conflict";

export type DemoPreflightResult =
  | {
      ok: true;
      /** `false` offline: no reads happened, so existing Firestore state is unknown. */
      existingStateChecked: boolean;
      classifications: readonly ClassifiedPath[];
      /** Operations whose action is `create` or `set`; ready for the guarded writer. */
      plannedOperations: readonly PlannedOperation[];
    }
  | {
      ok: false;
      error: { category: PreflightErrorCategory };
      /** Filled only for `conflict`, so the report can show which paths block. */
      classifications: readonly ClassifiedPath[];
    };

export interface DemoPreflightInput {
  config: Pick<DemoSeedConfig, "network" | "presenterUid">;
  operations: readonly PlannedOperation[];
  manifest: readonly ManifestEntry[];
  crypto: DemoCrypto;
  /** Required only when `config.network`; never touched otherwise. */
  online?: { reader: DemoReader; presenter: DemoPresenterLookup };
}

// ---------------------------------------------------------------------------
// Local crypto preflight (BR-26)
// ---------------------------------------------------------------------------

const CRYPTO_PROBE = "demo-seed-local-crypto-probe";
const PROBE_CONTEXT = "demo-seed-crypto-probe";

/** Encrypt a harmless probe, decrypt it, compare, discard. Proves only the local key works. */
export function runLocalCryptoPreflight(crypto: DemoCrypto): boolean {
  try {
    return crypto.openRecord(crypto.sealRecord(CRYPTO_PROBE, PROBE_CONTEXT), PROBE_CONTEXT) === CRYPTO_PROBE;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Classification (BR-23, BR-24, BR-27)
// ---------------------------------------------------------------------------

type Verdict = { compatible: true } | { compatible: false; reason: ConflictReason };

const OK: Verdict = { compatible: true };
const conflict = (reason: ConflictReason): Verdict => ({ compatible: false, reason });

function asRecord(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function classifyTeam(existing: Record<string, unknown>, docId: string, crypto: DemoCrypto): Verdict {
  // A plaintext name or a missing envelope is a malformed document; an envelope that does not open is undecryptable.
  if (Object.hasOwn(existing, "name") || readRecordEnvelope(existing.content) === null) return conflict("malformed-shape");
  let opened: unknown;
  try {
    opened = openTeamDocument(docId, existing, crypto.openRecord);
  } catch {
    return conflict("undecryptable");
  }
  if (opened === null) return conflict("undecryptable");
  if (
    !isNonEmptyString((opened as Record<string, unknown>).name) ||
    !isValidTeamStatus(existing.status) ||
    !isValidDate(existing.createdAt) ||
    !isNonEmptyString(existing.createdBy)
  ) {
    return conflict("malformed-shape");
  }
  if (existing.status !== "active") return conflict("team-disabled");
  if (existing.createdBy !== DEMO_AUDIT_ACTOR) return conflict("foreign-creator");
  return OK;
}

function classifyMembership(existing: Record<string, unknown>, expected: Record<string, unknown>): Verdict {
  const identity = { uid: String(expected.uid), teamId: DEMO_TEAM_ID };
  if (!isValidMembershipFor(existing, identity)) return conflict("membership-mismatch");
  if (existing.grantedBy !== DEMO_AUDIT_ACTOR) return conflict("membership-mismatch");
  return OK;
}

function classifySurvey(existing: Record<string, unknown>, docId: string, crypto: DemoCrypto): Verdict {
  // Scope is plaintext metadata, so it is checked before anything is decrypted.
  if (existing.teamId !== DEMO_TEAM_ID) return conflict("scope-mismatch");
  if (readRecordEnvelope(existing.content) === null) return conflict("malformed-shape");
  let opened: unknown;
  try {
    opened = openSurveyDocument(docId, existing, crypto.openRecord);
  } catch {
    return conflict("undecryptable");
  }
  if (opened === null) return conflict("undecryptable");
  if (!isValidSurvey({ ...(opened as Record<string, unknown>), surveyId: docId }, { surveyId: docId })) {
    return conflict("malformed-shape");
  }
  if (existing.createdBy !== DEMO_AUDIT_ACTOR) return conflict("foreign-creator");
  if (existing.accessMode !== "authenticated" || existing.minimumResponses !== DEMO_MINIMUM_RESPONSES) {
    return conflict("scope-mismatch");
  }
  return OK;
}

function hasEncryptedShape(existing: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(existing.ciphertext) &&
    isNonEmptyString(existing.iv) &&
    isNonEmptyString(existing.authTag) &&
    existing.keyVersion === "v2" &&
    existing.keyId === "k1" &&
    isValidDate(existing.submittedAt)
  );
}

function isValidAnswerPayload(plain: string): boolean {
  try {
    return validateSurveyAnswers(JSON.parse(plain)).ok;
  } catch {
    return false;
  }
}

function classifyResponse(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
  crypto: DemoCrypto,
  docId: string,
): Verdict {
  const existingKeys = Object.keys(existing).sort().join(",");
  const expectedKeys = Object.keys(expected).sort().join(",");
  if (existingKeys !== expectedKeys || !hasEncryptedShape(existing)) return conflict("malformed-shape");
  if (existing.surveyId !== expected.surveyId || existing.teamId !== DEMO_TEAM_ID) {
    return conflict("scope-mismatch");
  }
  return openRecordTo(existing, surveyResponseContext(DEMO_TEAM_ID, String(existing.surveyId), docId), crypto, isValidAnswerPayload)
    ? OK
    : conflict("undecryptable");
}

/**
 * Opens a v2 record with the active key and its record context (AAD), purely to validate. The plaintext is judged and
 * dropped, never returned. A wrong key, a tampered value or a value moved to another record all fail to open.
 */
function openRecordTo(
  existing: Record<string, unknown>,
  context: string,
  crypto: DemoCrypto,
  accept: (plain: string) => boolean,
): boolean {
  try {
    const plain = crypto.openRecord(
      {
        ciphertext: existing.ciphertext as string,
        iv: existing.iv as string,
        authTag: existing.authTag as string,
        keyVersion: "v2",
        keyId: "k1",
      },
      context,
    );
    return accept(plain);
  } catch {
    return false;
  }
}

function classifyChallenge(existing: Record<string, unknown>, docId: string, crypto: DemoCrypto): Verdict {
  if (!isValidChallenge({ ...existing, challengeId: docId }, { challengeId: docId })) {
    return conflict("malformed-shape");
  }
  if (existing.teamId !== DEMO_TEAM_ID) return conflict("scope-mismatch");
  return openRecordTo(existing, challengeContext(DEMO_TEAM_ID, docId), crypto, (plain) => validateChallengeText(plain).ok)
    ? OK
    : conflict("undecryptable");
}

function nodeIds(tree: Record<string, unknown>): string {
  return (tree.nodes as { nodeId: string }[]).map((n) => n.nodeId).join(",");
}

function classifySkillTree(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
  docId: string,
  crypto: DemoCrypto,
): Verdict {
  // Plaintext structure first: identifiers and order are not sealed, and a plaintext name or label is a malformed document.
  if (!hasPlaintextStructure(existing)) return conflict("malformed-shape");
  if (existing.createdBy !== DEMO_AUDIT_ACTOR) return conflict("foreign-creator");
  if (nodeIds(existing) !== nodeIds(expected)) return conflict("structure-mismatch");
  if (readRecordEnvelope(existing.content) === null) return conflict("malformed-shape");
  let opened: unknown;
  try {
    opened = openSkillTreeDocument(docId, existing, crypto.openRecord);
  } catch {
    return conflict("undecryptable");
  }
  if (opened === null) return conflict("undecryptable");
  return isValidSkillTree(opened) ? OK : conflict("malformed-shape");
}

function hasPlaintextStructure(existing: Record<string, unknown>): boolean {
  if (Object.hasOwn(existing, "name")) return false;
  if (!Array.isArray(existing.nodes)) return false;
  return existing.nodes.every(
    (node) => typeof node === "object" && node !== null && typeof (node as { nodeId?: unknown }).nodeId === "string" && !Object.hasOwn(node, "label"),
  );
}

function classifySkillProgress(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
  docId: string,
  crypto: DemoCrypto,
): Verdict {
  // Scope is plaintext metadata, so it is checked first. A plaintext stage or a missing envelope is malformed; an envelope
  // that does not open is undecryptable.
  if (existing.teamId !== DEMO_TEAM_ID || existing.treeId !== expected.treeId) return conflict("scope-mismatch");
  if (Object.hasOwn(existing, "currentNodeId") || readRecordEnvelope(existing.content) === null) return conflict("malformed-shape");
  let opened: unknown;
  try {
    opened = openSkillProgressDocument(existing, crypto.openRecord);
  } catch {
    return conflict("undecryptable");
  }
  if (opened === null) return conflict("undecryptable");
  return isValidSkillProgress(opened) ? OK : conflict("malformed-shape");
}

/** Compatible = valid roadmap shape for this team/tree/doc id, created by the seed. Later presenter edits are tolerated. */
function classifyRoadmapItem(existing: Record<string, unknown>, expected: Record<string, unknown>, docId: string, crypto: DemoCrypto): Verdict {
  // Scope is plaintext metadata, so it is checked before anything is decrypted.
  if (
    existing.teamId !== DEMO_TEAM_ID ||
    existing.treeId !== expected.treeId ||
    docId !== roadmapItemDocId(DEMO_TEAM_ID, String(existing.treeId))
  ) {
    return conflict("scope-mismatch");
  }
  if (readRecordEnvelope(existing.content) === null) return conflict("malformed-shape");
  let opened: unknown;
  try {
    opened = openRoadmapItemDocument(existing, crypto.openRecord);
  } catch {
    return conflict("undecryptable");
  }
  if (opened === null) return conflict("undecryptable");
  const parsed = parseRoadmapItem(opened as Record<string, unknown>);
  if (parsed === null) return conflict("malformed-shape");
  return parsed.createdBy === DEMO_AUDIT_ACTOR ? OK : conflict("foreign-creator");
}

function classifyExisting(op: PlannedOperation, data: unknown, crypto: DemoCrypto): Verdict {
  const existing = asRecord(data);
  const expected = asRecord(op.data);
  if (existing === null || expected === null) return conflict("malformed-shape");

  switch (op.collection) {
    case "teams":
      return classifyTeam(existing, op.docId, crypto);
    case "teamMemberships":
      return classifyMembership(existing, expected);
    case "surveys":
      return classifySurvey(existing, op.docId, crypto);
    case "surveyResponses":
      return classifyResponse(existing, expected, crypto, op.docId);
    case "challenges":
      return classifyChallenge(existing, op.docId, crypto);
    case "skillTrees":
      return classifySkillTree(existing, expected, op.docId, crypto);
    case "skillProgress":
      return classifySkillProgress(existing, expected, op.docId, crypto);
    case "roadmapItems":
      return classifyRoadmapItem(existing, expected, op.docId, crypto);
  }
}

function classifyPath(op: PlannedOperation, read: DemoReadResult, crypto: DemoCrypto): ClassifiedPath {
  const base = { path: op.path, collection: op.collection, writeClass: op.writeClass };

  if (!read.exists) return { ...base, state: "ABSENT", action: "create" };

  const verdict = classifyExisting(op, read.data, crypto);
  if (!verdict.compatible) {
    return { ...base, state: "CONFLICT", action: "blocked", reason: verdict.reason };
  }
  return { ...base, state: "COMPATIBLE", action: op.writeClass === "C" ? "skip" : "set" };
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function failure(category: PreflightErrorCategory, classifications: readonly ClassifiedPath[] = []): DemoPreflightResult {
  return { ok: false, error: { category }, classifications };
}

/**
 * Order: local crypto round-trip (every mode) → (online only) presenter
 * existence → one `get` per manifest path → classification. Any conflict
 * yields a failure with no planned operations. Offline, the reader and the
 * presenter lookup are never touched. No write path exists here.
 */
export async function runDemoPreflight(input: DemoPreflightInput): Promise<DemoPreflightResult> {
  const { config, operations, manifest, crypto, online } = input;

  assertManifestValid(manifest);
  assertOperationsMatchManifest(operations, manifest);

  if (!runLocalCryptoPreflight(crypto)) return failure("crypto-failed");

  if (!config.network) {
    return { ok: true, existingStateChecked: false, classifications: [], plannedOperations: operations };
  }
  if (online === undefined) return failure("adapters-missing");

  let presenterExists: boolean;
  try {
    presenterExists = await online.presenter.userExists(config.presenterUid);
  } catch {
    return failure("presenter-lookup-failed");
  }
  if (!presenterExists) return failure("presenter-not-found");

  let erasureRecordExists: boolean;
  try {
    erasureRecordExists = await online.presenter.hasErasureRecord(config.presenterUid);
  } catch {
    return failure("presenter-lookup-failed");
  }
  if (erasureRecordExists) return failure("presenter-erasure-record");

  const classifications: ClassifiedPath[] = [];
  for (const op of operations) {
    let read: DemoReadResult;
    try {
      read = await online.reader.get(op.path);
    } catch {
      return failure("read-failed");
    }
    classifications.push(classifyPath(op, read, crypto));
  }

  if (classifications.some((c) => c.state === "CONFLICT")) return failure("conflict", classifications);

  const writable = new Set(classifications.filter((c) => c.action !== "skip").map((c) => c.path));
  return {
    ok: true,
    existingStateChecked: true,
    classifications,
    plannedOperations: operations.filter((op) => writable.has(op.path)),
  };
}

// ---------------------------------------------------------------------------
// Dry-run report (BR-4 gate text, BR-28, BR-31)
// ---------------------------------------------------------------------------

export interface DemoDryRunReportInput {
  config: Pick<DemoSeedConfig, "mode" | "projectId" | "presenterUid" | "asOf">;
  operations: readonly PlannedOperation[];
  result: DemoPreflightResult;
}

/**
 * Redacted, deterministic report lines. Only fixed labels, ids, counts and
 * categories are emitted — never credentials, key material, payload fields,
 * decrypted values or the presenter email. The config's credentials are not
 * even accepted by the type.
 */
export function formatDemoDryRunReport(input: DemoDryRunReportInput): string[] {
  const { config, operations, result } = input;
  const lines: string[] = [
    config.mode === "write" ? "Demo Team seed — preflight before write" : "Demo Team seed — dry-run (no writes)",
    `Resolved project id: ${config.projectId}`,
    `Mode: ${config.mode}`,
    `Team id: ${DEMO_TEAM_ID}`,
    `Presenter uid: ${config.presenterUid}`,
    `As-of date: ${config.asOf.toISOString().slice(0, 10)}`,
    `Local crypto round-trip: ${result.ok || result.error.category !== "crypto-failed" ? "ok" : "FAILED"} (does not prove the key matches ciphertext already stored in Firestore)`,
  ];

  if (!result.ok && result.error.category !== "conflict") {
    lines.push(`Preflight failed: ${result.error.category}`, "Writes planned: 0", "Deletes: 0");
    return lines;
  }

  lines.push("Planned documents by collection:");
  for (const collection of ALLOWED_COLLECTIONS) {
    lines.push(`  ${collection}: ${operations.filter((op) => op.collection === collection).length}`);
  }

  if (result.ok && !result.existingStateChecked) {
    lines.push("Existing Firestore state: not checked (offline — no network, no reads)");
  } else {
    lines.push("Per-path action:");
    for (const c of result.classifications) {
      const suffix = c.action === "blocked" ? ` (${c.reason})` : c.action === "skip" ? " (exists)" : "";
      lines.push(`  ${c.action}${suffix} ${c.path}`);
    }
  }

  lines.push(
    result.ok
      ? `Writes planned: ${result.plannedOperations.length}`
      : "Writes planned: 0 (aborted: conflict)",
    "Deletes: 0",
    "Warning: the demo team and demo skill trees are visible to every signed-in user and every admin of the target project.",
    "Reminder: to demo admin surfaces the presenter must be an active superadmin in the Firestore registry (superadmins/{uid}; external prerequisite, not changed by this tool).",
    "Gate: the coordinator must approve this exact project id before `--write`; `--confirm` is only a typo guard.",
  );
  return lines;
}
