// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PublicHeader } from "./PublicHeader";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

describe("PublicHeader", () => {
  afterEach(() => {
    cleanup();
    mockPathname = "/";
  });

  it("offers only Hjem, Logg inn and Opprett konto", () => {
    render(<PublicHeader />);

    const nav = screen.getByRole("navigation", { name: "Hovednavigasjon" });
    const links = within(nav).getAllByRole("link").map((link) => link.textContent);
    expect(links).toEqual(["Hjem", "Logg inn", "Opprett konto"]);
  });

  it("marks the current page with aria-current on its exact path", () => {
    mockPathname = "/sign-in";
    render(<PublicHeader />);

    expect(screen.getByRole("link", { name: "Logg inn" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Hjem" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows the product name as text, not as a second navigation entry", () => {
    render(<PublicHeader />);

    expect(screen.getByText("DevPulse")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Hovednavigasjon" }).textContent).not.toContain("DevPulse");
  });
});
