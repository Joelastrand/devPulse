// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { teamSkillsCopy } from "../../team-owned-skills/copy";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();
const setOwnSkillLevelMock = vi.fn();
const clearOwnSkillLevelMock = vi.fn();
const deleteOwnSkillProfileMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/skill-profile-gateway", () => ({
  fetchOwnSkills: fetchOwnSkillsMock,
  setOwnSkillLevel: setOwnSkillLevelMock,
  clearOwnSkillLevel: clearOwnSkillLevelMock,
  deleteOwnSkillProfile: deleteOwnSkillProfileMock,
}));

const { SkillProfilePage } = await import("./SkillProfilePage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Level = 1 | 2 | 3 | 4 | null;

const skills: { treeId: string; name: string; level: Level }[] = [
  { treeId: "t-a", name: "Arkitektur", level: null },
  { treeId: "t-b", name: "Testing", level: 2 },
];

function ok(rows: { treeId: string; name: string; level: Level }[], extra = {}) {
  return { status: "ok", dto: { skills: rows, truncated: false, profile: "ok", ...extra } };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function renderWith(result: unknown) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue(result);
  render(<SkillProfilePage />);
  await screen.findByText(/egenvurderingen din er din egen/i);
}

const LEVEL_NAMES = ["Grunnleggende kjennskap", "Kan med støtte", "Kan selvstendig", "Avansert"] as const;

/** The rating group for one skill (four radio buttons, the team-owned control reused for the global list). */
function groupFor(name: string) {
  return screen.getByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel(name) });
}

function rowOf(name: string) {
  return groupFor(name).closest("li")!;
}

/** The confirmed level as its digit, or "" when not assessed (the checked radio's accessible label carries it). */
function levelOf(name: string): string {
  const checked = within(groupFor(name))
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true");
  return checked ? (checked.getAttribute("aria-label") ?? "").match(/: (\d)\. /)![1] : "";
}

function lockedOf(name: string): boolean {
  return within(groupFor(name))
    .getAllByRole("radio")
    .every((radio) => (radio as HTMLButtonElement).disabled);
}

/** Chooses a level by clicking its radio, or "" to clear it through the row's "Ikke vurdert" action. */
async function chooseLevel(name: string, value: string) {
  if (value === "") {
    await userEvent.click(within(rowOf(name)).getByRole("button", { name: "Fjern vurdering" }));
    return;
  }
  const level = Number(value) as 1 | 2 | 3 | 4;
  await userEvent.click(
    within(groupFor(name)).getByRole("radio", { name: `${name}: ${level}. ${LEVEL_NAMES[level - 1]}` }),
  );
}

const assessedCard = () => screen.getByRole("region", { name: "Vurderte ferdigheter" });
const assessedCardText = () => assessedCard().textContent ?? "";

