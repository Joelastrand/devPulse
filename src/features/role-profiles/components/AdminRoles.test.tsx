// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { adminRolesCopy } from "../copy";
import type { AdminRoleView, FetchAdminRolesResult } from "../client/roles-gateway";

const observeIdTokenMock = vi.fn();
const fetchAdminRolesMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/roles-gateway", () => ({
  fetchAdminRoles: fetchAdminRolesMock,
  setAdminRoleArchived: vi.fn(),
}));
vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({
  fetchAdminSkillTrees: vi.fn().mockResolvedValue({ status: "ok", trees: [] }),
}));

const { AdminRoles } = await import("./AdminRoles");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function signedInWith(token: string | null) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  });
}

function role(overrides: Partial<AdminRoleView> = {}): AdminRoleView {
  return {
    roleId: "role-1",
    name: "Backend",
    archived: false,
    expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
    ...overrides,
  };
}

async function renderWith(result: FetchAdminRolesResult) {
  signedInWith("admin-token");
  fetchAdminRolesMock.mockResolvedValue(result);
  render(<AdminRoles />);
  await waitFor(() => expect(screen.queryByText(adminRolesCopy.loading)).toBeNull());
}

describe("AdminRoles", () => {
  it("shows the personal-name notice and lists active and archived roles with a text status label", async () => {
    await renderWith({
      status: "ok",
      truncated: false,
      roles: [role(), role({ roleId: "role-2", name: "Frontend", archived: true })],
    });

    const active = screen.getByRole("heading", { name: "Backend" }).closest("li") as HTMLElement;
    const archived = screen.getByRole("heading", { name: "Frontend" }).closest("li") as HTMLElement;
    expect(within(active).getByText(adminRolesCopy.statusActive)).toBeTruthy();
    expect(within(archived).getByText(adminRolesCopy.statusArchived)).toBeTruthy();
    expect(fetchAdminRolesMock).toHaveBeenCalledWith("admin-token");
  });

  it("lists each expectation with its level, and marks an unavailable SkillTree as unavailable", async () => {
    await renderWith({
      status: "ok",
      truncated: false,
      roles: [
        role({
          expectations: [
            { treeId: "api", treeName: "API design", expectedLevel: 3 },
            { treeId: "gone", treeName: null, expectedLevel: 2 },
          ],
        }),
      ],
    });

    expect(screen.getByText(/API design/)).toBeTruthy();
    expect(screen.getByText(`${adminRolesCopy.unavailableArea} — ${adminRolesCopy.expectedLevel(2)}`, { exact: false })).toBeTruthy();
  });

  it("shows the empty-state copy when there are no roles", async () => {
    await renderWith({ status: "ok", truncated: false, roles: [] });

    expect(screen.getByText(adminRolesCopy.empty)).toBeTruthy();
  });

  it("shows the no-expectations copy for a role without expectations", async () => {
    await renderWith({ status: "ok", truncated: false, roles: [role({ expectations: [] })] });

    expect(screen.getByText(adminRolesCopy.noExpectations)).toBeTruthy();
  });

  it("shows a generic forbidden alert for a non-admin without confirming any admin list", async () => {
    await renderWith({ status: "forbidden" });

    expect(screen.getByRole("alert").textContent).toBe(adminRolesCopy.forbidden);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("shows a neutral error alert when the list cannot be read, with no role content", async () => {
    await renderWith({ status: "read_failed" });

    expect(screen.getByRole("alert").textContent).toBe(adminRolesCopy.readFailed);
  });

  it("offers sign-in when the caller is signed out", async () => {
    signedInWith(null);
    render(<AdminRoles />);

    expect(await screen.findByRole("link", { name: adminRolesCopy.signInLink })).toBeTruthy();
    expect(fetchAdminRolesMock).not.toHaveBeenCalled();
  });
});
