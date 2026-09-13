import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMUM_RESPONSES,
  MINIMUM_RESPONSES_MAX,
  MINIMUM_RESPONSES_MIN,
  effectiveLifecycle,
  isValidMinimumResponses,
  isValidSurvey,
  isValidSurveyAccessMode,
} from "./survey";

describe("isValidSurveyAccessMode", () => {
  it("accepts 'public'", () => {
    expect(isValidSurveyAccessMode("public")).toBe(true);
  });

  it("accepts 'authenticated'", () => {
    expect(isValidSurveyAccessMode("authenticated")).toBe(true);
  });

  it("rejects an unrecognized string", () => {
    expect(isValidSurveyAccessMode("private")).toBe(false);
  });

  it("rejects non-string values, including undefined for a missing field", () => {
    expect(isValidSurveyAccessMode(undefined)).toBe(false);
    expect(isValidSurveyAccessMode(null)).toBe(false);
    expect(isValidSurveyAccessMode(42)).toBe(false);
    expect(isValidSurveyAccessMode({})).toBe(false);
  });

  it("never throws on malformed input", () => {
    expect(() => isValidSurveyAccessMode(Symbol("x"))).not.toThrow();
  });
});

describe("effectiveLifecycle", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("is 'scheduled' when no lifecycle timestamps are set", () => {
    expect(effectiveLifecycle({}, now)).toBe("scheduled");
  });

  it("is 'open' when openedAt is set and nothing else", () => {
    expect(
      effectiveLifecycle({ openedAt: new Date("2026-06-01T00:00:00.000Z") }, now),
    ).toBe("open");
  });

  it("is 'open' when openedAt is set and endAt is still in the future", () => {
    expect(
      effectiveLifecycle(
        {
          openedAt: new Date("2026-06-01T00:00:00.000Z"),
          endAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("open");
  });

  it("is 'closed' when closedAt is set, even with endAt still in the future", () => {
    expect(
      effectiveLifecycle(
        {
          openedAt: new Date("2026-06-01T00:00:00.000Z"),
          closedAt: new Date("2026-06-10T00:00:00.000Z"),
          endAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("closed");
  });

  it("is 'closed' automatically once endAt has passed, even though closedAt was never set (BR-8)", () => {
    expect(
      effectiveLifecycle(
        {
          openedAt: new Date("2026-06-01T00:00:00.000Z"),
          endAt: new Date("2026-06-10T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("closed");
  });

  it("is 'closed' exactly at the endAt boundary instant (now >= endAt)", () => {
    const endAt = new Date("2026-06-15T12:00:00.000Z");
    expect(effectiveLifecycle({ openedAt: new Date("2026-06-01T00:00:00.000Z"), endAt }, endAt)).toBe(
      "closed",
    );
  });

  it("is 'open' one millisecond before the endAt boundary", () => {
    const endAt = new Date("2026-06-15T12:00:00.000Z");
    const justBefore = new Date(endAt.getTime() - 1);
    expect(
      effectiveLifecycle({ openedAt: new Date("2026-06-01T00:00:00.000Z"), endAt }, justBefore),
    ).toBe("open");
  });

  it("is 'scheduled', not 'closed', when only endAt is set and it has not yet passed and the survey was never opened", () => {
    expect(
      effectiveLifecycle({ endAt: new Date("2026-06-20T00:00:00.000Z") }, now),
    ).toBe("scheduled");
  });

  it("is 'closed' when endAt has already passed and the survey was never opened (scheduled survey whose window elapsed)", () => {
    expect(
      effectiveLifecycle({ endAt: new Date("2026-06-01T00:00:00.000Z") }, now),
    ).toBe("closed");
  });

  it("never gates on startAt — an explicitly opened survey stays open regardless of its own planned start (type-level: SurveyLifecycleFields has no startAt field at all)", () => {
    // A future startAt on the full Survey record has no bearing here: only
    // the openedAt/closedAt/endAt slice is ever passed to this function.
    const futureStartSurvey = {
      openedAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    expect(effectiveLifecycle(futureStartSurvey, now)).toBe("open");
  });
});

describe("isValidMinimumResponses", () => {
  it("accepts the boundary and default values", () => {
    expect(isValidMinimumResponses(MINIMUM_RESPONSES_MIN)).toBe(true);
    expect(isValidMinimumResponses(DEFAULT_MINIMUM_RESPONSES)).toBe(true);
    expect(isValidMinimumResponses(MINIMUM_RESPONSES_MAX)).toBe(true);
  });

  it("accepts every integer within the allowed range", () => {
    for (let value = MINIMUM_RESPONSES_MIN; value <= MINIMUM_RESPONSES_MAX; value += 1) {
      expect(isValidMinimumResponses(value)).toBe(true);
    }
  });

  it("rejects a value below the minimum", () => {
    expect(isValidMinimumResponses(MINIMUM_RESPONSES_MIN - 1)).toBe(false);
    expect(isValidMinimumResponses(2)).toBe(false);
    expect(isValidMinimumResponses(1)).toBe(false);
    expect(isValidMinimumResponses(0)).toBe(false);
    expect(isValidMinimumResponses(-1)).toBe(false);
  });

  it("rejects a value above the maximum", () => {
    expect(isValidMinimumResponses(MINIMUM_RESPONSES_MAX + 1)).toBe(false);
  });

  it("rejects a decimal", () => {
    expect(isValidMinimumResponses(5.5)).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidMinimumResponses(Number.NaN)).toBe(false);
    expect(isValidMinimumResponses(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidMinimumResponses(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it("rejects missing, null, and non-number values, never throwing", () => {
    expect(isValidMinimumResponses(undefined)).toBe(false);
    expect(isValidMinimumResponses(null)).toBe(false);
    expect(isValidMinimumResponses("5")).toBe(false);
    expect(isValidMinimumResponses({})).toBe(false);
    expect(() => isValidMinimumResponses(Symbol("x"))).not.toThrow();
  });
});

describe("isValidSurvey", () => {
  const validSurvey = {
    surveyId: "survey-1",
    teamId: "team-1",
    accessMode: "public",
    minimumResponses: DEFAULT_MINIMUM_RESPONSES,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    createdBy: "admin-uid",
  };

  it("accepts a minimal scheduled survey (no optional fields set)", () => {
    expect(isValidSurvey(validSurvey, { surveyId: "survey-1" })).toBe(true);
  });

  it("accepts a survey with every optional field populated", () => {
    const full = {
      ...validSurvey,
      title: "Q3 pulse",
      startAt: new Date("2026-06-05T00:00:00.000Z"),
      endAt: new Date("2026-06-20T00:00:00.000Z"),
      openedAt: new Date("2026-06-05T00:00:00.000Z"),
      closedAt: new Date("2026-06-19T00:00:00.000Z"),
      archivedAt: new Date("2026-06-21T00:00:00.000Z"),
    };
    expect(isValidSurvey(full, { surveyId: "survey-1" })).toBe(true);
  });

  it("rejects a surveyId mismatch", () => {
    expect(isValidSurvey(validSurvey, { surveyId: "some-other-id" })).toBe(false);
  });

  it("rejects a missing/malformed teamId", () => {
    expect(isValidSurvey({ ...validSurvey, teamId: undefined }, { surveyId: "survey-1" })).toBe(
      false,
    );
    expect(isValidSurvey({ ...validSurvey, teamId: "" }, { surveyId: "survey-1" })).toBe(false);
    expect(isValidSurvey({ ...validSurvey, teamId: 42 }, { surveyId: "survey-1" })).toBe(false);
  });

  it("rejects an invalid accessMode", () => {
    expect(
      isValidSurvey({ ...validSurvey, accessMode: "private" }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, accessMode: undefined }, { surveyId: "survey-1" }),
    ).toBe(false);
  });

  it("rejects a non-string title", () => {
    expect(isValidSurvey({ ...validSurvey, title: 42 }, { surveyId: "survey-1" })).toBe(false);
  });

  it("rejects a missing, malformed, or out-of-range minimumResponses — no fallback to the default", () => {
    const withoutMinimumResponses: Record<string, unknown> = { ...validSurvey };
    delete withoutMinimumResponses.minimumResponses;
    expect(isValidSurvey(withoutMinimumResponses, { surveyId: "survey-1" })).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, minimumResponses: null }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, minimumResponses: "5" }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, minimumResponses: 5.5 }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, minimumResponses: 2 }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, minimumResponses: 21 }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, minimumResponses: Number.NaN }, { surveyId: "survey-1" }),
    ).toBe(false);
  });

  it("rejects malformed lifecycle timestamps (wrong type or invalid Date)", () => {
    expect(
      isValidSurvey(
        { ...validSurvey, openedAt: "2026-06-05T00:00:00.000Z" },
        { surveyId: "survey-1" },
      ),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, closedAt: new Date("not a date") }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, endAt: 1234567890 }, { surveyId: "survey-1" }),
    ).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, archivedAt: null }, { surveyId: "survey-1" }),
    ).toBe(false);
  });

  it("rejects a missing or invalid createdAt", () => {
    const withoutCreatedAt: Record<string, unknown> = { ...validSurvey };
    delete withoutCreatedAt.createdAt;
    expect(isValidSurvey(withoutCreatedAt, { surveyId: "survey-1" })).toBe(false);
    expect(
      isValidSurvey({ ...validSurvey, createdAt: "2026-06-01" }, { surveyId: "survey-1" }),
    ).toBe(false);
  });

  it("rejects a missing/blank createdBy", () => {
    expect(isValidSurvey({ ...validSurvey, createdBy: "" }, { surveyId: "survey-1" })).toBe(
      false,
    );
    expect(isValidSurvey({ ...validSurvey, createdBy: undefined }, { surveyId: "survey-1" })).toBe(
      false,
    );
  });

  it("fails closed on non-object/malformed persisted data", () => {
    expect(isValidSurvey(null, { surveyId: "survey-1" })).toBe(false);
    expect(isValidSurvey(undefined, { surveyId: "survey-1" })).toBe(false);
    expect(isValidSurvey("not an object", { surveyId: "survey-1" })).toBe(false);
    expect(isValidSurvey(42, { surveyId: "survey-1" })).toBe(false);
    expect(isValidSurvey([], { surveyId: "survey-1" })).toBe(false);
  });
});
