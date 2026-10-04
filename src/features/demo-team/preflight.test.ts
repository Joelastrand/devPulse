import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "../../lib/encryption/encryption";
import type { DemoSeedConfig } from "./config";
import { buildDemoSeedPlan, type PlannedOperation } from "./plan";
import {
  type DemoCrypto,
  type DemoPreflightResult,
  type DemoReader,
  formatDemoDryRunReport,
  runDemoPreflight,
  runLocalCryptoPreflight,
} from "./preflight";

const PRESENTER = "presenter-uid-fixture";
const AS_OF = new Date("2026-03-16T00:00:00.000Z");
const PROJECT = "fake-demo-project";
const PRIVATE_KEY_SENTINEL = "PRIVATE-KEY-SENTINEL-DO-NOT-PRINT";
const EMAIL_SENTINEL = "presenter.email@example.invalid";

const ROADMAP_PATHS = [
  "roadmapItems/demo-team__demo-skill-testing",
  "roadmapItems/demo-team__demo-skill-observability",
  "roadmapItems/demo-team__demo-skill-delivery",
];

const realCrypto: DemoCrypto = { encrypt, decrypt };

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function buildPlan() {
  return buildDemoSeedPlan({ presenterUid: PRESENTER, asOf: AS_OF, encrypt });
}

type Store = Map<string, unknown>;

/** A target that already holds exactly the intended dataset. */
function correctStore(operations: readonly PlannedOperation[]): Store {
  return new Map(operations.map((op) => [op.path, structuredClone(op.data)]));
}

function fakeReader(store: Store) {
  const calls: string[] = [];
  const reader: DemoReader = {
    async get(path) {
      calls.push(path);
      return store.has(path) ? { exists: true, data: store.get(path) } : { exists: false };
    },
  };
  return { reader, calls };
}

function fakePresenter(exists = true) {
  const calls: string[] = [];
  return {
    calls,
    presenter: {
      async userExists(uid: string) {
        calls.push(uid);
        return exists;
      },
    },
  };
}

const onlineConfig = { network: true, presenterUid: PRESENTER } as const;
const offlineConfig = { network: false, presenterUid: PRESENTER } as const;

async function preflightOnline(store: Store, options: { crypto?: DemoCrypto; presenterExists?: boolean } = {}) {
  const { operations, manifest } = buildPlan();
  const r = fakeReader(store);
  const p = fakePresenter(options.presenterExists ?? true);
  const result = await runDemoPreflight({
    config: onlineConfig,
    operations,
    manifest,
    crypto: options.crypto ?? realCrypto,
    online: { reader: r.reader, presenter: p.presenter },
  });
  return { result, reads: r.calls, presenterCalls: p.calls, operations, manifest };
}

function classificationOf(result: DemoPreflightResult, path: string) {
  const found = result.classifications.find((c) => c.path === path);
  if (found === undefined) throw new Error(`no classification for ${path}`);
  return found;
}

describe("local crypto preflight (BR-26)", () => {
  it("passes with a working round-trip", () => {
    expect(runLocalCryptoPreflight(realCrypto)).toBe(true);
  });

  it("fails when encrypt throws, decrypt throws, or the round-trip differs", () => {
    const real = realCrypto;
    expect(runLocalCryptoPreflight({ encrypt: () => { throw new Error("no key"); }, decrypt: real.decrypt })).toBe(false);
    expect(runLocalCryptoPreflight({ encrypt: real.encrypt, decrypt: () => { throw new Error("bad"); } })).toBe(false);
    expect(runLocalCryptoPreflight({ encrypt: real.encrypt, decrypt: () => "something else" })).toBe(false);
  });

  it("aborts offline and online with zero reads and no plan when crypto fails", async () => {
    const { operations, manifest } = buildPlan();
    const broken: DemoCrypto = { encrypt: () => { throw new Error("KEY-TEXT-LEAK"); }, decrypt };
    const r = fakeReader(new Map());
    const p = fakePresenter();

    for (const config of [offlineConfig, onlineConfig]) {
      const result = await runDemoPreflight({
        config,
        operations,
        manifest,
        crypto: broken,
        online: { reader: r.reader, presenter: p.presenter },
      });
      expect(result).toEqual({ ok: false, error: { category: "crypto-failed" }, classifications: [] });
      expect(JSON.stringify(result)).not.toContain("KEY-TEXT-LEAK");
    }
    expect(r.calls).toEqual([]);
    expect(p.calls).toEqual([]);
  });
});

