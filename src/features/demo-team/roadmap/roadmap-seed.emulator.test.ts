import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { DEMO_SKILL_TREES } from "../fixtures";
import { generateMemberRef } from "../../teams/domain/member-ref";
import { roadmapItemDocId } from "../../roadmap/domain/roadmap-item";
import { openRoadmapItemDocument, toPersistedRoadmapItem } from "../../roadmap/domain/roadmap-item-content-codec";
import { DEMO_ROADMAP_EXPANSION } from "./fixtures";
import { createRoadmapOnlineAdapters } from "./adapters";
import { runRoadmapProvisioning, type RoadmapRunnerInput } from "./runner";

/**
 * Emulator suite for the roadmap expansion seed (Phase E). Real Firebase Admin SDK transactions against the Firestore emulator
 * only. Skipped unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set. Each case uses its own fresh `demo-`
 * project, deleted afterwards. No live project is contacted.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(EMULATOR_HOST) && process.env.DEVPULSE_EMULATOR_PROJECT !== undefined;
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const created: string[] = [];

describe.skipIf(!enabled)("roadmap expansion seed on the Firestore emulator", () => {
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
    const project = `demo-roadmap-seed-${Math.random().toString(36).slice(2, 10)}`;
    created.push(project);
    const app = adminApp.initializeApp({ credential: credential as never, projectId: project }, `setup-${project}`);
    const db = firestore.getFirestore(app);
    await db.doc(`teams/${TEAM}`).set({ status: "active" });
    await db.doc(`teamMemberships/${PRESENTER}__${TEAM}`).set({ uid: PRESENTER, teamId: TEAM, role: "teamadmin" });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const membership = { ...buildIdentityMembership(identity, TEAM, AS_OF), memberRef: refs.get(identity.uid) };
      await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).set(membership);
    }
    for (const tree of DEMO_SKILL_TREES) {
      await db.doc(`skillTrees/${tree.id}`).set({ name: tree.name });
    }
    return { project, db };
  }

  function runner(project: string, extra: string[], plans = DEMO_ROADMAP_EXPANSION): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
    const sdk = {
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
    const input: RoadmapRunnerInput = {
      argv: ["--project", project, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-13", ...extra],
      env: { FIREBASE_PROJECT_ID: project, FIREBASE_CLIENT_EMAIL: `seed@${project}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: "not-a-real-key" },
      now: () => AS_OF,
      crypto: demoCrypto,
      createOnlineAdapters: async () => createRoadmapOnlineAdapters({ sdk, projectId: project, clientEmail: "seed@x", privateKey: "not-a-real-key" }),
      plans,
    };
    return runRoadmapProvisioning(input);
  }

  const WRITE = (project: string) => ["--write", `--confirm=${project}`];

  it("creates every roadmap plan, sealed, owned by the member's existing memberRef, and changes nothing else", async () => {
    const { project, db } = await freshProject();
    const result = await runner(project, WRITE(project));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain("create 6");

    for (const plan of DEMO_ROADMAP_EXPANSION) {
      const snap = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, plan.treeId)}`).get()).data() as Record<string, unknown>;
      expect(snap).toBeDefined();
      for (const key of ["targetNodeId", "priority", "status", "startDate", "targetDate", "ownerRef"]) {
        expect(snap).not.toHaveProperty(key);
      }
      const opened = openRoadmapItemDocument(snap, demoCrypto.openRecord) as Record<string, unknown>;
      expect(opened.ownerRef).toBe(refs.get(plan.ownerUid));
      expect(opened.targetNodeId).toBe(plan.targetNodeId);
    }
    // The three pre-existing tree plans are not in this fixture set and must not appear.
    const untouched = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, "demo-skill-testing")}`).get()).exists;
    expect(untouched).toBe(false);
  });

  it("rerunning after success is a no-op: every plan is skipped and nothing is written", async () => {
    const { project, db } = await freshProject();
    expect((await runner(project, WRITE(project))).exitCode).toBe(0);
    const before = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, DEMO_ROADMAP_EXPANSION[0].treeId)}`).get()).data();

    const rerun = await runner(project, WRITE(project));
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.join("\n")).toContain("skip 6");
    const after = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, DEMO_ROADMAP_EXPANSION[0].treeId)}`).get()).data();
    expect(after).toEqual(before);
  });

  it("aborts with no write when an existing plan differs, and never overwrites it", async () => {
    const { project, db } = await freshProject();
    const first = DEMO_ROADMAP_EXPANSION[0];
    const differing = {
      teamId: TEAM,
      treeId: first.treeId,
      targetNodeId: "node-0",
      priority: first.priority,
      status: first.status,
      startDate: first.startDate,
      targetDate: first.targetDate,
      ownerRef: refs.get(first.ownerUid),
      createdAt: AS_OF,
      createdBy: "someone-else",
      updatedAt: AS_OF,
      updatedBy: "someone-else",
    };
    const stored = toPersistedRoadmapItem({ ...differing }, demoCrypto.sealRecord);
    await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, first.treeId)}`).set(stored);

    const result = await runner(project, WRITE(project));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("conflicts-found");
    const kept = (await db.doc(`roadmapItems/${roadmapItemDocId(TEAM, first.treeId)}`).get()).data() as Record<string, unknown>;
    // Timestamps come back as Firestore Timestamps, so compare the sealed content and the accountability uid instead.
    expect(kept.content).toEqual(stored.content);
    expect(kept.createdBy).toBe("someone-else");
    const others = await Promise.all(
      DEMO_ROADMAP_EXPANSION.slice(1).map((p) => db.doc(`roadmapItems/${roadmapItemDocId(TEAM, p.treeId)}`).get()),
    );
    expect(others.every((snap) => !snap.exists)).toBe(true);
  });
});
