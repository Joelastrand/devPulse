// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conversationsCopy } from "../copy";
import type {
  FetchConversationResult,
  OwnerConversationWire,
  OwnGoalWire,
  ParticipantConversationWire,
  PendingInvitationWire,
  SharedGoalWire,
} from "../client/conversations-gateway";

const observeIdTokenMock = vi.fn();
const fetchConversationMock = vi.fn();
const updateConversationMock = vi.fn();
const fetchOwnGoalsMock = vi.fn();
const fetchSelectableMembersMock = vi.fn();
const acceptInvitationMock = vi.fn();
const endParticipationMock = vi.fn();
const saveParticipantNotesMock = vi.fn();
const deleteConversationMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));
vi.mock("../client/conversations-gateway", () => ({
  fetchConversation: fetchConversationMock,
  updateConversation: updateConversationMock,
  deleteConversation: deleteConversationMock,
  fetchOwnGoals: fetchOwnGoalsMock,
  fetchSelectableMembers: fetchSelectableMembersMock,
  acceptInvitation: acceptInvitationMock,
  endParticipation: endParticipationMock,
  saveParticipantNotes: saveParticipantNotesMock,
}));

const { ConversationDetail } = await import("./ConversationDetail");

const ISO = "2026-10-01T10:00:00.000Z";
const CONVERSATION_ID = "conv-1";

function owner(overrides: Partial<OwnerConversationWire> = {}): OwnerConversationWire {
  return {
    conversationId: CONVERSATION_ID,
    title: "Kommunikasjon i prosjekter",
    status: "open",
    plannedFor: "2026-11-02",
    teamId: "team-secret-1",
    participant: { state: "none", displayName: null },
    ownerNotes: "Mine notater",
    nextSteps: ["Les kapittel to"],
    participantNotes: "Deltakerens egne ord",
    sharedGoals: [],
    createdAt: ISO,
    updatedAt: ISO,
    completedAt: null,
    ...overrides,
  };
}

function ownerView(conversation: OwnerConversationWire): FetchConversationResult {
  return { status: "ok", view: { kind: "owner", conversation } } as FetchConversationResult;
}

function goal(overrides: Partial<OwnGoalWire> = {}): OwnGoalWire {
  return { id: "g1", title: "Lær Rust", status: "active", ...overrides };
}

const savedAck = { status: "saved" as const };

/** Signed in with the given detail reads in order. The goal list defaults to empty. */
function signedInWith(...reads: FetchConversationResult[]) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  for (const read of reads) fetchConversationMock.mockResolvedValueOnce(read);
  // Writes re-read the conversation. Unless a test queues another read, the last one answers again.
  fetchConversationMock.mockResolvedValue(reads[reads.length - 1]);
}

async function renderOwner(conversation: OwnerConversationWire = owner(), goals: OwnGoalWire[] = []) {
  fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals, truncated: false } });
  signedInWith(ownerView(conversation));
  render(<ConversationDetail conversationId={CONVERSATION_ID} />);
  await screen.findByRole("heading", { level: 2, name: conversationsCopy.titleSection });
}

