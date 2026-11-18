import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, IDENTITY_AUDIT_ACTOR } from "./fixtures";
import type { IdentityBatch, IdentityOnlineAdapters } from "./adapters";
import type { ObservedAuthAccount } from "./plan";
import { runIdentityProvisioning, type IdentityRunnerInput } from "./runner";
import { toPersistedUserProfile } from "../../profiles/domain/user-profile-content-codec";

const PROJECT = "demo-fake-project";
const TEAM = "8yB2bS8Jav69TCfDETON";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const AS_OF = new Date("2026-11-14T00:00:00.000Z");

/** In-memory Firebase stand-in with create-only semantics (a batch fails whole if any document already exists). */
class FakeWorld {
  readonly accounts = new Map<string, ObservedAuthAccount>();
  readonly docs = new Map<string, unknown>();
  readonly createdPaths: string[] = [];
  authFailAfter: number | null = null;
  batchFails = false;
  authCreates = 0;
  batchCommits = 0;

  constructor() {
    this.docs.set(`teams/${TEAM}`, { status: "active" });
    this.docs.set(`teamMemberships/${PRESENTER}__${TEAM}`, { uid: PRESENTER, teamId: TEAM, role: "teamadmin" });
    this.accounts.set(PRESENTER, account(PRESENTER, "admin@nve.no", false));
  }

  adapters(): IdentityOnlineAdapters {
    return {
      presenterAuthExists: async (uid) => this.accounts.has(uid),
      accountById: async (uid) => this.accounts.get(uid) ?? null,
      accountByMail: async (email) => [...this.accounts.values()].find((a) => a.email === email) ?? null,
      createAuthAccount: async (request) => {
        if (this.authFailAfter !== null && this.authCreates >= this.authFailAfter) throw new Error("boom");
        if (this.accounts.has(request.uid)) throw new Error("already exists");
        this.accounts.set(request.uid, account(request.uid, request.email, request.disabled));
        this.authCreates += 1;
      },
      readDoc: async (path) => (this.docs.has(path) ? { exists: true, data: this.docs.get(path) } : { exists: false }),
      createBatch: (): IdentityBatch => {
        const ops: Array<[string, unknown]> = [];
        return {
          create: (path, data) => ops.push([path, data]),
          commit: async () => {
            if (this.batchFails) throw new Error("boom");
            if (ops.some(([path]) => this.docs.has(path))) throw new Error("already exists");
            for (const [path, data] of ops) {
              this.docs.set(path, data);
              this.createdPaths.push(path);
            }
            this.batchCommits += 1;
          },
        };
      },
    };
  }
}

function account(uid: string, email: string, disabled: boolean): ObservedAuthAccount {
  return { uid, email, disabled, hasPassword: false, hasCustomClaims: false, providerCount: 0 };
}

