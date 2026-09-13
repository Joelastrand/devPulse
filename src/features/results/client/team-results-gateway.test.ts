import { describe, expect, it, vi } from "vitest";
import type { TeamResultsFetchResult, TeamResultsGateway } from "./team-results-gateway";
import { fetchTeamResults } from "./team-results-gateway";

const PUBLISHED_ENTRY = {
  surveyId: "survey-1",
  title: "Q3-puls",
  date: "2026-08-24T00:00:00.000Z",
  minimumResponses: 5,
  status: "published" as const,
  mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
  count: 7,
};

const INSUFFICIENT_ENTRY = {
  surveyId: "survey-2",
  date: "2026-08-31T00:00:00.000Z",
  minimumResponses: 5,
  status: "insufficient" as const,
};

describe("fetchTeamResults", () => {
  it("forwards the id token and teamId and returns the parsed result", async () => {
    const expected: TeamResultsFetchResult = {
      status: "ok",
      teamId: "team-1",
      results: [INSUFFICIENT_ENTRY, PUBLISHED_ENTRY],
    };
    const gateway: TeamResultsGateway = {
      fetchTeamResults: vi.fn(async () => expected),
    };

    const result = await fetchTeamResults("an-id-token", "team-1", { gateway });

    expect(gateway.fetchTeamResults).toHaveBeenCalledWith("an-id-token", "team-1");
    expect(result).toEqual(expected);
  });
});

describe("fetchTeamResults default gateway", () => {
  it("sends the Authorization header and requests the per-team endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ status: "forbidden" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/results", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ status: "forbidden" });

    vi.unstubAllGlobals();
  });

  it("URL-encodes the teamId", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ status: "forbidden" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTeamResults("an-id-token", "team/with slash");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/team%2Fwith%20slash/results",
      { headers: { Authorization: "Bearer an-id-token" } },
    );

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the response body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the parsed body has no recognized status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "totally_unexpected" }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns an ok result with an empty results array (no completed surveys)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok", teamId: "team-1", results: [] }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "ok", teamId: "team-1", results: [] });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if teamId/results are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok", teamId: "team-1" }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if any entry in results is malformed (missing date)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "ok",
          teamId: "team-1",
          results: [{ surveyId: "survey-1", minimumResponses: 5, status: "insufficient" }],
        }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if a published entry has a malformed count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "ok",
          teamId: "team-1",
          results: [
            {
              surveyId: "survey-1",
              date: "2026-08-24T00:00:00.000Z",
              minimumResponses: 5,
              status: "published",
              mean: { flow: 3, stress: 3, fun: 3 },
              count: "seven",
            },
          ],
        }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if a published entry has malformed aggregates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "ok",
          teamId: "team-1",
          results: [
            {
              surveyId: "survey-1",
              date: "2026-08-24T00:00:00.000Z",
              minimumResponses: 5,
              status: "published",
              mean: { flow: 3, stress: 3 },
              count: 7,
            },
          ],
        }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if an entry's date is not a valid date string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "ok",
          teamId: "team-1",
          results: [
            { surveyId: "survey-1", date: "not-a-date", minimumResponses: 5, status: "insufficient" },
          ],
        }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("never reclassifies an insufficient entry as published, even if the body carries a stray count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "ok",
          teamId: "team-1",
          results: [
            {
              surveyId: "survey-1",
              date: "2026-08-24T00:00:00.000Z",
              minimumResponses: 5,
              status: "insufficient",
              count: 4,
            },
          ],
        }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.results[0].status).toBe("insufficient");
    }
  });

  it("trusts a known error status from the body even on a non-ok HTTP response (403 forbidden)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ status: "forbidden" }),
      })),
    );

    const result = await fetchTeamResults("an-id-token", "team-1");

    expect(result).toEqual({ status: "forbidden" });

    vi.unstubAllGlobals();
  });
});
