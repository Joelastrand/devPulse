import { describe, expect, it } from "vitest";
import { listQueryFrom, userManagementErrorStatus } from "./user-management-http";
import type { UserManagementError } from "./user-management";

describe("userManagementErrorStatus", () => {
  it.each<[UserManagementError, number]>([
    ["unauthenticated", 401],
    ["erasure_in_progress", 403],
    ["auth_unavailable", 503],
    ["forbidden", 403],
    ["invalid_input", 400],
    ["confirmation_required", 400],
    ["user_not_found", 404],
    ["self_action_refused", 409],
    ["target_is_superadmin", 409],
    ["persistence_failed", 500],
  ])("maps %s to HTTP %i", (error, status) => {
    expect(userManagementErrorStatus(error)).toBe(status);
  });
});

describe("listQueryFrom", () => {
  it("passes the raw query values through as untrusted input, and omits absent ones", () => {
    expect(listQueryFrom(new URL("https://example.test/api/admin/users?limit=10&pageToken=abc&email=a%40nve.no"))).toEqual({
      limit: 10,
      pageToken: "abc",
      email: "a@nve.no",
    });
    expect(listQueryFrom(new URL("https://example.test/api/admin/users"))).toEqual({
      limit: undefined,
      pageToken: undefined,
      email: undefined,
    });
  });
});
