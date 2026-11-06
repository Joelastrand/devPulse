import { describe, expect, it } from "vitest";
import { parseTeamSystemRecord } from "./team-system-record";

const TEAM = "team-fixture-1";
const CREATED = new Date("2026-01-02T10:00:00.000Z");
const ASSESSED = new Date("2026-02-03T10:00:00.000Z");

/** Synthetic legacy document: only the three attributes that existed before the seven-attribute model. */
function legacyDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM,
    name: "Fiktivt system",
    description: null,
    backstageUrl: null,
    availability: { value: "god", note: "Stabil drift", assessedAt: ASSESSED, assessedBy: "uid-fixture" },
    maintainability: { value: "trenger_oppfolging", note: "Gammel kode", assessedAt: ASSESSED, assessedBy: "uid-fixture" },
    security: { value: "kritisk", note: null, assessedAt: ASSESSED, assessedBy: null },
    knowledgeMemberRefs: ["ref-fixture-a"],
    createdAt: CREATED,
    createdBy: "uid-fixture",
    updatedAt: CREATED,
    updatedBy: "uid-fixture",
    ...overrides,
  };
}

describe("legacy three-attribute documents (SPEC round 2, BR-18)", () => {
  it("remains readable and keeps the stored values and metadata of the three legacy attributes", () => {
    const record = parseTeamSystemRecord(legacyDocument(), "sys-fixture-1", TEAM);
    expect(record).not.toBeNull();
    expect(record?.assessments.availability).toEqual({
      value: "god",
      note: "Stabil drift",
      assessedAt: ASSESSED,
      assessedBy: "uid-fixture",
    });
    expect(record?.assessments.maintainability.value).toBe("trenger_oppfolging");
    expect(record?.assessments.maintainability.note).toBe("Gammel kode");
    expect(record?.assessments.security).toEqual({ value: "kritisk", note: null, assessedAt: ASSESSED, assessedBy: null });
  });

  it("reads the four newer attributes as ikke_vurdert, never as god", () => {
    const record = parseTeamSystemRecord(legacyDocument(), "sys-fixture-1", TEAM);
    for (const attribute of ["reliability", "testability", "deployability", "observability"] as const) {
      expect(record?.assessments[attribute]).toEqual({ value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null });
    }
  });

  it("still skips a document whose present attribute is malformed", () => {
    const malformed = legacyDocument({ security: { value: "fornuftig", note: null, assessedAt: ASSESSED, assessedBy: null } });
    expect(parseTeamSystemRecord(malformed, "sys-fixture-1", TEAM)).toBeNull();
  });

  it("still skips a document that belongs to another team", () => {
    expect(parseTeamSystemRecord(legacyDocument({ teamId: "other-team" }), "sys-fixture-1", TEAM)).toBeNull();
  });

  it("reads a document that already stores all seven attributes", () => {
    const assessment = { value: "god", note: null, assessedAt: ASSESSED, assessedBy: null };
    const full = legacyDocument({
      reliability: assessment,
      testability: { value: "trenger_oppfolging", note: null, assessedAt: ASSESSED, assessedBy: null },
      deployability: assessment,
      observability: assessment,
    });
    const record = parseTeamSystemRecord(full, "sys-fixture-1", TEAM);
    expect(record?.assessments.reliability.value).toBe("god");
    expect(record?.assessments.testability.value).toBe("trenger_oppfolging");
    expect(record?.assessments.deployability.value).toBe("god");
  });
});
