import { describe, expect, it } from "vitest";
import { CONTENT_PAYLOAD_KEYS, parseConversationContent } from "./content-payload";

/** Synthetic test data only (invariant 15). */
function validGoal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goalTitle: "Syntetisk mål",
    treeId: null,
    targetDate: null,
    status: "completed",
    capturedAt: "2026-10-14T08:30:00.000Z",
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Syntetisk samtale",
    ownerNotes: "Syntetiske notater\nmed linjeskift",
    nextSteps: ["Første steg", "Andre steg"],
    participantNotes: "",
    sharedGoals: [validGoal()],
    ...overrides,
  };
}

describe("decrypted content payload (BR-51, BR-39, BR-40 limits)", () => {
  it("has exactly the five encrypted content keys", () => {
    expect([...CONTENT_PAYLOAD_KEYS]).toEqual(["title", "ownerNotes", "nextSteps", "participantNotes", "sharedGoals"]);
  });

  it("accepts a canonical payload with empty notes and no goals", () => {
    const result = parseConversationContent(validPayload({ ownerNotes: "", nextSteps: [], sharedGoals: [] }));
    expect(result.ok).toBe(true);
  });

  it("returns the payload with snapshot capturedAt as a Date", () => {
    const result = parseConversationContent(validPayload());
    expect(result).toEqual({
      ok: true,
      content: {
        title: "Syntetisk samtale",
        ownerNotes: "Syntetiske notater\nmed linjeskift",
        nextSteps: ["Første steg", "Andre steg"],
        participantNotes: "",
        sharedGoals: [
          {
            goalTitle: "Syntetisk mål",
            treeId: null,
            targetDate: null,
            status: "completed",
            capturedAt: new Date("2026-10-14T08:30:00.000Z"),
          },
        ],
      },
    });
  });

  it.each([
    ["missing title", () => {
      const payload = validPayload();
      delete payload.title;
      return payload;
    }],
    ["extra key", () => validPayload({ plannedFor: "2026-10-14" })],
    ["extra participantUid key", () => validPayload({ participantUid: "synthetic-uid" })],
    ["title over 100 code points", () => validPayload({ title: "a".repeat(101) })],
    ["title over 400 UTF-8 bytes", () => validPayload({ title: "æ".repeat(101) })],
    ["title with leading space (not canonical)", () => validPayload({ title: " Syntetisk" })],
    ["title as number", () => validPayload({ title: 1 })],
    ["title empty", () => validPayload({ title: "" })],
    ["title with bidi control", () => validPayload({ title: "Synt‮tisk" })],
    ["ownerNotes over 4096 bytes", () => validPayload({ ownerNotes: "x".repeat(4097) })],
    ["ownerNotes not NFC (not canonical)", () => validPayload({ ownerNotes: "é" })],
    ["participantNotes as null", () => validPayload({ participantNotes: null })],
    ["nextSteps with 11 items", () => validPayload({ nextSteps: Array.from({ length: 11 }, () => "steg") })],
    ["nextSteps as string", () => validPayload({ nextSteps: "steg" })],
    ["nextStep empty", () => validPayload({ nextSteps: ["steg", ""] })],
    ["nextStep over 200 code points", () => validPayload({ nextSteps: ["s".repeat(201)] })],
    ["nextStep with surrounding space", () => validPayload({ nextSteps: [" steg"] })],
    ["nextStep non-string item", () => validPayload({ nextSteps: ["steg", 2] })],
    ["sharedGoals with 6 snapshots", () => validPayload({ sharedGoals: Array.from({ length: 6 }, () => validGoal()) })],
    ["sharedGoals as object", () => validPayload({ sharedGoals: {} })],
    ["snapshot with unknown key", () => validPayload({ sharedGoals: [validGoal({ goalId: "synthetic-goal" })] })],
    ["snapshot with invalid status", () => validPayload({ sharedGoals: [validGoal({ status: "archived" })] })],
  ])("rejects %s", (_name, build) => {
    expect(parseConversationContent(build())).toEqual({ ok: false });
  });

  it.each([null, undefined, "payload", 7, [], [validPayload()], new Date(0), new (class Payload {})()])(
    "rejects a non-plain payload %#",
    (value) => {
      expect(parseConversationContent(value)).toEqual({ ok: false });
    },
  );
});
