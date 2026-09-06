import { describe, expect, it } from "vitest";
import {
  getCurrentSurveyPeriod,
  isPeriodClosed,
  listPrecedingClosedPeriods,
} from "./period";

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

describe("isPeriodClosed", () => {
  it("treats any period earlier than the current one as closed", () => {
    expect(isPeriodClosed("2026-W35", "2026-W36")).toBe(true);
    expect(isPeriodClosed("2025-W52", "2026-W01")).toBe(true);
  });

  it("treats the current period itself as open, not closed", () => {
    expect(isPeriodClosed("2026-W36", "2026-W36")).toBe(false);
  });

  it("treats any period after the current one as open", () => {
    expect(isPeriodClosed("2026-W37", "2026-W36")).toBe(false);
  });
});

describe("listPrecedingClosedPeriods", () => {
  it("returns exactly the requested count of periods, oldest first, excluding the current period", () => {
    const now = new Date("2026-09-05T12:00:00.000Z"); // 2026-W36
    const periods = listPrecedingClosedPeriods(12, now);

    expect(periods).toHaveLength(12);
    expect(periods).not.toContain("2026-W36");
    expect(periods[periods.length - 1]).toBe("2026-W35");
    expect(periods[0]).toBe("2026-W24");
  });

  it("returns periods in strictly increasing (oldest-to-newest) order", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const periods = listPrecedingClosedPeriods(12, now);

    for (let i = 1; i < periods.length; i++) {
      expect(periods[i - 1] < periods[i]).toBe(true);
    }
  });

  it("correctly crosses an ISO year boundary", () => {
    // 2026-01-05 is a Monday in ISO week 2 of 2026.
    const now = new Date("2026-01-05T00:00:00.000Z");
    const periods = listPrecedingClosedPeriods(3, now);

    expect(periods).toEqual(["2025-W51", "2025-W52", "2026-W01"]);
  });
});
