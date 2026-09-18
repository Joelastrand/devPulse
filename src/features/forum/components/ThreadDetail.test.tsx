// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchThreadDetailMock = vi.fn();
const fetchOwnAdminStatusMock = vi.fn();
const deleteThreadMock = vi.fn();
const deleteReplyMock = vi.fn();
const createReplyMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../../teams/client/own-admin-status-gateway", () => ({
  fetchOwnAdminStatus: fetchOwnAdminStatusMock,
}));

vi.mock("../client/forum-gateway", () => ({
  fetchThreadDetail: fetchThreadDetailMock,
  deleteThread: deleteThreadMock,
  deleteReply: deleteReplyMock,
  createReply: createReplyMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

const { ThreadDetail } = await import("./ThreadDetail");

const NOT_ADMIN = { ok: true, isAdmin: false };
const IS_ADMIN = { ok: true, isAdmin: true };

const OWN_THREAD = {
  threadId: "thread-1",
  title: "Har noen løst byggeproblemet?",
  body: "Bygget feiler stadig på CI.",
  authorTag: "48D73D",
  isOwnThread: true,
  createdAt: "2026-01-10T10:00:00.000Z",
};

const OTHERS_THREAD = { ...OWN_THREAD, isOwnThread: false };

const ACTIVE_REPLY = {
  replyId: "reply-1",
  isDeleted: false as const,
  body: "Prøv å rydde cache-mappen.",
  authorTag: "AA11BB",
  isOwnReply: false,
  createdAt: "2026-01-10T11:00:00.000Z",
};

const OWN_ACTIVE_REPLY = {
  ...ACTIVE_REPLY,
  replyId: "reply-2",
  body: "Jeg fikset det ved å slette node_modules.",
  isOwnReply: true,
};

const TOMBSTONED_REPLY = {
  replyId: "reply-3",
  isDeleted: true as const,
  body: null,
  authorTag: null,
  isOwnReply: false,
  createdAt: "2026-01-10T12:00:00.000Z",
};

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

function capturingObserver() {
  let callback: ((token: string | null) => void) | null = null;
  observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
    callback = cb;
    return () => {};
  });
  return {
    emit(token: string | null) {
      callback?.(token);
    },
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ThreadDetail", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchThreadDetailMock.mockReset();
    fetchOwnAdminStatusMock.mockReset();
    deleteThreadMock.mockReset();
    deleteReplyMock.mockReset();
    createReplyMock.mockReset();
    routerPushMock.mockReset();
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows a sign-in prompt when signed out", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("renders the thread title, body, authorTag, and replies in order for an authorized reader", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: OTHERS_THREAD,
      replies: [ACTIVE_REPLY, TOMBSTONED_REPLY],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("heading", { name: OTHERS_THREAD.title })).toBeTruthy();
    expect(screen.getByText(OTHERS_THREAD.body)).toBeTruthy();
    expect(screen.getByText(ACTIVE_REPLY.body)).toBeTruthy();
    expect(fetchThreadDetailMock).toHaveBeenCalledWith("a-token", "team-1", "thread-1");
  });

  it("renders a deleted reply as the fixed placeholder, never the original content or an author tag", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: OTHERS_THREAD,
      replies: [TOMBSTONED_REPLY],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByText(/innlegget er fjernet/i)).toBeTruthy();
  });

  it("collapses not_found and forbidden into the same generic non-sensitive state", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    fetchThreadDetailMock.mockResolvedValueOnce({ status: "not_found" });
    const { unmount } = render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    const notFoundMessage = await screen.findByText(/fant ikke tråden/i);
    unmount();

    fetchThreadDetailMock.mockResolvedValueOnce({ status: "forbidden" });
    render(<ThreadDetail teamId="team-1" threadId="thread-2" />);
    const forbiddenMessage = await screen.findByText(/fant ikke tråden/i);

    expect(forbiddenMessage.textContent).toBe(notFoundMessage.textContent);
  });

  it("shows a distinct infrastructure-failure message for read_failed", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "read_failed" });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("shows the delete action to the thread's own author, and it is absent for a non-owner, non-admin caller", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: OWN_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("button", { name: /^slett tråd$/i })).toBeTruthy();
  });

  it("hides the thread delete action from a caller who is neither the owner nor an admin (defense in depth)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: OTHERS_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    await screen.findByRole("heading", { name: OTHERS_THREAD.title });
    expect(screen.queryByRole("button", { name: /^slett tråd$/i })).toBeNull();
  });

  it("shows the thread delete action to an app admin even without owning the thread", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: OTHERS_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(IS_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("button", { name: /^slett tråd$/i })).toBeTruthy();
  });

  it("requires explicit confirmation, mentioning replies are also removed, before deleting the thread", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: OWN_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    const user = userEvent.setup();
    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await user.click(await screen.findByRole("button", { name: /^slett tråd$/i }));

    expect(screen.getByText(/alle svarene slettes permanent/i)).toBeTruthy();
    expect(deleteThreadMock).not.toHaveBeenCalled();
  });

  it("deletes the thread on confirmation and redirects to the team page", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: OWN_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    deleteThreadMock.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await user.click(await screen.findByRole("button", { name: /^slett tråd$/i }));
    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));

    await waitFor(() => expect(deleteThreadMock).toHaveBeenCalledWith("a-token", "team-1", "thread-1"));
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/teams/team-1"));
  });

  it("shows the delete action on a reply to its own author, and hides it for a non-owner, non-admin caller", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: OTHERS_THREAD,
      replies: [ACTIVE_REPLY, OWN_ACTIVE_REPLY],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByText(ACTIVE_REPLY.body);

    const deleteButtons = screen.getAllByRole("button", { name: /^slett svar/i });
    expect(deleteButtons).toHaveLength(1);
  });

  it("tombstones a reply on confirmation and re-fetches the thread to show the placeholder", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock
      .mockResolvedValueOnce({ status: "ok", thread: OTHERS_THREAD, replies: [OWN_ACTIVE_REPLY] })
      .mockResolvedValueOnce({
        status: "ok",
        thread: OTHERS_THREAD,
        replies: [{ ...TOMBSTONED_REPLY, replyId: OWN_ACTIVE_REPLY.replyId }],
      });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    deleteReplyMock.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByText(OWN_ACTIVE_REPLY.body);

    await user.click(screen.getByRole("button", { name: /^slett svar/i }));
    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));

    await waitFor(() =>
      expect(deleteReplyMock).toHaveBeenCalledWith("a-token", "team-1", "thread-1", OWN_ACTIVE_REPLY.replyId),
    );
    expect(await screen.findByText(/innlegget er fjernet/i)).toBeTruthy();
    expect(screen.queryByText(OWN_ACTIVE_REPLY.body)).toBeNull();
  });

  it("tolerates a retry returning success for an already-tombstoned reply (BR-27) without erroring", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: OTHERS_THREAD,
      replies: [OWN_ACTIVE_REPLY],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    // The server treats a retry against an already-tombstoned reply as an
    // idempotent success (BR-27) — the client never distinguishes this from
    // a first-time delete, and never reconstructs the erased author identity.
    deleteReplyMock.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByText(OWN_ACTIVE_REPLY.body);

    await user.click(screen.getByRole("button", { name: /^slett svar/i }));
    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));

    await waitFor(() => expect(deleteReplyMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a reply form for a real member and refreshes the thread on a successful reply", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock
      .mockResolvedValueOnce({ status: "ok", thread: OTHERS_THREAD, replies: [] })
      .mockResolvedValueOnce({ status: "ok", thread: OTHERS_THREAD, replies: [ACTIVE_REPLY] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    createReplyMock.mockResolvedValue({ status: "ok" });

    const user = userEvent.setup();
    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByRole("heading", { name: OTHERS_THREAD.title });

    await user.type(screen.getByRole("textbox", { name: "Svar" }), "Et nytt svar på tråden.");
    await user.click(screen.getByRole("button", { name: /^send svar$/i }));

    await waitFor(() => expect(fetchThreadDetailMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(ACTIVE_REPLY.body)).toBeTruthy();
  });

  it("discards a stale thread-detail response once the caller has signed out before it resolves", async () => {
    const observer = capturingObserver();
    let resolveDetail: (value: unknown) => void = () => {};
    fetchThreadDetailMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    observer.emit("a-token");

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveDetail({ status: "ok", thread: OTHERS_THREAD, replies: [] });
    await flushMicrotasks();

    expect(screen.queryByRole("heading", { name: OTHERS_THREAD.title })).toBeNull();
  });

  it("discards a stale thread-detail response once navigation moved to a different thread", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchThreadDetailMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: "ok", thread: { ...OTHERS_THREAD, threadId: "thread-2", title: "En annen tråd" }, replies: [] });
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    const { rerender } = render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    rerender(<ThreadDetail teamId="team-1" threadId="thread-2" />);
    await screen.findByRole("heading", { name: "En annen tråd" });

    resolveFirst({ status: "ok", thread: OTHERS_THREAD, replies: [] });
    await flushMicrotasks();

    expect(screen.queryByRole("heading", { name: OTHERS_THREAD.title })).toBeNull();
    expect(screen.getByRole("heading", { name: "En annen tråd" })).toBeTruthy();
  });

  it("discards a stale post-reply refresh once the caller has signed out before it resolves (BR-46)", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchThreadDetailMock.mockResolvedValueOnce({ status: "ok", thread: OTHERS_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    createReplyMock.mockResolvedValue({ status: "ok" });
    let resolveRefresh: (value: unknown) => void = () => {};
    fetchThreadDetailMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    observer.emit("a-token");
    await screen.findByRole("heading", { name: OTHERS_THREAD.title });

    await user.type(screen.getByRole("textbox", { name: "Svar" }), "Et nytt svar på tråden.");
    await user.click(screen.getByRole("button", { name: /^send svar$/i }));
    await screen.findByText(/svaret ditt ble lagt til/i);

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveRefresh({ status: "ok", thread: OTHERS_THREAD, replies: [ACTIVE_REPLY] });
    await flushMicrotasks();

    expect(screen.queryByText(ACTIVE_REPLY.body)).toBeNull();
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("discards a stale delete-thread response once the caller has signed out before it resolves (BR-46)", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: OWN_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    let resolveDelete: (value: unknown) => void = () => {};
    deleteThreadMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    observer.emit("a-token");
    await user.click(await screen.findByRole("button", { name: /^slett tråd$/i }));
    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveDelete({ ok: true });
    await flushMicrotasks();

    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("discards a stale delete-reply response once the caller has signed out before it resolves (BR-46)", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: OTHERS_THREAD,
      replies: [OWN_ACTIVE_REPLY],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);
    let resolveDelete: (value: unknown) => void = () => {};
    deleteReplyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    observer.emit("a-token");
    await screen.findByText(OWN_ACTIVE_REPLY.body);
    await user.click(screen.getByRole("button", { name: /^slett svar/i }));
    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveDelete({ ok: true });
    await flushMicrotasks();

    // Never re-fetches (and therefore never renders a tombstone) on behalf of a superseded auth state.
    expect(fetchThreadDetailMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("renders HTML/script-shaped thread and reply content as inert literal text (stored-XSS regression)", async () => {
    const xssPayload = '<img src=x onerror="window.__forumXss = true">';
    (window as unknown as { __forumXss?: boolean }).__forumXss = undefined;

    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: { ...OTHERS_THREAD, title: xssPayload, body: xssPayload },
      replies: [{ ...ACTIVE_REPLY, body: xssPayload }],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(NOT_ADMIN);

    const { container } = render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findAllByText(xssPayload);

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.textContent).toContain(xssPayload);
    expect((window as unknown as { __forumXss?: boolean }).__forumXss).not.toBe(true);
  });

  it("never renders an identity-shaped value (authorUid/deletedBy/ciphertext) anywhere on the page", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: OWN_THREAD,
      replies: [ACTIVE_REPLY, TOMBSTONED_REPLY],
    });
    fetchOwnAdminStatusMock.mockResolvedValue(IS_ADMIN);

    const { container } = render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByText(ACTIVE_REPLY.body);

    expect(container.textContent).not.toMatch(/authorUid|deletedBy|ciphertext|\biv\b|keyVersion/i);
  });
});
