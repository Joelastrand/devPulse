// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

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

// The per-team write panel is covered elsewhere; here only the team list's identity handling matters.
vi.mock("./SkillContributionPanel", () => ({ SkillContributionPanel: () => null }));

const { OwnCompetenceSharing } = await import("./OwnCompetenceSharing");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function team(teamId: string, name: string) {
  return { teamId, name, isMember: true, canOpen: true, relationship: "member" };
}

function setIdentity(token: Identity) {
  act(() => {
    for (const subscriber of identitySubscribers) subscriber(token);
  });
}

beforeEach(() => {
  identitySubscribers = new Set();
  fetchTeamsOverviewMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("own competence sharing: direct account switch (A -> B, no sign-out in between)", () => {
  it("does not keep account A's team list visible while account B's read is pending", async () => {
    fetchTeamsOverviewMock.mockImplementation((token: string) =>
      token === "token-a" ? Promise.resolve({ status: "ok", teams: [team("t1", "Konto A-team")] }) : new Promise(() => {}),
    );
    render(<OwnCompetenceSharing />);
    expect(await screen.findByRole("button", { name: /Konto A-team/ })).toBeTruthy();

    setIdentity("token-b");

    expect(screen.queryByRole("button", { name: /Konto A-team/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("ignores a late team list from account A and shows only account B's teams", async () => {
    const lateA = deferred<{ status: "ok"; teams: ReturnType<typeof team>[] }>();
    const b = deferred<{ status: "ok"; teams: ReturnType<typeof team>[] }>();
    fetchTeamsOverviewMock.mockImplementation((token: string) => (token === "token-a" ? lateA.promise : b.promise));
    render(<OwnCompetenceSharing />);

    setIdentity("token-b");
    b.resolve({ status: "ok", teams: [team("t2", "Konto B-team")] });
    expect(await screen.findByRole("button", { name: /Konto B-team/ })).toBeTruthy();

    lateA.resolve({ status: "ok", teams: [team("t1", "Konto A-team")] });
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /Konto A-team/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Konto B-team/ })).toBeTruthy();
  });

  it("ignores a late failure from account A after the switch and shows no error for account B", async () => {
    const lateA = deferred<{ status: "read_failed" }>();
    fetchTeamsOverviewMock.mockImplementation((token: string) =>
      token === "token-a" ? lateA.promise : Promise.resolve({ status: "ok", teams: [team("t2", "Konto B-team")] }),
    );
    render(<OwnCompetenceSharing />);

    setIdentity("token-b");
    expect(await screen.findByRole("button", { name: /Konto B-team/ })).toBeTruthy();

    lateA.resolve({ status: "read_failed" });
    await act(async () => {});

    expect(screen.queryByText(/kunne ikke lastes/)).toBeNull();
    expect(screen.getByRole("button", { name: /Konto B-team/ })).toBeTruthy();
  });
});

describe("own competence sharing: token refresh (same account, new token string)", () => {
  it("re-reads and shows the same account teams after a refresh, instead of staying in the loading state", async () => {
    fetchTeamsOverviewMock.mockImplementation((token: string) =>
      token === "token-a" || token === "token-a-refreshed" ? Promise.resolve({ status: "ok", teams: [team("t1", "Konto A-team")] }) : new Promise(() => {}),
    );
    render(<OwnCompetenceSharing />);
    expect(await screen.findByRole("button", { name: /Konto A-team/ })).toBeTruthy();

    setIdentity("token-a-refreshed");

    expect(fetchTeamsOverviewMock).toHaveBeenCalledWith("token-a-refreshed");
    expect(await screen.findByRole("button", { name: /Konto A-team/ })).toBeTruthy();
  });
});
