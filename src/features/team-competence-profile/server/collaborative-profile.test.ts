import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createCollaborativeProfile, type CollaborativeProfileStore, type RawDoc } from "./collaborative-profile";
import { collaborativeLevelDocId, type CollaborativeLevelRecord, type ProfileSettingsRecord } from "../domain/collaborative-records";
import { competenceAreaDocId } from "../../team-competence-catalog/domain/competence-area";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-01T09:00:00Z");
const EARLIER = new Date("2026-05-01T09:00:00Z");
const TREE = "tree-alpha";
const TREE_ARCHIVED = "tree-old";

const TEAMS: Record<string, unknown> = { "team-1": "active", "team-2": "active", "team-off": "disabled" };
const MEMBERSHIPS: Array<Record<string, unknown>> = [
  { uid: "uid-lead", teamId: "team-1", memberRef: "0123456789abcdefghjkmnpqrs", createdAt: EARLIER, role: "teamadmin" },
  { uid: "uid-member", teamId: "team-1", memberRef: "tvwxyz0123456789abcdefghjk", createdAt: EARLIER, role: "member" },
  { uid: "uid-lead-2", teamId: "team-2", memberRef: "mnpqrstvwxyz0123456789abcd", createdAt: EARLIER, role: "teamadmin" },
  { uid: "uid-lead-off", teamId: "team-off", memberRef: "0123456789abcdefghjkmnpqrs", createdAt: EARLIER, role: "teamadmin" },
];

interface World {
  settings?: Map<string, unknown>;
  levels?: Map<string, unknown>;
  areas?: Map<string, { status: string }>;
}

function world(extra: World = {}) {
  const settings = extra.settings ?? new Map<string, unknown>();
  const levels = extra.levels ?? new Map<string, unknown>();
  const areas =
    extra.areas ??
    new Map<string, { status: string }>([
      [competenceAreaDocId("team-1", TREE), { status: "active" }],
      [competenceAreaDocId("team-1", TREE_ARCHIVED), { status: "archived" }],
    ]);
  const counts = { settingsWrites: 0, levelWrites: 0 };

  const store: CollaborativeProfileStore = {
    async getSettings(teamId) {
      return settings.get(teamId);
    },
    async setSettings(teamId, record: ProfileSettingsRecord) {
      counts.settingsWrites += 1;
      settings.set(teamId, record);
    },
    async listLevels(teamId, limit) {
      const docs: RawDoc[] = [];
      for (const [id, data] of levels) {
        if ((data as { teamId?: string }).teamId === teamId) docs.push({ id, data });
      }
      return docs.slice(0, limit);
    },
    async writeLevelIfActiveArea(teamId, treeId, record: CollaborativeLevelRecord | null) {
      if (areas.get(competenceAreaDocId(teamId, treeId))?.status !== "active") return "area_not_active" as const;
      counts.levelWrites += 1;
      const id = collaborativeLevelDocId(teamId, treeId);
      if (record === null) levels.delete(id);
      else levels.set(id, record);
      return "written" as const;
    },
  };

  const profile = createCollaborativeProfile({
    store,
    now: () => NOW,
    verifyToken: vi.fn(async (token: string) => {
      const uid = token.replace(/^token-/, "");
      return { uid, email: `${uid}@example.test`, email_verified: true };
    }) as never,
    membership: {
      isSuperadmin: async () => false,
      reads: {
        async getTeamStatus(teamId) {
          return TEAMS[teamId];
        },
        async getMembership(uid, teamId) {
          return MEMBERSHIPS.find((m) => m.uid === uid && m.teamId === teamId);
        },
      },
    },
  });
  return { profile, settings, levels, counts };
}

