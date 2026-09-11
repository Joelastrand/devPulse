import { afterEach, describe, expect, it, vi } from "vitest";

const createTeamMock = vi.fn();
const listTeamsMock = vi.fn();

vi.mock("../../../../src/features/teams/server/create-team", () => ({
  createTeam: createTeamMock,
}));
vi.mock("../../../../src/features/teams/server/list-teams", () => ({
  listTeams: listTeamsMock,
}));

const { GET, POST } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams", {
    headers: header ? { authorization: header } : {},
  });
}

function postRequest(body: unknown, header = "Bearer valid-token"): Request {
  return new Request("http://localhost/api/admin/teams", {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/teams", () => {
  afterEach(() => {
    listTeamsMock.mockReset();
  });

  it("returns the team list for an app admin", async () => {
    const teams = [
      { teamId: "team-1", name: "Platform", status: "active" },
    ];
    listTeamsMock.mockResolvedValue({ ok: true, teams });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ teams });
  });

  it("extracts exactly the bearer token from the Authorization header", async () => {
    listTeamsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await GET(requestWithAuth("Bearer abc.def.ghi"));

    expect(listTeamsMock).toHaveBeenCalledWith("abc.def.ghi");
  });

  it("returns 401 when unauthenticated", async () => {
    listTeamsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth());

    expect(response.status).toBe(401);
    expect(listTeamsMock).toHaveBeenCalledWith("");
  });

  it("returns 403 for a non-admin caller, never a team list", async () => {
    listTeamsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("returns 500 on a read failure, not a partial list", async () => {
    listTeamsMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"));

    expect(response.status).toBe(500);
  });
});

describe("POST /api/admin/teams", () => {
  afterEach(() => {
    createTeamMock.mockReset();
  });

  it("returns 201 and the new teamId for a valid admin creation", async () => {
    createTeamMock.mockResolvedValue({ ok: true, teamId: "generated-1" });

    const response = await POST(postRequest({ name: "Platform" }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ teamId: "generated-1" });
  });

  it("passes the bearer token and name through to createTeam", async () => {
    createTeamMock.mockResolvedValue({ ok: true, teamId: "generated-1" });

    await POST(postRequest({ name: "Platform" }, "Bearer abc.def.ghi"));

    expect(createTeamMock).toHaveBeenCalledWith("abc.def.ghi", "Platform");
  });

  it("returns a generic 4xx and never calls createTeam for a malformed body", async () => {
    const request = new Request("http://localhost/api/admin/teams", {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createTeamMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    createTeamMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(postRequest({ name: "Platform" }, ""));

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller, never creating a team", async () => {
    createTeamMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest({ name: "Platform" }));

    expect(response.status).toBe(403);
  });

  it("returns 400 for an invalid name", async () => {
    createTeamMock.mockResolvedValue({ ok: false, error: "invalid_name" });

    const response = await POST(postRequest({ name: "  " }));

    expect(response.status).toBe(400);
  });

  it("returns 500, not a partial success, on a persistence failure", async () => {
    createTeamMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest({ name: "Platform" }));

    expect(response.status).toBe(500);
  });

  it("never logs the token, name, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createTeamMock.mockResolvedValue({ ok: true, teamId: "generated-1" });
    await POST(postRequest({ name: "Platform" }));

    createTeamMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    await POST(postRequest({ name: "Platform" }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
