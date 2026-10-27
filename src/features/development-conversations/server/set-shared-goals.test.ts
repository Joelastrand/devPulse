import { describe, expect, it } from "vitest";
import type { ConversationContent } from "../domain/content-payload";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { ConversationStore, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { OTHER_OWNER_UID, NOW, OWNER_UID, PARTICIPANT_UID, seedOwnerConversation } from "./owner-read-test-support";
import type { OwnedGoalReader } from "./read-owned-goal-snapshots";
import { setSharedGoals, type SetSharedGoalsDeps } from "./set-shared-goals";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";

/** Synthetic fixtures only (invariant 15). No real person, team or wellbeing data. */
const CONVERSATION_ID = "conv-1";
const LATER = new Date(NOW.getTime() + 60_000);
const CAPTURED_AT = new Date("2026-10-01T08:00:00.000Z");
const OLD_SNAPSHOT: SharedGoalSnapshot = {
  goalTitle: "Previously shared goal",
  treeId: "tree-a",
  targetDate: "2026-12-31",
  status: "active",
  capturedAt: CAPTURED_AT,
};

/** Goal ids are chosen so the deep scan can look for them verbatim. */
const GOAL_IDS = ["goal-secret-1", "goal-secret-2", "goal-secret-3", "goal-secret-4", "goal-secret-5", "goal-secret-6"];

/** D1-shaped goal data as a raw read returns it. */
function goalData(title: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title,
    status: "active",
    treeId: "tree-a",
    targetDate: "2026-12-31",
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    updatedAt: new Date("2026-09-02T08:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Test-local goal reader keyed by owner and goal id. It records every read, can be made to fail, and can run a hook
 * after a read so a test can change the conversation between the goal reads and the transaction (BR-50 (4)).
 */
function fakeGoalReader(seed: Record<string, Record<string, unknown>>) {
  const goals = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const reads: Array<{ ownerUid: string; goalId: string }> = [];
  let failNext = false;
  let afterRead: (() => Promise<void>) | null = null;
  const reader: OwnedGoalReader = {
    async get(ownerUid, goalId) {
      reads.push({ ownerUid, goalId });
      if (failNext) {
        failNext = false;
        throw new Error("simulated Firestore failure with a secret path");
      }
      const data = goals.get(`${ownerUid}/${goalId}`);
      const result = data === undefined ? undefined : structuredClone(data);
      if (afterRead !== null) {
        const hook = afterRead;
        afterRead = null;
        await hook();
      }
      return result;
    },
  };
  return {
    reader,
    reads,
    failNextRead() {
      failNext = true;
    },
    afterNextRead(hook: () => Promise<void>) {
      afterRead = hook;
    },
    /** Test only: changes a stored D1 goal in place, as an edit, completion, reopen or delete would. */
    mutate(ownerUid: string, goalId: string, data: Record<string, unknown> | null) {
      if (data === null) goals.delete(`${ownerUid}/${goalId}`);
      else goals.set(`${ownerUid}/${goalId}`, data);
    },
  };
}

function goalSeed(ownerUid = OWNER_UID): Record<string, Record<string, unknown>> {
  const seed: Record<string, Record<string, unknown>> = {};
  GOAL_IDS.forEach((goalId, index) => {
    seed[`${ownerUid}/${goalId}`] = goalData(`Synthetic goal ${index + 1}`);
  });
  return seed;
}

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  goals: ReturnType<typeof fakeGoalReader>;
  deps: SetSharedGoalsDeps;
}

function setup(options: { goals?: Record<string, Record<string, unknown>> } = {}): Setup {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const goals = fakeGoalReader(options.goals ?? goalSeed());
  const deps: SetSharedGoalsDeps = { store, codec, goalStore: goals.reader, clock: () => new Date(NOW.getTime()) };
  return { store, codec, goals, deps };
}

async function rawOwner(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** The decrypted content of the stored owner document, read the way a decrypting reader reads it. */
async function storedContent(store: ConversationStore, codec: FakeContentCodec): Promise<ConversationContent> {
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

describe("setSharedGoals: open conversations (BR-24, BR-27, AD-6)", () => {
  it("clears the set with an empty list", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).sharedGoals).toEqual([]);
  });

  it("replaces the whole set with one snapshot per selected goal", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).sharedGoals).toEqual([
      { goalTitle: "Synthetic goal 1", treeId: "tree-a", targetDate: "2026-12-31", status: "active", capturedAt: NOW },
    ]);
    expect((await rawOwner(store)).updatedAt).toEqual(NOW);
  });

  it("accepts five distinct goals and stores them in request order", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    const ids = GOAL_IDS.slice(0, 5);
    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, ids, deps)).toEqual({ ok: true });
    expect((await storedContent(store, codec)).sharedGoals.map((goal) => goal.goalTitle)).toEqual([
      "Synthetic goal 1",
      "Synthetic goal 2",
      "Synthetic goal 3",
      "Synthetic goal 4",
      "Synthetic goal 5",
    ]);
  });

  it("rejects six goals with invalid_goal_selection and writes nothing", async () => {
    const { store, codec, goals, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, GOAL_IDS, deps)).toEqual({ ok: false, error: "invalid_goal_selection" });
    expect(goals.reads).toHaveLength(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects duplicate ids with invalid_goal_selection and writes nothing", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0], GOAL_IDS[0]], deps)).toEqual({
      ok: false,
      error: "invalid_goal_selection",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects a goal that belongs to another owner, as an absent goal, with no write", async () => {
    const { store, codec, goals, deps } = setup({ goals: { ...goalSeed(OTHER_OWNER_UID) } });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "invalid_goal_selection" });
    expect(goals.reads).toEqual([{ ownerUid: OWNER_UID, goalId: GOAL_IDS[0] }]);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("rejects the whole selection when one goal is malformed, and writes nothing", async () => {
    const { store, codec, goals, deps } = setup({
      goals: { ...goalSeed(), [`${OWNER_UID}/${GOAL_IDS[1]}`]: goalData("Broken", { status: "archived" }) },
    });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0], GOAL_IDS[1]], deps)).toEqual({
      ok: false,
      error: "invalid_goal_selection",
    });
    expect(goals.reads.length).toBeGreaterThan(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("maps a goal read failure to persistence_failed and writes nothing", async () => {
    const { store, codec, goals, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);
    goals.failNextRead();

    const result = await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
    expect(await rawOwner(store)).toEqual(before);
  });

  it("keeps the previous set when the replacement cannot be encrypted (one transaction)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);
    const failingEncode: SetSharedGoalsDeps["codec"] = {
      ...codec,
      encodeContent: () => ({ ok: false, error: "key_unavailable" }),
    };

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], { ...deps, codec: failingEncode })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for an absent conversation and writes nothing", async () => {
    const { store, deps } = setup();
    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("setSharedGoals: completed conversations (BR-27, CL-26, D2-SI-9)", () => {
  it("refuses a non-empty set with conversation_completed and leaves the stored set unchanged", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed", sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("clears the set with an empty list and keeps the conversation completed", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      title: "Frozen title",
      sharedGoals: [OLD_SNAPSHOT],
    });

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], deps)).toEqual({ ok: true });
    const raw = await rawOwner(store);
    expect(raw.status).toBe("completed");
    expect(raw.completedAt).toEqual(new Date(NOW.getTime() + 3000));
    const content = await storedContent(store, codec);
    expect(content.sharedGoals).toEqual([]);
    expect(content.title).toBe("Frozen title");
  });
});

