import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitChallenge } from "./submit-challenge";

// TASK-033: the default anonymous challenge writer creates its document inside a transaction that reads the submitter's
// erasure fence first. Structural test over a recording Admin Firestore double; fixtures are synthetic.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const TEAM_ID = "team-33";
const MEMBER_UID = "member-33";
const VALID_TEXT = "Handoffs between squads are unclear to newcomers.";

const docs = new Map<string, Record<string, unknown>>();
const creates: string[] = [];
let nextId = 0;

holder.db = {
  collection: (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? `auto-${(nextId += 1)}`;
      return { id: docId, path: `${name}/${docId}` };
    },
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: { path: string }) {
        return { exists: docs.has(ref.path), data: () => docs.get(ref.path) };
      },
      create(ref: { path: string }, data: Record<string, unknown>) {
        creates.push(ref.path);
        docs.set(ref.path, data);
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: MEMBER_UID, email: "member@example.com", email_verified: true });
const membershipReader = { getMembership: async () => ({ uid: MEMBER_UID, teamId: TEAM_ID }) };
const teamStatusReader = { getTeamStatus: async () => "active" };

beforeEach(() => {
  docs.clear();
  creates.length = 0;
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("default anonymous challenge writer", () => {
  it("refuses with erasure_in_progress and creates no challenge while the submitter's erasure record exists", async () => {
    docs.set(`accountErasures/${MEMBER_UID}`, { status: "in_progress", step: "forum" });

    const result = await submitChallenge(
      "t",
      TEAM_ID,
      VALID_TEXT,
      { verifyToken, membershipReader, teamStatusReader },
    );

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(creates).toEqual([]);
  });

  it("creates exactly one challenge when no erasure record exists", async () => {
    const result = await submitChallenge("t", TEAM_ID, VALID_TEXT, { verifyToken, membershipReader, teamStatusReader });

    expect(result).toEqual({ ok: true });
    expect(creates).toHaveLength(1);
    expect(creates[0].startsWith("challenges/")).toBe(true);
  });
});
