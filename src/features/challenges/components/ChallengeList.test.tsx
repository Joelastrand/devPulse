// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChallengeList } from "./ChallengeList";
import type { MemberChallengeView } from "../client/challenges-gateway";

const OPEN_CHALLENGE: MemberChallengeView = {
  challengeId: "c1",
  text: "Deploy process has no clear owner",
  status: "open",
  submittedAt: "2026-01-10",
};

const RESOLVED_CHALLENGE: MemberChallengeView = {
  challengeId: "c2",
  text: "Code review is too slow",
  status: "resolved",
  submittedAt: "2026-01-05",
};

describe("ChallengeList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading state via role=status", () => {
    render(<ChallengeList state={{ status: "loading" }} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows an empty state when there are no challenges", () => {
    render(<ChallengeList state={{ status: "loaded", challenges: [] }} />);

    expect(screen.getByText(/ingen utfordringer/i)).toBeTruthy();
  });

  it("shows an error state via role=alert", () => {
    render(<ChallengeList state={{ status: "error" }} />);

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders an open challenge with a Norwegian, non-color status label", () => {
    render(<ChallengeList state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }} />);

    expect(screen.getByText(OPEN_CHALLENGE.text)).toBeTruthy();
    expect(screen.getByText(/åpen/i)).toBeTruthy();
  });

  it("renders a resolved challenge with its Norwegian status label", () => {
    render(<ChallengeList state={{ status: "loaded", challenges: [RESOLVED_CHALLENGE] }} />);

    expect(screen.getByText(RESOLVED_CHALLENGE.text)).toBeTruthy();
    expect(screen.getByText(/løst/i)).toBeTruthy();
  });

  it("renders items in exactly the order received, never re-sorting client-side", () => {
    render(
      <ChallengeList
        state={{ status: "loaded", challenges: [RESOLVED_CHALLENGE, OPEN_CHALLENGE] }}
      />,
    );

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toContain(RESOLVED_CHALLENGE.text);
    expect(items[1]).toContain(OPEN_CHALLENGE.text);
  });

  it("never renders an identity-shaped value (uid/email) anywhere in its output", () => {
    const canary: MemberChallengeView = {
      challengeId: "c3",
      text: "Legitimate challenge text",
      status: "open",
      submittedAt: "2026-01-01",
    };
    const { container } = render(<ChallengeList state={{ status: "loaded", challenges: [canary] }} />);

    expect(container.textContent).not.toMatch(/uid/i);
    expect(container.textContent).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    expect(container.textContent).not.toMatch(/resolvedBy/i);
    expect(container.textContent).not.toMatch(/archivedBy/i);
  });
});
