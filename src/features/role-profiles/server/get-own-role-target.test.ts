import { describe, expect, it } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { createFakeRoleTargetStore } from "./fake-role-target-store";
import { getOwnRoleTarget } from "./get-own-role-target";

const OWNER = "uid-owner";
const UPDATED_AT = new Date("2026-10-02T09:00:00Z");
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const ROLE = {
  name: "Backend",
  expectations: [{ treeId: "api", expectedLevel: 3 }],
  createdAt: CREATED_AT,
  createdBy: "admin-uid",
};

function setup() {
  const roles = createFakeRoleStore();
  const targets = createFakeRoleTargetStore();
  return { roles, targets, deps: { roles, targets } };
}

describe("getOwnRoleTarget", () => {
  it("returns none without an error when no target document exists, and performs no write (BR-19)", async () => {
    const { deps, targets } = setup();

    expect(await getOwnRoleTarget(OWNER, deps)).toEqual({ status: "none" });
    expect(targets.log).toEqual([`get:${OWNER}`]);
  });

  it("returns the selected role with its name and archived=false for an active role", async () => {
    const { roles, deps, targets } = setup();
    roles.seedRaw("role-1", ROLE);
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });

    expect(await getOwnRoleTarget(OWNER, deps)).toEqual({
      status: "selected",
      target: { roleId: "role-1", name: "Backend", archived: false },
    });
  });

  it("reports an archived referenced role as selected with archived=true (no removal)", async () => {
    const { roles, deps, targets } = setup();
    roles.seedRaw("role-1", { ...ROLE, archivedAt: UPDATED_AT, archivedBy: "admin-uid" });
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });

    expect(await getOwnRoleTarget(OWNER, deps)).toEqual({
      status: "selected",
      target: { roleId: "role-1", name: "Backend", archived: true },
    });
  });

  it("reports a malformed target document as unavailable without echoing its content (BR-20)", async () => {
    const { deps, targets } = setup();
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT, extraSecret: "do-not-echo" });

    const result = await getOwnRoleTarget(OWNER, deps);

    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/role-1|do-not-echo/);
  });

  it("reports a target whose referenced role is missing as unavailable, with no roleId or name (BR-20)", async () => {
    const { deps, targets } = setup();
    targets.seedRaw(OWNER, { roleId: "gone-role", updatedAt: UPDATED_AT });

    const result = await getOwnRoleTarget(OWNER, deps);

    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/gone-role/);
  });

  it("reports a target whose referenced role is malformed as unavailable (BR-20, BR-21)", async () => {
    const { roles, deps, targets } = setup();
    roles.seedRaw("role-1", { name: "", expectations: [], createdAt: CREATED_AT, createdBy: "admin-uid" });
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });

    expect(await getOwnRoleTarget(OWNER, deps)).toEqual({ status: "unavailable" });
  });

  it("reports a stored roleId that is not addressable as unavailable rather than failing", async () => {
    const { deps, targets } = setup();
    targets.seedRaw(OWNER, { roleId: "a/b", updatedAt: UPDATED_AT });

    expect(await getOwnRoleTarget(OWNER, deps)).toEqual({ status: "unavailable" });
  });

  it("performs only reads: no delete and no write of any kind", async () => {
    const { roles, deps, targets } = setup();
    roles.seedRaw("role-1", ROLE);
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });

    await getOwnRoleTarget(OWNER, deps);

    expect(targets.log.filter((entry) => !entry.startsWith("get:"))).toEqual([]);
    expect(targets.storedSubjectUids()).toEqual([OWNER]);
  });

  it("reads only the subject it is given, never another uid's target", async () => {
    const { roles, deps, targets } = setup();
    roles.seedRaw("role-1", ROLE);
    targets.seedRaw("uid-other", { roleId: "role-1", updatedAt: UPDATED_AT });

    expect(await getOwnRoleTarget(OWNER, deps)).toEqual({ status: "none" });
    expect(targets.log).toEqual([`get:${OWNER}`]);
  });

  it("lets a failed target read reject instead of reporting a status (neutral 500 at the route)", async () => {
    const { roles } = setup();
    const failing = {
      get: async () => {
        throw new Error("firestore unavailable");
      },
      delete: async () => undefined,
      runSelection: async () => {
        throw new Error("not used by read");
      },
    };

    await expect(getOwnRoleTarget(OWNER, { roles, targets: failing })).rejects.toThrow("firestore unavailable");
  });

  it("lets a failed role read reject instead of reporting unavailable", async () => {
    const { targets } = setup();
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });
    const failing = {
      create: async () => "",
      listWindow: async () => ({ docs: [], rawCount: 0 }),
      count: async () => 0,
      get: async () => {
        throw new Error("firestore unavailable");
      },
      update: async () => undefined,
    };

    await expect(getOwnRoleTarget(OWNER, { roles: failing, targets })).rejects.toThrow("firestore unavailable");
  });
});