describe("offline preflight (BR-28, BR-29)", () => {
  it("makes zero reader and presenter calls, checks crypto, and plans all 85 operations", async () => {
    const { operations, manifest } = buildPlan();
    const r = fakeReader(new Map());
    const p = fakePresenter();
    const result = await runDemoPreflight({
      config: offlineConfig,
      operations,
      manifest,
      crypto: realCrypto,
      online: { reader: r.reader, presenter: p.presenter },
    });

    expect(result).toMatchObject({ ok: true, existingStateChecked: false, classifications: [] });
    expect(result.ok && result.plannedOperations).toHaveLength(85);
    expect(r.calls).toEqual([]);
    expect(p.calls).toEqual([]);
  });

  it("does not need online adapters at all", async () => {
    const { operations, manifest } = buildPlan();
    const result = await runDemoPreflight({ config: offlineConfig, operations, manifest, crypto: realCrypto });
    expect(result.ok).toBe(true);
  });
});

describe("online preflight — presenter and adapters", () => {
  it("checks presenter existence with the uid only, before any read", async () => {
    const { presenterCalls, reads } = await preflightOnline(new Map());
    expect(presenterCalls).toEqual([PRESENTER]);
    expect(reads).toHaveLength(85);
  });

  it("aborts with zero reads when the presenter does not exist", async () => {
    const { result, reads } = await preflightOnline(new Map(), { presenterExists: false });
    expect(result).toEqual({ ok: false, error: { category: "presenter-not-found" }, classifications: [] });
    expect(reads).toEqual([]);
  });

  it("reports lookup failure as a category without raw exception text", async () => {
    const { operations, manifest } = buildPlan();
    const r = fakeReader(new Map());
    const result = await runDemoPreflight({
      config: onlineConfig,
      operations,
      manifest,
      crypto: realCrypto,
      online: {
        reader: r.reader,
        presenter: {
          async userExists() {
            throw new Error(`token ${PRIVATE_KEY_SENTINEL}`);
          },
        },
      },
    });
    expect(result).toEqual({ ok: false, error: { category: "presenter-lookup-failed" }, classifications: [] });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY_SENTINEL);
    expect(r.calls).toEqual([]);
  });

  it("reports a failing read as a category without raw exception text", async () => {
    const { operations, manifest } = buildPlan();
    const result = await runDemoPreflight({
      config: onlineConfig,
      operations,
      manifest,
      crypto: realCrypto,
      online: {
        reader: {
          async get() {
            throw new Error(`permission denied ${PRIVATE_KEY_SENTINEL}`);
          },
        },
        presenter: fakePresenter().presenter,
      },
    });
    expect(result).toEqual({ ok: false, error: { category: "read-failed" }, classifications: [] });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY_SENTINEL);
  });

  it("fails closed when an online run is given no adapters", async () => {
    const { operations, manifest } = buildPlan();
    const result = await runDemoPreflight({ config: onlineConfig, operations, manifest, crypto: realCrypto });
    expect(result).toEqual({ ok: false, error: { category: "adapters-missing" }, classifications: [] });
  });
});

