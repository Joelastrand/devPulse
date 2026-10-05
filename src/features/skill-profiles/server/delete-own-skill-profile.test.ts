import { describe, expect, it, vi } from "vitest";
import { deleteOwnSkillProfile, type DeleteOwnSkillProfileDeps } from "./delete-own-skill-profile";
import { createFakeSkillProfileStore } from "./fake-skill-profile-store";
import { getOwnSkills } from "./get-own-skills";
import { setOwnSkillLevel } from "./set-own-skill-level";

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

function setup(profiles: Record<string, Record<string, unknown>> = {}, skillTrees: Record<string, unknown> = {}) {
  const fake = createFakeSkillProfileStore(profiles, skillTrees);
  const deps = (uid = "user-1", extra: Record<string, unknown> = {}): DeleteOwnSkillProfileDeps => ({
    verifyToken: vi.fn().mockResolvedValue({ uid, email: `${uid}@example.com`, email_verified: true, ...extra }),
    store: fake.store,
  });
  return { ...fake, deps };
}

describe("deleteOwnSkillProfile", () => {
  it("returns unauthenticated for an invalid token and deletes nothing", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } });
    const result = await deleteOwnSkillProfile("t", {
      ...s.deps(),
      verifyToken: vi.fn().mockRejectedValue(new Error("bad")),
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(s.deletes).toEqual([]);
    expect(s.docs.has("user-1")).toBe(true);
  });

  it("physically removes the whole document, including timestamps and unknown fields", async () => {
    const s = setup({
      "user-1": { levels: { ts: 2, go: 3 }, createdAt: EARLIER, updatedAt: EARLIER, future: "x" },
    });
    const result = await deleteOwnSkillProfile("t", s.deps());
    expect(result).toEqual({ ok: true });
    // Absent, not emptied.
    expect(s.docs.has("user-1")).toBe(false);
    expect(await s.store.read("user-1")).toBeUndefined();
  });

  it("deletes only the verified uid's document, leaving other people's profiles intact", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } }, "user-2": { levels: { ts: 4 } } });
    await deleteOwnSkillProfile("t", s.deps("user-1"));
    expect(s.deletes).toEqual(["user-1"]);
    expect(s.docs.get("user-2")).toEqual({ levels: { ts: 4 } });
  });

  it("succeeds for an absent document without creating one or writing", async () => {
    const s = setup();
    const result = await deleteOwnSkillProfile("t", s.deps());
    expect(result).toEqual({ ok: true });
    expect(s.docs.size).toBe(0);
    expect(s.writes).toEqual([]);
  });

  it("is idempotent on repeat", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } });
    expect(await deleteOwnSkillProfile("t", s.deps())).toEqual({ ok: true });
    expect(await deleteOwnSkillProfile("t", s.deps())).toEqual({ ok: true });
    expect(s.docs.size).toBe(0);
  });

  it.each([[null], [[]], ["bad"], [42]])(
    "recovers an unreadable profile (levels: %j) without a profile_unreadable error",
    async (levels) => {
      const s = setup({ "user-1": { levels, createdAt: "bad", future: 1 } });
      const result = await deleteOwnSkillProfile("t", s.deps());
      expect(result).toEqual({ ok: true });
      expect(s.docs.has("user-1")).toBe(false);
    },
  );

  it("deletes a profile with broken timestamps without repairing or writing anything first", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 }, createdAt: "bad", updatedAt: 7 } });
    await deleteOwnSkillProfile("t", s.deps());
    expect(s.writes).toEqual([]);
    expect(s.docs.has("user-1")).toBe(false);
  });

  it("never reads the profile, so no interpretation or transaction is involved", async () => {
    const s = setup({ "user-1": { levels: null } });
    const read = vi.spyOn(s.store, "read");
    const runTransaction = vi.spyOn(s.store, "runTransaction");
    await deleteOwnSkillProfile("t", s.deps());
    expect(read).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
    expect(s.treeReads).toEqual([]);
  });

  it("works with emailVerified:false", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } });
    const result = await deleteOwnSkillProfile("t", s.deps("user-1", { email_verified: false }));
    expect(result).toEqual({ ok: true });
    expect(s.docs.has("user-1")).toBe(false);
  });

  it("maps a store failure to persistence_failed without leaking the error", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } });
    const store = {
      ...s.store,
      delete: vi.fn().mockRejectedValue(new Error("secret skillProfiles/user-1 path")),
    };
    const result = await deleteOwnSkillProfile("t", { ...s.deps(), store });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("lets a following GET see an ok empty profile and a following PUT recreate with a fresh createdAt", async () => {
    const tree = {
      name: "TypeScript",
      nodes: [
        { nodeId: "node-0", label: "A", order: 0 },
        { nodeId: "node-1", label: "B", order: 1 },
      ],
      createdAt: EARLIER,
      createdBy: "admin-uid",
    };
    const s = setup({ "user-1": { levels: null, createdAt: EARLIER } }, { ts: tree });
    const catalogReader = { listOrderedByCreatedAt: vi.fn().mockResolvedValue([{ id: "ts", data: tree }]) };
    const unreadable = await getOwnSkills("t", { ...s.deps(), catalogReader });
    expect(unreadable.ok && unreadable.dto.profile).toBe("unreadable");

    await deleteOwnSkillProfile("t", s.deps());

    const recovered = await getOwnSkills("t", { ...s.deps(), catalogReader });
    expect(recovered).toEqual({
      ok: true,
      dto: { skills: [{ treeId: "ts", name: "TypeScript", level: null }], truncated: false, profile: "ok" },
    });

    const put = await setOwnSkillLevel("t", "ts", { level: 2 }, { ...s.deps(), now: () => NOW });
    expect(put).toEqual({ ok: true, level: 2 });
    expect(s.docs.get("user-1")).toEqual({ levels: { ts: 2 }, createdAt: NOW, updatedAt: NOW });
  });

  it("is distinct from DELETE-one: the document is gone, not merely emptied", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } });
    await deleteOwnSkillProfile("t", s.deps());
    expect(s.docs.get("user-1")).not.toEqual({ levels: {} });
    expect(s.docs.has("user-1")).toBe(false);
  });
});
