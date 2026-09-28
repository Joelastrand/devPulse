// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/features/teams/components/AdminTeams", () => ({
  AdminTeams: () => <div data-testid="admin-teams" />,
}));

const { default: AdminTeamsPage } = await import("./page");
const { WIDTH_CLASSNAMES } = await import("../../../src/components/ui/PageShell");

describe("AdminTeamsPage", () => {
  it("renders at the wide PageShell width (docs/features/ui-refresh/SPEC.md — BR-5)", () => {
    render(<AdminTeamsPage />);

    expect(screen.getByRole("main").className).toContain(WIDTH_CLASSNAMES.wide);
  });
});
