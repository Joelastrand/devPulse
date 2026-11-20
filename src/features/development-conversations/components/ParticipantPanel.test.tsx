// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { conversationsCopy } from "../copy";

const updateConversationMock = vi.fn();

// Only the write is mocked. A colleague picker call would fail, because no team list exists in this gateway (A2.1).
vi.mock("../client/conversations-gateway", () => ({
  fetchInvitableColleagues: async () => ({ status: "ok", response: { colleagues: [], truncated: false } }),
  updateConversation: updateConversationMock,
}));

const { ParticipantPanel } = await import("./ParticipantPanel");

type PanelProps = Parameters<typeof ParticipantPanel>[0];

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    conversationId: "conv-synthetic-1",
    token: "a-token",
    completed: false,
    participant: { state: "none", displayName: null },
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ParticipantPanel {...props} />);
  return props;
}

beforeEach(() => {
  updateConversationMock.mockReset();
  updateConversationMock.mockResolvedValue({ status: "saved" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ParticipantPanel without a participant (A2.1)", () => {
  it("offers the colleague picker without a participant, and no removal control", async () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: conversationsCopy.colleaguePickerHeading })).toBeTruthy();
    expect(await screen.findByText(conversationsCopy.colleagueListEmpty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: conversationsCopy.removeButton })).toBeNull();
  });
});

describe("ParticipantPanel with a bound participant", () => {
  it("shows the participant's name and offers removal only after the owner confirms", async () => {
    const props = renderPanel({ participant: { state: "accepted", displayName: "Synthetic colleague" } });
    expect(screen.getByText(/Synthetic colleague/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    expect(updateConversationMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.confirmRemove }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock.mock.calls[0]).toContainEqual({ participantMemberRef: null });
  });

  it("uses the pending wording for a pending invitation, and cancel sends nothing", async () => {
    renderPanel({ participant: { state: "pending", displayName: null } });

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    expect(screen.getByText(conversationsCopy.removePendingWarning)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.cancelButton }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("offers no participant control once the conversation is completed", () => {
    renderPanel({ completed: true, participant: { state: "accepted", displayName: null } });

    expect(screen.queryByRole("button", { name: conversationsCopy.removeButton })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
