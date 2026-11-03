// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Section } from "./Section";

describe("Section", () => {
  afterEach(cleanup);

  it("renders its title as an h2", () => {
    render(<Section title="Pulse">Innhold</Section>);

    expect(screen.getByRole("heading", { level: 2, name: "Pulse" })).toBeTruthy();
  });

  it("labels the region with its heading", () => {
    render(<Section title="Pulse">Innhold</Section>);

    expect(screen.getByRole("region", { name: "Pulse" })).toBeTruthy();
  });

  it("renders the optional description and action beside the title", () => {
    render(
      <Section title="Pulse" description="Siste resultat" action={<button type="button">Vis alle</button>}>
        Innhold
      </Section>,
    );

    expect(screen.getByText("Siste resultat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vis alle" })).toBeTruthy();
  });

  it("separates sections with space, not a border", () => {
    const { container } = render(<Section title="Pulse">Innhold</Section>);

    const className = container.querySelector("section")?.className ?? "";
    expect(className).not.toMatch(/(^|\s)border(\s|$)/);
  });
});
