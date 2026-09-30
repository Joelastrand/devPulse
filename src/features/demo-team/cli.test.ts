import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "./crypto";

const ROOT = resolve(__dirname, "../../..");
const PROJECT = "demo-fake-project";
const PRIVATE_KEY_MARKER = "FAKE-PRIVATE-KEY-MARKER";
const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

describe("crypto adapter", () => {
  beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips through the repository's real encryption with a fresh IV each time", () => {
    const a = demoCrypto.encrypt("synthetic probe");
    const b = demoCrypto.encrypt("synthetic probe");
    expect(a.keyVersion).toBe("v1");
    expect(a.iv).not.toBe(b.iv);
    expect(demoCrypto.decrypt(a)).toBe("synthetic probe");
  });

  it("fails closed without echoing the key or plaintext when the key is unusable", () => {
    const payload = demoCrypto.encrypt("synthetic probe");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    for (const action of [() => demoCrypto.decrypt(payload), () => { vi.stubEnv("ENCRYPTION_KEY", ""); demoCrypto.encrypt("synthetic probe"); }]) {
      let message = "";
      try {
        action();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("synthetic probe");
      expect(message).not.toContain(ENCRYPTION_KEY);
    }
  });

  it("does not reimplement cryptography (delegates to lib/encryption)", () => {
    const source = readFileSync(join(__dirname, "crypto.ts"), "utf8");
    expect(source).toContain('from "../../lib/encryption/encryption"');
    expect(source).not.toMatch(/createCipheriv|createDecipheriv|randomBytes/);
  });
});

describe("package script", () => {
  const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("uses native Node with only the resolver hook, the react-server condition and the optional env file", () => {
    expect(scripts["seed:demo-team"]).toBe(
      "node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs --env-file-if-exists=.env.local src/features/demo-team/cli.ts",
    );
  });

  it("adds no dependency or compiler change (BR-32)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string>>;
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["firebase", "firebase-admin", "next", "react", "react-dom", "recharts", "server-only"]);
    expect(Object.keys(pkg.devDependencies)).not.toContain("tsx");
    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    expect(tsconfig).not.toContain("allowImportingTsExtensions");
  });
});

// Real Node, fake env, offline only: no Firebase SDK call, no network, no key material.
const nodeMajor = Number(process.versions.node.split(".")[0]);

/** Explicit, minimal child env: the real .env.local and the parent env are never inherited. */
const childEnv = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  PATH: process.env.PATH ?? "",
  ...extra,
});

describe.skipIf(nodeMajor < 24)("CLI smoke under real Node (offline, fake env)", () => {
  function runCli(args: string[], env: Record<string, string>) {
    return spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "./src/features/demo-team/register-ts-resolver.mjs",
        "src/features/demo-team/cli.ts",
        ...args,
      ],
      { cwd: ROOT, env: childEnv(env), encoding: "utf8", timeout: 60_000 },
    );
  }

  const fakeEnv = {
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`,
    FIREBASE_PRIVATE_KEY: PRIVATE_KEY_MARKER,
    ENCRYPTION_KEY,
  };
  const args = ["--project", PROJECT, "--presenter-uid", "presenter-uid-fixture", "--as-of", "2026-03-16", "--offline"];

  it("exits 0, prints the resolved target and plan counts, and leaks nothing", () => {
    const res = runCli(args, fakeEnv);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`Resolved project id: ${PROJECT}`);
    expect(res.stdout).toContain("Mode: offline-dry-run");
    expect(res.stdout).toContain("Writes planned: 82");
    expect(res.stdout).toContain("Local crypto round-trip: ok");
    expect(res.stdout).not.toContain(PRIVATE_KEY_MARKER);
    expect(res.stdout).not.toContain(ENCRYPTION_KEY);
  });

  it("tolerates the leading `--` that pnpm forwards", () => {
    const res = runCli(["--", ...args], fakeEnv);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Writes planned: 82");
  });

  it("does not load firebase-admin offline (only the entry's own module graph runs)", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "./src/features/demo-team/register-ts-resolver.mjs",
        "--import",
        `data:text/javascript,process.on("exit",()=>{const l=process.moduleLoadList.filter(m=>/firebase/i.test(m));process.stderr.write("FB:"+l.length)})`,
        "src/features/demo-team/cli.ts",
        ...args,
      ],
      { cwd: ROOT, env: childEnv(fakeEnv), encoding: "utf8", timeout: 60_000 },
    );
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("FB:0");
  });

  it.each([
    ["an unknown flag", ["--project", PROJECT, "--bogus"], fakeEnv, 2, "unknown-flag"],
    ["a missing presenter", ["--project", PROJECT, "--offline"], fakeEnv, 2, "missing-flag"],
    ["a project/env mismatch", ["--project", "some-other-project", "--presenter-uid", "p-1", "--offline"], fakeEnv, 2, "project-mismatch"],
    ["an unusable encryption key", args, { ...fakeEnv, ENCRYPTION_KEY: "not-base64!" }, 1, "crypto-failed"],
    ["--write without --confirm", [...args.slice(0, -1), "--write"], fakeEnv, 2, "confirm-required"],
  ])("exits non-zero with a category only for %s", (_label, argv, env, status, category) => {
    const res = runCli(argv, env);
    expect(res.status).toBe(status);
    expect(res.stderr).toContain(category);
    expect(res.stderr).not.toContain(PRIVATE_KEY_MARKER);
    expect(res.stderr).not.toContain(ENCRYPTION_KEY);
    expect(res.stdout).not.toContain("committed");
  });
});
