import { describe, expect, it, vi } from "vitest";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { type ReadErasureFence } from "../../auth/server/erasure-fence";
import {
  grantSuperadmin,
  listSuperadmins,
  revokeSuperadmin,
  type SuperadminOperationDeps,
} from "./superadmin-operations";
import { readSuperadminActive } from "./superadmin-policy";
import { eraseSuperadminRecord, revokeSuperadminForErasureStart } from "./superadmin-erasure";
import type { SuperadminStore, SuperadminTransaction } from "./superadmin-store";

/**
 * In-memory registry with Firestore-like optimistic transactions. A transaction records the version of every document it
 * reads; at commit, any version change since the read is a conflict and the work is re-run, as Firestore does. This
 * models the serialization mechanism (the control document) without the Firestore emulator, which is not available here.
 */
const CONTROL = "superadminRegistry/control";
const recordKey = (uid: string) => `superadmins/${uid}`;

interface Seed {
  readonly records?: Record<string, { active: boolean }>;
  readonly activeCount?: unknown;
  /** Makes the first `size` transactions that read the control document wait for each other before any commits. */
  readonly barrier?: { size: number };
}

function createFakeRegistry(seed: Seed = {}) {
  const docs = new Map<string, { data: Record<string, unknown>; version: number }>();
  const versionOf = (key: string) => docs.get(key)?.version ?? 0;
  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));
  const upsert = (key: string, fields: Record<string, unknown>) => {
    const current = docs.get(key);
    docs.set(key, { data: { ...(current?.data ?? {}), ...fields }, version: versionOf(key) + 1 });
  };

  for (const [uid, record] of Object.entries(seed.records ?? {})) {
    docs.set(recordKey(uid), { data: { uid, ...record, grantedAt: new Date(0) }, version: 1 });
  }
  if (seed.activeCount !== undefined || seed.records) {
    const count = seed.activeCount ?? Object.values(seed.records ?? {}).filter((r) => r.active).length;
    docs.set(CONTROL, { data: { activeCount: count }, version: 1 });
  }

  let arrived = 0;
  let release: (() => void) | undefined;
  const gate = seed.barrier ? new Promise<void>((resolve) => (release = resolve)) : undefined;

  const stats = { attempts: 0, commits: 0, writes: 0 };

  const store: SuperadminStore = {
    async readRecord(uid) {
      return clone(docs.get(recordKey(uid))?.data);
    },
    async listActiveRecords() {
      return [...docs.entries()]
        .filter(([key, doc]) => key.startsWith("superadmins/") && doc.data.active === true)
        .map(([key, doc]) => ({ docId: key.slice("superadmins/".length), ...clone(doc.data) }));
    },
    async runUnfenced(work) {
      return store.run({ actorUid: "", targetUid: "" }, work);
    },
    async run(_fence, work) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        stats.attempts++;
        const reads = new Map<string, number>();
        const queued: Array<() => void> = [];
        const tx: SuperadminTransaction = {
          async readRecord(uid) {
            const key = recordKey(uid);
            reads.set(key, versionOf(key));
            return clone(docs.get(key)?.data);
          },
          async readActiveCount() {
            reads.set(CONTROL, versionOf(CONTROL));
            const data = clone(docs.get(CONTROL)?.data);
            if (gate && attempt === 1) {
              arrived++;
              if (arrived === seed.barrier?.size) release?.();
              await gate;
            }
            return data;
          },
          mergeRecord(uid, fields) {
            queued.push(() => upsert(recordKey(uid), fields));
          },
          deleteRecord(uid) {
            queued.push(() => {
              docs.delete(recordKey(uid));
              stats.writes++;
            });
          },
          writeActiveCount(activeCount, now) {
            queued.push(() => upsert(CONTROL, { activeCount, updatedAt: now }));
          },
        };
        const result = await work(tx);
        const conflict = [...reads].some(([key, version]) => versionOf(key) !== version);
        if (!conflict) {
          for (const write of queued) {
            write();
            stats.writes++;
          }
          stats.commits++;
          return result;
        }
      }
      throw new Error("contention");
    },
  };

  return {
    store,
    stats,
    record: (uid: string) => docs.get(recordKey(uid))?.data,
    activeCount: () => docs.get(CONTROL)?.data.activeCount,
    setRecord: (uid: string, fields: Record<string, unknown>) => upsert(recordKey(uid), fields),
  };
}

