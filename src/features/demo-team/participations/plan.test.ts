import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { DEMO_TEAM_PROJECTS, teamProjectRecord } from "../fixtures";
import { toPersistedTeamProject, openTeamProjectDocument } from "../../team-projects/server/team-project-codec";
import { parseStoredTeamProject } from "../../team-projects/domain/team-project";
import { DEMO_PARTICIPATIONS, participationInterval, validateDemoParticipations, type DemoParticipation } from "./fixtures";
import { participationDocumentFor, planParticipationProvisioning, type ObservedMember, type ObservedProject } from "./plan";
import { openParticipationDocument } from "../../team-projects/server/team-project-codec";

const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const REF_A = "0000000000000000000000000a";
const REF_B = "0000000000000000000000000b";
const ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
afterEach(() => vi.unstubAllEnvs());

/** The live-shaped project record the plan reads: opened and parsed exactly as the runner does. */
function openedProject(projectId: string) {
  const p = DEMO_TEAM_PROJECTS.find((x) => x.projectId === projectId)!;
  const stored = toPersistedTeamProject(projectId, teamProjectRecord(p, TEAM, AS_OF), demoCrypto.sealRecord);
  const opened = openTeamProjectDocument(projectId, stored, demoCrypto.openRecord);
  const parsed = opened === null ? null : parseStoredTeamProject(opened, projectId, TEAM);
  return parsed === null ? null : { teamId: parsed.teamId, archived: parsed.archived, startDate: parsed.startDate, endDate: parsed.endDate };
}

function allProjects(): Map<string, ObservedProject> {
  return new Map(DEMO_TEAM_PROJECTS.map((p) => [p.projectId, { project: openedProject(p.projectId) }]));
}

/** A world where all ten members hold an ordinary membership with no memberRef yet. */
function baseInput(overrides: Partial<Parameters<typeof planParticipationProvisioning>[0]> = {}) {
  const members = new Map<string, ObservedMember>(
    DEMO_MEMBER_IDENTITIES.map((i) => [i.uid, { membership: buildIdentityMembership(i, TEAM, AS_OF) }]),
  );
  const memberships = DEMO_MEMBER_IDENTITIES.map((i) => buildIdentityMembership(i, TEAM, AS_OF));
  let key = 0;
  return {
    teamId: TEAM,
    members,
    teamMemberships: memberships as unknown[],
    erasing: new Set<string>(),
    projects: allProjects(),
    participations: new Map(DEMO_PARTICIPATIONS.map((f) => [f.participationId, { raw: undefined }])),
    createKey: () => `${String(++key).padStart(26, "0")}`,
    ...overrides,
  };
}

