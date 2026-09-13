import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type {
  CreateSurveyDeps,
  SurveyRecord,
  SurveysCollection,
  TeamStatusReader,
} from "./create-survey";
import { createSurvey } from "./create-survey";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-42";
const NOW = new Date("2026-09-01T00:00:00Z");

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function fakeSurveysCollection(): SurveysCollection & { writes: SurveyRecord[] } {
  const writes: SurveyRecord[] = [];
  return {
    writes,
    add: vi.fn(async (record: SurveyRecord) => {
      writes.push(record);
      return { id: `generated-survey-${writes.length}` };
    }),
  };
}

function fakeTeamStatusReader(status: unknown): TeamStatusReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getTeamStatus: vi.fn(async (teamId: string) => {
      calls.push(teamId);
      return status;
    }),
  };
}

function baseDeps(overrides: Partial<CreateSurveyDeps> = {}): CreateSurveyDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    collection: fakeSurveysCollection(),
    teamStatusReader: fakeTeamStatusReader("active"),
    now: NOW,
    ...overrides,
  };
}

describe("createSurvey", () => {
  it("creates a scheduled survey for an app admin with only accessMode and minimumResponses provided", async () => {
    const collection = fakeSurveysCollection();
    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection }),
    );

    expect(result).toEqual({ ok: true, surveyId: "generated-survey-1" });
    expect(collection.writes).toEqual([
      {
        teamId: TEAM_ID,
        accessMode: "public",
        minimumResponses: 5,
        createdAt: NOW,
        createdBy: ADMIN_UID,
      },
    ]);
  });

  it("persists exactly the intended managed-survey shape with every optional field set, and no others", async () => {
    const collection = fakeSurveysCollection();
    const result = await createSurvey(
      "token",
      TEAM_ID,
      {
        accessMode: "authenticated",
        minimumResponses: 10,
        title: "Q3 pulse",
        startAt: "2026-10-01T00:00:00.000Z",
        endAt: "2026-10-15T00:00:00.000Z",
      },
      baseDeps({ collection }),
    );

    expect(result.ok).toBe(true);
    expect(collection.writes).toHaveLength(1);
    const stored = collection.writes[0];
    expect(stored).toEqual({
      teamId: TEAM_ID,
      accessMode: "authenticated",
      minimumResponses: 10,
      title: "Q3 pulse",
      startAt: new Date("2026-10-01T00:00:00.000Z"),
      endAt: new Date("2026-10-15T00:00:00.000Z"),
      createdAt: NOW,
      createdBy: ADMIN_UID,
    });
    // No lifecycle field is ever written at creation (TASK-001's
    // effectiveLifecycle reads their absence as "scheduled").
    expect(stored).not.toHaveProperty("openedAt");
    expect(stored).not.toHaveProperty("closedAt");
    expect(stored).not.toHaveProperty("archivedAt");
    expect(stored).not.toHaveProperty("surveyId");
  });

  it("never persists any respondent-identity or response-shaped field", async () => {
    const collection = fakeSurveysCollection();
    await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection }),
    );

    const stored = collection.writes[0];
    for (const forbiddenField of [
      "uid",
      "email",
      "ciphertext",
      "iv",
      "authTag",
      "keyVersion",
      "submittedAt",
      "ip",
      "responses",
    ]) {
      expect(stored).not.toHaveProperty(forbiddenField);
    }
  });

  it("returns a server-generated surveyId, never derived from title/teamId", async () => {
    const collection = fakeSurveysCollection();
    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5, title: "Some Survey Title" },
      baseDeps({ collection }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.surveyId).not.toContain("some");
    expect(result.surveyId).not.toContain("survey-title");
    expect(result.surveyId).not.toContain(TEAM_ID);
  });

  it("derives createdBy from the verified admin identity, never from the request", async () => {
    const collection = fakeSurveysCollection();
    await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5, createdBy: "attacker-uid" },
      baseDeps({ collection }),
    );

    expect(collection.writes[0].createdBy).toBe(ADMIN_UID);
  });

  it("ignores a client-supplied teamId in the request body — the route-scoped teamId always wins", async () => {
    const collection = fakeSurveysCollection();
    await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5, teamId: "attacker-team" },
      baseDeps({ collection }),
    );

    expect(collection.writes[0].teamId).toBe(TEAM_ID);
  });

  it("ignores a client-supplied surveyId or lifecycle-shaped field in the request body", async () => {
    const collection = fakeSurveysCollection();
    await createSurvey(
      "token",
      TEAM_ID,
      {
        accessMode: "public",
        minimumResponses: 5,
        surveyId: "attacker-chosen-id",
        openedAt: "2026-01-01T00:00:00.000Z",
        closedAt: "2026-01-02T00:00:00.000Z",
        archivedAt: "2026-01-03T00:00:00.000Z",
      },
      baseDeps({ collection }),
    );

    const stored = collection.writes[0];
    expect(stored).not.toHaveProperty("surveyId");
    expect(stored).not.toHaveProperty("openedAt");
    expect(stored).not.toHaveProperty("closedAt");
    expect(stored).not.toHaveProperty("archivedAt");
  });

  it("rejects an unauthenticated caller and reads no team status, attempts no write", async () => {
    const collection = fakeSurveysCollection();
    const teamStatusReader = fakeTeamStatusReader("active");
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await createSurvey(
      "bad-token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection, teamStatusReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.writes).toHaveLength(0);
    expect(teamStatusReader.calls).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeSurveysCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a non-object input body", async () => {
    const collection = fakeSurveysCollection();
    const result = await createSurvey("token", TEAM_ID, null, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a missing or invalid accessMode and attempts no write", async () => {
    const collection = fakeSurveysCollection();

    const missing = await createSurvey(
      "token",
      TEAM_ID,
      { minimumResponses: 5 },
      baseDeps({ collection }),
    );
    const invalid = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "private", minimumResponses: 5 },
      baseDeps({ collection }),
    );

    expect(missing).toEqual({ ok: false, error: "invalid_access_mode" });
    expect(invalid).toEqual({ ok: false, error: "invalid_access_mode" });
    expect(collection.writes).toHaveLength(0);
  });

  it("accepts a valid future startAt with no endAt", async () => {
    const collection = fakeSurveysCollection();
    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5, startAt: "2026-12-01T00:00:00.000Z" },
      baseDeps({ collection }),
    );

    expect(result.ok).toBe(true);
    expect(collection.writes[0].startAt).toEqual(new Date("2026-12-01T00:00:00.000Z"));
    expect(collection.writes[0]).not.toHaveProperty("endAt");
  });

  it("rejects an endAt at or before startAt and attempts no write", async () => {
    const collection = fakeSurveysCollection();

    const result = await createSurvey(
      "token",
      TEAM_ID,
      {
        accessMode: "public",
        minimumResponses: 5,
        startAt: "2026-12-15T00:00:00.000Z",
        endAt: "2026-12-01T00:00:00.000Z",
      },
      baseDeps({ collection }),
    );

    expect(result).toEqual({ ok: false, error: "invalid_date_range" });
    expect(collection.writes).toHaveLength(0);
  });

  it("does not consult team status at all for an invalid request (validation happens first)", async () => {
    const collection = fakeSurveysCollection();
    const teamStatusReader = fakeTeamStatusReader("active");

    await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "not-a-real-mode", minimumResponses: 5 },
      baseDeps({ collection, teamStatusReader }),
    );

    expect(teamStatusReader.calls).toHaveLength(0);
  });

  it("rejects creation for a nonexistent team and attempts no write", async () => {
    const collection = fakeSurveysCollection();
    const teamStatusReader = fakeTeamStatusReader(undefined);

    const result = await createSurvey(
      "token",
      "no-such-team",
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed (as team_not_found) on a malformed/unrecognized team status", async () => {
    const collection = fakeSurveysCollection();
    const teamStatusReader = fakeTeamStatusReader("archived");

    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects creation for a disabled team and attempts no write", async () => {
    const collection = fakeSurveysCollection();
    const teamStatusReader = fakeTeamStatusReader("disabled");

    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports a controlled failure, not a thrown error, when reading team status fails", async () => {
    const collection = fakeSurveysCollection();
    const teamStatusReader: TeamStatusReader = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports failure, not partial success, when the Firestore write fails", async () => {
    const collection: SurveysCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs the token, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps(),
    );

    const failingCollection: SurveysCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createSurvey(
      "token",
      TEAM_ID,
      { accessMode: "public", minimumResponses: 5 },
      baseDeps({ collection: failingCollection }),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("minimumResponses", () => {
    it("accepts and persists the boundary values 3 and 20", async () => {
      const collection = fakeSurveysCollection();

      await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: 3 },
        baseDeps({ collection }),
      );
      await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: 20 },
        baseDeps({ collection }),
      );

      expect(collection.writes[0].minimumResponses).toBe(3);
      expect(collection.writes[1].minimumResponses).toBe(20);
    });

    it("persists exactly the validated value, e.g. 10 — never rounds or coerces it", async () => {
      const collection = fakeSurveysCollection();
      await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: 10 },
        baseDeps({ collection }),
      );

      expect(collection.writes[0].minimumResponses).toBe(10);
    });

    it("rejects a value below 3 and attempts no write, no team-status read", async () => {
      const collection = fakeSurveysCollection();
      const teamStatusReader = fakeTeamStatusReader("active");

      const result = await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: 2 },
        baseDeps({ collection, teamStatusReader }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(collection.writes).toHaveLength(0);
      expect(teamStatusReader.calls).toHaveLength(0);
    });

    it("rejects a value above 20", async () => {
      const collection = fakeSurveysCollection();
      const result = await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: 21 },
        baseDeps({ collection }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(collection.writes).toHaveLength(0);
    });

    it("rejects a decimal value", async () => {
      const collection = fakeSurveysCollection();
      const result = await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: 5.5 },
        baseDeps({ collection }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(collection.writes).toHaveLength(0);
    });

    it("rejects a missing minimumResponses — the server never assumes 5", async () => {
      const collection = fakeSurveysCollection();
      const result = await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public" },
        baseDeps({ collection }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(collection.writes).toHaveLength(0);
    });

    it("rejects malformed values: a numeric string and NaN", async () => {
      const collection = fakeSurveysCollection();

      const stringResult = await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: "5" },
        baseDeps({ collection }),
      );
      const nanResult = await createSurvey(
        "token",
        TEAM_ID,
        { accessMode: "public", minimumResponses: Number.NaN },
        baseDeps({ collection }),
      );

      expect(stringResult).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(nanResult).toEqual({ ok: false, error: "invalid_minimum_responses" });
      expect(collection.writes).toHaveLength(0);
    });
  });
});
