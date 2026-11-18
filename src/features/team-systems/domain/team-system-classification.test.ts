import { describe, expect, it } from "vitest";
import {
  BUSINESS_CRITICALITIES,
  BUSINESS_CRITICALITY_LABELS,
  SYSTEM_TYPES,
  SYSTEM_TYPE_LABELS,
  UNASSESSED_CLASSIFICATION,
  USER_REACHES,
  USER_REACH_LABELS,
  isBusinessCriticality,
  isSystemType,
  isUserReach,
} from "./team-system";
import { parseTeamSystemRecord } from "./team-system-record";

const TEAM = "team-1";
const SYSTEM = "sys-1";
const NOW = new Date("2026-01-01T00:00:00.000Z");

/** A minimal stored document as it looked before the classification fields existed (synthetic data). */
function legacyDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM,
    name: "Testsystem",
    description: null,
    backstageUrl: null,
    knowledgeMemberRefs: [],
    createdAt: NOW,
    createdBy: "admin-1",
    updatedAt: NOW,
    updatedBy: "admin-1",
    ...overrides,
  };
}

describe("system classification values", () => {
  it("accepts exactly the documented system types, criticality levels and user reach values", () => {
    expect(SYSTEM_TYPES).toEqual(["internt", "eksternt", "uavklart"]);
    expect(BUSINESS_CRITICALITIES).toEqual(["lav", "middels", "hoy", "kritisk", "ikke_vurdert"]);
    expect(USER_REACHES).toEqual(["faa_brukere", "ett_team", "flere_avdelinger", "virksomhetsomfattende", "ikke_vurdert"]);
  });

  it("rejects values outside the enumerations", () => {
    expect(isSystemType("ekstern")).toBe(false);
    expect(isSystemType(undefined)).toBe(false);
    expect(isBusinessCriticality("høy")).toBe(false);
    expect(isBusinessCriticality(3)).toBe(false);
    expect(isUserReach("1000 brukere")).toBe(false);
    expect(isUserReach(null)).toBe(false);
  });

  it("has Norwegian labels for every value", () => {
    for (const type of SYSTEM_TYPES) expect(SYSTEM_TYPE_LABELS[type]).toBeTruthy();
    for (const level of BUSINESS_CRITICALITIES) expect(BUSINESS_CRITICALITY_LABELS[level]).toBeTruthy();
    for (const reach of USER_REACHES) expect(USER_REACH_LABELS[reach]).toBeTruthy();
    expect(BUSINESS_CRITICALITY_LABELS.hoy).toBe("Høy");
    expect(USER_REACH_LABELS.ett_team).toBe("En avdeling eller et team");
  });

  it("defaults to not assessed in every dimension", () => {
    expect(UNASSESSED_CLASSIFICATION).toEqual({
      systemType: "uavklart",
      businessCriticality: "ikke_vurdert",
      userReach: "ikke_vurdert",
    });
  });
});

describe("stored classification (parseTeamSystemRecord)", () => {
  it("reads a legacy record without the fields as not assessed, and never classifies it silently", () => {
    const record = parseTeamSystemRecord(legacyDocument(), SYSTEM, TEAM);
    expect(record).not.toBeNull();
    expect(record?.classification).toEqual(UNASSESSED_CLASSIFICATION);
  });

  it("reads the stored values when they are valid", () => {
    const record = parseTeamSystemRecord(
      legacyDocument({ systemType: "eksternt", businessCriticality: "kritisk", userReach: "virksomhetsomfattende" }),
      SYSTEM,
      TEAM,
    );
    expect(record?.classification).toEqual({
      systemType: "eksternt",
      businessCriticality: "kritisk",
      userReach: "virksomhetsomfattende",
    });
  });

  it("treats an unknown stored value as not assessed for that dimension only and keeps the system", () => {
    const record = parseTeamSystemRecord(
      legacyDocument({ systemType: "ukjent", businessCriticality: "hoy", userReach: 42 }),
      SYSTEM,
      TEAM,
    );
    expect(record).not.toBeNull();
    expect(record?.classification).toEqual({
      systemType: "uavklart",
      businessCriticality: "hoy",
      userReach: "ikke_vurdert",
    });
  });

  it("does not derive criticality from the system type", () => {
    const record = parseTeamSystemRecord(legacyDocument({ systemType: "eksternt" }), SYSTEM, TEAM);
    expect(record?.classification.businessCriticality).toBe("ikke_vurdert");
  });
});
