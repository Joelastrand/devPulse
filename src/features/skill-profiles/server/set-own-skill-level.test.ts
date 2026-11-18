import { describe, expect, it, vi } from "vitest";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { seedSkillLevelsCreateOnly } from "./skill-profile-store";
import { createFakeSkillProfileStore } from "./fake-skill-profile-store";
import { setOwnSkillLevel, type SetOwnSkillLevelDeps } from "./set-own-skill-level";
import type { SkillProfileStore } from "./skill-profile-store";
import { registerClaims } from "../../../../test/auth-fixtures";

const { testAdminAuth } = await vi.hoisted(async () => await import("../../../../test/auth-fixtures"));
/** Set only by the trusted-seed fence test below. Unset, any Firestore use still throws (the original guarantee). */
const dbHolder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => testAdminAuth,
  getFirestoreDb: () => {
    if (dbHolder.db === undefined) throw new Error("unexpected Firestore use");
    return dbHolder.db;
  },
}));

const NOW = new Date("2026-06-01T12:00:00Z");
const EARLIER = new Date("2026-01-01T00:00:00Z");

function validTree(name = "TypeScript") {
  return {
    name,
    nodes: [
      { nodeId: "node-0", label: "Stage A", order: 0 },
      { nodeId: "node-1", label: "Stage B", order: 1 },
    ],
    createdAt: EARLIER,
    createdBy: "admin-uid",
  };
}

function setup(profiles: Record<string, Record<string, unknown>> = {}, trees: Record<string, unknown> = { ts: validTree() }) {
  const fake = createFakeSkillProfileStore(profiles, trees);
  const deps = (uid = "user-1", extra: Record<string, unknown> = {}): SetOwnSkillLevelDeps => ({
    verifyToken: vi.fn().mockImplementation(async () => registerClaims({ uid, email: `${uid}@nve.no`, email_verified: true, ...extra })),
    store: fake.store,
    now: () => NOW,
  });
  return { ...fake, deps };
}

describe("trusted skill-level seed — erasure fence (create-only, feature-owned)", () => {
  it.each([
    ["a valid in-progress record", { status: "in_progress" }],
    ["a malformed record", "not-a-record"],
  ])("refuses with %s as ErasureWriteRefused, reads only the fence and creates nothing", async (_label, erasure) => {
    const reads: string[] = [];
    const creates: string[] = [];
    dbHolder.db = {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
      runTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          get: async (ref: { path: string }) => {
            reads.push(ref.path);
            return { exists: ref.path.startsWith("accountErasures/"), data: () => erasure };
          },
          create: (ref: { path: string }) => creates.push(ref.path),
          set: () => undefined,
          update: () => undefined,
          delete: () => undefined,
        }),
    };
    try {
      await expect(seedSkillLevelsCreateOnly("user-1", [{ treeId: "demo-skill-typescript", level: 4 }], { createdAt: NOW, updatedAt: NOW })).rejects.toBeInstanceOf(
        ErasureWriteRefused,
      );
      expect(reads).toEqual(["accountErasures/user-1"]);
      expect(creates).toEqual([]);
    } finally {
      dbHolder.db = undefined;
    }
  });
});

