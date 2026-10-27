import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { READ_WINDOW } from "../domain/conversation-constants";
import { FORBIDDEN_DTO_KEYS, OWNER_PARTICIPANT_KEYS, OWNER_SUMMARY_KEYS } from "../domain/dto-keys";
import type { RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader } from "./fake-team-eligibility";
import {
  NOW,
  OTHER_OWNER_UID,
  OWNER_UID,
  PARTICIPANT_UID,
  TEAM_ID,
  rosterTeam,
  seedOwnerConversation,
} from "./owner-read-test-support";
import { readOwnerConversations, type ReadOwnerConversationsDeps } from "./read-owner-conversations";

/** Test-local name lookup. It records each call so tests can prove the one-call-per-list bound. */
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

function setup(options: { members?: string[]; names?: Record<string, string>; resolveParticipantState?: () => Promise<boolean> } = {}) {
  const store: FakeConversationStore = createFakeConversationStore({ generateId: () => "unused" });
  const codec: FakeContentCodec = createFakeContentCodec();
  const names = nameLookup(options.names);
  const deps: ReadOwnerConversationsDeps = {
    store,
    codec,
    teamReader: createFakeTeamEligibilityReader(rosterTeam(options.members ?? [OWNER_UID, PARTICIPANT_UID])),
    resolveParticipantState: options.resolveParticipantState ?? (async () => true),
    getNames: names.getNames,
  };
  return { store, codec, deps, names };
}

/** The stored plain record of a seeded conversation, copied so a test can alter one field and reseed it. */
async function storedRecord(store: FakeConversationStore, conversationId: string): Promise<RawConversationData> {
  const record = await store.getOwner(OWNER_UID, conversationId);
  if (record === undefined) throw new Error("fixture missing");
  return record;
}

