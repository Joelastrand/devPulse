import { afterEach, describe, expect, it, vi } from "vitest";

const openSurveyMock = vi.fn();

vi.mock("../../../../../../../../src/features/surveys/server/open-survey", () => ({
  openSurvey: openSurveyMock,
}));

const { POST } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/surveys/survey-1/open", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", surveyId = "survey-1") {
  return { params: Promise.resolve({ teamId, surveyId }) };
}

describe("POST /api/admin/teams/[teamId]/surveys/[surveyId]/open", () => {
  afterEach(() => {
    openSurveyMock.mockReset();
  });

  it("opens the survey for an app admin", async () => {
    openSurveyMock.mockResolvedValue({ ok: true });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token, teamId, and surveyId through", async () => {
    openSurveyMock.mockResolvedValue({ ok: true });

    await POST(requestWithAuth("Bearer abc.def.ghi"), params("team-42", "survey-9"));

    expect(openSurveyMock).toHaveBeenCalledWith("abc.def.ghi", "team-42", "survey-9");
  });

  it("returns 401 when unauthenticated", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 409 when the team already has a genuinely open survey", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "team_already_has_open_survey" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(409);
  });

  it("returns 409 when the survey is not scheduled", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "not_scheduled" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(409);
  });

  it("returns 409 for a disabled team", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(409);
  });

  it("returns 404 for a survey belonging to a different team", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "wrong_team" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 500 on a persistence failure", async () => {
    openSurveyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
