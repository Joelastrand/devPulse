import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { Team } from "../domain/team";
import type { TeamListCollection } from "./list-teams";
import { listTeams } from "./list-teams";

const ADMIN_EMAIL = "admin@example.com";

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function fakeCollection(teams: Team[]): TeamListCollection {
  return { listAll: vi.fn().mockResolvedValue(teams) };
}

describe("listTeams", () => {
  it("returns every team, including disabled ones, for an app admin", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const teams = [
      { teamId: "team-1", name: "Platform", status: "active" as const, createdAt: new Date(), createdBy: "admin-1" },
      { teamId: "team-2", name: "Retired", status: "disabled" as const, createdAt: new Date(), createdBy: "admin-1" },
    ];
    const collection = fakeCollection(teams);

    const result = await listTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, teams });
  });

  it("rejects an unauthenticated caller and attempts no read", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));
    const collection = fakeCollection([]);

    const result = await listTeams("bad-token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.listAll).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and attempts no read", async () => {
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ email: "dev@example.com" }),
    );
    const collection = fakeCollection([]);

    const result = await listTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.listAll).not.toHaveBeenCalled();
  });

  it("never includes the admin allow-list in the returned result, success or failure", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];

    const okResult = await listTeams("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      collection: fakeCollection([]),
    });
    const forbiddenResult = await listTeams("token", {
      verifyToken: verifyTokenReturning(
        verifiedIdentity({ email: "dev@example.com" }),
      ),
      allowList,
      collection: fakeCollection([]),
    });

    expect(JSON.stringify(okResult)).not.toContain("other-admin@example.com");
    expect(JSON.stringify(forbiddenResult)).not.toContain(
      "other-admin@example.com",
    );
  });

  it("reports failure, not a partial list, when the Firestore read fails", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection: TeamListCollection = {
      listAll: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});
