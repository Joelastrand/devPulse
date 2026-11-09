import { describe, expect, it } from "vitest";
import { drawnRuns } from "./KompetanseprofilRadar";

/** Synthetic fixtures only. */
const p = (name: string, value: number | null) => ({ name, value });
const names = (runs: { name: string }[][]) => runs.map((run) => run.map((point) => point.name));

describe("drawnRuns", () => {
  it("returns one run with every point when no value is missing", () => {
    expect(names(drawnRuns([p("a", 1), p("b", 2), p("c", 3)]))).toEqual([["a", "b", "c"]]);
  });

  it("breaks the run at a missing value and never includes it", () => {
    expect(names(drawnRuns([p("a", 1), p("b", null), p("c", 3), p("d", 4)]))).toEqual([["c", "d", "a"]]);
  });

  it("keeps a single value as its own run", () => {
    expect(names(drawnRuns([p("a", null), p("b", 2), p("c", null), p("d", null)]))).toEqual([["b"]]);
  });

  it("returns no run when every value is missing", () => {
    expect(drawnRuns([p("a", null), p("b", null), p("c", null)])).toEqual([]);
  });

  it("does not join across the wrap-around when the first value is missing", () => {
    expect(names(drawnRuns([p("a", null), p("b", 2), p("c", 3), p("d", null)]))).toEqual([["b", "c"]]);
  });
});