interface TestUser {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly disabled?: boolean;
}

const USERS: Record<string, TestUser> = {
  admin: { uid: "admin-uid", email: "admin@example.test" },
  second: { uid: "second-uid", email: "second@example.test" },
  third: { uid: "third-uid", email: "third@example.test" },
  dev: { uid: "dev-uid", email: "dev@example.test" },
  unverified: { uid: "unverified-uid", email: "unverified@example.test", emailVerified: false },
  disabled: { uid: "disabled-uid", email: "disabled@example.test", disabled: true },
};

/** Tokens are the synthetic UID itself in these tests; the verifier maps them to a decoded token. */
const verifyToken = (token: string) => {
  const user = Object.values(USERS).find((candidate) => candidate.uid === token);
  if (!user) return Promise.reject(new Error("invalid token"));
  return Promise.resolve({ uid: user.uid, email: user.email, email_verified: user.emailVerified !== false } as never);
};

const noFence: ReadErasureFence = async () => ({ kind: "none" });

function depsFor(registry: ReturnType<typeof createFakeRegistry>, extra: Partial<SuperadminOperationDeps> = {}): SuperadminOperationDeps {
  const usersByEmail = new Map(Object.values(USERS).map((user) => [user.email, user]));
  return {
    verifyToken,
    readFence: noFence,
    store: registry.store,
    isSuperadmin: (uid) => readSuperadminActive(uid, registry.store),
    lookupAuthUserByEmail: async (email) => {
      const user = usersByEmail.get(email);
      return user && { uid: user.uid, emailVerified: user.emailVerified !== false, disabled: user.disabled === true };
    },
    ...extra,
  };
}

const TWO_ADMINS = {
  records: { "admin-uid": { active: true }, "second-uid": { active: true } },
};

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

describe("revokeSuperadminForErasureStart (owner decision, Option A)", () => {
  it("revokes a superadmin while another active superadmin remains, and keeps the count exact", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);

    const result = await revokeSuperadminForErasureStart("second-uid", { store: registry.store });

    expect(result).toEqual({ ok: true });
    expect(registry.record("second-uid")).toMatchObject({ active: false });
    expect(registry.activeCount()).toBe(1);
  });

  it("refuses the last active superadmin with last_superadmin and writes nothing", async () => {
    const registry = createFakeRegistry({ records: { "admin-uid": { active: true } } });

    const result = await revokeSuperadminForErasureStart("admin-uid", { store: registry.store });

    expect(result).toEqual({ ok: false, error: "last_superadmin" });
    expect(registry.record("admin-uid")).toMatchObject({ active: true });
    expect(registry.activeCount()).toBe(1);
  });

  it("treats an account that is not an active superadmin as nothing to revoke", async () => {
    const registry = createFakeRegistry(TWO_ADMINS);
    const writesBefore = registry.stats.writes;

    expect(await revokeSuperadminForErasureStart("dev-uid", { store: registry.store })).toEqual({ ok: true });
    expect(registry.stats.writes).toBe(writesBefore);
  });

  it("lets two concurrent erasures of two superadmins never remove the last active one", async () => {
    const registry = createFakeRegistry({ ...TWO_ADMINS, barrier: { size: 2 } });

    const [a, b] = await Promise.all([
      revokeSuperadminForErasureStart("admin-uid", { store: registry.store }),
      revokeSuperadminForErasureStart("second-uid", { store: registry.store }),
    ]);

    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)).toEqual([{ ok: false, error: "last_superadmin" }]);
    expect(registry.activeCount()).toBe(1);
    expect(["admin-uid", "second-uid"].filter((uid) => registry.record(uid)?.active === true)).toHaveLength(1);
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
