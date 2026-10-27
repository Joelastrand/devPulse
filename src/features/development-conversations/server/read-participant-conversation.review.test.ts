import { describe, expect, it } from "vitest";
import type { SkillTreeNameReader } from "./area-names";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { NOW, OWNER_UID, PARTICIPANT_MEMBER_REF, PARTICIPANT_UID, TEAM_ID, rosterTeam, seedOwnerConversation } from "./owner-read-test-support";
import { readParticipantConversation, type ReadParticipantConversationDeps } from "./read-participant-conversation";

// Synthetic fixtures only (invariant 15). Focused TASK-017 review coverage: denial before crypto, read failures,
// memberRef values, pending and completed, and no-write guarantees. The happy path lives in read-participant-conversation.test.ts.
const CONVERSATION_ID = "conv-1";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const NOT_FOUND = { ok: false, error: "conversation_not_found" };
const PERSISTENCE_FAILED = { ok: false, error: "persistence_failed" };

interface Harness {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: ReadParticipantConversationDeps;
}

function harness(options: { trees?: Record<string, string>; failTeamName?: boolean } = {}): Harness {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
  const teamReader = createFakeTeamEligibilityReader(state);
  const trees = options.trees ?? { "tree-a": "Synthetic area" };
  const areaNameReader: SkillTreeNameReader = {
    getSkillTree: async (treeId) =>
      trees[treeId] === undefined
        ? undefined
        : {
            name: trees[treeId],
            nodes: [
              { nodeId: "node-0", label: "Start", order: 0 },
              { nodeId: "node-1", label: "Mål", order: 1 },
            ],
            createdAt: new Date("2026-08-01T08:00:00.000Z"),
            createdBy: "admin-1",
          },
  };
  const deps: ReadParticipantConversationDeps = {
    store,
    codec,
    teamReader,
    teamNameReader: {
      getTeamName: async () => {
        if (options.failTeamName) throw new Error("simulated team name failure with a secret path");
        return "Synthetic team";
      },
    },
    areaNameReader,
    getNames: async (uids) => new Map(uids.filter((uid) => uid === OWNER_UID).map((uid) => [uid, "Synthetic owner"])),
  };
  return { store, codec, state, deps };
}

/** An accepted participant with one snapshot. Options replace the owner document's participant binding or status. */
async function seedAccepted(
  store: FakeConversationStore,
  codec: FakeContentCodec,
  options: { status?: "open" | "completed"; participant?: { uid: string; state: "pending" | "accepted" } } = {},
): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    participantNotes: "Synthetic participant note",
    status: options.status ?? "open",
    sharedGoals: [{ goalTitle: "Synthetic goal", treeId: "tree-a", targetDate: null, status: "active", capturedAt: NOW }],
    participant: options.participant ?? { uid: PARTICIPANT_UID, state: "accepted" },
  });
  await store.runTransaction(async (tx) => {
    tx.setParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date(NOW.getTime() + 1000) });
  });
}

/** Counts every codec call, so a test can prove the decision came before any probe or decryption. */
function spyCodec(codec: FakeContentCodec): { calls: { probe: number; decrypt: number }; spied: ReadParticipantConversationDeps["codec"] } {
  const calls = { probe: 0, decrypt: 0 };
  const spied: ReadParticipantConversationDeps["codec"] = {
    probeKey: () => {
      calls.probe += 1;
      return codec.probeKey();
    },
    decryptForClassification: (envelope) => {
      calls.decrypt += 1;
      return codec.decryptForClassification(envelope);
    },
  };
  return { calls, spied };
}

/** Counts transactions, so a test can prove a read path opens no write. */
function spyTransactions(store: FakeConversationStore): { calls: { transactions: number }; spied: FakeConversationStore } {
  const calls = { transactions: 0 };
  const spied: FakeConversationStore = {
    ...store,
    runTransaction: (work) => {
      calls.transactions += 1;
      return store.runTransaction(work);
    },
  };
  return { calls, spied };
}

type Breaker = (h: Harness) => Promise<void>;

const DENIALS: Array<[string, Breaker]> = [
  [
    "no index entry",
    async ({ store }) => {
      await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));
    },
  ],
  [
    "owner document missing",
    async ({ store }) => {
      await store.runTransaction(async (tx) => tx.deleteOwner(OWNER_UID, CONVERSATION_ID));
    },
  ],
  [
    "pending participant",
    async ({ store, codec }) => {
      await store.runTransaction(async (tx) => tx.deleteOwner(OWNER_UID, CONVERSATION_ID));
      await seedAccepted(store, codec, { participant: { uid: PARTICIPANT_UID, state: "pending" } });
    },
  ],
  [
    "team disabled",
    async ({ state }) => {
      state.teamStatus[TEAM_ID] = "disabled";
    },
  ],
  [
    "membership removed",
    async ({ state }) => {
      delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    },
  ],
  [
    "membership replaced with a new memberRef",
    async ({ state }) => {
      state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: REJOINED_REF };
    },
  ],
];

