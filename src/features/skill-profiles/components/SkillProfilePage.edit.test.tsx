// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  await screen.findByText(/egenvurderingen din er privat/i);
}

function selectFor(name: string) {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

describe("SkillProfilePage — level select (TASK-008)", () => {
  it("offers exactly 'Ikke vurdert' plus the four canonical levels, level 4 being 'Avansert'", async () => {
    await renderWith(ok(skills));

    const options = Array.from(selectFor("Arkitektur").options);
    expect(options.map((o) => o.textContent)).toEqual([
      "Ikke vurdert",
      "Grunnleggende kjennskap",
      "Kan med støtte",
      "Kan selvstendig",
      "Avansert",
    ]);
    expect(options.map((o) => o.value)).toEqual(["", "1", "2", "3", "4"]);
    expect(selectFor("Arkitektur").value).toBe("");
    expect(selectFor("Testing").value).toBe("2");
  });

  it("choosing a level sends one PUT and applies the result to row, indicator and overview without refetching", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: true, level: 4 });

    await userEvent.selectOptions(selectFor("Arkitektur"), "4");

    await waitFor(() => expect(selectFor("Arkitektur").value).toBe("4"));
    expect(setOwnSkillLevelMock).toHaveBeenCalledTimes(1);
    expect(setOwnSkillLevelMock).toHaveBeenCalledWith("a-token", "t-a", 4);
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(1);
    const row = selectFor("Arkitektur").closest("li")!;
    expect(within(row).getByRole("status").textContent).toBe("");
    expect(row.textContent).toContain("Avansert");
    expect(screen.getByText("Du har vurdert 2 av 2 ferdigheter.")).toBeTruthy();
    expect(screen.getByText("Avansert: 1")).toBeTruthy();
  });

  it("applies the server's canonical level, not the chosen one", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: true, level: 3 });

    await userEvent.selectOptions(selectFor("Arkitektur"), "1");

    await waitFor(() => expect(selectFor("Arkitektur").value).toBe("3"));
  });

  it("choosing 'Ikke vurdert' uses DELETE-one (never PUT) and the row becomes unassessed", async () => {
    await renderWith(ok(skills));
    clearOwnSkillLevelMock.mockResolvedValue({ ok: true, level: null });

    await userEvent.selectOptions(selectFor("Testing"), "");

    await waitFor(() => expect(selectFor("Testing").value).toBe(""));
    expect(clearOwnSkillLevelMock).toHaveBeenCalledTimes(1);
    expect(clearOwnSkillLevelMock).toHaveBeenCalledWith("a-token", "t-b");
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(screen.getByText(/du har ikke vurdert noen ferdigheter ennå/i)).toBeTruthy();
  });

  it("is keyboard reachable: Tab moves from the filter to each native select in order", async () => {
    await renderWith(ok(skills));

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Alle" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(selectFor("Arkitektur"));
    await userEvent.tab();
    expect(document.activeElement).toBe(selectFor("Testing"));
  });

  it("no optimistic update: while saving the control is disabled with a 'Lagrer…' status and keeps the confirmed value", async () => {
    await renderWith(ok(skills));
    const pending = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValue(pending.promise);

    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    const select = selectFor("Arkitektur");
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("");
    expect(within(select.closest("li")!).getByRole("status").textContent).toBe("Lagrer…");
    expect(screen.getByText("Du har vurdert 1 av 2 ferdigheter.")).toBeTruthy();
    expect(selectFor("Testing").disabled).toBe(false);

    pending.resolve({ ok: true, level: 3 });
    await waitFor(() => expect(selectFor("Arkitektur").disabled).toBe(false));
    expect(selectFor("Arkitektur").value).toBe("3");
  });

  it("a saving row cannot receive a second request; different rows save concurrently", async () => {
    await renderWith(ok(skills));
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await userEvent.selectOptions(selectFor("Arkitektur"), "3");
    await userEvent.selectOptions(selectFor("Arkitektur"), "1");
    await userEvent.selectOptions(selectFor("Testing"), "4");

    expect(setOwnSkillLevelMock).toHaveBeenCalledTimes(2);
    expect(setOwnSkillLevelMock).toHaveBeenNthCalledWith(1, "a-token", "t-a", 3);
    expect(setOwnSkillLevelMock).toHaveBeenNthCalledWith(2, "a-token", "t-b", 4);

    second.resolve({ ok: true, level: 4 });
    first.resolve({ ok: true, level: 3 });
    await waitFor(() => expect(selectFor("Arkitektur").value).toBe("3"));
    expect(selectFor("Testing").value).toBe("4");
  });

  it("failure: reverts to the last confirmed value with a row alert; other rows stay usable; retry works", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValueOnce({ ok: false, error: "persistence_failed" });

    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    const row = selectFor("Arkitektur").closest("li")!;
    expect((await within(row).findByRole("alert")).textContent).toBe("Vurderingen ble ikke lagret. Prøv igjen.");
    expect(selectFor("Arkitektur").value).toBe("");
    expect(selectFor("Arkitektur").disabled).toBe(false);
    expect(selectFor("Testing").closest("li")!.querySelector('[role="alert"]')).toBeNull();
    expect(screen.getByText("Du har vurdert 1 av 2 ferdigheter.")).toBeTruthy();

    setOwnSkillLevelMock.mockResolvedValueOnce({ ok: true, level: 3 });
    await userEvent.selectOptions(selectFor("Arkitektur"), "3");
    await waitFor(() => expect(selectFor("Arkitektur").value).toBe("3"));
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it.each(["unknown", "invalid_input"] as const)(
    "%s write error is a generic row failure: no saved state, profile not treated as empty (409 is covered in the reset tests)",
    async (error) => {
      await renderWith(ok(skills));
      setOwnSkillLevelMock.mockResolvedValue({ ok: false, error });

      await userEvent.selectOptions(selectFor("Arkitektur"), "3");

      const row = selectFor("Arkitektur").closest("li")!;
      expect((await within(row).findByRole("alert")).textContent).toBe("Vurderingen ble ikke lagret. Prøv igjen.");
      expect(selectFor("Testing").value).toBe("2");
      expect(screen.getByText("Du har vurdert 1 av 2 ferdigheter.")).toBeTruthy();
    },
  );

  it("a failed clear keeps the persisted level", async () => {
    await renderWith(ok(skills));
    clearOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await userEvent.selectOptions(selectFor("Testing"), "");

    await screen.findByRole("alert");
    expect(selectFor("Testing").value).toBe("2");
  });

  it("404 skill_unavailable: row error, exactly one catalog refetch, never a saved state", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "skill_unavailable" });
    fetchOwnSkillsMock.mockResolvedValueOnce(ok(skills));

    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    const row = selectFor("Arkitektur").closest("li")!;
    expect((await within(row).findByRole("alert")).textContent).toBe("Denne ferdigheten er ikke lenger tilgjengelig.");
    await waitFor(() => expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(2));
    expect(fetchOwnSkillsMock).toHaveBeenLastCalledWith("a-token");
    expect(selectFor("Arkitektur").value).toBe("");
  });

  it("404 skill_unavailable: the refetched catalog replaces the list", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "skill_unavailable" });
    fetchOwnSkillsMock.mockResolvedValueOnce(ok([skills[1]]));

    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Arkitektur" })).toBeNull());
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Du har vurdert 1 av 1 ferdigheter.")).toBeTruthy();
  });

  it("401 on save: sign-in prompt, no data rendered, no refetch, no saved wording", async () => {
    await renderWith(ok(skills));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    expect(await screen.findByRole("link", { name: "Logg inn" })).toBeTruthy();
    expect(screen.queryByText("Arkitektur")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
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
    await screen.findByRole("combobox", { name: "Arkitektur" });

    const pending = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValue(pending.promise);
    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    fetchOwnSkillsMock.mockResolvedValueOnce(ok([{ treeId: "t-z", name: "Bs område", level: null }]));
    emit("token-b");
    await screen.findByRole("combobox", { name: "Bs område" });

    pending.resolve({ ok: true, level: 3 });
    await Promise.resolve();
    expect(screen.queryByText("Arkitektur")).toBeNull();
    expect(selectFor("Bs område").value).toBe("");
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
    expect(screen.queryByRole("combobox", { name: "Arkitektur" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Testing" })).toBeTruthy();

    await userEvent.keyboard("{ArrowDown}");
    expect((screen.getByRole("radio", { name: "Ikke vurdert" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("combobox", { name: "Arkitektur" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Testing" })).toBeNull();
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
    await userEvent.selectOptions(selectFor("Arkitektur"), "3");

    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    await userEvent.click(screen.getByRole("radio", { name: "Ikke vurdert" }));
    expect(selectFor("Arkitektur").disabled).toBe(true);

    pending.resolve({ ok: true, level: 3 });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Arkitektur" })).toBeNull());
    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    expect(selectFor("Arkitektur").value).toBe("3");
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

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Ikke vurdert")).toBeNull();
    expect(screen.queryByText(/du har ikke vurdert noen/i)).toBeNull();
  });
});
