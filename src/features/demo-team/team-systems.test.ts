import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TEAM_SYSTEMS, teamSystemRecord } from "./fixtures";
import { demoCrypto } from "./crypto";
import { buildDemoSeedPlan } from "./plan";
import { ASSESSMENT_ATTRIBUTES, needsAttention } from "../team-systems/domain/team-system";
import { openTeamSystemDocument, toPersistedTeamSystem } from "../team-systems/server/team-system-codec";

/**
 * Team systems (Systemoversikt) fixtures and the corrected encryption shape. Offline: the real codec and a test-only key, so
 * the AAD binding and envelope checks run for real. Synthetic data only.
 */
const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-13T00:00:00.000Z");
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("team system fixtures", () => {
  it("each fixture carries every supported attribute at the top level, with the demo actor on assessed attributes only", () => {
    for (const s of DEMO_TEAM_SYSTEMS) {
      const record = teamSystemRecord(s, TEAM, AS_OF) as Record<string, Record<string, unknown>>;
      for (const attribute of ASSESSMENT_ATTRIBUTES) {
        expect(record[attribute]).toBeDefined();
        if (record[attribute].value === "ikke_vurdert") expect(record[attribute].assessedBy).toBeNull();
        else expect(record[attribute].assessedBy).toBe("demo-seed");
      }
    }
  });

  it("derives the overview's follow-up count from the actual assessments: 6 systems need follow-up, 2 are healthy", () => {
    const counts = DEMO_TEAM_SYSTEMS.map((s) => {
      const record = teamSystemRecord(s, TEAM, AS_OF) as Record<string, Record<string, { value: string }>>;
      const assessments = Object.fromEntries(ASSESSMENT_ATTRIBUTES.map((a) => [a, record[a]]));
      return needsAttention(assessments as never);
    });
    expect(counts.filter(Boolean)).toHaveLength(6);
    expect(counts.filter((c) => !c)).toHaveLength(2);
  });

  it("uses only supported assessment values", () => {
    const allowed = ["god", "trenger_oppfolging", "kritisk", "ikke_vurdert"];
    for (const s of DEMO_TEAM_SYSTEMS) {
      for (const assessment of Object.values(s.assessments)) expect(allowed).toContain(assessment?.value);
    }
  });
});

describe("team system encryption in the plan", () => {
  const plan = () => buildDemoSeedPlan({ presenterUid: PRESENTER, teamId: TEAM, asOf: AS_OF, sealRecord: demoCrypto.sealRecord });

  it("never stores a system name, description or assessment note as plaintext", () => {
    const serialized = JSON.stringify(plan().operations.filter((op) => op.collection === "teamSystems"));
    for (const s of DEMO_TEAM_SYSTEMS) {
      expect(serialized).not.toContain(s.name);
      expect(serialized).not.toContain(s.description);
      for (const assessment of Object.values(s.assessments)) {
        if (assessment?.note) expect(serialized).not.toContain(assessment.note);
      }
    }
  });

  it("plans one create-only system per fixture, in the selected team, with stable ids", () => {
    const systems = plan().operations.filter((op) => op.collection === "teamSystems");
    expect(systems.map((op) => op.docId)).toEqual(DEMO_TEAM_SYSTEMS.map((s) => s.systemId));
    expect(systems.every((op) => op.writeClass === "C")).toBe(true);
    expect(systems.every((op) => (op.data as { teamId: string }).teamId === TEAM)).toBe(true);
  });
});

describe("team system round trip and binding", () => {
  const fixture = DEMO_TEAM_SYSTEMS[2];

  it("round-trips the name, description and every decrypted note", () => {
    const stored = toPersistedTeamSystem(fixture.systemId, teamSystemRecord(fixture, TEAM, AS_OF), demoCrypto.sealRecord);
    const opened = openTeamSystemDocument(fixture.systemId, stored, demoCrypto.openRecord) as Record<string, Record<string, unknown>>;
    expect(opened.name).toBe(fixture.name);
    expect(opened.description).toBe(fixture.description);
    expect(opened.reliability.note).toBe(fixture.assessments.reliability?.note);
  });

  it("refuses a note moved to another system or another attribute (record-specific AAD)", () => {
    const stored = toPersistedTeamSystem(fixture.systemId, teamSystemRecord(fixture, TEAM, AS_OF), demoCrypto.sealRecord) as Record<string, Record<string, unknown>>;
    const otherSystem = openTeamSystemDocument("demo-system-other", stored, demoCrypto.openRecord) as Record<string, unknown>;
    expect(otherSystem.name).toBeUndefined();
    const moved = { ...stored, maintainability: { ...stored.maintainability, note: stored.reliability.note } };
    const opened = openTeamSystemDocument(fixture.systemId, moved, demoCrypto.openRecord) as Record<string, Record<string, unknown>>;
    expect(opened.maintainability.note).toBe(false);
  });

  it("refuses a tampered note envelope and a plaintext note", () => {
    const stored = toPersistedTeamSystem(fixture.systemId, teamSystemRecord(fixture, TEAM, AS_OF), demoCrypto.sealRecord) as Record<string, Record<string, unknown>>;
    const envelope = stored.reliability.note as { ciphertext: string };
    const tampered = { ...stored, reliability: { ...stored.reliability, note: { ...envelope, ciphertext: (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1) } } };
    expect((openTeamSystemDocument(fixture.systemId, tampered, demoCrypto.openRecord) as Record<string, Record<string, unknown>>).reliability.note).toBe(false);
    const plain = { ...stored, reliability: { ...stored.reliability, note: "Klartekst" } };
    expect((openTeamSystemDocument(fixture.systemId, plain, demoCrypto.openRecord) as Record<string, Record<string, unknown>>).reliability.note).toBe(false);
  });

  it("fails closed when the encryption key is missing", () => {
    const stored = toPersistedTeamSystem(fixture.systemId, teamSystemRecord(fixture, TEAM, AS_OF), demoCrypto.sealRecord);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openTeamSystemDocument(fixture.systemId, stored, demoCrypto.openRecord)).toThrow();
  });
});
