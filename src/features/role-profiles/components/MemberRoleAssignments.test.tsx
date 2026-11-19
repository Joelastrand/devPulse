// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function assignButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: roleAssignmentCopy.assign });
}

function setup({ assignedRoleId }: { assignedRoleId: string | null }) {
  fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [BACKEND, OVERINGENIOR], truncated: false });
  lookupRoleAssignmentsMock.mockResolvedValue({ status: "ok", roleIds: { [ADMIN_MEMBER.uid]: assignedRoleId } });
  render(<MemberRoleAssignments token={TOKEN} members={[ADMIN_MEMBER]} />);
  return waitFor(() => expect(screen.queryByText(roleAssignmentCopy.loading)).toBeNull());
}

describe("MemberRoleAssignments (admin self-assignment UI)", () => {
  it("keeps the assign action disabled until a role is selected", async () => {
    await setup({ assignedRoleId: null });

    expect(assignButton().disabled).toBe(true);
  });

  it("enables the assign action for the administrator's own row once a valid role is selected, and shows the role after the server confirms", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: null });
    assignAdminRoleToUserMock.mockResolvedValue({ ok: true, roleId: BACKEND.roleId });

    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), BACKEND.roleId);
    expect(assignButton().disabled).toBe(false);
    await user.click(assignButton());

    expect(assignAdminRoleToUserMock).toHaveBeenCalledWith(TOKEN, ADMIN_MEMBER.uid, BACKEND.roleId);
    expect(await screen.findByText(roleAssignmentCopy.saved)).toBeTruthy();
    expect(screen.getByText(`${roleAssignmentCopy.heading}: Backend`)).toBeTruthy();
  });

  it("changes an existing organizational role to another active role", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });
    assignAdminRoleToUserMock.mockResolvedValue({ ok: true, roleId: OVERINGENIOR.roleId });

    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), OVERINGENIOR.roleId);
    await user.click(screen.getByRole("button", { name: roleAssignmentCopy.change }));

    expect(assignAdminRoleToUserMock).toHaveBeenCalledWith(TOKEN, ADMIN_MEMBER.uid, OVERINGENIOR.roleId);
    expect(await screen.findByText(`${roleAssignmentCopy.heading}: Overingeniør`)).toBeTruthy();
  });

  it("keeps change disabled when the selection is the role already assigned", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });

    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), BACKEND.roleId);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: roleAssignmentCopy.change }).disabled).toBe(true);
  });

  it("removes the organizational role and shows the removal after the server confirms", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });
    removeAdminRoleFromUserMock.mockResolvedValue({ ok: true });

    await user.click(screen.getByRole("button", { name: roleAssignmentCopy.remove }));

    expect(removeAdminRoleFromUserMock).toHaveBeenCalledWith(TOKEN, ADMIN_MEMBER.uid);
    expect(await screen.findByText(roleAssignmentCopy.removed)).toBeTruthy();
    expect(screen.getByText(`${roleAssignmentCopy.heading}: ${roleAssignmentCopy.none}`)).toBeTruthy();
  });

  it("shows a server error and never the success message or a changed role", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: null });
    assignAdminRoleToUserMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await user.selectOptions(screen.getByLabelText(roleAssignmentCopy.select), BACKEND.roleId);
    await user.click(screen.getByRole("button", { name: roleAssignmentCopy.assign }));

    expect(await screen.findByText(roleAssignmentCopy.errors.persistence_failed)).toBeTruthy();
    expect(screen.queryByText(roleAssignmentCopy.saved)).toBeNull();
    expect(screen.getByText(`${roleAssignmentCopy.heading}: ${roleAssignmentCopy.none}`)).toBeTruthy();
  });

  it("shows the server's refusal for an unauthorized caller and keeps the previous role", async () => {
    const user = userEvent.setup();
    await setup({ assignedRoleId: BACKEND.roleId });
    removeAdminRoleFromUserMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await user.click(screen.getByRole("button", { name: roleAssignmentCopy.remove }));

    expect(await screen.findByText(roleAssignmentCopy.errors.forbidden)).toBeTruthy();
    expect(screen.queryByText(roleAssignmentCopy.removed)).toBeNull();
    expect(screen.getByText(`${roleAssignmentCopy.heading}: Backend`)).toBeTruthy();
  });
});
