import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentTeamSurveyMock = vi.fn();

vi.mock("../../../../../src/features/surveys/server/get-current-team-survey", () => ({
  getCurrentTeamSurvey: getCurrentTeamSurveyMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/current-survey", {
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/teams/[teamId]/current-survey", () => {
  afterEach(() => {
    getCurrentTeamSurveyMock.mockReset();
  });

  it("returns the current survey for an authorized caller", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({
      ok: true,
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });
  });

  it("returns a null survey (empty state) as 200, not an error", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: true, survey: null });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", survey: null });
  });

  it("extracts exactly the bearer token and passes the URL's teamId through", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(getCurrentTeamSurveyMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns a generic 401 auth error when the Authorization header is missing", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(getCurrentTeamSurveyMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns a generic 401 auth error for a malformed Authorization header", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth("not-a-bearer-token"), params());

    expect(response.status).toBe(401);
    expect(getCurrentTeamSurveyMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns a 'forbidden' response, never survey data, for a denied caller", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns the same 'forbidden' response shape for a nonexistent teamId as for an unauthorized one", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(
      requestWithAuth("Bearer valid-token"),
      params("nonexistent-team"),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns a 500 failure response, not a fabricated empty state, on a read failure", async () => {
    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("never logs the token or survey content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getCurrentTeamSurveyMock.mockResolvedValue({
      ok: true,
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });
    await GET(requestWithAuth("Bearer valid-token"), params());

    getCurrentTeamSurveyMock.mockResolvedValue({ ok: false, error: "read_failed" });
    await GET(requestWithAuth("Bearer valid-token"), params());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
