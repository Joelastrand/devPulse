import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { listSystemFavorites, setSystemFavorite, type FavoriteDeps, type FavoriteStore, type FavoriteWriteTx } from "./system-favorites";
import { openFavoriteTeamId, favoriteContext, sealFavoriteContent, FAVORITE_CONTENT_FIELD } from "./system-favorites-codec";
import { verifierFor } from "../../../../test/auth-fixtures";

const { testAdminAuth } = await vi.hoisted(async () => await import("../../../../test/auth-fixtures"));
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => testAdminAuth,
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use: tests inject a store");
  },
}));

// The erasure fence is a Firestore transaction read. The fake store below does not run it, so the fence refusal is modelled
// here by mapping the refusal error the same way the real module does.
vi.mock("../../auth/server/erasure-write-fence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/server/erasure-write-fence")>();
  return {
    ...actual,
    runFencedTransaction: vi.fn(),
    writeRefusalFor: (error: unknown) => (error instanceof actual.ErasureWriteRefused ? "erasure_in_progress" : "persistence_failed"),
  };
});

const NOW = new Date("2026-06-01T09:00:00Z");
const SYSTEM_NAME = "Saksportalen";
const SYSTEM_DESCRIPTION = "Saksbehandling for innbyggere";

interface World {
  /** Team status by team id. */
  teams: Record<string, string>;
  /** Membership pairs `uid|teamId`. */
  members: Set<string>;
  /** Systems by id: the stored team id plus business content that must never be copied into a favorite. */
  systems: Record<string, { teamId: string; name: string; description: string }>;
  /** Favorite documents by owner uid, then by system id, holding exactly what the production store would hold. */
  favorites: Record<string, Record<string, Record<string, unknown>>>;
}

function world(extra: Partial<World> = {}): World {
  return {
    teams: { "team-1": "active", "team-2": "active", "team-off": "disabled" },
    members: new Set(["uid-a|team-1", "uid-b|team-1", "uid-a|team-2", "uid-a|team-off", "uid-c|team-2"]),
    systems: {
      "sys-1": { teamId: "team-1", name: SYSTEM_NAME, description: SYSTEM_DESCRIPTION },
      "sys-2": { teamId: "team-1", name: "Lønnsportalen", description: "Lønn" },
      "sys-x": { teamId: "team-2", name: "Annet teams system", description: "Ikke i team-1" },
    },
    favorites: {},
    ...extra,
  };
}

function makeStore(state: World): FavoriteStore {
  const favoritesOf = (uid: string) => (state.favorites[uid] ??= {});
  const tx = (): FavoriteWriteTx => ({
    async getMembership(uid, teamId) {
      return state.members.has(`${uid}|${teamId}`) ? { uid, teamId, memberRef: "ref" } : undefined;
    },
    async getTeamStatus(teamId) {
      return state.teams[teamId];
    },
    async getSystemTeamId(systemId) {
      return state.systems[systemId]?.teamId;
    },
    setFavorite(uid, systemId, data) {
      favoritesOf(uid)[systemId] = data;
    },
    deleteFavorite(uid, systemId) {
      delete favoritesOf(uid)[systemId];
    },
  });
  return {
    async getMembership(uid, teamId) {
      return state.members.has(`${uid}|${teamId}`) ? { uid, teamId, memberRef: "ref" } : undefined;
    },
    async getTeamStatus(teamId) {
      return state.teams[teamId];
    },
    async listFavorites(uid) {
      return Object.entries(state.favorites[uid] ?? {}).map(([id, data]) => ({ id, data }));
    },
    async runWriteTransaction(_actor, fn) {
      return fn(tx());
    },
  };
}

