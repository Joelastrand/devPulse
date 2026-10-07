import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const setMock = vi.fn();
const withdrawMock = vi.fn();

vi.mock("../../../../../src/features/team-skills/server/get-own-skill-contribution", () => ({
  getOwnSkillContribution: getMock,
}));
vi.mock("../../../../../src/features/team-skills/server/set-own-skill-contribution", () => ({
  setOwnSkillContribution: setMock,
}));
vi.mock("../../../../../src/features/team-skills/server/withdraw-own-skill-contribution", () => ({
  withdrawOwnSkillContribution: withdrawMock,
}));

const routeModule = await import("./route");
const { GET, PUT, DELETE } = routeModule;

const params = (teamId = "team-1") => ({ params: Promise.resolve({ teamId }) });

function request(method: string, body?: string, auth?: string): Request {
  return new Request("http://localhost/api/teams/team-1/skill-contribution", {
    method,
    headers: auth ? { authorization: auth, "content-type": "application/json" } : { "content-type": "application/json" },
    body,
  });
}

afterEach(() => {
  getMock.mockReset();
  setMock.mockReset();
  withdrawMock.mockReset();
});

describe("/api/teams/[teamId]/skill-contribution", () => {
  it("exports only GET, PUT and DELETE", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["DELETE", "GET", "PUT"]);
  });

  it("GET passes token and path team, returning only the two booleans", async () => {
    getMock.mockResolvedValue({ ok: true, contributing: true, canOptIn: false, consentedAt: "leak", uid: "leak" });
    const response = await GET(request("GET", undefined, "Bearer abc.def"), params("team-42"));

    expect(getMock).toHaveBeenCalledWith("abc.def", "team-42");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contributing: true, canOptIn: false });
  });

  it("PUT passes the body untouched (no subject taken from it) and answers { contributing: true }", async () => {
    setMock.mockResolvedValue({ ok: true, contributing: true, consentedAt: "leak" });
    const body = { noticeVersion: 1, uid: "victim" };
    const response = await PUT(request("PUT", JSON.stringify(body), "Bearer abc"), params("team-7"));

    expect(setMock).toHaveBeenCalledWith("abc", "team-7", body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contributing: true });
  });

  it("PUT passes unparsable JSON as undefined and a missing header as an empty token", async () => {
    setMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const response = await PUT(request("PUT", "{nope"), params());
    expect(setMock).toHaveBeenCalledWith("", "team-1", undefined);
    expect(response.status).toBe(401);
  });

  it("DELETE ignores any body and answers { contributing: false }", async () => {
    withdrawMock.mockResolvedValue({ ok: true, contributing: false });
    const response = await DELETE(request("DELETE", JSON.stringify({ uid: "victim" }), "Bearer abc"), params("team-3"));

    expect(withdrawMock).toHaveBeenCalledWith("abc", "team-3");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contributing: false });
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_input", 400],
    ["notice_outdated", 409],
    ["team_disabled", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i with only the error code", async (error, status) => {
    setMock.mockResolvedValue({ ok: false, error });
    const response = await PUT(request("PUT", "{}", "Bearer abc"), params());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("the route file does not name the participation field or read any other store", () => {
    const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/skillContribution|consentedAt|firebase|teamMemberships/);
  });
});
