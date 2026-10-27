// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ParticipantConversationWire, SharedGoalWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";

const saveParticipantNotesMock = vi.fn();
const fetchOwnGoalsMock = vi.fn();
const fetchSelectableMembersMock = vi.fn();
const fetchConversationMock = vi.fn();
const updateConversationMock = vi.fn();

vi.mock("../client/conversations-gateway", () => ({
  saveParticipantNotes: saveParticipantNotesMock,
  fetchOwnGoals: fetchOwnGoalsMock,
  fetchSelectableMembers: fetchSelectableMembersMock,
  fetchConversation: fetchConversationMock,
  updateConversation: updateConversationMock,
}));

const { ParticipantConversation } = await import("./ParticipantConversation");

// Synthetic data only. Every value is fictional.
const CONVERSATION_ID = "conv-synthetic-7";
const ISO = "2026-10-01T10:00:00.000Z";

function conversation(overrides: Partial<ParticipantConversationWire> = {}): ParticipantConversationWire {
  return {
    conversationId: CONVERSATION_ID,
    title: "Kodegjennomgang (syntetisk)",
    status: "open",
    plannedFor: "2026-11-02",
    teamName: "Plattform (syntetisk)",
    ownerDisplayName: "Kari Testperson",
    ownerNotes: "Eierens notat om gjennomgangen",
    nextSteps: ["Les kapittel to"],
    participantNotes: "Mine egne ord",
    sharedGoals: [
      { goalTitle: "Lær Rust (syntetisk)", areaName: "Programmering", targetDate: "2026-12-01", status: "active", capturedAt: ISO },
      { goalTitle: "Gammelt mål (syntetisk)", areaName: null, targetDate: null, status: "completed", capturedAt: ISO } as SharedGoalWire,
    ],
    createdAt: ISO,
    updatedAt: ISO,
    completedAt: null,
    ...overrides,
  };
}

interface Props {
  conversation?: ParticipantConversationWire;
  notice?: string;
  refreshFailed?: boolean;
  onLeave?: () => Promise<void>;
  onChanged?: () => Promise<void>;
  onUnauthenticated?: () => void;
}

function renderView(props: Props = {}) {
  const onChanged = props.onChanged ?? vi.fn().mockResolvedValue(undefined);
  const onLeave = props.onLeave ?? vi.fn().mockResolvedValue(undefined);
  const onUnauthenticated = props.onUnauthenticated ?? vi.fn();
  return {
    onChanged,
    onLeave,
    ...render(
      <ParticipantConversation
        conversation={props.conversation ?? conversation()}
        token="a-token"
        notice={props.notice}
        refreshFailed={props.refreshFailed ?? false}
        onLeave={onLeave}
        onChanged={onChanged}
        onUnauthenticated={onUnauthenticated}
      />,
    ),
  };
}