function deps(state: World, uid = "uid-a", extra: Partial<FavoriteDeps> = {}): FavoriteDeps {
  return {
    verifyToken: verifierFor({ uid, email: `${uid}@nve.no`, emailVerified: true }),
    store: makeStore(state),
    now: () => NOW,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("setSystemFavorite — authorization (Phase 2F.1)", () => {
  it("refuses an unauthenticated request without touching the store", async () => {
    const state = world();
    const result = await setSystemFavorite("", "team-1", "sys-1", true, deps(state));
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(state.favorites).toEqual({});
  });

  it("refuses a caller who is not a member of the team", async () => {
    const state = world();
    const result = await setSystemFavorite("token", "team-1", "sys-x", true, deps(state, "uid-c"));
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(state.favorites).toEqual({});
  });

  it("refuses a write on a disabled team even for a member", async () => {
    const state = world();
    const result = await setSystemFavorite("token", "team-off", "sys-1", true, deps(state));
    expect(result).toEqual({ ok: false, error: "team_disabled" });
  });

  it("refuses a system that belongs to another team, so no cross-team reference is stored", async () => {
    const state = world();
    const result = await setSystemFavorite("token", "team-1", "sys-x", true, deps(state));
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(state.favorites).toEqual({});
  });

  it("refuses a system id that does not exist", async () => {
    const state = world();
    const result = await setSystemFavorite("token", "team-1", "sys-missing", true, deps(state));
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it.each(["", "../sys-1", "sys 1", "x".repeat(129), "sys/1"])("refuses a malformed system id %j", async (systemId) => {
    const state = world();
    const result = await setSystemFavorite("token", "team-1", systemId, true, deps(state));
    expect(result).toEqual({ ok: false, error: "invalid_request" });
  });

  it("refuses a non-boolean desired state", async () => {
    const state = world();
    const result = await setSystemFavorite("token", "team-1", "sys-1", "yes" as unknown as boolean, deps(state));
    expect(result).toEqual({ ok: false, error: "invalid_request" });
  });

  it("refuses the write while an erasure is in progress, and stores nothing", async () => {
    const state = world();
    const refusingStore: FavoriteStore = {
      ...makeStore(state),
      async runWriteTransaction() {
        throw new ErasureWriteRefused();
      },
    };
    const result = await setSystemFavorite("token", "team-1", "sys-1", true, deps(state, "uid-a", { store: refusingStore }));
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(state.favorites).toEqual({});
  });
});

describe("setSystemFavorite — persistence (Phase 2F.1)", () => {
  it("stores a favorite under the caller's own path, keyed by the system id", async () => {
    const state = world();
    const result = await setSystemFavorite("token", "team-1", "sys-1", true, deps(state, "uid-a"));
    expect(result).toEqual({ ok: true, favorite: true });
    expect(Object.keys(state.favorites["uid-a"] ?? {})).toEqual(["sys-1"]);
    expect(state.favorites["uid-b"]).toBeUndefined();
  });

  it("stores no system name, description or other business data in the favorite document", async () => {
    const state = world();
    await setSystemFavorite("token", "team-1", "sys-1", true, deps(state, "uid-a"));
    const stored = JSON.stringify(state.favorites["uid-a"]?.["sys-1"]);
    expect(stored).not.toContain(SYSTEM_NAME);
    expect(stored).not.toContain(SYSTEM_DESCRIPTION);
    expect(stored).not.toContain("team-1");
    expect(Object.keys(state.favorites["uid-a"]?.["sys-1"] ?? {}).sort()).toEqual([FAVORITE_CONTENT_FIELD, "favoritedAt"]);
  });

  it("is idempotent: setting the same state twice leaves exactly one document", async () => {
    const state = world();
    await setSystemFavorite("token", "team-1", "sys-1", true, deps(state));
    const second = await setSystemFavorite("token", "team-1", "sys-1", true, deps(state));
    expect(second).toEqual({ ok: true, favorite: true });
    expect(Object.keys(state.favorites["uid-a"] ?? {})).toEqual(["sys-1"]);
  });

  it("removes the favorite on false, and a repeated false is a harmless no-op", async () => {
    const state = world();
    await setSystemFavorite("token", "team-1", "sys-1", true, deps(state));
    expect(await setSystemFavorite("token", "team-1", "sys-1", false, deps(state))).toEqual({ ok: true, favorite: false });
    expect(await setSystemFavorite("token", "team-1", "sys-1", false, deps(state))).toEqual({ ok: true, favorite: false });
    expect(state.favorites["uid-a"] ?? {}).toEqual({});
  });

  it("never changes another person's favorites when one person toggles a system", async () => {
    const state = world();
    await setSystemFavorite("token", "team-1", "sys-1", true, deps(state, "uid-b"));
    await setSystemFavorite("token", "team-1", "sys-1", false, deps(state, "uid-a"));
    expect(Object.keys(state.favorites["uid-b"] ?? {})).toEqual(["sys-1"]);
  });
});

describe("listSystemFavorites — isolation (Phase 2F.1)", () => {
  it("returns only the caller's own favorites in the requested team", async () => {
    const state = world();
    await setSystemFavorite("token", "team-1", "sys-1", true, deps(state, "uid-a"));
    await setSystemFavorite("token", "team-1", "sys-2", true, deps(state, "uid-b"));
    const result = await listSystemFavorites("token", "team-1", deps(state, "uid-a"));
    expect(result).toEqual({ ok: true, systemIds: ["sys-1"] });
  });

  it("refuses a read by a non-member of the team", async () => {
    const state = world();
    const result = await listSystemFavorites("token", "team-1", deps(state, "uid-c"));
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an unauthenticated read", async () => {
    const state = world();
    expect(await listSystemFavorites("", "team-1", deps(state))).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("ignores a favorite whose sealed team does not match the requested team", async () => {
    const state = world();
    // A record sealed for team-2 under the caller's own path: it must not appear in team-1's favorites.
    state.favorites["uid-a"] = {
      "sys-1": {
        [FAVORITE_CONTENT_FIELD]: sealFavoriteContent("uid-a", "sys-1", "team-2"),
        favoritedAt: NOW,
      },
    };
    expect(await listSystemFavorites("token", "team-1", deps(state, "uid-a"))).toEqual({ ok: true, systemIds: [] });
  });

  it("skips a record copied from another owner's path, because the seal is bound to the owner and system", async () => {
    const state = world();
    const sealedForB = sealFavoriteContent("uid-b", "sys-1", "team-1");
    state.favorites["uid-a"] = { "sys-1": { [FAVORITE_CONTENT_FIELD]: sealedForB, favoritedAt: NOW } };
    expect(await listSystemFavorites("token", "team-1", deps(state, "uid-a"))).toEqual({ ok: true, systemIds: [] });
  });

  it("skips a record whose content was tampered with, and keeps the valid ones", async () => {
    const state = world();
    await setSystemFavorite("token", "team-1", "sys-1", true, deps(state, "uid-a"));
    await setSystemFavorite("token", "team-1", "sys-2", true, deps(state, "uid-a"));
    const broken = state.favorites["uid-a"]?.["sys-2"];
    if (broken === undefined) throw new Error("fixture missing");
    broken[FAVORITE_CONTENT_FIELD] = { ...(broken[FAVORITE_CONTENT_FIELD] as object), ciphertext: "AAAA" };
    expect(await listSystemFavorites("token", "team-1", deps(state, "uid-a"))).toEqual({ ok: true, systemIds: ["sys-1"] });
  });
});

describe("favorite seal (Phase 2F.1)", () => {
  it("opens to the team id only for the exact owner and system it was sealed for", () => {
    const envelope = sealFavoriteContent("uid-a", "sys-1", "team-1");
    const data = { [FAVORITE_CONTENT_FIELD]: envelope };
    expect(openFavoriteTeamId("uid-a", "sys-1", data)).toBe("team-1");
    expect(openFavoriteTeamId("uid-b", "sys-1", data)).toBeNull();
    expect(openFavoriteTeamId("uid-a", "sys-2", data)).toBeNull();
  });

  it("binds the context to the owner path, so it is a distinct AAD from goals and team systems", () => {
    expect(favoriteContext("uid-a", "sys-1")).toBe("system-favorite:uid-a:sys-1");
  });
});
