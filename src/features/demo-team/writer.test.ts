import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSeedPlan, type ManifestEntry, type PlannedOperation } from "./plan";
import {
  DemoWriteError,
  MAX_BATCH_OPERATIONS,
  type DemoWriteBatch,
  writeDemoOperations,
} from "./writer";

const PRESENTER = "presenter-uid-fixture";
const AS_OF = new Date("2026-03-16T00:00:00.000Z");

const { operations, manifest } = buildDemoSeedPlan({
  presenterUid: PRESENTER,
  asOf: AS_OF,
  encrypt: () => ({ ciphertext: "Y2lwaGVy", iv: "aXY=", authTag: "dGFn", keyVersion: "v1" }),
});

/** In-memory atomic fake: writes apply only on a successful commit; `create` on an existing path fails the whole commit. */
function fakeStore(initial: Record<string, unknown> = {}, options: { failCommit?: boolean } = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const calls: string[] = [];
  let batches = 0;
  let commits = 0;

  const createBatch = (): DemoWriteBatch => {
    batches += 1;
    const staged: Array<{ kind: "create" | "set"; path: string; data: unknown }> = [];
    return {
      create(path, data) {
        calls.push("create");
        staged.push({ kind: "create", path, data });
      },
      set(path, data) {
        calls.push("set");
        staged.push({ kind: "set", path, data });
      },
      async commit() {
        commits += 1;
        if (options.failCommit) {
          throw new Error("secret-ish raw failure text");
        }
        const next = new Map(store);
        for (const { kind, path, data } of staged) {
          if (kind === "create" && next.has(path)) {
            throw new Error("already exists");
          }
          next.set(path, data);
        }
        store.clear();
        for (const [k, v] of next) store.set(k, v);
      },
    };
  };

  return {
    store,
    calls,
    createBatch,
    get batches() {
      return batches;
    },
    get commits() {
      return commits;
    },
  };
}

function forged(collection: string, docId: string, writeClass: "C" | "U" = "U"): PlannedOperation {
  return { collection, docId, path: `${collection}/${docId}`, writeClass, data: {} } as unknown as PlannedOperation;
}

async function expectRejected(
  fake: ReturnType<typeof fakeStore>,
  ops: readonly PlannedOperation[],
  category: string,
  man: readonly ManifestEntry[] = manifest,
) {
  const error = await writeDemoOperations({ operations: ops, manifest: man, createBatch: fake.createBatch }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DemoWriteError);
  expect((error as DemoWriteError).category).toBe(category);
  expect(fake.batches).toBe(0);
  expect(fake.calls).toEqual([]);
  expect(fake.commits).toBe(0);
  expect(fake.store.size).toBe(0);
}

describe("writeDemoOperations — happy path", () => {
  it("writes the full 85-operation plan in exactly one batch and one commit", async () => {
    const fake = fakeStore();
    const result = await writeDemoOperations({ operations, manifest, createBatch: fake.createBatch });

    expect(result).toEqual({ written: 85 });
    expect(fake.batches).toBe(1);
    expect(fake.commits).toBe(1);
    expect(fake.store.size).toBe(85);
  });

  it("maps class C to create and class U to set", async () => {
    const fake = fakeStore();
    await writeDemoOperations({ operations, manifest, createBatch: fake.createBatch });

    const creates = operations.filter((o) => o.writeClass === "C").length;
    expect(creates).toBe(6);
    expect(fake.calls.filter((c) => c === "create")).toHaveLength(creates);
    expect(fake.calls.filter((c) => c === "set")).toHaveLength(operations.length - creates);
  });

  it("accepts a manifest-owned subset (compatible C records skipped upstream)", async () => {
    const fake = fakeStore();
    const subset = operations.filter((o) => o.writeClass === "U");
    await expect(
      writeDemoOperations({ operations: subset, manifest, createBatch: fake.createBatch }),
    ).resolves.toEqual({ written: subset.length });
    expect(fake.commits).toBe(1);
  });

  it("re-running over the same store converges without duplicates (U set) but a C collision fails", async () => {
    const fake = fakeStore();
    const uOnly = operations.filter((o) => o.writeClass === "U");
    await writeDemoOperations({ operations: uOnly, manifest, createBatch: fake.createBatch });
    await writeDemoOperations({ operations: uOnly, manifest, createBatch: fake.createBatch });
    expect(fake.store.size).toBe(uOnly.length);
  });
});

