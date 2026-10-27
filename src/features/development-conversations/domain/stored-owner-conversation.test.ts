import { describe, expect, it, vi } from "vitest";
import {
  classifyStoredConversation,
  KEY_CHECK_BYTES,
  KEY_CHECK_CONTEXT,
  STORED_OWNER_PLAIN_KEYS,
  type DecryptOutcome,
  type StoredEnvelope,
} from "./stored-owner-conversation";
import {
  OWNER_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_DTO_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  PENDING_DTO_KEYS,
  RECOVERY_ITEM_KEYS,
  SHARED_GOAL_DTO_KEYS,
} from "./dto-keys";

/** Synthetic test data only (invariant 15). Base64 values have the helper's lengths: 12-byte IV, 16-byte tag. */
const SYNTHETIC_IV = "AAAAAAAAAAAAAAAA";
const SYNTHETIC_TAG = "AAAAAAAAAAAAAAAAAAAAAA==";
const SYNTHETIC_CIPHERTEXT = "c3ludGhldGlj";
/** 32 zero bytes in canonical base64 (the form of an HMAC-SHA-256 output). The value is synthetic, not a real key check. */
const SYNTHETIC_KEY_CHECK = "A".repeat(43) + "=";
const CREATED = new Date("2026-10-01T08:00:00.000Z");
const UPDATED = new Date("2026-10-02T08:00:00.000Z");
const INVITED = new Date("2026-10-03T08:00:00.000Z");
const ACCEPTED = new Date("2026-10-04T08:00:00.000Z");
const COMPLETED = new Date("2026-10-05T08:00:00.000Z");

function validPayload(): Record<string, unknown> {
  return {
    title: "Syntetisk samtale",
    ownerNotes: "Syntetiske notater",
    nextSteps: ["Synthetic step"],
    participantNotes: "",
    sharedGoals: [],
  };
}

/** A canonical open conversation with no participant (BR-51 plain key set, nulls written explicitly). */
function validOwnerDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    createdAt: CREATED,
    updatedAt: UPDATED,
    ciphertext: SYNTHETIC_CIPHERTEXT,
    iv: SYNTHETIC_IV,
    authTag: SYNTHETIC_TAG,
    keyVersion: "v1",
    keyCheck: SYNTHETIC_KEY_CHECK,
    ...overrides,
  };
}

function decryptedValid(): DecryptOutcome {
  return { status: "decrypted", payload: validPayload() };
}

function classify(raw: unknown, outcome: DecryptOutcome = decryptedValid()) {
  return classifyStoredConversation(raw, () => outcome);
}

describe("stored owner conversation plain key set (BR-51)", () => {
  it("is exactly the sixteen BR-51 plain fields and holds no content field", () => {
    expect([...STORED_OWNER_PLAIN_KEYS]).toEqual([
      "teamId",
      "participantUid",
      "participantMemberRef",
      "participantState",
      "participantInvitedAt",
      "participantAcceptedAt",
      "plannedFor",
      "status",
      "completedAt",
      "createdAt",
      "updatedAt",
      "ciphertext",
      "iv",
      "authTag",
      "keyVersion",
      "keyCheck",
    ]);
    expect(STORED_OWNER_PLAIN_KEYS).toHaveLength(16);
    for (const forbidden of ["title", "ownerNotes", "nextSteps", "participantNotes", "sharedGoals"]) {
      expect(STORED_OWNER_PLAIN_KEYS).not.toContain(forbidden);
    }
  });

  it("pins the keyCheck context and its decoded length (CL-27)", () => {
    expect(KEY_CHECK_CONTEXT).toBe("devpulse.d2.conversation-key-check.v1");
    expect(KEY_CHECK_BYTES).toBe(32);
  });

  it("keeps keyCheck out of every public DTO allow-list (BR-46, CL-27)", () => {
    const allowLists = [
      PENDING_DTO_KEYS,
      OWNER_DTO_KEYS,
      PARTICIPANT_DTO_KEYS,
      OWNER_PARTICIPANT_KEYS,
      OWNER_SUMMARY_KEYS,
      PARTICIPANT_SUMMARY_KEYS,
      RECOVERY_ITEM_KEYS,
      SHARED_GOAL_DTO_KEYS,
    ];
    for (const keys of allowLists) {
      expect(keys as readonly string[]).not.toContain("keyCheck");
    }
  });
});

