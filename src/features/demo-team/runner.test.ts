import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoAdapterError, type DemoOnlineAdapters } from "./adapters";
import { demoCrypto } from "./crypto";
import { runDemoSeed, stripForwardedSeparator, type DemoRunnerInput } from "./runner";
import { buildDemoLogicalFixtures } from "./fixtures";
import { buildDemoSeedPlan } from "./plan";

const PROJECT = "demo-fake-project";
const PRESENTER = "presenter-uid-fixture";
const PRIVATE_KEY_MARKER = "FAKE-PRIVATE-KEY-MARKER";
const ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
const NOW = () => new Date("2026-03-16T10:00:00.000Z");

const ENV = {
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_PRIVATE_KEY: PRIVATE_KEY_MARKER,
};

const ARGS = ["--project", PROJECT, "--presenter-uid", PRESENTER, "--as-of", "2026-03-16"];
const WRITE_ARGS = [...ARGS, "--write", "--confirm", PROJECT];

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** In-memory Firestore fake behind the adapter seams. Atomic batch; `create` on an existing path fails the commit. */
function fakeOnline(options: { initial?: Record<string, unknown>; presenterExists?: boolean; failCommit?: boolean } = {}) {
  const store = new Map<string, unknown>(Object.entries(options.initial ?? {}));
  const log: string[] = [];
  let commits = 0;
  let batches = 0;

  const adapters: DemoOnlineAdapters = {
    reader: {
      async get(path) {
        log.push(`get ${path}`);
        return store.has(path) ? { exists: true, data: structuredClone(store.get(path)) } : { exists: false };
      },
    },
    presenter: {
      async userExists() {
        log.push("userExists");
        return options.presenterExists ?? true;
      },
    },
    createBatch() {
      batches += 1;
      const staged: Array<{ kind: "create" | "set"; path: string; data: unknown }> = [];
      return {
        create: (path, data) => void staged.push({ kind: "create", path, data }),
        set: (path, data) => void staged.push({ kind: "set", path, data }),
        async commit() {
          log.push("commit");
          commits += 1;
          if (options.failCommit) throw new Error(`raw failure ${PRIVATE_KEY_MARKER}`);
          const next = new Map(store);
          for (const { kind, path, data } of staged) {
            if (kind === "create" && next.has(path)) throw new Error("already exists");
            next.set(path, structuredClone(data));
          }
          store.clear();
          for (const [key, value] of next) store.set(key, value);
        },
      };
    },
  };

  return { adapters, store, log, counts: () => ({ commits, batches }) };
}

function run(argv: string[], online: ReturnType<typeof fakeOnline> | null, overrides: Partial<DemoRunnerInput> = {}) {
  const createOnlineAdapters = vi.fn(async () => {
    if (online === null) throw new Error("no online adapters configured for this test");
    return online.adapters;
  });
  return {
    createOnlineAdapters,
    result: runDemoSeed({ argv, env: ENV, now: NOW, crypto: demoCrypto, createOnlineAdapters, ...overrides }),
  };
}

const allOutput = (r: { stdout: string[]; stderr: string[] }) => [...r.stdout, ...r.stderr].join("\n");

function expectNoSecrets(text: string) {
  expect(text).not.toContain(PRIVATE_KEY_MARKER);
  expect(text).not.toContain(ENCRYPTION_KEY);
  expect(text).not.toMatch(/authTag/i);
}

describe("stripForwardedSeparator", () => {
  it("drops exactly one leading bare `--` and nothing else", () => {
    expect(stripForwardedSeparator(["--", "--project", "x"])).toEqual(["--project", "x"]);
    expect(stripForwardedSeparator(["--project", "x"])).toEqual(["--project", "x"]);
    expect(stripForwardedSeparator(["--", "--"])).toEqual(["--"]);
    expect(stripForwardedSeparator(["--project", "--", "x"])).toEqual(["--project", "--", "x"]);
  });

  it("keeps the parser strict: a second `--` or other positional still aborts", async () => {
    for (const argv of [["--", "--", ...ARGS], ["stray", ...ARGS], [...ARGS, "--"]]) {
      const { result, createOnlineAdapters } = run(stripForwardedSeparator(argv), null);
      const out = await result;
      expect(out.exitCode).toBe(2);
      expect(out.stderr[0]).toMatch(/^Configuration error: unknown-flag/);
      expect(createOnlineAdapters).not.toHaveBeenCalled();
    }
  });
});

