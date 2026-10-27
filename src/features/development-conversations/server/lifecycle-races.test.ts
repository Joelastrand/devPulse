import { describe, expect, it } from "vitest";
import type { ConversationContent } from "../domain/content-payload";
import type { ConversationStatus } from "../domain/conversation-status";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";
import { changeParticipant, type ChangeParticipantDeps } from "./change-participant";
import { completeConversation, type CompleteConversationDeps } from "./complete-conversation";
import type { ConversationStore, ConversationTransaction, RawConversationData } from "./conversation-store-types";
import { deleteConversation } from "./delete-conversation";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { inviteParticipant, type InviteParticipantDeps } from "./invite-participant";
import type { ParticipantRefReader } from "./member-ref-binding";
import { NOW, OWNER_UID, PARTICIPANT_MEMBER_REF, PARTICIPANT_UID, TEAM_ID, seedOwnerConversation } from "./owner-read-test-support";
import type { OwnedGoalReader } from "./read-owned-goal-snapshots";
import { acceptInvitation, leaveParticipation, type RespondToParticipationDeps } from "./respond-to-participation";
import { setSharedGoals, type SetSharedGoalsDeps } from "./set-shared-goals";
import { updateOwnerSections, type UpdateOwnerSectionsDeps } from "./update-owner-sections";
import { writeParticipantNotes, type WriteParticipantNotesDeps } from "./write-participant-notes";

/**
 * Deterministic concurrency and lifecycle race suite (SPEC BR-48, BR-49, BR-50 (1) to (6), BR-13, BR-17, BR-28; TASK-022).
 *
 * Every race is scripted with `scheduleCommitConflicts(1, beforeRetry)`: the operation under test runs its first attempt
 * to completion, the attempt's writes are discarded as a Firestore commit conflict would discard them, the competing
 * operation (or a membership change) commits, and then the operation's retry runs against the new authoritative state.
 * No timing, sleeps, probabilistic interleaving or worker settings are involved. The fake team and membership fixtures
 * are read live, so a change made between attempts is seen by the retry. A change made during an attempt is not
 * isolated from that attempt's reads, and no test relies on that. The fake is not a Firestore emulator.
 *
 * Final-state assertions read the persisted owner document and the participation index, and decode the encrypted
 * payload so that logical sections are compared, not ciphertext. Race tests run the operation under test through a
 * counting store, so each test also proves that the retry happened and what each attempt re-read (BR-48).
 */

// Synthetic fixtures only (invariant 15). Every uid, team, title and goal is fictional.
const CONVERSATION_ID = "conv-1";
const CANDIDATE_UID = "candidate-2";
const CANDIDATE_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const OWNER_REF = "0123456789abcdefghjkmnpqrs";
const GOAL_ID = "goal-race-1";
const TITLE = "Synthetic title";
const OWNER_NOTE = "Synthetic owner note";
const STEP = "Synthetic step";
const INVITED_AT = new Date(NOW.getTime() + 1000);
/** The time of the operation under test's own write. */
const T_WRITE = new Date(NOW.getTime() + 60_000);
/** The time of the competing operation, which commits between attempts. */
const T_COMPETE = new Date(NOW.getTime() + 120_000);
const GOAL = {
  title: "Synthetic goal",
  status: "active",
  treeId: "tree-a",
  targetDate: "2026-12-31",
  createdAt: new Date("2026-09-01T08:00:00.000Z"),
  updatedAt: new Date("2026-09-02T08:00:00.000Z"),
};
const OLD_SNAPSHOT: SharedGoalSnapshot = {
  goalTitle: "Previously shared goal",
  treeId: "tree-a",
  targetDate: "2026-12-31",
  status: "active",
  capturedAt: NOW,
};
const NEW_SNAPSHOT: SharedGoalSnapshot = {
  goalTitle: GOAL.title,
  treeId: "tree-a",
  targetDate: "2026-12-31",
  status: "active",
  capturedAt: T_WRITE,
};

const OK = { ok: true };
const NOT_FOUND = { ok: false, error: "conversation_not_found" };
const COMPLETED = { ok: false, error: "conversation_completed" };

const ENVELOPE_KEYS = ["ciphertext", "iv", "authTag", "keyVersion", "keyCheck"];

