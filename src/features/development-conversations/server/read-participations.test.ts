import { describe, expect, it } from "vitest";
import { PARTICIPANT_SUMMARY_KEYS } from "../domain/dto-keys";
import { READ_WINDOW } from "../domain/conversation-constants";
import type { ConversationStore, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { readParticipations, type ReadParticipationsDeps } from "./read-participations";
import {
  NOW,
  OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  TEAM_ID,
  rosterTeam,
  seedOwnerConversation,
} from "./owner-read-test-support";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const TEAM_NAME = "Synthetic team";
const OTHER_PARTICIPANT_UID = "participant-2";
const OTHER_MEMBER_REF = "abcdefghjkmnpqrstvwxyz0123";
const MEMBERSHIP_KEY = `${PARTICIPANT_UID}__${TEAM_ID}`;

interface Counts {
  owner: number;
  probe: number;
  teamStatus: number;
  membership: number;
  teamName: number;
}

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  teamNames: Record<string, unknown>;
  counts: Counts;
  deps: ReadParticipationsDeps;
}

/** The caller's team and membership fixture, the synthetic codec, and counting wrappers around every read. */
function setup(state: FakeTeamEligibilityState = rosterTeam([OWNER_UID, PARTICIPANT_UID])): Setup {
  const store = createFakeConversationStore({ teams: state });
  const codec = createFakeContentCodec();
  const teamNames: Record<string, unknown> = { [TEAM_ID]: TEAM_NAME };
  const counts: Counts = { owner: 0, probe: 0, teamStatus: 0, membership: 0, teamName: 0 };
  const deps: ReadParticipationsDeps = {
    store: countingStore(store, counts),
    codec: {
      probeKey: () => {
        counts.probe += 1;
        return codec.probeKey();
      },
      decryptForClassification: (envelope) => codec.decryptForClassification(envelope),
    },
    teamReader: {
      getTeamStatus: async (teamId) => {
        counts.teamStatus += 1;
        if (state.failTeamRead) throw new Error("simulated team read failure");
        return state.teamStatus[teamId];
      },
      getMembership: async (uid, teamId) => {
        counts.membership += 1;
        if (state.failMembershipRead) throw new Error("simulated membership read failure");
        return state.memberships[`${uid}__${teamId}`];
      },
    },
    teamNameReader: {
      getTeamName: async (teamId) => {
        counts.teamName += 1;
        return teamNames[teamId];
      },
    },
  };
  return { store, codec, state, teamNames, counts, deps };
}

/** Counts owner point reads, so a test can prove the window bound. */
function countingStore(store: FakeConversationStore, counts: Counts): ConversationStore {
  return {
    ...store,
    getOwner: async (ownerUid, conversationId) => {
      counts.owner += 1;
      return store.getOwner(ownerUid, conversationId);
    },
  };
}

/** An index entry and an owner document for an accepted or pending participation, as earlier tasks leave them. */
async function seedParticipation(
  setupValue: Setup,
  conversationId: string,
  options: {
    state?: "pending" | "accepted";
    title?: string;
    invitedAt?: Date;
    ownerUid?: string;
    status?: "open" | "completed";
  } = {},
): Promise<void> {
  const { store, codec } = setupValue;
  const ownerUid = options.ownerUid ?? OWNER_UID;
  await seedOwnerConversation(store, codec, {
    ownerUid,
    conversationId,
    title: options.title ?? `Synthetic title ${conversationId}`,
    status: options.status,
    participant: { uid: PARTICIPANT_UID, state: options.state ?? "accepted" },
  });
  store.seedRawParticipation(PARTICIPANT_UID, conversationId, {
    ownerUid,
    invitedAt: options.invitedAt ?? NOW,
  });
}

/** Removes a participant's membership, so BR-21 (d) and (e) fail. */
function removeMembership(state: FakeTeamEligibilityState, uid = PARTICIPANT_UID): void {
  delete state.memberships[`${uid}__${TEAM_ID}`];
}

