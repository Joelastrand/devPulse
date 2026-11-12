import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SharedEvidenceSnapshot } from "../../development-conversations/domain/shared-evidence-snapshot";

vi.mock("server-only", () => ({}));

import { createFakeConversationStore, type FakeConversationStore } from "../../development-conversations/server/fake-conversation-store";
import { createFakeContentCodec, type FakeContentCodec } from "../../development-conversations/server/fake-content-codec";
import { seedOwnerConversation, OWNER_UID, PARTICIPANT_UID, NOW } from "../../development-conversations/server/owner-read-test-support";
import { conversationContext } from "../../development-conversations/domain/stored-owner-conversation";
import type { ConversationStore } from "../../development-conversations/server/conversation-store-types";
import { ErasureStepFailure } from "./erasure-runner";
import {
  eraseParticipantBinding,
  runParticipantBindingsBatch,
  type BoundConversation,
  type ParticipantBindingCodec,
  type ParticipantBindingDiscovery,
  type ParticipantBindingsDeps,
} from "./participant-bindings-erasure";
import { issueErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";

// TASK-019: an erasure-only cleanup of a conversation OWNED BY SOMEONE ELSE where the erased person is the participant.
// Fixtures are synthetic. The erased person is PARTICIPANT_UID (the participant), the owner is OWNER_UID.
// Discovery is a port; these tests use a discovery stub over the seeded bindings. The production collection-group adapter
// is covered at TASK-038.

const CONVERSATION = "conv-binding-1";
const OTHER_PARTICIPANT = "participant-2";

/**
 * A discovery stub over an explicit list of candidate conversations. It reads each owner document's CURRENT participant
 * field, as the real collection-group query does, so a cleaned binding stops being returned.
 */
function discoveryOver(store: ConversationStore, candidates: BoundConversation[]): ParticipantBindingDiscovery {
  return {
    async listBoundTo(uid, limit) {
      const bound: BoundConversation[] = [];
      for (const candidate of candidates) {
        if (bound.length >= limit) break;
        const raw = await store.getOwner(candidate.ownerUid, candidate.conversationId);
        if (raw !== undefined && raw.participantUid === uid) bound.push(candidate);
      }
      return bound;
    },
  };
}

function deps(
  store: ConversationStore,
  codec: ParticipantBindingCodec,
  discovery: ParticipantBindingDiscovery = discoveryOver(store, []),
): ParticipantBindingsDeps {
  return { store, codec, cleanupCapability: issueErasureOwnerCleanupCapability(), discovery, clock: () => new Date(NOW.getTime()) };
}

function fake(): { store: FakeConversationStore; codec: FakeContentCodec } {
  return { store: createFakeConversationStore(), codec: createFakeContentCodec() };
}

async function seedBound(
  store: FakeConversationStore,
  codec: FakeContentCodec,
  options: { status?: "open" | "completed"; participantNotes?: string; participantUid?: string; state?: "pending" | "accepted"; sharedEvidence?: SharedEvidenceSnapshot[] } = {},
): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION,
    title: "Owner title",
    ownerNotes: "Owner's private notes",
    nextSteps: ["Owner step"],
    participantNotes: options.participantNotes ?? "Participant's private note",
    participant: { uid: options.participantUid ?? PARTICIPANT_UID, state: options.state ?? "accepted" },
    status: options.status ?? "open",
    sharedEvidence: options.sharedEvidence ?? [],
  });
  store.seedRawParticipation(options.participantUid ?? PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
}

/** The stored envelope decoded with the codec, for asserting the preserved content. */
function decodedOf(codec: FakeContentCodec, raw: Record<string, unknown>, conversationId = CONVERSATION) {
  const decoded = codec.decodeContent({
    ciphertext: raw.ciphertext as string,
    iv: raw.iv as string,
    authTag: raw.authTag as string,
    keyVersion: raw.keyVersion as "v2",
    keyId: "k1",
    keyCheck: raw.keyCheck as string,
  }, conversationContext(OWNER_UID, conversationId));
  if (!decoded.ok) throw new Error("stored payload does not decode");
  return decoded.content;
}

async function ownerRaw(store: ConversationStore, conversationId = CONVERSATION): Promise<Record<string, unknown>> {
  const raw = await store.getOwner(OWNER_UID, conversationId);
  if (raw === undefined) throw new Error("owner document missing");
  return raw;
}

const TARGET = { ownerUid: OWNER_UID, conversationId: CONVERSATION };

