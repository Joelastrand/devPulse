// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { roleAssignmentCopy } from "../copy";
import type { AdminRoleView } from "../client/roles-gateway";

const fetchAdminRolesMock = vi.fn();
const lookupRoleAssignmentsMock = vi.fn();
const assignAdminRoleToUserMock = vi.fn();
const removeAdminRoleFromUserMock = vi.fn();

vi.mock("../client/roles-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client/roles-gateway")>();
  return { ...actual, fetchAdminRoles: fetchAdminRolesMock };
});
vi.mock("../client/role-assignment-gateway", () => ({
  lookupRoleAssignments: lookupRoleAssignmentsMock,
  assignAdminRoleToUser: assignAdminRoleToUserMock,
  removeAdminRoleFromUser: removeAdminRoleFromUserMock,
}));

const { MemberRoleAssignments } = await import("./MemberRoleAssignments");

const TOKEN = "admin-token";
// A fictional administrator who is also a member of the team shown on the page.
const ADMIN_MEMBER = { uid: "admin-1", displayName: "Testadmin", email: "admin@nve.no" };

const BACKEND: AdminRoleView = { roleId: "role-backend", name: "Backend", description: "Bygger API-et", archived: false };
const OVERINGENIOR: AdminRoleView = { roleId: "role-lead", name: "Overingeniør", description: "Leder fagområdet", archived: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type UserEvent = ReturnType<typeof userEvent.setup>;

function memberRow(): HTMLElement {
  return screen.getByRole("listitem");
}

/** Roles are edited in an inline editor opened from the member's row. */
async function openEditor(user: UserEvent) {
  await user.click(within(memberRow()).getByRole("button", { name: /^(tildel rolle|endre rolle)$/i }));
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: roleAssignmentCopy.save });
}

function setup({ assignedRoleId }: { assignedRoleId: string | null }) {
  fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [BACKEND, OVERINGENIOR], truncated: false });
  lookupRoleAssignmentsMock.mockResolvedValue({ status: "ok", roleIds: { [ADMIN_MEMBER.uid]: assignedRoleId } });
  render(<MemberRoleAssignments token={TOKEN} members={[ADMIN_MEMBER]} />);
  return waitFor(() => expect(screen.queryByText(roleAssignmentCopy.loading)).toBeNull());
}

describe("MemberRoleAssignments (admin self-assignment UI)", () => {
  it("shows the row's role as the badge, or 'Ingen rolle tildelt' when none is set", async () => {
    await setup({ assignedRoleId: null });

    expect(within(memberRow()).getByText(roleAssignmentCopy.none)).toBeTruthy();
    expect(within(memberRow()).getByRole("button", { name: roleAssignmentCopy.assign })).toBeTruthy();
  });

  it("keeps the save action disabled until a role is selected in the editor", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: null });

    await openEditor(user);

    expect(saveButton().disabled).toBe(true);
  });

  it("enables the save action for the administrator's own row once a valid role is selected, and shows the role after the server confirms", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: null });
    assignAdminRoleToUserMock.mockResolvedValue({ ok: true, roleId: BACKEND.roleId });

    await openEditor(user);
    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), BACKEND.roleId);
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());

    expect(assignAdminRoleToUserMock).toHaveBeenCalledWith(TOKEN, ADMIN_MEMBER.uid, BACKEND.roleId);
    expect(await screen.findByText(roleAssignmentCopy.saved)).toBeTruthy();
    expect(within(memberRow()).getByText("Backend")).toBeTruthy();
    // The editor closes once the server has confirmed the change.
    expect(screen.queryByLabelText(roleAssignmentCopy.select)).toBeNull();
  });

  it("preselects the current role when the editor opens for a changed assignment", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });

    await openEditor(user);

    expect((screen.getByLabelText(roleAssignmentCopy.select) as HTMLSelectElement).value).toBe(BACKEND.roleId);
  });

  it("changes an existing organizational role to another active role", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });
    assignAdminRoleToUserMock.mockResolvedValue({ ok: true, roleId: OVERINGENIOR.roleId });

    await openEditor(user);
    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), OVERINGENIOR.roleId);
    await user.click(saveButton());

    expect(assignAdminRoleToUserMock).toHaveBeenCalledWith(TOKEN, ADMIN_MEMBER.uid, OVERINGENIOR.roleId);
    expect(await screen.findByText("Overingeniør")).toBeTruthy();
  });

  it("keeps save disabled when the selection is the role already assigned", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });

    await openEditor(user);

    expect(saveButton().disabled).toBe(true);
  });

  it("removes the organizational role and shows the removal after the server confirms", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });
    removeAdminRoleFromUserMock.mockResolvedValue({ ok: true });

    await openEditor(user);
    await user.click(screen.getByRole("button", { name: roleAssignmentCopy.remove }));

    expect(removeAdminRoleFromUserMock).toHaveBeenCalledWith(TOKEN, ADMIN_MEMBER.uid);
    expect(await screen.findByText(roleAssignmentCopy.removed)).toBeTruthy();
    expect(within(memberRow()).getByText(roleAssignmentCopy.none)).toBeTruthy();
  });

  it("shows a server error and never the success message or a changed role, and keeps the selection for a retry", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: null });
    assignAdminRoleToUserMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await openEditor(user);
    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), BACKEND.roleId);
    await user.click(saveButton());

    expect(await screen.findByText(roleAssignmentCopy.errors.persistence_failed)).toBeTruthy();
    expect(screen.queryByText(roleAssignmentCopy.saved)).toBeNull();
    expect(within(memberRow()).getByText(roleAssignmentCopy.none)).toBeTruthy();
    // The editor stays open with the chosen role, so the administrator can retry without choosing again.
    expect((screen.getByLabelText(roleAssignmentCopy.select) as HTMLSelectElement).value).toBe(BACKEND.roleId);
  });

  it("shows the server's refusal for an unauthorized caller and keeps the previous role", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });
    removeAdminRoleFromUserMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await openEditor(user);
    await user.click(screen.getByRole("button", { name: roleAssignmentCopy.remove }));

    expect(await screen.findByText(roleAssignmentCopy.errors.forbidden)).toBeTruthy();
    expect(screen.queryByText(roleAssignmentCopy.removed)).toBeNull();
    // The badge (a span) keeps the previous role; the open editor's option also reads "Backend", so only the badge is checked.
    expect(within(memberRow()).getByText("Backend", { selector: "span" })).toBeTruthy();
  });

  it("closes the editor with Escape without sending any request", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: null });

    await openEditor(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText(roleAssignmentCopy.select)).toBeNull();
    expect(assignAdminRoleToUserMock).not.toHaveBeenCalled();
  });
});
