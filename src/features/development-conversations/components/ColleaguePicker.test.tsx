// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationsCopy } from "../copy";
import { fetchInvitableColleagues } from "../client/conversations-gateway";
import { ColleaguePicker } from "./ColleaguePicker";

vi.mock("../client/conversations-gateway", () => ({
  fetchInvitableColleagues: vi.fn(),
}));

// Synthetic fixtures only (invariant 15). Names and references are fictional.
const TOKEN = "synthetic-token";
const ANNA_REF = "0123456789abcdefghjkmnpqrs";
const KARI_A_REF = "abcdefghjkmnpqrstvwxyz0123";
const KARI_B_REF = "abcdefghjkmnpqrstvwxyz0124";
const NAMELESS_REF = "9876543210zyxwvtsrqpnmkjhg";

const fetchMock = vi.mocked(fetchInvitableColleagues);

function renderPicker(overrides: Partial<Parameters<typeof ColleaguePicker>[0]> = {}) {
  const props = {
    token: TOKEN,
    pending: false,
    onInvite: vi.fn(),
    onUnauthenticated: vi.fn(),
    ...overrides,
  };
  render(<ColleaguePicker {...props} />);
  return props;
}

/** The list is collapsed until the person asks for it (search also opens it). A test that needs the choices opens it first. */
async function browseColleagues() {
  fireEvent.click(await screen.findByRole("button", { name: conversationsCopy.colleagueBrowseButton }));
}

