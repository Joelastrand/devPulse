// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { conversationsCopy } from "./copy";
import type {
  ConversationListResponse,
  OwnerConversationWire,
  OwnerParticipantWire,
  ParticipantConversationWire,
  PendingInvitationWire,
  SharedGoalWire,
} from "./client/conversations-gateway";

const observeIdTokenMock = vi.fn();
const fetchConversationMock = vi.fn();
const fetchConversationListMock = vi.fn();
const fetchOwnGoalsMock = vi.fn();
const fetchSelectableMembersMock = vi.fn();
const fetchCreateOptionsMock = vi.fn();
const createConversationMock = vi.fn();
const updateConversationMock = vi.fn();
const deleteConversationMock = vi.fn();
const acceptInvitationMock = vi.fn();
const endParticipationMock = vi.fn();
const saveParticipantNotesMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock("../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));
vi.mock("./client/conversations-gateway", () => ({
  fetchConversation: fetchConversationMock,
  fetchConversationList: fetchConversationListMock,
  updateConversation: updateConversationMock,
  deleteConversation: deleteConversationMock,
  fetchOwnGoals: fetchOwnGoalsMock,
  fetchSelectableMembers: fetchSelectableMembersMock,
  fetchCreateOptions: fetchCreateOptionsMock,
  createConversation: createConversationMock,
  acceptInvitation: acceptInvitationMock,
  endParticipation: endParticipationMock,
  saveParticipantNotes: saveParticipantNotesMock,
}));

const { CompleteConversationDialog } = await import("./components/CompleteConversationDialog");
const { ConversationsPage } = await import("./components/ConversationsPage");
const { CreateConversationForm } = await import("./components/CreateConversationForm");
const { DeleteConversationDialog } = await import("./components/DeleteConversationDialog");
const { ConversationDetail } = await import("./components/ConversationDetail");
const { GoalSnapshotSelector } = await import("./components/GoalSnapshotSelector");
const { ParticipantConversation } = await import("./components/ParticipantConversation");
const { ParticipantPanel } = await import("./components/ParticipantPanel");
const { PendingInvitation } = await import("./components/PendingInvitation");
const { RecoveryRegion } = await import("./components/RecoveryRegion");

const CONVERSATION_ID = "conv-synthetic-1";
const ISO = "2026-10-01T10:00:00.000Z";

/** Every string the copy module can produce, with functions called on sample arguments. */
function copyStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return copyStrings((value as (...args: unknown[]) => unknown)(1, 1, 1));
  if (Array.isArray(value)) return value.flatMap(copyStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(copyStrings);
  return [];
}

/** Every non-test source file in this feature, recursively. */
function featureSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return featureSourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function renderCompletion(participantState: "none" | "pending" | "accepted") {
  render(
    <CompleteConversationDialog
      conversationId={CONVERSATION_ID}
      token="a-token"
      participantState={participantState}
      onUnauthenticated={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: conversationsCopy.completeConversationButton }));
  return screen.getByRole("group", { name: conversationsCopy.completeConfirmHeading });
}

function completedOwner(): OwnerConversationWire {
  return {
    conversationId: CONVERSATION_ID,
    title: "Kommunikasjon i prosjekter",
    status: "completed",
    plannedFor: null,
    teamId: null,
    participant: { state: "none", displayName: null },
    ownerNotes: "",
    nextSteps: [],
    participantNotes: "",
    sharedGoals: [],
    createdAt: ISO,
    updatedAt: ISO,
    completedAt: ISO,
  };
}

