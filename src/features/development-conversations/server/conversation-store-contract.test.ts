import { beforeEach, describe, expect, it, vi } from "vitest";
import { isConversationId } from "../domain/conversation-id";
import { getDefaultConversationStore } from "./conversation-store";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createAdminFirestoreDouble, type AdminFirestoreDouble } from "./conversation-store-test-support";
import {
  CONVERSATION_RAW_READ_LIMIT,
  InvalidConversationStoreKeyError,
  ownerDocumentPath,
  participationDocumentPath,
  type ConversationStore,
  type OwnerDocumentWrite,
} from "./conversation-store-types";

/**
 * Shared contract (TASK-005 acceptance: "fake and production share the contract test"). Every case runs against the Admin
 * store, driven through the recording double, and against the in-memory fake. All values are synthetic.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));

const T1 = new Date("2026-01-01T10:00:00.000Z");
const T2 = new Date("2026-01-02T10:00:00.000Z");
const T3 = new Date("2026-01-03T10:00:00.000Z");
const OWNER = "owner-1";
const CALLER = "participant-1";

/** Synthetic owner document. The envelope values are placeholders: the store never decrypts or checks them. */
function ownerDoc(overrides: Partial<OwnerDocumentWrite> = {}): OwnerDocumentWrite {
  return {
    teamId: "team-a",
    participantUid: null,
    participantMemberRef: null,
    participantState: null,
    participantInvitedAt: null,
    participantAcceptedAt: null,
    plannedFor: null,
    status: "open",
    completedAt: null,
    createdAt: T1,
    updatedAt: T1,
    ciphertext: "synthetic-ciphertext",
    iv: "synthetic-iv",
    authTag: "synthetic-tag",
    keyVersion: "v1",
    keyCheck: "synthetic-key-check",
    ...overrides,
  };
}

const CANONICAL_OWNER_KEYS = [
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
];

interface Harness {
  store: ConversationStore;
  /** Writes a raw owner document as given, outside the canonical write shape (for malformed-data cases). */
  seedRawOwner(ownerUid: string, conversationId: string, data: Record<string, unknown>): void;
  /** Writes a raw index document as given. */
  seedRawParticipation(callerUid: string, conversationId: string, data: Record<string, unknown>): void;
}

interface Implementation {
  name: string;
  create(): Harness;
}

function adminHarness(double: AdminFirestoreDouble): Harness {
  holder.db = double.db;
  return {
    store: getDefaultConversationStore(),
    seedRawOwner: (ownerUid, conversationId, data) => double.documents.set(ownerDocumentPath(ownerUid, conversationId).join("/"), { ...data }),
    seedRawParticipation: (callerUid, conversationId, data) =>
      double.documents.set(participationDocumentPath(callerUid, conversationId).join("/"), { ...data }),
  };
}

function fakeHarness(fake: FakeConversationStore): Harness {
  return {
    store: fake,
    seedRawOwner: (ownerUid, conversationId, data) => fake.seedRawOwner(ownerUid, conversationId, data),
    seedRawParticipation: (callerUid, conversationId, data) => fake.seedRawParticipation(callerUid, conversationId, data),
  };
}

const implementations: Implementation[] = [
  {
    name: "Admin store on the recording double",
    create: () => adminHarness(createAdminFirestoreDouble()),
  },
  {
    name: "in-memory fake",
    create: () => fakeHarness(createFakeConversationStore()),
  },
];

