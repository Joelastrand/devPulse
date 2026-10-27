// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { conversationsCopy } from "../copy";

const deleteConversationMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock("../client/conversations-gateway", () => ({
  deleteConversation: deleteConversationMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const { DeleteConversationDialog } = await import("./DeleteConversationDialog");

const CONVERSATION_ID = "conv-synthetic-1";

function renderDialog(overrides: Partial<Parameters<typeof DeleteConversationDialog>[0]> = {}) {
  const props = {
    conversationId: CONVERSATION_ID,
    token: "a-token",
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<DeleteConversationDialog {...props} />);
  return props;
}

/** Opens the confirmation and returns its form (the group element is the form). */
function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton }));
  return screen.getByRole("group", { name: conversationsCopy.deleteConfirmHeading });
}

/** A request the test resolves by hand, so the pending state can be observed. */
function deferredDelete() {
  let resolve: (value: unknown) => void = () => {};
  deleteConversationMock.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  return (value: unknown) => resolve(value);
}

beforeEach(() => {
  deleteConversationMock.mockReset();
  routerReplaceMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DeleteConversationDialog: owner-only destructive control (SPEC BR-5, BR-29, BR-38; TASK-031)", () => {
  it("renders only the open control and sends nothing until the owner confirms", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton })).toBeTruthy();
    expect(screen.queryByRole("group", { name: conversationsCopy.deleteConfirmHeading })).toBeNull();
    expect(deleteConversationMock).not.toHaveBeenCalled();
  });

  it("states the consequence before confirmation: access removed, nothing kept, cannot be undone", () => {
    renderDialog();
    const group = openConfirmation();
    expect(group.textContent).toContain(conversationsCopy.deleteConsequence);
    expect(group.textContent).toContain(conversationsCopy.deleteIrreversible);
    expect(deleteConversationMock).not.toHaveBeenCalled();
  });

  it("cancel sends no DELETE, does not navigate, and returns focus to the open control", () => {
    renderDialog();
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.keepConversation }));
    expect(deleteConversationMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.deleteConversationButton }));
  });

  it("confirm sends exactly one DELETE and then leaves the detail page for the list", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "deleted" });
    const props = renderDialog();
    const group = openConfirmation();
    fireEvent.submit(group);

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/me/conversations"));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID);
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("two submits in the same tick send one DELETE (synchronous guard, not the disabled state)", async () => {
    const resolve = deferredDelete();
    renderDialog();
    const group = openConfirmation();
    act(() => {
      fireEvent.submit(group);
      fireEvent.submit(group);
    });
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    resolve({ status: "deleted" });
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledTimes(1));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
  });

  it("shows a pending state while the request is active", async () => {
    const resolve = deferredDelete();
    renderDialog();
    fireEvent.submit(openConfirmation());
    const pendingButton = await screen.findByRole("button", { name: conversationsCopy.deletingLabel });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    resolve({ status: "deleted" });
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalled());
  });

  it("not-found is treated as already gone: navigates to the list with no second DELETE", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "error", error: "conversation_not_found" });
    renderDialog();
    fireEvent.submit(openConfirmation());
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/me/conversations"));
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous failure re-reads once, never resends DELETE, and claims neither success nor failure", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());

    expect(await screen.findByText(conversationsCopy.deleteNotConfirmed)).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("an unknown outcome is ambiguous too, with the same single re-read", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "error", error: "unknown" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());
    expect(await screen.findByText(conversationsCopy.deleteNotConfirmed)).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
  });

  it("signed out: hands over to the auth path and navigates nowhere", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "unauthenticated" });
    const props = renderDialog();
    fireEvent.submit(openConfirmation());
    await waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it("uses no cancel wording and shows no raw code, identifier or conversation text", async () => {
    deleteConversationMock.mockResolvedValueOnce({ status: "error", error: "persistence_failed" });
    renderDialog();
    fireEvent.submit(openConfirmation());
    await screen.findByText(conversationsCopy.deleteNotConfirmed);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/avbryt|avlys|cancel/i);
    expect(text).not.toContain("persistence_failed");
    expect(text).not.toContain(CONVERSATION_ID);
  });
});
