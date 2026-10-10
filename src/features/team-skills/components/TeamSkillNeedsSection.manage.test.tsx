// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchSkillNeedsMock = vi.fn();
const putSkillNeedMock = vi.fn();
const deleteSkillNeedMock = vi.fn();

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillNeeds: fetchSkillNeedsMock,
  putSkillNeed: putSkillNeedMock,
  deleteSkillNeed: deleteSkillNeedMock,
}));

// The participation panel has its own tests (SkillContributionPanel.test.tsx); it is out of scope here.
vi.mock("./SkillContributionPanel", () => ({ SkillContributionPanel: () => null }));

const { TeamSkillNeedsSection } = await import("./TeamSkillNeedsSection");

const NEED_A = { treeId: "t-a", areaName: "Testing", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 };
const NEED_GONE = { treeId: "t-x", areaName: null, areaAvailable: false, requiredLevel: 2, requiredCoverage: 3 };
const CATALOG = [
  { treeId: "t-a", name: "Testing" },
  { treeId: "t-b", name: "Sikkerhet" },
  { treeId: "t-c", name: "Drift" },
];
const LEAD = { canManageNeeds: true, canReadCoverage: true };
const MEMBER = { canManageNeeds: false, canReadCoverage: true };

function loaded(needs: unknown[], viewer = LEAD, catalog: unknown[] = CATALOG, catalogTruncated = false) {
  return { status: "ok", needs, catalog, catalogTruncated, needsTruncated: false, viewer };
}

function serve(...results: unknown[]) {
  results.forEach((result, index) => {
    if (index === results.length - 1) fetchSkillNeedsMock.mockResolvedValue(result);
    else fetchSkillNeedsMock.mockResolvedValueOnce(result);
  });
}

async function renderLead(needs: unknown[] = [NEED_A], viewer = LEAD, catalog: unknown[] = CATALOG) {
  serve(loaded(needs, viewer, catalog));
  const user = userEvent.setup();
  const view = render(<TeamSkillNeedsSection teamId="team-1" token="a-token" />);
  await screen.findByRole("heading", { name: "Kompetansebehov og dekning" });
  await waitFor(() => expect(screen.queryByText(/laster/i)).toBeNull());
  return { user, view };
}

const table = () => screen.getByRole("table");

afterEach(() => {
  cleanup();
  fetchSkillNeedsMock.mockReset();
  putSkillNeedMock.mockReset();
  deleteSkillNeedMock.mockReset();
});

