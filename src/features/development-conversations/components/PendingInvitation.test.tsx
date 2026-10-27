// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingInvitationWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { PendingInvitation } from "./PendingInvitation";

// Synthetic data only. The conversation id and team id are fictional.
const CONVERSATION_ID = "pend-synthetic-1";

/** The approved pending DTO (SPEC BR-41). It has no content field, so the view cannot render one. */
function invitation(overrides: Partial<PendingInvitationWire> = {}): PendingInvitationWire {
  return {
    conversationId: CONVERSATION_ID,
    state: "pending",
    teamName: "Plattform (syntetisk)",
    invitedAt: "2026-10-02T10:00:00.000Z",
    ownerDisplayName: "Kari Testperson",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PendingInvitation: approved pending data only", () => {
  it("shows the team name, the invitation date and the owner's roster-level name", () => {
    render(<PendingInvitation invitation={invitation()} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: conversationsCopy.pendingHeading })).toBeTruthy();
    expect(screen.getByText(`${conversationsCopy.teamLabel}: Plattform (syntetisk)`)).toBeTruthy();
    expect(screen.getByText(conversationsCopy.pendingOwnerLine("Kari Testperson"))).toBeTruthy();
    expect(screen.getByText(/Invitert/)).toBeTruthy();
  });

  it("uses the neutral owner name when the approved DTO has no display name", () => {
    render(<PendingInvitation invitation={invitation({ ownerDisplayName: null })} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(conversationsCopy.pendingOwnerLine(conversationsCopy.anonymousColleague))).toBeTruthy();
  });

  it("states that no content is shown before acceptance, and gives the BR-38 participant copy", () => {
    render(<PendingInvitation invitation={invitation()} onAccept={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByText(conversationsCopy.pendingNoContent)).toBeTruthy();
    for (const line of conversationsCopy.pendingCopy) expect(screen.getByText(line)).toBeTruthy();
  });

  it("renders no content, no hidden identifier and no raw conversation id", () => {
    const { container } = render(<PendingInvitation invitation={invitation()} onAccept={vi.fn()} onDecline={vi.fn()} />);
    const html = container.innerHTML;
    expect(html).not.toContain(CONVERSATION_ID);
    expect(html).not.toMatch(/memberRef|uid|email|teamId|membership|ownerNotes|nextSteps|sharedGoals|participantNotes|plannedFor/i);
    expect(container.querySelectorAll("a[href]")).toHaveLength(0);
  });
});

describe("PendingInvitation: accept and decline", () => {
  it("accept sends one request through the parent and no other action", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<PendingInvitation invitation={invitation()} onAccept={onAccept} onDecline={onDecline} />);
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.acceptButton }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("decline is direct, with no confirmation, and sends one request", async () => {
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<PendingInvitation invitation={invitation()} onAccept={vi.fn()} onDecline={onDecline} />);
    await userEvent.click(screen.getByRole("button", { name: conversationsCopy.declineButton }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("two accept clicks in the same tick send one request, before any re-render disables the button", () => {
    const onAccept = vi.fn(() => new Promise<void>(() => {}));
    render(<PendingInvitation invitation={invitation()} onAccept={onAccept} onDecline={vi.fn()} />);
    const button = screen.getByRole("button", { name: conversationsCopy.acceptButton });
    // Both clicks land inside one act scope, so React has not re-rendered the disabled button between them. Only the
    // in-flight guard can refuse the second click.
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("a decline while an accept is in flight is refused, so the two actions never overlap", () => {
    const onAccept = vi.fn(() => new Promise<void>(() => {}));
    const onDecline = vi.fn(() => new Promise<void>(() => {}));
    render(<PendingInvitation invitation={invitation()} onAccept={onAccept} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.acceptButton }));
    fireEvent.click(screen.getByRole("button", { name: conversationsCopy.declineButton }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it("shows the page's notice in a polite status region, and keeps the actions while the invitation is still pending", () => {
    render(
      <PendingInvitation
        invitation={invitation()}
        notice={conversationsCopy.acceptNotConfirmedPending}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText(conversationsCopy.acceptNotConfirmedPending).getAttribute("role")).toBe("status");
    expect(screen.getByRole("button", { name: conversationsCopy.acceptButton })).toBeTruthy();
    expect(screen.getByRole("button", { name: conversationsCopy.declineButton })).toBeTruthy();
  });
});