beforeEach(() => {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchConversationMock.mockResolvedValue({ status: "ok", view: { kind: "owner", conversation: completedOwner() } });
  fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [], truncated: false } });
  fetchSelectableMembersMock.mockResolvedValue({ status: "ok", response: { members: [], truncated: false } });
  fetchConversationListMock.mockResolvedValue({ status: "ok", response: emptyList });
  fetchCreateOptionsMock.mockResolvedValue({ status: "ok", response: { items: [], truncated: false } });
  createConversationMock.mockResolvedValue({ status: "created", conversationId: "conv-synthetic-new" });
  acceptInvitationMock.mockResolvedValue({ status: "accepted" });
  endParticipationMock.mockResolvedValue({ status: "ended" });
  saveParticipantNotesMock.mockResolvedValue({ status: "saved" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("copy: forbidden performance and evaluation terms (TASK-033, D2-SI-17)", () => {
  it("no copy string contains a score, ranking, rating, performance or activity term", () => {
    const forbidden = [
      /\bscore\b/i,
      /\brating\b/i,
      /vurdering/i,
      /rangering/i,
      /prestasjon/i,
      /ytelse/i,
      /på sporet/i,
      /dele utviklingsprofil/i,
      /avlys/i,
      /\brank\b/i,
      /performance/i,
      /productivity/i,
      /last viewed/i,
      /read receipt/i,
    ];
    const strings = copyStrings(conversationsCopy);
    expect(strings.length).toBeGreaterThan(100);
    for (const text of strings) {
      for (const term of forbidden) expect(text, `"${text}" matches ${term}`).not.toMatch(term);
    }
  });
});

describe("static: no raw HTML in D2 components (TASK-033)", () => {
  it("no D2 source file uses dangerouslySetInnerHTML", () => {
    const files = featureSourceFiles(join(process.cwd(), "src", "features", "development-conversations"));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("BR-5: conversation delete surfaces never use cancel wording", () => {
  it("the delete confirmation dismisses with 'Behold samtalen', sends nothing, and states the BR-38 consequence", async () => {
    render(<DeleteConversationDialog conversationId={CONVERSATION_ID} token="a-token" onUnauthenticated={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton }));
    const group = screen.getByRole("group", { name: conversationsCopy.deleteConfirmHeading });

    expect(group.textContent).toMatch(/fjernes/);
    expect(group.textContent).toContain("Ingenting beholdes.");
    expect(document.body.textContent).not.toMatch(/avbryt|cancel/i);

    await userEvent.click(within(group).getByRole("button", { name: "Behold samtalen" }));
    expect(deleteConversationMock).not.toHaveBeenCalled();
  });
});

describe("completion copy matches the participant state (BR-13, BR-16, BR-21, BR-27, BR-28, TASK-033)", () => {
  it("with no participant, does not say a participant can be removed as if one exists", () => {
    const group = renderCompletion("none");
    expect(group.textContent).not.toMatch(/fjerne deltakeren/i);
  });

  it("with an accepted participant, does not promise access that holds regardless of team membership", () => {
    const group = renderCompletion("accepted");
    expect(group.textContent).toMatch(/beholder tilgangen/);
    expect(group.textContent).toMatch(/medlem av teamet/);
  });

  it("with a pending invitation, states that the invitation is withdrawn and not that access is kept", () => {
    const group = renderCompletion("pending");
    expect(group.textContent).toContain(conversationsCopy.completePendingWithdrawn);
    expect(group.textContent).not.toMatch(/beholder tilgangen/);
  });
});

describe("completed owner view does not imply a participant or shared goals exist (TASK-033)", () => {
  it("the completed notice names no participant when the conversation has none", async () => {
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const notice = await screen.findByText(conversationsCopy.detailCompleted);
    expect(notice.textContent).not.toMatch(/\bdeltakeren\b/);
    expect(notice.textContent).toMatch(/skrivebeskyttet/);
  });
});

/* TASK-033 keyboard and label coverage. Native controls supply the keyboard behaviour (Tab, Space on checkboxes, Enter on
 * buttons), so these tests drive the real controls with user-event and assert the focus order, the accessible names and the
 * mutations that happen or must not happen. Synthetic data only. */

const sharedGoal: SharedGoalWire = { goalTitle: "Lær Rust", areaName: null, targetDate: null, status: "active", capturedAt: ISO };
const ROSTER = {
  status: "ok",
  response: {
    members: [
      { memberRef: "ref-synthetic-kari", displayName: "Kari Testperson", ordinal: null, isSelf: false },
      { memberRef: "ref-synthetic-ola", displayName: "Ola Testperson", ordinal: null, isSelf: false },
    ],
    truncated: false,
  },
};

function renderGoalSelector(shared: SharedGoalWire[] = []) {
  fetchOwnGoalsMock.mockResolvedValue({ status: "ok", response: { goals: [{ id: "g1", title: "Lær Rust", status: "active" }], truncated: false } });
  render(
    <GoalSnapshotSelector
      conversationId={CONVERSATION_ID}
      token="a-token"
      completed={false}
      sharedGoals={shared}
      onUnauthenticated={vi.fn()}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

function renderPanel(participant: OwnerParticipantWire = { state: "none", displayName: null }) {
  fetchSelectableMembersMock.mockResolvedValue(ROSTER);
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <ParticipantPanel
      conversationId={CONVERSATION_ID}
      token="a-token"
      teamId="team-synthetic-1"
      completed={false}
      participant={participant}
      onUnauthenticated={vi.fn()}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
}

function renderRecovery() {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(<RecoveryRegion items={[{ conversationId: "bad-1" }]} token="a-token" onUnauthenticated={vi.fn()} onChanged={onChanged} />);
  return { onChanged };
}

describe("keyboard and labels: goal snapshot selector (TASK-033, SPEC BR-24, BR-27, TASK-028)", () => {
  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  it("each goal checkbox is named by its goal, and Space toggles it without sending anything", async () => {
    renderGoalSelector();
    const checkbox = (await screen.findByRole("checkbox", { name: /Lær Rust/ })) as HTMLInputElement;
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(checkbox);
    await user.keyboard(" ");
    expect(checkbox.checked).toBe(true);
    await user.keyboard(" ");
    expect(checkbox.checked).toBe(false);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("Save is skipped by Tab until a goal is chosen, then Enter sends exactly the chosen set", async () => {
    renderGoalSelector();
    await screen.findByRole("checkbox", { name: /Lær Rust/ });
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard(" ");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.saveGoals }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { sharedGoalIds: ["g1"] }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("with no goal chosen, Tab never reaches Save, so an empty selection cannot be sent", async () => {
    renderGoalSelector();
    await screen.findByRole("checkbox", { name: /Lær Rust/ });
    const save = screen.getByRole("button", { name: conversationsCopy.saveGoals }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).not.toBe(save);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("clear-all is its own Tab stop, and Enter on it sends only the empty set", async () => {
    renderGoalSelector([sharedGoal]);
    await screen.findByRole("checkbox", { name: /Lær Rust/ });
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.clearGoals }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { sharedGoalIds: [] }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });
});

describe("keyboard and labels: colleague selector and invitation (TASK-033, SPEC BR-8, BR-10, BR-38)", () => {
  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  it("the colleague selector is named by its label, is reached by Tab, and choosing a colleague sends nothing", async () => {
    renderPanel();
    const select = (await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague })) as HTMLSelectElement;
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(select);
    await user.selectOptions(select, "0");
    expect(select.value).toBe("0");
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("Enter on the invite action opens a confirmation that takes focus, and sends nothing before the owner confirms", async () => {
    renderPanel();
    const select = await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague });
    const user = userEvent.setup();
    await user.tab();
    await user.selectOptions(select, "0");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    await user.keyboard("{Enter}");
    const group = screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
    expect(document.activeElement?.textContent).toBe(conversationsCopy.inviteConfirmHeading);
    expect(within(group).getByText(conversationsCopy.inviteTargetLine("Kari Testperson"))).toBeTruthy();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });
});

describe("keyboard and labels: participant removal confirmation (TASK-033, SPEC BR-16; Avbryt allowed here)", () => {
  const accepted: OwnerParticipantWire = { state: "accepted", displayName: "Kari Testperson" };

  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  it("Enter on Remove opens a confirmation that states its consequence and takes focus", async () => {
    renderPanel(accepted);
    await screen.findByRole("combobox", { name: conversationsCopy.chooseReplacement });
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.removeButton }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("group", { name: conversationsCopy.removeActiveWarning })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(conversationsCopy.removeActiveWarning);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("Avbryt dismisses by keyboard with no removal sent, and focus returns to the participant heading", async () => {
    renderPanel(accepted);
    await screen.findByRole("combobox", { name: conversationsCopy.chooseReplacement });
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.confirmRemove }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.cancelButton }));
    await user.keyboard("{Enter}");
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.removeActiveWarning })).toBeNull();
    expect(document.activeElement?.textContent).toBe(conversationsCopy.participantSection);
  });

  it("Enter on the confirmed removal sends exactly one removal and re-reads once", async () => {
    const { onChanged } = renderPanel(accepted);
    await screen.findByRole("combobox", { name: conversationsCopy.chooseReplacement });
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { participantMemberRef: null });
  });
});

describe("keyboard and labels: participant replacement confirmation (TASK-033, SPEC BR-16; Avbryt allowed here)", () => {
  const accepted: OwnerParticipantWire = { state: "accepted", displayName: "Kari Testperson" };

  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  it("a chosen replacement is reached by Tab, and Enter on Replace opens a confirmation that takes focus", async () => {
    renderPanel(accepted);
    const select = await screen.findByRole("combobox", { name: conversationsCopy.chooseReplacement });
    const user = userEvent.setup();
    await user.tab();
    await user.selectOptions(select, "1");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.replaceButton }));
    await user.keyboard("{Enter}");
    const group = screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
    expect(document.activeElement?.textContent).toBe(conversationsCopy.inviteConfirmHeading);
    expect(within(group).getByText(conversationsCopy.replaceWarning)).toBeTruthy();
    expect(within(group).getByText(conversationsCopy.inviteTargetLine("Ola Testperson"))).toBeTruthy();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("Avbryt dismisses by keyboard with no replacement sent, and focus returns to the participant heading", async () => {
    renderPanel(accepted);
    const select = await screen.findByRole("combobox", { name: conversationsCopy.chooseReplacement });
    const user = userEvent.setup();
    await user.tab();
    await user.selectOptions(select, "1");
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.confirmReplace }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.cancelButton }));
    await user.keyboard("{Enter}");
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.inviteConfirmHeading })).toBeNull();
    expect(document.activeElement?.textContent).toBe(conversationsCopy.participantSection);
  });

  it("Enter on the confirmed replacement sends only the chosen colleague's ref", async () => {
    renderPanel(accepted);
    const select = await screen.findByRole("combobox", { name: conversationsCopy.chooseReplacement });
    const user = userEvent.setup();
    await user.tab();
    await user.selectOptions(select, "1");
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { participantMemberRef: "ref-synthetic-ola" });
  });
});

