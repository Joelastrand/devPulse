import { describe, expect, it, vi } from "vitest";
import { createFakeRegistry, depsFor, TWO_ADMINS, USERS } from "./superadmin-registry.test-helper";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import {
  grantSuperadmin,
  listSuperadmins,
  revokeSuperadmin,
} from "./superadmin-operations";
import { eraseSuperadminRecord } from "./superadmin-erasure";
import type { SuperadminStore } from "./superadmin-store";

describe("grantSuperadmin", () => {
  it("lets an existing superadmin grant superadmin to another verified user by email", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await grantSuperadmin("admin-uid", USERS.second.email, depsFor(registry));

    expect(result).toEqual({ ok: true, outcome: "granted", targetUid: "second-uid" });
    expect(registry.record("second-uid")).toMatchObject({ uid: "second-uid", active: true, grantedByUid: "admin-uid" });
    expect(registry.activeCount()).toBe(2);
  });

  it("treats granting an existing superadmin as an idempotent success without a second write", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);
    const writesBefore = registry.stats.writes;

    const result = await grantSuperadmin("admin-uid", USERS.second.email, depsFor(registry));

    expect(result).toEqual({ ok: true, outcome: "already_superadmin", targetUid: "second-uid" });
    expect(registry.stats.writes).toBe(writesBefore);
    expect(registry.activeCount()).toBe(2);
  });

  it("denies a grant from a verified user who is not a superadmin", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await grantSuperadmin("dev-uid", USERS.third.email, depsFor(registry));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(registry.record("third-uid")).toBeUndefined();
  });

  it("denies self-promotion by a user who is not a superadmin", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await grantSuperadmin("dev-uid", USERS.dev.email, depsFor(registry));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(registry.record("dev-uid")).toBeUndefined();
  });

  it("refuses a grant when the caller's superadmin role was revoked inside the transaction (stale role)", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);
    // The request-level check still sees an active superadmin, but the registry is revoked before the transaction reads it.
    const deps = depsFor(registry, { isSuperadmin: async () => true });
    registry.setRecord("second-uid", { active: false });

    const result = await grantSuperadmin("second-uid", USERS.third.email, deps);

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(registry.record("third-uid")).toBeUndefined();
  });

  it("returns target_not_found for an address with no Firebase Auth account and creates nothing", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });
    const writesBefore = registry.stats.writes;

    const result = await grantSuperadmin("admin-uid", "nobody@example.test", depsFor(registry));

    expect(result).toEqual({ ok: false, error: "target_not_found" });
    expect(registry.stats.writes).toBe(writesBefore);
  });

  it("refuses a target whose email is not verified", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await grantSuperadmin("admin-uid", USERS.unverified.email, depsFor(registry));

    expect(result).toEqual({ ok: false, error: "target_unverified" });
    expect(registry.record("unverified-uid")).toBeUndefined();
  });

  it("refuses a disabled target account", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await grantSuperadmin("admin-uid", USERS.disabled.email, depsFor(registry));

    expect(result).toEqual({ ok: false, error: "target_disabled" });
  });

  it("rejects malformed target input without looking the account up", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });
    const lookup = vi.fn();

    for (const input of [undefined, 42, "", "not-an-email", "a@b@c", "x y@example.test"]) {
      const result = await grantSuperadmin("admin-uid", input, depsFor(registry, { lookupAuthUserByEmail: lookup }));
      expect(result).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller with the existing unauthenticated refusal", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    const result = await grantSuperadmin("not-a-token", USERS.third.email, depsFor(registry));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("fails closed as auth_unavailable when the registry read for the caller fails", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);
    const deps = depsFor(registry, {
      isSuperadmin: async () => {
        throw new Error("firestore unavailable");
      },
    });

    const result = await grantSuperadmin("admin-uid", USERS.third.email, deps);

    expect(result).toEqual({ ok: false, error: "auth_unavailable" });
    expect(registry.record("third-uid")).toBeUndefined();
  });

  it("refuses the grant with erasure_in_progress when the target has an erasure record, writing nothing", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });
    const refusingStore: SuperadminStore = {
      ...registry.store,
      run: async () => {
        throw new ErasureWriteRefused();
      },
    };

    const result = await grantSuperadmin("admin-uid", USERS.second.email, depsFor(registry, { store: refusingStore }));

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(registry.record("second-uid")).toBeUndefined();
  });

  it("maps an invalid control document to persistence_failed and writes nothing (fails closed)", async () => {
    const registry = createFakeRegistry({
      records: { "admin-uid": { active: true } },
      activeCount: -3,
    });

    const result = await grantSuperadmin("admin-uid", USERS.second.email, depsFor(registry));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(registry.record("second-uid")).toBeUndefined();
  });
});

