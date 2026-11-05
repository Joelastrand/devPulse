// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectMainLandmark, expectNamedControls } from "../../../../../src/components/ui/heading-structure";
import { cleanup } from "@testing-library/react";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../../src/features/teams/components/AdminTeamDetail", () => ({
  AdminTeamDetail: () => <div data-testid="admin-team-detail" />,
}));

const { default: AdminTeamDetailPage } = await import("./page");

function paramsOf(teamId: string) {
  return Promise.resolve({ teamId });
}

describe("AdminTeamDetailPage", () => {
  it("renders at the wide PageShell width (docs/features/ui-refresh/SPEC.md — BR-5)", async () => {
    render(await AdminTeamDetailPage({ params: paramsOf("team-1") }));

    expect(screen.getByRole("main").closest(".max-w-main")).not.toBeNull();
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark; the page title is checked in the composed view's suite", async () => {
    render(await AdminTeamDetailPage({ params: paramsOf("team-1") }));
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    // The page title is owned by the composed client view; its heading structure is checked in that view's suite.
  });
});
