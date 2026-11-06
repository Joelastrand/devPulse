import { describe, expect, it } from "vitest";
import {
  isInGoodStanding,
  knowledgeRiskBand,
  needsAttention,
  parseBackstageUrl,
  parseOptionalText,
  parseSystemName,
  type AssessmentValue,
} from "./team-system";
import { parseTeamSystemRecord, traceAssessment, type StoredAssessment } from "./team-system-record";

/** The three legacy attributes take the given values; the four newer ones take `rest` (default "god"). */
const assess = (a: AssessmentValue, b: AssessmentValue, c: AssessmentValue, rest: AssessmentValue = "god") => ({
  availability: { value: a },
  reliability: { value: rest },
  maintainability: { value: b },
  security: { value: c },
  testability: { value: rest },
  deployability: { value: rest },
  observability: { value: rest },
});

describe("knowledgeRiskBand (BR-9)", () => {
  it.each([
    [0, "none"],
    [1, "high"],
    [2, "elevated"],
    [3, "lower"],
    [12, "lower"],
  ])("maps %i knowledge members to %s", (count, band) => {
    expect(knowledgeRiskBand(count)).toBe(band);
  });

  it("treats negative or non-integer counts as no registered knowledge", () => {
    expect(knowledgeRiskBand(-1)).toBe("none");
    expect(knowledgeRiskBand(1.5)).toBe("none");
  });
});

describe("attention and good standing (BR-10)", () => {
  it("needs attention when any assessment is kritisk or trenger_oppfolging", () => {
    expect(needsAttention(assess("god", "god", "kritisk"))).toBe(true);
    expect(needsAttention(assess("trenger_oppfolging", "god", "god"))).toBe(true);
  });

  it("does not flag all-god or all-not-assessed systems as needing attention", () => {
    expect(needsAttention(assess("god", "god", "god"))).toBe(false);
    expect(needsAttention(assess("ikke_vurdert", "ikke_vurdert", "ikke_vurdert"))).toBe(false);
  });

  it("is in good standing only when all seven assessments are god", () => {
    expect(isInGoodStanding(assess("god", "god", "god"))).toBe(true);
    expect(isInGoodStanding(assess("god", "ikke_vurdert", "god"))).toBe(false);
  });

  it("is not in good standing when one of the four newer attributes is not assessed", () => {
    expect(isInGoodStanding(assess("god", "god", "god", "ikke_vurdert"))).toBe(false);
  });

  it("flags attention from a newer attribute that is trenger_oppfolging", () => {
    const withTesting = { ...assess("god", "god", "god"), testability: { value: "trenger_oppfolging" as const } };
    expect(needsAttention(withTesting)).toBe(true);
  });
});

