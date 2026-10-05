import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOwnSkillLevel,
  deleteOwnSkillProfile,
  fetchOwnSkills,
  setOwnSkillLevel,
} from "./skill-profile-gateway";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => ({ status, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function failToParse(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      json: async () => {
        throw new Error("bad json");
      },
    })),
  );
}

function networkFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network");
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const DTO = {
  skills: [
    { treeId: "t-1", name: "Testing", level: 3 },
    { treeId: "t-2", name: "Arkitektur", level: null },
  ],
  truncated: false,
  profile: "ok",
};

describe("fetchOwnSkills", () => {
  it("GETs /api/me/skills with only the Authorization header and returns the server DTO unchanged", async () => {
    const fetchMock = respond(200, DTO);

    const result = await fetchOwnSkills("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/me/skills", { headers: { Authorization: "Bearer an-id-token" } });
    expect(result).toEqual({ status: "ok", dto: DTO });
  });

  it("preserves truncated and unreadable-profile state from the DTO", async () => {
    respond(200, { skills: [], truncated: true, profile: "unreadable" });

    expect(await fetchOwnSkills("t")).toEqual({
      status: "ok",
      dto: { skills: [], truncated: true, profile: "unreadable" },
    });
  });

  it.each([
    ["a non-object body", "nope"],
    ["a null body", null],
    ["missing truncated", { skills: [], profile: "ok" }],
    ["a non-boolean truncated", { skills: [], truncated: "no", profile: "ok" }],
    ["an unknown profile state", { skills: [], truncated: false, profile: "empty" }],
    ["an extra top-level key", { ...DTO, uid: "u1" }],
    ["skills not being an array", { ...DTO, skills: {} }],
    ["a row with level 0", { ...DTO, skills: [{ treeId: "t", name: "N", level: 0 }] }],
    ["a row with level 5", { ...DTO, skills: [{ treeId: "t", name: "N", level: 5 }] }],
    ["a row with a string level", { ...DTO, skills: [{ treeId: "t", name: "N", level: "3" }] }],
    ["a row with an extra key", { ...DTO, skills: [{ treeId: "t", name: "N", level: 1, nodes: [] }] }],
    ["a row without a name", { ...DTO, skills: [{ treeId: "t", level: 1 }] }],
    ["a row with an empty treeId", { ...DTO, skills: [{ treeId: "", name: "N", level: 1 }] }],
  ])("fails safe to read_failed for a malformed 200 body (%s)", async (_label, body) => {
    respond(200, body);

    expect(await fetchOwnSkills("t")).toEqual({ status: "read_failed" });
  });

  it("maps 401 to unauthenticated, even with an unparseable body", async () => {
    failToParse(401);

    expect(await fetchOwnSkills("t")).toEqual({ status: "unauthenticated" });
  });

  it("maps 500 and a thrown fetch to read_failed", async () => {
    respond(500, { error: "persistence_failed" });
    expect(await fetchOwnSkills("t")).toEqual({ status: "read_failed" });

    networkFailure();
    expect(await fetchOwnSkills("t")).toEqual({ status: "read_failed" });
  });
});

