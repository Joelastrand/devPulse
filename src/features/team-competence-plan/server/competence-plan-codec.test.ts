import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetencePlan } from "../domain/competence-plan";
import { openCompetencePlanDocument, toPersistedCompetencePlan } from "./competence-plan-codec";

const PLAN_ID = "0f8fad5b-d9cb-469f-a165-8c45a5d4a0b1";

const plan: CompetencePlan = {
  teamId: "team-1",
  title: "Hemmelig plan",
  treeId: null,
  targetStage: 3,
  priority: "high",
  archived: false,
  milestones: [{ id: "m-1", title: "Milepælstekst", targetDate: "2026-06-01", status: "planned" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
} as CompetencePlan;

describe("competence plan codec", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  it("persists title and milestone text only inside the envelope, keeping metadata plaintext", () => {
    const persisted = toPersistedCompetencePlan(PLAN_ID, plan);
    expect(persisted).toMatchObject({ teamId: "team-1", targetStage: 3, priority: "high", archived: false });
    expect(Object.hasOwn(persisted, "title")).toBe(false);
    expect(Object.hasOwn(persisted, "milestones")).toBe(false);
    expect(JSON.stringify(persisted)).not.toMatch(/Hemmelig|Milepælstekst|2026-06-01/);
  });

  it("opens the content back into the domain shape for the same plan and team", () => {
    const opened = openCompetencePlanDocument(PLAN_ID, toPersistedCompetencePlan(PLAN_ID, plan));
    expect(opened).toMatchObject({ title: "Hemmelig plan", milestones: plan.milestones, teamId: "team-1" });
  });

  it("refuses content moved to another plan id (substitution)", () => {
    const sealed = toPersistedCompetencePlan(PLAN_ID, plan);
    expect(openCompetencePlanDocument("aaaaaaaa-0000-4000-8000-000000000000", sealed)).toBeNull();
  });

  it("refuses content whose stored team was changed (substitution across teams)", () => {
    const sealed = toPersistedCompetencePlan(PLAN_ID, plan);
    expect(openCompetencePlanDocument(PLAN_ID, { ...sealed, teamId: "team-2" })).toBeNull();
  });

  it("refuses a plaintext copy of the content (no plaintext fallback)", () => {
    const metadata: Record<string, unknown> = { ...toPersistedCompetencePlan(PLAN_ID, plan) };
    delete metadata.content;
    expect(openCompetencePlanDocument(PLAN_ID, { ...metadata, title: "Hemmelig plan", milestones: plan.milestones })).toBeNull();
  });

  it("fails closed when the key is missing", () => {
    const sealed = toPersistedCompetencePlan(PLAN_ID, plan);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openCompetencePlanDocument(PLAN_ID, sealed)).toThrow();
  });
});
