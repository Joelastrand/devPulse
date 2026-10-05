import { describe, expect, it, vi } from "vitest";
import { getOwnSkills, type GetOwnSkillsDeps } from "./get-own-skills";
import type { RawCatalogDoc, SkillCatalogReader } from "./skill-catalog";
import type { SkillProfileStore } from "./skill-profile-store";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

function verifyTokenFor(uid: string, extra: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({ uid, email: `${uid}@example.com`, email_verified: true, ...extra });
}

const when = new Date("2026-01-01T00:00:00Z");

function tree(id: string, name: string): RawCatalogDoc {
  return {
    id,
    data: {
      name,
      nodes: [
        { nodeId: "node-0", label: "Stage A", order: 0 },
        { nodeId: "node-1", label: "Stage B", order: 1 },
      ],
      createdAt: when,
      createdBy: "admin-uid",
    },
  };
}

function setup(profiles: Record<string, Record<string, unknown>> = {}, trees: RawCatalogDoc[] = []) {
  const read = vi.fn(async (uid: string) => profiles[uid]);
  // The seam's mutation entry points (transactional writes and whole-profile delete); GET must never call them.
  const writeSpies = { runTransaction: vi.fn(), delete: vi.fn() };
  const store = { read, ...writeSpies } as unknown as SkillProfileStore;
  const listOrderedByCreatedAt = vi.fn(async (limit: number) => trees.slice(0, limit));
  const catalogReader: SkillCatalogReader = { listOrderedByCreatedAt };
  const deps = (uid = "user-1"): GetOwnSkillsDeps => ({ verifyToken: verifyTokenFor(uid), store, catalogReader });
  const noWrites = () => Object.values(writeSpies).every((spy) => spy.mock.calls.length === 0);
  return { read, noWrites, listOrderedByCreatedAt, deps };
}

const TREES = [tree("ts", "TypeScript"), tree("go", "Go")];

