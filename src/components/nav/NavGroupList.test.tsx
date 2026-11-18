// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { NavGroup } from "./NavGroupList";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { activeNavHref, NavGroupList } = await import("./NavGroupList");

const GROUPS: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { href: "/", label: "Hjem" },
      { href: "/teams", label: "Team" },
    ],
  },
  {
    key: "personal",
    items: [
      { href: "/me/skills", label: "Ferdigheter" },
      { href: "/me/goals", label: "Mål" },
    ],
  },
  {
    key: "admin",
    items: [{ href: "/admin/teams", label: "Adminteam" }],
  },
];

describe("activeNavHref", () => {
  it.each([
    ["/", "/"],
    ["/teams", "/teams"],
    ["/teams/", "/teams"],
    ["/teams/team-1", "/teams"],
    ["/teams/team-1/systems", "/teams"],
    ["/teams/team-1/systems/sys-1/edit", "/teams"],
    ["/me/skills/x", "/me/skills"],
    ["/admin/teams/team-1", "/admin/teams"],
  ])("marks %s as the item %s", (pathname, expected) => {
    expect(activeNavHref(GROUPS, pathname)).toBe(expected);
  });

  it("never matches a route by a mere string prefix", () => {
    expect(activeNavHref(GROUPS, "/teamsfoo")).toBeNull();
    expect(activeNavHref(GROUPS, "/meskills")).toBeNull();
  });

  it("does not mark the root item for any nested path", () => {
    expect(activeNavHref(GROUPS, "/me/profile")).toBeNull();
  });

  it("returns null for an unknown route", () => {
    expect(activeNavHref(GROUPS, "/unknown")).toBeNull();
  });

  it("prefers the most specific matching item when two items match", () => {
    const nested: NavGroup[] = [
      { key: "a", items: [{ href: "/teams", label: "Team" }] },
      { key: "b", items: [{ href: "/teams/team-1/systems", label: "Systemer" }] },
    ];
    expect(activeNavHref(nested, "/teams/team-1/systems/s1")).toBe("/teams/team-1/systems");
    expect(activeNavHref(nested, "/teams/team-1/roadmap")).toBe("/teams");
  });
});

describe("NavGroupList current item", () => {
  afterEach(() => {
    cleanup();
  });

  it("gives aria-current to exactly one link on a nested route", () => {
    render(<NavGroupList groups={GROUPS} pathname="/teams/team-1/competence" />);

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Team");
  });

  it("marks the exact route and carries the visible active classes, not only a colour change", () => {
    render(<NavGroupList groups={GROUPS} pathname="/me/goals" />);

    const current = screen.getByRole("link", { current: "page", name: "Mål" });
    expect(current.className).toContain("font-semibold");
    expect(current.className).toContain("before:bg-sidebar-foreground");
    expect(screen.getByRole("link", { name: "Ferdigheter" }).hasAttribute("aria-current")).toBe(false);
  });
});
