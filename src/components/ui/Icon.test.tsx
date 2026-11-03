// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { House } from "lucide-react";
import { Icon } from "./Icon";

describe("Icon", () => {
  afterEach(cleanup);

  it("is hidden from assistive technology by default", () => {
    const { container } = render(<Icon icon={House} />);

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("exposes an accessible name when a label is given", () => {
    render(<Icon icon={House} label="Hjem" />);

    const image = screen.getByRole("img", { name: "Hjem" });
    expect(image.getAttribute("aria-hidden")).toBeNull();
  });

  it("renders the action size of 20 px by default", () => {
    const { container } = render(<Icon icon={House} />);

    expect(container.querySelector("svg")?.getAttribute("width")).toBe("20");
  });

  it.each([
    ["inline", "16"],
    ["action", "20"],
    ["feature", "24"],
  ] as const)("renders the %s size at %s px", (size, pixels) => {
    const { container } = render(<Icon icon={House} size={size} />);

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe(pixels);
    expect(svg?.getAttribute("height")).toBe(pixels);
  });

  it("uses the 1.75 stroke width from the SPEC", () => {
    const { container } = render(<Icon icon={House} />);

    expect(container.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.75");
  });
});
