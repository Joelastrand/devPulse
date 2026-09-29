import type { EncryptedPayload } from "../../lib/encryption/encryption";
import type { Challenge } from "../challenges/domain/challenge";
import type { SkillProgressRecord } from "../skill-trees/domain/skill-progress";
import { skillProgressDocId } from "../skill-trees/domain/skill-progress";
import type { SkillTreeRecord } from "../skill-trees/domain/skill-tree";
import type { SurveyResponseRecord } from "../surveys/server/submit-survey-response";
import type { Team } from "../teams/domain/team";
import { membershipDocId, type TeamMembershipRecord } from "../teams/domain/team-membership";
import {
  assertValidAsOf,
  assertValidPresenterUid,
  buildDemoLogicalFixtures,
  CLOSED_PERIOD_COUNT,
  DEMO_SKILL_TREES,
  DEMO_SURVEY_NEXT_ID,
  DEMO_TEAM_ID,
  DEMO_TRACKED_SKILLS,
  demoChallengeId,
  demoResponseId,
  demoSurveyId,
  periodResponseCount,
  type SurveyFixture,
} from "./fixtures";

/**
 * Pure logical seed plan + explicit manifest (docs/features/demo-team/
 * SPEC.md — "Ownership model", "Manifest classification"). No Firebase
 * import, no I/O, no clock, no RNG. Reading, classifying against persisted
 * documents and writing belong to later tasks.
 */

/** The only collections the seed may ever touch (BR-16). */
export const ALLOWED_COLLECTIONS = [
  "teams",
  "teamMemberships",
  "surveys",
  "surveyResponses",
  "challenges",
  "skillTrees",
  "skillProgress",
] as const;

export type DemoCollection = (typeof ALLOWED_COLLECTIONS)[number];

/** `C` = create-only (written only if absent); `U` = upsert (`set` to the fixture). */
export type WriteClass = "C" | "U";

export interface ManifestEntry {
  collection: DemoCollection;
  docId: string;
  /** `{collection}/{docId}` — the exact document path. */
  path: string;
  writeClass: WriteClass;
}

/**
 * Persisted document shapes. Ids that Firestore holds only as the document
 * id (`surveyId`, `challengeId`, `treeId` in a tree) are not stored fields,
 * matching the existing server operations; validators are fed the id
 * separately, exactly as the read paths do.
 */
export type PersistedTeam = Omit<Team, "teamId">;
export type PersistedSurvey = SurveyFixture;
export type PersistedChallenge = Omit<Challenge, "challengeId">;

interface OperationBase extends ManifestEntry {
  /** Deep-copyable persisted data; sensitive values are already encrypted. */
  data: unknown;
}

export type PlannedOperation = OperationBase &
  (
    | { collection: "teams"; data: PersistedTeam }
    | { collection: "teamMemberships"; data: TeamMembershipRecord }
    | { collection: "surveys"; data: PersistedSurvey }
    | { collection: "surveyResponses"; data: SurveyResponseRecord }
    | { collection: "challenges"; data: PersistedChallenge }
    | { collection: "skillTrees"; data: SkillTreeRecord }
    | { collection: "skillProgress"; data: SkillProgressRecord }
  );

export type DemoEncrypt = (plaintext: string) => EncryptedPayload;

function entry(collection: DemoCollection, docId: string, writeClass: WriteClass): ManifestEntry {
  return { collection, docId, path: `${collection}/${docId}`, writeClass };
}

/**
 * The explicit, deterministic manifest: exact document paths derived from
 * fixed id tables only — independent of dates, encryption and any
 * Firestore state. Nothing here queries, wildcards or deletes. Ownership of
 * a path is defined by membership in this list, never by an id prefix or a
 * field value.
 */
export function buildDemoManifest(presenterUid: string): readonly ManifestEntry[] {
  assertValidPresenterUid(presenterUid);

  const periods = Array.from({ length: CLOSED_PERIOD_COUNT }, (_, i) => i + 1);

  const manifest: ManifestEntry[] = [
    entry("teams", DEMO_TEAM_ID, "C"),
    entry("teamMemberships", membershipDocId(presenterUid, DEMO_TEAM_ID), "C"),
    ...periods.map((p) => entry("surveys", demoSurveyId(p), "U")),
    entry("surveys", DEMO_SURVEY_NEXT_ID, "C"),
    ...periods.flatMap((p) =>
      Array.from({ length: periodResponseCount(p) }, (_, r) =>
        entry("surveyResponses", demoResponseId(p, r + 1), "U"),
      ),
    ),
    ...Array.from({ length: 5 }, (_, i) => entry("challenges", demoChallengeId(i + 1), "U")),
    ...DEMO_SKILL_TREES.map(({ id }) => entry("skillTrees", id, "U")),
    ...DEMO_TRACKED_SKILLS.map(({ treeId }) =>
      entry("skillProgress", skillProgressDocId(DEMO_TEAM_ID, treeId), "U"),
    ),
  ];

  assertManifestValid(manifest);
  return Object.freeze(manifest);
}

