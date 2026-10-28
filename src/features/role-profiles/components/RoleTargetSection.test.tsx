// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogRoleView, ComparisonView, FetchComparisonResult, RoleTargetView } from "../client/role-target-gateway";
import { personRoleCopy, targetErrorMessage } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchOwnRoleTargetMock = vi.fn();
const fetchRoleCatalogMock = vi.fn();
const setOwnRoleTargetMock = vi.fn();
const clearOwnRoleTargetMock = vi.fn();
const fetchRoleComparisonMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/role-target-gateway", () => ({
  fetchOwnRoleTarget: fetchOwnRoleTargetMock,
  fetchRoleCatalog: fetchRoleCatalogMock,
  setOwnRoleTarget: setOwnRoleTargetMock,
  clearOwnRoleTarget: clearOwnRoleTargetMock,
  fetchRoleComparison: fetchRoleComparisonMock,
}));

const { RoleTargetSection } = await import("./RoleTargetSection");

const BACKEND: CatalogRoleView = {
  roleId: "role-1",
  name: "Backend",
  selectable: true,
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
};
const FRONTEND: CatalogRoleView = {
  roleId: "role-2",
  name: "Frontend",
  selectable: true,
  expectations: [{ treeId: "ui", treeName: "UI", expectedLevel: 2 }],
};
const UNSELECTABLE: CatalogRoleView = { roleId: "role-3", name: "Hemmelig", selectable: false, expectations: [] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderWith(
  target: RoleTargetView,
  roles: CatalogRoleView[] = [BACKEND, FRONTEND, UNSELECTABLE],
  comparison: FetchComparisonResult = { status: "ok", view: { state: "no_target" } },
) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("member-token");
    return () => {};
  });
  fetchOwnRoleTargetMock.mockResolvedValue({ status: "ok", view: target });
  fetchRoleCatalogMock.mockResolvedValue({ status: "ok", roles, truncated: false });
  fetchRoleComparisonMock.mockResolvedValue(comparison);
  render(<RoleTargetSection />);
  await waitFor(() => expect(screen.queryByText(personRoleCopy.loading)).toBeNull());
}

describe("RoleTargetSection — states", () => {
  it("shows the no-target state with a selector that offers only selectable roles (PG-2)", async () => {
    await renderWith({ status: "none" });

    expect(screen.getByText(personRoleCopy.noTarget)).toBeTruthy();
    const select = screen.getByLabelText(personRoleCopy.chooseRole) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      personRoleCopy.selectPlaceholder,
      "Backend",
      "Frontend",
    ]);
  });

  it("shows the empty copy when no role is selectable", async () => {
    await renderWith({ status: "none" }, [UNSELECTABLE]);

    expect(screen.getByText(personRoleCopy.noRoles)).toBeTruthy();
    expect(screen.queryByLabelText(personRoleCopy.chooseRole)).toBeNull();
  });

  it("shows the selected role with change and clear actions", async () => {
    await renderWith({ status: "selected", target: { roleId: "role-1", name: "Backend", archived: false } });

    expect(screen.getByText("Backend")).toBeTruthy();
    expect(screen.getByRole("button", { name: personRoleCopy.changeRole })).toBeTruthy();
    expect(screen.getByRole("button", { name: personRoleCopy.clearRole })).toBeTruthy();
    expect(screen.queryByText(personRoleCopy.archived)).toBeNull();
  });

  it("shows the archived notice for an archived target (BR-5)", async () => {
    await renderWith({ status: "selected", target: { roleId: "role-9", name: "Gammel", archived: true } });

    expect(screen.getByText(personRoleCopy.archived)).toBeTruthy();
  });

  it("shows the zero-expectation notice for an active role without expectations", async () => {
    await renderWith(
      { status: "selected", target: { roleId: "role-4", name: "Tom", archived: false } },
      [{ roleId: "role-4", name: "Tom", selectable: false, expectations: [] }],
    );

    expect(screen.getByText(personRoleCopy.noExpectations)).toBeTruthy();
  });

  it("shows the unavailable notice with change and clear still available (PG-3)", async () => {
    await renderWith({ status: "unavailable" });

    expect(screen.getByRole("alert").textContent).toBe(personRoleCopy.unavailable);
    expect(screen.getByRole("button", { name: personRoleCopy.changeRole })).toBeTruthy();
    expect(screen.getByRole("button", { name: personRoleCopy.clearRole })).toBeTruthy();
  });

  it("shows a neutral alert when the section cannot be read", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("member-token");
      return () => {};
    });
    fetchOwnRoleTargetMock.mockResolvedValue({ status: "read_failed" });
    fetchRoleCatalogMock.mockResolvedValue({ status: "ok", roles: [], truncated: false });
    render(<RoleTargetSection />);

    expect((await screen.findByRole("alert")).textContent).toBe(personRoleCopy.readFailed);
  });

  it("offers sign-in when the caller is signed out", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<RoleTargetSection />);

    expect(await screen.findByRole("link", { name: personRoleCopy.signInLink })).toBeTruthy();
    expect(fetchOwnRoleTargetMock).not.toHaveBeenCalled();
  });
});

