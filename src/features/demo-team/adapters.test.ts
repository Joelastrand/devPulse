import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cert } from "firebase-admin/app";
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import {
  createFirebaseDemoAdapters,
  DemoAdapterError,
  loadFirebaseAdminSdk,
  normalizePrivateKey,
  toPlainData,
  type AdminAppLike,
  type DemoAdminSdk,
} from "./adapters";

const PROJECT = "demo-fake-project";
const EMAIL = `seed@${PROJECT}.iam.gserviceaccount.com`;
const KEY = "-----BEGIN PRIVATE KEY-----\\nFAKE-KEY-MARKER\\n-----END PRIVATE KEY-----\\n";

interface Recorded {
  certCalls: Array<{ projectId: string; clientEmail: string; privateKey: string }>;
  initCalls: Array<{ options: { credential: unknown; projectId: string }; name: string }>;
  gets: string[];
  batchOps: Array<{ kind: "create" | "set" | "commit"; path?: string; data?: unknown }>;
  getUserCalls: string[];
}

function fakeSdk(options: {
  docs?: Record<string, unknown>;
  boundProjectId?: string | undefined;
  getUserError?: unknown;
  certThrows?: boolean;
} = {}): { sdk: DemoAdminSdk; rec: Recorded } {
  const rec: Recorded = { certCalls: [], initCalls: [], gets: [], batchOps: [], getUserCalls: [] };
  const docs = options.docs ?? {};

  const sdk: DemoAdminSdk = {
    cert(account) {
      rec.certCalls.push(account);
      if (options.certThrows) throw new Error(`bad key ${account.privateKey}`);
      return { credentialMarker: true };
    },
    initializeApp(initOptions, name) {
      rec.initCalls.push({ options: initOptions, name });
      const app: AdminAppLike = {
        options: { projectId: "boundProjectId" in options ? options.boundProjectId : initOptions.projectId },
      };
      return app;
    },
    getFirestore() {
      return {
        doc: (path: string) => ({
          path,
          async get() {
            rec.gets.push(path);
            return { exists: path in docs, data: () => docs[path] };
          },
        }),
        batch: () => ({
          create: (ref: unknown, data: unknown) => {
            rec.batchOps.push({ kind: "create", path: (ref as { path: string }).path, data });
          },
          set: (ref: unknown, data: unknown) => {
            rec.batchOps.push({ kind: "set", path: (ref as { path: string }).path, data });
          },
          commit: async () => {
            rec.batchOps.push({ kind: "commit" });
          },
        }),
      } as unknown as ReturnType<DemoAdminSdk["getFirestore"]>;
    },
    getAuth() {
      return {
        async getUser(uid: string) {
          rec.getUserCalls.push(uid);
          if (options.getUserError !== undefined) throw options.getUserError;
          return { uid, email: "must-never-escape@example.test" };
        },
      };
    },
  };
  return { sdk, rec };
}

const build = (sdk: DemoAdminSdk) =>
  createFirebaseDemoAdapters({ sdk, projectId: PROJECT, clientEmail: EMAIL, privateKey: KEY });

describe("Firebase initialization", () => {
  it("initializes a dedicated named app with the explicit projectId and cert credential", () => {
    const { sdk, rec } = fakeSdk();
    build(sdk);

    expect(rec.certCalls).toHaveLength(1);
    expect(rec.certCalls[0]).toMatchObject({ projectId: PROJECT, clientEmail: EMAIL });
    expect(rec.initCalls).toHaveLength(1);
    expect(rec.initCalls[0].options).toEqual({ credential: { credentialMarker: true }, projectId: PROJECT });
    expect(rec.initCalls[0].name).toBe("demo-team-seed");
  });

  it("fails closed when the initialized app is bound to a different project", () => {
    for (const bound of ["some-other-project", undefined]) {
      const { sdk } = fakeSdk({ boundProjectId: bound });
      expect(() => build(sdk)).toThrowError(
        expect.objectContaining({ category: "project-binding-mismatch" }),
      );
    }
  });

  it("maps credential failures to a category without echoing the key", () => {
    const { sdk } = fakeSdk({ certThrows: true });
    let caught: unknown;
    try {
      build(sdk);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DemoAdapterError);
    expect((caught as DemoAdapterError).category).toBe("credentials-invalid");
    expect(String((caught as Error).message)).not.toContain("FAKE-KEY-MARKER");
  });

  it("never references applicationDefault or project/credential discovery (static)", () => {
    const source = readFileSync(join(__dirname, "adapters.ts"), "utf8");
    // The only mention allowed is the explanatory comment.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["applicationDefault", ".firebaserc", "firebase-tools", "gcloud", "GOOGLE_APPLICATION_CREDENTIALS", "getApps"]) {
      expect(code).not.toContain(forbidden);
    }
    // No delete/query/list surface.
    for (const forbidden of [".delete(", "collection(", "where(", ".list", "recursiveDelete", "listCollections"]) {
      expect(code).not.toContain(forbidden);
    }
    // Firebase is loaded only through dynamic import, never statically.
    expect(source).not.toMatch(/^import (?!type )[^"]*from "firebase-admin/m);
  });
});

