import { afterEach, describe, expect, it, vi } from "vitest";

const getTeamSurveyResultsMock = vi.fn();

vi.mock("../../../../../src/features/results/server/get-team-survey-results", () => ({
  getTeamSurveyResults: getTeamSurveyResultsMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/results", {
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

const PUBLISHED_ENTRY = {
  surveyId: "survey-1",
  title: "Q3-puls",
  date: new Date("2026-08-24T00:00:00.000Z"),
  minimumResponses: 5,
  status: "published" as const,
  mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
  count: 7,
};

const INSUFFICIENT_ENTRY = {
  surveyId: "survey-2",
  date: new Date("2026-08-31T00:00:00.000Z"),
  minimumResponses: 5,
  status: "insufficient" as const,
};

describe("GET /api/teams/[teamId]/results", () => {
  afterEach(() => {
    getTeamSurveyResultsMock.mockReset();
  });

  it("returns the survey-instance results for an authorized caller, with the date serialized as an ISO string", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({
      ok: true,
      teamId: "team-1",
      results: [INSUFFICIENT_ENTRY, PUBLISHED_ENTRY],
    });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      teamId: "team-1",
      results: [
        {
          surveyId: "survey-2",
          date: "2026-08-31T00:00:00.000Z",
          minimumResponses: 5,
          status: "insufficient",
        },
        {
          surveyId: "survey-1",
          title: "Q3-puls",
          date: "2026-08-24T00:00:00.000Z",
          minimumResponses: 5,
          status: "published",
          mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
          count: 7,
        },
      ],
    });
  });

  it("never includes a count or mean field for an insufficient entry", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({
      ok: true,
      teamId: "team-1",
      results: [INSUFFICIENT_ENTRY],
    });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(payload.results[0]).not.toHaveProperty("count");
    expect(payload.results[0]).not.toHaveProperty("mean");
  });

  it("returns an empty results array, not an error, when the team has no closed surveys", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: true, teamId: "team-1", results: [] });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", teamId: "team-1", results: [] });
  });

  it("extracts exactly the bearer token and passes the URL's teamId through", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(getTeamSurveyResultsMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns a generic 401 auth error when the Authorization header is missing", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(getTeamSurveyResultsMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns a generic 401 auth error for a malformed Authorization header", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth("not-a-bearer-token"), params());

    expect(response.status).toBe(401);
    expect(getTeamSurveyResultsMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns a 'forbidden' response, never a result array, for a denied caller", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns the same 'forbidden' response shape for a nonexistent teamId as for an unauthorized one", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(
      requestWithAuth("Bearer valid-token"),
      params("nonexistent-team"),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns a 500 failure response, not a partial/fabricated result, on a read failure", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("ignores a client-supplied period query parameter; only the token and path teamId reach getTeamSurveyResults", async () => {
    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await GET(
      new Request("http://localhost/api/teams/team-1/results?period=2026-W36", {
        headers: { authorization: "Bearer valid-token" },
      }),
      params("team-1"),
    );

    expect(getTeamSurveyResultsMock).toHaveBeenCalledTimes(1);
    expect(getTeamSurveyResultsMock).toHaveBeenCalledWith("valid-token", "team-1");
  });

  it("never logs the token or result content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getTeamSurveyResultsMock.mockResolvedValue({
      ok: true,
      teamId: "team-1",
      results: [PUBLISHED_ENTRY],
    });
    await GET(requestWithAuth("Bearer valid-token"), params());

    getTeamSurveyResultsMock.mockResolvedValue({ ok: false, error: "read_failed" });
    await GET(requestWithAuth("Bearer valid-token"), params());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