describe("keyboard and labels: recovery delete (TASK-033, TASK-026 regression, SPEC BR-5, BR-33)", () => {
  const deleteName = conversationsCopy.recoveryDeleteButtonName(1, 1);

  beforeEach(() => {
    deleteConversationMock.mockResolvedValue({ status: "deleted" });
  });

  it("Tab reaches the labelled delete action, and Enter opens a confirmation that takes focus", async () => {
    renderRecovery();
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: deleteName }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("group", { name: conversationsCopy.deleteConfirmRecovery })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(conversationsCopy.deleteConfirmRecovery);
    expect(deleteConversationMock).not.toHaveBeenCalled();
  });

  it("the keyboard dismiss is exactly 'Behold samtalen', sends no DELETE, offers no Avbryt, and returns focus to the delete action", async () => {
    renderRecovery();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.deleteConfirmButton }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Behold samtalen" }));
    await user.keyboard("{Enter}");
    expect(deleteConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.deleteConfirmRecovery })).toBeNull();
    expect(within(screen.getByRole("region", { name: conversationsCopy.recoveryHeading })).queryByRole("button", { name: "Avbryt" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: deleteName }));
  });

  it("Enter on the confirmed delete sends exactly one DELETE for this item and re-reads once", async () => {
    const { onChanged } = renderRecovery();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledWith("a-token", "bad-1");
  });
});

