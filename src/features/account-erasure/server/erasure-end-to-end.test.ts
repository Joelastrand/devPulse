import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";
import { getProductionStartErasureDeps } from "./production-erasure";
import { startOrResumeErasure } from "./start-erasure";

// TASK-038: end-to-end runs of the real start/resume operation through the composed production handler graph, over the Admin
// Firestore recording double (structural) and a fake Auth port. The production readiness flag stays false: these tests set
// `ready: true` on their own dependency object only, to exercise the composed chain. They do not claim D-EMU behaviour.

const holder = vi.hoisted(() => ({ db: undefined as unknown, auth: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
  getAdminAuth: () => holder.auth,
}));
vi.mock("server-only", () => ({}));

const UID = "uid-e2e";
const OTHER = "uid-other-e2e";
const EMAIL = "Erased.Person@Example.com";
const NORMALIZED = "erased.person@example.com";
const TEAM = "t-e2e";
const NOW = new Date("2026-11-02T10:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const CREATED = new Date("2026-10-01T00:00:00Z");

let db: FakeAdminFirestore;
let deleteUser: ReturnType<typeof vi.fn>;

function threadRecord(authorUid: string, extra: Record<string, unknown> = {}) {
  return { teamId: TEAM, authorUid, ciphertext: "c-ct", iv: "c-iv", authTag: "c-tag", keyVersion: "v1", createdAt: CREATED, ...extra };
}
function replyRecord(threadId: string, authorUid: string) {
  return { teamId: TEAM, threadId, authorUid, ciphertext: "r-ct", iv: "r-iv", authTag: "r-tag", keyVersion: "v1", createdAt: CREATED };
}

function seedPerson(): void {
  db.docs.set(`skillProfiles/${UID}`, { levels: {} });
  db.docs.set(`userProfiles/${UID}`, { displayName: "Synthetic Person" });
  db.docs.set(`userDevelopment/${UID}/goals/g1`, { title: "goal" });
  db.docs.set(`userDevelopment/${UID}/roleTarget/current`, { roleId: "r" });
  db.docs.set(`surveyParticipations/${UID}__s1`, { uid: UID, surveyId: "s1" });
  db.docs.set(`surveys/sv1`, { createdBy: UID, title: "kept" });
  db.docs.set(`teamMemberships/${UID}__${TEAM}`, { uid: UID, teamId: TEAM, memberRef: "ref-e2e", role: "teamadmin" });
  db.docs.set(`roadmapItems/${TEAM}__tree`, { teamId: TEAM, ownerRef: "ref-e2e", targetNodeId: "n" });
  db.docs.set(`teamInvitations/${TEAM}__${NORMALIZED}`, { email: NORMALIZED, status: "pending", invitedBy: OTHER });
  db.docs.set(`forumThreads/th-own`, threadRecord(UID));
  db.docs.set(`forumThreads/th-shared`, threadRecord(UID));
  db.docs.set(`forumReplies/rp-other`, replyRecord("th-shared", OTHER));
}

/** Other people's data that the erasure must not touch. */
function seedOthers(): void {
  db.docs.set(`skillProfiles/${OTHER}`, { levels: {} });
  db.docs.set(`teamMemberships/${OTHER}__${TEAM}`, { uid: OTHER, teamId: TEAM, memberRef: "ref-other" });
  db.docs.set(`teamInvitations/${TEAM}__keep@example.com`, { email: "keep@example.com", status: "pending" });
}

function deps(options: { authResult?: "deleted" | "unavailable" } = {}) {
  const base = getProductionStartErasureDeps({
    verifyToken: vi.fn().mockResolvedValue({
      uid: UID,
      email: EMAIL,
      email_verified: true,
      auth_time: NOW_SECONDS - 60,
    }),
    readFence: async (uid: string) => {
      const record = db.docs.get(`accountErasures/${uid}`) as { status?: string } | undefined;
      if (record === undefined) return { kind: "none" as const };
      if (record.status === "in_progress") return { kind: "in_progress" as const };
      return { kind: "terminal" as const };
    },
  });
  deleteUser = vi.fn(async () => {
    if (options.authResult === "unavailable") throw Object.assign(new Error("transient"), { code: "app/network" });
    return undefined;
  });
  holder.auth = { deleteUser };
  return { ...base, ready: true, now: () => NOW, nowSeconds: () => NOW_SECONDS };
}

const START_BODY = { confirmation: EMAIL };

/**
 * Calls the operation as the client does: each request runs at most one budget and answers `in_progress` until a terminal
 * answer. The loop is bounded, so a stuck erasure fails the test instead of hanging it.
 */
async function drive(d: ReturnType<typeof deps>, maxCalls = 50) {
  let result = await startOrResumeErasure("token", START_BODY, d);
  for (let i = 1; i < maxCalls; i += 1) {
    if (!result.ok || result.state.status !== "in_progress") return result;
    result = await startOrResumeErasure("token", START_BODY, d);
  }
  throw new Error("erasure did not reach a terminal answer within the call bound");
}

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

describe("production erasure chain, end to end", () => {
  it("runs to completed: every person-owned item is removed, other people's items are kept, Auth is deleted once", async () => {
    seedPerson();
    seedOthers();

    const result = await drive(deps());

    expect(result).toEqual({ ok: true, state: { status: "completed" } });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(UID);
    expect(db.docs.has(`skillProfiles/${UID}`)).toBe(false);
    expect(db.docs.has(`userProfiles/${UID}`)).toBe(false);
    expect(db.docs.has(`userDevelopment/${UID}/goals/g1`)).toBe(false);
    expect(db.docs.has(`userDevelopment/${UID}/roleTarget/current`)).toBe(false);
    expect(db.docs.has(`surveyParticipations/${UID}__s1`)).toBe(false);
    expect(db.docs.get("surveys/sv1")).toMatchObject({ createdBy: null, title: "kept" });
    expect(db.docs.has(`teamMemberships/${UID}__${TEAM}`)).toBe(false);
    expect(db.docs.get(`roadmapItems/${TEAM}__tree`)).toMatchObject({ ownerRef: null });
    expect(db.docs.has(`teamInvitations/${TEAM}__${NORMALIZED}`)).toBe(false);
    expect(db.docs.has(`forumThreads/th-own`)).toBe(false);
    expect(db.docs.get("forumThreads/th-shared")).toMatchObject({ teamId: TEAM, status: "erased" });
    expect(db.docs.get("forumReplies/rp-other")).toMatchObject({ authorUid: OTHER });
    expect(db.docs.get("accountErasures/" + UID)).toMatchObject({ status: "completed", step: "final_sweep" });
    expect(db.docs.has(`skillProfiles/${OTHER}`)).toBe(true);
    expect(db.docs.has(`teamMemberships/${OTHER}__${TEAM}`)).toBe(true);
    expect(db.docs.has(`teamInvitations/${TEAM}__keep@example.com`)).toBe(true);
  });

  it("a completed erasure is never restarted or re-run: the centralized fence refuses the terminal record before the operation", async () => {
    seedPerson();
    await drive(deps());
    deleteUser.mockClear();

    // SPEC "Start/resume contract" and TASK-013: a completed record is refused by the fence as invalid_token (401), so the
    // operation does not run and Auth is not touched again.
    const again = await startOrResumeErasure("token", START_BODY, deps());

    expect(again).toEqual({ ok: false, error: "unauthenticated" });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(db.docs.get("accountErasures/" + UID)).toMatchObject({ status: "completed" });
  });

  it("a transient Auth failure stays resumable: auth_unavailable is stored, the step does not advance, and a retry completes", async () => {
    seedPerson();

    const failing = deps({ authResult: "unavailable" });
    const first = await drive(failing);

    expect(first).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(db.docs.get("accountErasures/" + UID)).toMatchObject({
      status: "in_progress",
      step: "auth_delete",
      errorCode: "auth_unavailable",
    });

    const retry = await drive(deps({ authResult: "deleted" }));

    expect(retry).toEqual({ ok: true, state: { status: "completed" } });
  });

  it("an unreadable forum payload stops the erasure at forum, stores payload_unreadable, and never reports completion", async () => {
    seedPerson();
    db.docs.set("forumThreads/th-bad", { teamId: TEAM, authorUid: UID });

    const result = await drive(deps());

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(db.docs.get("accountErasures/" + UID)).toMatchObject({
      status: "in_progress",
      step: "forum",
      errorCode: "payload_unreadable",
    });
  });

  it("returns no identifier or content on any response branch", async () => {
    seedPerson();
    const bodies = [
      await startOrResumeErasure("token", START_BODY, deps({ authResult: "unavailable" })),
      await startOrResumeErasure("token", START_BODY, deps()),
    ];
    for (const body of bodies) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(UID);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(NORMALIZED);
      expect(text).not.toContain(TEAM);
    }
  });

  it("refuses to run any step when the verified e-mail normalizes to empty (fail closed, no record, no step)", async () => {
    seedPerson();
    const blankEmail = {
      ...deps(),
      verifyToken: vi.fn().mockResolvedValue({ uid: UID, email: "   ", email_verified: true, auth_time: NOW_SECONDS - 60 }),
    };

    const result = await startOrResumeErasure("token", { confirmation: "   " }, blankEmail);

    expect(result).toEqual({ ok: false, error: "erasure_unavailable" });
    expect(db.docs.has("accountErasures/" + UID)).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(db.docs.has(`forumThreads/th-own`)).toBe(true);
    expect(db.docs.has("accountErasures/" + UID)).toBe(false);
  });
});
