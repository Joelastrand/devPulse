import { describe, expect, it } from "vitest";
import { invitationBelongsToErasedPerson } from "./invitation-match";

// TASK-038 finding 2 and the 2026-11-02 AE-SI-7 repair: the ownership predicate for a stored team invitation. Fixtures are
// synthetic. The erased person's normalized address is ERASED; the uid is UID.

const TEAM = "team-1";
const ERASED = "erased@example.com";
const UID = "uid-erased";
const EXACT_ID = `${TEAM}__${ERASED}`;

describe("invitationBelongsToErasedPerson (AE-SI-7, ownership rule)", () => {
  it("matches a valid stored email that normalizes to the erased address", () => {
    expect(invitationBelongsToErasedPerson("any-id", { email: "  Erased@Example.com ", teamId: TEAM }, ERASED, UID)).toBe(true);
  });

  it("does not match a valid stored email that is different, even when the document id is the erased address's exact id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { email: "other@example.com", teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("does not match a valid different stored email by a misleading id that merely ends with the erased address", () => {
    const misleading = `${TEAM}__someone__${ERASED}`;
    expect(invitationBelongsToErasedPerson(misleading, { email: "other@example.com", teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a record with no stored email only by the exact deterministic id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__other-${ERASED}`, { teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a null stored email only by the exact deterministic id, never by a misleading id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { email: null, teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${ERASED}`, { email: null, teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a non-string stored email (a number, an object) only by the exact deterministic id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { email: 42, teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(EXACT_ID, { email: { address: ERASED }, teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${ERASED}`, { email: 42, teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a blank stored email only by the exact deterministic id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { email: "   ", teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${ERASED}`, { email: "", teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a record resolved to the erased uid, whatever its email", () => {
    expect(invitationBelongsToErasedPerson("other", { email: "other@example.com", resolvedUid: UID, teamId: TEAM }, ERASED, UID)).toBe(true);
  });

  it("does not match a record with a different resolved uid and a different valid email", () => {
    expect(invitationBelongsToErasedPerson("other", { email: "other@example.com", resolvedUid: "uid-other", teamId: TEAM }, ERASED, UID)).toBe(false);
  });
});