/* TASK-033 I-1 coverage: every interactive control rendered by the D2 UI. A control is reached with Tab (`tabTo`), activated
 * with Enter or Space, and found by its accessible name. Click-only tests are not keyboard evidence here. Focus-return rules
 * are asserted where a component has one. Synthetic data only. */

const emptyList: ConversationListResponse = { owned: { items: [], truncated: false }, participating: { items: [], truncated: false } };

const listData: ConversationListResponse = {
  owned: {
    items: [
      {
        kind: "summary",
        conversation: {
          conversationId: "conv-synthetic-owned",
          title: "Synthetic owned",
          status: "open",
          plannedFor: null,
          participant: { state: "none", displayName: null },
          sharedGoalCount: 0,
          createdAt: ISO,
          updatedAt: ISO,
        },
      },
    ],
    truncated: false,
  },
  participating: {
    items: [
      { conversationId: "conv-synthetic-accepted", state: "accepted", title: "Synthetic accepted", teamName: "Team Synthetic A", invitedAt: ISO },
      { conversationId: "conv-synthetic-pending", state: "pending", title: null, teamName: "Team Synthetic B", invitedAt: ISO },
    ],
    truncated: false,
  },
};

const openOwner: OwnerConversationWire = {
  conversationId: CONVERSATION_ID,
  title: "Synthetic title",
  status: "open",
  plannedFor: null,
  teamId: null,
  participant: { state: "none", displayName: null },
  ownerNotes: "",
  nextSteps: [],
  participantNotes: "",
  sharedGoals: [],
  createdAt: ISO,
  updatedAt: ISO,
  completedAt: null,
};

const pendingWire: PendingInvitationWire = {
  conversationId: CONVERSATION_ID,
  state: "pending",
  teamName: "Team Synthetic",
  invitedAt: ISO,
  ownerDisplayName: "Ola Testperson",
};

const participantWire: ParticipantConversationWire = {
  conversationId: CONVERSATION_ID,
  title: "Synthetic title",
  status: "open",
  plannedFor: null,
  teamName: "Team Synthetic",
  ownerDisplayName: "Ola Testperson",
  ownerNotes: "",
  nextSteps: [],
  participantNotes: "",
  sharedGoals: [],
  createdAt: ISO,
  updatedAt: ISO,
  completedAt: null,
};

const teamChoices = [
  { teamId: "team-synthetic-a", name: "Team Synthetic A" },
  { teamId: "team-synthetic-b", name: "Team Synthetic B" },
];

/** Tabs until `target` has focus. Fails when the control cannot be reached by keyboard in the page's own order. */
async function tabTo(user: UserEvent, target: HTMLElement, limit = 60) {
  for (let step = 0; step < limit && document.activeElement !== target; step += 1) {
    await user.tab();
  }
  expect(document.activeElement, `keyboard reach to "${target.textContent}"`).toBe(target);
}