describe("classifyStoredConversation: keyCheck structural form (CL-27)", () => {
  it("hands the stored keyCheck to the codec unchanged, so the codec can compare it", () => {
    const decrypt = vi.fn<(envelope: StoredEnvelope) => DecryptOutcome>(() => decryptedValid());
    classifyStoredConversation(validOwnerDoc(), decrypt);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt.mock.calls[0]?.[0]).toMatchObject({ keyCheck: SYNTHETIC_KEY_CHECK, keyVersion: "v1" });
  });

  it("accepts any structurally valid keyCheck as stored metadata, without comparing it to a key", () => {
    // TASK-002 cannot know the configured key. A different 32-byte value is therefore still a valid document here.
    const otherValue = "Q".repeat(43) + "=";
    expect(classify(validOwnerDoc({ keyCheck: otherValue })).kind).toBe("valid");
  });

  it("does not classify a document as unreadable from its keyCheck alone", () => {
    expect(classify(validOwnerDoc({ keyCheck: "Q".repeat(43) + "=" })).kind).toBe("valid");
    expect(classify(validOwnerDoc({ keyCheck: "Q".repeat(43) + "=" }), { status: "authentication_failed" })).toEqual({
      kind: "unreadable_payload",
    });
  });

  it.each([
    ["missing keyCheck", () => {
      const doc = validOwnerDoc();
      delete doc.keyCheck;
      return doc;
    }, "keys"],
    ["explicitly undefined keyCheck", () => validOwnerDoc({ keyCheck: undefined }), "keys"],
    ["null keyCheck", () => validOwnerDoc({ keyCheck: null }), "key_check"],
    ["numeric keyCheck", () => validOwnerDoc({ keyCheck: 1 }), "key_check"],
    ["empty keyCheck", () => validOwnerDoc({ keyCheck: "" }), "key_check"],
    ["keyCheck of 31 bytes", () => validOwnerDoc({ keyCheck: "A".repeat(42) + "==" }), "key_check"],
    ["keyCheck of 33 bytes", () => validOwnerDoc({ keyCheck: "A".repeat(44) }), "key_check"],
    ["keyCheck without padding (wrong length)", () => validOwnerDoc({ keyCheck: "A".repeat(43) }), "key_check"],
    ["keyCheck not base64", () => validOwnerDoc({ keyCheck: "!".repeat(43) + "=" }), "key_check"],
    ["keyCheck with non-zero unused trailing bits", () => validOwnerDoc({ keyCheck: "A".repeat(42) + "B=" }), "key_check"],
    ["keyCheck with a line break", () => validOwnerDoc({ keyCheck: "A".repeat(43) + "=\n" }), "key_check"],
    ["keyCheck as a Buffer-like object", () => validOwnerDoc({ keyCheck: { length: 32 } }), "key_check"],
  ])("rejects %s before any decryption", (_name, build, reason) => {
    const decrypt = vi.fn(() => decryptedValid());
    expect(classifyStoredConversation(build(), decrypt)).toEqual({ kind: "malformed", reason });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("treats a malformed keyCheck as malformed even when the caller would report authentication failure", () => {
    const outcome = vi.fn((): DecryptOutcome => ({ status: "authentication_failed" }));
    expect(classifyStoredConversation(validOwnerDoc({ keyCheck: null }), outcome)).toEqual({
      kind: "malformed",
      reason: "key_check",
    });
    expect(outcome).not.toHaveBeenCalled();
  });

  it("propagates a configured-key mismatch thrown by the codec, never classifying it as malformed or unreadable", () => {
    // The codec (TASK-003) detects a keyCheck mismatch before authentication and throws an operational error.
    // This test pins the seam: the classifier does not catch it.
    const mismatch = () => {
      throw new Error("synthetic configured-key mismatch");
    };
    expect(() => classifyStoredConversation(validOwnerDoc(), mismatch)).toThrow("synthetic configured-key mismatch");
  });
});

describe("classifyStoredConversation: valid documents", () => {
  it("classifies an open conversation with no participant and no team", () => {
    const result = classify(validOwnerDoc({ teamId: null }));
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.record).toMatchObject({
        teamId: null,
        participant: null,
        plannedFor: null,
        status: "open",
        completedAt: null,
        createdAt: CREATED,
        updatedAt: UPDATED,
      });
      expect(result.record.content.title).toBe("Syntetisk samtale");
    }
  });

  it("classifies a completed conversation with an accepted participant", () => {
    const result = classify(
      validOwnerDoc({
        plannedFor: "2026-10-14",
        status: "completed",
        completedAt: COMPLETED,
        participantUid: "synthetic-participant",
        participantMemberRef: "synthetic-ref",
        participantState: "accepted",
        participantInvitedAt: INVITED,
        participantAcceptedAt: ACCEPTED,
      }),
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.record.status).toBe("completed");
      expect(result.record.completedAt).toEqual(COMPLETED);
      expect(result.record.plannedFor).toBe("2026-10-14");
      expect(result.record.participant).toEqual({
        uid: "synthetic-participant",
        memberRef: "synthetic-ref",
        state: "accepted",
        invitedAt: INVITED,
        acceptedAt: ACCEPTED,
      });
    }
  });

  it("classifies an open conversation with a pending invitation (acceptedAt null)", () => {
    const result = classify(
      validOwnerDoc({
        participantUid: "synthetic-participant",
        participantMemberRef: "synthetic-ref",
        participantState: "pending",
        participantInvitedAt: INVITED,
      }),
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.record.participant?.state).toBe("pending");
      expect(result.record.participant?.acceptedAt).toBeNull();
    }
  });
});