interface World {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  teams: FakeTeamEligibilityState;
  refReader: ParticipantRefReader;
  goalReader: OwnedGoalReader;
  goalReads: string[];
}

function membershipDoc(uid: string, memberRef: string): Record<string, unknown> {
  return { uid, teamId: TEAM_ID, createdAt: new Date(0), memberRef };
}

/** An active team with an owner, the participant and a candidate. The fixtures are shared by the store and the operations. */
function world(): World {
  const codec = createFakeContentCodec();
  const teams: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: {
      [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc(OWNER_UID, OWNER_REF),
      [`${PARTICIPANT_UID}__${TEAM_ID}`]: membershipDoc(PARTICIPANT_UID, PARTICIPANT_MEMBER_REF),
      [`${CANDIDATE_UID}__${TEAM_ID}`]: membershipDoc(CANDIDATE_UID, CANDIDATE_REF),
    },
  };
  const goalReads: string[] = [];
  const goalReader: OwnedGoalReader = {
    async get(ownerUid, goalId) {
      goalReads.push(goalId);
      return ownerUid === OWNER_UID && goalId === GOAL_ID ? structuredClone(GOAL) : undefined;
    },
  };
  const refReader: ParticipantRefReader = {
    ...createFakeTeamEligibilityReader(teams),
    async listMemberships(_teamId, limit) {
      return Object.values(teams.memberships).slice(0, limit);
    },
  };
  return { store: createFakeConversationStore({ teams }), codec, teams, refReader, goalReader, goalReads };
}

interface SeedOptions {
  participant?: "pending" | "accepted";
  participantNotes?: string;
  status?: ConversationStatus;
  sharedGoals?: SharedGoalSnapshot[];
}

/** One canonical owner document (through the fake codec) and, with a participant, the participant's index entry. */
async function seed(w: World, options: SeedOptions = {}): Promise<void> {
  await seedOwnerConversation(w.store, w.codec, {
    conversationId: CONVERSATION_ID,
    title: TITLE,
    ownerNotes: OWNER_NOTE,
    nextSteps: [STEP],
    plannedFor: "2026-11-03",
    participant: options.participant === undefined ? undefined : { uid: PARTICIPANT_UID, state: options.participant },
    participantNotes: options.participantNotes,
    status: options.status,
    sharedGoals: options.sharedGoals,
  });
  if (options.participant !== undefined) {
    w.store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: INVITED_AT });
  }
}

/** The decrypted logical content of a stored owner document, read through the synthetic codec only to assert on it. */
function contentOf(codec: FakeContentCodec, raw: RawConversationData): ConversationContent {
  const result = codec.decodeContent({
    ciphertext: raw.ciphertext,
    iv: raw.iv,
    authTag: raw.authTag,
    keyVersion: raw.keyVersion,
    keyCheck: raw.keyCheck,
  } as StoredEnvelope);
  if (!result.ok) throw new Error("fixture payload does not decode");
  return result.content;
}

async function rawOwner(w: World): Promise<RawConversationData> {
  const raw = await w.store.getOwner(OWNER_UID, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** Everything a race can change, for one conversation: plain owner fields, decoded content and both index entries. */
async function stateOf(w: World) {
  const raw = await w.store.getOwner(OWNER_UID, CONVERSATION_ID);
  return {
    plain: raw === undefined ? undefined : Object.fromEntries(Object.entries(raw).filter(([key]) => !ENVELOPE_KEYS.includes(key))),
    content: raw === undefined ? undefined : contentOf(w.codec, raw),
    participantIndex: await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID),
    candidateIndex: await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID),
  };
}

interface AttemptReads {
  index: number;
  owner: number;
  team: number;
  membership: number;
}

/**
 * A pass-through store that counts what each transaction attempt reads. Attempts are recorded in order, so the retry
 * is visible as a second entry. Nothing is changed.
 */
