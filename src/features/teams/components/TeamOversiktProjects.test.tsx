// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ClientTeamProject } from "../../team-projects/client/team-projects-gateway";
import { TeamOversiktProjects, compactProjects } from "./TeamOversiktProjects";

function project(overrides: Partial<ClientTeamProject> & { projectId: string }): ClientTeamProject {
  return {
    title: `Prosjekt ${overrides.projectId}`,
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    lifecycleStatus: "planned",
    effectiveStatus: "planned",
    priority: "medium",
    archived: false,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("compactProjects", () => {
  it("lists active projects before planned ones, each ordered by start date", () => {
    const result = compactProjects([
      project({ projectId: "p-planned-late", startDate: "2026-09-01", effectiveStatus: "planned" }),
      project({ projectId: "p-active-late", startDate: "2026-05-01", effectiveStatus: "active" }),
      project({ projectId: "p-planned-early", startDate: "2026-02-01", effectiveStatus: "planned" }),
      project({ projectId: "p-active-early", startDate: "2026-03-01", effectiveStatus: "active" }),
    ]);
    expect(result.map((p) => p.projectId)).toEqual(["p-active-early", "p-active-late", "p-planned-early", "p-planned-late"]);
  });

  it("excludes archived and completed projects", () => {
    const result = compactProjects([
      project({ projectId: "p-archived", effectiveStatus: "active", archived: true }),
      project({ projectId: "p-completed", effectiveStatus: "completed" }),
      project({ projectId: "p-kept", effectiveStatus: "planned" }),
    ]);
    expect(result.map((p) => p.projectId)).toEqual(["p-kept"]);
  });

  it("caps the compact list at five projects; the full list stays in Roadmap", () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      project({ projectId: `p-${index}`, startDate: `2026-0${index + 1}-01`, effectiveStatus: "active" }),
    );
    expect(compactProjects(many)).toHaveLength(5);
  });
});

describe("TeamOversiktProjects", () => {
  it("shows a loading state and no project rows while the read is pending", () => {
    render(<TeamOversiktProjects teamId="team-a" read={{ status: "loading" }} />);
    expect(screen.getByText("Laster…")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a forbidden message and no rows when the read is refused", () => {
    render(<TeamOversiktProjects teamId="team-a" read={{ status: "forbidden" }} />);
    expect(screen.getByText("Kun for teamledere")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows an unavailable message rather than an empty list when the read fails", () => {
    render(<TeamOversiktProjects teamId="team-a" read={{ status: "unavailable" }} />);
    expect(screen.getByText("Kunne ikke lastes")).toBeTruthy();
    expect(screen.queryByText("Ingen aktive eller planlagte prosjekter.")).toBeNull();
  });

  it("shows an explicit empty state when the team has no open projects", () => {
    render(<TeamOversiktProjects teamId="team-a" read={{ status: "ok", projects: [] }} />);
    expect(screen.getByText("Ingen aktive eller planlagte prosjekter.")).toBeTruthy();
  });

  it("renders project titles with their status text and links to the Roadmap tab", () => {
    render(
      <TeamOversiktProjects
        teamId="team-a"
        read={{ status: "ok", projects: [project({ projectId: "p-1", title: "Syntetisk prosjekt", effectiveStatus: "active" })] }}
      />,
    );
    const list = screen.getByRole("list", { name: "Prosjekter" });
    const row = within(list).getAllByRole("listitem")[0];
    expect(within(row).getByText("Syntetisk prosjekt")).toBeTruthy();
    expect(within(row).getByText("Pågår")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Roadmap/ }).getAttribute("href")).toBe("/teams/team-a/roadmap");
  });
});
