import { describe, expect, it } from "vitest";
import { CONVERSATION_LIMIT } from "../domain/conversation-constants";
import { OWNER_DOCUMENT_KEYS, type ConversationStore } from "./conversation-store-types";
import { createConversation, type CreateConversationDeps } from "./create-conversation";
import { createFakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";

const OWNER_UID = "owner-1";
const OTHER_UID = "owner-2";
const TEAM_ID = "team-alpha";
const DISABLED_TEAM_ID = "team-disabled";
const MEMBER_REF = "0123456789abcdefghjkmnpqrs";
const NOW = new Date("2026-10-17T09:30:00.000Z");
const TITLE = "Plan the Q4 mentoring rota";

function membershipDoc(uid: string, teamId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date(0), memberRef: MEMBER_REF, ...overrides };
}

function teamState(overrides: Partial<FakeTeamEligibilityState> = {}): FakeTeamEligibilityState {
  return {
    teamStatus: { [TEAM_ID]: "active", [DISABLED_TEAM_ID]: "disabled" },
    memberships: {
      [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc(OWNER_UID, TEAM_ID),
      [`${OWNER_UID}__${DISABLED_TEAM_ID}`]: membershipDoc(OWNER_UID, DISABLED_TEAM_ID),
    },
    ...overrides,
  };
}

function setup(options: { teams?: FakeTeamEligibilityState; store?: ConversationStore } = {}) {
  const store = options.store ?? createFakeConversationStore({ generateId: () => "conv-1" });
  const codec = createFakeContentCodec();
  const deps: CreateConversationDeps = {
    store,
    codec,
    teamReader: createFakeTeamEligibilityReader(options.teams ?? teamState()),
    clock: () => new Date(NOW.getTime()),
  };
  return { store, codec, deps };
}

describe("createConversation: team link (BR-2, BR-3, BR-9)", () => {
  it("creates an open conversation without a team", async () => {
    const { store, deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE }, deps);

    expect(result).toEqual({ ok: true, conversationId: "conv-1" });
    expect(await store.countOwner(OWNER_UID)).toBe(1);
  });

  it("creates the conversation when the owner has an active membership of the team", async () => {
    const { deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: TEAM_ID }, deps);

    expect(result.ok).toBe(true);
  });

  it("rejects a team the owner is not a member of, as invalid_input on teamId", async () => {
    const { store, deps } = setup({ teams: teamState({ memberships: {} }) });

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: TEAM_ID }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "teamId" });
    expect(await store.countOwner(OWNER_UID)).toBe(0);
  });

  it("rejects a non-member owner regardless of any admin status, since the seam never reads one", async () => {
    const { deps } = setup({
      teams: teamState({ memberships: { [`${OTHER_UID}__${TEAM_ID}`]: membershipDoc(OTHER_UID, TEAM_ID, { role: "admin" }) } }),
    });

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: TEAM_ID }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "teamId" });
  });

  it("accepts a lead only as an ordinary active member, with no role-based bypass", async () => {
    const { deps } = setup({
      teams: teamState({ memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc(OWNER_UID, TEAM_ID, { role: "lead" }) } }),
    });

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: TEAM_ID }, deps);

    expect(result.ok).toBe(true);
  });

  it("rejects a disabled team as invalid_input on teamId", async () => {
    const { deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: DISABLED_TEAM_ID }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "teamId" });
  });

  it("maps a team read failure to persistence_failed, never to invalid_input", async () => {
    const { deps } = setup({ teams: teamState({ failTeamRead: true }) });

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: TEAM_ID }, deps);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("rejects a team id that is not a single path segment, before any read", async () => {
    const { deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: "team/alpha" }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "teamId" });
  });
});

describe("createConversation: input and caps (BR-37, BR-39)", () => {
  it("rejects an invalid title as invalid_input on title, with nothing written", async () => {
    const { store, deps } = setup();

    const result = await createConversation(OWNER_UID, { title: "   " }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "title" });
    expect(await store.countOwner(OWNER_UID)).toBe(0);
  });

  it("rejects an invalid plannedFor as invalid_input on plannedFor", async () => {
    const { deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE, plannedFor: "2026-02-30" }, deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "plannedFor" });
  });

  it("rejects creation at the owner cap with conversation_limit and writes nothing more", async () => {
    const { store, deps } = setup();
    for (let i = 0; i < CONVERSATION_LIMIT; i += 1) {
      await store.runTransaction(async (tx) => {
        tx.createOwner(OWNER_UID, `seed-${i}`, {
          teamId: null,
          participantUid: null,
          participantMemberRef: null,
          participantState: null,
          participantInvitedAt: null,
          participantAcceptedAt: null,
          plannedFor: null,
          status: "open",
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          ciphertext: "c",
          iv: "i",
          authTag: "t",
          keyVersion: "v1",
          keyCheck: "k",
        });
      });
    }

    const result = await createConversation(OWNER_UID, { title: TITLE }, deps);

    expect(result).toEqual({ ok: false, error: "conversation_limit" });
    expect(await store.countOwner(OWNER_UID)).toBe(CONVERSATION_LIMIT);
  });

  it("maps a count failure to persistence_failed and writes nothing", async () => {
    const base = createFakeConversationStore({ generateId: () => "conv-1" });
    const failing: ConversationStore = {
      ...base,
      async countOwner() {
        throw new Error("simulated count failure with a document path");
      },
    };
    const { deps } = setup({ store: failing });

    const result = await createConversation(OWNER_UID, { title: TITLE }, deps);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await base.countOwner(OWNER_UID)).toBe(0);
  });
});

describe("createConversation: key handling (BR-53)", () => {
  it("returns persistence_failed on a key outage before any write", async () => {
    const { store, codec, deps } = setup();
    codec.setKeyFailure("key_unavailable");

    const result = await createConversation(OWNER_UID, { title: TITLE }, deps);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await store.countOwner(OWNER_UID)).toBe(0);
  });
});

describe("createConversation: stored shape (BR-51, BR-52)", () => {
  it("writes the canonical owner document with status open, empty sections and no plaintext", async () => {
    const { store, deps } = setup();

    const result = await createConversation(
      OWNER_UID,
      { title: TITLE, plannedFor: "2026-11-01", teamId: TEAM_ID },
      deps,
    );
    expect(result.ok).toBe(true);

    const stored = await store.getOwner(OWNER_UID, "conv-1");
    expect(stored).toBeDefined();
    expect(Object.keys(stored ?? {}).sort()).toEqual([...OWNER_DOCUMENT_KEYS].sort());
    expect(stored).toMatchObject({
      status: "open",
      teamId: TEAM_ID,
      plannedFor: "2026-11-01",
      participantUid: null,
      participantState: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(JSON.stringify(stored)).not.toContain(TITLE);
  });

  it("maps a failed write transaction to persistence_failed and leaves no owner document", async () => {
    const base = createFakeConversationStore({ generateId: () => "conv-1" });
    const failingWrite: ConversationStore = {
      ...base,
      runTransaction() {
        return Promise.reject(new Error("simulated write failure with a document path"));
      },
    };
    const { deps } = setup({ store: failingWrite });

    const result = await createConversation(OWNER_UID, { title: TITLE }, deps);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await base.getOwner(OWNER_UID, "conv-1")).toBeUndefined();
  });

  it("uses the verified owner uid and ignores any ownerUid supplied in the input", async () => {
    const { store, deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE, ownerUid: OTHER_UID } as never, deps);

    expect(result.ok).toBe(true);
    expect(await store.countOwner(OWNER_UID)).toBe(1);
    expect(await store.countOwner(OTHER_UID)).toBe(0);
  });
});
