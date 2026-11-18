import { normalizePrivateKey, DemoAdapterError } from "../adapters";
import type { IdentityAdminSdk } from "../identities/adapters";

/**
 * Firebase Admin adapters for the roadmap expansion seed (Phase E). One transaction per run: every read happens first, the plan
 * is computed from those reads, and the create-only writes are queued and applied at the end, so they commit or none do.
 *
 * Allow-lists are narrow. Reads: `teams`, `teamMemberships` (by id and by `teamId` query), `skillTrees`, `roadmapItems`,
 * `accountErasures`. Writes: `roadmapItems` only, as a create or as a field-level update restricted to the owner fields
 * (`content`, `ownerRefIndex`, `updatedAt`, `updatedBy`). There is no set, no delete and no membership write.
 */

const READ_PATHS = ["teams", "teamMemberships", "skillTrees", "roadmapItems", "accountErasures"] as const;
const WRITE_PATHS = ["roadmapItems"] as const;
/** The only fields an owner update may set. Everything else in a roadmap document is left as stored. */
export const ROADMAP_OWNER_UPDATE_FIELDS = ["content", "ownerRefIndex", "updatedAt", "updatedBy"] as const;

export interface RoadmapTx {
  /** Reads one document by `collection/id`. Only allow-listed collections are reachable. */
  get(path: string): Promise<{ exists: false } | { exists: true; data: unknown }>;
  /** Reads every membership of the team (by the `teamId` field). */
  queryTeamMemberships(teamId: string): Promise<unknown[]>;
  /** Queues a create-only write. The commit fails if the document exists by then. */
  create(path: string, data: Record<string, unknown>): void;
  /**
   * Queues a field-level update of an existing roadmap document. Only `ROADMAP_OWNER_UPDATE_FIELDS` may be set; any other key
   * throws before the write is queued. The commit fails if the document no longer exists.
   */
  updateOwnerFields(path: string, fields: Record<string, unknown>): void;
}

export interface RoadmapOnlineAdapters {
  runTransaction<T>(work: (tx: RoadmapTx) => Promise<T>): Promise<T>;
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

export function createRoadmapOnlineAdapters(input: {
  sdk: IdentityAdminSdk;
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): RoadmapOnlineAdapters {
  const { sdk, projectId, clientEmail, privateKey } = input;

  let app: { options: { projectId?: string } };
  try {
    const credential = sdk.cert({ projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) });
    app = sdk.initializeApp({ credential, projectId }, "demo-roadmap-seed");
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
            pending.push(() => tx.create(db.doc(path), data));
          },
          updateOwnerFields(path, fields) {
            assertPath(path, WRITE_PATHS);
            const allowed = new Set<string>(ROADMAP_OWNER_UPDATE_FIELDS);
            if (Object.keys(fields).some((key) => !allowed.has(key))) {
              throw new Error("Update rejected: only owner fields may be set.");
            }
            pending.push(() => tx.update(db.doc(path), fields));
          },
        });
        for (const apply of pending) apply();
        return result;
      });
    },
  };
}