describe("RoleTargetSection — comparison", () => {
  const AVAILABLE: ComparisonView = {
    state: "available",
    target: { roleId: "role-1", name: "Backend" },
    rows: [{ treeId: "api", treeName: "API design", expectedLevel: 3, status: "meets", ownLevel: 4 }],
  };

  it("shows the comparison rows under a selected target", async () => {
    await renderWith(
      { status: "selected", target: { roleId: "role-1", name: "Backend", archived: false } },
      [BACKEND],
      { status: "ok", view: AVAILABLE },
    );

    expect(await screen.findByText(personRoleCopy.comparison.meets)).toBeTruthy();
    expect(screen.getByText("API design")).toBeTruthy();
  });

  it("keeps the target visible and shows a neutral alert when only the comparison read fails", async () => {
    await renderWith(
      { status: "selected", target: { roleId: "role-1", name: "Backend", archived: false } },
      [BACKEND],
      { status: "read_failed" },
    );

    expect(screen.getByText("Backend")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(personRoleCopy.comparison.readFailed);
  });
});

describe("RoleTargetSection — actions", () => {
  it("clears the target through the clear route and shows the no-target state again", async () => {
    await renderWith({ status: "selected", target: { roleId: "role-1", name: "Backend", archived: false } });
    clearOwnRoleTargetMock.mockResolvedValue({ ok: true });
    fetchOwnRoleTargetMock.mockResolvedValueOnce({ status: "ok", view: { status: "none" } });

    await userEvent.click(screen.getByRole("button", { name: personRoleCopy.clearRole }));

    expect(clearOwnRoleTargetMock).toHaveBeenCalledWith("member-token");
    expect(await screen.findByText(personRoleCopy.noTarget)).toBeTruthy();
  });

  it("changes the target through the selector and sends only the chosen roleId", async () => {
    await renderWith({ status: "selected", target: { roleId: "role-1", name: "Backend", archived: false } });
    setOwnRoleTargetMock.mockResolvedValue({ ok: true, view: { status: "selected", target: { roleId: "role-2", name: "Frontend", archived: false } } });
    fetchOwnRoleTargetMock.mockResolvedValueOnce({
      status: "ok",
      view: { status: "selected", target: { roleId: "role-2", name: "Frontend", archived: false } },
    });

    await userEvent.click(screen.getByRole("button", { name: personRoleCopy.changeRole }));
    await userEvent.selectOptions(screen.getByLabelText(personRoleCopy.chooseRole), "role-2");
    await userEvent.click(screen.getByRole("button", { name: personRoleCopy.selectRole }));

    await waitFor(() => expect(setOwnRoleTargetMock).toHaveBeenCalledWith("member-token", "role-2"));
    expect(await screen.findByText("Frontend")).toBeTruthy();
  });

  it("shows the refusal of a role that cannot be selected in an alert, and keeps the selector open", async () => {
    await renderWith({ status: "none" });
    setOwnRoleTargetMock.mockResolvedValue({ ok: false, error: "role_not_selectable" });

    await userEvent.selectOptions(screen.getByLabelText(personRoleCopy.chooseRole), "role-1");
    await userEvent.click(screen.getByRole("button", { name: personRoleCopy.selectRole }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(targetErrorMessage("role_not_selectable"))).toBeTruthy();
    expect(screen.getByLabelText(personRoleCopy.chooseRole)).toBeTruthy();
  });
});
