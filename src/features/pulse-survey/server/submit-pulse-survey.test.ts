import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTeamsSource, PulseSurveyCollection } from "./submit-pulse-survey";
import { submitPulseSurvey } from "./submit-pulse-survey";

// The four legacy team identifiers the pulse survey used before TASK-006
// (formerly `ALLOWED_TEAM_IDS`, deleted in TASK-011) — inlined here only to
// prove the tests below don't depend on that retired static list for
// authorization.
const LEGACY_TEAM_IDS = ["platform", "web-app", "mobile", "data-platform"];

const validPayload = {
  answers: [1, 5, 3],
  teamId: "platform",
};

function fakeCollection(
  overrides: Partial<PulseSurveyCollection> = {},
): PulseSurveyCollection & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    add: vi.fn(async (record) => {
      writes.push(record);
      return { id: "fake-id" };
    }),
    ...overrides,
  };
}

function fakeActiveTeams(
  teams: Array<{ teamId: string; name: string }> = [
    { teamId: "platform", name: "platform" },
  ],
): ActiveTeamsSource {
  return { listActive: vi.fn().mockResolvedValue({ ok: true, teams }) };
}

describe("submitPulseSurvey", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists exactly one minimal-shape, encrypted document for a valid, currently-active team", async () => {
    const collection = fakeCollection();
    const activeTeams = fakeActiveTeams();

    const result = await submitPulseSurvey(validPayload, {
      now: new Date("2026-09-01T00:00:00Z"),
      collection,
      activeTeams,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);

    const written = collection.writes[0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(
      ["authTag", "ciphertext", "iv", "keyVersion", "period", "teamId"].sort(),
    );
    expect(written.teamId).toBe("platform");
    expect(written.period).toBe("2026-W36");
    expect(typeof written.ciphertext).toBe("string");
    expect(typeof written.iv).toBe("string");
    expect(typeof written.authTag).toBe("string");
    expect(written.keyVersion).toBe("v1");
  });

  it("never persists the raw answer values in plaintext", async () => {
    const collection = fakeCollection();

    await submitPulseSurvey(validPayload, { collection, activeTeams: fakeActiveTeams() });

    const written = JSON.stringify(collection.writes[0]);
    expect(written).not.toContain("1,5,3");
    expect(written).not.toMatch(/"answers"/);
  });

  it("rejects an invalid submission and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(
      { answers: [1, 6, 3], teamId: "platform" },
      { collection, activeTeams: fakeActiveTeams() },
    );

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a nonexistent teamId and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(
      { answers: [1, 5, 3], teamId: "not-a-team" },
      { collection, activeTeams: fakeActiveTeams([{ teamId: "platform", name: "platform" }]) },
    );

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a disabled teamId (excluded from the active set) identically to an unknown one, and attempts no write", async () => {
    const collection = fakeCollection();
    // The active-teams source (list-active-teams.ts) already excludes
    // disabled teams from its result — from this operation's perspective a
    // disabled team simply is not present in the active set.
    const activeTeams = fakeActiveTeams([{ teamId: "web-app", name: "web-app" }]);

    const result = await submitPulseSurvey(
      { answers: [1, 5, 3], teamId: "platform" },
      { collection, activeTeams },
    );

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("accepts a teamId that is NOT one of the four legacy team ids, proving legacy-id membership is not required for authorization", async () => {
    const collection = fakeCollection();
    const opaqueFirestoreTeamId = "a1B2c3D4e5F6-opaque-firestore-doc-id";
    expect(LEGACY_TEAM_IDS).not.toContain(opaqueFirestoreTeamId);
    const activeTeams = fakeActiveTeams([
      { teamId: opaqueFirestoreTeamId, name: "Newly Created Team" },
    ]);

    const result = await submitPulseSurvey(
      { answers: [1, 5, 3], teamId: opaqueFirestoreTeamId },
      { collection, activeTeams },
    );

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);
  });

  it("rejects a teamId that IS one of the four legacy team ids but is absent from the current active set, proving legacy-id membership is not sufficient for authorization", async () => {
    const collection = fakeCollection();
    const legacyTeamId = LEGACY_TEAM_IDS[0];
    const activeTeams = fakeActiveTeams([]);

    const result = await submitPulseSurvey(
      { answers: [1, 5, 3], teamId: legacyTeamId },
      { collection, activeTeams },
    );

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a teamId excluded for being malformed identically to any other invalid teamId, and attempts no write", async () => {
    const collection = fakeCollection();
    // A malformed `teams` document is already excluded upstream by
    // list-active-teams.ts; here it is simply absent from the active set.
    const activeTeams = fakeActiveTeams([]);

    const result = await submitPulseSurvey(validPayload, { collection, activeTeams });

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a team that was active when the selector loaded but was disabled before submission (TOCTOU) — active-team membership is re-checked fresh on every call, not cached", async () => {
    const collection = fakeCollection();
    const listActive = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, teams: [{ teamId: "platform", name: "platform" }] })
      .mockResolvedValueOnce({ ok: true, teams: [] });
    const activeTeams: ActiveTeamsSource = { listActive };

    const atLoadTime = await submitPulseSurvey(validPayload, { collection, activeTeams });
    const afterDisabling = await submitPulseSurvey(validPayload, { collection, activeTeams });

    expect(atLoadTime).toEqual({ ok: true });
    expect(afterDisabling).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(1);
    expect(listActive).toHaveBeenCalledTimes(2);
  });

  it("does not leak a distinguishing signal between a structurally invalid submission and a valid-shape but inactive teamId", async () => {
    const invalidShape = await submitPulseSurvey(
      { answers: [1, 5], teamId: "platform" },
      { collection: fakeCollection(), activeTeams: fakeActiveTeams() },
    );
    const inactiveTeam = await submitPulseSurvey(
      { answers: [1, 5, 3], teamId: "not-a-team" },
      { collection: fakeCollection(), activeTeams: fakeActiveTeams() },
    );

    expect(invalidShape).toEqual(inactiveTeam);
  });

  it("rejects a malformed (non-object) payload and attempts no write", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey("not an object", {
      collection,
      activeTeams: fakeActiveTeams(),
    });

    expect(result).toEqual({ ok: false, error: "invalid_submission" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed with team_validation_failed, not a write, when the active-team read fails", async () => {
    const collection = fakeCollection();
    const activeTeams: ActiveTeamsSource = {
      listActive: vi.fn().mockResolvedValue({ ok: false, error: "read_failed" }),
    };

    const result = await submitPulseSurvey(validPayload, { collection, activeTeams });

    expect(result).toEqual({ ok: false, error: "team_validation_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed with team_validation_failed, not a write, when the active-team check throws", async () => {
    const collection = fakeCollection();
    const activeTeams: ActiveTeamsSource = {
      listActive: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await submitPulseSurvey(validPayload, { collection, activeTeams });

    expect(result).toEqual({ ok: false, error: "team_validation_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports failure, not partial success, when the Firestore write fails", async () => {
    const collection = fakeCollection({
      add: vi.fn(async () => {
        throw new Error("simulated firestore outage");
      }),
    });

    const result = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: fakeActiveTeams(),
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails closed with a generic error and attempts no write when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const collection = fakeCollection();

    const result = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: fakeActiveTeams(),
    });

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed with a generic error and attempts no write when ENCRYPTION_KEY is invalid", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "abc");
    const collection = fakeCollection();

    const result = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: fakeActiveTeams(),
    });

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("allows two submissions for the same period to both succeed independently", async () => {
    const collection = fakeCollection();

    const first = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: fakeActiveTeams(),
    });
    const second = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: fakeActiveTeams(),
    });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(2);
  });

  it("produces distinct ciphertext for two submissions with identical answers", async () => {
    const collection = fakeCollection();

    await submitPulseSurvey(validPayload, { collection, activeTeams: fakeActiveTeams() });
    await submitPulseSurvey(validPayload, { collection, activeTeams: fakeActiveTeams() });

    const [first, second] = collection.writes as Array<Record<string, unknown>>;
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it("uses the server-computed period, ignoring any client-supplied period value", async () => {
    const collection = fakeCollection();

    const result = await submitPulseSurvey(
      { ...validPayload, period: "2020-W01" },
      { now: new Date("2026-09-01T00:00:00Z"), collection, activeTeams: fakeActiveTeams() },
    );

    expect(result).toEqual({ ok: true });
    expect((collection.writes[0] as Record<string, unknown>).period).toBe(
      "2026-W36",
    );
  });

  it("never logs the request payload, answers, or key material for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const collection = fakeCollection();
    await submitPulseSurvey(validPayload, { collection, activeTeams: fakeActiveTeams() });

    const failingCollection = fakeCollection({
      add: vi.fn(async () => {
        throw new Error("simulated firestore outage");
      }),
    });
    await submitPulseSurvey(validPayload, {
      collection: failingCollection,
      activeTeams: fakeActiveTeams(),
    });

    vi.stubEnv("ENCRYPTION_KEY", "");
    const encryptionFailureResult = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: fakeActiveTeams(),
    });

    expect(encryptionFailureResult).toEqual({
      ok: false,
      error: "encryption_failed",
    });

    const teamValidationFailureResult = await submitPulseSurvey(validPayload, {
      collection,
      activeTeams: {
        listActive: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      },
    });

    expect(teamValidationFailureResult).toEqual({
      ok: false,
      error: "team_validation_failed",
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