function counting(store: FakeConversationStore): { store: ConversationStore; attempts: AttemptReads[] } {
  const attempts: AttemptReads[] = [];
  const counted: ConversationStore = {
    ...store,
    runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) =>
      store.runTransaction<T>((tx) => {
        const reads: AttemptReads = { index: 0, owner: 0, team: 0, membership: 0 };
        attempts.push(reads);
        return work({
          ...tx,
          teamEligibility: {
            getTeamStatus: (teamId) => {
              reads.team += 1;
              return tx.teamEligibility.getTeamStatus(teamId);
            },
            getMembership: (uid, teamId) => {
              reads.membership += 1;
              return tx.teamEligibility.getMembership(uid, teamId);
            },
          },
          getParticipation: (callerUid, conversationId) => {
            reads.index += 1;
            return tx.getParticipation(callerUid, conversationId);
          },
          getOwner: (ownerUid, conversationId) => {
            reads.owner += 1;
            return tx.getOwner(ownerUid, conversationId);
          },
        });
      }),
  };
  return { store: counted, attempts };
}

const at = (time: Date) => () => new Date(time.getTime());

/** Operation dependencies. Each takes the store to use, so the operation under test can run through the counting store. */
const deps = {
  respond: (w: World, store: ConversationStore, time = T_WRITE): RespondToParticipationDeps => ({
    store,
    codec: w.codec,
    clock: at(time),
  }),
  change: (w: World, store: ConversationStore, time = T_WRITE): ChangeParticipantDeps => ({
    store,
    codec: w.codec,
    refReader: w.refReader,
    clock: at(time),
  }),
  notes: (w: World, store: ConversationStore, time = T_WRITE): WriteParticipantNotesDeps => ({ store, codec: w.codec, clock: at(time) }),
  complete: (_w: World, store: ConversationStore, time = T_WRITE): CompleteConversationDeps => ({ store, clock: at(time) }),
  invite: (w: World, store: ConversationStore, time = T_WRITE): InviteParticipantDeps => ({
    store,
    codec: w.codec,
    refReader: w.refReader,
    clock: at(time),
  }),
  goals: (w: World, store: ConversationStore, time = T_WRITE): SetSharedGoalsDeps => ({
    store,
    codec: w.codec,
    goalStore: w.goalReader,
    clock: at(time),
  }),
  sections: (w: World, store: ConversationStore, time = T_WRITE): UpdateOwnerSectionsDeps => ({
    store,
    codec: w.codec,
    clock: at(time),
  }),
};

const accept = (w: World, store: ConversationStore) => acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps.respond(w, store));
const leave = (w: World, store: ConversationStore, time = T_WRITE) =>
  leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps.respond(w, store, time));
const removeParticipant = (w: World, store: ConversationStore, time = T_WRITE) =>
  changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps.change(w, store, time));
const replaceWithCandidate = (w: World, store: ConversationStore, time = T_WRITE) =>
  changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps.change(w, store, time));
const writeNotes = (w: World, store: ConversationStore, text: string) =>
  writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, text, deps.notes(w, store));
const complete = (w: World, store: ConversationStore, time = T_WRITE) =>
  completeConversation(OWNER_UID, CONVERSATION_ID, deps.complete(w, store, time));
const invite = (w: World, store: ConversationStore) => inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps.invite(w, store));
const updateTitle = (w: World, store: ConversationStore, title: string, time = T_COMPETE) =>
  updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title }, deps.sections(w, store, time));
const setGoals = (w: World, store: ConversationStore, goalIds: unknown) =>
  setSharedGoals(OWNER_UID, CONVERSATION_ID, goalIds, deps.goals(w, store));
const deleteOwn = (w: World, store: ConversationStore) => deleteConversation(OWNER_UID, CONVERSATION_ID, { store });

