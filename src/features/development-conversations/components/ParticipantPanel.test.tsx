// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { conversationsCopy } from "../copy";

const fetchSelectableMembersMock = vi.fn();
const updateConversationMock = vi.fn();

vi.mock("../client/conversations-gateway", () => ({
  fetchSelectableMembers: fetchSelectableMembersMock,
  updateConversation: updateConversationMock,
}));

const { ParticipantPanel } = await import("./ParticipantPanel");

type PanelProps = Parameters<typeof ParticipantPanel>[0];

/** Synthetic teammates only. The refs are obviously fictional and are checked to stay out of the DOM. */
const kari = { memberRef: "ref-synthetic-kari", displayName: "Kari Testperson", ordinal: null, isSelf: false };
const olaFirst = { memberRef: "ref-synthetic-ola-a", displayName: "Ola Testperson", ordinal: 1, isSelf: false };
const olaSecond = { memberRef: "ref-synthetic-ola-b", displayName: "Ola Testperson", ordinal: 2, isSelf: false };
const self = { memberRef: "ref-synthetic-self", displayName: "Deg Selv", ordinal: null, isSelf: true };
const unnamed = { memberRef: "ref-synthetic-unnamed", displayName: null, ordinal: null, isSelf: false };

function teamList(members = [kari, olaFirst, olaSecond, self, unnamed], truncated = false) {
  return { status: "ok", response: { members, truncated } };
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    conversationId: "conv-synthetic-1",
    token: "a-token",
    teamId: "team-synthetic-1",
    completed: false,
    participant: { state: "none", displayName: null },
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ParticipantPanel {...props} />);
  return props;
}

/** Waits until the team list has loaded, then returns the selector. */
async function selector(label: string = conversationsCopy.chooseColleague) {
  return (await screen.findByRole("combobox", { name: label })) as HTMLSelectElement;
}

beforeEach(() => {
  fetchSelectableMembersMock.mockReset();
  updateConversationMock.mockReset();
  fetchSelectableMembersMock.mockResolvedValue(teamList());
  updateConversationMock.mockResolvedValue({ status: "saved" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ParticipantPanel: owner eligibility refusal leaks no roster (SPEC Amendment 2026-10-19, TASK-029 I-1)", () => {
  it("reads the selector by conversation id only, never by team id", async () => {
    renderPanel();
    await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague });
    expect(fetchSelectableMembersMock).toHaveBeenCalledWith("a-token", "conv-synthetic-1");
  });

  it("an unavailable participant with a refused selector shows no teammate name and no empty-roster claim", async () => {
    fetchSelectableMembersMock.mockResolvedValue({ status: "error", error: "conversation_not_found" });
    const { container } = render(
      <ParticipantPanel {...defaultProps()} participant={{ state: "unavailable", displayName: "Synthetic Gone" }} />,
    );

    expect(await screen.findByText(conversationsCopy.colleagueOptionsError)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(container.innerHTML).not.toContain("Kari Testperson");
    expect(container.innerHTML).not.toContain("Ola Testperson");
    expect(container.innerHTML).not.toContain("ref-synthetic");
    expect(screen.queryByText(conversationsCopy.colleagueOptionsEmpty)).toBeNull();
  });

  it("a refused selector never renders as an empty roster, for any refusal code", async () => {
    for (const error of ["invalid_participant", "conversation_completed", "persistence_failed"] as const) {
      fetchSelectableMembersMock.mockResolvedValueOnce({ status: "error", error });
      const { unmount } = render(<ParticipantPanel {...defaultProps()} />);

      expect(await screen.findByText(conversationsCopy.colleagueOptionsError)).toBeTruthy();
      expect(screen.queryByText(conversationsCopy.colleagueOptionsEmpty)).toBeNull();
      unmount();
    }
  });

  it("the removal control stays available to the owner when the selector is refused", async () => {
    fetchSelectableMembersMock.mockResolvedValue({ status: "error", error: "conversation_not_found" });
    renderPanel({ participant: { state: "unavailable", displayName: "Synthetic Gone" } });

    await screen.findByText(conversationsCopy.colleagueOptionsError);
    expect(screen.getByRole("button", { name: conversationsCopy.removeButton })).toBeTruthy();
  });
});

describe("ParticipantPanel: choosing a teammate (SPEC BR-8, D2-SI-4)", () => {
  it("offers only the other members, with the ordinal and neutral name, and renders no memberRef", async () => {
    const { container } = render(<ParticipantPanel {...defaultProps()} />);
    const select = await selector();
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual([conversationsCopy.chooseColleague, "Kari Testperson", "Ola Testperson (1)", "Ola Testperson (2)", "En kollega"]);
    expect(container.innerHTML).not.toContain("ref-synthetic");
    expect(screen.queryByText("Deg Selv")).toBeNull();
  });

  it("states that members beyond the server's read bound cannot be selected", async () => {
    fetchSelectableMembersMock.mockResolvedValue(teamList([kari], true));
    render(<ParticipantPanel {...defaultProps()} />);
    await selector();
    expect(screen.getByText(conversationsCopy.colleagueOptionsTruncated)).toBeTruthy();
  });

  it("keeps the no-team case explicit and reads no team list", () => {
    renderPanel({ teamId: null });
    expect(screen.getByText(conversationsCopy.noTeamForParticipant)).toBeTruthy();
    expect(screen.queryByRole("button", { name: conversationsCopy.inviteButton })).toBeNull();
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
  });

  it("a completed conversation offers no selector and reads no team list", () => {
    renderPanel({ completed: true });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: conversationsCopy.inviteButton })).toBeNull();
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
  });

  it("a team read that fails shows neutral copy and retries only when the owner asks", async () => {
    fetchSelectableMembersMock.mockResolvedValueOnce({ status: "error", error: "unknown" });
    renderPanel();
    expect(await screen.findByText(conversationsCopy.colleagueOptionsError)).toBeTruthy();
    expect(fetchSelectableMembersMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.retryButton }));
    await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague });
    expect(fetchSelectableMembersMock).toHaveBeenCalledTimes(2);
  });

  it("an unauthenticated team read signs the owner out of the panel", async () => {
    fetchSelectableMembersMock.mockResolvedValueOnce({ status: "unauthenticated" });
    const props = renderPanel();
    await vi.waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
  });
});

