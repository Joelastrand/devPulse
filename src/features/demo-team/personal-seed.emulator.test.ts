import { teamPlanCounts } from "./team-plan-counts";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFirebaseDemoAdapters, loadFirebaseAdminSdk } from "./adapters";
import { demoCrypto } from "./crypto";
import { loadProductionPersonalWriters } from "./personal-seed";
import { runDemoSeed } from "./runner";
import { buildDemoSeedPlan } from "./plan";
import { DemoWriteError, writeDemoOperations } from "./writer";

/**
 * End-to-end verification of the seed against ISOLATED Firebase emulators (never live Firebase). It runs only when both
 * emulator hosts are given explicitly, for example:
 *   DEVPULSE_SEED_EMULATOR_FIRESTORE=127.0.0.1:8291  DEVPULSE_SEED_EMULATOR_AUTH=127.0.0.1:9291
 * Identities are test-only (`seed-test-uid-*`, reserved `example.com` addresses). The generated key and the encryption
 * key exist only in this process. The project id starts with `demo-`, which the Admin safety check requires for emulators.
 */
const FIRESTORE_HOST = process.env.DEVPULSE_SEED_EMULATOR_FIRESTORE;
const AUTH_HOST = process.env.DEVPULSE_SEED_EMULATOR_AUTH;
const suite = FIRESTORE_HOST && AUTH_HOST ? describe : describe.skip;

const PROJECT = "demo-devpulse-seedtest";
const PRESENTER = "seed-test-uid-1";
const OTHER_OWNER = "seed-test-uid-2";
const MISMATCH_OWNER = "seed-test-uid-3";
const AS_OF = "2026-03-16";
const now = () => new Date("2026-03-16T10:00:00.000Z");

const teamWrite = ["--project", PROJECT, "--presenter-uid", PRESENTER, "--as-of", AS_OF, "--write", "--confirm", PROJECT];
const personalWrite = (uid: string) => ["--project", PROJECT, "--presenter-uid", uid, "--as-of", AS_OF, "--personal", "--write", "--confirm", PROJECT];

async function clearIsolatedProject(host: string): Promise<void> {
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  if (!response.ok) throw new Error("could not clear the isolated emulator project");
}

/** Removes every test account from the isolated Auth emulator (emulator endpoint only). */
async function clearIsolatedAuth(host: string): Promise<void> {
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  if (!response.ok) throw new Error("could not clear the isolated auth emulator");
}