describe("parseBackstageUrl (BR-8)", () => {
  it("treats absent or blank input as no link", () => {
    expect(parseBackstageUrl(undefined)).toEqual({ ok: true, value: null });
    expect(parseBackstageUrl(null)).toEqual({ ok: true, value: null });
    expect(parseBackstageUrl("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts an absolute https URL and stores its normalized form", () => {
    expect(parseBackstageUrl("https://backstage.example.test/catalog/default/component/saksportalen")).toEqual({
      ok: true,
      value: "https://backstage.example.test/catalog/default/component/saksportalen",
    });
    expect(parseBackstageUrl("  https://Backstage.Example.test  ")).toEqual({
      ok: true,
      value: "https://backstage.example.test/",
    });
  });

  it.each([
    ["plain http", "http://backstage.example.test/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["relative path", "/catalog/x"],
    ["embedded credentials", "https://user:secret@backstage.example.test/x"],
    ["username only", "https://user@backstage.example.test/x"],
    ["whitespace inside", "https://backstage.example.test/a b"],
    ["non-string", 42],
    ["over 2048 characters", `https://backstage.example.test/${"a".repeat(2100)}`],
  ])("rejects %s", (_label, input) => {
    expect(parseBackstageUrl(input)).toEqual({ ok: false });
  });
});

describe("name and text parsing", () => {
  it("trims a name and rejects blank or overlong names", () => {
    expect(parseSystemName("  Saksportalen  ")).toBe("Saksportalen");
    expect(parseSystemName("   ")).toBeNull();
    expect(parseSystemName("x".repeat(121))).toBeNull();
    expect(parseSystemName(7)).toBeNull();
  });

  it("maps blank optional text to null and rejects overlong or non-string text", () => {
    expect(parseOptionalText("  ", 10)).toBeNull();
    expect(parseOptionalText(undefined, 10)).toBeNull();
    expect(parseOptionalText("x".repeat(11), 10)).toBeUndefined();
    expect(parseOptionalText(3, 10)).toBeUndefined();
  });
});

describe("traceAssessment (BR-6)", () => {
  const now = new Date("2026-06-01T09:00:00Z");
  const earlier: StoredAssessment = {
    value: "god",
    note: "Stabil",
    assessedAt: new Date("2026-05-01T09:00:00Z"),
    assessedBy: "uid-earlier",
  };

  it("keeps metadata of an unchanged assessment", () => {
    expect(traceAssessment(earlier, { value: "god", note: "Stabil" }, now, "uid-now")).toEqual(earlier);
  });

  it("stamps the time and caller when the value changes", () => {
    expect(traceAssessment(earlier, { value: "kritisk", note: "Stabil" }, now, "uid-now")).toEqual({
      value: "kritisk",
      note: "Stabil",
      assessedAt: now,
      assessedBy: "uid-now",
    });
  });

  it("stamps the time and caller when only the note changes", () => {
    expect(traceAssessment(earlier, { value: "god", note: null }, now, "uid-now").assessedBy).toBe("uid-now");
  });
});

describe("parseTeamSystemRecord", () => {
  const stored = {
    teamId: "team-1",
    name: "Saksportalen",
    description: null,
    backstageUrl: null,
    availability: { value: "god", note: null, assessedAt: new Date(), assessedBy: "uid-1" },
    maintainability: { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    security: { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    knowledgeMemberRefs: ["ref-a"],
    createdAt: new Date(),
    createdBy: "uid-1",
    updatedAt: new Date(),
    updatedBy: "uid-1",
  };

  it("accepts a well-formed document of the requested team", () => {
    const record = parseTeamSystemRecord(stored, "sys-1", "team-1");
    expect(record?.name).toBe("Saksportalen");
    expect(record?.assessments.availability.value).toBe("god");
  });

  it("skips a document that belongs to another team", () => {
    expect(parseTeamSystemRecord(stored, "sys-1", "team-2")).toBeNull();
  });

  it("skips a document with an unknown assessment value", () => {
    const bad = { ...stored, security: { ...stored.security, value: "ok" } };
    expect(parseTeamSystemRecord(bad, "sys-1", "team-1")).toBeNull();
  });

  it("skips a document with a non-Date timestamp", () => {
    expect(parseTeamSystemRecord({ ...stored, createdAt: "2026" }, "sys-1", "team-1")).toBeNull();
  });
});

describe("parseTeamSystemRecord — stored Backstage URL re-validation", () => {
  const base = {
    teamId: "team-1",
    name: "Saksportalen",
    description: null,
    availability: { value: "god", note: null, assessedAt: new Date(), assessedBy: "uid-1" },
    maintainability: { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    security: { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    knowledgeMemberRefs: [],
    createdAt: new Date(),
    createdBy: "uid-1",
    updatedAt: new Date(),
    updatedBy: "uid-1",
  };

  it.each([
    ["javascript scheme", "javascript:alert(1)"],
    ["credentialed link", "https://user:secret@backstage.example.test/x"],
    ["plain http", "http://backstage.example.test/x"],
  ])("drops a stored %s instead of exposing it as a link", (_label, url) => {
    const record = parseTeamSystemRecord({ ...base, backstageUrl: url }, "sys-1", "team-1");
    expect(record?.backstageUrl).toBeNull();
  });

  it("keeps a valid stored https link", () => {
    const record = parseTeamSystemRecord({ ...base, backstageUrl: "https://backstage.example.test/x" }, "sys-1", "team-1");
    expect(record?.backstageUrl).toBe("https://backstage.example.test/x");
  });
});
