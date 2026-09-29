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
const fetchAdminSurveysMock = vi.fn();
const createAdminSurveyMock = vi.fn();
const openAdminSurveyMock = vi.fn();
const closeAdminSurveyMock = vi.fn();
const deleteOrArchiveAdminSurveyMock = vi.fn();
const fetchAdminChallengesMock = vi.fn();
const resolveAdminChallengeMock = vi.fn();
const archiveAdminChallengeMock = vi.fn();
const deleteAdminChallengeMock = vi.fn();
const fetchAdminSkillTreesMock = vi.fn();
const startAdminTeamSkillTrackingMock = vi.fn();
const updateAdminTeamSkillProgressMock = vi.fn();
const stopAdminTeamSkillTrackingMock = vi.fn();
const fetchTeamSkillsMock = vi.fn();

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

vi.mock("../../surveys/client/admin-survey-gateway", () => ({
  fetchAdminSurveys: fetchAdminSurveysMock,
  createAdminSurvey: createAdminSurveyMock,
  openAdminSurvey: openAdminSurveyMock,
  closeAdminSurvey: closeAdminSurveyMock,
  deleteOrArchiveAdminSurvey: deleteOrArchiveAdminSurveyMock,
}));

vi.mock("../../challenges/client/admin-challenges-gateway", () => ({
  fetchAdminChallenges: fetchAdminChallengesMock,
  resolveAdminChallenge: resolveAdminChallengeMock,
  archiveAdminChallenge: archiveAdminChallengeMock,
  deleteAdminChallenge: deleteAdminChallengeMock,
}));

vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({
  fetchAdminSkillTrees: fetchAdminSkillTreesMock,
  startAdminTeamSkillTracking: startAdminTeamSkillTrackingMock,
  updateAdminTeamSkillProgress: updateAdminTeamSkillProgressMock,
  stopAdminTeamSkillTracking: stopAdminTeamSkillTrackingMock,
  fetchTeamSkills: fetchTeamSkillsMock,
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
  surveys = [],
  challenges = [],
  skillTrees = [],
  teamSkills = [],
}: {
  teams?: { teamId: string; name: string; status: "active" | "disabled" }[];
  members?: { uid: string; email: string | null }[];
  invitations?: { email: string; invitedBy: string; createdAt: string }[];
  requests?: { uid: string; email: string | null; createdAt: string }[];
  surveys?: unknown[];
  challenges?: unknown[];
  skillTrees?: unknown[];
  teamSkills?: unknown[];
} = {}) {
  fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams });
  fetchTeamMembersMock.mockResolvedValue({ status: "ok", members });
  fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations });
  fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests });
  fetchAdminSurveysMock.mockResolvedValue({ status: "ok", surveys });
  fetchAdminChallengesMock.mockResolvedValue({ status: "ok", challenges });
  fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: skillTrees });
  fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: teamSkills });
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
    fetchAdminSurveysMock.mockReset();
    createAdminSurveyMock.mockReset();
    openAdminSurveyMock.mockReset();
    closeAdminSurveyMock.mockReset();
    deleteOrArchiveAdminSurveyMock.mockReset();
    fetchAdminChallengesMock.mockReset();
    resolveAdminChallengeMock.mockReset();
    archiveAdminChallengeMock.mockReset();
    deleteAdminChallengeMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    startAdminTeamSkillTrackingMock.mockReset();
    updateAdminTeamSkillProgressMock.mockReset();
    stopAdminTeamSkillTrackingMock.mockReset();
    fetchTeamSkillsMock.mockReset();
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<AdminTeamDetail teamId="team-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("prompts sign-in when signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchAdminTeamsMock).not.toHaveBeenCalled();
  });

  it("shows a generic Norwegian forbidden message for a non-admin caller, never revealing allow-list membership", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamMembersMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "forbidden" });
    fetchAdminSurveysMock.mockResolvedValue({ status: "forbidden" });

    render(<AdminTeamDetail teamId="team-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ikke tilgang/i);
    expect(alert.textContent).not.toMatch(/admin_emails|allow-?list|@/i);
  });

  it("shows a not-found message when no team matches the route's teamId", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ teams: [{ teamId: "other-team", name: "Mobile", status: "active" }] });

    render(<AdminTeamDetail teamId="team-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ikke funnet/i);
  });

  it("shows a generic error state when any read fails, never a fabricated view", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [{ teamId: "team-1", name: "Platform", status: "active" }] });
    fetchTeamMembersMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations: [] });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests: [] });
    fetchAdminSurveysMock.mockResolvedValue({ status: "ok", surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
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

  it("labels the team's opaque Firestore ID clearly instead of showing it bare", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ teams: [{ teamId: "team-1", name: "Platform", status: "active" }] });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { name: "Platform" });
    expect(screen.getByText("Aktivt · Team-ID: team-1")).toBeTruthy();
  });

  it("invites a member by email and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk();
    inviteTeamMemberMock.mockResolvedValue({ ok: true, outcome: "invitation_created" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen ventende invitasjoner/i);

    await user.type(screen.getByLabelText(/e-postadresse/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /^inviter$/i }));

    expect(inviteTeamMemberMock).toHaveBeenCalledWith("a-token", "team-1", "new@example.com");
    expect(fetchTeamInvitationsMock).toHaveBeenCalledTimes(2);
  });

  it("shows a controlled Norwegian error and does not clear the form when invite fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk();
    inviteTeamMemberMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen ventende invitasjoner/i);

    await user.type(screen.getByLabelText(/e-postadresse/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /^inviter$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/deaktivert/i);
    expect(screen.getByLabelText(/e-postadresse/i)).toHaveProperty("value", "new@example.com");
  });

  it("wires aria-invalid and aria-describedby on the invite-email field's error state (docs/features/ui-refresh/SPEC.md — BR-9)", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk();
    inviteTeamMemberMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen ventende invitasjoner/i);

    const emailField = screen.getByLabelText(/e-postadresse/i);
    await user.type(emailField, "new@example.com");
    await user.click(screen.getByRole("button", { name: /^inviter$/i }));

    const alert = await screen.findByRole("alert");
    expect(emailField.getAttribute("aria-invalid")).toBe("true");
    expect(emailField.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("never introduces a progressive-disclosure toggle for the invite form (BR-13)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk();

    render(<AdminTeamDetail teamId="team-1" />);
    // The invite field is reachable immediately, with no prior "expand"
    // interaction (docs/features/ui-refresh/SPEC.md — BR-13).
    const emailField = await screen.findByLabelText(/e-postadresse/i);

    // Scoped to the invite section itself (`section > form`, not the whole
    // page) — TASK-006 legitimately adds an `aria-expanded` toggle
    // elsewhere on this same page (survey creation, BR-12), so a page-wide
    // assertion would no longer isolate what BR-13 actually guarantees:
    // the invite form specifically never gains one.
    const inviteSection = emailField.closest("section") as HTMLElement;
    expect(inviteSection.querySelector("[aria-expanded]")).toBeNull();
  });

  it("removes a member and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ members: [{ uid: "uid-1", email: "member@example.com" }] });
    removeAdminTeamMemberMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("member@example.com");

    await user.click(screen.getByRole("button", { name: /fjern/i }));

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

    await user.click(screen.getByRole("button", { name: /avbryt invitasjon/i }));

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

    await user.click(screen.getByRole("button", { name: /^godkjenn$/i }));

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

    await user.click(screen.getByRole("button", { name: /avvis/i }));

    expect(resolveAccessRequestMock).toHaveBeenCalledWith("a-token", "team-1", "uid-2", "rejected");
    expect(fetchTeamAccessRequestsMock).toHaveBeenCalledTimes(2);
  });

  it("labels Godkjenn as pending and disables (without relabeling) Avvis while an approval is in flight", async () => {
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

    await user.click(screen.getByRole("button", { name: /^godkjenn$/i }));

    const approveButton = await screen.findByRole("button", { name: /^godkjenner…$/i });
    const rejectButton = screen.getByRole("button", { name: /^avvis$/i });
    expect(approveButton.hasAttribute("disabled")).toBe(true);
    expect(rejectButton.hasAttribute("disabled")).toBe(true);
    // Avvis must never be mislabeled as the action in flight.
    expect(rejectButton.textContent).toBe("Avvis");

    resolveApprove({ ok: true, outcome: "approved" });
    await flushMicrotasks();
  });

  it("labels Avvis as pending and disables (without relabeling) Godkjenn while a rejection is in flight", async () => {
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

    await user.click(screen.getByRole("button", { name: /^avvis$/i }));

    const rejectButton = await screen.findByRole("button", { name: /^avviser…$/i });
    const approveButton = screen.getByRole("button", { name: /^godkjenn$/i });
    expect(rejectButton.hasAttribute("disabled")).toBe(true);
    expect(approveButton.hasAttribute("disabled")).toBe(true);
    // Godkjenn must never be mislabeled as the action in flight.
    expect(approveButton.textContent).toBe("Godkjenn");

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

    await user.click(screen.getByRole("button", { name: /^godkjenn$/i }));
    const rejectButton = await screen.findByRole("button", { name: /^avvis$/i });

    // The Avvis button is disabled while Godkjenn is in flight; userEvent
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

    await user.click(within(rowA).getByRole("button", { name: /^godkjenn$/i }));
    await within(rowA).findByRole("button", { name: /^godkjenner…$/i });

    // requester-a's own row: both controls disabled, Avvis not relabeled.
    expect(within(rowA).getByRole("button", { name: /^godkjenner…$/i }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(within(rowA).getByRole("button", { name: /^avvis$/i }).hasAttribute("disabled")).toBe(true);

    // requester-b's own Godkjenn/Avvis controls remain fully untouched by
    // requester-a's in-flight approval.
    const rejectB = within(rowB).getByRole("button", { name: /^avvis$/i });
    const approveB = within(rowB).getByRole("button", { name: /^godkjenn$/i });
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

    const button = screen.getByRole("button", { name: /fjern/i });
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    await user.click(button);

    expect(removeAdminTeamMemberMock).toHaveBeenCalledTimes(1);

    resolveRemove({ ok: true });
  });

  it("contains no leftover English copy", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      members: [{ uid: "uid-1", email: "member@example.com" }],
      invitations: [{ email: "invitee@example.com", invitedBy: "admin-uid", createdAt: "2026-01-01T00:00:00.000Z" }],
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("member@example.com");

    expect(screen.queryByText(/^sign in$/i)).toBeNull();
    expect(screen.queryByText(/^invite$/i)).toBeNull();
    expect(screen.queryByText(/^remove$/i)).toBeNull();
    expect(screen.queryByText(/^approve$/i)).toBeNull();
    expect(screen.queryByText(/^reject$/i)).toBeNull();
    expect(screen.queryByText(/^members$/i)).toBeNull();
  });
});

