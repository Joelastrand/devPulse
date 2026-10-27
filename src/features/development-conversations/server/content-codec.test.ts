import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt, readEncryptionKeyBytes } from "../../../lib/encryption/encryption";
import type { ConversationContent } from "../domain/content-payload";
import {
  classifyStoredConversation,
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
  deriveKeyCheckBytes,
  encodeContent,
  probeKey,
} from "./content-codec";

/*
 * Synthetic test data only (invariant 15). Every key here is generated in the test. Nothing comes from `.env.local`
 * or a production constant. The "independent" helpers below recompute AES-GCM and HMAC directly with `node:crypto`,
 * so the codec is checked against an outside reference and not against itself.
 */

const CONTEXT = "devpulse.d2.conversation-key-check.v1";

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
};

function independentKeyCheck(keyBytes: Buffer): string {
  return createHmac("sha256", keyBytes).update(CONTEXT, "utf8").digest("base64");
}

/** AES-256-GCM sealed with the test's own key bytes. Produces authenticated bytes the codec must still classify. */
function sealRawBytes(plaintext: Buffer, keyBytes: Buffer): StoredEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: STORED_KEY_VERSION,
    keyCheck: independentKeyCheck(keyBytes),
  };
}

function tamper(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = bytes[0] ^ 0xff;
  return bytes.toString("base64");
}

function encodeOrThrow(content: ConversationContent): StoredEnvelope {
  const result = encodeContent(content);
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
    keyCheck: envelope.keyCheck,
  };
}

