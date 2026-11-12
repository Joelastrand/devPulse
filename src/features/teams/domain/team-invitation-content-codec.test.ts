import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import {
  invitationDocIdForEmail,
  invitationEmailIndex,
  openInvitationDocument,
  openStoredInvitation,
  toPersistedInvitation,
} from "./team-invitation-content-codec";

/**
 * Storage boundary of a team invitation. The address is sealed; matching uses the keyed blind index `emailIndex`, and the
 * document id is `<teamId>__<emailIndex>`. Synthetic fixtures only.
 */
const TEAM = "team-invite-1";
const OTHER_TEAM = "team-invite-2";
const EMAIL = "Synthetic.Person@Example.Test";
const NORMALIZED = "synthetic.person@example.test";
const record = {
  teamId: TEAM,
  email: EMAIL,
  status: "pending",
  invitedBy: "admin-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("team invitation storage boundary", () => {
  it("persists no plaintext address, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedInvitation(TEAM, record);
    expectStorageBoundary({
      persisted,
      secrets: [NORMALIZED, EMAIL],
      envelopeField: "content",
      open: (p) => openInvitationDocument(TEAM, p),
      openAsOtherRecord: (p) => openInvitationDocument(OTHER_TEAM, p),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openInvitationDocument(TEAM, p);
      },
    });
  });

  it("stores only the blind index of the normalized address, never a plaintext or unkeyed hash of it", () => {
    const persisted = toPersistedInvitation(TEAM, record);
    expect(persisted).not.toHaveProperty("email");
    expect(persisted.emailIndex).toBe(invitationEmailIndex(EMAIL));
    expect(persisted.emailIndex).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.emailIndex).not.toContain(NORMALIZED);
  });

  it("uses the same index for any casing or surrounding whitespace of the same address", () => {
    expect(invitationEmailIndex("  SYNTHETIC.person@example.TEST ")).toBe(invitationEmailIndex(NORMALIZED));
  });

  it("detects a duplicate invitation by document id: the same team and address give the same id, another team a different one", () => {
    expect(invitationDocIdForEmail(TEAM, EMAIL)).toBe(invitationDocIdForEmail(TEAM, "  synthetic.person@example.test"));
    expect(invitationDocIdForEmail(TEAM, EMAIL)).not.toBe(invitationDocIdForEmail(OTHER_TEAM, EMAIL));
    expect(invitationDocIdForEmail(TEAM, EMAIL)).toBe(`${TEAM}__${invitationEmailIndex(EMAIL)}`);
  });

  it("restores the normalized address and keeps the domain fields", () => {
    expect(openInvitationDocument(TEAM, toPersistedInvitation(TEAM, record))).toMatchObject({
      teamId: TEAM,
      email: NORMALIZED,
      status: "pending",
      invitedBy: "admin-1",
    });
  });

  it("refuses an invitation whose index is missing, so a malformed record is never matched by content", () => {
    const persisted = toPersistedInvitation(TEAM, record);
    const { emailIndex: _index, ...withoutIndex } = persisted;
    void _index;
    expect(openInvitationDocument(TEAM, withoutIndex)).toBeNull();
  });

  it("refuses a document that still carries a plaintext email next to the envelope", () => {
    expect(openInvitationDocument(TEAM, { ...toPersistedInvitation(TEAM, record), email: NORMALIZED })).toBeNull();
  });

  it("opens a stored invitation through its own team", () => {
    expect(openStoredInvitation(toPersistedInvitation(TEAM, record))).toMatchObject({ email: NORMALIZED });
    expect(openStoredInvitation({ status: "pending" })).toBeNull();
  });
});
