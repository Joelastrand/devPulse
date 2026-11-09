import { describe, expect, it } from "vitest";
import { assignParticipationLanes } from "./project-roadmap-view";

function item(participationId: string, startDate: string, endDate: string) {
  return { participationId, startDate, endDate };
}

function laneOf(result: { item: { participationId: string }; lane: number }[], id: string): number | undefined {
  return result.find((entry) => entry.item.participationId === id)?.lane;
}

describe("assignParticipationLanes", () => {
  it("keeps non-overlapping assignments of one member on the same lane", () => {
    const result = assignParticipationLanes([item("a", "2026-11-01", "2026-11-30"), item("b", "2026-12-01", "2026-12-31")]);

    expect(laneOf(result, "a")).toBe(0);
    expect(laneOf(result, "b")).toBe(0);
  });

  it("puts overlapping assignments on separate lanes instead of merging them", () => {
    const result = assignParticipationLanes([item("a", "2026-11-01", "2026-12-15"), item("b", "2026-12-01", "2027-01-31")]);

    expect(laneOf(result, "a")).toBe(0);
    expect(laneOf(result, "b")).toBe(1);
  });

  it("treats an interval that starts on the last day of another as overlapping, since both dates are inclusive", () => {
    const result = assignParticipationLanes([item("a", "2026-11-01", "2026-11-30"), item("b", "2026-11-30", "2026-12-10")]);

    expect(laneOf(result, "b")).toBe(1);
  });

  it("reuses a lane once its earlier assignment has ended", () => {
    const result = assignParticipationLanes([
      item("a", "2026-11-01", "2026-11-30"),
      item("b", "2026-11-05", "2026-11-20"),
      item("c", "2026-12-01", "2026-12-10"),
    ]);

    expect(laneOf(result, "c")).toBe(0);
  });
});
