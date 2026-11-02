import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveChallenge } from "./archive-challenge";
import { resolveChallenge } from "./resolve-challenge";

// TASK-034: the admin stamp writes on challenges (archive, resolve) read the admin's erasure fence first, in the same
// transaction, and write nothing when it refuses. Structural test over a recording Admin Firestore double. Fixtures are
// synthetic; the admin uid is fictional.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const ADMIN_UID = "admin-34";
const ADMIN_EMAIL = "admin34@example.com";
const TEAM_ID = "team-34";
const CHALLENGE_ID = "challenge-34";
const CHALLENGE_PATH = `challenges/${CHALLENGE_ID}`;

type Data = Record<string, unknown>;

const docs = new Map<string, Data>();
const updates: string[] = [];

holder.db = {
  collection: (name: string) => ({
    doc: (id: string) => {
      const path = `${name}/${id}`;
      return { path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) };
    },
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: { path: string }) {
        return { exists: docs.has(ref.path), data: () => docs.get(ref.path) };
      },
      update(ref: { path: string }, data: Data) {
        updates.push(ref.path);
        docs.set(ref.path, { ...docs.get(ref.path), ...data });
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
const allowList = [ADMIN_EMAIL];

function seedChallenge(): void {
  docs.set(CHALLENGE_PATH, {
    teamId: TEAM_ID,
    ciphertext: "ciphertext-bytes",
    iv: "iv-bytes",
    authTag: "auth-tag-bytes",
    keyVersion: "v1",
    submittedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

beforeEach(() => {
  docs.clear();
  updates.length = 0;
});

describe("admin challenge stamp writes are refused while the admin's erasure record exists", () => {
  it("archive refuses with erasure_in_progress and stamps nothing", async () => {
    seedChallenge();
    docs.set(`accountErasures/${ADMIN_UID}`, { status: "in_progress", step: "forum" });

    const result = await archiveChallenge("t", TEAM_ID, CHALLENGE_ID, { verifyToken, allowList });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(updates).toEqual([]);
    expect(docs.get(CHALLENGE_PATH)).not.toHaveProperty("archivedBy");
  });

  it("resolve refuses with erasure_in_progress and stamps nothing", async () => {
    seedChallenge();
    docs.set(`accountErasures/${ADMIN_UID}`, { status: "in_progress", step: "forum" });

    const result = await resolveChallenge("t", TEAM_ID, CHALLENGE_ID, { verifyToken, allowList });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(updates).toEqual([]);
    expect(docs.get(CHALLENGE_PATH)).not.toHaveProperty("resolvedBy");
  });

  it("archive without an erasure record stamps the admin uid (unchanged behaviour)", async () => {
    seedChallenge();

    const result = await archiveChallenge("t", TEAM_ID, CHALLENGE_ID, { verifyToken, allowList });

    expect(result).toEqual({ ok: true });
    expect(docs.get(CHALLENGE_PATH)).toMatchObject({ archivedBy: ADMIN_UID });
  });
});
