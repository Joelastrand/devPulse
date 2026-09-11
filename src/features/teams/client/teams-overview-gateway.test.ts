import { describe, expect, it, vi } from "vitest";
import type {
  RequestTeamAccessGateway,
  RequestTeamAccessResult,
  TeamsOverviewFetchResult,
  TeamsOverviewGateway,
} from "./teams-overview-gateway";
import { fetchTeamsOverview, requestTeamAccess } from "./teams-overview-gateway";

describe("fetchTeamsOverview", () => {
  it("forwards the id token as a bearer token and returns the parsed result", async () => {
    const expected: TeamsOverviewFetchResult = {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Team One", relationship: "member" }],
    };
    const gateway: TeamsOverviewGateway = {
      fetchTeamsOverview: vi.fn(async () => expected),
    };

    const result = await fetchTeamsOverview("an-id-token", { gateway });

    expect(gateway.fetchTeamsOverview).toHaveBeenCalledWith("an-id-token");
    expect(result).toEqual(expected);
  });
});

describe("fetchTeamsOverview default gateway", () => {
  it("sends the Authorization header and parses the JSON response", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Team One", relationship: "none" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTeamsOverview("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Team One", relationship: "none" }],
    });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await fetchTeamsOverview("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result for a malformed team entry (invalid relationship)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          status: "ok",
          teams: [{ teamId: "team-1", name: "Team One", relationship: "totally_unexpected" }],
        }),
      })),
    );

    const result = await fetchTeamsOverview("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the parsed body has no recognized status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ status: "totally_unexpected" }),
      })),
    );

    const result = await fetchTeamsOverview("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error status from the body (unauthenticated)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ status: "unauthenticated" }),
      })),
    );

    const result = await fetchTeamsOverview("an-id-token");

    expect(result).toEqual({ status: "unauthenticated" });

    vi.unstubAllGlobals();
  });
});

describe("requestTeamAccess", () => {
  it("forwards the id token and teamId and returns the parsed result", async () => {
    const expected: RequestTeamAccessResult = { ok: true, outcome: "created" };
    const gateway: RequestTeamAccessGateway = {
      requestTeamAccess: vi.fn(async () => expected),
    };

    const result = await requestTeamAccess("an-id-token", "team-1", { gateway });

    expect(gateway.requestTeamAccess).toHaveBeenCalledWith("an-id-token", "team-1");
    expect(result).toEqual(expected);
  });
});

describe("requestTeamAccess default gateway", () => {
  it("POSTs to the existing TASK-005 endpoint with the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ outcome: "created" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestTeamAccess("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/access-requests", {
      method: "POST",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true, outcome: "created" });

    vi.unstubAllGlobals();
  });

  it("url-encodes the teamId", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ outcome: "created" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestTeamAccess("an-id-token", "team with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/team%20with%20space/access-requests",
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });

  it("returns the server's error code on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 400,
        json: async () => ({ error: "team_disabled" }),
      })),
    );

    const result = await requestTeamAccess("an-id-token", "team-1");

    expect(result).toEqual({ ok: false, error: "team_disabled" });

    vi.unstubAllGlobals();
  });

  it("returns 'unknown' when the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await requestTeamAccess("an-id-token", "team-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });

  it("returns 'unknown' for an unrecognized response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ nonsense: true }),
      })),
    );

    const result = await requestTeamAccess("an-id-token", "team-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});
