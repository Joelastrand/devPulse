import { describe, expect, it } from "vitest";
import {
  buildGanttRows,
  buildMemberParticipationRows,
  formatMonthLabelNb,
  formatPlanDateNb,
  type ParticipationInput,
} from "./project-roadmap-view";
import { buildTimelineWindow } from "./timeline-geometry";
import { groupProjectsByStatus } from "./project-roadmap-view";

describe("groupProjectsByStatus", () => {
  it("orders groups planned, active, completed, omits empty groups and keeps stored order inside a group", () => {
    const groups = groupProjectsByStatus([
      { projectId: "c", effectiveStatus: "completed" as const },
      { projectId: "a1", effectiveStatus: "active" as const },
      { projectId: "p1", effectiveStatus: "planned" as const },
      { projectId: "a2", effectiveStatus: "active" as const },
    ]);
    expect(groups.map((group) => group.status)).toEqual(["planned", "active", "completed"]);
    expect(groups[1].projects.map((project) => project.projectId)).toEqual(["a1", "a2"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupProjectsByStatus([])).toEqual([]);
  });
});

const SIX_MONTHS_FROM_NOV_2026 = buildTimelineWindow("2026-11-06", 6); // 2026-11-01 .. 2027-04-30, 181 days
const THREE_MONTHS_FROM_NOV_2026 = buildTimelineWindow("2026-11-06", 3); // 2026-11-01 .. 2027-01-31, 92 days

function project(overrides: Partial<Parameters<typeof buildGanttRows>[0][number]> & { projectId: string }) {
  return { title: `Prosjekt ${overrides.projectId}`, startDate: "2026-11-01", endDate: "2026-11-30", archived: false, ...overrides };
}

describe("buildGanttRows", () => {
  it("positions bars from the real start and end dates inside the window", () => {
    const [row] = buildGanttRows([project({ projectId: "p-1", startDate: "2026-11-01", endDate: "2026-12-31" })], SIX_MONTHS_FROM_NOV_2026);

    expect(row?.bar?.leftPercent).toBeCloseTo(0);
    expect(row?.bar?.widthPercent).toBeCloseTo((61 / 181) * 100);
    expect(row?.bar?.clippedStart).toBe(false);
    expect(row?.bar?.clippedEnd).toBe(false);
  });

  it("clips a project that starts before and ends after the three-month window", () => {
    const [row] = buildGanttRows([project({ projectId: "p-1", startDate: "2026-10-01", endDate: "2027-03-31" })], THREE_MONTHS_FROM_NOV_2026);

    expect(row?.bar?.leftPercent).toBeCloseTo(0);
    expect(row?.bar?.widthPercent).toBeCloseTo(100);
    expect(row?.bar?.clippedStart).toBe(true);
    expect(row?.bar?.clippedEnd).toBe(true);
  });

  it("lists a project outside the window without a bar", () => {
    const [row] = buildGanttRows([project({ projectId: "p-1", startDate: "2026-01-01", endDate: "2026-03-01" })], SIX_MONTHS_FROM_NOV_2026);

    expect(row?.bar).toBeNull();
  });

  it("excludes archived projects from the plan", () => {
    const rows = buildGanttRows(
      [project({ projectId: "p-1" }), project({ projectId: "p-2", archived: true })],
      SIX_MONTHS_FROM_NOV_2026,
    );

    expect(rows.map((row) => row.projectId)).toEqual(["p-1"]);
  });
});

function participation(overrides: Partial<ParticipationInput> & { participationId: string }): ParticipationInput {
  return {
    projectId: "p-1",
    projectTitle: "Demo",
    memberRef: "m-1",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    overlapsOther: false,
    archived: false,
    ...overrides,
  };
}

describe("buildMemberParticipationRows", () => {
  it("groups intervals by member and sorts members by display name", () => {
    const rows = buildMemberParticipationRows(
      [
        participation({ participationId: "a-1", memberRef: "m-2" }),
        participation({ participationId: "a-2", memberRef: "m-1" }),
        participation({ participationId: "a-3", memberRef: "m-1", startDate: "2026-12-01", endDate: "2026-12-15" }),
      ],
      [
        { memberRef: "m-1", displayName: "Anna Sørensen" },
        { memberRef: "m-2", displayName: "Marius" },
      ],
      SIX_MONTHS_FROM_NOV_2026,
    );

    expect(rows.map((row) => row.displayName)).toEqual(["Anna Sørensen", "Marius"]);
    expect(rows[0]?.bars.map((bar) => bar.participationId)).toEqual(["a-2", "a-3"]);
  });

  it("keeps a member without a name as null instead of inventing one", () => {
    const [row] = buildMemberParticipationRows(
      [participation({ participationId: "a-1", memberRef: "m-9" })],
      [],
      SIX_MONTHS_FROM_NOV_2026,
    );

    expect(row?.displayName).toBeNull();
  });

  it("drops archived intervals and intervals outside the window", () => {
    const rows = buildMemberParticipationRows(
      [
        participation({ participationId: "a-1", archived: true }),
        participation({ participationId: "a-2", startDate: "2026-01-01", endDate: "2026-01-31" }),
      ],
      [],
      SIX_MONTHS_FROM_NOV_2026,
    );

    expect(rows).toEqual([]);
  });

  it("carries the informational overlap flag without computing any capacity value", () => {
    const [row] = buildMemberParticipationRows(
      [participation({ participationId: "a-1", overlapsOther: true })],
      [],
      SIX_MONTHS_FROM_NOV_2026,
    );

    expect(row?.bars[0]?.overlapsOther).toBe(true);
    expect(Object.keys(row ?? {})).toEqual(["memberRef", "displayName", "bars", "laneCount"]);
  });
});

describe("Norwegian date labels", () => {
  it("formats a calendar date without locale-dependent output", () => {
    expect(formatPlanDateNb("2027-01-15")).toBe("15. jan 2027");
    expect(formatPlanDateNb("2026-12-01")).toBe("1. des 2026");
  });

  it("formats month column headers across a year boundary", () => {
    expect(formatMonthLabelNb(12, 2026)).toBe("des 2026");
    expect(formatMonthLabelNb(1, 2027)).toBe("jan 2027");
  });
});