describe("SkillProfilePage — level select (TASK-008)", () => {
  it("offers exactly 'Ikke vurdert' plus the four canonical levels, level 4 being 'Avansert'", async () => {
    await renderWith(ok(skills));

    const radios = within(groupFor("Arkitektur")).getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Arkitektur: 1. Grunnleggende kjennskap",
      "Arkitektur: 2. Kan med støtte",
      "Arkitektur: 3. Kan selvstendig",
      "Arkitektur: 4. Avansert",
    ]);
    expect(within(rowOf("Arkitektur")).queryByRole("button", { name: "Ikke vurdert" })).toBeNull();
    expect(levelOf("Arkitektur")).toBe("");
    expect(levelOf("Testing")).toBe("2");
  });

  it("choosing a level sends one PUT and applies the result to row, indicator and overview without refetching", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: true, level: 4 });

    await chooseLevel("Arkitektur", "4");

    await waitFor(() => expect(levelOf("Arkitektur")).toBe("4"));
    expect(setOwnSkillLevelMock).toHaveBeenCalledTimes(1);
    expect(setOwnSkillLevelMock).toHaveBeenCalledWith("a-token", "t-a", 4);
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(1);
    const row = rowOf("Arkitektur");
    expect(within(row).queryByRole("status")).toBeNull();
    expect(row.textContent).toContain("Avansert");
    expect(assessedCardText()).toContain("2 av 2");
  });

  it("applies the server's canonical level, not the chosen one", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: true, level: 3 });

    await chooseLevel("Arkitektur", "1");

    await waitFor(() => expect(levelOf("Arkitektur")).toBe("3"));
  });

  it("choosing 'Ikke vurdert' uses DELETE-one (never PUT) and the row becomes unassessed", async () => {
    await renderWith(ok(skills));
    clearOwnSkillLevelMock.mockResolvedValue({ ok: true, level: null });

    await chooseLevel("Testing", "");

    await waitFor(() => expect(levelOf("Testing")).toBe(""));
    expect(clearOwnSkillLevelMock).toHaveBeenCalledTimes(1);
    expect(clearOwnSkillLevelMock).toHaveBeenCalledWith("a-token", "t-b");
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(screen.getByText(/du har ikke vurdert noen ferdigheter ennå/i)).toBeTruthy();
  });

  it("is keyboard reachable: Tab moves from the filter into each rating group in order", async () => {
    await renderWith(ok(skills));

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Alle" }));
    await userEvent.tab();
    // The collapsed level legend is a disclosure and therefore a tab stop before the rating groups.
    expect(document.activeElement).toBe(screen.getByText("Nivåer"));
    await userEvent.tab();
    expect(document.activeElement).toBe(within(groupFor("Arkitektur")).getByRole("radio", { name: "Arkitektur: 1. Grunnleggende kjennskap" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(within(groupFor("Testing")).getByRole("radio", { name: "Testing: 2. Kan med støtte" }));
  });

  it("no optimistic update: while saving the control is disabled with a 'Lagrer…' status and keeps the confirmed value", async () => {
    await renderWith(ok(skills));
    const pending = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValue(pending.promise);

    await chooseLevel("Arkitektur", "3");

    expect(lockedOf("Arkitektur")).toBe(true);
    expect(levelOf("Arkitektur")).toBe("");
    expect(within(rowOf("Arkitektur")).getByRole("status").textContent).toBe("Lagrer…");
    expect(assessedCardText()).toContain("1 av 2");
    expect(lockedOf("Testing")).toBe(false);

    pending.resolve({ ok: true, level: 3 });
    await waitFor(() => expect(lockedOf("Arkitektur")).toBe(false));
    expect(levelOf("Arkitektur")).toBe("3");
  });

  it("a saving row cannot receive a second request; different rows save concurrently", async () => {
    await renderWith(ok(skills));
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await chooseLevel("Arkitektur", "3");
    await chooseLevel("Arkitektur", "1");
    await chooseLevel("Testing", "4");

    expect(setOwnSkillLevelMock).toHaveBeenCalledTimes(2);
    expect(setOwnSkillLevelMock).toHaveBeenNthCalledWith(1, "a-token", "t-a", 3);
    expect(setOwnSkillLevelMock).toHaveBeenNthCalledWith(2, "a-token", "t-b", 4);

    second.resolve({ ok: true, level: 4 });
    first.resolve({ ok: true, level: 3 });
    await waitFor(() => expect(levelOf("Arkitektur")).toBe("3"));
    expect(levelOf("Testing")).toBe("4");
  });

  it("failure: reverts to the last confirmed value with a row alert; other rows stay usable; retry works", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValueOnce({ ok: false, error: "persistence_failed" });

    await chooseLevel("Arkitektur", "3");

    const row = rowOf("Arkitektur");
    expect((await within(row).findByRole("alert")).textContent).toBe("Vurderingen ble ikke lagret. Prøv igjen.");
    expect(levelOf("Arkitektur")).toBe("");
    expect(lockedOf("Arkitektur")).toBe(false);
    expect(rowOf("Testing").querySelector('[role="alert"]')).toBeNull();
    expect(assessedCardText()).toContain("1 av 2");

    setOwnSkillLevelMock.mockResolvedValueOnce({ ok: true, level: 3 });
    await chooseLevel("Arkitektur", "3");
    await waitFor(() => expect(levelOf("Arkitektur")).toBe("3"));
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it.each(["unknown", "invalid_input"] as const)(
    "%s write error is a generic row failure: no saved state, profile not treated as empty (409 is covered in the reset tests)",
    async (error) => {
      await renderWith(ok(skills));
      setOwnSkillLevelMock.mockResolvedValue({ ok: false, error });

      await chooseLevel("Arkitektur", "3");

      const row = rowOf("Arkitektur");
      expect((await within(row).findByRole("alert")).textContent).toBe("Vurderingen ble ikke lagret. Prøv igjen.");
      expect(levelOf("Testing")).toBe("2");
      expect(assessedCardText()).toContain("1 av 2");
    },
  );

  it("a failed clear keeps the persisted level", async () => {
    await renderWith(ok(skills));
    clearOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await chooseLevel("Testing", "");

    await screen.findByRole("alert");
    expect(levelOf("Testing")).toBe("2");
  });

  it("404 skill_unavailable: row error, exactly one catalog refetch, never a saved state", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "skill_unavailable" });
    fetchOwnSkillsMock.mockResolvedValueOnce(ok(skills));

    await chooseLevel("Arkitektur", "3");

    const row = rowOf("Arkitektur");
    expect((await within(row).findByRole("alert")).textContent).toBe("Denne ferdigheten er ikke lenger tilgjengelig.");
    await waitFor(() => expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(2));
    expect(fetchOwnSkillsMock).toHaveBeenLastCalledWith("a-token");
    expect(levelOf("Arkitektur")).toBe("");
  });

  it("404 skill_unavailable: the refetched catalog replaces the list", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "skill_unavailable" });
    fetchOwnSkillsMock.mockResolvedValueOnce(ok([skills[1]]));

    await chooseLevel("Arkitektur", "3");

    await waitFor(() => expect(screen.queryByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Arkitektur") })).toBeNull());
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(2);
    expect(assessedCardText()).toContain("1 av 1");
  });

  it("401 on save: sign-in prompt, no data rendered, no refetch, no saved wording", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await chooseLevel("Arkitektur", "3");

    expect(await screen.findByRole("link", { name: "Logg inn" })).toBeTruthy();
    expect(screen.queryByText("Arkitektur")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/lagret/i)).toBeNull();
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("a save response arriving after an identity change is not applied", async () => {
    let emit: (token: string | null) => void = () => {};
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      emit = callback;
      callback("token-a");
      return () => {};
    });
    fetchOwnSkillsMock.mockResolvedValueOnce(ok(skills));
    render(<SkillProfilePage />);
    await screen.findByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Arkitektur") });

    const pending = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValue(pending.promise);
    await chooseLevel("Arkitektur", "3");

    fetchOwnSkillsMock.mockResolvedValueOnce(ok([{ treeId: "t-z", name: "Bs område", level: null }]));
    emit("token-b");
    await screen.findByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Bs område") });

    pending.resolve({ ok: true, level: 3 });
    await Promise.resolve();
    expect(screen.queryByText("Arkitektur")).toBeNull();
    expect(levelOf("Bs område")).toBe("");
  });
});

