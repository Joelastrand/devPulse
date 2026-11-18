import { describe, expect, it } from "vitest";
import { RADAR_MAX_AXES } from "./radar-model";
import { resolveRadarSelection, toggleRadarSelection } from "./radar-selection";

const ids = (count: number) => Array.from({ length: count }, (_, i) => `sk${i + 1}`);

describe("resolveRadarSelection", () => {
  it("defaults to the first eight eligible areas in catalog order", () => {
    expect(resolveRadarSelection(ids(23), null)).toEqual(ids(RADAR_MAX_AXES));
  });

  it("returns every eligible area when there are no more than eight", () => {
    expect(resolveRadarSelection(ids(4), null)).toEqual(ids(4));
  });

  it("keeps a saved choice in its own order and drops areas that are no longer eligible", () => {
    expect(resolveRadarSelection(["a", "b", "c"], ["c", "gone", "a"])).toEqual(["c", "a"]);
  });

  it("caps a saved choice at the maximum", () => {
    expect(resolveRadarSelection(ids(12), ids(12))).toEqual(ids(RADAR_MAX_AXES));
  });

  it("keeps an empty saved choice empty, so the radar shows its own too-few message", () => {
    expect(resolveRadarSelection(ids(10), [])).toEqual([]);
  });
});

describe("toggleRadarSelection", () => {
  it("adds an area that is not selected", () => {
    expect(toggleRadarSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an area that is selected", () => {
    expect(toggleRadarSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("refuses a ninth area", () => {
    const full = ids(RADAR_MAX_AXES);
    expect(toggleRadarSelection(full, "extra")).toEqual(full);
  });
});
