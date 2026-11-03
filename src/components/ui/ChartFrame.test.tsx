// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ChartFrame } from "./ChartFrame";

describe("ChartFrame", () => {
  afterEach(cleanup);

  it("names the figure by its title", () => {
    render(
      <ChartFrame title="Puls over tid" legend={<span>Teamet</span>} table={<table />}>
        <div>graf</div>
      </ChartFrame>,
    );

    expect(screen.getByRole("figure", { name: "Puls over tid" })).toBeTruthy();
  });

  it("renders the legend slot", () => {
    render(
      <ChartFrame title="Puls" legend={<span>Teamet</span>} table={<table />}>
        <div>graf</div>
      </ChartFrame>,
    );

    expect(screen.getByText("Teamet")).toBeTruthy();
  });

  it("renders the table alternative beside the chart", () => {
    render(
      <ChartFrame title="Puls" table={<table aria-label="Tabell over puls" />}>
        <div>graf</div>
      </ChartFrame>,
    );

    expect(screen.getByRole("table", { name: "Tabell over puls" })).toBeTruthy();
    expect(screen.getByText("graf")).toBeTruthy();
  });

  it("renders the empty slot instead of the chart when data is insufficient", () => {
    render(
      <ChartFrame title="Puls" insufficientData empty={<p>For få svar til å vise trend.</p>} />,
    );

    expect(screen.getByText("For få svar til å vise trend.")).toBeTruthy();
  });

  it("does not render a table alternative for insufficient data, because there is nothing to tabulate", () => {
    render(
      <ChartFrame title="Puls" insufficientData empty={<p>Ingen data</p>} />,
    );

    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the note for suppressed values as text beneath the chart", () => {
    render(
      <ChartFrame title="Puls" table={<table />} note="Tomme punkter er skjult av personvern, ikke null.">
        <div>graf</div>
      </ChartFrame>,
    );

    const figure = screen.getByRole("figure", { name: "Puls" });
    expect(within(figure).getByText("Tomme punkter er skjult av personvern, ikke null.")).toBeTruthy();
  });

  it("does not compute values: it renders only the slots the caller passes", () => {
    const { container } = render(
      <ChartFrame title="Puls" table={<table />}>
        <div>graf</div>
      </ChartFrame>,
    );

    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\b0\b/);
  });
});
