import { afterEach, describe, expect, it, vi } from "vitest";

const seedLegacyTeamsMock = vi.fn();

vi.mock("../../../../../src/features/teams/server/seed-legacy-teams", () => ({
  seedLegacyTeams: seedLegacyTeamsMock,
}));

const { POST } = await import("./route");

function postRequest(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/seed-legacy", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

describe("POST /api/admin/teams/seed-legacy", () => {
  afterEach(() => {
    seedLegacyTeamsMock.mockReset();
  });

  it("returns 200 and the per-team outcomes for an app admin", async () => {
    const outcomes = [
      { teamId: "platform", result: "created" },
      { teamId: "web-app", result: "already_exists" },
    ];
    seedLegacyTeamsMock.mockResolvedValue({ ok: true, outcomes });

    const response = await POST(postRequest("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcomes });
  });

  it("extracts exactly the bearer token from the Authorization header", async () => {
    seedLegacyTeamsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await POST(postRequest("Bearer abc.def.ghi"));

    expect(seedLegacyTeamsMock).toHaveBeenCalledWith("abc.def.ghi");
  });

  it("returns 401 when unauthenticated and never seeds", async () => {
    seedLegacyTeamsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    expect(seedLegacyTeamsMock).toHaveBeenCalledWith("");
  });

  it("returns 403 for a non-admin caller, never seeding", async () => {
    seedLegacyTeamsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("never logs the token or outcomes for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    seedLegacyTeamsMock.mockResolvedValue({ ok: true, outcomes: [] });
    await POST(postRequest("Bearer valid-token"));

    seedLegacyTeamsMock.mockResolvedValue({ ok: false, error: "forbidden" });
    await POST(postRequest("Bearer valid-token"));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
