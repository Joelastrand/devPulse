// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hook = vi.hoisted(() => ({
  state: null as unknown,
}));
const reload = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());

vi.mock("../client/use-collaborative-team-data", () => ({
  useCollaborativeTeamData: () => hook.state,
}));
vi.mock("../client/collaborative-gateway", () => ({
  saveCollaborativeMode: save,
}));

const { TeamSettingsCompetenceProfile } = await import("./TeamSettingsCompetenceProfile");

function loaded(canEdit: boolean, mode: "automatic" | "collaborative" = "automatic") {
  return {
    phase: "signed_in",
    token: "tok",
    reload,
    current: {
      key: "k1",
      profile: { status: "ok", mode, levels: [] },
      areas: { status: "ok", areas: [], canEdit, truncated: false },
    },
  };
}

beforeEach(() => {
  reload.mockClear();
  save.mockReset();
});

afterEach(cleanup);

describe("TeamSettingsCompetenceProfile", () => {
  it("lets a teamadmin switch to collaborative mode and save it", async () => {
    hook.state = loaded(true);
    save.mockResolvedValue({ status: "ok" });
    render(<TeamSettingsCompetenceProfile teamId="team-1" />);

    const collaborative = screen.getByRole("radio", { name: /Felles kompetanseprofil/ }) as HTMLInputElement;
    expect(collaborative.disabled).toBe(false);
    fireEvent.click(collaborative);
    fireEvent.click(screen.getByRole("button", { name: "Lagre modus" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("tok", "team-1", "collaborative"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("shows the stored mode to a member as read-only, with no save control and no request", () => {
    hook.state = loaded(false, "collaborative");
    render(<TeamSettingsCompetenceProfile teamId="team-1" />);

    const collaborative = screen.getByRole("radio", { name: /Felles kompetanseprofil/ }) as HTMLInputElement;
    expect(collaborative.checked).toBe(true);
    expect(collaborative.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Lagre modus" })).toBeNull();
    expect(screen.getByText("Bare teamadmin kan endre modus.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the previous mode visible and explains the refusal when a save is refused", async () => {
    hook.state = loaded(true);
    save.mockResolvedValue({ status: "forbidden" });
    render(<TeamSettingsCompetenceProfile teamId="team-1" />);

    fireEvent.click(screen.getByRole("radio", { name: /Felles kompetanseprofil/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lagre modus" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Bare teamadmin kan endre modus.", { selector: "[role=alert]" })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("states that the mode does not change any member's sharing", () => {
    hook.state = loaded(true);
    render(<TeamSettingsCompetenceProfile teamId="team-1" />);
    expect(screen.getByText("Endring av modus endrer ikke noen medlems deling.")).toBeTruthy();
  });
});