describe("team profile mode", () => {
  it("defaults to automatic when no mode has been stored", async () => {
    const { profile } = world();
    expect(await profile.getTeamProfile("token-uid-member", "team-1")).toEqual({ ok: true, mode: "automatic", levels: [] });
  });

  it("lets a teamadmin save the mode and returns it on the next read (persists across reloads)", async () => {
    const w = world();
    expect(await w.profile.setTeamProfileMode("token-uid-lead", "team-1", { mode: "collaborative" })).toEqual({
      ok: true,
      mode: "collaborative",
    });
    expect(w.settings.get("team-1")).toEqual({ teamId: "team-1", mode: "collaborative", updatedAt: NOW });
    expect(await w.profile.getTeamProfile("token-uid-member", "team-1")).toMatchObject({ ok: true, mode: "collaborative" });
  });

  it("refuses an ordinary member's mode write and writes nothing", async () => {
    const w = world();
    expect(await w.profile.setTeamProfileMode("token-uid-member", "team-1", { mode: "collaborative" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(w.counts.settingsWrites).toBe(0);
  });

  it("refuses a teamadmin of another team, so cross-team settings cannot change", async () => {
    const w = world();
    expect(await w.profile.setTeamProfileMode("token-uid-lead-2", "team-1", { mode: "collaborative" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(w.settings.has("team-1")).toBe(false);
  });

  it("refuses a teamadmin write on a disabled team", async () => {
    const w = world();
    expect(await w.profile.setTeamProfileMode("token-uid-lead-off", "team-off", { mode: "collaborative" })).toEqual({
      ok: false,
      error: "team_disabled",
    });
  });

  it.each([
    [{ mode: "manual" }, "invalid_input"],
    [{ mode: 1 }, "invalid_input"],
    [{}, "invalid_request"],
    [{ mode: "collaborative", extra: true }, "invalid_request"],
    [null, "invalid_request"],
  ])("rejects the malformed body %j with %s and writes nothing", async (body, error) => {
    const w = world();
    expect(await w.profile.setTeamProfileMode("token-uid-lead", "team-1", body)).toEqual({ ok: false, error });
    expect(w.counts.settingsWrites).toBe(0);
  });

  it("fails closed when the stored mode is invalid instead of defaulting it", async () => {
    const w = world({ settings: new Map([["team-1", { teamId: "team-1", mode: "manual", updatedAt: NOW }]]) });
    expect(await w.profile.getTeamProfile("token-uid-member", "team-1")).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("collaborative team levels", () => {
  it("lets a teamadmin set an integer 1–4 on an active area", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, { level: 3 })).toEqual({
      ok: true,
      treeId: TREE,
      level: 3,
    });
    expect(w.levels.get(collaborativeLevelDocId("team-1", TREE))).toEqual({
      teamId: "team-1",
      treeId: TREE,
      level: 3,
      updatedAt: NOW,
    });
  });

  it("shows the saved value to members after reload, without any member identity", async () => {
    const w = world();
    await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, { level: 2 });
    const view = await w.profile.getTeamProfile("token-uid-member", "team-1");
    expect(view).toEqual({ ok: true, mode: "automatic", levels: [{ treeId: TREE, level: 2 }] });
    expect(JSON.stringify(view)).not.toMatch(/uid|memberRef|email/);
  });

  it("keeps the team value when the mode changes", async () => {
    const w = world();
    await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, { level: 4 });
    await w.profile.setTeamProfileMode("token-uid-lead", "team-1", { mode: "collaborative" });
    await w.profile.setTeamProfileMode("token-uid-lead", "team-1", { mode: "automatic" });
    expect(await w.profile.getTeamProfile("token-uid-member", "team-1")).toMatchObject({ levels: [{ treeId: TREE, level: 4 }] });
  });

  it("clears the team value on null", async () => {
    const w = world();
    await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, { level: 1 });
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, { level: null })).toEqual({
      ok: true,
      treeId: TREE,
      level: null,
    });
    expect(await w.profile.getTeamProfile("token-uid-member", "team-1")).toMatchObject({ levels: [] });
  });

  it("refuses an ordinary member's level write and writes nothing", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-member", "team-1", TREE, { level: 3 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(w.counts.levelWrites).toBe(0);
  });

  it("refuses a teamadmin of another team", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead-2", "team-1", TREE, { level: 3 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(w.counts.levelWrites).toBe(0);
  });

  it.each([
    [0],
    [5],
    [2.5],
    ["3"],
    [NaN],
    [undefined],
  ])("rejects the invalid level %s with invalid_input and writes nothing", async (level) => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, { level })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(w.counts.levelWrites).toBe(0);
  });

  it("rejects a body without the level key as invalid_request", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE, {})).toEqual({ ok: false, error: "invalid_request" });
    expect(w.counts.levelWrites).toBe(0);
  });

  it("rejects a malformed tree id before any write", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", "../etc", { level: 2 })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(w.counts.levelWrites).toBe(0);
  });

  it("refuses a value for an archived area, so an archived assignment cannot receive one", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", TREE_ARCHIVED, { level: 2 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(w.counts.levelWrites).toBe(0);
  });

  it("refuses a value for an area the team has not assigned", async () => {
    const w = world();
    expect(await w.profile.setCollaborativeLevel("token-uid-lead", "team-1", "tree-unassigned", { level: 2 })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("fails closed when a stored level is malformed", async () => {
    const levels = new Map<string, unknown>([
      [collaborativeLevelDocId("team-1", TREE), { teamId: "team-1", treeId: TREE, level: 9, updatedAt: NOW }],
    ]);
    const w = world({ levels });
    expect(await w.profile.getTeamProfile("token-uid-member", "team-1")).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("independence from member data", () => {
  it("the gateway imports no member profile, contribution or participation module", () => {
    const source = readFileSync(new URL("./collaborative-profile.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/skill-profiles\/server|team-skills\/|skillProfiles|read-skill-levels/);
  });
});
