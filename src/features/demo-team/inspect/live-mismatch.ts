import { demoCrypto } from "../crypto";
import type { DemoCrypto } from "../preflight";
import { buildDemoSeedPlan } from "../plan";
import { openTeamProjectDocument } from "../../team-projects/server/team-project-codec";
import { openTeamSystemDocument } from "../../team-systems/server/team-system-codec";
import { openCompetencePlanDocument } from "../../team-competence-plan/server/competence-plan-codec";
import { openTeamSkillDocument } from "../../team-owned-skills/server/team-skill-codec";
import { openSkillTreeDocument } from "../../skill-trees/domain/skill-tree-content-codec";
import { openSkillProgressDocument } from "../../skill-trees/server/skill-progress-content-codec";
import { openRoadmapItemDocument } from "../../roadmap/domain/roadmap-item-content-codec";

/**
 * Read-only comparison of the live demo records with the current fixtures (Phase D, section 6). Each live document and its
 * fixture are opened with the same codec the seed uses, then compared field by field. Metadata timestamps are reported
 * separately from business content. Nothing here writes, and the caller supplies a read-only adapter.
 */

export const INSPECTED_COLLECTIONS = [
  "teamProjects",
  "teamSystems",
  "teamCompetencePlans",
  "teamSkills",
  "skillTrees",
  "skillProgress",
  "roadmapItems",
] as const;
export type InspectedCollection = (typeof INSPECTED_COLLECTIONS)[number];

/** Fields that record when or by whom a row was written. A difference there is metadata, not business content. */
const METADATA_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "roleUpdatedAt",
  "roleUpdatedBy",
  "assessedAt",
  "assessedBy",
  "grantedBy",
  "archivedAt",
  "archivedBy",
  "lastUpdatedAt",
]);

export type DocumentVerdict =
  | { kind: "absent" }
  | { kind: "identical" }
  | { kind: "metadata-only"; keys: string[] }
  | {
      kind: "business-content";
      keys: string[];
      metadataKeys: string[];
      dateShiftDays: Record<string, number>;
      /** Fields whose stored JS type differs from the fixture (for example a Firestore Timestamp where a string is expected). */
      typeMismatch: Record<string, { fixture: string; live: string }>;
    }
  | { kind: "unreadable"; reason: "not-openable" | "malformed" };

export interface InspectedDocument {
  collection: InspectedCollection;
  docId: string;
  verdict: DocumentVerdict;
}

export type Codec = (docId: string, data: unknown, open: DemoCrypto["openRecord"]) => unknown;

const CODECS: Record<InspectedCollection, Codec> = {
  teamProjects: (id, data, open) => openTeamProjectDocument(id, data as Record<string, unknown>, open),
  teamSystems: (id, data, open) => openTeamSystemDocument(id, data, open),
  teamCompetencePlans: (id, data, open) => openCompetencePlanDocument(id, data, open),
  teamSkills: (id, data, open) => openTeamSkillDocument(id, data, open),
  skillTrees: (id, data, open) => openSkillTreeDocument(id, data, open),
  skillProgress: (_id, data, open) => openSkillProgressDocument(data, open),
  roadmapItems: (_id, data, open) => openRoadmapItemDocument(data, open),
};

/** The JS shape of a value, distinguishing a Firestore Timestamp (has `toDate`) from a plain string or object. */
export function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") return "Timestamp";
  return typeof value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canonical JSON with Dates as ISO strings, so two equal values compare equal regardless of key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => (inner instanceof Date ? inner.toISOString() : inner));
}

/** Removes metadata fields at every depth, so a nested audit timestamp is not mistaken for business content. */
function withoutMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMetadata);
  if (value instanceof Date) return value;
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) out[key] = withoutMetadata(inner);
  }
  return out;
}

function diffKeys(expected: Record<string, unknown>, live: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(expected), ...Object.keys(live)]);
  return [...keys].filter((key) => canonical(withoutMetadata(expected[key])) !== canonical(withoutMetadata(live[key]))).sort();
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Whole-day difference between two plain calendar dates (live minus fixture). `null` when either is not a plain date. */
export function dayShift(expected: unknown, live: unknown): number | null {
  if (typeof expected !== "string" || typeof live !== "string") return null;
  if (!DATE_ONLY.test(expected) || !DATE_ONLY.test(live)) return null;
  return Math.round((Date.parse(live) - Date.parse(expected)) / 86_400_000);
}

