import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillProgressRecord } from "../domain/skill-progress";
import { skillProgressDocId } from "../domain/skill-progress";
import { startTeamSkillTracking } from "./start-team-skill-tracking";
import { stopTeamSkillTracking } from "./stop-team-skill-tracking";
import { updateTeamSkillProgress } from "./update-team-skill-progress";
import { reportTeamSkillProgress } from "./report-team-skill-progress";

/**
 * Writer-only fence for the team skill-progress writes (TASK-031, W-15). The production default stores run each write in a
 * transaction that reads `accountErasures/{adminUid}` first. A record there refuses the write and nothing is written.
 */

type Doc = Record<string, unknown>;

const { db } = vi.hoisted(() => {
  const docs = new Map<string, Doc>();
  const applyWrite = (kind: "set" | "update" | "delete", path: string, data?: Doc) => {
    if (kind === "delete") docs.delete(path);
    else if (kind === "set") docs.set(path, { ...data });
    else if (!docs.has(path)) throw new Error("NOT_FOUND");
    else docs.set(path, { ...docs.get(path), ...data });
  };
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) });
  const ref = (path: string) => ({
    path,
    get: async () => snapshot(path),
    set: async (data: Doc) => applyWrite("set", path, data),
    update: async (data: Doc) => applyWrite("update", path, data),
    delete: async () => applyWrite("delete", path),
  });
  const database = {
    docs,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: { path: string }) => snapshot(r.path),
        set: (r: { path: string }, data: Doc) => void writes.push(() => applyWrite("set", r.path, data)),
        update: (r: { path: string }, data: Doc) => void writes.push(() => applyWrite("update", r.path, data)),
        delete: (r: { path: string }) => void writes.push(() => applyWrite("delete", r.path)),
      };
      const result = await work(tx);
      writes.forEach((write) => write());
      return result;
    },
  };
  return { db: database };
});

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => db,
}));

const ADMIN_UID = "admin-1";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;
const ADMIN_EMAIL = "admin@example.com";
const TEAM = "team-1";
const TREE = "tree-1";
const PROGRESS = `skillProgress/${skillProgressDocId(TEAM, TREE)}`;
const verifyToken = vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
const isSuperadmin = isAdminUid;
const treeReader = { get: async () => ({ exists: true, data: () => tree }) };
const tree = {
  name: "Container adoption",
  nodes: [
    { nodeId: "node-0", label: "Start", order: 0 },
    { nodeId: "node-1", label: "Next", order: 1 },
  ],
  createdAt: new Date("2025-01-01T00:00:00Z"),
  createdBy: "admin-0",
  updatedAt: new Date("2025-01-01T00:00:00Z"),
  updatedBy: "admin-0",
};

function progress(): SkillProgressRecord {
  return { teamId: TEAM, treeId: TREE, currentNodeId: "node-0", updatedAt: new Date("2026-01-01T00:00:00Z"), updatedBy: "admin-0" };
}

function seedProgress(): void {
  db.docs.set(PROGRESS, progress() as unknown as Doc);
}

function raiseErasure(): void {
  db.docs.set(`accountErasures/${ADMIN_UID}`, { status: "in_progress", step: "forum" });
}

const deps = { verifyToken, isSuperadmin, treeReader };

beforeEach(() => {
  db.docs.clear();
});

describe("team skill-progress writers are refused while the admin's erasure record exists", () => {
  it("start refuses with erasure_in_progress and creates no progress record", async () => {
    db.docs.set(`skillTrees/${TREE}`, tree as unknown as Doc);
    db.docs.set(`teams/${TEAM}`, { status: "active" });
    raiseErasure();

    expect(await startTeamSkillTracking("t", TEAM, TREE, { verifyToken, isSuperadmin, treeReader })).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(db.docs.has(PROGRESS)).toBe(false);
  });

  it("stop refuses with erasure_in_progress and keeps the progress record", async () => {
    seedProgress();
    raiseErasure();

    expect(await stopTeamSkillTracking("t", TEAM, TREE, { verifyToken, isSuperadmin: isAdminUid })).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(db.docs.has(PROGRESS)).toBe(true);
  });

  it("update refuses with erasure_in_progress and leaves the stage unchanged", async () => {
    seedProgress();
    raiseErasure();

    expect(await updateTeamSkillProgress("t", TEAM, TREE, "node-1", deps)).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(db.docs.get(PROGRESS)?.currentNodeId).toBe("node-0");
  });

  it("report refuses with erasure_in_progress and leaves the stage unchanged", async () => {
    seedProgress();
    raiseErasure();

    const member = { getMembership: async () => ({ uid: ADMIN_UID, teamId: TEAM }) };
    const teamStatus = { getTeamStatus: async () => "active" };
    expect(await reportTeamSkillProgress("t", TEAM, TREE, "node-1", { verifyToken, membershipReader: member, teamStatusReader: teamStatus, treeReader })).toEqual({
      ok: false,
      error: "erasure_in_progress",
    });
    expect(db.docs.get(PROGRESS)?.currentNodeId).toBe("node-0");
  });

  it("without an erasure record, update still writes the stage (unchanged behaviour)", async () => {
    seedProgress();

    expect(await updateTeamSkillProgress("t", TEAM, TREE, "node-1", deps)).toEqual({ ok: true });
    expect(db.docs.get(PROGRESS)?.currentNodeId).toBe("node-1");
  });
});