describe.each(implementations)("conversation store contract — $name", ({ create }) => {
  let harness: Harness;
  let store: ConversationStore;

  beforeEach(() => {
    harness = create();
    store = harness.store;
  });

  describe("owner documents", () => {
    it("writes the sixteen canonical keys and reads them back as Dates, with no extra key", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc()));
      const stored = await store.getOwner(OWNER, "conv-1");
      expect(Object.keys(stored ?? {}).sort()).toEqual(CANONICAL_OWNER_KEYS);
      expect(stored?.createdAt).toEqual(T1);
      expect(stored?.keyCheck).toBe("synthetic-key-check");
    });

    it("returns undefined for an absent document", async () => {
      expect(await store.getOwner(OWNER, "missing")).toBeUndefined();
    });

    it("never persists a field the write shape does not declare", async () => {
      const withExtra = { ...ownerDoc(), title: "must not persist", ownerUid: OWNER } as OwnerDocumentWrite;
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", withExtra));
      const stored = (await store.getOwner(OWNER, "conv-1")) ?? {};
      expect(stored).not.toHaveProperty("title");
      expect(stored).not.toHaveProperty("ownerUid");
      expect(Object.keys(stored).sort()).toEqual(CANONICAL_OWNER_KEYS);
    });

    it("refuses to write a canonical key that is undefined, rather than storing it as absent", async () => {
      const broken = { ...ownerDoc(), keyCheck: undefined } as unknown as OwnerDocumentWrite;
      await expect(store.runTransaction(async (tx) => tx.setOwner(OWNER, "conv-1", broken))).rejects.toThrow();
      expect(await store.getOwner(OWNER, "conv-1")).toBeUndefined();
    });

    it("createOwner fails when the document already exists, and never overwrites it", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc({ status: "open" })));
      await expect(store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc({ status: "completed" })))).rejects.toThrow();
      expect((await store.getOwner(OWNER, "conv-1"))?.status).toBe("open");
    });

    it("setOwner replaces the whole document and leaves other documents untouched", async () => {
      await store.runTransaction(async (tx) => {
        tx.createOwner(OWNER, "conv-1", ownerDoc());
        tx.createOwner(OWNER, "conv-2", ownerDoc({ teamId: "team-b" }));
      });
      await store.runTransaction(async (tx) => tx.setOwner(OWNER, "conv-1", ownerDoc({ status: "completed", completedAt: T2 })));
      expect((await store.getOwner(OWNER, "conv-1"))?.status).toBe("completed");
      expect((await store.getOwner(OWNER, "conv-2"))?.teamId).toBe("team-b");
    });

    it("updateOwner changes only the given keys, clears with null, and never creates a document", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc({ plannedFor: "2026-02-01" })));
      await store.runTransaction(async (tx) => tx.updateOwner(OWNER, "conv-1", { plannedFor: null, updatedAt: T2 }));
      const stored = await store.getOwner(OWNER, "conv-1");
      expect(stored?.plannedFor).toBeNull();
      expect(stored?.updatedAt).toEqual(T2);
      expect(stored?.teamId).toBe("team-a");
      await expect(store.runTransaction(async (tx) => tx.updateOwner(OWNER, "absent", { status: "completed" }))).rejects.toThrow();
      expect(await store.getOwner(OWNER, "absent")).toBeUndefined();
    });

    it("refuses an update that sets no canonical key, as the Admin SDK does", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc()));
      await expect(store.runTransaction(async (tx) => tx.updateOwner(OWNER, "conv-1", {}))).rejects.toThrow();
      await expect(store.runTransaction(async (tx) => tx.updateOwner(OWNER, "conv-1", { status: undefined }))).rejects.toThrow();
      expect((await store.getOwner(OWNER, "conv-1"))?.status).toBe("open");
    });

    it("copies a Date in an update, so the caller's later change does not reach the stored document", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc()));
      const updatedAt = new Date(T2);
      await store.runTransaction(async (tx) => tx.updateOwner(OWNER, "conv-1", { updatedAt }));
      updatedAt.setFullYear(1999);
      expect((await store.getOwner(OWNER, "conv-1"))?.updatedAt).toEqual(T2);
    });

    it("deleteOwner removes the document, and deleting an absent document is not an error", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc()));
      await store.runTransaction(async (tx) => {
        tx.deleteOwner(OWNER, "conv-1");
        tx.deleteOwner(OWNER, "never-existed");
      });
      expect(await store.getOwner(OWNER, "conv-1")).toBeUndefined();
    });

    it("returns copies: changing a returned value does not change the stored document", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc()));
      const first = await store.getOwner(OWNER, "conv-1");
      if (first?.createdAt instanceof Date) first.createdAt.setFullYear(1999);
      if (first) first.status = "completed";
      const second = await store.getOwner(OWNER, "conv-1");
      expect(second?.status).toBe("open");
      expect(second?.createdAt).toEqual(T1);
    });
  });

  describe("bounded owner reads", () => {
    it("lists the window newest first and leaves out documents without createdAt", async () => {
      await store.runTransaction(async (tx) => {
        tx.createOwner(OWNER, "old", ownerDoc({ createdAt: T1 }));
        tx.createOwner(OWNER, "new", ownerDoc({ createdAt: T3 }));
        tx.createOwner(OWNER, "mid", ownerDoc({ createdAt: T2 }));
      });
      harness.seedRawOwner(OWNER, "no-created-at", { status: "open" });
      const window = await store.listOwnerWindow(OWNER);
      expect(window.docs.map((doc) => doc.id)).toEqual(["new", "mid", "old"]);
      expect(window.rawCount).toBe(3);
    });

    it("returns at most 100 documents and a rawCount of 101 when the set is larger", async () => {
      for (let i = 0; i < 102; i += 1) {
        harness.seedRawOwner(OWNER, `c${String(i).padStart(3, "0")}`, { createdAt: new Date(T1.getTime() + i * 1000) });
      }
      const window = await store.listOwnerWindow(OWNER);
      expect(window.rawCount).toBe(CONVERSATION_RAW_READ_LIMIT);
      expect(window.docs).toHaveLength(100);
      expect(window.docs[0]?.id).toBe("c101");
      expect(window.docs.at(-1)?.id).toBe("c002");
    });

    it("finds documents whose createdAt is absent, and reads only ids and that presence", async () => {
      harness.seedRawOwner(OWNER, "broken-a", { status: "open" });
      harness.seedRawOwner(OWNER, "fine", { createdAt: T1 });
      harness.seedRawOwner(OWNER, "broken-b", { ciphertext: "x" });
      const scan = await store.scanOwnerMissingCreatedAt(OWNER);
      expect(scan.missingCreatedAtIds.sort()).toEqual(["broken-a", "broken-b"]);
      expect(scan.rawCount).toBe(3);
    });

    it("counts every owner document, including malformed and missing-createdAt documents", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "good", ownerDoc()));
      harness.seedRawOwner(OWNER, "no-created-at", { status: "open" });
      harness.seedRawOwner("someone-else", "other", { createdAt: T1 });
      expect(await store.countOwner(OWNER)).toBe(2);
    });
  });

  describe("participant index", () => {
    it("writes exactly the two index keys and reads them back", async () => {
      await store.runTransaction(async (tx) => tx.setParticipation(CALLER, "conv-1", { ownerUid: OWNER, invitedAt: T1 }));
      expect(await store.getParticipation(CALLER, "conv-1")).toEqual({ ownerUid: OWNER, invitedAt: T1 });
    });

    it("never persists a field outside the index shape", async () => {
      const withExtra = { ownerUid: OWNER, invitedAt: T1, title: "must not persist", plannedFor: "2026-02-01" } as unknown as {
        ownerUid: string;
        invitedAt: Date;
      };
      await store.runTransaction(async (tx) => tx.setParticipation(CALLER, "conv-1", withExtra));
      expect(Object.keys((await store.getParticipation(CALLER, "conv-1")) ?? {}).sort()).toEqual(["invitedAt", "ownerUid"]);
    });

    it("returns undefined for an absent index entry", async () => {
      expect(await store.getParticipation(CALLER, "absent")).toBeUndefined();
    });

    it("lists the window by invitedAt newest first, and leaves out entries without invitedAt", async () => {
      await store.runTransaction(async (tx) => {
        tx.setParticipation(CALLER, "early", { ownerUid: OWNER, invitedAt: T1 });
        tx.setParticipation(CALLER, "late", { ownerUid: OWNER, invitedAt: T3 });
      });
      harness.seedRawParticipation(CALLER, "no-invite", { ownerUid: OWNER });
      const window = await store.listParticipationWindow(CALLER);
      expect(window.docs.map((doc) => doc.id)).toEqual(["late", "early"]);
      expect(window.rawCount).toBe(2);
      expect(await store.countParticipation(CALLER)).toBe(3);
    });

    it("keeps the index subtree of one caller apart from the owner subtree", async () => {
      await store.runTransaction(async (tx) => {
        tx.createOwner(CALLER, "conv-1", ownerDoc());
        tx.setParticipation(OWNER, "conv-2", { ownerUid: CALLER, invitedAt: T1 });
      });
      expect(await store.countParticipation(CALLER)).toBe(0);
      expect((await store.listOwnerWindow(OWNER)).rawCount).toBe(0);
      expect((await store.listParticipationWindow(CALLER)).rawCount).toBe(0);
    });
  });

  describe("transactions across both subtrees", () => {
    it("commits the owner and index writes together", async () => {
      await store.runTransaction(async (tx) => {
        tx.createOwner(OWNER, "conv-1", ownerDoc());
        tx.setParticipation(CALLER, "conv-1", { ownerUid: OWNER, invitedAt: T1 });
      });
      expect(await store.getOwner(OWNER, "conv-1")).toBeDefined();
      expect(await store.getParticipation(CALLER, "conv-1")).toBeDefined();
    });

    it("commits neither write when the second write fails", async () => {
      await expect(
        store.runTransaction(async (tx) => {
          tx.createOwner(OWNER, "conv-1", ownerDoc());
          await Promise.resolve();
          throw new Error("injected failure on the second write");
        }),
      ).rejects.toThrow("injected failure");
      expect(await store.getOwner(OWNER, "conv-1")).toBeUndefined();
    });

    it("rejects a read after a write, and commits nothing", async () => {
      await expect(
        store.runTransaction(async (tx) => {
          tx.createOwner(OWNER, "conv-1", ownerDoc());
          await tx.getOwner(OWNER, "conv-1");
        }),
      ).rejects.toThrow();
      expect(await store.getOwner(OWNER, "conv-1")).toBeUndefined();
    });

    it("reads inside the transaction see the committed state", async () => {
      await store.runTransaction(async (tx) => tx.createOwner(OWNER, "conv-1", ownerDoc()));
      const seen = await store.runTransaction(async (tx) => (await tx.getOwner(OWNER, "conv-1"))?.teamId);
      expect(seen).toBe("team-a");
    });
  });

  describe("identifiers and segments", () => {
    it("allocates a conversation id that satisfies the domain id rule", () => {
      for (let i = 0; i < 5; i += 1) {
        expect(isConversationId(store.newOwnerId(OWNER))).toBe(true);
      }
    });

    it("refuses a uid or an id that would change the path shape", async () => {
      await expect(store.listOwnerWindow("a/b")).rejects.toBeInstanceOf(InvalidConversationStoreKeyError);
      await expect(store.getOwner(OWNER, "a__b")).rejects.toBeInstanceOf(InvalidConversationStoreKeyError);
      await expect(store.getParticipation("..", "conv-1")).rejects.toBeInstanceOf(InvalidConversationStoreKeyError);
    });
  });
});