describe("setOwnSkillLevel", () => {
  it("PUTs exactly {level} with the Authorization header to the URL-encoded treeId — no uid or subject", async () => {
    const fetchMock = respond(200, { level: 3 });

    const result = await setOwnSkillLevel("an-id-token", "tree/with space?x=1#y", 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, rawInit] = fetchMock.mock.calls[0];
    const init = rawInit ?? {};
    expect(url).toBe("/api/me/skills/tree%2Fwith%20space%3Fx%3D1%23y");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ Authorization: "Bearer an-id-token", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ level: 3 });
    expect(Object.keys(init).sort()).toEqual(["body", "headers", "method"]);
    expect(result).toEqual({ ok: true, level: 3 });
  });

  it("returns the canonical level from the server, not the requested one", async () => {
    respond(200, { level: 4 });

    expect(await setOwnSkillLevel("t", "t-1", 2)).toEqual({ ok: true, level: 4 });
  });

  it.each([
    ["a missing level", {}],
    ["a null level", { level: null }],
    ["level 0", { level: 0 }],
    ["an extra key", { level: 2, uid: "u" }],
    ["a non-object body", "ok"],
  ])("treats a malformed 200 body (%s) as a generic failure", async (_label, body) => {
    respond(200, body);

    expect(await setOwnSkillLevel("t", "t-1", 2)).toEqual({ ok: false, error: "unknown" });
  });

  it.each([
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [400, { error: "invalid_input" }, "invalid_input"],
    [400, { error: "invalid_request" }, "invalid_input"],
    [404, { error: "skill_unavailable" }, "skill_unavailable"],
    [409, { error: "profile_unreadable" }, "profile_unreadable"],
    [500, { error: "persistence_failed" }, "persistence_failed"],
    [502, { error: "something_else" }, "unknown"],
    [500, undefined, "unknown"],
  ])("maps status %s %j to the distinct result %s", async (status, body, expected) => {
    respond(status, body);

    expect(await setOwnSkillLevel("t", "t-1", 2)).toEqual({ ok: false, error: expected });
  });

  it("maps a bare 401 with an unparseable body to unauthenticated and a thrown fetch to unknown", async () => {
    failToParse(401);
    expect(await setOwnSkillLevel("t", "t-1", 2)).toEqual({ ok: false, error: "unauthenticated" });

    networkFailure();
    expect(await setOwnSkillLevel("t", "t-1", 2)).toEqual({ ok: false, error: "unknown" });
  });
});

describe("clearOwnSkillLevel", () => {
  it("DELETEs the URL-encoded treeId with only the Authorization header and no body", async () => {
    const fetchMock = respond(200, { level: null });

    const result = await clearOwnSkillLevel("an-id-token", "a/b c");

    expect(fetchMock).toHaveBeenCalledWith("/api/me/skills/a%2Fb%20c", {
      method: "DELETE",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true, level: null });
  });

  it.each([
    ["a missing level", {}],
    ["a numeric level", { level: 2 }],
    ["an extra key", { level: null, uid: "u" }],
  ])("treats a malformed 200 body (%s) as a generic failure", async (_label, body) => {
    respond(200, body);

    expect(await clearOwnSkillLevel("t", "t-1")).toEqual({ ok: false, error: "unknown" });
  });

  it.each([
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [404, { error: "skill_unavailable" }, "skill_unavailable"],
    [409, { error: "profile_unreadable" }, "profile_unreadable"],
    [500, { error: "persistence_failed" }, "persistence_failed"],
    [500, "garbage", "unknown"],
  ])("maps status %s %j to the distinct result %s", async (status, body, expected) => {
    respond(status, body);

    expect(await clearOwnSkillLevel("t", "t-1")).toEqual({ ok: false, error: expected });
  });

  it("maps a thrown fetch to unknown", async () => {
    networkFailure();

    expect(await clearOwnSkillLevel("t", "t-1")).toEqual({ ok: false, error: "unknown" });
  });
});

describe("deleteOwnSkillProfile", () => {
  it("DELETEs /api/me/skills with only the Authorization header — no body, no subject", async () => {
    const fetchMock = respond(200, { ok: true });

    const result = await deleteOwnSkillProfile("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/me/skills", {
      method: "DELETE",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true });
  });

  it.each([
    ["a missing ok", {}],
    ["ok: false", { ok: false }],
    ["an extra key", { ok: true, uid: "u" }],
  ])("treats a malformed 200 body (%s) as a generic failure", async (_label, body) => {
    respond(200, body);

    expect(await deleteOwnSkillProfile("t")).toEqual({ ok: false, error: "unknown" });
  });

  it.each([
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [500, { error: "persistence_failed" }, "persistence_failed"],
    [409, { error: "profile_unreadable" }, "unknown"],
    [500, undefined, "unknown"],
  ])("maps status %s %j to %s", async (status, body, expected) => {
    respond(status, body);

    expect(await deleteOwnSkillProfile("t")).toEqual({ ok: false, error: expected });
  });

  it("maps a bare 401 with an unparseable body to unauthenticated and a thrown fetch to unknown", async () => {
    failToParse(401);
    expect(await deleteOwnSkillProfile("t")).toEqual({ ok: false, error: "unauthenticated" });

    networkFailure();
    expect(await deleteOwnSkillProfile("t")).toEqual({ ok: false, error: "unknown" });
  });
});
