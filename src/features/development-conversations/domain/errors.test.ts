import { describe, expect, it } from "vitest";
import { CONVERSATION_ERROR_CODES, CONVERSATION_ERROR_STATUS, isConversationErrorCode } from "./errors";

describe("stable conversation errors (SPEC \"Stable errors\")", () => {
  it("maps every code to the approved HTTP status", () => {
    expect(CONVERSATION_ERROR_STATUS).toEqual({
      unauthenticated: 401,
      conversation_not_found: 404,
      invalid_input: 400,
      payload_too_large: 413,
      invalid_goal_selection: 400,
      invalid_participant: 400,
      conversation_completed: 409,
      invalid_transition: 409,
      conversation_limit: 409,
      persistence_failed: 500,
    });
  });

  it("has a status for exactly the listed codes", () => {
    expect(Object.keys(CONVERSATION_ERROR_STATUS).sort()).toEqual([...CONVERSATION_ERROR_CODES].sort());
  });

  it("recognises only listed codes", () => {
    expect(isConversationErrorCode("conversation_not_found")).toBe(true);
    for (const value of ["key_unavailable", "payload_unauthenticated", "Error", "", null, 404]) {
      expect(isConversationErrorCode(value)).toBe(false);
    }
  });
});
