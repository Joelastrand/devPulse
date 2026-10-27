import { describe, expect, it } from "vitest";
import * as constants from "./conversation-constants";

describe("D2 code constants (SPEC \"Code constants\")", () => {
  it("pins every limit to the approved value", () => {
    expect(constants).toMatchObject({
      CONVERSATION_LIMIT: 100,
      PARTICIPATION_LIMIT: 100,
      READ_WINDOW: 100,
      TITLE_MAX_CODE_POINTS: 100,
      TITLE_MAX_BYTES: 400,
      NOTE_MAX_BYTES: 4096,
      NEXT_STEPS_MAX_ITEMS: 10,
      NEXT_STEP_MAX_CODE_POINTS: 200,
      NEXT_STEP_MAX_BYTES: 800,
      SHARED_GOALS_MAX: 5,
      CONVERSATION_BODY_MAX_BYTES: 32768,
    });
  });

  it("exposes only numeric limits", () => {
    for (const value of Object.values(constants)) {
      expect(typeof value).toBe("number");
    }
  });
});
