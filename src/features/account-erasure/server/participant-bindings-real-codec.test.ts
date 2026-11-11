import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as contentCodec from "../../development-conversations/server/content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "../../development-conversations/server/fake-conversation-store";
import { issueErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";
import type { ConversationContent } from "../../development-conversations/domain/content-payload";
import type { SharedEvidenceSnapshot } from "../../development-conversations/domain/shared-evidence-snapshot";
import { NOW, OWNER_UID, PARTICIPANT_UID } from "../../development-conversations/server/owner-read-test-support";
import { eraseParticipantBinding, type ParticipantBindingCodec, type ParticipantBindingsDeps } from "./participant-bindings-erasure";

/**
 * E-6 / I-7 with the REAL encryption helper (content-codec and the key accessor), not the fake codec. Synthetic data only
 * (invariant 15). The key is stubbed per test; nothing reads a real key.
 */

const CONVERSATION = "conv-real-codec-1";
const TARGET = { ownerUid: OWNER_UID, conversationId: CONVERSATION };
const PRIVATE_NOTE = "Synthetic participant note";
const EVIDENCE_TITLE = "Synthetic achievement for re-encryption";

const EVIDENCE: SharedEvidenceSnapshot = {
  kind: "achievement",
  title: EVIDENCE_TITLE,
  description: "Synthetic description",
  outcome: "Synthetic outcome",
  period: { start: "2026-01-01", end: "2026-06-30" },
  relationToRole: "beyond",
  capturedAt: NOW,
};

/** The real helper, wired as the erasure codec. Only the encode seam can be replaced, to model a failed re-encryption. */
const realCodec: ParticipantBindingCodec = {
  probeKey: contentCodec.probeKey,
  decryptForClassification: contentCodec.decryptForClassification,
  encodeContent: contentCodec.encodeContent,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function deps(store: FakeConversationStore, codec: ParticipantBindingCodec): ParticipantBindingsDeps {
  return {
    store,
    codec,
    cleanupCapability: issueErasureOwnerCleanupCapability(),
    discovery: { listBoundTo: async () => [] },
    clock: () => new Date(NOW.getTime()),
  };
}

/** Seeds a bound conversation through the real encoder and the store's transactional write, as production does. */
async function seedBound(store: FakeConversationStore): Promise<void> {
  const content: ConversationContent = {
    title: "Synthetic owner title",
    ownerNotes: "Synthetic owner notes",
    nextSteps: ["Synthetic next step"],
    participantNotes: PRIVATE_NOTE,
    sharedGoals: [],
    sharedEvidence: [EVIDENCE],
  };
  const encoded = contentCodec.encodeContent(content);
  if (!encoded.ok) throw new Error("fixture key unavailable");
  await store.runOwnerTransaction(OWNER_UID, async (tx) => {
    tx.createOwner(OWNER_UID, CONVERSATION, {
      teamId: "synthetic-team",
      participantUid: PARTICIPANT_UID,
      participantMemberRef: "synthetic-member-ref",
      participantState: "accepted",
      participantInvitedAt: NOW,
      participantAcceptedAt: NOW,
      plannedFor: null,
      status: "open",
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...encoded.content,
    });
  });
  store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
}

async function rawOwner(store: FakeConversationStore): Promise<Record<string, unknown>> {
  const raw = await store.getOwner(OWNER_UID, CONVERSATION);
  if (raw === undefined) throw new Error("owner document missing");
  return raw;
}

function decodeRaw(raw: Record<string, unknown>): ConversationContent {
  const decoded = contentCodec.decodeContent({
    ciphertext: raw.ciphertext as string,
    iv: raw.iv as string,
    authTag: raw.authTag as string,
    keyVersion: raw.keyVersion as "v1",
    keyCheck: raw.keyCheck as string,
  } as Parameters<typeof contentCodec.decodeContent>[0]);
  if (!decoded.ok) throw new Error(`stored payload does not decode: ${decoded.error}`);
  return decoded.content;
}

describe("I-7 participant binding re-encryption with the real encryption helper (E-6)", () => {
  it("re-encrypts under the current key, preserves sharedEvidence exactly, and clears only the participant note", async () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const store = createFakeConversationStore();
    await seedBound(store);
    const before = await rawOwner(store);
    const beforeContent = decodeRaw(before);

    expect(await eraseParticipantBinding(deps(store, realCodec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "cleaned" });

    const after = await rawOwner(store);
    expect(after.ciphertext).not.toBe(before.ciphertext);
    const afterContent = decodeRaw(after);
    expect(afterContent.sharedEvidence).toEqual(beforeContent.sharedEvidence);
    expect(afterContent.sharedEvidence).toEqual([EVIDENCE]);
    expect(afterContent.participantNotes).toBe("");
    expect(afterContent.title).toBe(beforeContent.title);
    expect(afterContent.ownerNotes).toBe(beforeContent.ownerNotes);
    expect(afterContent.nextSteps).toEqual(beforeContent.nextSteps);
    expect(after.participantUid).toBeNull();
    expect(JSON.stringify(after)).not.toContain(EVIDENCE_TITLE);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
  });

  it("reports a failed re-encryption as store_unavailable and writes nothing (no partial write, no index deletion)", async () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const store = createFakeConversationStore();
    await seedBound(store);
    const before = await rawOwner(store);
    const failingEncode: ParticipantBindingCodec = {
      ...realCodec,
      encodeContent: () => ({ ok: false, error: "key_unavailable" }),
    };

    expect(await eraseParticipantBinding(deps(store, failingEncode), TARGET, PARTICIPANT_UID)).toEqual({
      ok: false,
      error: "store_unavailable",
    });

    expect(await rawOwner(store)).toEqual(before);
    expect(decodeRaw(await rawOwner(store)).sharedEvidence).toEqual([EVIDENCE]);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeDefined();
  });

  it("reports a throwing re-encryption as store_unavailable and writes nothing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const store = createFakeConversationStore();
    await seedBound(store);
    const before = await rawOwner(store);
    const throwingEncode: ParticipantBindingCodec = {
      ...realCodec,
      encodeContent: () => {
        throw new Error("synthetic encrypt failure");
      },
    };

    expect(await eraseParticipantBinding(deps(store, throwingEncode), TARGET, PARTICIPANT_UID)).toEqual({
      ok: false,
      error: "store_unavailable",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeDefined();
  });

  it("refuses a payload written under another key with no write, and never reports the key or ciphertext", async () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const store = createFakeConversationStore();
    await seedBound(store);
    const before = await rawOwner(store);

    // The current key changes after the document was written: the stored keyCheck no longer matches (key mismatch).
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const result = await eraseParticipantBinding(deps(store, realCodec), TARGET, PARTICIPANT_UID);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|keyCheck|authTag|iv/);
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeDefined();
  });
});
