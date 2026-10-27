import { describe, expect, it } from "vitest";
import { CONVERSATION_STATUSES, completeStatus, isConversationStatus } from "./conversation-status";

describe("conversation status lifecycle (BR-4, BR-28)", () => {
  it("has exactly open and completed", () => {
    expect(CONVERSATION_STATUSES).toEqual(["open", "completed"]);
  });

  it("completes an open conversation", () => {
    expect(completeStatus("open")).toEqual({ ok: true, status: "completed" });
  });

  it("rejects completing an already completed conversation as invalid_transition", () => {
    expect(completeStatus("completed")).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("validates stored status values without coercion", () => {
    expect(isConversationStatus("open")).toBe(true);
    expect(isConversationStatus("completed")).toBe(true);
    for (const value of ["cancelled", "draft", "reopened", "OPEN", "", null, undefined, 1]) {
      expect(isConversationStatus(value)).toBe(false);
    }
  });
});
