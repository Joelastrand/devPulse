// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { adminRolesCopy, personRoleCopy } from "./copy";
import type { AdminRoleView } from "./client/roles-gateway";

/*
 * Accessibility regression for the admin page and the /me/skills section (SPEC acceptance: keyboard and label checks).
 * It asserts the attributes a keyboard or screen-reader user depends on: real labels, error association, role="alert"
 * for server errors, a predictable focus order, and names that identify each row's action.
 */

const observeIdTokenMock = vi.fn();
const fetchAdminRolesMock = vi.fn();
const createAdminRoleMock = vi.fn();
const fetchOwnRoleTargetMock = vi.fn();
const fetchRoleCatalogMock = vi.fn();
const fetchRoleComparisonMock = vi.fn();
const fetchAdminSkillTreesMock = vi.fn();

vi.mock("../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("./client/roles-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client/roles-gateway")>();
  return {
    ...actual,
    fetchAdminRoles: fetchAdminRolesMock,
    createAdminRole: createAdminRoleMock,
  };
});
vi.mock("./client/role-target-gateway", () => ({
  fetchOwnRoleTarget: fetchOwnRoleTargetMock,
  fetchRoleCatalog: fetchRoleCatalogMock,
  fetchRoleComparison: fetchRoleComparisonMock,
  setOwnRoleTarget: vi.fn(),
  clearOwnRoleTarget: vi.fn(),
}));
vi.mock("../skill-trees/client/skill-trees-gateway", () => ({
  fetchAdminSkillTrees: fetchAdminSkillTreesMock,
}));

const { AdminRoles } = await import("./components/AdminRoles");
const { RoleTargetSection } = await import("./components/RoleTargetSection");

const CATALOG = [{ treeId: "api", name: "API design", nodes: [] }];
const ROLE: AdminRoleView = {
  roleId: "role-1",
  name: "Backend",
  archived: false,
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
};

function signedIn(token: string | null = "admin-token") {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin roles page — labels and focus", () => {
  it("opens the create form with every control labelled and the toggle pointing at the form", async () => {
    signedIn();
    fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [ROLE], truncated: false });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: CATALOG });
    render(<AdminRoles />);
    await waitFor(() => expect(screen.queryByText(adminRolesCopy.loading)).toBeNull());

    const toggle = screen.getByRole("button", { name: adminRolesCopy.newRole });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled).not.toBeNull();
    expect(screen.getByLabelText(adminRolesCopy.form.nameLabel)).toBeTruthy();
    expect(screen.getByLabelText(adminRolesCopy.form.descriptionLabel)).toBeTruthy();
  });

  it("names each row's action after its role, so the actions are distinguishable", async () => {
    signedIn();
    fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [ROLE], truncated: false });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: CATALOG });
    render(<AdminRoles />);

    expect(await screen.findByRole("button", { name: `${adminRolesCopy.editRole} Backend` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${adminRolesCopy.archiveRole} Backend` })).toBeTruthy();
  });

  it("moves focus through the create form in order: name, description, add, save, cancel", async () => {
    signedIn();
    fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [], truncated: false });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: CATALOG });
    render(<AdminRoles />);
    await waitFor(() => expect(screen.queryByText(adminRolesCopy.loading)).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.newRole }));

    const name = screen.getByLabelText(adminRolesCopy.form.nameLabel);
    name.focus();
    const order: Element[] = [name];
    for (let step = 0; step < 4; step += 1) {
      await userEvent.tab();
      order.push(document.activeElement as Element);
    }

    expect(order[1]).toBe(screen.getByLabelText(adminRolesCopy.form.descriptionLabel));
    expect(order[2]).toBe(screen.getByRole("button", { name: adminRolesCopy.form.addExpectation }));
    expect(order[3]).toBe(screen.getByRole("button", { name: adminRolesCopy.save }));
    expect(order[4]).toBe(screen.getByRole("button", { name: adminRolesCopy.cancel }));
  });
});

describe("admin role form — errors", () => {
  it("links a field error to its input through aria-describedby and marks the input invalid", async () => {
    signedIn();
    fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [], truncated: false });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: CATALOG });
    render(<AdminRoles />);
    await waitFor(() => expect(screen.queryByText(adminRolesCopy.loading)).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.newRole }));

    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    const input = screen.getByLabelText(adminRolesCopy.form.nameLabel);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    const described = describedBy.map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described.join(" ")).toContain(adminRolesCopy.form.nameError);
  });

  it("announces a server refusal with role=alert", async () => {
    signedIn();
    fetchAdminRolesMock.mockResolvedValue({ status: "ok", roles: [], truncated: false });
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: CATALOG });
    createAdminRoleMock.mockResolvedValue({ ok: false, error: "cap_reached" });
    render(<AdminRoles />);
    await waitFor(() => expect(screen.queryByText(adminRolesCopy.loading)).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.newRole }));
    await userEvent.type(screen.getByLabelText(adminRolesCopy.form.nameLabel), "Backend");

    await userEvent.click(screen.getByRole("button", { name: adminRolesCopy.save }));

    expect((await screen.findByRole("alert")).textContent).toBe(adminRolesCopy.errors.cap_reached);
  });
});

describe("/me/skills role section — labels", () => {
  it("labels the target selector and names its submit action", async () => {
    signedIn();
    fetchOwnRoleTargetMock.mockResolvedValue({ status: "ok", view: { status: "none" } });
    fetchRoleCatalogMock.mockResolvedValue({
      status: "ok",
      roles: [{ roleId: "role-1", name: "Backend", selectable: true, expectations: [] }],
      truncated: false,
    });
    fetchRoleComparisonMock.mockResolvedValue({ status: "ok", view: { state: "no_target" } });
    render(<RoleTargetSection />);

    const select = await screen.findByLabelText(personRoleCopy.chooseRole);
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("button", { name: personRoleCopy.selectRole })).toBeTruthy();
  });
});