/** Every key of a value, at any depth. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
  }
  return [];
}

describe("readOwnerConversations: owner list (BR-33, BR-36, BR-44)", () => {
  it("lists owner summaries newest first with the exact summary key set", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-old", createdAt: new Date(NOW.getTime() - 60_000) });
    await seedOwnerConversation(store, codec, { conversationId: "conv-new", createdAt: NOW });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.conversationId)).toEqual(["conv-new", "conv-old"]);
    expect(Object.keys(result.conversations[0]).sort()).toEqual([...OWNER_SUMMARY_KEYS].sort());
    expect(Object.keys(result.conversations[0].participant).sort()).toEqual([...OWNER_PARTICIPANT_KEYS].sort());
    expect(result.recovery).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("carries no forbidden field or participant identifier anywhere in the list", async () => {
    const { store, codec, deps } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Person" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "pending" } });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = allKeys(result);
    expect(keys.filter((key) => (FORBIDDEN_DTO_KEYS as readonly string[]).includes(key))).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(PARTICIPANT_UID);
    expect(JSON.stringify(result)).not.toContain("areaName");
  });

  it("fails the whole request with no items when the key probe fails (BR-53)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1" });
    codec.setKeyFailure("key_unavailable");

    expect(await readOwnerConversations(OWNER_UID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails the whole request when a stored keyCheck does not match the configured key, and never makes it a recovery item (BR-53)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1" });
    codec.setKeyFailure("key_mismatch");

    expect(await readOwnerConversations(OWNER_UID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("turns a structurally malformed document into a recovery item and still lists the valid ones (BR-33)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-valid" });
    await seedOwnerConversation(store, codec, { conversationId: "conv-bad", createdAt: new Date(NOW.getTime() - 1000) });
    store.seedRawOwner(OWNER_UID, "conv-bad", { ...(await storedRecord(store, "conv-bad")), title: "extra plaintext key" });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.conversationId)).toEqual(["conv-valid"]);
    expect(result.recovery).toEqual([{ conversationId: "conv-bad" }]);
  });

  it("turns an unauthenticated payload into a recovery item (BR-33)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-tampered" });
    const envelope = await storedRecord(store, "conv-tampered");
    store.seedRawOwner(OWNER_UID, "conv-tampered", { ...envelope, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations).toEqual([]);
    expect(result.recovery).toEqual([{ conversationId: "conv-tampered" }]);
  });

  it("finds a document without createdAt by the bounded scan and treats it as a recovery item (BR-33)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-valid" });
    await seedOwnerConversation(store, codec, { conversationId: "conv-no-created" });
    const record = { ...(await storedRecord(store, "conv-no-created")) };
    delete record.createdAt;
    store.seedRawOwner(OWNER_UID, "conv-no-created", record);

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.conversationId)).toEqual(["conv-valid"]);
    expect(result.recovery).toEqual([{ conversationId: "conv-no-created" }]);
  });

  it("turns a document whose decrypted payload breaks the content rules into a recovery item (BR-33)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-valid" });
    // A 101-code-point title is over TASK-001's limit, so the TASK-002 payload parser rejects the decrypted content.
    await seedOwnerConversation(store, codec, { conversationId: "conv-over-limit", title: "a".repeat(101), createdAt: new Date(NOW.getTime() - 1000) });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.conversationId)).toEqual(["conv-valid"]);
    expect(result.recovery).toEqual([{ conversationId: "conv-over-limit" }]);
  });

  it("classifies a document once when the ordered window and the missing-createdAt scan both name it (BR-33)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1" });
    const overlapping = {
      ...store,
      async scanOwnerMissingCreatedAt() {
        return { missingCreatedAtIds: ["conv-1"], rawCount: 1 };
      },
    };

    const result = await readOwnerConversations(OWNER_UID, { ...deps, store: overlapping });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations.map((c) => c.conversationId)).toEqual(["conv-1"]);
    expect(result.recovery).toEqual([]);
  });

  it("fails the whole list with no items when the ordered window read fails (BR-47)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1" });
    const failing = {
      ...store,
      async listOwnerWindow(): Promise<never> {
        throw new Error("simulated store read failure");
      },
    };

    expect(await readOwnerConversations(OWNER_UID, { ...deps, store: failing })).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("returns no partial list when a missing-createdAt point read fails after the window was read (BR-47)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-valid" });
    await seedOwnerConversation(store, codec, { conversationId: "conv-no-created" });
    const record = { ...(await storedRecord(store, "conv-no-created")) };
    delete record.createdAt;
    store.seedRawOwner(OWNER_UID, "conv-no-created", record);
    const failing = {
      ...store,
      async getOwner(ownerUid: string, conversationId: string) {
        if (conversationId === "conv-no-created") throw new Error("simulated point read failure");
        return store.getOwner(ownerUid, conversationId);
      },
    };

    expect(await readOwnerConversations(OWNER_UID, { ...deps, store: failing })).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reads at most READ_WINDOW + 1 raw documents, classifies only the first READ_WINDOW, and reports truncation (BR-36)", async () => {
    const { store, codec, deps } = setup();
    for (let index = 0; index <= READ_WINDOW; index += 1) {
      await seedOwnerConversation(store, codec, {
        conversationId: `conv-${String(index).padStart(3, "0")}`,
        createdAt: new Date(NOW.getTime() - index * 1000),
      });
    }
    let decrypts = 0;
    const countingDeps: ReadOwnerConversationsDeps = {
      ...deps,
      codec: {
        probeKey: () => codec.probeKey(),
        decryptForClassification: (envelope) => {
          decrypts += 1;
          return codec.decryptForClassification(envelope);
        },
      },
    };

    const result = await readOwnerConversations(OWNER_UID, countingDeps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.conversations).toHaveLength(READ_WINDOW);
    expect(decrypts).toBe(READ_WINDOW);
  });

  it("lists only the caller's own conversations", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-mine" });
    await seedOwnerConversation(store, codec, { conversationId: "conv-other", ownerUid: OTHER_OWNER_UID });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations.map((c) => c.conversationId)).toEqual(["conv-mine"]);
  });
});

describe("readOwnerConversations: participant state (BR-42, BR-44)", () => {
  it("reports state none and no name when there is no participant", async () => {
    const { store, codec, deps, names } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1" });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations[0].participant).toEqual({ state: "none", displayName: null });
    expect(names.calls).toEqual([]);
  });

  it("takes pending or accepted from the stored binding when the BR-21 check holds", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-pending", participant: { uid: PARTICIPANT_UID, state: "pending" } });
    await seedOwnerConversation(store, codec, {
      conversationId: "conv-accepted",
      createdAt: new Date(NOW.getTime() - 1000),
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations.map((c) => c.participant.state)).toEqual(["pending", "accepted"]);
  });

  it("reports unavailable when the injected BR-21 check says the bound participant no longer passes", async () => {
    const { store, codec, deps } = setup({ resolveParticipantState: async () => false });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations[0].participant.state).toBe("unavailable");
  });

  it("fails the request when the BR-21 check cannot be completed", async () => {
    const { store, codec, deps } = setup({
      resolveParticipantState: async () => {
        throw new Error("simulated access read failure");
      },
    });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });

    expect(await readOwnerConversations(OWNER_UID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("readOwnerConversations: roster-rule names (AD-7, BR-42, CL-20)", () => {
  it("shows the participant name only while both the owner and the participant are active members of the team", async () => {
    const { store, codec, deps, names } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations[0].participant.displayName).toBe("Synthetic Colleague");
    expect(names.calls).toEqual([[PARTICIPANT_UID]]);
  });

  it("is null when the participant's membership is no longer active", async () => {
    const { store, codec, deps, names } = setup({ members: [OWNER_UID], names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations[0].participant.displayName).toBeNull();
    expect(names.calls).toEqual([]);
  });

  it("is null when the owner no longer holds an active membership of the team (CL-20)", async () => {
    const { store, codec, deps, names } = setup({ members: [PARTICIPANT_UID], names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations[0].participant.displayName).toBeNull();
    expect(names.calls).toEqual([]);
  });

  it("performs one name lookup per list, with uids deduplicated", async () => {
    const { store, codec, deps, names } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-a", participant: { uid: PARTICIPANT_UID, state: "accepted" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-b", participant: { uid: PARTICIPANT_UID, state: "pending" } });

    const result = await readOwnerConversations(OWNER_UID, deps);

    expect(result.ok && result.conversations.map((c) => c.participant.displayName)).toEqual([
      "Synthetic Colleague",
      "Synthetic Colleague",
    ]);
    expect(names.calls).toEqual([[PARTICIPANT_UID]]);
  });

  it("is null when the team is disabled, even for two active members (CL-20, BR-31)", async () => {
    const { store, codec, deps, names } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });
    const disabledTeam = {
      ...deps,
      teamReader: createFakeTeamEligibilityReader({ ...rosterTeam([OWNER_UID, PARTICIPANT_UID]), teamStatus: { [TEAM_ID]: "disabled" } }),
    };

    const result = await readOwnerConversations(OWNER_UID, disabledTeam);

    expect(result.ok && result.conversations[0].participant.displayName).toBeNull();
    expect(names.calls).toEqual([]);
  });

  it("fails the whole list, and shows no name, when a roster membership read fails (CL-20)", async () => {
    const { store, codec, deps, names } = setup({ names: { [PARTICIPANT_UID]: "Synthetic Colleague" } });
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });
    const failingRead = {
      ...deps,
      teamReader: createFakeTeamEligibilityReader({ ...rosterTeam([OWNER_UID, PARTICIPANT_UID]), failMembershipRead: true }),
    };

    expect(await readOwnerConversations(OWNER_UID, failingRead)).toEqual({ ok: false, error: "persistence_failed" });
    expect(names.calls).toEqual([]);
  });

  it("fails the whole list rather than showing a partial result when the name lookup fails", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1", participant: { uid: PARTICIPANT_UID, state: "accepted" } });
    const failingDeps: ReadOwnerConversationsDeps = {
      ...deps,
      getNames: async () => {
        throw new Error("simulated profile read failure");
      },
    };

    expect(await readOwnerConversations(OWNER_UID, failingDeps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("readOwnerConversations: no area-name resolution on the list path (product-owner decision, 2026-10-17)", () => {
  it("never imports the SkillTree catalog or the area-name seam, and never writes an areaName", () => {
    for (const file of ["read-owner-conversations.ts", "owner-read.ts", "participant-presentation.ts"]) {
      // Comments are stripped, as the D2 scope guard does, so a prose mention of the rule does not count as code.
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/skill-trees|skillTrees|resolveAreaNames|area-names|areaName/);
    }
  });
});