describe("readParticipations: shown entries and summary shape (BR-34, BR-44)", () => {
  it("shows a pending entry with a null title and an accepted entry with its title, invitedAt from the index", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted", title: "Synthetic accepted", invitedAt: new Date("2026-10-10T08:00:00.000Z") });
    await seedParticipation(setupValue, "conv-pending", { state: "pending", title: "Synthetic pending", invitedAt: new Date("2026-10-11T08:00:00.000Z") });

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({
      ok: true,
      participations: [
        { conversationId: "conv-pending", state: "pending", title: null, teamName: TEAM_NAME, invitedAt: new Date("2026-10-11T08:00:00.000Z") },
        { conversationId: "conv-accepted", state: "accepted", title: "Synthetic accepted", teamName: TEAM_NAME, invitedAt: new Date("2026-10-10T08:00:00.000Z") },
      ],
      truncated: false,
    });
  });

  it("every summary has exactly the BR-44 keys, with no uid, memberRef or crypto detail anywhere in the result", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });

    const result = await readParticipations(PARTICIPANT_UID, setupValue.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const summary of result.participations) {
      expect(Object.keys(summary).sort()).toEqual([...PARTICIPANT_SUMMARY_KEYS].sort());
    }
    const text = JSON.stringify(result);
    for (const fragment of [OWNER_UID, PARTICIPANT_UID, PARTICIPANT_MEMBER_REF, "ciphertext", "authTag", "keyCheck", "ownerUid", "memberRef"]) {
      expect(text, fragment).not.toContain(fragment);
    }
  });

  it("shows a completed conversation to an accepted participant, because completion freezes content, not access", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-done", { state: "accepted", status: "completed", title: "Synthetic done" });

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({
      ok: true,
      participations: [{ conversationId: "conv-done", state: "accepted", title: "Synthetic done", teamName: TEAM_NAME, invitedAt: NOW }],
      truncated: false,
    });
  });

  it("returns an empty list for a caller with no index entries, and lists only the caller's own entries", async () => {
    const setupValue = setup(rosterTeam([OWNER_UID, PARTICIPANT_UID, OTHER_PARTICIPANT_UID]));
    expect(await readParticipations("participant-9", setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });

    await seedParticipation(setupValue, "conv-mine", { state: "accepted" });
    await seedOwnerConversation(setupValue.store, setupValue.codec, {
      conversationId: "conv-theirs",
      participant: { uid: OTHER_PARTICIPANT_UID, state: "accepted" },
    });
    setupValue.store.seedRawParticipation(OTHER_PARTICIPANT_UID, "conv-theirs", { ownerUid: OWNER_UID, invitedAt: NOW });

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toMatchObject({
      ok: true,
      participations: [{ conversationId: "conv-mine" }],
    });
    expect(await readParticipations(OTHER_PARTICIPANT_UID, setupValue.deps)).toMatchObject({
      ok: true,
      participations: [{ conversationId: "conv-theirs" }],
    });
  });
});

describe("readParticipations: omission, never placeholder (BR-21, BR-34, BR-14)", () => {
  it("omits a pending entry whose membership was removed, and an accepted entry whose membership was removed", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    removeMembership(setupValue.state);

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });
  });

  it("omits every entry of a disabled team, pending and accepted alike", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    setupValue.state.teamStatus[TEAM_ID] = "disabled";

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });
  });

  it("omits an accepted entry whose membership was replaced with a new memberRef (memberRef is freshness, not authorization)", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    setupValue.state.memberships[MEMBERSHIP_KEY] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: NOW, memberRef: OTHER_MEMBER_REF };

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });
  });

  it("omits a pending entry whose memberRef no longer matches the current membership", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });
    setupValue.state.memberships[MEMBERSHIP_KEY] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: NOW, memberRef: OTHER_MEMBER_REF };

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });
  });

  it("omits an entry whose owner document is missing, or names another participant (stale index)", async () => {
    const setupValue = setup(rosterTeam([OWNER_UID, PARTICIPANT_UID, OTHER_PARTICIPANT_UID]));
    setupValue.store.seedRawParticipation(PARTICIPANT_UID, "conv-missing", { ownerUid: OWNER_UID, invitedAt: NOW });
    await seedOwnerConversation(setupValue.store, setupValue.codec, {
      conversationId: "conv-stale",
      participant: { uid: OTHER_PARTICIPANT_UID, state: "accepted" },
    });
    setupValue.store.seedRawParticipation(PARTICIPANT_UID, "conv-stale", { ownerUid: OWNER_UID, invitedAt: NOW });

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });
  });

  it("omits a malformed index entry without revealing it, and returns only the shape of a success", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-good", { state: "accepted" });
    setupValue.store.seedRawParticipation(PARTICIPANT_UID, "conv-bad", { ownerUid: 7, invitedAt: NOW } as unknown as RawConversationData);

    const result = await readParticipations(PARTICIPANT_UID, setupValue.deps);
    expect(result).toEqual({
      ok: true,
      participations: [expect.objectContaining({ conversationId: "conv-good" })],
      truncated: false,
    });
    expect(Object.keys(result).sort()).toEqual(["ok", "participations", "truncated"]);
  });

  it("omits an accepted entry whose payload is unauthenticated, and still shows the other entries", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-good", { state: "accepted", title: "Synthetic good", invitedAt: new Date("2026-10-12T08:00:00.000Z") });
    await seedParticipation(setupValue, "conv-tampered", { state: "accepted", invitedAt: new Date("2026-10-11T08:00:00.000Z") });
    const raw = await setupValue.store.getOwner(OWNER_UID, "conv-tampered");
    if (raw === undefined) throw new Error("fixture missing");
    setupValue.store.seedRawOwner(OWNER_UID, "conv-tampered", { ...raw, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({
      ok: true,
      participations: [{ conversationId: "conv-good", state: "accepted", title: "Synthetic good", teamName: TEAM_NAME, invitedAt: new Date("2026-10-12T08:00:00.000Z") }],
      truncated: false,
    });
  });

  it("omits an accepted entry whose decrypted payload is malformed, and still shows the other entries", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-good", { state: "accepted", title: "Synthetic good", invitedAt: new Date("2026-10-12T08:00:00.000Z") });
    // A 101-code-point title decrypts and authenticates, but breaks TASK-001's content rule, so it is malformed, not unauthenticated.
    await seedParticipation(setupValue, "conv-malformed", { state: "accepted", title: "a".repeat(101), invitedAt: new Date("2026-10-11T08:00:00.000Z") });

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({
      ok: true,
      participations: [{ conversationId: "conv-good", state: "accepted", title: "Synthetic good", teamName: TEAM_NAME, invitedAt: new Date("2026-10-12T08:00:00.000Z") }],
      truncated: false,
    });
  });
});

