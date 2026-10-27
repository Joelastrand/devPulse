import { describe, expect, it } from "vitest";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import { OWNER_DOCUMENT_KEYS, type ConversationStore, type RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { OTHER_OWNER_UID, NOW, OWNER_UID, PARTICIPANT_UID, seedOwnerConversation } from "./owner-read-test-support";
import { updateOwnerSections, type UpdateOwnerSectionsDeps } from "./update-owner-sections";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";

/** Synthetic fixtures only (invariant 15). No real person, team or wellbeing data. */
const CONVERSATION_ID = "conv-1";
const LATER = new Date(NOW.getTime() + 60_000);
const CAPTURED_AT = new Date("2026-10-01T08:00:00.000Z");
const SNAPSHOT_GOAL: SharedGoalSnapshot = {
  goalTitle: "Synthetic goal",
  treeId: "tree-a",
  targetDate: "2026-12-31",
  status: "active",
  capturedAt: CAPTURED_AT,
};

function setup(): { store: FakeConversationStore; codec: FakeContentCodec; deps: UpdateOwnerSectionsDeps; setNow: (date: Date) => void } {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  let now = new Date(NOW.getTime());
  const deps: UpdateOwnerSectionsDeps = { store, codec, clock: () => new Date(now.getTime()) };
  return { store, codec, deps, setNow: (date) => (now = date) };
}

async function rawOwner(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** The decrypted content of the stored owner document, read the way a decrypting reader reads it. */
async function storedContent(store: ConversationStore, codec: FakeContentCodec) {
  const raw = await rawOwner(store);
  const envelope = {
    ciphertext: raw.ciphertext,
    iv: raw.iv,
    authTag: raw.authTag,
    keyVersion: raw.keyVersion,
    keyCheck: raw.keyCheck,
  } as StoredEnvelope;
  const decoded = codec.decodeContent(envelope);
  if (!decoded.ok) throw new Error("fixture content unreadable");
  return decoded.content;
}

describe("updateOwnerSections: allowed owner keys (BR-19, BR-49)", () => {
  it("updates the title", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, title: "Old title" });

    const result = await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Plan the Q4 rota" }, deps);

    expect(result).toEqual({ ok: true });
    expect((await storedContent(store, codec)).title).toBe("Plan the Q4 rota");
  });

  it("updates plannedFor in the plain field and clears it with null", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, plannedFor: null });

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { plannedFor: "2026-11-03" }, deps)).toEqual({ ok: true });
    expect((await rawOwner(store)).plannedFor).toBe("2026-11-03");

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { plannedFor: null }, deps)).toEqual({ ok: true });
    expect((await rawOwner(store)).plannedFor).toBeNull();
  });

  it("updates owner notes and clears them with an empty string", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, ownerNotes: "Before" });

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "After\nsecond line" }, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).ownerNotes).toBe("After\nsecond line");

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "" }, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).ownerNotes).toBe("");
  });

  it("replaces the next steps whole, and clears them with an empty list", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { nextSteps: ["Book room", "Send agenda"] }, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).nextSteps).toEqual(["Book room", "Send agenda"]);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { nextSteps: ["Only this"] }, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).nextSteps).toEqual(["Only this"]);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { nextSteps: [] }, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).nextSteps).toEqual([]);
  });

  it("leaves every key that is absent from the patch unchanged (BR-19)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      title: "Keep me",
      plannedFor: "2026-12-01",
      ownerNotes: "Keep notes",
      participantNotes: "Participant text",
    });

    await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { nextSteps: ["One"] }, deps);

    const content = await storedContent(store, codec);
    expect(content.title).toBe("Keep me");
    expect(content.ownerNotes).toBe("Keep notes");
    expect((await rawOwner(store)).plannedFor).toBe("2026-12-01");
  });

  it("writes updatedAt from the injected clock and leaves createdAt unchanged", async () => {
    const { store, codec, deps, setNow } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    setNow(LATER);

    await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Renamed" }, deps);

    const after = await rawOwner(store);
    expect(after.updatedAt).toEqual(LATER);
    expect(after.createdAt).toEqual(before.createdAt);
  });
});

