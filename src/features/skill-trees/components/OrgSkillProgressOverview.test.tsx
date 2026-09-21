// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { OrgSkillProgressTreeView } from "../client/skill-trees-gateway";
import { OrgSkillProgressOverview } from "./OrgSkillProgressOverview";

afterEach(() => {
  cleanup();
});

const ONE_TEAM_TREE: OrgSkillProgressTreeView = {
  treeId: "tree-1",
  name: "Containere",
  nodes: [
    { nodeId: "node-0", label: "Fundamentals", order: 0 },
    { nodeId: "node-1", label: "Pilotdrift", order: 1 },
  ],
  teams: [{ teamId: "team-1", teamName: "Alpha", teamStatus: "active", currentNodeId: "node-1" }],
};

const MULTI_TEAM_TREE: OrgSkillProgressTreeView = {
  treeId: "tree-2",
  name: "Kubernetes",
  nodes: [
    { nodeId: "node-0", label: "Fundamentals", order: 0 },
    { nodeId: "node-1", label: "Produksjon", order: 1 },
  ],
  teams: [
    { teamId: "team-2", teamName: "Bravo", teamStatus: "active", currentNodeId: null },
    { teamId: "team-3", teamName: "Charlie", teamStatus: "disabled", currentNodeId: "node-0" },
  ],
};

describe("OrgSkillProgressOverview", () => {
  it("shows a Norwegian loading state", () => {
    render(<OrgSkillProgressOverview state={{ status: "loading" }} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows a generic error state, isolated (nothing else rendered)", () => {
    const { container } = render(<OrgSkillProgressOverview state={{ status: "error" }} />);

    expect(screen.getByRole("alert").textContent).toMatch(/noe gikk galt/i);
    expect(container.querySelectorAll("ul").length).toBe(0);
  });

  it("shows a distinct empty state for zero trees", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [] }} />);

    expect(screen.getByText(/ingen kompetanseområder spores/i)).toBeTruthy();
  });

  it("renders a one-team tree with its team name and current stage label", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [ONE_TEAM_TREE] }} />);

    expect(screen.getByText("Containere")).toBeTruthy();
    expect(screen.getByText("Alpha", { exact: false })).toBeTruthy();
    expect(screen.getByText(/pilotdrift/i)).toBeTruthy();
  });

  it("renders a multi-team tree with every tracking team", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE] }} />);

    expect(screen.getByText("Kubernetes")).toBeTruthy();
    expect(screen.getByText("Bravo", { exact: false })).toBeTruthy();
    expect(screen.getByText("Charlie", { exact: false })).toBeTruthy();
  });

  it("renders 'Ikke startet' for a null currentNodeId, never blank", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE] }} />);

    expect(screen.getByText(/ikke startet/i)).toBeTruthy();
  });

  it("labels a disabled team's entry with 'Deaktivert' via text", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE] }} />);

    const charlieRow = screen.getByText("Charlie", { exact: false }).closest("li");
    expect(charlieRow?.textContent).toMatch(/deaktivert/i);
    // Never color-only: the label is plain text content, not conveyed via
    // a class-only visual treatment with no textual equivalent.
    expect(charlieRow?.textContent).toContain("Deaktivert");
  });

  it("preserves the DTO's tree ordering without re-sorting", () => {
    const { container } = render(
      <OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE, ONE_TEAM_TREE] }} />,
    );

    const headings = Array.from(container.querySelectorAll("h3")).map((el) => el.textContent);
    expect(headings).toEqual(["Kubernetes", "Containere"]);
  });

  it("preserves the DTO's team ordering within a tree without re-sorting", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE] }} />);

    const teamHeading = screen.getByText("Kubernetes");
    const teamList = teamHeading.closest("li")?.querySelector("ul");
    const items = Array.from(teamList?.querySelectorAll("li") ?? []).map((el) => el.textContent ?? "");
    const bravoIndex = items.findIndex((text) => text.includes("Bravo"));
    const charlieIndex = items.findIndex((text) => text.includes("Charlie"));
    expect(bravoIndex).toBeGreaterThanOrEqual(0);
    expect(charlieIndex).toBeGreaterThan(bravoIndex);
  });

  it("uses semantic list markup for trees and teams", () => {
    const { container } = render(
      <OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE] }} />,
    );

    expect(container.querySelectorAll("ul").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("renders no interactive/mutation control anywhere in this section", () => {
    render(<OrgSkillProgressOverview state={{ status: "loaded", trees: [MULTI_TEAM_TREE, ONE_TEAM_TREE] }} />);

    expect(screen.queryAllByRole("button").length).toBe(0);
    expect(screen.queryAllByRole("link").length).toBe(0);
    expect(screen.queryAllByRole("textbox").length).toBe(0);
  });
});
