import { describe, expect, it } from "vitest";
import {
  adminRolesCopy,
  roleAssignmentCopy,
  roleAssignmentErrorMessage,
  roleErrorMessage,
} from "./copy";

describe("role copy", () => {
  it("maps known admin role error codes to their text", () => {
    expect(roleErrorMessage("role_archived")).toBe(adminRolesCopy.errors.role_archived);
  });

  it("maps an unknown admin error code to the neutral failure text, never raw content", () => {
    expect(roleErrorMessage("something_new")).toBe(adminRolesCopy.errors.persistence_failed);
  });

  it("maps assignment errors, and falls back to the neutral failure text", () => {
    expect(roleAssignmentErrorMessage("self_assignment")).toBe(roleAssignmentCopy.errors.self_assignment);
    expect(roleAssignmentErrorMessage("something_new")).toBe(roleAssignmentCopy.errors.persistence_failed);
  });

  it("states that the description is required", () => {
    expect(adminRolesCopy.form.descriptionHint).toContain("Påkrevd");
  });

  it("carries no skill-expectation or target-role wording in any role copy", () => {
    const serialized = JSON.stringify([adminRolesCopy, roleAssignmentCopy]);
    expect(serialized).not.toMatch(/forventning|målrolle|Målrolle|Rolleforventning|Forventet nivå/);
  });
});
