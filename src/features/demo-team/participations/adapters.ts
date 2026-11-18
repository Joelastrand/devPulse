import { normalizePrivateKey, DemoAdapterError } from "../adapters";
import type { IdentityAdminSdk } from "../identities/adapters";

/**
 * Firebase Admin adapters for the participation seed (Phase D). One transaction per run: every read happens first, the plan is
 * computed from those reads, and the writes are queued and applied together at the end, so they commit or none do.
 *
 * Allow-lists are narrow. Reads: `teams`, `teamMemberships` (by id and by `teamId` query), `teamProjects`,
 * `teamProjectParticipations`, `accountErasures`. Writes: `teamMemberships` (field `memberRef` only, a field-level update) and
 * `teamProjectParticipations` (create only). There is no delete, no set and no whole-document overwrite.
 */

const READ_PATHS = ["teams", "teamMemberships", "teamProjects", "teamProjectParticipations", "accountErasures"] as const;
const WRITE_PATHS = ["teamMemberships", "teamProjectParticipations"] as const;

export interface ParticipationTx {
  /** Reads one document by `collection/id`. Only allow-listed collections are reachable. */
  get(path: string): Promise<{ exists: false } | { exists: true; data: unknown }>;
  /** Reads every membership of the team (by the `teamId` field). */
  queryTeamMemberships(teamId: string): Promise<unknown[]>;
  /** Queues a create-only write. The commit fails if the document exists by then. */
  create(path: string, data: Record<string, unknown>): void;
  /** Queues a field-level update of `teamMemberships` that may change `memberRef` only. */
  updateMembershipMemberRef(path: string, memberRef: string): void;
}

export interface ParticipationOnlineAdapters {
  runTransaction<T>(work: (tx: ParticipationTx) => Promise<T>): Promise<T>;
}

function assertPath(path: string, collections: readonly string[]): void {
  const parts = path.split("/");
  if (parts.length !== 2 || !collections.includes(parts[0]) || parts[1].length === 0) {
    throw new Error("Path rejected: not an allow-listed document path.");
  }
}

/** Converts Firestore timestamps to `Date` at the top level only. Anything else is returned as stored. */
function withDates(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const maybe = value as { toDate?: () => Date } | null;
    out[key] = maybe !== null && typeof maybe === "object" && typeof maybe.toDate === "function" ? maybe.toDate() : value;
  }
  return out;
}

interface FirestoreLike {
  doc(path: string): unknown;
  collection(name: string): {
    where(field: string, op: string, value: unknown): { get(): Promise<{ docs: Array<{ data(): unknown }> }> };
  };
  runTransaction<T>(work: (tx: TransactionLike) => Promise<T>): Promise<T>;
}

/** Document and query reads share one `get`; each call site narrows the result to the shape it asked for. */
interface TransactionLike {
  get(target: unknown): Promise<unknown>;
  create(ref: unknown, data: unknown): unknown;
  update(ref: unknown, data: unknown): unknown;
}

interface DocumentSnapshotLike {
  exists: boolean;
  data(): unknown;
}

interface QuerySnapshotLike {
  docs: Array<{ data(): unknown }>;
}

export function createParticipationOnlineAdapters(input: {
  sdk: IdentityAdminSdk;
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): ParticipationOnlineAdapters {
  const { sdk, projectId, clientEmail, privateKey } = input;

  let app: { options: { projectId?: string } };
  try {
    const credential = sdk.cert({ projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) });
    app = sdk.initializeApp({ credential, projectId }, "demo-participations-seed");
  } catch {
    throw new DemoAdapterError("credentials-invalid");
  }
  if (app.options.projectId !== projectId) throw new DemoAdapterError("project-binding-mismatch");

  const db = sdk.getFirestore(app) as unknown as FirestoreLike;

  return {
    async runTransaction(work) {
      return db.runTransaction(async (tx) => {
        const pending: Array<() => void> = [];
        const result = await work({
          async get(path) {
            assertPath(path, READ_PATHS);
            const snapshot = (await tx.get(db.doc(path))) as DocumentSnapshotLike;
            if (!snapshot.exists) return { exists: false };
            return { exists: true, data: withDates(snapshot.data()) };
          },
          async queryTeamMemberships(teamId) {
            const snapshot = (await tx.get(db.collection("teamMemberships").where("teamId", "==", teamId))) as QuerySnapshotLike;
            return snapshot.docs.map((doc) => withDates(doc.data()));
          },
          create(path, data) {
            assertPath(path, WRITE_PATHS);
            if (!path.startsWith("teamProjectParticipations/")) throw new Error("Create rejected: only participations are created.");
            pending.push(() => tx.create(db.doc(path), data));
          },
          updateMembershipMemberRef(path, memberRef) {
            assertPath(path, ["teamMemberships"]);
            pending.push(() => tx.update(db.doc(path), { memberRef }));
          },
        });
        for (const apply of pending) apply();
        return result;
      });
    },
  };
}
