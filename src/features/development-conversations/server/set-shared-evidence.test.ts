import { describe, expect, it } from "vitest";
import type { ConversationContent } from "../domain/content-payload";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { SharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";
import type { EvidenceSourceFields, EvidenceSourceKind } from "../../personal-role-workspace/server/owned-evidence-source";
import type { RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { OTHER_OWNER_UID, NOW, OWNER_UID, seedOwnerConversation } from "./owner-read-test-support";
import type { OwnedEvidenceReader } from "./owned-evidence-seam";
import { setSharedEvidence, type SetSharedEvidenceDeps } from "./set-shared-evidence";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";
import { conversationContext } from "../domain/stored-owner-conversation";

/** Synthetic fixtures only (invariant 15). No real person, team or wellbeing data. */
const CONVERSATION_ID = "conv-1";
const CTX = conversationContext(OWNER_UID, CONVERSATION_ID);
/** The owner read version of the fixture (its `updatedAt` is `NOW`). */
const FRESH = NOW.toISOString();
const CAPTURED_AT = new Date("2026-10-01T08:00:00.000Z");

const RESPONSIBILITY_IDS = ["resp-1", "resp-2", "resp-3", "resp-4", "resp-5", "resp-6"];
const ACHIEVEMENT_IDS = ["ach-1", "ach-2", "ach-3", "ach-4", "ach-5", "ach-6"];

const OLD_RESPONSIBILITY: SharedEvidenceSnapshot = {
  kind: "responsibility",
  title: "Previously shared responsibility",
  description: null,
  status: "active",
  relationToRole: "within",
  period: { start: null, end: null },
  capturedAt: CAPTURED_AT,
};
const OLD_GOAL: SharedGoalSnapshot = {
  goalTitle: "Previously shared goal",
  treeId: null,
  targetDate: null,
  status: "active",
  capturedAt: CAPTURED_AT,
};

function responsibilityFields(index: number, overrides: Partial<EvidenceSourceFields> = {}): EvidenceSourceFields {
  return {
    kind: "responsibility",
    title: `Synthetic responsibility ${index}`,
    description: "Synthetic description",
    status: "active",
    relationToRole: "within",
    startDate: "2026-01-01",
    endDate: null,
    ...overrides,
  } as EvidenceSourceFields;
}

function achievementFields(index: number, overrides: Partial<EvidenceSourceFields> = {}): EvidenceSourceFields {
  return {
    kind: "achievement",
    title: `Synthetic achievement ${index}`,
    description: "Synthetic achievement description",
    outcome: null,
    relationToRole: "beyond",
    periodStart: null,
    periodEnd: null,
    ...overrides,
  } as EvidenceSourceFields;
}

/** Owner-scoped source reader keyed by owner and id. It records every read and can be made to fail, as a store would. */
function fakeEvidenceReader(seed: Record<string, EvidenceSourceFields>) {
  const sources = new Map<string, EvidenceSourceFields>(Object.entries(seed));
  const reads: Array<{ ownerUid: string; kind: EvidenceSourceKind; id: string }> = [];
  let failNext = false;
  const reader: OwnedEvidenceReader = {
    async read(ownerUid, kind, id) {
      reads.push({ ownerUid, kind, id });
      if (failNext) {
        failNext = false;
        return { ok: false, error: "persistence_failed" };
      }
      const fields = sources.get(`${ownerUid}/${id}`);
      if (fields === undefined || fields.kind !== kind) return { ok: false, error: "not_found" };
      return { ok: true, fields: structuredClone(fields) };
    },
    async list() {
      return { ok: true, list: { items: [], truncated: false } };
    },
  };
  return {
    reader,
    reads,
    failNextRead() {
      failNext = true;
    },
    /** Test only: removes or edits a source record, as the owner would in the personal workspace. */
    mutate(ownerUid: string, id: string, fields: EvidenceSourceFields | null) {
      if (fields === null) sources.delete(`${ownerUid}/${id}`);
      else sources.set(`${ownerUid}/${id}`, fields);
    },
  };
}

function sourceSeed(ownerUid = OWNER_UID): Record<string, EvidenceSourceFields> {
  const seed: Record<string, EvidenceSourceFields> = {};
  RESPONSIBILITY_IDS.forEach((id, index) => (seed[`${ownerUid}/${id}`] = responsibilityFields(index + 1)));
  ACHIEVEMENT_IDS.forEach((id, index) => (seed[`${ownerUid}/${id}`] = achievementFields(index + 1)));
  return seed;
}

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  evidence: ReturnType<typeof fakeEvidenceReader>;
  deps: SetSharedEvidenceDeps;
}

function setup(options: { sources?: Record<string, EvidenceSourceFields> } = {}): Setup {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const evidence = fakeEvidenceReader(options.sources ?? sourceSeed());
  const deps: SetSharedEvidenceDeps = { store, codec, reader: evidence.reader, clock: () => new Date(NOW.getTime()) };
  return { store, codec, evidence, deps };
}

async function rawOwner(store: FakeConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** The decrypted content of the stored owner document, read the way a decrypting reader reads it. */
async function storedContent(store: FakeConversationStore, codec: FakeContentCodec): Promise<ConversationContent> {
  const raw = await rawOwner(store);
  const envelope = {
    ciphertext: raw.ciphertext,
    iv: raw.iv,
    authTag: raw.authTag,
    keyVersion: raw.keyVersion,
    keyId: "k1", keyCheck: raw.keyCheck,
  } as StoredEnvelope;
  const decoded = codec.decodeContent(envelope, CTX);
  if (!decoded.ok) throw new Error("fixture content unreadable");
  return decoded.content;
}

const selection = (responsibilityIds: string[] = [], achievementIds: string[] = []) => ({ responsibilityIds, achievementIds });

describe("setSharedEvidence: open conversations (BR-40 to BR-45, BR-42 limits, D2-SI-19)", () => {
  it("stores one snapshot per selected record with exactly the allow-listed keys and no source id", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"], ["ach-1"]), FRESH, deps)).toEqual({ ok: true });
    const stored = (await storedContent(store, codec)).sharedEvidence;
    expect(stored).toEqual([
      {
        kind: "responsibility",
        title: "Synthetic responsibility 1",
        description: "Synthetic description",
        status: "active",
        relationToRole: "within",
        period: { start: "2026-01-01", end: null },
        capturedAt: NOW,
      },
      {
        kind: "achievement",
        title: "Synthetic achievement 1",
        description: "Synthetic achievement description",
        outcome: null,
        period: { start: null, end: null },
        relationToRole: "beyond",
        capturedAt: NOW,
      },
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/resp-1|ach-1|goalIds|responsibilityIds|ownerUid|"id"/);
  });

  it("replaces the whole evidence set in one write, keeping the previous set only when it is selected again", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedEvidence: [OLD_RESPONSIBILITY] });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection([], ["ach-2"]), FRESH, deps)).toEqual({ ok: true });
    const stored = (await storedContent(store, codec)).sharedEvidence;
    expect(stored.map((item) => item.kind)).toEqual(["achievement"]);
    expect((await rawOwner(store)).updatedAt).toEqual(NOW);
  });

  it("clears the set with an empty selection and reads no source record", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedEvidence: [OLD_RESPONSIBILITY] });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(), FRESH, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).sharedEvidence).toEqual([]);
    expect(evidence.reads).toHaveLength(0);
  });

  it("accepts five responsibilities and five achievements together", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(RESPONSIBILITY_IDS.slice(0, 5), ACHIEVEMENT_IDS.slice(0, 5)), FRESH, deps)).toEqual({
      ok: true,
    });
    expect((await storedContent(store, codec)).sharedEvidence).toHaveLength(10);
  });

  it("rejects six responsibilities with invalid_evidence_selection before any read, and writes nothing", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedEvidence: [OLD_RESPONSIBILITY] });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(RESPONSIBILITY_IDS), FRESH, deps)).toEqual({
      ok: false,
      error: "invalid_evidence_selection",
    });
    expect(evidence.reads).toHaveLength(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects six achievements the same way", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection([], ACHIEVEMENT_IDS), FRESH, deps)).toEqual({
      ok: false,
      error: "invalid_evidence_selection",
    });
    expect(evidence.reads).toHaveLength(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects malformed, duplicate and non-addressable ids before any source read", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    for (const bad of [selection(["resp-1", "resp-1"]), selection(["bad id!"]), selection(["__x__"]), selection([""])]) {
      expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, bad, FRESH, deps)).toEqual({ ok: false, error: "invalid_evidence_selection" });
    }
    expect(evidence.reads).toHaveLength(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects a body that carries uid, ownerUid or a client-written snapshot (N-E7)", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    const forged = [
      { ...selection(["resp-1"]), uid: OTHER_OWNER_UID },
      { ...selection(["resp-1"]), ownerUid: OTHER_OWNER_UID },
      { ...selection(), sharedEvidence: [OLD_RESPONSIBILITY] },
      "not an object",
      null,
    ];
    for (const body of forged) {
      expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, body, FRESH, deps)).toEqual({ ok: false, error: "invalid_evidence_selection" });
    }
    expect(evidence.reads).toHaveLength(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns invalid_evidence_selection for a foreign or unknown id, with no write and no existence hint (N-E6)", async () => {
    const { store, codec, evidence, deps } = setup({ sources: sourceSeed(OTHER_OWNER_UID) });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedEvidence: [OLD_RESPONSIBILITY] });
    const before = await rawOwner(store);

    const result = await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps);
    expect(result).toEqual({ ok: false, error: "invalid_evidence_selection" });
    expect(evidence.reads).toEqual([{ ownerUid: OWNER_UID, kind: "responsibility", id: "resp-1" }]);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a source whose stored text would need repair, as an invalid selection, with no write", async () => {
    const { store, codec, deps } = setup({
      sources: { [`${OWNER_UID}/resp-1`]: responsibilityFields(1, { title: "  padded title  " }) },
    });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({
      ok: false,
      error: "invalid_evidence_selection",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("maps a failed source read to persistence_failed and writes nothing", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    evidence.failNextRead();

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses with persistence_failed before any read when the key is unavailable, and writes nothing", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(evidence.reads).toHaveLength(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("keeps sharedGoals byte-for-byte while replacing the evidence set (BR-49)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_GOAL] });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).sharedGoals).toEqual([OLD_GOAL]);
  });

  it("returns conversation_not_found for another owner's conversation id, with no write", async () => {
    const { store, codec, deps } = setup({ sources: sourceSeed(OTHER_OWNER_UID) });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, ownerUid: OWNER_UID });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OTHER_OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for a malformed conversation id before any read", async () => {
    const { evidence, deps } = setup();
    expect(await setSharedEvidence(OWNER_UID, "not a valid id!", selection(["resp-1"]), FRESH, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(evidence.reads).toHaveLength(0);
  });

  it("preserves an existing snapshot after its source record is edited or deleted (BR-70)", async () => {
    const { store, codec, evidence, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({ ok: true });
    const captured = (await storedContent(store, codec)).sharedEvidence;

    evidence.mutate(OWNER_UID, "resp-1", responsibilityFields(1, { title: "Edited after sharing" }));
    expect((await storedContent(store, codec)).sharedEvidence).toEqual(captured);
    evidence.mutate(OWNER_UID, "resp-1", null);
    expect((await storedContent(store, codec)).sharedEvidence).toEqual(captured);
  });
});

