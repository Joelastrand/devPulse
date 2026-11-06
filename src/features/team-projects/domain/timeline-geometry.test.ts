import { describe, expect, it } from "vitest";
import { barForRange, buildTimelineWindow, todayMarkerPercent } from "./timeline-geometry";

describe("buildTimelineWindow", () => {
  it("builds a 3-month window of whole calendar months from the anchor month", () => {
    const w = buildTimelineWindow("2026-06-15", 3);
    expect(w.startDate).toBe("2026-06-01");
    expect(w.endDate).toBe("2026-08-31");
    expect(w.totalDays).toBe(30 + 31 + 31);
    expect(w.columns.map((c) => c.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(w.columns.map((c) => c.startDay)).toEqual([0, 30, 61]);
  });

  it("crosses the year boundary with 6 months, including a leap February", () => {
    const w = buildTimelineWindow("2027-11-06", 6);
    expect(w.startDate).toBe("2027-11-01");
    expect(w.endDate).toBe("2028-04-30");
    expect(w.columns.map((c) => c.key)).toEqual(["2027-11", "2027-12", "2028-01", "2028-02", "2028-03", "2028-04"]);
    expect(w.columns.find((c) => c.key === "2028-02")?.dayCount).toBe(29);
    expect(w.totalDays).toBe(30 + 31 + 31 + 29 + 31 + 30);
  });

  it("rejects an invalid anchor date", () => {
    expect(() => buildTimelineWindow("2026-02-30", 3)).toThrow();
  });
});

describe("barForRange", () => {
  const w = buildTimelineWindow("2026-06-01", 3); // 92 days: 2026-06-01 … 2026-08-31

  it("positions a bar from its real start and end dates, end inclusive", () => {
    const bar = barForRange(w, "2026-07-01", "2026-07-31");
    expect(bar).not.toBeNull();
    expect(bar!.leftPercent).toBeCloseTo((30 / 92) * 100, 6);
    expect(bar!.widthPercent).toBeCloseTo((31 / 92) * 100, 6);
    expect(bar!.clippedStart).toBe(false);
    expect(bar!.clippedEnd).toBe(false);
  });

  it("draws a single-day project as exactly one day wide", () => {
    const bar = barForRange(w, "2026-06-10", "2026-06-10");
    expect(bar!.widthPercent).toBeCloseTo((1 / 92) * 100, 6);
  });

  it("clips bars that start before or end after the window and marks them", () => {
    const bar = barForRange(w, "2026-05-15", "2026-06-10");
    expect(bar!.leftPercent).toBe(0);
    expect(bar!.clippedStart).toBe(true);
    expect(bar!.clippedEnd).toBe(false);

    const tail = barForRange(w, "2026-08-20", "2026-10-01");
    expect(tail!.clippedEnd).toBe(true);
    expect(tail!.leftPercent + tail!.widthPercent).toBeCloseTo(100, 6);
  });

  it("returns null for ranges fully outside the window", () => {
    expect(barForRange(w, "2026-05-01", "2026-05-31")).toBeNull();
    expect(barForRange(w, "2026-09-01", "2026-09-30")).toBeNull();
  });

  it("returns null for invalid or reversed ranges instead of drawing them", () => {
    expect(barForRange(w, "2026-07-10", "2026-07-01")).toBeNull();
    expect(barForRange(w, "2026-02-30", "2026-07-01")).toBeNull();
  });

  it("handles a bar crossing a year boundary in a 6-month window", () => {
    const w6 = buildTimelineWindow("2026-11-06", 6);
    const bar = barForRange(w6, "2026-12-20", "2027-01-10");
    // Window starts 2026-11-01: 30 days of November plus 19 days into December = 49.
    expect(bar!.leftPercent).toBeCloseTo((49 / w6.totalDays) * 100, 6);
    expect(bar!.widthPercent).toBeCloseTo((22 / w6.totalDays) * 100, 6);
  });
});

describe("todayMarkerPercent", () => {
  const w = buildTimelineWindow("2026-06-01", 3);

  it("places the marker at the centre of today's day inside the window", () => {
    expect(todayMarkerPercent(w, "2026-06-01")).toBeCloseTo((0.5 / 92) * 100, 6);
    expect(todayMarkerPercent(w, "2026-08-31")).toBeCloseTo((91.5 / 92) * 100, 6);
  });

  it("returns null when today is outside the window", () => {
    expect(todayMarkerPercent(w, "2026-05-31")).toBeNull();
    expect(todayMarkerPercent(w, "2026-09-01")).toBeNull();
  });

  it("returns null for an invalid date", () => {
    expect(todayMarkerPercent(w, "not-a-date")).toBeNull();
  });
});
