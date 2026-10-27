import { describe, expect, it } from "vitest";
import { parseSharedGoalSnapshot, SHARED_GOAL_SNAPSHOT_KEYS } from "./shared-goal-snapshot";

/** Synthetic test data only (invariant 15). */
function validSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goalTitle: "Syntetisk mål",
    treeId: "synthetic-tree",
    targetDate: "2026-12-31",
    status: "active",
    capturedAt: "2026-10-14T08:30:00.000Z",
    ...overrides,
  };
}

describe("shared goal snapshot stored shape (BR-25, BR-26)", () => {
  it("has exactly the BR-25 snapshot keys and no goal id", () => {
    expect([...SHARED_GOAL_SNAPSHOT_KEYS]).toEqual(["goalTitle", "treeId", "targetDate", "status", "capturedAt"]);
  });

  it("accepts a canonical snapshot and returns capturedAt as a Date", () => {
    const result = parseSharedGoalSnapshot(validSnapshot());
    expect(result).toEqual({
      ok: true,
      snapshot: {
        goalTitle: "Syntetisk mål",
        treeId: "synthetic-tree",
        targetDate: "2026-12-31",
        status: "active",
        capturedAt: new Date("2026-10-14T08:30:00.000Z"),
      },
    });
  });

  it("accepts null treeId and null targetDate, and a completed status", () => {
    const result = parseSharedGoalSnapshot(validSnapshot({ treeId: null, targetDate: null, status: "completed" }));
    expect(result.ok).toBe(true);
  });

  it.each([
    ["missing goalTitle", () => ({ ...validSnapshot(), goalTitle: undefined })],
    ["extra goalId key", () => ({ ...validSnapshot(), goalId: "synthetic-goal" })],
    ["extra areaName key", () => ({ ...validSnapshot(), areaName: "Synthetic area" })],
    ["non-string goalTitle", () => validSnapshot({ goalTitle: 42 })],
    ["empty goalTitle", () => validSnapshot({ goalTitle: "" })],
    ["goalTitle with surrounding space (not canonical)", () => validSnapshot({ goalTitle: " Syntetisk " })],
    ["goalTitle with control character", () => validSnapshot({ goalTitle: "Syn\u0007tetisk" })],
    ["empty treeId string", () => validSnapshot({ treeId: "" })],
    ["numeric treeId", () => validSnapshot({ treeId: 7 })],
    ["malformed targetDate", () => validSnapshot({ targetDate: "2026-02-30" })],
    ["targetDate with time", () => validSnapshot({ targetDate: "2026-12-31T00:00:00Z" })],
    ["unknown status", () => validSnapshot({ status: "archived" })],
    ["capturedAt with offset (not canonical)", () => validSnapshot({ capturedAt: "2026-10-14T08:30:00+02:00" })],
    ["capturedAt without milliseconds", () => validSnapshot({ capturedAt: "2026-10-14T08:30:00Z" })],
    ["capturedAt as a Date instance", () => validSnapshot({ capturedAt: new Date("2026-10-14T08:30:00.000Z") })],
    ["capturedAt as epoch number", () => validSnapshot({ capturedAt: 1789380600000 })],
    ["capturedAt unparseable", () => validSnapshot({ capturedAt: "not a date" })],
  ])("rejects %s", (_name, build) => {
    expect(parseSharedGoalSnapshot(build())).toEqual({ ok: false });
  });

  it.each([null, undefined, "snapshot", 3, [], new Date(0), new (class Goal {})()])("rejects a non-plain value %#", (value) => {
    expect(parseSharedGoalSnapshot(value)).toEqual({ ok: false });
  });
});
