// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamOverviewEntry } from "../client/teams-overview-gateway";
import { TeamsPageContent } from "./TeamsPageContent";

const member: TeamOverviewEntry = { teamId: "t-member", name: "Plattform", relationship: "member", isMember: true, canOpen: true };
const admin: TeamOverviewEntry = { teamId: "t-admin", name: "Data", relationship: "teamadmin", isMember: true, canOpen: true };
const requestable: TeamOverviewEntry = { teamId: "t-other", name: "Mobil", relationship: "none", isMember: false, canOpen: false };
const openOther: TeamOverviewEntry = { teamId: "t-open", name: "Design", relationship: "none", isMember: false, canOpen: true };

function renderPage(teams: TeamOverviewEntry[], onRequestAccess = vi.fn()) {
  render(<TeamsPageContent teams={teams} requestStates={{}} onRequestAccess={onRequestAccess} />);
  return { onRequestAccess };
}

afterEach(() => {
  cleanup();
});

describe("TeamsPageContent", () => {
  it("counts the caller's memberships and team-admin roles, never a member total", () => {
    renderPage([member, admin, requestable]);

    const strip = document.querySelector("dl");
    expect(strip).toBeTruthy();
    const values = Array.from(strip!.querySelectorAll("dd")).map((dd) => dd.textContent);
    expect(values).toEqual(["2", "1"]);
    expect(document.body.textContent ?? "").not.toMatch(/medlemmer/i);
  });

  it("separates the caller's teams from other visible teams under their own headings", () => {
    renderPage([member, admin, requestable]);

    expect(screen.getByRole("heading", { level: 2, name: "Mine team" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Andre team" })).toBeTruthy();
    const mine = screen.getByRole("heading", { level: 2, name: "Mine team" }).closest("section");
    const others = screen.getByRole("heading", { level: 2, name: "Andre team" }).closest("section");
    expect(within(mine!).getByRole("link", { name: "Plattform" })).toBeTruthy();
    expect(within(others!).queryByRole("link", { name: "Plattform" })).toBeNull();
    expect(within(others!).getByText("Mobil")).toBeTruthy();
  });

  it("drops the group heading when every visible team is the caller's own", () => {
    renderPage([member, admin]);

    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getByRole("link", { name: "Plattform" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Data" })).toBeTruthy();
  });

  it("says the caller is not a member of any team when only other teams are visible", () => {
    renderPage([requestable, openOther]);

    expect(screen.getByText("Du er ikke medlem av noen team ennå.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Andre team" })).toBeTruthy();
  });

  it("links an openable card by its team name and labels the action 'Åpne team'", () => {
    renderPage([member, openOther]);

    expect(screen.getByRole("link", { name: "Plattform" }).getAttribute("href")).toBe("/teams/t-member");
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe("/teams/t-open");
    expect(screen.getAllByText("Åpne team")).toHaveLength(2);
  });

  it("offers request-access on a non-openable card and reports which team was chosen", async () => {
    const { onRequestAccess } = renderPage([member, requestable]);

    await userEvent.click(screen.getByRole("button", { name: "Be om tilgang" }));

    expect(onRequestAccess).toHaveBeenCalledWith("t-other");
    expect(screen.queryByRole("link", { name: "Mobil" })).toBeNull();
  });

  it("filters team names case-insensitively and ignores extra whitespace", async () => {
    renderPage([member, admin, requestable]);

    await userEvent.type(screen.getByRole("searchbox", { name: "Søk etter team" }), "  MOBIL ");

    expect(screen.getByText("Mobil")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Plattform" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Data" })).toBeNull();
  });

  it("hides a section whose teams all fall outside the search, and keeps the other section", async () => {
    renderPage([member, requestable]);

    await userEvent.type(screen.getByRole("searchbox", { name: "Søk etter team" }), "mobil");

    expect(screen.queryByRole("heading", { level: 2, name: "Mine team" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Andre team" })).toBeTruthy();
  });

  it("shows a Norwegian no-match message and a reset action that restores every team", async () => {
    renderPage([member, requestable]);
    const search = screen.getByRole("searchbox", { name: "Søk etter team" });

    await userEvent.type(search, "finnes ikke");
    expect(screen.getByRole("status").textContent).toBe("Ingen team samsvarer med søket.");

    await userEvent.click(screen.getByRole("button", { name: "Nullstill søk" }));

    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("link", { name: "Plattform" })).toBeTruthy();
    expect(screen.getByText("Mobil")).toBeTruthy();
  });

  it("omits the search field when there is only one team", () => {
    renderPage([member]);

    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
