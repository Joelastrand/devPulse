import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSurveyParticipation } from "./survey-participation-gateway";

describe("fetchSurveyParticipation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends no Authorization header when no token is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "not_found" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSurveyParticipation("survey-1", undefined);

    expect(fetchMock).toHaveBeenCalledWith("/api/surveys/survey-1", { headers: {} });
  });

  it("forwards a supplied token as a bearer Authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "answerable", survey: { surveyId: "survey-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSurveyParticipation("survey-1", "a-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/surveys/survey-1", {
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it("URL-encodes the surveyId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "not_found" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSurveyParticipation("weird/id", undefined);

    expect(fetchMock).toHaveBeenCalledWith("/api/surveys/weird%2Fid", { headers: {} });
  });

  it("returns the parsed result for every known status without a survey field", async () => {
    for (const status of ["not_found", "sign_in_required", "forbidden"]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchSurveyParticipation("survey-1", undefined);
      expect(result).toEqual({ status });
    }
  });

  it("returns the parsed result, including the safe survey summary, for every known status that carries one", async () => {
    for (const status of ["scheduled", "closed", "answerable"]) {
      const survey = { surveyId: "survey-1", title: "Uke 36", teamName: "Platform" };
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status, survey }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchSurveyParticipation("survey-1", undefined);
      expect(result).toEqual({ status, survey });
    }
  });

  it("falls back to read_failed for a malformed response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSurveyParticipation("survey-1", undefined);
    expect(result).toEqual({ status: "read_failed" });
  });

  it("falls back to read_failed for a 'scheduled'/'closed'/'answerable' status missing its survey field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "answerable" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSurveyParticipation("survey-1", undefined);
    expect(result).toEqual({ status: "read_failed" });
  });

  it("returns read_failed when fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const result = await fetchSurveyParticipation("survey-1", undefined);
    expect(result).toEqual({ status: "read_failed" });
  });

  it("returns read_failed when the response body is not valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSurveyParticipation("survey-1", undefined);
    expect(result).toEqual({ status: "read_failed" });
  });
});
