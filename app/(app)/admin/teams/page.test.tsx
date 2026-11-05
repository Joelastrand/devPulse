// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../../src/features/teams/components/AdminTeams", () => ({
  AdminTeams: () => <div data-testid="admin-teams" />,
}));

const { default: AdminTeamsPage } = await import("./page");

describe("AdminTeamsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders at the wide PageShell width (docs/features/ui-refresh/SPEC.md — BR-5)", () => {
    render(<AdminTeamsPage />);

    expect(screen.getByRole("main").closest(".max-w-main")).not.toBeNull();
  });

  it("links to the admin roles page next to the skill areas page (role-profiles TASK-020)", () => {
    render(<AdminTeamsPage />);

    const links = screen.getAllByRole("link", { name: "Roller" });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute("href") === "/admin/roles")).toBe(true);
  });

  it("shows the admin scope marker and no invented tab (visual-redesign TASK-014, BR-23)", () => {
    render(<AdminTeamsPage />);

    expect(screen.getAllByText("Administrasjon").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: /Medlemmer|Tilganger|Innstillinger/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Medlemmer|Tilganger|Innstillinger/ })).toBeNull();
  });
});

describe("admin teams heading structure (visual-redesign TASK-019)", () => {
  it("has one level-1 page title and a valid hierarchy", () => {
    render(<AdminTeamsPage />);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<AdminTeamsPage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
