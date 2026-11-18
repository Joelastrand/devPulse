import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSystemFavorites, setSystemFavorite } from "./system-favorites-gateway";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("system favorites gateway (Phase 2F.1)", () => {
  it("sends the verified token as a bearer credential and reads the caller's ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { systemIds: ["s1"] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSystemFavorites("token-a", "team/1");

    expect(result).toEqual({ status: "ok", systemIds: ["s1"] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/team%2F1/system-favorites",
      expect.objectContaining({ headers: { Authorization: "Bearer token-a" } }),
    );
  });

  it("reports unauthenticated and forbidden reads by status, never as favorites", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(401, { error: "unauthenticated" })));
    expect(await fetchSystemFavorites("", "team-1")).toEqual({ status: "unauthenticated" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(403, { error: "forbidden" })));
    expect(await fetchSystemFavorites("token", "team-1")).toEqual({ status: "forbidden" });
  });

  it("treats a malformed read body as a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { systemIds: [1, 2] })));
    expect(await fetchSystemFavorites("token", "team-1")).toEqual({ status: "read_failed" });
  });

  it("treats a network failure as a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    expect(await fetchSystemFavorites("token", "team-1")).toEqual({ status: "read_failed" });
  });

  it("sends the desired state in the body and reports success only when the server confirms it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { favorite: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setSystemFavorite("token-a", "team-1", "sys-1", true);

    expect(result).toEqual({ ok: true, favorite: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/team-1/system-favorites/sys-1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ favorite: true }) }),
    );
  });

  it("does not report success when the confirmed state differs from the one requested", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { favorite: false })));
    expect(await setSystemFavorite("token", "team-1", "sys-1", true)).toEqual({ ok: false, error: "request_failed" });
  });

  it("surfaces a known server error code and nothing else", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(404, { error: "not_found" })));
    expect(await setSystemFavorite("token", "team-1", "sys-x", true)).toEqual({ ok: false, error: "not_found" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(500, { error: "<stack trace>" })));
    expect(await setSystemFavorite("token", "team-1", "sys-x", true)).toEqual({ ok: false, error: "request_failed" });
  });

  it("reports a network failure on write as request_failed, so the UI never shows success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await setSystemFavorite("token", "team-1", "sys-1", false)).toEqual({ ok: false, error: "request_failed" });
  });
});
