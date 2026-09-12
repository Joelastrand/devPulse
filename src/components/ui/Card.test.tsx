// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  afterEach(cleanup);

  it("renders as a <div> by default", () => {
    render(<Card>Innhold</Card>);

    expect(screen.getByText("Innhold").tagName).toBe("DIV");
  });

  it("renders as a list item for a list-row card", () => {
    render(
      <ul>
        <Card as="li">Team A</Card>
      </ul>,
    );

    expect(screen.getByRole("listitem")).toBeTruthy();
  });

  it("renders as a labelled region for a section-level panel", () => {
    render(
      <Card as="section" aria-label="Sammendrag">
        Innhold
      </Card>,
    );

    expect(screen.getByRole("region", { name: "Sammendrag" })).toBeTruthy();
  });

  it("passes through arbitrary props to the rendered element", () => {
    render(<Card data-testid="team-card">Innhold</Card>);

    expect(screen.getByTestId("team-card")).toBeTruthy();
  });
});
