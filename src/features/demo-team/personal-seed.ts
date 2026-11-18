import type { Goal } from "../personal-goals/domain/goal";
import type { ResponsibilityContent } from "../personal-role-workspace/domain/responsibility";
import type { AchievementContent } from "../personal-role-workspace/domain/achievement";
import type { SelfAssessedLevel } from "../skill-profiles/domain/self-assessed-level";
import type { ConversationContent } from "../development-conversations/domain/content-payload";
import { resolveDemoSeedConfig, type DemoSeedConfig } from "./config";
import { buildPersonalLogicalFixtures, type PersonalLogicalFixtures } from "./personal-fixtures";
import { DEMO_SKILL_TREES } from "./fixtures";

/**
 * The single trusted entry point for the presenter's personal "Min utvikling" demo data (Phase 1). It orchestrates only:
 * it builds the deterministic fixture plan, applies the existing demo-team safety gates, and calls the feature-owned
 * create-only seed operations. It never writes an owner-only collection itself.
 *
 * - Project proof, presenter UID and `--write --confirm` come from the existing demo-team config (`resolveDemoSeedConfig`).
 * - Offline dry runs read nothing: no owner module is loaded, no Firebase code is imported, no network is opened.
 * - Owner modules are loaded dynamically only in write mode, after every gate passed. There is no HTTP route.
 * - Create-only: each owner operation creates, skips an identical record, or reports a conflict and writes nothing.
 *
 * Only the presenter's own uid (from the explicit `--presenter-uid`) is used. Document counts are reported per Firestore
 * document, separately from the team seed's counts.
 */

// ---------------------------------------------------------------------------
// Plan (pure)
// ---------------------------------------------------------------------------

export interface PersonalSeedPlan {
  goals: { id: string; goal: Goal }[];
  responsibilities: { id: string; content: ResponsibilityContent; stamps: Stamps }[];
  achievements: { id: string; content: AchievementContent; stamps: Stamps }[];
  skillLevels: { treeId: string; level: SelfAssessedLevel }[];
  skillProfileStamps: Stamps;
  conversation: { id: string; content: ConversationContent; plannedFor: string; stamps: Stamps };
  /** Firestore documents this plan writes: goals + responsibilities + achievements + one skill profile + one conversation. */
  documentCount: number;
}

export interface Stamps {
  createdAt: Date;
  updatedAt: Date;
}

function toGoal(fixture: PersonalLogicalFixtures["goals"][number]): Goal {
  const base = {
    title: fixture.title,
    treeId: fixture.treeId,
    targetDate: fixture.targetDate,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  };
  return fixture.status === "completed" && fixture.completedAt !== null
    ? { ...base, status: "completed", completedAt: fixture.completedAt }
    : { ...base, status: "active" };
}

/** Pure: the same `(presenterUid, asOf)` always yields the same ids, contents and stamps. */
export function planPersonalSeed(input: { presenterUid: string; asOf: Date }): PersonalSeedPlan {
  const fixtures = buildPersonalLogicalFixtures(input);
  const plan: PersonalSeedPlan = {
    goals: fixtures.goals.map((g) => ({ id: g.id, goal: toGoal(g) })),
    responsibilities: fixtures.responsibilities.map((r) => ({
      id: r.id,
      content: { ...r.payload, ...r.plain },
      stamps: { createdAt: r.createdAt, updatedAt: r.updatedAt },
    })),
    achievements: fixtures.achievements.map((a) => ({
      id: a.id,
      content: { ...a.payload, relationToRole: a.plain.relationToRole, periodStart: a.plain.periodStart, periodEnd: a.plain.periodEnd, goalIds: a.plain.goalIds, responsibilityIds: a.plain.responsibilityIds },
      stamps: { createdAt: a.createdAt, updatedAt: a.updatedAt },
    })),
    skillLevels: fixtures.skillLevels.map((s) => ({ treeId: s.treeId, level: s.level })),
    skillProfileStamps: { createdAt: fixtures.asOf, updatedAt: fixtures.asOf },
    conversation: {
      id: fixtures.conversation.id,
      content: fixtures.conversation.content,
      plannedFor: fixtures.conversation.plannedFor,
      stamps: { createdAt: fixtures.conversation.createdAt, updatedAt: fixtures.conversation.updatedAt },
    },
    documentCount: 0,
  };
  plan.documentCount = plan.goals.length + plan.responsibilities.length + plan.achievements.length + 1 + 1;
  return plan;
}

// ---------------------------------------------------------------------------
// Writers (feature-owned operations, injected)
// ---------------------------------------------------------------------------

export type SeedAction = "create" | "skip";

