// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  afterEach(cleanup);

  it("renders the title as the page's top-level <h1>", () => {
    render(<PageHeader title="Team" />);

    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeTruthy();
  });

  it("renders exactly one heading even with a description present", () => {
    render(<PageHeader title="Team" description="Administrer teamet ditt." />);

    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByText("Administrer teamet ditt.")).toBeTruthy();
  });

  it("omits the description paragraph when none is given", () => {
    const { container } = render(<PageHeader title="Team" />);

    expect(container.querySelector("p")).toBeNull();
  });
});

describe("PageHeader structure", () => {
  afterEach(cleanup);

  it("renders the eyebrow as visible text above the title", () => {
    const { container } = render(<PageHeader title="Team" eyebrow="Administrasjon" />);

    expect(screen.getByText("Administrasjon")).toBeTruthy();
    expect(container.querySelector("h1")?.previousElementSibling?.textContent).toBe("Administrasjon");
  });

  it("renders its one primary action beside the title", () => {
    render(<PageHeader title="Team" primaryAction={<button type="button">Ny samtale</button>} />);

    expect(screen.getByRole("button", { name: "Ny samtale" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the action out of the heading", () => {
    render(<PageHeader title="Team" primaryAction={<button type="button">Lagre</button>} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
  });
});
