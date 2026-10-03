import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "../../lib/encryption/encryption";
import { effectiveChallengeStatus, isValidChallenge } from "../challenges/domain/challenge";
import { validateChallengeText } from "../challenges/domain/challenge-text";
import { computeSurveyAggregate } from "../results/domain/aggregation";
import { isRoadmapItemFor, parseRoadmapItem, roadmapItemDocId, type RoadmapItemRecord } from "../roadmap/domain/roadmap-item";
import { isTargetReached, validateTargetNode } from "../roadmap/domain/roadmap-target";
import { isValidSkillProgress } from "../skill-trees/domain/skill-progress";
import { isValidSkillTree } from "../skill-trees/domain/skill-tree";
import { validateSurveyAnswers } from "../surveys/domain/answers";
import { effectiveLifecycle, isValidSurvey } from "../surveys/domain/survey";
import { isValidTeamStatus } from "../teams/domain/team";
import { isValidMembershipFor } from "../teams/domain/team-membership";
import {
  buildDemoLogicalFixtures,
  DEMO_AUDIT_ACTOR,
  DEMO_TEAM_ID,
  DEMO_SURVEY_NEXT_ID,
  surveyPeriodDates,
} from "./fixtures";
import {
  ALLOWED_COLLECTIONS,
  assertAllowedEntry,
  assertManifestValid,
  assertOperationsMatchManifest,
  buildDemoManifest,
  buildDemoSeedPlan,
  type DemoEncrypt,
  type PlannedOperation,
} from "./plan";