describe("SkillProfilePage — filter (TASK-008)", () => {
  it("is a labelled radio group defaulting to 'Alle' and makes no request on change", async () => {
    await renderWith(ok(skills));

    const group = screen.getByRole("group", { name: "Vis" });
    expect(within(group).getAllByRole("radio").map((r) => (r as HTMLInputElement).labels![0].textContent)).toEqual([
      "Alle",
      "Vurdert",
      "Ikke vurdert",
    ]);
    expect((screen.getByRole("radio", { name: "Alle" }) as HTMLInputElement).checked).toBe(true);

    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));

    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(1);
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();
  });

  it("filters assessed and unassessed rows, operable by keyboard", async () => {
    await renderWith(ok(skills));

    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    expect(screen.queryByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Arkitektur") })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Testing") })).toBeTruthy();

    await userEvent.keyboard("{ArrowDown}");
    expect((screen.getByRole("radio", { name: "Ikke vurdert" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Arkitektur") })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Testing") })).toBeNull();
  });

  it("shows a neutral message when nothing matches; the overview is unaffected", async () => {
    await renderWith(ok([{ treeId: "t-a", name: "Arkitektur", level: null }]));

    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));

    expect(screen.getByText("Ingen ferdigheter samsvarer med valgt filter.")).toBeTruthy();
    expect(screen.getByText(/du har ikke vurdert noen ferdigheter ennå/i)).toBeTruthy();
  });

  it("row save state survives filtering out and in; a saved row follows its confirmed state", async () => {
    await renderWith(ok(skills));
    const pending = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValue(pending.promise);
    await chooseLevel("Arkitektur", "3");

    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    await userEvent.click(screen.getByRole("radio", { name: "Ikke vurdert" }));
    expect(lockedOf("Arkitektur")).toBe(true);

    pending.resolve({ ok: true, level: 3 });
    await waitFor(() => expect(screen.queryByRole("radiogroup", { name: teamSkillsCopy.own.groupLabel("Arkitektur") })).toBeNull());
    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    expect(levelOf("Arkitektur")).toBe("3");
  });
});

describe("SkillProfilePage — boundaries (TASK-008)", () => {
  it("never calls DELETE-all on its own and uses no score wording", async () => {
    await renderWith(ok(skills, { truncated: true }));

    expect(screen.getByText("Listen kan være ufullstendig.")).toBeTruthy();
    expect(deleteOwnSkillProfileMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/poeng|score|rangering|gjennomsnitt|prosent|%|snitt/i);
  });

  it("unreadable profile: no selectors or filter, so nothing is writable and it never reads as empty", async () => {
    await renderWith(ok(skills, { profile: "unreadable" }));

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Ikke vurdert")).toBeNull();
    expect(screen.queryByText(/du har ikke vurdert noen/i)).toBeNull();
  });
});