describe("setSharedEvidence: completed conversations (BR-48, Amendment D, N-E8)", () => {
  it("refuses adding one item, with conversation_completed, and leaves the document byte-identical", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed" });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a partial removal, with conversation_completed, and leaves the document byte-identical", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      sharedEvidence: [OLD_RESPONSIBILITY, { ...OLD_RESPONSIBILITY, title: "Second" }],
    });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a non-empty replacement, with conversation_completed, and leaves the document byte-identical", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed", sharedEvidence: [OLD_RESPONSIBILITY] });
    const before = await rawOwner(store);

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection([], ["ach-1"]), FRESH, deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("gives an invalid selection its own validation error before the completed check (BR-48 precedence)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed" });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(RESPONSIBILITY_IDS), FRESH, deps)).toEqual({
      ok: false,
      error: "invalid_evidence_selection",
    });
  });

  it("accepts the whole-set clear, and the stored set is then empty", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      sharedEvidence: [OLD_RESPONSIBILITY],
      sharedGoals: [OLD_GOAL],
    });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(), FRESH, deps)).toEqual({ ok: true });
    const content = await storedContent(store, codec);
    expect(content.sharedEvidence).toEqual([]);
    expect(content.sharedGoals).toEqual([OLD_GOAL]);
  });
});