beforeEach(() => {
  saveParticipantNotesMock.mockReset();
  fetchOwnGoalsMock.mockReset();
  fetchSelectableMembersMock.mockReset();
  fetchConversationMock.mockReset();
  updateConversationMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ParticipantConversation: shared content is read-only and labelled", () => {
  it("renders every shared section with its heading: title, date, owner notes, next steps, goals, own notes", () => {
    renderView();
    for (const heading of [
      conversationsCopy.titleSection,
      conversationsCopy.plannedForSection,
      conversationsCopy.ownerNotesSection,
      conversationsCopy.nextStepsSection,
      conversationsCopy.sharedGoalsSection,
      conversationsCopy.participantOwnNotesSection,
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeTruthy();
    }
    expect(screen.getByText("Kodegjennomgang (syntetisk)")).toBeTruthy();
    expect(screen.getByText("Eierens notat om gjennomgangen")).toBeTruthy();
    expect(screen.getByText("Les kapittel to")).toBeTruthy();
  });

  it("states that the owner's content is current and may change, and that the owner's notes are the owner's", () => {
    renderView();
    expect(screen.getByText(conversationsCopy.ownerContentNote)).toBeTruthy();
  });

  it("labels the owner with the approved roster-level name, and falls back to the neutral name", () => {
    const { unmount } = renderView();
    expect(screen.getByText("Kari Testperson")).toBeTruthy();
    unmount();
    renderView({ conversation: conversation({ ownerDisplayName: null }) });
    expect(screen.getByText(conversationsCopy.anonymousColleague)).toBeTruthy();
  });

  it("shows owner content as text, with no owner-content input anywhere", () => {
    renderView();
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0]?.getAttribute("id")).toBe("participant-notes");
  });

  it("shows each snapshot goal with its area name, its status label, and the snapshot copy", () => {
    renderView();
    expect(screen.getByText("Lær Rust (syntetisk)")).toBeTruthy();
    expect(screen.getByText("Programmering")).toBeTruthy();
    expect(screen.getByText(conversationsCopy.areaUnavailable)).toBeTruthy();
    expect(screen.getByText(conversationsCopy.participantSharedGoalsNote)).toBeTruthy();
  });

  it("reads no owner goal list and no selector list, and makes no request of its own", () => {
    renderView();
    expect(fetchOwnGoalsMock).not.toHaveBeenCalled();
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
    expect(fetchConversationMock).not.toHaveBeenCalled();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("renders no hidden identifier, no team id, no raw conversation id and no timestamp", () => {
    const { container } = renderView();
    const html = container.innerHTML;
    expect(html).not.toContain(CONVERSATION_ID);
    expect(html).not.toMatch(/memberRef|participantMemberRef|uid|email|membership|ownerUid|participantUid|teamId|capturedAt|createdAt|updatedAt|2026-10-01T10/i);
  });
});

describe("ParticipantConversation: the participant's own notes", () => {
  it("states that the notes are visible to the owner and deleted when the participant leaves", () => {
    renderView();
    expect(screen.getByText(conversationsCopy.participantNotesVisibility)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel })).toBeTruthy();
  });

  it("prefills the editor with the stored notes", () => {
    renderView();
    expect((screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel }) as HTMLTextAreaElement).value).toBe("Mine egne ord");
  });

  it("saves only participantNotes, once, with the exact body", async () => {
    saveParticipantNotesMock.mockResolvedValue({ status: "saved" });
    const { onChanged } = renderView();
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel });
    await user.clear(field);
    await user.type(field, "Nytt notat");
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1));
    expect(saveParticipantNotesMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { notes: "Nytt notat" });
    expect(await screen.findByText(conversationsCopy.saved)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("an empty notes field clears the notes: the body is an empty string", async () => {
    saveParticipantNotesMock.mockResolvedValue({ status: "saved" });
    renderView();
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1));
    expect(saveParticipantNotesMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { notes: "" });
  });

  it("accepts exactly 4096 UTF-8 bytes and refuses one more, on the client, with no request", async () => {
    saveParticipantNotesMock.mockResolvedValue({ status: "saved" });
    renderView();
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel });
    await user.clear(field);
    fireEvent.change(field, { target: { value: "x".repeat(4097) } });
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    expect(await screen.findByText(conversationsCopy.notesInvalid)).toBeTruthy();
    expect(saveParticipantNotesMock).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "x".repeat(4096) } });
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1));
  });

  it("two notes submits in the same tick send one request", () => {
    saveParticipantNotesMock.mockReturnValue(new Promise(() => {}));
    renderView();
    const form = screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous save shows the neutral copy, re-reads once, and is not retried", async () => {
    saveParticipantNotesMock.mockResolvedValue({ status: "error", error: "read_failed" });
    const { onChanged } = renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    expect(await screen.findByText(conversationsCopy.writeAmbiguous)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(conversationsCopy.saved)).toBeNull();
  });

  it("a signed-out response clears the view through the page, and shows no notes feedback", async () => {
    saveParticipantNotesMock.mockResolvedValue({ status: "unauthenticated" });
    const onUnauthenticated = vi.fn();
    render(
      <ParticipantConversation
        conversation={conversation()}
        token="a-token"
        refreshFailed={false}
        onLeave={vi.fn()}
        onChanged={vi.fn()}
        onUnauthenticated={onUnauthenticated}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(conversationsCopy.writeAmbiguous)).toBeNull();
  });

  it("a failed refresh after a save keeps the view and the draft, with a neutral message", () => {
    renderView({ refreshFailed: true });
    expect(screen.getByText(conversationsCopy.refreshFailed)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel }) as HTMLTextAreaElement).value).toBe("Mine egne ord");
  });
});

describe("ParticipantConversation: leaving", () => {
  it("opens a confirmation that states the deletion before anything is sent", async () => {
    const { onLeave } = renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: conversationsCopy.leaveButton }));
    const group = screen.getByRole("group", { name: conversationsCopy.leaveConfirmHeading });
    expect(within(group).getByText(conversationsCopy.leaveConfirmCopy)).toBeTruthy();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("cancel sends nothing, and returns focus to the leave control", async () => {
    const { onLeave } = renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: conversationsCopy.leaveButton }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.cancelButton }));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.leaveConfirmHeading })).toBeNull();
    expect(document.activeElement?.textContent).toBe(conversationsCopy.leaveButton);
  });

  it("confirming leave calls the page once, and two confirm submits in the same tick send one request", async () => {
    const onLeave = vi.fn(() => new Promise<void>(() => {}));
    renderView({ onLeave });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: conversationsCopy.leaveButton }));
    const form = screen.getByRole("group", { name: conversationsCopy.leaveConfirmHeading });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("leave stays available while the conversation is completed", () => {
    renderView({ conversation: conversation({ status: "completed", completedAt: ISO }) });
    expect(screen.getByRole("button", { name: conversationsCopy.leaveButton })).toBeTruthy();
  });
});

describe("ParticipantConversation: completed", () => {
  it("is read-only: no notes editor, the completion copy, and the content still readable", () => {
    renderView({ conversation: conversation({ status: "completed", completedAt: ISO }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: conversationsCopy.saveNotes })).toBeNull();
    expect(screen.getByText(conversationsCopy.participantCompleted)).toBeTruthy();
    expect(screen.getByText("Eierens notat om gjennomgangen")).toBeTruthy();
    expect(screen.getByText("Mine egne ord")).toBeTruthy();
  });
});

describe("ParticipantConversation: copy and notices", () => {
  it("shows the page's notice as a status message, and the participant visibility copy", () => {
    renderView({ notice: conversationsCopy.acceptedNotice });
    expect(screen.getByText(conversationsCopy.acceptedNotice).getAttribute("role")).toBe("status");
    expect(screen.getByText(conversationsCopy.participantPrivacy)).toBeTruthy();
  });

  it("uses no forbidden term and no evaluation framing", () => {
    const { container } = renderView();
    expect(container.textContent ?? "").not.toMatch(/score|rating|rangering|vurdering|prestasjon|ytelse|på sporet|avlys|skjult|privat notat/i);
  });
});