describe("updateOwnerSections: input rules (BR-39, BR-19)", () => {
  it("rejects a keyless or non-object patch as invalid_input", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, {}, deps)).toEqual({ ok: false, error: "invalid_input", field: "patch" });
    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, "title", deps)).toEqual({ ok: false, error: "invalid_input", field: "patch" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it.each([
    ["sharedGoalIds", { sharedGoalIds: ["goal-1"] }],
    ["participantMemberRef", { participantMemberRef: null }],
    ["status", { status: "completed" }],
  ])("rejects %s, which another task owns, as invalid_input with the field name", async (field, patch) => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, patch, deps)).toEqual({ ok: false, error: "invalid_input", field });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects an unknown key as invalid_input with a fixed placeholder, never the key text", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    const result = await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { uid: OTHER_OWNER_UID, title: "Valid" }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "unknown" });
    expect(JSON.stringify(result)).not.toContain(OTHER_OWNER_UID);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects an empty title (TASK-001) and names the field only", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "   " }, deps)).toEqual({ ok: false, error: "invalid_input", field: "title" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects an over-long title and an over-long note by field, with no write (BR-40)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    // 101 code points is over the title cap (TASK-001); the notes cap is 4096 UTF-8 bytes.
    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "a".repeat(101) }, deps)).toEqual({ ok: false, error: "invalid_input", field: "title" });
    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "a".repeat(4097) }, deps)).toEqual({ ok: false, error: "invalid_input", field: "ownerNotes" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects an invalid plannedFor and an over-long next-step list, naming the field", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { plannedFor: "2026-02-30" }, deps)).toEqual({ ok: false, error: "invalid_input", field: "plannedFor" });
    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { nextSteps: Array.from({ length: 11 }, (_, i) => `Step ${i}`) }, deps)).toEqual({
      ok: false,
      error: "invalid_input",
      field: "nextSteps",
    });
  });
});

describe("updateOwnerSections: completed conversations (BR-28)", () => {
  it.each([
    ["title", { title: "New" }],
    ["plannedFor", { plannedFor: "2026-11-03" }],
    ["ownerNotes", { ownerNotes: "New" }],
    ["nextSteps", { nextSteps: ["New"] }],
  ])("refuses %s with conversation_completed and writes nothing", async (_key, patch) => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed" });
    const before = await rawOwner(store);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, patch, deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("updateOwnerSections: unreadable or absent documents (BR-33, BR-53, IMPL-1)", () => {
  it("writes nothing when the payload is unauthenticated, and reports conversation_not_found", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const record = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });
    const before = await rawOwner(store);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Lost write" }, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("writes nothing when the document is malformed, and reports conversation_not_found", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const record = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, title: "extra plaintext key" });
    const before = await rawOwner(store);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "x" }, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("writes nothing and reports persistence_failed on a key outage, never conversation_not_found", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Blocked" }, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("writes nothing and reports persistence_failed on a configured-key mismatch", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    codec.setKeyFailure("key_mismatch");

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Blocked" }, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("reports conversation_not_found for an absent document and for another owner's id", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { ownerUid: OTHER_OWNER_UID, conversationId: CONVERSATION_ID });

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Nope" }, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await updateOwnerSections(OWNER_UID, "absent-id", { title: "Nope" }, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("reports persistence_failed when the transaction fails, with no path or content in the result", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const failing: ConversationStore = {
      ...store,
      runTransaction() {
        return Promise.reject(new Error("simulated failure with a document path"));
      },
    };

    const result = await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Blocked" }, { ...deps, store: failing });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("simulated");
  });
});

describe("updateOwnerSections: field replacement and storage (BR-49, D2-SI-7)", () => {
  it("keeps the last of two sequential writes, with no history", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "First" }, deps);
    await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "Second" }, deps);

    expect((await storedContent(store, codec)).ownerNotes).toBe("Second");
  });

  it("never touches participantNotes or sharedGoals, and keeps them as previously stored", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participantNotes: "Synthetic participant text",
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });

    await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Renamed", ownerNotes: "Owner text" }, deps);

    const content = await storedContent(store, codec);
    expect(content.participantNotes).toBe("Synthetic participant text");
    expect(content.sharedGoals).toEqual([]);
  });

  it("stores no plaintext title or note in the document", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const secret = "Synthetic plaintext marker";

    await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: secret, ownerNotes: secret, nextSteps: [secret] }, deps);

    expect(JSON.stringify(await rawOwner(store))).not.toContain(secret);
  });
});

/** Stored fields that are envelope or write metadata rather than plain conversation fields. */
const ENVELOPE_AND_WRITE_KEYS = ["ciphertext", "iv", "authTag", "keyCheck", "updatedAt"];

function plainFieldsOf(raw: RawConversationData): RawConversationData {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !ENVELOPE_AND_WRITE_KEYS.includes(key)));
}

