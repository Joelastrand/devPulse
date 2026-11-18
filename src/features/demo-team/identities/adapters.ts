import type { App, Credential } from "firebase-admin/app";
import { normalizePrivateKey, toPlainData, DemoAdapterError } from "../adapters";
import type { IdentityAuthCreateRequest } from "./fixtures";
import type { ObservedAuthAccount } from "./plan";

/**
 * Firebase Admin adapters for the fictional-member provisioning (Phase C, step 2). They expose only the operations this
 * flow needs and nothing else: Auth lookups by uid and by e-mail, one fixed-shape Auth creation, reads of three
 * collections (`teams`, `teamMemberships`, `userProfiles`), and a create-only batch. There is no update, no delete, no
 * query and no list. The Auth creation request is `IdentityAuthCreateRequest` (disabled, no password, no claims).
 *
 * Credentials are explicit (`cert()`) and the app is bound to the explicit project id, exactly like the team seed.
 * Errors carry categories only, never raw SDK text.
 */

interface AuthUserRecordLike {
  uid: string;
  email?: string;
  disabled: boolean;
  passwordHash?: string;
  customClaims?: Record<string, unknown>;
  providerData: readonly unknown[];
}

interface IdentityAuthLike {
  getUser(uid: string): Promise<AuthUserRecordLike>;
  getUserByEmail(email: string): Promise<AuthUserRecordLike>;
  createUser(request: IdentityAuthCreateRequest): Promise<unknown>;
}

interface DocumentSnapshotLike {
  exists: boolean;
  data(): unknown;
}

interface FirestoreLike {
  doc(path: string): { get(): Promise<DocumentSnapshotLike> };
  batch(): {
    create(ref: unknown, data: unknown): unknown;
    commit(): Promise<unknown>;
  };
}

export interface IdentityAdminSdk {
  cert(account: { projectId: string; clientEmail: string; privateKey: string }): unknown;
  initializeApp(options: { credential: unknown; projectId: string }, name: string): { options: { projectId?: string } };
  getFirestore(app: unknown): FirestoreLike;
  getAuth(app: unknown): IdentityAuthLike;
}

/** Document paths the provisioning may read or create. Nothing else is reachable through these adapters. */
export const IDENTITY_READ_COLLECTIONS = ["teams", "teamMemberships", "userProfiles"] as const;
export const IDENTITY_WRITE_COLLECTIONS = ["teamMemberships", "userProfiles"] as const;

function assertPath(path: string, collections: readonly string[]): void {
  const parts = path.split("/");
  if (parts.length !== 2 || !collections.includes(parts[0]) || parts[1].length === 0) {
    throw new Error("Path rejected: not an allow-listed document path.");
  }
}

export interface IdentityBatch {
  create(path: string, data: unknown): void;
  commit(): Promise<void>;
}

export interface IdentityOnlineAdapters {
  presenterAuthExists(uid: string): Promise<boolean>;
  accountById(uid: string): Promise<ObservedAuthAccount | null>;
  accountByMail(email: string): Promise<ObservedAuthAccount | null>;
  createAuthAccount(request: IdentityAuthCreateRequest): Promise<void>;
  readDoc(path: string): Promise<{ exists: false } | { exists: true; data: unknown }>;
  createBatch(): IdentityBatch;
}

/** Maps a live Admin `UserRecord` to the fields the decision depends on. Never stores the hash itself. */
export function toObservedAuthAccount(record: AuthUserRecordLike): ObservedAuthAccount {
  const claims = record.customClaims;
  return {
    uid: record.uid,
    email: typeof record.email === "string" ? record.email.toLowerCase() : null,
    disabled: record.disabled === true,
    hasPassword: typeof record.passwordHash === "string" && record.passwordHash.length > 0,
    hasCustomClaims: claims !== undefined && claims !== null && Object.keys(claims).length > 0,
    providerCount: record.providerData.length,
  };
}

const APP_NAME = "demo-identities-seed";

export async function loadIdentityAdminSdk(): Promise<IdentityAdminSdk> {
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
      getFirestore: (app) => firestore.getFirestore(app as App) as unknown as FirestoreLike,
      getAuth: (app) => auth.getAuth(app as App) as unknown as IdentityAuthLike,
    };
  } catch {
    throw new DemoAdapterError("sdk-unavailable");
  }
}

export function createIdentityOnlineAdapters(input: {
  sdk: IdentityAdminSdk;
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): IdentityOnlineAdapters {
  const { sdk, projectId, clientEmail, privateKey } = input;

  let app: { options: { projectId?: string } };
  try {
    const credential = sdk.cert({ projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) });
    app = sdk.initializeApp({ credential, projectId }, APP_NAME);
  } catch {
    throw new DemoAdapterError("credentials-invalid");
  }
  if (app.options.projectId !== projectId) {
    throw new DemoAdapterError("project-binding-mismatch");
  }

  const db = sdk.getFirestore(app);
  const auth = sdk.getAuth(app);

  /** `auth/user-not-found` is the only "absent" answer; any other failure rejects so the run fails closed. */
  async function lookup(run: () => Promise<AuthUserRecordLike>): Promise<ObservedAuthAccount | null> {
    try {
      return toObservedAuthAccount(await run());
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "auth/user-not-found") return null;
      throw new Error("Auth lookup failed.");
    }
  }

  return {
    async presenterAuthExists(uid) {
      return (await lookup(() => auth.getUser(uid))) !== null;
    },
    accountById(uid) {
      return lookup(() => auth.getUser(uid));
    },
    accountByMail(email) {
      return lookup(() => auth.getUserByEmail(email));
    },
    async createAuthAccount(request) {
      // The only Auth write in this tool. Request is built by `buildIdentityAuthRequest`: disabled, no password, no claims.
      await auth.createUser(request);
    },
    async readDoc(path) {
      assertPath(path, IDENTITY_READ_COLLECTIONS);
      const snapshot = await db.doc(path).get();
      if (!snapshot.exists) return { exists: false };
      return { exists: true, data: toPlainData(snapshot.data()) };
    },
    createBatch() {
      const batch = db.batch();
      return {
        create(path, data) {
          assertPath(path, IDENTITY_WRITE_COLLECTIONS);
          batch.create(db.doc(path), data);
        },
        async commit() {
          await batch.commit();
        },
      };
    },
  };
}
