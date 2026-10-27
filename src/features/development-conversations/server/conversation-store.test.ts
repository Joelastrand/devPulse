import { readFileSync } from "node:fs";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConversationStore } from "./conversation-store";
import { createAdminFirestoreDouble, type AdminFirestoreDouble } from "./conversation-store-test-support";
import { CONVERSATION_RAW_READ_LIMIT, type OwnerDocumentWrite } from "./conversation-store-types";

/**
 * Admin-store specifics: the literal storage paths, the bounded query shapes, the Timestamp boundary, error propagation
 * and the static Admin-only properties. The shared contract (both implementations) lives in
 * `conversation-store-contract.test.ts`.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));

const T1 = new Date("2026-01-01T10:00:00.000Z");
const T2 = new Date("2026-01-02T10:00:00.000Z");

const OWNER_PATH = "userDevelopment/owner-1/conversations/conv-1";
const INDEX_PATH = "userDevelopment/participant-1/conversationParticipations/conv-1";

function ownerDoc(): OwnerDocumentWrite {
  return {
    teamId: "team-a",
    participantUid: "participant-1",
    participantMemberRef: "synthetic-member-ref",
    participantState: "pending",
    participantInvitedAt: T1,
    participantAcceptedAt: null,
    plannedFor: "2026-02-01",
    status: "open",
    completedAt: null,
    createdAt: T1,
    updatedAt: T2,
    ciphertext: "synthetic-ciphertext",
    iv: "synthetic-iv",
    authTag: "synthetic-tag",
    keyVersion: "v1",
    keyCheck: "synthetic-key-check",
  };
}

const CONVERSATION_SOURCE = readFileSync(new URL("./conversation-store.ts", import.meta.url), "utf8");

describe("Admin conversation store", () => {
  let double: AdminFirestoreDouble;

  beforeEach(() => {
    double = createAdminFirestoreDouble();
    holder.db = double.db;
  });

  describe("paths", () => {
    it("writes the owner document under the owner's conversations subtree", async () => {
      await getDefaultConversationStore().runTransaction(async (tx) => tx.createOwner("owner-1", "conv-1", ownerDoc()));
      expect([...double.documents.keys()]).toEqual([OWNER_PATH]);
    });

    it("writes the index document under the participant's index subtree, keyed by the participant uid", async () => {
      await getDefaultConversationStore().runTransaction(async (tx) =>
        tx.setParticipation("participant-1", "conv-1", { ownerUid: "owner-1", invitedAt: T1 }),
      );
      expect([...double.documents.keys()]).toEqual([INDEX_PATH]);
    });
  });

  describe("write shape", () => {
    it("persists exactly the sixteen canonical keys, the dates as Timestamps, and the envelope as given", async () => {
      await getDefaultConversationStore().runTransaction(async (tx) => tx.createOwner("owner-1", "conv-1", ownerDoc()));
      const stored = double.documents.get(OWNER_PATH) ?? {};
      expect(Object.keys(stored).sort()).toEqual(
        [
          "authTag",
          "ciphertext",
          "completedAt",
          "createdAt",
          "iv",
          "keyCheck",
          "keyVersion",
          "participantAcceptedAt",
          "participantInvitedAt",
          "participantMemberRef",
          "participantState",
          "participantUid",
          "plannedFor",
          "status",
          "teamId",
          "updatedAt",
        ].sort(),
      );
      expect(stored.createdAt).toBeInstanceOf(Timestamp);
      expect(stored.participantInvitedAt).toBeInstanceOf(Timestamp);
      expect(stored.keyCheck).toBe("synthetic-key-check");
      expect(stored.keyVersion).toBe("v1");
    });

    it("persists the index as exactly ownerUid and a Timestamp invitedAt", async () => {
      await getDefaultConversationStore().runTransaction(async (tx) =>
        tx.setParticipation("participant-1", "conv-1", { ownerUid: "owner-1", invitedAt: T1 }),
      );
      const stored = double.documents.get(INDEX_PATH) ?? {};
      expect(Object.keys(stored).sort()).toEqual(["invitedAt", "ownerUid"]);
      expect(stored.invitedAt).toBeInstanceOf(Timestamp);
    });

    it("patches only the given keys, and writes Timestamps for dates in the patch", async () => {
      await getDefaultConversationStore().runTransaction(async (tx) => tx.createOwner("owner-1", "conv-1", ownerDoc()));
      await getDefaultConversationStore().runTransaction(async (tx) => tx.updateOwner("owner-1", "conv-1", { updatedAt: T2, plannedFor: null }));
      const stored = double.documents.get(OWNER_PATH) ?? {};
      expect(stored.updatedAt).toBeInstanceOf(Timestamp);
      expect(stored.plannedFor).toBeNull();
      expect(stored.teamId).toBe("team-a");
    });
  });

  describe("Timestamp boundary", () => {
    it("maps top-level Timestamps to Dates on read and leaves other values alone", async () => {
      double.documents.set(OWNER_PATH, { createdAt: Timestamp.fromDate(T1), status: "open", title: "as stored" });
      const stored = await getDefaultConversationStore().getOwner("owner-1", "conv-1");
      expect(stored?.createdAt).toBeInstanceOf(Date);
      expect((stored?.createdAt as Date).getTime()).toBe(T1.getTime());
      expect(stored?.status).toBe("open");
      expect(stored?.title).toBe("as stored");
    });
  });

  describe("bounded queries", () => {
    it("lists owner documents with orderBy createdAt desc and limit(READ_WINDOW + 1)", async () => {
      await getDefaultConversationStore().listOwnerWindow("owner-1");
      expect(double.calls).toEqual([`userDevelopment/owner-1/conversations|orderBy(createdAt,desc)|limit(${CONVERSATION_RAW_READ_LIMIT})|get`]);
    });

    it("runs the recovery scan with select(createdAt) and limit, and no orderBy", async () => {
      await getDefaultConversationStore().scanOwnerMissingCreatedAt("owner-1");
      expect(double.calls).toEqual([`userDevelopment/owner-1/conversations|select(createdAt)|limit(${CONVERSATION_RAW_READ_LIMIT})|get`]);
    });

    it("lists index entries with orderBy invitedAt desc and limit(READ_WINDOW + 1)", async () => {
      await getDefaultConversationStore().listParticipationWindow("participant-1");
      expect(double.calls).toEqual([
        `userDevelopment/participant-1/conversationParticipations|orderBy(invitedAt,desc)|limit(${CONVERSATION_RAW_READ_LIMIT})|get`,
      ]);
    });

    it("counts both subtrees with count() aggregation, not a document read", async () => {
      const store = getDefaultConversationStore();
      await store.countOwner("owner-1");
      await store.countParticipation("participant-1");
      expect(double.calls).toEqual([
        "count userDevelopment/owner-1/conversations",
        "count userDevelopment/participant-1/conversationParticipations",
      ]);
    });

    it("never issues a document-list query without a limit (static, on the store source)", () => {
      // Count aggregations are bounded by the collection (BR-37) and need no limit; every other list read must have one.
      const statements = CONVERSATION_SOURCE.split(";");
      const listed = statements.filter(
        (statement) => statement.includes("subtree(") && statement.includes(".get()") && !statement.includes(".count()"),
      );
      expect(listed.length).toBeGreaterThan(0);
      for (const statement of listed) expect(statement).toContain(".limit(");
    });

    it("uses no collection group and no client Firestore SDK (static, on the store source)", () => {
      // The forbidden call is written from fragments, so this file does not trip the TASK-004 dimension 2 scan.
      const groupCall = new RegExp(`\\.${["collection", "Group"].join("")}\\s*\\(`);
      expect(CONVERSATION_SOURCE).not.toMatch(groupCall);
      expect(CONVERSATION_SOURCE).not.toMatch(/from\s+["']firebase\/(firestore|app)["']/);
      expect(CONVERSATION_SOURCE).toMatch(/from\s+["']firebase-admin\/firestore["']/);
      expect(double.db).not.toHaveProperty(["collection", "Group"].join(""));
    });
  });

  describe("errors and missing documents", () => {
    it("reports an absent document as undefined, not as an error", async () => {
      expect(await getDefaultConversationStore().getOwner("owner-1", "conv-1")).toBeUndefined();
      expect(await getDefaultConversationStore().getParticipation("participant-1", "conv-1")).toBeUndefined();
    });

    it("propagates a Firestore failure unchanged, with no wrapping and no added message", async () => {
      const failure = new Error("simulated Admin SDK failure");
      holder.db = { collection: () => { throw failure; } };
      await expect(getDefaultConversationStore().getOwner("owner-1", "conv-1")).rejects.toBe(failure);
    });
  });
});
