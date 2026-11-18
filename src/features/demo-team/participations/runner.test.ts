import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { DEMO_TEAM_PROJECTS, teamProjectRecord } from "../fixtures";
import { toPersistedTeamProject } from "../../team-projects/server/team-project-codec";
import { DEMO_PARTICIPATIONS } from "./fixtures";
import type { ParticipationOnlineAdapters, ParticipationTx } from "./adapters";
import { runParticipationProvisioning, type ParticipationRunnerInput } from "./runner";

const PROJECT = "demo-fake-project";
const TEAM = "8yB2bS8Jav69TCfDETON";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");

/**
 * In-memory store with transaction semantics: a transaction stages its writes and applies them only at commit, all or nothing.
 * `create` fails if the document exists at commit; an update requires the document to exist.
 */
class FakeWorld {
  readonly docs = new Map<string, Record<string, unknown>>();
  commits = 0;
  /** Runs after the transaction's reads and before its commit (simulates a concurrent writer). */
  beforeCommit: (() => void) | null = null;

  constructor(options: { presenterTeamAdmin?: boolean; withMemberRef?: Record<string, string> } = {}) {
    this.docs.set(`teams/${TEAM}`, { status: "active" });
    this.docs.set(`teamMemberships/${PRESENTER}__${TEAM}`, {
      uid: PRESENTER,
      teamId: TEAM,
      role: options.presenterTeamAdmin === false ? undefined : "teamadmin",
    });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const base = buildIdentityMembership(identity, TEAM, AS_OF) as unknown as Record<string, unknown>;
      const ref = options.withMemberRef?.[identity.uid];
      this.docs.set(`teamMemberships/${identity.uid}__${TEAM}`, ref === undefined ? base : { ...base, memberRef: ref });
    }
    for (const p of DEMO_TEAM_PROJECTS) {
      const stored = toPersistedTeamProject(p.projectId, teamProjectRecord(p, TEAM, AS_OF), demoCrypto.sealRecord);
      this.docs.set(`teamProjects/${p.projectId}`, stored as Record<string, unknown>);
    }
  }

  adapters(): ParticipationOnlineAdapters {
    return {
      runTransaction: async <T>(work: (tx: ParticipationTx) => Promise<T>): Promise<T> => {
        const staged: Array<() => void> = [];
        const tx: ParticipationTx = {
          get: async (path) => (this.docs.has(path) ? { exists: true, data: structuredClone(this.docs.get(path)) } : { exists: false }),
          queryTeamMemberships: async (teamId) =>
            [...this.docs.entries()]
              .filter(([path, data]) => path.startsWith("teamMemberships/") && data.teamId === teamId)
              .map(([, data]) => structuredClone(data)),
          create: (path, data) => {
            staged.push(() => {
              if (this.docs.has(path)) throw new Error("already exists");
              this.docs.set(path, data);
            });
          },
          updateMembershipMemberRef: (path, memberRef) => {
            staged.push(() => {
              const current = this.docs.get(path);
              if (current === undefined) throw new Error("missing");
              this.docs.set(path, { ...current, memberRef });
            });
          },
        };
        const result = await work(tx);
        this.beforeCommit?.();
        // Atomic commit: apply to a copy, and swap it in only when every staged write succeeds.
        const snapshot = new Map(this.docs);
        try {
          for (const apply of staged) apply();
        } catch (error) {
          this.docs.clear();
          for (const [k, v] of snapshot) this.docs.set(k, v);
          throw error;
        }
        this.commits += staged.length > 0 ? 1 : 0;
        return result;
      },
    };
  }
}

