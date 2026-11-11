// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { adminRolesCopy, roleErrorMessage } from "../copy";
import type { AdminRoleView } from "../client/roles-gateway";

const createAdminRoleMock = vi.fn();
const updateAdminRoleMock = vi.fn();

vi.mock("../client/roles-gateway", () => ({
  createAdminRole: createAdminRoleMock,
  updateAdminRole: updateAdminRoleMock,
}));

const { RoleForm } = await import("./RoleForm");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const existing: AdminRoleView = { roleId: "role-1", name: "Backend", description: "Bygger API-et", archived: false };

describe("RoleForm — create", () => {
  it("creates a role from a title and a description, and reports success", async () => {
    createAdminRoleMock.mockResolvedValue({ ok: true, role: { ...existing } });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<RoleForm token="admin-token" onSaved={onSaved} onCancel={() => {}} />);

    await user.type(screen.getByLabelText(adminRolesCopy.form.nameLabel), "Backend");
    await user.type(screen.getByLabelText(adminRolesCopy.form.descriptionLabel), "Bygger API-et");
    await user.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(createAdminRoleMock).toHaveBeenCalledWith("admin-token", { name: "Backend", description: "Bygger API-et" });
  });

  it("refuses to send when the description is missing, and says so next to the field", async () => {
    const user = userEvent.setup();
    render(<RoleForm token="admin-token" onSaved={() => {}} onCancel={() => {}} />);

    await user.type(screen.getByLabelText(adminRolesCopy.form.nameLabel), "Backend");
    await user.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(createAdminRoleMock).not.toHaveBeenCalled();
    expect(screen.getByText(adminRolesCopy.form.descriptionError)).toBeTruthy();
  });

  it("maps a server refusal to its neutral message and keeps the entered content", async () => {
    createAdminRoleMock.mockResolvedValue({ ok: false, error: "cap_reached" });
    const user = userEvent.setup();
    render(<RoleForm token="admin-token" onSaved={() => {}} onCancel={() => {}} />);

    await user.type(screen.getByLabelText(adminRolesCopy.form.nameLabel), "Backend");
    await user.type(screen.getByLabelText(adminRolesCopy.form.descriptionLabel), "Bygger API-et");
    await user.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(await screen.findByText(roleErrorMessage("cap_reached"))).toBeTruthy();
    expect((screen.getByLabelText(adminRolesCopy.form.nameLabel) as HTMLInputElement).value).toBe("Backend");
  });
});

describe("RoleForm — edit", () => {
  it("sends only the changed description and keeps the title out of the request", async () => {
    updateAdminRoleMock.mockResolvedValue({ ok: true, role: { ...existing, description: "Ny beskrivelse" } });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<RoleForm token="admin-token" role={existing} onSaved={onSaved} onCancel={() => {}} />);

    const description = screen.getByLabelText(adminRolesCopy.form.descriptionLabel);
    await user.clear(description);
    await user.type(description, "Ny beskrivelse");
    await user.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(updateAdminRoleMock).toHaveBeenCalledWith("admin-token", "role-1", { description: "Ny beskrivelse" });
  });

  it("refuses to clear the description: an emptied description is a validation error, nothing is sent", async () => {
    const user = userEvent.setup();
    render(<RoleForm token="admin-token" role={existing} onSaved={() => {}} onCancel={() => {}} />);

    await user.clear(screen.getByLabelText(adminRolesCopy.form.descriptionLabel));
    await user.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(updateAdminRoleMock).not.toHaveBeenCalled();
    expect(screen.getByText(adminRolesCopy.form.descriptionError)).toBeTruthy();
  });

  it("closes without a request when nothing changed", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<RoleForm token="admin-token" role={existing} onSaved={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(updateAdminRoleMock).not.toHaveBeenCalled();
  });
});
