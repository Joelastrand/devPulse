import { describe, expect, it, vi } from "vitest";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import {
  writeProjectParticipation,
  type WriteProjectParticipationDeps,
  type WriteProjectParticipationTx,
} from "./write-project-participation";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

vi.mock("../../auth/server/erasure-write-fence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auth/server/erasure-write-fence")>();
  return { ...actual, runFencedTransaction: vi.fn() };
});

// Synthetic member references: 26 characters of the opaque alphabet, never derived from uids.
const REF_A = "0123456789abcdefghjkmnpqrs";
const REF_B = "tvwxyz0123456789abcdefghjk";
const REF_OUTSIDER = "mnpqrstvwxyz0123456789abcd";

interface World {
  /** UIDs that are active registry superadmins for this test world. */
  superadmins?: string[];
  teams?: Record<string, unknown>;
  memberships?: Array<Record<string, unknown>>;
  projects?: Record<string, Record<string, unknown>>;
  participations?: Record<string, Record<string, unknown>>;
}

interface Writes {
  created: Array<{ id: string; data: Record<string, unknown> }>;
  set: Array<{ id: string; data: Record<string, unknown> }>;
  touched: Array<{ uid: string; teamId: string; memberRef: string }>;
}

function membership(uid: string, teamId: string, memberRef: string, role: "teamadmin" | "member" = "member") {
  return { uid, teamId, memberRef, createdAt: new Date("2026-05-01T09:00:00Z"), role };
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
    createdAt: new Date("2026-05-01T09:00:00Z"),
    updatedAt: new Date("2026-05-01T09:00:00Z"),
    ...extra,
  };
}

function storedParticipation(extra: Record<string, unknown> = {}) {
  return {
    teamId: "team-1",
    projectId: "proj-1",
    memberRef: REF_A,
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    archived: false,
    ...extra,
  };
}

const DEFAULT_WORLD: World = {
  teams: { "team-1": "active", "team-2": "active" },
  memberships: [
    membership("uid-lead", "team-1", REF_B, "teamadmin"),
    membership("uid-member", "team-1", REF_A),
    membership("uid-lead-2", "team-2", "mnpqrstvwxyz0123456789abcd", "teamadmin"),
  ],
  projects: { "proj-1": storedProject(), "proj-archived": storedProject({ archived: true, archivedAt: new Date("2026-05-20T09:00:00Z") }), "proj-other": storedProject({ teamId: "team-2" }) },
  participations: {},
};

function world(extra: World = {}): World {
  return { ...DEFAULT_WORLD, ...extra };
}

function build(w: World, callerUid = "uid-lead", options: { verifyFails?: boolean; newId?: string; fenceRefuses?: boolean } = {}) {
  const writes: Writes = { created: [], set: [], touched: [] };
  const participations = { ...(w.participations ?? {}) };
  const tx: WriteProjectParticipationTx = {
    async getMembership(uid, teamId) {
      return (w.memberships ?? []).find((m) => m.uid === uid && m.teamId === teamId);
    },
    async getTeamStatus(teamId) {
      return w.teams?.[teamId];
    },
    async getProject(projectId) {
      const found = w.projects?.[projectId];
      return found === undefined ? undefined : { projectId, ...found };
    },
    async getParticipation(participationId) {
      const found = participations[participationId];
      return found === undefined ? undefined : { participationId, ...found };
    },
    async listMembershipsByRefs(teamId, refs) {
      return (w.memberships ?? []).filter((m) => m.teamId === teamId && refs.includes(m.memberRef as string));
    },
    async listParticipationsOfMember(teamId, memberRef, limit) {
      return Object.entries(participations)
        .filter(([, p]) => p.teamId === teamId && p.memberRef === memberRef)
        .slice(0, limit)
        .map(([participationId, p]) => ({ participationId, ...p }));
    },
    createParticipation(id, data) {
      writes.created.push({ id, data });
      participations[id] = data;
    },
    setParticipation(id, data) {
      writes.set.push({ id, data });
      participations[id] = data;
    },
    touchMembership(uid, teamId, memberRef) {
      writes.touched.push({ uid, teamId, memberRef });
    },
  };
  const deps: WriteProjectParticipationDeps = {
    verifyToken: options.verifyFails
      ? vi.fn().mockRejectedValue(new Error("bad token"))
      : vi.fn().mockResolvedValue({ uid: callerUid, email: `${callerUid}@example.test`, email_verified: true }),
    store: {
      async runWriteTransaction(_actor, fn) {
        if (options.fenceRefuses) throw new ErasureWriteRefused();
        return fn(tx);
      },
    },
    newParticipationId: () => options.newId ?? "part-new",
    isSuperadmin: async (uid: string) => (w.superadmins ?? []).includes(uid),
  };
  return { deps, writes };
}

