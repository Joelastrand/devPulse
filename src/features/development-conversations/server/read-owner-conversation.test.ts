import { describe, expect, it } from "vitest";
import { FORBIDDEN_DTO_KEYS, OWNER_DTO_KEYS, OWNER_PARTICIPANT_KEYS } from "../domain/dto-keys";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader } from "./fake-team-eligibility";
import {
  OTHER_OWNER_UID,
  OWNER_UID,
  PARTICIPANT_UID,
  rosterTeam,
  seedOwnerConversation,
} from "./owner-read-test-support";
import { readOwnerConversation, type ReadOwnerConversationDeps } from "./read-owner-conversation";
import type { SkillTreeNameReader } from "./area-names";

const CONVERSATION_ID = "conv-1";
const CAPTURED_AT = new Date("2026-10-10T08:00:00.000Z");

/** A valid stored SkillTree as a raw read returns it. Synthetic. */
function treeData(name: string): Record<string, unknown> {
  return {
    name,
    nodes: [
      { nodeId: "node-0", label: "Start", order: 0 },
      { nodeId: "node-1", label: "Mål", order: 1 },
    ],
    createdAt: new Date("2026-08-01T08:00:00.000Z"),
    createdBy: "admin-1",
  };
}

/** Test-local catalog reader. It records every point read, so tests can prove the bound and deduplication. */
function fakeCatalog(trees: Record<string, unknown> = {}) {
  const reads: string[] = [];
  const reader: SkillTreeNameReader = {
    async getSkillTree(treeId) {
      reads.push(treeId);
      return trees[treeId] === undefined ? undefined : structuredClone(trees[treeId]);
    },
  };
  return { reader, reads };
}

function goal(treeId: string | null, goalTitle = "Synthetic goal"): SharedGoalSnapshot {
  return { goalTitle, treeId, targetDate: null, status: "active", capturedAt: CAPTURED_AT };
}

function nameLookup(names: Record<string, string> = {}) {
  const calls: string[][] = [];
  return {
    calls,
    getNames: async (uids: readonly string[]) => {
      calls.push([...uids]);
      return new Map(uids.flatMap((uid) => (names[uid] === undefined ? [] : [[uid, names[uid]] as const])));
    },
  };
}

function setup(options: { members?: string[]; names?: Record<string, string>; trees?: Record<string, unknown> } = {}) {
  const store: FakeConversationStore = createFakeConversationStore({ generateId: () => "unused" });
  const codec: FakeContentCodec = createFakeContentCodec();
  const names = nameLookup(options.names);
  const catalog = fakeCatalog(options.trees);
  const deps: ReadOwnerConversationDeps = {
    store,
    codec,
    teamReader: createFakeTeamEligibilityReader(rosterTeam(options.members ?? [OWNER_UID, PARTICIPANT_UID])),
    resolveParticipantState: async () => true,
    getNames: names.getNames,
    areaNameReader: catalog.reader,
  };
  return { store, codec, deps, names, catalog };
}

