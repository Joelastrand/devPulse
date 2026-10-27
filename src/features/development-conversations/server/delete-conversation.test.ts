import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConversationStore, ConversationTransaction, RawConversationData } from "./conversation-store-types";
import { deleteConversation, type DeleteConversationDeps } from "./delete-conversation";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";

const OWNER_UID = "owner-1";
const PARTICIPANT_UID = "participant-1";
const CONVERSATION_ID = "conv-1";

/** A raw owner document. Only `participantUid` and `status` matter to delete; the rest is opaque, as stored. */
function ownerData(overrides: Record<string, unknown> = {}): RawConversationData {
  return {
    teamId: "team-alpha",
    participantUid: null,
    status: "open",
    ciphertext: "opaque",
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    ...overrides,
  };
}

function setup(): { store: FakeConversationStore; deps: DeleteConversationDeps } {
  const store = createFakeConversationStore();
  return { store, deps: { store } };
}

describe("deleteConversation (BR-5, BR-29)", () => {
  it("removes an open owner document", async () => {
    const { store, deps } = setup();
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, ownerData());

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({ ok: true });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("removes a completed owner document", async () => {
    const { store, deps } = setup();
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, ownerData({ status: "completed", completedAt: new Date() }));

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({ ok: true });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("removes the participant index in the same transaction as the owner document", async () => {
    const { store, deps } = setup();
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, ownerData({ participantUid: PARTICIPANT_UID }));
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date() });

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({ ok: true });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("leaves both documents when the index delete fails inside the transaction", async () => {
    const base = createFakeConversationStore();
    base.seedRawOwner(OWNER_UID, CONVERSATION_ID, ownerData({ participantUid: PARTICIPANT_UID }));
    base.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date() });
    const failingIndexDelete: ConversationStore = {
      ...base,
      runTransaction(work) {
        return base.runTransaction((tx) =>
          work({
            ...tx,
            deleteParticipation() {
              throw new Error("simulated index delete failure with a document path");
            },
          } as ConversationTransaction),
        );
      },
    };

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, { store: failingIndexDelete });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await base.getOwner(OWNER_UID, CONVERSATION_ID)).toBeDefined();
    expect(await base.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("removes the index of a malformed owner document with a readable participantUid", async () => {
    const { store, deps } = setup();
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { status: "unknown", participantUid: PARTICIPANT_UID });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date() });

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({ ok: true });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it.each([
    ["a number", 42],
    ["a reserved __uid__ form", "__reserved__"],
    ["a path-like value", "a/b"],
    ["an empty string", ""],
  ])("removes the owner document alone when participantUid is %s, leaving the index", async (_label, value) => {
    const { store, deps } = setup();
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, ownerData({ participantUid: value }));
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date() });

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({ ok: true });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("returns conversation_not_found for a missing owner document and writes nothing", async () => {
    const { store, deps } = setup();

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await store.countOwner(OWNER_UID)).toBe(0);
  });

  it("returns conversation_not_found for a malformed conversation id, without a read", async () => {
    const { deps } = setup();

    const result = await deleteConversation(OWNER_UID, "bad/id", deps);

    expect(result).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("maps a read failure to persistence_failed without a message", async () => {
    const base = createFakeConversationStore();
    const failingRead: ConversationStore = {
      ...base,
      runTransaction() {
        return Promise.reject(new Error("simulated read failure with a document path"));
      },
    };

    const result = await deleteConversation(OWNER_UID, CONVERSATION_ID, { store: failingRead });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("document path");
  });

  it("never invokes the content codec: the operation does not import it", () => {
    const source = readFileSync(resolve(__dirname, "delete-conversation.ts"), "utf8");

    expect(source).not.toContain("content-codec");
    expect(source).not.toContain("decryptForClassification");
  });
});
