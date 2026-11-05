// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationSectionTabs } from "./ConversationSectionTabs";

const TABS = [
  { id: "overview", label: "Oversikt", children: <p>Innhold oversikt</p> },
  {
    id: "notes",
    label: "Notater",
    children: <textarea aria-label="Eget notat" defaultValue="" />,
  },
  { id: "follow-up", label: "Oppfølging", children: <p>Innhold oppfølging</p> },
];

afterEach(() => {
  cleanup();
});

describe("ConversationSectionTabs (visual-redesign TASK-013)", () => {
  it("exposes a tab list whose selected tab controls the visible tab panel", () => {
    render(<ConversationSectionTabs tabs={TABS} label="Seksjoner" />);

    const list = screen.getByRole("tablist", { name: "Seksjoner" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Oversikt", "Notater", "Oppfølging"]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");

    const panel = screen.getByRole("tabpanel", { name: "Oversikt" });
    expect(panel.getAttribute("id")).toBe(tabs[0]?.getAttribute("aria-controls"));
    expect(panel.className).not.toContain("hidden");
    expect(screen.getByRole("tabpanel", { name: "Notater" }).className).toContain("hidden");
  });

  it("moves between tabs with arrow keys, Home and End, and gives focus to the selected tab", async () => {
    const user = userEvent.setup();
    render(<ConversationSectionTabs tabs={TABS} label="Seksjoner" />);

    screen.getByRole("tab", { name: "Oversikt" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Notater" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Notater" }));

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Oppfølging" }).getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Oversikt" }).getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Oppfølging" }).getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Oversikt" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<ConversationSectionTabs tabs={TABS} label="Seksjoner" />);

    expect(screen.getByRole("tab", { name: "Oversikt" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Notater" }).getAttribute("tabindex")).toBe("-1");
  });

  it("keeps an unsaved draft in a panel when the user switches tabs and back", async () => {
    const user = userEvent.setup();
    render(<ConversationSectionTabs tabs={TABS} label="Seksjoner" />);

    await user.click(screen.getByRole("tab", { name: "Notater" }));
    await user.type(screen.getByRole("textbox", { name: "Eget notat" }), "Ikke lagret ennå");
    await user.click(screen.getByRole("tab", { name: "Oppfølging" }));
    await user.click(screen.getByRole("tab", { name: "Notater" }));

    expect((screen.getByRole("textbox", { name: "Eget notat" }) as HTMLTextAreaElement).value).toBe("Ikke lagret ennå");
  });
});