beforeEach(() => {
  updateConversationMock.mockReset();
  fetchConversationMock.mockReset();
  fetchOwnGoalsMock.mockReset();
  fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [], truncated: false } });
  fetchSelectableMembersMock.mockReset();
  fetchSelectableMembersMock.mockResolvedValue({ status: "ok", response: { members: [], truncated: false } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationDetail: loading and load states", () => {
  it("shows the loading copy before the first read, then the owner editor", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchConversationMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(screen.getByText(conversationsCopy.detailLoading)).toBeTruthy();
    expect(fetchConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID);
  });

  it("signed out: shows a sign-in link and makes no detail request", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect((await screen.findByRole("link", { name: conversationsCopy.signInLink })).getAttribute("href")).toBe("/sign-in");
    expect(fetchConversationMock).not.toHaveBeenCalled();
  });

  it("not found and a read that returned 401 both show the same neutral copy, with no reason", async () => {
    signedInWith({ status: "error", error: "conversation_not_found" });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByText(conversationsCopy.detailNotFound)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("an operational read failure shows the load error with a retry that re-reads once", async () => {
    signedInWith({ status: "error", error: "persistence_failed" }, ownerView(owner()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByText(conversationsCopy.detailLoadError)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.detailNotFound)).toBeNull();
    fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [], truncated: false } });
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.retryButton }));
    expect(await screen.findByRole("heading", { level: 2, name: conversationsCopy.titleSection })).toBeTruthy();
    expect(fetchConversationMock).toHaveBeenCalledTimes(2);
  });

  it("the server's participant view renders the accepted participant page, and no owner editor", async () => {
    signedInWith(participantView(participant()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByRole("heading", { level: 2, name: conversationsCopy.ownerNotesSection })).toBeTruthy();
    expect(screen.getByText("Eierens notat")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: conversationsCopy.participantSection })).toBeNull();
    expect(screen.queryByRole("button", { name: conversationsCopy.inviteButton })).toBeNull();
  });

  it("the server's pending view renders the pending invitation, with no content from the owner", async () => {
    signedInWith({ status: "ok", view: { kind: "pending", invitation: pendingInvitation() } });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByRole("heading", { level: 2, name: conversationsCopy.pendingHeading })).toBeTruthy();
    expect(screen.queryByText("Veiledning hemmelig")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: conversationsCopy.titleSection })).toBeNull();
    expect(fetchOwnGoalsMock).not.toHaveBeenCalled();
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
  });
});

const ISO_NOW = "2026-10-01T10:00:00.000Z";

function participant(overrides: Partial<ParticipantConversationWire> = {}): ParticipantConversationWire {
  return {
    conversationId: CONVERSATION_ID,
    title: "Veiledning hemmelig",
    status: "open",
    plannedFor: null,
    teamName: "Plattform",
    ownerDisplayName: "Kari",
    ownerNotes: "Eierens notat",
    nextSteps: [],
    participantNotes: "",
    sharedGoals: [],
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    completedAt: null,
    ...overrides,
  };
}

function participantView(conversation: ParticipantConversationWire): FetchConversationResult {
  return { status: "ok", view: { kind: "participant", conversation } } as FetchConversationResult;
}

function pendingInvitation(overrides: Partial<PendingInvitationWire> = {}): PendingInvitationWire {
  return {
    conversationId: CONVERSATION_ID,
    state: "pending",
    teamName: "Plattform",
    invitedAt: ISO_NOW,
    ownerDisplayName: "Kari",
    ...overrides,
  };
}

const pendingView = (): FetchConversationResult => ({ status: "ok", view: { kind: "pending", invitation: pendingInvitation() } });

/** One participation response from the gateway. */
const confirmedEnd = { status: "ended" as const };
const confirmedAccept = { status: "accepted" as const };
const readFailed = { status: "error" as const, error: "read_failed" as const };

