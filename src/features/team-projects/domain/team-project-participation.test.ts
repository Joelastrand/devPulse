import { describe, expect, it } from "vitest";
import {
  hasOverlappingParticipation,
  PARTICIPATION_NOTE_MAX_LENGTH,
  parseStoredParticipation,
  participationIntervalsOverlap,
  validateParticipationFields,
} from "./team-project-participation";

// Synthetic, obviously fictional member reference (26 lowercase Crockford base32 characters).
const MEMBER = "0123456789abcdefghjkmnpqrs";
const OTHER_MEMBER = "tvwxyz0123456789abcdefghjk";

const valid = {
  projectId: "project-1",
  memberRef: MEMBER,
  startDate: "2026-06-01",
  endDate: "2026-06-30",
};

describe("validateParticipationFields", () => {
  it("accepts a complete participation and keeps a trimmed note", () => {
    expect(validateParticipationFields({ ...valid, note: "  Integrasjon  " })).toEqual({
      ok: true,
      value: { ...valid, note: "Integrasjon" },
    });
  });

  it("drops a blank note instead of storing an empty string", () => {
    const result = validateParticipationFields({ ...valid, note: "   " });
    expect(result.ok && "note" in result.value).toBe(false);
  });

  it("reports every missing or invalid field at once", () => {
    expect(validateParticipationFields({ projectId: " ", memberRef: "not-a-ref", startDate: "2026-02-30", endDate: undefined })).toEqual({
      ok: false,
      issues: ["project_id_required", "member_ref_invalid", "start_date_invalid", "end_date_invalid"],
    });
  });

  it("rejects a member reference that is not in the opaque 26-character format", () => {
    expect(validateParticipationFields({ ...valid, memberRef: "a".repeat(25) })).toEqual({ ok: false, issues: ["member_ref_invalid"] });
    expect(validateParticipationFields({ ...valid, memberRef: "user-uid-1" })).toEqual({ ok: false, issues: ["member_ref_invalid"] });
  });

  it("rejects end before start and accepts a single-day interval", () => {
    expect(validateParticipationFields({ ...valid, startDate: "2026-07-01", endDate: "2026-06-30" })).toEqual({ ok: false, issues: ["end_before_start"] });
    expect(validateParticipationFields({ ...valid, startDate: "2026-07-01", endDate: "2026-07-01" }).ok).toBe(true);
  });

  it("enforces the note length bound and rejects non-string notes", () => {
    expect(validateParticipationFields({ ...valid, note: "x".repeat(PARTICIPATION_NOTE_MAX_LENGTH + 1) })).toEqual({ ok: false, issues: ["note_too_long"] });
    expect(validateParticipationFields({ ...valid, note: 42 })).toEqual({ ok: false, issues: ["note_invalid"] });
  });

  it("rejects non-object input", () => {
    expect(validateParticipationFields(null).ok).toBe(false);
    expect(validateParticipationFields("x").ok).toBe(false);
  });
});

describe("participation overlap (informational only)", () => {
  it("treats shared endpoints as overlapping and adjacent intervals as not overlapping", () => {
    expect(participationIntervalsOverlap({ startDate: "2026-06-01", endDate: "2026-06-10" }, { startDate: "2026-06-10", endDate: "2026-06-20" })).toBe(true);
    expect(participationIntervalsOverlap({ startDate: "2026-06-01", endDate: "2026-06-10" }, { startDate: "2026-06-11", endDate: "2026-06-20" })).toBe(false);
  });

  it("flags overlap only for the same member", () => {
    const existing = [{ memberRef: MEMBER, startDate: "2026-06-01", endDate: "2026-06-30" }];
    expect(hasOverlappingParticipation({ memberRef: MEMBER, startDate: "2026-06-15", endDate: "2026-07-15" }, existing)).toBe(true);
    expect(hasOverlappingParticipation({ memberRef: OTHER_MEMBER, startDate: "2026-06-15", endDate: "2026-07-15" }, existing)).toBe(false);
  });

  it("handles a year boundary by calendar order", () => {
    expect(participationIntervalsOverlap({ startDate: "2026-12-20", endDate: "2027-01-05" }, { startDate: "2027-01-01", endDate: "2027-01-02" })).toBe(true);
  });
});

describe("parseStoredParticipation", () => {
  const stored = { ...valid, teamId: "team-a", archived: false };

  it("parses a valid record for its own team", () => {
    expect(parseStoredParticipation(stored, "pp-1", "team-a")).toEqual({ participationId: "pp-1", teamId: "team-a", ...valid, archived: false });
  });

  it("rejects a record from another team", () => {
    expect(parseStoredParticipation(stored, "pp-1", "team-b")).toBeNull();
  });

  it("rejects a missing archived flag or empty id", () => {
    expect(parseStoredParticipation({ ...stored, archived: undefined }, "pp-1", "team-a")).toBeNull();
    expect(parseStoredParticipation(stored, "", "team-a")).toBeNull();
  });

  it("rejects a malformed stored member reference instead of coercing it", () => {
    expect(parseStoredParticipation({ ...stored, memberRef: "bad" }, "pp-1", "team-a")).toBeNull();
  });

  it("rejects a stored note that only validates after trimming", () => {
    expect(parseStoredParticipation({ ...stored, note: "  padded  " }, "pp-1", "team-a")).toBeNull();
  });

  it("rejects an invalid stored interval", () => {
    expect(parseStoredParticipation({ ...stored, startDate: "2026-07-01", endDate: "2026-06-01" }, "pp-1", "team-a")).toBeNull();
  });

  it("never returns a utilization, capacity or performance field", () => {
    const parsed = parseStoredParticipation({ ...stored, utilization: 0.8, capacity: 40 }, "pp-1", "team-a");
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {})).not.toEqual(expect.arrayContaining(["utilization", "capacity"]));
  });
});
