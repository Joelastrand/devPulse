// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Identity = string | null;
let identitySubscribers = new Set<(token: Identity) => void>();
const observeIdTokenMock = vi.fn((callback: (token: Identity) => void) => {
  identitySubscribers.add(callback);
  callback("token-a");
  return () => {
    identitySubscribers.delete(callback);
  };
});
vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));

const fetchTeamsOverviewMock = vi.fn();
vi.mock("../../teams/client/teams-overview-gateway", () => ({ fetchTeamsOverview: fetchTeamsOverviewMock }));

const fetchTeamSkillsMock = vi.fn();
const setRatingMock = vi.fn();
const clearRatingMock = vi.fn();
vi.mock("../client/team-skills-gateway", () => ({
  fetchTeamSkills: fetchTeamSkillsMock,
  setOwnTeamSkillRating: setRatingMock,
  clearOwnTeamSkillRating: clearRatingMock,
}));

const { OwnTeamSkillsSection } = await import("./OwnTeamSkillsSection");
const { teamSkillsCopy } = await import("../copy");

/** A deferred answer the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const TEAM = { teamId: "t1", name: "Plattform", isMember: true, canOpen: true };
const SKILL = { skillId: "s1", name: "Testing", category: null, active: true, guidance: {} };

function skillsOk(own: { skillId: string; level: 1 | 2 | 3 | 4; outdated: boolean }[] = []) {
  return { status: "ok", skills: [SKILL], canEdit: false, own, truncated: false };
}

function setIdentity(token: Identity) {
  act(() => {
    for (const subscriber of identitySubscribers) subscriber(token);
  });
}

beforeEach(() => {
  identitySubscribers = new Set();
  fetchTeamsOverviewMock.mockReset();
  fetchTeamSkillsMock.mockReset();
  setRatingMock.mockReset();
  clearRatingMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("team-owned skills: loading and empty states", () => {
  it("shows one busy announcement and a decorative placeholder, not the empty message, while loading", () => {
    fetchTeamsOverviewMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<OwnTeamSkillsSection />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(teamSkillsCopy.loading);
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(teamSkillsCopy.own.emptyTeam)).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
  });

  it("replaces the placeholder with the loaded team after a successful read", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [TEAM] });
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    render(<OwnTeamSkillsSection />);

    expect(await screen.findByRole("heading", { name: teamSkillsCopy.own.heading })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Testing")).toBeTruthy();
  });

  it("shows the empty state only after a successful read with no member teams", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    render(<OwnTeamSkillsSection />);

    expect(await screen.findByText(teamSkillsCopy.own.emptyTeam)).toBeTruthy();
  });

  it("keeps a failed overview distinct from the empty state", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });
    render(<OwnTeamSkillsSection />);

    expect(await screen.findByText(teamSkillsCopy.errors.read_failed)).toBeTruthy();
    expect(screen.queryByText(teamSkillsCopy.own.emptyTeam)).toBeNull();
  });
});

describe("team-owned skills: rating writes", () => {
  it("blocks a repeat rating on the same skill while its write is pending, and only that row is disabled", async () => {
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [TEAM] });
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    const write = deferred<{ status: "ok" }>();
    setRatingMock.mockReturnValue(write.promise);
    render(<OwnTeamSkillsSection />);
    await screen.findByText("Testing");

    const radio = screen.getByRole("radio", { name: /Testing: 2\./ });
    await user.click(radio);
    expect(screen.getByText(teamSkillsCopy.savingButton)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Testing: 3\./ }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(radio);
    expect(setRatingMock).toHaveBeenCalledTimes(1);

    write.resolve({ status: "ok" });
    await waitFor(() => expect(screen.queryByText(teamSkillsCopy.savingButton)).toBeNull());
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(2);
  });

  it("shows the write error next to the team and keeps the rating controls usable", async () => {
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [TEAM] });
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    setRatingMock.mockResolvedValue({ status: "forbidden" });
    render(<OwnTeamSkillsSection />);
    await screen.findByText("Testing");

    await user.click(screen.getByRole("radio", { name: /Testing: 2\./ }));

    await waitFor(() => expect(screen.queryByText(teamSkillsCopy.savingButton)).toBeNull());
    expect((screen.getByRole("radio", { name: /Testing: 3\./ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("team-owned skills: identity changes", () => {
  it("ignores a late team list from the previous account after an account switch", async () => {
    const lateOverview = deferred<{ status: "ok"; teams: (typeof TEAM)[] }>();
    fetchTeamsOverviewMock.mockImplementation((token: string) =>
      token === "token-a" ? lateOverview.promise : Promise.resolve({ status: "ok", teams: [{ ...TEAM, teamId: "t2", name: "Konto B-team" }] }),
    );
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    render(<OwnTeamSkillsSection />);

    setIdentity("token-b");
    expect(await screen.findByText(/Konto B-team/)).toBeTruthy();

    lateOverview.resolve({ status: "ok", teams: [{ ...TEAM, name: "Konto A-team" }] });
    await act(async () => {});

    expect(screen.queryByText(/Konto A-team/)).toBeNull();
    expect(screen.getByText(/Konto B-team/)).toBeTruthy();
  });

  it("drops a rating outcome from the previous account and does not show it as saved", async () => {
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [TEAM] });
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    const write = deferred<{ status: "forbidden" }>();
    setRatingMock.mockReturnValue(write.promise);
    render(<OwnTeamSkillsSection />);
    await screen.findByText("Testing");

    await user.click(screen.getByRole("radio", { name: /Testing: 2\./ }));
    setIdentity(null);
    expect(await screen.findByText(teamSkillsCopy.own.emptyTeam)).toBeTruthy();

    write.resolve({ status: "forbidden" });
    await act(async () => {});

    expect(screen.queryByText(teamSkillsCopy.errors.write_failed)).toBeNull();
    expect(screen.queryByText("Testing")).toBeNull();
  });
});

describe("team-owned skills: direct account switch (A -> B, no sign-out in between)", () => {
  it("clears account A's team blocks and skills while account B's read is pending", async () => {
    fetchTeamsOverviewMock.mockImplementation((token: string) =>
      token === "token-a" ? Promise.resolve({ status: "ok", teams: [TEAM] }) : new Promise(() => {}),
    );
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    render(<OwnTeamSkillsSection />);
    expect(await screen.findByText("Testing")).toBeTruthy();

    setIdentity("token-b");

    expect(screen.queryByText("Testing")).toBeNull();
    expect(screen.queryByText(/Plattform/)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(teamSkillsCopy.loading);
  });

  it("ignores a late rating write from account A after the switch and does not show it for account B", async () => {
    fetchTeamsOverviewMock.mockImplementation((token: string) =>
      token === "token-a"
        ? Promise.resolve({ status: "ok", teams: [TEAM] })
        : Promise.resolve({ status: "ok", teams: [{ ...TEAM, teamId: "t2", name: "Konto B-team" }] }),
    );
    fetchTeamSkillsMock.mockResolvedValue(skillsOk());
    const write = deferred<{ status: "ok" }>();
    setRatingMock.mockReturnValue(write.promise);
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<OwnTeamSkillsSection />);
    await screen.findByText("Testing");
    await user.click(screen.getByRole("radio", { name: /Testing: 2\./ }));

    setIdentity("token-b");
    expect(await screen.findByText(/Konto B-team/)).toBeTruthy();

    write.resolve({ status: "ok" });
    await act(async () => {});

    expect(screen.queryByText(/Plattform/)).toBeNull();
    expect(screen.queryByText(teamSkillsCopy.savingButton)).toBeNull();
  });
});
