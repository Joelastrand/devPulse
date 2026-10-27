// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const usePathnameMock = vi.fn(() => "/me/skills");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

const { PersonalNav } = await import("./PersonalNav");

afterEach(() => {
  cleanup();
  usePathnameMock.mockReset();
  usePathnameMock.mockReturnValue("/me/skills");
});

describe("PersonalNav", () => {
  it("is a labelled navigation landmark listing exactly Ferdigheter, Mål and Samtaler in that order", () => {
    render(<PersonalNav />);
    const nav = screen.getByRole("navigation", { name: "Personlig utvikling" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Ferdigheter", "/me/skills"],
      ["Mål", "/me/goals"],
      ["Samtaler", "/me/conversations"],
    ]);
  });

  it.each([
    ["/me/skills", "Ferdigheter", "Mål"],
    ["/me/goals", "Mål", "Ferdigheter"],
    ["/me/conversations", "Samtaler", "Mål"],
  ])("on %s marks only %s as the current page", (path, current, other) => {
    usePathnameMock.mockReturnValue(path);
    render(<PersonalNav />);
    expect(screen.getByRole("link", { name: current }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: other }).getAttribute("aria-current")).toBeNull();
  });

  it.each([
    "/me/skills/",
    "/me/goals/x",
    "/me/profile",
    "/",
    // Decision (TASK-032): a conversation detail page is not an exact match, so no entry is current there.
    "/me/conversations/conv-1",
  ])("marks neither entry current on %s (exact path only)", (path) => {
    usePathnameMock.mockReturnValue(path);
    render(<PersonalNav />);
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("aria-current")).toBeNull();
  });

  it("adds exactly one Samtaler entry and no role, placeholder or other extra entry", () => {
    render(<PersonalNav />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: /samtaler/i })).toHaveLength(1);
  });
});