const validCreate = { memberRef: REF_A, startDate: "2026-07-01", endDate: "2026-07-31", note: "  Planlagt kapasitet  " };

describe("writeProjectParticipation — authorization", () => {
  it("lets a lead of an active team create a participation for a same-team member and project", async () => {
    const { deps, writes } = build(world());
    const result = await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps);

    expect(result).toEqual({
      ok: true,
      participation: {
        participationId: "part-new",
        projectId: "proj-1",
        memberRef: REF_A,
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        note: "Planlagt kapasitet",
        archived: false,
        overlapsOther: false,
      },
    });
    expect(writes.created).toHaveLength(1);
    expect(writes.created[0].data).toMatchObject({ teamId: "team-1", projectId: "proj-1", memberRef: REF_A, archived: false });
    expect(writes.created[0].data).not.toHaveProperty("uid");
    expect(writes.touched).toEqual([{ uid: "uid-member", teamId: "team-1", memberRef: REF_A }]);
  });

  it("refuses a plain member, even of the same team", async () => {
    const { deps, writes } = build(world(), "uid-member");
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses a lead of another team (cross-team isolation)", async () => {
    const { deps, writes } = build(world(), "uid-lead-2");
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.created).toHaveLength(0);
  });

  it("refuses writes to a disabled team", async () => {
    const { deps, writes } = build(world({ teams: { "team-1": "disabled" } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps)).toEqual({ ok: false, error: "team_disabled" });
    expect(writes.created).toHaveLength(0);
  });

  it("returns an authentication refusal without any write when the token does not verify", async () => {
    const { deps, writes } = build(world(), "uid-lead", { verifyFails: true });
    const result = await writeProjectParticipation("bad", "team-1", "proj-1", "create", null, validCreate, deps);
    expect(result.ok).toBe(false);
    expect(writes.created).toHaveLength(0);
  });

  it("refuses every write with erasure_in_progress when the erasure fence refuses the actor", async () => {
    const { deps, writes } = build(world(), "uid-lead", { fenceRefuses: true });
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps)).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(writes.created).toHaveLength(0);
  });
});

describe("writeProjectParticipation — member and project references", () => {
  it("rejects a member reference that belongs to another team", async () => {
    const { deps, writes } = build(world({ memberships: [...(DEFAULT_WORLD.memberships ?? []), membership("uid-x", "team-2", REF_OUTSIDER)] }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, memberRef: REF_OUTSIDER }, deps)).toEqual({
      ok: false,
      error: "invalid_member",
    });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects a member reference with no current membership (a removed member)", async () => {
    const { deps, writes } = build(world());
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, memberRef: REF_OUTSIDER }, deps)).toEqual({
      ok: false,
      error: "invalid_member",
    });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects a project of another team as not_found, with no write", async () => {
    const { deps, writes } = build(world());
    expect(await writeProjectParticipation("token", "team-1", "proj-other", "create", null, validCreate, deps)).toEqual({ ok: false, error: "not_found" });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects an unknown project as not_found", async () => {
    const { deps } = build(world());
    expect(await writeProjectParticipation("token", "team-1", "proj-missing", "create", null, validCreate, deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a new participation on an archived project", async () => {
    const { deps, writes } = build(world());
    expect(await writeProjectParticipation("token", "team-1", "proj-archived", "create", null, validCreate, deps)).toEqual({
      ok: false,
      error: "project_archived",
    });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects a projectId in the body, which is taken from the route only", async () => {
    const { deps } = build(world());
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, projectId: "proj-other" }, deps)).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });
});

