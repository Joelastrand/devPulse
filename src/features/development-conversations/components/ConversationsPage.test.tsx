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
  await screen.findByRole("heading", { level: 2, name: conversationsCopy.participatingHeading });
}

describe("ConversationsPage states", () => {
  it("signed out: shows a sign-in link and makes no request", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<ConversationsPage />);
    expect((await screen.findByRole("link", { name: conversationsCopy.signInLink })).getAttribute("href")).toBe("/sign-in");
    expect(fetchConversationListMock).not.toHaveBeenCalled();
  });

  it("loading: shows a loading status while the list request is pending", () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchConversationListMock.mockReturnValue(new Promise(() => {}));
    render(<ConversationsPage />);
    expect(screen.getByText(conversationsCopy.loading)).toBeTruthy();
    expect(fetchConversationListMock).toHaveBeenCalledWith("a-token");
  });

  it("empty: shows one empty state and no section headings when nothing is owned or participated", async () => {
    signedInWith({ status: "ok", response: list() });
    render(<ConversationsPage />);
    expect(await screen.findByText(conversationsCopy.empty)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: conversationsCopy.ownedHeading })).toBeNull();
    expect(screen.queryByRole("heading", { name: conversationsCopy.participatingHeading })).toBeNull();
  });

  it("empty: the create disclosure is still offered, collapsed, so a new owner can start a conversation", async () => {
    signedInWith({ status: "ok", response: list() });
    render(<ConversationsPage />);
    const toggle = await screen.findByRole("button", { name: conversationsCopy.createToggle });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("form", { name: conversationsCopy.createHeading })).toBeNull();
  });

  it("populated: renders owned summaries with status and participant state, in the server order", async () => {
    await renderReady(
      list({
        owned: {
          items: [
            summary({ conversationId: "conv-1", title: "Første samtale", participant: { state: "accepted", displayName: "Kari" } }),
            summary({ conversationId: "conv-2", title: "Andre samtale", status: "completed", plannedFor: null }),
          ],
          truncated: false,
        },
      }),
    );
    const section = screen.getByRole("region", { name: conversationsCopy.ownedHeading });
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Første samtale");
    expect(items[0]?.textContent).toContain(conversationsCopy.participantStateLabel.accepted);
    expect(items[0]?.textContent).toContain("Kari");
    expect(items[1]?.textContent).toContain("Andre samtale");
    expect(items[1]?.textContent).toContain(conversationsCopy.statusLabel.completed);
  });

  it("populated: a pending participation shows 'Venter på svar', no title and an open link", async () => {
    // The title is non-null here on purpose: the component must hide it for a pending entry even if one arrives.
    await renderReady(
      list({
        participating: {
          items: [participation({ conversationId: "pend-1", state: "pending", title: "Skjult tittel", teamName: "Plattform" })],
          truncated: false,
        },
      }),
    );
    const section = screen.getByRole("region", { name: conversationsCopy.participatingHeading });
    expect(within(section).getByText(conversationsCopy.pendingBadge)).toBeTruthy();
    const link = within(section).getByRole("link", { name: conversationsCopy.openPendingName("Plattform") });
    expect(link.getAttribute("href")).toBe("/me/conversations/pend-1");
    expect(section.textContent).not.toContain("Skjult tittel");
    expect(section.textContent).not.toContain(conversationsCopy.titleUnavailable);
  });

  it("an owner title and an accepted participant title each link to their detail page", async () => {
    await renderReady(
      list({
        owned: { items: [summary({ conversationId: "conv-1" })], truncated: false },
        participating: { items: [participation()], truncated: false },
      }),
    );
    const owned = screen.getByRole("region", { name: conversationsCopy.ownedHeading });
    const participating = screen.getByRole("region", { name: conversationsCopy.participatingHeading });
    expect(within(owned).getByRole("link", { name: "Kommunikasjon i prosjekter" }).getAttribute("href")).toBe("/me/conversations/conv-1");
    // TASK-030: the accepted participant title opens the participant view, with the encoded id as its route.
    expect(within(participating).getByRole("link", { name: "Veiledning i kodegjennomgang" }).getAttribute("href")).toBe("/me/conversations/part-1");
  });

  it("owned recovery-only list: shows the recovery region and does not claim there are no conversations", async () => {
    await renderReady(
      list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }),
    );
    expect(screen.getByRole("region", { name: conversationsCopy.recoveryHeading })).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.ownedEmpty)).toBeNull();
    expect(screen.queryByRole("heading", { name: conversationsCopy.ownedHeading })).toBeNull();
  });

  it("populated: an accepted participation shows its title and team", async () => {
    await renderReady(list({ participating: { items: [participation()], truncated: false } }));
    const section = screen.getByRole("region", { name: conversationsCopy.participatingHeading });
    expect(within(section).getByText("Veiledning i kodegjennomgang")).toBeTruthy();
    expect(section.textContent).toContain("Plattform");
  });

  it("populated: a section with no items shows its own neutral line", async () => {
    await renderReady(
      list({ owned: { items: [summary()], truncated: false }, participating: { items: [], truncated: false } }),
    );
    const section = screen.getByRole("region", { name: conversationsCopy.participatingHeading });
    expect(within(section).getByText(conversationsCopy.participatingEmpty)).toBeTruthy();
  });

  it("truncated owned list: shows the bounded truncation message", async () => {
    await renderReady(list({ owned: { items: [summary()], truncated: true } }));
    expect(screen.getByText(conversationsCopy.truncatedNotice)).toBeTruthy();
  });

  it("truncated participation list: shows the bounded truncation message", async () => {
    await renderReady(list({ participating: { items: [participation()], truncated: true } }));
    expect(screen.getByText(conversationsCopy.truncatedNotice)).toBeTruthy();
  });

  it("read_failed: shows the load error and retry re-issues the GET", async () => {
    signedInWith({ status: "error", error: "read_failed" }, { status: "ok", response: list() });
    render(<ConversationsPage />);
    expect(await screen.findByText(conversationsCopy.loadError)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.empty)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.retryButton }));
    expect(await screen.findByText(conversationsCopy.empty)).toBeTruthy();
    expect(fetchConversationListMock).toHaveBeenCalledTimes(2);
  });

  it("persistence_failed: shows the same load error copy and no content", async () => {
    signedInWith({ status: "error", error: "persistence_failed" });
    render(<ConversationsPage />);
    expect(await screen.findByText(conversationsCopy.loadError)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: conversationsCopy.ownedHeading })).toBeNull();
  });
});