describe("participant binding cleanup on a conversation owned by someone else (TASK-019)", () => {
  it("cleans an active binding: clears the participant fields, removes the notes, keeps owner content, deletes the index", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec);
    const before = decodedOf(codec, await ownerRaw(store));

    const result = await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID);

    expect(result).toEqual({ ok: true, outcome: "cleaned" });
    const raw = await ownerRaw(store);
    expect(raw).toMatchObject({
      participantUid: null,
      participantMemberRef: null,
      participantState: null,
      participantInvitedAt: null,
      participantAcceptedAt: null,
    });
    const after = decodedOf(codec, raw);
    expect(after.participantNotes).toBe("");
    expect(after.title).toBe(before.title);
    expect(after.ownerNotes).toBe(before.ownerNotes);
    expect(after.nextSteps).toEqual(before.nextSteps);
    expect(after.sharedGoals).toEqual(before.sharedGoals);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
  });

  it("preserves the owner's sharedEvidence exactly through the I-7 re-encryption (E-6)", async () => {
    const { store, codec } = fake();
    const snapshot: SharedEvidenceSnapshot = {
      kind: "achievement",
      title: "Synthetic achievement",
      description: "Synthetic description",
      outcome: null,
      period: { start: "2026-01-01", end: null },
      relationToRole: "within",
      capturedAt: NOW,
    };
    await seedBound(store, codec, { sharedEvidence: [snapshot] });
    const before = decodedOf(codec, await ownerRaw(store));

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "cleaned" });
    const after = decodedOf(codec, await ownerRaw(store));
    expect(after.sharedEvidence).toEqual(before.sharedEvidence);
    expect(after.sharedEvidence).toEqual([snapshot]);
    expect(after.participantNotes).toBe("");
  });

  it("cleans a COMPLETED conversation too, and keeps it completed (the approved erasure-only exception)", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec, { status: "completed" });

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "cleaned" });
    const raw = await ownerRaw(store);
    expect(raw.status).toBe("completed");
    expect(raw.participantUid).toBeNull();
    expect(decodedOf(codec, raw).participantNotes).toBe("");
  });

  it("cleans a binding whose participantNotes are already empty, with the owner content unchanged", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec, { participantNotes: "" });

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "cleaned" });
    expect(decodedOf(codec, await ownerRaw(store)).ownerNotes).toBe("Owner's private notes");
  });

  it("skips an already-cleaned binding (no participant): the owner document is not rewritten, and a leftover index entry is removed", async () => {
    const { store, codec } = fake();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION, title: "Owner title" });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
    const before = await ownerRaw(store);

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "skipped" });
    expect(await ownerRaw(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
  });

  it("skips a stale binding that names another participant: that person's binding and index are untouched", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec, { participantUid: OTHER_PARTICIPANT });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
    const before = await ownerRaw(store);

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "skipped" });
    expect(await ownerRaw(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
    expect(await store.getParticipation(OTHER_PARTICIPANT, CONVERSATION)).toBeDefined();
  });

  it("removes an orphaned index entry whose owner document is gone", async () => {
    const { store, codec } = fake();
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "skipped" });
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
  });

  it("fails closed on an undecryptable payload: nothing is written, the binding stays, and the failure is payload_unreadable", async () => {
    const { store, codec } = fake();
    store.seedRawOwner(OWNER_UID, CONVERSATION, {
      teamId: "team-alpha",
      participantUid: PARTICIPANT_UID,
      participantMemberRef: "0123456789abcdefghjkmnpqrs",
      participantState: "accepted",
      participantInvitedAt: NOW,
      participantAcceptedAt: NOW,
      plannedFor: null,
      status: "open",
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ciphertext: Buffer.from("no-such-handle").toString("base64"),
      iv: "AAAAAAAAAAAAAAAA",
      authTag: "AAAAAAAAAAAAAAAAAAAAAA==",
      keyVersion: "v2", keyId: "k1",
      keyCheck: "A".repeat(43) + "=",
    });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
    const before = await ownerRaw(store);

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({
      ok: false,
      error: "payload_unreadable",
    });
    expect(await ownerRaw(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeDefined();
  });

  it("fails closed on a malformed owner document: payload_unreadable, no write", async () => {
    const { store, codec } = fake();
    store.seedRawOwner(OWNER_UID, CONVERSATION, { junk: true });

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({
      ok: false,
      error: "payload_unreadable",
    });
  });

  it("reports a key outage as store_unavailable, never as malformed data, and writes nothing", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec);
    const before = await ownerRaw(store);
    codec.setKeyFailure("key_unavailable");

    expect(await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({
      ok: false,
      error: "store_unavailable",
    });
    expect(await ownerRaw(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeDefined();
  });

  it("reports a failed re-encryption as store_unavailable, with no partial write of the binding or the index", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec);
    const before = await ownerRaw(store);
    const failingEncoder: ParticipantBindingCodec = { ...codec, encodeContent: () => ({ ok: false, error: "key_unavailable" }) };

    expect(await eraseParticipantBinding(deps(store, failingEncoder), TARGET, PARTICIPANT_UID)).toEqual({
      ok: false,
      error: "store_unavailable",
    });
    expect(await ownerRaw(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeDefined();
  });

  it("leaves no erased uid or memberRef in the owner document after cleanup", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec);

    await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID);

    const serialized = JSON.stringify(await ownerRaw(store));
    expect(serialized).not.toContain(PARTICIPANT_UID);
    expect(serialized).not.toContain("0123456789abcdefghjkmnpqrs");
  });

  it("grants the erased person no access afterwards: no binding, no index entry", async () => {
    const { store, codec } = fake();
    await seedBound(store, codec, { status: "completed" });
    await eraseParticipantBinding(deps(store, codec), TARGET, PARTICIPANT_UID);

    expect((await ownerRaw(store)).participantUid).toBeNull();
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
  });
});

