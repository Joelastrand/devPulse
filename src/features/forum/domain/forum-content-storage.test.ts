import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptRecord, encryptRecord, RecordEnvelopeError, type RecordEnvelope } from "../../../lib/encryption/record-envelope";
import { surveyResponseContext } from "../../surveys/domain/response-context";
import { forumReplyContext } from "./forum-reply";
import { forumThreadContext } from "./forum-thread";

/**
 * Storage boundary of forum content and survey answers at the envelope level: each sealed value is bound to the record that
 * holds it (team, thread, reply or response), so a value moved to another record fails authentication, a tampered value is
 * refused, and a missing key fails closed. Synthetic fixtures only.
 */
const TEAM = "team-forum-1";
const THREAD = "thread-1";
const REPLY = "reply-1";
const RESPONSE = "response-1";
const SURVEY = "survey-1";
const SECRET_TITLE = "Synthetic thread title";
const SECRET_BODY = "Synthetic thread body text";
const SECRET_REPLY = "Synthetic reply text";
const SECRET_ANSWER = "Synthetic answer payload";

// One fixed key for the file: the envelopes below are sealed when the describe blocks are collected.
const FIXED_KEY = randomBytes(32).toString("base64");
vi.stubEnv("ENCRYPTION_KEY", FIXED_KEY);

function openWith(envelope: RecordEnvelope, context: string): string | "refused" {
  try {
    return decryptRecord(envelope, context);
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code === "authentication_failed") return "refused";
    throw error;
  }
}

function tamper(envelope: RecordEnvelope): RecordEnvelope {
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return { ...envelope, ciphertext: bytes.toString("base64") };
}

describe("forum thread storage boundary", () => {
  const sealed = encryptRecord(JSON.stringify({ title: SECRET_TITLE, body: SECRET_BODY }), forumThreadContext(TEAM, THREAD));

  it("persists an envelope that contains neither the title nor the body", () => {
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain(SECRET_TITLE);
    expect(serialized).not.toContain(SECRET_BODY);
    expect(sealed).toMatchObject({ keyVersion: "v2", keyId: "k1" });
  });

  it("opens for the owning thread", () => {
    expect(JSON.parse(decryptRecord(sealed, forumThreadContext(TEAM, THREAD)))).toEqual({ title: SECRET_TITLE, body: SECRET_BODY });
  });

  it("refuses a value moved to another thread or another team", () => {
    expect(openWith(sealed, forumThreadContext(TEAM, "thread-2"))).toBe("refused");
    expect(openWith(sealed, forumThreadContext("team-other", THREAD))).toBe("refused");
  });

  it("refuses a tampered envelope", () => {
    expect(openWith(tamper(sealed), forumThreadContext(TEAM, THREAD))).toBe("refused");
  });

  it("fails closed when the key is missing", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => decryptRecord(sealed, forumThreadContext(TEAM, THREAD))).toThrow();
    vi.stubEnv("ENCRYPTION_KEY", FIXED_KEY);
  });
});

describe("forum reply storage boundary", () => {
  const sealed = encryptRecord(SECRET_REPLY, forumReplyContext(TEAM, THREAD, REPLY));

  it("persists an envelope that does not contain the reply text", () => {
    expect(JSON.stringify(sealed)).not.toContain(SECRET_REPLY);
  });

  it("refuses a value moved to another reply, another thread or another team", () => {
    expect(openWith(sealed, forumReplyContext(TEAM, THREAD, "reply-2"))).toBe("refused");
    expect(openWith(sealed, forumReplyContext(TEAM, "thread-2", REPLY))).toBe("refused");
    expect(openWith(sealed, forumReplyContext("team-other", THREAD, REPLY))).toBe("refused");
  });

  it("opens for the owning reply and refuses a tampered envelope", () => {
    expect(decryptRecord(sealed, forumReplyContext(TEAM, THREAD, REPLY))).toBe(SECRET_REPLY);
    expect(openWith(tamper(sealed), forumReplyContext(TEAM, THREAD, REPLY))).toBe("refused");
  });
});

describe("survey response storage boundary", () => {
  const sealed = encryptRecord(SECRET_ANSWER, surveyResponseContext(TEAM, SURVEY, RESPONSE));

  it("persists an envelope that does not contain the answer payload", () => {
    expect(JSON.stringify(sealed)).not.toContain(SECRET_ANSWER);
  });

  it("refuses a response moved to another response, survey or team, and opens for its own record", () => {
    expect(decryptRecord(sealed, surveyResponseContext(TEAM, SURVEY, RESPONSE))).toBe(SECRET_ANSWER);
    expect(openWith(sealed, surveyResponseContext(TEAM, SURVEY, "response-2"))).toBe("refused");
    expect(openWith(sealed, surveyResponseContext(TEAM, "survey-2", RESPONSE))).toBe("refused");
    expect(openWith(sealed, surveyResponseContext("team-other", SURVEY, RESPONSE))).toBe("refused");
    expect(openWith(tamper(sealed), surveyResponseContext(TEAM, SURVEY, RESPONSE))).toBe("refused");
  });
});
