import { describe, expect, it } from "vitest";
import { clearOwnRoleTarget } from "./clear-own-role-target";
import { createFakeRoleTargetStore } from "./fake-role-target-store";

const OWNER = "uid-owner";
const UPDATED_AT = new Date("2026-10-02T09:00:00Z");

describe("clearOwnRoleTarget", () => {
  it("removes the owner's target with exactly one delete and no other write (hard delete, PO-1)", async () => {
    const targets = createFakeRoleTargetStore();
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });

    await clearOwnRoleTarget(OWNER, { targets });

    expect(targets.log).toEqual([`delete:${OWNER}`]);
    expect(targets.storedSubjectUids()).toEqual([]);
  });

  it("succeeds without error when no target exists (idempotent)", async () => {
    const targets = createFakeRoleTargetStore();

    await expect(clearOwnRoleTarget(OWNER, { targets })).resolves.toBeUndefined();
    expect(targets.log).toEqual([`delete:${OWNER}`]);
  });

  it("removes only the subject's document and leaves other owners' targets untouched", async () => {
    const targets = createFakeRoleTargetStore();
    targets.seedRaw(OWNER, { roleId: "role-1", updatedAt: UPDATED_AT });
    targets.seedRaw("uid-other", { roleId: "role-1", updatedAt: UPDATED_AT });

    await clearOwnRoleTarget(OWNER, { targets });

    expect(targets.storedSubjectUids()).toEqual(["uid-other"]);
  });

  it("lets a failed delete reject so the route can report a neutral failure", async () => {
    const failing = {
      get: async () => undefined,
      delete: async () => {
        throw new Error("firestore unavailable");
      },
      runSelection: async () => {
        throw new Error("not used by clear");
      },
    };

    await expect(clearOwnRoleTarget(OWNER, { targets: failing })).rejects.toThrow("firestore unavailable");
  });
});
