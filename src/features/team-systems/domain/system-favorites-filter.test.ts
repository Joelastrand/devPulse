import { describe, expect, it } from "vitest";
import { UNASSESSED_CLASSIFICATION, type SystemClassification } from "./team-system";
import { countActiveFilters, DEFAULT_SYSTEM_FILTER, filterSystems, type SystemFilter } from "./team-system-summary";

interface Row {
  systemId: string;
  name: string;
  description: string | null;
  knowledgeRisk: "none" | "high" | "elevated" | "lower";
  attention: boolean;
  classification: SystemClassification;
}

function row(systemId: string, systemType: SystemClassification["systemType"], extra: Partial<Row> = {}): Row {
  return {
    systemId,
    name: `System ${systemId}`,
    description: null,
    knowledgeRisk: "none",
    attention: false,
    classification: { ...UNASSESSED_CLASSIFICATION, systemType },
    ...extra,
  };
}

const rows: Row[] = [
  row("s1", "internt", { attention: true }),
  row("s2", "internt", { knowledgeRisk: "high" }),
  row("s3", "eksternt", { description: "Kundeportal" }),
  row("s4", "uavklart"),
];

const withFilter = (patch: Partial<SystemFilter>): SystemFilter => ({ ...DEFAULT_SYSTEM_FILTER, ...patch });
const ids = (list: Row[]) => list.map((system) => system.systemId);

describe("Plassering filter on the existing systemType field (Phase 2F.1)", () => {
  it("keeps only internal systems for the Interne option", () => {
    expect(ids(filterSystems(rows, withFilter({ systemType: "internt" })))).toEqual(["s1", "s2"]);
  });

  it("keeps only external systems for the Eksterne option", () => {
    expect(ids(filterSystems(rows, withFilter({ systemType: "eksternt" })))).toEqual(["s3"]);
  });

  it("keeps unassessed systems, including legacy records without a classification, for Ikke vurdert", () => {
    const legacy = { ...row("legacy", "uavklart"), classification: { ...UNASSESSED_CLASSIFICATION } };
    expect(ids(filterSystems([...rows, legacy], withFilter({ systemType: "uavklart" })))).toEqual(["s4", "legacy"]);
  });

  it("combines the placement filter with the attention filter", () => {
    const result = filterSystems(
      rows,
      withFilter({ systemType: "internt", attention: "attention", knowledge: "all" }),
    );
    expect(ids(result)).toEqual(["s1"]);
  });
});

describe("Kun favoritter (Phase 2F.1)", () => {
  it("shows only the favorite systems when the switch is on", () => {
    const result = filterSystems(rows, withFilter({ favoritesOnly: true }), new Set(["s2", "s3"]));
    expect(ids(result)).toEqual(["s2", "s3"]);
  });

  it("shows nothing when the switch is on and the person has no favorites", () => {
    expect(filterSystems(rows, withFilter({ favoritesOnly: true }), new Set())).toEqual([]);
  });

  it("ignores favorites while the switch is off", () => {
    expect(ids(filterSystems(rows, DEFAULT_SYSTEM_FILTER, new Set(["s1"])))).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("combines the favorites switch with the placement filter", () => {
    const result = filterSystems(rows, withFilter({ favoritesOnly: true, systemType: "internt" }), new Set(["s1", "s3"]));
    expect(ids(result)).toEqual(["s1"]);
  });

  it("never treats a system without an id as a favorite", () => {
    const anonymous = { name: "Uten id", description: null, knowledgeRisk: "none" as const, attention: false, classification: UNASSESSED_CLASSIFICATION };
    expect(filterSystems([anonymous], withFilter({ favoritesOnly: true }), new Set(["undefined"]))).toEqual([]);
  });

  it("counts the favorites switch as one active filter", () => {
    expect(countActiveFilters(withFilter({ favoritesOnly: true }))).toBe(1);
    expect(countActiveFilters(withFilter({ favoritesOnly: true, systemType: "eksternt", query: "  " }))).toBe(2);
    expect(countActiveFilters(DEFAULT_SYSTEM_FILTER)).toBe(0);
  });
});
