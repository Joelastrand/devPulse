import { afterEach, describe, expect, it, vi } from "vitest";

const submitPulseSurveyMock = vi.fn();

vi.mock("../../../src/features/pulse-survey/server/submit-pulse-survey", () => ({
  submitPulseSurvey: submitPulseSurveyMock,
}));

const { POST } = await import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/pulse-survey", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pulse-survey", () => {
  afterEach(() => {
    submitPulseSurveyMock.mockReset();
  });

  it("returns 201 and a success body for a valid submission", async () => {
    submitPulseSurveyMock.mockResolvedValue({ ok: true });

    const response = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "platform" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ ok: true });
  });

  it("returns a generic 4xx and never calls submitPulseSurvey for a malformed body", async () => {
    const request = new Request("http://localhost/api/pulse-survey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(submitPulseSurveyMock).not.toHaveBeenCalled();
  });

  it("returns a generic 400 when the submission is invalid", async () => {
    submitPulseSurveyMock.mockResolvedValue({
      ok: false,
      error: "invalid_submission",
    });

    const response = await POST(
      jsonRequest({ answers: [1, 6, 3], teamId: "platform" }),
    );

    expect(response.status).toBe(400);
  });

  it("returns a 500 failure response, not a partial success, when persistence fails", async () => {
    submitPulseSurveyMock.mockResolvedValue({
      ok: false,
      error: "persistence_failed",
    });

    const response = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "platform" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.ok).not.toBe(true);
  });

  it("returns a generic 500 failure response, not error internals, when encryption fails closed", async () => {
    submitPulseSurveyMock.mockResolvedValue({
      ok: false,
      error: "encryption_failed",
    });

    const response = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "platform" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "encryption_failed" });
  });

  it("returns a generic 500 failure response, not error internals, when active-team validation fails closed (e.g. a Firestore read failure)", async () => {
    submitPulseSurveyMock.mockResolvedValue({
      ok: false,
      error: "team_validation_failed",
    });

    const response = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "platform" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "team_validation_failed" });
  });

  it("returns a generic 400, indistinguishable from any other invalid submission, when the teamId is disabled or unknown", async () => {
    submitPulseSurveyMock.mockResolvedValue({
      ok: false,
      error: "invalid_submission",
    });

    const response = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "disabled-or-unknown-team" }),
    );

    expect(response.status).toBe(400);
  });

  it("allows two valid submissions for the same period to both succeed", async () => {
    submitPulseSurveyMock.mockResolvedValue({ ok: true });

    const first = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "platform" }),
    );
    const second = await POST(
      jsonRequest({ answers: [1, 5, 3], teamId: "platform" }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("never logs the request body or error internals for a malformed request", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const request = new Request("http://localhost/api/pulse-survey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json at all",
    });
    await POST(request);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
