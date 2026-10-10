// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchSkillNeedsMock = vi.fn();

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillNeeds: fetchSkillNeedsMock,
}));

// The participation panel has its own tests (SkillContributionPanel.test.tsx); it is out of scope here.
vi.mock("./SkillContributionPanel", () => ({ SkillContributionPanel: () => null }));

const { TeamSkillNeedsSection } = await import("./TeamSkillNeedsSection");

const NEED_A = { treeId: "t-a", areaName: "Testing", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 };
const NEED_B = { treeId: "t-b", areaName: "Sikkerhet", areaAvailable: true, requiredLevel: 4, requiredCoverage: 1 };
const NEED_GONE = { treeId: "t-x", areaName: null, areaAvailable: false, requiredLevel: 2, requiredCoverage: 3 };

function ok(
  needs: unknown[],
  viewer = { canManageNeeds: false, canReadCoverage: true },
  needsTruncated = false,
) {
  fetchSkillNeedsMock.mockResolvedValue({ status: "ok", needs, catalog: [], catalogTruncated: false, needsTruncated, viewer });
}

afterEach(() => {
  cleanup();
  fetchSkillNeedsMock.mockReset();
});

describe("TeamSkillNeedsSection", () => {
  it("shows a loading state, then requests needs with the token and team", async () => {
    ok([]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    expect(screen.getByRole("heading", { name: "Kompetansebehov og dekning" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
    await screen.findByText("Ingen kompetansebehov er registrert.");
    expect(fetchSkillNeedsMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("shows the empty state with the neutral lead hint", async () => {
    ok([]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    expect(await screen.findByText("Ingen kompetansebehov er registrert.")).toBeTruthy();
    expect(screen.getByText("Teamledere registrerer behov.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a semantic table: caption, column headers and a row header per need, and nothing per person", async () => {
    ok([NEED_A, NEED_B]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    const table = await screen.findByRole("table", { name: "Kompetansebehov for teamet" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Kompetanseområde", "Behov", "Dekning"]);
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const rowHeader = within(rows[0]).getByRole("rowheader");
    expect(rowHeader.textContent).toBe("Testing");
    expect(rowHeader.getAttribute("scope")).toBe("row");
    expect(within(rows[0]).getByText("Minst 2 bidragsytere på nivå «Kan selvstendig» eller høyere")).toBeTruthy();
    expect(within(rows[1]).getByText("Minst 1 bidragsyter på nivå «Avansert» eller høyere")).toBeTruthy();
  });

  it("shows the coverage column as text only, as «not available yet», with no coverage state or number", async () => {
    ok([NEED_A]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Dekning er ikke tilgjengelig ennå")).toBeTruthy();
    expect(table.textContent).not.toMatch(/dekket|ikke nok data|\d+\s*(av|%)/i);
  });

  it("renders a stacked card per need with the same text as its table row", async () => {
    ok([NEED_A, NEED_GONE]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    const table = await screen.findByRole("table");
    const list = screen.getByRole("list", { name: "Kompetansebehov for teamet" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    const bodyRows = within(table).getAllByRole("row").slice(1);
    bodyRows.forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll("th, td")).map((c) => c.textContent);
      const values = Array.from(cards[index].querySelectorAll("dd")).map((d) => d.textContent);
      expect(values).toEqual(cells);
    });
    expect(cards[0].querySelector("dl")).toBeTruthy();
  });

  it("marks an unavailable area distinctly from the not-yet-available coverage placeholder", async () => {
    ok([NEED_GONE]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Kompetanseområdet er ikke lenger tilgjengelig")).toBeTruthy();
    expect(within(table).queryByText("Dekning er ikke tilgjengelig ennå")).toBeNull();
    expect(table.textContent).not.toMatch(/personvern|for få|nok data/i);
  });

  it("shows one read-only line for a viewer who cannot manage needs, and no editing controls", async () => {
    ok([NEED_A], { canManageNeeds: false, canReadCoverage: false });
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    expect(await screen.findByText("Teamledere endrer kompetansebehovene.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("omits the read-only line for a lead (management controls are covered in the manage suite)", async () => {
    ok([NEED_A], { canManageNeeds: true, canReadCoverage: true });
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    await screen.findByRole("table");
    expect(screen.queryByText("Teamledere endrer kompetansebehovene.")).toBeNull();
  });

  it("shows the truncation notice only when the server says the list is truncated", async () => {
    ok([NEED_A], undefined, true);
    const first = render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);
    expect(await screen.findByText("Listen kan være ufullstendig.")).toBeTruthy();
    first.unmount();

    ok([NEED_A]);
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);
    await screen.findByRole("table");
    expect(screen.queryByText("Listen kan være ufullstendig.")).toBeNull();
  });

  it("shows an error with retry on a failed read, and a retry reloads", async () => {
    const user = userEvent.setup();
    fetchSkillNeedsMock.mockResolvedValue({ status: "read_failed" });
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/kunne ikke lastes/i);
    ok([NEED_A]);
    await user.click(screen.getByRole("button", { name: "Prøv igjen" }));

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchSkillNeedsMock).toHaveBeenCalledTimes(2);
  });

  it("shows a distinct message without retry when access is forbidden", async () => {
    fetchSkillNeedsMock.mockResolvedValue({ status: "forbidden" });
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/ikke tilgang/i);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("drops the previous team's needs when the team or token changes", async () => {
    ok([NEED_A]);
    const view = render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);
    await screen.findByText("Testing", { selector: "th" });

    let release: (value: unknown) => void = () => {};
    fetchSkillNeedsMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    view.rerender(<TeamSkillNeedsSection teamId="team-2" token="a-token" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
    expect(screen.queryByText("Testing", { selector: "th" })).toBeNull();
    release({
      status: "ok",
      needs: [NEED_B],
      catalog: [],
      catalogTruncated: false,
      needsTruncated: false,
      viewer: { canManageNeeds: false, canReadCoverage: true },
    });
    expect(await screen.findByText("Sikkerhet", { selector: "th" })).toBeTruthy();
    expect(fetchSkillNeedsMock).toHaveBeenLastCalledWith("a-token", "team-2");
  });

  it("uses no counts, evaluative or surveillance wording, and no person wording", async () => {
    ok([NEED_A, NEED_B, NEED_GONE], { canManageNeeds: false, canReadCoverage: false }, true);
    const view = render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);
    await screen.findByRole("table");

    const text = view.container.textContent ?? "";
    expect(text).not.toMatch(/svak|sterk|kritisk|rang|score|poeng|prosent|%|anonym|ansatt|mangler|kun \d|bare \d/i);
  });
});
