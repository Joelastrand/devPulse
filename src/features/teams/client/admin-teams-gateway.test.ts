import { describe, expect, it, vi } from "vitest";
import type {
  AdminTeamsFetchResult,
  AdminTeamsGateway,
  CreateAdminTeamGateway,
  CreateAdminTeamResult,
  SetAdminTeamStatusGateway,
  SetAdminTeamStatusResult,
} from "./admin-teams-gateway";
import { createAdminTeam, fetchAdminTeams, setAdminTeamStatus } from "./admin-teams-gateway";

describe("fetchAdminTeams", () => {
  it("forwards the id token as a bearer token and returns the parsed result", async () => {
    const expected: AdminTeamsFetchResult = {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    };
    const gateway: AdminTeamsGateway = {
      fetchAdminTeams: vi.fn(async () => expected),
    };

    const result = await fetchAdminTeams("an-id-token", { gateway });

    expect(gateway.fetchAdminTeams).toHaveBeenCalledWith("an-id-token");
    expect(result).toEqual(expected);
  });
});

describe("fetchAdminTeams default gateway", () => {
  it("sends the Authorization header and requests the admin endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdminTeams("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });

    vi.unstubAllGlobals();
  });

  it("includes both active and disabled teams from the body unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          teams: [
            { teamId: "team-1", name: "Platform", status: "active" },
            { teamId: "team-2", name: "Legacy", status: "disabled" },
          ],
        }),
      })),
    );

    const result = await fetchAdminTeams("an-id-token");

    expect(result).toEqual({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", status: "active" },
        { teamId: "team-2", name: "Legacy", status: "disabled" },
      ],
    });

    vi.unstubAllGlobals();
  });

  it("ignores extra fields on each team entry (createdAt/createdBy) rather than rejecting the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          teams: [
            {
              teamId: "team-1",
              name: "Platform",
              status: "active",
              createdAt: "2026-01-01T00:00:00.000Z",
              createdBy: "some-uid",
            },
          ],
        }),
      })),
    );

    const result = await fetchAdminTeams("an-id-token");

    expect(result).toEqual({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
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

    const result = await fetchAdminTeams("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result for a malformed team entry (invalid status)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          teams: [{ teamId: "team-1", name: "Platform", status: "totally_unexpected" }],
        }),
      })),
    );

    const result = await fetchAdminTeams("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error status from the body even on a non-ok HTTP response (403 forbidden)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ error: "forbidden" }),
      })),
    );

    const result = await fetchAdminTeams("an-id-token");

    expect(result).toEqual({ status: "forbidden" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result for an unrecognized error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ error: "totally_unexpected" }),
      })),
    );

    const result = await fetchAdminTeams("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });
});

describe("createAdminTeam", () => {
  it("forwards the id token and name and returns the parsed result", async () => {
    const expected: CreateAdminTeamResult = { ok: true, teamId: "team-1" };
    const gateway: CreateAdminTeamGateway = {
      createAdminTeam: vi.fn(async () => expected),
    };

    const result = await createAdminTeam("an-id-token", "Platform", { gateway });

    expect(gateway.createAdminTeam).toHaveBeenCalledWith("an-id-token", "Platform");
    expect(result).toEqual(expected);
  });
});

describe("createAdminTeam default gateway", () => {
  it("POSTs the name to the existing TASK-001 endpoint with the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 201,
      json: async () => ({ teamId: "team-1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createAdminTeam("an-id-token", "Platform");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams", {
      method: "POST",
      headers: { Authorization: "Bearer an-id-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Platform" }),
    });
    expect(result).toEqual({ ok: true, teamId: "team-1" });

    vi.unstubAllGlobals();
  });

  it("returns the server's error code on failure (invalid_name)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 400,
        json: async () => ({ error: "invalid_name" }),
      })),
    );

    const result = await createAdminTeam("an-id-token", "");

    expect(result).toEqual({ ok: false, error: "invalid_name" });

    vi.unstubAllGlobals();
  });

  it("returns 'unknown' when the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await createAdminTeam("an-id-token", "Platform");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });

  it("returns 'unknown' for an unrecognized response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 201,
        json: async () => ({ nonsense: true }),
      })),
    );

    const result = await createAdminTeam("an-id-token", "Platform");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});

describe("setAdminTeamStatus", () => {
  it("forwards the id token, teamId, and status and returns the parsed result", async () => {
    const expected: SetAdminTeamStatusResult = { ok: true };
    const gateway: SetAdminTeamStatusGateway = {
      setAdminTeamStatus: vi.fn(async () => expected),
    };

    const result = await setAdminTeamStatus("an-id-token", "team-1", "disabled", { gateway });

    expect(gateway.setAdminTeamStatus).toHaveBeenCalledWith("an-id-token", "team-1", "disabled");
    expect(result).toEqual(expected);
  });
});

describe("setAdminTeamStatus default gateway", () => {
  it("PATCHes the existing TASK-001 endpoint with the Authorization header and status body", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setAdminTeamStatus("an-id-token", "team-1", "disabled");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1", {
      method: "PATCH",
      headers: { Authorization: "Bearer an-id-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("url-encodes the teamId", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await setAdminTeamStatus("an-id-token", "team with space", "active");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team%20with%20space",
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });

  it("returns the server's error code on failure (forbidden)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 403,
        json: async () => ({ error: "forbidden" }),
      })),
    );

    const result = await setAdminTeamStatus("an-id-token", "team-1", "disabled");

    expect(result).toEqual({ ok: false, error: "forbidden" });

    vi.unstubAllGlobals();
  });

  it("returns 'unknown' when the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await setAdminTeamStatus("an-id-token", "team-1", "active");

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

    const result = await setAdminTeamStatus("an-id-token", "team-1", "active");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});
