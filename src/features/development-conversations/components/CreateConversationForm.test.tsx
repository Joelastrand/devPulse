// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conversationsCopy } from "../copy";

const createConversationMock = vi.fn();
const fetchCreateOptionsMock = vi.fn();

vi.mock("../client/conversations-gateway", () => ({
  createConversation: createConversationMock,
  fetchCreateOptions: fetchCreateOptionsMock,
}));

const { CreateConversationForm } = await import("./CreateConversationForm");

const TOKEN = "a-token";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(overrides: Partial<Parameters<typeof CreateConversationForm>[0]> = {}) {
  const props = {
    token: TOKEN,
    onUnauthenticated: vi.fn(),
    onChanged: vi.fn(async () => {}),
    ...overrides,
  };
  render(<CreateConversationForm {...props} />);
  return props;
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: conversationsCopy.createToggle }));
  return screen.findByRole("form", { name: conversationsCopy.createHeading });
}

/** The server's create options, as the gateway returns them: `{ status: "ok", response: { items, truncated } }`. */
function withMemberships(teams: { teamId: string; name: string }[] = [{ teamId: "team-a", name: "Plattform" }], truncated = false) {
  fetchCreateOptionsMock.mockResolvedValue({ status: "ok", response: { items: teams, truncated } });
}

function field(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function submitButton() {
  return screen.getByRole("button", { name: conversationsCopy.createSubmit });
}

describe("CreateConversationForm: disclosure", () => {
  it("is collapsed by default and exposes its state with aria-expanded", async () => {
    withMemberships();
    const user = userEvent.setup();
    renderForm();

    const toggle = screen.getByRole("button", { name: conversationsCopy.createToggle });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("form")).toBeNull();

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByRole("form", { name: conversationsCopy.createHeading })).toBeTruthy();
  });

  it("states that a conversation starts private with no participant, and that a team cannot be changed later", async () => {
    withMemberships();
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    expect(screen.getByText(conversationsCopy.createPrivacy)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(conversationsCopy.createTeamHint)).toBeTruthy());
  });
});