describe("BR-50 (1): completion vs participant write (BR-28, BR-13, BR-17)", () => {
  it("completion commits first: the conflicted note write retries, sees completed, and commits nothing", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await writeNotes(w, counted.store, "Late note")).toEqual(COMPLETED);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.updatedAt).toEqual(T_COMPETE);
    expect(contentOf(w.codec, after).participantNotes).toBe("Before");
    expect(after.participantState).toBe("accepted");
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("note write commits first: the conflicted completion keeps the note, the envelope and the participation", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    let ciphertextAfterNote: unknown;
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await writeNotes(w, w.store, "Committed note")).toEqual(OK);
      ciphertextAfterNote = (await rawOwner(w)).ciphertext;
    });

    expect(await complete(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.completedAt).toEqual(T_COMPETE);
    // Completion never rewrites the payload, so the envelope is the one the note write committed.
    expect(after.ciphertext).toBe(ciphertextAfterNote);
    expect(contentOf(w.codec, after).participantNotes).toBe("Committed note");
    expect(after.participantState).toBe("accepted");
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("BR-13: completion commits first: the conflicted accept fails and creates no access", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await accept(w, counted.store)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.participantAcceptedAt).toBeNull();
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("accept commits first: the conflicted completion keeps the accepted participant and their index (BR-28)", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await accept(w, w.store)).toEqual(OK);
    });

    expect(await complete(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBe(PARTICIPANT_UID);
    expect(after.participantState).toBe("accepted");
    expect(after.participantAcceptedAt).toEqual(T_WRITE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toEqual({ ownerUid: OWNER_UID, invitedAt: INVITED_AT });
  });

  it("self-leave commits first: the conflicted completion retries, completes, and leaves no participant or index (BR-13, BR-28)", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await leave(w, w.store)).toEqual(OK);
    });

    expect(await complete(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.completedAt).toEqual(T_COMPETE);
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(contentOf(w.codec, after).participantNotes).toBe("");
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("completion commits first: the conflicted self-leave succeeds, since leave is allowed after completion (BR-17)", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await leave(w, counted.store)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(contentOf(w.codec, after).participantNotes).toBe("");
    expect(contentOf(w.codec, after).ownerNotes).toBe(OWNER_NOTE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("BR-50 (2): revoke vs participant write (BR-16, BR-20)", () => {
  it("owner removal commits first: the conflicted note write fails and does not recreate participantNotes", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await removeParticipant(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await writeNotes(w, counted.store, "Late note")).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.updatedAt).toEqual(T_COMPETE);
    const content = contentOf(w.codec, after);
    expect(content.participantNotes).toBe("");
    expect(content.ownerNotes).toBe(OWNER_NOTE);
    expect(content.title).toBe(TITLE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("note write commits first: the owner removal retries against the new payload and deletes that note", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await writeNotes(w, w.store, "Committed note")).toEqual(OK);
    });

    expect(await removeParticipant(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(after.updatedAt).toEqual(T_COMPETE);
    // Neither the stale attempt's "Before" nor the committed "Committed note" survives the removal (BR-16).
    expect(contentOf(w.codec, after).participantNotes).toBe("");
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("owner update commits first: the conflicted owner removal keeps the owner's new fields and deletes only the notes (BR-16)", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await updateTitle(w, w.store, "Late title", T_COMPETE)).toEqual(OK);
    });

    expect(await removeParticipant(w, counted.store, T_WRITE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(contentOf(w.codec, after)).toEqual({
      title: "Late title",
      ownerNotes: OWNER_NOTE,
      nextSteps: [STEP],
      participantNotes: "",
      sharedGoals: [],
    });
  });

  it("removal then rejoin between attempts: the note write fails on the new memberRef, and the stale binding is not reused", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, () => {
      w.teams.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = membershipDoc(PARTICIPANT_UID, REJOINED_REF);
    });

    expect(await writeNotes(w, counted.store, "Late note")).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    // The owner document keeps the old binding: nothing repairs or re-binds it, so access stays denied (BR-21 (e)).
    expect(after.participantMemberRef).toBe(PARTICIPANT_MEMBER_REF);
    expect(after.participantState).toBe("accepted");
    expect(contentOf(w.codec, after).participantNotes).toBe("Before");
    expect(await writeNotes(w, w.store, "After rejoin")).toEqual(NOT_FOUND);
  });
});

