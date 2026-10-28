// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/features/role-profiles/components/AdminRoles", () => ({
  AdminRoles: () => <div data-testid="admin-roles" />,
}));

const { default: AdminRolesPage } = await import("./page");

describe("/admin/roles page", () => {
  it("renders the Roller heading and the admin role list", () => {
    render(<AdminRolesPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Roller" })).toBeTruthy();
    expect(screen.getByTestId("admin-roles")).toBeTruthy();
  });
});