describe("setOwnSkillLevel", () => {
  it("returns unauthenticated for an invalid token and touches nothing", async () => {
    const s = setup();
    const result = await setOwnSkillLevel("t", "ts", { level: 2 }, {
      ...s.deps(),
      verifyToken: vi.fn().mockRejectedValue(new Error("bad")),
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(s.writes).toEqual([]);
    expect(s.treeReads).toEqual([]);
  });

  it.each([1, 2, 3, 4] as const)("creates the profile with createdAt = updatedAt = now for level %i", async (level) => {
    const s = setup();
    const result = await setOwnSkillLevel("t", "ts", { level }, s.deps());
    expect(result).toEqual({ ok: true, level });
    expect(s.docs.get("user-1")).toEqual({ levels: { ts: level }, createdAt: NOW, updatedAt: NOW });
  });

  it("refuses an unverified-email caller and writes nothing, even to another person's document", async () => {
    const s = setup({ "user-2": { levels: { ts: 4 } } });
    const result = await setOwnSkillLevel("t", "ts", { level: 1 }, s.deps("user-1", { email_verified: false }));
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(s.writes).toEqual([]);
    expect(s.docs.get("user-2")).toEqual({ levels: { ts: 4 } });
  });

  it("changes the level, replacing the old value without history, and preserves other keys and unknown fields", async () => {
    const s = setup({
      "user-1": { levels: { ts: 1, go: 3 }, createdAt: EARLIER, updatedAt: EARLIER, futureField: { a: 1 } },
    });
    await setOwnSkillLevel("t", "ts", { level: 4 }, s.deps());
    expect(s.docs.get("user-1")).toEqual({
      levels: { ts: 4, go: 3 },
      createdAt: EARLIER,
      updatedAt: NOW,
      futureField: { a: 1 },
    });
  });

  it("is idempotent for the same level", async () => {
    const s = setup();
    await setOwnSkillLevel("t", "ts", { level: 2 }, s.deps());
    const result = await setOwnSkillLevel("t", "ts", { level: 2 }, s.deps());
    expect(result).toEqual({ ok: true, level: 2 });
    expect(s.docs.get("user-1")?.levels).toEqual({ ts: 2 });
  });

  it("treats a document without levels as empty and repairs a missing createdAt", async () => {
    const s = setup({ "user-1": { updatedAt: EARLIER, extra: true } });
    await setOwnSkillLevel("t", "ts", { level: 3 }, s.deps());
    expect(s.docs.get("user-1")).toEqual({ levels: { ts: 3 }, createdAt: NOW, updatedAt: NOW, extra: true });
  });

  it.each([
    ["string", "nope"],
    ["null", null],
    ["number", 7],
    ["invalid date", new Date("invalid")],
  ])("repairs an invalid createdAt (%s) and tolerates an invalid updatedAt", async (_label, createdAt) => {
    const s = setup({ "user-1": { levels: { go: 1 }, createdAt, updatedAt: "bad" } });
    await setOwnSkillLevel("t", "ts", { level: 3 }, s.deps());
    expect(s.docs.get("user-1")).toEqual({ levels: { go: 1, ts: 3 }, createdAt: NOW, updatedAt: NOW });
  });

  it("preserves a valid Timestamp-like createdAt", async () => {
    const stamp = { toDate: () => EARLIER };
    const s = setup({ "user-1": { levels: {}, createdAt: stamp } });
    const store = s.store;
    await setOwnSkillLevel("t", "ts", { level: 2 }, { ...s.deps(), store });
    expect(s.docs.get("user-1")?.createdAt).toEqual(stamp);
  });

  it("overwrites an invalid stored entry with a valid level", async () => {
    const s = setup({ "user-1": { levels: { ts: "3", go: 2 }, createdAt: EARLIER } });
    await setOwnSkillLevel("t", "ts", { level: 1 }, s.deps());
    expect(s.docs.get("user-1")?.levels).toEqual({ ts: 1, go: 2 });
  });

  it.each([
    ["null", null],
    ["array", [1]],
    ["string", "x"],
    ["number", 5],
  ])("rejects with profile_unreadable and writes nothing when levels is %s", async (_label, levels) => {
    const s = setup({ "user-1": { levels, createdAt: EARLIER } });
    const result = await setOwnSkillLevel("t", "ts", { level: 2 }, s.deps());
    expect(result).toEqual({ ok: false, error: "profile_unreadable" });
    expect(s.writes).toEqual([]);
    expect(s.docs.get("user-1")).toEqual({ levels, createdAt: EARLIER });
  });

  it.each([
    ["non-existent tree", "missing"],
    ["malformed id (slash)", "a/b"],
    ["malformed id (empty)", ""],
    ["malformed id (129 chars)", "a".repeat(129)],
  ])("returns skill_unavailable and writes nothing for %s", async (_label, treeId) => {
    const s = setup();
    const result = await setOwnSkillLevel("t", treeId, { level: 2 }, s.deps());
    expect(result).toEqual({ ok: false, error: "skill_unavailable" });
    expect(s.writes).toEqual([]);
    expect(s.docs.has("user-1")).toBe(false);
  });

  it("returns skill_unavailable for an invalid existing tree document", async () => {
    const s = setup({}, { bad: { name: "", nodes: [] } });
    const result = await setOwnSkillLevel("t", "bad", { level: 2 }, s.deps());
    expect(result).toEqual({ ok: false, error: "skill_unavailable" });
    expect(s.writes).toEqual([]);
  });

  it("case (f): succeeds for a valid tree known only by id, validating its own document and never the catalog", async () => {
    // 600 trees exist; "t599" would be beyond the first-500 catalog window and is only reachable by id.
    const trees = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`t${i}`, validTree(`S${i}`)]));
    const s = setup({}, trees);
    const result = await setOwnSkillLevel("t", "t599", { level: 3 }, s.deps());
    expect(result).toEqual({ ok: true, level: 3 });
    expect(s.treeReads).toEqual(["t599"]);
    expect(s.docs.get("user-1")?.levels).toEqual({ t599: 3 });
  });

  it.each([
    ["empty object", {}],
    ["level 0", { level: 0 }],
    ["level 5", { level: 5 }],
    ["negative", { level: -1 }],
    ["fraction", { level: 2.5 }],
    ["numeric string", { level: "3" }],
    ["null", { level: null }],
    ["boolean", { level: true }],
    ["object", { level: {} }],
    ["array level", { level: [1] }],
    ["extra key", { level: 1, extra: 1 }],
    ["array body", []],
  ])("rejects %s with invalid_input and writes nothing", async (_label, body) => {
    const s = setup();
    const result = await setOwnSkillLevel("t", "ts", body, s.deps());
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(s.writes).toEqual([]);
    expect(s.treeReads).toEqual([]);
  });

  it.each([["string", "x"], ["number", 3], ["null", null], ["undefined (missing/malformed)", undefined]])(
    "rejects a %s body with invalid_request",
    async (_label, body) => {
      const s = setup();
      expect(await setOwnSkillLevel("t", "ts", body, s.deps())).toEqual({ ok: false, error: "invalid_request" });
      expect(s.writes).toEqual([]);
    },
  );

  it("concurrent writes to different keys both survive (per-key merge, no whole-map replace)", async () => {
    const s = setup({ "user-1": { levels: { go: 1 }, createdAt: EARLIER } }, { ts: validTree(), py: validTree("Python") });
    const [a, b] = await Promise.all([
      setOwnSkillLevel("t", "ts", { level: 2 }, s.deps()),
      setOwnSkillLevel("t", "py", { level: 4 }, s.deps()),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(s.docs.get("user-1")?.levels).toEqual({ go: 1, ts: 2, py: 4 });
  });

  it("same-key concurrent writes are last-write-wins", async () => {
    const s = setup();
    await Promise.all([
      setOwnSkillLevel("t", "ts", { level: 1 }, s.deps()),
      setOwnSkillLevel("t", "ts", { level: 4 }, s.deps()),
    ]);
    expect(s.docs.get("user-1")?.levels).toEqual({ ts: 4 });
  });

  it("maps any store failure to persistence_failed without leaking the message", async () => {
    const store: SkillProfileStore = {
      read: vi.fn(),
      delete: vi.fn(),
      runTransaction: vi.fn().mockRejectedValue(new Error("secret firestore internals")),
    };
    const result = await setOwnSkillLevel("t", "ts", { level: 2 }, { ...setup().deps(), store });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns exactly { ok, level } with no internal fields", async () => {
    const s = setup({ "user-1": { levels: {}, secret: "x" } });
    const result = await setOwnSkillLevel("t", "ts", { level: 2 }, s.deps());
    expect(Object.keys(result).sort()).toEqual(["level", "ok"]);
  });
});
