import { describe, expect, it } from "vitest";
import { getCurrentSurveyPeriod } from "./period";

describe("getCurrentSurveyPeriod", () => {
  it("computes the UTC ISO week for a given instant", () => {
    // 2026-09-05 is a Saturday in ISO week 36 of 2026.
    expect(getCurrentSurveyPeriod(new Date("2026-09-05T12:00:00.000Z"))).toBe(
      "2026-W36",
    );
  });

  it("uses the supplied instant across a week boundary rather than any external period value", () => {
    // Monday 2025-12-29 is the first day of ISO week 1, 2026.
    expect(getCurrentSurveyPeriod(new Date("2025-12-29T00:00:00.000Z"))).toBe(
      "2026-W01",
    );
    // The instant just before it (Sunday) still belongs to the prior ISO year's last week.
    expect(getCurrentSurveyPeriod(new Date("2025-12-28T23:59:59.999Z"))).toBe(
      "2025-W52",
    );
  });

  it("defaults to the current instant when none is supplied", () => {
    const before = getCurrentSurveyPeriod(new Date());
    const result = getCurrentSurveyPeriod();
    expect(result).toBe(before);
  });
});
