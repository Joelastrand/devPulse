// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeamCompetenceOverview, type OverviewArea } from "./TeamCompetenceOverview";

const AREAS: OverviewArea[] = [
  { treeId: "t-test", name: "Testautomatisering", level: 3, levelState: "value", target: 3, hasPlan: true },
  { treeId: "t-obs", name: "Observerbarhet", level: 2, levelState: "value", target: 3, hasPlan: false },
  { treeId: "t-int", name: "Integrasjoner", level: 1, levelState: "value", target: 3, hasPlan: false },
  { treeId: "t-sec", name: "Sikker utvikling", level: null, levelState: "not_set", target: 2, hasPlan: false },
];

function renderOverview(options: { canEdit: boolean; areas?: OverviewArea[]; mode?: "collaborative" | "automatic" }) {
  return render(
    <TeamCompetenceOverview
      teamId="team-1"
      areas={options.areas ?? AREAS}
      canEdit={options.canEdit}
      mode={options.mode ?? "collaborative"}
      radar={<div data-testid="radar" />}
    />,
  );
}

/** A row of the per-area table (not the priority list, which repeats some areas). */
function rowFor(name: string): HTMLElement {
  const table = screen.getByRole("heading", { name: "Kompetanse per område" }).closest("section");
  if (table === null) throw new Error("no table section");
  const row = within(table).getByText(name).closest("li");
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

afterEach(() => {
  cleanup();
});

describe("TeamCompetenceOverview", () => {
  it("counts areas on target out of all active areas, and never counts an unset area as on target", () => {
    renderOverview({ canEdit: false });

    expect(screen.getByText("1 av 4")).toBeTruthy();
    expect(screen.getByText("kompetanseområder på mål")).toBeTruthy();
  });

  it("states status in words with a count, not by colour alone", () => {
    renderOverview({ canEdit: false });

    const legend = screen.getByRole("list", { name: "Kompetanseområder" });
    expect(within(legend).getByText("Oppfyller mål").nextElementSibling?.textContent).toBe("1");
    expect(within(legend).getByText("Nær mål").nextElementSibling?.textContent).toBe("1");
    expect(within(legend).getByText("Under utvikling").nextElementSibling?.textContent).toBe("1");
    expect(within(legend).getByText("Ikke vurdert").nextElementSibling?.textContent).toBe("1");
  });

  it("shows an unset level as 'Ikke satt', never as zero", () => {
    renderOverview({ canEdit: false });

    expect(within(rowFor("Sikker utvikling")).getByText("Ikke satt")).toBeTruthy();
    expect(within(rowFor("Sikker utvikling")).queryByText("0 / 4")).toBeNull();
  });

  it("offers 'Opprett kompetanseplan' to a lead for an area without a plan, preselecting that area", () => {
    renderOverview({ canEdit: true });

    const link = within(rowFor("Observerbarhet")).getByRole("link", { name: /Opprett kompetanseplan/ });
    expect(link.getAttribute("href")).toBe("/teams/team-1/competence-plan?area=t-obs");
  });

  it("offers 'Rediger plan' to a lead for an area that already has a plan, never a second create action", () => {
    renderOverview({ canEdit: true });

    const row = rowFor("Testautomatisering");
    expect(within(row).getByRole("link", { name: /Rediger plan/ }).getAttribute("href")).toBe(
      "/teams/team-1/competence-plan#plan-card-t-test",
    );
    expect(within(row).queryByRole("link", { name: /Opprett kompetanseplan/ })).toBeNull();
  });

  it("gives a member the plan status and a link to the plan, but no create action", () => {
    renderOverview({ canEdit: false });

    expect(within(rowFor("Testautomatisering")).getByRole("link", { name: /Se kompetanseplan/ })).toBeTruthy();
    expect(within(rowFor("Observerbarhet")).queryByRole("link")).toBeNull();
    expect(within(rowFor("Observerbarhet")).getByText("Ingen plan ennå")).toBeTruthy();
  });

  it("lists only areas below target in priority, largest gap first", () => {
    renderOverview({ canEdit: false });

    const priority = screen.getByRole("heading", { name: "Prioriterte områder" }).closest("section");
    if (priority === null) throw new Error("no priority section");
    const names = within(priority)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("span")?.textContent);
    expect(names).toEqual(["Integrasjoner", "Observerbarhet"]);
  });

  it("does not show the automatic-mode note as a claim about levels in collaborative mode", () => {
    renderOverview({ canEdit: false, mode: "collaborative" });

    expect(screen.queryByText(/Nivåene for automatisk profil/)).toBeNull();
  });
});
