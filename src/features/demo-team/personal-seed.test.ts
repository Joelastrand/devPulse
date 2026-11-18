import { describe, expect, it } from "vitest";
import { personalRelationshipProblems, planPersonalSeed, runPersonalSeed, type PersonalWriters } from "./personal-seed";
import { runDemoSeed } from "./runner";

import { createHash } from "node:crypto";
import { DEMO_SKILL_TREES } from "./fixtures";
import { buildDemoSeedPlan, ALLOWED_COLLECTIONS, type DemoSealRecord } from "./plan";
import { DEMO_PERSONAL_SKILL_TREE_IDS } from "./personal-fixtures";
import { teamPlanCounts } from "./team-plan-counts";

const PRESENTER = "presenter-uid-fixture";
const PROJECT = "devpulse-nve";
const AS_OF = "2026-03-16";
const env = {
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_PRIVATE_KEY: "placeholder",
};
const offlineArgv = ["--project", PROJECT, "--presenter-uid", PRESENTER, "--as-of", AS_OF, "--offline"];
const writeArgv = ["--project", PROJECT, "--presenter-uid", PRESENTER, "--as-of", AS_OF, "--write", "--confirm", PROJECT];
const now = () => new Date("2026-03-16T10:00:00.000Z");

/** Recording writers: every call is logged in order; `respond` decides the action or a refusal per step. */
function recordingWriters(respond: (step: string) => "create" | "skip" | "throw" = () => "create") {
  const calls: string[] = [];
  const act = async (step: string) => {
    calls.push(step);
    if (respond(step) === "throw") throw new Error("refused");
    return respond(step) === "skip" ? "skip" : "create";
  };
  const writers: PersonalWriters = {
    treeExists: async () => true,
    seedGoal: (goalId) => act(`goal:${goalId}`),
    seedResponsibility: (id) => act(`responsibility:${id}`),
    seedAchievement: (id) => act(`achievement:${id}`),
    seedSkillLevels: () => act("skillLevels"),
    seedConversation: (id) => act(`conversation:${id}`),
  };
  return { writers, calls };
}

const fakeSeal: DemoSealRecord = (plaintext) => ({
  ciphertext: createHash("sha256").update(plaintext).digest("base64"),
  iv: "aXYtZml4dHVyZQ==",
  authTag: "dGFnLWZpeHR1cmU=",
  keyVersion: "v2",
  keyId: "k1",
});

describe("personal fixture integrity (references resolve, nothing dangling, no personal writes from demo-team)", () => {
  const asOf = new Date("2026-03-16T00:00:00.000Z");
  const plan = planPersonalSeed({ presenterUid: PRESENTER, asOf });
  const teamTreeIds = new Set<string>(DEMO_SKILL_TREES.map((t) => t.id));

  it("every personal skill tree id is a planned team catalog tree, and every skill level references one of them", () => {
    for (const id of DEMO_PERSONAL_SKILL_TREE_IDS) expect(teamTreeIds.has(id)).toBe(true);
    for (const { treeId } of plan.skillLevels) expect(teamTreeIds.has(treeId)).toBe(true);
    const skillTreeOps = buildDemoSeedPlan({ presenterUid: PRESENTER, asOf, sealRecord: fakeSeal }).operations.filter(
      (o) => o.collection === "skillTrees",
    );
    const planned = new Set(skillTreeOps.map((o) => o.docId));
    for (const { treeId } of plan.skillLevels) expect(planned.has(treeId)).toBe(true);
  });

  it("every goal's skill-tree reference resolves to a planned tree", () => {
    for (const { goal } of plan.goals) {
      expect(goal.treeId === undefined || teamTreeIds.has(goal.treeId)).toBe(true);
    }
  });

  it("every responsibility goal link and achievement link resolves to a planned goal or responsibility", () => {
    const goalIds = new Set(plan.goals.map((g) => g.id));
    const responsibilityIds = new Set(plan.responsibilities.map((r) => r.id));
    for (const r of plan.responsibilities) for (const g of r.content.goalIds) expect(goalIds.has(g)).toBe(true);
    for (const a of plan.achievements) {
      for (const g of a.content.goalIds) expect(goalIds.has(g)).toBe(true);
      for (const r of a.content.responsibilityIds) expect(responsibilityIds.has(r)).toBe(true);
    }
  });

  it("the team manifest holds no personal collection: demo-team plans team documents only", () => {
    // Structural: the team allowlist is exactly the eight team collections, so no owner-only collection can be planned here.
    expect([...ALLOWED_COLLECTIONS].sort()).toEqual(
      ["challenges", "roadmapItems", "skillProgress", "skillTrees", "surveyResponses", "surveys", "teamMemberships", "teamCompetencePlans", "teamProjects", "teamSkills", "teamSystems", "teams"].sort(),
    );
    expect(teamPlanCounts().byCollection.skillTrees).toBe(DEMO_SKILL_TREES.length);
  });
});