describe("AdminTeamDetail survey management", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    fetchTeamMembersMock.mockReset();
    fetchTeamInvitationsMock.mockReset();
    fetchTeamAccessRequestsMock.mockReset();
    fetchAdminSurveysMock.mockReset();
    createAdminSurveyMock.mockReset();
    openAdminSurveyMock.mockReset();
    closeAdminSurveyMock.mockReset();
    deleteOrArchiveAdminSurveyMock.mockReset();
    fetchAdminChallengesMock.mockReset();
    resolveAdminChallengeMock.mockReset();
    archiveAdminChallengeMock.mockReset();
    deleteAdminChallengeMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    startAdminTeamSkillTrackingMock.mockReset();
    updateAdminTeamSkillProgressMock.mockReset();
    stopAdminTeamSkillTrackingMock.mockReset();
    fetchTeamSkillsMock.mockReset();
  });

  it("shows an empty state when the team has no surveys", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByText(/ingen undersøkelser/i);
  });

  it("renders active and archived surveys, each with lifecycle, access mode, and its generated link", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-open",
          title: "Q3 pulse",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "open",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          surveyId: "survey-archived",
          accessMode: "authenticated",
          minimumResponses: 10,
          lifecycle: "closed",
          archived: true,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByText("Q3 pulse");
    const openRow = screen.getByText("Q3 pulse").closest("li") as HTMLElement;
    expect(within(openRow).getByText(/pågående/i)).toBeTruthy();
    expect(within(openRow).getByText(/alle med lenken/i)).toBeTruthy();
    expect(within(openRow).getByText(/minst 5 svar/i)).toBeTruthy();
    expect(within(openRow).getByRole("link", { name: "/survey/survey-open" })).toBeTruthy();

    const archivedRow = screen
      .getByText(surveysAdminFallbackTitle())
      .closest("li") as HTMLElement;
    expect(within(archivedRow).getByText(/kun medlemmer av teamet/i)).toBeTruthy();
    expect(within(archivedRow).getByText(/minst 10 svar/i)).toBeTruthy();
    expect(within(archivedRow).getByRole("link", { name: "/survey/survey-archived" })).toBeTruthy();
  });

  it("keeps the survey-creation form collapsed by default, with the toggle exposing aria-expanded", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);

    // The active/archived survey lists remain the default-visible view
    // while the creation form is collapsed (docs/features/ui-refresh/
    // SPEC.md — BR-12).
    expect(screen.queryByLabelText(/tittel/i)).toBeNull();
    const toggle = screen.getByRole("button", { name: /ny undersøkelse/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const user = userEvent.setup();
    await user.click(toggle);

    expect(screen.getByLabelText(/tittel/i)).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Opening the form triggers no fetch of any kind (BR-14).
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(1);
  });

  it("closes the survey-creation form via Cancel without creating anything or fetching again", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);

    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));
    await user.click(screen.getByLabelText(/alle med lenken/i));
    await user.type(screen.getByLabelText(/tittel/i), "Q3 pulse");
    await user.click(screen.getByRole("button", { name: /^avbryt$/i }));

    expect(screen.queryByLabelText(/tittel/i)).toBeNull();
    expect(screen.getByRole("button", { name: /ny undersøkelse/i }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(createAdminSurveyMock).not.toHaveBeenCalled();
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the create-survey submit button disabled until an access mode is chosen", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    const submit = screen.getByRole("button", { name: /opprett undersøkelse/i });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText(/alle med lenken/i));
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("pre-fills the minimum-responses field with 5", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    expect(screen.getByLabelText(/minste antall svar/i)).toHaveProperty("value", "5");
  });

  it("associates the minimum-responses hint with its input via aria-describedby (docs/features/ui-refresh/SPEC.md — BR-21)", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    const minimumResponsesInput = screen.getByLabelText(/minste antall svar/i);
    const describedBy = minimumResponsesInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy as string);
    expect(hint?.textContent).toMatch(/resultater vises først/i);
  });

  it("sends a custom minimum-responses value chosen by the admin", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });
    createAdminSurveyMock.mockResolvedValue({ ok: true, surveyId: "generated-1" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    await user.click(screen.getByLabelText(/alle med lenken/i));
    const minimumResponsesInput = screen.getByLabelText(/minste antall svar/i);
    await user.clear(minimumResponsesInput);
    await user.type(minimumResponsesInput, "10");
    await user.click(screen.getByRole("button", { name: /opprett undersøkelse/i }));

    expect(createAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", {
      accessMode: "public",
      minimumResponses: 10,
    });
  });

  it("creates a public survey, collapses the form, and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });
    createAdminSurveyMock.mockResolvedValue({ ok: true, surveyId: "generated-1" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    await user.click(screen.getByLabelText(/alle med lenken/i));
    await user.type(screen.getByLabelText(/tittel/i), "Q3 pulse");
    await user.click(screen.getByRole("button", { name: /opprett undersøkelse/i }));

    expect(createAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", {
      accessMode: "public",
      minimumResponses: 5,
      title: "Q3 pulse",
    });
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(2);
    // A successful creation collapses the form again (BR-14).
    await screen.findByText(/ingen undersøkelser/i);
    expect(screen.queryByLabelText(/tittel/i)).toBeNull();
    expect(screen.getByRole("button", { name: /ny undersøkelse/i }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("creates an authenticated survey with optional start/end dates", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });
    createAdminSurveyMock.mockResolvedValue({ ok: true, surveyId: "generated-2" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    await user.click(screen.getByLabelText(/kun medlemmer av teamet/i));
    await user.type(screen.getByLabelText(/start/i), "2026-10-01T09:00");
    await user.type(screen.getByLabelText(/slutt/i), "2026-10-15T09:00");
    await user.click(screen.getByRole("button", { name: /opprett undersøkelse/i }));

    expect(createAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", {
      accessMode: "authenticated",
      minimumResponses: 5,
      startAt: "2026-10-01T09:00",
      endAt: "2026-10-15T09:00",
    });
  });

  it("shows a controlled error, keeps the create form open, and does not clear it when creation fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });
    createAdminSurveyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    await user.click(screen.getByLabelText(/alle med lenken/i));
    await user.type(screen.getByLabelText(/tittel/i), "Q3 pulse");
    await user.click(screen.getByRole("button", { name: /opprett undersøkelse/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    // The form remains open and recoverable on failure (BR-14).
    expect(screen.getByLabelText(/tittel/i)).toHaveProperty("value", "Q3 pulse");
    expect(screen.getByRole("button", { name: /ny undersøkelse/i }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("wires aria-invalid/aria-describedby on the survey-creation fields to the create-error alert (docs/features/ui-refresh/SPEC.md — BR-9)", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ surveys: [] });
    createAdminSurveyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(/ingen undersøkelser/i);
    await user.click(screen.getByRole("button", { name: /ny undersøkelse/i }));

    await user.click(screen.getByLabelText(/alle med lenken/i));
    await user.type(screen.getByLabelText(/tittel/i), "Q3 pulse");
    await user.click(screen.getByRole("button", { name: /opprett undersøkelse/i }));

    const alert = await screen.findByRole("alert");
    const titleField = screen.getByLabelText(/tittel/i);
    const minimumResponsesField = screen.getByLabelText(/minste antall svar/i);

    expect(titleField.getAttribute("aria-invalid")).toBe("true");
    expect(titleField.getAttribute("aria-describedby")).toBe(alert.id);
    expect(minimumResponsesField.getAttribute("aria-invalid")).toBe("true");
    expect(minimumResponsesField.getAttribute("aria-describedby")).toContain(alert.id);
    // The minimum-responses hint (BR-21) is still associated alongside the error.
    expect(minimumResponsesField.getAttribute("aria-describedby")).toMatch(/-description/);
  });

  it("copies the survey link and shows accessible feedback", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /kopier lenke/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/survey/survey-1"));
    await screen.findByText(/lenke kopiert/i);
  });

  it("shows a visible, non-sensitive failure state when copying the survey link fails (docs/features/ui-refresh/SPEC.md — BR-22)", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /kopier lenke/i }));

    const alert = await screen.findByRole("alert");
    // Never exposes the underlying clipboard-API error detail.
    expect(alert.textContent).toMatch(/kunne ikke kopiere/i);
    expect(alert.textContent).not.toMatch(/denied/i);
    expect(screen.queryByText(/lenke kopiert/i)).toBeNull();
  });

  it("opens a scheduled survey and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    openAdminSurveyMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /^åpne/i }));

    expect(openAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", "survey-1");
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(2);
  });

  it("closes an open survey and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "open",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    closeAdminSurveyMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /^steng/i }));

    expect(closeAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", "survey-1");
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(2);
  });

  it("requires explicit confirmation before removing a closed survey, and cancel leaves it untouched", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "closed",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /slett\/arkiver/i }));
    await screen.findByText(/er du sikker/i);
    expect(deleteOrArchiveAdminSurveyMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /avbryt/i }));
    expect(screen.queryByText(/er du sikker/i)).toBeNull();
    expect(deleteOrArchiveAdminSurveyMock).not.toHaveBeenCalled();
  });

  it("removes a closed survey once confirmed and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "closed",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    deleteOrArchiveAdminSurveyMock.mockResolvedValue({ ok: true, outcome: "deleted" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /slett\/arkiver/i }));
    await user.click(screen.getByRole("button", { name: /bekreft fjerning/i }));

    expect(deleteOrArchiveAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", "survey-1");
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(2);
  });

  it("leaves state unchanged and shows a controlled error when a survey mutation fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    openAdminSurveyMock.mockResolvedValue({ ok: false, error: "conflict" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /^åpne/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kunne ikke åpne/i);
    // The list is not re-fetched on failure — only one initial load call.
    expect(fetchAdminSurveysMock).toHaveBeenCalledTimes(1);
  });

  it("does not fire a second open request from repeated clicks while one is already in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    let resolveOpen: (value: unknown) => void = () => {};
    openAdminSurveyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    const button = screen.getByRole("button", { name: /^åpne/i });
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    await user.click(button);

    expect(openAdminSurveyMock).toHaveBeenCalledTimes(1);
    resolveOpen({ ok: true });
  });

  it("keeps two different surveys' action state independent", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      surveys: [
        {
          surveyId: "survey-a",
          title: "Survey A",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          surveyId: "survey-b",
          title: "Survey B",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    let resolveOpenA: (value: unknown) => void = () => {};
    openAdminSurveyMock.mockImplementation(
      (_token: string, _teamId: string, surveyId: string) =>
        new Promise((resolve) => {
          if (surveyId === "survey-a") {
            resolveOpenA = resolve;
          } else {
            resolve({ ok: true });
          }
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("Survey A");

    const openButtons = screen.getAllByRole("button", { name: /^åpne/i });
    await user.click(openButtons[0]);

    // Survey A's button is now pending/disabled; Survey B's own button must
    // remain independently clickable and correctly labeled.
    expect(screen.getByRole("button", { name: /åpner…/i })).toBeTruthy();
    const surveyBButton = screen.getByRole("button", { name: /^åpne – survey b$/i });
    expect(surveyBButton.hasAttribute("disabled")).toBe(false);

    await user.click(surveyBButton);
    expect(openAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-1", "survey-b");

    resolveOpenA({ ok: true });
  });
});

function surveysAdminFallbackTitle(): string {
  return "Undersøkelse";
}

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
    fetchAdminSurveysMock.mockReset();
    createAdminSurveyMock.mockReset();
    openAdminSurveyMock.mockReset();
    closeAdminSurveyMock.mockReset();
    deleteOrArchiveAdminSurveyMock.mockReset();
    fetchAdminChallengesMock.mockReset();
    resolveAdminChallengeMock.mockReset();
    archiveAdminChallengeMock.mockReset();
    deleteAdminChallengeMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    startAdminTeamSkillTrackingMock.mockReset();
    updateAdminTeamSkillProgressMock.mockReset();
    stopAdminTeamSkillTrackingMock.mockReset();
    fetchTeamSkillsMock.mockReset();
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
    fetchAdminSurveysMock.mockResolvedValue({ status: "ok", surveys: [] });
    fetchAdminChallengesMock.mockResolvedValue({ status: "ok", challenges: [] });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: [] });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [] });

    let resolveRemove: (value: unknown) => void = () => {};
    removeAdminTeamMemberMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = resolve;
        }),
    );

    const { rerender } = render(<AdminTeamDetail teamId="team-a" />);
    await screen.findByText("member-a@example.com");

    await user.click(screen.getByRole("button", { name: /fjern/i }));
    expect(removeAdminTeamMemberMock).toHaveBeenCalledWith("a-token", "team-a", "uid-1");

    // Route changes to team B while team A's remove-member call is still
    // in flight — mirrors navigating away mid-mutation.
    rerender(<AdminTeamDetail teamId="team-b" />);
    await screen.findByRole("heading", { name: "Team B" });
    await screen.findByText(/ingen medlemmer/i);

    const fetchMembersCallsBeforeResolve = fetchTeamMembersMock.mock.calls.length;

    // Team A's deferred remove-member result now resolves, long after the
    // route moved on to team B.
    resolveRemove({ ok: true });
    await flushMicrotasks();

    // No stale post-mutation refresh for team A fired, and team B's
    // already-rendered (empty) member list is untouched — no phantom row,
    // no leaked error/pending state, no extra fetch.
    expect(screen.getByRole("heading", { name: "Team B" })).toBeTruthy();
    expect(screen.getByText(/ingen medlemmer/i)).toBeTruthy();
    expect(screen.queryByText("member-a@example.com")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchTeamMembersMock.mock.calls.length).toBe(fetchMembersCallsBeforeResolve);
  });

  it("ignores a stale in-flight open-survey result for team A once the route has changed to team B", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));

    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", status: "active" },
        { teamId: "team-b", name: "Team B", status: "active" },
      ],
    });
    fetchTeamMembersMock.mockResolvedValue({ status: "ok", members: [] });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations: [] });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests: [] });
    fetchAdminSurveysMock.mockImplementation(async (_token: string, teamId: string) => {
      if (teamId === "team-a") {
        return {
          status: "ok",
          surveys: [
            {
              surveyId: "survey-a",
              accessMode: "public",
              minimumResponses: 5,
              lifecycle: "scheduled",
              archived: false,
              createdBy: "admin-1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { status: "ok", surveys: [] };
    });
    fetchAdminChallengesMock.mockResolvedValue({ status: "ok", challenges: [] });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: [] });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [] });

    let resolveOpen: (value: unknown) => void = () => {};
    openAdminSurveyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const { rerender } = render(<AdminTeamDetail teamId="team-a" />);
    await screen.findByRole("link", { name: "/survey/survey-a" });

    await user.click(screen.getByRole("button", { name: /^åpne/i }));
    expect(openAdminSurveyMock).toHaveBeenCalledWith("a-token", "team-a", "survey-a");

    // Route changes to team B while team A's open-survey call is still in
    // flight — mirrors navigating away mid-mutation.
    rerender(<AdminTeamDetail teamId="team-b" />);
    await screen.findByRole("heading", { name: "Team B" });
    await screen.findByText(/ingen undersøkelser/i);

    const fetchSurveysCallsBeforeResolve = fetchAdminSurveysMock.mock.calls.length;

    // Team A's deferred open-survey result now resolves, long after the
    // route moved on to team B.
    resolveOpen({ ok: true });
    await flushMicrotasks();

    // No stale post-mutation refresh for team A fired, and team B's
    // already-rendered (empty) survey list is untouched.
    expect(screen.getByRole("heading", { name: "Team B" })).toBeTruthy();
    expect(screen.getByText(/ingen undersøkelser/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "/survey/survey-a" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchAdminSurveysMock.mock.calls.length).toBe(fetchSurveysCallsBeforeResolve);
  });

  it("ignores a stale in-flight open-survey result after sign-out", async () => {
    const user = userEvent.setup();
    let authCallback: (token: string | null) => void = () => {};
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      authCallback = callback;
      callback("a-token");
      return () => {};
    });

    mockOk({
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    let resolveOpen: (value: unknown) => void = () => {};
    openAdminSurveyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("link", { name: "/survey/survey-1" });

    await user.click(screen.getByRole("button", { name: /^åpne/i }));

    // Sign out while the open-survey call is still in flight.
    authCallback(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveOpen({ ok: true });
    await flushMicrotasks();

    // Still shows the signed-out prompt — the stale result never resurrects
    // the signed-in survey-management view.
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("ignores a stale challenges list result for team A once the route has changed to team B", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));

    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", status: "active" },
        { teamId: "team-b", name: "Team B", status: "active" },
      ],
    });
    fetchTeamMembersMock.mockResolvedValue({ status: "ok", members: [] });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations: [] });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests: [] });
    fetchAdminSurveysMock.mockResolvedValue({ status: "ok", surveys: [] });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: [] });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [] });

    let resolveChallengesA: (value: unknown) => void = () => {};
    fetchAdminChallengesMock.mockImplementation(async (_token: string, teamId: string) => {
      if (teamId === "team-a") {
        return new Promise((resolve) => {
          resolveChallengesA = resolve;
        });
      }
      return { status: "ok", challenges: [] };
    });

    // Team A's own challenge fetch never resolves before the route moves on
    // (its overall load stays pending on this one slow contract) — mirrors
    // navigating away before a slow read ever completed.
    const { rerender } = render(<AdminTeamDetail teamId="team-a" />);
    rerender(<AdminTeamDetail teamId="team-b" />);
    await screen.findByRole("heading", { name: "Team B" });
    await screen.findByText(/ingen utfordringer/i);

    // Team A's deferred challenge list now resolves, long after the route
    // moved on to team B.
    resolveChallengesA({
      status: "ok",
      challenges: [
        { challengeId: "stale-a", text: "STALE-CANARY-team-a", status: "open", submittedAt: "2026-01-01" },
      ],
    });
    await flushMicrotasks();

    // Team B's already-rendered (empty) challenge list is untouched — no
    // phantom row from team A's stale response.
    expect(screen.getByRole("heading", { name: "Team B" })).toBeTruthy();
    expect(screen.queryByText(/STALE-CANARY-team-a/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a stale in-flight resolve-challenge result for team A once the route has changed to team B", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));

    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", status: "active" },
        { teamId: "team-b", name: "Team B", status: "active" },
      ],
    });
    fetchTeamMembersMock.mockResolvedValue({ status: "ok", members: [] });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "ok", invitations: [] });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "ok", requests: [] });
    fetchAdminSurveysMock.mockResolvedValue({ status: "ok", surveys: [] });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: [] });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [] });
    fetchAdminChallengesMock.mockImplementation(async (_token: string, teamId: string) => {
      if (teamId === "team-a") {
        return {
          status: "ok",
          challenges: [
            { challengeId: "challenge-a", text: "Team A challenge", status: "open", submittedAt: "2026-01-01" },
          ],
        };
      }
      return { status: "ok", challenges: [] };
    });

    let resolveResolve: (value: unknown) => void = () => {};
    resolveAdminChallengeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResolve = resolve;
        }),
    );

    const { rerender } = render(<AdminTeamDetail teamId="team-a" />);
    await screen.findByText("Team A challenge");

    await user.click(screen.getByRole("button", { name: /marker som løst/i }));
    expect(resolveAdminChallengeMock).toHaveBeenCalledWith("a-token", "team-a", "challenge-a");

    // Route changes to team B while team A's resolve call is still in
    // flight — mirrors navigating away mid-mutation.
    rerender(<AdminTeamDetail teamId="team-b" />);
    await screen.findByRole("heading", { name: "Team B" });
    await screen.findByText(/ingen utfordringer/i);

    const fetchChallengesCallsBeforeResolve = fetchAdminChallengesMock.mock.calls.length;

    // Team A's deferred resolve result now resolves, long after the route
    // moved on to team B.
    resolveResolve({ ok: true });
    await flushMicrotasks();

    // No stale post-mutation refresh for team A fired, and team B's
    // already-rendered (empty) challenge list is untouched.
    expect(screen.getByRole("heading", { name: "Team B" })).toBeTruthy();
    expect(screen.getByText(/ingen utfordringer/i)).toBeTruthy();
    expect(screen.queryByText("Team A challenge")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchAdminChallengesMock.mock.calls.length).toBe(fetchChallengesCallsBeforeResolve);
  });

  it("ignores a stale in-flight archive-challenge result after sign-out", async () => {
    const user = userEvent.setup();
    let authCallback: (token: string | null) => void = () => {};
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      authCallback = callback;
      callback("a-token");
      return () => {};
    });

    mockOk({
      challenges: [
        { challengeId: "challenge-1", text: "A challenge", status: "open", submittedAt: "2026-01-01" },
      ],
    });

    let resolveArchive: (value: unknown) => void = () => {};
    archiveAdminChallengeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveArchive = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("A challenge");

    await user.click(screen.getByRole("button", { name: /^arkiver –/i }));

    // Sign out while the archive call is still in flight.
    authCallback(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveArchive({ ok: true });
    await flushMicrotasks();

    // Still shows the signed-out prompt — the stale result never resurrects
    // the signed-in admin view.
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });
});

