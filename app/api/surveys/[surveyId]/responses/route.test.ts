import { afterEach, describe, expect, it, vi } from "vitest";

const submitSurveyResponseMock = vi.fn();

vi.mock("../../../../../src/features/surveys/server/submit-survey-response", () => ({
  submitSurveyResponse: submitSurveyResponseMock,
}));

const { POST } = await import("./route");

function jsonRequest(body: unknown, header?: string): Request {
  return new Request("http://localhost/api/surveys/survey-1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(header ? { authorization: header } : {}),
    },
    body: JSON.stringify(body),
  });
}

function params(surveyId = "survey-1") {
  return { params: Promise.resolve({ surveyId }) };
}

describe("POST /api/surveys/[surveyId]/responses", () => {
  afterEach(() => {
    submitSurveyResponseMock.mockReset();
  });

  it("returns 201 and a success body for a valid submission", async () => {
    submitSurveyResponseMock.mockResolvedValue({ ok: true });

    const response = await POST(jsonRequest({ answers: [1, 5, 3] }), params());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the URL's surveyId, the parsed answers, and no token through when unauthenticated", async () => {
    submitSurveyResponseMock.mockResolvedValue({ ok: true });

    await POST(jsonRequest({ answers: [1, 5, 3] }), params("survey-42"));

    expect(submitSurveyResponseMock).toHaveBeenCalledWith("survey-42", [1, 5, 3], undefined);
  });

  it("extracts exactly the bearer token for an authenticated submission", async () => {
    submitSurveyResponseMock.mockResolvedValue({ ok: true });

    await POST(jsonRequest({ answers: [1, 5, 3] }, "Bearer abc.def.ghi"), params());

    expect(submitSurveyResponseMock).toHaveBeenCalledWith("survey-1", [1, 5, 3], "abc.def.ghi");
  });

  it("ignores a client-supplied teamId/accessMode/uid in the request body — only answers reach submitSurveyResponse", async () => {
    submitSurveyResponseMock.mockResolvedValue({ ok: true });

    await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "other-team", accessMode: "public", uid: "someone" }),
      params(),
    );

    expect(submitSurveyResponseMock).toHaveBeenCalledWith("survey-1", [1, 5, 3], undefined);
  });

  it("returns a generic 400 and never calls submitSurveyResponse for a malformed JSON body", async () => {
    const request = new Request("http://localhost/api/surveys/survey-1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await POST(request, params());

    expect(response.status).toBe(400);
    expect(submitSurveyResponseMock).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_submission", 400],
    ["survey_unavailable", 409],
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["already_submitted", 409],
    ["encryption_failed", 500],
    ["persistence_failed", 500],
  ])("maps %s to HTTP %i", async (error, expectedStatus) => {
    submitSurveyResponseMock.mockResolvedValue({ ok: false, error });

    const response = await POST(jsonRequest({ answers: [1, 5, 3] }), params());
    const payload = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(payload).toEqual({ error });
  });

  it("never echoes a generated document id or answer content back to the caller", async () => {
    submitSurveyResponseMock.mockResolvedValue({ ok: true });

    const response = await POST(jsonRequest({ answers: [1, 5, 3] }), params());
    const payload = await response.json();

    expect(Object.keys(payload)).toEqual(["ok"]);
  });

  it("never logs the request body, token, or error internals", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    submitSurveyResponseMock.mockResolvedValue({ ok: false, error: "already_submitted" });
    await POST(jsonRequest({ answers: [1, 5, 3] }, "Bearer a-token"), params());

    const request = new Request("http://localhost/api/surveys/survey-1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json at all",
    });
    await POST(request, params());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