describe("classifyStoredConversation: malformed plain shape never decrypts", () => {
  it.each([
    ["missing key", () => {
      const doc = validOwnerDoc();
      delete doc.updatedAt;
      return doc;
    }],
    ["explicitly undefined key", () => validOwnerDoc({ plannedFor: undefined })],
    ["extra plaintext ownerNotes key", () => validOwnerDoc({ ownerNotes: "Synthetic plaintext" })],
    ["extra title key", () => validOwnerDoc({ title: "Synthetic plaintext" })],
    ["extra conversationId key", () => validOwnerDoc({ conversationId: "synthetic-id" })],
    ["extra role key", () => validOwnerDoc({ role: "lead" })],
    ["unknown status", () => validOwnerDoc({ status: "Open" })],
    ["status draft", () => validOwnerDoc({ status: "draft" })],
    ["completedAt on open", () => validOwnerDoc({ completedAt: COMPLETED })],
    ["completed without completedAt", () => validOwnerDoc({ status: "completed", completedAt: null })],
    ["completedAt as string", () => validOwnerDoc({ status: "completed", completedAt: "2026-10-05T08:00:00.000Z" })],
    ["plannedFor invalid calendar date", () => validOwnerDoc({ plannedFor: "2026-02-30" })],
    ["plannedFor with time", () => validOwnerDoc({ plannedFor: "2026-10-14T00:00:00Z" })],
    ["plannedFor as Date", () => validOwnerDoc({ plannedFor: new Date("2026-10-14T00:00:00Z") })],
    ["createdAt as string", () => validOwnerDoc({ createdAt: "2026-10-01T08:00:00.000Z" })],
    ["createdAt missing as null", () => validOwnerDoc({ createdAt: null })],
    ["updatedAt invalid Date", () => validOwnerDoc({ updatedAt: new Date("nope") })],
    ["teamId empty", () => validOwnerDoc({ teamId: "" })],
    ["teamId numeric", () => validOwnerDoc({ teamId: 1 })],
    ["participant without team", () => validOwnerDoc({
      teamId: null,
      participantUid: "synthetic-participant",
      participantMemberRef: "synthetic-ref",
      participantState: "pending",
      participantInvitedAt: INVITED,
    })],
    ["partial binding: uid without memberRef", () => validOwnerDoc({
      participantUid: "synthetic-participant",
      participantState: "pending",
      participantInvitedAt: INVITED,
    })],
    ["partial binding: state without uid", () => validOwnerDoc({ participantState: "pending", participantInvitedAt: INVITED })],
    ["participant state declined", () => validOwnerDoc({
      participantUid: "synthetic-participant",
      participantMemberRef: "synthetic-ref",
      participantState: "declined",
      participantInvitedAt: INVITED,
    })],
    ["pending with acceptedAt set", () => validOwnerDoc({
      participantUid: "synthetic-participant",
      participantMemberRef: "synthetic-ref",
      participantState: "pending",
      participantInvitedAt: INVITED,
      participantAcceptedAt: ACCEPTED,
    })],
    ["accepted without acceptedAt", () => validOwnerDoc({
      participantUid: "synthetic-participant",
      participantMemberRef: "synthetic-ref",
      participantState: "accepted",
      participantInvitedAt: INVITED,
      participantAcceptedAt: null,
    })],
    ["participantInvitedAt as string", () => validOwnerDoc({
      participantUid: "synthetic-participant",
      participantMemberRef: "synthetic-ref",
      participantState: "pending",
      participantInvitedAt: "2026-10-03T08:00:00.000Z",
    })],
    ["empty participantMemberRef", () => validOwnerDoc({
      participantUid: "synthetic-participant",
      participantMemberRef: "",
      participantState: "pending",
      participantInvitedAt: INVITED,
    })],
    ["keyVersion other than v1", () => validOwnerDoc({ keyVersion: "v2" })],
    ["ciphertext not base64", () => validOwnerDoc({ ciphertext: "not base64!" })],
    ["ciphertext empty", () => validOwnerDoc({ ciphertext: "" })],
    ["iv of 11 bytes", () => validOwnerDoc({ iv: "AAAAAAAAAAAAAAA=" })],
    ["iv of 10 bytes", () => validOwnerDoc({ iv: "AAAAAAAAAAAAAA==" })],
    ["iv not a string", () => validOwnerDoc({ iv: 12 })],
    ["authTag of 15 bytes", () => validOwnerDoc({ authTag: "AAAAAAAAAAAAAAAAAAAA" })],
    ["authTag with padding in the middle", () => validOwnerDoc({ authTag: "AAAA=AAAAAAAAAAAAAAAAAAAAA" })],
  ])("rejects %s without calling decryption", (_name, build) => {
    const decrypt = vi.fn(() => decryptedValid());
    const result = classifyStoredConversation(build(), decrypt);
    expect(result.kind).toBe("malformed");
    expect(decrypt).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "conversation", 4, [], [validOwnerDoc()], new Date(0), new (class Owner {})()])(
    "rejects non-plain input %#",
    (value) => {
      const decrypt = vi.fn(() => decryptedValid());
      expect(classifyStoredConversation(value, decrypt).kind).toBe("malformed");
      expect(decrypt).not.toHaveBeenCalled();
    },
  );
});