describe("BR-50 (3): accept vs owner removal, replacement and rejoin (BR-15, BR-16)", () => {
  it("owner removal commits first: the conflicted accept fails and creates no accepted participation", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await removeParticipant(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await accept(w, counted.store)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.participantAcceptedAt).toBeNull();
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("owner replacement commits first: the conflicted accept fails, the old index is gone, and the candidate is pending", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await replaceWithCandidate(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await accept(w, counted.store)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBe(CANDIDATE_UID);
    expect(after.participantMemberRef).toBe(CANDIDATE_REF);
    expect(after.participantState).toBe("pending");
    expect(after.participantAcceptedAt).toBeNull();
    expect(after.participantInvitedAt).toEqual(T_COMPETE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toEqual({ ownerUid: OWNER_UID, invitedAt: T_COMPETE });
  });

  it("accept commits first: the conflicted owner replacement retries against the accepted participant, replaces them, and makes the candidate pending", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await accept(w, w.store)).toEqual(OK);
    });

    expect(await replaceWithCandidate(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBe(CANDIDATE_UID);
    expect(after.participantState).toBe("pending");
    expect(after.participantAcceptedAt).toBeNull();
    expect(after.participantInvitedAt).toEqual(T_COMPETE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toEqual({ ownerUid: OWNER_UID, invitedAt: T_COMPETE });
  });

  it("accept commits first: the conflicted owner removal retries against the accepted state and removes it", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await accept(w, w.store)).toEqual(OK);
    });

    expect(await removeParticipant(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.participantAcceptedAt).toBeNull();
    expect(after.updatedAt).toEqual(T_COMPETE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("removal then rejoin between attempts: the conflicted accept fails on the new memberRef and stays pending", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, () => {
      w.teams.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = membershipDoc(PARTICIPANT_UID, REJOINED_REF);
    });

    expect(await accept(w, counted.store)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantState).toBe("pending");
    expect(after.participantAcceptedAt).toBeNull();
    expect(after.participantMemberRef).toBe(PARTICIPANT_MEMBER_REF);
  });
});

describe("BR-50 (4): snapshot change vs completion (BR-24 to BR-27, CL-26)", () => {
  it("completion commits first: the conflicted non-empty set fails with conversation_completed, and the goal is read once", async () => {
    const w = world();
    await seed(w, { sharedGoals: [OLD_SNAPSHOT] });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await setGoals(w, counted.store, [GOAL_ID])).toEqual(COMPLETED);

    expect(counted.attempts).toHaveLength(2);
    // The goal reads run before the transaction (BR-50 (4)), so the retry does not read the goal again.
    expect(w.goalReads).toEqual([GOAL_ID]);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.updatedAt).toEqual(T_COMPETE);
    expect(contentOf(w.codec, after).sharedGoals).toEqual([OLD_SNAPSHOT]);
  });

  it("snapshot set commits first: the conflicted completion keeps that snapshot and completes", async () => {
    const w = world();
    await seed(w);
    const counted = counting(w.store);
    let ciphertextAfterSet: unknown;
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await setGoals(w, w.store, [GOAL_ID])).toEqual(OK);
      ciphertextAfterSet = (await rawOwner(w)).ciphertext;
    });

    expect(await complete(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.ciphertext).toBe(ciphertextAfterSet);
    expect(contentOf(w.codec, after).sharedGoals).toEqual([NEW_SNAPSHOT]);
  });

  it("clear commits first: the conflicted completion retries, completes, and keeps the cleared set empty", async () => {
    const w = world();
    await seed(w, { sharedGoals: [OLD_SNAPSHOT] });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await setGoals(w, w.store, [])).toEqual(OK);
    });

    expect(await complete(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.completedAt).toEqual(T_COMPETE);
    expect(contentOf(w.codec, after).sharedGoals).toEqual([]);
  });

  it("completion commits first: the conflicted clear is still allowed (BR-27, CL-26) and empties the set", async () => {
    const w = world();
    await seed(w, { sharedGoals: [OLD_SNAPSHOT] });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await setGoals(w, counted.store, [])).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.updatedAt).toEqual(T_WRITE);
    expect(contentOf(w.codec, after).sharedGoals).toEqual([]);
  });
});

