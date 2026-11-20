// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conversationsCopy } from "../copy";

const createConversationMock = vi.fn();

// Only the create call is mocked. No team list exists in this gateway, so none can be requested (A2.1).
vi.mock("../client/conversations-gateway", () => ({
  fetchInvitableColleagues: async () => ({ status: "ok", response: { colleagues: [], truncated: false } }),
  createConversation: createConversationMock,
}));

const { CreateConversationForm } = await import("./CreateConversationForm");

const TOKEN = "a-token";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(overrides: Partial<Parameters<typeof CreateConversationForm>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    token: TOKEN,
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn(async () => {}),
    ...overrides,
  };
  render(<CreateConversationForm {...props} />);
  return props;
}

/** The page header owns the trigger; the form is controlled and renders its panel only while open. */
async function openForm() {
  return screen.getByRole("form", { name: conversationsCopy.createHeading });
}

describe("CreateConversationForm (A2.1: no team)", () => {
  it("renders no panel while closed, so the page header's single action is the only way in", () => {
    renderForm({ open: false });
    expect(screen.queryByRole("form", { name: conversationsCopy.createHeading })).toBeNull();
  });

  it("offers only the title and the optional planned date, with no team choice", async () => {
    renderForm();
    const form = await openForm();

    expect(form.querySelector("#create-title")).not.toBeNull();
    expect(form.querySelector("#create-planned-for")).not.toBeNull();
    expect(form.querySelector("select")).toBeNull();
  });

  it("creates with the title and date only, and re-reads the list after success", async () => {
    createConversationMock.mockResolvedValue({ status: "created", conversationId: "conv-1" });
    const props = renderForm();
    await openForm();

    await userEvent.type(screen.getByLabelText(conversationsCopy.createTitleLabel), "Synthetic conversation");
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.createSubmit }));

    await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(createConversationMock).toHaveBeenCalledWith(TOKEN, { title: "Synthetic conversation", plannedFor: null });
  });

  it("refuses an empty title on the client, with nothing sent", async () => {
    renderForm();
    await openForm();

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.createSubmit }));

    expect(await screen.findByText(conversationsCopy.createTitleInvalid)).toBeTruthy();
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("shows the invalid-input message without naming a field when the server refuses the create", async () => {
    createConversationMock.mockResolvedValue({ status: "error", error: "invalid_input" });
    renderForm();
    await openForm();

    await userEvent.type(screen.getByLabelText(conversationsCopy.createTitleLabel), "Synthetic conversation");
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.createSubmit }));

    expect(await screen.findByText(conversationsCopy.createInvalidInput)).toBeTruthy();
  });

  it("re-reads the list after an ambiguous outcome and never retries the create on its own", async () => {
    createConversationMock.mockResolvedValue({ status: "error", error: "read_failed" });
    const props = renderForm();
    await openForm();

    await userEvent.type(screen.getByLabelText(conversationsCopy.createTitleLabel), "Synthetic conversation");
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.createSubmit }));

    expect(await screen.findByText(conversationsCopy.createAmbiguous)).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(createConversationMock).toHaveBeenCalledTimes(1);
  });
});
