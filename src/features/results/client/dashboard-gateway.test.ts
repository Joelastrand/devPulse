import { describe, expect, it, vi } from "vitest";
import type { DashboardFetchResult, DashboardGateway } from "./dashboard-gateway";
import { fetchDashboard } from "./dashboard-gateway";

describe("fetchDashboard", () => {
  it("forwards the id token as a bearer token and returns the parsed result", async () => {
    const expected: DashboardFetchResult = {
      status: "ok",
      teamId: "platform",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    };
    const gateway: DashboardGateway = {
      fetchDashboard: vi.fn(async () => expected),
    };

    const result = await fetchDashboard("an-id-token", { gateway });

    expect(gateway.fetchDashboard).toHaveBeenCalledWith("an-id-token");
    expect(result).toEqual(expected);
  });
});

describe("fetchDashboard default gateway", () => {
  it("sends the Authorization header and parses the JSON response", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ status: "no_team" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDashboard("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/results", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ status: "no_team" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await fetchDashboard("an-id-token");

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

    const result = await fetchDashboard("an-id-token");

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

    const result = await fetchDashboard("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns a read_failed result if the parsed body has no status field at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ teamId: "platform" }),
      })),
    );

    const result = await fetchDashboard("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns an ok result only when teamId/current/trend are all present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok", teamId: "platform" }),
      })),
    );

    const result = await fetchDashboard("an-id-token");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error status from the body even on a non-ok HTTP response (401 unauthenticated)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ status: "unauthenticated" }),
      })),
    );

    const result = await fetchDashboard("an-id-token");

    expect(result).toEqual({ status: "unauthenticated" });

    vi.unstubAllGlobals();
  });
});
