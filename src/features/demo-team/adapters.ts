import type { App, Credential } from "firebase-admin/app";
import { isAllowedCollection } from "./plan";
import type { DemoPresenterLookup, DemoReader, DemoReadResult } from "./preflight";
import type { DemoWriteBatch } from "./writer";

/**
 * Thin Firebase Admin adapters for the demo-team seed (docs/features/
 * demo-team/SPEC.md — "Target-project safety model", BR-2, BR-5, BR-29,
 * BR-30). They only translate to the seams the preflight and the guarded
 * writer already define: a `get(path)`-only reader, a boolean presenter lookup
 * and a create/set/commit-only batch. No delete, query or list exists here.
 *
 * The SDK is injected so this module imports no Firebase code statically; the
 * real SDK is loaded by `loadFirebaseAdminSdk()` only in online modes. The app
 * is always initialized with an explicit `projectId` and an explicit `cert()`
 * credential — never an ambient default credential or any implicit project discovery.
 *
 * Errors carry a category only, never raw SDK text (which may echo paths,
 * credential fragments or document data).
 */

// ---------------------------------------------------------------------------
// Minimal structural views of the Admin SDK
// ---------------------------------------------------------------------------

export interface AdminAppLike {
  options: { projectId?: string };
}

interface DocumentSnapshotLike {
  exists: boolean;
  data(): unknown;
}

interface DocumentRefLike {
  get(): Promise<DocumentSnapshotLike>;
}

interface WriteBatchLike {
  create(ref: DocumentRefLike, data: unknown): unknown;
  set(ref: DocumentRefLike, data: unknown): unknown;
  commit(): Promise<unknown>;
}

interface FirestoreLike {
  doc(path: string): DocumentRefLike;
  batch(): WriteBatchLike;
}

interface AuthLike {
  getUser(uid: string): Promise<unknown>;
}

export interface DemoAdminSdk {
  cert(account: { projectId: string; clientEmail: string; privateKey: string }): unknown;
  initializeApp(options: { credential: unknown; projectId: string }, name: string): AdminAppLike;
  getFirestore(app: AdminAppLike): FirestoreLike;
  getAuth(app: AdminAppLike): AuthLike;
}

export type DemoAdapterErrorCategory = "sdk-unavailable" | "credentials-invalid" | "project-binding-mismatch";

export class DemoAdapterError extends Error {
  readonly category: DemoAdapterErrorCategory;

  constructor(category: DemoAdapterErrorCategory) {
    super(`Demo seed adapter failed: ${category}`);
    this.name = "DemoAdapterError";
    this.category = category;
  }
}

export interface DemoOnlineAdapters {
  reader: DemoReader;
  presenter: DemoPresenterLookup;
  createBatch: () => DemoWriteBatch;
}

// ---------------------------------------------------------------------------
// Real SDK loader (online modes only)
// ---------------------------------------------------------------------------

/** Dynamic imports keep offline runs from ever loading `firebase-admin`. */
export async function loadFirebaseAdminSdk(): Promise<DemoAdminSdk> {
  try {
    const [adminApp, firestore, auth] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore"),
      import("firebase-admin/auth"),
    ]);
    return {
      cert: (account) => adminApp.cert(account),
      initializeApp: (options, name) =>
        adminApp.initializeApp({ credential: options.credential as Credential, projectId: options.projectId }, name),
      getFirestore: (appRef) => firestore.getFirestore(appRef as App) as unknown as FirestoreLike,
      getAuth: (appRef) => auth.getAuth(appRef as App),
    };
  } catch {
    throw new DemoAdapterError("sdk-unavailable");
  }
}

// ---------------------------------------------------------------------------
// Credential and value normalization
// ---------------------------------------------------------------------------

/**
 * `FIREBASE_PRIVATE_KEY` held in an env file is usually one line with literal
 * `\n` sequences; `cert()` needs a PEM with real newlines. Applied only at this
 * runtime boundary (same normalization as `src/lib/firebase/admin.ts`).
 */
export function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

function isTimestampLike(value: object): value is { toDate(): Date } {
  return typeof (value as { toDate?: unknown }).toDate === "function";
}

/** Persisted Firestore data → plain values: `Timestamp` → `Date`, recursively. */
export function toPlainData(value: unknown): unknown {
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  if (isTimestampLike(value)) return value.toDate();
  if (Array.isArray(value)) return value.map(toPlainData);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toPlainData(inner)]));
}

/** Only exact `{allow-listed collection}/{docId}` paths ever reach the SDK. */
function assertSeedPath(path: string): void {
  const parts = path.split("/");
  if (parts.length !== 2 || !isAllowedCollection(parts[0]) || parts[1].length === 0) {
    throw new Error("Path rejected: not an allow-listed document path.");
  }
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

const APP_NAME = "demo-team-seed";

export function createFirebaseDemoAdapters(input: {
  sdk: DemoAdminSdk;
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): DemoOnlineAdapters {
  const { sdk, projectId, clientEmail, privateKey } = input;

  let app: AdminAppLike;
  try {
    const credential = sdk.cert({ projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) });
    // A dedicated named app: never reuses or depends on any default app.
    app = sdk.initializeApp({ credential, projectId }, APP_NAME);
  } catch {
    throw new DemoAdapterError("credentials-invalid");
  }
  if (app.options.projectId !== projectId) {
    throw new DemoAdapterError("project-binding-mismatch");
  }

  const db = sdk.getFirestore(app);
  const auth = sdk.getAuth(app);

  const reader: DemoReader = {
    async get(path): Promise<DemoReadResult> {
      assertSeedPath(path);
      const snapshot = await db.doc(path).get();
      if (!snapshot.exists) return { exists: false };
      return { exists: true, data: toPlainData(snapshot.data()) };
    },
  };

  const presenter: DemoPresenterLookup = {
    async userExists(uid) {
      try {
        await auth.getUser(uid); // record (incl. email) is discarded immediately
        return true;
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "auth/user-not-found") return false;
        throw new Error("Presenter lookup failed.");
      }
    },
  };

  const createBatch = (): DemoWriteBatch => {
    const batch = db.batch();
    return {
      create(path, data) {
        assertSeedPath(path);
        batch.create(db.doc(path), data);
      },
      set(path, data) {
        assertSeedPath(path);
        batch.set(db.doc(path), data); // full replace: no merge option
      },
      async commit() {
        await batch.commit();
      },
    };
  };

  return { reader, presenter, createBatch };
}
