import { describe, expect, it, vi } from "vitest";
import { clearOwnSkillLevel, type ClearOwnSkillLevelDeps } from "./clear-own-skill-level";
import { createFakeSkillProfileStore } from "./fake-skill-profile-store";
import type { SkillProfileStore } from "./skill-profile-store";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-01T12:00:00Z");
const EARLIER = new Date("2026-01-01T00:00:00Z");

function setup(profiles: Record<string, Record<string, unknown>> = {}) {
  const fake = createFakeSkillProfileStore(profiles);
  const deps = (uid = "user-1", extra: Record<string, unknown> = {}): ClearOwnSkillLevelDeps => ({
    verifyToken: vi.fn().mockResolvedValue({ uid, email: `${uid}@example.com`, email_verified: true, ...extra }),
    store: fake.store,
    now: () => NOW,
  });
  return { ...fake, deps };
}

describe("clearOwnSkillLevel", () => {
  it("returns unauthenticated for an invalid token and touches nothing", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } });
    const result = await clearOwnSkillLevel("t", "ts", {
      ...s.deps(),
      verifyToken: vi.fn().mockRejectedValue(new Error("bad")),
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(s.writes).toEqual([]);
  });

  it("removes only the target key, preserves other keys/unknown fields, sets updatedAt and keeps a valid createdAt", async () => {
    const s = setup({ "user-1": { levels: { ts: 2, go: 3 }, createdAt: EARLIER, updatedAt: EARLIER, future: "kept" } });
    const result = await clearOwnSkillLevel("t", "ts", s.deps());
    expect(result).toEqual({ ok: true, level: null });
    expect(s.docs.get("user-1")).toEqual({ levels: { go: 3 }, createdAt: EARLIER, updatedAt: NOW, future: "kept" });
  });

  it("keeps the document with empty levels when the last key is removed", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 }, createdAt: EARLIER } });
    await clearOwnSkillLevel("t", "ts", s.deps());
    expect(s.docs.get("user-1")).toEqual({ levels: {}, createdAt: EARLIER, updatedAt: NOW });
  });

  it("repairs a missing or invalid createdAt when it removes a key", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 }, createdAt: "bad" } });
    await clearOwnSkillLevel("t", "ts", s.deps());
    expect(s.docs.get("user-1")).toEqual({ levels: {}, createdAt: NOW, updatedAt: NOW });
  });

  it("removes a stored key even when its value is invalid (stale/hidden entry)", async () => {
    const s = setup({ "user-1": { levels: { gone: 9, go: 1 }, createdAt: EARLIER } });
    await clearOwnSkillLevel("t", "gone", s.deps());
    expect(s.docs.get("user-1")?.levels).toEqual({ go: 1 });
  });

  it("does not look up the tree (works for unavailable trees)", async () => {
    const s = setup({ "user-1": { levels: { gone: 2 } } });
    await clearOwnSkillLevel("t", "gone", s.deps());
    expect(s.treeReads).toEqual([]);
  });

  it("is a no-write success when the key is absent, even with broken timestamps", async () => {
    const s = setup({ "user-1": { levels: { go: 1 }, createdAt: "bad", updatedAt: null } });
    const result = await clearOwnSkillLevel("t", "ts", s.deps());
    expect(result).toEqual({ ok: true, level: null });
    expect(s.writes).toEqual([]);
    expect(s.docs.get("user-1")).toEqual({ levels: { go: 1 }, createdAt: "bad", updatedAt: null });
  });

  it("is a no-write success when levels is missing", async () => {
    const s = setup({ "user-1": { createdAt: EARLIER } });
    expect(await clearOwnSkillLevel("t", "ts", s.deps())).toEqual({ ok: true, level: null });
    expect(s.writes).toEqual([]);
  });

  it("is a no-write success and creates no profile when the document is absent", async () => {
    const s = setup();
    expect(await clearOwnSkillLevel("t", "ts", s.deps())).toEqual({ ok: true, level: null });
    expect(s.writes).toEqual([]);
    expect(s.docs.has("user-1")).toBe(false);
  });

  it("is idempotent on repeat: the second call writes nothing", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 }, createdAt: EARLIER } });
    await clearOwnSkillLevel("t", "ts", s.deps());
    await clearOwnSkillLevel("t", "ts", s.deps());
    expect(s.writes).toHaveLength(1);
  });

  it("does not match inherited property names as present keys", async () => {
    const s = setup({ "user-1": { levels: { go: 1 } } });
    await clearOwnSkillLevel("t", "constructor", s.deps());
    expect(s.writes).toEqual([]);
  });

  it.each([["null", null], ["array", []], ["string", "x"]])(
    "rejects with profile_unreadable and writes nothing when levels is %s",
    async (_label, levels) => {
      const s = setup({ "user-1": { levels } });
      expect(await clearOwnSkillLevel("t", "ts", s.deps())).toEqual({ ok: false, error: "profile_unreadable" });
      expect(s.writes).toEqual([]);
      expect(s.docs.get("user-1")).toEqual({ levels });
    },
  );

  it.each([["slash", "a/b"], ["empty", ""], ["too long", "a".repeat(129)], ["space", "a b"]])(
    "returns skill_unavailable for a malformed id (%s)",
    async (_label, treeId) => {
      const s = setup({ "user-1": { levels: { ts: 2 } } });
      expect(await clearOwnSkillLevel("t", treeId, s.deps())).toEqual({ ok: false, error: "skill_unavailable" });
      expect(s.writes).toEqual([]);
    },
  );

  it("touches only the verified uid's document with emailVerified false", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } }, "user-2": { levels: { ts: 3 } } });
    const result = await clearOwnSkillLevel("t", "ts", s.deps("user-2", { email_verified: false }));
    expect(result.ok).toBe(true);
    expect(s.writes.map((w) => w.uid)).toEqual(["user-2"]);
    expect(s.docs.get("user-1")).toEqual({ levels: { ts: 2 } });
  });

  it("maps a store failure to persistence_failed without leaking the message", async () => {
    const store: SkillProfileStore = {
      read: vi.fn(),
      delete: vi.fn(),
      runTransaction: vi.fn().mockRejectedValue(new Error("secret firestore internals")),
    };
    const result = await clearOwnSkillLevel("t", "ts", { ...setup().deps(), store });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
