import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentTeamSurvey } from "./current-team-survey-gateway";

describe("fetchCurrentTeamSurvey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the token as a bearer Authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", survey: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCurrentTeamSurvey("a-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/current-survey", {
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it("URL-encodes the teamId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", survey: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCurrentTeamSurvey("a-token", "weird/id");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/weird%2Fid/current-survey", {
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it("returns the empty state (survey: null) as-is", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", survey: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "ok", survey: null });
  });

  it("returns a valid current-survey summary", async () => {
    const survey = {
      surveyId: "survey-1",
      title: "Q3 pulse",
      accessMode: "authenticated",
      lifecycle: "open",
      startAt: "2026-08-01T00:00:00.000Z",
      endAt: "2026-10-01T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", survey }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "ok", survey });
  });

  it("returns every known read-error status as-is", async () => {
    for (const status of ["unauthenticated", "forbidden", "read_failed"]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchCurrentTeamSurvey("a-token", "team-1");
      expect(result).toEqual({ status });
    }
  });

  it("falls back to read_failed for a malformed response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "read_failed" });
  });

  it("falls back to read_failed for an 'ok' status with a malformed survey field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "ok", survey: { surveyId: "survey-1" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "read_failed" });
  });

  it("falls back to read_failed for an unrecognized status string", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "unknown_status" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "read_failed" });
  });

  it("returns read_failed when fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "read_failed" });
  });

  it("returns read_failed when the response body is not valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCurrentTeamSurvey("a-token", "team-1");
    expect(result).toEqual({ status: "read_failed" });
  });
});
