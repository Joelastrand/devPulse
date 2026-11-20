import { describe, expect, it } from "vitest";
import { CONVERSATION_LIMIT } from "../domain/conversation-constants";
import { OWNER_DOCUMENT_KEYS } from "./conversation-store-types";
import { createConversation, type CreateConversationDeps, type CreateConversationInput } from "./create-conversation";
import { createFakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import type { FakeTeamEligibilityState } from "./fake-team-eligibility";
import { issueErasureOwnerCleanupCapability } from "./erasure-owner-cleanup-capability";
import type { FakeConversationStore } from "./fake-conversation-store";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe as describeSeed, expect as expectSeed, it as itSeed, vi } from "vitest";
import { ConversationSeedConflictError, seedOwnerConversationCreateOnly } from "./create-conversation";
import { createFakeConversationStore as createSeedStore } from "./fake-conversation-store";
import type { ConversationContent } from "../domain/content-payload";

const SEED_OWNER = "seed-owner-1";
const SEED_ID = "demo-conversation-01";
const SEED_CONTENT: ConversationContent = {
  title: "Syntetisk samtale for test",
  ownerNotes: "Syntetiske notater for test",
  nextSteps: ["Første syntetiske steg"],
  participantNotes: "",
  sharedGoals: [],
  sharedEvidence: [],
};
const SEED_STAMPS = { createdAt: new Date("2026-03-01T00:00:00.000Z"), updatedAt: new Date("2026-03-02T00:00:00.000Z") };
const seedInput = (store: FakeConversationStore, content: ConversationContent = SEED_CONTENT) => ({
  store,
  ownerUid: SEED_OWNER,
  conversationId: SEED_ID,
  content,
  plannedFor: "2026-04-01",
  stamps: SEED_STAMPS,
});

describeSeed("owner conversation — trusted create-only seed (feature-owned)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  itSeed("creates an owner-only conversation, sealed and readable only under its own owner AAD, and writes no participation index", async () => {
    const store = createSeedStore();
    await expectSeed(seedOwnerConversationCreateOnly(seedInput(store))).resolves.toBe("create");
    const stored = await store.runOwnerTransaction(SEED_OWNER, (tx) => tx.getOwner(SEED_OWNER, SEED_ID));
    expectSeed(stored).toBeDefined();
    expectSeed(stored).toMatchObject({ status: "open", participantUid: null, plannedFor: "2026-04-01" });
    const participation = await store.runTransaction((tx) => tx.getParticipation(SEED_OWNER, SEED_ID));
    expectSeed(participation).toBeUndefined();
  });

  itSeed("never stores the title or notes as plaintext", async () => {
    const store = createSeedStore();
    await seedOwnerConversationCreateOnly(seedInput(store));
    const stored = await store.runOwnerTransaction(SEED_OWNER, (tx) => tx.getOwner(SEED_OWNER, SEED_ID));
    const serialized = JSON.stringify(stored);
    expectSeed(serialized).not.toContain("Syntetisk samtale for test");
    expectSeed(serialized).not.toContain("Syntetiske notater for test");
    expectSeed(stored).not.toHaveProperty("title");
  });

  itSeed("skips an identical existing conversation without writing", async () => {
    const store = createSeedStore();
    await seedOwnerConversationCreateOnly(seedInput(store));
    const before = JSON.stringify(await store.runOwnerTransaction(SEED_OWNER, (tx) => tx.getOwner(SEED_OWNER, SEED_ID)));
    await expectSeed(seedOwnerConversationCreateOnly(seedInput(store))).resolves.toBe("skip");
    expectSeed(JSON.stringify(await store.runOwnerTransaction(SEED_OWNER, (tx) => tx.getOwner(SEED_OWNER, SEED_ID)))).toBe(before);
  });

  itSeed("rejects a conflicting existing conversation without overwriting it", async () => {
    const store = createSeedStore();
    await seedOwnerConversationCreateOnly(seedInput(store));
    const before = JSON.stringify(await store.runOwnerTransaction(SEED_OWNER, (tx) => tx.getOwner(SEED_OWNER, SEED_ID)));
    await expectSeed(
      seedOwnerConversationCreateOnly(seedInput(store, { ...SEED_CONTENT, title: "Annen tittel for test" })),
    ).rejects.toBeInstanceOf(ConversationSeedConflictError);
    expectSeed(JSON.stringify(await store.runOwnerTransaction(SEED_OWNER, (tx) => tx.getOwner(SEED_OWNER, SEED_ID)))).toBe(before);
  });

  itSeed("treats the same fixture id under another owner as a separate, create-only record (ownership is part of the path)", async () => {
    const store = createSeedStore();
    await seedOwnerConversationCreateOnly(seedInput(store));
    // Another owner has no document at this id, so a seed there creates a fresh, separately sealed record.
    await expectSeed(seedOwnerConversationCreateOnly({ ...seedInput(store), ownerUid: "seed-owner-2" })).resolves.toBe("create");
  });

  itSeed("is refused by the erasure fence without writing", async () => {
    const store = createSeedStore({ erasingUids: [SEED_OWNER] });
    await expectSeed(seedOwnerConversationCreateOnly(seedInput(store))).rejects.toThrow();
    // Test-only unfenced read: the refused seed must have left no document behind.
    const stored = await store.runTransaction((tx) => tx.getOwner(SEED_OWNER, SEED_ID));
    expectSeed(stored).toBeUndefined();
  });
});

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

function setup(options: { teams?: FakeTeamEligibilityState; store?: FakeConversationStore } = {}) {
  const store = options.store ?? createFakeConversationStore({ generateId: () => "conv-1" });
  const codec = createFakeContentCodec();
  const deps: CreateConversationDeps = {
    store,
    codec,
    clock: () => new Date(NOW.getTime()),
  };
  return { store, codec, deps };
}

describe("createConversation: no team (A2.1)", () => {
  it("creates an open conversation without a team, with no team read", async () => {
    const { store, deps } = setup();

    const result = await createConversation(OWNER_UID, { title: TITLE }, deps);

    expect(result).toEqual({ ok: true, conversationId: "conv-1" });
    expect(await store.countOwner(OWNER_UID)).toBe(1);
  });

  it("ignores a supplied teamId: it is never read, validated or stored", async () => {
    const { store, deps } = setup({ teams: teamState({ failTeamRead: true }) });

    const result = await createConversation(OWNER_UID, { title: TITLE, teamId: "team/alpha" } as unknown as CreateConversationInput, deps);

    expect(result).toEqual({ ok: true, conversationId: "conv-1" });
    expect(await store.getOwner(OWNER_UID, "conv-1")).not.toHaveProperty("teamId");
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
      await store.runErasureCleanupTransaction(issueErasureOwnerCleanupCapability(), async (tx) => {
        tx.createOwner(OWNER_UID, `seed-${i}`, {
          participantUid: null,
          participantBindings: null,
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
          keyVersion: "v2", keyId: "k1",
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
    const failing: FakeConversationStore = {
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
      { title: TITLE, plannedFor: "2026-11-01" },
      deps,
    );
    expect(result.ok).toBe(true);

    const stored = await store.getOwner(OWNER_UID, "conv-1");
    expect(stored).toBeDefined();
    expect(Object.keys(stored ?? {}).sort()).toEqual([...OWNER_DOCUMENT_KEYS].sort());
    expect(stored).toMatchObject({
      status: "open",
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
    const failingWrite: FakeConversationStore = {
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