describe("participation fixtures", () => {
  it("are valid, 18 to 25 in number, and spread across all six existing projects", () => {
    expect(validateDemoParticipations(DEMO_PARTICIPATIONS)).toEqual([]);
    expect(DEMO_PARTICIPATIONS.length).toBeGreaterThanOrEqual(18);
    expect(DEMO_PARTICIPATIONS.length).toBeLessThanOrEqual(25);
    expect(new Set(DEMO_PARTICIPATIONS.map((p) => p.projectId)).size).toBe(6);
  });

  it("never assigns the same member to the same project twice", () => {
    const pairs = DEMO_PARTICIPATIONS.map((p) => `${p.projectId}|${p.uid}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("keeps every interval inside its project's live dates", () => {
    for (const fixture of DEMO_PARTICIPATIONS) {
      const project = openedProject(fixture.projectId)!;
      const interval = participationInterval(fixture, project);
      expect(interval).not.toBeNull();
      expect(interval!.startDate >= project.startDate && interval!.endDate <= project.endDate).toBe(true);
      expect(interval!.startDate <= interval!.endDate).toBe(true);
    }
  });

  it("refuses a start offset that falls after the project's end", () => {
    const fixture: DemoParticipation = { ...DEMO_PARTICIPATIONS[0], startOffsetDays: 100000 };
    expect(participationInterval(fixture, { startDate: "2026-01-01", endDate: "2026-02-01" })).toBeNull();
  });

  it("rejects a non-fixture member, an unknown project, and a blank note", () => {
    const list = DEMO_PARTICIPATIONS.map((p) => ({ ...p }));
    list[0] = { ...list[0], uid: "someone-real" };
    list[1] = { ...list[1], projectId: "demo-project-unknown" };
    list[2] = { ...list[2], note: "   " };
    const categories = validateDemoParticipations(list).map((p) => p.category);
    expect(categories).toEqual(expect.arrayContaining(["member", "project", "note"]));
  });
});

describe("planParticipationProvisioning: memberRef", () => {
  it("materializes a fresh memberRef for every membership that lacks one", () => {
    const plan = planParticipationProvisioning(baseInput());
    expect(plan.counts.memberRef).toEqual({ keep: 0, materialize: 10, conflict: 0 });
    expect(plan.members.every((m) => m.memberRef !== null && m.memberRef.length === 26)).toBe(true);
  });

  it("keeps a valid existing memberRef and uses it, never rotating it", () => {
    const uid = DEMO_MEMBER_IDENTITIES[0].uid;
    const members = new Map<string, ObservedMember>(
      DEMO_MEMBER_IDENTITIES.map((i) => [i.uid, { membership: { ...buildIdentityMembership(i, TEAM, AS_OF), ...(i.uid === uid ? { memberRef: REF_A } : {}) } }]),
    );
    const plan = planParticipationProvisioning(baseInput({ members, teamMemberships: [...members.values()].map((m) => m.membership) }));
    const kept = plan.members.find((m) => m.uid === uid);
    expect(kept).toMatchObject({ action: "keep", memberRef: REF_A });
  });

  it("refuses a malformed memberRef instead of replacing it", () => {
    const uid = DEMO_MEMBER_IDENTITIES[1].uid;
    const members = new Map<string, ObservedMember>(
      DEMO_MEMBER_IDENTITIES.map((i) => [i.uid, { membership: { ...buildIdentityMembership(i, TEAM, AS_OF), ...(i.uid === uid ? { memberRef: "NOT-A-REF" } : {}) } }]),
    );
    const plan = planParticipationProvisioning(baseInput({ members, teamMemberships: [...members.values()].map((m) => m.membership) }));
    expect(plan.members.find((m) => m.uid === uid)).toMatchObject({ action: "conflict", reason: "member-ref-malformed" });
    expect(plan.noConflicts).toBe(false);
  });

  it("refuses a memberRef that two memberships of the team share", () => {
    const first = DEMO_MEMBER_IDENTITIES[0].uid;
    const second = DEMO_MEMBER_IDENTITIES[1].uid;
    const members = new Map<string, ObservedMember>(
      DEMO_MEMBER_IDENTITIES.map((i) => [
        i.uid,
        { membership: { ...buildIdentityMembership(i, TEAM, AS_OF), ...(i.uid === first || i.uid === second ? { memberRef: REF_A } : {}) } },
      ]),
    );
    const plan = planParticipationProvisioning(baseInput({ members, teamMemberships: [...members.values()].map((m) => m.membership) }));
    expect(plan.members.find((m) => m.uid === first)).toMatchObject({ action: "conflict", reason: "member-ref-duplicated" });
  });

  it("never gives a fresh memberRef a value another membership already holds", () => {
    const other = { ...buildIdentityMembership(DEMO_MEMBER_IDENTITIES[9], TEAM, AS_OF), uid: "someone-else__x", memberRef: REF_B };
    // First candidate collides with the held value; the rest are fresh.
    let n = 0;
    const createKey = () => (n++ === 0 ? REF_B : `${String(n).padStart(25, "0")}z`);
    const plan = planParticipationProvisioning(
      baseInput({ teamMemberships: [...(baseInput().teamMemberships as unknown[]), other], createKey }),
    );
    const materialized = plan.members.filter((m) => m.action === "materialize").map((m) => m.memberRef);
    expect(materialized).not.toContain(REF_B);
    expect(new Set(materialized).size).toBe(materialized.length);
  });

  it("refuses a member whose erasure record exists", () => {
    const plan = planParticipationProvisioning(baseInput({ erasing: new Set([DEMO_MEMBER_IDENTITIES[2].uid]) }));
    expect(plan.members.find((m) => m.uid === DEMO_MEMBER_IDENTITIES[2].uid)).toMatchObject({
      action: "conflict",
      reason: "erasure-record-present",
    });
  });

  it("refuses a missing membership or one that carries a team role", () => {
    const members = new Map<string, ObservedMember>(DEMO_MEMBER_IDENTITIES.slice(1).map((i) => [i.uid, { membership: buildIdentityMembership(i, TEAM, AS_OF) }]));
    const missing = planParticipationProvisioning(baseInput({ members }));
    expect(missing.members.find((m) => m.uid === DEMO_MEMBER_IDENTITIES[0].uid)).toMatchObject({ reason: "membership-missing" });

    const admin = new Map<string, ObservedMember>(
      DEMO_MEMBER_IDENTITIES.map((i) => [i.uid, { membership: { ...buildIdentityMembership(i, TEAM, AS_OF), ...(i.uid === DEMO_MEMBER_IDENTITIES[3].uid ? { role: "teamadmin" } : {}) } }]),
    );
    const roled = planParticipationProvisioning(baseInput({ members: admin }));
    expect(roled.members.find((m) => m.uid === DEMO_MEMBER_IDENTITIES[3].uid)).toMatchObject({ reason: "membership-not-ordinary-member" });
  });
});

describe("planParticipationProvisioning: participations", () => {
  it("creates every missing participation with the derived interval and the fixture's note", () => {
    const plan = planParticipationProvisioning(baseInput());
    expect(plan.counts.participation).toEqual({ create: DEMO_PARTICIPATIONS.length, skip: 0, conflict: 0 });
    const first = plan.participations[0];
    expect(first.fields).toMatchObject({ teamId: TEAM, projectId: DEMO_PARTICIPATIONS[0].projectId, archived: false, note: DEMO_PARTICIPATIONS[0].note });
  });

  it("points every participation at the member's effective memberRef", () => {
    const plan = planParticipationProvisioning(baseInput());
    for (const item of plan.participations) {
      const member = plan.members.find((m) => m.uid === item.uid);
      expect(item.fields?.memberRef).toBe(member?.memberRef);
    }
  });

  it("skips an existing participation that equals the fixture, decrypting the note to compare", () => {
    const first = DEMO_PARTICIPATIONS[0];
    const plan0 = planParticipationProvisioning(baseInput());
    const item = plan0.participations[0];
    const stored = participationDocumentFor(first.participationId, item.fields!);
    const plan = planParticipationProvisioning(
      baseInput({
        participations: new Map(DEMO_PARTICIPATIONS.map((f) => [f.participationId, { raw: f.participationId === first.participationId ? stored : undefined }])),
      }),
    );
    expect(plan.participations[0].action).toBe("skip");
    expect(openParticipationDocument(first.participationId, stored).note).toBe(first.note);
  });

  it("conflicts on an existing participation whose note or dates differ", () => {
    const first = DEMO_PARTICIPATIONS[0];
    const plan0 = planParticipationProvisioning(baseInput());
    const fields = { ...plan0.participations[0].fields!, note: "En annen notis." };
    const stored = participationDocumentFor(first.participationId, fields);
    const plan = planParticipationProvisioning(
      baseInput({
        participations: new Map(DEMO_PARTICIPATIONS.map((f) => [f.participationId, { raw: f.participationId === first.participationId ? stored : undefined }])),
      }),
    );
    expect(plan.participations[0]).toMatchObject({ action: "conflict", reason: "participation-differs" });
  });

  it("conflicts on a missing, archived, or other-team project, and on an interval outside the project", () => {
    const projects = allProjects();
    projects.set("demo-project-api", { project: undefined });
    projects.set("demo-project-devplatform", { project: { teamId: "other", archived: false, startDate: "2026-01-01", endDate: "2026-02-01" } });
    projects.set("demo-project-access", { project: { teamId: TEAM, archived: true, startDate: "2026-01-01", endDate: "2026-02-01" } });
    const plan = planParticipationProvisioning(baseInput({ projects }));
    const reasonOf = (id: string) => plan.participations.find((p) => p.participationId === id)?.reason;
    expect(reasonOf("demo-participation-01")).toBe("project-missing");
    expect(reasonOf("demo-participation-06")).toBe("project-other-team");
    expect(reasonOf("demo-participation-10")).toBe("project-archived");
    expect(plan.noConflicts).toBe(false);
  });

  it("reports an interval outside the project instead of clamping it silently", () => {
    const projects = allProjects();
    projects.set("demo-project-api", { project: { teamId: TEAM, archived: false, startDate: "2026-01-01", endDate: "2026-01-10" } });
    const plan = planParticipationProvisioning(
      baseInput({ projects, fixtures: [{ ...DEMO_PARTICIPATIONS[0], startOffsetDays: 50 }] }),
    );
    expect(plan.participations[0]).toMatchObject({ action: "conflict", reason: "interval-outside-project" });
  });
});
