// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchAdminTeamsMock = vi.fn();
const fetchTeamMembersMock = vi.fn();
const fetchTeamInvitationsMock = vi.fn();
const fetchTeamAccessRequestsMock = vi.fn();
const inviteTeamMemberMock = vi.fn();
const removeAdminTeamMemberMock = vi.fn();
const cancelTeamInvitationMock = vi.fn();
const resolveAccessRequestMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/admin-teams-gateway", () => ({
  fetchAdminTeams: fetchAdminTeamsMock,
}));

vi.mock("../client/admin-team-detail-gateway", () => ({
  fetchTeamMembers: fetchTeamMembersMock,
  fetchTeamInvitations: fetchTeamInvitationsMock,
  fetchTeamAccessRequests: fetchTeamAccessRequestsMock,
  inviteTeamMember: inviteTeamMemberMock,
  removeAdminTeamMember: removeAdminTeamMemberMock,
  cancelTeamInvitation: cancelTeamInvitationMock,
  resolveAccessRequest: resolveAccessRequestMock,
}));

const { AdminTeamDetail } = await import("./AdminTeamDetail");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mockOk({
  teams = [{ teamId: "team-1", name: "Platform", status: "active" as const }],
  members = [],
  invitations = [],
  requests = [],
}: {
  teams?: { teamId: string; name: string; status: "active" | "disabled" }[];
  members?: { uid: string; email: string | null }[];
  invitations?: { email: string; invitedBy: string; createdAt: string }[];
  requests?: { uid: string; email: string | null; createdAt: string }[];
} = {}) {
  fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams });
  fetchTeamMembersMock.mockResolvedValue({ status: "ok", members });
  fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations });
  fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests });
}

