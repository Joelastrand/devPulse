// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchSkillNeedsMock = vi.fn();
const fetchSkillCoverageMock = vi.fn();

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillNeeds: fetchSkillNeedsMock,
  fetchSkillCoverage: fetchSkillCoverageMock,
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

beforeEach(() => {
  fetchSkillCoverageMock.mockResolvedValue({ status: "available", rows: [] });
});

afterEach(() => {
  cleanup();
  fetchSkillNeedsMock.mockReset();
  fetchSkillCoverageMock.mockReset();
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

  it("shows an unavailable area as the integrity state, not as a coverage or privacy state", async () => {
    ok([NEED_GONE]);
    fetchSkillCoverageMock.mockResolvedValue({ status: "available", rows: [{ ...NEED_GONE, state: "area_unavailable" }] });
    render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Kompetanseområdet er ikke lenger tilgjengelig")).toBeTruthy();
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

const rowFor = (need: { treeId: string; areaName: string | null; requiredLevel: number; requiredCoverage: number }, state: string) => ({
  treeId: need.treeId,
  areaName: need.areaName,
  requiredLevel: need.requiredLevel,
  requiredCoverage: need.requiredCoverage,
  state,
});
const available = (...rows: unknown[]) => fetchSkillCoverageMock.mockResolvedValue({ status: "available", rows });
const renderSection = () => render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);
const coverageCells = (table: HTMLElement) =>
  Array.from(table.querySelectorAll("tbody tr")).map((row) => row.querySelectorAll("td")[1].textContent ?? "");

describe("TeamSkillNeedsSection — coverage column (TASK-018)", () => {
  it("renders each categorical state as approved text, joined to its need by treeId", async () => {
    ok([NEED_A, NEED_B, NEED_GONE]);
    available(rowFor(NEED_B, "covered"), rowFor(NEED_A, "insufficient_data"), rowFor(NEED_GONE, "area_unavailable"));
    renderSection();

    const rows = within(await screen.findByRole("table")).getAllByRole("row").slice(1);
    await waitFor(() => expect(rows[0].textContent).toContain("Ikke nok data til å vise dekning ennå."));
    expect(rows[0].textContent).toContain("Dekningen vises når nok bidragsytere har vurdert området.");
    expect(rows[1].textContent).toContain("Behovet er dekket");
    expect(rows[2].textContent).toContain("Kompetanseområdet er ikke lenger tilgjengelig");
    expect(fetchSkillCoverageMock).toHaveBeenCalledTimes(1);
    expect(fetchSkillCoverageMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("renders the gap state", async () => {
    ok([NEED_A]);
    available(rowFor(NEED_A, "gap"));
    renderSection();

    expect(await within(await screen.findByRole("table")).findByText("Behovet er ikke dekket ennå")).toBeTruthy();
  });

  it("shows the same coverage text to a lead and an ordinary member for the same server answer", async () => {
    const texts: string[][] = [];
    for (const canManageNeeds of [true, false]) {
      ok([NEED_A], { canManageNeeds, canReadCoverage: true });
      available(rowFor(NEED_A, "gap"));
      const view = renderSection();
      const table = await screen.findByRole("table");
      await within(table).findByText("Behovet er ikke dekket ennå");
      texts.push(coverageCells(table));
      view.unmount();
    }
    expect(texts[0]).toEqual(texts[1]);
  });

  it("keeps coverage text identical in the stacked card and exposes no number, ratio or person", async () => {
    ok([NEED_A, NEED_B]);
    available(rowFor(NEED_A, "insufficient_data"), rowFor(NEED_B, "gap"));
    const view = renderSection();

    const table = await screen.findByRole("table");
    await within(table).findByText("Behovet er ikke dekket ennå");
    const cards = within(screen.getByRole("list", { name: "Kompetansebehov for teamet" })).getAllByRole("listitem");
    Array.from(table.querySelectorAll("tbody tr")).forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll("th, td")).map((c) => c.textContent);
      expect(Array.from(cards[index].querySelectorAll("dd")).map((d) => d.textContent)).toEqual(cells);
    });
    expect(cards[0].textContent).toContain("Dekning");
    // Coverage adds no digit, ratio or evaluative word; the only digits on the page are the need's own target.
    expect(coverageCells(table).join(" ")).not.toMatch(/\d|%|svak|sterk|kritisk|rang|score|anonym|ansatt|mangler/i);
    expect(view.container.textContent).not.toMatch(/uid|e-post|@/i);
  });

  it("does not request coverage and states the membership and disabled-team facts when the hint says it is unavailable", async () => {
    ok([NEED_A], { canManageNeeds: false, canReadCoverage: false });
    renderSection();

    const table = await screen.findByRole("table");
    expect(
      within(table).getByText("Dekning vises bare for teamets medlemmer. Dekning vises ikke for deaktiverte team."),
    ).toBeTruthy();
    expect(table.textContent).not.toMatch(/ikke nok data|dekket ennå|Behovet er dekket/);
    expect(fetchSkillCoverageMock).not.toHaveBeenCalled();
  });

  it("corrects a stale hint: 403 from coverage shows the members-only line, 409 the disabled-team line", async () => {
    const cases = [
      ["forbidden", "Dekning vises bare for teamets medlemmer."],
      ["team_disabled", "Dekning vises ikke for deaktiverte team."],
    ];
    for (const [status, text] of cases) {
      ok([NEED_A]);
      fetchSkillCoverageMock.mockResolvedValue({ status });
      const view = renderSection();
      expect(await within(await screen.findByRole("table")).findByText(text)).toBeTruthy();
      view.unmount();
    }
  });

  it("shows the approved incomplete line for every need and no categorical state", async () => {
    ok([NEED_A, NEED_B]);
    fetchSkillCoverageMock.mockResolvedValue({ status: "incomplete" });
    renderSection();

    const table = await screen.findByRole("table");
    expect(await within(table).findAllByText("Dekningen kan ikke vises for dette teamet akkurat nå.")).toHaveLength(2);
    expect(table.textContent).not.toMatch(/dekket|ikke nok data/);
  });

  it("fails closed per need when its coverage row is missing or describes a different target", async () => {
    ok([NEED_A, NEED_B]);
    available({ ...rowFor(NEED_A, "covered"), requiredCoverage: NEED_A.requiredCoverage + 1 });
    renderSection();

    const table = await screen.findByRole("table");
    expect(await within(table).findAllByText("Dekningen kan ikke vises for dette teamet akkurat nå.")).toHaveLength(2);
    expect(table.textContent).not.toContain("Behovet er dekket");
  });

  it("does not join by position: a row for another tree never decorates a need", async () => {
    ok([NEED_A]);
    available(rowFor(NEED_B, "covered"));
    renderSection();

    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Dekningen kan ikke vises for dette teamet akkurat nå.")).toBeTruthy();
    expect(table.textContent).not.toContain("Behovet er dekket");
  });

  it("scopes a coverage read failure to coverage, keeps the needs and retries only coverage", async () => {
    ok([NEED_A]);
    fetchSkillCoverageMock.mockResolvedValueOnce({ status: "read_failed" });
    const user = userEvent.setup();
    renderSection();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Dekningen kunne ikke lastes akkurat nå.");
    expect(within(screen.getByRole("table")).getByText("Testing", { selector: "th" })).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText(/dekket|ikke nok data/)).toBeNull();

    available(rowFor(NEED_A, "covered"));
    await user.click(within(alert).getByRole("button", { name: "Prøv igjen" }));

    expect(await within(screen.getByRole("table")).findByText("Behovet er dekket")).toBeTruthy();
    expect(fetchSkillNeedsMock).toHaveBeenCalledTimes(1);
    expect(fetchSkillCoverageMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops old coverage and ignores a late answer after a team switch", async () => {
    ok([NEED_A]);
    let releaseA!: (value: unknown) => void;
    fetchSkillCoverageMock.mockReturnValueOnce(new Promise((resolve) => (releaseA = resolve)));
    const view = renderSection();
    await screen.findByRole("table");

    ok([NEED_B]);
    available(rowFor(NEED_B, "gap"));
    view.rerender(<TeamSkillNeedsSection key="team-2" teamId="team-2" token="a-token" />);
    expect((await screen.findAllByText("Behovet er ikke dekket ennå")).length).toBeGreaterThan(0);

    releaseA({ status: "available", rows: [rowFor(NEED_A, "covered")] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Behovet er dekket")).toBeNull();
    expect(screen.getByText("Sikkerhet", { selector: "th" })).toBeTruthy();
  });

  it("ignores a late coverage answer from an old token", async () => {
    ok([NEED_A]);
    let releaseOld!: (value: unknown) => void;
    fetchSkillCoverageMock.mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)));
    const view = renderSection();
    await screen.findByRole("table");

    available(rowFor(NEED_A, "gap"));
    view.rerender(<TeamSkillNeedsSection key="b" teamId="team-1" token="b-token" />);
    expect((await screen.findAllByText("Behovet er ikke dekket ennå")).length).toBeGreaterThan(0);

    releaseOld({ status: "available", rows: [rowFor(NEED_A, "covered")] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Behovet er dekket")).toBeNull();
  });
});