describe("setSharedEvidence: version precondition (E-1, conversation_changed)", () => {
  const LATER = new Date(NOW.getTime() + 60_000);
  const laterDeps = (deps: SetSharedEvidenceDeps, at: Date): SetSharedEvidenceDeps => ({ ...deps, clock: () => new Date(at.getTime()) });

  it("refuses a stale selection after another write advanced the conversation, and keeps the newer set", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, laterDeps(deps, LATER))).toEqual({ ok: true });

    const stale = await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-2"]), FRESH, deps);

    expect(stale).toEqual({ ok: false, error: "conversation_changed" });
    const stored = (await storedContent(store, codec)).sharedEvidence;
    expect(stored.map((snapshot) => snapshot.title)).toEqual(["Synthetic responsibility 1"]);
  });

  it("lets exactly one of two concurrent attempts with the same version succeed, and the other writes nothing", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const attempts = await Promise.all([
      setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, laterDeps(deps, new Date(LATER.getTime() + 1))),
      setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-2"]), FRESH, laterDeps(deps, new Date(LATER.getTime() + 2))),
    ]);

    expect(attempts.filter((result) => result.ok)).toHaveLength(1);
    expect(attempts.filter((result) => !result.ok)).toEqual([{ ok: false, error: "conversation_changed" }]);
    const stored = (await storedContent(store, codec)).sharedEvidence;
    expect(stored).toHaveLength(1);
  });

  it("refuses a clear from a stale view, so a newer selection is not erased", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), FRESH, laterDeps(deps, LATER))).toEqual({ ok: true });

    expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(), FRESH, deps)).toEqual({ ok: false, error: "conversation_changed" });
    expect((await storedContent(store, codec)).sharedEvidence).toHaveLength(1);
  });

  it("refuses a missing or non-canonical version with invalid_input before any source read", async () => {
    const { deps, evidence } = setup();
    for (const version of [undefined, null, 42, "2026-10-17T09:30:00Z", "not a date"]) {
      expect(await setSharedEvidence(OWNER_UID, CONVERSATION_ID, selection(["resp-1"]), version, deps)).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
    expect(evidence.reads).toHaveLength(0);
  });
});
