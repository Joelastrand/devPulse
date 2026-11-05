// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure } from "../../../components/ui/heading-structure";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("AdminRoles split view (visual-redesign TASK-015)", () => {
  it("renders the list and the selected role side by side from lg, with no permission toggle, Rettigheter tab or assignment control (visual-fidelity TASK-017)", async () => {
    await renderWith({ status: "ok", truncated: false, roles: [role(), role({ roleId: "role-2", name: "Frontend" })] });

    const summary = screen.getByRole("list", { name: adminRolesCopy.splitListLabel });
    const grid = summary.parentElement;
    expect(grid?.className).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]");
    expect(summary.className).toContain("hidden");
    expect(summary.className).toContain("lg:flex");

    expect(screen.queryByRole("tab", { name: /Rettigheter/ })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /tildel|assign|rolle for/i })).toBeNull();
    expect(screen.queryByText(/Rettigheter/)).toBeNull();
  });

  it("lists every role in the summary list with its expectation count and archived text", async () => {
    await renderWith({
      status: "ok",
      truncated: false,
      roles: [
        role({ description: "Bygger API-et" }),
        role({ roleId: "role-2", name: "Frontend", archived: true, expectations: [] }),
      ],
    });

    const summary = screen.getByRole("list", { name: adminRolesCopy.splitListLabel });
    expect(within(summary).getByText("Bygger API-et")).toBeTruthy();
    expect(within(summary).getByRole("button", { name: /Backend/ }).textContent).toContain(
      adminRolesCopy.expectationCount(1),
    );
    expect(within(summary).getByRole("button", { name: /Frontend/ }).textContent).toContain(adminRolesCopy.statusArchived);
  });

  it("selects a role from the list: the selection moves and only that role's row is marked for desktop display", async () => {
    await renderWith({
      status: "ok",
      truncated: false,
      roles: [role(), role({ roleId: "role-2", name: "Frontend" })],
    });
    const summary = screen.getByRole("list", { name: adminRolesCopy.splitListLabel });
    const backendButton = within(summary).getByRole("button", { name: /Backend/ });
    const frontendButton = within(summary).getByRole("button", { name: /Frontend/ });

    expect(backendButton.getAttribute("aria-pressed")).toBe("true");
    const frontendRow = screen.getByRole("heading", { name: "Frontend" }).closest("li") as HTMLElement;
    expect(frontendRow.className).toContain("lg:hidden");

    await userEvent.click(frontendButton);

    expect(frontendButton.getAttribute("aria-pressed")).toBe("true");
    expect(backendButton.getAttribute("aria-pressed")).toBe("false");
    expect(frontendRow.className).not.toContain("lg:hidden");
  });

  it("closes an open editor when the selection moves to another role", async () => {
    await renderWith({
      status: "ok",
      truncated: false,
      roles: [role(), role({ roleId: "role-2", name: "Frontend" })],
    });
    const user = userEvent.setup();
    const backendRow = screen.getByRole("heading", { name: "Backend" }).closest("li") as HTMLElement;
    await user.click(within(backendRow).getByRole("button", { name: new RegExp(adminRolesCopy.editRole) }));
    expect(within(backendRow).getAllByRole("textbox").length).toBeGreaterThan(0);

    const summary = screen.getByRole("list", { name: adminRolesCopy.splitListLabel });
    await user.click(within(summary).getByRole("button", { name: /Frontend/ }));

    expect(within(backendRow).queryAllByRole("textbox")).toHaveLength(0);
  });
});

describe("admin roles heading structure (visual-redesign TASK-019)", () => {
  it("keeps a valid heading hierarchy for the split view", async () => {
    await renderWith({ status: "ok", truncated: false, roles: [role(), role({ roleId: "role-2", name: "Frontend" })] });
    expectHeadingStructure(document.body, { ownsPageTitle: false });
  });
});