describe("ConversationDetail: participation through the detail page", () => {
  it("accept sends one request, then re-reads the detail and renders the participant view with the accepted notice", async () => {
    acceptInvitationMock.mockResolvedValue(confirmedAccept);
    signedInWith(pendingView(), participantView(participant()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByText(conversationsCopy.acceptedNotice)).toBeTruthy();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
    expect(acceptInvitationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID);
    expect(screen.getByRole("heading", { level: 2, name: conversationsCopy.ownerNotesSection })).toBeTruthy();
  });

  it("two accept clicks in the same tick send one accept request", async () => {
    acceptInvitationMock.mockReturnValue(new Promise(() => {}));
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const button = await screen.findByRole("button", { name: conversationsCopy.acceptButton });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous accept is never sent again: the detail is re-read once, and the accepted detail proves acceptance", async () => {
    acceptInvitationMock.mockResolvedValue(readFailed);
    signedInWith(pendingView(), participantView(participant()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByRole("heading", { level: 2, name: conversationsCopy.ownerNotesSection })).toBeTruthy();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationMock).toHaveBeenCalledTimes(2);
  });

  it("an ambiguous accept whose re-read is still pending keeps the pending view with the neutral notice", async () => {
    acceptInvitationMock.mockResolvedValue(readFailed);
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByText(conversationsCopy.acceptNotConfirmedPending)).toBeTruthy();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous accept with a failed re-read says it could not confirm, claims neither result, and does not re-send", async () => {
    acceptInvitationMock.mockResolvedValue(readFailed);
    signedInWith(pendingView(), { status: "error", error: "persistence_failed" });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByText(conversationsCopy.participationUnconfirmed)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.acceptedNotice)).toBeNull();
    expect(screen.queryByText(conversationsCopy.acceptNotConfirmedPending)).toBeNull();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
  });

  it("a confirmed accept whose re-read fails says the acceptance is confirmed but the page could not be loaded", async () => {
    acceptInvitationMock.mockResolvedValue(confirmedAccept);
    signedInWith(pendingView(), { status: "error", error: "persistence_failed" });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByText(conversationsCopy.acceptedUnread)).toBeTruthy();
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
  });

  it("an accept refused as not found shows the neutral not-found copy, with no re-read", async () => {
    acceptInvitationMock.mockResolvedValue({ status: "error", error: "conversation_not_found" });
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByText(conversationsCopy.detailNotFound)).toBeTruthy();
    expect(fetchConversationMock).toHaveBeenCalledTimes(1);
  });

  it("decline sends one request, makes no content read, and shows the ended notice", async () => {
    endParticipationMock.mockResolvedValue(confirmedEnd);
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.declineButton }));
    expect(await screen.findByText(conversationsCopy.declinedNotice)).toBeTruthy();
    expect(endParticipationMock).toHaveBeenCalledTimes(1);
    expect(endParticipationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID);
    expect(fetchConversationMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: conversationsCopy.acceptButton })).toBeNull();
  });

  it("an ambiguous decline is not repeated, and a pending re-read keeps the pending view with its neutral notice", async () => {
    endParticipationMock.mockResolvedValue(readFailed);
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.declineButton }));
    expect(await screen.findByText(conversationsCopy.declineNotConfirmedPending)).toBeTruthy();
    expect(endParticipationMock).toHaveBeenCalledTimes(1);
  });

  it("a participant notes save changes participantNotes only, then re-reads in place without losing the draft", async () => {
    saveParticipantNotesMock.mockResolvedValue({ status: "saved" });
    signedInWith(participantView(participant()), participantView(participant({ participantNotes: "Nytt" })));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const user = userEvent.setup();
    const field = await screen.findByRole("textbox", { name: conversationsCopy.participantNotesLabel });
    await user.clear(field);
    await user.type(field, "Nytt");
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1));
    expect(saveParticipantNotesMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { notes: "Nytt" });
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(await screen.findByText(conversationsCopy.saved)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel })).toBeTruthy();
  });

  it("a confirmed leave shows the left notice and sends no content read", async () => {
    endParticipationMock.mockResolvedValue(confirmedEnd);
    signedInWith(participantView(participant()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: conversationsCopy.leaveButton }));
    expect(endParticipationMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: conversationsCopy.confirmLeave }));
    expect(await screen.findByText(conversationsCopy.leftNotice)).toBeTruthy();
    expect(endParticipationMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous leave whose re-read still shows the participant says so, and is not repeated", async () => {
    endParticipationMock.mockResolvedValue(readFailed);
    signedInWith(participantView(participant()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: conversationsCopy.leaveButton }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.confirmLeave }));
    expect(await screen.findByText(conversationsCopy.participationStillActive)).toBeTruthy();
    expect(endParticipationMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous leave whose re-read is not found shows only the neutral not-found copy", async () => {
    endParticipationMock.mockResolvedValue(readFailed);
    signedInWith(participantView(participant()), { status: "error", error: "conversation_not_found" });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: conversationsCopy.leaveButton }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.confirmLeave }));
    expect(await screen.findByText(conversationsCopy.detailNotFound)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.leftNotice)).toBeNull();
  });

  it("a sign-out during a participation request clears the protected view", async () => {
    acceptInvitationMock.mockResolvedValue({ status: "unauthenticated" });
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    expect(await screen.findByRole("link", { name: conversationsCopy.signInLink })).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.pendingHeading)).toBeNull();
  });

  it("the owner view stays the owner editor for an owner, and a participant action never reaches it", async () => {
    await renderOwner();
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    expect(endParticipationMock).not.toHaveBeenCalled();
    expect(saveParticipantNotesMock).not.toHaveBeenCalled();
  });
});

