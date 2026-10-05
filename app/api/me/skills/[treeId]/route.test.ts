import { afterEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn();
const clearMock = vi.fn();

vi.mock("../../../../../src/features/skill-profiles/server/set-own-skill-level", () => ({
  setOwnSkillLevel: setMock,
}));
vi.mock("../../../../../src/features/skill-profiles/server/clear-own-skill-level", () => ({
  clearOwnSkillLevel: clearMock,
}));

const routeModule = await import("./route");

const ctx = (treeId = "ts") => ({ params: Promise.resolve({ treeId }) });

function put(body: string | undefined, header: string | null = "Bearer abc", url = "http://localhost/api/me/skills/ts") {
  return new Request(url, {
    method: "PUT",
    headers: header ? { authorization: header, "content-type": "application/json" } : {},
    body,
  });
}

afterEach(() => {
  setMock.mockReset();
  clearMock.mockReset();
});

describe("PUT /api/me/skills/[treeId]", () => {
  it("passes token, path treeId and parsed body, and returns exactly { level }", async () => {
    setMock.mockResolvedValue({ ok: true, level: 3, extra: "leak" });
    const response = await routeModule.PUT(put('{"level":3}'), ctx("go"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ level: 3 });
    expect(setMock).toHaveBeenCalledWith("abc", "go", { level: 3 });
  });

  it.each([
    ["unauthenticated", 401],
    ["invalid_request", 400],
    ["invalid_input", 400],
    ["skill_unavailable", 404],
    ["profile_unreadable", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i with only the error code", async (error, status) => {
    setMock.mockResolvedValue({ ok: false, error });
    const response = await routeModule.PUT(put('{"level":1}'), ctx());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it.each([["malformed JSON", "{nope"], ["missing body", undefined]])(
    "hands an undefined body to the operation for %s",
    async (_label, body) => {
      setMock.mockResolvedValue({ ok: false, error: "invalid_request" });
      const response = await routeModule.PUT(put(body), ctx());
      expect(setMock).toHaveBeenCalledWith("abc", "ts", undefined);
      expect(response.status).toBe(400);
    },
  );

  it.each([[null], ["Basic abc"], ["Bearer"]])("passes an empty token for header %s", async (header) => {
    setMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const response = await routeModule.PUT(put('{"level":1}', header), ctx());
    expect(setMock.mock.calls[0][0]).toBe("");
    expect(response.status).toBe(401);
  });

  it("takes no subject from the query or body", async () => {
    setMock.mockResolvedValue({ ok: true, level: 1 });
    await routeModule.PUT(put('{"level":1,"uid":"other"}', "Bearer t", "http://localhost/api/me/skills/ts?uid=other"), ctx());
    expect(setMock.mock.calls[0].slice(0, 2)).toEqual(["t", "ts"]);
    expect(setMock.mock.calls[0]).toHaveLength(3);
  });
});

describe("DELETE /api/me/skills/[treeId]", () => {
  it("returns { level: null } and calls the operation with token and treeId only", async () => {
    clearMock.mockResolvedValue({ ok: true, level: null });
    const response = await routeModule.DELETE(
      new Request("http://localhost/api/me/skills/ts", { method: "DELETE", headers: { authorization: "Bearer abc" } }),
      ctx("go"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ level: null });
    expect(clearMock.mock.calls).toEqual([["abc", "go"]]);
  });

  it("ignores a malformed request body without reading it", async () => {
    clearMock.mockResolvedValue({ ok: true, level: null });
    const request = new Request("http://localhost/api/me/skills/ts", {
      method: "DELETE",
      headers: { authorization: "Bearer abc", "content-type": "application/json" },
      body: "{not json",
    });
    const response = await routeModule.DELETE(request, ctx());
    expect(response.status).toBe(200);
    expect(request.bodyUsed).toBe(false);
  });

  it.each([
    ["unauthenticated", 401],
    ["skill_unavailable", 404],
    ["profile_unreadable", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i", async (error, status) => {
    clearMock.mockResolvedValue({ ok: false, error });
    const response = await routeModule.DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});

describe("route surface", () => {
  it("routes exactly PUT and DELETE", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["DELETE", "PUT"]);
  });
});