describe("revokeSuperadmin", () => {
  it("revokes another superadmin while one other active superadmin remains", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    const result = await revokeSuperadmin("admin-uid", "second-uid", depsFor(registry));

    expect(result).toEqual({ ok: true, targetUid: "second-uid" });
    expect(registry.record("second-uid")).toMatchObject({ active: false, revokedByUid: "admin-uid" });
    expect(registry.activeCount()).toBe(1);
  });

  it("refuses to revoke the last active superadmin, including by self-revocation", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await revokeSuperadmin("admin-uid", "admin-uid", depsFor(registry));

    expect(result).toEqual({ ok: false, error: "last_superadmin" });
    expect(registry.record("admin-uid")).toMatchObject({ active: true });
    expect(registry.activeCount()).toBe(1);
  });

  it("denies revocation from a verified user who is not a superadmin", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    const result = await revokeSuperadmin("dev-uid", "second-uid", depsFor(registry));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(registry.record("second-uid")).toMatchObject({ active: true });
  });

  it("returns not_superadmin for a target that is not an active superadmin", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    const result = await revokeSuperadmin("admin-uid", "dev-uid", depsFor(registry));

    expect(result).toEqual({ ok: false, error: "not_superadmin" });
    expect(registry.activeCount()).toBe(2);
  });

  it("rejects an empty or path-like target id as invalid input", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    expect(await revokeSuperadmin("admin-uid", "", depsFor(registry))).toEqual({ ok: false, error: "invalid_input" });
    expect(await revokeSuperadmin("admin-uid", "a/b", depsFor(registry))).toEqual({ ok: false, error: "invalid_input" });
  });

  it("lets concurrent revocations of different superadmins never remove the last active one", async () => {
    // Three superadmins: two revocations race, both reading the control document before either commits.
    const registry = createFakeRegistry({
      records: { "admin-uid": { active: true }, "second-uid": { active: true }, "third-uid": { active: true } },
      barrier: { size: 2 },
    });
    const deps = depsFor(registry);

    const [a, b] = await Promise.all([
      revokeSuperadmin("admin-uid", "second-uid", deps),
      revokeSuperadmin("third-uid", "admin-uid", deps),
    ]);

    // Both revocations are legitimate with three superadmins; the second one must see the first one's commit.
    expect(a).toEqual({ ok: true, targetUid: "second-uid" });
    expect(b).toEqual({ ok: true, targetUid: "admin-uid" });
    expect(registry.activeCount()).toBe(1);
    const remaining = ["admin-uid", "second-uid", "third-uid"].filter((uid) => registry.record(uid)?.active === true);
    expect(remaining).toEqual(["third-uid"]);
    expect(registry.stats.attempts).toBeGreaterThan(registry.stats.commits);
  });

  it("lets two concurrent revocations in a two-superadmin registry revoke at most one of them", async () => {
    const registry = createFakeRegistry({ ...TWO_ADMINS, barrier: { size: 2 } });
    const deps = depsFor(registry);

    const [a, b] = await Promise.all([
      revokeSuperadmin("admin-uid", "second-uid", deps),
      revokeSuperadmin("second-uid", "admin-uid", deps),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok)).toHaveLength(1);
    expect(registry.activeCount()).toBe(1);
    const active = ["admin-uid", "second-uid"].filter((uid) => registry.record(uid)?.active === true);
    expect(active).toHaveLength(1);
  });

  it("refuses with erasure_in_progress when the actor has an erasure record, writing nothing", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);
    const refusingStore: SuperadminStore = {
      ...registry.store,
      run: async () => {
        throw new ErasureWriteRefused();
      },
    };

    const result = await revokeSuperadmin("admin-uid", "second-uid", depsFor(registry, { store: refusingStore }));

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(registry.record("second-uid")).toMatchObject({ active: true });
  });
});

describe("listSuperadmins", () => {
  it("lists only active superadmin uids to a superadmin", async () => {
    const registry = createFakeRegistry({
      records: { "admin-uid": { active: true }, "second-uid": { active: true }, "dev-uid": { active: false } },
    });

    const result = await listSuperadmins("admin-uid", depsFor(registry));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.superadmins.map((row) => row.uid)).toEqual(["admin-uid", "second-uid"]);
  });

  it("denies the listing to a non-superadmin", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    expect(await listSuperadmins("dev-uid", depsFor(registry))).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("eraseSuperadminRecord (erasure cleanup of I-16)", () => {
  it("is idempotent: an absent record is ok with no write", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);
    const writesBefore = registry.stats.writes;

    expect(await eraseSuperadminRecord("dev-uid", { store: registry.store })).toEqual({ ok: true });
    expect(registry.stats.writes).toBe(writesBefore);
  });

  it("deletes a revoked record and leaves the count untouched", async () => {
    const registry = createFakeRegistry({
      records: { "admin-uid": { active: true }, "second-uid": { active: false } },
      activeCount: 1,
    });

    expect(await eraseSuperadminRecord("second-uid", { store: registry.store })).toEqual({ ok: true });
    expect(registry.record("second-uid")).toBeUndefined();
    expect(registry.activeCount()).toBe(1);
  });

  it("removes an active record through the count rule when another superadmin remains", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    expect(await eraseSuperadminRecord("second-uid", { store: registry.store })).toEqual({ ok: true });
    expect(registry.record("second-uid")).toBeUndefined();
    expect(registry.activeCount()).toBe(1);
  });

  it("refuses to delete the last active superadmin and keeps the record (fail closed)", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    expect(await eraseSuperadminRecord("admin-uid", { store: registry.store })).toEqual({
      ok: false,
      error: "last_superadmin",
    });
    expect(registry.record("admin-uid")).toMatchObject({ active: true });
    expect(registry.activeCount()).toBe(1);
  });
});