function input(world: FakeWorld, extra: string[] = [], overrides: Partial<IdentityRunnerInput> = {}): IdentityRunnerInput {
  const argv = ["--project", PROJECT, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-14", ...extra];
  return {
    argv,
    env: {
      FIREBASE_PROJECT_ID: PROJECT,
      FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`,
      FIREBASE_PRIVATE_KEY: "not-a-real-key",
    },
    now: () => AS_OF,
    crypto: demoCrypto,
    createOnlineAdapters: async () => world.adapters(),
    ...overrides,
  };
}

const WRITE = ["--write", `--confirm=${PROJECT}`];

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
afterEach(() => vi.unstubAllEnvs());

describe("runIdentityProvisioning", () => {
  it("validates the fixtures offline without building adapters or reading anything", async () => {
    const createOnlineAdapters = vi.fn();
    const result = await runIdentityProvisioning(
      input(new FakeWorld(), ["--offline"], { createOnlineAdapters }),
    );
    expect(result.exitCode).toBe(0);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });

  it("reports the plan in a live dry run without writing anything", async () => {
    const world = new FakeWorld();
    const result = await runIdentityProvisioning(input(world));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Auth accounts (disabled, no password): create 10, skip 0, conflict 0");
    expect(result.stdout).toContain("Dry run: nothing written.");
    expect(world.authCreates).toBe(0);
    expect(world.batchCommits).toBe(0);
  });

  it("refuses a write without the matching --confirm before any adapter is built", async () => {
    const createOnlineAdapters = vi.fn();
    const result = await runIdentityProvisioning(input(new FakeWorld(), ["--write"], { createOnlineAdapters }));
    expect(result.exitCode).toBe(2);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });

  it("creates 10 disabled Auth accounts and 10 memberships and profiles on a confirmed write, leaving the presenter untouched", async () => {
    const world = new FakeWorld();
    const presenterBefore = world.docs.get(`teamMemberships/${PRESENTER}__${TEAM}`);
    const result = await runIdentityProvisioning(input(world, WRITE));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.at(-1)).toContain("created 10 disabled Auth accounts");
    expect(world.authCreates).toBe(10);
    expect(world.batchCommits).toBe(1);

    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const created = world.accounts.get(identity.uid);
      expect(created).toEqual(account(identity.uid, identity.email, true));
      expect(world.docs.get(`teamMemberships/${identity.uid}__${TEAM}`)).toMatchObject({
        uid: identity.uid,
        teamId: TEAM,
        createdVia: "admin_direct",
        grantedBy: IDENTITY_AUDIT_ACTOR,
      });
      expect(world.docs.get(`teamMemberships/${identity.uid}__${TEAM}`)).not.toHaveProperty("role");
    }

    expect(world.docs.get(`teamMemberships/${PRESENTER}__${TEAM}`)).toBe(presenterBefore);
    expect(world.accounts.get(PRESENTER)?.disabled).toBe(false);
    expect(world.createdPaths.every((path) => path.startsWith("teamMemberships/demo-member-") || path.startsWith("userProfiles/demo-member-"))).toBe(true);
  });

  it("stores the display name sealed, never in plaintext, and without a uid field", async () => {
    const world = new FakeWorld();
    await runIdentityProvisioning(input(world, WRITE));
    const profile = world.docs.get("userProfiles/demo-member-01") as Record<string, unknown>;
    expect(profile).not.toHaveProperty("displayName");
    expect(profile).not.toHaveProperty("uid");
    expect(JSON.stringify(profile)).not.toContain("Ingrid Solberg");
  });

  it("is a no-op on rerun once everything matches", async () => {
    const world = new FakeWorld();
    await runIdentityProvisioning(input(world, WRITE));
    const authBefore = world.authCreates;
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.at(-1)).toContain("nothing to write");
    expect(world.authCreates).toBe(authBefore);
    expect(world.batchCommits).toBe(1);
  });

  it("resumes after an Auth failure: nothing is written to Firestore, and the rerun creates only what is missing", async () => {
    const world = new FakeWorld();
    world.authFailAfter = 3;
    const failed = await runIdentityProvisioning(input(world, WRITE));
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr[0]).toContain("auth-create-failed");
    expect(failed.stdout.at(-1)).toContain("created 3 of 10");
    expect(world.accounts.size).toBe(1 + 3);
    expect(world.batchCommits).toBe(0);
    expect(world.createdPaths).toEqual([]);

    world.authFailAfter = null;
    const resumed = await runIdentityProvisioning(input(world, WRITE));
    expect(resumed.exitCode).toBe(0);
    expect(world.accounts.size).toBe(1 + 10);
    expect(world.createdPaths).toHaveLength(20);
    expect(world.batchCommits).toBe(1);
  });

  it("resumes after a Firestore failure: Auth stays created, the batch wrote nothing, and the rerun creates the documents", async () => {
    const world = new FakeWorld();
    world.batchFails = true;
    const failed = await runIdentityProvisioning(input(world, WRITE));
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr[0]).toContain("firestore-write-failed");
    expect(world.authCreates).toBe(10);
    expect(world.createdPaths).toEqual([]);

    world.batchFails = false;
    const resumed = await runIdentityProvisioning(input(world, WRITE));
    expect(resumed.exitCode).toBe(0);
    expect(world.authCreates).toBe(10);
    expect(world.createdPaths).toHaveLength(20);
  });

  it("skips an Auth account that already matches and creates the rest of a partially provisioned set", async () => {
    const world = new FakeWorld();
    world.accounts.set("demo-member-02", account("demo-member-02", "magnus.eriksen@example.com", true));
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(0);
    expect(world.authCreates).toBe(9);
  });

  it("writes nothing when any existing record conflicts, and names the conflict", async () => {
    const world = new FakeWorld();
    world.accounts.set("demo-member-05", account("demo-member-05", "thea.berg@example.com", false));
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Conflict: demo-member-05 auth (account-enabled)");
    expect(world.authCreates).toBe(0);
    expect(world.batchCommits).toBe(0);
  });

  it("refuses to write an e-mail already owned by a different account", async () => {
    const world = new FakeWorld();
    world.accounts.set("someone-else", account("someone-else", "nora.vik@example.com", false));
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(world.authCreates).toBe(0);
  });

  it("refuses when the presenter is not the team's teamadmin", async () => {
    const world = new FakeWorld();
    world.docs.set(`teamMemberships/${PRESENTER}__${TEAM}`, { uid: PRESENTER, teamId: TEAM });
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toContain("presenter-not-teamadmin");
    expect(world.authCreates).toBe(0);
  });

  it("refuses when the target team does not exist", async () => {
    const world = new FakeWorld();
    world.docs.delete(`teams/${TEAM}`);
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toContain("team-missing");
    expect(world.authCreates).toBe(0);
  });

  it("opens an existing profile to detect a different display name as a conflict", async () => {
    const world = new FakeWorld();
    world.docs.set(
      "userProfiles/demo-member-04",
      toPersistedUserProfile("demo-member-04", { displayName: "Someone Else", createdAt: AS_OF, updatedAt: AS_OF }, demoCrypto.sealRecord),
    );
    const result = await runIdentityProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Conflict: demo-member-04 profile (profile-name-differs)");
  });
});
