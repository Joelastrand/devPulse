// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchSkillNeedsMock = vi.fn();
const fetchSkillCoverageMock = vi.fn();
const fetchContributionMock = vi.fn();

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillNeeds: fetchSkillNeedsMock,
  fetchSkillCoverage: fetchSkillCoverageMock,
  putSkillNeed: vi.fn(),
  deleteSkillNeed: vi.fn(),
  fetchSkillContribution: fetchContributionMock,
  optInSkillContribution: vi.fn(),
  withdrawSkillContribution: vi.fn(),
}));

const { TeamSkillNeedsSection } = await import("./TeamSkillNeedsSection");

/**
 * Accessibility sweep over the whole C2 section with the real panel, table and editor (TASK-019, BR-28):
 * heading order, table semantics, labelled controls, a keyboard path, live regions and text-only meaning.
 */

const NEEDS = [
  { treeId: "t-a", areaName: "Testing", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 },
  { treeId: "t-b", areaName: "Sikkerhet", areaAvailable: true, requiredLevel: 2, requiredCoverage: 1 },
  { treeId: "t-x", areaName: null, areaAvailable: false, requiredLevel: 2, requiredCoverage: 3 },
];
const CATALOG = [...NEEDS.slice(0, 2).map((n) => ({ treeId: n.treeId, name: n.areaName })), { treeId: "t-c", name: "Drift" }];

afterEach(() => {
  cleanup();
  fetchSkillNeedsMock.mockReset();
  fetchSkillCoverageMock.mockReset();
  fetchContributionMock.mockReset();
});

async function renderSection(canManageNeeds: boolean) {
  fetchSkillNeedsMock.mockResolvedValue({
    status: "ok",
    needs: NEEDS,
    catalog: CATALOG,
    catalogTruncated: false,
    needsTruncated: false,
    viewer: { canManageNeeds, canReadCoverage: true },
  });
  fetchSkillCoverageMock.mockResolvedValue({
    status: "available",
    rows: [
      { ...NEEDS[0], state: "covered" },
      { ...NEEDS[1], state: "insufficient_data" },
    ],
  });
  fetchContributionMock.mockResolvedValue({ status: "ok", contributing: false, canOptIn: true });
  const user = userEvent.setup();
  render(<TeamSkillNeedsSection teamId="team-1" token="tok" teamName="Alfa" />);
  await screen.findByRole("heading", { name: "Kompetansebehov og dekning" });
  await screen.findAllByText("Behovet er dekket");
  await screen.findByRole("button", { name: "Bidra til teamets kompetanseoversikt" });
  return { user };
}

describe("C2 section accessibility sweep", () => {
  it("renders the panel and the needs content as siblings without a duplicate-key warning", async () => {
    // Only the duplicate-key warning is asserted; every console.error is still forwarded so unrelated errors stay visible.
    const original = console.error.bind(console);
    const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => original(...args));
    try {
      await renderSection(true);
      const duplicateKeyWarnings = error.mock.calls.filter((call) => /same key/i.test(call.map(String).join(" ")));
      expect(duplicateKeyWarnings).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("keeps a strictly descending heading order inside the section (no skipped level)", async () => {
    await renderSection(true);
    const levels = screen.getAllByRole("heading").map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(3);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  });

  it("exposes one captioned table with column and row headers and a text coverage label per row", async () => {
    await renderSection(true);
    const table = screen.getByRole("table", { name: "Kompetansebehov for teamet" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.getAttribute("scope"))).toEqual(Array(4).fill("col"));
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(NEEDS.length);
    for (const h of rowHeaders) expect(h.getAttribute("scope")).toBe("row");
    expect(within(table).getByText("Behovet er dekket")).toBeTruthy();
    expect(within(table).getByText("Ikke nok data til å vise dekning ennå.")).toBeTruthy();
    expect(within(table).getByText("Kompetanseområdet er ikke lenger tilgjengelig")).toBeTruthy();
  });

  it("gives every form control a programmatic label", async () => {
    await renderSection(true);
    const controls = [...document.querySelectorAll("input, select, textarea")].filter(
      (c) => c.getAttribute("type") !== "hidden",
    );
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const control of controls) {
      const labelled =
        (control as HTMLInputElement).labels?.length || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby");
      expect(labelled, `${control.outerHTML} has no label`).toBeTruthy();
    }
  });

  it("marks any decorative icon aria-hidden, since state is always stated in text (BR-27)", async () => {
    await renderSection(true);
    // Vacuously true while the section renders no icon; it starts to bite the moment one is added.
    for (const svg of document.querySelectorAll("svg")) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("lets a keyboard user reach the opt-in control, the disclosure and the editor controls and operate them", async () => {
    const { user } = await renderSection(true);
    const optIn = screen.getByRole("button", { name: "Bidra til teamets kompetanseoversikt" });
    optIn.focus();
    expect(document.activeElement).toBe(optIn);

    const summary = screen.getByText("Slik fungerer personvernet");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    summary.focus();
    expect(summary.tagName).toBe("SUMMARY"); // native control: Enter/Space toggle it in browsers (jsdom lacks that behaviour)
    await user.click(summary);
    expect(details.open).toBe(true);

    const area = screen.getByLabelText("Kompetanseområde", { selector: "select" });
    await user.selectOptions(area, "t-c");
    expect((area as HTMLSelectElement).value).toBe("t-c");
    const coverage = screen.getByLabelText("Antall bidragsytere") as HTMLInputElement;
    expect(coverage.getAttribute("min")).toBe("1");
    expect(coverage.getAttribute("max")).toBe("20");
  });

  it("shows no editing controls to a viewer who cannot manage, and still states meaning in text", async () => {
    await renderSection(false);
    expect(screen.queryByRole("button", { name: /legg til behov|endre|slett/i })).toBeNull();
    expect(screen.queryByLabelText("Antall bidragsytere")).toBeNull();
    expect(screen.getByText("Teamledere endrer kompetansebehovene.")).toBeTruthy();
  });

  it("announces a failed read through role=alert, in text, with a native retry button", async () => {
    fetchSkillNeedsMock.mockResolvedValue({ status: "error" });
    fetchContributionMock.mockResolvedValue({ status: "ok", contributing: false, canOptIn: true });
    render(<TeamSkillNeedsSection teamId="team-1" token="tok" teamName="Alfa" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Kompetansebehovene kunne ikke lastes akkurat nå.");
    const retry = await screen.findByRole("button", { name: "Prøv igjen" });
    expect(retry.tagName).toBe("BUTTON"); // a native button is reachable and activatable by keyboard
  });

  it("provides the stacked card layout for narrow widths with the same text as the table", async () => {
    await renderSection(false);
    const list = screen.getByRole("list", { name: "Kompetansebehov for teamet", hidden: true });
    expect(list.className).toMatch(/sm:hidden/);
    expect(screen.getByRole("table", { name: "Kompetansebehov for teamet", hidden: true }).className).toMatch(/hidden[^"]*sm:table/);
    expect(within(list).getAllByText("Behovet er dekket", { ignore: "script" }).length).toBeGreaterThan(0);
  });
});
