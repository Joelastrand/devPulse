import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const initializeApp = vi.fn<(options: unknown) => { name: string }>(() => ({ name: "[DEFAULT]" }));
const applicationDefault = vi.fn(() => ({ kind: "adc" }));
const cert = vi.fn<(value: unknown) => { kind: string }>(() => ({ kind: "cert" }));

vi.mock("firebase-admin/app", () => ({
  applicationDefault,
  cert,
  getApps: () => [],
  initializeApp,
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({}) }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));

const ENV_KEYS = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"] as const;

describe("getAdminAuth app options", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    initializeApp.mockClear();
    applicationDefault.mockClear();
    cert.mockClear();
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("passes the configured project id when only default credentials are available (emulator mode)", async () => {
    process.env.FIREBASE_PROJECT_ID = "demo-devpulse-verify";
    const { getAdminAuth } = await import("./admin");
    getAdminAuth();

    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(initializeApp.mock.calls[0][0]).toEqual({
      projectId: "demo-devpulse-verify",
      credential: { kind: "adc" },
    });
  });

  it("uses the service-account credential, with the project id, when cert variables are present", async () => {
    process.env.FIREBASE_PROJECT_ID = "example-project";
    process.env.FIREBASE_CLIENT_EMAIL = "svc@example-project.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n";
    const { getAdminAuth } = await import("./admin");
    getAdminAuth();

    expect(applicationDefault).not.toHaveBeenCalled();
    expect(cert).toHaveBeenCalledTimes(1);
    expect(initializeApp.mock.calls[0][0]).toEqual({ credential: { kind: "cert" } });
  });

  it("leaves the project id unset when no project is configured", async () => {
    const { getAdminAuth } = await import("./admin");
    getAdminAuth();

    expect(initializeApp.mock.calls[0][0]).toEqual({ projectId: undefined, credential: { kind: "adc" } });
  });
});
