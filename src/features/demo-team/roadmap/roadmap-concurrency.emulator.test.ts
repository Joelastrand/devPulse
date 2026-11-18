import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { DEMO_SKILL_TREES } from "../fixtures";
import { generateMemberRef } from "../../teams/domain/member-ref";
import { roadmapItemDocId, type RoadmapItemRecord } from "../../roadmap/domain/roadmap-item";
import { openRoadmapItemDocument, toPersistedRoadmapItem } from "../../roadmap/domain/roadmap-item-content-codec";
import { DEMO_ROADMAP_EXPANSION } from "./fixtures";
import { createRoadmapOnlineAdapters } from "./adapters";
import { runRoadmapProvisioning, type RoadmapRunnerInput } from "./runner";
import { runOwnerAssignments, DEMO_ROADMAP_OWNER_ASSIGNMENTS, type OwnerRunnerInput } from "./owners-runner";

/**
 * Emulator suite for roadmap seeding under concurrency and for the owner update (Phase E2). Real Firebase Admin SDK transactions
 * against the Firestore emulator only. Skipped unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set. Each
 * case uses its own fresh `demo-` project, deleted afterwards. No live project is contacted.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(EMULATOR_HOST) && process.env.DEVPULSE_EMULATOR_PROJECT !== undefined;
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const LATER = new Date("2026-11-16T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");
const created: string[] = [];

/** The three original plans as they were seeded: no owner, values fixed here so the test can assert them. */
const ORIGINAL_PLANS: readonly RoadmapItemRecord[] = [
  {
    teamId: TEAM, treeId: "demo-skill-testing", targetNodeId: "node-4", priority: "high", status: "active",
    startDate: "2026-10-30", targetDate: "2027-01-12", createdAt: AS_OF, createdBy: "demo-seed", updatedAt: AS_OF, updatedBy: "demo-seed",
  },
  {
    teamId: TEAM, treeId: "demo-skill-observability", targetNodeId: "node-2", priority: "medium", status: "planned",
    createdAt: AS_OF, createdBy: "demo-seed", updatedAt: AS_OF, updatedBy: "demo-seed",
  },
  {
    teamId: TEAM, treeId: "demo-skill-delivery", targetNodeId: "node-4", priority: "low", status: "completed",
    completedAt: AS_OF, createdAt: AS_OF, createdBy: "demo-seed", updatedAt: AS_OF, updatedBy: "demo-seed",
  },
];