export function isAllowedCollection(collection: string): collection is DemoCollection {
  return (ALLOWED_COLLECTIONS as readonly string[]).includes(collection);
}

/** Rejects any entry outside the seven-collection allow-list (e.g. `forumThreads`) or with a path that does not match its parts. */
export function assertAllowedEntry(candidate: { collection: string; docId: string; path: string }): void {
  if (!isAllowedCollection(candidate.collection)) {
    throw new Error("Manifest entry rejected: collection is not allow-listed.");
  }
  if (
    candidate.docId.length === 0 ||
    candidate.docId.includes("/") ||
    candidate.path !== `${candidate.collection}/${candidate.docId}`
  ) {
    throw new Error("Manifest entry rejected: malformed document path.");
  }
}

/** Allow-list check plus uniqueness of every full path. */
export function assertManifestValid(manifest: readonly ManifestEntry[]): void {
  const seen = new Set<string>();
  for (const candidate of manifest) {
    assertAllowedEntry(candidate);
    if (seen.has(candidate.path)) {
      throw new Error("Manifest rejected: duplicate document path.");
    }
    seen.add(candidate.path);
  }
}

/** Guard: every operation must be a manifest path with the same collection/class, and the sets must match exactly. */
export function assertOperationsMatchManifest(
  operations: readonly PlannedOperation[],
  manifest: readonly ManifestEntry[],
): void {
  assertManifestValid(manifest);
  const byPath = new Map(manifest.map((m) => [m.path, m]));
  const seen = new Set<string>();

  for (const op of operations) {
    assertAllowedEntry(op);
    const owned = byPath.get(op.path);
    if (owned === undefined || owned.writeClass !== op.writeClass || owned.collection !== op.collection) {
      throw new Error("Operation rejected: path is not in the manifest.");
    }
    if (seen.has(op.path)) {
      throw new Error("Operation rejected: duplicate document path.");
    }
    seen.add(op.path);
  }

  if (seen.size !== manifest.length) {
    throw new Error("Plan does not cover the manifest exactly.");
  }
}

export interface DemoSeedPlan {
  /** The 82 intended document operations, in deterministic order. */
  operations: readonly PlannedOperation[];
  manifest: readonly ManifestEntry[];
}

/**
 * Builds the pure seed plan from `(presenterUid, asOf, encrypt)`. `encrypt`
 * is injected (the repository's own implementation at runtime); survey
 * answers and challenge text are encrypted here and never appear as
 * plaintext in any operation. Same inputs yield the same ids, paths, write
 * classes and logical values; only ciphertext bytes may differ.
 */
export function buildDemoSeedPlan(input: {
  presenterUid: string;
  asOf: Date;
  encrypt: DemoEncrypt;
}): DemoSeedPlan {
  const { presenterUid, asOf, encrypt } = input;
  assertValidAsOf(asOf);

  const fixtures = buildDemoLogicalFixtures({ presenterUid, asOf });
  const manifest = buildDemoManifest(presenterUid);
  const classOf = new Map(manifest.map((m) => [m.path, m.writeClass]));

  const op = <C extends DemoCollection>(
    collection: C,
    docId: string,
    data: Extract<PlannedOperation, { collection: C }>["data"],
  ): PlannedOperation => {
    const path = `${collection}/${docId}`;
    const writeClass = classOf.get(path);
    if (writeClass === undefined) {
      throw new Error("Operation rejected: path is not in the manifest.");
    }
    return { collection, docId, path, writeClass, data } as PlannedOperation;
  };

  const operations: PlannedOperation[] = [
    op("teams", DEMO_TEAM_ID, fixtures.team),
    op("teamMemberships", membershipDocId(presenterUid, DEMO_TEAM_ID), fixtures.membership),
    ...fixtures.closedSurveys.map(({ id, record }) => op("surveys", id, record)),
    op("surveys", fixtures.scheduledSurvey.id, fixtures.scheduledSurvey.record),
    ...fixtures.responses.map((r) =>
      op("surveyResponses", r.id, {
        surveyId: r.surveyId,
        teamId: DEMO_TEAM_ID,
        ...encrypt(JSON.stringify(r.answers)),
        submittedAt: r.submittedAt,
      }),
    ),
    ...fixtures.challenges.map(({ id, text, ...rest }) =>
      op("challenges", id, { teamId: DEMO_TEAM_ID, ...encrypt(text), ...rest }),
    ),
    ...fixtures.skillTrees.map((t) => op("skillTrees", t.id, t.record)),
    ...fixtures.skillProgress.map((p) =>
      op("skillProgress", skillProgressDocId(DEMO_TEAM_ID, p.treeId), p.record),
    ),
  ];

  assertOperationsMatchManifest(operations, manifest);
  return { operations, manifest };
}
