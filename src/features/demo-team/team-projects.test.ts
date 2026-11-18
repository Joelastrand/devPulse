import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TEAM_PROJECTS, teamProjectRecord } from "./fixtures";
import { demoCrypto } from "./crypto";
import { buildDemoSeedPlan } from "./plan";
import { openTeamProjectDocument, toPersistedTeamProject } from "../team-projects/server/team-project-codec";
import { resolveEffectiveProjectStatus } from "../team-projects/domain/team-project";

/**
 * Team delivery projects (Phase 1 of the team demo). Offline and deterministic: the title is sealed with the real codec and a
 * test-only key, so the AAD binding is exercised for real. No Firebase access.
 */
const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const TODAY = "2026-11-13";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("team project records: sealed titles and AAD binding", () => {
  it("never stores a project title as plaintext, and the sealed title opens only under its own team and project", () => {
    const p = DEMO_TEAM_PROJECTS[0];
    const stored = toPersistedTeamProject(p.projectId, teamProjectRecord(p, TEAM, AS_OF), demoCrypto.sealRecord);
    expect(JSON.stringify(stored)).not.toContain(p.title);
    expect(stored).not.toHaveProperty("title");
    expect(openTeamProjectDocument(p.projectId, stored, demoCrypto.openRecord)).toMatchObject({ title: p.title, teamId: TEAM });
    // Substitution: the same content under another project id, or another team, does not open.
    expect(openTeamProjectDocument("demo-project-other", stored, demoCrypto.openRecord)).toBeNull();
    expect(openTeamProjectDocument(p.projectId, { ...stored, teamId: "other-team" }, demoCrypto.openRecord)).toBeNull();
  });
});

describe("dashboard counts come from the project records", () => {
  it("derives active, planned and completed project counts from the lifecycle and start dates of the records", () => {
    const statuses = DEMO_TEAM_PROJECTS.map((p) => {
      const record = teamProjectRecord(p, TEAM, AS_OF);
      return resolveEffectiveProjectStatus(
        { lifecycleStatus: record.lifecycleStatus as "planned" | "completed", startDate: record.startDate as string },
        TODAY,
      );
    });
    const count = (status: string) => statuses.filter((s) => s === status).length;
    expect(count("active")).toBe(3);
    expect(count("planned")).toBe(1);
    expect(count("completed")).toBe(2);
  });

  it("every fixture project has a valid date order and a supported priority", () => {
    for (const p of DEMO_TEAM_PROJECTS) {
      const record = teamProjectRecord(p, TEAM, AS_OF);
      expect(String(record.startDate) <= String(record.endDate)).toBe(true);
      expect(["high", "medium", "low"]).toContain(p.priority);
      expect(record.archived).toBe(false);
    }
  });
});

describe("team project operations in the team plan", () => {
  it("plans one create-only project document per fixture, all in the selected team, with stable ids", () => {
    const plan = buildDemoSeedPlan({ presenterUid: PRESENTER, teamId: TEAM, asOf: AS_OF, sealRecord: demoCrypto.sealRecord });
    const projects = plan.operations.filter((op) => op.collection === "teamProjects");
    expect(projects.map((op) => op.docId)).toEqual(DEMO_TEAM_PROJECTS.map((p) => p.projectId));
    expect(projects.every((op) => op.writeClass === "C")).toBe(true);
    expect(projects.every((op) => (op.data as { teamId: string }).teamId === TEAM)).toBe(true);
    expect(projects.every((op) => op.path === `teamProjects/${op.docId}`)).toBe(true);
  });

  it("the planned project documents hold no plaintext title in any field", () => {
    const plan = buildDemoSeedPlan({ presenterUid: PRESENTER, teamId: TEAM, asOf: AS_OF, sealRecord: demoCrypto.sealRecord });
    const serialized = JSON.stringify(plan.operations.filter((op) => op.collection === "teamProjects"));
    for (const p of DEMO_TEAM_PROJECTS) expect(serialized).not.toContain(p.title);
  });
});
