import { describe, expect, it, vi } from "vitest";
import { listTeamProjects, mapTeamProjectDocs, TEAM_PROJECTS_MAX, type ListTeamProjectsDeps } from "./list-team-projects";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-02T09:00:00Z");
const EARLIER = new Date("2026-05-01T09:00:00Z");

function stored(projectId: string, extra: Record<string, unknown> = {}) {
  return {
    projectId,
    teamId: "team-1",
    title: `Prosjekt ${projectId}`,
    startDate: "2026-06-01",
    endDate: "2026-09-30",
    lifecycleStatus: "planned",
    priority: "medium",
    archived: false,
    archivedAt: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...extra,
  };
}

function deps(options: {
  callerUid?: string;
  role?: "teamadmin" | "member" | "outsider";
  projects?: unknown[];
  readFails?: boolean;
  tokenFails?: boolean;
}): ListTeamProjectsDeps {
  const memberships: Record<string, Record<string, unknown>> = {
    "uid-lead": { uid: "uid-lead", teamId: "team-1", memberRef: "r1", createdAt: EARLIER, role: "teamadmin" },
    "uid-member": { uid: "uid-member", teamId: "team-1", memberRef: "r2", createdAt: EARLIER, role: "member" },
  };
  const callerUid = options.callerUid ?? (options.role === "teamadmin" ? "uid-lead" : options.role === "outsider" ? "uid-out" : "uid-member");
  return {
    verifyToken: options.tokenFails
      ? vi.fn().mockRejectedValue(new Error("bad"))
      : vi.fn().mockResolvedValue({ uid: callerUid, email: "x@example.test", email_verified: true }),
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
      async listByTeam() {
        if (options.readFails) throw new Error("firestore down");
        return options.projects ?? [];
      },
    },
    now: () => NOW,
  };
}

describe("listTeamProjects", () => {
  it("returns active projects to a member, without a write capability", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: [stored("p1")] }));
    expect(result).toEqual({
      ok: true,
      projects: [expect.objectContaining({ projectId: "p1", effectiveStatus: "active", archived: false })],
      canEdit: false,
      truncated: false,
    });
  });

  it("grants canEdit only to a lead", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "teamadmin", projects: [stored("p1")] }));
    expect(result).toMatchObject({ ok: true, canEdit: true });
  });

  it("denies a caller who is not a member of the team", async () => {
    expect(await listTeamProjects("t", "team-1", {}, deps({ role: "outsider", projects: [stored("p1")] }))).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("returns unauthenticated for a token that does not verify", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ tokenFails: true }));
    expect(result.ok).toBe(false);
  });

  it("excludes archived projects by default and includes them on request", async () => {
    const projects = [stored("p1"), stored("p2", { archived: true, archivedAt: EARLIER })];
    const defaults = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects }));
    const withArchived = await listTeamProjects("t", "team-1", { includeArchived: true }, deps({ role: "member", projects }));
    expect(defaults).toMatchObject({ ok: true, projects: [{ projectId: "p1" }] });
    expect(withArchived).toMatchObject({ ok: true, projects: [{ projectId: "p1" }, { projectId: "p2", archived: true }] });
  });

  it("shows a completed project as completed even when its start date has passed", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: [stored("p1", { lifecycleStatus: "completed" })] }));
    expect(result).toMatchObject({ ok: true, projects: [{ effectiveStatus: "completed" }] });
  });

  it("reads a stored project whose only identifier is its document id", async () => {
    // Regression: stored project documents carry no projectId field. Before the fix every row lost its id and the whole
    // read failed closed (HTTP 500 on the team Oversikt and Roadmap pages).
    const fields: Record<string, unknown> = { ...stored("p1") };
    delete fields.projectId;
    const rows = mapTeamProjectDocs([{ id: "p1", data: () => fields }]);
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: rows }));
    expect(result).toMatchObject({ ok: true, projects: [{ projectId: "p1", title: "Prosjekt p1" }] });
  });

  it("takes the project id from the document id, not from a stored field", async () => {
    const fields: Record<string, unknown> = { ...stored("stored-id") };
    const rows = mapTeamProjectDocs([{ id: "doc-id", data: () => fields }]);
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: rows }));
    expect(result).toMatchObject({ ok: true, projects: [{ projectId: "doc-id" }] });
  });

  it("fails closed when a stored record is malformed, rather than dropping or coercing it", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: [stored("p1", { priority: "urgent" })] }));
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("fails closed when a stored record belongs to another team", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: [stored("p1", { teamId: "team-2" })] }));
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("maps a store failure to read_failed without leaking the error", async () => {
    expect(await listTeamProjects("t", "team-1", {}, deps({ role: "member", readFails: true }))).toEqual({ ok: false, error: "read_failed" });
  });

  it("marks the response truncated when the team has more projects than the bound", async () => {
    const many = Array.from({ length: TEAM_PROJECTS_MAX + 1 }, (_, i) => stored(`p${i}`));
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: many }));
    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && result.projects).toHaveLength(TEAM_PROJECTS_MAX);
  });

  it("returns only the allow-listed view keys, with no actor or timestamp fields", async () => {
    const result = await listTeamProjects("t", "team-1", {}, deps({ role: "member", projects: [stored("p1", { createdBy: "uid-x" })] }));
    expect(result.ok && Object.keys(result.projects[0]).sort()).toEqual(
      ["archived", "effectiveStatus", "endDate", "lifecycleStatus", "priority", "projectId", "startDate", "title"],
    );
  });
});
