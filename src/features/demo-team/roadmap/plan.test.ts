import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { roadmapItemDocId } from "../../roadmap/domain/roadmap-item";
import { openRoadmapItemDocument, toPersistedRoadmapItem } from "../../roadmap/domain/roadmap-item-content-codec";
import { DEMO_ROADMAP_EXPANSION, validateDemoRoadmapExpansion, type DemoRoadmapPlan } from "./fixtures";
import { planRoadmapExpansion, type ObservedMembership, type ObservedRoadmapItem, type RoadmapPlanInput } from "./plan";

const TEAM = "8yB2bS8Jav69TCfDETON";
const NOW = new Date("2026-11-16T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
afterEach(() => vi.unstubAllEnvs());

/** A live-shaped ordinary membership with a valid memberRef. */
function membershipOf(uid: string, memberRef: string | undefined) {
  return { uid, teamId: TEAM, role: undefined, ...(memberRef === undefined ? {} : { memberRef }), docId: `${uid}__${TEAM}` };
}

function refFor(uid: string): string {
  return uid.slice(-2).padStart(26, "0");
}

function baseInput(overrides: Partial<RoadmapPlanInput> = {}): RoadmapPlanInput {
  const members = new Map<string, ObservedMembership>();
  for (const identity of DEMO_MEMBER_IDENTITIES) {
    members.set(identity.uid, { membership: membershipOf(identity.uid, refFor(identity.uid)) });
  }
  const trees = new Map<string, boolean>(DEMO_ROADMAP_EXPANSION.map((p) => [p.treeId, true] as const));
  return {
    teamId: TEAM,
    now: NOW,
    members,
    teamMemberships: [...members.values()].map((m) => m.membership),
    erasing: new Set(),
    skillTrees: trees,
    roadmapItems: new Map(),
    openRecord: demoCrypto.openRecord,
    sealRecord: demoCrypto.sealRecord,
    ...overrides,
  };
}

/** The stored form the runner would read back for a plan that was already created by this seed. */
function storedFor(plan: DemoRoadmapPlan, input: RoadmapPlanInput): ObservedRoadmapItem {
  const ownerRef = refFor(plan.ownerUid);
  const record = {
    teamId: TEAM,
    treeId: plan.treeId,
    targetNodeId: plan.targetNodeId,
    priority: plan.priority,
    status: plan.status,
    startDate: plan.startDate,
    targetDate: plan.targetDate,
    ownerRef,
    createdAt: NOW,
    createdBy: "demo-seed",
    updatedAt: NOW,
    updatedBy: "demo-seed",
  };
  return { raw: toPersistedRoadmapItem({ ...record }, input.sealRecord) };
}

/** A fresh members map in which one owner's observed membership is replaced. */
function withOwner(uid: string, observed: ObservedMembership): ReadonlyMap<string, ObservedMembership> {
  const members = new Map<string, ObservedMembership>();
  for (const identity of DEMO_MEMBER_IDENTITIES) {
    members.set(identity.uid, identity.uid === uid ? observed : { membership: membershipOf(identity.uid, refFor(identity.uid)) });
  }
  return members;
}

describe("roadmap expansion fixtures", () => {
  it("are valid and target only trees without an existing plan", () => {
    expect(validateDemoRoadmapExpansion()).toEqual([]);
    expect(DEMO_ROADMAP_EXPANSION.length).toBeGreaterThanOrEqual(4);
    expect(DEMO_ROADMAP_EXPANSION.length).toBeLessThanOrEqual(6);
  });

  it("reject an existing team tree, a missing tree, an out-of-range node and an unknown owner", () => {
    const bad: DemoRoadmapPlan[] = [
      { ...DEMO_ROADMAP_EXPANSION[0], treeId: "demo-skill-testing" },
      { ...DEMO_ROADMAP_EXPANSION[1], treeId: "demo-skill-unknown" },
      { ...DEMO_ROADMAP_EXPANSION[2], targetNodeId: "node-9" },
      { ...DEMO_ROADMAP_EXPANSION[3], ownerUid: "demo-member-99" },
    ];
    const categories = validateDemoRoadmapExpansion([...bad, DEMO_ROADMAP_EXPANSION[4]]).map((p) => p.category);
    expect(categories).toEqual(expect.arrayContaining(["existing-tree", "tree", "target-node", "owner"]));
  });
});

describe("planRoadmapExpansion", () => {
  it("creates every plan on a fresh team, with the owner's existing memberRef", () => {
    const plan = planRoadmapExpansion(baseInput());
    expect(plan.noConflicts).toBe(true);
    expect(plan.counts).toEqual({ create: DEMO_ROADMAP_EXPANSION.length, skip: 0, conflict: 0 });
    const first = plan.entries[0];
    expect(first.record?.ownerRef).toBe(refFor(DEMO_ROADMAP_EXPANSION[0].ownerUid));
    expect(first.docId).toBe(roadmapItemDocId(TEAM, DEMO_ROADMAP_EXPANSION[0].treeId));
    expect(first.record?.createdBy).toBe("demo-seed");
  });

  it("never writes business content in plaintext and seals the owner through the index", () => {
    const plan = planRoadmapExpansion(baseInput());
    for (const entry of plan.entries) {
      expect(entry.persisted).toBeDefined();
      const persisted = entry.persisted ?? {};
      for (const key of ["targetNodeId", "priority", "status", "startDate", "targetDate", "ownerRef"]) {
        expect(persisted).not.toHaveProperty(key);
      }
      expect(JSON.stringify(persisted)).not.toContain(refFor(entry.ownerUid));
      expect(persisted).toHaveProperty("ownerRefIndex");
      expect(openRoadmapItemDocument(persisted, demoCrypto.openRecord)).not.toBeNull();
    }
  });

  it("skips identical stored plans (idempotent rerun) and conflicts on any differing field", () => {
    const input = baseInput();
    const roadmapItems = new Map<string, ObservedRoadmapItem>();
    for (const plan of DEMO_ROADMAP_EXPANSION) {
      roadmapItems.set(roadmapItemDocId(TEAM, plan.treeId), storedFor(plan, input));
    }
    const rerun = planRoadmapExpansion(baseInput({ roadmapItems }));
    expect(rerun.counts).toEqual({ create: 0, skip: DEMO_ROADMAP_EXPANSION.length, conflict: 0 });

    const changed = new Map(roadmapItems);
    const first = DEMO_ROADMAP_EXPANSION[0];
    changed.set(roadmapItemDocId(TEAM, first.treeId), storedFor({ ...first, priority: first.priority === "low" ? "high" : "low" }, input));
    const differ = planRoadmapExpansion(baseInput({ roadmapItems: changed }));
    expect(differ.entries[0]).toMatchObject({ action: "conflict", reason: "roadmap-item-differs" });
    expect(differ.noConflicts).toBe(false);
  });

  it("conflicts instead of overwriting when an unreadable document occupies the id", () => {
    const roadmapItems = new Map<string, ObservedRoadmapItem>([[roadmapItemDocId(TEAM, DEMO_ROADMAP_EXPANSION[0].treeId), { raw: { garbage: true } }]]);
    const plan = planRoadmapExpansion(baseInput({ roadmapItems }));
    expect(plan.entries[0]).toMatchObject({ action: "conflict", reason: "roadmap-item-differs" });
  });

  it("conflicts when the owner has no membership, is erasing, or lacks a memberRef", () => {
    const owner = DEMO_ROADMAP_EXPANSION[0].ownerUid;
    const missing = baseInput({ members: withOwner(owner, { membership: undefined }) });
    expect(planRoadmapExpansion(missing).entries[0]).toMatchObject({ reason: "owner-membership-missing" });

    const erasing = baseInput({ erasing: new Set([owner]) });
    expect(planRoadmapExpansion(erasing).entries[0]).toMatchObject({ reason: "erasure-record-present" });

    const noRef = baseInput({ members: withOwner(owner, { membership: membershipOf(owner, undefined) }) });
    expect(planRoadmapExpansion(noRef).entries[0]).toMatchObject({ reason: "owner-member-ref-missing" });
  });

  it("conflicts when a memberRef is shared by another membership of the team", () => {
    const owner = DEMO_ROADMAP_EXPANSION[0].ownerUid;
    const other = DEMO_MEMBER_IDENTITIES.find((i) => i.uid !== owner)!.uid;
    const shared = baseInput();
    shared.teamMemberships = [...shared.teamMemberships, membershipOf(other, refFor(owner))];
    expect(planRoadmapExpansion(shared).entries[0]).toMatchObject({ reason: "owner-member-ref-duplicated" });
  });

  it("conflicts when the skill tree is missing", () => {
    const skillTrees = new Map<string, boolean>([[DEMO_ROADMAP_EXPANSION[0].treeId, false]]);
    expect(planRoadmapExpansion(baseInput({ skillTrees })).entries[0]).toMatchObject({ reason: "skill-tree-missing" });
  });

  it("creates nothing for a conflicting run, so one conflict blocks the whole write", () => {
    const skillTrees = new Map<string, boolean>(DEMO_ROADMAP_EXPANSION.map((p) => [p.treeId, p.treeId !== DEMO_ROADMAP_EXPANSION[0].treeId]));
    const plan = planRoadmapExpansion(baseInput({ skillTrees }));
    expect(plan.noConflicts).toBe(false);
    expect(plan.counts).toEqual({ create: DEMO_ROADMAP_EXPANSION.length - 1, skip: 0, conflict: 1 });
  });
});
