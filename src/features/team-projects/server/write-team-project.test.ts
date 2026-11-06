import { describe, expect, it, vi } from "vitest";
import { writeTeamProject, type WriteTeamProjectDeps, type WriteTeamProjectTx } from "./write-team-project";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

vi.mock("../../auth/server/erasure-write-fence", () => ({
  runFencedTransaction: vi.fn(),
  writeRefusalFor: () => "persistence_failed",
}));

const NOW = new Date("2026-06-01T09:00:00Z");
const EARLIER = new Date("2026-05-01T09:00:00Z");

interface World {
  teams?: Record<string, unknown>;
  /** UIDs that are active registry superadmins for this test world. */
  superadmins?: string[];
  memberships?: Array<Record<string, unknown>>;
  projects?: Record<string, Record<string, unknown>>;
}

interface Writes {
  created: Array<{ id: string; data: Record<string, unknown> }>;
  set: Array<{ id: string; data: Record<string, unknown> }>;
}

function membership(uid: string, teamId: string, role: "teamadmin" | "member" = "member") {
  return { uid, teamId, memberRef: `ref-${uid}`, createdAt: EARLIER, role };
}

function storedProject(extra: Record<string, unknown> = {}) {
  return {
    teamId: "team-1",
    title: "Betalingsløsning",
    startDate: "2026-06-01",
    endDate: "2026-09-30",
    lifecycleStatus: "planned",
    priority: "high",
    archived: false,
    archivedAt: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...extra,
  };
}

function build(world: World, callerUid = "uid-lead", options: { verifyFails?: boolean; newId?: string } = {}) {
  const writes: Writes = { created: [], set: [] };
  const tx: WriteTeamProjectTx = {
    async getMembership(uid, teamId) {
      return (world.memberships ?? []).find((m) => m.uid === uid && m.teamId === teamId);
    },
    async getTeamStatus(teamId) {
      return world.teams?.[teamId];
    },
    async getProject(projectId) {
      const found = world.projects?.[projectId];
      return found === undefined ? undefined : { projectId, ...found };
    },
    createProject(id, data) {
      writes.created.push({ id, data });
    },
    setProject(id, data) {
      writes.set.push({ id, data });
    },
  };
  const deps: WriteTeamProjectDeps = {
    verifyToken: options.verifyFails
      ? vi.fn().mockRejectedValue(new Error("bad token"))
      : vi.fn().mockResolvedValue({ uid: callerUid, email: `${callerUid}@example.test`, email_verified: true }),
    store: {
      async runWriteTransaction(_actor, fn) {
        return fn(tx);
      },
    },
    now: () => NOW,
    newProjectId: () => options.newId ?? "proj-new",
    isSuperadmin: async (uid: string) => (world.superadmins ?? []).includes(uid),
  };
  return { deps, writes };
}

const world = (extra: World = {}): World => ({
  teams: { "team-1": "active", "team-2": "active" },
  memberships: [membership("uid-lead", "team-1", "teamadmin"), membership("uid-member", "team-1"), membership("uid-lead-2", "team-2", "teamadmin")],
  projects: { "proj-1": storedProject() },
  ...extra,
});

const validCreate = {
  title: "  Ny betalingsløsning ",
  startDate: "2026-06-01",
  endDate: "2026-09-30",
  lifecycleStatus: "planned",
  priority: "high",
};

