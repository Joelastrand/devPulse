import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openManualAssessmentDocument, sealManualAssessmentFields } from "./manual-assessment-codec";

const teamId = "team-1";
const skillId = "skill-1";

function stored(fields: { level: unknown; note: unknown }) {
  return { teamId, skillId, criteriaVersion: 2, updatedAt: new Date(0), updatedBy: "admin-1", ...fields };
}

describe("manual assessment codec (agreed team level and note)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens the sealed level and note for the same team and skill", () => {
    const sealed = sealManualAssessmentFields(teamId, skillId, { level: 3, note: "Agreed in retro" });
    expect(openManualAssessmentDocument(teamId, skillId, stored(sealed))).toMatchObject({ level: 3, note: "Agreed in retro" });
  });

  it("keeps a missing note as plaintext null", () => {
    const sealed = sealManualAssessmentFields(teamId, skillId, { level: 2, note: null });
    expect(sealed.note).toBeNull();
    expect(openManualAssessmentDocument(teamId, skillId, stored(sealed))).toMatchObject({ level: 2, note: null });
  });

  it("does not expose the level or note in the sealed document", () => {
    const sealed = sealManualAssessmentFields(teamId, skillId, { level: 4, note: "Hemmelig notat" });
    expect(JSON.stringify(sealed)).not.toContain("Hemmelig");
    expect(JSON.stringify(sealed)).not.toMatch(/"level":4/);
  });

  it("refuses a level envelope moved into the note field (context separation)", () => {
    const sealed = sealManualAssessmentFields(teamId, skillId, { level: 3, note: "x" });
    const swapped = openManualAssessmentDocument(teamId, skillId, stored({ level: sealed.level, note: sealed.level }));
    expect((swapped as { note: unknown }).note).not.toBe(3);
    expect(typeof (swapped as { note: unknown }).note).not.toBe("string");
  });

  it("refuses a sealed level moved to another skill of the same team", () => {
    const sealed = sealManualAssessmentFields(teamId, skillId, { level: 3, note: null });
    const opened = openManualAssessmentDocument(teamId, "skill-2", stored({ level: sealed.level, note: null }));
    expect((opened as { level: unknown }).level).toBeUndefined();
  });

  it("refuses a plaintext level and a plaintext note (no plaintext fallback)", () => {
    const opened = openManualAssessmentDocument(teamId, skillId, stored({ level: 3, note: "klartekst" }));
    expect((opened as { level: unknown }).level).toBeUndefined();
    expect((opened as { note: unknown }).note).toBeUndefined();
  });

  it("fails closed when the encryption key is missing", () => {
    const sealed = sealManualAssessmentFields(teamId, skillId, { level: 1, note: "n" });
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openManualAssessmentDocument(teamId, skillId, stored(sealed))).toThrow();
  });
});
