import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { DEMO_SKILL_TREES } from "../fixtures";
import { isRoadmapPriority, isRoadmapStatus, type RoadmapPriority, type RoadmapStatus } from "../../roadmap/domain/roadmap-item";
import { isValidPlanDate, validatePlanDateRange } from "../../roadmap/domain/roadmap-dates";

/**
 * Additional team roadmap plans for the demo team (Phase E). A roadmap plan is one per (team, competency area), so every entry
 * here targets a tree that has no plan yet. The three existing plans (testing, observability, delivery) are never touched.
 * Each plan has one responsible member (`ownerUid`, resolved to that member's existing memberRef at run time). Dates are fixed
 * ISO dates, so reruns compute the same document. The roadmap model has no title or free-text field, so nothing human-readable is written.
 */
export interface DemoRoadmapPlan {
  treeId: string;
  targetNodeId: string;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  startDate: string;
  targetDate: string;
  ownerUid: string;
}

/** Trees that already hold a team plan in the live demo (see `DEMO_ROADMAP_PLANS` in `../fixtures.ts`). */
export const EXISTING_ROADMAP_TREE_IDS: readonly string[] = Object.freeze([
  "demo-skill-testing",
  "demo-skill-observability",
  "demo-skill-delivery",
]);

export const DEMO_ROADMAP_EXPANSION: readonly DemoRoadmapPlan[] = Object.freeze([
  { treeId: "demo-skill-api", targetNodeId: "node-2", status: "active", priority: "high", startDate: "2026-10-05", targetDate: "2027-02-26", ownerUid: "demo-member-02" },
  { treeId: "demo-skill-accessibility", targetNodeId: "node-2", status: "active", priority: "high", startDate: "2026-10-19", targetDate: "2027-01-29", ownerUid: "demo-member-04" },
  { treeId: "demo-skill-secure-dev", targetNodeId: "node-2", status: "planned", priority: "high", startDate: "2026-12-01", targetDate: "2027-03-31", ownerUid: "demo-member-06" },
  { treeId: "demo-skill-data", targetNodeId: "node-2", status: "active", priority: "medium", startDate: "2026-09-21", targetDate: "2027-02-12", ownerUid: "demo-member-07" },
  { treeId: "demo-skill-cloud", targetNodeId: "node-1", status: "planned", priority: "medium", startDate: "2027-01-11", targetDate: "2027-05-28", ownerUid: "demo-member-05" },
  { treeId: "demo-skill-incident", targetNodeId: "node-1", status: "planned", priority: "medium", startDate: "2026-11-30", targetDate: "2027-03-12", ownerUid: "demo-member-08" },
]);

export interface RoadmapFixtureProblem {
  category: "count" | "tree" | "existing-tree" | "duplicate-tree" | "target-node" | "status" | "priority" | "dates" | "owner";
  subject: string;
}

/** Offline validation of the roadmap expansion fixtures. Never throws. */
export function validateDemoRoadmapExpansion(
  plans: readonly DemoRoadmapPlan[] = DEMO_ROADMAP_EXPANSION,
): RoadmapFixtureProblem[] {
  const problems: RoadmapFixtureProblem[] = [];
  if (plans.length < 4 || plans.length > 6) problems.push({ category: "count", subject: String(plans.length) });

  const trees = new Map<string, number>(DEMO_SKILL_TREES.map((tree) => [tree.id, tree.labels.length]));
  const uids = new Set(DEMO_MEMBER_IDENTITIES.map((identity) => identity.uid));
  const seen = new Set<string>();
  for (const plan of plans) {
    const subject = plan.treeId;
    const labelCount = trees.get(plan.treeId);
    if (labelCount === undefined) problems.push({ category: "tree", subject });
    if (EXISTING_ROADMAP_TREE_IDS.includes(plan.treeId)) problems.push({ category: "existing-tree", subject });
    if (seen.has(plan.treeId)) problems.push({ category: "duplicate-tree", subject });
    seen.add(plan.treeId);

    const match = /^node-(\d+)$/.exec(plan.targetNodeId);
    if (labelCount === undefined || match === null || Number(match[1]) >= labelCount) {
      problems.push({ category: "target-node", subject });
    }
    if (!isRoadmapStatus(plan.status)) problems.push({ category: "status", subject });
    if (!isRoadmapPriority(plan.priority)) problems.push({ category: "priority", subject });
    if (!isValidPlanDate(plan.startDate) || !isValidPlanDate(plan.targetDate) || !validatePlanDateRange(plan.startDate, plan.targetDate)) {
      problems.push({ category: "dates", subject });
    }
    if (!uids.has(plan.ownerUid)) problems.push({ category: "owner", subject });
  }
  return problems;
}
