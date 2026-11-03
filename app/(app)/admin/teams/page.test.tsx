// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../src/features/teams/components/AdminTeams", () => ({
  AdminTeams: () => <div data-testid="admin-teams" />,
}));

const { default: AdminTeamsPage } = await import("./page");

describe("AdminTeamsPage", () => {
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
});
