import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";
import { ERASURE_STEPS } from "../domain/erasure-state";
import { createAdminAuthDeletionPort } from "./auth-deletion-adapter";
import { buildProductionStepHandlers } from "./production-erasure-handlers";
import { getDefaultConversationStore } from "../../development-conversations/server/conversation-store";

// TASK-038: composition, Auth adapter and production conversation-list runtime coverage. Structural Admin double; no
// Firebase access. The Auth adapter is exercised against a fake `getAdminAuth` result.

const holder = vi.hoisted(() => ({ db: undefined as unknown, auth: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
  getAdminAuth: () => holder.auth,
}));
vi.mock("server-only", () => ({}));

const UID = "uid-comp";
const OTHER = "uid-comp-other";
let db: FakeAdminFirestore;

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

describe("production handler composition", () => {
  it("registers a handler for every step the runner runs, and leaves Auth to the post-handoff step", () => {
    const handlers = buildProductionStepHandlers({ uid: UID, normalizedEmail: "x@example.com" }, () => new Date());
    const runnerSteps = ERASURE_STEPS.filter((step) => step !== "auth_delete" && step !== "final_sweep");
    expect(runnerSteps.filter((step) => handlers[step] === undefined)).toEqual([]);
    expect(handlers.auth_delete).toBeUndefined();
    expect(handlers.final_sweep).toBeUndefined();
  });
});

describe("Auth deletion adapter", () => {
  it("maps a successful delete to deleted", async () => {
    holder.auth = { deleteUser: vi.fn(async () => undefined) };
    await expect(createAdminAuthDeletionPort().deleteUser(UID)).resolves.toBe("deleted");
  });

  it("maps auth/user-not-found to not_found (retry-safe success)", async () => {
    holder.auth = { deleteUser: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { code: "auth/user-not-found" }))) };
    await expect(createAdminAuthDeletionPort().deleteUser(UID)).resolves.toBe("not_found");
  });

  it("maps every other failure to unavailable and returns no raw SDK text", async () => {
    holder.auth = {
      deleteUser: vi.fn(async () => Promise.reject(Object.assign(new Error("token=secret-value"), { code: "app/internal" }))),
    };
    const result = await createAdminAuthDeletionPort().deleteUser(UID);
    expect(result).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});

describe("production conversation erasure lists (runtime)", () => {
  it("lists owned conversation ids by keys only, for the owner, and never another owner's", async () => {
    db.docs.set(`userDevelopment/${UID}/conversations/c1`, { createdAt: new Date() });
    db.docs.set(`userDevelopment/${UID}/conversations/c2`, { malformed: true });
    db.docs.set(`userDevelopment/${OTHER}/conversations/c9`, {});
    const store = getDefaultConversationStore();

    const ids = await store.listOwnerIdsForErasure(UID, 10);

    expect(ids.sort()).toEqual(["c1", "c2"]);
  });

  it("lists participation index ids of the caller only", async () => {
    db.docs.set(`userDevelopment/${UID}/conversationParticipations/p1`, { ownerUid: OTHER });
    db.docs.set(`userDevelopment/${OTHER}/conversationParticipations/p2`, { ownerUid: UID });
    const store = getDefaultConversationStore();

    expect(await store.listParticipationIdsForErasure(UID, 10)).toEqual(["p1"]);
  });
});
