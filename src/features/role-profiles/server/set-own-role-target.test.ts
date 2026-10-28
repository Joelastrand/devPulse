import { describe, expect, it } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { createFakeRoleTargetStore } from "./fake-role-target-store";
import { setOwnRoleTarget } from "./set-own-role-target";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const OWNER = "uid-owner";
const NOW = new Date("2026-10-03T12:00:00Z");
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const UPDATED_AT = new Date("2026-10-02T09:00:00Z");
const VALID_TREE = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
    { nodeId: "node-2", label: "Expert", order: 2 },
  ],
  createdAt: CREATED_AT,
  createdBy: "admin-uid",
};
const ACTIVE_ROLE = {
  name: "Backend",
  expectations: [{ treeId: "api", expectedLevel: 3 }],
  createdAt: CREATED_AT,
  createdBy: "admin-uid",
};

/** Non-transactional tree source for the fake scope; `trees` maps a treeId to its raw data, absent ids are missing. */
function treeReader(trees: Record<string, unknown>): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: trees[id] }));
    },
  };
}

function setup(options: { roles?: Record<string, Record<string, unknown>>; trees?: Record<string, unknown> } = {}) {
  const roles = createFakeRoleStore();
  for (const [id, data] of Object.entries(options.roles ?? {})) roles.seedRaw(id, data);
  const targets = createFakeRoleTargetStore({
    readRole: (roleId) => roles.get(roleId),
    trees: treeReader(options.trees ?? { api: VALID_TREE }),
  });
  return { targets, deps: { targets, now: () => NOW } };
}

describe("setOwnRoleTarget", () => {
  it("selects an active role with a valid expectation and writes exactly { roleId, updatedAt }", async () => {
    const { targets, deps } = setup({ roles: { "role-1": ACTIVE_ROLE } });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: true });
    expect(targets.storedTarget(OWNER)).toEqual({ roleId: "role-1", updatedAt: NOW });
  });

  it("performs all transactional reads before its single write (PG-7)", async () => {
    const { targets, deps } = setup({ roles: { "role-1": ACTIVE_ROLE } });

    await setOwnRoleTarget(OWNER, "role-1", deps);

    expect(targets.log).toEqual(["tx.get:role:role-1", "tx.get:trees:api", `tx.set:${OWNER}`]);
  });

  it("reads only the referenced SkillTrees and writes only the subject's own document", async () => {
    const { targets, deps } = setup({ roles: { "role-1": ACTIVE_ROLE } });

    await setOwnRoleTarget(OWNER, "role-1", deps);

    expect(targets.log.filter((entry) => entry.startsWith("tx.get:trees:"))).toEqual(["tx.get:trees:api"]);
    expect(targets.storedSubjectUids()).toEqual([OWNER]);
  });

  it("selects when at least one of several expectations has a valid SkillTree (PG-2)", async () => {
    const { targets, deps } = setup({
      roles: {
        "role-1": {
          ...ACTIVE_ROLE,
          expectations: [
            { treeId: "gone", expectedLevel: 2 },
            { treeId: "api", expectedLevel: 3 },
          ],
        },
      },
    });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: true });
    expect(targets.storedTarget(OWNER)).toEqual({ roleId: "role-1", updatedAt: NOW });
  });

  it("refuses a missing role with not_found and writes nothing", async () => {
    const { targets, deps } = setup();

    expect(await setOwnRoleTarget(OWNER, "missing", deps)).toEqual({ ok: false, error: "not_found" });
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });

  it("refuses a malformed role with the same not_found as a missing role, and writes nothing (PG-9)", async () => {
    const { targets, deps } = setup({ roles: { "role-1": { ...ACTIVE_ROLE, name: "" } } });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: false, error: "not_found" });
    expect(targets.storedTarget(OWNER)).toBeUndefined();
  });

  it("refuses an unaddressable roleId with not_found and writes nothing", async () => {
    const { targets, deps } = setup();

    expect(await setOwnRoleTarget(OWNER, "a/b", deps)).toEqual({ ok: false, error: "not_found" });
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });

  it("refuses an archived role with role_not_selectable and writes nothing (archive before the read)", async () => {
    const { targets, deps } = setup({
      roles: { "role-1": { ...ACTIVE_ROLE, archivedAt: UPDATED_AT, archivedBy: "admin-uid" } },
    });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: false, error: "role_not_selectable" });
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });

  it("refuses a zero-expectation role with role_not_selectable and writes nothing (PG-2)", async () => {
    const { targets, deps } = setup({ roles: { "role-1": { ...ACTIVE_ROLE, expectations: [] } } });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: false, error: "role_not_selectable" });
    expect(targets.storedTarget(OWNER)).toBeUndefined();
  });

  it("refuses a role whose expectations have no valid SkillTree (missing or invalid) with role_not_selectable", async () => {
    const { targets, deps } = setup({
      roles: { "role-1": ACTIVE_ROLE },
      trees: { api: { name: "Broken", nodes: [], createdAt: CREATED_AT, createdBy: "admin-uid" } },
    });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: false, error: "role_not_selectable" });
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });

  it("replaces a malformed existing target with a valid selection", async () => {
    const { targets, deps } = setup({ roles: { "role-1": ACTIVE_ROLE } });
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT, extra: "malformed" });

    expect(await setOwnRoleTarget(OWNER, "role-1", deps)).toEqual({ ok: true });
    expect(targets.storedTarget(OWNER)).toEqual({ roleId: "role-1", updatedAt: NOW });
  });

  it("changing the target replaces the previous roleId in the same single document (no history)", async () => {
    const { targets, deps } = setup({
      roles: { "role-1": ACTIVE_ROLE, "role-2": { ...ACTIVE_ROLE, name: "Frontend" } },
    });

    await setOwnRoleTarget(OWNER, "role-1", deps);
    expect(await setOwnRoleTarget(OWNER, "role-2", deps)).toEqual({ ok: true });

    expect(targets.storedTarget(OWNER)).toEqual({ roleId: "role-2", updatedAt: NOW });
    expect(targets.storedSubjectUids()).toEqual([OWNER]);
  });

  it("lets a failed role read reject and writes nothing", async () => {
    const targets = createFakeRoleTargetStore({
      readRole: async () => {
        throw new Error("firestore unavailable");
      },
    });

    await expect(setOwnRoleTarget(OWNER, "role-1", { targets, now: () => NOW })).rejects.toThrow("firestore unavailable");
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });

  it("lets a failed SkillTree read reject instead of reporting role_not_selectable", async () => {
    const roles = createFakeRoleStore();
    roles.seedRaw("role-1", ACTIVE_ROLE);
    const targets = createFakeRoleTargetStore({
      readRole: (roleId) => roles.get(roleId),
      trees: {
        async getMany() {
          throw new Error("firestore unavailable");
        },
      },
    });

    await expect(setOwnRoleTarget(OWNER, "role-1", { targets, now: () => NOW })).rejects.toThrow("firestore unavailable");
    expect(targets.log.filter((entry) => entry.startsWith("tx.set:"))).toEqual([]);
  });
});
