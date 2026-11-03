// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBadge, type StatusTone } from "./StatusBadge";

const TONES: StatusTone[] = ["success", "warning", "danger", "info", "neutral"];

describe("StatusBadge", () => {
  afterEach(cleanup);

  it.each(TONES)("renders the %s tone with its text label", (tone) => {
    render(<StatusBadge tone={tone}>Status</StatusBadge>);

    expect(screen.getByText("Status")).toBeTruthy();
  });

  it.each(TONES)("renders a decorative icon for the %s tone", (tone) => {
    const { container } = render(<StatusBadge tone={tone}>Status</StatusBadge>);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the caller's text as the only text content", () => {
    const { container } = render(<StatusBadge tone="success">Fullført</StatusBadge>);

    expect(container.querySelector("span")?.textContent).toBe("Fullført");
  });

  it("uses the neutral tone when none is given", () => {
    render(<StatusBadge>Aktiv</StatusBadge>);

    expect(screen.getByText("Aktiv").className).toContain("text-text-secondary");
  });

  it("gives each tone a different text colour token, so tone is not colour alone", () => {
    const classes = TONES.map((tone) => {
      const { unmount, container } = render(<StatusBadge tone={tone}>Status</StatusBadge>);
      const className = container.querySelector("span")?.className ?? "";
      unmount();
      return className;
    });
    expect(new Set(classes).size).toBe(TONES.length);
  });

  it("forwards a caller className and native span props", () => {
    render(
      <StatusBadge tone="info" className="extra-class" id="status-1">
        Ny
      </StatusBadge>,
    );

    const badge = screen.getByText("Ny");
    expect(badge.className).toMatch(/extra-class/);
    expect(badge.id).toBe("status-1");
  });
});
