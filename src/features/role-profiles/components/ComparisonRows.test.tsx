// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComparisonRowView } from "../client/role-target-gateway";
import { personRoleCopy } from "../copy";
import { ComparisonRows } from "./ComparisonRows";

const copy = personRoleCopy.comparison;

afterEach(cleanup);

const ROWS: ComparisonRowView[] = [
  { treeId: "api", treeName: "API design", expectedLevel: 3, status: "meets", ownLevel: 4 },
  { treeId: "testing", treeName: "Testing", expectedLevel: 2, status: "development_opportunity", ownLevel: 1 },
  { treeId: "ops", treeName: "Operations", expectedLevel: 4, status: "not_assessed", ownLevel: null },
  { treeId: "broken", treeName: null, expectedLevel: 2, status: "area_unavailable", ownLevel: null },
];

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("li") as HTMLElement;
}

describe("ComparisonRows — available", () => {
  it("renders one text label per status, with the expected and own levels", () => {
    render(<ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />);

    expect(within(rowFor("API design")).getByText(copy.meets)).toBeTruthy();
    expect(within(rowFor("Testing")).getByText(copy.developmentOpportunity)).toBeTruthy();
    expect(within(rowFor("Operations")).getByText(copy.notAssessed)).toBeTruthy();
    expect(within(rowFor("API design")).getByText(`${copy.expectedLevel(3)} · ${copy.ownLevel(4)}`)).toBeTruthy();
  });

  it("shows a missing own level as not assessed, never as zero, and an unavailable tree as unavailable", () => {
    render(<ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />);

    expect(within(rowFor("Operations")).getByText(`${copy.expectedLevel(4)} · ${copy.notAssessed}`)).toBeTruthy();
    expect(within(rowFor("Operations")).queryByText(/Ditt nivå 0/)).toBeNull();
    expect(screen.getByText(`${copy.expectedLevel(2)} · ${copy.unavailable}`)).toBeTruthy();
  });

  it("keeps the response order and shows no summary totals", () => {
    const { container } = render(
      <ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />,
    );

    const names = Array.from(container.querySelectorAll("li p:first-child")).map((node) => node.textContent);
    expect(names).toEqual(["API design", "Testing", "Operations", copy.areaUnavailable]);
    expect(container.textContent ?? "").not.toMatch(/%|totalt|antall|prosent/i);
  });

  it("shows the approved privacy notice word for word", () => {
    render(<ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />);

    expect(
      screen.getByText(
        "Valgt rolle og sammenligningen er bare synlige for deg. Rollen sier noe om forventninger til en rolle, ikke om deg som person, og brukes ikke i vurdering, lønn eller tildeling av oppgaver.",
      ),
    ).toBeTruthy();
    expect(copy.privacyNotice).toBe(
      "Valgt rolle og sammenligningen er bare synlige for deg. Rollen sier noe om forventninger til en rolle, ikke om deg som person, og brukes ikke i vurdering, lønn eller tildeling av oppgaver.",
    );
  });
});

describe("ComparisonRows — Opprett mål (PG-1, PG-11, BR-14)", () => {
  it("offers the create-goal link only for development opportunity and not assessed rows", () => {
    render(<ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />);

    expect(screen.getAllByRole("link", { name: copy.createGoal })).toHaveLength(2);
    expect(within(rowFor("Testing")).getByRole("link", { name: copy.createGoal })).toBeTruthy();
    expect(within(rowFor("Operations")).getByRole("link", { name: copy.createGoal })).toBeTruthy();
    expect(within(rowFor("API design")).queryByRole("link", { name: copy.createGoal })).toBeNull();
    expect(within(rowFor(copy.areaUnavailable)).queryByRole("link", { name: copy.createGoal })).toBeNull();
  });

  it("links with treeId as the only parameter, and no title, role or level", () => {
    render(<ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />);

    const href = within(rowFor("Testing")).getByRole("link", { name: copy.createGoal }).getAttribute("href");
    expect(href).toBe("/me/goals?treeId=testing");
  });
});

describe("ComparisonRows — target states", () => {
  it("shows the zero-expectation notice without rows", () => {
    const { container } = render(
      <ComparisonRows comparison={{ state: "target_unavailable", reason: "no_expectations" }} />,
    );

    expect(screen.getByText(personRoleCopy.noExpectations)).toBeTruthy();
    expect(container.querySelector("li")).toBeNull();
  });

  it("shows the unavailable notice without rows for reason unavailable", () => {
    const { container } = render(<ComparisonRows comparison={{ state: "target_unavailable", reason: "unavailable" }} />);

    expect(screen.getByText(personRoleCopy.unavailable)).toBeTruthy();
    expect(container.querySelector("li")).toBeNull();
  });

  it("renders nothing without a target", () => {
    const { container } = render(<ComparisonRows comparison={{ state: "no_target" }} />);

    expect(container.textContent).toBe("");
  });
});