describe("writeTeamProject — authorization", () => {
  it("lets a lead of an active team create a project scoped to that team", async () => {
    const { deps, writes } = build(world());
    const result = await writeTeamProject("token", "team-1", "create", null, validCreate, deps);

    expect(result).toEqual({
      ok: true,
      project: expect.objectContaining({ projectId: "proj-new", title: "Ny betalingsløsning", archived: false, effectiveStatus: "active" }),
    });
    expect(writes.created).toHaveLength(1);
    expect(writes.created[0].data).toMatchObject({ teamId: "team-1", title: "Ny betalingsløsning", archived: false });
  });

  it("refuses a plain member, even of the same team", async () => {
    const { deps, writes } = build(world(), "uid-member");
    expect(await writeTeamProject("token", "team-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses a lead of another team (cross-team isolation)", async () => {
    const { deps, writes } = build(world(), "uid-lead-2");
    expect(await writeTeamProject("token", "team-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses a non-member, even one who is listed as a lead elsewhere", async () => {
    const { deps } = build(world(), "uid-outsider");
    expect(await writeTeamProject("token", "team-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses writes to a disabled team", async () => {
    const { deps, writes } = build(world({ teams: { "team-1": "disabled" } }));
    expect(await writeTeamProject("token", "team-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "team_disabled" });
    expect(writes.created).toHaveLength(0);
  });

  it("returns unauthenticated when the token does not verify, without any write", async () => {
    const { deps, writes } = build(world(), "uid-lead", { verifyFails: true });
    const result = await writeTeamProject("bad", "team-1", "create", null, validCreate, deps);
    expect(result.ok).toBe(false);
    expect(writes.created).toHaveLength(0);
  });
});

describe("writeTeamProject — validation", () => {
  it("rejects unknown keys, including a product link, with invalid_request", async () => {
    const { deps } = build(world());
    expect(await writeTeamProject("token", "team-1", "create", null, { ...validCreate, productId: "p-1" }, deps)).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });

  it("rejects a non-object envelope", async () => {
    const { deps } = build(world());
    expect(await writeTeamProject("token", "team-1", "create", null, "x", deps)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("reports every invalid create field together", async () => {
    const { deps, writes } = build(world());
    const result = await writeTeamProject("token", "team-1", "create", null, { title: "", startDate: "2026-02-30", endDate: "2026-01-01", priority: "x", lifecycleStatus: "planned" }, deps);
    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      // An invalid start date suppresses the order check, so the end date is only reported when it is itself invalid.
      issues: ["title_required", "start_date_invalid", "priority_invalid"],
    });
    expect(writes.created).toHaveLength(0);
  });

  it("validates the merged result on update, so a date change cannot invert the stored range", async () => {
    const { deps, writes } = build(world());
    const result = await writeTeamProject("token", "team-1", "update", "proj-1", { endDate: "2026-05-01" }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input", issues: ["end_before_start"] });
    expect(writes.set).toHaveLength(0);
  });

  it("does not allow archive or restore to carry a body", async () => {
    const { deps } = build(world());
    expect(await writeTeamProject("token", "team-1", "archive", "proj-1", { title: "x" }, deps)).toEqual({ ok: false, error: "invalid_request" });
  });
});

describe("writeTeamProject — team ownership of existing projects", () => {
  it("does not update a project that belongs to another team (not_found, no write)", async () => {
    const { deps, writes } = build(world({ projects: { "proj-other": storedProject({ teamId: "team-2" }) } }));
    expect(await writeTeamProject("token", "team-1", "update", "proj-other", { title: "Ny" }, deps)).toEqual({ ok: false, error: "not_found" });
    expect(writes.set).toHaveLength(0);
  });

  it("reports not_found for an unknown project id", async () => {
    const { deps } = build(world());
    expect(await writeTeamProject("token", "team-1", "update", "missing", { title: "Ny" }, deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("fails closed on a malformed stored record instead of defaulting it", async () => {
    const { deps, writes } = build(world({ projects: { "proj-1": storedProject({ priority: "urgent" }) } }));
    expect(await writeTeamProject("token", "team-1", "update", "proj-1", { title: "Ny" }, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(writes.set).toHaveLength(0);
  });
});

describe("writeTeamProject — update, archive and restore", () => {
  it("updates allowed fields and keeps the stored team and creation time", async () => {
    const { deps, writes } = build(world());
    const result = await writeTeamProject("token", "team-1", "update", "proj-1", { title: "Ny tittel", lifecycleStatus: "completed" }, deps);
    expect(result).toMatchObject({ ok: true, project: { projectId: "proj-1", title: "Ny tittel", lifecycleStatus: "completed", effectiveStatus: "completed" } });
    expect(writes.set[0].data).toMatchObject({ teamId: "team-1", title: "Ny tittel", createdAt: EARLIER, updatedAt: NOW, archived: false });
  });

  it("archives a project, recording the archive time, and keeps all other fields", async () => {
    const { deps, writes } = build(world());
    const result = await writeTeamProject("token", "team-1", "archive", "proj-1", undefined, deps);
    expect(result).toMatchObject({ ok: true, project: { projectId: "proj-1", archived: true } });
    expect(writes.set[0].data).toMatchObject({ archived: true, archivedAt: NOW, title: "Betalingsløsning", startDate: "2026-06-01" });
  });

  it("restores an archived project and clears its archive time", async () => {
    const { deps, writes } = build(world({ projects: { "proj-1": storedProject({ archived: true, archivedAt: EARLIER }) } }));
    const result = await writeTeamProject("token", "team-1", "restore", "proj-1", undefined, deps);
    expect(result).toMatchObject({ ok: true, project: { archived: false } });
    expect(writes.set[0].data).toMatchObject({ archived: false, archivedAt: null });
  });

  it("refuses to edit an archived project until it is restored", async () => {
    const { deps, writes } = build(world({ projects: { "proj-1": storedProject({ archived: true, archivedAt: EARLIER }) } }));
    expect(await writeTeamProject("token", "team-1", "update", "proj-1", { title: "Ny" }, deps)).toEqual({ ok: false, error: "project_archived" });
    expect(writes.set).toHaveLength(0);
  });

  it("refuses an action with a missing or unexpected project id", async () => {
    const { deps } = build(world());
    expect(await writeTeamProject("token", "team-1", "create", "proj-1", validCreate, deps)).toEqual({ ok: false, error: "invalid_request" });
    expect(await writeTeamProject("token", "team-1", "update", null, { title: "x" }, deps)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("never stores an actor uid on a project", async () => {
    const { deps, writes } = build(world());
    await writeTeamProject("token", "team-1", "create", null, validCreate, deps);
    await writeTeamProject("token", "team-1", "update", "proj-1", { title: "Ny" }, deps);
    for (const entry of [...writes.created, ...writes.set]) {
      expect(Object.keys(entry.data)).not.toEqual(expect.arrayContaining(["createdBy", "updatedBy", "archivedBy"]));
    }
  });
});
