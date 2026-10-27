import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isConversationId } from "../domain/conversation-id";
import { createFakeConversationStore } from "./fake-conversation-store";
import { InvalidConversationStoreKeyError, type OwnerDocumentWrite } from "./conversation-store-types";

/**
 * Fake-specific behaviour: injected ids, test-only raw seeding, instance isolation, copies, and the Firebase-free property.
 * Parity with the Admin store is proven by the shared contract test (`conversation-store-contract.test.ts`).
 */

const T1 = new Date("2026-01-01T10:00:00.000Z");
const FAKE_SOURCE = readFileSync(new URL("./fake-conversation-store.ts", import.meta.url), "utf8");

function ownerDoc(): OwnerDocumentWrite {
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
  };
}

describe("fake conversation store", () => {
  it("allocates ids from the injected generator, and refuses one that breaks the id rule", () => {
    const store = createFakeConversationStore({ generateId: () => "injected-1" });
    expect(store.newOwnerId("owner-1")).toBe("injected-1");

    const bad = createFakeConversationStore({ generateId: () => "bad__id" });
    expect(() => bad.newOwnerId("owner-1")).toThrow(InvalidConversationStoreKeyError);
  });

  it("allocates valid ids by default, and the defaults are distinct", () => {
    const store = createFakeConversationStore();
    const ids = [store.newOwnerId("owner-1"), store.newOwnerId("owner-1")];
    expect(ids.every(isConversationId)).toBe(true);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("returns raw seeded documents unchanged, so later tests can exercise malformed reads", async () => {
    const store = createFakeConversationStore();
    store.seedRawOwner("owner-1", "malformed", { status: "not-a-status", createdAt: T1, extra: 1 });
    expect(await store.getOwner("owner-1", "malformed")).toEqual({ status: "not-a-status", createdAt: T1, extra: 1 });
  });

  it("does not repair or drop a malformed seeded document from a window or a count", async () => {
    const store = createFakeConversationStore();
    store.seedRawOwner("owner-1", "malformed", { status: "not-a-status", createdAt: T1 });
    const window = await store.listOwnerWindow("owner-1");
    expect(window.docs.map((doc) => doc.id)).toEqual(["malformed"]);
    expect(await store.countOwner("owner-1")).toBe(1);
  });

  it("keeps separate instances separate", async () => {
    const first = createFakeConversationStore();
    const second = createFakeConversationStore();
    await first.runTransaction(async (tx) => tx.createOwner("owner-1", "conv-1", ownerDoc()));
    expect(await second.getOwner("owner-1", "conv-1")).toBeUndefined();
  });

  it("does not let a failed transaction leave a partial draft behind", async () => {
    const store = createFakeConversationStore();
    await store.runTransaction(async (tx) => tx.createOwner("owner-1", "conv-1", ownerDoc())).catch(() => undefined);
    await expect(
      store.runTransaction(async (tx) => {
        tx.deleteOwner("owner-1", "conv-1");
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await store.getOwner("owner-1", "conv-1")).toBeDefined();
  });

  it("is Firebase-free: it imports no Firebase module and no Admin initialisation module", () => {
    expect(FAKE_SOURCE).not.toMatch(/from\s+["'](firebase|firebase-admin|firebase-admin\/firestore)(\/[^"']*)?["']/);
    expect(FAKE_SOURCE).not.toMatch(/src\/lib\/firebase\//);
  });
});

describe("fake conversation store: deterministic commit conflicts (TASK-022, BR-48)", () => {
  it("discards a conflicted attempt's buffered writes and re-runs work from fresh reads", async () => {
    const store = createFakeConversationStore();
    const seen: Array<unknown> = [];
    store.scheduleCommitConflicts(1);

    await store.runTransaction(async (tx) => {
      seen.push(await tx.getOwner("owner-1", "conv-1"));
      tx.createOwner("owner-1", "conv-1", ownerDoc());
    });

    // The discarded attempt's create is not visible to the second attempt, so the second create is the only one that commits.
    expect(seen).toEqual([undefined, undefined]);
    expect(await store.getOwner("owner-1", "conv-1")).toBeDefined();
  });

  it("awaits an asynchronous beforeRetry, and the next attempt observes the change it made", async () => {
    const store = createFakeConversationStore();
    const seen: Array<unknown> = [];
    store.scheduleCommitConflicts(1, async () => {
      await Promise.resolve();
      store.seedRawOwner("owner-1", "conv-1", { status: "completed" });
    });

    await store.runTransaction(async (tx) => {
      seen.push(await tx.getOwner("owner-1", "conv-1"));
    });

    expect(seen).toEqual([undefined, { status: "completed" }]);
  });

  it("runs beforeRetry once per discarded attempt, with that attempt's number, and no more than the scheduled count", async () => {
    const store = createFakeConversationStore();
    const hookCalls: number[] = [];
    let attempts = 0;
    store.scheduleCommitConflicts(2, (discardedAttempt) => {
      hookCalls.push(discardedAttempt);
    });

    await store.runTransaction(async () => {
      attempts += 1;
    });
    await store.runTransaction(async () => {
      attempts += 1;
    });

    expect(hookCalls).toEqual([1, 2]);
    expect(attempts).toBe(4);
  });

  it("spends a conflict before its hook runs, so a transaction started by the hook commits without a second conflict", async () => {
    const store = createFakeConversationStore();
    let outerAttempts = 0;
    store.scheduleCommitConflicts(1, async () => {
      await store.runTransaction(async (tx) => tx.createOwner("owner-1", "conv-1", ownerDoc()));
    });

    await store.runTransaction(async () => {
      outerAttempts += 1;
    });

    expect(outerAttempts).toBe(2);
    expect(await store.getOwner("owner-1", "conv-1")).toBeDefined();
  });
});
