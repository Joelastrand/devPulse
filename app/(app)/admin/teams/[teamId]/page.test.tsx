// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