describe("AdminTeamDetail", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    fetchTeamMembersMock.mockReset();
    fetchTeamInvitationsMock.mockReset();
    fetchTeamAccessRequestsMock.mockReset();
    inviteTeamMemberMock.mockReset();
    removeAdminTeamMemberMock.mockReset();
    cancelTeamInvitationMock.mockReset();
    resolveAccessRequestMock.mockReset();
  });

  it("shows a loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<AdminTeamDetail teamId="team-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/loading/i);
  });

  it("prompts sign-in when signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("link", { name: /sign in/i });
    expect(fetchAdminTeamsMock).not.toHaveBeenCalled();
  });

  it("shows a generic forbidden message for a non-admin caller, never revealing allow-list membership", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamMembersMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "forbidden" });

    render(<AdminTeamDetail teamId="team-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/don't have permission/i);
    expect(alert.textContent).not.toMatch(/admin_emails|allow-?list|@/i);
  });

  it("shows a not-found message when no team matches the route's teamId", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ teams: [{ teamId: "other-team", name: "Mobile", status: "active" }] });

    render(<AdminTeamDetail teamId="team-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be found/i);
  });

  it("shows a generic error state when any read fails, never a fabricated view", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [{ teamId: "team-1", name: "Platform", status: "active" }] });
    fetchTeamMembersMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations: [] });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests: [] });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("alert");
  });

  it("renders the team name/status, members, pending invitations, and pending access requests", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
      members: [{ uid: "uid-1", email: "member@example.com" }],
      invitations: [{ email: "invitee@example.com", invitedBy: "admin-uid", createdAt: "2026-01-01T00:00:00.000Z" }],
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { name: "Platform" });
    expect(screen.getByText("member@example.com")).toBeTruthy();
    expect(screen.getByText("invitee@example.com")).toBeTruthy();
    expect(screen.getByText("requester@example.com")).toBeTruthy();
  });

  it("invites a member by email and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk();
    inviteTeamMemberMock.mockResolvedValue({ ok: true, outcome: "invitation_created" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/no pending invitations/i);

    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(inviteTeamMemberMock).toHaveBeenCalledWith("a-token", "team-1", "new@example.com");
    expect(fetchTeamInvitationsMock).toHaveBeenCalledTimes(2);
  });

  it("shows a controlled error and does not clear the form when invite fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk();
    inviteTeamMemberMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/no pending invitations/i);

    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/disabled/i);
    expect(screen.getByLabelText(/email address/i)).toHaveProperty("value", "new@example.com");
  });

  it("removes a member and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ members: [{ uid: "uid-1", email: "member@example.com" }] });
    removeAdminTeamMemberMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("member@example.com");

    await user.click(screen.getByRole("button", { name: /remove/i }));

    expect(removeAdminTeamMemberMock).toHaveBeenCalledWith("a-token", "team-1", "uid-1");
    expect(fetchTeamMembersMock).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending invitation and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      invitations: [{ email: "invitee@example.com", invitedBy: "admin-uid", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    cancelTeamInvitationMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("invitee@example.com");

    await user.click(screen.getByRole("button", { name: /cancel invitation/i }));

    expect(cancelTeamInvitationMock).toHaveBeenCalledWith("a-token", "team-1", "invitee@example.com");
    expect(fetchTeamInvitationsMock).toHaveBeenCalledTimes(2);
  });

  it("approves a pending access request and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    resolveAccessRequestMock.mockResolvedValue({ ok: true, outcome: "approved" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("requester@example.com");

    await user.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(resolveAccessRequestMock).toHaveBeenCalledWith("a-token", "team-1", "uid-2", "approved");
    expect(fetchTeamAccessRequestsMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a pending access request and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    resolveAccessRequestMock.mockResolvedValue({ ok: true, outcome: "rejected" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("requester@example.com");

    await user.click(screen.getByRole("button", { name: /reject/i }));

    expect(resolveAccessRequestMock).toHaveBeenCalledWith("a-token", "team-1", "uid-2", "rejected");
    expect(fetchTeamAccessRequestsMock).toHaveBeenCalledTimes(2);
  });

  it("labels Approve as pending and disables (without relabeling) Reject while an approval is in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    let resolveApprove: (value: unknown) => void = () => {};
    resolveAccessRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprove = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("requester@example.com");

    await user.click(screen.getByRole("button", { name: /^approve$/i }));

    const approveButton = await screen.findByRole("button", { name: /^approving…$/i });
    const rejectButton = screen.getByRole("button", { name: /^reject$/i });
    expect(approveButton.hasAttribute("disabled")).toBe(true);
    expect(rejectButton.hasAttribute("disabled")).toBe(true);
    // Reject must never be mislabeled as the action in flight.
    expect(rejectButton.textContent).toBe("Reject");

    resolveApprove({ ok: true, outcome: "approved" });
    await flushMicrotasks();
  });

  it("labels Reject as pending and disables (without relabeling) Approve while a rejection is in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    let resolveReject: (value: unknown) => void = () => {};
    resolveAccessRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReject = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("requester@example.com");

    await user.click(screen.getByRole("button", { name: /^reject$/i }));

    const rejectButton = await screen.findByRole("button", { name: /^rejecting…$/i });
    const approveButton = screen.getByRole("button", { name: /^approve$/i });
    expect(rejectButton.hasAttribute("disabled")).toBe(true);
    expect(approveButton.hasAttribute("disabled")).toBe(true);
    // Approve must never be mislabeled as the action in flight.
    expect(approveButton.textContent).toBe("Approve");

    resolveReject({ ok: true, outcome: "rejected" });
    await flushMicrotasks();
  });

  it("does not allow both approve and reject to fire for the same request while one is already pending", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    let resolveApprove: (value: unknown) => void = () => {};
    resolveAccessRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprove = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("requester@example.com");

    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    const rejectButton = await screen.findByRole("button", { name: /^reject$/i });

    // The Reject button is disabled while Approve is in flight; userEvent
    // respects `disabled`, so this proves the real UI guard, not just the
    // handler's own reentrancy check.
    await user.click(rejectButton);

    expect(resolveAccessRequestMock).toHaveBeenCalledTimes(1);
    expect(resolveAccessRequestMock).toHaveBeenCalledWith("a-token", "team-1", "uid-2", "approved");

    resolveApprove({ ok: true, outcome: "approved" });
    await flushMicrotasks();
  });

  it("keeps a different request's approve/reject state independent of another request's pending action", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      requests: [
        { uid: "uid-2", email: "requester-a@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
        { uid: "uid-3", email: "requester-b@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const resolvers: ((value: unknown) => void)[] = [];
    resolveAccessRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("requester-a@example.com");

    const rowA = screen.getByText("requester-a@example.com").closest("li")!;
    const rowB = screen.getByText("requester-b@example.com").closest("li")!;

    await user.click(within(rowA).getByRole("button", { name: /^approve$/i }));
    await within(rowA).findByRole("button", { name: /^approving…$/i });

    // requester-a's own row: both controls disabled, Reject not relabeled.
    expect(within(rowA).getByRole("button", { name: /^approving…$/i }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(within(rowA).getByRole("button", { name: /^reject$/i }).hasAttribute("disabled")).toBe(true);

    // requester-b's own Approve/Reject controls remain fully untouched by
    // requester-a's in-flight approval.
    const rejectB = within(rowB).getByRole("button", { name: /^reject$/i });
    const approveB = within(rowB).getByRole("button", { name: /^approve$/i });
    expect(rejectB.hasAttribute("disabled")).toBe(false);
    expect(approveB.hasAttribute("disabled")).toBe(false);

    await user.click(approveB);
    expect(resolveAccessRequestMock).toHaveBeenCalledWith("a-token", "team-1", "uid-3", "approved");

    resolvers.forEach((resolve) => resolve({ ok: true, outcome: "approved" }));
    await flushMicrotasks();
  });

  it("does not fire a second remove request from repeated clicks while one is already in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ members: [{ uid: "uid-1", email: "member@example.com" }] });
    let resolveRemove: (value: unknown) => void = () => {};
    removeAdminTeamMemberMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("member@example.com");

    const button = screen.getByRole("button", { name: /remove/i });
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    await user.click(button);

    expect(removeAdminTeamMemberMock).toHaveBeenCalledTimes(1);

    resolveRemove({ ok: true });
  });
});

describe("AdminTeamDetail stale mutation races", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    fetchTeamMembersMock.mockReset();
    fetchTeamInvitationsMock.mockReset();
    fetchTeamAccessRequestsMock.mockReset();
    inviteTeamMemberMock.mockReset();
    removeAdminTeamMemberMock.mockReset();
    cancelTeamInvitationMock.mockReset();
    resolveAccessRequestMock.mockReset();
  });

  it("ignores a stale in-flight remove-member result for team A once the route has changed to team B", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));

    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", status: "active" },
        { teamId: "team-b", name: "Team B", status: "active" },
      ],
    });
    fetchTeamMembersMock.mockImplementation(async (_token: string, teamId: string) => {
      if (teamId === "team-a") {
        return { status: "ok", members: [{ uid: "uid-1", email: "member-a@example.com" }] };
      }
      return { status: "ok", members: [] };
    });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations: [] });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests: [] });

    let resolveRemove: (value: unknown) => void = () => {};
    removeAdminTeamMemberMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = resolve;
        }),
    );

    const { rerender } = render(<AdminTeamDetail teamId="team-a" />);
    await screen.findByText("member-a@example.com");

    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(removeAdminTeamMemberMock).toHaveBeenCalledWith("a-token", "team-a", "uid-1");

    // Route changes to team B while team A's remove-member call is still
    // in flight — mirrors navigating away mid-mutation.
    rerender(<AdminTeamDetail teamId="team-b" />);
    await screen.findByRole("heading", { name: "Team B" });
    await screen.findByText(/no members yet/i);

    const fetchMembersCallsBeforeResolve = fetchTeamMembersMock.mock.calls.length;

    // Team A's deferred remove-member result now resolves, long after the
    // route moved on to team B.
    resolveRemove({ ok: true });
    await flushMicrotasks();

    // No stale post-mutation refresh for team A fired, and team B's
    // already-rendered (empty) member list is untouched — no phantom row,
    // no leaked error/pending state, no extra fetch.
    expect(screen.getByRole("heading", { name: "Team B" })).toBeTruthy();
    expect(screen.getByText(/no members yet/i)).toBeTruthy();
    expect(screen.queryByText("member-a@example.com")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchTeamMembersMock.mock.calls.length).toBe(fetchMembersCallsBeforeResolve);
  });
});
