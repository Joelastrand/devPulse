// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conversationsCopy } from "../copy";
import type { ConversationListResponse, OwnedListItem, OwnerSummaryWire, ParticipationSummaryWire } from "../client/conversations-gateway";

const observeIdTokenMock = vi.fn();
const fetchConversationListMock = vi.fn();
const deleteConversationMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/conversations-gateway", () => ({
  fetchConversationList: fetchConversationListMock,
  deleteConversation: deleteConversationMock,
  fetchCreateOptions: vi.fn(async () => ({ status: "error", error: "unavailable" })),
}));

const { ConversationsPage } = await import("./ConversationsPage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function summary(overrides: Partial<OwnerSummaryWire> = {}): OwnedListItem {
  return {
    kind: "summary",
    conversation: {
      conversationId: "conv-1",
      title: "Kommunikasjon i prosjekter",
      status: "open",
      plannedFor: "2026-11-02",
      participant: { state: "none", displayName: null },
      sharedGoalCount: 0,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      ...overrides,
    },
  };
}

function participation(overrides: Partial<ParticipationSummaryWire> = {}): ParticipationSummaryWire {
  return {
    conversationId: "part-1",
    state: "accepted",
    title: "Veiledning i kodegjennomgang",
    teamName: "Plattform",
    invitedAt: "2026-10-02T10:00:00.000Z",
    ...overrides,
  };
}

function list(overrides: Partial<ConversationListResponse> = {}): ConversationListResponse {
  return {
    owned: { items: [], truncated: false },
    participating: { items: [], truncated: false },
    ...overrides,
  };
}

function signedInWith(...results: unknown[]) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  for (const result of results) fetchConversationListMock.mockResolvedValueOnce(result);
}

async function renderReady(response: ConversationListResponse) {
  signedInWith({ status: "ok", response });
  render(<ConversationsPage />);
  await waitFor(() => expect(screen.getByText(conversationsCopy.privacyNotice)).toBeTruthy());
}

function completed(overrides: Partial<OwnerSummaryWire> = {}): OwnedListItem {
  return summary({ conversationId: "conv-done", title: "Avsluttet samtale", status: "completed", ...overrides });
}

function pendingInvitation(): ParticipationSummaryWire {
  return { conversationId: "inv-1", state: "pending", title: null, teamName: "Plattform", invitedAt: "2026-10-03T10:00:00.000Z" };
}

describe("Samtaler grouped by state (TASK-033)", () => {
  it("groups invitations, open and completed conversations under their own headings", async () => {
    await renderReady(list({
      owned: { items: [summary(), completed()], truncated: false },
      participating: { items: [pendingInvitation(), participation()], truncated: false },
    }));

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Dine samtaler", "Fullførte samtaler", "Invitasjoner", "Samtaler du er med i"]);
  });

  it("puts a completed conversation under the completed heading only", async () => {
    await renderReady(list({ owned: { items: [completed()], truncated: false } }));

    const completedSection = screen.getByRole("region", { name: "Fullførte samtaler" });
    expect(within(completedSection).getByText("Avsluttet samtale")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Dine samtaler" })).getByText(conversationsCopy.ownedEmpty)).toBeTruthy();
  });

  it("keeps the create form hidden until Ny samtale is pressed", async () => {
    const user = userEvent.setup();
    await renderReady(list({ owned: { items: [summary()], truncated: false } }));

    expect(screen.queryByLabelText("Tittel")).toBeNull();
    await user.click(screen.getByRole("button", { name: conversationsCopy.createToggle }));
    expect(screen.getByLabelText("Tittel")).toBeTruthy();
  });
});
