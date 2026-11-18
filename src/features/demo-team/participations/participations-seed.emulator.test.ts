import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { DEMO_TEAM_PROJECTS, teamProjectRecord } from "../fixtures";
import { toPersistedTeamProject, openParticipationDocument } from "../../team-projects/server/team-project-codec";
import { isMemberRef } from "../../teams/domain/member-ref";
import { DEMO_PARTICIPATIONS } from "./fixtures";
import { createParticipationOnlineAdapters } from "./adapters";
import { runParticipationProvisioning, type ParticipationRunnerInput } from "./runner";

/**
 * Emulator suite for the participation seed (Phase D). Real Firebase Admin SDK transactions against the Firestore emulator
 * only. Skipped unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set. Each case uses its own fresh
 * `demo-` project id, and every project is deleted afterwards. No live project is ever contacted.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(EMULATOR_HOST) && process.env.DEVPULSE_EMULATOR_PROJECT !== undefined;
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
const created: string[] = [];

describe.skipIf(!enabled)("participation seed on the Firestore emulator", () => {
  let adminApp: typeof import("firebase-admin/app");
  let firestore: typeof import("firebase-admin/firestore");
  let credential: unknown;

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
  }, 60_000);

  afterAll(async () => {
    if (!EMULATOR_HOST) return;
    for (const project of created) {
      await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
    }
    vi.unstubAllEnvs();
  });

  /** A fresh project seeded with the team, the presenter, the ten fictional memberships and the six demo projects. */
  async function freshProject(options: { withErasure?: string } = {}) {
    const project = `demo-part-seed-${Math.random().toString(36).slice(2, 10)}`;
    created.push(project);
    const app = adminApp.initializeApp({ credential: credential as never, projectId: project }, `setup-${project}`);
    const db = firestore.getFirestore(app);
    await db.doc(`teams/${TEAM}`).set({ status: "active" });
    await db.doc(`teamMemberships/${PRESENTER}__${TEAM}`).set({ uid: PRESENTER, teamId: TEAM, role: "teamadmin" });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).set(buildIdentityMembership(identity, TEAM, AS_OF));
    }
    for (const p of DEMO_TEAM_PROJECTS) {
      const stored = toPersistedTeamProject(p.projectId, teamProjectRecord(p, TEAM, AS_OF), demoCrypto.sealRecord);
      await db.doc(`teamProjects/${p.projectId}`).set(stored);
    }
    if (options.withErasure !== undefined) {
      await db.doc(`accountErasures/${options.withErasure}`).set({ status: "pending" });
    }
    return { project, db };
  }

  function runner(project: string, extra: string[]): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
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
    } as unknown as Parameters<typeof createParticipationOnlineAdapters>[0]["sdk"];
    const input: ParticipationRunnerInput = {
      argv: ["--project", project, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-13", ...extra],
      env: { FIREBASE_PROJECT_ID: project, FIREBASE_CLIENT_EMAIL: `seed@${project}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: "not-a-real-key" },
      now: () => AS_OF,
      crypto: demoCrypto,
      createOnlineAdapters: async () => createParticipationOnlineAdapters({ sdk, projectId: project, clientEmail: "seed@x", privateKey: "not-a-real-key" }),
    };
    return runParticipationProvisioning(input);
  }

  const WRITE = (project: string) => ["--write", `--confirm=${project}`];

  it("sets a valid, unique memberRef on each membership and changes no other membership field", async () => {
    const { project, db } = await freshProject();
    const before = await db.doc(`teamMemberships/${DEMO_MEMBER_IDENTITIES[0].uid}__${TEAM}`).get();
    const result = await runner(project, WRITE(project));
    expect(result.exitCode).toBe(0);

    const refs = new Set<string>();
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const snap = (await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).get()).data() as Record<string, unknown>;
      expect(isMemberRef(snap.memberRef)).toBe(true);
      refs.add(snap.memberRef as string);
      expect(snap.role).toBeUndefined();
      expect(snap.uid).toBe(identity.uid);
      expect(snap.teamId).toBe(TEAM);
    }
    expect(refs.size).toBe(DEMO_MEMBER_IDENTITIES.length);

    const afterFirst = (await db.doc(`teamMemberships/${DEMO_MEMBER_IDENTITIES[0].uid}__${TEAM}`).get()).data() as Record<string, unknown>;
    const rest: Record<string, unknown> = { ...afterFirst };
    delete rest.memberRef;
    expect(rest).toEqual(before.data());
    const presenter = (await db.doc(`teamMemberships/${PRESENTER}__${TEAM}`).get()).data();
    expect(presenter).toEqual({ uid: PRESENTER, teamId: TEAM, role: "teamadmin" });
  });

  it("creates each participation with the member's memberRef, the project, and a note sealed under its own AAD", async () => {
    const { project, db } = await freshProject();
    await runner(project, WRITE(project));
    const first = DEMO_PARTICIPATIONS[0];
    const doc = (await db.doc(`teamProjectParticipations/${first.participationId}`).get()).data() as Record<string, unknown>;
    expect(doc.teamId).toBe(TEAM);
    expect(doc.projectId).toBe(first.projectId);
    expect(doc.archived).toBe(false);
    const member = (await db.doc(`teamMemberships/${first.uid}__${TEAM}`).get()).data() as Record<string, unknown>;
    expect(doc.memberRef).toBe(member.memberRef);
    expect(JSON.stringify(doc)).not.toContain(first.note);
    expect(openParticipationDocument(first.participationId, doc).note).toBe(first.note);
    // A sealed note must not open under another participation's id (AAD binding).
    expect(openParticipationDocument(DEMO_PARTICIPATIONS[1].participationId, doc).note).toBe(false);

    const count = (await db.collection("teamProjectParticipations").get()).size;
    expect(count).toBe(DEMO_PARTICIPATIONS.length);
  });

  it("is a no-op on rerun and leaves every stored document unchanged", async () => {
    const { project, db } = await freshProject();
    await runner(project, WRITE(project));
    const snapshot = (await db.collection("teamMemberships").get()).docs.map((d) => d.data());
    const participations = (await db.collection("teamProjectParticipations").get()).docs.map((d) => d.data());
    const rerun = await runner(project, WRITE(project));
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.join("\n")).toContain("nothing to write");
    expect((await db.collection("teamMemberships").get()).docs.map((d) => d.data())).toEqual(snapshot);
    expect((await db.collection("teamProjectParticipations").get()).docs.map((d) => d.data())).toEqual(participations);
  });

  it("refuses a conflicting participation and changes no membership at all", async () => {
    const { project, db } = await freshProject();
    const target = DEMO_PARTICIPATIONS[4];
    await db.doc(`teamProjectParticipations/${target.participationId}`).set({ teamId: TEAM, projectId: target.projectId, archived: true });
    const result = await runner(project, WRITE(project));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain(`Conflict: teamProjectParticipations/${target.participationId}`);
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const snap = (await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).get()).data() as Record<string, unknown>;
      expect(snap.memberRef).toBeUndefined();
    }
  });

  it("refuses when a member has an erasure record, writing nothing", async () => {
    const { project, db } = await freshProject({ withErasure: DEMO_MEMBER_IDENTITIES[6].uid });
    const result = await runner(project, WRITE(project));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain("erasure-record-present");
    const snap = (await db.doc(`teamMemberships/${DEMO_MEMBER_IDENTITIES[0].uid}__${TEAM}`).get()).data() as Record<string, unknown>;
    expect(snap.memberRef).toBeUndefined();
    expect((await db.collection("teamProjectParticipations").get()).size).toBe(0);
  });

  it("two concurrent runs leave one memberRef per member and each participation exactly once", async () => {
    const { project, db } = await freshProject();
    const [a, b] = await Promise.all([runner(project, WRITE(project)), runner(project, WRITE(project))]);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);

    const refs = new Set<string>();
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      const snap = (await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).get()).data() as Record<string, unknown>;
      expect(isMemberRef(snap.memberRef)).toBe(true);
      refs.add(snap.memberRef as string);
    }
    expect(refs.size).toBe(DEMO_MEMBER_IDENTITIES.length);
    expect((await db.collection("teamProjectParticipations").get()).size).toBe(DEMO_PARTICIPATIONS.length);
  });
});