describe("updateOwnerSections: one-field updates preserve every other field (BR-19, BR-49, IMPL-1)", () => {
  it.each([
    ["title", { title: "Changed title" }, { title: "Changed title" }, {}],
    ["ownerNotes", { ownerNotes: "Changed notes" }, { ownerNotes: "Changed notes" }, {}],
    ["nextSteps", { nextSteps: ["Changed step"] }, { nextSteps: ["Changed step"] }, {}],
    ["plannedFor", { plannedFor: "2027-01-15" }, {}, { plannedFor: "2027-01-15" }],
  ])(
    "a %s-only update keeps every other content field, plain field and the binding",
    async (_label, input, contentChange, plainChange) => {
      const { store, codec, deps, setNow } = setup();
      await seedOwnerConversation(store, codec, {
        conversationId: CONVERSATION_ID,
        title: "Original title",
        ownerNotes: "Original notes",
        nextSteps: ["Original step"],
        plannedFor: "2026-11-03",
        participantNotes: "Synthetic participant text",
        sharedGoals: [SNAPSHOT_GOAL],
        participant: { uid: PARTICIPANT_UID, state: "accepted" },
      });
      const beforeRaw = await rawOwner(store);
      const beforeContent = await storedContent(store, codec);
      setNow(LATER);

      expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, input, deps)).toEqual({ ok: true });

      const afterRaw = await rawOwner(store);
      expect(await storedContent(store, codec)).toEqual({ ...beforeContent, ...contentChange });
      expect(plainFieldsOf(afterRaw)).toEqual({ ...plainFieldsOf(beforeRaw), ...plainChange });
      expect(afterRaw.updatedAt).toEqual(LATER);
      expect(Object.keys(afterRaw).sort()).toEqual([...OWNER_DOCUMENT_KEYS].sort());
      expect(Object.values(afterRaw).every((value) => value !== undefined)).toBe(true);
    },
  );
});

describe("updateOwnerSections: validation runs before any read, codec call or transaction", () => {
  function countingDeps(deps: UpdateOwnerSectionsDeps) {
    const calls: string[] = [];
    const store: ConversationStore = {
      ...deps.store,
      getOwner: (ownerUid, conversationId) => {
        calls.push("getOwner");
        return deps.store.getOwner(ownerUid, conversationId);
      },
      runTransaction: (work) => {
        calls.push("runTransaction");
        return deps.store.runTransaction(work);
      },
    };
    const codec = {
      ...deps.codec,
      probeKey: () => {
        calls.push("probeKey");
        return deps.codec.probeKey();
      },
      encodeContent: (content: Parameters<FakeContentCodec["encodeContent"]>[0]) => {
        calls.push("encodeContent");
        return deps.codec.encodeContent(content);
      },
      decryptForClassification: (envelope: StoredEnvelope) => {
        calls.push("decryptForClassification");
        return deps.codec.decryptForClassification(envelope);
      },
    };
    return { calls, deps: { ...deps, store, codec } };
  }

  it.each([
    ["an empty patch", {}],
    ["a non-object patch", "title"],
    ["an empty title", { title: "   " }],
    ["an over-long note", { ownerNotes: "a".repeat(4097) }],
    ["an invalid plannedFor", { plannedFor: "2026-02-30" }],
    ["a known forbidden key", { status: "completed" }],
    ["an unknown key", { uid: OTHER_OWNER_UID }],
  ])("%s touches no store read, codec call or transaction", async (_label, input) => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const counted = countingDeps(deps);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, input, counted.deps)).toMatchObject({ ok: false, error: "invalid_input" });
    expect(counted.calls).toEqual([]);
  });

  it("refuses a malformed conversation id before any read, codec call or transaction", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const counted = countingDeps(deps);

    for (const malformedId of ["bad/id", "a".repeat(129)]) {
      expect(await updateOwnerSections(OWNER_UID, malformedId, { title: "Valid" }, counted.deps)).toEqual({
        ok: false,
        error: "conversation_not_found",
      });
    }
    expect(counted.calls).toEqual([]);
  });

  it("performs its only conversation read and its only write inside one transaction", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const counted = countingDeps(deps);

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Valid" }, counted.deps)).toEqual({ ok: true });
    expect(counted.calls.filter((call) => call === "getOwner")).toEqual([]);
    expect(counted.calls.filter((call) => call === "runTransaction")).toHaveLength(1);
  });
});

describe("updateOwnerSections: transactional read on retry (BR-49, no stale-payload overwrite)", () => {
  it("re-reads the committed payload when the transaction is re-run, so a retry cannot undo a concurrent write", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, ownerNotes: "Before" });
    const retrying: ConversationStore = {
      ...store,
      async runTransaction(work) {
        // The first attempt reads the old payload, then conflicts. A concurrent owner-notes write commits before the retry.
        await store.runTransaction(async (tx) => {
          await work(tx);
          throw new Error("transaction conflict");
        }).catch(() => undefined);
        const concurrent = codec.encodeContent({
          title: "Synthetic conversation",
          ownerNotes: "Concurrent note",
          nextSteps: [],
          participantNotes: "",
          sharedGoals: [],
        });
        if (!concurrent.ok) throw new Error("fixture key unavailable");
        await store.runTransaction(async (tx) => {
          tx.updateOwner(OWNER_UID, CONVERSATION_ID, { ...concurrent.content, updatedAt: LATER });
        });
        return store.runTransaction(work);
      },
    };

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Retried title" }, { ...deps, store: retrying })).toEqual({
      ok: true,
    });

    const content = await storedContent(store, codec);
    expect(content.title).toBe("Retried title");
    expect(content.ownerNotes).toBe("Concurrent note");
  });
});
