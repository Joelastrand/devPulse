import { describe, expect, it, vi, beforeEach } from "vitest";

const service = vi.hoisted(() => ({ setSystemFavorite: vi.fn() }));
vi.mock("../../../../../../src/features/team-systems/server/system-favorites", () => service);

const { PUT } = await import("./route");

function request(body: unknown, { raw, token = "token-a" }: { raw?: string; token?: string } = {}) {
  return new Request("https://app.test/api/teams/team-1/system-favorites/sys-1", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ teamId: "team-1", systemId: "sys-1" }) };

describe("PUT /api/teams/[teamId]/system-favorites/[systemId] (Phase 2F.1)", () => {
  beforeEach(() => {
    service.setSystemFavorite.mockReset();
  });

  it("passes the bearer token, team and system from the request and returns the confirmed state", async () => {
    service.setSystemFavorite.mockResolvedValue({ ok: true, favorite: true });

    const response = await PUT(request({ favorite: true }), context);

    expect(service.setSystemFavorite).toHaveBeenCalledWith("token-a", "team-1", "sys-1", true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ favorite: true });
  });

  const invalidBodies: Array<[string, { body?: unknown; raw?: string }]> = [
    ["a body that is not JSON", { raw: "{not json" }],
    ["an array body", { body: [true] }],
    ["a body with no favorite key", { body: {} }],
    ["a body with an extra key that could carry a uid", { body: { favorite: true, uid: "uid-other" } }],
    ["a non-boolean favorite value", { body: { favorite: "yes" } }],
  ];
  it.each(invalidBodies)("refuses %s as an invalid request without calling the service", async (_label, input) => {
    const response = await PUT(request(input.body, { raw: input.raw }), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(service.setSystemFavorite).not.toHaveBeenCalled();
  });

  it("maps a refusal to its status code and returns only the code", async () => {
    service.setSystemFavorite.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await PUT(request({ favorite: true }), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("maps an unauthenticated refusal to 401 without any detail", async () => {
    service.setSystemFavorite.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PUT(request({ favorite: true }, { token: "" }), context);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});
