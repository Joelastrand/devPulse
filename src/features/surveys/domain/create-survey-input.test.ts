import { describe, expect, it } from "vitest";
import { validateCreateSurveyInput } from "./create-survey-input";

describe("validateCreateSurveyInput", () => {
  it("accepts a valid immediate survey (accessMode + minimumResponses only)", () => {
    const result = validateCreateSurveyInput({ accessMode: "public", minimumResponses: 5 });
    expect(result).toEqual({
      ok: true,
      data: { accessMode: "public", minimumResponses: 5 },
    });
  });

  it("accepts a valid authenticated survey with a title", () => {
    const result = validateCreateSurveyInput({
      accessMode: "authenticated",
      minimumResponses: 5,
      title: "Q3 pulse",
    });
    expect(result).toEqual({
      ok: true,
      data: { accessMode: "authenticated", minimumResponses: 5, title: "Q3 pulse" },
    });
  });

  it("accepts a valid future-start survey", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      startAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.startAt).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    }
  });

  it("accepts a valid survey with both startAt and a later endAt", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-15T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.startAt).toEqual(new Date("2026-07-01T00:00:00.000Z"));
      expect(result.data.endAt).toEqual(new Date("2026-07-15T00:00:00.000Z"));
    }
  });

  it("accepts an endAt with no startAt", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      endAt: "2026-07-15T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an endAt at or before startAt", () => {
    const same = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      startAt: "2026-07-01T00:00:00.000Z",
      endAt: "2026-07-01T00:00:00.000Z",
    });
    expect(same).toEqual({ ok: false, error: "invalid_date_range" });

    const before = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      startAt: "2026-07-15T00:00:00.000Z",
      endAt: "2026-07-01T00:00:00.000Z",
    });
    expect(before).toEqual({ ok: false, error: "invalid_date_range" });
  });

  it("rejects a missing accessMode", () => {
    const result = validateCreateSurveyInput({ minimumResponses: 5, title: "Q3 pulse" });
    expect(result).toEqual({ ok: false, error: "invalid_access_mode" });
  });

  it("rejects an invalid accessMode value", () => {
    const result = validateCreateSurveyInput({ accessMode: "private", minimumResponses: 5 });
    expect(result).toEqual({ ok: false, error: "invalid_access_mode" });
  });

  it("rejects a non-string title", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      title: 42,
    });
    expect(result).toEqual({ ok: false, error: "invalid_title" });
  });

  it("rejects an unparseable startAt", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      startAt: "not a date",
    });
    expect(result).toEqual({ ok: false, error: "invalid_start_at" });
  });

  it("rejects an unparseable endAt", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      endAt: "not a date",
    });
    expect(result).toEqual({ ok: false, error: "invalid_end_at" });
  });

  it("rejects a non-string/non-Date startAt", () => {
    const result = validateCreateSurveyInput({
      accessMode: "public",
      minimumResponses: 5,
      startAt: 12345,
    });
    expect(result).toEqual({ ok: false, error: "invalid_start_at" });
  });

  it("rejects a non-object payload", () => {
    expect(validateCreateSurveyInput(null)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateCreateSurveyInput(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateCreateSurveyInput("public")).toEqual({ ok: false, error: "invalid_input" });
  });

  describe("minimumResponses", () => {
    it("accepts the boundary values 3 and 20, and the default 5", () => {
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 3 }),
      ).toEqual({ ok: true, data: { accessMode: "public", minimumResponses: 3 } });
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 5 }),
      ).toEqual({ ok: true, data: { accessMode: "public", minimumResponses: 5 } });
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 20 }),
      ).toEqual({ ok: true, data: { accessMode: "public", minimumResponses: 20 } });
    });

    it("persists exactly the submitted valid value, e.g. 10", () => {
      const result = validateCreateSurveyInput({ accessMode: "public", minimumResponses: 10 });
      expect(result).toEqual({ ok: true, data: { accessMode: "public", minimumResponses: 10 } });
    });

    it("rejects a value below 3", () => {
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 2 }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 1 }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 0 }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
    });

    it("rejects a value above 20", () => {
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 21 }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
    });

    it("rejects a decimal", () => {
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: 5.5 }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
    });

    it("rejects a missing minimumResponses — never defaults to 5", () => {
      expect(validateCreateSurveyInput({ accessMode: "public" })).toEqual({
        ok: false,
        error: "invalid_minimum_responses",
      });
    });

    it("rejects malformed values: a numeric string, null, NaN, and Infinity", () => {
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: "5" }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: null }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(
        validateCreateSurveyInput({ accessMode: "public", minimumResponses: Number.NaN }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(
        validateCreateSurveyInput({
          accessMode: "public",
          minimumResponses: Number.POSITIVE_INFINITY,
        }),
      ).toEqual({ ok: false, error: "invalid_minimum_responses" });
    });

    it("is validated before accessMode-independent optional fields, but a malformed accessMode is reported first", () => {
      // accessMode is checked first regardless of minimumResponses validity —
      // this just documents that ordering, not a new invariant.
      const result = validateCreateSurveyInput({ accessMode: "private", minimumResponses: -1 });
      expect(result).toEqual({ ok: false, error: "invalid_access_mode" });
    });
  });
});
