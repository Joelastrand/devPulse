import { afterEach, describe, expect, it, vi } from "vitest";

const materializeMock = vi.fn();

vi.mock("../../../../../../src/features/teams/server/materialize-member-refs", () => ({
  materializeMemberRefs: materializeMock,
}));

const routeModule = await import("./route");

function post(header?: string, body?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/member-refs", {
    method: "POST",
    headers: header ? { authorization: header } : {},
    body,
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("POST /api/admin/teams/[teamId]/member-refs", () => {
  afterEach(() => {
    materializeMock.mockReset();
  });

  it("returns only the operational counts for an app admin", async () => {
    materializeMock.mockResolvedValue({ ok: true, materialized: 2, alreadyHad: 1, truncated: false });

    const response = await routeModule.POST(post("Bearer valid-token"), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ materialized: 2, alreadyHad: 1, truncated: false });
  });

  it("passes only the bearer token and route teamId, ignoring any request body", async () => {
    materializeMock.mockResolvedValue({ ok: true, materialized: 0, alreadyHad: 0, truncated: false });

    await routeModule.POST(post("Bearer abc.def", JSON.stringify({ teamId: "other", memberRef: "x" })), params("team-42"));

    expect(materializeMock).toHaveBeenCalledWith("abc.def", "team-42");
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["team_not_found", 404],
    ["persistence_failed", 500],
  ])("maps %s to %i", async (error, status) => {
    materializeMock.mockResolvedValue({ ok: false, error });

    const response = await routeModule.POST(post("Bearer valid-token"), params());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("calls the operation with an empty token when the header is missing or not a bearer token", async () => {
    materializeMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await routeModule.POST(post(), params());
    await routeModule.POST(post("Basic abc"), params());

    expect(materializeMock).toHaveBeenNthCalledWith(1, "", "team-1");
    expect(materializeMock).toHaveBeenNthCalledWith(2, "", "team-1");
  });

  it("exposes only POST (no GET, so nothing can write on a read)", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["POST"]);
  });
});
