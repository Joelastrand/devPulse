import { afterEach, describe, expect, it, vi } from "vitest";

const getTeamsOverviewMock = vi.fn();

vi.mock("../../../src/features/teams/server/get-teams-overview", () => ({
  getTeamsOverview: getTeamsOverviewMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams", {
    headers: header ? { authorization: header } : {},
  });
}

describe("GET /api/teams", () => {
  afterEach(() => {
    getTeamsOverviewMock.mockReset();
  });

  it("returns the overview payload for an authenticated caller", async () => {
    getTeamsOverviewMock.mockResolvedValue({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "member" }],
    });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Team One", relationship: "member" }],
    });
  });

  it("extracts exactly the bearer token", async () => {
    getTeamsOverviewMock.mockResolvedValue({ ok: true, teams: [] });

    await GET(requestWithAuth("Bearer abc.def.ghi"));

    expect(getTeamsOverviewMock).toHaveBeenCalledWith("abc.def.ghi");
  });

  it("returns a 401 error when the Authorization header is missing, and calls through with an empty token", async () => {
    getTeamsOverviewMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ status: "unauthenticated" });
    expect(getTeamsOverviewMock).toHaveBeenCalledWith("");
  });

  it("returns a 401 error for a malformed Authorization header", async () => {
    getTeamsOverviewMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth("not-a-bearer-token"));

    expect(response.status).toBe(401);
    expect(getTeamsOverviewMock).toHaveBeenCalledWith("");
  });

  it("returns a 500 failure response, not a partial/fabricated list, on a read failure", async () => {
    getTeamsOverviewMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ status: "read_failed" });
  });

  it("never logs the token or overview content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getTeamsOverviewMock.mockResolvedValue({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "admin" }],
    });
    await GET(requestWithAuth("Bearer valid-token"));

    getTeamsOverviewMock.mockResolvedValue({ ok: false, error: "read_failed" });
    await GET(requestWithAuth("Bearer valid-token"));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
