import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ListTeamSurveysDeps, RawSurveyDoc, TeamSurveysCollection } from "./list-team-surveys";
import { listTeamSurveys } from "./list-team-surveys";

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

function fakeCollection(docs: RawSurveyDoc[]): TeamSurveysCollection & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listRawForTeam: vi.fn(async (teamId: string) => {
      calls.push(teamId);
      return docs;
    }),
  };
}

function surveyDoc(id: string, overrides: Record<string, unknown> = {}): RawSurveyDoc {
  return {
    id,
    data: {
      teamId: TEAM_ID,
      accessMode: "public",
      minimumResponses: 5,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdBy: ADMIN_UID,
      ...overrides,
    },
  };
}

function baseDeps(overrides: Partial<ListTeamSurveysDeps> = {}): ListTeamSurveysDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    collection: fakeCollection([]),
    now: NOW,
    ...overrides,
  };
}

describe("listTeamSurveys", () => {
  it("lists a team's surveys with derived lifecycle for an app admin", async () => {
    const collection = fakeCollection([
      surveyDoc("survey-1", { title: "Q3 pulse", openedAt: new Date("2026-02-01T00:00:00Z") }),
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result).toEqual({
      ok: true,
      surveys: [
        {
          surveyId: "survey-1",
          title: "Q3 pulse",
          accessMode: "public",
          minimumResponses: 5,
          lifecycle: "open",
          openedAt: new Date("2026-02-01T00:00:00Z"),
          archived: false,
          createdBy: ADMIN_UID,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    expect(collection.calls).toEqual([TEAM_ID]);
  });

  it("derives scheduled/closed/archived correctly and never leaks title when unset", async () => {
    const collection = fakeCollection([
      surveyDoc("scheduled-1"),
      surveyDoc("closed-1", { closedAt: new Date("2026-03-01T00:00:00Z") }),
      surveyDoc("archived-1", {
        closedAt: new Date("2026-03-01T00:00:00Z"),
        archivedAt: new Date("2026-04-01T00:00:00Z"),
      }),
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const byId = new Map(result.surveys.map((entry) => [entry.surveyId, entry]));

    expect(byId.get("scheduled-1")?.lifecycle).toBe("scheduled");
    expect(byId.get("scheduled-1")).not.toHaveProperty("title");
    expect(byId.get("closed-1")?.lifecycle).toBe("closed");
    expect(byId.get("closed-1")?.archived).toBe(false);
    expect(byId.get("archived-1")?.lifecycle).toBe("closed");
    expect(byId.get("archived-1")?.archived).toBe(true);
  });

  it("sorts newest-created first", async () => {
    const collection = fakeCollection([
      surveyDoc("older", { createdAt: new Date("2026-01-01T00:00:00Z") }),
      surveyDoc("newer", { createdAt: new Date("2026-06-01T00:00:00Z") }),
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.surveys.map((entry) => entry.surveyId)).toEqual(["newer", "older"]);
  });

  it("excludes a malformed survey document rather than failing the whole read", async () => {
    const collection = fakeCollection([
      surveyDoc("valid-1"),
      { id: "malformed-1", data: { teamId: TEAM_ID, accessMode: "not-a-real-mode" } },
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.surveys.map((entry) => entry.surveyId)).toEqual(["valid-1"]);
  });

  it("excludes a survey with a missing or out-of-range minimumResponses rather than defaulting it", async () => {
    const collection = fakeCollection([
      surveyDoc("valid-1"),
      { id: "missing-threshold", data: { teamId: TEAM_ID, accessMode: "public", createdAt: new Date("2026-01-01T00:00:00Z"), createdBy: ADMIN_UID } },
      surveyDoc("out-of-range", { minimumResponses: 2 }),
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.surveys.map((entry) => entry.surveyId)).toEqual(["valid-1"]);
  });

  it("surfaces each survey's own configured minimumResponses", async () => {
    const collection = fakeCollection([
      surveyDoc("survey-3", { minimumResponses: 3 }),
      surveyDoc("survey-20", { minimumResponses: 20 }),
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const byId = new Map(result.surveys.map((entry) => [entry.surveyId, entry]));
    expect(byId.get("survey-3")?.minimumResponses).toBe(3);
    expect(byId.get("survey-20")?.minimumResponses).toBe(20);
  });

  it("never returns encrypted-response or participation-shaped fields", async () => {
    const collection = fakeCollection([
      surveyDoc("survey-1", {
        ciphertext: "should-never-appear",
        iv: "should-never-appear",
        authTag: "should-never-appear",
        keyVersion: 1,
      }),
    ]);

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    for (const forbiddenField of ["ciphertext", "iv", "authTag", "keyVersion", "uid", "responses"]) {
      expect(result.surveys[0]).not.toHaveProperty(forbiddenField);
    }
  });

  it("rejects an unauthenticated caller and never queries surveys", async () => {
    const collection = fakeCollection([surveyDoc("survey-1")]);
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await listTeamSurveys("bad-token", TEAM_ID, baseDeps({ collection, verifyToken }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.calls).toHaveLength(0);
  });

  it("rejects a non-admin caller and never queries surveys", async () => {
    const collection = fakeCollection([surveyDoc("survey-1")]);
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection, verifyToken }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.calls).toHaveLength(0);
  });

  it("reports a controlled read_failed, not a thrown error, on a query failure", async () => {
    const collection: TeamSurveysCollection = {
      listRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listTeamSurveys("token", TEAM_ID, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await listTeamSurveys("token", TEAM_ID, baseDeps({ collection: fakeCollection([surveyDoc("survey-1")]) }));

    const failingCollection: TeamSurveysCollection = {
      listRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await listTeamSurveys("token", TEAM_ID, baseDeps({ collection: failingCollection }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