describe("readParticipations: window bound (BR-34, BR-36)", () => {
  it("reads at most READ_WINDOW owner documents and reports truncated when the raw index has more than READ_WINDOW rows", async () => {
    const setupValue = setup();
    for (let i = 0; i < READ_WINDOW + 1; i += 1) {
      // No owner document: each entry is omitted, so the test measures the bound and not the content.
      setupValue.store.seedRawParticipation(PARTICIPANT_UID, `conv-${String(i).padStart(3, "0")}`, {
        ownerUid: OWNER_UID,
        invitedAt: new Date(NOW.getTime() - i * 1000),
      });
    }

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: true });
    expect(setupValue.counts.owner).toBe(READ_WINDOW);
  });

  it("does not report truncated at exactly READ_WINDOW rows", async () => {
    const setupValue = setup();
    for (let i = 0; i < READ_WINDOW; i += 1) {
      setupValue.store.seedRawParticipation(PARTICIPANT_UID, `conv-${String(i).padStart(3, "0")}`, {
        ownerUid: OWNER_UID,
        invitedAt: new Date(NOW.getTime() - i * 1000),
      });
    }

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: true, participations: [], truncated: false });
  });
});

describe("readParticipations: key handling (BR-53)", () => {
  it("a key outage with an accepted entry → persistence_failed for the whole list, never a partial omission", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    setupValue.codec.setKeyFailure("key_unavailable");

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: false, error: "persistence_failed" });
    setupValue.codec.setKeyFailure(null);
  });

  it("a key mismatch with an accepted entry → persistence_failed for the whole list", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    setupValue.codec.setKeyFailure("key_mismatch");

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: false, error: "persistence_failed" });
    setupValue.codec.setKeyFailure(null);
  });

  it("a key outage with only pending entries still lists them, because no title is decrypted and no probe runs", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });
    setupValue.codec.setKeyFailure("key_unavailable");

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({
      ok: true,
      participations: [expect.objectContaining({ conversationId: "conv-pending", state: "pending", title: null })],
      truncated: false,
    });
    setupValue.codec.setKeyFailure(null);
    expect(setupValue.counts.probe).toBe(0);
  });

  it("probes the key once per request, however many accepted entries are shown", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-a", { state: "accepted" });
    await seedParticipation(setupValue, "conv-b", { state: "accepted" });
    await seedParticipation(setupValue, "conv-c", { state: "accepted" });

    const result = await readParticipations(PARTICIPANT_UID, setupValue.deps);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.participations).toHaveLength(3);
    expect(setupValue.counts.probe).toBe(1);
  });
});

describe("readParticipations: shared reads per request (BR-36)", () => {
  it("reads each team status, membership and team name once for entries in the same team", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-a", { state: "accepted" });
    await seedParticipation(setupValue, "conv-b", { state: "accepted" });
    await seedParticipation(setupValue, "conv-c", { state: "pending" });

    const result = await readParticipations(PARTICIPANT_UID, setupValue.deps);

    expect(result).toMatchObject({ ok: true });
    expect(setupValue.counts).toMatchObject({ owner: 3, teamStatus: 1, membership: 1, teamName: 1 });
  });
});

describe("readParticipations: operational failures (BR-47, BR-53)", () => {
  it("a team read failure → persistence_failed for the whole list", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    setupValue.state.failTeamRead = true;

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("a membership read failure → persistence_failed for the whole list, never an omission", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-pending", { state: "pending" });
    setupValue.state.failMembershipRead = true;

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("a missing team name → persistence_failed for the whole list", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    delete setupValue.teamNames[TEAM_ID];

    expect(await readParticipations(PARTICIPANT_UID, setupValue.deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("an owner read failure → persistence_failed for the whole list", async () => {
    const setupValue = setup();
    await seedParticipation(setupValue, "conv-accepted", { state: "accepted" });
    const failingStore: ConversationStore = {
      ...setupValue.store,
      getOwner: async () => {
        throw new Error("simulated owner read failure");
      },
    };

    expect(await readParticipations(PARTICIPANT_UID, { ...setupValue.deps, store: failingStore })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });
});
