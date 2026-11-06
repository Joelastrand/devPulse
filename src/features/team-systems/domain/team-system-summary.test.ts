import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_FILTER,
  filterSystems,
  summarizeSystems,
  type SystemSummaryInput,
} from "./team-system-summary";

const base = (overrides: Partial<SystemSummaryInput>): SystemSummaryInput => ({
  name: "System",
  description: null,
  knowledgeRisk: "none",
  knowledgeCount: 0,
  attention: false,
  inGoodStanding: false,
  ...overrides,
});

describe("summarizeSystems (BR-11, BR-12)", () => {
  const systems: SystemSummaryInput[] = [
    base({ name: "A", knowledgeRisk: "high", knowledgeCount: 1, inGoodStanding: true }),
    base({ name: "B", knowledgeRisk: "elevated", knowledgeCount: 2, attention: true }),
    base({ name: "C", knowledgeRisk: "lower", knowledgeCount: 3 }),
    base({ name: "D", knowledgeRisk: "none", knowledgeCount: 0, attention: true }),
  ];

  it("counts systems, good standing and attention from the list only", () => {
    const summary = summarizeSystems(systems);
    expect(summary.total).toBe(4);
    expect(summary.inGoodStanding).toBe(1);
    expect(summary.needingAttention).toBe(2);
  });

  it("counts knowledge-risk systems as those with at most one knowledgeable member", () => {
    expect(summarizeSystems(systems).knowledgeRiskCount).toBe(2);
  });

  it("counts systems per knowledge band and systems with exactly one knowledgeable person", () => {
    const summary = summarizeSystems(systems);
    expect(summary.byBand).toEqual({ none: 1, high: 1, elevated: 1, lower: 1 });
    expect(summary.singleKnowledgePersonCount).toBe(1);
  });

  it("returns zeros for an empty inventory (no invented data)", () => {
    const summary = summarizeSystems([]);
    expect(summary.total).toBe(0);
    expect(summary.byBand).toEqual({ none: 0, high: 0, elevated: 0, lower: 0 });
  });
});

describe("filterSystems (BR-13)", () => {
  const systems: SystemSummaryInput[] = [
    base({ name: "Saksportalen", description: "Saksbehandling og arkiv", knowledgeRisk: "high", knowledgeCount: 1 }),
    base({ name: "Dataplattform", description: "Analyse", knowledgeRisk: "lower", knowledgeCount: 3, attention: true }),
  ];

  it("returns everything for the default filter", () => {
    expect(filterSystems(systems, DEFAULT_SYSTEM_FILTER)).toHaveLength(2);
  });

  it("matches the name case-insensitively and ignores surrounding whitespace", () => {
    const found = filterSystems(systems, { ...DEFAULT_SYSTEM_FILTER, query: "  SAKS " });
    expect(found.map((s) => s.name)).toEqual(["Saksportalen"]);
  });

  it("matches the description too", () => {
    const found = filterSystems(systems, { ...DEFAULT_SYSTEM_FILTER, query: "arkiv" });
    expect(found.map((s) => s.name)).toEqual(["Saksportalen"]);
  });

  it("filters to systems that need attention", () => {
    const found = filterSystems(systems, { ...DEFAULT_SYSTEM_FILTER, attention: "attention" });
    expect(found.map((s) => s.name)).toEqual(["Dataplattform"]);
  });

  it("filters by an exact knowledge-risk band", () => {
    const found = filterSystems(systems, { ...DEFAULT_SYSTEM_FILTER, knowledge: "high" });
    expect(found.map((s) => s.name)).toEqual(["Saksportalen"]);
  });

  it("returns an empty list when nothing matches (no-results state input)", () => {
    expect(filterSystems(systems, { ...DEFAULT_SYSTEM_FILTER, query: "finnes-ikke" })).toEqual([]);
  });
});
