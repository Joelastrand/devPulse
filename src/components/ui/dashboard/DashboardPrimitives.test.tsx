// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ClipboardList } from "lucide-react";
import {
  ActionListItem,
  INSUFFICIENT_DATA_TEXT,
  InitialsAvatar,
  InsufficientData,
  LevelBar,
  StatTile,
  SummaryPanel,
  initialsFor,
} from "./DashboardPrimitives";

describe("dashboard presentation primitives", () => {
  afterEach(cleanup);

  describe("InsufficientData", () => {
    it("states that data is not yet available, in text", () => {
      render(<InsufficientData />);

      expect(screen.getByText(INSUFFICIENT_DATA_TEXT)).toBeTruthy();
    });
  });

  describe("StatTile", () => {
    it("shows the pre-formatted value, the detail and the text status", () => {
      render(<StatTile label="Teamets puls" value="3,9" detail="Arbeidsflyt og trivsel" statusText="Stabil" tone="info" />);

      const tile = screen.getByRole("region", { name: "Teamets puls" });
      expect(within(tile).getByText("3,9")).toBeTruthy();
      expect(within(tile).getByText("Arbeidsflyt og trivsel")).toBeTruthy();
      expect(within(tile).getByText("Stabil")).toBeTruthy();
    });

    it("shows the insufficient-data state and no value when the value is unavailable", () => {
      render(<StatTile label="Kompetansedekning" />);

      const tile = screen.getByRole("region", { name: "Kompetansedekning" });
      expect(within(tile).getByText(INSUFFICIENT_DATA_TEXT)).toBeTruthy();
      expect(within(tile).queryByText("0")).toBeNull();
    });

    it("never presents a zero value as a real figure when the caller passes no value", () => {
      render(<StatTile label="Aktive tiltak" value={undefined} />);

      expect(screen.queryByText("0")).toBeNull();
      expect(screen.getByText(INSUFFICIENT_DATA_TEXT)).toBeTruthy();
    });
  });

  describe("SummaryPanel", () => {
    it("renders the title as a level-two heading and the action beside it", () => {
      render(
        <SummaryPanel title="Kompetanseområder" action={<a href="/x">Se alle</a>}>
          <p>innhold</p>
        </SummaryPanel>,
      );

      expect(screen.getByRole("heading", { level: 2, name: "Kompetanseområder" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Se alle" })).toBeTruthy();
      expect(screen.getByText("innhold")).toBeTruthy();
    });
  });

  describe("LevelBar", () => {
    it("shows the value text and status text, and clamps the bar width to the scale", () => {
      render(
        <ul>
          <LevelBar label="Systemdesign" valueText="3,2" fraction={1.5} statusText="Utviklingsmulighet" tone="warning" />
        </ul>,
      );

      const row = screen.getByText("Systemdesign").closest("li");
      expect(row).toBeTruthy();
      expect(within(row as HTMLElement).getByText("3,2")).toBeTruthy();
      expect(within(row as HTMLElement).getByText("Utviklingsmulighet")).toBeTruthy();
      const fill = (row as HTMLElement).querySelector<HTMLElement>("span.bg-primary");
      expect(fill?.style.width).toBe("100%");
    });

    it("shows the insufficient-data state instead of a bar when the value is null", () => {
      render(
        <ul>
          <LevelBar label="Teknisk fasilitering" valueText={null} fraction={0} />
        </ul>,
      );

      const row = screen.getByText("Teknisk fasilitering").closest("li") as HTMLElement;
      expect(within(row).getByText(INSUFFICIENT_DATA_TEXT)).toBeTruthy();
      expect(row.querySelector("span.bg-primary")).toBeNull();
    });
  });

  describe("ActionListItem", () => {
    it("is a single link to the given route with its title and description", () => {
      render(
        <ul>
          <ActionListItem href="/teams" title="Se teamets kompetansebehov" description="Vurder hvilke områder som bør styrkes." icon={ClipboardList} />
        </ul>,
      );

      const link = screen.getByRole("link", { name: /se teamets kompetansebehov/i });
      expect(link.getAttribute("href")).toBe("/teams");
      expect(link.textContent).toContain("Vurder hvilke områder som bør styrkes.");
    });
  });

  describe("initials", () => {
    it.each([
      ["Joel Åstrand", "JÅ"],
      ["Kari", "K"],
      ["  Anne   Marie Olsen ", "AO"],
      ["", "?"],
    ])("derives initials for %j as %s", (name, expected) => {
      expect(initialsFor(name)).toBe(expected);
    });

    it("hides the avatar from assistive technology; the name is shown as text beside it", () => {
      const { container } = render(<InitialsAvatar name="Kari Nordmann" />);

      const avatar = container.querySelector("span");
      expect(avatar?.getAttribute("aria-hidden")).toBe("true");
      expect(avatar?.textContent).toBe("KN");
    });
  });
});
