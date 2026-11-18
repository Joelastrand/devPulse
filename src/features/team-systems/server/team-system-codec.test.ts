import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSESSMENT_ATTRIBUTES } from "../domain/team-system";
import { openTeamSystemDocument, toPersistedTeamSystem } from "./team-system-codec";

/**
 * Security regression for the team-system encryption shape. One canonical stored shape: attributes at the top level, each
 * with its own sealed note. Synthetic fixtures only.
 */

const SYSTEM_ID = "sys-1";
const SECRET_NAME = "Hemmelig betalingsløsning";
const SECRET_DESCRIPTION = "Hemmelig beskrivelse av systemet";
const SECRET_NOTE = "Privat vurdering av sikkerhet";

function allAssessments(note: string | null = SECRET_NOTE) {
  return Object.fromEntries(
    ASSESSMENT_ATTRIBUTES.map((attribute) => [
      attribute,
      attribute === "security"
        ? { value: "trenger_oppfolging", note, assessedAt: new Date(0), assessedBy: "admin-1" }
        : { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null },
    ]),
  );
}

function system(overrides: Record<string, unknown> = {}) {
  return {
    teamId: "team-1",
    name: SECRET_NAME,
    description: SECRET_DESCRIPTION,
    backstageUrl: null,
    systemType: "uavklart",
    businessCriticality: "ikke_vurdert",
    userReach: "ikke_vurdert",
    knowledgeMemberRefs: [],
    createdAt: new Date(0),
    createdBy: "admin-1",
    updatedAt: new Date(0),
    updatedBy: "admin-1",
    ...allAssessments(),
    ...overrides,
  };
}

/** Flips one character of a stored envelope's ciphertext, keeping it base64-shaped. */
function tamper(envelope: unknown): unknown {
  const e = envelope as { ciphertext: string };
  const first = e.ciphertext[0] === "A" ? "B" : "A";
  return { ...e, ciphertext: first + e.ciphertext.slice(1) };
}

