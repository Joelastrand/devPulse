import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { LEGACY_TEAM_SEEDS } from "../domain/legacy-team-seed";
import type {
  LegacyTeamSeedCollection,
  LegacyTeamSeedRecord,
} from "./seed-legacy-teams";
import { isAlreadyExistsError, seedLegacyTeams } from "./seed-legacy-teams";

const ADMIN_EMAIL = "admin@example.com";
const LEGACY_IDS = LEGACY_TEAM_SEEDS.map((seed) => seed.teamId);

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

/**
 * An in-memory fake reproducing Firestore's `DocumentReference.create()`
 * atomicity: the existence check and the write happen inside one
 * synchronous block with no `await` between them, so — exactly like a real
 * Firestore create-only write — two logically concurrent callers can never
 * both observe "absent" for the same id and both write.
 */
function fakeCollection(
  existing: Record<string, LegacyTeamSeedRecord> = {},
): LegacyTeamSeedCollection & { store: Record<string, LegacyTeamSeedRecord> } {
  const store: Record<string, LegacyTeamSeedRecord> = { ...existing };
  return {
    store,
    async createIfAbsent(teamId, record) {
      if (teamId in store) {
        return "already_exists";
      }
      store[teamId] = record;
      return "created";
    },
  };
}

describe("seedLegacyTeams", () => {
  it("creates all four missing legacy teams with their exact legacy ids, active, once", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
      now: new Date("2026-09-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcomes).toEqual(
      LEGACY_IDS.map((teamId) => ({ teamId, result: "created" })),
    );
    for (const seed of LEGACY_TEAM_SEEDS) {
      expect(collection.store[seed.teamId]).toEqual({
        name: seed.name,
        status: "active",
        createdAt: new Date("2026-09-01T00:00:00Z"),
        createdBy: "admin-1",
      });
    }
  });

  it("is idempotent: running twice creates no duplicate and reports already_exists the second time", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    await seedLegacyTeams("token", { verifyToken, allowList: [ADMIN_EMAIL], collection });
    const second = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcomes).toEqual(
      LEGACY_IDS.map((teamId) => ({ teamId, result: "already_exists" })),
    );
    expect(Object.keys(collection.store).sort()).toEqual([...LEGACY_IDS].sort());
  });

  it("preserves an existing team document untouched, including a disabled one", async () => {
    const existingDisabled = {
      name: "platform",
      status: "disabled",
      createdAt: new Date("2020-01-01T00:00:00Z"),
      createdBy: "someone-else",
    } as unknown as LegacyTeamSeedRecord;
    const collection = fakeCollection({ platform: existingDisabled });
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const platformOutcome = result.outcomes.find((o) => o.teamId === "platform");
    expect(platformOutcome).toEqual({ teamId: "platform", result: "already_exists" });
    expect(collection.store.platform).toEqual(existingDisabled);
  });

  it("handles partial-existing state: creates only the missing legacy teams", async () => {
    const collection = fakeCollection({
      platform: {
        name: "platform",
        status: "active",
        createdAt: new Date("2020-01-01T00:00:00Z"),
        createdBy: "someone-else",
      },
    });
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
      now: new Date("2026-09-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcomes).toEqual(
      LEGACY_IDS.map((teamId) => ({
        teamId,
        result: teamId === "platform" ? "already_exists" : "created",
      })),
    );
  });

  it("two concurrent seed invocations can never both create the same legacy id — exactly one wins each id, and the loser never overwrites the winner", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const [first, second] = await Promise.all([
      seedLegacyTeams("token", {
        verifyToken,
        allowList: [ADMIN_EMAIL],
        collection,
        now: new Date("2026-09-01T00:00:00Z"),
      }),
      seedLegacyTeams("token", {
        verifyToken,
        allowList: [ADMIN_EMAIL],
        collection,
        now: new Date("2026-09-02T00:00:00Z"),
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    for (const teamId of LEGACY_IDS) {
      const firstResult = first.outcomes.find((o) => o.teamId === teamId)?.result;
      const secondResult = second.outcomes.find((o) => o.teamId === teamId)?.result;
      expect([firstResult, secondResult].sort()).toEqual(["already_exists", "created"]);
    }

    // Exactly one document per legacy id — no duplicate, no lost write.
    expect(Object.keys(collection.store).sort()).toEqual([...LEGACY_IDS].sort());
  });

  it("resolves to already_exists, never an overwrite, when another actor creates the same legacy team mid-invocation (between this call's processing of two earlier/later ids)", async () => {
    const collection = fakeCollection();
    const concurrentlyCreated: LegacyTeamSeedRecord = {
      name: "concurrently created",
      status: "active",
      createdAt: new Date("2020-01-01T00:00:00Z"),
      createdBy: "another-actor",
    };
    const realCreateIfAbsent = collection.createIfAbsent.bind(collection);
    let injected = false;
    collection.createIfAbsent = async (teamId, record) => {
      if (teamId === LEGACY_IDS[0] && !injected) {
        injected = true;
        // Simulate another actor's write landing on the *next* legacy id
        // in between this invocation's own create calls for the first and
        // second ids — there must be no stale pre-check that could miss it.
        collection.store[LEGACY_IDS[1]] = concurrentlyCreated;
      }
      return realCreateIfAbsent(teamId, record);
    };

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = result.outcomes.find((o) => o.teamId === LEGACY_IDS[1]);
    expect(outcome).toEqual({ teamId: LEGACY_IDS[1], result: "already_exists" });
    expect(collection.store[LEGACY_IDS[1]]).toEqual(concurrentlyCreated);
  });

  it("cannot reactivate a legacy team that another actor created and then disabled mid-invocation, before this call's own write for that id", async () => {
    const collection = fakeCollection();
    const concurrentlyDisabled = {
      name: LEGACY_IDS[1],
      status: "disabled",
      createdAt: new Date("2020-01-01T00:00:00Z"),
      createdBy: "another-admin",
    } as unknown as LegacyTeamSeedRecord;
    const realCreateIfAbsent = collection.createIfAbsent.bind(collection);
    let injected = false;
    collection.createIfAbsent = async (teamId, record) => {
      if (teamId === LEGACY_IDS[0] && !injected) {
        injected = true;
        collection.store[LEGACY_IDS[1]] = concurrentlyDisabled;
      }
      return realCreateIfAbsent(teamId, record);
    };

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = result.outcomes.find((o) => o.teamId === LEGACY_IDS[1]);
    expect(outcome).toEqual({ teamId: LEGACY_IDS[1], result: "already_exists" });
    expect(collection.store[LEGACY_IDS[1]]).toEqual(concurrentlyDisabled);
  });

  it("reports a per-team write failure clearly, without failing the whole call or leaking raw error detail", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection: LegacyTeamSeedCollection = {
      createIfAbsent: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcomes).toEqual(
      LEGACY_IDS.map((teamId) => ({ teamId, result: "failed" })),
    );
    expect(JSON.stringify(result)).not.toContain("simulated firestore outage");
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await seedLegacyTeams("bad-token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(Object.keys(collection.store)).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ email: "dev@example.com" }),
    );

    const result = await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(Object.keys(collection.store)).toHaveLength(0);
  });

  it("never includes the admin allow-list in the returned result, success or failure", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];

    const okResult = await seedLegacyTeams("token", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      collection: fakeCollection(),
    });
    const forbiddenResult = await seedLegacyTeams("token", {
      verifyToken: verifyTokenReturning(
        verifiedIdentity({ email: "dev@example.com" }),
      ),
      allowList,
      collection: fakeCollection(),
    });

    expect(JSON.stringify(okResult)).not.toContain("other-admin@example.com");
    expect(JSON.stringify(forbiddenResult)).not.toContain("other-admin@example.com");
  });

  it("never logs the token, identity, or errors for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection: fakeCollection(),
    });

    const failingCollection: LegacyTeamSeedCollection = {
      createIfAbsent: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await seedLegacyTeams("token", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection: failingCollection,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("isAlreadyExistsError", () => {
  it("recognizes a Firestore ALREADY_EXISTS error (gRPC code 6)", () => {
    expect(isAlreadyExistsError({ code: 6 })).toBe(true);
    expect(isAlreadyExistsError(Object.assign(new Error("already exists"), { code: 6 }))).toBe(
      true,
    );
  });

  it("does not misclassify an unrelated error as ALREADY_EXISTS", () => {
    expect(isAlreadyExistsError(new Error("simulated firestore outage"))).toBe(false);
    expect(isAlreadyExistsError({ code: 5 })).toBe(false);
    expect(isAlreadyExistsError({ code: "6" })).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
    expect(isAlreadyExistsError(undefined)).toBe(false);
    expect(isAlreadyExistsError("ALREADY_EXISTS")).toBe(false);
  });
});