describe("AdminTeamDetail challenge management", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    fetchTeamMembersMock.mockReset();
    fetchTeamInvitationsMock.mockReset();
    fetchTeamAccessRequestsMock.mockReset();
    fetchAdminSurveysMock.mockReset();
    fetchAdminChallengesMock.mockReset();
    resolveAdminChallengeMock.mockReset();
    archiveAdminChallengeMock.mockReset();
    deleteAdminChallengeMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    startAdminTeamSkillTrackingMock.mockReset();
    updateAdminTeamSkillProgressMock.mockReset();
    stopAdminTeamSkillTrackingMock.mockReset();
    fetchTeamSkillsMock.mockReset();
  });

  const OPEN_CHALLENGE = {
    challengeId: "challenge-open",
    text: "Deploy process has no clear owner",
    status: "open" as const,
    submittedAt: "2026-01-10",
  };
  const RESOLVED_CHALLENGE = {
    challengeId: "challenge-resolved",
    text: "Code review is too slow",
    status: "resolved" as const,
    submittedAt: "2026-01-05",
  };
  const ARCHIVED_CHALLENGE = {
    challengeId: "challenge-archived",
    text: "An old, already-archived friction",
    status: "archived" as const,
    submittedAt: "2025-12-01",
  };

  it("shows a loading state, then an empty state when the team has no challenges", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [] });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByText(/ingen utfordringer/i);
  });

  it("shows a controlled error state for the challenges section without erasing team details, members, invitations, requests, or survey management", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      members: [{ uid: "uid-1", email: "member@example.com" }],
      invitations: [{ email: "invitee@example.com", invitedBy: "admin-uid", createdAt: "2026-01-01T00:00:00.000Z" }],
      requests: [{ uid: "uid-2", email: "requester@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
      surveys: [
        {
          surveyId: "survey-1",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "scheduled",
          archived: false,
          createdBy: "admin-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    fetchAdminChallengesMock.mockResolvedValue({ status: "read_failed" });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { name: "Platform" });
    // The team, members, invitations, requests, and survey sections all
    // still render — only the challenges section shows its own error.
    expect(screen.getByText("member@example.com")).toBeTruthy();
    expect(screen.getByText("invitee@example.com")).toBeTruthy();
    expect(screen.getByText("requester@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "/survey/survey-1" })).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("renders active and archived challenges, active including both open and resolved", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE, ARCHIVED_CHALLENGE] });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByText(OPEN_CHALLENGE.text);
    expect(screen.getByText(RESOLVED_CHALLENGE.text)).toBeTruthy();
    // Archived remains visible to the admin — the key difference from the
    // member-facing team page.
    expect(screen.getByText(ARCHIVED_CHALLENGE.text)).toBeTruthy();
  });

  it("resolves an open challenge and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE] });
    resolveAdminChallengeMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    await user.click(screen.getByRole("button", { name: /marker som løst/i }));

    expect(resolveAdminChallengeMock).toHaveBeenCalledWith("a-token", "team-1", "challenge-open");
    expect(fetchAdminChallengesMock).toHaveBeenCalledTimes(2);
  });

  it("shows a row-local Norwegian error and preserves other sections when resolve fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE] });
    resolveAdminChallengeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    await user.click(screen.getByRole("button", { name: /marker som løst/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kunne ikke markere/i);
    expect(alert.textContent).not.toMatch(/persistence_failed|firebase|firestore/i);
  });

  it("archives an open challenge and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE] });
    archiveAdminChallengeMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    await user.click(screen.getByRole("button", { name: /^arkiver –/i }));

    expect(archiveAdminChallengeMock).toHaveBeenCalledWith("a-token", "team-1", "challenge-open");
    expect(fetchAdminChallengesMock).toHaveBeenCalledTimes(2);
  });

  it("archives a resolved challenge and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [RESOLVED_CHALLENGE] });
    archiveAdminChallengeMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(RESOLVED_CHALLENGE.text);

    await user.click(screen.getByRole("button", { name: /^arkiver –/i }));

    expect(archiveAdminChallengeMock).toHaveBeenCalledWith("a-token", "team-1", "challenge-resolved");
  });

  it("requires explicit confirmation before deleting, and cancels cleanly without calling the delete gateway", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    await user.click(screen.getByRole("button", { name: /^slett –/i }));
    const prompt = await screen.findByText(/slettes permanent/i);
    expect(prompt).toBeTruthy();
    expect(deleteAdminChallengeMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /avbryt/i }));
    expect(deleteAdminChallengeMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/slettes permanent/i)).toBeNull();
  });

  it("deletes a challenge after explicit confirmation and refreshes the authoritative view", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE] });
    deleteAdminChallengeMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    await user.click(screen.getByRole("button", { name: /^slett –/i }));
    await screen.findByText(/slettes permanent/i);
    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));

    expect(deleteAdminChallengeMock).toHaveBeenCalledWith("a-token", "team-1", "challenge-open");
    expect(fetchAdminChallengesMock).toHaveBeenCalledTimes(2);
  });

  it("keeps one challenge row's pending state independent of another row's actions", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE] });
    let resolvePending: (value: unknown) => void = () => {};
    resolveAdminChallengeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    const openRow = screen.getByText(OPEN_CHALLENGE.text).closest("li")!;
    const resolvedRow = screen.getByText(RESOLVED_CHALLENGE.text).closest("li")!;

    await user.click(within(openRow).getByRole("button", { name: /marker som løst/i }));

    expect(within(openRow).getByRole("button", { name: /markerer/i }).hasAttribute("disabled")).toBe(true);
    const resolvedArchiveButton = within(resolvedRow).getByRole("button", { name: /^arkiver –/i });
    expect(resolvedArchiveButton.hasAttribute("disabled")).toBe(false);

    resolvePending({ ok: true });
    await flushMicrotasks();
  });

  it("still allows resolve/archive/delete for a disabled team's challenges", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      teams: [{ teamId: "team-1", name: "Platform", status: "disabled" }],
      challenges: [OPEN_CHALLENGE],
    });
    resolveAdminChallengeMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    const resolveButton = screen.getByRole("button", { name: /marker som løst/i });
    expect(resolveButton.hasAttribute("disabled")).toBe(false);

    await user.click(resolveButton);
    expect(resolveAdminChallengeMock).toHaveBeenCalledWith("a-token", "team-1", "challenge-open");
  });

  it("never renders a submitter identity or an identity-implying label anywhere in the admin challenge section", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      challenges: [
        {
          challengeId: "challenge-canary",
          text: "Legitimate challenge text",
          status: "open",
          submittedAt: "2026-01-01",
        },
      ],
    });

    const { container } = render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText("Legitimate challenge text");

    expect(container.textContent).not.toMatch(/uid|resolvedBy|archivedBy/i);
    expect(container.textContent).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    expect(container.textContent).not.toMatch(/submitted by|meldt inn av|forfatter|sendt av/i);
  });

  it("contains no leftover English copy in the challenges section", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ challenges: [OPEN_CHALLENGE] });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByText(OPEN_CHALLENGE.text);

    expect(screen.queryByText(/^resolve$/i)).toBeNull();
    expect(screen.queryByText(/^archive$/i)).toBeNull();
    expect(screen.queryByText(/^delete$/i)).toBeNull();
  });
});