describe("BR-50 (5): delete vs any write (BR-29)", () => {
  type Run = (w: World, store: ConversationStore) => Promise<unknown>;
  const cases: Array<[string, SeedOptions, Run]> = [
    ["participant note write", { participant: "accepted" }, (w, s) => writeNotes(w, s, "Late note")],
    ["accept", { participant: "pending" }, accept],
    ["accepted self-leave", { participant: "accepted" }, (w, s) => leave(w, s)],
    ["owner section update", { participant: "accepted" }, (w, s) => updateTitle(w, s, "Late title")],
    ["snapshot set", {}, (w, s) => setGoals(w, s, [GOAL_ID])],
    ["owner removal", { participant: "accepted" }, (w, s) => removeParticipant(w, s)],
    ["owner replacement", { participant: "pending" }, (w, s) => replaceWithCandidate(w, s)],
    ["completion", { participant: "accepted" }, (w, s) => complete(w, s)],
    ["invitation", {}, (w, s) => invite(w, s)],
  ];

  it.each(cases)("delete commits first: the conflicted %s fails with conversation_not_found and leaves no document or index", async (_name, options, run) => {
    const w = world();
    await seed(w, options);
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await deleteOwn(w, w.store)).toEqual(OK);
    });

    expect(await run(w, counted.store)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    expect(await w.store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("BR-50 (6) and BR-13: invitation vs delete and completion", () => {
  it("delete commits first: the conflicted invitation fails with conversation_not_found and writes no candidate index", async () => {
    const w = world();
    await seed(w);
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await deleteOwn(w, w.store)).toEqual(OK);
    });

    expect(await invite(w, counted.store)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    expect(await w.store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("completion commits first: the conflicted invitation fails with conversation_completed and creates no access (BR-13)", async () => {
    const w = world();
    await seed(w);
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await invite(w, counted.store)).toEqual(COMPLETED);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBeNull();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("invitation commits first: the conflicted completion withdraws the pending invitation in the same commit (BR-13)", async () => {
    const w = world();
    await seed(w);
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await invite(w, w.store)).toEqual(OK);
    });

    expect(await complete(w, counted.store, T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    // No completed document with a pending participant, and no index, may survive (CL-25).
    const after = await rawOwner(w);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.participantMemberRef).toBeNull();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("invitation first vs delete (BR-29, BR-10)", () => {
  it("invitation commits first: the conflicted delete retries, removes the owner document and the invited candidate's index", async () => {
    const w = world();
    await seed(w);
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await invite(w, w.store)).toEqual(OK);
    });

    expect(await deleteOwn(w, counted.store)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    expect(await w.store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("completion vs delete (BR-29, BR-28)", () => {
  it("completion commits first: the conflicted delete still succeeds, and removes the owner document and the participant index", async () => {
    const w = world();
    await seed(w, { participant: "accepted" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await complete(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await deleteConversation(OWNER_UID, CONVERSATION_ID, { store: counted.store })).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    expect(await w.store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("leave vs owner update, leave vs leave, and notes vs section writes (BR-17, BR-49, IMPL-1)", () => {
  it("owner update commits first: the conflicted leave decrypts the new payload, keeps the new fields, and removes only its notes", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Late title", ownerNotes: "Late owner" }, deps.sections(w, w.store, T_COMPETE))).toEqual(OK);
    });

    expect(await leave(w, counted.store, T_WRITE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(after.updatedAt).toEqual(T_WRITE);
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
    expect(contentOf(w.codec, after)).toEqual({
      title: "Late title",
      ownerNotes: "Late owner",
      nextSteps: [STEP],
      participantNotes: "",
      sharedGoals: [],
    });
  });

  it("leave commits first: the conflicted owner update retries and cannot restore the participant's notes", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await leave(w, w.store, T_WRITE)).toEqual(OK);
    });

    expect(await updateTitle(w, counted.store, "Late title", T_COMPETE)).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    expect(after.updatedAt).toEqual(T_COMPETE);
    expect(contentOf(w.codec, after)).toEqual({
      title: "Late title",
      ownerNotes: OWNER_NOTE,
      nextSteps: [STEP],
      participantNotes: "",
      sharedGoals: [],
    });
  });

  it("leave vs leave: one leave commits, and the other, retried, finds no index and returns conversation_not_found (BR-17)", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await leave(w, w.store, T_COMPETE)).toEqual(OK);
    });

    expect(await leave(w, counted.store, T_WRITE)).toEqual(NOT_FOUND);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.participantUid).toBeNull();
    // The second leave committed nothing: the first leave's time and state are the final ones.
    expect(after.updatedAt).toEqual(T_COMPETE);
    expect(contentOf(w.codec, after).participantNotes).toBe("");
    expect(await w.store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await leave(w, w.store, T_WRITE)).toEqual(NOT_FOUND);
  });

  it("BR-49: the owner's section update commits first, and the conflicted note write keeps those fields and writes only participantNotes", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Late title", nextSteps: ["Late step"] }, deps.sections(w, w.store, T_COMPETE))).toEqual(OK);
    });

    expect(await writeNotes(w, counted.store, "Committed note")).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    const after = await rawOwner(w);
    expect(after.updatedAt).toEqual(T_WRITE);
    expect(contentOf(w.codec, after)).toEqual({
      title: "Late title",
      ownerNotes: OWNER_NOTE,
      nextSteps: ["Late step"],
      participantNotes: "Committed note",
      sharedGoals: [],
    });
  });

  it("BR-49: the participant's note commits first, and the conflicted owner update keeps that note", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1, async () => {
      expect(await writeNotes(w, w.store, "Committed note")).toEqual(OK);
    });

    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { ownerNotes: "Late owner" }, deps.sections(w, counted.store, T_COMPETE))).toEqual(OK);

    expect(counted.attempts).toHaveLength(2);
    expect(contentOf(w.codec, await rawOwner(w))).toEqual({
      title: TITLE,
      ownerNotes: "Late owner",
      nextSteps: [STEP],
      participantNotes: "Committed note",
      sharedGoals: [],
    });
  });
});

