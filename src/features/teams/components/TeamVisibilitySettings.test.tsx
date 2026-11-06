// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamVisibilitySettings } from "./TeamVisibilitySettings";
import { visibilityCopy } from "../visibility-copy";

const fetchTeamVisibility = vi.fn();
const saveTeamVisibility = vi.fn();

vi.mock("../client/team-visibility-gateway", () => ({
  fetchTeamVisibility: (...args: unknown[]) => fetchTeamVisibility(...args),
  saveTeamVisibility: (...args: unknown[]) => saveTeamVisibility(...args),
  fetchPublicTeam: vi.fn(),
}));

beforeEach(() => {
  fetchTeamVisibility.mockReset();
  saveTeamVisibility.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TeamVisibilitySettings", () => {
  it("shows a read-only status to a caller the server reports cannot administer the team", async () => {
    fetchTeamVisibility.mockResolvedValue({ status: "ok", visibility: "private", canAdminister: false });
    render(<TeamVisibilitySettings teamId="team-1" token="tok" />);

    expect(await screen.findByText(visibilityCopy.statusPrivate)).toBeTruthy();
    expect(screen.getByText(visibilityCopy.readOnlyNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: visibilityCopy.makePublicButton })).toBeNull();
  });

  it("asks for confirmation before making a team public, and saves only after confirming", async () => {
    fetchTeamVisibility.mockResolvedValue({ status: "ok", visibility: "private", canAdminister: true });
    saveTeamVisibility.mockResolvedValue({ status: "ok", visibility: "public", changed: true });
    const user = userEvent.setup();
    render(<TeamVisibilitySettings teamId="team-1" token="tok" />);

    await user.click(await screen.findByRole("button", { name: visibilityCopy.makePublicButton }));
    expect(saveTeamVisibility).not.toHaveBeenCalled();
    expect(screen.getByText(visibilityCopy.confirmPublicBody)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: visibilityCopy.confirmPublicButton }));
    await waitFor(() => expect(saveTeamVisibility).toHaveBeenCalledWith("tok", "team-1", "public"));
    expect(await screen.findByText(visibilityCopy.savedPublic)).toBeTruthy();
  });

  it("cancelling the confirmation keeps the team private with no write", async () => {
    fetchTeamVisibility.mockResolvedValue({ status: "ok", visibility: "private", canAdminister: true });
    const user = userEvent.setup();
    render(<TeamVisibilitySettings teamId="team-1" token="tok" />);

    await user.click(await screen.findByRole("button", { name: visibilityCopy.makePublicButton }));
    await user.click(screen.getByRole("button", { name: visibilityCopy.cancelButton }));

    expect(saveTeamVisibility).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: visibilityCopy.makePublicButton })).toBeTruthy();
  });

  it("shows a controlled error when the server refuses a disabled team, without changing the status", async () => {
    fetchTeamVisibility.mockResolvedValue({ status: "ok", visibility: "private", canAdminister: true });
    saveTeamVisibility.mockResolvedValue({ status: "team_disabled" });
    const user = userEvent.setup();
    render(<TeamVisibilitySettings teamId="team-1" token="tok" />);

    await user.click(await screen.findByRole("button", { name: visibilityCopy.makePublicButton }));
    await user.click(screen.getByRole("button", { name: visibilityCopy.confirmPublicButton }));

    expect(await screen.findByText(visibilityCopy.errorTeamDisabled)).toBeTruthy();
    expect(screen.getByText(visibilityCopy.statusPrivate)).toBeTruthy();
  });
});
