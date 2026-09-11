import { afterEach, describe, expect, it, vi } from "vitest";

const getTeamResultsMock = vi.fn();

vi.mock("../../../../../src/features/results/server/get-team-results", () => ({
  getTeamResults: getTeamResultsMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/results", {
    headers: header ? { authorization: header } : {},
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/teams/[teamId]/results", () => {
  afterEach(() => {
    getTeamResultsMock.mockReset();
  });

  it("returns the dashboard payload for an authorized caller", async () => {
    getTeamResultsMock.mockResolvedValue({
      ok: true,
      teamId: "team-1",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      teamId: "team-1",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });
  });

  it("extracts exactly the bearer token and passes the URL's teamId through", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(getTeamResultsMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns a generic 401 auth error when the Authorization header is missing", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(getTeamResultsMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns a generic 401 auth error for a malformed Authorization header", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth("not-a-bearer-token"), params());

    expect(response.status).toBe(401);
    expect(getTeamResultsMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns a 'forbidden' response, never an aggregate, for a denied caller", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns the same 'forbidden' response shape for a nonexistent teamId as for an unauthorized one", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(
      requestWithAuth("Bearer valid-token"),
      params("nonexistent-team"),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ status: "forbidden" });
  });

  it("returns a 500 failure response, not a partial/fabricated aggregate, on a read failure", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("ignores a client-supplied period query parameter; only the token and path teamId reach getTeamResults", async () => {
    getTeamResultsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    await GET(
      new Request("http://localhost/api/teams/team-1/results?period=2026-W36", {
        headers: { authorization: "Bearer valid-token" },
      }),
      params("team-1"),
    );

    expect(getTeamResultsMock).toHaveBeenCalledTimes(1);
    expect(getTeamResultsMock).toHaveBeenCalledWith("valid-token", "team-1");
  });

  it("never logs the token or dashboard content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getTeamResultsMock.mockResolvedValue({
      ok: true,
      teamId: "team-1",
      current: { period: "2026-W35", status: "published", mean: { flow: 3, stress: 3, fun: 3 }, count: 5 },
      trend: [],
    });
    await GET(requestWithAuth("Bearer valid-token"), params());

    getTeamResultsMock.mockResolvedValue({ ok: false, error: "read_failed" });
    await GET(requestWithAuth("Bearer valid-token"), params());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