function input(world: FakeWorld, extra: string[] = [], overrides: Partial<ParticipationRunnerInput> = {}): ParticipationRunnerInput {
  return {
    argv: ["--project", PROJECT, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-13", ...extra],
    env: { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: "not-a-real-key" },
    now: () => AS_OF,
    crypto: demoCrypto,
    createOnlineAdapters: async () => world.adapters(),
    createKey: (() => {
      let k = 0;
      return () => `${String(++k).padStart(25, "0")}a`;
    })(),
    ...overrides,
  };
}

const WRITE = ["--write", `--confirm=${PROJECT}`];

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
afterEach(() => vi.unstubAllEnvs());

describe("runParticipationProvisioning", () => {
  it("validates offline without building adapters", async () => {
    const world = new FakeWorld();
    const createOnlineAdapters = vi.fn(async () => world.adapters());
    const result = await runParticipationProvisioning(input(world, ["--offline"], { createOnlineAdapters }));
    expect(result.exitCode).toBe(0);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
    expect(result.stdout.join("\n")).toContain("fixtures valid");
  });

  it("reports a live dry run without writing anything", async () => {
    const world = new FakeWorld();
    const before = new Map(world.docs);
    const result = await runParticipationProvisioning(input(world));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain(`teamProjectParticipations: create ${DEMO_PARTICIPATIONS.length}, skip 0, conflict 0`);
    expect(result.stdout.join("\n")).toContain("Dry run: nothing written.");
    expect(world.docs).toEqual(before);
    expect(world.commits).toBe(0);
  });

  it("refuses a write without the matching confirmation before any adapter is built", async () => {
    const world = new FakeWorld();
    const createOnlineAdapters = vi.fn(async () => world.adapters());
    const result = await runParticipationProvisioning(input(world, ["--write"], { createOnlineAdapters }));
    expect(result.exitCode).toBe(2);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });

  it("sets memberRef on the ten memberships and creates every participation in one transaction", async () => {
    const world = new FakeWorld();
    const membershipBefore = structuredClone(world.docs.get(`teamMemberships/${DEMO_MEMBER_IDENTITIES[0].uid}__${TEAM}`));
    const result = await runParticipationProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(0);
    expect(world.commits).toBe(1);
    expect(result.stdout.join("\n")).toContain("Deletes: 0");
    const after = world.docs.get(`teamMemberships/${DEMO_MEMBER_IDENTITIES[0].uid}__${TEAM}`) as Record<string, unknown>;
    const { memberRef, ...rest } = after;
    expect(typeof memberRef).toBe("string");
    expect(rest).toEqual(membershipBefore);
    expect(world.docs.has(`teamProjectParticipations/${DEMO_PARTICIPATIONS[0].participationId}`)).toBe(true);
  });

  it("keeps an existing memberRef and never rotates it", async () => {
    const existing = "0123456789abcdefghjkmnpqrs";
    const world = new FakeWorld({ withMemberRef: { [DEMO_MEMBER_IDENTITIES[0].uid]: existing } });
    await runParticipationProvisioning(input(world, WRITE));
    expect((world.docs.get(`teamMemberships/${DEMO_MEMBER_IDENTITIES[0].uid}__${TEAM}`) as { memberRef: string }).memberRef).toBe(existing);
  });

  it("rerunning after success is a no-op and leaves every record unchanged", async () => {
    const world = new FakeWorld();
    await runParticipationProvisioning(input(world, WRITE));
    const snapshot = structuredClone(Object.fromEntries(world.docs));
    const rerun = await runParticipationProvisioning(input(world, WRITE));
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.join("\n")).toContain("nothing to write");
    expect(structuredClone(Object.fromEntries(world.docs))).toEqual(snapshot);
  });

  it("writes nothing when a plan has a conflict", async () => {
    const world = new FakeWorld();
    world.docs.set(`teamProjectParticipations/${DEMO_PARTICIPATIONS[2].participationId}`, { teamId: TEAM, projectId: "x", archived: true });
    const before = new Map(world.docs);
    const result = await runParticipationProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain(`Conflict: teamProjectParticipations/${DEMO_PARTICIPATIONS[2].participationId}`);
    expect(world.docs).toEqual(before);
    expect(world.commits).toBe(0);
  });

  it("refuses when the presenter is not the team's teamadmin, writing nothing", async () => {
    const world = new FakeWorld({ presenterTeamAdmin: false });
    const before = new Map(world.docs);
    const result = await runParticipationProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("presenter-not-teamadmin");
    expect(world.docs).toEqual(before);
  });

  it("writes nothing at all when a participation appears between the reads and the commit", async () => {
    const world = new FakeWorld();
    const racing = DEMO_PARTICIPATIONS[10].participationId;
    world.beforeCommit = () => world.docs.set(`teamProjectParticipations/${racing}`, { raced: true });
    const before = new Map(world.docs);
    const result = await runParticipationProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("transaction-failed");
    // Only the racing writer's document is present; no membership memberRef and no other participation was written.
    expect(world.docs.get(`teamProjectParticipations/${racing}`)).toEqual({ raced: true });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      expect((world.docs.get(`teamMemberships/${identity.uid}__${TEAM}`) as Record<string, unknown>).memberRef).toBeUndefined();
    }
    expect(world.docs.size).toBe(before.size + 1);
  });
});
