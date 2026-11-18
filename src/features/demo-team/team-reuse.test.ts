import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDemoSeedPlan, buildDemoManifest, type PlannedOperation } from "./plan";
import { runDemoPreflight, type DemoReader, type DemoScope } from "./preflight";
import { demoCrypto } from "./crypto";
import { toPersistedTeam } from "../teams/domain/team-content-codec";
import { resolveDemoSeedConfig } from "./config";

/**
 * Reuse of an existing team (approved target 8yB2bS8Jav69TCfDETON). Offline, deterministic, no Firebase. The team record is sealed
 * with the real codec and a test-only key, so the preflight's decryption check is exercised for real.
 */
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const EXISTING_TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const ASOF_TEXT = "2026-11-13";

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function plan(teamId: string) {
  return buildDemoSeedPlan({ presenterUid: PRESENTER, asOf: AS_OF, teamId, sealRecord: demoCrypto.sealRecord });
}

/** The existing team as the application stores it: sealed name, plaintext metadata. */
function existingTeam(overrides: { createdBy?: string; status?: string } = {}): Record<string, unknown> {
  const sealed = toPersistedTeam(
    EXISTING_TEAM,
    { name: "Eksisterende demoteam", status: "active", createdAt: new Date("2026-06-01T00:00:00.000Z"), createdBy: PRESENTER },
    demoCrypto.sealRecord,
  ) as Record<string, unknown>;
  return { ...sealed, status: overrides.status ?? "active", createdBy: overrides.createdBy ?? PRESENTER, visibility: "private" };
}

/** An online reader over an in-memory map of exact paths; every other path is absent. Read-only in every sense. */
function readerOver(docs: Record<string, unknown>): DemoReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async get(path: string) {
      reads.push(path);
      return path in docs ? { exists: true, data: docs[path] } : { exists: false };
    },
  };
}

