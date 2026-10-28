import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createRole, type CreateRoleDeps } from "./create-role";
import { createFakeRoleStore } from "./fake-role-store";
import { getOwnRoleTarget } from "./get-own-role-target";
import { setRoleArchived, type SetRoleArchivedDeps } from "./set-role-archived";
import { setOwnRoleTarget } from "./set-own-role-target";
import { clearOwnRoleTarget } from "./clear-own-role-target";
import { createFakeRoleTargetStore } from "./fake-role-target-store";
import type { RoleStore } from "./role-store-types";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

/*
 * Concurrency and transaction semantics (TASK-012). Each operation's write behaviour is pinned here, and the
 * operations claim only the guarantees they perform: create is count-then-create (BR-7 overshoot accepted); archive
 * and restore are single-document last-write-wins; selection is the only transactional write (PG-7).
 */

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const OWNER = "uid-owner";
const NOW = new Date("2026-10-03T12:00:00Z");
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const VALID_TREE = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: CREATED_AT,
  createdBy: "curator-uid",
};
const ACTIVE_ROLE = {
  name: "Backend",
  expectations: [{ treeId: "api", expectedLevel: 3 }],
  createdAt: CREATED_AT,
  createdBy: "admin-uid",
};

const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));

function treeReader(docs: Record<string, unknown>): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: docs[id] }));
    },
  };
}

function verifyAsAdmin() {
  return vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
}

/** Wraps the in-memory role store and records every write so the write count per call can be asserted. */
function recordingRoleStore(options: { count?: number; failUpdate?: boolean; generateIds?: boolean } = {}) {
  let nextId = 0;
  const base = createFakeRoleStore({ generateId: options.generateIds ? () => `role-${(nextId += 1)}` : () => "role-1" });
  const writes: string[] = [];
  const store: RoleStore & { seedRaw: typeof base.seedRaw } = {
    seedRaw: base.seedRaw,
    listWindow: base.listWindow,
    get: base.get,
    async count() {
      return options.count ?? (await base.count());
    },
    async create(role) {
      writes.push("create");
      return base.create(role);
    },
    async update(roleId, changes) {
      writes.push(`update:${roleId}`);
      if (options.failUpdate) throw new Error("firestore unavailable");
      return base.update(roleId, changes);
    },
  };
  return { store, base, writes };
}

describe("role create — count-then-create (BR-7)", () => {
  function createDeps(store: RoleStore): CreateRoleDeps {
    return {
      verifyToken: verifyAsAdmin(),
      allowList: [ADMIN_EMAIL],
      store,
      treeReader: treeReader({ api: VALID_TREE }),
      now: () => NOW,
    };
  }
  const INPUT = { name: "Backend", expectations: [{ treeId: "api", expectedLevel: 3 }] };

  it("refuses a create at the cap with cap_reached and writes nothing", async () => {
    const { store, writes } = recordingRoleStore({ count: 50 });

    expect(await createRole("token", INPUT, createDeps(store))).toEqual({ ok: false, error: "cap_reached" });
    expect(writes).toEqual([]);
  });

  it("documents the bound under concurrent creates: both passing the count check both write (overshoot accepted)", async () => {
    // Both creates observe 49 documents before either writes, so both pass the count check.
    const { store, base, writes } = recordingRoleStore({ count: 49, generateIds: true });
    for (let i = 0; i < 49; i += 1) base.seedRaw(`seed-${i}`, ACTIVE_ROLE);

    const results = await Promise.all([
      createRole("token", INPUT, createDeps(store)),
      createRole("token", INPUT, createDeps(store)),
    ]);

    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(await base.count()).toBe(51);
    expect(writes).toEqual(["create", "create"]);
  });

  it("performs at most one create per call and returns a neutral persistence_failed when that write fails", async () => {
    const { store, writes } = recordingRoleStore();
    const failing: RoleStore = {
      ...store,
      async create() {
        writes.push("create");
        throw new Error("firestore unavailable");
      },
    };

    expect(await createRole("token", INPUT, createDeps(failing))).toEqual({ ok: false, error: "persistence_failed" });
    expect(writes).toEqual(["create"]);
  });
});