describe("OwnerConversationEditor: sections and privacy copy", () => {
  it("renders every owner section with its visibility copy, and the participant notes read only", async () => {
    await renderOwner(owner({ participantNotes: "Deltakerens egne ord" }));
    expect(screen.getByRole("heading", { level: 2, name: conversationsCopy.notesSection })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: conversationsCopy.nextStepsSection })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: conversationsCopy.sharedGoalsSection })).toBeTruthy();
    expect(screen.getByText(conversationsCopy.detailPrivacy)).toBeTruthy();
    expect(screen.getByText(conversationsCopy.sharedGoalsVisibility)).toBeTruthy();
    // Title, date, notes and next steps are all shared after acceptance, so each one carries the visibility line.
    expect(screen.getAllByText(conversationsCopy.visibleToParticipant)).toHaveLength(4);
    expect(screen.getByText("Deltakerens egne ord")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /Deltakerens/ })).toBeNull();
  });

  it("never renders a hidden identifier, team id or raw link other than the conversation route", async () => {
    await renderOwner(
      owner({
        sharedGoals: [{ goalTitle: "Lær Rust", areaName: null, targetDate: null, status: "active", capturedAt: ISO } as SharedGoalWire],
      }),
    );
    const html = document.body.innerHTML;
    expect(html).not.toContain("team-secret-1");
    expect(html).not.toMatch(/memberRef|participantMemberRef|uid|email/i);
    for (const link of Array.from(document.querySelectorAll("a[href]"))) {
      expect(link.getAttribute("href")).not.toMatch(/team|uid/i);
    }
  });

  it("shows an area that is not available with its neutral copy, and never a stored goal id", async () => {
    await renderOwner(
      owner({
        sharedGoals: [{ goalTitle: "Lær Rust", areaName: null, targetDate: null, status: "active", capturedAt: ISO } as SharedGoalWire],
      }),
    );
    expect(screen.getByText(conversationsCopy.areaUnavailable)).toBeTruthy();
  });
});

describe("OwnerConversationEditor: each section saves on its own", () => {
  it("saves the title alone: one write with only the title key", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: conversationsCopy.titleSection });
    await user.clear(field);
    await user.type(field, "Ny tittel");
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { title: "Ny tittel" });
    expect(await screen.findByText(conversationsCopy.saved)).toBeTruthy();
  });

  it("refuses an empty title on the client, and sends nothing", async () => {
    await renderOwner();
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: conversationsCopy.titleSection }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    expect(await screen.findByText(conversationsCopy.createTitleInvalid)).toBeTruthy();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("clears the planned date when the date field is empty", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(conversationsCopy.plannedForSection, { selector: "input" }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.savePlannedFor }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { plannedFor: null }));
  });

  it("clears the owner notes when the notes field is empty, and writes only ownerNotes", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: conversationsCopy.notesSection }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { ownerNotes: "" }));
  });

  it("refuses more than ten next steps, and sends nothing", async () => {
    await renderOwner();
    const field = screen.getByRole("textbox", { name: conversationsCopy.nextStepsSection });
    fireEvent.change(field, { target: { value: Array.from({ length: 11 }, (_, i) => `Steg ${i + 1}`).join("\n") } });
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.saveNextSteps }));
    expect(await screen.findByText(conversationsCopy.nextStepsLimit)).toBeTruthy();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("skips blank lines and sends the non-empty next steps in order", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    const field = screen.getByRole("textbox", { name: conversationsCopy.nextStepsSection });
    fireEvent.change(field, { target: { value: "Første\n\n  Andre  \n" } });
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.saveNextSteps }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { nextSteps: ["Første", "Andre"] }));
  });
});