/** The owner-module operations the orchestrator calls. Production wiring is `loadProductionPersonalWriters`. */
export interface PersonalWriters {
  /** Read-only catalog check: does `skillTrees/{treeId}` exist? Used by the write-mode dependency preflight. */
  treeExists(treeId: string): Promise<boolean>;
  seedGoal(goalId: string, goal: Goal): Promise<SeedAction>;
  seedResponsibility(id: string, content: ResponsibilityContent, stamps: Stamps): Promise<SeedAction>;
  seedAchievement(id: string, content: AchievementContent, stamps: Stamps): Promise<SeedAction>;
  seedSkillLevels(levels: { treeId: string; level: SelfAssessedLevel }[], stamps: Stamps): Promise<SeedAction>;
  seedConversation(id: string, content: ConversationContent, plannedFor: string, stamps: Stamps): Promise<SeedAction>;
}

/** Production writers: bind the owner operations to the presenter uid. Loaded only in write mode, after every gate. */
export async function loadProductionPersonalWriters(presenterUid: string): Promise<PersonalWriters> {
  const [goals, records, skills, conversations] = await Promise.all([
    import("../personal-goals/server/goal-store"),
    import("../personal-role-workspace/server/record-operations"),
    import("../skill-profiles/server/skill-profile-store"),
    import("../development-conversations/server/create-conversation"),
  ]);
  const { getDefaultConversationStore } = await import("../development-conversations/server/conversation-store");
  const { productionPersonalRecordDeps } = records;
  const deps = productionPersonalRecordDeps();
  const store = getDefaultConversationStore();
  return {
    treeExists: async (treeId) => {
      const { getFirestoreDb } = await import("../../lib/firebase/admin");
      const snapshot = await getFirestoreDb().collection("skillTrees").doc(treeId).get();
      return snapshot.exists;
    },
    seedGoal: (goalId, goal) => goals.seedGoalCreateOnly(presenterUid, goalId, goal),
    seedResponsibility: (id, content, stamps) => records.seedResponsibilityCreateOnly(presenterUid, id, content, stamps, deps),
    seedAchievement: (id, content, stamps) => records.seedAchievementCreateOnly(presenterUid, id, content, stamps, deps),
    seedSkillLevels: (levels, stamps) => skills.seedSkillLevelsCreateOnly(presenterUid, levels, stamps),
    seedConversation: (id, content, plannedFor, stamps) =>
      conversations.seedOwnerConversationCreateOnly({ store, ownerUid: presenterUid, conversationId: id, content, plannedFor, stamps }),
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface PersonalSeedRunInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  /** Injected in tests; production passes `loadProductionPersonalWriters`. Never called offline. */
  loadWriters?: (presenterUid: string) => Promise<PersonalWriters>;
  /** The project the owner operations' Admin app is bound to. Injected in tests; production reads the default app. */
  resolveBoundProjectId?: () => Promise<string | undefined>;
}

/** Production binding: the default Admin app's project, read-only. Loaded only in write mode, after the gates. */
async function productionBoundProjectId(): Promise<string | undefined> {
  const { getAdminAppProjectId } = await import("../../lib/firebase/admin");
  return getAdminAppProjectId();
}

/** Every skill tree the personal records reference, once each, in fixture order. */
export function requiredTreeIds(plan: PersonalSeedPlan): string[] {
  const ids = [...plan.skillLevels.map((s) => s.treeId), ...plan.goals.map((g) => g.goal.treeId ?? "")].filter((id) => id !== "");
  return [...new Set(ids)];
}

/**
 * Pure relationship check for the personal fixtures (no Firebase): every goal's and skill level's tree must be a planned
 * catalog tree; every responsibility goal link and achievement goal/responsibility link must resolve to a planned record.
 */
export function personalRelationshipProblems(plan: PersonalSeedPlan): string[] {
  const treeIds = new Set<string>(DEMO_SKILL_TREES.map((t) => t.id));
  const goalIds = new Set(plan.goals.map((g) => g.id));
  const responsibilityIds = new Set(plan.responsibilities.map((r) => r.id));
  const problems: string[] = [];
  for (const id of requiredTreeIds(plan)) if (!treeIds.has(id)) problems.push(`skill tree ${id} is not planned`);
  for (const r of plan.responsibilities) for (const g of r.content.goalIds) if (!goalIds.has(g)) problems.push(`responsibility ${r.id} links to unknown goal ${g}`);
  for (const a of plan.achievements) {
    for (const g of a.content.goalIds) if (!goalIds.has(g)) problems.push(`achievement ${a.id} links to unknown goal ${g}`);
    for (const r of a.content.responsibilityIds) if (!responsibilityIds.has(r)) problems.push(`achievement ${a.id} links to unknown responsibility ${r}`);
  }
  return problems;
}

export interface PersonalSeedRunOutput {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function reportLines(config: DemoSeedConfig, plan: PersonalSeedPlan): string[] {
  return [
    config.mode === "write" ? "Personal demo seed — preflight before write" : "Personal demo seed — dry-run (no writes)",
    `Resolved project id: ${config.projectId}`,
    `Mode: ${config.mode}`,
    `Presenter uid: ${config.presenterUid}`,
    `As-of date: ${config.asOf.toISOString().slice(0, 10)}`,
    "Planned personal records (feature-owned, create-only):",
    `  goals: ${plan.goals.length}`,
    `  responsibilities: ${plan.responsibilities.length}`,
    `  achievements: ${plan.achievements.length}`,
    `  skill profile (one document, ${plan.skillLevels.length} levels): 1`,
    `  development conversation (owner-only, no participant index): 1`,
    `Personal Firestore documents planned: ${plan.documentCount}`,
    "Existing Firestore state: not checked (offline — no reads). Each owner operation classifies its own record on write.",
    "Team documents are reported separately by `pnpm seed:demo-team`.",
    "Deletes: 0",
  ];
}

function abort(stdout: string[], category: string, exitCode: 1 | 2 = 1): PersonalSeedRunOutput {
  return { exitCode, stdout, stderr: [`Aborted: ${category} (nothing was written)`] };
}

/**
 * Runs the personal seed. Offline: returns the plan only. Write: requires `--write --confirm <projectId>` and the project
 * proof (from `resolveDemoSeedConfig`), then applies the create-only operations in order. A conflict stops the run
 * before any further record is written; already-created records are reported, never removed.
 */
export async function runPersonalSeed(input: PersonalSeedRunInput): Promise<PersonalSeedRunOutput> {
  const resolved = resolveDemoSeedConfig({ argv: input.argv, env: input.env, now: input.now });
  if (!resolved.ok) {
    const { category, subject } = resolved.error;
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`Configuration error: ${category}${subject === undefined ? "" : ` (${subject})`}`],
    };
  }
  const { config } = resolved;
  const plan = planPersonalSeed({ presenterUid: config.presenterUid, asOf: config.asOf });
  const lines = reportLines(config, plan);

  // Fixture relationships are validated offline too: no reference may dangle, whatever the mode.
  const problems = personalRelationshipProblems(plan);
  if (problems.length > 0) return abort([...lines, ...problems.map((p) => `Relationship problem: ${p}`)], "fixture-relationship-invalid");

  if (config.mode !== "write") {
    return { exitCode: 0, stdout: [...lines, "Relationships: all personal references resolve to planned records and existing catalog trees (fixtures only)."], stderr: [] };
  }
  if (!config.writesAllowed || !config.network) return abort(lines, "write-gate-not-satisfied");

  // Project binding: the default Admin app that the owner operations use must be bound to the proven project. Checked
  // before any writer is loaded or any document is touched. A missing or different project fails closed.
  const boundProjectId = await (input.resolveBoundProjectId ?? productionBoundProjectId)();
  if (boundProjectId !== config.projectId) return abort(lines, "project-binding-mismatch");
  if (input.loadWriters === undefined) return abort(lines, "write-adapter-not-wired");

  let writers: PersonalWriters;
  try {
    writers = await input.loadWriters(config.presenterUid);
  } catch {
    return abort(lines, "adapters-failed");
  }

  // Dependency preflight: every referenced skill tree must already be in the catalog (written by the team seed).
  const missing: string[] = [];
  for (const treeId of requiredTreeIds(plan)) {
    try {
      if (!(await writers.treeExists(treeId))) missing.push(treeId);
    } catch {
      return abort(lines, "catalog-check-failed");
    }
  }
  if (missing.length > 0) {
    return {
      exitCode: 1,
      stdout: [
        ...lines,
        `Missing skill trees: ${missing.length} of ${requiredTreeIds(plan).length}. Run the team seed first (team mode writes the catalog):`,
        `  pnpm seed:demo-team -- --project ${config.projectId} --presenter-uid ${config.presenterUid} --write --confirm ${config.projectId}`,
        "Nothing was written.",
      ],
      stderr: ["Aborted: skill-tree-catalog-missing (nothing was written)"],
    };
  }

  const counts = { create: 0, skip: 0, conflict: 0 };
  const steps: Array<() => Promise<SeedAction>> = [
    ...plan.goals.map((g) => () => writers.seedGoal(g.id, g.goal)),
    ...plan.responsibilities.map((r) => () => writers.seedResponsibility(r.id, r.content, r.stamps)),
    ...plan.achievements.map((a) => () => writers.seedAchievement(a.id, a.content, a.stamps)),
    () => writers.seedSkillLevels(plan.skillLevels, plan.skillProfileStamps),
    () => writers.seedConversation(plan.conversation.id, plan.conversation.content, plan.conversation.plannedFor, plan.conversation.stamps),
  ];
  for (const step of steps) {
    try {
      counts[await step()] += 1;
    } catch {
      counts.conflict += 1;
      return {
        exitCode: 1,
        stdout: [...lines, `Write stopped at a conflict or refusal: create ${counts.create}, skip ${counts.skip}, conflict ${counts.conflict}. Nothing was overwritten.`],
        stderr: ["Aborted: conflict-or-refusal (nothing was overwritten)"],
      };
    }
  }
  return {
    exitCode: 0,
    stdout: [...lines, `Write: create ${counts.create}, skip ${counts.skip}, conflict ${counts.conflict}. Deletes: 0`],
    stderr: [],
  };
}