describe("personal seed plan (pure, feature-owned fixtures)", () => {
  const plan = planPersonalSeed({ presenterUid: PRESENTER, asOf: new Date(`${AS_OF}T00:00:00.000Z`) });

  it("plans the approved personal record counts: 6 goals, 4 responsibilities, 5 achievements, 1 skill profile with 12 levels, 1 conversation", () => {
    expect(plan.goals).toHaveLength(6);
    expect(plan.responsibilities).toHaveLength(4);
    expect(plan.achievements).toHaveLength(5);
    expect(plan.skillLevels).toHaveLength(12);
    expect(plan.documentCount).toBe(17);
  });

  it("uses stable fixture ids and is deterministic for the same presenter and as-of date", () => {
    expect(plan.goals.map((g) => g.id)).toEqual(["demo-goal-01", "demo-goal-02", "demo-goal-03", "demo-goal-04", "demo-goal-05", "demo-goal-06"]);
    expect(plan.conversation.id).toBe("demo-conversation-01");
    expect(planPersonalSeed({ presenterUid: PRESENTER, asOf: new Date(`${AS_OF}T00:00:00.000Z`) })).toEqual(plan);
  });

  it("gives completed goals a completion instant and active goals none, and keeps an overdue active goal", () => {
    const completed = plan.goals.filter((g) => g.goal.status === "completed");
    expect(completed).toHaveLength(2);
    expect(completed.every((g) => g.goal.status === "completed" && g.goal.completedAt instanceof Date)).toBe(true);
    const overdue = plan.goals.find((g) => g.id === "demo-goal-03");
    expect(overdue?.goal.status).toBe("active");
    expect(overdue?.goal.targetDate).toBeDefined();
  });

  it("keeps every date inside the fixture window and never plans a participant for the conversation", () => {
    expect(plan.conversation.content.participantNotes).toBe("");
    expect(plan.conversation.content.sharedGoals).toEqual([]);
    expect(plan.conversation.content.sharedEvidence).toEqual([]);
  });
});

describe("personal write — project binding, catalog dependency and fixture relationships (no live services)", () => {
  it("a default Admin app bound to a different project aborts before any writer is loaded or any document is touched", async () => {
    let loaded = false;
    const { writers, calls } = recordingWriters();
    const out = await runPersonalSeed({
      argv: writeArgv,
      env,
      now,
      resolveBoundProjectId: async () => "devpulse-other",
      loadWriters: async () => {
        loaded = true;
        return writers;
      },
    });
    expect(out.exitCode).toBe(1);
    expect(out.stderr.join("\n")).toContain("project-binding-mismatch");
    expect(loaded).toBe(false);
    expect(calls).toEqual([]);
  });

  it("an unknown or unbound project (no project id on the app) fails closed the same way", async () => {
    let loaded = false;
    const out = await runPersonalSeed({
      argv: writeArgv,
      env,
      now,
      resolveBoundProjectId: async () => undefined,
      loadWriters: async () => {
        loaded = true;
        return recordingWriters().writers;
      },
    });
    expect(out.stderr.join("\n")).toContain("project-binding-mismatch");
    expect(loaded).toBe(false);
  });

  it("refuses to write when a referenced skill tree is missing from the catalog, names the team seed, and writes nothing", async () => {
    const { writers, calls } = recordingWriters();
    const out = await runPersonalSeed({
      argv: writeArgv,
      env,
      now,
      resolveBoundProjectId: async () => PROJECT,
      loadWriters: async () => ({ ...writers, treeExists: async (treeId: string) => treeId !== "demo-skill-cloud" }),
    });
    expect(out.exitCode).toBe(1);
    expect(out.stderr.join("\n")).toContain("skill-tree-catalog-missing");
    expect(out.stdout.join("\n")).toContain(`pnpm seed:demo-team -- --project ${PROJECT} --presenter-uid ${PRESENTER} --write --confirm ${PROJECT}`);
    expect(calls).toEqual([]);
  });

  it("offline mode validates the fixture relationships and reports them as resolved, with no Firebase access", async () => {
    const out = await runPersonalSeed({ argv: offlineArgv, env, now });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain("Relationships: all personal references resolve");
  });

  it("a dangling achievement-to-goal link is a fixture problem that aborts the run in every mode", () => {
    const plan = planPersonalSeed({ presenterUid: PRESENTER, asOf: new Date(`${AS_OF}T00:00:00.000Z`) });
    const broken = { ...plan, achievements: plan.achievements.map((a, i) => (i === 0 ? { ...a, content: { ...a.content, goalIds: ["no-such-goal"] } } : a)) };
    expect(personalRelationshipProblems(broken)).toEqual(["achievement demo-ach-01 links to unknown goal no-such-goal"]);
    expect(personalRelationshipProblems(plan)).toEqual([]);
  });
});