describe("writeProjectParticipation — interval validation", () => {
  it("reports every invalid field together and writes nothing", async () => {
    const { deps, writes } = build(world());
    const result = await writeProjectParticipation(
      "token",
      "team-1",
      "proj-1",
      "create",
      null,
      { memberRef: REF_A, startDate: "2026-02-30", endDate: "not-a-date", note: 7 },
      deps,
    );
    expect(result).toEqual({ ok: false, error: "invalid_input", issues: ["start_date_invalid", "end_date_invalid", "note_invalid"] });
    expect(writes.created).toHaveLength(0);
  });

  it("rejects an end date before the start date", async () => {
    const { deps, writes } = build(world());
    expect(
      await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, startDate: "2026-08-02", endDate: "2026-08-01" }, deps),
    ).toEqual({ ok: false, error: "invalid_input", issues: ["end_before_start"] });
    expect(writes.created).toHaveLength(0);
  });

  it("accepts a single-day interval where start equals end (inclusive)", async () => {
    const { deps } = build(world());
    const result = await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, startDate: "2026-07-01", endDate: "2026-07-01" }, deps);
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown key in the create envelope", async () => {
    const { deps } = build(world());
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, utilization: 80 }, deps)).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });
});

describe("writeProjectParticipation — overlap is informational only", () => {
  it("flags an overlapping interval of the same member in another project, and still writes it", async () => {
    const { deps, writes } = build(
      world({ participations: { "part-existing": storedParticipation({ projectId: "proj-1", startDate: "2026-06-01", endDate: "2026-06-30" }) } }),
    );
    const result = await writeProjectParticipation(
      "token",
      "team-1",
      "proj-1",
      "create",
      null,
      { ...validCreate, startDate: "2026-06-30", endDate: "2026-07-10" },
      deps,
    );
    expect(result).toMatchObject({ ok: true, participation: { overlapsOther: true } });
    expect(writes.created).toHaveLength(1);
  });

  it("does not flag an overlap with a different member", async () => {
    const { deps } = build(world({ participations: { "part-b": storedParticipation({ memberRef: REF_B, startDate: "2026-07-01", endDate: "2026-07-31" }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps)).toMatchObject({
      ok: true,
      participation: { overlapsOther: false },
    });
  });

  it("does not flag an adjacent interval that ends the day before the next starts", async () => {
    const { deps } = build(world({ participations: { "part-a": storedParticipation({ startDate: "2026-06-01", endDate: "2026-06-30" }) } }));
    expect(
      await writeProjectParticipation("token", "team-1", "proj-1", "create", null, { ...validCreate, startDate: "2026-07-01", endDate: "2026-07-05" }, deps),
    ).toMatchObject({ ok: true, participation: { overlapsOther: false } });
  });
});

describe("writeProjectParticipation — update and remove", () => {
  const existing = { "part-1": storedParticipation({ note: "Første fase" }) };

  it("updates dates and note, keeping the member and project fixed", async () => {
    const { deps, writes } = build(world({ participations: existing }));
    const result = await writeProjectParticipation("token", "team-1", "proj-1", "update", "part-1", { endDate: "2026-07-15" }, deps);

    expect(result).toMatchObject({ ok: true, participation: { participationId: "part-1", endDate: "2026-07-15", note: "Første fase", memberRef: REF_A } });
    expect(writes.set[0].data).toMatchObject({ teamId: "team-1", projectId: "proj-1", memberRef: REF_A, endDate: "2026-07-15", note: "Første fase" });
  });

  it("validates the merged interval on update, so a date change cannot invert the range", async () => {
    const { deps, writes } = build(world({ participations: existing }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "update", "part-1", { endDate: "2026-05-01" }, deps)).toEqual({
      ok: false,
      error: "invalid_input",
      issues: ["end_before_start"],
    });
    expect(writes.set).toHaveLength(0);
  });

  it("rejects a memberRef in the update envelope", async () => {
    const { deps } = build(world({ participations: existing }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "update", "part-1", { memberRef: REF_B }, deps)).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });

  it("does not update a participation through a different project in the path (not_found)", async () => {
    const { deps, writes } = build(world({ participations: existing }));
    expect(await writeProjectParticipation("token", "team-1", "proj-other", "update", "part-1", { endDate: "2026-07-15" }, deps)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(writes.set).toHaveLength(0);
  });

  it("does not update a participation that belongs to another team (not_found)", async () => {
    const { deps, writes } = build(world({ participations: { "part-other": storedParticipation({ teamId: "team-2", projectId: "proj-other" }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-other", "update", "part-other", { endDate: "2026-07-15" }, deps)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(writes.set).toHaveLength(0);
  });

  it("refuses to change an archived participation", async () => {
    const { deps, writes } = build(world({ participations: { "part-1": storedParticipation({ archived: true }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "update", "part-1", { endDate: "2026-07-15" }, deps)).toEqual({
      ok: false,
      error: "participation_archived",
    });
    expect(writes.set).toHaveLength(0);
  });

  it("refuses to change a participation on an archived project", async () => {
    const { deps, writes } = build(world({ participations: { "part-a": storedParticipation({ projectId: "proj-archived" }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-archived", "update", "part-a", { endDate: "2026-07-15" }, deps)).toEqual({
      ok: false,
      error: "project_archived",
    });
    expect(writes.set).toHaveLength(0);
  });

  it("removes a participation as a soft archive, keeping the record and its note", async () => {
    const { deps, writes } = build(world({ participations: existing }));
    const result = await writeProjectParticipation("token", "team-1", "proj-1", "remove", "part-1", undefined, deps);

    expect(result).toEqual({
      ok: true,
      participation: expect.objectContaining({ participationId: "part-1", archived: true, overlapsOther: false, note: "Første fase" }),
    });
    expect(writes.set).toHaveLength(1);
    expect(writes.set[0].data).toMatchObject({ archived: true, memberRef: REF_A, note: "Første fase" });
  });

  it("treats a second removal as already done, without a second write", async () => {
    const { deps, writes } = build(world({ participations: { "part-1": storedParticipation({ archived: true }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "remove", "part-1", {}, deps)).toMatchObject({
      ok: true,
      participation: { archived: true },
    });
    expect(writes.set).toHaveLength(0);
  });

  it("allows removal from an archived project so that cleanup stays possible", async () => {
    const { deps } = build(world({ participations: { "part-a": storedParticipation({ projectId: "proj-archived" }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-archived", "remove", "part-a", undefined, deps)).toMatchObject({
      ok: true,
      participation: { archived: true },
    });
  });

  it("refuses a remove request that carries a body", async () => {
    const { deps } = build(world({ participations: existing }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "remove", "part-1", { endDate: "2026-07-15" }, deps)).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });

  it("refuses a plain member to remove a participation", async () => {
    const { deps, writes } = build(world({ participations: existing }), "uid-member");
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "remove", "part-1", undefined, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(writes.set).toHaveLength(0);
  });
});

describe("writeProjectParticipation — malformed stored records fail closed", () => {
  it.each([
    ["an invalid stored member reference", { memberRef: "not-a-ref" }],
    ["a reversed stored interval", { startDate: "2026-07-10", endDate: "2026-07-01" }],
    ["a stored team mismatch", { teamId: "team-2" }],
    ["a missing archived flag", { archived: undefined }],
    ["a blank stored note", { note: "   " }],
  ])("refuses an update of a record with %s as persistence_failed, with no write", async (_label, patch) => {
    const stored = { ...storedParticipation(), ...patch };
    const { deps, writes } = build(world({ participations: { "part-1": stored as Record<string, unknown> } }));
    const result = await writeProjectParticipation("token", "team-1", "proj-1", "update", "part-1", { endDate: "2026-07-15" }, deps);
    expect(result.ok).toBe(false);
    expect(writes.set).toHaveLength(0);
  });

  it("refuses to write when another record of the same member is malformed (overlap check cannot be trusted)", async () => {
    const { deps, writes } = build(world({ participations: { "part-bad": storedParticipation({ startDate: "2026-99-01" }) } }));
    expect(await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(writes.created).toHaveLength(0);
  });
});

describe("writeProjectParticipation — no utilization or capacity in responses", () => {
  it("returns only the allow-listed view keys", async () => {
    const { deps } = build(world());
    const result = await writeProjectParticipation("token", "team-1", "proj-1", "create", null, validCreate, deps);
    expect(result.ok && Object.keys(result.participation).sort()).toEqual(
      ["archived", "endDate", "memberRef", "note", "overlapsOther", "participationId", "projectId", "startDate"],
    );
  });
});
