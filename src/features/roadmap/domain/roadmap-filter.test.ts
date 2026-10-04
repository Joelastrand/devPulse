import { describe, expect, it } from "vitest";
import type { TeamSkillView } from "../../skill-trees/client/skill-trees-gateway";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import {
  DEFAULT_ROADMAP_FILTER,
  eligibleRoadmapAreas,
  filterRoadmapItems,
  summarizeRoadmapItems,
  type RoadmapFilter,
} from "./roadmap-filter";

interface P {
  treeId: string;
  status: "planned" | "active" | "completed";
  priority: "high" | "medium" | "low";
  archived: boolean;
  overdue: boolean;
}

function p(treeId: string, o: Partial<P> = {}): P {
  return { treeId, status: "planned", priority: "medium", archived: false, overdue: false, ...o };
}
const f = (o: Partial<RoadmapFilter> = {}): RoadmapFilter => ({ ...DEFAULT_ROADMAP_FILTER, ...o });
const ids = (items: { treeId: string }[]) => items.map((i) => i.treeId);

const dataset: P[] = [
  p("a", { status: "active", priority: "high" }),
  p("b", { status: "planned", priority: "low", overdue: true }),
  p("c", { status: "completed", priority: "medium" }),
  p("d", { status: "active", priority: "low", archived: true }),
  p("e", { status: "completed", priority: "high", archived: true }),
  p("f", { status: "planned", priority: "high" }),
];

