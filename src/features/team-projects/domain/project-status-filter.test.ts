import { describe, expect, it } from "vitest";
import { filterProjectsByStatus } from "./project-roadmap-view";

const projects = [
  { projectId: "a", effectiveStatus: "planned" as const },
  { projectId: "b", effectiveStatus: "active" as const },
  { projectId: "c", effectiveStatus: "planned" as const },
];

describe("filterProjectsByStatus", () => {
  it("keeps every project for the all filter, in stored order", () => {
    expect(filterProjectsByStatus(projects, "all").map((p) => p.projectId)).toEqual(["a", "b", "c"]);
  });

  it("keeps only projects with the selected effective status, in stored order", () => {
    expect(filterProjectsByStatus(projects, "planned").map((p) => p.projectId)).toEqual(["a", "c"]);
    expect(filterProjectsByStatus(projects, "active").map((p) => p.projectId)).toEqual(["b"]);
  });

  it("returns an empty list when no project has the status", () => {
    expect(filterProjectsByStatus(projects, "completed")).toEqual([]);
  });
});