describe("setSharedGoals: completion race (BR-50 (4))", () => {
  it("fails with conversation_completed when the conversation completes between the goal reads and the transaction", async () => {
    const { store, codec, goals, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);
    goals.afterNextRead(async () => {
      await store.runTransaction(async (tx) => {
        tx.updateOwner(OWNER_UID, CONVERSATION_ID, { status: "completed", completedAt: LATER, updatedAt: LATER });
      });
    });

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "conversation_completed" });
    const after = await rawOwner(store);
    expect(after.status).toBe("completed");
    expect(after.ciphertext).toBe(before.ciphertext);
    expect((await storedContent(store, codec)).sharedGoals).toEqual([OLD_SNAPSHOT]);
  });
});

describe("setSharedGoals: snapshot content (BR-25, BR-26)", () => {
  it("keeps the snapshot after the D1 goal is edited or deleted, because no goal id is stored", async () => {
    const { store, codec, goals, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: true });

    goals.mutate(OWNER_UID, GOAL_IDS[0], goalData("Edited after sharing", { status: "completed" }));
    expect((await storedContent(store, codec)).sharedGoals[0]?.goalTitle).toBe("Synthetic goal 1");

    goals.mutate(OWNER_UID, GOAL_IDS[0], null);
    expect((await storedContent(store, codec)).sharedGoals[0]).toMatchObject({ goalTitle: "Synthetic goal 1", status: "active" });
  });

  it("never stores or returns a goal id (deep scan of the stored object, decrypted content and result)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    const result = await setSharedGoals(OWNER_UID, CONVERSATION_ID, GOAL_IDS.slice(0, 5), deps);
    expect(result).toEqual({ ok: true });

    const serialized = JSON.stringify([await rawOwner(store), await storedContent(store, codec), result]);
    for (const goalId of GOAL_IDS) {
      expect(serialized).not.toContain(goalId);
    }
  });
});

const LATER_CLOCK = () => new Date(LATER.getTime());

/** Rewrites stored plain or envelope fields in place, as a corrupted or foreign document would look. */
async function reseedRawOwner(store: FakeConversationStore, patch: Partial<RawConversationData>, ownerUid = OWNER_UID): Promise<void> {
  const raw = await rawOwner(store, ownerUid);
  store.seedRawOwner(ownerUid, CONVERSATION_ID, { ...raw, ...patch });
}