describe.skipIf(!enabled)("roadmap seeding under concurrency and owner updates on the Firestore emulator", () => {
  let adminApp: typeof import("firebase-admin/app");
  let firestore: typeof import("firebase-admin/firestore");
  let credential: unknown;
  const refs = new Map<string, string>();

  beforeAll(async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    adminApp = await import("firebase-admin/app");
    firestore = await import("firebase-admin/firestore");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    credential = adminApp.cert({ projectId: "demo-x", clientEmail: "emulator@demo-x.iam.gserviceaccount.com", privateKey });
    for (const identity of DEMO_MEMBER_IDENTITIES) refs.set(identity.uid, generateMemberRef());
  }, 60_000);

  afterAll(async () => {
    if (!EMULATOR_HOST) return;
    for (const project of created) {
      await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
    }
    vi.unstubAllEnvs();
  });

  /** A fresh project: the team, the presenter, ten ordinary memberships with memberRefs, and every skill tree. */
  async function freshProject() {
    const project = `demo-roadmap-conc-${Math.random().toString(36).slice(2, 10)}`;
    created.push(project);
    const app = adminApp.initializeApp({ credential: credential as never, projectId: project }, `setup-${project}`);
    const db = firestore.getFirestore(app);
    await db.doc(`teams/${TEAM}`).set({ status: "active" });
    await db.doc(`teamMemberships/${PRESENTER}__${TEAM}`).set({ uid: PRESENTER, teamId: TEAM, role: "teamadmin" });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).set({ ...buildIdentityMembership(identity, TEAM, AS_OF), memberRef: refs.get(identity.uid) });
    }
    for (const tree of DEMO_SKILL_TREES) await db.doc(`skillTrees/${tree.id}`).set({ name: tree.name });
    return { project, db };
  }

  /** Stores the three original plans without an owner, exactly as the original seed did (sealed, owner index absent). */
  async function seedOriginals(db: FirebaseDb): Promise<void> {
    for (const record of ORIGINAL_PLANS) {
      await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, record.treeId)}`).set(toPersistedRoadmapItem({ ...record }, demoCrypto.sealRecord));
    }
  }

  function makeSdk() {
    return {
      cert: () => ({}),
      initializeApp: (opts: { projectId: string }, name: string) => {
        const appName = `${name}-${opts.projectId}`;
        try {
          return adminApp.getApp(appName);
        } catch {
          return adminApp.initializeApp({ credential: credential as never, projectId: opts.projectId }, appName);
        }
      },
      getFirestore: (a: unknown) => firestore.getFirestore(a as import("firebase-admin/app").App),
      getAuth: () => {
        throw new Error("not used");
      },
    } as unknown as Parameters<typeof createRoadmapOnlineAdapters>[0]["sdk"];
  }

  function argvFor(project: string, extra: string[]): string[] {
    return ["--project", project, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-13", ...extra];
  }

  function envFor(project: string): Record<string, string> {
    return { FIREBASE_PROJECT_ID: project, FIREBASE_CLIENT_EMAIL: `seed@${project}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: "not-a-real-key" };
  }

  function createRun(project: string, extra: string[]) {
    const sdk = makeSdk();
    const input: RoadmapRunnerInput = {
      argv: argvFor(project, extra),
      env: envFor(project),
      now: () => AS_OF,
      crypto: demoCrypto,
      createOnlineAdapters: async () => createRoadmapOnlineAdapters({ sdk, projectId: project, clientEmail: "seed@x", privateKey: "not-a-real-key" }),
      plans: DEMO_ROADMAP_EXPANSION,
    };
    return runRoadmapProvisioning(input);
  }

  function ownerRun(project: string, extra: string[], now: Date = LATER) {
    const sdk = makeSdk();
    const input: OwnerRunnerInput = {
      argv: argvFor(project, extra),
      env: envFor(project),
      now: () => now,
      crypto: demoCrypto,
      createOnlineAdapters: async () => createRoadmapOnlineAdapters({ sdk, projectId: project, clientEmail: "seed@x", privateKey: "not-a-real-key" }),
    };
    return runOwnerAssignments(input);
  }

  const WRITE = (project: string) => ["--write", `--confirm=${project}`];

  it("two concurrent creation runs never overwrite a roadmap document", async () => {
    const { project, db } = await freshProject();
    const [a, b] = await Promise.all([createRun(project, WRITE(project)), createRun(project, WRITE(project))]);
    for (const result of [a, b]) expect([0, 1]).toContain(result.exitCode);

    const creators = [a, b].filter((r) => r.stdout.join("\n").includes("created 6"));
    expect(creators.length).toBeLessThanOrEqual(1);

    for (const plan of DEMO_ROADMAP_EXPANSION) {
      const snap = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, plan.treeId)}`).get()).data() as Record<string, unknown>;
      expect(snap).toBeDefined();
      const opened = openRoadmapItemDocument(snap, demoCrypto.openRecord) as Record<string, unknown>;
      expect(opened.targetNodeId).toBe(plan.targetNodeId);
      expect(opened.ownerRef).toBe(refs.get(plan.ownerUid));
      expect(opened.createdBy).toBe("demo-seed");
    }
  });

  it("an existing roadmap document created by someone else is never overwritten by a concurrent run", async () => {
    const { project, db } = await freshProject();
    const first = DEMO_ROADMAP_EXPANSION[0];
    const foreign = toPersistedRoadmapItem(
      {
        teamId: TEAM, treeId: first.treeId, targetNodeId: "node-0", priority: "low", status: "planned",
        createdAt: AS_OF, createdBy: "someone-else", updatedAt: AS_OF, updatedBy: "someone-else",
      },
      demoCrypto.sealRecord,
    );
    await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, first.treeId)}`).set(foreign);

    const [a, b] = await Promise.all([createRun(project, WRITE(project)), createRun(project, WRITE(project))]);
    expect(a.exitCode).toBe(1);
    expect(b.exitCode).toBe(1);

    const kept = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, first.treeId)}`).get()).data() as Record<string, unknown>;
    expect(kept.content).toEqual(foreign.content);
    expect(kept.createdBy).toBe("someone-else");
  });

  it("an identical rerun of the owner update produces zero writes", async () => {
    const { project, db } = await freshProject();
    await seedOriginals(db);
    expect((await ownerRun(project, WRITE(project))).exitCode).toBe(0);
    const id = roadmapItemDocId(TEAM, "demo-skill-observability");
    const before = (await db.doc(`roadmapItems/${id}`).get()).data() as Record<string, unknown>;

    const rerun = await ownerRun(project, WRITE(project), new Date("2027-01-01T00:00:00.000Z"));
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.join("\n")).toContain("skip 3");
    const after = (await db.doc(`roadmapItems/${id}`).get()).data() as Record<string, unknown>;
    expect(after).toEqual(before);
  });

  it("rejects a conflicting owner update and leaves the document unchanged", async () => {
    const { project, db } = await freshProject();
    const id = roadmapItemDocId(TEAM, "demo-skill-observability");
    const other = DEMO_MEMBER_IDENTITIES.find((i) => i.uid !== "demo-member-08")!.uid;
    const owned = toPersistedRoadmapItem(
      { ...ORIGINAL_PLANS[1], ownerRef: refs.get(other) },
      demoCrypto.sealRecord,
    );
    await db.doc(`roadmapItems/${id}`).set(owned);

    const result = await ownerRun(project, WRITE(project));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.concat(result.stderr).join("\n")).toContain("owner-already-set");
    const kept = (await db.doc(`roadmapItems/${id}`).get()).data() as Record<string, unknown>;
    expect(kept.content).toEqual(owned.content);
    expect(kept.updatedBy).toBe("demo-seed");
  });

  it("assigns the owner and leaves every other business field and the creation metadata unchanged", async () => {
    const { project, db } = await freshProject();
    await seedOriginals(db);

    const result = await ownerRun(project, WRITE(project));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("update 3");

    for (const original of ORIGINAL_PLANS) {
      const id = roadmapItemDocId(TEAM, original.treeId);
      const snap = (await db.doc(`roadmapItems/${id}`).get()).data() as Record<string, unknown>;
      const opened = openRoadmapItemDocument(snap, demoCrypto.openRecord) as Record<string, unknown>;
      const owner = DEMO_ROADMAP_OWNER_ASSIGNMENTS.find((a) => a.treeId === original.treeId)!;

      expect(opened.ownerRef).toBe(refs.get(owner.ownerUid));
      expect(opened.targetNodeId).toBe(original.targetNodeId);
      expect(opened.priority).toBe(original.priority);
      expect(opened.status).toBe(original.status);
      expect(opened.startDate).toBe(original.startDate);
      expect(opened.targetDate).toBe(original.targetDate);
      expect(opened.completedAt === undefined ? undefined : new Date(opened.completedAt as string).toISOString()).toBe(
        original.completedAt?.toISOString(),
      );
      expect(snap.createdBy).toBe("demo-seed");
      expect(snap.teamId).toBe(TEAM);
      expect(snap.treeId).toBe(original.treeId);
      expect(snap.updatedBy).toBe("demo-seed");
    }
  });
});

type FirebaseDb = { doc(path: string): { set(data: unknown): Promise<unknown>; get(): Promise<{ data(): unknown }> } };