describe("OwnerConversationEditor: writes, ambiguity and re-reads", () => {
  it("ignores a second submit while the first write is in flight: one request", async () => {
    updateConversationMock.mockReturnValue(new Promise(() => {}));
    await renderOwner();
    const form = screen.getByRole("textbox", { name: conversationsCopy.titleSection }).closest("form");
    if (!form) throw new Error("title form missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected invalid input shows the general copy and does not re-read", async () => {
    updateConversationMock.mockResolvedValue({ status: "error", error: "invalid_input" });
    await renderOwner();
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    expect(await screen.findByText(conversationsCopy.writeInvalid)).toBeTruthy();
    expect(fetchConversationMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous write says the save could not be confirmed, re-reads once, and never retries", async () => {
    updateConversationMock.mockResolvedValue({ status: "error", error: "persistence_failed" });
    await renderOwner();
    fetchConversationMock.mockResolvedValueOnce(ownerView(owner()));
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    expect(await screen.findByText(conversationsCopy.writeAmbiguous)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.saved)).toBeNull();
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationMock).toHaveBeenCalledTimes(2);
  });

  it("a failed re-read keeps the editor and the person's draft", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    fetchConversationMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    const user = userEvent.setup();
    const field = screen.getByRole("textbox", { name: conversationsCopy.titleSection });
    await user.clear(field);
    await user.type(field, "Utkast");
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    expect(await screen.findByText(conversationsCopy.refreshFailed)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: conversationsCopy.titleSection }) as HTMLInputElement).value).toBe("Utkast");
  });

  it("a write that finds the conversation completed says so, and re-reads into the read-only view", async () => {
    updateConversationMock.mockResolvedValue({ status: "error", error: "conversation_completed" });
    await renderOwner();
    fetchConversationMock.mockResolvedValueOnce(ownerView(owner({ status: "completed", completedAt: ISO })));
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    expect(await screen.findByText(conversationsCopy.writeCompleted)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: conversationsCopy.notesSection })).toBeNull());
  });
});

describe("OwnerConversationEditor: completed conversations", () => {
  it("shows every section read only, and the only action is clearing the shared goals", async () => {
    const shared: SharedGoalWire = { goalTitle: "Lær Rust", areaName: "Programmering", targetDate: "2026-12-01", status: "active", capturedAt: ISO };
    await renderOwner(owner({ status: "completed", completedAt: ISO, sharedGoals: [shared] }));
    expect(screen.getByText(conversationsCopy.detailCompleted)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: conversationsCopy.saveGoals })).toBeNull();
    expect(fetchOwnGoalsMock).not.toHaveBeenCalled();
  });

  it("clears every shared goal with one write that sends an empty set", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    const shared: SharedGoalWire = { goalTitle: "Lær Rust", areaName: "Programmering", targetDate: null, status: "active", capturedAt: ISO };
    await renderOwner(owner({ status: "completed", completedAt: ISO, sharedGoals: [shared] }));
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.clearGoals }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { sharedGoalIds: [] }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });
});

describe("GoalSnapshotSelector: owner goal choice (BR-24, BR-27)", () => {
  it("lists the owner's goals from the D1 list and says that a save replaces the whole set", async () => {
    await renderOwner(owner(), [goal({ id: "g1", title: "Lær Rust" }), goal({ id: "g2", title: "Lær SQL", status: "completed" })]);
    expect(await screen.findByRole("checkbox", { name: /Lær Rust/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Lær SQL/ })).toBeTruthy();
    expect(screen.getByText(conversationsCopy.selectorCopy)).toBeTruthy();
    expect(fetchOwnGoalsMock).toHaveBeenCalledWith("a-token");
  });

  it("allows at most five goals: the sixth checkbox is disabled, and the save sends the ids in order", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    const goals = ["g1", "g2", "g3", "g4", "g5", "g6"].map((id, i) => goal({ id, title: `Mål ${i + 1}` }));
    await renderOwner(owner(), goals);
    const user = userEvent.setup();
    for (let i = 1; i <= 5; i += 1) await user.click(await screen.findByRole("checkbox", { name: new RegExp(`Mål ${i} `) }));
    const sixth = screen.getByRole("checkbox", { name: /Mål 6 / });
    expect((sixth as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveGoals }));
    await waitFor(() =>
      expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { sharedGoalIds: ["g1", "g2", "g3", "g4", "g5"] }),
    );
  });

  it("an invalid goal selection from the server is shown as stable copy, with no re-read", async () => {
    updateConversationMock.mockResolvedValue({ status: "error", error: "invalid_goal_selection" });
    await renderOwner(owner(), [goal()]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /Lær Rust/ }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveGoals }));
    expect(await screen.findByText(conversationsCopy.goalSelectionInvalid)).toBeTruthy();
    expect(fetchConversationMock).toHaveBeenCalledTimes(1);
  });

  it("a failed goal list shows its error and keeps the save disabled", async () => {
    fetchOwnGoalsMock.mockResolvedValue({ status: "error", error: "read_failed" });
    signedInWith(ownerView(owner()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByText(conversationsCopy.selectorError)).toBeTruthy();
    expect((screen.getByRole("button", { name: conversationsCopy.saveGoals }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a truncated goal list says that not every goal is shown", async () => {
    fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [goal()], truncated: true } });
    signedInWith(ownerView(owner()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByText(conversationsCopy.selectorTruncated)).toBeTruthy();
  });

  it("keeps the save control inside the shared goals section", async () => {
    await renderOwner(owner(), [goal()]);
    const section = screen.getByRole("region", { name: conversationsCopy.sharedGoalsSection });
    expect(within(section).getByRole("button", { name: conversationsCopy.saveGoals })).toBeTruthy();
  });
});