describe("configuration failures", () => {
  it("exit 2, category only, no adapters, no secrets", async () => {
    const { result, createOnlineAdapters } = run(["--project", PROJECT], null);
    const out = await result;
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toEqual(["Configuration error: missing-flag (--presenter-uid)"]);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });

  it("rejects write requests missing any gate before adapters exist", async () => {
    const cases: Array<[string[], string]> = [
      [[...ARGS, "--write"], "confirm-required"],
      [[...ARGS, "--write", "--confirm", "other-project-id"], "confirm-mismatch"],
      [[...ARGS, "--write", "--offline", "--confirm", PROJECT], "conflicting-flags"],
    ];
    for (const [argv, category] of cases) {
      const { result, createOnlineAdapters } = run(argv, null);
      const out = await result;
      expect(out.exitCode).toBe(2);
      expect(out.stderr[0]).toContain(category);
      expect(createOnlineAdapters).not.toHaveBeenCalled();
    }
  });

  it("rejects a project that does not match the credential trio before adapters exist", async () => {
    const { result, createOnlineAdapters } = run(
      ["--project", "some-other-project", "--presenter-uid", PRESENTER],
      null,
    );
    expect((await result).stderr[0]).toContain("project-mismatch");
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });
});

describe("offline dry-run", () => {
  it("prints the plan, builds no adapters, reads and writes nothing", async () => {
    const { result, createOnlineAdapters } = run([...ARGS, "--offline"], null);
    const out = await result;

    expect(out.exitCode).toBe(0);
    expect(out.stderr).toEqual([]);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
    const text = allOutput(out);
    expect(text).toContain(`Resolved project id: ${PROJECT}`);
    expect(text).toContain("Mode: offline-dry-run");
    expect(text).toContain("Writes planned: 85");
    expect(text).toContain("Deletes: 0");
    expect(text).toContain("not checked (offline");
    expectNoSecrets(text);
  });

  it("aborts with zero network when the local crypto round-trip fails", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const { result, createOnlineAdapters } = run([...ARGS, "--offline"], null);
    const out = await result;
    expect(out.exitCode).toBe(1);
    expect(out.stderr[0]).toContain("crypto-failed");
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });
});

describe("online dry-run", () => {
  it("builds adapters after validation, checks the presenter, reads each manifest path once, never writes", async () => {
    const online = fakeOnline();
    const { result, createOnlineAdapters } = run(ARGS, online);
    const out = await result;

    expect(out.exitCode).toBe(0);
    expect(createOnlineAdapters).toHaveBeenCalledTimes(1);
    expect(createOnlineAdapters).toHaveBeenCalledWith({
      projectId: PROJECT,
      credentials: { clientEmail: ENV.FIREBASE_CLIENT_EMAIL, privateKey: PRIVATE_KEY_MARKER },
    });

    const reads = online.log.filter((l) => l.startsWith("get "));
    expect(reads).toHaveLength(85);
    expect(new Set(reads).size).toBe(85);
    expect(online.log[0]).toBe("userExists");
    expect(online.counts()).toEqual({ commits: 0, batches: 0 });
    expect(online.store.size).toBe(0);

    const text = allOutput(out);
    expect(text).toContain("Mode: online-dry-run");
    expect(text).toContain(`Resolved project id: ${PROJECT}`);
    expect(text).toContain("Gate: the coordinator must approve this exact project id");
    expectNoSecrets(text);
  });

  it("missing presenter → exit 1, no batch", async () => {
    const online = fakeOnline({ presenterExists: false });
    const out = await run(ARGS, online).result;
    expect(out.exitCode).toBe(1);
    expect(out.stderr[0]).toContain("presenter-not-found");
    expect(online.counts().batches).toBe(0);
  });

  it("maps adapter construction failures to a category and never leaks raw text", async () => {
    const binding = await run(ARGS, null, {
      createOnlineAdapters: async () => {
        throw new DemoAdapterError("project-binding-mismatch");
      },
    }).result;
    expect(binding.exitCode).toBe(1);
    expect(binding.stderr[0]).toContain("project-binding-mismatch");

    const raw = await run(ARGS, null, {
      createOnlineAdapters: async () => {
        throw new Error(`boom ${PRIVATE_KEY_MARKER}`);
      },
    }).result;
    expect(raw.exitCode).toBe(1);
    expect(raw.stderr[0]).toContain("adapters-failed");
    expectNoSecrets(allOutput(raw));
  });
});

