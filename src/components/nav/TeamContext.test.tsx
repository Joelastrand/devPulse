// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useAnnounceTeamName, TeamContextProvider } from "./TeamContext";

const observeIdTokenMock = vi.fn();
let mockPathname = "/teams/team-1";

vi.mock("../../features/auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
  signOut: vi.fn(),
}));
vi.mock("../../features/teams/client/own-admin-status-gateway", () => ({
  fetchOwnAdminStatus: vi.fn(async () => ({ ok: true, isAdmin: false })),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

const { AppShell } = await import("./AppShell");

function Announcer({ name }: { name: string | null }) {
  useAnnounceTeamName(name);
  return null;
}

function renderShell(name: string | null) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  return render(
    <TeamContextProvider>
      <AppShell>
        <Announcer name={name} />
        <p>Innhold</p>
      </AppShell>
    </TeamContextProvider>,
  );
}

describe("team context in the shell", () => {
  afterEach(() => {
    cleanup();
    mockPathname = "/";
  });

  it("shows the announced team name as context in the signed-in navigation", async () => {
    renderShell("Team Alfa");

    expect(await screen.findByText("Team Alfa")).toBeTruthy();
  });

  it("shows no team context when no team name has been announced", async () => {
    renderShell(null);

    await waitFor(() => expect(screen.getByRole("link", { name: /ferdigheter/i })).toBeTruthy());
    expect(screen.queryByText("Team Alfa")).toBeNull();
  });

  it("clears the team context when the announcing page unmounts", async () => {
    const { rerender } = renderShell("Team Alfa");
    await screen.findByText("Team Alfa");

    rerender(
      <TeamContextProvider>
        <AppShell>
          <p>Innhold</p>
        </AppShell>
      </TeamContextProvider>,
    );

    await waitFor(() => expect(screen.queryByText("Team Alfa")).toBeNull());
  });
});
