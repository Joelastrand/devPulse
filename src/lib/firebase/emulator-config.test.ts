import { describe, expect, it } from "vitest";
import { assertAdminEmulatorSafe, resolveAuthEmulatorUrl } from "./emulator-config";

const local = "http://127.0.0.1:9099";

describe("resolveAuthEmulatorUrl", () => {
  it("is off when no emulator URL is configured", () => {
    expect(resolveAuthEmulatorUrl({ authUrl: undefined, projectId: "devpulse-ac26e", nodeEnv: "development" })).toBeNull();
    expect(resolveAuthEmulatorUrl({ authUrl: "", projectId: "devpulse-ac26e", nodeEnv: "development" })).toBeNull();
  });

  it("accepts a local origin for a demo- project outside production", () => {
    expect(resolveAuthEmulatorUrl({ authUrl: local, projectId: "demo-devpulse-verify", nodeEnv: "development" })).toBe(local);
  });

  it("refuses production builds", () => {
    expect(() => resolveAuthEmulatorUrl({ authUrl: local, projectId: "demo-x", nodeEnv: "production" })).toThrow(/production/);
  });

  it("refuses non-local hosts", () => {
    for (const authUrl of ["https://identitytoolkit.googleapis.com", "http://example.com:9099", "http://localhost:9099/evil"]) {
      expect(() => resolveAuthEmulatorUrl({ authUrl, projectId: "demo-x", nodeEnv: "development" })).toThrow(/local/);
    }
  });

  it("refuses a project id that is not demo-", () => {
    expect(() => resolveAuthEmulatorUrl({ authUrl: local, projectId: "devpulse-ac26e", nodeEnv: "development" })).toThrow(/demo-/);
    expect(() => resolveAuthEmulatorUrl({ authUrl: local, projectId: undefined, nodeEnv: "development" })).toThrow(/demo-/);
  });
});

describe("assertAdminEmulatorSafe", () => {
  it("does nothing when no emulator host is set", () => {
    expect(() => assertAdminEmulatorSafe({ FIREBASE_PROJECT_ID: "devpulse-ac26e" })).not.toThrow();
  });

  it("accepts local hosts with a demo- project", () => {
    expect(() =>
      assertAdminEmulatorSafe({
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        FIREBASE_PROJECT_ID: "demo-devpulse-verify",
      }),
    ).not.toThrow();
  });

  it("refuses a remote host, a real project, or production", () => {
    expect(() =>
      assertAdminEmulatorSafe({ FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443", FIREBASE_PROJECT_ID: "demo-x" }),
    ).toThrow(/localhost/);
    expect(() => assertAdminEmulatorSafe({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_PROJECT_ID: "devpulse-ac26e" })).toThrow(/demo-/);
    expect(() =>
      assertAdminEmulatorSafe({ NODE_ENV: "production", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_PROJECT_ID: "demo-x" }),
    ).toThrow(/production/);
  });
});