describe("filterRoadmapItems", () => {
  it("defaults hide archived and keep the rest in input order", () => {
    expect(ids(filterRoadmapItems(dataset, f()))).toEqual(["a", "b", "c", "f"]);
  });

  it("shows archived when visible", () => {
    expect(ids(filterRoadmapItems(dataset, f({ showArchived: true })))).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it.each([
    ["active", ["a"]],
    ["planned", ["b", "f"]],
    ["completed", ["c"]],
  ] as const)("filters status %s", (status, expected) => {
    expect(ids(filterRoadmapItems(dataset, f({ status })))).toEqual(expected);
  });

  it.each([
    ["high", ["a", "f"]],
    ["medium", ["c"]],
    ["low", ["b"]],
  ] as const)("filters priority %s", (priority, expected) => {
    expect(ids(filterRoadmapItems(dataset, f({ priority })))).toEqual(expected);
  });

  it("composes status and priority", () => {
    expect(ids(filterRoadmapItems(dataset, f({ status: "planned", priority: "high" })))).toEqual(["f"]);
    expect(filterRoadmapItems(dataset, f({ status: "active", priority: "low" }))).toEqual([]);
  });

  it("matches an archived plan's status/priority only when archived is shown", () => {
    const hidden = f({ status: "completed", priority: "high" });
    expect(filterRoadmapItems(dataset, hidden)).toEqual([]);
    expect(ids(filterRoadmapItems(dataset, { ...hidden, showArchived: true }))).toEqual(["e"]);
  });

  it("does not mutate or reorder its input", () => {
    const input = Object.freeze(dataset.map((i) => Object.freeze({ ...i })));
    const before = JSON.stringify(input);
    const out = filterRoadmapItems(input, f({ showArchived: true }));
    expect(out).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("handles empty input", () => {
    expect(filterRoadmapItems([], f({ status: "active" }))).toEqual([]);
  });
});

describe("summarizeRoadmapItems", () => {
  it("counts non-archived plans by exclusive status", () => {
    const s = summarizeRoadmapItems(dataset);
    expect(s).toEqual({ total: 4, active: 1, planned: 2, completed: 1, overdue: 1 });
    expect(s.planned + s.active + s.completed).toBe(s.total);
  });

  it("excludes archived plans from every count", () => {
    expect(
      summarizeRoadmapItems([p("x", { archived: true, status: "active", overdue: true })]),
    ).toEqual({ total: 0, active: 0, planned: 0, completed: 0, overdue: 0 });
  });

  it("is a function of the unfiltered set only (filter state is not an input)", () => {
    const base = summarizeRoadmapItems(dataset);
    // Summarising a pre-filtered list would differ — callers must pass the full set.
    expect(summarizeRoadmapItems(filterRoadmapItems(dataset, f({ status: "active" })))).not.toEqual(base);
    expect(summarizeRoadmapItems(dataset)).toEqual(base);
  });

  it("counts overdue only as a subset of active/planned", () => {
    const s = summarizeRoadmapItems([
      p("a", { status: "active", overdue: true }),
      p("b", { status: "completed", overdue: true }),
      p("c", { status: "planned" }),
    ]);
    expect(s.overdue).toBe(1);
    expect(s.overdue).toBeLessThanOrEqual(s.active + s.planned);
    expect(s.total).toBe(3);
  });

  it("handles empty input and exposes only descriptive counts", () => {
    const s = summarizeRoadmapItems([]);
    expect(Object.keys(s).sort()).toEqual(["active", "completed", "overdue", "planned", "total"]);
    expect(s.total).toBe(0);
  });

  it("does not mutate its input", () => {
    const input = Object.freeze(dataset.map((i) => Object.freeze({ ...i })));
    expect(() => summarizeRoadmapItems(input)).not.toThrow();
  });
});

describe("eligibleRoadmapAreas", () => {
  const area = (treeId: string) => ({ treeId, name: `Område ${treeId}` });
  const skills = ["a", "b", "c", "d", "e"].map(area);

  it("returns every area when there are no plans", () => {
    expect(eligibleRoadmapAreas(skills, [])).toEqual(skills);
  });

  it.each([
    ["planned", p("b", { status: "planned" })],
    ["active", p("b", { status: "active" })],
    ["completed", p("b", { status: "completed" })],
    ["archived", p("b", { status: "active", archived: true })],
  ])("a %s plan excludes its tree", (_label, item) => {
    expect(ids(eligibleRoadmapAreas(skills, [item]))).toEqual(["a", "c", "d", "e"]);
  });

  it("handles a mixture of archived and non-archived plans", () => {
    const items = [p("a"), p("c", { archived: true }), p("e", { status: "completed" })];
    expect(ids(eligibleRoadmapAreas(skills, items))).toEqual(["b", "d"]);
  });

  it("ignores roadmap treeIds that are not in the skills read", () => {
    expect(eligibleRoadmapAreas(skills, [p("zzz")])).toEqual(skills);
  });

  it("returns empty for empty skills", () => {
    expect(eligibleRoadmapAreas([], [p("a")])).toEqual([]);
  });

  it("preserves skills order and the original area objects", () => {
    const input = [area("z"), area("m"), area("a")];
    const out = eligibleRoadmapAreas(input, [p("m")]);
    expect(ids(out)).toEqual(["z", "a"]);
    expect(out[0]).toBe(input[0]);
    expect(out[1]).toBe(input[2]);
  });

  it("is deterministic with duplicate roadmap treeIds", () => {
    const items = [p("b"), p("b", { archived: true })];
    expect(ids(eligibleRoadmapAreas(skills, items))).toEqual(["a", "c", "d", "e"]);
  });

  it("uses the complete set, not a filtered/visible subset", () => {
    const visible = filterRoadmapItems(dataset, f());
    const sk = ["a", "d", "e", "g"].map(area);
    expect(ids(eligibleRoadmapAreas(sk, visible))).toEqual(["d", "e", "g"]);
    expect(ids(eligibleRoadmapAreas(sk, dataset))).toEqual(["g"]);
  });

  it("does not mutate inputs", () => {
    const a = Object.freeze([Object.freeze(area("a")), Object.freeze(area("b"))]);
    const items = Object.freeze([Object.freeze(p("a"))]);
    expect(ids(eligibleRoadmapAreas(a, items))).toEqual(["b"]);
  });
});

describe("structural compatibility with the real DTOs", () => {
  it("accepts RoadmapItemView and TeamSkillView without casts", () => {
    const items: RoadmapItemView[] = [];
    const skills: TeamSkillView[] = [];
    const filtered: RoadmapItemView[] = filterRoadmapItems(items, DEFAULT_ROADMAP_FILTER);
    const eligible: TeamSkillView[] = eligibleRoadmapAreas(skills, items);
    expect(summarizeRoadmapItems(filtered).total).toBe(0);
    expect(eligible).toEqual([]);
  });
});
