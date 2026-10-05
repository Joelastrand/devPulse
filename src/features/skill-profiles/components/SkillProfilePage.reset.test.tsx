// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
type Row = { treeId: string; name: string; level: Level };

const assessed: Row[] = [
  { treeId: "t-a", name: "Arkitektur", level: null },
  { treeId: "t-b", name: "Testing", level: 2 },
];

function ok(rows: Row[], extra = {}) {
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

const resetButton = () => screen.queryByRole("button", { name: "Nullstill alle ferdigheter" });
const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;

async function openConfirmation() {
  await userEvent.click(resetButton()!);
  return screen.getByRole("button", { name: "Ja, nullstill alle" });
}

describe("SkillProfilePage — reset-all visibility (TASK-009)", () => {
  it("is shown when any visible skill is assessed", async () => {
    await renderWith(ok(assessed));
    expect(resetButton()).toBeTruthy();
    expect((resetButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("is absent when nothing is assessed, readable and not truncated", async () => {
    await renderWith(ok([{ treeId: "t-a", name: "Arkitektur", level: null }]));
    expect(resetButton()).toBeNull();
  });

  it("is shown for an unreadable profile", async () => {
    await renderWith(ok([{ treeId: "t-a", name: "Arkitektur", level: null }], { profile: "unreadable" }));
    expect(resetButton()).toBeTruthy();
  });

  it("is shown for a truncated catalog even with nothing assessed, and with no skills", async () => {
    await renderWith(ok([], { truncated: true }));
    expect(resetButton()).toBeTruthy();
  });

  it("is not shown on a read failure or when signed out", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<SkillProfilePage />);
    await screen.findByRole("link", { name: "Logg inn" });
    expect(resetButton()).toBeNull();
  });
});

describe("SkillProfilePage — reset-all confirmation (TASK-009)", () => {
  it("requires confirmation, describes the effect plainly and sends no request before confirming", async () => {
    await renderWith(ok(assessed));
    await openConfirmation();

    expect(screen.getByText(/lagrede egenvurderinger fjernes permanent/i).textContent).toMatch(
      /ferdighetslisten slettes ikke.*bare dine egne/i,
    );
    expect(deleteOwnSkillProfileMock).not.toHaveBeenCalled();
  });

  it("moves focus to the confirm step on open", async () => {
    await renderWith(ok(assessed));
    await openConfirmation();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Avbryt" }));
  });

  it("cancel makes no request, keeps every level and returns focus to the trigger", async () => {
    await renderWith(ok(assessed));
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: "Avbryt" }));

    expect(deleteOwnSkillProfileMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Ja, nullstill alle" })).toBeNull();
    expect(select("Testing").value).toBe("2");
    expect(document.activeElement).toBe(resetButton());
  });

  it("confirm calls the DELETE-all gateway exactly once with only the token, and is not double-submittable", async () => {
    await renderWith(ok(assessed));
    const pending = deferred<{ ok: true }>();
    deleteOwnSkillProfileMock.mockReturnValue(pending.promise);
    const confirm = await openConfirmation();

    await userEvent.click(confirm);

    expect(deleteOwnSkillProfileMock).toHaveBeenCalledTimes(1);
    expect(deleteOwnSkillProfileMock).toHaveBeenCalledWith("a-token");
    expect(screen.queryByRole("button", { name: "Ja, nullstill alle" })).toBeNull();
    expect((screen.getByRole("button", { name: "Nullstiller…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(select("Testing").value).toBe("2"); // not optimistic
    expect(select("Testing").disabled).toBe(true); // no row write can conflict
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();

    pending.resolve({ ok: true });
    await waitFor(() => expect(select("Testing").value).toBe(""));
  });
});

describe("SkillProfilePage — reset-all outcomes (TASK-009)", () => {
  it("success: all rows unassessed, catalog kept, overview zero, reset gone, no per-skill writes, no refetch", async () => {
    await renderWith(ok(assessed));
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });

    await userEvent.click(await openConfirmation());

    await waitFor(() => expect(select("Testing").value).toBe(""));
    expect(select("Arkitektur").value).toBe("");
    expect(select("Testing").disabled).toBe(false);
    expect(screen.getByText(/du har ikke vurdert noen ferdigheter ennå/i)).toBeTruthy();
    expect(resetButton()).toBeNull();
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("success updates the filter results: 'Vurdert' becomes empty, 'Ikke vurdert' lists all rows", async () => {
    await renderWith(ok(assessed));
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    expect(screen.queryByRole("combobox", { name: "Arkitektur" })).toBeNull();

    await userEvent.click(await openConfirmation());

    await screen.findByText("Ingen ferdigheter samsvarer med valgt filter.");
    await userEvent.click(screen.getByRole("radio", { name: "Ikke vurdert" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("failure: levels stay, an alert (not success) is shown, and retry is possible", async () => {
    await renderWith(ok(assessed));
    deleteOwnSkillProfileMock.mockResolvedValueOnce({ ok: false, error: "persistence_failed" });

    await userEvent.click(await openConfirmation());

    expect((await screen.findByRole("alert")).textContent).toBe("Egenvurderingene dine ble ikke nullstilt. Prøv igjen.");
    expect(select("Testing").value).toBe("2");
    expect(select("Testing").disabled).toBe(false);

    deleteOwnSkillProfileMock.mockResolvedValueOnce({ ok: true });
    await userEvent.click(await openConfirmation());
    await waitFor(() => expect(select("Testing").value).toBe(""));
    expect(deleteOwnSkillProfileMock).toHaveBeenCalledTimes(2);
  });

  it("a gateway failure for a malformed 2xx body is treated as failure, never success", async () => {
    await renderWith(ok(assessed));
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: false, error: "unknown" });

    await userEvent.click(await openConfirmation());

    await screen.findByRole("alert");
    expect(select("Testing").value).toBe("2");
  });

  it("401: shows the sign-in prompt and removes all personal content", async () => {
    await renderWith(ok(assessed));
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await userEvent.click(await openConfirmation());

    expect((await screen.findByRole("link", { name: "Logg inn" })).getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByText("Testing")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(resetButton()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SkillProfilePage — reset-all versus row saves (TASK-009)", () => {
  it("reset cannot start while a row save is pending, and a stale save cannot resurrect a level afterwards", async () => {
    await renderWith(ok(assessed));
    const save = deferred<{ ok: true; level: 3 }>();
    setOwnSkillLevelMock.mockReturnValue(save.promise);

    await userEvent.selectOptions(select("Arkitektur"), "3");

    expect((resetButton() as HTMLButtonElement).disabled).toBe(true);
    save.resolve({ ok: true, level: 3 });
    await waitFor(() => expect((resetButton() as HTMLButtonElement).disabled).toBe(false));
    expect(select("Arkitektur").value).toBe("3");
  });

  it("rows cannot be edited while the confirmation is open", async () => {
    await renderWith(ok(assessed));
    await openConfirmation();
    expect(select("Arkitektur").disabled).toBe(true);
    expect(select("Testing").disabled).toBe(true);
  });
});

describe("SkillProfilePage — unreadable profile recovery (TASK-009)", () => {
  const unreadable = () => ok([{ treeId: "t-a", name: "Arkitektur", level: null }], { profile: "unreadable" });

  it("shows names and the notice only, with no selectors, 'Ikke vurdert', filter or overview", async () => {
    await renderWith(unreadable());
    expect(screen.getByText("Arkitektur")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/kan ikke leses/i);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Ikke vurdert")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("cancel leaves it unreadable and sends nothing", async () => {
    await renderWith(unreadable());
    await openConfirmation();
    await userEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(deleteOwnSkillProfileMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/kan ikke leses/i);
  });

  it("success moves to the normal empty state with selectors; no repair writes happen", async () => {
    await renderWith(unreadable());
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });

    await userEvent.click(await openConfirmation());

    await waitFor(() => expect(select("Arkitektur").value).toBe(""));
    expect(screen.queryByText(/kan ikke leses/i)).toBeNull();
    expect(screen.getByText(/du har ikke vurdert noen ferdigheter ennå/i)).toBeTruthy();
    expect(resetButton()).toBeNull();
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();
  });

  it("failure stays unreadable: no selectors, no 'Ikke vurdert', no overview, recovery still offered", async () => {
    await renderWith(unreadable());
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await userEvent.click(await openConfirmation());

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByText(/kan ikke leses/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Ikke vurdert")).toBeNull();
    expect(screen.queryByText(/du har ikke vurdert/i)).toBeNull();
    expect(resetButton()).toBeTruthy();
  });

  it("401 shows the sign-in prompt and no profile content", async () => {
    await renderWith(unreadable());
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await userEvent.click(await openConfirmation());

    await screen.findByRole("link", { name: "Logg inn" });
    expect(screen.queryByText("Arkitektur")).toBeNull();
  });

  it("a 409 during an edit moves the page into the unreadable state", async () => {
    await renderWith(ok(assessed));
    setOwnSkillLevelMock.mockResolvedValue({ ok: false, error: "profile_unreadable" });

    await userEvent.selectOptions(select("Arkitektur"), "3");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/kan ikke leses/i));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Ikke vurdert")).toBeNull();
    expect(resetButton()).toBeTruthy();
  });
});

describe("SkillProfilePage — truncated notice (TASK-009)", () => {
  it("is absent when truncated is false, even with many rows", async () => {
    await renderWith(ok(assessed));
    expect(screen.queryByText(/ufullstendig/i)).toBeNull();
  });

  it("is driven by the flag, not the row count, and never claims missing areas or mentions 500", async () => {
    await renderWith(ok(assessed, { truncated: true }));
    const notice = screen.getByText("Listen kan være ufullstendig.");
    expect(notice).toBeTruthy();
    expect(notice.textContent).not.toMatch(/500|mangler|skjult/i);
  });

  it("stays visible under every filter, including an empty match", async () => {
    await renderWith(ok(assessed, { truncated: true }));
    await userEvent.click(screen.getByRole("radio", { name: "Vurdert" }));
    expect(screen.getByText("Listen kan være ufullstendig.")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Ikke vurdert" }));
    expect(screen.getByText("Listen kan være ufullstendig.")).toBeTruthy();
  });

  it("appears together with the unreadable notice when both apply", async () => {
    await renderWith(ok(assessed, { truncated: true, profile: "unreadable" }));
    expect(screen.getByText("Listen kan være ufullstendig.")).toBeTruthy();
    expect(screen.getByText(/kan ikke leses/i)).toBeTruthy();
  });

  it("remains after a successful reset because the catalog is still truncated", async () => {
    await renderWith(ok(assessed, { truncated: true }));
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });
    await userEvent.click(await openConfirmation());
    await waitFor(() => expect(select("Testing").value).toBe(""));
    expect(screen.getByText("Listen kan være ufullstendig.")).toBeTruthy();
  });
});
