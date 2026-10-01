import { describe, expect, it, vi } from "vitest";
import { deleteOwnProfile } from "./delete-own-profile";
import { getOwnProfile } from "./get-own-profile";
import { setOwnProfile } from "./set-own-profile";
import type { UserProfileStore } from "./user-profile-store";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const EMAIL = "anna.berg@example.com";

function verifyTokenFor(uid: string) {
  return vi.fn().mockResolvedValue({ uid, email: EMAIL, email_verified: true });
}

const rejectingVerifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

/** In-memory `UserProfileStore` keyed by `uid`, recording every call. */
function fakeStore(initial: Record<string, unknown> = {}) {
  const docs = new Map<string, unknown>(Object.entries(initial));
  const calls: Array<{ op: "read" | "upsert" | "remove"; uid: string }> = [];
  const store: UserProfileStore = {
    async read(uid) {
      calls.push({ op: "read", uid });
      return docs.get(uid);
    },
    async upsert(uid, build) {
      calls.push({ op: "upsert", uid });
      docs.set(uid, build(docs.get(uid)));
    },
    async remove(uid) {
      calls.push({ op: "remove", uid });
      docs.delete(uid);
    },
  };
  return { store, docs, calls };
}

const EARLIER = new Date("2026-01-01T00:00:00Z");
const LATER = new Date("2026-02-01T00:00:00Z");
const validDoc = { displayName: "Anna Berg", createdAt: EARLIER, updatedAt: EARLIER };

