import { describe, expect, it } from "vitest";
import {
  SIMULATED_CONTRIBUTION_TEAM_ID,
  SKILL_CONTRIBUTION_FIELD,
  isEffectiveSkillContribution,
  readSkillContribution,
  type SkillContributionContext,
} from "./skill-contribution";

const DEMO_CONTEXT: SkillContributionContext = { uid: "demo-member-03", teamId: SIMULATED_CONTRIBUTION_TEAM_ID };
const asOf = new Date("2026-09-15T09:00:00.000Z");

function membership(contribution: Record<string, unknown>): Record<string, unknown> {
  return { uid: DEMO_CONTEXT.uid, teamId: DEMO_CONTEXT.teamId, [SKILL_CONTRIBUTION_FIELD]: contribution };
}

describe("genuine consent (unchanged)", () => {
  it("reads a genuine record with and without a context, as origin genuine", () => {
    const raw = membership({ noticeVersion: 2, consentedAt: asOf });
    expect(readSkillContribution(raw)).toEqual({ noticeVersion: 2, consentedAt: asOf, origin: "genuine" });
    expect(readSkillContribution(raw, DEMO_CONTEXT)?.origin).toBe("genuine");
    expect(isEffectiveSkillContribution(raw)).toBe(true);
  });

  it("refuses a genuine record with an extra key, even in the demo team", () => {
    expect(readSkillContribution(membership({ noticeVersion: 2, consentedAt: asOf, note: "x" }), DEMO_CONTEXT)).toBeNull();
  });

  it("keeps the notice version and timestamp requirements", () => {
    expect(isEffectiveSkillContribution(membership({ noticeVersion: 1, consentedAt: asOf }))).toBe(false);
    expect(readSkillContribution(membership({ noticeVersion: 2, consentedAt: "2026-09-15" }))).toBeNull();
  });
});

describe("simulated demo consent", () => {
  const simulated = { noticeVersion: 2, consentedAt: asOf, simulated: true };

  it("is accepted only for an exact demo uid in the exact designated team", () => {
    expect(readSkillContribution(membership(simulated), DEMO_CONTEXT)).toEqual({ noticeVersion: 2, consentedAt: asOf, origin: "simulated" });
    expect(isEffectiveSkillContribution(membership(simulated), DEMO_CONTEXT)).toBe(true);
  });

  it("is rejected without a context, so a bare field read never trusts the marker", () => {
    expect(readSkillContribution(membership(simulated))).toBeNull();
    expect(isEffectiveSkillContribution(membership(simulated))).toBe(false);
  });

  it("is rejected for another team, even with the same fictional uid", () => {
    expect(readSkillContribution(membership(simulated), { ...DEMO_CONTEXT, teamId: "demo-team" })).toBeNull();
  });

  it("is rejected for a real or near-miss uid, even in the demo team (a uid match alone is not enough)", () => {
    for (const uid of ["demo-member-00", "demo-member-11", "someone-real", "demo-member-3"]) {
      expect(readSkillContribution(membership(simulated), { uid, teamId: SIMULATED_CONTRIBUTION_TEAM_ID })).toBeNull();
    }
  });

  it("is rejected unless the marker is exactly true", () => {
    for (const marker of [false, "true", 1, null]) {
      expect(readSkillContribution(membership({ ...simulated, simulated: marker }), DEMO_CONTEXT)).toBeNull();
    }
  });

  it("still rejects unknown additional keys alongside the marker", () => {
    expect(readSkillContribution(membership({ ...simulated, extra: true }), DEMO_CONTEXT)).toBeNull();
  });

  it("keeps the notice version requirement: a stale simulated record is readable but not effective", () => {
    const stale = membership({ noticeVersion: 1, consentedAt: asOf, simulated: true });
    expect(readSkillContribution(stale, DEMO_CONTEXT)?.origin).toBe("simulated");
    expect(isEffectiveSkillContribution(stale, DEMO_CONTEXT)).toBe(false);
  });
});
