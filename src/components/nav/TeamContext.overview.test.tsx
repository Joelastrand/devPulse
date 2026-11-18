// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { teamsCopy } from "../../features/teams/copy";

// Controllable stand-in for the Firebase auth observer: each subscriber receives the current token on subscribe, as the
// real observer does, and every later `emitToken` reaches all live subscribers.
type TokenCallback = (token: string | null) => void;
let currentToken: string | null = "token-A";
let subscribers = new Set<TokenCallback>();

function emitToken(token: string | null) {
  currentToken = token;
  for (const callback of [...subscribers]) callback(token);
}

vi.mock("../../features/auth/client/auth-client", () => ({
  observeIdToken: (callback: TokenCallback) => {
    subscribers.add(callback);
    callback(currentToken);
    return () => {
      subscribers.delete(callback);
    };
  },
  signOut: vi.fn(),
}));

const fetchTeamsOverviewMock = vi.fn();
vi.mock("../../features/teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: (token: string) => fetchTeamsOverviewMock(token),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/team-1/competence",
}));

const { TeamContextProvider } = await import("./TeamContext");
const { TeamPageHeader } = await import("../../features/teams/components/TeamPageHeader");

function overviewNamed(name: string) {
  return { status: "ok", teams: [{ teamId: "team-1", name, relationship: "member", isMember: true, canOpen: true }] };
}

// One provider for the whole signed-in shell, as in `app/(app)/layout.tsx`. Navigation toggles the page header inside it.
function Shell({ showHeader, children }: { showHeader: boolean; children?: React.ReactNode }) {
  return <TeamContextProvider>{showHeader ? <TeamPageHeader teamId="team-1" /> : null}{children}</TeamContextProvider>;
}

describe("shared team overview read in the signed-in shell", () => {
  beforeEach(() => {
    currentToken = "token-A";
    subscribers = new Set();
    fetchTeamsOverviewMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("reads the overview once for the same session across team page navigations", async () => {
    fetchTeamsOverviewMock.mockResolvedValue(overviewNamed("Plattform"));

    const { rerender } = render(<Shell showHeader />);
    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();

    // A tab switch unmounts the page header and mounts it again inside the same shell; the session must not ask again.
    rerender(<Shell showHeader={false} />);
    rerender(<Shell showHeader />);
    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();

    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledWith("token-A");
  });

  it("shares one read between two headers mounted together", async () => {
    fetchTeamsOverviewMock.mockResolvedValue(overviewNamed("Plattform"));

    render(
      <TeamContextProvider>
        <TeamPageHeader teamId="team-1" />
        <TeamPageHeader teamId="team-1" />
      </TeamContextProvider>,
    );

    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1, name: "Plattform" })).toHaveLength(2));
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("never reuses one identity's overview after an account switch", async () => {
    fetchTeamsOverviewMock.mockImplementation(async (token: string) =>
      overviewNamed(token === "token-A" ? "Alfa-teamet" : "Beta-teamet"),
    );

    const { rerender } = render(<Shell showHeader />);
    expect(await screen.findByRole("heading", { level: 1, name: "Alfa-teamet" })).toBeTruthy();

    emitToken("token-B");
    rerender(<Shell showHeader={false} />);
    rerender(<Shell showHeader />);

    expect(await screen.findByRole("heading", { level: 1, name: "Beta-teamet" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Alfa-teamet" })).toBeNull();
    expect(fetchTeamsOverviewMock).toHaveBeenLastCalledWith("token-B");
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2);
  });

  it("clears the shared read on sign-out, so the next signed-in read is fresh", async () => {
    fetchTeamsOverviewMock.mockResolvedValue(overviewNamed("Plattform"));

    const { rerender } = render(<Shell showHeader />);
    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();

    emitToken(null);
    rerender(<Shell showHeader={false} />);
    emitToken("token-A");
    rerender(<Shell showHeader />);

    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed read: the next mount asks again and falls back meanwhile", async () => {
    fetchTeamsOverviewMock
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce(overviewNamed("Plattform"));

    const { rerender } = render(<Shell showHeader />);
    expect(await screen.findByRole("heading", { level: 1, name: teamsCopy.detail.fallbackName })).toBeTruthy();
    rerender(<Shell showHeader={false} />);

    rerender(<Shell showHeader />);

    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2);
  });

  it("makes no overview read when the page already supplies the team name", async () => {
    render(
      <TeamContextProvider>
        <TeamPageHeader teamId="team-1" name="Plattform" />
      </TeamContextProvider>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
  });

  it("makes no overview read while signed out", async () => {
    currentToken = null;

    render(<Shell showHeader />);

    expect(screen.getByRole("heading", { level: 1, name: teamsCopy.detail.fallbackName })).toBeTruthy();
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
  });
});
