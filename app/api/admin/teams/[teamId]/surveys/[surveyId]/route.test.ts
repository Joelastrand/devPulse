import { afterEach, describe, expect, it, vi } from "vitest";

const deleteOrArchiveSurveyMock = vi.fn();

vi.mock("../../../../../../../src/features/surveys/server/delete-or-archive-survey", () => ({
  deleteOrArchiveSurvey: deleteOrArchiveSurveyMock,
}));

const { DELETE } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/surveys/survey-1", {
    method: "DELETE",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", surveyId = "survey-1") {
  return { params: Promise.resolve({ teamId, surveyId }) };
}

describe("DELETE /api/admin/teams/[teamId]/surveys/[surveyId]", () => {
  afterEach(() => {
    deleteOrArchiveSurveyMock.mockReset();
  });

  it("returns the server-determined outcome for a successful deletion", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: true, outcome: "deleted" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcome: "deleted" });
  });

  it("returns the server-determined outcome for a successful archive", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: true, outcome: "archived" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcome: "archived" });
  });

  it("passes the bearer token, teamId, and surveyId through", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: true, outcome: "deleted" });

    await DELETE(requestWithAuth("Bearer abc.def.ghi"), params("team-42", "survey-9"));

    expect(deleteOrArchiveSurveyMock).toHaveBeenCalledWith("abc.def.ghi", "team-42", "survey-9");
  });

  it("returns 401 when unauthenticated", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await DELETE(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a nonexistent survey", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: false, error: "survey_not_found" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 404 for a survey belonging to a different team", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: false, error: "wrong_team" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 409 while the survey is not closed", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: false, error: "not_closed" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(409);
  });

  it("returns 500 on a persistence failure", async () => {
    deleteOrArchiveSurveyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