describe("classification — empty, correct and partial targets (BR-23)", () => {
  it("empty target: every path ABSENT → create, all 85 operations planned", async () => {
    const { result, reads, operations, manifest } = await preflightOnline(new Map());

    expect(result.ok).toBe(true);
    expect(result.classifications).toHaveLength(85);
    expect(result.classifications.every((c) => c.state === "ABSENT" && c.action === "create")).toBe(true);
    expect(result.ok && result.plannedOperations).toHaveLength(85);
    // Only manifest paths are read, each exactly once (BR-29).
    expect([...reads].sort()).toEqual(manifest.map((m) => m.path).sort());
    expect(operations).toHaveLength(85);
  });

  it("already-correct target: C → skip, U → set (79 planned), no conflict", async () => {
    const { operations } = buildPlan();
    const { result } = await preflightOnline(correctStore(operations));

    expect(result.ok).toBe(true);
    const c = result.classifications;
    expect(c.every((x) => x.state === "COMPATIBLE")).toBe(true);
    expect(c.filter((x) => x.action === "skip").map((x) => x.writeClass)).toEqual(["C", "C", "C", "C", "C", "C"]);
    expect(c.filter((x) => x.action === "set")).toHaveLength(79);
    expect(result.ok && result.plannedOperations.every((op) => op.writeClass === "U")).toBe(true);
    expect(result.ok && result.plannedOperations).toHaveLength(79);
  });

  it("partially existing target mixes create, set and skip", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.delete("surveys/demo-survey-01");
    store.delete("skillTrees/demo-skill-testing");
    store.delete("teams/demo-team");
    store.delete("challenges/demo-challenge-03");
    // Keep membership (C, compatible → skip).

    const { result } = await preflightOnline(store);
    expect(result.ok).toBe(true);
    expect(classificationOf(result, "surveys/demo-survey-01")).toMatchObject({ state: "ABSENT", action: "create" });
    expect(classificationOf(result, "teams/demo-team")).toMatchObject({ state: "ABSENT", action: "create" });
    expect(classificationOf(result, `teamMemberships/${PRESENTER}__demo-team`)).toMatchObject({
      state: "COMPATIBLE",
      action: "skip",
    });
    expect(classificationOf(result, "surveys/demo-survey-02")).toMatchObject({ state: "COMPATIBLE", action: "set" });
    // 85 - 1 skipped membership - scheduled survey skip - … only C-compatible are skipped.
    const skipped = result.classifications.filter((c) => c.action === "skip").map((c) => c.path).sort();
    expect(skipped).toEqual(
      [
        `teamMemberships/${PRESENTER}__demo-team`,
        "surveys/demo-survey-next",
        ...ROADMAP_PATHS,
      ].sort(),
    );
    expect(result.ok && result.plannedOperations).toHaveLength(80);
  });

  it("is deterministic: the same inputs classify identically", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.delete("surveys/demo-survey-05");
    const a = await preflightOnline(store);
    const b = await preflightOnline(store);
    expect(a.result.classifications).toEqual(b.result.classifications);
    expect(a.reads).toEqual(b.reads);
  });
});

describe("classification — compatible but edited records (BR-21, BR-23)", () => {
  async function withEdit(path: string, edit: (data: Record<string, unknown>) => Record<string, unknown>) {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.set(path, edit(store.get(path) as Record<string, unknown>));
    return preflightOnline(store);
  }

  it("progress moved by the presenter (real updatedBy) stays COMPATIBLE and is set back", async () => {
    const { result } = await withEdit("skillProgress/demo-team__demo-skill-testing", (d) => ({
      ...d,
      currentNodeId: "node-4",
      updatedBy: "some-real-admin-uid",
    }));
    expect(result.ok).toBe(true);
    expect(classificationOf(result, "skillProgress/demo-team__demo-skill-testing")).toMatchObject({
      state: "COMPATIBLE",
      action: "set",
    });
  });

  it("a resolved demo challenge (real resolvedBy) stays COMPATIBLE", async () => {
    const { result } = await withEdit("challenges/demo-challenge-01", (d) => ({
      ...d,
      resolvedAt: new Date("2026-03-01T10:00:00.000Z"),
      resolvedBy: "some-real-admin-uid",
    }));
    expect(result.ok).toBe(true);
    expect(classificationOf(result, "challenges/demo-challenge-01").state).toBe("COMPATIBLE");
  });

  it("an opened scheduled survey stays COMPATIBLE and is skipped", async () => {
    const { result } = await withEdit("surveys/demo-survey-next", (d) => ({
      ...d,
      openedAt: new Date("2026-03-10T08:00:00.000Z"),
    }));
    expect(classificationOf(result, "surveys/demo-survey-next")).toMatchObject({ state: "COMPATIBLE", action: "skip" });
  });

  it("an edited team name and an edited tree label with an updatedBy pair stay COMPATIBLE", async () => {
    const team = await withEdit("teams/demo-team", (d) => ({ ...d, name: "Omdøpt demo" }));
    expect(team.result.ok).toBe(true);

    const tree = await withEdit("skillTrees/demo-skill-delivery", (d) => ({
      ...d,
      nodes: (d.nodes as { label: string }[]).map((n, i) => (i === 0 ? { ...n, label: "Endret" } : n)),
      updatedAt: new Date("2026-03-02T00:00:00.000Z"),
      updatedBy: "some-real-admin-uid",
    }));
    expect(tree.result.ok).toBe(true);
  });
});

