import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamSystemsMock = vi.fn();
const writeTeamSystemMock = vi.fn();

vi.mock("../../../../../src/features/team-systems/server/list-team-systems", () => ({
  listTeamSystems: listTeamSystemsMock,
}));

vi.mock("../../../../../src/features/team-systems/server/write-team-system", () => ({
  writeTeamSystem: writeTeamSystemMock,
}));

const { GET, POST } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWith(body?: unknown, header = "Bearer abc.def"): Request {
  return new Request("http://localhost/api/teams/team-1/systems", {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  listTeamSystemsMock.mockReset();
  writeTeamSystemMock.mockReset();
});

describe("GET /api/teams/[teamId]/systems", () => {
  it("returns exactly systems, canEdit and truncated and passes the bearer token through", async () => {
    listTeamSystemsMock.mockResolvedValue({ ok: true, systems: [{ name: "A" }], canEdit: true, truncated: false });

    const response = await GET(requestWith(), params("team-42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ systems: [{ name: "A" }], canEdit: true, truncated: false });
    expect(listTeamSystemsMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it("passes an empty token when the Authorization header is not a bearer token", async () => {
    listTeamSystemsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWith(undefined, "Basic nope"), params());

    expect(response.status).toBe(401);
    expect(listTeamSystemsMock).toHaveBeenCalledWith("", "team-1");
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["read_failed", 500],
  ])("maps %s to %i with an error code only", async (error, status) => {
    listTeamSystemsMock.mockResolvedValue({ ok: false, error });

    const response = await GET(requestWith(), params());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});

describe("POST /api/teams/[teamId]/systems", () => {
  it("returns 201 with the new systemId only", async () => {
    writeTeamSystemMock.mockResolvedValue({ ok: true, systemId: "sys-1" });

    const response = await POST(requestWith({ name: "Saksportalen" }), params());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ systemId: "sys-1" });
    expect(writeTeamSystemMock).toHaveBeenCalledWith("abc.def", "team-1", null, { name: "Saksportalen" });
  });

  it("treats unparsable JSON as an invalid request body", async () => {
    writeTeamSystemMock.mockResolvedValue({ ok: false, error: "invalid_request" });
    const badRequest = new Request("http://localhost/api/teams/team-1/systems", {
      method: "POST",
      headers: { authorization: "Bearer abc.def" },
      body: "{not json",
    });

    const response = await POST(badRequest, params());

    expect(writeTeamSystemMock).toHaveBeenCalledWith("abc.def", "team-1", null, undefined);
    expect(response.status).toBe(400);
  });

  it.each([
    ["forbidden", 403],
    ["team_disabled", 400],
    ["invalid_knowledge", 400],
    ["limit_reached", 409],
    ["erasure_in_progress", 403],
    ["persistence_failed", 500],
  ])("maps %s to %i with an error code only", async (error, status) => {
    writeTeamSystemMock.mockResolvedValue({ ok: false, error });

    const response = await POST(requestWith({ name: "X" }), params());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