describe("ConversationsPage recovery region", () => {
  it("shows neutral text and exactly one delete action per recovery item, with no content", async () => {
    await renderReady(
      list({
        owned: {
          items: [{ kind: "recovery", item: { conversationId: "bad-1" } }, { kind: "recovery", item: { conversationId: "bad-2" } }],
          truncated: false,
        },
      }),
    );
    const region = screen.getByRole("region", { name: conversationsCopy.recoveryHeading });
    expect(within(region).getByText(conversationsCopy.recoveryNotice(2))).toBeTruthy();
    const deleteButtons = within(region).getAllByRole("button");
    expect(deleteButtons).toHaveLength(2);
    for (const button of deleteButtons) expect(button.textContent).toBe(conversationsCopy.deleteButton);
    expect(within(region).queryByRole("link")).toBeNull();
    expect(region.textContent).not.toContain("bad-1");
    expect(region.textContent).not.toContain("bad-2");
    // Identifiers must not leak through attributes either (aria-labels, hrefs, data attributes).
    expect(region.innerHTML).not.toContain("bad-1");
    expect(region.innerHTML).not.toContain("bad-2");
  });

  it("deletes after confirmation, then re-reads the authoritative list", async () => {
    signedInWith(
      { status: "ok", response: list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }) },
      { status: "ok", response: list() },
    );
    deleteConversationMock.mockResolvedValue({ status: "deleted" });
    render(<ConversationsPage />);
    const region = await screen.findByRole("region", { name: conversationsCopy.recoveryHeading });

    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) }));
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.deleteConfirmButton }));

    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledWith("a-token", "bad-1");
    expect(await screen.findByText(conversationsCopy.empty)).toBeTruthy();
    expect(fetchConversationListMock).toHaveBeenCalledTimes(2);
  });

  it("keep closes the confirmation and sends nothing, and the dismiss never uses cancel wording (SPEC BR-5)", async () => {
    await renderReady(list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }));
    const region = screen.getByRole("region", { name: conversationsCopy.recoveryHeading });
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) }));
    // Regression pin: the conversation-delete dismiss must not be the shared "Avbryt" label.
    expect(within(region).queryByRole("button", { name: conversationsCopy.cancelButton })).toBeNull();
    expect(within(region).queryByRole("button", { name: /avbryt/i })).toBeNull();
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.keepConversation }));
    expect(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) })).toBeTruthy();
    expect(deleteConversationMock).not.toHaveBeenCalled();
  });

  it("unknown outcome: never says nothing was saved, never retries, and re-reads only on user request", async () => {
    await renderReady(list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }));
    deleteConversationMock.mockResolvedValue({ status: "error", error: "unknown" });
    const region = screen.getByRole("region", { name: conversationsCopy.recoveryHeading });
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) }));
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.deleteConfirmButton }));

    expect(await within(region).findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(conversationsCopy.deleteFailed);
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationListMock).toHaveBeenCalledTimes(1);
  });

  it("read_failed on delete is treated as an uncertain outcome, not as a confirmed failure to save", async () => {
    await renderReady(list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }));
    deleteConversationMock.mockResolvedValue({ status: "error", error: "read_failed" });
    const region = screen.getByRole("region", { name: conversationsCopy.recoveryHeading });
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) }));
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.deleteConfirmButton }));
    expect(await screen.findByText(conversationsCopy.deleteFailed)).toBeTruthy();
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
  });

  it("conversation_not_found on delete shows neutral copy and re-reads the list", async () => {
    signedInWith(
      { status: "ok", response: list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }) },
      { status: "ok", response: list() },
    );
    deleteConversationMock.mockResolvedValue({ status: "error", error: "conversation_not_found" });
    render(<ConversationsPage />);
    const region = await screen.findByRole("region", { name: conversationsCopy.recoveryHeading });
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) }));
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.deleteConfirmButton }));
    expect(await screen.findByText(conversationsCopy.empty)).toBeTruthy();
    expect(fetchConversationListMock).toHaveBeenCalledTimes(2);
  });

  it("a delete that is in flight disables the confirm action, so a second click sends nothing", async () => {
    await renderReady(list({ owned: { items: [{ kind: "recovery", item: { conversationId: "bad-1" } }], truncated: false } }));
    deleteConversationMock.mockReturnValue(new Promise(() => {}));
    const region = screen.getByRole("region", { name: conversationsCopy.recoveryHeading });
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.recoveryDeleteButtonName(1, 1) }));
    const confirm = within(region).getByRole("button", { name: conversationsCopy.deleteConfirmButton });
    await userEvent.click(confirm);
    await waitFor(() => expect(within(region).getByRole("button", { name: conversationsCopy.deletingLabel })).toHaveProperty("disabled", true));
    await userEvent.click(within(region).getByRole("button", { name: conversationsCopy.deletingLabel }));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationsPage copy", () => {
  it("never renders forbidden performance or surveillance terms in the list copy", async () => {
    await renderReady(
      list({
        owned: { items: [summary()], truncated: true },
        participating: { items: [participation({ state: "pending", title: null })], truncated: true },
      }),
    );
    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const term of ["score", "rating", "vurdering", "rangering", "prestasjon", "ytelse", "på sporet"]) {
      expect(text).not.toContain(term);
    }
  });
});
