import { afterEach, describe, expect, it, vi } from "vitest";

const getDashboardMock = vi.fn();

vi.mock("../../../src/features/results/server/get-dashboard", () => ({
  getDashboard: getDashboardMock,
}));

const { GET } = await import("./route");

function requestWithAuth(
  header?: string,
  url = "http://localhost/api/results",
): Request {
  return new Request(url, header ? { headers: { authorization: header } } : {});
}

describe("GET /api/results", () => {
  afterEach(() => {
    getDashboardMock.mockReset();
  });

  it("returns the dashboard payload for a resolved, verified caller", async () => {
    getDashboardMock.mockResolvedValue({
      ok: true,
      teamId: "platform",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      teamId: "platform",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });
  });

  it("extracts exactly the bearer token from the Authorization header", async () => {
    getDashboardMock.mockResolvedValue({ ok: false, error: "no_team" });

    await GET(requestWithAuth("Bearer abc.def.ghi"));

    expect(getDashboardMock).toHaveBeenCalledWith("abc.def.ghi");
  });

  it("returns a generic 401 auth error when the Authorization header is missing", async () => {
    getDashboardMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth());

    expect(response.status).toBe(401);
    expect(getDashboardMock).toHaveBeenCalledWith("");
  });

  it("returns a generic 401 auth error for a malformed Authorization header", async () => {
    getDashboardMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth("not-a-bearer-token"));

    expect(response.status).toBe(401);
    expect(getDashboardMock).toHaveBeenCalledWith("");
  });

  it("returns a 'no team' response, never an aggregate, for an unassigned/unverified caller", async () => {
    getDashboardMock.mockResolvedValue({ ok: false, error: "no_team" });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "no_team" });
  });

  it("returns a 500 failure response, not a partial/fabricated aggregate, on a read failure", async () => {
    getDashboardMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("ignores a client-supplied teamId/period query parameter; only the token reaches getDashboard", async () => {
    getDashboardMock.mockResolvedValue({ ok: false, error: "no_team" });

    await GET(
      requestWithAuth(
        "Bearer valid-token",
        "http://localhost/api/results?teamId=other-team&period=2026-W36",
      ),
    );

    expect(getDashboardMock).toHaveBeenCalledTimes(1);
    expect(getDashboardMock).toHaveBeenCalledWith("valid-token");
  });

  it("never logs the token or dashboard content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getDashboardMock.mockResolvedValue({
      ok: true,
      teamId: "platform",
      current: { period: "2026-W35", status: "published", mean: { flow: 3, stress: 3, fun: 3 }, count: 5 },
      trend: [],
    });
    await GET(requestWithAuth("Bearer valid-token"));

    getDashboardMock.mockResolvedValue({ ok: false, error: "read_failed" });
    await GET(requestWithAuth("Bearer valid-token"));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
