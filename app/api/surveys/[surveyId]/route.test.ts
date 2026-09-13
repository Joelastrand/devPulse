import { afterEach, describe, expect, it, vi } from "vitest";

const resolveSurveyForParticipationMock = vi.fn();

vi.mock("../../../../src/features/surveys/server/resolve-survey-for-participation", () => ({
  resolveSurveyForParticipation: resolveSurveyForParticipationMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/surveys/survey-1", {
    headers: header ? { authorization: header } : {},
  });
}

function params(surveyId = "survey-1") {
  return { params: Promise.resolve({ surveyId }) };
}

describe("GET /api/surveys/[surveyId]", () => {
  afterEach(() => {
    resolveSurveyForParticipationMock.mockReset();
  });

  it("passes no token and the URL's surveyId through when the caller sends no Authorization header", async () => {
    resolveSurveyForParticipationMock.mockResolvedValue({ ok: true, status: "not_found" });

    await GET(requestWithAuth(), params("survey-42"));

    expect(resolveSurveyForParticipationMock).toHaveBeenCalledWith("survey-42", undefined);
  });

  it("extracts exactly the bearer token", async () => {
    resolveSurveyForParticipationMock.mockResolvedValue({ ok: true, status: "not_found" });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params());

    expect(resolveSurveyForParticipationMock).toHaveBeenCalledWith("survey-1", "abc.def.ghi");
  });

  it("returns 200 with just a status for not_found/sign_in_required/forbidden, never a survey field", async () => {
    for (const status of ["not_found", "sign_in_required", "forbidden"]) {
      resolveSurveyForParticipationMock.mockResolvedValue({ ok: true, status });

      const response = await GET(requestWithAuth(), params());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ status });
    }
  });

  it("returns 200 with the safe survey summary for scheduled/closed/answerable", async () => {
    const survey = { surveyId: "survey-1", title: "Uke 36", teamName: "Platform" };
    for (const status of ["scheduled", "closed", "answerable"]) {
      resolveSurveyForParticipationMock.mockResolvedValue({ ok: true, status, survey });

      const response = await GET(requestWithAuth(), params());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ status, survey });
    }
  });

  it("returns a 500 read_failed response, not a fabricated outcome, on a read failure", async () => {
    resolveSurveyForParticipationMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth(), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("never logs the token or survey content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    resolveSurveyForParticipationMock.mockResolvedValue({
      ok: true,
      status: "answerable",
      survey: { surveyId: "survey-1" },
    });
    await GET(requestWithAuth("Bearer a-token"), params());

    resolveSurveyForParticipationMock.mockResolvedValue({ ok: false, error: "read_failed" });
    await GET(requestWithAuth("Bearer a-token"), params());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