describe("readParticipantConversation: denial happens before any crypto (BR-21, BR-53)", () => {
  for (const keyState of ["key_unavailable", "key_mismatch"] as const) {
    for (const [label, breakCase] of DENIALS) {
      it(`denies ${label} with ${keyState} without probing or decrypting`, async () => {
        const h = harness();
        await seedAccepted(h.store, h.codec);
        await breakCase(h);
        h.codec.setKeyFailure(keyState);
        const { calls, spied } = spyCodec(h.codec);

        expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, codec: spied })).toStrictEqual(NOT_FOUND);
        expect(calls).toEqual({ probe: 0, decrypt: 0 });
      });
    }
  }

  it("denies an unreadable ciphertext for a non-participant without decrypting it", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    delete h.state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    const record = { ...(await h.store.getOwner(OWNER_UID, CONVERSATION_ID)) };
    h.store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });
    const { calls, spied } = spyCodec(h.codec);

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, codec: spied })).toStrictEqual(NOT_FOUND);
    expect(calls.decrypt).toBe(0);
  });
});

describe("readParticipantConversation: authorized crypto outcomes (BR-53, BR-47)", () => {
  it("reports an authorized key outage as persistence_failed after one probe and no decryption", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    h.codec.setKeyFailure("key_unavailable");
    const { calls, spied } = spyCodec(h.codec);

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, codec: spied })).toStrictEqual(PERSISTENCE_FAILED);
    expect(calls).toEqual({ probe: 1, decrypt: 0 });
  });

  it("reports an authorized key mismatch as persistence_failed, never as not found", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    h.codec.setKeyFailure("key_mismatch");

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(PERSISTENCE_FAILED);
  });
});

describe("readParticipantConversation: memberRef binding, each value on its own (BR-21 (e), CL-23)", () => {
  for (const [label, value] of [
    ["null", null],
    ["malformed", "not a member ref!"],
  ] as const) {
    it(`denies a current membership whose memberRef is ${label}`, async () => {
      const h = harness();
      await seedAccepted(h.store, h.codec);
      h.state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: value };

      expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(NOT_FOUND);
    });

    it(`denies a stored participantMemberRef that is ${label}`, async () => {
      const h = harness();
      await seedAccepted(h.store, h.codec);
      const record = { ...(await h.store.getOwner(OWNER_UID, CONVERSATION_ID)) };
      h.store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, participantMemberRef: value });

      expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(NOT_FOUND);
    });
  }

  it("still allows the matching current membership, so the two checks above are not a blanket denial", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    expect(h.state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`]).toMatchObject({ memberRef: PARTICIPANT_MEMBER_REF });
    expect((await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).ok).toBe(true);
  });
});

describe("readParticipantConversation: pending and completed (BR-30, CL-25)", () => {
  it("denies a pending invitation on a completed conversation, so the accepted path cannot be used", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec, { status: "completed", participant: { uid: PARTICIPANT_UID, state: "pending" } });

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(NOT_FOUND);
  });
});

describe("readParticipantConversation: operational failures are never denials (BR-47)", () => {
  it("reports an index read failure as persistence_failed", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    const failing = {
      ...h.store,
      getParticipation: async () => {
        throw new Error("simulated index failure with a secret path");
      },
    };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, store: failing })).toStrictEqual(PERSISTENCE_FAILED);
  });

  it("reports an owner read failure as persistence_failed", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    const failing = {
      ...h.store,
      getOwner: async () => {
        throw new Error("simulated owner failure with a secret path");
      },
    };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, store: failing })).toStrictEqual(PERSISTENCE_FAILED);
  });

  it("reports a team name read failure as persistence_failed", async () => {
    const h = harness({ failTeamName: true });
    await seedAccepted(h.store, h.codec);

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(PERSISTENCE_FAILED);
  });

  it("reports an owner-name presentation failure as persistence_failed", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    h.deps.getNames = async () => {
      throw new Error("simulated profile failure with a secret path");
    };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(PERSISTENCE_FAILED);
  });

  it("reports an area-name read failure as persistence_failed, never as area unavailable", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    h.deps.areaNameReader = {
      getSkillTree: async () => {
        throw new Error("simulated catalog failure with a secret path");
      },
    };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps)).toStrictEqual(PERSISTENCE_FAILED);
  });

  it("shows a null area name for a missing SkillTree, which is not an operational failure", async () => {
    const h = harness({ trees: {} });
    await seedAccepted(h.store, h.codec);

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps);
    expect(result.ok && result.dto.sharedGoals[0]?.areaName).toBeNull();
  });
});

describe("readParticipantConversation: no writes on any path (BR-17, D2-SI-8)", () => {
  it("opens no transaction on a successful read", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    const writes = spyTransactions(h.store);

    expect((await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, store: writes.spied })).ok).toBe(true);
    expect(writes.calls.transactions).toBe(0);
  });

  it("opens no transaction on a denied read", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    delete h.state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    const writes = spyTransactions(h.store);

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, { ...h.deps, store: writes.spied })).toStrictEqual(NOT_FOUND);
    expect(writes.calls.transactions).toBe(0);
  });

  it("leaves the owner document and the index unchanged on success and on denial", async () => {
    const h = harness();
    await seedAccepted(h.store, h.codec);
    const snapshot = async () => ({
      owner: await h.store.getOwner(OWNER_UID, CONVERSATION_ID),
      index: await h.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID),
    });
    const before = await snapshot();

    await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps);
    delete h.state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, h.deps);

    expect(await snapshot()).toEqual(before);
  });
});
