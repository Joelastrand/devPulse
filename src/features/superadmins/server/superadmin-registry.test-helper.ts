import { type ReadErasureFence } from "../../auth/server/erasure-fence";
import { readSuperadminActive } from "./superadmin-policy";
import type { SuperadminOperationDeps } from "./superadmin-operations";
import type { SuperadminStore, SuperadminTransaction } from "./superadmin-store";

/**
 * In-memory registry with Firestore-like optimistic transactions. A transaction records the version of every document it
 * reads; at commit, any version change since the read is a conflict and the work is re-run, as Firestore does. This
 * models the serialization mechanism (the control document) without the Firestore emulator, which is not available here.
 */
export const CONTROL = "superadminRegistry/control";
export const recordKey = (uid: string) => `superadmins/${uid}`;

interface Seed {
  readonly records?: Record<string, { active: boolean }>;
  readonly activeCount?: unknown;
  /** Makes the first `size` transactions that read the control document wait for each other before any commits. */
  readonly barrier?: { size: number };
}

export function createFakeRegistry(seed: Seed = {}) {
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

export interface TestUser {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly disabled?: boolean;
}

export const USERS: Record<string, TestUser> = {
  admin: { uid: "admin-uid", email: "admin@example.test" },
  second: { uid: "second-uid", email: "second@example.test" },
  third: { uid: "third-uid", email: "third@example.test" },
  dev: { uid: "dev-uid", email: "dev@example.test" },
  unverified: { uid: "unverified-uid", email: "unverified@example.test", emailVerified: false },
  disabled: { uid: "disabled-uid", email: "disabled@example.test", disabled: true },
};

/** Tokens are the synthetic UID itself in these tests; the verifier maps them to a decoded token. */
export const verifyToken = (token: string) => {
  const user = Object.values(USERS).find((candidate) => candidate.uid === token);
  if (!user) return Promise.reject(new Error("invalid token"));
  return Promise.resolve({ uid: user.uid, email: user.email, email_verified: user.emailVerified !== false } as never);
};

export const noFence: ReadErasureFence = async () => ({ kind: "none" });

export function depsFor(registry: ReturnType<typeof createFakeRegistry>, extra: Partial<SuperadminOperationDeps> = {}): SuperadminOperationDeps {
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

export const TWO_ADMINS = {
  records: { "admin-uid": { active: true }, "second-uid": { active: true } },
};