describe("team system encryption: one canonical stored shape", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  it("writes every supported attribute at the top level with its own sealed note, and no nested assessments field", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system());
    expect(persisted).not.toHaveProperty("assessments");
    for (const attribute of ASSESSMENT_ATTRIBUTES) expect(persisted).toHaveProperty(attribute);
    expect(persisted.security).toMatchObject({ value: "trenger_oppfolging", assessedBy: "admin-1" });
    expect((persisted.security as { note: { ciphertext: unknown } }).note).toHaveProperty("ciphertext");
    expect(persisted.availability).toMatchObject({ value: "ikke_vurdert", note: null });
  });

  it("stores no plaintext business content anywhere in the document (name, description, note)", () => {
    const serialized = JSON.stringify(toPersistedTeamSystem(SYSTEM_ID, system()));
    expect(serialized).not.toContain(SECRET_NAME);
    expect(serialized).not.toContain(SECRET_DESCRIPTION);
    expect(serialized).not.toContain(SECRET_NOTE);
    expect(Object.hasOwn(toPersistedTeamSystem(SYSTEM_ID, system()), "name")).toBe(false);
  });

  it("round-trips every supported value, the name, the description and the decrypted note", () => {
    const opened = openTeamSystemDocument(SYSTEM_ID, toPersistedTeamSystem(SYSTEM_ID, system())) as Record<string, unknown>;
    expect(opened).toMatchObject({ name: SECRET_NAME, description: SECRET_DESCRIPTION });
    expect(opened.security).toMatchObject({ value: "trenger_oppfolging", note: SECRET_NOTE });
    expect(opened.availability).toMatchObject({ value: "ikke_vurdert", note: null });
  });

  it("refuses a note moved to another attribute of the same system (record-specific AAD)", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system()) as Record<string, Record<string, unknown>>;
    const moved = { ...persisted, reliability: { ...persisted.reliability, note: persisted.security.note } };
    const opened = openTeamSystemDocument(SYSTEM_ID, moved) as Record<string, Record<string, unknown>>;
    expect(opened.reliability.note).toBe(false);
  });

  it("refuses content moved to another system (substitution of the whole document)", () => {
    const opened = openTeamSystemDocument("sys-2", toPersistedTeamSystem(SYSTEM_ID, system())) as Record<string, unknown>;
    expect(opened.name).toBeUndefined();
    expect(opened.description).toBeUndefined();
  });

  it("refuses a tampered note envelope: the note is refused, never read", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system()) as Record<string, Record<string, unknown>>;
    const tampered = { ...persisted, security: { ...persisted.security, note: tamper(persisted.security.note) } };
    const opened = openTeamSystemDocument(SYSTEM_ID, tampered) as Record<string, Record<string, unknown>>;
    expect(opened.security.note).toBe(false);
  });

  it("refuses a tampered content envelope: name and description are omitted", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system());
    const tampered = { ...persisted, content: tamper(persisted.content) };
    const opened = openTeamSystemDocument(SYSTEM_ID, tampered) as Record<string, unknown>;
    expect(opened.name).toBeUndefined();
  });

  it("refuses a plaintext name or description (no plaintext fallback)", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system());
    expect(openTeamSystemDocument(SYSTEM_ID, { ...persisted, name: SECRET_NAME })).toBeNull();
    expect(openTeamSystemDocument(SYSTEM_ID, { ...persisted, description: SECRET_DESCRIPTION })).toBeNull();
  });

  it("refuses a plaintext attribute note (no plaintext fallback)", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system()) as Record<string, Record<string, unknown>>;
    const plain = { ...persisted, security: { ...persisted.security, note: SECRET_NOTE } };
    const opened = openTeamSystemDocument(SYSTEM_ID, plain) as Record<string, Record<string, unknown>>;
    expect(opened.security.note).toBe(false);
  });

  it("fails closed when the encryption key is missing on write and on read", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system());
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openTeamSystemDocument(SYSTEM_ID, persisted)).toThrow();
    expect(() => toPersistedTeamSystem(SYSTEM_ID, system())).toThrow();
  });

  it("keeps the audit actor plaintext on the stored document and returns it only on the domain record, not in any name or note", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system()) as Record<string, Record<string, unknown>>;
    expect(persisted.security.assessedBy).toBe("admin-1");
    expect(JSON.stringify(persisted)).not.toContain(SECRET_NOTE);
  });
});

describe("system classification: sealed with the content, never plaintext", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  const CLASSIFICATION = { systemType: "eksternt", businessCriticality: "kritisk", userReach: "virksomhetsomfattende" };

  it("seals the classification and stores no plaintext copy of it", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system(CLASSIFICATION));
    expect(persisted).not.toHaveProperty("systemType");
    expect(persisted).not.toHaveProperty("businessCriticality");
    expect(persisted).not.toHaveProperty("userReach");
    expect(JSON.stringify(persisted)).not.toContain("virksomhetsomfattende");
    expect(JSON.stringify(persisted)).not.toContain("eksternt");
  });

  it("round-trips the classification through open", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system(CLASSIFICATION));
    const opened = openTeamSystemDocument(SYSTEM_ID, persisted) as Record<string, unknown>;
    expect(opened).toMatchObject(CLASSIFICATION);
    expect(opened.name).toBe(SECRET_NAME);
  });

  it("opens a legacy document that has no classification content without inventing one", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system({ systemType: "uavklart", businessCriticality: "ikke_vurdert", userReach: "ikke_vurdert" }));
    const opened = openTeamSystemDocument(SYSTEM_ID, persisted) as Record<string, unknown>;
    expect(opened.businessCriticality).toBe("ikke_vurdert");
  });

  it("refuses a document that carries the classification in plaintext", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system(CLASSIFICATION));
    const withPlaintext = { ...persisted, businessCriticality: "kritisk" };
    expect(openTeamSystemDocument(SYSTEM_ID, withPlaintext)).toBeNull();
  });
});
