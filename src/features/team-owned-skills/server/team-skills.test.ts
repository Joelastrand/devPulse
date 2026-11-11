import { describe, expect, it, vi } from "vitest";
import { createFakeTeamSkillStore, type FakeTeamSkillState } from "./fake-team-skill-store";
import {
  clearOwnTeamSkillLevel,
  createTeamSkill,
  listTeamSkills,
  setOwnTeamSkillLevel,
  updateTeamSkill,
  type TeamSkillDeps,
} from "./manage-team-skills";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-01T12:00:00Z");
const T = "team-a";
const OTHER = "team-b";
const ADMIN = "admin-1";
const OTHER_ADMIN = "admin-2";
const MEMBER = "member-1";
const OUTSIDER = "outsider-1";

/** Synthetic fixture: the token string is the uid, so each test chooses its caller explicitly. */
function setup(extra: Partial<FakeTeamSkillState> = {}, options: { superadmin?: string[] } = {}) {
  const state: Partial<FakeTeamSkillState> = {
    teams: { [T]: { status: "active" }, [OTHER]: { status: "active" }, ...(extra.teams ?? {}) },
    memberships: {
      [`${ADMIN}__${T}`]: { uid: ADMIN, teamId: T, role: "teamadmin" },
      [`${MEMBER}__${T}`]: { uid: MEMBER, teamId: T },
      [`${MEMBER}__${OTHER}`]: { uid: MEMBER, teamId: OTHER },
      [`${OTHER_ADMIN}__${OTHER}`]: { uid: OTHER_ADMIN, teamId: OTHER, role: "teamadmin" },
      ...(extra.memberships ?? {}),
    },
    skills: extra.skills ?? {},
    assessments: extra.assessments ?? {},
  };
  const fake = createFakeTeamSkillStore(state);
  const superadmins = new Set(options.superadmin ?? []);
  const deps: TeamSkillDeps = {
    verifyToken: vi.fn().mockImplementation(async (token: string) => ({ uid: token, email: `${token}@example.test`, email_verified: true })),
    isSuperadmin: vi.fn(async (uid: string) => superadmins.has(uid)),
    store: fake.store,
    now: () => NOW,
  };
  return { ...fake, deps };
}

const validSkill = { name: "Testautomatisering", description: "Skriver og vedlikeholder tester", guidance: { "1": "Ser over" } };

/** Creates a skill as a team administrator and returns its id. Throws on setup failure so tests stay focused. */
async function createSkill(deps: TeamSkillDeps, body: unknown = validSkill, team = T, admin = ADMIN): Promise<string> {
  const created = await createTeamSkill(admin, team, body, deps);
  if (!created.ok) throw new Error(`setup failed: ${created.error}`);
  return created.skill.skillId;
}

