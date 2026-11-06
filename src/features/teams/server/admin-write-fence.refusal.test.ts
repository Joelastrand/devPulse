import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveAccessRequest } from "./approve-access-request";
import { createInvitation } from "./create-invitation";
import { grantTeamMembership } from "./grant-team-membership";
import { rejectAccessRequest } from "./reject-access-request";
import { seedLegacyTeams } from "./seed-legacy-teams";
import { setTeamMemberRole } from "./set-team-member-role";

// TASK-035: direct refusal coverage for the team-management admin writes that stamp the acting admin's uid. Each protected
// mutation reads the fence inside its own transaction and writes nothing when the fence refuses. Structural test over a
// recording Admin Firestore double. Fixtures are synthetic; the admin and target uids are fictional.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const ADMIN_UID = "admin-35";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;
const ADMIN_EMAIL = "admin35@example.com";
const TARGET_UID = "member-35";
const TEAM_ID = "team-35";
const ADMIN_FENCE = `accountErasures/${ADMIN_UID}`;

type Data = Record<string, unknown>;

const docs = new Map<string, Data>();
const writes: string[] = [];

function pathOf(ref: string | { path: string }): string {
  return typeof ref === "string" ? ref : ref.path;
}

holder.db = {
  collection: (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? `generated-${name}`;
      const path = `${name}/${docId}`;
      return { id: docId, path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) };
    },
    where: () => ({ get: async () => ({ docs: [] }), limit: () => ({ get: async () => ({ docs: [] }) }) }),
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: string | { path: string }) {
        const path = pathOf(ref);
        return { exists: docs.has(path), data: () => docs.get(path) };
      },
      create(ref: string | { path: string }, data: Data) {
        writes.push(`create|${pathOf(ref)}`);
        docs.set(pathOf(ref), data);
      },
      set(ref: string | { path: string }, data: Data) {
        writes.push(`set|${pathOf(ref)}`);
        docs.set(pathOf(ref), data);
      },
      update(ref: string | { path: string }, data: Data) {
        writes.push(`update|${pathOf(ref)}`);
        docs.set(pathOf(ref), { ...docs.get(pathOf(ref)), ...data });
      },
      delete(ref: string | { path: string }) {
        writes.push(`delete|${pathOf(ref)}`);
        docs.delete(pathOf(ref));
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
const isSuperadmin = isAdminUid;

function seedAdminFence(): void {
  docs.set(ADMIN_FENCE, { status: "in_progress", step: "forum" });
}

beforeEach(() => {
  docs.clear();
  writes.length = 0;
});

describe("team admin writes are refused while the acting admin's erasure record exists", () => {
  it("setting a member role refuses with erasure_in_progress and writes nothing", async () => {
    seedAdminFence();

    const result = await setTeamMemberRole("t", TEAM_ID, TARGET_UID, "teamadmin", { verifyToken, isSuperadmin: isAdminUid });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("rejecting an access request refuses with erasure_in_progress and writes nothing", async () => {
    seedAdminFence();
    docs.set(`teamAccessRequests/${TARGET_UID}__${TEAM_ID}`, { uid: TARGET_UID, teamId: TEAM_ID, status: "pending" });

    const result = await rejectAccessRequest("t", TARGET_UID, TEAM_ID, { verifyToken, isSuperadmin: isAdminUid });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
    expect(docs.get(`teamAccessRequests/${TARGET_UID}__${TEAM_ID}`)).toMatchObject({ status: "pending" });
  });

  it("approving an access request refuses with erasure_in_progress and creates no membership", async () => {
    seedAdminFence();
    docs.set(`teamAccessRequests/${TARGET_UID}__${TEAM_ID}`, { uid: TARGET_UID, teamId: TEAM_ID, status: "pending" });

    const result = await approveAccessRequest("t", TARGET_UID, TEAM_ID, { verifyToken, isSuperadmin: isAdminUid });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("the admin's immediate grant refuses with erasure_in_progress, even though the target uid has no record", async () => {
    seedAdminFence();

    // The grant operation surfaces the refusal as a thrown ErasureWriteRefused; its caller maps it (create-invitation.ts).
    await expect(
      grantTeamMembership({
        uid: TARGET_UID,
        teamId: TEAM_ID,
        createdAt: new Date("2026-10-29T00:00:00Z"),
        createdVia: "invitation",
        grantedBy: ADMIN_UID,
      }),
    ).rejects.toMatchObject({ code: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("creating a pending invitation refuses with erasure_in_progress and stores no invitation", async () => {
    seedAdminFence();

    const result = await createInvitation("t", TEAM_ID, "invitee@example.com", {
      verifyToken,
      isSuperadmin,
      teamsCollection: { getStatus: async () => "active" },
      membershipsCollection: { get: async () => undefined },
      findAccount: async () => null,
    });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("seeding legacy teams creates no team document while the admin's erasure record exists", async () => {
    seedAdminFence();

    const result = await seedLegacyTeams("t", { verifyToken, isSuperadmin: isAdminUid });

    // Each seed create is refused: no team is created, and every outcome reports the public `erasure_in_progress` code.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected seed outcomes");
    expect(result.outcomes.every((outcome) => outcome.result === "erasure_in_progress")).toBe(true);
    expect(result.outcomes.length).toBeGreaterThan(0);
    expect(writes).toEqual([]);
  });
});
