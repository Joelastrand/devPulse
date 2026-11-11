import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/encryption/encryption";
import type { ConversationContent } from "../domain/content-payload";
import type { SharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import { decodeContent, encodeContent, probeKey, type EncryptedContent } from "./content-codec";
import { classifyOwnerDocument } from "./owner-read";
import { createFakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import { OWNER_UID, NOW, seedOwnerConversation } from "./owner-read-test-support";

/**
 * Real AES-256-GCM round trip for the conversation payload (SPEC BR-51 v1 and v2, Amendment C2; SECURITY-REVIEW N-E9 to N-E12).
 * These tests use the production codec and the production helper with a random test key. No fake crypto is involved.
 * All values are synthetic (invariant 15).
 */

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);

const CAPTURED = new Date("2026-10-02T08:30:00.000Z");
const GOAL: SharedGoalSnapshot = {
  goalTitle: "Synthetic goal med æøå",
  treeId: null,
  targetDate: "2026-12-31",
  status: "active",
  capturedAt: CAPTURED,
};
const RESPONSIBILITY: SharedEvidenceSnapshot = {
  kind: "responsibility",
  title: "Synthetic ansvar med æøå 🚀",
  description: "Synthetic beskrivelse",
  status: "active",
  relationToRole: "within",
  period: { start: "2026-01-01", end: null },
  capturedAt: CAPTURED,
};
const ACHIEVEMENT: SharedEvidenceSnapshot = {
  kind: "achievement",
  title: "Synthetic prestasjon",
  description: "Synthetic achievement description",
  outcome: "Synthetic outcome",
  period: { start: null, end: "2026-09-30" },
  relationToRole: "beyond",
  capturedAt: CAPTURED,
};

const CONTENT_V2: ConversationContent = {
  title: "Synthetic tittel",
  ownerNotes: "Synthetic owner note",
  nextSteps: ["Synthetic step"],
  participantNotes: "Synthetic participant note",
  sharedGoals: [GOAL],
  sharedEvidence: [RESPONSIBILITY, ACHIEVEMENT],
};

/** The v1 key set, with the same values, for a legacy document. */
function v1Plaintext(): string {
  return JSON.stringify({
    title: CONTENT_V2.title,
    ownerNotes: CONTENT_V2.ownerNotes,
    nextSteps: CONTENT_V2.nextSteps,
    participantNotes: CONTENT_V2.participantNotes,
    sharedGoals: [{ goalTitle: GOAL.goalTitle, treeId: null, targetDate: GOAL.targetDate, status: GOAL.status, capturedAt: CAPTURED.toISOString() }],
  });
}

function useKey(bytes: Buffer): void {
  vi.stubEnv("ENCRYPTION_KEY", bytes.toString("base64"));
}

/** Writes a legacy v1 document: the envelope of a real encode, with its ciphertext replaced by a v1 plaintext. */
function encodeV1Envelope(): EncryptedContent {
  const current = encodeContent({ ...CONTENT_V2, sharedEvidence: [] });
  if (!current.ok) throw new Error("fixture key unavailable");
  const legacy = encrypt(v1Plaintext());
  return { ...current.content, ciphertext: legacy.ciphertext, iv: legacy.iv, authTag: legacy.authTag };
}

/** Encrypts an arbitrary JSON object under the configured key, so a test can craft a malformed authenticated payload. */
function encodeRawPayload(payload: unknown): EncryptedContent {
  const current = encodeContent({ ...CONTENT_V2, sharedEvidence: [] });
  if (!current.ok) throw new Error("fixture key unavailable");
  const crafted = encrypt(JSON.stringify(payload));
  return { ...current.content, ciphertext: crafted.ciphertext, iv: crafted.iv, authTag: crafted.authTag };
}

beforeEach(() => {
  useKey(KEY_A);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("real AES-GCM round trip, payload v2 (Amendment C2)", () => {
  it("decrypts a v2 payload back to the same content, including sharedEvidence and Norwegian text", () => {
    const encoded = encodeContent(CONTENT_V2);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = decodeContent(encoded.content);
    expect(decoded).toEqual({ ok: true, content: CONTENT_V2 });
  });

  it("writes an empty sharedEvidence as v2, and reads it back as an empty list", () => {
    const encoded = encodeContent({ ...CONTENT_V2, sharedEvidence: [] });
    if (!encoded.ok) throw new Error("fixture key unavailable");
    expect(decodeContent(encoded.content)).toEqual({ ok: true, content: { ...CONTENT_V2, sharedEvidence: [] } });
  });

  it("stores exactly the envelope keys and no plaintext title, notes, goal or evidence text", () => {
    const encoded = encodeContent(CONTENT_V2);
    if (!encoded.ok) throw new Error("fixture key unavailable");

    expect(Object.keys(encoded.content).sort()).toEqual(["authTag", "ciphertext", "iv", "keyCheck", "keyVersion"]);
    const stored = JSON.stringify(encoded.content);
    for (const plaintext of [CONTENT_V2.title, RESPONSIBILITY.title, ACHIEVEMENT.title, ACHIEVEMENT.outcome ?? "", GOAL.goalTitle, "Synthetic step"]) {
      expect(stored).not.toContain(plaintext);
    }
    expect(stored).not.toContain("sharedEvidence");
  });
});

describe("real AES-GCM round trip, payload v1 (read compatibility, N-E10)", () => {
  it("decrypts a v1 document, reads sharedEvidence as an empty list, and keeps sharedGoals unchanged", () => {
    const decoded = decodeContent(encodeV1Envelope());
    expect(decoded).toEqual({
      ok: true,
      content: { ...CONTENT_V2, sharedEvidence: [], sharedGoals: [{ ...GOAL }] },
    });
  });

  it("re-encodes a v1 read as v2 with sharedEvidence present and the goals unchanged (N-E12 round trip)", () => {
    const first = decodeContent(encodeV1Envelope());
    if (!first.ok) throw new Error("fixture unreadable");
    const rewritten = encodeContent(first.content);
    if (!rewritten.ok) throw new Error("fixture key unavailable");

    const second = decodeContent(rewritten.content);
    expect(second).toEqual({ ok: true, content: first.content });
    expect(second.ok && second.content.sharedGoals).toEqual([GOAL]);
  });
});

describe("wrong, missing and invalid keys fail safely (C-5)", () => {
  it("returns key_mismatch for a wrong key, with the code only and no ciphertext or key identifier", () => {
    const encoded = encodeContent(CONTENT_V2);
    if (!encoded.ok) throw new Error("fixture key unavailable");

    useKey(KEY_B);
    const result = decodeContent(encoded.content);
    expect(result).toEqual({ ok: false, error: "key_mismatch" });
    expect(JSON.stringify(result)).not.toContain(encoded.content.ciphertext);
    expect(JSON.stringify(result)).not.toContain(encoded.content.keyCheck);
  });

  it("returns key_unavailable for a missing key on decode, never a malformed or unauthenticated result", () => {
    const encoded = encodeContent(CONTENT_V2);
    if (!encoded.ok) throw new Error("fixture key unavailable");

    vi.stubEnv("ENCRYPTION_KEY", "");
    delete process.env.ENCRYPTION_KEY;
    expect(decodeContent(encoded.content)).toEqual({ ok: false, error: "key_unavailable" });
  });

  it("returns key_unavailable when encoding without a key, and the probe fails before any write", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(encodeContent(CONTENT_V2)).toEqual({ ok: false, error: "key_unavailable" });
    expect(probeKey()).toEqual({ ok: false, error: "key_unavailable" });
  });

  it("returns key_unavailable for an invalid key length, with no key detail in the result", () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    const result = encodeContent(CONTENT_V2);
    expect(result).toEqual({ ok: false, error: "key_unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/16|bytes|length/);
  });
});

describe("malformed decrypted payloads (N-E11): authenticated, so never repaired", () => {
  it("rejects an extra payload key as malformed_payload", () => {
    const payload = {
      title: "Synthetic",
      ownerNotes: "",
      nextSteps: [],
      participantNotes: "",
      sharedGoals: [],
      sharedEvidence: [],
      extra: "unexpected",
    };
    expect(decodeContent(encodeRawPayload(payload))).toEqual({ ok: false, error: "malformed_payload" });
  });

  it("rejects sharedEvidence: null as malformed_payload, and never reads it as empty", () => {
    const payload = {
      title: "Synthetic",
      ownerNotes: "",
      nextSteps: [],
      participantNotes: "",
      sharedGoals: [],
      sharedEvidence: null,
    };
    expect(decodeContent(encodeRawPayload(payload))).toEqual({ ok: false, error: "malformed_payload" });
  });

  it("rejects a snapshot that carries a source id as malformed_payload, and never repairs it", () => {
    const payload = {
      title: "Synthetic",
      ownerNotes: "",
      nextSteps: [],
      participantNotes: "",
      sharedGoals: [],
      sharedEvidence: [{ ...RESPONSIBILITY, period: { start: null, end: null }, capturedAt: CAPTURED.toISOString(), id: "resp-1" }],
    };
    expect(decodeContent(encodeRawPayload(payload))).toEqual({ ok: false, error: "malformed_payload" });
  });
});

describe("a plain sharedEvidence field is never a valid stored document (N-E9)", () => {
  it("classifies an owner document with a plain sharedEvidence key as not valid", async () => {
    const store = createFakeConversationStore();
    const codec = createFakeContentCodec();
    await seedOwnerConversation(store, codec, { conversationId: "conv-1" });
    const raw = await store.getOwner(OWNER_UID, "conv-1");
    if (raw === undefined) throw new Error("fixture missing");

    const withPlainField = { ...raw, sharedEvidence: [{ kind: "responsibility", title: "Synthetic plain" }] };
    expect(classifyOwnerDocument(withPlainField, codec).kind).not.toBe("valid");
    expect(classifyOwnerDocument(raw, codec).kind).toBe("valid");
  });
});
