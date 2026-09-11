// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader";

describe("SiteHeader", () => {
  it("links to home, the pulse survey, results, teams, and sign-in", () => {
    render(<SiteHeader />);

    const nav = screen.getByRole("navigation", { name: /main/i });
    expect(nav.querySelector('a[href="/"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/pulse-survey"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/results"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/teams"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/sign-in"]')).toBeTruthy();
  });
});
