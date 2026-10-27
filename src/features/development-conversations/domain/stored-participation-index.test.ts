import { describe, expect, it } from "vitest";
import { parseStoredParticipationIndex, PARTICIPATION_INDEX_KEYS } from "./stored-participation-index";

/** Synthetic test data only (invariant 15). */
function validIndex(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ownerUid: "synthetic-owner", invitedAt: new Date("2026-10-14T08:30:00.000Z"), ...overrides };
}

describe("participation index stored shape (BR-34, CL-13)", () => {
  it("has exactly ownerUid and invitedAt", () => {
    expect([...PARTICIPATION_INDEX_KEYS]).toEqual(["ownerUid", "invitedAt"]);
  });

  it("accepts a locator with ownerUid and invitedAt", () => {
    expect(parseStoredParticipationIndex(validIndex())).toEqual({
      ok: true,
      entry: { ownerUid: "synthetic-owner", invitedAt: new Date("2026-10-14T08:30:00.000Z") },
    });
  });

  it.each([
    ["missing ownerUid", () => ({ invitedAt: new Date(0) })],
    ["missing invitedAt", () => ({ ownerUid: "synthetic-owner" })],
    ["empty ownerUid", () => validIndex({ ownerUid: "" })],
    ["numeric ownerUid", () => validIndex({ ownerUid: 12 })],
    ["invitedAt as string", () => validIndex({ invitedAt: "2026-10-14T08:30:00.000Z" })],
    ["invitedAt as epoch number", () => validIndex({ invitedAt: 1789380600000 })],
    ["invitedAt invalid Date", () => validIndex({ invitedAt: new Date("nope") })],
    ["extra title key (no content duplication, CL-13)", () => validIndex({ title: "Synthetic title" })],
    ["extra participantMemberRef key", () => validIndex({ participantMemberRef: "synthetic-ref" })],
    ["explicit undefined invitedAt", () => validIndex({ invitedAt: undefined })],
  ])("rejects %s", (_name, build) => {
    expect(parseStoredParticipationIndex(build())).toEqual({ ok: false });
  });

  it.each([null, undefined, "index", 1, [], [validIndex()], new Date(0), new (class Index {})()])(
    "rejects a non-plain value %#",
    (value) => {
      expect(parseStoredParticipationIndex(value)).toEqual({ ok: false });
    },
  );
});