/**
 * Counts the click that a keyboard Enter on a native link produces. The default navigation is cancelled, as Next's client
 * Link does, because no app router is mounted here and jsdom cannot navigate.
 */
function countClicks(element: HTMLElement) {
  const clicks = vi.fn();
  element.addEventListener("click", (event) => {
    event.preventDefault();
    clicks();
  });
  return clicks;
}

describe("keyboard and labels: goal snapshot clear-all after completion (TASK-033, SPEC BR-27, TASK-028)", () => {
  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  it("the completed clear-all is reached by Tab, Enter sends only the empty set, and no goal list is loaded", async () => {
    render(
      <GoalSnapshotSelector
        conversationId={CONVERSATION_ID}
        token="a-token"
        completed
        sharedGoals={[sharedGoal]}
        onUnauthenticated={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const user = userEvent.setup();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.clearGoals }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { sharedGoalIds: [] }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(fetchOwnGoalsMock).not.toHaveBeenCalled();
  });
});

describe("keyboard and labels: invitation confirmation and colleague retry (TASK-033, SPEC BR-8, BR-10, BR-38)", () => {
  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  async function openInviteConfirmation(user: UserEvent) {
    const select = await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague });
    await tabTo(user, select);
    await user.selectOptions(select, "0");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.inviteButton }));
    await user.keyboard("{Enter}");
    return screen.getByRole("group", { name: conversationsCopy.inviteConfirmHeading });
  }

  it("Invite confirmation is reached by Tab, and Enter sends exactly one invitation for the chosen colleague, then re-reads once", async () => {
    const { onChanged } = renderPanel();
    const user = userEvent.setup();
    const group = await openInviteConfirmation(user);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.confirmInvite }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { participantMemberRef: "ref-synthetic-kari" });
  });

  it("Invite cancel is reached by Tab, sends nothing, and returns focus to the participant heading", async () => {
    renderPanel();
    const user = userEvent.setup();
    const group = await openInviteConfirmation(user);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.cancelButton }));
    await user.keyboard("{Enter}");
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.inviteConfirmHeading })).toBeNull();
    expect(document.activeElement?.textContent).toBe(conversationsCopy.participantSection);
  });

  it("Retry in the unavailable colleague state is reached by Tab, and Enter re-reads the colleague list only", async () => {
    fetchSelectableMembersMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    renderPanel();
    await screen.findByText(conversationsCopy.colleagueOptionsError);
    expect(fetchSelectableMembersMock).toHaveBeenCalledTimes(1);
    const user = userEvent.setup();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.retryButton }));
    await user.keyboard("{Enter}");
    await screen.findByRole("combobox", { name: conversationsCopy.chooseColleague });
    expect(fetchSelectableMembersMock).toHaveBeenCalledTimes(2);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });
});

describe("keyboard and labels: owner conversation delete (TASK-033, SPEC BR-5, BR-29)", () => {
  beforeEach(() => {
    deleteConversationMock.mockResolvedValue({ status: "deleted" });
  });

  function renderDelete() {
    render(
      <DeleteConversationDialog
        conversationId={CONVERSATION_ID}
        token="a-token"
        onUnauthenticated={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    return userEvent.setup();
  }

  async function openDelete(user: UserEvent) {
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.deleteConversationButton }));
    await user.keyboard("{Enter}");
    return screen.getByRole("group", { name: conversationsCopy.deleteConfirmHeading });
  }

  it("the open control is reached by Tab, and Enter states the consequence and takes focus without sending a DELETE", async () => {
    const user = renderDelete();
    await openDelete(user);
    expect(document.activeElement?.textContent).toBe(conversationsCopy.deleteConfirmHeading);
    expect(deleteConversationMock).not.toHaveBeenCalled();
  });

  it("keyboard 'Behold samtalen' sends no DELETE, offers no Avbryt, and returns focus to the open control", async () => {
    const user = renderDelete();
    const group = await openDelete(user);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.keepConversation }));
    await user.keyboard("{Enter}");
    expect(deleteConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.deleteConfirmHeading })).toBeNull();
    expect(document.body.textContent).not.toMatch(/avbryt/i);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton }));
  });

  it("keyboard 'Slett samtale' sends exactly one DELETE for this conversation and leaves the detail page", async () => {
    const user = renderDelete();
    const group = await openDelete(user);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.confirmDelete }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/me/conversations"));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID);
  });
});

