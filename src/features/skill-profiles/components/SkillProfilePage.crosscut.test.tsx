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

const rows = [
  { treeId: "t-a", name: "Arkitektur", level: null },
  { treeId: "t-b", name: "Testing", level: null },
  { treeId: "t-c", name: "Utvikling", level: 2 },
];

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function renderReady() {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills: rows, truncated: false, profile: "ok" } });
  render(<SkillProfilePage />);
  await screen.findByText(/egenvurderingen din er din egen/i);
}

const resetButton = () => screen.getByRole("button", { name: /nullstill alle ferdigheter|nullstiller/i }) as HTMLButtonElement;
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

describe("SkillProfilePage — mutation-time 409 with another save still in flight (TASK-010, S4)", () => {
  it("keeps recovery unavailable until the other in-flight save has settled", async () => {
    await renderReady();
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await chooseLevel("Arkitektur", "3");
    await chooseLevel("Testing", "4");

    a.resolve({ ok: false, error: "profile_unreadable" });
    await screen.findByText(/kan ikke leses/i);

    expect(resetButton().disabled).toBe(true);
    b.resolve({ ok: false, error: "profile_unreadable" });
    await waitFor(() => expect(resetButton().disabled).toBe(false));
  });

  it("a save that started before the unreadable transition cannot restore a level after recovery", async () => {
    await renderReady();
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    setOwnSkillLevelMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await chooseLevel("Arkitektur", "3");
    await chooseLevel("Testing", "4");

    a.resolve({ ok: false, error: "profile_unreadable" });
    await screen.findByText(/kan ikke leses/i);
    b.resolve({ ok: true, level: 4 });
    await waitFor(() => expect(resetButton().disabled).toBe(false));
    // Still unreadable: no known level is presented.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryAllByText("Avansert")).toHaveLength(1); // the legend only

    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });
    await userEvent.click(resetButton());
    await userEvent.click(screen.getByRole("button", { name: "Ja, nullstill alle" }));

    await waitFor(() => expect(levelOf("Testing")).toBe(""));
    expect(levelOf("Arkitektur")).toBe("");
    expect(levelOf("Utvikling")).toBe("");
  });

  it("a catalog refetch started by a 404 cannot restore a readable profile after a 409", async () => {
    await renderReady();
    const refetch = deferred<unknown>();
    setOwnSkillLevelMock
      .mockResolvedValueOnce({ ok: false, error: "skill_unavailable" })
      .mockResolvedValueOnce({ ok: false, error: "profile_unreadable" });
    fetchOwnSkillsMock.mockReturnValueOnce(refetch.promise);

    await chooseLevel("Arkitektur", "3");
    await waitFor(() => expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(2));
    await chooseLevel("Testing", "4");
    await screen.findByText(/kan ikke leses/i);

    refetch.resolve({ status: "ok", dto: { skills: rows, truncated: false, profile: "ok" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/kan ikke leses/i)).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("SkillProfilePage — reset focus and announcement (TASK-010, S2)", () => {
  async function openAndConfirm(result: Promise<unknown>) {
    deleteOwnSkillProfileMock.mockReturnValue(result);
    await userEvent.click(resetButton());
    await userEvent.click(screen.getByRole("button", { name: "Ja, nullstill alle" }));
  }

  it("keeps focus inside the page while resetting and announces success once the trigger is gone", async () => {
    await renderReady();
    const done = deferred<unknown>();
    await openAndConfirm(done.promise);

    expect(document.body).not.toBe(document.activeElement);
    expect(document.activeElement?.getAttribute("role")).toBe("status");

    done.resolve({ ok: true });
    const status = await screen.findByText("Egenvurderingene dine er nullstilt.");
    expect(status.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(status);
    expect(screen.queryByRole("button", { name: /nullstill alle ferdigheter/i })).toBeNull();
  });

  it("does not announce success when the reset fails", async () => {
    await renderReady();
    await openAndConfirm(Promise.resolve({ ok: false, error: "persistence_failed" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Egenvurderingene dine er nullstilt.")).toBeNull();
  });
});

describe("SkillProfilePage — request economy (TASK-010)", () => {
  it("page load is exactly one GET and makes no per-skill or write request", async () => {
    await renderReady();
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(1);
    expect(setOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(clearOwnSkillLevelMock).not.toHaveBeenCalled();
    expect(deleteOwnSkillProfileMock).not.toHaveBeenCalled();
  });
});

describe("SkillProfilePage — repeated reset on a truncated catalog (TASK-010 remediation)", () => {
  const SUCCESS = "Egenvurderingene dine er nullstilt.";

  async function renderTruncated() {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills: rows, truncated: true, profile: "ok" } });
    render(<SkillProfilePage />);
    await screen.findByText(/egenvurderingen din er din egen/i);
  }

  async function startReset(result: Promise<unknown>) {
    deleteOwnSkillProfileMock.mockReturnValueOnce(result);
    await userEvent.click(resetButton());
    await userEvent.click(screen.getByRole("button", { name: "Ja, nullstill alle" }));
  }

  it("a failed second reset neither re-exposes the first success nor drops focus to body", async () => {
    await renderTruncated();
    await startReset(Promise.resolve({ ok: true }));
    await screen.findByText(SUCCESS);

    const second = deferred<unknown>();
    await userEvent.click(resetButton());
    expect(screen.queryByText(SUCCESS)).toBeNull();
    deleteOwnSkillProfileMock.mockReturnValueOnce(second.promise);
    await userEvent.click(screen.getByRole("button", { name: "Ja, nullstill alle" }));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("role")).toBe("status");

    second.resolve({ ok: false, error: "persistence_failed" });
    await screen.findByRole("alert");
    expect(screen.queryByText(SUCCESS)).toBeNull();
    expect(deleteOwnSkillProfileMock).toHaveBeenCalledTimes(2);
    expect(levelOf("Utvikling")).toBe("");
    expect(resetButton().disabled).toBe(false);
  });

  it("a successful second reset announces success again for the second operation", async () => {
    await renderTruncated();
    await startReset(Promise.resolve({ ok: true }));
    await screen.findByText(SUCCESS);

    const second = deferred<unknown>();
    await startReset(second.promise);
    expect(screen.queryByText(SUCCESS)).toBeNull();
    expect(document.activeElement?.getAttribute("role")).toBe("status");

    second.resolve({ ok: true });
    const status = await screen.findByText(SUCCESS);
    expect(document.activeElement).toBe(status);
    expect(deleteOwnSkillProfileMock).toHaveBeenCalledTimes(2);
  });
});