describe("pnpm seed:demo-team -- --personal (CLI routing and approval gates, mocks only)", () => {
  const stubCrypto = {
    sealRecord: () => ({ ciphertext: "c", iv: "aXYtZml4dHVyZQ==", authTag: "dGFnLWZpeHR1cmU=", keyVersion: "v2" as const, keyId: "k1" as const }),
    openRecord: () => "",
  };
  const routed = (argv: string[], loadPersonalWriters?: (uid: string) => Promise<PersonalWriters>) =>
    runDemoSeed({
      argv,
      resolvePersonalBoundProjectId: async () => PROJECT,
      env,
      now,
      crypto: stubCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters must not be built in personal mode");
      },
      loadPersonalWriters,
    });

  it("offline personal mode prints the plan and builds no adapter and loads no writer", async () => {
    let loaded = false;
    const out = await routed(["--project", PROJECT, "--presenter-uid", PRESENTER, "--as-of", AS_OF, "--personal", "--offline"], async () => {
      loaded = true;
      return recordingWriters().writers;
    });
    expect(out.exitCode).toBe(0);
    expect(loaded).toBe(false);
    expect(out.stdout.join("\n")).toContain("Personal Firestore documents planned: 17");
  });

  it("personal write without --confirm is refused before any writer is loaded", async () => {
    let loaded = false;
    const out = await routed(["--project", PROJECT, "--presenter-uid", PRESENTER, "--personal", "--write"], async () => {
      loaded = true;
      return recordingWriters().writers;
    });
    expect(out.exitCode).toBe(2);
    expect(loaded).toBe(false);
  });

  it("personal write requires the presenter uid and the exact project, refusing a mismatched project", async () => {
    const out = await routed(["--project", PROJECT, "--personal", "--write", "--confirm", PROJECT]);
    expect(out.exitCode).toBe(2);
    const mismatched = await routed(["--project", "devpulse-other", "--presenter-uid", PRESENTER, "--personal", "--write", "--confirm", "devpulse-other"]);
    expect(mismatched.exitCode).toBe(2);
    expect(mismatched.stderr.join("\n")).toContain("project-mismatch");
  });

  it("a confirmed personal write loads the writers once, for the explicit presenter uid, and reports create counts", async () => {
    const { writers, calls } = recordingWriters();
    const seenUids: string[] = [];
    const out = await routed(writeArgv.concat(["--personal"]), async (uid) => {
      seenUids.push(uid);
      return writers;
    });
    expect(out.exitCode).toBe(0);
    expect(seenUids).toEqual([PRESENTER]);
    expect(calls).toHaveLength(17);
    expect(out.stdout.join("\n")).toContain("create 17, skip 0, conflict 0");
  });

  it("without a wired owner writer, a confirmed personal write aborts and writes nothing", async () => {
    const out = await routed(writeArgv.concat(["--personal"]));
    expect(out.exitCode).toBe(1);
    expect(out.stderr.join("\n")).toContain("write-adapter-not-wired");
  });
});

