import { describe, expect, it } from "vitest";
import { resolveTeamForUser } from "./team-assignments";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    uid: "user-1",
    email: "dev@example.com",
    emailVerified: true,
    ...overrides,
  };
}

describe("resolveTeamForUser", () => {
  it("resolves a verified, mapped email to its teamId", () => {
    const result = resolveTeamForUser(identity({ email: "dev@example.com" }), {
      assignments: { "dev@example.com": "platform" },
    });

    expect(result).toEqual({ ok: true, teamId: "platform" });
  });

  it("returns unverified for a mapped but unverified email", () => {
    const result = resolveTeamForUser(
      identity({ email: "dev@example.com", emailVerified: false }),
      { assignments: { "dev@example.com": "platform" } },
    );

    expect(result).toEqual({ ok: false, reason: "unverified" });
  });

  it("returns unassigned for a verified email absent from the mapping", () => {
    const result = resolveTeamForUser(identity({ email: "nobody@example.com" }), {
      assignments: { "dev@example.com": "platform" },
    });

    expect(result).toEqual({ ok: false, reason: "unassigned" });
  });

  it("returns unassigned when the mapped teamId is no longer allowed", () => {
    const result = resolveTeamForUser(identity({ email: "dev@example.com" }), {
      assignments: { "dev@example.com": "retired-team" },
    });

    expect(result).toEqual({ ok: false, reason: "unassigned" });
  });

  it("resolves purely from the verified identity's email, ignoring unrelated mapping entries", () => {
    const result = resolveTeamForUser(identity({ email: "dev@example.com" }), {
      assignments: {
        "dev@example.com": "platform",
        "other@example.com": "mobile",
      },
    });

    expect(result).toEqual({ ok: true, teamId: "platform" });
  });
});