describe("CreateConversationForm: fields and validation", () => {
  it("labels every field and makes the title required", async () => {
    withMemberships();
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    expect(field(conversationsCopy.createTitleLabel).required).toBe(true);
    expect(field(conversationsCopy.plannedForLabel).getAttribute("type")).toBe("date");
  });

  it("shows a field error for an empty title and makes no request", async () => {
    withMemberships();
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await user.click(submitButton());

    expect(field(conversationsCopy.createTitleLabel).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(conversationsCopy.createTitleInvalid)).toBeTruthy();
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("rejects a title with a line separator before any request", async () => {
    withMemberships();
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    fireEvent.change(field(conversationsCopy.createTitleLabel), { target: { value: "Del én Del to" } });
    await user.click(submitButton());

    expect(screen.getByText(conversationsCopy.createTitleInvalid)).toBeTruthy();
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("rejects a planned date outside the 2020–2100 range before any request", async () => {
    withMemberships();
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    fireEvent.change(field(conversationsCopy.plannedForLabel), { target: { value: "2019-01-01" } });
    await user.click(submitButton());

    expect(field(conversationsCopy.plannedForLabel).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(conversationsCopy.createDateInvalid)).toBeTruthy();
    expect(createConversationMock).not.toHaveBeenCalled();
  });
});

describe("CreateConversationForm: team selector", () => {
  it("is absent when the owner has no active memberships", async () => {
    withMemberships([]);
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await waitFor(() => expect(fetchCreateOptionsMock).toHaveBeenCalled());
    expect(screen.queryByLabelText(conversationsCopy.teamLabel)).toBeNull();
  });

  it("lists only the owner's memberships, and sends no team when none is chosen", async () => {
    withMemberships([{ teamId: "team-a", name: "Plattform" }]);
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    const select = (await screen.findByLabelText(conversationsCopy.teamLabel)) as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Plattform" })).toBeTruthy();
    expect(select.value).toBe("");

    createConversationMock.mockResolvedValue({ status: "created", conversationId: "c1" });
    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    await user.click(submitButton());

    await waitFor(() => expect(createConversationMock).toHaveBeenCalledTimes(1));
    const [, input] = createConversationMock.mock.calls[0];
    expect(input).not.toHaveProperty("teamId");
  });

  it("sends the chosen team id as the only team input", async () => {
    withMemberships([{ teamId: "team-a", name: "Plattform" }]);
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await user.selectOptions(await screen.findByLabelText(conversationsCopy.teamLabel), "team-a");
    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    createConversationMock.mockResolvedValue({ status: "created", conversationId: "c1" });
    await user.click(submitButton());

    await waitFor(() => expect(createConversationMock).toHaveBeenCalledTimes(1));
    expect(createConversationMock).toHaveBeenCalledWith(TOKEN, { title: "Kommunikasjon", plannedFor: null, teamId: "team-a" });
  });

  it("says the team choice cannot be loaded, distinct from a complete read with no options", async () => {
    fetchCreateOptionsMock.mockResolvedValue({ status: "error", error: "persistence_failed" });
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    expect(await screen.findByText(conversationsCopy.createTeamUnavailable)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.createTeamNone)).toBeNull();
    expect(screen.queryByLabelText(conversationsCopy.teamLabel)).toBeNull();
  });

  it("reports an unauthenticated team read to the page", async () => {
    fetchCreateOptionsMock.mockResolvedValue({ status: "unauthenticated" });
    const user = userEvent.setup();
    const props = renderForm();
    await openForm(user);

    await waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
  });

  it("shows no selector while the options are still loading, never an empty list", async () => {
    fetchCreateOptionsMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    expect(screen.queryByLabelText(conversationsCopy.teamLabel)).toBeNull();
    expect(screen.queryByText(conversationsCopy.createTeamNone)).toBeNull();
    expect(screen.queryByText(conversationsCopy.createTeamUnavailable)).toBeNull();
  });

  it("says that no team can be chosen right now when a complete read has zero options, without a failure claim", async () => {
    withMemberships([]);
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    expect(await screen.findByText(conversationsCopy.createTeamNone)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.createTeamUnavailable)).toBeNull();
    expect(screen.queryByLabelText(conversationsCopy.teamLabel)).toBeNull();
  });

  it("says the list may be incomplete when the server window is truncated, and still offers the options it has", async () => {
    withMemberships([{ teamId: "team-a", name: "Plattform" }], true);
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    expect(await screen.findByLabelText(conversationsCopy.teamLabel)).toBeTruthy();
    expect(screen.getByText(conversationsCopy.createTeamTruncated)).toBeTruthy();
    expect(screen.queryByText(conversationsCopy.createTeamNone)).toBeNull();
  });

  it("ignores a team response from an earlier open after the form was closed and reopened", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchCreateOptionsMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    withMemberships([{ teamId: "team-new", name: "Nytt" }]);
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: conversationsCopy.createToggle }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.createToggle }));
    await user.click(screen.getByRole("button", { name: conversationsCopy.createToggle }));

    expect(await screen.findByRole("option", { name: "Nytt" })).toBeTruthy();
    resolveFirst({ status: "ok", response: { items: [{ teamId: "team-old", name: "Gammelt" }], truncated: false } });

    await waitFor(() => expect(screen.queryByRole("option", { name: "Gammelt" })).toBeNull());
    expect(screen.getByRole("option", { name: "Nytt" })).toBeTruthy();
  });
});

