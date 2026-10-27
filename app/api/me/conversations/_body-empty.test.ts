import { describe, expect, it } from "vitest";
import { CONVERSATION_BODY_MAX_BYTES } from "../../../../src/features/development-conversations/domain/conversation-constants";
import { readEmptyConversationBody } from "./_body";

/** Synthetic request bodies only (TASK-024). A route that takes no body still reads any body under the same cap. */
const URL_UNDER_TEST = "http://localhost/api/me/conversations/c0000000000000000001/participation";
const encoder = new TextEncoder();

const requestWithText = (text: string) => new Request(URL_UNDER_TEST, { method: "DELETE", body: new Blob([encoder.encode(text)]) });

describe("readEmptyConversationBody: routes that take no body (SPEC BR-17, BR-40)", () => {
  it("accepts a request with no body at all", async () => {
    expect(await readEmptyConversationBody(new Request(URL_UNDER_TEST, { method: "DELETE" }))).toEqual({ ok: true });
  });

  it("accepts an empty body and an empty object", async () => {
    expect(await readEmptyConversationBody(requestWithText(""))).toEqual({ ok: true });
    expect(await readEmptyConversationBody(requestWithText("{}"))).toEqual({ ok: true });
  });

  it("refuses any key with invalid_input, without returning the key name", async () => {
    expect(await readEmptyConversationBody(requestWithText('{"participantUid":"x"}'))).toEqual({ ok: false, error: "invalid_input" });
    expect(await readEmptyConversationBody(requestWithText('{"state":"accepted"}'))).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses a body that is not a JSON object, or is not UTF-8 JSON, with invalid_input", async () => {
    for (const text of ["[]", "null", "not json"]) {
      expect(await readEmptyConversationBody(requestWithText(text))).toEqual({ ok: false, error: "invalid_input" });
    }
    const invalidUtf8 = new Request(URL_UNDER_TEST, { method: "DELETE", body: new Uint8Array([0x7b, 0xff, 0x7d]) });
    expect(await readEmptyConversationBody(invalidUtf8)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses a body over the cap with payload_too_large, before parsing", async () => {
    const oversize = `{"x":"${"a".repeat(CONVERSATION_BODY_MAX_BYTES)}"}`;
    expect(await readEmptyConversationBody(requestWithText(oversize))).toEqual({ ok: false, error: "payload_too_large" });
  });
});