describe("classification — conflicts abort with no planned writes (BR-23, BR-24, BR-27)", () => {
  const PATHS = {
    team: "teams/demo-team",
    membership: `teamMemberships/${PRESENTER}__demo-team`,
    survey: "surveys/demo-survey-03",
    scheduled: "surveys/demo-survey-next",
    response: "surveyResponses/demo-response-s01-r01",
    challenge: "challenges/demo-challenge-02",
    tree: "skillTrees/demo-skill-testing",
    progress: "skillProgress/demo-team__demo-skill-delivery",
  } as const;

  const cases: Array<{
    name: string;
    path: string;
    reason: string;
    edit: (d: Record<string, unknown>) => unknown;
  }> = [
    { name: "team with malformed shape", path: PATHS.team, reason: "malformed-shape", edit: (d) => ({ ...d, status: "bogus" }) },
    { name: "non-object team", path: PATHS.team, reason: "malformed-shape", edit: () => "nope" },
    { name: "disabled team", path: PATHS.team, reason: "team-disabled", edit: (d) => ({ ...d, status: "disabled" }) },
    { name: "team with foreign createdBy", path: PATHS.team, reason: "foreign-creator", edit: (d) => ({ ...d, createdBy: "real-admin" }) },
    { name: "membership with foreign grantedBy", path: PATHS.membership, reason: "membership-mismatch", edit: (d) => ({ ...d, grantedBy: "real-admin" }) },
    { name: "membership for another team/uid", path: PATHS.membership, reason: "membership-mismatch", edit: (d) => ({ ...d, uid: "someone-else" }) },
    { name: "malformed membership", path: PATHS.membership, reason: "malformed-shape", edit: () => null },
    { name: "survey of another team", path: PATHS.survey, reason: "scope-mismatch", edit: (d) => ({ ...d, teamId: "other-team" }) },
    { name: "survey with foreign createdBy", path: PATHS.survey, reason: "foreign-creator", edit: (d) => ({ ...d, createdBy: "real-admin" }) },
    { name: "survey with malformed shape", path: PATHS.survey, reason: "malformed-shape", edit: (d) => ({ ...d, minimumResponses: 1 }) },
    { name: "survey with different minimumResponses", path: PATHS.survey, reason: "scope-mismatch", edit: (d) => ({ ...d, minimumResponses: 8 }) },
    { name: "scheduled id occupied by a public survey", path: PATHS.scheduled, reason: "scope-mismatch", edit: (d) => ({ ...d, accessMode: "public" }) },
    { name: "scheduled id occupied by another team's survey", path: PATHS.scheduled, reason: "scope-mismatch", edit: (d) => ({ ...d, teamId: "other-team" }) },
    { name: "response with an extra identity field", path: PATHS.response, reason: "malformed-shape", edit: (d) => ({ ...d, uid: "someone" }) },
    { name: "response for another survey", path: PATHS.response, reason: "scope-mismatch", edit: (d) => ({ ...d, surveyId: "demo-survey-02" }) },
    { name: "response with wrong keyVersion", path: PATHS.response, reason: "malformed-shape", edit: (d) => ({ ...d, keyVersion: "v2" }) },
    { name: "undecryptable response", path: PATHS.response, reason: "undecryptable", edit: (d) => ({ ...d, authTag: Buffer.alloc(16).toString("base64") }) },
    { name: "response that decrypts to an invalid answer tuple", path: PATHS.response, reason: "undecryptable", edit: (d) => ({ ...d, ...encrypt("[9,9,9]") }) },
    { name: "response that decrypts to non-JSON", path: PATHS.response, reason: "undecryptable", edit: (d) => ({ ...d, ...encrypt("not json") }) },
    { name: "undecryptable challenge", path: PATHS.challenge, reason: "undecryptable", edit: (d) => ({ ...d, ciphertext: Buffer.from("garbage-bytes").toString("base64") }) },
    { name: "challenge whose text is invalid", path: PATHS.challenge, reason: "undecryptable", edit: (d) => ({ ...d, ...encrypt("ab") }) },
    { name: "challenge of another team", path: PATHS.challenge, reason: "scope-mismatch", edit: (d) => ({ ...d, teamId: "other-team" }) },
    { name: "challenge with a half lifecycle pair", path: PATHS.challenge, reason: "malformed-shape", edit: (d) => ({ ...d, resolvedAt: new Date() }) },
    { name: "tree with fewer nodes (structure mismatch)", path: PATHS.tree, reason: "structure-mismatch", edit: (d) => ({ ...d, nodes: (d.nodes as unknown[]).slice(0, 3) }) },
    { name: "tree with foreign createdBy", path: PATHS.tree, reason: "foreign-creator", edit: (d) => ({ ...d, createdBy: "real-admin" }) },
    { name: "malformed tree", path: PATHS.tree, reason: "malformed-shape", edit: (d) => ({ ...d, nodes: "x" }) },
    { name: "progress of another team", path: PATHS.progress, reason: "scope-mismatch", edit: (d) => ({ ...d, teamId: "other-team" }) },
    { name: "progress for another tree", path: PATHS.progress, reason: "scope-mismatch", edit: (d) => ({ ...d, treeId: "demo-skill-testing" }) },
    { name: "malformed progress", path: PATHS.progress, reason: "malformed-shape", edit: (d) => ({ ...d, updatedBy: "" }) },
  ];

  it.each(cases)("$name ⇒ CONFLICT ($reason), abort, nothing planned", async ({ path, reason, edit }) => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.set(path, edit(store.get(path) as Record<string, unknown>));

    const { result } = await preflightOnline(store);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.category).toBe("conflict");
    expect(result).not.toHaveProperty("plannedOperations");
    expect(classificationOf(result, path)).toMatchObject({ state: "CONFLICT", action: "blocked", reason });
    // Every other path is still classified, so the report shows the whole picture.
    expect(result.classifications).toHaveLength(85);
    expect(result.classifications.filter((c) => c.state === "CONFLICT")).toHaveLength(1);
  });

  it("an existing record is never adopted by id match alone: a stranger's survey at a closed id conflicts", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.set("surveys/demo-survey-01", {
      teamId: "real-team",
      title: "Ekte",
      accessMode: "authenticated",
      minimumResponses: 5,
      createdAt: new Date(),
      createdBy: "real-admin",
    });
    const { result } = await preflightOnline(store);
    expect(result.ok).toBe(false);
  });

  it("a key mismatch on existing ciphertext is an undecryptable conflict, not an overwrite", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    // Data was encrypted with the stubbed key above; switch to a different key.
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const { result } = await preflightOnline(store);

    expect(result.ok).toBe(false);
    const reasons = new Set(result.classifications.filter((c) => c.state === "CONFLICT").map((c) => c.reason));
    expect(reasons).toEqual(new Set(["undecryptable"]));
    expect(result.classifications.filter((c) => c.state === "CONFLICT")).toHaveLength(64);
  });
});

