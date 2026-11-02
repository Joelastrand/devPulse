import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";
import { createParticipantBindingDiscovery, parseOwnedConversationPath } from "./erasure-adapters-conversations";

// TASK-038 / TASK-019: runtime coverage of the collection-group discovery (structural Admin double; the real query needs the
// AE-IDX-1 index, verified by the D-EMU or operator index check, not by this test).

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({ getFirestoreDb: () => holder.db }));
vi.mock("server-only", () => ({}));

const UID = "uid-38c";
const OTHER = "uid-owner";
let db: FakeAdminFirestore;

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

describe("participant binding discovery (collection group)", () => {
  it("finds every owned conversation whose participantUid is the uid, across owners, and no other", async () => {
    db.docs.set(`userDevelopment/${OTHER}/conversations/c1`, { participantUid: UID });
    db.docs.set(`userDevelopment/${OTHER}/conversations/c2`, { participantUid: "someone-else" });
    db.docs.set(`userDevelopment/third-owner/conversations/c3`, { participantUid: UID });

    const bound = await createParticipantBindingDiscovery().listBoundTo(UID, 10);

    expect(bound.sort((a, b) => a.conversationId.localeCompare(b.conversationId))).toEqual([
      { ownerUid: OTHER, conversationId: "c1" },
      { ownerUid: "third-owner", conversationId: "c3" },
    ]);
  });

  it("respects the limit and reads keys only (no field values are returned)", async () => {
    db.docs.set(`userDevelopment/${OTHER}/conversations/a`, { participantUid: UID });
    db.docs.set(`userDevelopment/${OTHER}/conversations/b`, { participantUid: UID });

    const bound = await createParticipantBindingDiscovery().listBoundTo(UID, 1);

    expect(bound).toHaveLength(1);
    expect(Object.keys(bound[0] as object).sort()).toEqual(["conversationId", "ownerUid"]);
  });

  it("fails closed on a document path that is not an owned conversation", () => {
    expect(() => parseOwnedConversationPath("conversations/x")).toThrow("unexpected conversation document path");
    expect(() => parseOwnedConversationPath("userDevelopment/u/goals/g")).toThrow("unexpected conversation document path");
  });

  it("refuses a path-breaking uid before any read", async () => {
    await expect(createParticipantBindingDiscovery().listBoundTo("a/b", 1)).rejects.toThrow("invalid uid segment");
    expect(db.reads).toEqual([]);
  });
});