describe("review: destructive and draft-safety behavior", () => {
  it("an open selector with nothing selected cannot save, so it never clears existing snapshots by accident", async () => {
    const shared: SharedGoalWire = { goalTitle: "Lær Rust", areaName: "Programmering", targetDate: null, status: "active", capturedAt: ISO };
    await renderOwner(owner({ sharedGoals: [shared] }), [goal()]);
    await screen.findByRole("checkbox", { name: /Lær Rust/ });
    const save = screen.getByRole("button", { name: conversationsCopy.saveGoals }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(conversationsCopy.selectorNeedsGoal)).toBeTruthy();
    await userEvent.click(save);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("an open conversation offers an explicit clear-all that sends exactly an empty set", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    const shared: SharedGoalWire = { goalTitle: "Lær Rust", areaName: null, targetDate: null, status: "active", capturedAt: ISO };
    await renderOwner(owner({ sharedGoals: [shared] }), [goal()]);
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.clearGoals }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { sharedGoalIds: [] }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("a truncated goal list says that saving replaces the whole set, including goals not shown", async () => {
    fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [goal()], truncated: true } });
    signedInWith(ownerView(owner()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByText(conversationsCopy.selectorTruncated)).toBeTruthy();
  });

  it("an unsaved title draft survives a successful notes save", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    const user = userEvent.setup();
    const title = screen.getByRole("textbox", { name: conversationsCopy.titleSection });
    await user.clear(title);
    await user.type(title, "Utkast til tittel");
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { ownerNotes: "Mine notater" });
    expect((screen.getByRole("textbox", { name: conversationsCopy.titleSection }) as HTMLInputElement).value).toBe("Utkast til tittel");
  });

  it("after a confirmed title save the field shows the canonical value, not the untrimmed draft", async () => {
    updateConversationMock.mockResolvedValue(savedAck);
    await renderOwner();
    const user = userEvent.setup();
    const title = screen.getByRole("textbox", { name: conversationsCopy.titleSection });
    await user.clear(title);
    await user.type(title, "  Ny tittel  ");
    await user.click(screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { title: "Ny tittel" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: conversationsCopy.titleSection }) as HTMLInputElement).value).toBe("Ny tittel"));
  });

  it("a participant or pending view never triggers a read of the owner's D1 goals", async () => {
    signedInWith({ status: "ok", view: { kind: "pending", invitation: { conversationId: CONVERSATION_ID, state: "pending", teamName: "Plattform", invitedAt: ISO, ownerDisplayName: null } } } as FetchConversationResult);
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByRole("heading", { level: 2, name: conversationsCopy.pendingHeading })).toBeTruthy();
    expect(fetchOwnGoalsMock).not.toHaveBeenCalled();
  });
});

describe("review: TASK-029 participant controls keep owner drafts (TASK-028 draft safety)", () => {
  it("an unsaved title draft survives an invitation and the authoritative re-read that follows it", async () => {
    fetchSelectableMembersMock.mockResolvedValue({
      status: "ok",
      response: { members: [{ memberRef: "ref-synthetic-kari", displayName: "Kari Testperson", ordinal: null, isSelf: false }], truncated: false },
    });
    updateConversationMock.mockResolvedValue(savedAck);
    const invited = owner({ participant: { state: "pending", displayName: "Kari Testperson" } });
    signedInWith(ownerView(owner()), ownerView(invited));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await screen.findByRole("heading", { level: 2, name: conversationsCopy.titleSection });

    const user = userEvent.setup();
    const title = screen.getByRole("textbox", { name: conversationsCopy.titleSection });
    await user.clear(title);
    await user.type(title, "Utkast til tittel");
    fireEvent.change(await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague }), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.confirmInvite }));

    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { participantMemberRef: "ref-synthetic-kari" });
    expect(await screen.findByText(conversationsCopy.participantStateLabel.pending + ": Kari Testperson")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: conversationsCopy.titleSection }) as HTMLInputElement).value).toBe("Utkast til tittel");
  });
});

