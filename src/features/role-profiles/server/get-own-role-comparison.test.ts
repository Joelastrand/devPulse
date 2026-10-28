import { describe, expect, it, vi } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { createFakeRoleTargetStore } from "./fake-role-target-store";
import { getOwnRoleComparison, type RoleComparisonDeps } from "./get-own-role-comparison";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

/* The C1 result type is derived from the operation's own dependency, so this file imports nothing from skill-profiles. */
type ReadSkillsResult = Awaited<ReturnType<NonNullable<RoleComparisonDeps["readSkills"]>>>;
type OwnSkillLevel = Extract<ReadSkillsResult, { ok: true }>["dto"]["skills"][number]["level"];

const OWNER = "uid-owner";
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const UPDATED_AT = new Date("2026-10-02T09:00:00Z");

const TREE = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: CREATED_AT,
  createdBy: "curator-uid",
});
const TREES: Record<string, unknown> = {
  api: TREE("API design"),
  testing: TREE("Testing"),
  ops: TREE("Operations"),
  broken: { name: "Broken", nodes: [], createdAt: CREATED_AT, createdBy: "curator-uid" },
};

const ROLE = {
  name: "Backend",
  expectations: [
    { treeId: "api", expectedLevel: 3 },
    { treeId: "testing", expectedLevel: 2 },
    { treeId: "ops", expectedLevel: 4 },
    { treeId: "broken", expectedLevel: 2 },
    { treeId: "gone", expectedLevel: 2 },
  ],
  createdAt: CREATED_AT,
  createdBy: "admin-uid",
};

const skill = (treeId: string, name: string, level: OwnSkillLevel) => ({ treeId, name, level });

function ownSkills(
  levels: Record<string, OwnSkillLevel>,
  options: { truncated?: boolean; profile?: "ok" | "unreadable" } = {},
): ReadSkillsResult {
  return {
    ok: true,
    dto: {
      skills: Object.entries(levels).map(([treeId, level]) => skill(treeId, treeId, level)),
      truncated: options.truncated ?? false,
      profile: options.profile ?? "ok",
    },
  };
}

function treeReader(docs: Record<string, unknown>, failing = false): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      if (failing) throw new Error("firestore unavailable");
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: docs[id] }));
    },
  };
}

function setup(
  options: {
    role?: Record<string, unknown>;
    target?: Record<string, unknown>;
    trees?: Record<string, unknown>;
    skills?: ReadSkillsResult;
    treeReadFails?: boolean;
  } = {},
) {
  const roles = createFakeRoleStore();
  roles.seedRaw("role-1", options.role ?? ROLE);
  const targets = createFakeRoleTargetStore();
  if (options.target !== undefined) targets.seedRaw(OWNER, options.target);
  const readSkills = vi.fn(async (): Promise<ReadSkillsResult> => options.skills ?? ownSkills({}));
  const deps: RoleComparisonDeps = {
    verifyToken: vi.fn().mockResolvedValue({ uid: OWNER, email: "owner@example.com", email_verified: true }),
    roles,
    targets,
    treeReader: treeReader(options.trees ?? TREES, options.treeReadFails),
    readSkills,
  };
  return { deps, roles, targets, readSkills };
}

const VALID_TARGET = { roleId: "role-1", updatedAt: UPDATED_AT };

describe("getOwnRoleComparison — states (PG-4)", () => {
  it("returns no_target with no C1 read when the owner has no target (BR-19)", async () => {
    const { deps, readSkills } = setup();

    expect(await getOwnRoleComparison("token", deps)).toEqual({ ok: true, comparison: { state: "no_target" } });
    expect(readSkills).not.toHaveBeenCalled();
  });

  it("returns target_unavailable/unavailable for a malformed target, with no C1 read (BR-20)", async () => {
    const { deps, readSkills } = setup({ target: { ...VALID_TARGET, extra: "x" } });

    expect(await getOwnRoleComparison("token", deps)).toEqual({
      ok: true,
      comparison: { state: "target_unavailable", reason: "unavailable" },
    });
    expect(readSkills).not.toHaveBeenCalled();
  });

  it("returns target_unavailable/unavailable when the referenced role is missing", async () => {
    const { deps } = setup({ target: { roleId: "gone-role", updatedAt: UPDATED_AT } });

    expect(await getOwnRoleComparison("token", deps)).toEqual({
      ok: true,
      comparison: { state: "target_unavailable", reason: "unavailable" },
    });
  });

  it("returns target_unavailable/unavailable when the referenced role is malformed (BR-21)", async () => {
    const { deps } = setup({ role: { ...ROLE, name: "" }, target: VALID_TARGET });

    expect(await getOwnRoleComparison("token", deps)).toEqual({
      ok: true,
      comparison: { state: "target_unavailable", reason: "unavailable" },
    });
  });

  it("returns target_unavailable/unavailable for an archived role, with no rows", async () => {
    const { deps, readSkills } = setup({
      role: { ...ROLE, archivedAt: UPDATED_AT, archivedBy: "admin-uid" },
      target: VALID_TARGET,
    });

    expect(await getOwnRoleComparison("token", deps)).toEqual({
      ok: true,
      comparison: { state: "target_unavailable", reason: "unavailable" },
    });
    expect(readSkills).not.toHaveBeenCalled();
  });

  it("returns target_unavailable/no_expectations for an active role with zero expectations", async () => {
    const { deps, readSkills } = setup({ role: { ...ROLE, expectations: [] }, target: VALID_TARGET });

    expect(await getOwnRoleComparison("token", deps)).toEqual({
      ok: true,
      comparison: { state: "target_unavailable", reason: "no_expectations" },
    });
    expect(readSkills).not.toHaveBeenCalled();
  });

  it("returns target_unavailable/unavailable with no rows when no expectation resolves to a valid SkillTree", async () => {
    const { deps, readSkills } = setup({
      role: { ...ROLE, expectations: [{ treeId: "gone", expectedLevel: 2 }] },
      target: VALID_TARGET,
      trees: {},
    });

    expect(await getOwnRoleComparison("token", deps)).toEqual({
      ok: true,
      comparison: { state: "target_unavailable", reason: "unavailable" },
    });
    expect(readSkills).not.toHaveBeenCalled();
  });
});

