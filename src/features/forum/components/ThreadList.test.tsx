// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThreadList } from "./ThreadList";
import type { ThreadSummaryView } from "../client/forum-gateway";

const THREAD_A: ThreadSummaryView = {
  threadId: "thread-a",
  title: "Har noen løst byggeproblemet?",
  authorTag: "48D73D",
  isOwnThread: false,
  createdAt: "2026-01-10T10:00:00.000Z",
};

const THREAD_B: ThreadSummaryView = {
  threadId: "thread-b",
  title: "Forslag til ny arbeidsflyt",
  authorTag: "AA11BB",
  isOwnThread: true,
  createdAt: "2026-01-05T08:00:00.000Z",
};

describe("ThreadList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading state via role=status", () => {
    render(<ThreadList teamId="team-1" state={{ status: "loading" }} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows an error state via role=alert", () => {
    render(<ThreadList teamId="team-1" state={{ status: "error" }} />);

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows the Norwegian empty state when there are no threads", () => {
    render(<ThreadList teamId="team-1" state={{ status: "loaded", threads: [] }} />);

    expect(screen.getByText(/ingen tråder ennå/i)).toBeTruthy();
  });

  it("renders a thread's title, authorTag, and a link to its detail view", () => {
    render(<ThreadList teamId="team-9" state={{ status: "loaded", threads: [THREAD_A] }} />);

    const link = screen.getByRole("link", { name: THREAD_A.title });
    expect(link.getAttribute("href")).toBe("/teams/team-9/forum/thread-a");
    expect(screen.getByText(/48D73D/)).toBeTruthy();
  });

  it("renders items in exactly the order received, never re-sorting client-side", () => {
    render(<ThreadList teamId="team-1" state={{ status: "loaded", threads: [THREAD_B, THREAD_A] }} />);

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toContain(THREAD_B.title);
    expect(items[1]).toContain(THREAD_A.title);
  });

  it("never renders an identity-shaped value (authorUid/ciphertext) anywhere in its output", () => {
    const { container } = render(<ThreadList teamId="team-1" state={{ status: "loaded", threads: [THREAD_A] }} />);

    expect(container.textContent).not.toMatch(/authorUid|ciphertext|\biv\b|authTag|keyVersion/i);
  });
});
