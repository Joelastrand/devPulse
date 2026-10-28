// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminRoleView } from "../client/roles-gateway";
import { adminRolesCopy } from "../copy";

const createAdminRoleMock = vi.fn();
const updateAdminRoleMock = vi.fn();

vi.mock("../client/roles-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client/roles-gateway")>();
  return { ...actual, createAdminRole: createAdminRoleMock, updateAdminRole: updateAdminRoleMock };
});

const { RoleForm } = await import("./RoleForm");

const CATALOG = [
  { treeId: "api", name: "API design", nodes: [] },
  { treeId: "testing", name: "Testing", nodes: [] },
];

const ROLE: AdminRoleView = {
  roleId: "role-1",
  name: "Backend",
  description: "Bygger tjenester",
  archived: false,
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(props: Partial<Parameters<typeof RoleForm>[0]> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(
    <RoleForm token="admin-token" catalog={CATALOG} catalogAvailable onSaved={onSaved} onCancel={onCancel} {...props} />,
  );
  return { onSaved, onCancel };
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText(adminRolesCopy.form.nameLabel) as HTMLInputElement;
}

describe("RoleForm — create", () => {
  it("shows the name error and sends nothing when the name is empty", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(createAdminRoleMock).not.toHaveBeenCalled();
    expect(screen.getByText(adminRolesCopy.form.nameError)).toBeTruthy();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("creates a role with zero expectations and only the name when no description is given (BR-3)", async () => {
    createAdminRoleMock.mockResolvedValue({ ok: true, role: ROLE });
    const { onSaved } = renderForm();

    await userEvent.type(nameInput(), "  Backend  ");
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createAdminRoleMock).toHaveBeenCalledWith("admin-token", { name: "Backend", expectations: [] });
  });

  it("rejects a row without a chosen SkillTree and a description over 500 characters, sending nothing", async () => {
    renderForm();

    await userEvent.type(nameInput(), "Backend");
    fireEvent.change(screen.getByLabelText(adminRolesCopy.form.descriptionLabel), { target: { value: "x".repeat(501) } });
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.form.addExpectation }));
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(createAdminRoleMock).not.toHaveBeenCalled();
    expect(screen.getByText(adminRolesCopy.form.descriptionError)).toBeTruthy();
    expect(screen.getByText(adminRolesCopy.form.expectationsError)).toBeTruthy();
  });

  it("maps a server refusal to its neutral message and keeps the entered content", async () => {
    createAdminRoleMock.mockResolvedValue({ ok: false, error: "cap_reached" });
    const { onSaved } = renderForm();

    await userEvent.type(nameInput(), "Backend");
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(await screen.findByText(adminRolesCopy.errors.cap_reached)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Backend");
  });
});

describe("RoleForm — edit", () => {
  it("closes without any request when nothing changed", async () => {
    const { onCancel, onSaved } = renderForm({ role: ROLE });

    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect(updateAdminRoleMock).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sends only the changed name, not the unchanged description or expectations", async () => {
    updateAdminRoleMock.mockResolvedValue({ ok: true, role: { ...ROLE, name: "Platform" } });
    const { onSaved } = renderForm({ role: ROLE });

    await userEvent.clear(nameInput());
    await userEvent.type(nameInput(), "Platform");
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateAdminRoleMock).toHaveBeenCalledWith("admin-token", "role-1", { name: "Platform" });
  });

  it("clears the description by sending an empty string when the field is emptied (PG-10)", async () => {
    updateAdminRoleMock.mockResolvedValue({ ok: true, role: { ...ROLE, description: undefined } });
    renderForm({ role: ROLE });

    await userEvent.clear(screen.getByLabelText(adminRolesCopy.form.descriptionLabel));
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    await waitFor(() => expect(updateAdminRoleMock).toHaveBeenCalledTimes(1));
    expect(updateAdminRoleMock).toHaveBeenCalledWith("admin-token", "role-1", { description: "" });
  });

  it("shows role_archived as a neutral alert when the role was archived by someone else (PG-6)", async () => {
    updateAdminRoleMock.mockResolvedValue({ ok: false, error: "role_archived" });
    renderForm({ role: ROLE });

    await userEvent.type(nameInput(), " 2");
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(adminRolesCopy.errors.role_archived)).toBeTruthy();
  });
});

describe("RoleForm — catalog and expectations", () => {
  it("disables saving and explains the problem when the SkillTree catalog is unavailable", () => {
    renderForm({ catalogAvailable: false });

    expect(screen.getByText(adminRolesCopy.form.noCatalog)).toBeTruthy();
    expect((screen.getByRole("button", { name: adminRolesCopy.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers only the catalog's SkillTrees and the levels 2 to 4 in an expectation row", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.form.addExpectation }));

    const area = screen.getByLabelText(adminRolesCopy.form.areaLabel) as HTMLSelectElement;
    const level = screen.getByLabelText(adminRolesCopy.form.levelLabel) as HTMLSelectElement;
    expect(Array.from(area.options).map((option) => option.textContent)).toEqual([
      adminRolesCopy.form.chooseArea,
      "API design",
      "Testing",
    ]);
    expect(Array.from(level.options).map((option) => option.value)).toEqual(["2", "3", "4"]);
  });
});