describe("CreateConversationForm: submit outcomes", () => {
  it("creates once with the trimmed title and the planned date, then closes and refreshes the list", async () => {
    withMemberships([]);
    const user = userEvent.setup();
    const props = renderForm();
    await openForm(user);

    createConversationMock.mockResolvedValue({ status: "created", conversationId: "c1" });
    await user.type(field(conversationsCopy.createTitleLabel), "  Kommunikasjon  ");
    fireEvent.change(field(conversationsCopy.plannedForLabel), { target: { value: "2026-11-03" } });
    await user.click(submitButton());

    await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
    expect(createConversationMock).toHaveBeenCalledWith(TOKEN, { title: "Kommunikasjon", plannedFor: "2026-11-03" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: conversationsCopy.createToggle }));
  });

  it("sends one create for two submit events dispatched in the same tick, before the pending render", async () => {
    // Two Enter presses or two submit events can arrive before React re-renders the disabled button. Only the synchronous
    // ref guard stops the second one, so this test fails if that guard is removed.
    withMemberships([]);
    let finish: (value: unknown) => void = () => {};
    createConversationMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderForm();
    const form = await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(createConversationMock).toHaveBeenCalledTimes(1);

    finish({ status: "created", conversationId: "c1" });
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("disables the submit button while the create is pending, so a click sends nothing", async () => {
    withMemberships([]);
    let finish: (value: unknown) => void = () => {};
    createConversationMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    await user.click(submitButton());
    const pendingButton = await screen.findByRole("button", { name: conversationsCopy.createPending });
    await user.click(pendingButton);

    expect(createConversationMock).toHaveBeenCalledTimes(1);
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

    finish({ status: "created", conversationId: "c1" });
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("keeps the form open and its controls disabled while a create is pending, so a late error never reaches a closed form", async () => {
    // Reproduces the review defect: a close during the pending create left the late error on the closed form, and the next
    // open showed it. The disclosure must not be able to close the form until the create has finished.
    withMemberships([]);
    let finish: (value: unknown) => void = () => {};
    createConversationMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderForm();
    await openForm(user);
    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    await user.click(submitButton());
    await screen.findByRole("button", { name: conversationsCopy.createPending });

    const toggle = screen.getByRole("button", { name: conversationsCopy.createToggle }) as HTMLButtonElement;
    await user.click(toggle);

    expect(screen.getByRole("form", { name: conversationsCopy.createHeading })).toBeTruthy();
    expect(toggle.disabled).toBe(true);
    expect((screen.getByRole("button", { name: conversationsCopy.cancelCreate }) as HTMLButtonElement).disabled).toBe(true);

    finish({ status: "error", error: "conversation_limit" });
    expect(await screen.findByText(conversationsCopy.createLimit)).toBeTruthy();
    expect(toggle.disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: conversationsCopy.cancelCreate }));
    expect(screen.queryByRole("form")).toBeNull();

    await user.click(toggle);
    await screen.findByRole("form", { name: conversationsCopy.createHeading });
    expect(screen.queryByText(conversationsCopy.createLimit)).toBeNull();
    expect(field(conversationsCopy.createTitleLabel).value).toBe("");
  });

  it("shows the limit message for conversation_limit and keeps the input", async () => {
    withMemberships([]);
    createConversationMock.mockResolvedValue({ status: "error", error: "conversation_limit" });
    const user = userEvent.setup();
    const props = renderForm();
    await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    await user.click(submitButton());

    expect(await screen.findByText(conversationsCopy.createLimit)).toBeTruthy();
    expect(field(conversationsCopy.createTitleLabel).value).toBe("Kommunikasjon");
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("shows the neutral invalid-input message and never the raw server text or a field name", async () => {
    withMemberships([]);
    createConversationMock.mockResolvedValue({ status: "error", error: "invalid_input" });
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    await user.click(submitButton());

    const alert = await screen.findByText(conversationsCopy.createInvalidInput);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).not.toMatch(/invalid_input|teamId|plannedFor|title/i);
  });

  it.each(["persistence_failed", "read_failed", "unknown"] as const)(
    "treats %s as an ambiguous write: neutral copy, a list re-read, and no automatic retry",
    async (error) => {
      withMemberships([]);
      createConversationMock.mockResolvedValue({ status: "error", error });
      const user = userEvent.setup();
      const props = renderForm();
      await openForm(user);

      await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
      await user.click(submitButton());

      expect(await screen.findByText(conversationsCopy.createAmbiguous)).toBeTruthy();
      await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
      expect(createConversationMock).toHaveBeenCalledTimes(1);
      expect(field(conversationsCopy.createTitleLabel).value).toBe("Kommunikasjon");
    },
  );

  it("reports an unauthenticated create to the page", async () => {
    withMemberships([]);
    createConversationMock.mockResolvedValue({ status: "unauthenticated" });
    const user = userEvent.setup();
    const props = renderForm();
    await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Kommunikasjon");
    await user.click(submitButton());

    await waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
  });
});

describe("CreateConversationForm: privacy of free text", () => {
  it("never places the title in an error message, a URL or browser storage", async () => {
    withMemberships([]);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    createConversationMock.mockResolvedValue({ status: "error", error: "persistence_failed" });
    const user = userEvent.setup();
    renderForm();
    await openForm(user);

    await user.type(field(conversationsCopy.createTitleLabel), "Hemmelig tittel");
    await user.click(submitButton());
    await screen.findByText(conversationsCopy.createAmbiguous);

    expect(document.body.textContent).not.toContain("Hemmelig tittel");
    expect(window.location.href).not.toContain("Hemmelig");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
