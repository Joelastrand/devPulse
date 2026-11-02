import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeConversationStore, type FakeConversationStore } from "../../development-conversations/server/fake-conversation-store";
import type { ConversationStore } from "../../development-conversations/server/conversation-store-types";
import { ErasureStepFailure } from "./erasure-runner";
import { runLocatorsBatch, runOwnedConversationsBatch, type ConversationsStepDeps } from "./conversations-erasure";

// TASK-018: owned conversations and participant-index locators. Fixtures are synthetic. The erased person is UID.

const UID = "erased-uid";
const OTHER = "other-uid";

const rawOwner = (participantUid: string | null, overrides: Record<string, unknown> = {}) => ({
  teamId: "team-1",
  participantUid,
  participantMemberRef: null,
  participantState: participantUid === null ? null : "accepted",
  participantInvitedAt: null,
  participantAcceptedAt: null,
  plannedFor: null,
  status: "active",
  completedAt: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  ciphertext: "owner-ciphertext",
  iv: "iv",
  authTag: "tag",
  keyVersion: "v1",
  keyCheck: "check",
  ...overrides,
});

async function runOwnedToDone(deps: ConversationsStepDeps, uid: string): Promise<void> {
  for (let batch = 0; batch < 50; batch += 1) {
    if ((await runOwnedConversationsBatch(deps, uid, 100)) === "done") return;
  }
  throw new Error("owned step did not reach done");
}

async function runLocatorsToDone(deps: ConversationsStepDeps, uid: string): Promise<void> {
  for (let batch = 0; batch < 50; batch += 1) {
    if ((await runLocatorsBatch(deps, uid, 100)) === "done") return;
  }
  throw new Error("locators step did not reach done");
}

function seeded(): FakeConversationStore {
  return createFakeConversationStore({ generateId: () => "unused" });
}

describe("conversations_owned step (TASK-018)", () => {
  it("deletes an owned conversation and the participant's index entry in the same step", async () => {
    const store = seeded();
    store.seedRawOwner(UID, "conv-owned-1", rawOwner(OTHER));
    store.seedRawParticipation(OTHER, "conv-owned-1", { ownerUid: UID, invitedAt: new Date("2026-08-02T00:00:00Z") });

    await runOwnedToDone({ store }, UID);

    expect(await store.getOwner(UID, "conv-owned-1")).toBeUndefined();
    expect(await store.getParticipation(OTHER, "conv-owned-1")).toBeUndefined();
  });

  it("deletes a malformed owned conversation, using plain fields only (BR-29)", async () => {
    const store = seeded();
    store.seedRawOwner(UID, "conv-malformed", { ciphertext: 42, junk: true });

    await runOwnedToDone({ store }, UID);

    expect(await store.getOwner(UID, "conv-malformed")).toBeUndefined();
  });

  it("leaves another owner's conversation and its index entries untouched", async () => {
    const store = seeded();
    store.seedRawOwner(UID, "conv-erased", rawOwner(null));
    store.seedRawOwner(OTHER, "conv-other", rawOwner(UID));
    store.seedRawParticipation(UID, "conv-other", { ownerUid: OTHER, invitedAt: new Date("2026-08-02T00:00:00Z") });

    await runOwnedToDone({ store }, UID);

    expect(await store.getOwner(OTHER, "conv-other")).toBeDefined();
    expect(await store.getParticipation(UID, "conv-other")).toBeDefined();
  });

  it("removes a completed owned conversation as well (owner deletion is not gated by status)", async () => {
    const store = seeded();
    store.seedRawOwner(UID, "conv-completed", rawOwner(null, { status: "completed", completedAt: new Date("2026-08-05T00:00:00Z") }));

    await runOwnedToDone({ store }, UID);

    expect(await store.getOwner(UID, "conv-completed")).toBeUndefined();
  });

  it("reports done when no owned conversation remains", async () => {
    const store = seeded();
    expect(await runOwnedConversationsBatch({ store }, UID, 100)).toBe("done");
  });

  it("fails closed on a listed id that is not a valid conversation id, so the step cannot loop", async () => {
    const store = seeded();
    const port: ConversationStore = { ...store, listOwnerIdsForErasure: async () => ["not a valid id!"] };

    await expect(runOwnedConversationsBatch({ store: port }, UID, 100)).rejects.toMatchObject({
      code: "verification_failed",
    });
  });

  it("reports store_unavailable and keeps the conversation when the delete transaction fails", async () => {
    const store = seeded();
    store.seedRawOwner(UID, "conv-keep", rawOwner(null));
    const failing: ConversationStore = {
      ...store,
      runErasureCleanupTransaction: async () => {
        throw new Error("firestore unavailable");
      },
    };

    await expect(runOwnedConversationsBatch({ store: failing }, UID, 100)).rejects.toBeInstanceOf(ErasureStepFailure);
    expect(await store.getOwner(UID, "conv-keep")).toBeDefined();
  });

  it("refuses a zero write budget as a programming error, not as a batch result", async () => {
    await expect(runOwnedConversationsBatch({ store: seeded() }, UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });
});

describe("locators step (TASK-018)", () => {
  it("removes the erased person's own participant index entries, including an orphaned entry whose owner is gone", async () => {
    const store = seeded();
    store.seedRawParticipation(UID, "conv-live", { ownerUid: OTHER, invitedAt: new Date("2026-08-02T00:00:00Z") });
    store.seedRawParticipation(UID, "conv-orphan", { ownerUid: OTHER, invitedAt: new Date("2026-08-03T00:00:00Z") });

    await runLocatorsToDone({ store }, UID);

    expect(await store.getParticipation(UID, "conv-live")).toBeUndefined();
    expect(await store.getParticipation(UID, "conv-orphan")).toBeUndefined();
  });

  it("does not touch another person's index entries", async () => {
    const store = seeded();
    store.seedRawParticipation(OTHER, "conv-x", { ownerUid: UID, invitedAt: new Date("2026-08-02T00:00:00Z") });

    await runLocatorsToDone({ store }, UID);

    expect(await store.getParticipation(OTHER, "conv-x")).toBeDefined();
  });

  it("reports done when no index entry remains", async () => {
    expect(await runLocatorsBatch({ store: seeded() }, UID, 100)).toBe("done");
  });

  it("fails closed on a listed id that is not a valid conversation id", async () => {
    const store = seeded();
    const port: ConversationStore = { ...store, listParticipationIdsForErasure: async () => ["bad id!"] };

    await expect(runLocatorsBatch({ store: port }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
  });
});
