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

const { OwnCompetenceSharing } = await import("./OwnCompetenceSharing");

const LOADING = "Laster delingsvalgene dine…";

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

describe("own competence sharing: loading and sign-out", () => {
  it("announces the pending read once and keeps the placeholder decorative", () => {
    fetchTeamsOverviewMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<OwnCompetenceSharing />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(LOADING);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
  });

  it("shows a sign-in message, not the loading placeholder, after sign-out", async () => {
    fetchTeamsOverviewMock.mockReturnValue(new Promise(() => {}));
    render(<OwnCompetenceSharing />);

    setIdentity(null);

    expect(await screen.findByText("Logg inn for å se delingsvalgene dine.")).toBeTruthy();
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not show the previous account's team list after sign-out", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "t1", name: "Konto A-team", isMember: true, canOpen: true, relationship: "member" }],
    });
    render(<OwnCompetenceSharing />);
    expect(await screen.findByText(/Konto A-team/)).toBeTruthy();

    setIdentity(null);

    expect(await screen.findByText("Logg inn for å se delingsvalgene dine.")).toBeTruthy();
    expect(screen.queryByText(/Konto A-team/)).toBeNull();
  });
});
