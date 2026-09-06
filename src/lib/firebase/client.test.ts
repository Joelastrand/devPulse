import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./client.ts", import.meta.url)), "utf8");

describe("firebase client config", () => {
  it("never reads server-only Firebase Admin credentials", () => {
    expect(source).not.toMatch(/FIREBASE_PRIVATE_KEY/);
    expect(source).not.toMatch(/FIREBASE_CLIENT_EMAIL/);
    expect(source).not.toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it("never imports the server-only Firebase Admin SDK", () => {
    expect(source).not.toMatch(/firebase-admin/);
  });

  it("only reads NEXT_PUBLIC_-prefixed environment variables", () => {
    const envReferences = source.match(/process\.env\.\w+/g) ?? [];
    expect(envReferences.length).toBeGreaterThan(0);
    for (const reference of envReferences) {
      expect(reference).toMatch(/^process\.env\.NEXT_PUBLIC_/);
    }
  });
});
