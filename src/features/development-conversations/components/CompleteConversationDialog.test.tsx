// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { conversationsCopy } from "../copy";

const updateConversationMock = vi.fn();

vi.mock("../client/conversations-gateway", () => ({
  updateConversation: updateConversationMock,
}));

const { CompleteConversationDialog } = await import("./CompleteConversationDialog");

const CONVERSATION_ID = "conv-synthetic-1";

function renderDialog(overrides: Partial<Parameters<typeof CompleteConversationDialog>[0]> = {}) {
  const props = {
    conversationId: CONVERSATION_ID,
    token: "a-token",
    participantState: "none" as const,
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<CompleteConversationDialog {...props} />);
  return props;
}

/** Opens the confirmation and returns its form (the group element is the form). */
function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: conversationsCopy.completeConversationButton }));
  return screen.getByRole("group", { name: conversationsCopy.completeConfirmHeading });
}

/** A request the test resolves by hand, so the pending state can be observed. */
function deferredUpdate() {
  let resolve: (value: unknown) => void = () => {};
  updateConversationMock.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  return (value: unknown) => resolve(value);
}

beforeEach(() => {
  updateConversationMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CompleteConversationDialog: owner completion (SPEC BR-4, BR-13, BR-28, CL-25; TASK-031)", () => {
  it("renders only the open control and sends nothing until the owner confirms", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: conversationsCopy.completeConversationButton })).toBeTruthy();
    expect(screen.queryByRole("group", { name: conversationsCopy.completeConfirmHeading })).toBeNull();
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("states that content becomes read-only, cannot be reopened, and what remains available", () => {
    renderDialog();
    const group = openConfirmation();
    expect(group.textContent).toContain(conversationsCopy.completeReadOnly);
    expect(group.textContent).toContain(conversationsCopy.completeNoReopen);
    expect(group.textContent).toContain(conversationsCopy.completeRemovalStillAvailable);
    expect(group.textContent).toContain(conversationsCopy.completeUnsavedLost);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("a pending invitation is stated as withdrawn, and an accepted participant as keeping access", () => {
    const { unmount } = render(
      <CompleteConversationDialog
        conversationId={CONVERSATION_ID}
        token="a-token"
        participantState="pending"
        onUnauthenticated={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    expect(openConfirmation().textContent).toContain(conversationsCopy.completePendingWithdrawn);
    unmount();
    cleanup();

    renderDialog({ participantState: "accepted" });
    const group = openConfirmation();
    expect(group.textContent).toContain(conversationsCopy.completeAcceptedKeeps);
    expect(group.textContent).not.toContain(conversationsCopy.completePendingWithdrawn);
  });

  it("cancel sends no request, and returns focus to the open control", () => {
    renderDialog();
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.keepOpen }));
    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.completeConversationButton }));
  });

  it("confirm sends exactly one status PATCH and re-reads the authoritative conversation", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "saved" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());

    await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, { status: "completed" });
  });

  it("two submits in the same tick send one PATCH (synchronous guard, not the disabled state)", async () => {
    const resolve = deferredUpdate();
    const props = renderDialog();
    const group = openConfirmation();
    act(() => {
      fireEvent.submit(group);
      fireEvent.submit(group);
    });
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    resolve({ status: "saved" });
    await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("shows the in-progress label and a disabled control while the request is active", async () => {
    const resolve = deferredUpdate();
    renderDialog();
    fireEvent.submit(openConfirmation());
    const pendingButton = await screen.findByRole("button", { name: conversationsCopy.completing });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    resolve({ status: "saved" });
    await waitFor(() => expect(screen.queryByRole("button", { name: conversationsCopy.completing })).toBeNull());
  });

  it("an ambiguous failure re-reads once, never resends the PATCH, and claims neither outcome", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());

    expect(await screen.findByText(conversationsCopy.completeNotConfirmed)).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("an already-completed refusal re-reads once and says the conversation is finished", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "error", error: "invalid_transition" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());

    expect(await screen.findByText(conversationsCopy.completeAlreadyDone)).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(updateConversationMock).toHaveBeenCalledTimes(1);
  });

  it("a not-found refusal re-reads once and shows the stable copy, with no raw code", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "error", error: "conversation_not_found" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());

    expect(await screen.findByText(conversationsCopy.writeNotFound)).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("conversation_not_found");
  });

  it("signed out: hands over to the auth path and does not re-read", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "unauthenticated" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());
    await waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("uses no cancel wording and shows no raw code or identifier", async () => {
    updateConversationMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    renderDialog();
    fireEvent.submit(openConfirmation());
    await screen.findByText(conversationsCopy.completeNotConfirmed);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/avbryt|avlys|cancel/i);
    expect(text).not.toContain("persistence_failed");
    expect(text).not.toContain(CONVERSATION_ID);
  });
});
