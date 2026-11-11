import { describe, expect, it } from "vitest";
import { parseStoredRoleAssignment, validateRoleAssignmentDraft } from "./role-assignment";

const T0 = new Date("2026-06-01T00:00:00.000Z");

describe("role assignment draft validation", () => {
  it("accepts exactly { roleId } with a stable role id", () => {
    expect(validateRoleAssignmentDraft({ roleId: "role-1" })).toEqual({ ok: true, draft: { roleId: "role-1" } });
  });

  it.each([
    ["a title instead of an id", { roleId: "Backend-utvikler", name: "Backend-utvikler" }],
    ["a uid in the body", { roleId: "role-1", uid: "member-1" }],
    ["an audit field in the body", { roleId: "role-1", createdBy: "admin-1" }],
    ["a role id with a path separator", { roleId: "a/b" }],
    ["an empty role id", { roleId: "" }],
    ["a non-string role id", { roleId: 42 }],
    ["an array instead of an object", ["role-1"]],
  ])("refuses %s", (_label, input) => {
    expect(validateRoleAssignmentDraft(input).ok).toBe(false);
  });
});

describe("stored role assignment parsing", () => {
  const stored = { roleId: "role-1", createdAt: T0, createdBy: "admin-1" };

  it("parses a creation record, with an optional change record", () => {
    expect(parseStoredRoleAssignment(stored)).toEqual({ ok: true, assignment: stored });
    expect(parseStoredRoleAssignment({ ...stored, updatedAt: T0, updatedBy: "admin-2" }).ok).toBe(true);
  });

  it("fails closed on an unknown field, a missing creator or a non-date creation time", () => {
    expect(parseStoredRoleAssignment({ ...stored, title: "Backend" }).ok).toBe(false);
    expect(parseStoredRoleAssignment({ roleId: "role-1", createdAt: T0 }).ok).toBe(false);
    expect(parseStoredRoleAssignment({ ...stored, createdAt: "2026-06-01" }).ok).toBe(false);
  });
});
