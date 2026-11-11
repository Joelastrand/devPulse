// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetencePlanPageData } from "../client/use-competence-plans";

const hook = vi.hoisted(() => ({ data: { phase: "loading" } as unknown }));

vi.mock("../client/use-competence-plans", () => ({
  useCompetencePlans: () => ({
    data: hook.data,
    create: vi.fn(),
    save: vi.fn(),
    saveMilestoneCompletion: vi.fn(),
    reload: vi.fn(),
  }),
}));

import { CompetencePlanSection } from "./CompetencePlanSection";

function loaded(overrides: Partial<Extract<CompetencePlanPageData, { phase: "loaded" }>> = {}): CompetencePlanPageData {
  return {
    phase: "loaded",
    canEdit: true,
    truncated: false,
    legacyItems: [],
    legacyFailed: false,
    plans: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("CompetencePlanSection creation entry (Kompetanseplan)", () => {
  it("offers 'Ny kompetanseplan' to a lead even when the team has no competence areas", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);

    expect(screen.getByRole("button", { name: "Ny kompetanseplan" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Tildel kompetanseområder på Teamkompetanse" })).toBeNull();
  });

  it("opens a creation form with a plan title field and no competence-area picker", async () => {
    hook.data = loaded();
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<CompetencePlanSection teamId="team-1" />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Ny kompetanseplan" }));

    expect(screen.getByRole("form", { name: "Legg til kompetanseplan" })).toBeTruthy();
    expect(screen.getByLabelText("Navn på plan")).toBeTruthy();
    expect(screen.queryByLabelText("Kompetanseområde")).toBeNull();
  });

  it("does not show the creation action to a member", () => {
    hook.data = loaded({ canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);

    expect(screen.queryByRole("button", { name: "Ny kompetanseplan" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });
});
