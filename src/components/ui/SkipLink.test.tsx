// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SKIP_LINK_TARGET_ID, SkipLink } from "./SkipLink";

describe("SkipLink", () => {
  afterEach(cleanup);

  it("links to the main content target with visible Norwegian text", () => {
    render(<SkipLink />);

    const link = screen.getByRole("link", { name: "Hopp til innhold" });
    expect(link.getAttribute("href")).toBe(`#${SKIP_LINK_TARGET_ID}`);
  });

  it("is the first focusable element when rendered first", () => {
    render(
      <>
        <SkipLink />
        <button type="button">Meny</button>
      </>,
    );

    const first = document.querySelector("a, button");
    expect(first?.textContent).toBe("Hopp til innhold");
  });
});