describe("TeamSkillNeedsSection — management visibility (server hint only)", () => {
  it("shows no add form, row actions, inputs or buttons to a viewer the server says cannot manage", async () => {
    await renderLead([NEED_A], MEMBER);

    expect(screen.queryByRole("heading", { name: "Legg til kompetansebehov" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Handlinger" })).toBeNull();
    expect(screen.getByText("Teamledere endrer kompetansebehovene.")).toBeTruthy();
  });

  it("shows the add form and an actions column when the server says the viewer can manage", async () => {
    await renderLead();

    expect(screen.getByRole("heading", { name: "Legg til kompetansebehov" })).toBeTruthy();
    expect(within(table()).getByRole("columnheader", { name: "Handlinger" })).toBeTruthy();
    expect(within(table()).getByRole("button", { name: "Endre behov for Testing" })).toBeTruthy();
    expect(within(table()).getByRole("button", { name: "Slett – Testing" })).toBeTruthy();
    expect(screen.queryByText("Teamledere endrer kompetansebehovene.")).toBeNull();
  });

  it("lets a lead add the first need on an empty team, without the ordinary-member hint", async () => {
    await renderLead([]);

    expect(screen.getByText("Ingen kompetansebehov er registrert.")).toBeTruthy();
    expect(screen.queryByText("Teamledere registrerer behov.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Legg til kompetansebehov" })).toBeTruthy();
  });
});

describe("TeamSkillNeedsSection — add", () => {
  it("offers only areas without a need, and only levels 2–4 with the C1 names", async () => {
    await renderLead([NEED_A, NEED_GONE]);

    const area = screen.getByRole("combobox", { name: "Kompetanseområde" });
    expect(within(area).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Velg kompetanseområde",
      "Sikkerhet",
      "Drift",
    ]);
    const level = screen.getByRole("combobox", { name: "Nivå" });
    expect(within(level).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Kan med støtte",
      "Kan selvstendig",
      "Avansert",
    ]);
  });

  it("says so, with no form, when every area already has a need", async () => {
    await renderLead([NEED_A], LEAD, [{ treeId: "t-a", name: "Testing" }]);

    expect(screen.getByText("Alle kompetanseområder har allerede et behov.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Legg til behov" })).toBeNull();
  });

  it("saves the chosen area, level and target, then re-reads the server and confirms in a live region", async () => {
    putSkillNeedMock.mockResolvedValue({ ok: true });
    const { user } = await renderLead();
    serve(loaded([NEED_A, { ...NEED_A, treeId: "t-b", areaName: "Sikkerhet", requiredLevel: 4, requiredCoverage: 3 }]));

    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    await user.selectOptions(screen.getByRole("combobox", { name: "Nivå" }), "4");
    const count = screen.getByRole("spinbutton", { name: "Antall bidragsytere" });
    await user.clear(count);
    await user.type(count, "3");
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    expect(putSkillNeedMock).toHaveBeenCalledWith("a-token", "team-1", "t-b", { requiredLevel: 4, requiredCoverage: 3 });
    expect(await within(table()).findByText("Sikkerhet", { selector: "th" })).toBeTruthy();
    expect(fetchSkillNeedsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Behovet er lagret.")).toBeTruthy();
    // The just-added area is no longer selectable, and focus returned to the (reset) area control.
    const area = screen.getByRole("combobox", { name: "Kompetanseområde" });
    expect(within(area).queryByRole("option", { name: "Sikkerhet" })).toBeNull();
    expect(document.activeElement).toBe(area);
  });

  it.each([["0"], ["21"], ["1.5"], [""]])("rejects a target of %j with an associated error and no request", async (value) => {
    const { user } = await renderLead();
    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    const count = screen.getByRole("spinbutton", { name: "Antall bidragsytere" });
    await user.clear(count);
    if (value) await user.type(count, value);
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    expect(putSkillNeedMock).not.toHaveBeenCalled();
    expect(screen.getByText("Antall må være et helt tall fra 1 til 20.")).toBeTruthy();
    expect(count.getAttribute("aria-invalid")).toBe("true");
    expect(count.getAttribute("aria-describedby")).toContain("skill-need-coverage-error");
  });

  it("requires an area before sending", async () => {
    const { user } = await renderLead();
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    expect(putSkillNeedMock).not.toHaveBeenCalled();
    expect(screen.getByText("Velg et kompetanseområde.")).toBeTruthy();
  });

  it("describes the target as a planning goal, not a result", async () => {
    await renderLead();
    const count = screen.getByRole("spinbutton", { name: "Antall bidragsytere" });
    expect(document.getElementById(count.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /mål teamet setter for planlegging, ikke et resultat/,
    );
  });
});

describe("TeamSkillNeedsSection — edit", () => {
  it("edits level and target of one need through the single form, keeping the area fixed", async () => {
    putSkillNeedMock.mockResolvedValue({ ok: true });
    const { user } = await renderLead([NEED_A, NEED_GONE]);
    serve(loaded([{ ...NEED_A, requiredLevel: 4, requiredCoverage: 5 }, NEED_GONE]));

    await user.click(within(table()).getByRole("button", { name: "Endre behov for Testing" }));

    expect(screen.getByRole("heading", { name: "Endre behov for «Testing»" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Kompetanseområde" })).toBeNull();
    const level = screen.getByRole("combobox", { name: "Nivå" }) as HTMLSelectElement;
    const count = screen.getByRole("spinbutton", { name: "Antall bidragsytere" }) as HTMLInputElement;
    expect(level.value).toBe("3");
    expect(count.value).toBe("2");
    expect(document.activeElement).toBe(level);

    await user.selectOptions(level, "4");
    await user.clear(count);
    await user.type(count, "5");
    await user.click(screen.getByRole("button", { name: "Lagre endring" }));

    expect(putSkillNeedMock).toHaveBeenCalledWith("a-token", "team-1", "t-a", { requiredLevel: 4, requiredCoverage: 5 });
    expect(await within(table()).findByText("Minst 5 bidragsytere på nivå «Avansert» eller høyere")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Legg til kompetansebehov" })).toBeTruthy();
  });

  it("cancels an edit without writing", async () => {
    const { user } = await renderLead();
    await user.click(within(table()).getByRole("button", { name: "Endre behov for Testing" }));
    await user.click(screen.getByRole("button", { name: "Avbryt endring" }));

    expect(putSkillNeedMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Legg til kompetansebehov" })).toBeTruthy();
  });

  it("offers an unavailable-area need delete only, never edit", async () => {
    await renderLead([NEED_GONE]);

    expect(within(table()).queryByRole("button", { name: /^Endre/ })).toBeNull();
    expect(within(table()).getByRole("button", { name: "Slett – Kompetanseområde" })).toBeTruthy();
  });
});

describe("TeamSkillNeedsSection — delete", () => {
  it("asks for confirmation (focus on the safe choice), can be cancelled, and then deletes on confirm", async () => {
    deleteSkillNeedMock.mockResolvedValue({ ok: true });
    const { user } = await renderLead();

    await user.click(within(table()).getByRole("button", { name: "Slett – Testing" }));
    expect(within(table()).getByText(/fjernes permanent/)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Avbryt");

    await user.click(within(table()).getByRole("button", { name: "Avbryt – Testing" }));
    expect(deleteSkillNeedMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(table()).getByRole("button", { name: "Slett – Testing" }));

    serve(loaded([]));
    await user.click(within(table()).getByRole("button", { name: "Slett – Testing" }));
    await user.click(within(table()).getByRole("button", { name: "Ja, slett – Testing" }));

    expect(deleteSkillNeedMock).toHaveBeenCalledWith("a-token", "team-1", "t-a");
    expect(await screen.findByText("Ingen kompetansebehov er registrert.")).toBeTruthy();
    expect(screen.getByText("Behovet er slettet.")).toBeTruthy();
  });

  it("allows only one pending confirmation at a time", async () => {
    const { user } = await renderLead([NEED_A, { ...NEED_A, treeId: "t-b", areaName: "Sikkerhet" }]);

    await user.click(within(table()).getByRole("button", { name: "Slett – Testing" }));

    expect((within(table()).getByRole("button", { name: "Slett – Sikkerhet" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("TeamSkillNeedsSection — pending, failures and reconciliation", () => {
  it("shows a pending state and ignores a second submit while a write is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    putSkillNeedMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { user } = await renderLead();
    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");

    await user.click(screen.getByRole("button", { name: "Legg til behov" }));
    const pending = screen.getByRole("button", { name: "Lagrer…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect((within(table()).getByRole("button", { name: "Endre behov for Testing" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(pending);
    expect(putSkillNeedMock).toHaveBeenCalledTimes(1);

    release({ ok: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Lagrer…" })).toBeNull());
  });

  it("never shows a fake «Sletter…» or sends a DELETE when a delete is confirmed around a save in flight", async () => {
    let release: (value: unknown) => void = () => {};
    putSkillNeedMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { user } = await renderLead();

    await user.click(within(table()).getByRole("button", { name: "Slett – Testing" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    // The save took the write slot, so the open confirmation was closed: it cannot be confirmed any more.
    expect(within(table()).queryByRole("button", { name: "Ja, slett – Testing" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sletter/ })).toBeNull();
    const deleteButton = within(table()).getByRole("button", { name: "Slett – Testing" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    await user.click(deleteButton);
    expect(deleteSkillNeedMock).not.toHaveBeenCalled();

    serve(loaded([NEED_A, { ...NEED_A, treeId: "t-b", areaName: "Sikkerhet" }]));
    release({ ok: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Lagrer…" })).toBeNull());
    expect(screen.queryByRole("button", { name: /Sletter/ })).toBeNull();
    expect(deleteSkillNeedMock).not.toHaveBeenCalled();
    expect((within(table()).getByRole("button", { name: "Slett – Testing" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("makes the add form non-actionable, and sends no PUT, while a delete is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    deleteSkillNeedMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { user } = await renderLead();

    await user.click(within(table()).getByRole("button", { name: "Slett – Testing" }));
    await user.click(within(table()).getByRole("button", { name: "Ja, slett – Testing" }));

    expect(within(table()).getByRole("button", { name: "Sletter… – Testing" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Kompetanseområde" }) as HTMLSelectElement).disabled).toBe(true);
    const add = screen.getByRole("button", { name: "Legg til behov" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.click(add);
    expect(putSkillNeedMock).not.toHaveBeenCalled();

    serve(loaded([]));
    release({ ok: true });
    expect(await screen.findByText("Behovet er slettet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Legg til behov" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ["invalid_input", "Verdiene er ikke gyldige. Kontroller nivå og antall.", false],
    ["persistence_failed", "Endringen ble ikke lagret. Prøv igjen.", false],
    ["skill_unavailable", "Kompetanseområdet er ikke lenger tilgjengelig.", true],
    ["unknown", "Endringen ble ikke lagret. Prøv igjen.", true],
  ])("shows a calm message for %s and re-reads only when the server's view may have changed", async (code, message, refreshes) => {
    putSkillNeedMock.mockResolvedValue({ ok: false, error: code });
    const { user } = await renderLead();
    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    await waitFor(() => expect(fetchSkillNeedsMock).toHaveBeenCalledTimes(refreshes ? 2 : 1));
    // The entered values survive a failed write.
    expect((screen.getByRole("combobox", { name: "Kompetanseområde" }) as HTMLSelectElement).value).toBe("t-b");
  });

  it.each([
    ["forbidden", "Du kan ikke endre kompetansebehov for dette teamet."],
    ["team_disabled", "Teamet er deaktivert, så kompetansebehov kan ikke endres."],
  ])("on %s re-reads the hints and removes the controls the server no longer allows", async (code, message) => {
    putSkillNeedMock.mockResolvedValue({ ok: false, error: code });
    const { user } = await renderLead();
    serve(loaded([NEED_A], MEMBER));

    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Legg til behov" })).toBeNull());
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Teamledere endrer kompetansebehovene.")).toBeTruthy();
  });

  it("keeps the shown list and says so when the re-read after a successful write fails", async () => {
    putSkillNeedMock.mockResolvedValue({ ok: true });
    const { user } = await renderLead();
    serve({ status: "read_failed" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Listen kunne ikke oppdateres akkurat nå.");
    expect(within(table()).getByText("Testing", { selector: "th" })).toBeTruthy();
  });

  it("reports a failed delete and keeps the need", async () => {
    deleteSkillNeedMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const { user } = await renderLead();

    await user.click(within(table()).getByRole("button", { name: "Slett – Testing" }));
    await user.click(within(table()).getByRole("button", { name: "Ja, slett – Testing" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Endringen ble ikke lagret. Prøv igjen.");
    expect(within(table()).getByText("Testing", { selector: "th" })).toBeTruthy();
  });
});

describe("TeamSkillNeedsSection — team switch during a write", () => {
  it("never lets a response for the previous team change or re-read what the new team shows", async () => {
    let release: (value: unknown) => void = () => {};
    putSkillNeedMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { user, view } = await renderLead();
    await user.selectOptions(screen.getByRole("combobox", { name: "Kompetanseområde" }), "t-b");
    await user.click(screen.getByRole("button", { name: "Legg til behov" }));

    const teamTwoNeed = { treeId: "t-c", areaName: "Drift", areaAvailable: true, requiredLevel: 2, requiredCoverage: 1 };
    serve(loaded([teamTwoNeed], MEMBER));
    view.rerender(<TeamSkillNeedsSection teamId="team-2" token="a-token" />);
    expect(await screen.findByText("Drift", { selector: "th" })).toBeTruthy();
    const callsBefore = fetchSkillNeedsMock.mock.calls.length;

    release({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSkillNeedsMock.mock.calls.length).toBe(callsBefore);
    expect(fetchSkillNeedsMock).toHaveBeenLastCalledWith("a-token", "team-2");
    expect(screen.queryByText("Behovet er lagret.")).toBeNull();
    expect(screen.queryByText("Testing")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TeamSkillNeedsSection — scope and copy", () => {
  it("shows no observed counts, percentages or person data in the lead view and keeps the coverage placeholder", async () => {
    const { view } = await renderLead([NEED_A, NEED_GONE]);

    const text = view.container.textContent ?? "";
    expect(text).toContain("Dekning er ikke tilgjengelig ennå");
    expect(text).not.toMatch(/svak|sterk|kritisk|rang|score|poeng|prosent|%|anonym|ansatt|mangler|kun \d|bare \d|\d+ av \d+/i);
    expect(fetchSkillNeedsMock).toHaveBeenCalledTimes(1);
  });
});
