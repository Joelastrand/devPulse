import { afterEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_BODY_MAX_BYTES } from "../../../../src/features/development-conversations/domain/conversation-constants";
import { readConversationBody } from "./_body";

/** Synthetic request bodies only. The body cap is tested at its exact boundary, without any unnecessary allocation. */
const URL_UNDER_TEST = "http://localhost/api/me/conversations";
const ALLOWED = new Set(["title", "plannedFor"]);
const encoder = new TextEncoder();

const requestWithBytes = (bytes: Uint8Array<ArrayBuffer>) => new Request(URL_UNDER_TEST, { method: "POST", body: new Blob([bytes]) });
const requestWithText = (text: string) => requestWithBytes(encoder.encode(text));

/** A JSON object whose UTF-8 encoding is exactly `byteLength` bytes, padded with ASCII inside the title. */
function titleBodyOfBytes(byteLength: number): string {
  const overhead = encoder.encode('{"title":""}').byteLength;
  return `{"title":"${"a".repeat(byteLength - overhead)}"}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readConversationBody: the byte cap (BR-40)", () => {
  it("accepts a body of exactly CONVERSATION_BODY_MAX_BYTES bytes", async () => {
    const text = titleBodyOfBytes(CONVERSATION_BODY_MAX_BYTES);
    expect(encoder.encode(text).byteLength).toBe(CONVERSATION_BODY_MAX_BYTES);
    const result = await readConversationBody(requestWithText(text), ALLOWED);
    expect(result.ok).toBe(true);
  });

  it("rejects one byte over the cap with payload_too_large", async () => {
    const text = titleBodyOfBytes(CONVERSATION_BODY_MAX_BYTES + 1);
    expect(encoder.encode(text).byteLength).toBe(CONVERSATION_BODY_MAX_BYTES + 1);
    expect(await readConversationBody(requestWithText(text), ALLOWED)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("measures UTF-8 bytes, not characters: multibyte content at the cap is accepted, one byte over is rejected", async () => {
    // "æ" is two UTF-8 bytes. 16377 of them plus "aa" is 32756 content bytes: with the 12 bytes of JSON overhead, exactly the cap.
    const atCap = `{"title":"${"æ".repeat(16377)}aa"}`;
    expect(encoder.encode(atCap).byteLength).toBe(CONVERSATION_BODY_MAX_BYTES);
    expect((await readConversationBody(requestWithText(atCap), ALLOWED)).ok).toBe(true);

    // 16378 of them plus "a" is one byte over the cap, while its character count is well under it.
    const overByOne = `{"title":"${"æ".repeat(16378)}a"}`;
    expect(overByOne.length).toBeLessThan(CONVERSATION_BODY_MAX_BYTES);
    expect(encoder.encode(overByOne).byteLength).toBe(CONVERSATION_BODY_MAX_BYTES + 1);
    expect(await readConversationBody(requestWithText(overByOne), ALLOWED)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("reports an oversized malformed body as payload_too_large, because size is checked before parsing", async () => {
    const malformed = `{${"a".repeat(CONVERSATION_BODY_MAX_BYTES)}`;
    expect(await readConversationBody(requestWithText(malformed), ALLOWED)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("never parses an oversized body", async () => {
    const parse = vi.spyOn(JSON, "parse");
    await readConversationBody(requestWithText(titleBodyOfBytes(CONVERSATION_BODY_MAX_BYTES + 1)), ALLOWED);
    expect(parse).not.toHaveBeenCalled();
  });

  it("reports a malformed body under the cap as invalid_input, not as a size error", async () => {
    expect(await readConversationBody(requestWithText('{"title":'), ALLOWED)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("keeps payload_too_large when the stream cancel rejects after the cap is exceeded (cancel is best effort)", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("simulated cancel failure"));
    const read = vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(CONVERSATION_BODY_MAX_BYTES + 1) });
    const request = { body: { getReader: () => ({ read, cancel }) } } as unknown as Request;

    expect(await readConversationBody(request, ALLOWED)).toEqual({ ok: false, error: "payload_too_large" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps payload_too_large when the stream cancel throws synchronously", async () => {
    const cancel = vi.fn(() => {
      throw new Error("simulated synchronous cancel failure");
    });
    const read = vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(CONVERSATION_BODY_MAX_BYTES + 1) });
    const request = { body: { getReader: () => ({ read, cancel }) } } as unknown as Request;

    expect(await readConversationBody(request, ALLOWED)).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("still reports a read failure before the size decision as invalid_input, not as a size error", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("simulated read failure"));
    const request = { body: { getReader: () => ({ read, cancel: vi.fn() }) } } as unknown as Request;

    expect(await readConversationBody(request, ALLOWED)).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("readConversationBody: shape and allow-list", () => {
  it("returns the object when every key is allowed", async () => {
    const result = await readConversationBody(requestWithText('{"title":"Tittel","plannedFor":null}'), ALLOWED);
    expect(result).toEqual({ ok: true, body: { title: "Tittel", plannedFor: null } });
  });

  it("refuses an empty body, an empty string, an array, a primitive and null as invalid_input", async () => {
    const empty = new Request(URL_UNDER_TEST, { method: "POST" });
    expect(await readConversationBody(empty, ALLOWED)).toEqual({ ok: false, error: "invalid_input" });
    for (const text of ["", "[]", '["title"]', "42", '"title"', "true", "null"]) {
      expect(await readConversationBody(requestWithText(text), ALLOWED)).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  it("refuses any key outside the allow-list, including owner selectors and a prototype key", async () => {
    for (const key of ["ownerUid", "uid", "participantUid", "memberRef", "__proto__", "Title"]) {
      const text = `{"title":"x","${key}":"y"}`;
      expect(await readConversationBody(requestWithText(text), ALLOWED)).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  it("refuses bytes that are not valid UTF-8 as invalid_input", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x74, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
    expect(await readConversationBody(requestWithBytes(bytes), ALLOWED)).toEqual({ ok: false, error: "invalid_input" });
  });
});