describe("ConversationDetail: the selector is read only in the open owner view (SPEC Amendment 2026-10-19, TASK-029 I-1)", () => {
  it("a completed owner view reads no selector", async () => {
    await renderOwner(owner({ status: "completed", completedAt: ISO, teamId: "team-synthetic-1" }));
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
  });

  it("a pending view reads no selector", async () => {
    signedInWith({ status: "ok", view: { kind: "pending", invitation: { conversationId: CONVERSATION_ID, state: "pending", teamName: "Plattform", invitedAt: ISO, ownerDisplayName: null } } } as FetchConversationResult);
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByRole("heading", { level: 2, name: conversationsCopy.pendingHeading })).toBeTruthy();
    expect(fetchSelectableMembersMock).not.toHaveBeenCalled();
  });

  it("an open owner view with a team reads the selector by conversation id only", async () => {
    await renderOwner(owner({ teamId: "team-synthetic-1" }));
    await waitFor(() => expect(fetchSelectableMembersMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID));
  });
});

describe("ConversationDetail: owner lifecycle controls (SPEC BR-5, BR-28, BR-29, BR-38; TASK-031)", () => {
  beforeEach(() => {
    deleteConversationMock.mockReset();
    routerReplaceMock.mockReset();
  });

  it("an open owner view offers completion and delete", async () => {
    await renderOwner(owner({ status: "open" }));
    expect(screen.getByRole("heading", { level: 2, name: conversationsCopy.lifecycleSection })).toBeTruthy();
    expect(screen.getByRole("button", { name: conversationsCopy.completeConversationButton })).toBeTruthy();
    expect(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton })).toBeTruthy();
  });

  it("a completed owner view offers delete but no completion and no reopen", async () => {
    await renderOwner(owner({ status: "completed", completedAt: ISO }));
    expect(screen.queryByRole("button", { name: conversationsCopy.completeConversationButton })).toBeNull();
    expect(screen.queryByRole("button", { name: /åpne|gjenåpne/i })).toBeNull();
    expect(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton })).toBeTruthy();
  });

  it("an accepted participant view offers neither owner lifecycle control", async () => {
    signedInWith(participantView(participant()));
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByRole("button", { name: conversationsCopy.leaveButton })).toBeTruthy();
    expect(screen.queryByRole("button", { name: conversationsCopy.completeConversationButton })).toBeNull();
    expect(screen.queryByRole("button", { name: conversationsCopy.deleteConversationButton })).toBeNull();
  });

  it("a pending view offers neither owner lifecycle control", async () => {
    signedInWith(pendingView());
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    expect(await screen.findByRole("button", { name: conversationsCopy.acceptButton })).toBeTruthy();
    expect(screen.queryByRole("button", { name: conversationsCopy.completeConversationButton })).toBeNull();
    expect(screen.queryByRole("button", { name: conversationsCopy.deleteConversationButton })).toBeNull();
  });

  it("a confirmed completion re-reads the owner detail and shows the completed view", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "saved" });
    signedInWith(ownerView(owner({ status: "open" })), ownerView(owner({ status: "completed", completedAt: ISO })));
    fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [], truncated: false } });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await screen.findByRole("heading", { level: 2, name: conversationsCopy.titleSection });

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.completeConversationButton }));
    fireEvent.submit(screen.getByRole("group", { name: conversationsCopy.completeConfirmHeading }));

    expect(await screen.findByText(conversationsCopy.detailCompleted)).toBeTruthy();
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { status: "completed" });
    expect(screen.queryByRole("button", { name: conversationsCopy.completeConversationButton })).toBeNull();
    expect(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton })).toBeTruthy();
  });

  it("a confirmed delete leaves the detail page for the list without a second DELETE", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "deleted" });
    await renderOwner(owner({ status: "open" }));

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton }));
    fireEvent.submit(screen.getByRole("group", { name: conversationsCopy.deleteConfirmHeading }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/me/conversations"));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID);
  });
});
