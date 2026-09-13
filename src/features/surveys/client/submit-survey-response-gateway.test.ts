import { afterEach, describe, expect, it, vi } from "vitest";
import { submitSurveyResponse } from "./submit-survey-response-gateway";

describe("submitSurveyResponse (client gateway)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the answers as JSON with no Authorization header when no token is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitSurveyResponse("survey-1", [1, 2, 3], undefined);

    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith("/api/surveys/survey-1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [1, 2, 3] }),
    });
  });

  it("forwards a supplied token as a bearer Authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitSurveyResponse("survey-1", [1, 2, 3], "a-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/surveys/survey-1/responses",
      expect.objectContaining({
        headers: { "content-type": "application/json", Authorization: "Bearer a-token" },
      }),
    );
  });

  it("maps every known server error to its status", async () => {
    for (const error of [
      "invalid_submission",
      "survey_unavailable",
      "unauthenticated",
      "forbidden",
      "already_submitted",
    ]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error }), { status: 400 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await submitSurveyResponse("survey-1", [1, 2, 3], undefined);
      expect(result).toEqual({ status: error });
    }
  });

  it("falls back to read_failed for an unrecognized error code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "something_new" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitSurveyResponse("survey-1", [1, 2, 3], undefined);
    expect(result).toEqual({ status: "read_failed" });
  });

  it("returns read_failed when fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await submitSurveyResponse("survey-1", [1, 2, 3], undefined);
    expect(result).toEqual({ status: "read_failed" });
  });
});