/** Every key of a value, at any depth. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
  }
  return [];
}

describe("readOwnerConversation: owner detail (BR-35, BR-42)", () => {
  it("returns the owner DTO with the exact key set and the stored content", async () => {
    const { store, codec, deps } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      title: "Synthetic title",
      ownerNotes: "Synthetic owner note",
      participantNotes: "Synthetic participant note",
      plannedFor: "2026-11-01",
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });

    const result = await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = result.conversation;
    expect(Object.keys(dto).sort()).toEqual([...OWNER_DTO_KEYS].sort());
    expect(Object.keys(dto.participant).sort()).toEqual([...OWNER_PARTICIPANT_KEYS].sort());
    expect(dto).toMatchObject({
      conversationId: CONVERSATION_ID,
      title: "Synthetic title",
      status: "open",
      plannedFor: "2026-11-01",
      teamId: "team-alpha",
      participant: { state: "accepted", displayName: "Synthetic Colleague" },
      ownerNotes: "Synthetic owner note",
      participantNotes: "Synthetic participant note",
      completedAt: null,
    });
  });

  it("returns conversation_not_found for a malformed document (BR-35)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const record: RawConversationData = { ...(await store.getOwner(OWNER_UID, CONVERSATION_ID)) };
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, title: "extra plaintext key" });

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("returns conversation_not_found for an unauthenticated payload (BR-35)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const record: RawConversationData = { ...(await store.getOwner(OWNER_UID, CONVERSATION_ID)) };
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("returns conversation_not_found when the decrypted payload breaks the content rules (BR-35)", async () => {
    const { store, codec, deps } = setup();
    // A 101-code-point title is over TASK-001's limit, so the TASK-002 payload parser rejects the decrypted content.
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, title: "a".repeat(101) });

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("returns conversation_not_found for an absent id, a foreign owner's id and a malformed id (BR-35)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { ownerUid: OTHER_OWNER_UID, conversationId: CONVERSATION_ID });
    const notFound = { ok: false, error: "conversation_not_found" };

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual(notFound);
    expect(await readOwnerConversation(OWNER_UID, "absent-id", deps)).toEqual(notFound);
    expect(await readOwnerConversation(OWNER_UID, "not/a/segment", deps)).toEqual(notFound);
  });

  it("fails with persistence_failed and no DTO when the key probe fails (BR-53)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    codec.setKeyFailure("key_unavailable");

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails with persistence_failed, never conversation_not_found, on a configured-key mismatch (BR-53)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    codec.setKeyFailure("key_mismatch");

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("carries no participant uid, memberRef, e-mail or forbidden field anywhere (BR-46, D2-SI-14)", async () => {
    const { store, codec, deps } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, participant: { uid: PARTICIPANT_UID, state: "pending" } });

    const result = await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(allKeys(result).filter((key) => (FORBIDDEN_DTO_KEYS as readonly string[]).includes(key))).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(PARTICIPANT_UID);
    expect(JSON.stringify(result)).not.toContain("0123456789abcdefghjkmnpqrs");
  });

  it("reports the participant as unavailable when the injected BR-21 check fails", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, participant: { uid: PARTICIPANT_UID, state: "accepted" } });

    const result = await readOwnerConversation(OWNER_UID, CONVERSATION_ID, {
      ...deps,
      resolveParticipantState: async () => false,
    });

    expect(result.ok && result.conversation.participant).toEqual({ state: "unavailable", displayName: null });
  });

  it("keeps the participant's notes visible to the owner while the participant is unavailable (CL-21)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participantNotes: "Synthetic participant note",
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });

    const result = await readOwnerConversation(OWNER_UID, CONVERSATION_ID, {
      ...deps,
      resolveParticipantState: async () => false,
    });

    expect(result.ok && result.conversation).toMatchObject({
      participantNotes: "Synthetic participant note",
      participant: { state: "unavailable", displayName: null },
    });
  });

  it("fails with persistence_failed when the owner point read fails (BR-47)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const failing = {
      ...store,
      async getOwner(): Promise<never> {
        throw new Error("simulated point read failure");
      },
    };

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, { ...deps, store: failing })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });

  it("fails with persistence_failed, and shows no name, when a roster membership read fails (CL-20)", async () => {
    const { store, codec, deps, names } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, participant: { uid: PARTICIPANT_UID, state: "accepted" } });
    const failingRead = {
      ...deps,
      teamReader: createFakeTeamEligibilityReader({ ...rosterTeam([OWNER_UID, PARTICIPANT_UID]), failMembershipRead: true }),
    };

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, failingRead)).toEqual({ ok: false, error: "persistence_failed" });
    expect(names.calls).toEqual([]);
  });
});

describe("readOwnerConversation: area names (BR-45, D2-SI-5)", () => {
  it("resolves at most five distinct trees through the seam, reading each distinct tree once", async () => {
    const { store, codec, deps, catalog } = setup({ trees: { "tree-a": treeData("Kodekvalitet") } });
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      sharedGoals: [goal("tree-a"), goal("tree-missing"), goal("tree-a"), goal(null)],
    });

    const result = await readOwnerConversation(OWNER_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.sharedGoals.map((g) => g.areaName)).toEqual(["Kodekvalitet", null, "Kodekvalitet", null]);
    expect(catalog.reads).toEqual(["tree-a", "tree-missing"]);
  });

  it("fails the detail with persistence_failed and no partial DTO when an area read fails", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, sharedGoals: [goal("tree-a")] });
    const failingDeps: ReadOwnerConversationDeps = {
      ...deps,
      areaNameReader: {
        async getSkillTree() {
          throw new Error("simulated catalog read failure");
        },
      },
    };

    expect(await readOwnerConversation(OWNER_UID, CONVERSATION_ID, failingDeps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});