function config(teamId: string) {
  const resolved = resolveDemoSeedConfig({
    argv: ["--project", "devpulse-nve", "--presenter-uid", PRESENTER, "--as-of", ASOF_TEXT, "--team-id", teamId],
    env: { FIREBASE_PROJECT_ID: "devpulse-nve", FIREBASE_CLIENT_EMAIL: "seed@devpulse-nve.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "placeholder" },
    now: () => AS_OF,
  });
  if (!resolved.ok) throw new Error("test config");
  return resolved.config;
}

const scopeFor = (teamId: string): DemoScope => ({ teamId, reuseExistingTeam: teamId !== "demo-team", presenterUid: PRESENTER });

function presenter() {
  return { userExists: async () => true, hasErasureRecord: async () => false };
}

describe("--team-id: the selected team id is applied consistently to every team-scoped document", () => {
  it("with an existing team id, no document is planned at teams/demo-team or any demo-team membership/roadmap path", () => {
    const operations = plan(EXISTING_TEAM).operations;
    const paths = operations.map((op) => op.path);
    expect(paths).not.toContain("teams/demo-team");
    expect(paths.some((p) => p.includes("demo-team"))).toBe(false);
    expect(paths).toContain(`teams/${EXISTING_TEAM}`);
    expect(paths).toContain(`teamMemberships/${PRESENTER}__${EXISTING_TEAM}`);
  });

  it("team-scoped records carry the selected team id in their fields and identifiers", () => {
    const operations = plan(EXISTING_TEAM).operations;
    const surveys = operations.filter((op) => op.collection === "surveys" && op.docId.startsWith("demo-survey-0"));
    expect(surveys.every((op) => (op.data as { teamId: string }).teamId === EXISTING_TEAM)).toBe(true);
    const progress = operations.filter((op) => op.collection === "skillProgress");
    expect(progress.every((op) => op.docId.startsWith(`${EXISTING_TEAM}__`))).toBe(true);
    const roadmap = operations.filter((op) => op.collection === "roadmapItems");
    expect(roadmap.every((op) => op.docId.startsWith(`${EXISTING_TEAM}__`))).toBe(true);
    const challenges = operations.filter((op) => op.collection === "challenges");
    expect(challenges.every((op) => (op.data as { teamId: string }).teamId === EXISTING_TEAM)).toBe(true);
  });

  it("the default (no --team-id) keeps the original demo-team paths, so offline tests are unchanged", () => {
    const paths = buildDemoManifest(PRESENTER).map((m) => m.path);
    expect(paths).toContain("teams/demo-team");
    expect(config("demo-team").teamId).toBe("demo-team");
  });

  it("refuses a malformed team id before any planning (no slash, no membership separator, bounded)", () => {
    for (const bad of ["a/b", "x__y", "-leading", "a".repeat(129)]) {
      const resolved = resolveDemoSeedConfig({
        argv: ["--project", "devpulse-nve", "--presenter-uid", PRESENTER, "--as-of", ASOF_TEXT, "--team-id", bad],
        env: { FIREBASE_PROJECT_ID: "devpulse-nve", FIREBASE_CLIENT_EMAIL: "seed@devpulse-nve.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "placeholder" },
        now: () => AS_OF,
      });
      expect(resolved.ok).toBe(false);
    }
  });
});

describe("reusing the existing team: the team is never written, and a missing or foreign team is refused", () => {
  it("the existing team opens with the configured key and is compatible: the team document is skipped, the presenter membership is created", async () => {
    const reader = readerOver({ [`teams/${EXISTING_TEAM}`]: existingTeam() });
    const built = plan(EXISTING_TEAM);
    const result = await runDemoPreflight({
      config: config(EXISTING_TEAM),
      operations: built.operations,
      manifest: built.manifest,
      crypto: demoCrypto,
      online: { reader, presenter: presenter() },
      scope: scopeFor(EXISTING_TEAM),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const team = result.classifications.find((c) => c.path === `teams/${EXISTING_TEAM}`);
    expect(team).toMatchObject({ state: "COMPATIBLE", action: "skip" });
    const membership = result.classifications.find((c) => c.path === `teamMemberships/${PRESENTER}__${EXISTING_TEAM}`);
    expect(membership).toMatchObject({ state: "ABSENT", action: "create" });
    expect(result.plannedOperations.some((op: PlannedOperation) => op.collection === "teams")).toBe(false);
    expect(result.plannedOperations.length).toBe(built.operations.length - 1);
    expect(reader.reads.some((p) => p.startsWith("teams/demo-team"))).toBe(false);
  });

  it("a team that is absent is refused (team-missing); reuse never creates a team", async () => {
    const built = plan(EXISTING_TEAM);
    const result = await runDemoPreflight({
      config: config(EXISTING_TEAM),
      operations: built.operations,
      manifest: built.manifest,
      crypto: demoCrypto,
      online: { reader: readerOver({}), presenter: presenter() },
      scope: scopeFor(EXISTING_TEAM),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.classifications.find((c) => c.path === `teams/${EXISTING_TEAM}`)).toMatchObject({ reason: "team-missing" });
  });

  it("a team created by another person is refused (foreign-creator) and nothing is planned", async () => {
    const built = plan(EXISTING_TEAM);
    const result = await runDemoPreflight({
      config: config(EXISTING_TEAM),
      operations: built.operations,
      manifest: built.manifest,
      crypto: demoCrypto,
      online: { reader: readerOver({ [`teams/${EXISTING_TEAM}`]: existingTeam({ createdBy: "someone-else" }) }), presenter: presenter() },
      scope: scopeFor(EXISTING_TEAM),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.classifications.find((c) => c.path === `teams/${EXISTING_TEAM}`)).toMatchObject({ reason: "foreign-creator" });
  });

  it("a disabled team is refused (team-disabled)", async () => {
    const built = plan(EXISTING_TEAM);
    const result = await runDemoPreflight({
      config: config(EXISTING_TEAM),
      operations: built.operations,
      manifest: built.manifest,
      crypto: demoCrypto,
      online: { reader: readerOver({ [`teams/${EXISTING_TEAM}`]: existingTeam({ status: "disabled" }) }), presenter: presenter() },
      scope: scopeFor(EXISTING_TEAM),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.classifications.find((c) => c.path === `teams/${EXISTING_TEAM}`)).toMatchObject({ reason: "team-disabled" });
  });

  it("a team sealed under another key cannot be opened, and the run is refused before any write", async () => {
    const sealedWithOtherKey = existingTeam();
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const built = plan(EXISTING_TEAM);
    const result = await runDemoPreflight({
      config: config(EXISTING_TEAM),
      operations: built.operations,
      manifest: built.manifest,
      crypto: demoCrypto,
      online: { reader: readerOver({ [`teams/${EXISTING_TEAM}`]: sealedWithOtherKey }), presenter: presenter() },
      scope: scopeFor(EXISTING_TEAM),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const reasons = result.classifications.map((c) => c.reason);
    expect(reasons).toContain("undecryptable");
  });
});

