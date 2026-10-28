import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clearOwnRoleTarget } from "./server/clear-own-role-target";
import { createRole } from "./server/create-role";
import { createFakeRoleStore } from "./server/fake-role-store";
import { createFakeRoleTargetStore } from "./server/fake-role-target-store";
import { getOwnRoleComparison, type RoleComparisonDeps } from "./server/get-own-role-comparison";
import { getOwnRoleTarget } from "./server/get-own-role-target";
import { listRolesForAdmin } from "./server/list-roles-for-admin";
import { setRoleArchived } from "./server/set-role-archived";
import { setOwnRoleTarget } from "./server/set-own-role-target";
import { updateRole } from "./server/update-role";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./server/skill-tree-seam-types";

/*
 * Authorization and privacy matrix (TASK-026, BR-1, BR-10, BR-13, PO-2). Every actor is run against every operation that
 * carries an authorization decision, through the same operations the routes call, with injected verifier, allow-list and
 * stores. Each cell asserts an outcome and, for a refusal, zero writes. No cell relies on hiding a control in the UI.
 * Route handlers are covered by their own suites (status map, subject binding, allow-lists).
 */

const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-10-03T12:00:00Z");
const CREATED_AT = new Date("2026-10-01T10:00:00Z");

interface Actor {
  name: "unauthenticated" | "person" | "teammate" | "lead" | "admin";
  token: string;
  uid?: string;
  email?: string;
}

const ACTORS: Actor[] = [
  { name: "unauthenticated", token: "bogus-token" },
  { name: "person", token: "tok-person", uid: "person-1", email: "person@example.com" },
  { name: "teammate", token: "tok-teammate", uid: "teammate-1", email: "teammate@example.com" },
  { name: "lead", token: "tok-lead", uid: "lead-1", email: "lead@example.com" },
  { name: "admin", token: "tok-admin", uid: "admin-1", email: ADMIN_EMAIL },
];

const PERSON_ACTORS = ACTORS.filter((actor) => actor.uid !== undefined && actor.name !== "admin");

const verifyToken = vi.fn().mockImplementation(async (token: string) => {
  const actor = ACTORS.find((candidate) => candidate.token === token);
  if (actor?.uid === undefined || actor.email === undefined) throw new Error("invalid token");
  return { uid: actor.uid, email: actor.email, email_verified: true };
});

const VALID_TREE = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: CREATED_AT,
  createdBy: "curator-uid",
};

function treeReader(): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: id === "api" ? VALID_TREE : undefined }));
    },
  };
}

const ROLE = {
  name: "Backend",
  expectations: [{ treeId: "api", expectedLevel: 3 }],
  createdAt: CREATED_AT,
  createdBy: "admin-uid",
};

/** A fresh world per cell: one active and one archived role, and a target for the person and the lead. */
function world() {
  const roles = createFakeRoleStore({ generateId: () => "created-role" });
  roles.seedRaw("role-1", ROLE);
  roles.seedRaw("role-archived", { ...ROLE, archivedAt: NOW, archivedBy: "admin-uid" });
  const targets = createFakeRoleTargetStore({ readRole: (id) => roles.get(id), trees: treeReader() });
  targets.seedRaw("person-1", { roleId: "role-1", updatedAt: NOW });
  targets.seedRaw("lead-1", { roleId: "role-archived", updatedAt: NOW });
  const writes = {
    create: vi.spyOn(roles, "create"),
    update: vi.spyOn(roles, "update"),
  };
  const adminDeps = { verifyToken, allowList: [ADMIN_EMAIL], store: roles, treeReader: treeReader(), now: () => NOW };
  return { roles, targets, writes, adminDeps };
}

function totalRoleWrites(writes: ReturnType<typeof world>["writes"]): number {
  return writes.create.mock.calls.length + writes.update.mock.calls.length;
}

const NON_ADMIN = ACTORS.filter((actor) => actor.name !== "admin" && actor.name !== "unauthenticated");

