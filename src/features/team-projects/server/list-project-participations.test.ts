import { describe, expect, it, vi } from "vitest";
import { listProjectParticipations, type ListProjectParticipationsDeps } from "./list-project-participations";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const REF_A = "0123456789abcdefghjkmnpqrs";
const REF_B = "tvwxyz0123456789abcdefghjk";

function record(id: string, extra: Record<string, unknown> = {}) {
  return {
    participationId: id,
    teamId: "team-1",
    projectId: "proj-1",
    memberRef: REF_A,
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    archived: false,
    ...extra,
  };
}

/** Team roles come from the team's membership documents; this seam returns a fixed role per uid. */
/** `roleByUid` lists memberships of team-1; a uid absent from it has no membership and is denied. */
function deps(roleByUid: Record<string, "teamadmin" | "member">, rows: unknown[], options: { storeFails?: boolean } = {}): ListProjectParticipationsDeps {
  const memberships: Record<string, Record<string, unknown>> = {};
  for (const [uid, role] of Object.entries(roleByUid)) {
    memberships[uid] = { uid, teamId: "team-1", memberRef: REF_B, createdAt: new Date("2026-05-01T09:00:00Z"), role };
  }
  return {
    verifyToken: vi.fn().mockImplementation(async (token: string) => {
      if (token === "bad") throw new Error("bad token");
      return { uid: token, email: `${token}@example.test`, email_verified: true };
    }),
    roleDeps: {
      isSuperadmin: async () => false,
      collection: {
        async getTeamStatus() {
          return "active";
        },
        async getMembership(uid: string) {
          return memberships[uid];
        },
      },
    },
    store: {
      async listByTeam(teamId: string) {
        if (options.storeFails) throw new Error("firestore unavailable");
        return rows.filter((row) => (row as { teamId?: string }).teamId === teamId);
      },
    },
  };
}

describe("listProjectParticipations — access", () => {
  it("lets a member read planning intervals, without edit rights", async () => {
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, [record("p1")]));
    expect(result).toMatchObject({ ok: true, canEdit: false, truncated: false, participations: [{ participationId: "p1" }] });
  });

  it("reports canEdit for a lead", async () => {
    const result = await listProjectParticipations("uid-lead", "team-1", "proj-1", {}, deps({ "uid-lead": "teamadmin" }, [record("p1")]));
    expect(result).toMatchObject({ ok: true, canEdit: true });
  });

  it("refuses a caller with no team role", async () => {
    const result = await listProjectParticipations("uid-outsider", "team-1", "proj-1", {}, deps({}, [record("p1")]));
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an unverified token before any read", async () => {
    const result = await listProjectParticipations("bad", "team-1", "proj-1", {}, deps({ bad: "teamadmin" }, [record("p1")]));
    expect(result.ok).toBe(false);
  });

  it("reports read_failed when the store cannot be read", async () => {
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, [], { storeFails: true }));
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("listProjectParticipations — team and project scope", () => {
  it("never returns records of another team, even when the store yields them", async () => {
    const rows = [record("p1"), record("p-other", { teamId: "team-2" })];
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, {
      ...deps({ "uid-member": "member" }, []),
      store: { listByTeam: async () => rows },
    });
    // The other team's record is malformed for team-1 (teamId mismatch), so the whole read fails closed rather than leaking it.
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("returns only the requested project's records", async () => {
    const rows = [record("p1"), record("p2", { projectId: "proj-2", memberRef: REF_B })];
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, rows));
    expect(result).toMatchObject({ ok: true, participations: [{ participationId: "p1", projectId: "proj-1" }] });
  });

  it("excludes archived records unless archived are requested", async () => {
    const rows = [record("p1"), record("p-archived", { archived: true })];
    const active = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, rows));
    const all = await listProjectParticipations("uid-member", "team-1", "proj-1", { includeArchived: true }, deps({ "uid-member": "member" }, rows));
    expect(active.ok && active.participations.map((p) => p.participationId)).toEqual(["p1"]);
    expect(all.ok && all.participations.map((p) => p.participationId)).toEqual(["p-archived", "p1"]);
  });
});

describe("listProjectParticipations — stored records and overlap", () => {
  it("fails the whole read on a malformed stored record instead of skipping or coercing it", async () => {
    const rows = [record("p1"), record("p-bad", { startDate: "2026-13-01" })];
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, rows));
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("flags overlap between one member's active records, including records in other projects", async () => {
    const rows = [
      record("p1", { startDate: "2026-06-01", endDate: "2026-06-30" }),
      record("p-other-project", { projectId: "proj-2", startDate: "2026-06-15", endDate: "2026-07-15" }),
    ];
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, rows));
    expect(result).toMatchObject({ ok: true, participations: [{ participationId: "p1", overlapsOther: true }] });
  });

  it("does not flag archived records as overlapping and never reports them as overlapping", async () => {
    const rows = [record("p1"), record("p-archived", { archived: true })];
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", { includeArchived: true }, deps({ "uid-member": "member" }, rows));
    expect(result).toMatchObject({ ok: true, participations: [{ participationId: "p-archived", overlapsOther: false }, { participationId: "p1", overlapsOther: false }] });
  });

  it("exposes only allow-listed keys, with no utilization or capacity value", async () => {
    const result = await listProjectParticipations("uid-member", "team-1", "proj-1", {}, deps({ "uid-member": "member" }, [record("p1", { note: "Planlagt" })]));
    expect(result.ok && Object.keys(result.participations[0]).sort()).toEqual(
      ["archived", "endDate", "memberRef", "note", "overlapsOther", "participationId", "projectId", "startDate"],
    );
  });
});
