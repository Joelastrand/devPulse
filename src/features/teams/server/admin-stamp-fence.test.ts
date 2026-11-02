import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSkillTree } from "../../skill-trees/server/create-skill-tree";
import { createTeam } from "./create-team";

// TASK-035: admin writes that stamp the admin's uid on skill trees and teams read the admin's erasure fence first, in the
// same transaction, and write nothing when it refuses. Structural test over a recording Admin Firestore double; fixtures are
// synthetic and the admin uid is fictional.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const ADMIN_UID = "admin-35";
const ADMIN_EMAIL = "admin35@example.com";
const FENCE = `accountErasures/${ADMIN_UID}`;

const docs = new Map<string, Record<string, unknown>>();
const writes: string[] = [];

holder.db = {
  collection: (name: string) => ({
    doc: (id?: string) => ({ id: id ?? `generated-${name}`, path: `${name}/${id ?? `generated-${name}`}` }),
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: { path: string }) {
        return { exists: docs.has(ref.path), data: () => docs.get(ref.path) };
      },
      create(ref: { path: string }) {
        writes.push(`create|${ref.path}`);
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
const allowList = [ADMIN_EMAIL];

beforeEach(() => {
  docs.clear();
  writes.length = 0;
});

describe("admin creates are refused while the admin's erasure record exists", () => {
  it("creating a skill tree refuses with erasure_in_progress and writes nothing", async () => {
    docs.set(FENCE, { status: "in_progress", step: "forum" });

    const result = await createSkillTree("t", "Container adoption", ["Start", "Next"], { verifyToken, allowList });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("creating a team refuses with erasure_in_progress and writes nothing", async () => {
    docs.set(FENCE, { status: "in_progress", step: "forum" });

    const result = await createTeam("t", "Platform", { verifyToken, allowList });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("creating a team without an erasure record writes once (unchanged behaviour)", async () => {
    const result = await createTeam("t", "Platform", { verifyToken, allowList });

    expect(result.ok).toBe(true);
    expect(writes).toEqual(["create|teams/generated-teams"]);
  });
});
