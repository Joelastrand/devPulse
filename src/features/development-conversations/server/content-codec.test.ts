import { createCipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationContent } from "../domain/content-payload";
import {
  classifyStoredConversation,
  conversationContext,
  STORED_KEY_ID,
  STORED_KEY_VERSION,
  STORED_OWNER_PLAIN_KEYS,
  type StoredEnvelope,
} from "../domain/stored-owner-conversation";
import {
  OWNER_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_DTO_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  PENDING_DTO_KEYS,
  RECOVERY_ITEM_KEYS,
  SHARED_GOAL_DTO_KEYS,
} from "../domain/dto-keys";
import {
  ContentKeyError,
  decodeContent,
  decryptForClassification,
  encodeContent,
  probeKey,
} from "./content-codec";

/*
 * Synthetic test data only (invariant 15). Every key is generated in the test. The "independent" helpers below recompute
 * the record subkey (HKDF-SHA-256), the key check (HMAC-SHA-256) and AES-256-GCM with `node:crypto` directly, so the codec
 * is checked against an outside reference and not against itself.
 */

const OWNER_UID = "synthetic-owner";
const CONVERSATION_ID = "synthetic-conversation";
const CTX = conversationContext(OWNER_UID, CONVERSATION_ID);

const CONTENT: ConversationContent = {
  title: "Syntetisk samtale om flyt",
  ownerNotes: "Syntetiske notater: å, ø, æ og 🙂",
  nextSteps: ["Synthetic next step"],
  participantNotes: "Syntetiske deltakernotater",
  sharedGoals: [
    {
      goalTitle: "Synthetic goal",
      treeId: null,
      targetDate: null,
      status: "active",
      capturedAt: new Date("2026-10-01T08:00:00.000Z"),
    },
  ],
  sharedEvidence: [],
};

/** The record subkey, derived as `record-envelope.ts` derives it for key id `k1`. */
function independentSubkey(keyBytes: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from(`devpulse/record/v2/${STORED_KEY_ID}`, "utf8"), 32));
}

function independentKeyCheck(keyBytes: Buffer): string {
  return createHmac("sha256", independentSubkey(keyBytes))
    .update(`devpulse/record/v2/key-check/${STORED_KEY_ID}`, "utf8")
    .digest("base64");
}

/** AES-256-GCM under the record subkey with the record context as AAD. Produces bytes the codec must still classify. */
function sealRawBytes(plaintext: Buffer, keyBytes: Buffer, context: string = CTX): StoredEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", independentSubkey(keyBytes), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: STORED_KEY_VERSION,
    keyId: STORED_KEY_ID,
    keyCheck: independentKeyCheck(keyBytes),
  };
}

function tamper(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = bytes[0] ^ 0xff;
  return bytes.toString("base64");
}

function encodeOrThrow(content: ConversationContent, context: string = CTX): StoredEnvelope {
  const result = encodeContent(content, context);
  if (!result.ok) {
    throw new Error("expected encodeContent to succeed");
  }
  return result.content;
}

function ownerDocFor(envelope: StoredEnvelope): Record<string, unknown> {
  return {
    teamId: "synthetic-team",
    participantUid: null,
    participantMemberRef: null,
    participantState: null,
    participantInvitedAt: null,
    participantAcceptedAt: null,
    plannedFor: null,
    status: "open",
    completedAt: null,
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    updatedAt: new Date("2026-10-02T08:00:00.000Z"),
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.authTag,
    keyVersion: envelope.keyVersion,
    keyId: envelope.keyId,
    keyCheck: envelope.keyCheck,
  };
}

