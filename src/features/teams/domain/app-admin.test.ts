import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isAppAdmin } from "./app-admin";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    uid: "user-1",
    email: "admin@example.com",
    emailVerified: true,
    ...overrides,
  };
}

describe("isAppAdmin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for a verified email present in the allow-list", () => {
    const result = isAppAdmin(identity({ email: "admin@example.com" }), {
      allowList: ["admin@example.com"],
    });

    expect(result).toBe(true);
  });

  it("returns false for a verified email absent from the allow-list", () => {
    const result = isAppAdmin(identity({ email: "dev@example.com" }), {
      allowList: ["admin@example.com"],
    });

    expect(result).toBe(false);
  });

  it("returns false for an allow-listed but unverified email", () => {
    const result = isAppAdmin(
      identity({ email: "admin@example.com", emailVerified: false }),
      { allowList: ["admin@example.com"] },
    );

    expect(result).toBe(false);
  });

  it("matches case-insensitively and ignores surrounding whitespace on both sides", () => {
    const result = isAppAdmin(identity({ email: "Admin@Example.com" }), {
      allowList: [" admin@example.com "],
    });

    expect(result).toBe(true);
  });

  it("never treats a client-supplied role/flag on the identity as admin evidence", () => {
    const spoofedIdentity = {
      ...identity({ email: "dev@example.com" }),
      isAdmin: true,
    };

    const result = isAppAdmin(spoofedIdentity, { allowList: ["admin@example.com"] });

    expect(result).toBe(false);
  });

  it("falls back to the server-only APP_ADMIN_EMAILS env var when no allow-list is injected", () => {
    vi.stubEnv("APP_ADMIN_EMAILS", "admin@example.com, other@example.com");

    expect(isAppAdmin(identity({ email: "admin@example.com" }))).toBe(true);
    expect(isAppAdmin(identity({ email: "other@example.com" }))).toBe(true);
    expect(isAppAdmin(identity({ email: "nobody@example.com" }))).toBe(false);
  });

  it("treats a missing/empty APP_ADMIN_EMAILS env var as an empty allow-list", () => {
    vi.stubEnv("APP_ADMIN_EMAILS", "");

    expect(isAppAdmin(identity({ email: "admin@example.com" }))).toBe(false);
  });
});