describe("admin role operations — actor × operation (BR-1, PO-2)", () => {
  it.each(ACTORS.map((actor) => [actor.name, actor] as const))("list: %s", async (_name, actor) => {
    const { adminDeps, writes } = world();
    const result = await listRolesForAdmin(actor.token, {}, adminDeps);

    if (actor.name === "admin") {
      expect(result.ok && result.roles.map((role) => role.roleId).sort()).toEqual(["role-1", "role-archived"]);
      return;
    }
    expect(result).toEqual({ ok: false, error: actor.name === "unauthenticated" ? "unauthenticated" : "forbidden" });
    expect(totalRoleWrites(writes)).toBe(0);
  });

  it.each(ACTORS.map((actor) => [actor.name, actor] as const))("create: %s", async (_name, actor) => {
    const { adminDeps, writes } = world();
    const result = await createRole(actor.token, { name: "New", expectations: [] }, adminDeps);

    if (actor.name === "admin") {
      expect(result.ok).toBe(true);
      expect(writes.create).toHaveBeenCalledTimes(1);
      return;
    }
    expect(result).toEqual({ ok: false, error: actor.name === "unauthenticated" ? "unauthenticated" : "forbidden" });
    expect(totalRoleWrites(writes)).toBe(0);
  });

  it.each(ACTORS.map((actor) => [actor.name, actor] as const))("edit: %s", async (_name, actor) => {
    const { adminDeps, writes } = world();
    const result = await updateRole(actor.token, "role-1", { name: "Renamed" }, adminDeps);

    if (actor.name === "admin") {
      expect(result.ok).toBe(true);
      return;
    }
    expect(result).toEqual({ ok: false, error: actor.name === "unauthenticated" ? "unauthenticated" : "forbidden" });
    expect(totalRoleWrites(writes)).toBe(0);
  });

  it.each(ACTORS.map((actor) => [actor.name, actor] as const))("archive: %s", async (_name, actor) => {
    const { adminDeps, writes } = world();
    const result = await setRoleArchived(actor.token, "role-1", true, adminDeps);

    if (actor.name === "admin") {
      expect(result.ok).toBe(true);
      return;
    }
    expect(result).toEqual({ ok: false, error: actor.name === "unauthenticated" ? "unauthenticated" : "forbidden" });
    expect(totalRoleWrites(writes)).toBe(0);
  });

  it("no non-admin actor can reach any admin role operation (app-admin status is the only grant)", async () => {
    for (const actor of NON_ADMIN) {
      const { adminDeps, writes } = world();
      expect((await createRole(actor.token, { name: "X", expectations: [] }, adminDeps)).ok).toBe(false);
      expect((await updateRole(actor.token, "role-1", { name: "X" }, adminDeps)).ok).toBe(false);
      expect((await setRoleArchived(actor.token, "role-1", true, adminDeps)).ok).toBe(false);
      expect((await listRolesForAdmin(actor.token, {}, adminDeps)).ok).toBe(false);
      expect(totalRoleWrites(writes)).toBe(0);
    }
  });
});

describe("person operations — own data only (BR-10, BR-13)", () => {
  it.each(ACTORS.map((actor) => [actor.name, actor] as const))("comparison: %s", async (_name, actor) => {
    const { roles, targets } = world();
    const deps: RoleComparisonDeps = {
      verifyToken,
      roles,
      targets,
      treeReader: treeReader(),
      readSkills: vi.fn(async () => ({
        ok: true as const,
        dto: { skills: [{ treeId: "api", name: "API design", level: 4 as const }], truncated: false, profile: "ok" as const },
      })),
    };
    const result = await getOwnRoleComparison(actor.token, deps);

    if (actor.name === "unauthenticated") {
      expect(result).toEqual({ ok: false, error: "unauthenticated" });
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (actor.name === "person") {
      expect(result.comparison).toMatchObject({ state: "available", target: { roleId: "role-1" } });
    } else if (actor.name === "lead") {
      expect(result.comparison).toEqual({ state: "target_unavailable", reason: "unavailable" });
    } else {
      expect(result.comparison).toEqual({ state: "no_target" });
    }
  });

  it.each(PERSON_ACTORS.map((actor) => [actor.name, actor] as const))(
    "target read, set and clear: %s acts only on their own document",
    async (_name, actor) => {
      const { roles, targets } = world();
      const uid = actor.uid as string;

      expect(await getOwnRoleTarget(uid, { targets, roles })).toMatchObject({ status: expect.any(String) });
      await setOwnRoleTarget(uid, "role-1", { targets, now: () => NOW });
      await clearOwnRoleTarget(uid, { targets });

      const writtenSubjects = targets.log.filter((entry) => entry.startsWith("tx.set:") || entry.startsWith("delete:"));
      expect(writtenSubjects.every((entry) => entry.endsWith(`:${uid}`))).toBe(true);
    },
  );

  it("an admin has no read of another person's target or comparison", async () => {
    const { roles, targets } = world();

    expect(await getOwnRoleTarget("admin-1", { targets, roles })).toEqual({ status: "none" });
    expect(targets.log.some((entry) => entry.includes("person-1"))).toBe(false);
  });

  it("a teammate or lead reads only their own target, never a team member's", async () => {
    const { roles, targets } = world();

    expect(await getOwnRoleTarget("teammate-1", { targets, roles })).toEqual({ status: "none" });
    expect(await getOwnRoleTarget("lead-1", { targets, roles })).toEqual({
      status: "selected",
      target: { roleId: "role-archived", name: "Backend", archived: true },
    });
    expect(targets.log.filter((entry) => entry.includes("person-1"))).toEqual([]);
  });
});

describe("route surface — no role-definition mutation outside the admin routes (BR-1, PO-2)", () => {
  const ROOT = process.cwd();
  const walk = (dir: string): string[] => {
    const absolute = join(ROOT, dir);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
      return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
    });
  };

  it("only files under app/api/admin/roles call the role-definition mutation operations", () => {
    const mutators = /\b(createRole|updateRole|setRoleArchived|listRolesForAdmin)\b/;
    const callers = walk("app/api").filter((path) => mutators.test(readFileSync(join(ROOT, path), "utf8")));

    expect(callers.length).toBeGreaterThan(0);
    expect(callers.every((path) => path.startsWith("app/api/admin/roles/"))).toBe(true);
  });
});
