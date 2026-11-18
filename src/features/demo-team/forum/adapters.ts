import { normalizePrivateKey, DemoAdapterError } from "../adapters";
import type { IdentityAdminSdk } from "../identities/adapters";

/**
 * Firebase Admin adapters for the forum fixtures (Phase D). Exposes only what this flow needs: four allow-listed reads
 * (`teams`, `teamMemberships`, `forumThreads`, `forumReplies`) and a create-only batch into `forumThreads` and `forumReplies`.
 * There is no update, delete, query or list. Errors carry categories only.
 */

export const FORUM_READ_COLLECTIONS = ["teams", "teamMemberships", "forumThreads", "forumReplies"] as const;
export const FORUM_WRITE_COLLECTIONS = ["forumThreads", "forumReplies"] as const;

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
    const maybeTimestamp = value as { toDate?: () => Date } | null;
    out[key] = maybeTimestamp !== null && typeof maybeTimestamp === "object" && typeof maybeTimestamp.toDate === "function"
      ? maybeTimestamp.toDate()
      : value;
  }
  return out;
}

export interface ForumBatch {
  create(path: string, data: unknown): void;
  commit(): Promise<void>;
}

export interface ForumOnlineAdapters {
  readDoc(path: string): Promise<{ exists: false } | { exists: true; data: unknown }>;
  createBatch(): ForumBatch;
}

export function createForumOnlineAdapters(input: {
  sdk: IdentityAdminSdk;
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): ForumOnlineAdapters {
  const { sdk, projectId, clientEmail, privateKey } = input;

  let app: { options: { projectId?: string } };
  try {
    const credential = sdk.cert({ projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) });
    app = sdk.initializeApp({ credential, projectId }, "demo-forum-seed");
  } catch {
    throw new DemoAdapterError("credentials-invalid");
  }
  if (app.options.projectId !== projectId) {
    throw new DemoAdapterError("project-binding-mismatch");
  }
  const db = sdk.getFirestore(app);

  return {
    async readDoc(path) {
      assertPath(path, FORUM_READ_COLLECTIONS);
      const snapshot = await db.doc(path).get();
      if (!snapshot.exists) return { exists: false };
      return { exists: true, data: withDates(snapshot.data()) };
    },
    createBatch() {
      const batch = db.batch();
      return {
        create(path, data) {
          assertPath(path, FORUM_WRITE_COLLECTIONS);
          batch.create(db.doc(path), data);
        },
        async commit() {
          await batch.commit();
        },
      };
    },
  };
}