describe("BR-48: each attempt re-reads its authoritative inputs", () => {
  it("accept re-reads the index, the owner, the team and the membership on every attempt", async () => {
    const w = world();
    await seed(w, { participant: "pending" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1);

    expect(await accept(w, counted.store)).toEqual(OK);

    const reads = { index: 1, owner: 1, team: 1, membership: 1 };
    expect(counted.attempts).toEqual([reads, reads]);
  });

  it("a participant note write re-reads the index, the owner, the team and the membership on every attempt", async () => {
    const w = world();
    await seed(w, { participant: "accepted" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1);

    expect(await writeNotes(w, counted.store, "Late note")).toEqual(OK);

    const reads = { index: 1, owner: 1, team: 1, membership: 1 };
    expect(counted.attempts).toEqual([reads, reads]);
  });

  it("accepted self-leave re-reads the index and the owner, and never the team or membership (BR-18)", async () => {
    const w = world();
    await seed(w, { participant: "accepted", participantNotes: "Before" });
    const counted = counting(w.store);
    w.store.scheduleCommitConflicts(1);

    expect(await leave(w, counted.store)).toEqual(OK);

    const reads = { index: 1, owner: 1, team: 0, membership: 0 };
    expect(counted.attempts).toEqual([reads, reads]);
  });
});

describe("TASK-022: a retried transaction applies each effect once (no double-apply)", () => {
  type Run = (w: World, store: ConversationStore) => Promise<unknown>;
  const cases: Array<[string, SeedOptions, Run]> = [
    ["invitation", {}, invite],
    ["accept", { participant: "pending" }, accept],
    ["pending decline", { participant: "pending" }, (w, s) => leave(w, s)],
    ["accepted self-leave", { participant: "accepted", participantNotes: "Before" }, (w, s) => leave(w, s)],
    ["owner removal", { participant: "accepted", participantNotes: "Before" }, (w, s) => removeParticipant(w, s)],
    ["owner replacement", { participant: "pending" }, (w, s) => replaceWithCandidate(w, s)],
    ["completion", { participant: "accepted" }, (w, s) => complete(w, s)],
    ["participant note write", { participant: "accepted" }, (w, s) => writeNotes(w, s, "Note")],
    ["owner section update", { participant: "accepted" }, (w, s) => updateTitle(w, s, "Title")],
    ["snapshot set", {}, (w, s) => setGoals(w, s, [GOAL_ID])],
    ["delete", { participant: "accepted" }, (w, s) => deleteOwn(w, s)],
  ];

  it.each(cases)("%s retried twice ends in the same state and result as a single attempt", async (_name, options, run) => {
    const single = world();
    await seed(single, options);
    const singleResult = await run(single, single.store);

    const retried = world();
    await seed(retried, options);
    retried.store.scheduleCommitConflicts(2);
    const counted = counting(retried.store);
    const retriedResult = await run(retried, counted.store);

    expect(counted.attempts).toHaveLength(3);
    expect(retriedResult).toEqual(singleResult);
    expect(await stateOf(retried)).toEqual(await stateOf(single));
  });
});