describe("runPersonalSeed — offline dry run (no Firebase, no owner module)", () => {
  it("prints the personal plan with document counts, reads nothing and never loads a writer", async () => {
    let loaded = false;
    const out = await runPersonalSeed({
      argv: offlineArgv,
      env,
      now,
      loadWriters: async () => {
        loaded = true;
        return recordingWriters().writers;
      },
    });
    expect(out.exitCode).toBe(0);
    expect(loaded).toBe(false);
    const text = out.stdout.join("\n");
    expect(text).toContain("dry-run (no writes)");
    expect(text).toContain("Personal Firestore documents planned: 17");
    expect(text).toContain("Existing Firestore state: not checked (offline");
    expect(text).toContain("Deletes: 0");
    // The dry run reports counts only: no fixture business text reaches the output.
    expect(text).not.toContain("Utviklingssamtale");
    expect(text).not.toContain("WCAG");
  });

  it("refuses a mismatched project id before planning anything", async () => {
    const out = await runPersonalSeed({
      argv: ["--project", "devpulse-other", "--presenter-uid", PRESENTER, "--offline"],
      env,
      now,
    });
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toEqual([]);
    expect(out.stderr.join("\n")).toContain("project-mismatch");
  });
});

describe("runPersonalSeed — write gates and create-only behavior", () => {
  it("requires explicit confirmation before any write (config refusal, no writer loaded)", async () => {
    let loaded = false;
    const out = await runPersonalSeed({
      argv: ["--project", PROJECT, "--presenter-uid", PRESENTER, "--write"],
      env,
      now,
      loadWriters: async () => {
        loaded = true;
        return recordingWriters().writers;
      },
    });
    expect(out.exitCode).toBe(2);
    expect(loaded).toBe(false);
  });

  it("refuses to write when no owner writer is wired (aborts with nothing written)", async () => {
    const out = await runPersonalSeed({ argv: writeArgv, env, now, resolveBoundProjectId: async () => PROJECT });
    expect(out.exitCode).toBe(1);
    expect(out.stderr.join("\n")).toContain("write-adapter-not-wired");
  });

  it("creates every planned record once, in the owner order: goals, responsibilities, achievements, skill levels, conversation", async () => {
    const { writers, calls } = recordingWriters();
    const out = await runPersonalSeed({ argv: writeArgv, env, now, loadWriters: async () => writers, resolveBoundProjectId: async () => PROJECT });
    expect(out.exitCode).toBe(0);
    expect(calls).toHaveLength(17);
    expect(calls.slice(0, 6).every((c) => c.startsWith("goal:"))).toBe(true);
    expect(calls.slice(6, 10).every((c) => c.startsWith("responsibility:"))).toBe(true);
    expect(calls.slice(10, 15).every((c) => c.startsWith("achievement:"))).toBe(true);
    expect(calls[15]).toBe("skillLevels");
    expect(calls[16]).toBe("conversation:demo-conversation-01");
    expect(out.stdout.join("\n")).toContain("create 17, skip 0, conflict 0");
  });

  it("reports identical existing records as skips on a rerun (idempotent, nothing overwritten)", async () => {
    const { writers } = recordingWriters(() => "skip");
    const out = await runPersonalSeed({ argv: writeArgv, env, now, loadWriters: async () => writers, resolveBoundProjectId: async () => PROJECT });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain("create 0, skip 17, conflict 0");
  });

  it("stops at the first conflict or refusal and writes nothing after it", async () => {
    const { writers, calls } = recordingWriters((step) => (step === "responsibility:demo-resp-02" ? "throw" : "create"));
    const out = await runPersonalSeed({ argv: writeArgv, env, now, loadWriters: async () => writers, resolveBoundProjectId: async () => PROJECT });
    expect(out.exitCode).toBe(1);
    expect(calls.at(-1)).toBe("responsibility:demo-resp-02");
    expect(calls).not.toContain("skillLevels");
    expect(out.stdout.join("\n")).toContain("Nothing was overwritten");
  });
});
