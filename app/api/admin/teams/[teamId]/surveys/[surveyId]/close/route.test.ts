import { afterEach, describe, expect, it, vi } from "vitest";

const closeSurveyMock = vi.fn();

vi.mock("../../../../../../../../src/features/surveys/server/close-survey", () => ({
  closeSurvey: closeSurveyMock,
}));

const { POST } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/surveys/survey-1/close", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1", surveyId = "survey-1") {
  return { params: Promise.resolve({ teamId, surveyId }) };
}

describe("POST /api/admin/teams/[teamId]/surveys/[surveyId]/close", () => {
  afterEach(() => {
    closeSurveyMock.mockReset();
  });

  it("closes the survey for an app admin", async () => {
    closeSurveyMock.mockResolvedValue({ ok: true });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token and surveyId through, but never the route's teamId", async () => {
    closeSurveyMock.mockResolvedValue({ ok: true });

    await POST(requestWithAuth("Bearer abc.def.ghi"), params("team-42", "survey-9"));

    expect(closeSurveyMock).toHaveBeenCalledWith("abc.def.ghi", "survey-9");
  });

  it("returns 401 when unauthenticated", async () => {
    closeSurveyMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    closeSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 404 for a nonexistent survey", async () => {
    closeSurveyMock.mockResolvedValue({ ok: false, error: "survey_not_found" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(404);
  });

  it("returns 409 when the survey was never opened", async () => {
    closeSurveyMock.mockResolvedValue({ ok: false, error: "not_open" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(409);
  });

  it("returns 500 on a persistence failure", async () => {
    closeSurveyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