/** Classifies one live document against its fixture. Pure: the caller supplies both raw documents and the crypto. */
export function judgeDocument(input: {
  collection: InspectedCollection;
  docId: string;
  expectedData: unknown;
  liveData: unknown;
  crypto: DemoCrypto;
}): DocumentVerdict {
  if (input.liveData === undefined) return { kind: "absent" };
  const codec = CODECS[input.collection];
  let expected: unknown;
  let live: unknown;
  try {
    expected = codec(input.docId, input.expectedData, input.crypto.openRecord);
    live = codec(input.docId, input.liveData, input.crypto.openRecord);
  } catch {
    return { kind: "unreadable", reason: "not-openable" };
  }
  if (!isObject(expected) || !isObject(live)) {
    return { kind: "unreadable", reason: live === null || live === undefined ? "not-openable" : "malformed" };
  }
  const keys = diffKeys(expected, live);
  if (keys.length === 0) return { kind: "identical" };
  const metadataKeys = keys.filter((key) => METADATA_KEYS.has(key));
  const businessKeys = keys.filter((key) => !METADATA_KEYS.has(key));
  if (businessKeys.length === 0) return { kind: "metadata-only", keys: metadataKeys };
  const dateShiftDays: Record<string, number> = {};
  for (const key of businessKeys) {
    const shift = dayShift(expected[key], live[key]);
    if (shift !== null) dateShiftDays[key] = shift;
  }
  const typeMismatch: Record<string, { fixture: string; live: string }> = {};
  for (const key of businessKeys) {
    const fixtureType = describeType(expected[key]);
    const liveType = describeType(live[key]);
    if (fixtureType !== liveType) typeMismatch[key] = { fixture: fixtureType, live: liveType };
  }
  return { kind: "business-content", keys: businessKeys, metadataKeys, dateShiftDays, typeMismatch };
}

export interface LiveReader {
  readDoc(path: string): Promise<{ exists: false } | { exists: true; data: unknown }>;
}

/** Inspects every fixture document of the seven demo collections. Read-only. */
export async function inspectLiveFixtures(input: {
  reader: LiveReader;
  teamId: string;
  presenterUid: string;
  asOf: Date;
  crypto?: DemoCrypto;
}): Promise<InspectedDocument[]> {
  const crypto = input.crypto ?? demoCrypto;
  const plan = buildDemoSeedPlan({ presenterUid: input.presenterUid, teamId: input.teamId, asOf: input.asOf, sealRecord: crypto.sealRecord });
  const results: InspectedDocument[] = [];
  for (const op of plan.operations) {
    if (!(INSPECTED_COLLECTIONS as readonly string[]).includes(op.collection)) continue;
    const collection = op.collection as InspectedCollection;
    const live = await input.reader.readDoc(op.path);
    const verdict = judgeDocument({
      collection,
      docId: op.docId,
      expectedData: op.data,
      liveData: live.exists ? live.data : undefined,
      crypto,
    });
    results.push({ collection, docId: op.docId, verdict });
  }
  return results;
}

/** One line per collection: counts by verdict and the business fields that differ, by name. Field names only, never values. */
export function summarize(results: readonly InspectedDocument[]): string[] {
  const lines: string[] = [];
  for (const collection of INSPECTED_COLLECTIONS) {
    const rows = results.filter((r) => r.collection === collection);
    if (rows.length === 0) continue;
    const count = (kind: DocumentVerdict["kind"]) => rows.filter((r) => r.verdict.kind === kind).length;
    lines.push(
      `${collection}: ${rows.length} fixtures — identical ${count("identical")}, metadata-only ${count("metadata-only")}, ` +
        `business-content ${count("business-content")}, absent ${count("absent")}, unreadable ${count("unreadable")}`,
    );
    const businessFields = new Set<string>();
    const metadataFields = new Set<string>();
    const shifts = new Map<string, number[]>();
    const types = new Map<string, string>();
    for (const row of rows) {
      if (row.verdict.kind === "business-content") {
        row.verdict.keys.forEach((k) => businessFields.add(k));
        row.verdict.metadataKeys.forEach((k) => metadataFields.add(k));
        for (const [key, t] of Object.entries(row.verdict.typeMismatch)) types.set(key, `fixture ${t.fixture} vs live ${t.live}`);
        for (const [key, days] of Object.entries(row.verdict.dateShiftDays)) {
          shifts.set(key, [...(shifts.get(key) ?? []), days]);
        }
      }
      if (row.verdict.kind === "metadata-only") row.verdict.keys.forEach((k) => metadataFields.add(k));
    }
    if (businessFields.size > 0) lines.push(`  business fields differing: ${[...businessFields].join(", ")}`);
    if (metadataFields.size > 0) lines.push(`  metadata fields differing: ${[...metadataFields].join(", ")}`);
    for (const [key, t] of types) lines.push(`  type mismatch ${key}: ${t}`);
    for (const [key, days] of shifts) {
      lines.push(`  date field ${key}: shift in days (live minus fixture) min ${Math.min(...days)}, max ${Math.max(...days)}, n ${days.length}`);
    }
  }
  return lines;
}