describe("keyboard and labels: owner completion (TASK-033, SPEC BR-4, BR-13)", () => {
  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  function renderComplete() {
    render(
      <CompleteConversationDialog
        conversationId={CONVERSATION_ID}
        token="a-token"
        participantState="none"
        onUnauthenticated={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    return userEvent.setup();
  }

  async function openComplete(user: UserEvent) {
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.completeConversationButton }));
    await user.keyboard("{Enter}");
    return screen.getByRole("group", { name: conversationsCopy.completeConfirmHeading });
  }

  it("the open control is reached by Tab, and Enter states the consequence and takes focus without completing", async () => {
    const user = renderComplete();
    await openComplete(user);
    expect(document.activeElement?.textContent).toBe(conversationsCopy.completeConfirmHeading);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("keyboard 'Behold åpen' sends no completion and returns focus to the open control", async () => {
    const user = renderComplete();
    const group = await openComplete(user);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.keepOpen }));
    await user.keyboard("{Enter}");
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.completeConfirmHeading })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.completeConversationButton }));
  });

  it("keyboard confirmation sends exactly one completion and re-reads once", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <CompleteConversationDialog
        conversationId={CONVERSATION_ID}
        token="a-token"
        participantState="none"
        onUnauthenticated={vi.fn()}
        onChanged={onChanged}
      />,
    );
    const user = userEvent.setup();
    const group = await openComplete(user);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.confirmComplete }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { status: "completed" });
  });
});

describe("keyboard and labels: participant view (TASK-033, SPEC BR-17, BR-20, BR-43)", () => {
  function renderParticipant() {
    const onLeave = vi.fn().mockResolvedValue(undefined);
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <ParticipantConversation
        conversation={participantWire}
        token="a-token"
        refreshFailed={false}
        onLeave={onLeave}
        onChanged={onChanged}
        onUnauthenticated={vi.fn()}
      />,
    );
    return { onLeave, onChanged, user: userEvent.setup() };
  }

  it("the participant's notes are reached by Tab, and Tab then Enter on 'Lagre notater' sends exactly one notes write", async () => {
    const { onChanged, user } = renderParticipant();
    await tabTo(user, screen.getByRole("textbox", { name: conversationsCopy.participantNotesLabel }));
    await user.keyboard("Synthetic note");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(saveParticipantNotesMock).toHaveBeenCalledTimes(1);
    expect(saveParticipantNotesMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { notes: "Synthetic note" });
  });

  it("Forlat is reached by Tab, Enter states the consequence, and keyboard Avbryt sends no leave and returns focus to Forlat", async () => {
    const { onLeave, user } = renderParticipant();
    const leave = screen.getByRole("button", { name: conversationsCopy.leaveButton });
    await tabTo(user, leave);
    await user.keyboard("{Enter}");
    const group = screen.getByRole("group", { name: conversationsCopy.leaveConfirmHeading });
    expect(document.activeElement?.textContent).toBe(conversationsCopy.leaveConfirmHeading);
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.cancelButton }));
    await user.keyboard("{Enter}");
    expect(onLeave).not.toHaveBeenCalled();
    expect(endParticipationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: conversationsCopy.leaveConfirmHeading })).toBeNull();
    expect(document.activeElement).toBe(leave);
  });

  it("keyboard 'Ja, forlat samtalen' performs exactly one leave", async () => {
    const { onLeave, user } = renderParticipant();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.leaveButton }));
    await user.keyboard("{Enter}");
    const group = screen.getByRole("group", { name: conversationsCopy.leaveConfirmHeading });
    await tabTo(user, within(group).getByRole("button", { name: conversationsCopy.confirmLeave }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  });
});

describe("keyboard and labels: pending invitation (TASK-033, SPEC BR-14, BR-15, BR-41)", () => {
  function renderPending() {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<PendingInvitation invitation={pendingWire} onAccept={onAccept} onDecline={onDecline} />);
    return { onAccept, onDecline, user: userEvent.setup() };
  }

  it("'Godta invitasjon' is reached by Tab, and Enter runs exactly one accept", async () => {
    const { onAccept, onDecline, user } = renderPending();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.acceptButton }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("'Avslå' is reached by Tab, and Space runs exactly one decline and no accept", async () => {
    const { onAccept, onDecline, user } = renderPending();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.declineButton }));
    await user.keyboard(" ");
    await waitFor(() => expect(onDecline).toHaveBeenCalledTimes(1));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("the pending view shows no conversation identifier", () => {
    renderPending();
    expect(document.body.textContent).not.toContain(CONVERSATION_ID);
    expect(document.body.textContent).not.toMatch(/ownerUid|participantUid|memberRef/);
  });
});