function listedWith(colleagues: Array<{ memberRef: string; displayName: string | null }>, truncated = false) {
  fetchMock.mockResolvedValueOnce({ status: "ok", response: { colleagues, truncated } });
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("ColleaguePicker: the invitation source (A2.1 revised, BR-9)", () => {
  it("shows a loading state, then each colleague as a named radio choice", async () => {
    listedWith([
      { memberRef: ANNA_REF, displayName: "Anna Synthetic" },
      { memberRef: NAMELESS_REF, displayName: null },
    ]);
    renderPicker();

    expect(screen.getByText(conversationsCopy.colleagueListLoading)).toBeTruthy();
    await browseColleagues();
    expect(await screen.findByRole("radio", { name: "Anna Synthetic" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: conversationsCopy.colleagueUnnamedOption })).toBeTruthy();
  });

  it("lists duplicate names as separate choices", async () => {
    listedWith([
      { memberRef: KARI_A_REF, displayName: "Kari Fiction" },
      { memberRef: KARI_B_REF, displayName: "Kari Fiction" },
    ]);
    renderPicker();

    await browseColleagues();
    expect(await screen.findAllByRole("radio", { name: "Kari Fiction" })).toHaveLength(2);
  });

  it("filters by display name, and a search with no match says so", async () => {
    listedWith([
      { memberRef: ANNA_REF, displayName: "Anna Synthetic" },
      { memberRef: KARI_A_REF, displayName: "Kari Fiction" },
    ]);
    renderPicker();
    await browseColleagues();
    await screen.findByRole("radio", { name: "Anna Synthetic" });

    fireEvent.change(screen.getByRole("searchbox", { name: conversationsCopy.colleagueSearchLabel }), { target: { value: "kar" } });
    expect(screen.queryByRole("radio", { name: "Anna Synthetic" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Kari Fiction" })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: conversationsCopy.colleagueSearchLabel }), { target: { value: "zzz" } });
    expect(screen.getByText(conversationsCopy.colleagueSearchEmpty)).toBeTruthy();
  });

  it("keeps the send control disabled until a colleague is chosen, then sends only that opaque reference", async () => {
    listedWith([
      { memberRef: ANNA_REF, displayName: "Anna Synthetic" },
      { memberRef: KARI_A_REF, displayName: "Kari Fiction" },
    ]);
    const props = renderPicker();
    await browseColleagues();
    await screen.findByRole("radio", { name: "Anna Synthetic" });
    const send = screen.getByRole("button", { name: conversationsCopy.colleagueInviteSubmit });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Kari Fiction" }));
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    expect(props.onInvite).toHaveBeenCalledWith(KARI_A_REF);
  });

  it("drops the choice when the search hides it, so the send can never target a colleague the user cannot see", async () => {
    listedWith([
      { memberRef: ANNA_REF, displayName: "Anna Synthetic" },
      { memberRef: KARI_A_REF, displayName: "Kari Fiction" },
    ]);
    const props = renderPicker();
    await browseColleagues();
    await screen.findByRole("radio", { name: "Anna Synthetic" });
    fireEvent.click(screen.getByRole("radio", { name: "Anna Synthetic" }));

    fireEvent.change(screen.getByRole("searchbox", { name: conversationsCopy.colleagueSearchLabel }), { target: { value: "kari" } });
    const send = screen.getByRole("button", { name: conversationsCopy.colleagueInviteSubmit });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(props.onInvite).not.toHaveBeenCalled();
  });

  it("shows the empty copy when the caller has no colleague to invite", async () => {
    listedWith([]);
    renderPicker();
    expect(await screen.findByText(conversationsCopy.colleagueListEmpty)).toBeTruthy();
  });

  it("says the list is truncated when a bound was reached", async () => {
    listedWith([{ memberRef: ANNA_REF, displayName: "Anna Synthetic" }], true);
    renderPicker();
    expect(await screen.findByText(conversationsCopy.colleagueListTruncated)).toBeTruthy();
  });

  it("shows the stable error copy when the list cannot be read, and no choices", async () => {
    fetchMock.mockResolvedValueOnce({ status: "error", error: "read_failed" });
    renderPicker();
    expect(await screen.findByText(conversationsCopy.colleagueListError)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("hands an unauthenticated response to the sign-in route, and shows no list", async () => {
    fetchMock.mockResolvedValueOnce({ status: "unauthenticated" });
    const props = renderPicker();
    await waitFor(() => expect(props.onUnauthenticated).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("disables the send control while another owner write is in flight", async () => {
    listedWith([{ memberRef: ANNA_REF, displayName: "Anna Synthetic" }]);
    renderPicker({ pending: true });
    await browseColleagues();
    await screen.findByRole("radio", { name: "Anna Synthetic" });
    fireEvent.click(screen.getByRole("radio", { name: "Anna Synthetic" }));
    expect((screen.getByRole("button", { name: conversationsCopy.colleagueInviteSubmit }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("states what the invitation means before it is sent (BR-38)", async () => {
    listedWith([{ memberRef: ANNA_REF, displayName: "Anna Synthetic" }]);
    renderPicker();
    await browseColleagues();
    await screen.findByRole("radio", { name: "Anna Synthetic" });
    expect(screen.getByRole("heading", { name: conversationsCopy.inviteConfirmHeading })).toBeTruthy();
  });
});

describe("ColleaguePicker: show and hide the colleague list", () => {
  it("starts collapsed, and the toggle reports its state and changes its label", async () => {
    listedWith([{ memberRef: ANNA_REF, displayName: "Anna Synthetic" }]);
    renderPicker();
    const browse = await screen.findByRole("button", { name: conversationsCopy.colleagueBrowseButton });
    expect(browse.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radio", { name: "Anna Synthetic" })).toBeNull();

    fireEvent.click(browse);
    const hide = screen.getByRole("button", { name: conversationsCopy.colleagueHideButton });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByRole("radio", { name: "Anna Synthetic" })).toBeTruthy();

    fireEvent.click(hide);
    expect(screen.getByRole("button", { name: conversationsCopy.colleagueBrowseButton }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radio", { name: "Anna Synthetic" })).toBeNull();
  });

  it("hiding the list keeps the search text, and a new query shows its matches again", async () => {
    listedWith([
      { memberRef: ANNA_REF, displayName: "Anna Synthetic" },
      { memberRef: KARI_A_REF, displayName: "Kari Fiction" },
    ]);
    renderPicker();
    await screen.findByRole("button", { name: conversationsCopy.colleagueBrowseButton });
    const search = screen.getByRole("searchbox", { name: conversationsCopy.colleagueSearchLabel }) as HTMLInputElement;

    fireEvent.change(search, { target: { value: "Anna" } });
    expect(await screen.findByRole("radio", { name: "Anna Synthetic" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.colleagueHideButton }));
    expect(search.value).toBe("Anna");

    fireEvent.change(search, { target: { value: "Kari" } });
    expect(await screen.findByRole("radio", { name: "Kari Fiction" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Anna Synthetic" })).toBeNull();
  });

  it("a colleague chosen before the list is hidden cannot be sent while it is hidden", async () => {
    listedWith([{ memberRef: ANNA_REF, displayName: "Anna Synthetic" }]);
    const props = renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: conversationsCopy.colleagueBrowseButton }));
    fireEvent.click(await screen.findByRole("radio", { name: "Anna Synthetic" }));
    expect((screen.getByRole("button", { name: conversationsCopy.colleagueInviteSubmit }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.colleagueHideButton }));
    const send = screen.getByRole("button", { name: conversationsCopy.colleagueInviteSubmit }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(props.onInvite).not.toHaveBeenCalled();
  });
});
