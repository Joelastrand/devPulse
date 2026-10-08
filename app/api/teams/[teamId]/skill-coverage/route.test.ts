import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const coverageMock = vi.fn();

vi.mock("../../../../../src/features/team-skills/server/get-team-skill-coverage", () => ({
  getTeamSkillCoverage: coverageMock,
}));

const routeModule = await import("./route");
const { GET } = routeModule;

const params = (teamId = "team-1") => ({ params: Promise.resolve({ teamId }) });

function request(auth?: string, query = ""): Request {
  return new Request(`http://localhost/api/teams/team-1/skill-coverage${query}`, {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

const row = (state: string) => ({
  treeId: "t1",
  areaName: "Alpha",
  requiredLevel: 3,
  requiredCoverage: 2,
  state,
});

afterEach(() => coverageMock.mockReset());

describe("/api/teams/[teamId]/skill-coverage", () => {
  it("exports only GET", () => {
    expect(Object.keys(routeModule)).toEqual(["GET"]);
  });

  it("delegates with exactly (token, path teamId)", async () => {
    coverageMock.mockResolvedValue({ ok: true, availability: "available", rows: [] });
    await GET(request("Bearer abc.def"), params("team-42"));
    expect(coverageMock).toHaveBeenCalledTimes(1);
    expect(coverageMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it("passes an empty token when the header is missing or not a bearer", async () => {
    coverageMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    await GET(request(), params());
    await GET(request("Basic xyz"), params());
    expect(coverageMock.mock.calls).toEqual([
      ["", "team-1"],
      ["", "team-1"],
    ]);
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["team_disabled", 409],
    ["read_failed", 500],
  ])("maps %s to %i with a bare error body and no-store", async (error, status) => {
    coverageMock.mockResolvedValue({ ok: false, error });
    const response = await GET(request("Bearer t"), params());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error });
  });

  it("answers 200 no-store with exactly { availability, rows } and allow-listed row keys", async () => {
    coverageMock.mockResolvedValue({
      ok: true,
      availability: "available",
      rows: [{ ...row("covered"), uid: "leak", count: 5, levels: [4] }],
      contributors: 5,
    });
    const response = await GET(request("Bearer t"), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["availability", "rows"]);
    expect(body.rows).toEqual([row("covered")]);
    expect(Object.keys(body.rows[0]).sort()).toEqual(["areaName", "requiredCoverage", "requiredLevel", "state", "treeId"]);
  });

  it("an incomplete scan is a 200 with no rows", async () => {
    coverageMock.mockResolvedValue({ ok: true, availability: "incomplete", rows: [] });
    const response = await GET(request("Bearer t"), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ availability: "incomplete", rows: [] });
  });

  it("ignores query parameters: same delegation and same response with or without them", async () => {
    coverageMock.mockResolvedValue({ ok: true, availability: "available", rows: [row("gap")] });
    const plain = await GET(request("Bearer t"), params());
    const withQuery = await GET(request("Bearer t", "?level=2&coverage=1&k=3&threshold=1&treeId=x"), params());
    expect(coverageMock.mock.calls[1]).toEqual(coverageMock.mock.calls[0]);
    expect(await withQuery.json()).toEqual(await plain.json());
  });

  it("never reads the query string, body or non-authorization headers (source)", () => {
    const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/searchParams|request\.url|nextUrl|request\.(json|text|formData)/);
    expect(source.match(/headers\.get\(([^)]*)\)/g)).toEqual(['headers.get("authorization")']);
  });

  it("imports team-skills only (source)", () => {
    const source = fs.readFileSync(path.join(__dirname, "route.ts"), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["next/server", "../../../../../src/features/team-skills/server/get-team-skill-coverage"]);
  });
});