describe("ParticipantPanel: invitation (BR-10, BR-38)", () => {
  it("does not send an invitation from the selector: the owner must confirm the pre-invitation copy first", async () => {
    renderPanel();
    fireEvent.change(await selector(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));

    expect(updateConversationMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
    for (const line of conversationsCopy.inviteCopy) expect(within(confirm).getByText(line)).toBeTruthy();
    expect(within(confirm).getByText(conversationsCopy.inviteTargetLine("Kari Testperson"))).toBeTruthy();
  });

  it("sends one invitation with only the opaque ref, then re-reads once", async () => {
    const props = renderPanel();
    fireEvent.change(await selector(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.confirmInvite }));

    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", "conv-synthetic-1", { participantMemberRef: "ref-synthetic-kari" });
    expect(await screen.findByText(conversationsCopy.inviteSent)).toBeTruthy();
  });

  it("two submits of the confirmation in one tick send one request", async () => {
    renderPanel();
    fireEvent.change(await selector(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    const confirm = screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
    fireEvent.submit(confirm);
    fireEvent.submit(confirm);
    await vi.waitFor(() => expect(updateConversationMock).toHaveBeenCalled());
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("cancel closes the confirmation and sends nothing", async () => {
    renderPanel();
    fireEvent.change(await selector(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.cancelButton }));
    expect(screen.queryByRole("group", { name: conversationsCopy.inviteConfirmHeading })).toBeNull();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("does not offer the invitation before the owner has picked a teammate", async () => {
    renderPanel();
    await selector();
    expect((screen.getByRole("button", { name: conversationsCopy.inviteButton }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows no accept or decline control: those belong to the participant view", async () => {
    renderPanel({ participant: { state: "pending", displayName: "Kari Testperson" } });
    await selector(conversationsCopy.chooseReplacement);
    expect(screen.queryByRole("button", { name: "Godta invitasjon" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Avslå" })).toBeNull();
  });
});

describe("ParticipantPanel: states and labels (BR-18, CL-21)", () => {
  it("shows each participant state as text with its name, and the unavailable copy keeps the notes visible", () => {
    renderPanel({ participant: { state: "unavailable", displayName: null } });
    expect(screen.getByText(conversationsCopy.participantStateLabel.unavailable, { exact: false })).toBeTruthy();
    expect(screen.getByText(conversationsCopy.participantStateNote.unavailable)).toBeTruthy();
    expect(screen.getByRole("button", { name: conversationsCopy.removeButton })).toBeTruthy();
  });

  it("names an accepted participant by display name, using the neutral name when there is none", () => {
    renderPanel({ participant: { state: "accepted", displayName: null } });
    expect(screen.getByText(`${conversationsCopy.participantStateLabel.accepted}: ${conversationsCopy.colleagueUnnamed}`)).toBeTruthy();
  });

  it("with no participant, offers no remove control", async () => {
    renderPanel();
    await selector();
    expect(screen.queryByRole("button", { name: conversationsCopy.removeButton })).toBeNull();
  });
});

describe("ParticipantPanel: replacement (BR-16)", () => {
  it("replacing an existing participant states that their notes are deleted, and sends the new ref", async () => {
    const props = renderPanel({ participant: { state: "accepted", displayName: "Kari Testperson" } });
    fireEvent.change(await selector(conversationsCopy.chooseReplacement), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.replaceButton }));

    const confirm = screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
    expect(within(confirm).getByText(conversationsCopy.replaceWarning)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: conversationsCopy.confirmReplace }));

    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", "conv-synthetic-1", { participantMemberRef: "ref-synthetic-ola-a" });
    expect(await screen.findByText(conversationsCopy.replaceSent)).toBeTruthy();
  });

  it("replacing a pending invitation says the invitation is withdrawn, not that notes are deleted", async () => {
    renderPanel({ participant: { state: "pending", displayName: "Kari Testperson" } });
    fireEvent.change(await selector(conversationsCopy.chooseReplacement), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.replaceButton }));
    const confirm = screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
    expect(within(confirm).getByText(conversationsCopy.replacePendingWarning)).toBeTruthy();
    expect(within(confirm).queryByText(conversationsCopy.replaceWarning)).toBeNull();
  });

  it("a completed conversation offers no replacement, though it still offers removal", async () => {
    renderPanel({ completed: true, participant: { state: "accepted", displayName: "Kari Testperson" } });
    expect(screen.queryByRole("button", { name: conversationsCopy.replaceButton })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: conversationsCopy.removeButton })).toBeTruthy();
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
  });
});

describe("ParticipantPanel: removal (BR-16, CL-21)", () => {
  it("a pending invitation's removal says the invitation is withdrawn, and sends an explicit null", async () => {
    const props = renderPanel({ participant: { state: "pending", displayName: "Kari Testperson" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    const confirm = screen.getByRole("group", { name: conversationsCopy.removePendingWarning });
    expect(within(confirm).getByText(conversationsCopy.removePendingWarning)).toBeTruthy();

    fireEvent.click(within(confirm).getByRole("button", { name: conversationsCopy.confirmRemove }));
    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", "conv-synthetic-1", { participantMemberRef: null });
    expect(await screen.findByText(conversationsCopy.participantRemoved)).toBeTruthy();
  });

  it("an accepted participant's removal says the notes are deleted before the owner confirms", () => {
    renderPanel({ participant: { state: "accepted", displayName: "Kari Testperson" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    expect(screen.getByText(conversationsCopy.removeActiveWarning)).toBeTruthy();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("removal stays available after completion", () => {
    renderPanel({ completed: true, participant: { state: "accepted", displayName: "Kari Testperson" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    expect(screen.getByText(conversationsCopy.removeActiveWarning)).toBeTruthy();
  });

  it("cancelling the removal sends nothing", () => {
    renderPanel({ participant: { state: "accepted", displayName: "Kari Testperson" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.cancelButton }));
    expect(updateConversationMock).not.toHaveBeenCalled();
  });
});

describe("ParticipantPanel: writes, ambiguity and refusals (SPEC Stable errors)", () => {
  it("a refused selection shows neutral copy, re-reads the conversation and the team list", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "error", error: "invalid_participant" });
    const props = renderPanel();
    fireEvent.change(await selector(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.confirmInvite }));

    expect(await screen.findByText(conversationsCopy.participantInvalid)).toBeTruthy();
    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    // The team list is read again after the refusal, so the owner chooses from the current members.
    await vi.waitFor(() => expect(fetchSelectableMembersMock).toHaveBeenCalledTimes(2));
  });

  it("an ambiguous outcome says the change could not be confirmed, re-reads once and never retries", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    const props = renderPanel();
    fireEvent.change(await selector(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.confirmInvite }));

    expect(await screen.findByText(conversationsCopy.writeAmbiguous)).toBeTruthy();
    await vi.waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("an unauthenticated write signs the owner out and claims no outcome", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "unauthenticated" });
    const props = renderPanel({ participant: { state: "accepted", displayName: "Kari Testperson" } });
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.confirmRemove }));
    await vi.waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(conversationsCopy.participantRemoved)).toBeNull();
  });
});

/** Props for the common case: a team, an open conversation and no participant. */
function defaultProps(): PanelProps {
  return {
    conversationId: "conv-synthetic-1",
    token: "a-token",
    teamId: "team-synthetic-1",
    completed: false,
    participant: { state: "none", displayName: null },
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
  };
}
