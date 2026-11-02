// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// TASK-015: the erased-thread placeholder renders its replies only, with no title, body, or author text and no reply form.

const observeIdTokenMock = vi.fn();
const fetchThreadDetailMock = vi.fn();
const fetchOwnAdminStatusMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../../teams/client/own-admin-status-gateway", () => ({
  fetchOwnAdminStatus: fetchOwnAdminStatusMock,
}));

vi.mock("../client/forum-gateway", () => ({
  fetchThreadDetail: fetchThreadDetailMock,
  deleteThread: vi.fn(),
  deleteReply: vi.fn(),
  createReply: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const { ThreadDetail } = await import("./ThreadDetail");
const { forumCopy } = await import("../copy");
const { formatSurveyDate } = await import("../../results/domain/format-survey-date");

const ERASED_THREAD = {
  threadId: "thread-1",
  status: "erased" as const,
  createdAt: "2026-01-10T10:00:00.000Z",
};

const OTHER_REPLY = {
  replyId: "reply-1",
  isDeleted: false as const,
  body: "Dette hjalp meg videre.",
  authorTag: "AA11BB",
  isOwnReply: false,
  createdAt: "2026-01-10T11:00:00.000Z",
};

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ThreadDetail on an erased-thread placeholder (TASK-015)", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchThreadDetailMock.mockReset();
    fetchOwnAdminStatusMock.mockReset();
  });

  it("shows the erased heading and keeps others' replies, with no reply form", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: ERASED_THREAD, replies: [OTHER_REPLY] });
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("heading", { name: forumCopy.erasedThread.title })).toBeTruthy();
    expect(screen.getByText("Dette hjalp meg videre.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: forumCopy.replyForm.submit })).toBeNull();
    expect(screen.queryByRole("button", { name: forumCopy.deleteThread.button })).toBeNull();
  });

  it("shows only the erased description and date in the header, with no author label", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: ERASED_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    const { container } = render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByRole("heading", { name: forumCopy.erasedThread.title });
    await flush();

    const expected = `${forumCopy.erasedThread.description} · ${formatSurveyDate(new Date(ERASED_THREAD.createdAt))}`;
    expect(screen.getByText(expected)).toBeTruthy();
    expect(container.textContent).not.toContain("Medlem");
    expect(container.textContent).toContain(forumCopy.detail.noReplies);
  });

  it("offers the delete action to an app admin", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: ERASED_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: true });

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("button", { name: forumCopy.deleteThread.button })).toBeTruthy();
  });

  it("offers no delete action to a non-admin reader of the placeholder", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({ status: "ok", thread: ERASED_THREAD, replies: [] });
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);
    await screen.findByRole("heading", { name: forumCopy.erasedThread.title });

    expect(screen.queryByRole("button", { name: forumCopy.deleteThread.button })).toBeNull();
  });

  it("control: an active thread does show the reply form, so the placeholder's missing form is meaningful", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchThreadDetailMock.mockResolvedValue({
      status: "ok",
      thread: {
        threadId: "thread-1",
        title: "Aktiv tråd",
        body: "Innhold",
        authorTag: "48D73D",
        isOwnThread: false,
        createdAt: "2026-01-10T10:00:00.000Z",
      },
      replies: [],
    });
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    render(<ThreadDetail teamId="team-1" threadId="thread-1" />);

    expect(await screen.findByRole("button", { name: forumCopy.replyForm.submit })).toBeTruthy();
  });
});