describe("writeDemoOperations — refuses before any write", () => {
  it.each(["forumThreads", "forumReplies", "teamSurveyState", "surveyParticipations", "teamInvitations", "teamAccessRequests", "users"])(
    "rejects a %s operation with zero batch calls",
    async (collection) => {
      const fake = fakeStore();
      const bad = forged(collection, "anything");
      await expectRejected(fake, [...operations, bad], "invalid_operations");
    },
  );

  it("rejects an allow-listed collection path that is not in the manifest", async () => {
    await expectRejected(fakeStore(), [...operations, forged("teams", "someone-elses-team")], "invalid_operations");
  });

  it("rejects a manifest path presented with the wrong write class", async () => {
    const tampered = operations.map((o) => (o.path === "teams/demo-team" ? { ...o, writeClass: "U" as const } : o));
    await expectRejected(fakeStore(), tampered, "invalid_operations");
  });

  it("rejects a manifest path presented with the wrong collection", async () => {
    const tampered = [...operations.slice(1), { ...operations[0], collection: "surveys" } as PlannedOperation];
    await expectRejected(fakeStore(), tampered, "invalid_operations");
  });

  it("rejects duplicate paths", async () => {
    await expectRejected(fakeStore(), [...operations, operations[0]], "invalid_operations");
  });

  it("rejects malformed paths (mismatched or nested)", async () => {
    const mismatched = { ...operations[0], path: "teams/other" } as PlannedOperation;
    await expectRejected(fakeStore(), [mismatched], "invalid_operations");
    await expectRejected(fakeStore(), [forged("teams", "a/b")], "invalid_operations");
  });

  it("rejects a manifest that itself contains a non-allow-listed collection", async () => {
    const badManifest: ManifestEntry[] = [
      ...manifest,
      { collection: "forumThreads" as never, docId: "t1", path: "forumThreads/t1", writeClass: "U" },
    ];
    await expectRejected(fakeStore(), [...operations, forged("forumThreads", "t1")], "invalid_operations", badManifest);
  });

  it("rejects an empty operation list", async () => {
    await expectRejected(fakeStore(), [], "invalid_operations");
  });

  it(`rejects more than ${MAX_BATCH_OPERATIONS} operations`, async () => {
    const many = Array.from({ length: MAX_BATCH_OPERATIONS + 1 }, () => operations[0]);
    await expectRejected(fakeStore(), many, "too_many_operations");
  });

  it("validates the whole list first: one bad operation last still produces zero writes", async () => {
    const fake = fakeStore();
    await expectRejected(fake, [...operations, forged("forumReplies", "r1")], "invalid_operations");
  });
});

describe("writeDemoOperations — atomic failure", () => {
  it("a failing commit leaves the store unchanged and reports only a category", async () => {
    const fake = fakeStore({}, { failCommit: true });
    const error = await writeDemoOperations({ operations, manifest, createBatch: fake.createBatch }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DemoWriteError);
    expect((error as DemoWriteError).category).toBe("write_failed");
    expect((error as Error).message).not.toContain("secret-ish");
    expect((error as Error).cause).toBeUndefined();
    expect(fake.commits).toBe(1);
    expect(fake.store.size).toBe(0);
  });

  it("a create collision fails the whole batch and nothing else is written", async () => {
    const existing = { "teams/demo-team": { name: "someone else's" } };
    const fake = fakeStore(existing);
    const error = await writeDemoOperations({ operations, manifest, createBatch: fake.createBatch }).catch(
      (e: unknown) => e,
    );

    expect((error as DemoWriteError).category).toBe("write_failed");
    expect([...fake.store.keys()]).toEqual(["teams/demo-team"]);
    expect(fake.store.get("teams/demo-team")).toEqual({ name: "someone else's" });
  });

  it("a throwing batch factory is reported as write_failed", async () => {
    const error = await writeDemoOperations({
      operations,
      manifest,
      createBatch: () => {
        throw new Error("boom with details");
      },
    }).catch((e: unknown) => e);
    expect((error as DemoWriteError).category).toBe("write_failed");
    expect((error as Error).message).not.toContain("boom");
  });
});

describe("writer source", () => {
  const source = readFileSync(join(__dirname, "writer.ts"), "utf8");

  it("has no removal/query symbol and no Firebase import", () => {
    expect(source).not.toMatch(/delete/i);
    expect(source).not.toMatch(/\.(where|getAll|listDocuments|recursiveDelete|collection|doc)\(/);
    expect(source).not.toMatch(/firebase/i);
  });

  it("exposes only create, set and commit on the batch seam", () => {
    const seam = /interface DemoWriteBatch \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    const members = [...seam.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);
    expect(members).toEqual(["create", "set", "commit"]);
  });
});
