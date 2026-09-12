import { afterEach, describe, expect, it, vi } from "vitest";
import type { OwnAdminStatusFetchResult, OwnAdminStatusGateway } from "./own-admin-status-gateway";
import { fetchOwnAdminStatus } from "./own-admin-status-gateway";

describe("fetchOwnAdminStatus", () => {
  it("forwards the id token and returns the gateway's parsed result", async () => {
    const expected: OwnAdminStatusFetchResult = { ok: true, isAdmin: true };
    const gateway: OwnAdminStatusGateway = {
      fetchOwnAdminStatus: vi.fn(async () => expected),
    };

    const result = await fetchOwnAdminStatus("an-id-token", { gateway });

    expect(gateway.fetchOwnAdminStatus).toHaveBeenCalledWith("an-id-token");
    expect(result).toEqual(expected);
  });
});

describe("fetchOwnAdminStatus default gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Authorization header and returns isAdmin: true", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ isAdmin: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOwnAdminStatus("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/me", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true, isAdmin: true });
  });

  it("returns isAdmin: false for a non-admin caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => ({ isAdmin: false }) })),
    );

    const result = await fetchOwnAdminStatus("an-id-token");

    expect(result).toEqual({ ok: true, isAdmin: false });
  });

  it("returns unauthenticated for a 401 response, never a boolean", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 401, json: async () => ({ error: "unauthenticated" }) })),
    );

    const result = await fetchOwnAdminStatus("an-id-token");

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("fails closed with read_failed if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await fetchOwnAdminStatus("an-id-token");

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("fails closed with read_failed for a malformed 200 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => ({ isAdmin: "yes" }) })),
    );

    const result = await fetchOwnAdminStatus("an-id-token");

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("fails closed with read_failed for an unexpected non-200/401 status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 500, json: async () => ({ error: "internal" }) })),
    );

    const result = await fetchOwnAdminStatus("an-id-token");

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});