describe("completed-conversation exception boundary (TASK-019)", () => {
  it("is imported only by the account-erasure server, never by a route, a UI file, or a development-conversations module", () => {
    const root = process.cwd();
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
      });
    const importers = [...walk("src"), ...walk("app")]
      .filter((path) => readFileSync(join(root, path), "utf8").includes("participant-bindings-erasure"))
      .filter((path) => !path.endsWith("participant-bindings-erasure.test.ts"))
      .sort();

    // Only the account-erasure server may compose this function. Nothing else may import it, so no ordinary D2 path can
    // reach the completed-conversation exception.
    expect(importers.every((path) => path.startsWith("src/features/account-erasure/server/"))).toBe(true);
  }, 30_000); // a full-repository directory walk; the default 5 s budget is too tight under full-suite load
});

describe("participant bindings step (TASK-019)", () => {
  it("cleans every binding to the erased person across owners, and leaves other participants' bindings untouched", async () => {
    const { store, codec } = fake();
    await seedOwnerConversation(store, codec, {
      conversationId: "conv-a",
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
      participantNotes: "A notes",
    });
    await seedOwnerConversation(store, codec, {
      ownerUid: "owner-9",
      conversationId: "conv-b",
      participant: { uid: PARTICIPANT_UID, state: "pending" },
      participantNotes: "",
    });
    await seedOwnerConversation(store, codec, {
      conversationId: "conv-c",
      participant: { uid: OTHER_PARTICIPANT, state: "accepted" },
      participantNotes: "keep",
    });
    const discovery = discoveryOver(store, [
      { ownerUid: OWNER_UID, conversationId: "conv-a" },
      { ownerUid: "owner-9", conversationId: "conv-b" },
      { ownerUid: OWNER_UID, conversationId: "conv-c" },
    ]);

    let finished = false;
    for (let batch = 0; batch < 20 && !finished; batch += 1) {
      finished = (await runParticipantBindingsBatch(deps(store, codec, discovery), PARTICIPANT_UID, 100)) === "done";
    }

    expect(finished).toBe(true);
    expect(await discovery.listBoundTo(PARTICIPANT_UID, 10)).toEqual([]);
    expect(await discovery.listBoundTo(OTHER_PARTICIPANT, 10)).toEqual([{ ownerUid: OWNER_UID, conversationId: "conv-c" }]);
    const other = await ownerRaw(store, "conv-c");
    expect(other.participantUid).toBe(OTHER_PARTICIPANT);
    expect(decodedOf(codec, other, "conv-c").participantNotes).toBe("keep");
  });

  it("reports done when no binding to the erased person remains", async () => {
    const { store, codec } = fake();
    expect(await runParticipantBindingsBatch(deps(store, codec), PARTICIPANT_UID, 100)).toBe("done");
  });

  it("raises payload_unreadable from the step so the runner records a resumable failure", async () => {
    const { store, codec } = fake();
    store.seedRawOwner(OWNER_UID, CONVERSATION, { junk: true });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
    // A junk owner document has no readable participant field, so the discovery is given the candidate directly.
    const discovery: ParticipantBindingDiscovery = {
      listBoundTo: async () => [{ ownerUid: OWNER_UID, conversationId: CONVERSATION }],
    };

    await expect(runParticipantBindingsBatch(deps(store, codec, discovery), PARTICIPANT_UID, 100)).rejects.toMatchObject({
      code: "payload_unreadable",
    });
  });

  it("fails closed on a listed id that is not a valid conversation id, so the step cannot loop", async () => {
    const { store, codec } = fake();
    const discovery: ParticipantBindingDiscovery = { listBoundTo: async () => [{ ownerUid: OWNER_UID, conversationId: "bad id!" }] };

    await expect(runParticipantBindingsBatch(deps(store, codec, discovery), PARTICIPANT_UID, 100)).rejects.toMatchObject({
      code: "verification_failed",
    });
  });

  it("refuses a zero write budget as a programming error", async () => {
    const { store, codec } = fake();
    await expect(runParticipantBindingsBatch(deps(store, codec), PARTICIPANT_UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });
});