describe("setSharedGoals: preservation (BR-49, D2-SI-7, D2-SI-8)", () => {
  const CONTENT = {
    title: "Preserved title",
    ownerNotes: "Owner notes before sharing",
    nextSteps: ["Keep this step"],
    participantNotes: "Participant history must survive",
    sharedGoals: [OLD_SNAPSHOT],
  };
  const PLAIN_KEYS = [
    "teamId",
    "participantUid",
    "participantMemberRef",
    "participantState",
    "participantInvitedAt",
    "participantAcceptedAt",
    "plannedFor",
    "status",
    "completedAt",
    "createdAt",
  ] as const;

  it.each([
    ["replacement", [GOAL_IDS[0], GOAL_IDS[1]]],
    ["clear", []],
  ])("keeps every other encrypted section and plain field after a %s", async (_label, goalIds) => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      title: CONTENT.title,
      ownerNotes: CONTENT.ownerNotes,
      nextSteps: CONTENT.nextSteps,
      participantNotes: CONTENT.participantNotes,
      sharedGoals: CONTENT.sharedGoals,
      plannedFor: "2026-11-03",
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, goalIds, { ...deps, clock: LATER_CLOCK })).toEqual({ ok: true });

    const after = await rawOwner(store);
    for (const key of PLAIN_KEYS) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(after.updatedAt).toEqual(LATER);
    const content = await storedContent(store, codec);
    expect({ ...content, sharedGoals: [] }).toEqual({ ...CONTENT, sharedGoals: [] });
  });

  it("leaves a completed conversation's frozen fields untouched when it clears the set", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      title: CONTENT.title,
      participantNotes: CONTENT.participantNotes,
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
      sharedGoals: CONTENT.sharedGoals,
    });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], { ...deps, clock: LATER_CLOCK })).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after.completedAt).toEqual(before.completedAt);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.participantInvitedAt).toEqual(before.participantInvitedAt);
    expect(after.participantAcceptedAt).toEqual(before.participantAcceptedAt);
    expect((await storedContent(store, codec)).participantNotes).toBe(CONTENT.participantNotes);
  });
});

describe("setSharedGoals: owner boundary and input contract (BR-24, D2-SI-15)", () => {
  it("returns conversation_not_found for a malformed id before any goal read or write", async () => {
    const { goals, deps, store } = setup();
    expect(await setSharedGoals(OWNER_UID, "bad id!", [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(goals.reads).toHaveLength(0);
    expect(await store.countOwner(OWNER_UID)).toBe(0);
  });

  it("does not touch another owner's conversation of the same id", async () => {
    const { store, codec, deps } = setup({ goals: goalSeed() });
    await seedOwnerConversation(store, codec, { ownerUid: OTHER_OWNER_UID, conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store, OTHER_OWNER_UID);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store, OTHER_OWNER_UID)).toEqual(before);
  });

  it.each([["a string", "goal-secret-1"], ["null", null], ["an object", { 0: "goal-secret-1" }]])(
    "rejects %s as the selection with invalid_goal_selection and no write",
    async (_label, goalIds) => {
      const { store, codec, goals, deps } = setup();
      await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
      const before = await rawOwner(store);

      expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, goalIds, deps)).toEqual({ ok: false, error: "invalid_goal_selection" });
      expect(goals.reads).toHaveLength(0);
      expect(await rawOwner(store)).toEqual(before);
    },
  );
});

describe("setSharedGoals: stored conversation classification (BR-33, BR-53)", () => {
  it("returns conversation_not_found for a structurally malformed stored document and does not repair it", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    await reseedRawOwner(store, { status: "archived" });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for an unauthenticated payload and does not overwrite it", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    await reseedRawOwner(store, { ciphertext: Buffer.from("no-such-handle").toString("base64") });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for a decrypted payload that fails the content rules", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const bad = codec.encodeContent({
      title: "Bad payload",
      ownerNotes: "",
      nextSteps: Array.from({ length: 999 }, () => "step"),
      participantNotes: "",
      sharedGoals: [],
    });
    if (!bad.ok) throw new Error("fixture key unavailable");
    await reseedRawOwner(store, { ...bad.content });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns persistence_failed on a key outage before any read, with no write", async () => {
    const { store, codec, goals, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0]], deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(goals.reads).toHaveLength(0);
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns persistence_failed on a configured-key mismatch (not a recovery or not-found result), with no write", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);
    codec.setKeyFailure("key_mismatch");

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], deps)).toEqual({ ok: false, error: "persistence_failed" });
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("maps a transaction failure to persistence_failed without leaking the raw error", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const failing: SetSharedGoalsDeps["store"] = {
      ...store,
      runTransaction: async () => {
        throw new Error("simulated transaction failure with a secret path");
      },
    };

    const result = await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], { ...deps, store: failing });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
  });
});

describe("setSharedGoals: completed precedence (decision 2026-10-17)", () => {
  it("returns invalid_goal_selection for an invalid non-empty selection even when the conversation is completed", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed", sharedGoals: [OLD_SNAPSHOT] });
    const before = await rawOwner(store);

    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [GOAL_IDS[0], GOAL_IDS[0]], deps)).toEqual({
      ok: false,
      error: "invalid_goal_selection",
    });
    expect(await rawOwner(store)).toEqual(before);
  });
});
