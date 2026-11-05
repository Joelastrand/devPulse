// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../../src/features/role-profiles/components/AdminRoles", () => ({
  AdminRoles: () => <div data-testid="admin-roles" />,
}));

const { default: AdminRolesPage } = await import("./page");

describe("/admin/roles page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Roller heading and the admin role list", () => {
    render(<AdminRolesPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Roller" })).toBeTruthy();
    expect(screen.getByTestId("admin-roles")).toBeTruthy();
  });
});

describe("/admin/roles heading structure (visual-redesign TASK-019)", () => {
  it("has one level-1 page title and a valid hierarchy", () => {
    render(<AdminRolesPage />);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<AdminRolesPage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