describe("classifyStoredConversation: canonical participant and status tuples (BR-2, BR-10, BR-13, BR-15)", () => {
  const pending = {
    participantUid: "synthetic-participant",
    participantMemberRef: "synthetic-ref",
    participantState: "pending",
    participantInvitedAt: INVITED,
    participantAcceptedAt: null,
  };
  const accepted = { ...pending, participantState: "accepted", participantAcceptedAt: ACCEPTED };
  const none = {
    participantUid: null,
    participantMemberRef: null,
    participantState: null,
    participantInvitedAt: null,
    participantAcceptedAt: null,
  };
  const open = { status: "open", completedAt: null };
  const completed = { status: "completed", completedAt: COMPLETED };

  it.each([
    ["open, no participant, with team", { ...open, ...none }, true],
    ["open, pending, with team", { ...open, ...pending }, true],
    ["open, accepted, with team", { ...open, ...accepted }, true],
    ["completed, no participant", { ...completed, ...none }, true],
    ["completed, accepted", { ...completed, ...accepted }, true],
    ["completed, pending (withdrawn at completion, BR-13)", { ...completed, ...pending }, false],
    ["open, pending, no team (BR-2)", { ...open, ...pending, teamId: null }, false],
    ["open, accepted, no team (BR-2)", { ...open, ...accepted, teamId: null }, false],
    ["open, no participant, no team", { ...open, ...none, teamId: null }, true],
    ["completed, no participant, no team", { ...completed, ...none, teamId: null }, true],
    ["open, pending, acceptedAt set", { ...open, ...pending, participantAcceptedAt: ACCEPTED }, false],
    ["open, accepted, acceptedAt missing", { ...open, ...accepted, participantAcceptedAt: null }, false],
    ["open, uid present, state null", { ...open, ...pending, participantState: null }, false],
    ["open, uid null, memberRef present", { ...open, ...none, participantMemberRef: "synthetic-ref" }, false],
    ["open, uid null, invitedAt present", { ...open, ...none, participantInvitedAt: INVITED }, false],
  ])("%s → %s", (_name, fields, valid) => {
    const result = classify(validOwnerDoc(fields));
    expect(result.kind === "valid").toBe(valid);
  });
});