describe("keyboard and labels: create conversation form (TASK-033, SPEC BR-1, BR-2, BR-6, BR-38)", () => {
  beforeEach(() => {
    fetchCreateOptionsMock.mockResolvedValue({ status: "ok", response: { items: teamChoices, truncated: false } });
  });

  function renderCreate() {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<CreateConversationForm token="a-token" onUnauthenticated={vi.fn()} onChanged={onChanged} />);
    return { onChanged, user: userEvent.setup() };
  }

  async function openCreate(user: UserEvent) {
    const toggle = screen.getByRole("button", { name: conversationsCopy.createToggle });
    await tabTo(user, toggle);
    await user.keyboard("{Enter}");
    await screen.findByRole("combobox", { name: conversationsCopy.teamLabel });
    return toggle;
  }

  it("'Ny samtale' is reached by Tab, Enter opens the form, and the team choice loads", async () => {
    const { user } = renderCreate();
    const toggle = screen.getByRole("button", { name: conversationsCopy.createToggle });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await openCreate(user);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("form", { name: conversationsCopy.createHeading })).toBeTruthy();
    expect(fetchCreateOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("title, planned date and team are reached by Tab and filled by keyboard, and Enter on submit creates exactly one conversation", async () => {
    const { onChanged, user } = renderCreate();
    await openCreate(user);
    await tabTo(user, screen.getByRole("textbox", { name: conversationsCopy.createTitleLabel }));
    await user.keyboard("Synthetic title");
    await tabTo(user, screen.getByLabelText(conversationsCopy.plannedForLabel, { selector: "input" }));
    await user.keyboard("2026-11-01");
    const team = screen.getByRole("combobox", { name: conversationsCopy.teamLabel });
    await tabTo(user, team);
    await user.selectOptions(team, "team-synthetic-b");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.createSubmit }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(createConversationMock).toHaveBeenCalledTimes(1);
    expect(createConversationMock).toHaveBeenCalledWith("a-token", {
      title: "Synthetic title",
      plannedFor: "2026-11-01",
      teamId: "team-synthetic-b",
    });
  });

  it("'Avbryt' is reached by Tab, Enter closes the form with no create, and focus returns to 'Ny samtale'", async () => {
    const { user } = renderCreate();
    const toggle = await openCreate(user);
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.cancelCreate }));
    await user.keyboard("{Enter}");
    expect(createConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: conversationsCopy.createHeading })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
});

describe("keyboard and labels: owner editor fields and save buttons (TASK-033, SPEC BR-19, BR-24 to BR-28)", () => {
  beforeEach(() => {
    updateConversationMock.mockResolvedValue({ status: "saved" });
  });

  async function renderOpenOwner() {
    fetchConversationMock.mockResolvedValue({ status: "ok", view: { kind: "owner", conversation: openOwner } });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await screen.findByRole("textbox", { name: conversationsCopy.titleSection });
    return userEvent.setup();
  }

  it("the title is reached by Tab, and Tab then Enter on 'Lagre tittel' sends exactly the edited title", async () => {
    const user = await renderOpenOwner();
    const field = screen.getByRole("textbox", { name: conversationsCopy.titleSection });
    await tabTo(user, field);
    await user.clear(field);
    await user.keyboard("Ny tittel");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.saveTitle }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { title: "Ny tittel" }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("the planned date is reached by Tab, and Tab then Enter on 'Lagre dato' sends exactly the chosen date", async () => {
    const user = await renderOpenOwner();
    await tabTo(user, screen.getByLabelText(conversationsCopy.plannedForSection, { selector: "input" }));
    await user.keyboard("2026-12-01");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.savePlannedFor }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { plannedFor: "2026-12-01" }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("the owner notes are reached by Tab, and Tab then Enter on 'Lagre notater' sends exactly the note", async () => {
    const user = await renderOpenOwner();
    await tabTo(user, screen.getByRole("textbox", { name: conversationsCopy.notesSection }));
    await user.keyboard("Synthetic owner note");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.saveNotes }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { ownerNotes: "Synthetic owner note" }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("the next steps are reached by Tab, and Tab then Enter on 'Lagre neste steg' sends exactly the step list", async () => {
    const user = await renderOpenOwner();
    await tabTo(user, screen.getByRole("textbox", { name: conversationsCopy.nextStepsSection }));
    await user.keyboard("Første steg");
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.saveNextSteps }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { nextSteps: ["Første steg"] }));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });
});

