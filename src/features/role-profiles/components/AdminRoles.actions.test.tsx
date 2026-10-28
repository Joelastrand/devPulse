// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { adminRolesCopy } from "../copy";
import type { AdminRoleView } from "../client/roles-gateway";

const observeIdTokenMock = vi.fn();
const fetchAdminRolesMock = vi.fn();
const setAdminRoleArchivedMock = vi.fn();
const fetchAdminSkillTreesMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/roles-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client/roles-gateway")>();
  return { ...actual, fetchAdminRoles: fetchAdminRolesMock, setAdminRoleArchived: setAdminRoleArchivedMock };
});
vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({
  fetchAdminSkillTrees: fetchAdminSkillTreesMock,
}));

const { AdminRoles } = await import("./AdminRoles");

const ACTIVE: AdminRoleView = {
  roleId: "role-1",
  name: "Backend",
  archived: false,
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
};
const ARCHIVED: AdminRoleView = { roleId: "role-2", name: "Frontend", archived: true, expectations: [] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function signedIn() {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("admin-token");
    return () => {};
  });
}

async function renderPage(roles: AdminRoleView[]) {
  signedIn();
  fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles, truncated: false });
  fetchAdminSkillTreesMock.mockResolvedValue({
    status: "ok",
    trees: [{ treeId: "api", name: "API design", nodes: [] }],
  });
  render(<AdminRoles />);
  await waitFor(() => expect(screen.queryByText(adminRolesCopy.loading)).toBeNull());
}

function rowFor(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("li") as HTMLElement;
}

describe("AdminRoles actions", () => {
  it("archives an active role and refetches the list", async () => {
    await renderPage([ACTIVE]);
    setAdminRoleArchivedMock.mockResolvedValue({ ok: true, role: { ...ACTIVE, archived: true } });
    fetchAdminRolesMock.mockResolvedValueOnce({ status: "ok", roles: [{ ...ACTIVE, archived: true }], truncated: false });

    await userEvent.click(within(rowFor("Backend")).getByRole("button", { name: new RegExp(`^${adminRolesCopy.archiveRole}`) }));

    expect(setAdminRoleArchivedMock).toHaveBeenCalledWith("admin-token", "role-1", true);
    await waitFor(() => expect(within(rowFor("Backend")).getByText(adminRolesCopy.statusArchived)).toBeTruthy());
    expect(fetchAdminRolesMock).toHaveBeenCalledTimes(2);
  });

  it("restores an archived role, and offers no archive action for it", async () => {
    await renderPage([ARCHIVED]);
    setAdminRoleArchivedMock.mockResolvedValue({ ok: true, role: { ...ARCHIVED, archived: false } });

    const row = rowFor("Frontend");
    expect(within(row).queryByRole("button", { name: new RegExp(`^${adminRolesCopy.archiveRole}`) })).toBeNull();
    expect((within(row).getByRole("button", { name: new RegExp(`^${adminRolesCopy.editRole}`) }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(within(row).getByRole("button", { name: new RegExp(`^${adminRolesCopy.restoreRole}`) }));

    expect(setAdminRoleArchivedMock).toHaveBeenCalledWith("admin-token", "role-2", false);
  });

  it("shows a neutral alert on the affected role when archiving fails, and keeps the list", async () => {
    await renderPage([ACTIVE]);
    setAdminRoleArchivedMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await userEvent.click(within(rowFor("Backend")).getByRole("button", { name: new RegExp(`^${adminRolesCopy.archiveRole}`) }));

    expect(await within(rowFor("Backend")).findByRole("alert")).toBeTruthy();
    expect(screen.getByText(adminRolesCopy.errors.persistence_failed)).toBeTruthy();
    expect(fetchAdminRolesMock).toHaveBeenCalledTimes(1);
  });

  it("opens the create form from the page button and closes it on cancel", async () => {
    await renderPage([]);

    const toggle = screen.getByRole("button", { name: adminRolesCopy.newRole });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: adminRolesCopy.form.createHeading })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.cancel }));

    expect(screen.queryByRole("heading", { name: adminRolesCopy.form.createHeading })).toBeNull();
  });

  it("opens one edit form at a time, from the row's edit button", async () => {
    await renderPage([ACTIVE, { ...ACTIVE, roleId: "role-3", name: "Platform" }]);

    await userEvent.click(within(rowFor("Backend")).getByRole("button", { name: new RegExp(`^${adminRolesCopy.editRole}`) }));
    expect(screen.getByRole("heading", { name: adminRolesCopy.form.editHeading("Backend") })).toBeTruthy();

    await userEvent.click(within(rowFor("Platform")).getByRole("button", { name: new RegExp(`^${adminRolesCopy.editRole}`) }));
    expect(screen.queryByRole("heading", { name: adminRolesCopy.form.editHeading("Backend") })).toBeNull();
    expect(screen.getByRole("heading", { name: adminRolesCopy.form.editHeading("Platform") })).toBeTruthy();
  });
});
