import { describe, expect, it, vi } from "vitest";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import { getBuiltInTemplate } from "../domain/templates";
import { listTeamResultsSurveys, type ListTeamResultsSurveysDeps } from "./list-team-results-surveys";

const NOW = new Date("2026-09-01T00:00:00Z");
const TEAM_ID = "team-42";
const MEMBER_UID = "member-1";
const OUTSIDER_UID = "outsider-1";
const TEAM_PULSE = getBuiltInTemplate("team-pulse").questions;

function verifyAs(uid: string) {
  return vi.fn().mockResolvedValue({ uid, email: `${uid}@example.com`, email_verified: true });
}

const authCollection: AuthorizeTeamAccessCollection = {
  async getTeamStatus() {
    return "active";
  },
  async getMembership(uid, teamId) {
    return uid === MEMBER_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
  },
};

const base = {
  teamId: TEAM_ID,
  accessMode: "public",
  minimumResponses: 3,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  createdBy: "admin-1",
  questions: TEAM_PULSE,
  questionSetVersion: 2,
};

function deps(rows: { id: string; data: unknown }[], overrides: Partial<ListTeamResultsSurveysDeps> = {}): ListTeamResultsSurveysDeps {
  return {
    now: NOW,
    verifyToken: verifyAs(MEMBER_UID),
    isSuperadmin: async () => false,
    authCollection,
    collections: { listSurveysForTeam: async () => rows },
    ...overrides,
  };
}

describe("listTeamResultsSurveys", () => {
  it("lists only closed configurable surveys, excluding drafts, open surveys and legacy surveys", async () => {
    const rows = [
      { id: "closed-new", data: { ...base, title: "Oktober", openedAt: new Date("2026-08-10T00:00:00Z"), closedAt: new Date("2026-08-20T00:00:00Z") } },
      { id: "draft", data: { ...base, title: "Utkast" } },
      { id: "open", data: { ...base, title: "Åpen", openedAt: new Date("2026-08-25T00:00:00Z") } },
      {
        id: "legacy",
        data: {
          teamId: TEAM_ID,
          accessMode: "public",
          minimumResponses: 3,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          createdBy: "admin-1",
          openedAt: new Date("2026-07-02T00:00:00Z"),
          closedAt: new Date("2026-07-09T00:00:00Z"),
        },
      },
    ];

    const result = await listTeamResultsSurveys("token", TEAM_ID, deps(rows));

    expect(result).toEqual({
      ok: true,
      surveys: [
        {
          surveyId: "closed-new",
          title: "Oktober",
          minimumResponses: 3,
          closedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns only the allow-listed header fields, never the creator or accessMode", async () => {
    const rows = [
      { id: "closed", data: { ...base, openedAt: new Date("2026-08-10T00:00:00Z"), closedAt: new Date("2026-08-20T00:00:00Z") } },
    ];

    const result = await listTeamResultsSurveys("token", TEAM_ID, deps(rows));

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("admin-1");
    expect(serialized).not.toContain("accessMode");
    expect(serialized).not.toContain("questions");
  });

  it("denies a caller who is neither a member nor an app admin", async () => {
    const result = await listTeamResultsSurveys("token", TEAM_ID, deps([], { verifyToken: verifyAs(OUTSIDER_UID) }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns read_failed when the survey read throws, with no partial list", async () => {
    const result = await listTeamResultsSurveys(
      "token",
      TEAM_ID,
      deps([], {
        collections: {
          listSurveysForTeam: async () => {
            throw new Error("firestore down");
          },
        },
      }),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});