describe("getOwnSkills", () => {
  it("returns unauthenticated for an invalid or empty token and reads nothing", async () => {
    const s = setup({}, TREES);

    const bad = await getOwnSkills("token", {
      ...s.deps(),
      verifyToken: vi.fn().mockRejectedValue(new Error("bad")),
    });
    const empty = await getOwnSkills("", s.deps());

    expect(bad).toEqual({ ok: false, error: "unauthenticated" });
    expect(empty).toEqual({ ok: false, error: "unauthenticated" });
    expect(s.read).not.toHaveBeenCalled();
    expect(s.listOrderedByCreatedAt).not.toHaveBeenCalled();
  });

  it("returns the caller's own levels sorted by name with profile ok", async () => {
    const s = setup({ "user-1": { levels: { ts: 3, go: 1 }, createdAt: when, updatedAt: when } }, TREES);

    const result = await getOwnSkills("token", s.deps());

    expect(result).toEqual({
      ok: true,
      dto: {
        skills: [
          { treeId: "go", name: "Go", level: 1 },
          { treeId: "ts", name: "TypeScript", level: 3 },
        ],
        truncated: false,
        profile: "ok",
      },
    });
  });

  it("reads only the verified uid's document; no other subject is reachable", async () => {
    const s = setup({ "user-1": { levels: { ts: 3 } }, "user-2": { levels: { ts: 4 } } }, TREES);

    await getOwnSkills("token", s.deps("user-2"));

    expect(s.read).toHaveBeenCalledTimes(1);
    expect(s.read).toHaveBeenCalledWith("user-2");
  });

  it("does not require emailVerified", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 } } }, TREES);

    const result = await getOwnSkills("token", {
      ...s.deps(),
      verifyToken: verifyTokenFor("user-1", { email_verified: false }),
    });

    expect(result.ok).toBe(true);
  });

  it("gives every identity (admin/lead-like included) only their own levels", async () => {
    const profiles = { "admin-1": { levels: { ts: 4 } }, "lead-1": { levels: { go: 2 } } };
    const s = setup(profiles, TREES);

    const admin = await getOwnSkills("token", s.deps("admin-1"));
    const lead = await getOwnSkills("token", s.deps("lead-1"));

    expect(admin.ok && admin.dto.skills.map((r) => r.level)).toEqual([null, 4]);
    expect(lead.ok && lead.dto.skills.map((r) => r.level)).toEqual([2, null]);
  });

  it("treats an absent document as an empty ok profile and does not create it", async () => {
    const s = setup({}, TREES);

    const result = await getOwnSkills("token", s.deps());

    expect(result).toEqual({
      ok: true,
      dto: {
        skills: [
          { treeId: "go", name: "Go", level: null },
          { treeId: "ts", name: "TypeScript", level: null },
        ],
        truncated: false,
        profile: "ok",
      },
    });
    expect(s.noWrites()).toBe(true);
  });

  it("treats a missing levels field as empty and readable", async () => {
    const s = setup({ "user-1": { createdAt: when, updatedAt: when } }, TREES);

    const result = await getOwnSkills("token", s.deps());

    expect(result.ok && result.dto.profile).toBe("ok");
    expect(result.ok && result.dto.skills.every((r) => r.level === null)).toBe(true);
  });

  it.each([
    ["null", null],
    ["array", [1, 2]],
    ["string", "x"],
    ["number", 5],
  ])("reports an unreadable profile with every level null when levels is %s", async (_label, levels) => {
    const s = setup({ "user-1": { levels } }, TREES);

    const result = await getOwnSkills("token", s.deps());

    expect(result).toEqual({
      ok: true,
      dto: {
        skills: [
          { treeId: "go", name: "Go", level: null },
          { treeId: "ts", name: "TypeScript", level: null },
        ],
        truncated: false,
        profile: "unreadable",
      },
    });
    expect(s.noWrites()).toBe(true);
  });

  it("ignores invalid individual values and keys for unlisted trees", async () => {
    const s = setup({ "user-1": { levels: { ts: 0, go: "3", gone: 4, py: 2.5, nul: null, five: 5 } } }, [
      ...TREES,
      tree("py", "Python"),
    ]);

    const result = await getOwnSkills("token", s.deps());

    expect(result.ok && result.dto.skills.every((r) => r.level === null)).toBe(true);
    expect(result.ok && result.dto.skills.map((r) => r.treeId)).toEqual(["go", "py", "ts"]);
  });

  it.each([
    ["missing", {}],
    ["invalid values", { createdAt: "nope", updatedAt: 7 }],
    ["null", { createdAt: null, updatedAt: null }],
  ])("is independent of timestamps (%s) and returns none", async (_label, stamps) => {
    const s = setup({ "user-1": { levels: { ts: 4 }, ...stamps } }, TREES);

    const result = await getOwnSkills("token", s.deps());

    expect(result.ok && result.dto.skills.find((r) => r.treeId === "ts")?.level).toBe(4);
    const json = JSON.stringify(result);
    expect(json).not.toContain("createdAt");
    expect(json).not.toContain("updatedAt");
    expect(s.noWrites()).toBe(true);
  });

  it("never leaks unknown top-level fields, nodes, creator, uid or timestamps; exact DTO key set", async () => {
    const s = setup(
      { "user-1": { levels: { ts: 2 }, createdAt: when, updatedAt: when, secretNote: "private", email: "x@y.z" } },
      TREES,
    );

    const result = await getOwnSkills("token", s.deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.dto).sort()).toEqual(["profile", "skills", "truncated"]);
    for (const row of result.dto.skills) expect(Object.keys(row).sort()).toEqual(["level", "name", "treeId"]);
    const json = JSON.stringify(result);
    for (const forbidden of ["secretNote", "private", "nodes", "Stage A", "admin-uid", "user-1", "x@y.z"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("performs no writes of any kind, including with broken timestamps", async () => {
    const s = setup({ "user-1": { levels: { ts: 2 }, createdAt: "bad", updatedAt: null } }, TREES);

    await getOwnSkills("token", s.deps());

    expect(s.noWrites()).toBe(true);
  });

  it("reflects the catalog truncation probe in the DTO with one catalog query", async () => {
    const many = Array.from({ length: 501 }, (_, i) => tree(`t${String(i).padStart(3, "0")}`, `S${i}`));
    const s = setup({}, many);

    const result = await getOwnSkills("token", s.deps());

    expect(result.ok && result.dto.truncated).toBe(true);
    expect(result.ok && result.dto.skills).toHaveLength(500);
    expect(s.listOrderedByCreatedAt).toHaveBeenCalledTimes(1);
  });

  it("issues the profile read and the catalog query before either resolves", async () => {
    const order: string[] = [];
    let releaseProfile!: () => void;
    let releaseCatalog!: () => void;
    const store = {
      read: vi.fn(() => {
        order.push("profile-start");
        return new Promise<undefined>((resolve) => {
          releaseProfile = () => resolve(undefined);
        });
      }),
    } as unknown as SkillProfileStore;
    const catalogReader: SkillCatalogReader = {
      listOrderedByCreatedAt: vi.fn(() => {
        order.push("catalog-start");
        return new Promise<RawCatalogDoc[]>((resolve) => {
          releaseCatalog = () => resolve([]);
        });
      }),
    };

    const pending = getOwnSkills("token", { verifyToken: verifyTokenFor("user-1"), store, catalogReader });
    await vi.waitFor(() => expect(order).toEqual(["profile-start", "catalog-start"]));
    releaseProfile();
    releaseCatalog();

    expect((await pending).ok).toBe(true);
  });

  it("maps a profile read failure to persistence_failed", async () => {
    const s = setup({}, TREES);
    s.read.mockRejectedValueOnce(new Error("secret internal"));

    expect(await getOwnSkills("token", s.deps())).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a catalog read failure to persistence_failed", async () => {
    const s = setup({}, TREES);
    s.listOrderedByCreatedAt.mockRejectedValueOnce(new Error("boom"));

    expect(await getOwnSkills("token", s.deps())).toEqual({ ok: false, error: "persistence_failed" });
  });
});
