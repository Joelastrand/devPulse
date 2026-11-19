// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTeamTabPanel, AdminTeamTabs } from "./AdminTeamTabs";

const routing = vi.hoisted(() => {
  let snapshot = new URLSearchParams("");
  const listeners = new Set<() => void>();
  function setSearch(query: string) {
    snapshot = new URLSearchParams(query);
    for (const listener of listeners) listener();
  }
  function navigate(href: string) {
    setSearch(href.split("?")[1] ?? "");
  }
  return {
    setSearch,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push: vi.fn((href: string) => navigate(href)),
    replace: vi.fn((href: string) => navigate(href)),
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/admin/teams/team-1",
    useRouter: () => ({ push: routing.push, replace: routing.replace }),
    useSearchParams: () => useSyncExternalStore(routing.subscribe, routing.getSnapshot),
  };
});


function renderShell() {
  return render(
    <AdminTeamTabs label="Administrasjon av teamet">
      <AdminTeamTabPanel id="oversikt" label="Oversikt">
        <p>Innhold oversikt</p>
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="medlemmer" label="Medlemmer">
        <p>Innhold medlemmer</p>
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="kompetanse" label="Kompetanse">
        <p>Innhold kompetanse</p>
      </AdminTeamTabPanel>
    </AdminTeamTabs>,
  );
}

function selectedTabLabel(): string | undefined {
  return screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent ?? undefined;
}

function panelFor(label: string): HTMLElement {
  const tab = screen.getByRole("tab", { name: label });
  const panelId = tab.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  if (!panel) throw new Error(`No panel for ${label}`);
  return panel;
}

beforeEach(() => {
  routing.setSearch("");
  routing.push.mockClear();
  routing.replace.mockClear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("AdminTeamTabs selection from the URL", () => {
  it("selects the first tab when no tab parameter is present", () => {
    renderShell();
    expect(selectedTabLabel()).toBe("Oversikt");
    expect(panelFor("Oversikt").className).not.toContain("hidden");
    expect(panelFor("Medlemmer").className).toContain("hidden");
  });

  it("selects the tab named by a direct link", () => {
    routing.setSearch("tab=kompetanse");
    renderShell();
    expect(selectedTabLabel()).toBe("Kompetanse");
    expect(panelFor("Kompetanse").className).not.toContain("hidden");
  });

  it("falls back to the first tab for an unknown value without rewriting the URL", () => {
    routing.setSearch("tab=unknown");
    renderShell();
    expect(selectedTabLabel()).toBe("Oversikt");
    expect(routing.replace).not.toHaveBeenCalled();
    expect(routing.push).not.toHaveBeenCalled();
  });

  it("falls back to the first tab when the tab parameter is duplicated", () => {
    routing.setSearch("tab=medlemmer&tab=kompetanse");
    renderShell();
    expect(selectedTabLabel()).toBe("Oversikt");
  });
});

describe("AdminTeamTabs switching", () => {
  it("pushes the selected tab into the URL and keeps unrelated parameters", async () => {
    routing.setSearch("ref=team-link");
    renderShell();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Medlemmer" }));
    expect(routing.push).toHaveBeenCalledWith("/admin/teams/team-1?ref=team-link&tab=medlemmer", { scroll: false });
    expect(selectedTabLabel()).toBe("Medlemmer");
  });

  it("moves between tabs with Arrow, Home and End keys", async () => {
    renderShell();
    const user = userEvent.setup();
    screen.getByRole("tab", { name: "Oversikt" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(selectedTabLabel()).toBe("Medlemmer");
    await user.keyboard("{End}");
    expect(selectedTabLabel()).toBe("Kompetanse");
    await user.keyboard("{ArrowRight}");
    expect(selectedTabLabel()).toBe("Oversikt");
    await user.keyboard("{Home}");
    expect(selectedTabLabel()).toBe("Oversikt");
  });

  it("keeps only the selected tab in the tab order", () => {
    routing.setSearch("tab=medlemmer");
    renderShell();
    expect(screen.getByRole("tab", { name: "Medlemmer" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Oversikt" }).tabIndex).toBe(-1);
  });

  it("keeps panel content mounted when its tab is inactive", () => {
    renderShell();
    expect(within(panelFor("Medlemmer")).getByText("Innhold medlemmer")).toBeTruthy();
  });

  it("associates each tab with its panel", () => {
    renderShell();
    const tab = screen.getByRole("tab", { name: "Medlemmer" });
    const panel = screen.getByRole("tabpanel", { hidden: true, name: "Medlemmer" });
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
  });
});

describe("AdminTeamTabs legacy section anchors", () => {
  it("selects the tab containing a legacy section anchor and replaces the history entry", () => {
    window.history.replaceState(null, "", "/admin/teams/team-1#admin-section-members");
    renderShell();
    expect(routing.replace).toHaveBeenCalledWith("/admin/teams/team-1?tab=medlemmer", { scroll: false });
    expect(routing.push).not.toHaveBeenCalled();
  });

  it("does not replace the URL when a tab parameter is already present", () => {
    routing.setSearch("tab=kompetanse");
    window.history.replaceState(null, "", "/admin/teams/team-1#admin-section-members");
    renderShell();
    expect(routing.replace).not.toHaveBeenCalled();
  });
});
