import { describe, expect, it, vi } from "vitest";
import type { TeamResultsFetchResult, TeamResultsGateway } from "./team-results-gateway";
import { fetchTeamResults } from "./team-results-gateway";

describe("fetchTeamResults", () => {
  it("forwards the id token and teamId and returns the parsed result", async () => {
    const expected: TeamResultsFetchResult = {
      status: "ok",
      teamId: "team-1",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
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

  it("returns an ok result only when teamId/current/trend are all present", async () => {
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