describe("write mode (fake adapters only)", () => {
  it("passes every gate → reads and encryption precede exactly one batch commit of all 85 documents", async () => {
    const online = fakeOnline();
    const out = await run(WRITE_ARGS, online).result;

    expect(out.exitCode).toBe(0);
    expect(online.counts()).toEqual({ commits: 1, batches: 1 });
    expect(online.store.size).toBe(85);
    const commitIndex = online.log.indexOf("commit");
    expect(online.log.slice(0, commitIndex).filter((l) => l.startsWith("get "))).toHaveLength(85);
    expect(online.log.slice(commitIndex + 1)).toEqual([]);
    expect(allOutput(out)).toContain("Write: committed 85 documents in one batch. Deletes: 0");
    expect(out.stdout[0]).toBe("Demo Team seed — preflight before write");
    expectNoSecrets(allOutput(out));
  });

  it("writes only manifest paths, from the eight collections, with no undefined values", async () => {
    const online = fakeOnline();
    await run(WRITE_ARGS, online).result;
    const { manifest } = buildDemoSeedPlan({ presenterUid: PRESENTER, asOf: new Date("2026-03-16T00:00:00.000Z"), encrypt: demoCrypto.encrypt });
    expect([...online.store.keys()].sort()).toEqual(manifest.map((m) => m.path).sort());

    const hasUndefined = (value: unknown): boolean =>
      value === undefined ||
      (value !== null && typeof value === "object" && !(value instanceof Date) && Object.values(value).some(hasUndefined));
    expect([...online.store.values()].some(hasUndefined)).toBe(false);
  });

  it("never stores plaintext answers or challenge text", async () => {
    const online = fakeOnline();
    await run(WRITE_ARGS, online).result;
    const serialized = JSON.stringify([...online.store.entries()]);
    expect(serialized).not.toContain(PRIVATE_KEY_MARKER);
    expect(serialized).not.toContain(ENCRYPTION_KEY);
    const fixtures = buildDemoLogicalFixtures({ presenterUid: PRESENTER, asOf: new Date("2026-03-16T00:00:00.000Z") });
    expect(fixtures.challenges).toHaveLength(5);
    for (const { text } of fixtures.challenges) expect(serialized).not.toContain(text);
    // Response plaintext is `[flow,stress,fun]`; no stored value is such a tuple.
    expect(serialized).not.toMatch(/[[1-5],[1-5],[1-5]]/);
  });

  it("a rerun converges: same ids, no duplicates, C records skipped, ciphertext differs", async () => {
    const online = fakeOnline();
    await run(WRITE_ARGS, online).result;
    const firstKeys = [...online.store.keys()].sort();
    const firstResponse = structuredClone(online.store.get("surveyResponses/demo-response-s01-r01")) as { ciphertext: string };

    const second = await run(WRITE_ARGS, online).result;
    expect(second.exitCode).toBe(0);
    expect([...online.store.keys()].sort()).toEqual(firstKeys);
    expect(online.store.size).toBe(85);
    expect(allOutput(second)).toContain("Write: committed 79 documents in one batch");
    const secondResponse = online.store.get("surveyResponses/demo-response-s01-r01") as { ciphertext: string };
    expect(secondResponse.ciphertext).not.toBe(firstResponse.ciphertext);
    expect(online.counts().commits).toBe(2);
  });

  it("a conflict → exit 1, zero batches, nothing written", async () => {
    const online = fakeOnline({
      initial: { "teams/demo-team": { name: "Someone else", status: "active", createdAt: new Date(), createdBy: "real-user" } },
    });
    const out = await run(WRITE_ARGS, online).result;

    expect(out.exitCode).toBe(1);
    expect(out.stderr[0]).toContain("conflict");
    expect(allOutput(out)).toContain("blocked (foreign-creator) teams/demo-team");
    expect(online.counts()).toEqual({ commits: 0, batches: 0 });
    expect(online.store.size).toBe(1);
  });

  it("a failing commit → write_failed, nothing committed, no raw text", async () => {
    const online = fakeOnline({ failCommit: true });
    const out = await run(WRITE_ARGS, online).result;
    expect(out.exitCode).toBe(1);
    expect(out.stderr[0]).toContain("write_failed");
    expect(online.store.size).toBe(0);
    expectNoSecrets(allOutput(out));
  });

  it("missing presenter or failed crypto → zero writes", async () => {
    const noPresenter = fakeOnline({ presenterExists: false });
    expect((await run(WRITE_ARGS, noPresenter).result).exitCode).toBe(1);
    expect(noPresenter.counts().batches).toBe(0);

    vi.stubEnv("ENCRYPTION_KEY", "not-base64!");
    const noCrypto = fakeOnline();
    const { result, createOnlineAdapters } = run(WRITE_ARGS, noCrypto);
    expect((await result).exitCode).toBe(1);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
    expect(noCrypto.counts().batches).toBe(0);
  });

  it("dry-run modes never reach the writer even when everything is green", async () => {
    const online = fakeOnline();
    await run(ARGS, online).result;
    expect(online.counts().batches).toBe(0);
  });
});

describe("static guarantees", () => {
  const read = (name: string) => readFileSync(join(__dirname, name), "utf8");

  it("runner and entry import no Firebase SDK and no delete/query surface", () => {
    for (const file of ["runner.ts", "cli.ts", "crypto.ts"]) {
      const source = read(file);
      expect(source).not.toMatch(/from "firebase/);
      expect(source).not.toMatch(/import\("firebase/);
      expect(source).not.toContain("applicationDefault");
    }
  });
});