describe("classifyStoredConversation: canonical base64 envelope", () => {
  it.each([
    ["QQ==", true],
    ["QUI=", true],
    ["QR==", false],
    ["QUJ=", false],
    ["QUI==", false],
    ["QQ", false],
    ["QQ==\n", false],
    ["Q-Q=", false],
    ["Q Q=", false],
    ["====", false],
  ])("ciphertext %j canonical=%s", (ciphertext, canonical) => {
    const decrypt = vi.fn(() => decryptedValid());
    const result = classifyStoredConversation(validOwnerDoc({ ciphertext }), decrypt);
    expect(result.kind === "malformed").toBe(!canonical);
  });

  it("rejects a non-canonical authTag whose unused trailing bits are set", () => {
    // Sixteen zero bytes, then the same bytes with the last character's low bits set to 1.
    expect(classify(validOwnerDoc({ authTag: "AAAAAAAAAAAAAAAAAAAAAB==" })).kind).toBe("malformed");
    expect(classify(validOwnerDoc({ authTag: "AAAAAAAAAAAAAAAAAAAAAA==" })).kind).toBe("valid");
  });
});

describe("classifyStoredConversation: payload and decryption outcomes", () => {
  it("classifies an authentication failure as unreadable_payload (recovery-safe, not malformed)", () => {
    expect(classify(validOwnerDoc(), { status: "authentication_failed" })).toEqual({ kind: "unreadable_payload" });
  });

  it.each([
    ["payload not an object", "synthetic string"],
    ["payload missing sharedGoals", { title: "Syntetisk", ownerNotes: "", nextSteps: [], participantNotes: "" }],
    ["payload title over limit", { ...validPayload(), title: "a".repeat(101) }],
    ["payload with extra key", { ...validPayload(), status: "completed" }],
    ["payload with whitespace title (not canonical)", { ...validPayload(), title: " Syntetisk " }],
    ["payload null", null],
  ])("classifies a decrypted payload that fails content rules as malformed: %s", (_name, payload) => {
    expect(classify(validOwnerDoc(), { status: "decrypted", payload })).toEqual({ kind: "malformed", reason: "payload" });
  });

  it("lets a decryption exception propagate, so a key outage is never classified as malformed (BR-53)", () => {
    const outage = () => {
      throw new Error("synthetic key outage");
    };
    expect(() => classifyStoredConversation(validOwnerDoc(), outage)).toThrow("synthetic key outage");
  });
});

describe("classifyStoredConversation: no leakage and parser safety", () => {
  it("does not echo stored values in a malformed result", () => {
    const result = classify(validOwnerDoc({ status: "synthetic-secret-status", plannedFor: "2026-02-30" }));
    expect(JSON.stringify(result)).not.toContain("synthetic-secret-status");
    expect(JSON.stringify(result)).not.toContain("2026-02-30");
  });

  it("does not echo content in a malformed payload result", () => {
    const result = classify(validOwnerDoc(), { status: "decrypted", payload: { title: "synthetic-secret-title" } });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret-title");
  });

  it("never throws on arbitrary malformed input", () => {
    const hostile: unknown[] = [
      Object.create(null),
      { ...validOwnerDoc(), __proto__: { status: "open" } },
      Object.assign(Object.create(null), validOwnerDoc()),
      Object.defineProperty({}, "status", { get: () => "open" }),
      Symbol("synthetic"),
      () => validOwnerDoc(),
      NaN,
    ];
    for (const value of hostile) {
      expect(() => classify(value)).not.toThrow();
    }
  });
});
