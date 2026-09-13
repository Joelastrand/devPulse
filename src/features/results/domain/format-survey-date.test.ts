import { describe, expect, it } from "vitest";
import { formatRelativeSurveyDate, formatSurveyDate } from "./format-survey-date";

describe("formatSurveyDate", () => {
  it("formats a date as a compact Norwegian day/month/year label", () => {
    expect(formatSurveyDate(new Date("2026-01-10T12:00:00.000Z"))).toMatch(/10\.\s*jan\.?\s*2026/i);
  });

  it("formats a different month/year correctly", () => {
    expect(formatSurveyDate(new Date("2026-09-01T00:00:00.000Z"))).toMatch(/1\.\s*sep\.?\s*2026/i);
  });
});

describe("formatRelativeSurveyDate", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  it("returns 'i dag' for the same day", () => {
    expect(formatRelativeSurveyDate(new Date("2026-09-13T01:00:00.000Z"), now)).toBe("i dag");
  });

  it("returns 'i dag' for a date at or after now (never a negative offset)", () => {
    expect(formatRelativeSurveyDate(new Date("2026-09-14T00:00:00.000Z"), now)).toBe("i dag");
  });

  it("returns '1 dag siden' for exactly one day ago", () => {
    expect(formatRelativeSurveyDate(new Date("2026-09-12T12:00:00.000Z"), now)).toBe("1 dag siden");
  });

  it("returns 'N dager siden' for less than a week ago", () => {
    expect(formatRelativeSurveyDate(new Date("2026-09-09T12:00:00.000Z"), now)).toBe("4 dager siden");
  });

  it("returns '1 uke siden' for exactly one week ago", () => {
    expect(formatRelativeSurveyDate(new Date("2026-09-06T12:00:00.000Z"), now)).toBe("1 uke siden");
  });

  it("returns 'N uker siden' for several weeks ago", () => {
    expect(formatRelativeSurveyDate(new Date("2026-08-16T12:00:00.000Z"), now)).toBe("4 uker siden");
  });

  it("returns '1 måned siden' for about a month ago", () => {
    expect(formatRelativeSurveyDate(new Date("2026-08-13T12:00:00.000Z"), now)).toBe("1 måned siden");
  });

  it("returns 'N måneder siden' for several months ago", () => {
    expect(formatRelativeSurveyDate(new Date("2026-03-13T12:00:00.000Z"), now)).toBe("6 måneder siden");
  });
});
