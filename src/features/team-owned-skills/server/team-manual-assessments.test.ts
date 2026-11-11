import { describe, expect, it, vi } from "vitest";
import { createFakeTeamSkillStore, type FakeTeamSkillState } from "./fake-team-skill-store";
import { createTeamSkill, updateTeamSkill, type TeamSkillDeps } from "./manage-team-skills";
import {
  clearTeamManualAssessment,
  listTeamManualAssessments,
  setTeamManualAssessment,
} from "./manage-team-manual-assessments";

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
function setup(extra: Partial<FakeTeamSkillState> = {}) {
  const state: Partial<FakeTeamSkillState> = {
    teams: { [T]: { status: "active" }, [OTHER]: { status: "active" } },
    memberships: {
      [`${ADMIN}__${T}`]: { uid: ADMIN, teamId: T, role: "teamadmin" },
      [`${MEMBER}__${T}`]: { uid: MEMBER, teamId: T },
      [`${OTHER_ADMIN}__${OTHER}`]: { uid: OTHER_ADMIN, teamId: OTHER, role: "teamadmin" },
    },
    skills: extra.skills ?? {},
    assessments: extra.assessments ?? {},
    manualAssessments: extra.manualAssessments ?? {},
  };
  const fake = createFakeTeamSkillStore(state);
  const deps: TeamSkillDeps = {
    verifyToken: vi.fn().mockImplementation(async (token: string) => ({ uid: token, email: `${token}@example.test`, email_verified: true })),
    isSuperadmin: vi.fn(async () => false),
    store: fake.store,
    now: () => NOW,
  };
  return { ...fake, deps };
}

async function createSkill(deps: TeamSkillDeps, name = "Testautomatisering", team = T, admin = ADMIN): Promise<string> {
  const created = await createTeamSkill(admin, team, { name, description: "Synthetisk kompetanseområde" }, deps);
  if (!created.ok) throw new Error(`setup failed: ${created.error}`);
  return created.skill.skillId;
}

describe("setTeamManualAssessment", () => {
  it("lets a team administrator record the agreed level, note and criteria version, with actor audit", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);

    const result = await setTeamManualAssessment(ADMIN, T, skillId, { level: 3, note: "  Enighet i teamet  " }, deps);

    expect(result).toEqual({ ok: true, skillId, level: 3, criteriaVersion: 1 });
    expect(state.manualAssessments?.[`${T}__${skillId}`]).toMatchObject({
      teamId: T,
      skillId,
      level: 3,
      note: "Enighet i teamet",
      criteriaVersion: 1,
      updatedBy: ADMIN,
    });
  });

  it("refuses a member, an outsider and a team administrator of another team, and writes nothing", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);

    expect(await setTeamManualAssessment(MEMBER, T, skillId, { level: 2 }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await setTeamManualAssessment(OUTSIDER, T, skillId, { level: 2 }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await setTeamManualAssessment(OTHER_ADMIN, T, skillId, { level: 2 }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(Object.keys(state.manualAssessments ?? {})).toHaveLength(0);
  });

  it.each([{ level: 0 }, { level: 5 }, { level: "3" }, { level: 2.5 }, {}, { level: 2, extra: true }])(
    "refuses an invalid body %j and writes nothing",
    async (body) => {
      const { deps, state } = setup();
      const skillId = await createSkill(deps);

      const result = await setTeamManualAssessment(ADMIN, T, skillId, body, deps);

      expect(result.ok).toBe(false);
      expect(Object.keys(state.manualAssessments ?? {})).toHaveLength(0);
    },
  );

  it("refuses a note over 300 characters rather than truncating it", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);

    expect(await setTeamManualAssessment(ADMIN, T, skillId, { level: 1, note: "x".repeat(301) }, deps)).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(Object.keys(state.manualAssessments ?? {})).toHaveLength(0);
  });

  it("refuses a skill that is inactive or belongs to another team", async () => {
    const { deps, state } = setup();
    const inactive = await createSkill(deps, "Inaktiv");
    const other = await createSkill(deps, "Annet lag", OTHER, OTHER_ADMIN);
    const skillDoc = state.skills[inactive] as Record<string, unknown>;
    state.skills[inactive] = { ...skillDoc, active: false };

    expect(await setTeamManualAssessment(ADMIN, T, inactive, { level: 2 }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(await setTeamManualAssessment(ADMIN, T, other, { level: 2 }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
    expect(await setTeamManualAssessment(ADMIN, T, "not/valid", { level: 2 }, deps)).toEqual({ ok: false, error: "skill_unavailable" });
  });

  it("does not change any individual self-assessment", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);
    const individual = { [`${MEMBER}__${skillId}`]: { uid: MEMBER, teamId: T, skillId, level: 1, criteriaVersion: 1 } };
    state.assessments = { ...individual };

    await setTeamManualAssessment(ADMIN, T, skillId, { level: 4 }, deps);

    expect(state.assessments).toEqual(individual);
  });
});