describe("content codec (record envelope v2)", () => {
  let keyBytes: Buffer;

  beforeEach(() => {
    keyBytes = randomBytes(32);
    vi.stubEnv("ENCRYPTION_KEY", keyBytes.toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("round trip and stored shape", () => {
    it("decodes an encoded payload back to the same content, including Norwegian letters and emoji", () => {
      const result = decodeContent(encodeOrThrow(CONTENT), CTX);
      expect(result).toEqual({ ok: true, content: expect.objectContaining({ title: CONTENT.title, ownerNotes: CONTENT.ownerNotes }) });
    });

    it("stores exactly the v2 envelope keys: ciphertext, iv, authTag, keyVersion, keyId and keyCheck", () => {
      expect(Object.keys(encodeOrThrow(CONTENT)).sort()).toEqual(
        ["authTag", "ciphertext", "iv", "keyCheck", "keyId", "keyVersion"],
      );
    });

    it("contains no readable plaintext of the title, notes or goal title in the stored object", () => {
      const serialized = JSON.stringify(encodeOrThrow(CONTENT));
      expect(serialized).not.toContain("Syntetisk samtale");
      expect(serialized).not.toContain("Synthetic goal");
      expect(serialized).not.toContain("Syntetiske notater");
    });

    it("writes keyVersion 'v2' and keyId 'k1', matching the record envelope", () => {
      const envelope = encodeOrThrow(CONTENT);
      expect(envelope.keyVersion).toBe("v2");
      expect(envelope.keyId).toBe("k1");
    });
  });

  describe("keyCheck and key derivation agree with an independent reference", () => {
    it("writes the keyCheck that an independent HKDF and HMAC computation produces for the configured key", () => {
      expect(encodeOrThrow(CONTENT).keyCheck).toBe(independentKeyCheck(keyBytes));
    });

    it("opens a record sealed by the independent AES-GCM reference under the same key and context", () => {
      const sealed = sealRawBytes(Buffer.from(JSON.stringify({ title: "x", ownerNotes: "", nextSteps: [], participantNotes: "", sharedGoals: [], sharedEvidence: [] }), "utf8"), keyBytes);
      const outcome = decryptForClassification(sealed, CTX);
      expect(outcome.status).toBe("decrypted");
    });
  });

  describe("probeKey (BR-53)", () => {
    it("succeeds for a valid configured key", () => {
      expect(probeKey()).toEqual({ ok: true });
    });

    it("returns key_unavailable when the key is missing", () => {
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(probeKey()).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_unavailable when the key is invalid base64", () => {
      vi.stubEnv("ENCRYPTION_KEY", "not-valid-base64!!!");
      expect(probeKey()).toEqual({ ok: false, error: "key_unavailable" });
    });
  });

  describe("encodeContent key failures", () => {
    it("returns key_unavailable for a missing key", () => {
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(encodeContent(CONTENT, CTX)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_unavailable for a key that decodes to the wrong length", () => {
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));
      expect(encodeContent(CONTENT, CTX)).toEqual({ ok: false, error: "key_unavailable" });
    });
  });

  describe("decodeContent failure classes", () => {
    it("returns key_unavailable for a missing key, and never payload_unauthenticated", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(decodeContent(envelope, CTX)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_mismatch for a wrong key, never payload_unauthenticated", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      expect(decodeContent(envelope, CTX)).toEqual({ ok: false, error: "key_mismatch" });
    });

    it("returns malformed_payload when keyCheck is not 32 decoded bytes, and never reaches AES", () => {
      const envelope = encodeOrThrow(CONTENT);
      expect(decodeContent({ ...envelope, keyCheck: Buffer.alloc(16).toString("base64") }, CTX)).toEqual({
        ok: false,
        error: "malformed_payload",
      });
    });

    it("returns payload_unauthenticated for a tampered ciphertext while keyCheck matches", () => {
      const envelope = encodeOrThrow(CONTENT);
      expect(decodeContent({ ...envelope, ciphertext: tamper(envelope.ciphertext) }, CTX)).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("returns payload_unauthenticated for a tampered auth tag while keyCheck matches", () => {
      const envelope = encodeOrThrow(CONTENT);
      expect(decodeContent({ ...envelope, authTag: tamper(envelope.authTag) }, CTX)).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("returns payload_unauthenticated for a tampered IV while keyCheck matches", () => {
      const envelope = encodeOrThrow(CONTENT);
      expect(decodeContent({ ...envelope, iv: tamper(envelope.iv) }, CTX)).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("never classifies a wrong key as payload_unauthenticated, even for a tampered envelope", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      const result = decodeContent({ ...envelope, ciphertext: tamper(envelope.ciphertext) }, CTX);
      expect(result).toEqual({ ok: false, error: "key_mismatch" });
    });
  });

  describe("record substitution (AAD binds the record context)", () => {
    it("refuses a record opened under another conversation's context", () => {
      const envelope = encodeOrThrow(CONTENT);
      const other = conversationContext(OWNER_UID, "another-conversation");
      expect(decodeContent(envelope, other)).toEqual({ ok: false, error: "payload_unauthenticated" });
    });

    it("refuses a record opened under another owner's context", () => {
      const envelope = encodeOrThrow(CONTENT);
      const other = conversationContext("another-owner", CONVERSATION_ID);
      expect(decodeContent(envelope, other)).toEqual({ ok: false, error: "payload_unauthenticated" });
    });

    it("classifies a substituted record as unreadable_payload, not as valid content", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));
      const result = classifyStoredConversation(raw, (envelope) =>
        decryptForClassification(envelope, conversationContext("another-owner", CONVERSATION_ID)),
      );
      expect(result).toEqual({ kind: "unreadable_payload" });
    });
  });

  describe("malformed decrypted payloads (authenticated, so not auth failures)", () => {
    it("returns malformed_payload for authenticated bytes that are invalid UTF-8, never a replacement character", () => {
      const envelope = sealRawBytes(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), keyBytes);
      expect(decodeContent(envelope, CTX)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("returns malformed_payload for a UTF-8 BOM before the JSON", () => {
      const envelope = sealRawBytes(Buffer.from("﻿{}", "utf8"), keyBytes);
      expect(decodeContent(envelope, CTX)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("returns malformed_payload for authenticated bytes that are not JSON", () => {
      const envelope = sealRawBytes(Buffer.from("not json at all", "utf8"), keyBytes);
      expect(decodeContent(envelope, CTX)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("returns malformed_payload for valid JSON that fails the payload shape", () => {
      const envelope = sealRawBytes(Buffer.from(JSON.stringify({ title: "only a title" }), "utf8"), keyBytes);
      expect(decodeContent(envelope, CTX)).toEqual({ ok: false, error: "malformed_payload" });
    });
  });

  describe("classifyStoredConversation seam (decryptForClassification)", () => {
    it("classifies a valid stored document as valid", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));
      const result = classifyStoredConversation(raw, (envelope) => decryptForClassification(envelope, CTX));
      expect(result.kind).toBe("valid");
    });

    it("classifies a tampered ciphertext as unreadable_payload, the only authentication recovery class", () => {
      const envelope = encodeOrThrow(CONTENT);
      const raw = ownerDocFor({ ...envelope, ciphertext: tamper(envelope.ciphertext) });
      const result = classifyStoredConversation(raw, (e) => decryptForClassification(e, CTX));
      expect(result).toEqual({ kind: "unreadable_payload" });
    });

    it("classifies authenticated invalid UTF-8 as malformed, never unreadable_payload", () => {
      const envelope = sealRawBytes(Buffer.from([0x7b, 0xff, 0x7d]), keyBytes);
      const result = classifyStoredConversation(ownerDocFor(envelope), (e) => decryptForClassification(e, CTX));
      expect(result.kind).toBe("malformed");
    });

    it("classifies authenticated malformed JSON as malformed, never unreadable_payload", () => {
      const envelope = sealRawBytes(Buffer.from("{", "utf8"), keyBytes);
      const result = classifyStoredConversation(ownerDocFor(envelope), (e) => decryptForClassification(e, CTX));
      expect(result.kind).toBe("malformed");
    });

    it("throws a ContentKeyError for a key mismatch, so the classifier never returns recovery data", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      expect(() => decryptForClassification(envelope, CTX)).toThrow(ContentKeyError);
    });

    it("throws a ContentKeyError for a missing key, so it is never malformed or unreadable", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(() => decryptForClassification(envelope, CTX)).toThrow(ContentKeyError);
    });

    it("uses the plain key set of the owner document, so the owner document keys are unchanged", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));
      expect(Object.keys(raw).sort()).toEqual([...STORED_OWNER_PLAIN_KEYS].sort());
    });
  });

  describe("keyCheck stays out of every public DTO allow-list", () => {
    it("is not in any public DTO allow-list", () => {
      const allowLists: readonly (readonly string[])[] = [
        PENDING_DTO_KEYS,
        OWNER_PARTICIPANT_KEYS,
        SHARED_GOAL_DTO_KEYS,
        OWNER_DTO_KEYS,
        PARTICIPANT_DTO_KEYS,
        OWNER_SUMMARY_KEYS,
        PARTICIPANT_SUMMARY_KEYS,
        RECOVERY_ITEM_KEYS,
      ];

      for (const keys of allowLists) {
        expect(keys).not.toContain("keyCheck");
        expect(keys).not.toContain("keyId");
      }
    });
  });

  describe("failure outputs carry no key, keyCheck, ciphertext, IV or helper text", () => {
    it("returns exact failure objects with no extra fields", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", "");

      expect(decodeContent(envelope, CTX)).toStrictEqual({ ok: false, error: "key_unavailable" });
      expect(encodeContent(CONTENT, CTX)).toStrictEqual({ ok: false, error: "key_unavailable" });
      expect(probeKey()).toStrictEqual({ ok: false, error: "key_unavailable" });
    });

    it("keeps the key and keyCheck out of serialized failure results", () => {
      const envelope = encodeOrThrow(CONTENT);
      const badKey = "not-valid-base64!!!";
      vi.stubEnv("ENCRYPTION_KEY", badKey);

      const serialized = JSON.stringify([decodeContent(envelope, CTX), encodeContent(CONTENT, CTX), probeKey()]);

      expect(serialized).not.toContain(badKey);
      expect(serialized).not.toContain(keyBytes.toString("base64"));
      expect(serialized).not.toContain(envelope.keyCheck);
      expect(serialized).not.toContain(envelope.ciphertext);
      expect(serialized).not.toContain(envelope.iv);
    });

    it("throws ContentKeyError with only the stable code as its message", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

      try {
        decryptForClassification(envelope, CTX);
        throw new Error("expected decryptForClassification to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ContentKeyError);
        expect((error as Error).message).toBe("key_mismatch");
        expect(String(error)).not.toContain(envelope.keyCheck);
      }
    });

    it("never logs content, keys or payload data on success or failure paths", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const envelope = encodeOrThrow(CONTENT);
      decodeContent(envelope, CTX);
      decodeContent({ ...envelope, ciphertext: tamper(envelope.ciphertext) }, CTX);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      decodeContent(envelope, CTX);

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