describe("getOwnRoleComparison — available rows (BR-11, BR-12)", () => {
  it("returns one status per expectation in expectation order, with the PG-4 statuses", async () => {
    const { deps } = setup({
      target: VALID_TARGET,
      skills: ownSkills({ api: 4, testing: 1, broken: 3 }),
    });

    const result = await getOwnRoleComparison("token", deps);

    expect(result).toEqual({
      ok: true,
      comparison: {
        state: "available",
        target: { roleId: "role-1", name: "Backend" },
        rows: [
          { treeId: "api", treeName: "API design", expectedLevel: 3, status: "meets", ownLevel: 4 },
          { treeId: "testing", treeName: "Testing", expectedLevel: 2, status: "development_opportunity", ownLevel: 1 },
          { treeId: "ops", treeName: "Operations", expectedLevel: 4, status: "not_assessed", ownLevel: null },
          { treeId: "broken", treeName: null, expectedLevel: 2, status: "area_unavailable", ownLevel: null },
          { treeId: "gone", treeName: null, expectedLevel: 2, status: "area_unavailable", ownLevel: null },
        ],
      },
    });
  });

  it("gives no levels when the C1 profile is unreadable: valid trees become not_assessed, never a fabricated level", async () => {
    const { deps } = setup({
      target: VALID_TARGET,
      skills: ownSkills({ api: null, testing: null, ops: null }, { profile: "unreadable" }),
    });

    const result = await getOwnRoleComparison("token", deps);

    expect(result.ok && result.comparison.state === "available" && result.comparison.rows[0]).toEqual({
      treeId: "api",
      treeName: "API design",
      expectedLevel: 3,
      status: "not_assessed",
      ownLevel: null,
    });
  });

  it("exposes exactly the approved keys: no totals, counts, ordering or status summary", async () => {
    const { deps } = setup({ target: VALID_TARGET, skills: ownSkills({ api: 4 }) });

    const result = await getOwnRoleComparison("token", deps);
    if (!result.ok || result.comparison.state !== "available") throw new Error("expected an available comparison");

    expect(Object.keys(result.comparison).sort()).toEqual(["rows", "state", "target"]);
    expect(Object.keys(result.comparison.target).sort()).toEqual(["name", "roleId"]);
    for (const row of result.comparison.rows) {
      expect(Object.keys(row).sort()).toEqual(["expectedLevel", "ownLevel", "status", "treeId", "treeName"]);
    }
  });
});

describe("getOwnRoleComparison — failures and boundaries", () => {
  it("returns unauthenticated for an invalid token and reads nothing", async () => {
    const { deps, targets, readSkills } = setup({ target: VALID_TARGET });
    deps.verifyToken = vi.fn().mockRejectedValue(new Error("invalid token"));

    expect(await getOwnRoleComparison("bad", deps)).toEqual({ ok: false, error: "unauthenticated" });
    expect(targets.log).toEqual([]);
    expect(readSkills).not.toHaveBeenCalled();
  });

  it("a failed C1 read is a neutral persistence_failure, never area_unavailable or not_assessed", async () => {
    const { deps } = setup({
      target: VALID_TARGET,
      skills: { ok: false, error: "persistence_failed" },
    });

    expect(await getOwnRoleComparison("token", deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("a failed SkillTree read rejects into a neutral persistence_failure, not an area_unavailable row", async () => {
    const { deps } = setup({ target: VALID_TARGET, treeReadFails: true, skills: ownSkills({ api: 4 }) });

    expect(await getOwnRoleComparison("token", deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("a truncated catalog that omits an expectation's tree is a failure, not not_assessed", async () => {
    const { deps } = setup({ target: VALID_TARGET, skills: ownSkills({ api: 4 }, { truncated: true }) });

    expect(await getOwnRoleComparison("token", deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("a truncated catalog that still lists every expectation's tree is comparable", async () => {
    const { deps } = setup({
      role: { ...ROLE, expectations: [{ treeId: "api", expectedLevel: 3 }] },
      target: VALID_TARGET,
      skills: ownSkills({ api: 4, testing: 1 }, { truncated: true }),
    });

    const result = await getOwnRoleComparison("token", deps);

    expect(result.ok && result.comparison.state === "available" && result.comparison.rows).toEqual([
      { treeId: "api", treeName: "API design", expectedLevel: 3, status: "meets", ownLevel: 4 },
    ]);
  });

  it("performs zero writes on any store and reads only the owner's own target", async () => {
    const { deps, roles, targets } = setup({ target: VALID_TARGET, skills: ownSkills({ api: 4 }) });
    const createSpy = vi.spyOn(roles, "create");
    const updateSpy = vi.spyOn(roles, "update");

    await getOwnRoleComparison("token", deps);

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(targets.log).toEqual([`get:${OWNER}`]);
  });
});