describe("content codec", () => {
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
      const decoded = decodeContent(encodeOrThrow(CONTENT));

      expect(decoded).toEqual({ ok: true, content: CONTENT });
    });

    it("stores exactly the five CL-27 envelope keys", () => {
      const envelope = encodeOrThrow(CONTENT);

      expect(Object.keys(envelope).sort()).toEqual(["authTag", "ciphertext", "iv", "keyCheck", "keyVersion"]);
    });

    it("contains no readable plaintext of the title, notes or goal title in the stored object", () => {
      const serialized = JSON.stringify(encodeOrThrow(CONTENT));

      expect(serialized).not.toContain(CONTENT.title);
      expect(serialized).not.toContain(CONTENT.ownerNotes);
      expect(serialized).not.toContain(CONTENT.participantNotes);
      expect(serialized).not.toContain(CONTENT.nextSteps[0]);
      expect(serialized).not.toContain("Synthetic goal");
      expect(serialized).not.toContain(Buffer.from(CONTENT.title, "utf8").toString("base64"));
    });

    it("writes a keyVersion equal to the helper's own keyVersion (TASK-002 handoff)", () => {
      const helperVersion = encrypt("handoff probe").keyVersion;

      expect(STORED_KEY_VERSION).toBe(helperVersion);
      expect(encodeOrThrow(CONTENT).keyVersion).toBe(helperVersion);
    });
  });

  describe("keyCheck derivation (CL-27)", () => {
    it("matches a fixed vector computed independently with HMAC-SHA-256 over the context", () => {
      vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));

      expect(deriveKeyCheckBytes(readEncryptionKeyBytes()).toString("base64")).toBe(
        "jLFx1Qk1GY1vRjRxTH2z7AfKMMHTId1cGNi7+m90Aic=",
      );
    });

    it("is deterministic for the same key", () => {
      const first = deriveKeyCheckBytes(readEncryptionKeyBytes());
      const second = deriveKeyCheckBytes(readEncryptionKeyBytes());

      expect(first.equals(second)).toBe(true);
    });

    it("yields a different value for a different context (domain separation)", () => {
      const withCurrentContext = createHmac("sha256", keyBytes).update(CONTEXT, "utf8").digest("base64");
      const withOtherContext = createHmac("sha256", keyBytes)
        .update("devpulse.d2.conversation-key-check.v2", "utf8")
        .digest("base64");

      expect(withOtherContext).not.toBe(withCurrentContext);
      expect(encodeOrThrow(CONTENT).keyCheck).toBe(withCurrentContext);
    });

    it("is exactly 32 decoded bytes in canonical padded base64", () => {
      const keyCheck = encodeOrThrow(CONTENT).keyCheck;

      expect(Buffer.from(keyCheck, "base64").length).toBe(32);
      expect(Buffer.from(keyCheck, "base64").toString("base64")).toBe(keyCheck);
    });
  });

  describe("AES and keyCheck use the same validated key (mandatory equality proof)", () => {
    it("derives keyCheck from the helper's accessor bytes, which equal the configured key", () => {
      expect(readEncryptionKeyBytes().equals(keyBytes)).toBe(true);
      expect(deriveKeyCheckBytes(readEncryptionKeyBytes()).toString("base64")).toBe(
        independentKeyCheck(keyBytes),
      );
    });

    it("encrypts with the helper under that key, and decodes only when keyCheck and AES agree", () => {
      const envelope = encodeOrThrow(CONTENT);

      expect(decodeContent(envelope)).toEqual({ ok: true, content: CONTENT });
      expect(envelope.keyCheck).toBe(independentKeyCheck(keyBytes));
    });
  });

  describe("probeKey (BR-53)", () => {
    it("succeeds for a valid configured key", () => {
      expect(probeKey()).toEqual({ ok: true });
    });

    it("returns key_unavailable when the key is missing", () => {
      delete process.env.ENCRYPTION_KEY;

      expect(probeKey()).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_unavailable when the key is invalid base64", () => {
      vi.stubEnv("ENCRYPTION_KEY", "not-valid-base64!!!");

      expect(probeKey()).toEqual({ ok: false, error: "key_unavailable" });
    });
  });

  describe("encodeContent key failures", () => {
    it("returns key_unavailable for a missing key", () => {
      delete process.env.ENCRYPTION_KEY;

      expect(encodeContent(CONTENT)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_unavailable for an invalid base64 key", () => {
      vi.stubEnv("ENCRYPTION_KEY", "not-valid-base64!!!");

      expect(encodeContent(CONTENT)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_unavailable for a key that decodes to the wrong length", () => {
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));

      expect(encodeContent(CONTENT)).toEqual({ ok: false, error: "key_unavailable" });
    });
  });

  describe("decodeContent failure classes", () => {
    it("returns key_unavailable for a missing key, and never payload_unauthenticated", () => {
      const envelope = encodeOrThrow(CONTENT);
      delete process.env.ENCRYPTION_KEY;

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_unavailable for an invalid base64 key", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", "not-valid-base64!!!");

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("returns key_mismatch for a wrong key, never payload_unauthenticated", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "key_mismatch" });
    });

    it("returns key_mismatch when keyCheck is not 32 decoded bytes, and never reaches AES", () => {
      const envelope = { ...encodeOrThrow(CONTENT), keyCheck: "AAAA" };

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "key_mismatch" });
    });

    it("returns payload_unauthenticated for a tampered ciphertext while keyCheck matches", () => {
      const envelope = encodeOrThrow(CONTENT);

      expect(decodeContent({ ...envelope, ciphertext: tamper(envelope.ciphertext) })).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("returns payload_unauthenticated for a tampered auth tag while keyCheck matches", () => {
      const envelope = encodeOrThrow(CONTENT);

      expect(decodeContent({ ...envelope, authTag: tamper(envelope.authTag) })).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("returns payload_unauthenticated for a tampered IV while keyCheck matches", () => {
      const envelope = encodeOrThrow(CONTENT);

      expect(decodeContent({ ...envelope, iv: tamper(envelope.iv) })).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("never classifies a wrong key as payload_unauthenticated, even for a tampered envelope", () => {
      const envelope = encodeOrThrow(CONTENT);
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

      expect(decodeContent({ ...envelope, ciphertext: tamper(envelope.ciphertext) })).toEqual({
        ok: false,
        error: "key_mismatch",
      });
    });
  });

  describe("malformed decrypted payloads (authenticated, so not auth failures)", () => {
    it("returns malformed_payload for authenticated bytes that are invalid UTF-8, never a replacement character", () => {
      const envelope = sealRawBytes(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), keyBytes);

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("rejects invalid UTF-8 inside an otherwise valid string value instead of replacing it", () => {
      // A replacement decoder would turn 0xff into U+FFFD inside `ownerNotes` and let the JSON parse. Strict decoding must not.
      const plaintext = Buffer.concat([
        Buffer.from('{"title":"Synthetic title","ownerNotes":"Synthetic ', "utf8"),
        Buffer.from([0xff]),
        Buffer.from('","nextSteps":[],"participantNotes":"","sharedGoals":[]}', "utf8"),
      ]);
      const envelope = sealRawBytes(plaintext, keyBytes);

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("returns malformed_payload for a UTF-8 BOM before the JSON", () => {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const envelope = sealRawBytes(Buffer.concat([bom, Buffer.from("{}", "utf8")]), keyBytes);

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("returns malformed_payload for authenticated bytes that are not JSON", () => {
      const envelope = sealRawBytes(Buffer.from("{not json", "utf8"), keyBytes);

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "malformed_payload" });
    });

    it("returns malformed_payload for valid JSON that fails the TASK-002 payload shape", () => {
      const envelope = sealRawBytes(Buffer.from('{"title":"only one key"}', "utf8"), keyBytes);

      expect(decodeContent(envelope)).toEqual({ ok: false, error: "malformed_payload" });
    });
  });

  describe("classifyStoredConversation seam (decryptForClassification)", () => {
    it("classifies a valid stored document as valid", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));

      const classification = classifyStoredConversation(raw, decryptForClassification);

      expect(classification.kind).toBe("valid");
    });

    it("classifies a tampered ciphertext as unreadable_payload, the only authentication recovery class", () => {
      const envelope = encodeOrThrow(CONTENT);
      const raw = ownerDocFor({ ...envelope, ciphertext: tamper(envelope.ciphertext) });

      expect(classifyStoredConversation(raw, decryptForClassification)).toEqual({ kind: "unreadable_payload" });
    });

    it("classifies authenticated invalid UTF-8 as malformed, never unreadable_payload", () => {
      const raw = ownerDocFor(sealRawBytes(Buffer.from([0x7b, 0xff, 0x7d]), keyBytes));

      expect(classifyStoredConversation(raw, decryptForClassification)).toEqual({
        kind: "malformed",
        reason: "payload",
      });
    });

    it("classifies authenticated malformed JSON as malformed, never unreadable_payload", () => {
      const raw = ownerDocFor(sealRawBytes(Buffer.from("{not json", "utf8"), keyBytes));

      expect(classifyStoredConversation(raw, decryptForClassification)).toEqual({
        kind: "malformed",
        reason: "payload",
      });
    });

    it("throws a ContentKeyError for a key mismatch, so the classifier never returns recovery data", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

      expect(() => classifyStoredConversation(raw, decryptForClassification)).toThrow(ContentKeyError);
      try {
        classifyStoredConversation(raw, decryptForClassification);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentKeyError);
        expect((error as ContentKeyError).code).toBe("key_mismatch");
      }
    });

    it("throws a ContentKeyError for a missing key, so it is never malformed or unreadable", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));
      delete process.env.ENCRYPTION_KEY;

      expect(() => classifyStoredConversation(raw, decryptForClassification)).toThrow(ContentKeyError);
    });

    it("uses the TASK-002 plain key set, so the owner document keys are unchanged", () => {
      const raw = ownerDocFor(encodeOrThrow(CONTENT));

      expect(Object.keys(raw).sort()).toEqual([...STORED_OWNER_PLAIN_KEYS].sort());
    });
  });

  describe("keyCheck stays out of every public DTO allow-list (CL-27)", () => {
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
      }
    });
  });

  describe("failure outputs carry no key, keyCheck, ciphertext, IV or helper text", () => {
    it("returns exact failure objects with no extra fields", () => {
      const envelope = encodeOrThrow(CONTENT);
      delete process.env.ENCRYPTION_KEY;

      expect(decodeContent(envelope)).toStrictEqual({ ok: false, error: "key_unavailable" });
      expect(encodeContent(CONTENT)).toStrictEqual({ ok: false, error: "key_unavailable" });
      expect(probeKey()).toStrictEqual({ ok: false, error: "key_unavailable" });
    });

    it("keeps the key and keyCheck out of serialized failure results and thrown messages", () => {
      const envelope = encodeOrThrow(CONTENT);
      const badKey = "not-valid-base64!!!";
      vi.stubEnv("ENCRYPTION_KEY", badKey);

      const serialized = JSON.stringify([
        decodeContent(envelope),
        encodeContent(CONTENT),
        probeKey(),
      ]);

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
        decryptForClassification(envelope);
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
      decodeContent(envelope);
      decodeContent({ ...envelope, ciphertext: tamper(envelope.ciphertext) });
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      decodeContent(envelope);

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