describe("AdminTeamDetail skill tracking (TASK-006)", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    fetchTeamMembersMock.mockReset();
    fetchTeamInvitationsMock.mockReset();
    fetchTeamAccessRequestsMock.mockReset();
    fetchAdminSurveysMock.mockReset();
    fetchAdminChallengesMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    startAdminTeamSkillTrackingMock.mockReset();
    updateAdminTeamSkillProgressMock.mockReset();
    stopAdminTeamSkillTrackingMock.mockReset();
    fetchTeamSkillsMock.mockReset();
  });

  const TREE = {
    treeId: "tree-1",
    name: "Containere",
    nodes: [
      { nodeId: "node-0", label: "Fundamentals", order: 0 },
      { nodeId: "node-1", label: "Pilotdrift", order: 1 },
    ],
  };

  it("renders the Kompetanseområder section with the catalog's untracked trees offered for start", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ skillTrees: [TREE] });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { name: "Kompetanseområder" });
    expect(screen.getByRole("button", { name: /start sporing – containere/i })).toBeTruthy();
  });

  it("reconstructs a persisted tracked tree's current stage on a fresh render, with no prior start action in this session (TASK-008 admin-reload closeout fix)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      skillTrees: [TREE],
      teamSkills: [{ treeId: "tree-1", name: "Containere", nodes: TREE.nodes, currentNodeId: "node-1" }],
    });

    render(<AdminTeamDetail teamId="team-1" />);

    // Rendered as already-tracked, at its true persisted stage, purely from
    // this fresh render's own read — no "start sporing" action was ever
    // clicked in this session.
    const select = await screen.findByRole("combobox", { name: /sett stadium – containere/i });
    expect((select as HTMLSelectElement).value).toBe("node-1");
    expect(screen.queryByRole("button", { name: /start sporing – containere/i })).toBeNull();
    expect(fetchTeamSkillsMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("permits set-stage and stop-tracking on a fresh render's reconstructed persisted tree, without first calling start", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      skillTrees: [TREE],
      teamSkills: [{ treeId: "tree-1", name: "Containere", nodes: TREE.nodes, currentNodeId: "node-0" }],
    });
    updateAdminTeamSkillProgressMock.mockResolvedValue({ ok: true });
    stopAdminTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);

    const select = await screen.findByRole("combobox", { name: /sett stadium – containere/i });
    await user.selectOptions(select, "node-1");
    expect(updateAdminTeamSkillProgressMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", "node-1");
    expect(startAdminTeamSkillTrackingMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /stopp sporing – containere/i }));
    expect(stopAdminTeamSkillTrackingMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1");
  });

  it("derives the untracked start-tracking picker from persisted state after reload — an already-tracked tree is never re-offered", async () => {
    const trackedTree = TREE;
    const untrackedTree = {
      treeId: "tree-2",
      name: "Observability",
      nodes: [{ nodeId: "node-0", label: "Basic logging", order: 0 }],
    };
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      skillTrees: [trackedTree, untrackedTree],
      teamSkills: [{ treeId: "tree-1", name: "Containere", nodes: trackedTree.nodes, currentNodeId: null }],
    });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("combobox", { name: /sett stadium – containere/i });
    // The already-tracked tree offers no "start" action; only the genuinely
    // untracked tree does.
    expect(screen.queryByRole("button", { name: /start sporing – containere/i })).toBeNull();
    expect(screen.getByRole("button", { name: /start sporing – observability/i })).toBeTruthy();
  });

  it("degrades gracefully to session-derived-only tracking when the persisted-progress read fails, without erasing the catalog or other sections", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ skillTrees: [TREE], members: [{ uid: "uid-1", email: "member@example.com" }] });
    fetchTeamSkillsMock.mockResolvedValue({ status: "read_failed" });

    render(<AdminTeamDetail teamId="team-1" />);

    // Falls back to the pre-fix baseline (nothing known yet — offered as
    // untracked) rather than blocking the whole page.
    await screen.findByRole("button", { name: /start sporing – containere/i });
    expect(screen.getByText("member@example.com")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts tracking a tree and moves it into the tracked section without erasing other page sections", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      skillTrees: [TREE],
      members: [{ uid: "uid-1", email: "member@example.com" }],
    });
    startAdminTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await screen.findByRole("button", { name: /start sporing – containere/i });

    await user.click(screen.getByRole("button", { name: /start sporing – containere/i }));

    expect(startAdminTeamSkillTrackingMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1");
    await screen.findByRole("combobox", { name: /sett stadium – containere/i });
    expect(screen.queryByRole("button", { name: /start sporing – containere/i })).toBeNull();
    // Other sections remain untouched by this local state update.
    expect(screen.getByText("member@example.com")).toBeTruthy();
  });

  it("sets a tracked tree's stage, including moving backward", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ skillTrees: [TREE] });
    startAdminTeamSkillTrackingMock.mockResolvedValue({ ok: true });
    updateAdminTeamSkillProgressMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: /start sporing – containere/i }));

    const select = await screen.findByRole("combobox", { name: /sett stadium – containere/i });
    await user.selectOptions(select, "node-1");
    expect(updateAdminTeamSkillProgressMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", "node-1");

    await user.selectOptions(select, "node-0");
    expect(updateAdminTeamSkillProgressMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", "node-0");
  });

  it("stops tracking a tree and moves it back into the untracked picker", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ skillTrees: [TREE] });
    startAdminTeamSkillTrackingMock.mockResolvedValue({ ok: true });
    stopAdminTeamSkillTrackingMock.mockResolvedValue({ ok: true });

    render(<AdminTeamDetail teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: /start sporing – containere/i }));

    await user.click(await screen.findByRole("button", { name: /stopp sporing – containere/i }));

    expect(stopAdminTeamSkillTrackingMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1");
    await screen.findByRole("button", { name: /start sporing – containere/i });
  });

  it("hides the start-tracking picker for a disabled team, wiring teamDisabled from the loaded team status", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({
      teams: [{ teamId: "team-1", name: "Platform", status: "disabled" }],
      skillTrees: [TREE],
    });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { name: "Kompetanseområder" });
    // The start-tracking picker is hidden entirely for a disabled team; the
    // component-level `TeamSkillTrackingSection` tests separately prove
    // set-stage/stop-tracking remain available and functional for an
    // already-tracked tree regardless of `teamDisabled`.
    expect(screen.queryByRole("button", { name: /start sporing/i })).toBeNull();
    expect(screen.getByText(/teamet er deaktivert/i)).toBeTruthy();
    expect(startAdminTeamSkillTrackingMock).not.toHaveBeenCalled();
  });

  it("shows a controlled catalog error without erasing other sections", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    mockOk({ members: [{ uid: "uid-1", email: "member@example.com" }] });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "read_failed" });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { name: "Platform" });
    expect(screen.getByText("member@example.com")).toBeTruthy();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => /noe gikk galt under lasting av kompetanseområder/i.test(alert.textContent ?? ""))).toBe(
      true,
    );
  });

  it("shows no skill-tracking UI for a non-admin caller", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamMembersMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamInvitationsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamAccessRequestsMock.mockResolvedValue({ status: "forbidden" });
    fetchAdminSurveysMock.mockResolvedValue({ status: "forbidden" });

    render(<AdminTeamDetail teamId="team-1" />);

    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "Kompetanseområder" })).toBeNull();
  });
});