describe("read-only guarantees (BR-25, BR-28)", () => {
  it("does not mutate the store or the planned operations", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.delete("surveys/demo-survey-04");
    const storeBefore = structuredClone([...store.entries()]);
    const opsBefore = structuredClone(operations);

    await preflightOnline(store);

    expect([...store.entries()]).toEqual(storeBefore);
    expect(operations).toEqual(opsBefore);
  });

  it("rejects operations that do not match the manifest before any read", async () => {
    const { operations, manifest } = buildPlan();
    const r = fakeReader(new Map());
    const forged = [...operations.slice(1), { ...operations[0], path: "forumThreads/x", collection: "forumThreads" } as unknown as PlannedOperation];
    await expect(
      runDemoPreflight({
        config: onlineConfig,
        operations: forged,
        manifest,
        crypto: realCrypto,
        online: { reader: r.reader, presenter: fakePresenter().presenter },
      }),
    ).rejects.toThrow();
    expect(r.calls).toEqual([]);
  });

  const source = readFileSync(join(__dirname, "preflight.ts"), "utf8");

  it("imports neither the writer nor Firebase and has no removal, query or I/O symbol", () => {
    expect(source).not.toMatch(/from\s+["']\.\/writer["']/);
    expect(source).not.toMatch(/writeDemoOperations|createBatch/);
    expect(source).not.toMatch(/from\s+["'](firebase|firebase-admin)/);
    expect(source).not.toMatch(/\bdelete\b/i);
    expect(source).not.toMatch(/\.(where|getAll|listDocuments|collection|doc)\(/);
    expect(source).not.toMatch(/\b(fetch|console\.\w+)\(/);
    expect(source).not.toMatch(/\bprocess\.(env|argv)\b/);
  });

  it("exposes only `get` on the reader seam and only `userExists` on the presenter seam", () => {
    const members = (name: string) => {
      const body = new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? "";
      return [...body.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);
    };
    expect(members("DemoReader")).toEqual(["get"]);
    expect(members("DemoPresenterLookup")).toEqual(["userExists"]);
  });
});

describe("dry-run report (BR-4, BR-28, BR-31)", () => {
  const fullConfig: DemoSeedConfig = {
    mode: "online-dry-run",
    projectId: PROJECT,
    presenterUid: PRESENTER,
    asOf: AS_OF,
    network: true,
    writesAllowed: false,
    credentials: { clientEmail: `sa@${PROJECT}.iam.gserviceaccount.com`, privateKey: PRIVATE_KEY_SENTINEL },
  };

  async function report(store: Store, config: DemoSeedConfig = fullConfig) {
    const { result, operations } = await preflightOnline(store);
    return { lines: formatDemoDryRunReport({ config, operations, result }), result, operations };
  }

  it("reports project, mode, counts, per-path actions, 0 deletes, warning, admin reminder and the gate", async () => {
    const { lines } = await report(new Map());
    const text = lines.join("\n");

    expect(text).toContain(`Resolved project id: ${PROJECT}`);
    expect(text).toContain("Mode: online-dry-run");
    expect(text).toContain("Presenter uid: presenter-uid-fixture");
    expect(text).toContain("As-of date: 2026-03-16");
    for (const [collection, n] of Object.entries({ teams: 1, teamMemberships: 1, surveys: 9, surveyResponses: 59, challenges: 5, skillTrees: 4, skillProgress: 3, roadmapItems: 3 })) {
      expect(text).toContain(`  ${collection}: ${n}`);
    }
    expect(text).toContain("  create teams/demo-team");
    expect(text).toContain("Deletes: 0");
    expect(text).toContain("visible to every signed-in user and every admin");
    expect(text).toContain("APP_ADMIN_EMAILS");
    expect(text).toContain("coordinator must approve this exact project id before `--write`");
    expect(text).toContain("does not prove the key matches ciphertext already stored");
  });

  it("shows set / skip (exists) / blocked (category) actions", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    const okReport = (await report(store)).lines.join("\n");
    expect(okReport).toContain("  skip (exists) teams/demo-team");
    expect(okReport).toContain("  set surveys/demo-survey-01");
    expect(okReport).toContain("Writes planned: 79");

    store.set("teams/demo-team", { ...(store.get("teams/demo-team") as object), status: "disabled" });
    const conflictReport = (await report(store)).lines.join("\n");
    expect(conflictReport).toContain("  blocked (team-disabled) teams/demo-team");
    expect(conflictReport).toContain("Writes planned: 0 (aborted: conflict)");
  });

  it("offline report states existing state was not checked", async () => {
    const { operations, manifest } = buildPlan();
    const result = await runDemoPreflight({ config: offlineConfig, operations, manifest, crypto: realCrypto });
    const text = formatDemoDryRunReport({
      config: { mode: "offline-dry-run", projectId: PROJECT, presenterUid: PRESENTER, asOf: AS_OF },
      operations,
      result,
    }).join("\n");
    expect(text).toContain("Mode: offline-dry-run");
    expect(text).toContain("not checked (offline");
    expect(text).toContain(`Resolved project id: ${PROJECT}`);
  });

  it("failure reports carry the category only", async () => {
    const { operations, manifest } = buildPlan();
    const result = await runDemoPreflight({
      config: onlineConfig,
      operations,
      manifest,
      crypto: { encrypt: () => { throw new Error(PRIVATE_KEY_SENTINEL); }, decrypt },
    });
    const text = formatDemoDryRunReport({ config: fullConfig, operations, result }).join("\n");
    expect(text).toContain("Local crypto round-trip: FAILED");
    expect(text).toContain("Preflight failed: crypto-failed");
    expect(text).not.toContain(PRIVATE_KEY_SENTINEL);
  });

  it("is deterministic for the same input", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    expect((await report(store)).lines).toEqual((await report(store)).lines);
  });

  it("never contains credentials, ciphertext, iv, authTag, decrypted text/answers or an email", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    // Include a conflict so the report shows its most detailed shape too.
    store.set("teams/demo-team", { ...(store.get("teams/demo-team") as object), createdBy: "x" });
    const { lines, result } = await report(store);
    const text = lines.join("\n") + JSON.stringify(result);

    expect(text).not.toContain(PRIVATE_KEY_SENTINEL);
    expect(text).not.toContain("iam.gserviceaccount.com");
    expect(text).not.toContain(EMAIL_SENTINEL);
    for (const op of operations) {
      if (op.collection === "surveyResponses" || op.collection === "challenges") {
        const data = op.data as unknown as { ciphertext: string; iv: string; authTag: string };
        for (const secret of [data.ciphertext, data.iv, data.authTag]) {
          expect(text).not.toContain(secret);
        }
      }
    }
    expect(text).not.toContain("Kodegranskninger");
    expect(text).not.toMatch(/\[\d,\d,\d\]/);
  });
});

describe("classification — roadmap plans (team-skill-planning TASK-011)", () => {
  const TESTING = "roadmapItems/demo-team__demo-skill-testing";

  async function withRoadmapEdit(edit: (data: Record<string, unknown>) => Record<string, unknown>) {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.set(TESTING, edit(store.get(TESTING) as Record<string, unknown>));
    return preflightOnline(store);
  }

  it("missing plans → create; identical plans → compatible skip (never rewritten)", async () => {
    const { operations } = buildPlan();
    const store = correctStore(operations);
    store.delete(TESTING);
    const { result } = await preflightOnline(store);
    expect(result.ok).toBe(true);
    expect(classificationOf(result, TESTING)).toMatchObject({ state: "ABSENT", action: "create", writeClass: "C" });
    expect(classificationOf(result, "roadmapItems/demo-team__demo-skill-delivery")).toMatchObject({
      state: "COMPATIBLE",
      action: "skip",
    });
    expect(result.ok && result.plannedOperations.some((op) => op.collection === "roadmapItems")).toBe(true);
  });

  it("tolerates presenter edits (status, owner reference, updatedBy, archive)", async () => {
    const { result } = await withRoadmapEdit((d) => ({
      ...d,
      status: "planned",
      completedAt: undefined,
      ownerRef: "opaque-ref",
      updatedBy: "someone-else",
      archivedAt: new Date("2026-03-20T00:00:00Z"),
      archivedBy: "someone-else",
    }));
    expect(result.ok).toBe(true);
    expect(classificationOf(result, TESTING)).toMatchObject({ state: "COMPATIBLE", action: "skip" });
    expect(result.ok && result.plannedOperations.map((o) => o.path)).not.toContain(TESTING);
  });

  // The read-side legacy tolerance (completed without completedAt) must not leak into preflight.
  it.each([
    ["absent", (d: Record<string, unknown>) => ({ ...d, status: "completed", completedAt: undefined })],
    ["null", (d: Record<string, unknown>) => ({ ...d, status: "completed", completedAt: null })],
  ])("completed plan with %s completedAt ⇒ CONFLICT malformed-shape, nothing planned", async (_name, edit) => {
    const { result } = await withRoadmapEdit(edit);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.category).toBe("conflict");
    expect(classificationOf(result, TESTING)).toMatchObject({ state: "CONFLICT", action: "blocked", reason: "malformed-shape" });
  });

  it.each([
    ["malformed shape", (d: Record<string, unknown>) => ({ ...d, priority: "urgent" }), "malformed-shape"],
    ["another team", (d: Record<string, unknown>) => ({ ...d, teamId: "other-team" }), "scope-mismatch"],
    ["another tree", (d: Record<string, unknown>) => ({ ...d, treeId: "demo-skill-delivery" }), "scope-mismatch"],
    ["foreign creator", (d: Record<string, unknown>) => ({ ...d, createdBy: "a-real-user" }), "foreign-creator"],
  ])("%s ⇒ CONFLICT, abort, nothing planned", async (_name, edit, reason) => {
    const { result } = await withRoadmapEdit(edit);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.category).toBe("conflict");
    expect(classificationOf(result, TESTING)).toMatchObject({ state: "CONFLICT", action: "blocked", reason });
  });
});