const PRESENTER = "presenter-uid-fixture";
const AS_OF = new Date("2026-03-16T00:00:00.000Z");
const LATER_AS_OF = new Date("2026-03-30T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic, plaintext-free stand-in so whole plans can be compared for equality. */
const fakeEncrypt: DemoEncrypt = (plaintext) => {
  const digest = createHash("sha256").update(plaintext).digest("base64");
  return { ciphertext: digest, iv: "aXYtZml4dHVyZQ==", authTag: "dGFnLWZpeHR1cmU=", keyVersion: "v1" };
};

function plan(asOf = AS_OF, enc: DemoEncrypt = fakeEncrypt) {
  return buildDemoSeedPlan({ presenterUid: PRESENTER, asOf, encrypt: enc });
}

function opsIn(operations: readonly PlannedOperation[], collection: string) {
  return operations.filter((o) => o.collection === collection);
}

function countBy(operations: readonly PlannedOperation[]) {
  return Object.fromEntries(
    ALLOWED_COLLECTIONS.map((c) => [c, opsIn(operations, c).length]),
  );
}

describe("demo dataset shape", () => {
  const { operations, manifest } = plan();

  it("plans exactly 85 documents with the approved per-collection counts", () => {
    expect(operations).toHaveLength(85);
    expect(countBy(operations)).toEqual({
      teams: 1,
      teamMemberships: 1,
      surveys: 9,
      surveyResponses: 59,
      challenges: 5,
      skillTrees: 4,
      skillProgress: 3,
      roadmapItems: 3,
    });
  });

  it("uses exactly the approved deterministic id sets", () => {
    const ids = (c: string) => opsIn(operations, c).map((o) => o.docId);
    expect(ids("teams")).toEqual(["demo-team"]);
    expect(ids("teamMemberships")).toEqual([`${PRESENTER}__demo-team`]);
    expect(ids("surveys")).toEqual([
      ...Array.from({ length: 8 }, (_, i) => `demo-survey-0${i + 1}`),
      "demo-survey-next",
    ]);
    expect(ids("challenges")).toEqual(
      Array.from({ length: 5 }, (_, i) => `demo-challenge-0${i + 1}`),
    );
    expect(ids("skillTrees")).toEqual([
      "demo-skill-testing",
      "demo-skill-delivery",
      "demo-skill-observability",
      "demo-skill-secure-dev",
    ]);
    expect(ids("skillProgress")).toEqual([
      "demo-team__demo-skill-testing",
      "demo-team__demo-skill-delivery",
      "demo-team__demo-skill-observability",
    ]);
    expect(ids("roadmapItems")).toEqual([
      "demo-team__demo-skill-testing",
      "demo-team__demo-skill-observability",
      "demo-team__demo-skill-delivery",
    ]);
    expect(ids("surveyResponses")[0]).toBe("demo-response-s01-r01");
    expect(ids("surveyResponses").at(-1)).toBe("demo-response-s08-r08");
  });

  it("assigns the approved write classes (C for team, membership, scheduled survey, roadmap plans; U for the rest)", () => {
    const cPaths = operations.filter((o) => o.writeClass === "C").map((o) => o.path);
    expect(cPaths).toEqual([
      "teams/demo-team",
      `teamMemberships/${PRESENTER}__demo-team`,
      "surveys/demo-survey-next",
      "roadmapItems/demo-team__demo-skill-testing",
      "roadmapItems/demo-team__demo-skill-observability",
      "roadmapItems/demo-team__demo-skill-delivery",
    ]);
    expect(operations.filter((o) => o.writeClass === "U")).toHaveLength(79);
  });

  it("has an explicit manifest of 85 unique, allow-listed paths that the plan matches exactly", () => {
    expect(manifest).toHaveLength(85);
    expect(new Set(manifest.map((m) => m.path)).size).toBe(85);
    expect(new Set(manifest.map((m) => m.collection))).toEqual(new Set(ALLOWED_COLLECTIONS));
    expect(operations.map((o) => o.path)).toEqual(manifest.map((m) => m.path));
    expect(() => assertOperationsMatchManifest(operations, manifest)).not.toThrow();
    expect(buildDemoManifest(PRESENTER)).toEqual(manifest);
  });
});

describe("manifest guard", () => {
  it("rejects Forum collections and arbitrary unknown collections", () => {
    for (const collection of ["forumThreads", "forumReplies", "somethingElse", "teamSurveyState", "surveyParticipations"]) {
      expect(() =>
        assertAllowedEntry({ collection, docId: "x", path: `${collection}/x` }),
      ).toThrow(/not allow-listed/);
    }
    expect(ALLOWED_COLLECTIONS.some((c) => c.startsWith("forum"))).toBe(false);
  });

  it("rejects malformed paths, wildcards-by-shape and duplicates", () => {
    expect(() => assertAllowedEntry({ collection: "teams", docId: "a/b", path: "teams/a/b" })).toThrow();
    expect(() => assertAllowedEntry({ collection: "teams", docId: "a", path: "surveys/a" })).toThrow();
    const [first] = buildDemoManifest(PRESENTER);
    expect(() => assertManifestValid([first, first])).toThrow(/duplicate/);
  });

  it("rejects a plan operation that is outside the manifest or missing from it", () => {
    const { operations, manifest } = plan();
    const stray: PlannedOperation = { ...operations[0], docId: "other-team", path: "teams/other-team" };
    expect(() => assertOperationsMatchManifest([...operations, stray], manifest)).toThrow(/not in the manifest/);
    expect(() => assertOperationsMatchManifest(operations.slice(1), manifest)).toThrow(/exactly/);
  });

  it("rejects an invalid presenter uid", () => {
    for (const uid of ["", " ", "a/b", "..", "x".repeat(129)]) {
      expect(() => buildDemoManifest(uid)).toThrow();
    }
  });
});

describe("surveys and dates", () => {
  const { operations } = plan();
  const surveys = opsIn(operations, "surveys");

  it("has eight closed historical surveys and one scheduled survey under the real lifecycle derivation", () => {
    const now = AS_OF;
    const lifecycles = surveys.map((s) => effectiveLifecycle(s.data as { openedAt?: Date; closedAt?: Date }, now));
    expect(lifecycles.filter((l) => l === "closed")).toHaveLength(8);
    expect(lifecycles.filter((l) => l === "scheduled")).toHaveLength(1);
    const next = surveys.find((s) => s.docId === DEMO_SURVEY_NEXT_ID);
    expect(next).toBeDefined();
    expect(effectiveLifecycle(next!.data as { openedAt?: Date }, now)).toBe("scheduled");
    // lifecycle is derived from stored timestamps, so it cannot flip with the clock
    expect(effectiveLifecycle(surveys[0].data as { closedAt?: Date }, new Date("1999-01-01"))).toBe("closed");
  });

  it("satisfies the real survey validator (id supplied separately, as the read paths do)", () => {
    for (const s of surveys) {
      expect(isValidSurvey({ ...(s.data as object), surveyId: s.docId }, { surveyId: s.docId })).toBe(true);
      expect((s.data as { teamId: string }).teamId).toBe("demo-team");
      expect(s.data).not.toHaveProperty("surveyId");
    }
  });

  it("follows the SPEC date formulas and keeps every response strictly inside its open window", () => {
    const p8 = surveyPeriodDates(AS_OF, 8);
    expect(p8.closedAt.getTime()).toBe(AS_OF.getTime() + 12 * 3600_000 - 2 * DAY_MS);
    expect(p8.openedAt.getTime()).toBe(p8.closedAt.getTime() - 7 * DAY_MS);
    expect(p8.createdAt.getTime()).toBe(p8.openedAt.getTime() - DAY_MS);
    expect(surveyPeriodDates(AS_OF, 1).closedAt.getTime()).toBe(p8.closedAt.getTime() - 7 * 14 * DAY_MS);

    const next = surveys.find((s) => s.docId === DEMO_SURVEY_NEXT_ID)!.data as { createdAt: Date };
    expect(next.createdAt.getTime()).toBe(AS_OF.getTime() - DAY_MS);

    for (const r of opsIn(operations, "surveyResponses")) {
      const data = r.data as { surveyId: string; submittedAt: Date };
      const survey = surveys.find((s) => s.docId === data.surveyId)!.data as { openedAt: Date; closedAt: Date };
      expect(data.submittedAt.getTime()).toBeGreaterThan(survey.openedAt.getTime());
      expect(data.submittedAt.getTime()).toBeLessThan(survey.closedAt.getTime());
    }
  });

  it("requires a valid midnight-UTC as-of, works across month/leap boundaries, and never reads the clock", () => {
    for (const bad of [new Date("invalid"), new Date("2026-03-16T00:00:00.001Z"), new Date("2026-03-16T12:00:00Z")]) {
      expect(() => plan(bad)).toThrow(/midnight UTC/);
    }
    const leap = plan(new Date("2028-02-29T00:00:00.000Z"));
    expect(leap.operations).toHaveLength(85);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
    try {
      expect(plan()).toEqual(plan());
      expect(buildDemoLogicalFixtures({ presenterUid: PRESENTER, asOf: AS_OF }).team.createdAt).toEqual(AS_OF);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("responses, threshold and trend (real encryption + real aggregation)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("distributes 59 responses as 8 per publishable period and 3 in period 3, none in the scheduled survey", () => {
    const responses = opsIn(plan(AS_OF, encrypt).operations, "surveyResponses");
    expect(responses).toHaveLength(59);
    const perSurvey = new Map<string, number>();
    for (const r of responses) {
      const id = (r.data as { surveyId: string }).surveyId;
      perSurvey.set(id, (perSurvey.get(id) ?? 0) + 1);
    }
    expect(perSurvey.size).toBe(8);
    expect(perSurvey.get("demo-survey-03")).toBe(3);
    for (const [id, n] of perSurvey) {
      if (id !== "demo-survey-03") expect(n).toBe(8);
    }
    expect(perSurvey.has(DEMO_SURVEY_NEXT_ID)).toBe(false);
  });

  it("publishes 7 periods, suppresses period 3 via the real threshold, publishes the latest, and trends the intended way", () => {
    const { operations } = plan(AS_OF, encrypt);
    const responses = opsIn(operations, "surveyResponses");
    const results = Array.from({ length: 8 }, (_, i) => {
      const surveyId = `demo-survey-0${i + 1}`;
      const candidates = responses
        .filter((r) => (r.data as { surveyId: string }).surveyId === surveyId)
        .map((r) => r.data as { ciphertext: string; iv: string; authTag: string; keyVersion: "v1" });
      return computeSurveyAggregate(surveyId, candidates, 5);
    });

    expect(results.map((r) => r.status)).toEqual([
      "published", "published", "insufficient", "published", "published", "published", "published", "published",
    ]);
    const published = results.flatMap((r) => (r.status === "published" ? [r] : []));
    expect(published).toHaveLength(7);
    expect(published.every((r) => r.count === 8)).toBe(true);
    expect(results[7].status).toBe("published");

    const first = published[0].mean;
    const last = published[published.length - 1].mean;
    expect(last.flow).toBeGreaterThan(first.flow);
    expect(last.fun).toBeGreaterThan(first.fun);
    expect(last.stress).toBeLessThan(first.stress);
    // Overall direction across all published periods (least-squares slope sign).
    const slope = (values: number[]) => {
      const n = values.length;
      const xs = values.map((_, i) => i);
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = values.reduce((a, b) => a + b, 0) / n;
      return xs.reduce((s, x, i) => s + (x - mx) * (values[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    };
    expect(slope(published.map((r) => r.mean.flow))).toBeGreaterThan(0);
    expect(slope(published.map((r) => r.mean.fun))).toBeGreaterThan(0);
    expect(slope(published.map((r) => r.mean.stress))).toBeLessThan(0);
  });

  it("keeps per-dimension means within ±0.13 of the approved targets and every answer in 1–5 with spread", () => {
    const targets = [
      [3.1, 3.9, 3.0], [3.2, 3.8, 3.2], null, [3.4, 3.5, 3.3], [3.6, 3.3, 3.5], [3.5, 3.2, 3.6], [3.8, 2.9, 3.7], [3.9, 2.7, 3.9],
    ];
    const responses = opsIn(plan(AS_OF, encrypt).operations, "surveyResponses");
    for (let p = 1; p <= 8; p++) {
      const answers = responses
        .filter((r) => (r.data as { surveyId: string }).surveyId === `demo-survey-0${p}`)
        .map((r) => {
          const parsed = validateSurveyAnswers(JSON.parse(decrypt(r.data as never)));
          expect(parsed.ok).toBe(true);
          return parsed.ok ? parsed.data : [0, 0, 0];
        });
      for (let d = 0; d < 3; d++) {
        expect(new Set(answers.map((a) => a[d])).size).toBeGreaterThanOrEqual(2);
        const target = targets[p - 1]?.[d];
        if (target !== undefined) {
          const mean = answers.reduce((s, a) => s + a[d], 0) / answers.length;
          expect(Math.abs(mean - target)).toBeLessThanOrEqual(0.13);
        }
      }
    }
  });
});

describe("challenges", () => {
  const { operations } = plan();
  const challenges = opsIn(operations, "challenges");

  it("has 3 open, 1 resolved and 1 archived challenge valid under the real validator", () => {
    const statuses = challenges.map((c) => effectiveChallengeStatus(c.data as { resolvedAt?: Date; archivedAt?: Date }));
    expect(statuses).toEqual(["open", "open", "open", "resolved", "archived"]);
    for (const c of challenges) {
      expect(isValidChallenge({ ...(c.data as object), challengeId: c.docId }, { challengeId: c.docId })).toBe(true);
      expect(c.data).not.toHaveProperty("challengeId");
    }
  });

  it("uses valid, non-identifying logical text and stores only ciphertext", () => {
    const { challenges: logical } = buildDemoLogicalFixtures({ presenterUid: PRESENTER, asOf: AS_OF });
    expect(logical).toHaveLength(5);
    for (const c of logical) {
      expect(validateChallengeText(c.text)).toEqual({ ok: true, text: c.text });
      expect(JSON.stringify(operations)).not.toContain(c.text);
    }
  });

  it("carries no submitter identity and the approved audit actor only on resolved/archived", () => {
    const allowed = ["teamId", "ciphertext", "iv", "authTag", "keyVersion", "submittedAt", "resolvedAt", "resolvedBy", "archivedAt", "archivedBy"];
    for (const c of challenges) {
      expect(Object.keys(c.data as object).every((k) => allowed.includes(k))).toBe(true);
    }
    expect(challenges[3].data).toMatchObject({ resolvedBy: DEMO_AUDIT_ACTOR });
    expect(challenges[4].data).toMatchObject({ archivedBy: DEMO_AUDIT_ACTOR });
    expect(challenges[3].data).not.toHaveProperty("archivedAt");
  });
});

describe("skill trees and progress", () => {
  const { operations } = plan();
  const trees = opsIn(operations, "skillTrees");
  const progress = opsIn(operations, "skillProgress");
  const nodesOf = (docId: string) =>
    (trees.find((t) => t.docId === docId)!.data as { nodes: { nodeId: string }[] }).nodes;

  it("has four valid, linear, org-wide 'Demo – ' trees with the approved stage counts", () => {
    expect(trees.map((t) => (t.data as { name: string }).name)).toEqual([
      "Demo – Testautomatisering", "Demo – Leveranse", "Demo – Observerbarhet", "Demo – Sikker utvikling",
    ]);
    expect(trees.map((t) => nodesOf(t.docId).length)).toEqual([5, 6, 4, 4]);
    for (const t of trees) {
      expect(isValidSkillTree(t.data)).toBe(true);
      expect(Object.keys(t.data as object).sort()).toEqual(["createdAt", "createdBy", "name", "nodes"]);
      expect(t.data).not.toHaveProperty("updatedBy");
    }
  });

  it("has exactly three team-level progress records; secure-dev is untracked", () => {
    expect(progress).toHaveLength(3);
    const byTree = new Map(progress.map((p) => [(p.data as { treeId: string }).treeId, p.data as { currentNodeId: string | null }]));
    expect(byTree.get("demo-skill-testing")?.currentNodeId).toBe("node-2"); // middle of 5
    expect(byTree.get("demo-skill-delivery")?.currentNodeId).toBe("node-4"); // per SPEC
    expect(byTree.get("demo-skill-observability")?.currentNodeId).toBeNull();
    expect(byTree.has("demo-skill-secure-dev")).toBe(false);
    expect(progress.some((p) => p.docId.includes("secure-dev"))).toBe(false);
  });

  it("references real nodes, satisfies the real progress validator and holds no individual data", () => {
    for (const p of progress) {
      const data = p.data as { teamId: string; treeId: string; currentNodeId: string | null };
      expect(isValidSkillProgress(p.data)).toBe(true);
      expect(data.teamId).toBe("demo-team");
      expect(p.docId).toBe(`demo-team__${data.treeId}`);
      if (data.currentNodeId !== null) {
        expect(nodesOf(data.treeId).map((n) => n.nodeId)).toContain(data.currentNodeId);
      }
      expect(Object.keys(p.data as object).sort()).toEqual(["currentNodeId", "teamId", "treeId", "updatedAt", "updatedBy"]);
    }
  });
});

describe("team, membership, presenter uid and privacy", () => {
  const { operations } = plan();
  const [team, membership] = operations;

  it("plans one active Demoteam and one presenter membership valid under the real validators", () => {
    expect(team.data).toMatchObject({ name: "Demoteam", status: "active", createdBy: DEMO_AUDIT_ACTOR });
    expect(isValidTeamStatus((team.data as { status: string }).status)).toBe(true);
    expect(membership.data).toMatchObject({
      uid: PRESENTER, teamId: "demo-team", createdVia: "admin_direct", grantedBy: DEMO_AUDIT_ACTOR,
    });
    expect(isValidMembershipFor(membership.data, { uid: PRESENTER, teamId: "demo-team" })).toBe(true);
  });

  it("uses the presenter uid only as the membership uid/doc id", () => {
    const withUid = operations.filter((o) => JSON.stringify(o).includes(PRESENTER));
    expect(withUid.map((o) => o.collection)).toEqual(["teamMemberships"]);
    expect(JSON.stringify(membership).split(PRESENTER).length - 1).toBe(3); // docId, path, data.uid
  });

  it("writes demo-seed only into the approved actor fields", () => {
    const actorKeys = new Set<string>();
    for (const o of operations) {
      for (const [k, v] of Object.entries(o.data as object)) {
        if (v === DEMO_AUDIT_ACTOR) actorKeys.add(`${o.collection}.${k}`);
      }
    }
    expect([...actorKeys].sort()).toEqual([
      "challenges.archivedBy", "challenges.resolvedBy", "roadmapItems.createdBy", "roadmapItems.updatedBy", "skillProgress.updatedBy",
      "skillTrees.createdBy", "surveys.createdBy", "teamMemberships.grantedBy", "teams.createdBy",
    ]);
  });

  it("gives survey responses exactly the seven approved fields and no identity or ownership marker", () => {
    for (const r of opsIn(operations, "surveyResponses")) {
      expect(Object.keys(r.data as object).sort()).toEqual(
        ["authTag", "ciphertext", "iv", "keyVersion", "submittedAt", "surveyId", "teamId"],
      );
    }
    const text = JSON.stringify(operations);
    for (const forbidden of ["seedOwner", "isDemo", "fixtureOwner", "email"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toMatch(/forum/i);
    expect(opsIn(operations, "users")).toHaveLength(0);
  });
});

describe("determinism", () => {
  it("yields identical ids, paths, classes and logical values for identical inputs", () => {
    const a = plan();
    const b = plan();
    expect(a).toEqual(b);
    expect(buildDemoLogicalFixtures({ presenterUid: PRESENTER, asOf: AS_OF })).toEqual(
      buildDemoLogicalFixtures({ presenterUid: PRESENTER, asOf: AS_OF }),
    );
  });

  it("keeps ids, paths and classes stable across as-of dates while only timestamps move", () => {
    const a = plan(AS_OF);
    const b = plan(LATER_AS_OF);
    const identity = (p: ReturnType<typeof plan>) => p.operations.map((o) => [o.path, o.writeClass]);
    expect(identity(b)).toEqual(identity(a));
    expect(b.manifest).toEqual(a.manifest);

    const strip = (p: ReturnType<typeof plan>) =>
      JSON.stringify(p.operations, (_k, v) => (typeof v === "string" && /^\d{4}-\d\d-\d\d(T|$)/.test(v) ? "<date>" : v));
    expect(strip(b)).toBe(strip(a));
    expect(JSON.stringify(b.operations)).not.toBe(JSON.stringify(a.operations));

    const shift = (LATER_AS_OF.getTime() - AS_OF.getTime());
    const closedA = (a.operations.find((o) => o.docId === "demo-survey-08")!.data as { closedAt: Date }).closedAt;
    const closedB = (b.operations.find((o) => o.docId === "demo-survey-08")!.data as { closedAt: Date }).closedAt;
    expect(closedB.getTime() - closedA.getTime()).toBe(shift);
  });

  it("produces fresh ciphertext with the real encrypt but the same logical plan", () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    try {
      const a = plan(AS_OF, encrypt);
      const b = plan(AS_OF, encrypt);
      expect(a.operations.map((o) => o.path)).toEqual(b.operations.map((o) => o.path));
      expect((a.operations[12].data as { ciphertext: string }).ciphertext).not.toBe(
        (b.operations[12].data as { ciphertext: string }).ciphertext,
      );
      expect(decrypt(a.operations[12].data as never)).toBe(decrypt(b.operations[12].data as never));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("roadmap plan fixtures (team-skill-planning TASK-011)", () => {
  const { operations } = plan();
  const items = opsIn(operations, "roadmapItems");
  const record = (treeId: string) =>
    items.find((o) => o.docId === roadmapItemDocId(DEMO_TEAM_ID, treeId))!.data as RoadmapItemRecord;
  const fixtures = buildDemoLogicalFixtures({ presenterUid: PRESENTER, asOf: AS_OF });
  const tree = (treeId: string) => fixtures.skillTrees.find((t) => t.id === treeId)!.record;
  const current = (treeId: string) => fixtures.skillProgress.find((p) => p.treeId === treeId)!.record.currentNodeId;

  it("has exactly three plans at the deterministic id, all parseable by the roadmap domain", () => {
    expect(items.map((o) => o.docId)).toEqual([
      "demo-team__demo-skill-testing",
      "demo-team__demo-skill-observability",
      "demo-team__demo-skill-delivery",
    ]);
    for (const o of items) {
      const parsed = parseRoadmapItem(o.data);
      expect(parsed).not.toBeNull();
      expect(isRoadmapItemFor(parsed!, o.docId, DEMO_TEAM_ID, parsed!.treeId)).toBe(true);
      expect(o.writeClass).toBe("C");
    }
  });

  it("targets a node of the exact tree, ahead of the tracked stage (delivery is reached)", () => {
    for (const o of items) {
      const r = o.data as RoadmapItemRecord;
      expect(tree(r.treeId).nodes.map((n) => n.nodeId)).toContain(r.targetNodeId);
    }
    expect(validateTargetNode(tree("demo-skill-testing"), current("demo-skill-testing"), "node-4")).toEqual({ ok: true });
    expect(validateTargetNode(tree("demo-skill-observability"), current("demo-skill-observability"), "node-2")).toEqual({ ok: true });
    expect(isTargetReached(tree("demo-skill-delivery"), current("demo-skill-delivery"), "node-4")).toBe(true);
    expect(isTargetReached(tree("demo-skill-testing"), current("demo-skill-testing"), "node-4")).toBe(false);
  });

  it("has the approved status, priority and dates", () => {
    expect(record("demo-skill-testing")).toMatchObject({
      status: "active",
      priority: "high",
      startDate: "2026-03-02",
      targetDate: "2026-05-15",
    });
    expect(record("demo-skill-observability")).toMatchObject({ status: "planned", priority: "medium" });
    expect(record("demo-skill-delivery")).toMatchObject({ status: "completed", priority: "low", completedAt: AS_OF });
    expect(record("demo-skill-observability").startDate).toBeUndefined();
    expect(record("demo-skill-observability").targetDate).toBeUndefined();
    expect(record("demo-skill-delivery").targetDate).toBeUndefined();
    expect(record("demo-skill-testing").completedAt).toBeUndefined();
  });

  it("is unassigned and carries no identity or derived presentation field", () => {
    const allowed = new Set([
      "teamId", "treeId", "targetNodeId", "priority", "status", "startDate", "targetDate",
      "completedAt", "createdAt", "createdBy", "updatedAt", "updatedBy",
    ]);
    for (const o of items) {
      expect(Object.keys(o.data as object).every((k) => allowed.has(k))).toBe(true);
      expect(o.data).not.toHaveProperty("ownerRef");
      expect(JSON.stringify(o)).not.toContain(PRESENTER);
      expect((o.data as RoadmapItemRecord).createdBy).toBe(DEMO_AUDIT_ACTOR);
      expect((o.data as RoadmapItemRecord).updatedBy).toBe(DEMO_AUDIT_ACTOR);
    }
  });

  it("leaves the presenter membership free of any member reference, and adds no member", () => {
    const memberships = opsIn(operations, "teamMemberships");
    expect(memberships).toHaveLength(1);
    expect(memberships[0].data).not.toHaveProperty("memberRef");
  });

  it("moves only the dated plan's dates with as-of", () => {
    const later = opsIn(plan(LATER_AS_OF).operations, "roadmapItems");
    const startAt = (x: readonly PlannedOperation[]) => (x[0].data as RoadmapItemRecord).startDate;
    expect(startAt(later)).toBe("2026-03-16");
    expect((later[0].data as RoadmapItemRecord).targetDate).toBe("2026-05-29");
    expect(JSON.stringify(later.slice(1))).toBe(JSON.stringify(items.slice(1)).replaceAll("2026-03-16", "2026-03-30"));
  });
});
