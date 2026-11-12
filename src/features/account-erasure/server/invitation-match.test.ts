import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { invitationEmailIndex } from "../../teams/domain/team-invitation-content-codec";
import { invitationBelongsToErasedPerson } from "./invitation-match";

// Ownership predicate for a stored team invitation. The stored address is sealed; ownership is decided by the blind index
// `emailIndex`. Fixtures are synthetic. The erased person's normalized address is ERASED; the uid is UID.

// One fixed key for the whole file: the indexes below are computed at load time and must match the predicate.
vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

const TEAM = "team-1";
const ERASED = "erased@example.com";
const UID = "uid-erased";
const INDEX = invitationEmailIndex(ERASED);
const EXACT_ID = `${TEAM}__${INDEX}`;
const OTHER_INDEX = invitationEmailIndex("other@example.com");

describe("invitationBelongsToErasedPerson (blind-index ownership rule)", () => {
  it("matches a stored emailIndex equal to the blind index of the erased address", () => {
    expect(invitationBelongsToErasedPerson("any-id", { emailIndex: INDEX, teamId: TEAM }, ERASED, UID)).toBe(true);
  });

  it("indexes the normalized address, so casing and whitespace never cause a false negative", () => {
    expect(invitationEmailIndex("  Erased@Example.com ")).toBe(INDEX);
  });

  it("does not match a different stored emailIndex, even when the document id is the erased address's exact id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { emailIndex: OTHER_INDEX, teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("never matches by a document id that merely contains the erased index as a suffix", () => {
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${INDEX}`, { emailIndex: OTHER_INDEX, teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a record with no emailIndex only by the exact deterministic id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${INDEX}`, { teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a null emailIndex only by the exact deterministic id, never by a misleading id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { emailIndex: null, teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${INDEX}`, { emailIndex: null, teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a non-string emailIndex (a number, an object) only by the exact deterministic id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { emailIndex: 42, teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(EXACT_ID, { emailIndex: { value: INDEX }, teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${INDEX}`, { emailIndex: 42, teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a blank emailIndex only by the exact deterministic id", () => {
    expect(invitationBelongsToErasedPerson(EXACT_ID, { emailIndex: "", teamId: TEAM }, ERASED, UID)).toBe(true);
    expect(invitationBelongsToErasedPerson(`${TEAM}__x__${INDEX}`, { emailIndex: "", teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("matches a record resolved to the erased uid, whatever its index", () => {
    expect(invitationBelongsToErasedPerson("other", { emailIndex: OTHER_INDEX, resolvedUid: UID, teamId: TEAM }, ERASED, UID)).toBe(true);
  });

  it("does not match a record with a different resolved uid and a different index", () => {
    expect(invitationBelongsToErasedPerson("other", { emailIndex: OTHER_INDEX, resolvedUid: "uid-other", teamId: TEAM }, ERASED, UID)).toBe(false);
  });

  it("refuses a plaintext email field as ownership evidence: only the index counts", () => {
    expect(invitationBelongsToErasedPerson("other", { email: ERASED, teamId: TEAM }, ERASED, UID)).toBe(false);
  });
});
