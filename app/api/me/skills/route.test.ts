import { afterEach, describe, expect, it, vi } from "vitest";

const getOwnSkillsMock = vi.fn();

const deleteOwnSkillProfileMock = vi.fn();

vi.mock("../../../../src/features/skill-profiles/server/get-own-skills", () => ({
  getOwnSkills: getOwnSkillsMock,
}));

vi.mock("../../../../src/features/skill-profiles/server/delete-own-skill-profile", () => ({
  deleteOwnSkillProfile: deleteOwnSkillProfileMock,
}));

const routeModule = await import("./route");

function request(header?: string, url = "http://localhost/api/me/skills"): Request {
  return new Request(url, { method: "GET", headers: header ? { authorization: header } : {} });
}

afterEach(() => {
  getOwnSkillsMock.mockReset();
  deleteOwnSkillProfileMock.mockReset();
});

describe("GET /api/me/skills", () => {
  it("maps the bearer token and returns exactly the allow-listed DTO", async () => {
    getOwnSkillsMock.mockResolvedValue({
      ok: true,
      dto: {
        skills: [{ treeId: "ts", name: "TypeScript", level: 3, nodes: ["leak"] }],
        truncated: true,
        profile: "ok",
        extra: "leak",
      },
    });

    const response = await routeModule.GET(request("Bearer abc.def"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skills: [{ treeId: "ts", name: "TypeScript", level: 3 }],
      truncated: true,
      profile: "ok",
    });
    expect(getOwnSkillsMock).toHaveBeenCalledWith("abc.def");
  });

  it.each([[undefined], ["Basic abc"], ["Bearer"]])("passes an empty token for header %s", async (header) => {
    getOwnSkillsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await routeModule.GET(request(header));

    expect(getOwnSkillsMock).toHaveBeenCalledWith("");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 500 persistence_failed", async () => {
    getOwnSkillsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await routeModule.GET(request("Bearer t"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });

  it("takes no subject from the query, only the token", async () => {
    getOwnSkillsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await routeModule.GET(request("Bearer t", "http://localhost/api/me/skills?uid=other&teamId=x"));

    expect(getOwnSkillsMock.mock.calls).toEqual([["t"]]);
  });

  it("routes exactly GET and DELETE", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["DELETE", "GET"]);
  });
});

describe("DELETE /api/me/skills", () => {
  function deleteRequest(header?: string, init: { body?: string; url?: string } = {}): Request {
    return new Request(init.url ?? "http://localhost/api/me/skills", {
      method: "DELETE",
      headers: header ? { authorization: header } : {},
      body: init.body,
    });
  }

  it("maps the bearer token and returns exactly { ok: true }", async () => {
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true, uid: "leak", levels: { ts: 1 } });

    const response = await routeModule.DELETE(deleteRequest("Bearer abc.def"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deleteOwnSkillProfileMock.mock.calls).toEqual([["abc.def"]]);
  });

  it.each([[undefined], ["Basic abc"], ["Bearer"]])("passes an empty token for header %s", async (header) => {
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await routeModule.DELETE(deleteRequest(header));

    expect(deleteOwnSkillProfileMock).toHaveBeenCalledWith("");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 500 persistence_failed without internal detail", async () => {
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await routeModule.DELETE(deleteRequest("Bearer t"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });

  it("never reads the body, even an invalid JSON one", async () => {
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });
    const request = deleteRequest("Bearer t", { body: "{not json" });

    const response = await routeModule.DELETE(request);

    expect(response.status).toBe(200);
    expect(request.bodyUsed).toBe(false);
  });

  it("takes no subject from the query, only the token", async () => {
    deleteOwnSkillProfileMock.mockResolvedValue({ ok: true });

    await routeModule.DELETE(deleteRequest("Bearer t", { url: "http://localhost/api/me/skills?uid=other&teamId=x" }));

    expect(deleteOwnSkillProfileMock.mock.calls).toEqual([["t"]]);
  });
});
