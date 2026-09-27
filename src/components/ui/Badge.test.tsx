// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  afterEach(cleanup);

  it("always renders its status text as real, visible content", () => {
    render(<Badge>Aktiv</Badge>);

    expect(screen.getByText("Aktiv")).toBeTruthy();
  });

  it("renders as an inline element carrying the supplied text, never an empty color-only marker", () => {
    const { container } = render(<Badge>Deaktivert</Badge>);

    const badge = container.querySelector("span");
    expect(badge?.textContent).toBe("Deaktivert");
  });

  it("forwards a caller className alongside the shared treatment", () => {
    render(<Badge className="extra-class">Ikke startet</Badge>);

    expect(screen.getByText("Ikke startet").className).toMatch(/extra-class/);
  });

  it("forwards other native span props (e.g. an accessible id for external reference)", () => {
    render(<Badge id="team-status">Aktiv</Badge>);

    expect(screen.getByText("Aktiv").id).toBe("team-status");
  });
});