describe("keyboard and labels: conversation detail links and recovery actions (TASK-033, SPEC BR-33, BR-35)", () => {
  it("'Tilbake til samtalene' is reached by Tab and Enter activates the link to the list", async () => {
    fetchConversationMock.mockResolvedValue({ status: "ok", view: { kind: "owner", conversation: openOwner } });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await screen.findByRole("textbox", { name: conversationsCopy.titleSection });
    const back = screen.getByRole("link", { name: conversationsCopy.backToList });
    expect(back.getAttribute("href")).toBe("/me/conversations");
    const clicks = countClicks(back);
    const user = userEvent.setup();
    await tabTo(user, back);
    await user.keyboard("{Enter}");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("'Logg inn' is reached by Tab and Enter activates the sign-in link when signed out", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const signIn = await screen.findByRole("link", { name: conversationsCopy.signInLink });
    expect(signIn.getAttribute("href")).toBe("/sign-in");
    const clicks = countClicks(signIn);
    const user = userEvent.setup();
    await tabTo(user, signIn);
    await user.keyboard("{Enter}");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("'Prøv igjen' in the load-error state is reached by Tab, and Enter loads the conversation again", async () => {
    fetchConversationMock
      .mockResolvedValueOnce({ status: "error", error: "persistence_failed" })
      .mockResolvedValue({ status: "ok", view: { kind: "owner", conversation: openOwner } });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    await screen.findByRole("button", { name: conversationsCopy.retryButton });
    const user = userEvent.setup();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.retryButton }));
    await user.keyboard("{Enter}");
    await screen.findByRole("textbox", { name: conversationsCopy.titleSection });
    expect(fetchConversationMock).toHaveBeenCalledTimes(2);
  });

  it("'Last på nytt' after an unconfirmed accept is reached by Tab, and Enter re-reads without sending accept again", async () => {
    fetchConversationMock
      .mockResolvedValueOnce({ status: "ok", view: { kind: "pending", invitation: pendingWire } })
      .mockResolvedValueOnce({ status: "error", error: "persistence_failed" })
      .mockResolvedValue({ status: "ok", view: { kind: "owner", conversation: openOwner } });
    acceptInvitationMock.mockResolvedValue({ status: "error", error: "persistence_failed" });
    render(<ConversationDetail conversationId={CONVERSATION_ID} />);
    const user = userEvent.setup();
    await tabTo(user, await screen.findByRole("button", { name: conversationsCopy.acceptButton }));
    await user.keyboard("{Enter}");
    await tabTo(user, await screen.findByRole("button", { name: conversationsCopy.reloadConversation }));
    await user.keyboard("{Enter}");
    await screen.findByRole("textbox", { name: conversationsCopy.titleSection });
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationMock).toHaveBeenCalledTimes(3);
  });
});

describe("keyboard and labels: conversation list page (TASK-033, SPEC BR-33, BR-34, BR-44)", () => {
  it("'Logg inn' is reached by Tab and Enter activates the sign-in link when signed out", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<ConversationsPage />);
    const signIn = await screen.findByRole("link", { name: conversationsCopy.signInLink });
    expect(signIn.getAttribute("href")).toBe("/sign-in");
    const clicks = countClicks(signIn);
    const user = userEvent.setup();
    await tabTo(user, signIn);
    await user.keyboard("{Enter}");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("'Prøv igjen' in the list load-error state is reached by Tab, and Enter reads the list again", async () => {
    fetchConversationListMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    render(<ConversationsPage />);
    await screen.findByRole("button", { name: conversationsCopy.retryButton });
    const user = userEvent.setup();
    await tabTo(user, screen.getByRole("button", { name: conversationsCopy.retryButton }));
    await user.keyboard("{Enter}");
    await screen.findByText(conversationsCopy.empty);
    expect(fetchConversationListMock).toHaveBeenCalledTimes(2);
  });

  it("the owned conversation link is reached by Tab and carries its own detail address", async () => {
    fetchConversationListMock.mockResolvedValue({ status: "ok", response: listData });
    render(<ConversationsPage />);
    const link = await screen.findByRole("link", { name: "Synthetic owned" });
    expect(link.getAttribute("href")).toBe("/me/conversations/conv-synthetic-owned");
    const clicks = countClicks(link);
    const user = userEvent.setup();
    await tabTo(user, link);
    await user.keyboard("{Enter}");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("the accepted participation link is reached by Tab and carries its own detail address", async () => {
    fetchConversationListMock.mockResolvedValue({ status: "ok", response: listData });
    render(<ConversationsPage />);
    const link = await screen.findByRole("link", { name: "Synthetic accepted" });
    expect(link.getAttribute("href")).toBe("/me/conversations/conv-synthetic-accepted");
    const clicks = countClicks(link);
    const user = userEvent.setup();
    await tabTo(user, link);
    await user.keyboard("{Enter}");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("the pending invitation link is reached by Tab, is named by its team, and carries its own detail address", async () => {
    fetchConversationListMock.mockResolvedValue({ status: "ok", response: listData });
    render(<ConversationsPage />);
    const link = await screen.findByRole("link", { name: conversationsCopy.openPendingName("Team Synthetic B") });
    expect(link.getAttribute("href")).toBe("/me/conversations/conv-synthetic-pending");
    const clicks = countClicks(link);
    const user = userEvent.setup();
    await tabTo(user, link);
    await user.keyboard("{Enter}");
    expect(clicks).toHaveBeenCalledTimes(1);
  });
});
