import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openTeamSystemDocument, toPersistedTeamSystem } from "./team-system-codec";

const SYSTEM_ID = "sys-1";

function assessments(noteText: string | null) {
  const empty = { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null };
  return {
    ...Object.fromEntries(["availability", "deployability", "maintainability", "observability", "reliability", "testability"].map((k) => [k, empty])),
    security: { value: "god", note: noteText, assessedAt: new Date(0), assessedBy: "admin-1" },
  };
}

const system = {
  teamId: "team-1",
  name: "Betalingsløsning",
  description: "Hemmelig beskrivelse",
  backstageUrl: null,
  assessments: assessments("Privat vurdering"),
  knowledgeMemberRefs: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("team system content codec", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  it("persists name, description and the attribute note only as envelopes", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system);
    expect(Object.hasOwn(persisted, "name")).toBe(false);
    expect(Object.hasOwn(persisted, "description")).toBe(false);
    expect(JSON.stringify(persisted)).not.toMatch(/Betalings|Hemmelig|Privat vurdering/);
  });

  it("keeps the attribute value, timestamp and audit actor plaintext", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system) as { assessments: Record<string, Record<string, unknown>> };
    expect(persisted.assessments.security).toMatchObject({ value: "god", assessedBy: "admin-1" });
    expect(persisted.assessments.availability.note).toBeNull();
  });

  it("opens the content back for the same system and team", () => {
    const opened = openTeamSystemDocument(SYSTEM_ID, toPersistedTeamSystem(SYSTEM_ID, system)) as Record<string, unknown>;
    expect(opened).toMatchObject({ name: "Betalingsløsning", description: "Hemmelig beskrivelse" });
    expect((opened.assessments as Record<string, Record<string, unknown>>).security.note).toBe("Privat vurdering");
  });

  it("refuses content moved to another system (substitution)", () => {
    const opened = openTeamSystemDocument("sys-2", toPersistedTeamSystem(SYSTEM_ID, system)) as Record<string, unknown>;
    expect(opened.name).toBeUndefined();
  });

  it("refuses a note moved to another attribute of the same system", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system) as { assessments: Record<string, Record<string, unknown>> };
    const moved = { ...persisted, assessments: { ...persisted.assessments, reliability: { ...persisted.assessments.reliability, note: persisted.assessments.security.note } } };
    const opened = openTeamSystemDocument(SYSTEM_ID, moved) as { assessments: Record<string, Record<string, unknown>> };
    expect(opened.assessments.reliability.note).toBe(false);
  });

  it("refuses a plaintext name or description (no plaintext fallback)", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system);
    expect(openTeamSystemDocument(SYSTEM_ID, { ...persisted, name: "Betalingsløsning" })).toBeNull();
  });

  it("refuses a plaintext attribute note", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system) as { assessments: Record<string, Record<string, unknown>> };
    const plain = { ...persisted, assessments: { ...persisted.assessments, security: { ...persisted.assessments.security, note: "Privat vurdering" } } };
    const opened = openTeamSystemDocument(SYSTEM_ID, plain) as { assessments: Record<string, Record<string, unknown>> };
    expect(opened.assessments.security.note).toBe(false);
  });

  it("fails closed when the key is missing", () => {
    const persisted = toPersistedTeamSystem(SYSTEM_ID, system);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openTeamSystemDocument(SYSTEM_ID, persisted)).toThrow();
  });
});