describe("role update and archive — single-document last write wins", () => {
  function archiveDeps(store: RoleStore): SetRoleArchivedDeps {
    return {
      verifyToken: verifyAsAdmin(),
      allowList: [ADMIN_EMAIL],
      store,
      treeReader: treeReader({ api: VALID_TREE }),
      now: () => NOW,
    };
  }

  it("archive is one single-document update; a repeated archive writes nothing (idempotent no-op)", async () => {
    const { store, base, writes } = recordingRoleStore();
    base.seedRaw("role-1", ACTIVE_ROLE);

    await setRoleArchived("token", "role-1", true, archiveDeps(store));
    await setRoleArchived("token", "role-1", true, archiveDeps(store));

    expect(writes).toEqual(["update:role-1"]);
  });

  it("a failed archive write reports persistence_failed and leaves the role active", async () => {
    const { store, base, writes } = recordingRoleStore({ failUpdate: true });
    base.seedRaw("role-1", ACTIVE_ROLE);

    expect(await setRoleArchived("token", "role-1", true, archiveDeps(store))).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(writes).toEqual(["update:role-1"]);
    expect(await base.get("role-1")).toEqual(ACTIVE_ROLE);
  });
});

describe("target selection — transactional (PG-7)", () => {
  it("an archive committed before the transaction's role read makes the selection refuse, with zero writes", async () => {
    const { store, base } = recordingRoleStore();
    base.seedRaw("role-1", ACTIVE_ROLE);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The transaction's read waits on the gate; the archive commits while it waits, so the read observes it.
    const targets = createFakeRoleTargetStore({
      readRole: async (roleId) => {
        await gate;
        return base.get(roleId);
      },
      trees: treeReader({ api: VALID_TREE }),
    });

    const selection = setOwnRoleTarget(OWNER, "role-1", { targets, now: () => NOW });
    await store.update("role-1", { set: { archivedAt: NOW, archivedBy: ADMIN_UID }, unset: [] });
    release();

    expect(await selection).toEqual({ ok: false, error: "role_not_selectable" });
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });

  it("an archive committed after the selection leaves the target set and reads back as archived (BR-5)", async () => {
    const { store, base } = recordingRoleStore();
    base.seedRaw("role-1", ACTIVE_ROLE);
    const targets = createFakeRoleTargetStore({ readRole: (roleId) => base.get(roleId), trees: treeReader({ api: VALID_TREE }) });

    expect(await setOwnRoleTarget(OWNER, "role-1", { targets, now: () => NOW })).toEqual({ ok: true });
    await setRoleArchived("token", "role-1", true, {
      verifyToken: verifyAsAdmin(),
      allowList: [ADMIN_EMAIL],
      store,
      treeReader: treeReader({ api: VALID_TREE }),
      now: () => NOW,
    });

    expect(await getOwnRoleTarget(OWNER, { targets, roles: base })).toEqual({
      status: "selected",
      target: { roleId: "role-1", name: "Backend", archived: true },
    });
  });

  it("each selection performs at most one target write, and each clear performs exactly one delete", async () => {
    const { base } = recordingRoleStore();
    base.seedRaw("role-1", ACTIVE_ROLE);
    const targets = createFakeRoleTargetStore({ readRole: (roleId) => base.get(roleId), trees: treeReader({ api: VALID_TREE }) });

    await setOwnRoleTarget(OWNER, "role-1", { targets, now: () => NOW });
    await clearOwnRoleTarget(OWNER, { targets });

    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toHaveLength(1);
    expect(targets.log.filter((entry) => entry.startsWith("delete:"))).toEqual([`delete:${OWNER}`]);
  });
});

describe("no operation claims a transaction it does not perform", () => {
  const productionServerFiles = readdirSync(SERVER_DIR).filter(
    (name) => name.endsWith(".ts") && !/\.test\.ts$/.test(name),
  );
  const read = (name: string) => readFileSync(`${SERVER_DIR}${name}`, "utf8");

  it("only the role-target store opens a Firestore transaction", () => {
    const withTransaction = productionServerFiles.filter((name) => /\.runTransaction\(/.test(read(name)));
    expect(withTransaction).toEqual(["role-target-store.ts"]);
  });

  it("the selection operation reads the role and SkillTrees only through its transactional scope", () => {
    const source = read("set-own-role-target.ts");
    expect(source).not.toMatch(/\b(?:roles|store|targets|base)\.get\(/);
    expect(source).toMatch(/scope\.readRole/);
    expect(source).toMatch(/scope\.trees/);
  });
});