describe("private key format", () => {
  it("turns literal \\n sequences into real newlines and leaves real PEMs unchanged", () => {
    expect(normalizePrivateKey("a\\nb\\n")).toBe("a\nb\n");
    expect(normalizePrivateKey("a\nb\n")).toBe("a\nb\n");
  });

  it("is applied before cert() and the raw value is never passed on", () => {
    const { sdk, rec } = fakeSdk();
    build(sdk);
    expect(rec.certCalls[0].privateKey).toBe(KEY.replace(/\\n/g, "\n"));
    expect(rec.certCalls[0].privateKey).not.toContain("\\n");
  });

  it("matches what the real Admin cert() needs (throwaway generated key, no network)", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const escaped = privateKey.replace(/\n/g, "\\n");
    const account = { projectId: PROJECT, clientEmail: EMAIL };

    expect(() => cert({ ...account, privateKey: escaped })).toThrow();
    expect(() => cert({ ...account, privateKey: normalizePrivateKey(escaped) })).not.toThrow();
  });

  it("loads the real SDK lazily without initializing any app", async () => {
    const sdk = await loadFirebaseAdminSdk();
    expect(Object.keys(sdk).sort()).toEqual(["cert", "getAuth", "getFirestore", "initializeApp"]);
  });
});

describe("reader adapter", () => {
  it("maps a missing document to { exists: false } with exactly one read", async () => {
    const { sdk, rec } = fakeSdk();
    const { reader } = build(sdk);
    await expect(reader.get("teams/demo-team")).resolves.toEqual({ exists: false });
    expect(rec.gets).toEqual(["teams/demo-team"]);
  });

  it("maps an existing document to its data with Firestore Timestamps as Date (nested too)", async () => {
    const created = new Date("2026-03-16T00:00:00.000Z");
    const nested = new Date("2026-03-17T12:30:00.000Z");
    const { sdk, rec } = fakeSdk({
      docs: {
        "teams/demo-team": {
          name: "Demoteam",
          createdAt: Timestamp.fromDate(created),
          meta: { list: [Timestamp.fromDate(nested)], nothing: null },
        },
      },
    });
    const { reader } = build(sdk);

    const result = await reader.get("teams/demo-team");
    expect(result).toEqual({
      exists: true,
      data: { name: "Demoteam", createdAt: created, meta: { list: [nested], nothing: null } },
    });
    if (!result.exists) throw new Error("unreachable");
    const data = result.data as { createdAt: unknown; meta: { list: unknown[] } };
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.meta.list[0]).toBeInstanceOf(Date);
    expect(rec.gets).toHaveLength(1);
  });

  it("converts duck-typed timestamps and leaves primitives and Dates alone", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(toPlainData({ toDate: () => date })).toBe(date);
    expect(toPlainData(date)).toBe(date);
    expect(toPlainData("x")).toBe("x");
    expect(toPlainData(3)).toBe(3);
    expect(toPlainData(null)).toBeNull();
  });

  it("rejects paths outside the eight allow-listed collections before any read", async () => {
    const { sdk, rec } = fakeSdk();
    const { reader } = build(sdk);
    for (const path of ["forumThreads/x", "teamSurveyState/demo-team", "teams", "teams/", "teams/a/b", "teams/demo-team/extra"]) {
      await expect(reader.get(path)).rejects.toThrow();
    }
    expect(rec.gets).toEqual([]);
  });
});

describe("presenter lookup adapter", () => {
  it("returns only a boolean and never the user record or email", async () => {
    const { sdk, rec } = fakeSdk();
    const { presenter } = build(sdk);
    const result = await presenter.userExists("presenter-1");
    expect(result).toBe(true);
    expect(JSON.stringify(result)).not.toContain("example.test");
    expect(rec.getUserCalls).toEqual(["presenter-1"]);
  });

  it("maps auth/user-not-found to false", async () => {
    const { sdk } = fakeSdk({ getUserError: { code: "auth/user-not-found", message: "secret detail" } });
    await expect(build(sdk).presenter.userExists("p")).resolves.toBe(false);
  });

  it("sanitizes any other failure (no raw SDK text)", async () => {
    const { sdk } = fakeSdk({ getUserError: Object.assign(new Error("token=abc123 leaked"), { code: "auth/internal-error" }) });
    const rejection = build(sdk).presenter.userExists("p");
    await expect(rejection).rejects.toThrow("Presenter lookup failed.");
    await rejection.catch((error: Error) => expect(error.message).not.toContain("abc123"));
  });
});

describe("batch adapter", () => {
  it("maps create→create, set→set (no merge) and commit, in order, to document refs", async () => {
    const { sdk, rec } = fakeSdk();
    const batch = build(sdk).createBatch();
    batch.create("teams/demo-team", { a: 1 });
    batch.set("surveys/demo-survey-01", { b: 2 });
    await batch.commit();

    expect(rec.batchOps).toEqual([
      { kind: "create", path: "teams/demo-team", data: { a: 1 } },
      { kind: "set", path: "surveys/demo-survey-01", data: { b: 2 } },
      { kind: "commit" },
    ]);
  });

  it("creates no batch until asked and exposes no delete", () => {
    const { sdk, rec } = fakeSdk();
    const adapters = build(sdk);
    expect(rec.batchOps).toEqual([]);
    const batch = adapters.createBatch();
    expect(Object.keys(batch).sort()).toEqual(["commit", "create", "set"]);
  });

  it("rejects non-allow-listed paths at the adapter as a last guard", () => {
    const { sdk, rec } = fakeSdk();
    const batch = build(sdk).createBatch();
    expect(() => batch.set("forumThreads/x", {})).toThrow();
    expect(() => batch.create("teamSurveyState/demo-team", {})).toThrow();
    expect(rec.batchOps).toEqual([]);
  });
});