describe("getOwnProfile", () => {
  it("returns the caller's own display name", async () => {
    const { store } = fakeStore({ "user-1": validDoc });

    const result = await getOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: true, displayName: "Anna Berg" });
  });

  it("returns null — never e-mail or any other identity value — when no profile exists", async () => {
    const { store } = fakeStore();

    const result = await getOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: true, displayName: null });
    expect(JSON.stringify(result)).not.toContain(EMAIL);
    expect(JSON.stringify(result)).not.toContain("user-1");
  });

  it.each([
    ["wrong type", { ...validDoc, displayName: 7 }],
    ["non-canonical name", { ...validDoc, displayName: "  Anna " }],
    ["missing timestamps", { displayName: "Anna Berg" }],
  ])("treats a corrupt stored document (%s) as no profile", async (_label, doc) => {
    const { store } = fakeStore({ "user-1": doc });

    const result = await getOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: true, displayName: null });
  });

  it("reads only the document of the verified uid, never another user's", async () => {
    const { store, calls } = fakeStore({
      "user-1": validDoc,
      "user-2": { ...validDoc, displayName: "Bo Lind" },
    });

    const result = await getOwnProfile("token", { verifyToken: verifyTokenFor("user-2"), store });

    expect(result).toEqual({ ok: true, displayName: "Bo Lind" });
    expect(calls).toEqual([{ op: "read", uid: "user-2" }]);
  });

  it("rejects an invalid token without touching the store", async () => {
    const { store, calls } = fakeStore({ "user-1": validDoc });

    const result = await getOwnProfile("token", { verifyToken: rejectingVerifyToken, store });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(calls).toEqual([]);
  });

  it("rejects an empty token", async () => {
    const { store } = fakeStore();

    const result = await getOwnProfile("", { store });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("reports persistence_failed without echoing the underlying error", async () => {
    const store: UserProfileStore = {
      read: vi.fn().mockRejectedValue(new Error("secret internal detail")),
      upsert: vi.fn(),
      remove: vi.fn(),
    };

    const result = await getOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("setOwnProfile", () => {
  it("creates a profile with exactly {displayName, createdAt, updatedAt}", async () => {
    const { store, docs } = fakeStore();

    const result = await setOwnProfile("token", "Anna Berg", {
      verifyToken: verifyTokenFor("user-1"),
      store,
      now: EARLIER,
    });

    expect(result).toEqual({ ok: true, displayName: "Anna Berg" });
    expect(docs.get("user-1")).toEqual({ displayName: "Anna Berg", createdAt: EARLIER, updatedAt: EARLIER });
  });

  it("never stores e-mail, uid or any other identity value in the document", async () => {
    const { store, docs } = fakeStore();

    await setOwnProfile("token", "Anna Berg", { verifyToken: verifyTokenFor("user-1"), store, now: EARLIER });

    expect(Object.keys(docs.get("user-1") as object).sort()).toEqual(["createdAt", "displayName", "updatedAt"]);
    expect(JSON.stringify(docs.get("user-1"))).not.toContain(EMAIL);
  });

  it("updates an existing profile, preserving createdAt and advancing updatedAt", async () => {
    const { store, docs } = fakeStore({ "user-1": validDoc });

    const result = await setOwnProfile("token", "Anna B", {
      verifyToken: verifyTokenFor("user-1"),
      store,
      now: LATER,
    });

    expect(result).toEqual({ ok: true, displayName: "Anna B" });
    expect(docs.get("user-1")).toEqual({ displayName: "Anna B", createdAt: EARLIER, updatedAt: LATER });
  });

  it("replaces a corrupt existing document with a fresh createdAt", async () => {
    const { store, docs } = fakeStore({ "user-1": { displayName: 7, stray: "field" } });

    await setOwnProfile("token", "Anna Berg", { verifyToken: verifyTokenFor("user-1"), store, now: LATER });

    expect(docs.get("user-1")).toEqual({ displayName: "Anna Berg", createdAt: LATER, updatedAt: LATER });
  });

  it("stores and returns the normalised value (NFC, trimmed, collapsed)", async () => {
    const { store, docs } = fakeStore();

    const result = await setOwnProfile("token", "  Zoë   Berg  ", {
      verifyToken: verifyTokenFor("user-1"),
      store,
      now: EARLIER,
    });

    expect(result).toEqual({ ok: true, displayName: "Zoë Berg" });
    expect((docs.get("user-1") as { displayName: string }).displayName).toBe("Zoë Berg");
  });

  it("writes only the document of the verified uid, leaving another user's profile untouched", async () => {
    const { store, docs, calls } = fakeStore({ "user-2": { ...validDoc, displayName: "Bo Lind" } });

    await setOwnProfile("token", "Anna Berg", { verifyToken: verifyTokenFor("user-1"), store, now: LATER });

    expect(calls).toEqual([{ op: "upsert", uid: "user-1" }]);
    expect((docs.get("user-2") as { displayName: string }).displayName).toBe("Bo Lind");
  });

  it.each([
    ["too short", "A"],
    ["too long", "a".repeat(51)],
    ["whitespace only", "   "],
    ["an inner newline", "Anna\nBerg"],
    ["not a string", 42],
    ["undefined", undefined],
  ])("rejects an invalid displayName (%s) without writing", async (_label, value) => {
    const { store, calls } = fakeStore();

    const result = await setOwnProfile("token", value, { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(calls).toEqual([]);
  });

  it("accepts exactly 50 code points made of astral characters (not 50 UTF-16 units)", async () => {
    const { store } = fakeStore();
    const name = "\u{1d538}".repeat(50);

    const result = await setOwnProfile("token", name, { verifyToken: verifyTokenFor("user-1"), store, now: EARLIER });

    expect(result).toEqual({ ok: true, displayName: name });
  });

  it("rejects an unauthenticated caller before validating or writing anything", async () => {
    const { store, calls } = fakeStore();

    const result = await setOwnProfile("token", "A", { verifyToken: rejectingVerifyToken, store });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(calls).toEqual([]);
  });

  it("reports persistence_failed without echoing the name or the underlying error", async () => {
    const store: UserProfileStore = {
      read: vi.fn(),
      upsert: vi.fn().mockRejectedValue(new Error("secret internal detail")),
      remove: vi.fn(),
    };

    const result = await setOwnProfile("token", "Anna Berg", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("deleteOwnProfile", () => {
  it("hard-deletes the caller's own profile", async () => {
    const { store, docs } = fakeStore({ "user-1": validDoc });

    const result = await deleteOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: true });
    expect(docs.has("user-1")).toBe(false);
  });

  it("deletes only the verified uid's document", async () => {
    const { store, docs, calls } = fakeStore({
      "user-1": validDoc,
      "user-2": { ...validDoc, displayName: "Bo Lind" },
    });

    await deleteOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(calls).toEqual([{ op: "remove", uid: "user-1" }]);
    expect(docs.has("user-2")).toBe(true);
  });

  it("succeeds when no profile exists (idempotent)", async () => {
    const { store } = fakeStore();

    const first = await deleteOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });
    const second = await deleteOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });

  it("rejects an unauthenticated caller without deleting anything", async () => {
    const { store, calls } = fakeStore({ "user-1": validDoc });

    const result = await deleteOwnProfile("token", { verifyToken: rejectingVerifyToken, store });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(calls).toEqual([]);
  });

  it("reports persistence_failed on a store failure", async () => {
    const store: UserProfileStore = {
      read: vi.fn(),
      upsert: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error("secret internal detail")),
    };

    const result = await deleteOwnProfile("token", { verifyToken: verifyTokenFor("user-1"), store });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});