suite("personal seed against isolated emulators (test-only identities and keys)", () => {
  let firestore: ReturnType<typeof getFirestore>;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
    process.env.FIREBASE_PROJECT_ID = PROJECT;
    process.env.FIREBASE_CLIENT_EMAIL = `seed@${PROJECT}.iam.gserviceaccount.com`;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    process.env.FIREBASE_PRIVATE_KEY = privateKey;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await clearIsolatedProject(FIRESTORE_HOST as string);
    await clearIsolatedAuth(AUTH_HOST as string);
    const setup = initializeApp({ projectId: PROJECT }, "emu-setup");
    await getAuth(setup).createUser({ uid: PRESENTER, email: "seed-test-1@example.com", emailVerified: true });
    firestore = getFirestore(initializeApp({ projectId: PROJECT }, "emu-verify"));
  });

  afterAll(async () => {
    await clearIsolatedProject(FIRESTORE_HOST as string).catch(() => undefined);
  });

  // The named team app is process-wide: every team run in this process reuses the one app (no second init under the same name).
  let sharedTeamApp: unknown;
  async function teamAdapters(target: { projectId: string; credentials: { clientEmail: string; privateKey: string } }) {
    const sdk = await loadFirebaseAdminSdk();
    const reusable = {
      ...sdk,
      initializeApp: (options: { projectId: string; credential: unknown }, name: string) =>
        (sharedTeamApp ??= sdk.initializeApp(options, name)) as ReturnType<typeof sdk.initializeApp>,
    };
    return createFirebaseDemoAdapters({ sdk: reusable, projectId: target.projectId, ...target.credentials });
  }

  const env = () => process.env as Readonly<Record<string, string | undefined>>;
  const readDoc = async (path: string) => {
    const snapshot = await firestore.doc(path).get();
    return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;
  };
  const count = async (path: string) => (await firestore.collection(path).count().get()).data().count;

  it("the personal write is refused before the team catalog exists, names the team seed, and writes nothing", async () => {
    const out = await runDemoSeed({
      argv: personalWrite(PRESENTER),
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters are not used in personal mode");
      },
      loadPersonalWriters: loadProductionPersonalWriters,
    });
    expect(out.exitCode).toBe(1);
    expect(out.stdout.join("\n")).toContain("Run the team seed first");
    expect(await count("skillTrees")).toBe(0);
    expect(await readDoc(`userDevelopment/${PRESENTER}/goals/demo-goal-01`)).toBeUndefined();
  }, 120_000);

  it("the team seed creates the twelve skill trees and the team documents", async () => {
    const out = await runDemoSeed({
      argv: teamWrite,
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: teamAdapters,
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain(`Write: committed ${teamPlanCounts().total} documents`);
    expect(await count("skillTrees")).toBe(12);
    expect(await readDoc("skillTrees/demo-skill-typescript")).toBeDefined();
  }, 120_000);

  it("the personal write creates the planned records; business content is sealed, owner-scoped and not plaintext", async () => {
    const out = await runDemoSeed({
      argv: personalWrite(PRESENTER),
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters are not used in personal mode");
      },
      loadPersonalWriters: loadProductionPersonalWriters,
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain("create 17, skip 0, conflict 0");
    expect(await count(`userDevelopment/${PRESENTER}/goals`)).toBe(6);
    expect(await count(`userDevelopment/${PRESENTER}/responsibilities`)).toBe(4);
    expect(await count(`userDevelopment/${PRESENTER}/achievements`)).toBe(5);
    expect(await count(`userDevelopment/${PRESENTER}/conversations`)).toBe(1);
    expect(await readDoc(`userDevelopment/${PRESENTER}/conversationParticipations/demo-conversation-01`)).toBeUndefined();

    const goal = await readDoc(`userDevelopment/${PRESENTER}/goals/demo-goal-01`);
    expect(JSON.stringify(goal)).not.toContain("Fullføre skyarkitekturkurs");
    expect(goal).toHaveProperty("content.ciphertext");

    const conversation = await readDoc(`userDevelopment/${PRESENTER}/conversations/demo-conversation-01`);
    expect(JSON.stringify(conversation)).not.toContain("Utviklingssamtale");
    expect(conversation).toHaveProperty("keyCheck");

    const profile = await readDoc(`skillProfiles/${PRESENTER}`);
    const levels = profile?.levels as Record<string, { ciphertext?: unknown }>;
    expect(Object.keys(levels)).toHaveLength(12);
    expect(typeof levels["demo-skill-typescript"].ciphertext).toBe("string");
  }, 120_000);

  it("a second run skips every identical record and changes no stored ciphertext", async () => {
    const before = JSON.stringify(await readDoc(`userDevelopment/${PRESENTER}/goals/demo-goal-01`));
    const out = await runDemoSeed({
      argv: personalWrite(PRESENTER),
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters are not used in personal mode");
      },
      loadPersonalWriters: loadProductionPersonalWriters,
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain("create 0, skip 17, conflict 0");
    expect(JSON.stringify(await readDoc(`userDevelopment/${PRESENTER}/goals/demo-goal-01`))).toBe(before);
  }, 120_000);

  it("a conflicting existing record stops the run and is not overwritten", async () => {
    const path = `userDevelopment/${PRESENTER}/goals/demo-goal-02`;
    const changed = new Date("2030-01-01T00:00:00.000Z");
    await firestore.doc(path).update({ updatedAt: changed });
    const out = await runDemoSeed({
      argv: personalWrite(PRESENTER),
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters are not used in personal mode");
      },
      loadPersonalWriters: loadProductionPersonalWriters,
    });
    expect(out.exitCode).toBe(1);
    expect(out.stdout.join("\n")).toContain("Nothing was overwritten");
    const stored = await readDoc(path);
    expect((stored?.updatedAt as { toDate(): Date }).toDate().toISOString()).toBe(changed.toISOString());
  }, 120_000);

  it("the account-erasure fence refuses personal writes for an erasing owner, and no record is created", async () => {
    await firestore.doc(`accountErasures/${OTHER_OWNER}`).set({ status: "in_progress" });
    const out = await runDemoSeed({
      argv: personalWrite(OTHER_OWNER),
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters are not used in personal mode");
      },
      loadPersonalWriters: loadProductionPersonalWriters,
    });
    expect(out.exitCode).toBe(1);
    expect(await count(`userDevelopment/${OTHER_OWNER}/goals`)).toBe(0);
    expect(await readDoc(`skillProfiles/${OTHER_OWNER}`)).toBeUndefined();
  }, 120_000);

  it("a project mismatch is rejected by the configuration gate before any mutation", async () => {
    const out = await runDemoSeed({
      argv: ["--project", "demo-devpulse-other", "--presenter-uid", MISMATCH_OWNER, "--as-of", AS_OF, "--personal", "--write", "--confirm", "demo-devpulse-other"],
      env: env(),
      now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => {
        throw new Error("team adapters are not used in personal mode");
      },
      loadPersonalWriters: loadProductionPersonalWriters,
    });
    expect(out.exitCode).toBe(2);
    expect(await count(`userDevelopment/${MISMATCH_OWNER}/goals`)).toBe(0);
    expect(await readDoc(`skillProfiles/${MISMATCH_OWNER}`)).toBeUndefined();
  }, 120_000);

  it("an identical team rerun writes nothing: every planned document is byte-for-byte unchanged", async () => {
    const plan = buildDemoSeedPlan({ presenterUid: PRESENTER, asOf: new Date(`${AS_OF}T00:00:00.000Z`), sealRecord: demoCrypto.sealRecord });
    const paths = plan.operations.map((op) => op.path);
    const snapshot = async () => JSON.stringify(await Promise.all(paths.map(async (path) => [path, (await firestore.doc(path).get()).data() ?? null])));
    const before = await snapshot();
    const out = await runDemoSeed({ argv: teamWrite, env: env(), now, crypto: demoCrypto, createOnlineAdapters: teamAdapters });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain("nothing to write");
    expect(await snapshot()).toBe(before);
  }, 120_000);

  it("a document created by a concurrent writer before the commit fails the whole batch: no partial write, no overwrite", async () => {
    const plan = buildDemoSeedPlan({ presenterUid: PRESENTER, asOf: new Date(`${AS_OF}T00:00:00.000Z`), sealRecord: demoCrypto.sealRecord });
    const planned = ["teamProjects/demo-project-api", "teamSkills/skTypescript"];
    for (const path of planned) await firestore.doc(path).delete();
    const ops = plan.operations.filter((op) => planned.includes(op.path));
    expect(ops).toHaveLength(2);
    const concurrent = { concurrentWriter: true };
    const batch = firestore.batch();
    const commitBatch = {
      create(path: string, data: unknown) {
        batch.create(firestore.doc(path), data as Record<string, unknown>);
      },
      set() {
        throw new Error("the create-only batch has no set");
      },
      async commit() {
        // A concurrent writer creates the second planned document after preflight and before this commit.
        await firestore.doc(planned[1]).set(concurrent);
        await batch.commit();
      },
    };
    const error = await writeDemoOperations({ operations: ops, manifest: plan.manifest, createBatch: () => commitBatch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoWriteError);
    expect((error as DemoWriteError).category).toBe("write_failed");
    expect((await firestore.doc(planned[0]).get()).exists).toBe(false);
    expect((await firestore.doc(planned[1]).get()).data()).toEqual(concurrent);
  }, 120_000);

  it("stored team records hold no plaintext business content and carry the selected team id", async () => {
    const project = (await firestore.doc("teamProjects/demo-project-devplatform").get()).data() ?? {};
    expect(JSON.stringify(project)).not.toContain("Forbedret utviklerplattform");
    expect(project.teamId).toBe("demo-team");
    const system = (await firestore.doc("teamSystems/demo-system-integration").get()).data() ?? {};
    expect(JSON.stringify(system)).not.toContain("Meldingskøene har hatt");
    expect(system.teamId).toBe("demo-team");
    const plan = (await firestore.doc("teamCompetencePlans/5f1d0c00-0000-4000-8000-000000000001").get()).data() ?? {};
    expect(JSON.stringify(plan)).not.toContain("Skyplattform og sikker drift");
    expect(plan.teamId).toBe("demo-team");
    const skill = (await firestore.doc("teamSkills/skReact").get()).data() ?? {};
    expect(JSON.stringify(skill)).not.toContain("Komponentbasert utvikling");
    expect(skill.teamId).toBe("demo-team");
  });
});