describe("listTeamManualAssessments", () => {
  it("shows the agreed level to a member without any actor identity, and marks it outdated after a guidance change", async () => {
    const { deps } = setup();
    const skillId = await createSkill(deps);
    await setTeamManualAssessment(ADMIN, T, skillId, { level: 3 }, deps);
    await updateTeamSkill(ADMIN, T, skillId, { guidance: { "3": "Nytt kriterium" } }, deps);

    const result = await listTeamManualAssessments(MEMBER, T, deps);

    expect(result).toMatchObject({ ok: true, canEdit: false, assessments: [{ skillId, name: "Testautomatisering", level: 3, outdated: true }] });
    expect(JSON.stringify(result)).not.toContain(ADMIN);
    expect(JSON.stringify(result)).not.toContain("updatedBy");
  });

  it("omits inactive skills from the profile but keeps their stored values", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);
    await setTeamManualAssessment(ADMIN, T, skillId, { level: 2 }, deps);
    state.skills[skillId] = { ...(state.skills[skillId] as Record<string, unknown>), active: false };

    const result = await listTeamManualAssessments(MEMBER, T, deps);

    expect(result).toEqual({ ok: true, canEdit: false, assessments: [] });
    expect(state.manualAssessments?.[`${T}__${skillId}`]).toBeDefined();
  });

  it("tells only an administrator that the profile can be edited", async () => {
    const { deps } = setup();
    await createSkill(deps);

    expect(await listTeamManualAssessments(ADMIN, T, deps)).toMatchObject({ ok: true, canEdit: true });
  });

  it("refuses a non-member and a team administrator of another team", async () => {
    const { deps } = setup();
    await createSkill(deps);

    expect(await listTeamManualAssessments(OUTSIDER, T, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await listTeamManualAssessments(OTHER_ADMIN, T, deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("fails closed when a stored manual value is malformed, with no partial list", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);
    await setTeamManualAssessment(ADMIN, T, skillId, { level: 2 }, deps);
    state.manualAssessments![`${T}__${skillId}`] = { ...state.manualAssessments![`${T}__${skillId}`], level: 9 };

    expect(await listTeamManualAssessments(MEMBER, T, deps)).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("clearTeamManualAssessment", () => {
  it("removes the agreed level for an administrator and is idempotent", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);
    await setTeamManualAssessment(ADMIN, T, skillId, { level: 2 }, deps);

    expect(await clearTeamManualAssessment(ADMIN, T, skillId, deps)).toEqual({ ok: true, skillId, cleared: true });
    expect(state.manualAssessments?.[`${T}__${skillId}`]).toBeUndefined();
    expect(await clearTeamManualAssessment(ADMIN, T, skillId, deps)).toEqual({ ok: true, skillId, cleared: false });
  });

  it("refuses a member", async () => {
    const { deps, state } = setup();
    const skillId = await createSkill(deps);
    await setTeamManualAssessment(ADMIN, T, skillId, { level: 2 }, deps);

    expect(await clearTeamManualAssessment(MEMBER, T, skillId, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(state.manualAssessments?.[`${T}__${skillId}`]).toBeDefined();
  });
});