describe("createTeamSkill", () => {
  it("lets a team administrator create an active skill with criteria version 1", async () => {
    const { deps, state } = setup();
    const result = await createTeamSkill(ADMIN, T, validSkill, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill).toMatchObject({ name: "Testautomatisering", active: true, criteriaVersion: 1, sortOrder: 0 });
    expect(state.skills[result.skill.skillId]).toMatchObject({ teamId: T, createdBy: ADMIN, updatedBy: ADMIN });
  });

  it("refuses a member, an outsider and a team administrator of another team", async () => {
    const { deps, state } = setup();
    expect(await createTeamSkill(MEMBER, T, validSkill, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await createTeamSkill(OUTSIDER, T, validSkill, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await createTeamSkill(OTHER_ADMIN, T, validSkill, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(Object.keys(state.skills)).toHaveLength(0);
  });

  it("lets a superadmin create a skill without a membership, but never for a disabled team", async () => {
    const { deps } = setup({ teams: { [T]: { status: "active" }, [OTHER]: { status: "disabled" } } }, { superadmin: ["root"] });
    expect((await createTeamSkill("root", T, validSkill, deps)).ok).toBe(true);
    expect(await createTeamSkill("root", OTHER, validSkill, deps)).toEqual({ ok: false, error: "team_disabled" });
  });

  it("rejects unknown keys, blank names and unknown guidance levels on the server", async () => {
    const { deps } = setup();
    expect(await createTeamSkill(ADMIN, T, { ...validSkill, role: "admin" }, deps)).toEqual({ ok: false, error: "invalid_request" });
    expect(await createTeamSkill(ADMIN, T, { ...validSkill, name: "   " }, deps)).toEqual({ ok: false, error: "invalid_input" });
    expect(await createTeamSkill(ADMIN, T, { ...validSkill, guidance: { "5": "fem" } }, deps)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses a duplicate of an active skill name within the same team, but allows it in another team", async () => {
    const { deps } = setup();
    await createSkill(deps);
    expect(await createTeamSkill(ADMIN, T, { ...validSkill, name: "  testautomatisering " }, deps)).toEqual({
      ok: false,
      error: "duplicate_name",
    });
    expect((await createTeamSkill(OTHER_ADMIN, OTHER, validSkill, deps)).ok).toBe(true);
  });
});

describe("updateTeamSkill", () => {
  it("bumps criteriaVersion only when guidance changes", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);

    expect(await updateTeamSkill(ADMIN, T, id, { name: "Testing" }, deps)).toMatchObject({
      ok: true,
      skill: { criteriaVersion: 1, name: "Testing" },
    });
    expect(await updateTeamSkill(ADMIN, T, id, { guidance: { "1": "Ny tekst" } }, deps)).toMatchObject({
      ok: true,
      skill: { criteriaVersion: 2 },
    });
  });

  it("deactivates and reactivates without touching stored assessments", async () => {
    const { deps, state } = setup();
    const id = await createSkill(deps);
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 3 }, deps);
    const before = JSON.stringify(state.assessments);

    expect(await updateTeamSkill(ADMIN, T, id, { active: false }, deps)).toMatchObject({ ok: true, skill: { active: false } });
    expect(JSON.stringify(state.assessments)).toBe(before);
    expect(await updateTeamSkill(ADMIN, T, id, { active: true }, deps)).toMatchObject({ ok: true, skill: { active: true } });
  });

  it("refuses to reactivate a skill whose name now duplicates an active one", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);
    await updateTeamSkill(ADMIN, T, id, { active: false }, deps);
    await createSkill(deps);
    expect(await updateTeamSkill(ADMIN, T, id, { active: true }, deps)).toEqual({ ok: false, error: "duplicate_name" });
  });

  it("reports another team's skill exactly like a missing one", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);
    expect(await updateTeamSkill(OTHER_ADMIN, OTHER, id, { name: "Stjålet" }, deps)).toEqual({ ok: false, error: "not_found" });
    expect(await updateTeamSkill(ADMIN, T, "doesnotexist", { name: "Ukjent" }, deps)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("own assessment of team skills", () => {
  it("lets a genuine member rate a team skill and stores the criteria version it was given under", async () => {
    const { deps, state } = setup();
    const id = await createSkill(deps);
    expect(await setOwnTeamSkillLevel(MEMBER, T, id, { level: 2 }, deps)).toEqual({ ok: true, skillId: id, level: 2, criteriaVersion: 1 });
    expect(state.assessments[`${MEMBER}__${id}`]).toMatchObject({ uid: MEMBER, teamId: T, skillId: id, level: 2, criteriaVersion: 1 });
  });

  it("keeps the original creation time when a rating is changed", async () => {
    const { deps, state } = setup();
    const id = await createSkill(deps);
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 2 }, deps);
    const earlier = new Date("2026-01-01T00:00:00Z");
    state.assessments[`${MEMBER}__${id}`] = { ...state.assessments[`${MEMBER}__${id}`], createdAt: earlier };
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 4 }, deps);
    expect(state.assessments[`${MEMBER}__${id}`]).toMatchObject({ level: 4, createdAt: earlier, updatedAt: NOW });
  });

  it("refuses a rating from an outsider, from a member of another team, and for an out-of-range level", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);
    expect(await setOwnTeamSkillLevel(OUTSIDER, T, id, { level: 2 }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await setOwnTeamSkillLevel(MEMBER, OTHER, id, { level: 2 }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(await setOwnTeamSkillLevel(MEMBER, T, id, { level: 5 }, deps)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses new ratings of an inactive skill and keeps the stored rating as history", async () => {
    const { deps, state } = setup();
    const id = await createSkill(deps);
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 4 }, deps);
    await updateTeamSkill(ADMIN, T, id, { active: false }, deps);

    expect(await setOwnTeamSkillLevel(MEMBER, T, id, { level: 1 }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(await clearOwnTeamSkillLevel(MEMBER, T, id, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(state.assessments[`${MEMBER}__${id}`]).toMatchObject({ level: 4, criteriaVersion: 1 });
  });

  it("flags a rating as outdated after the guidance changed, without changing the rating", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 3 }, deps);
    await updateTeamSkill(ADMIN, T, id, { guidance: { "3": "Strengere krav" } }, deps);

    expect(await listTeamSkills(MEMBER, T, deps)).toMatchObject({
      ok: true,
      own: [{ skillId: id, level: 3, criteriaVersion: 1, outdated: true }],
    });
  });

  it("clears a rating idempotently and leaves other ratings alone", async () => {
    const { deps, state } = setup();
    const id = await createSkill(deps);
    const other = await createSkill(deps, { name: "Kubernetes" });
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 2 }, deps);
    await setOwnTeamSkillLevel(MEMBER, T, other, { level: 4 }, deps);

    expect(await clearOwnTeamSkillLevel(MEMBER, T, id, deps)).toEqual({ ok: true, skillId: id, cleared: true });
    expect(await clearOwnTeamSkillLevel(MEMBER, T, id, deps)).toEqual({ ok: true, skillId: id, cleared: false });
    expect(state.assessments[`${MEMBER}__${id}`]).toBeUndefined();
    expect(state.assessments[`${MEMBER}__${other}`]).toMatchObject({ level: 4 });
  });

  it("refuses to overwrite an unreadable rating instead of repairing it", async () => {
    const { deps, state } = setup();
    const id = await createSkill(deps);
    state.assessments[`${MEMBER}__${id}`] = { uid: MEMBER, teamId: T, skillId: id, level: "high" };
    expect(await setOwnTeamSkillLevel(MEMBER, T, id, { level: 2 }, deps)).toEqual({ ok: false, error: "assessment_unreadable" });
    expect(state.assessments[`${MEMBER}__${id}`]).toEqual({ uid: MEMBER, teamId: T, skillId: id, level: "high" });
  });
});

describe("listTeamSkills", () => {
  it("returns definitions and canEdit for an administrator, and never another person's rating", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 4 }, deps);
    expect(await listTeamSkills(ADMIN, T, deps)).toMatchObject({ ok: true, canEdit: true, own: [] });
  });

  it("gives a plain member read access and their own ratings, but no edit right", async () => {
    const { deps } = setup();
    const id = await createSkill(deps);
    await setOwnTeamSkillLevel(MEMBER, T, id, { level: 1 }, deps);
    expect(await listTeamSkills(MEMBER, T, deps)).toMatchObject({
      ok: true,
      canEdit: false,
      own: [{ skillId: id, level: 1 }],
    });
  });

  it("refuses an outsider and an unauthenticated caller", async () => {
    const { deps } = setup();
    expect(await listTeamSkills(OUTSIDER, T, deps)).toEqual({ ok: false, error: "forbidden" });
    const unauth = { ...deps, verifyToken: vi.fn().mockRejectedValue(new Error("bad token")) };
    expect(await listTeamSkills("bad", T, unauth)).toEqual({ ok: false, error: "unauthenticated" });
  });
});
