import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOwnProfile, removeOwnProfile, saveOwnProfile } from "./profile-gateway";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ status, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOwnProfile", () => {
  it("GETs /api/me/profile with only the Authorization header — no uid, e-mail or query", async () => {
    const fetchMock = respond(200, { displayName: "Anna Berg" });

    const result = await fetchOwnProfile("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/me/profile", { headers: { Authorization: "Bearer an-id-token" } });
    expect(result).toEqual({ status: "ok", displayName: "Anna Berg" });
  });

  it("treats displayName: null as a normal successful 'no name set' result", async () => {
    respond(200, { displayName: null });

    expect(await fetchOwnProfile("t")).toEqual({ status: "ok", displayName: null });
  });

  it.each([
    ["a missing displayName", {}],
    ["a number", { displayName: 7 }],
    ["an empty string", { displayName: "" }],
    ["a non-object body", "nope"],
    ["a null body", null],
  ])("fails safe to read_failed for a malformed 200 body (%s)", async (_label, body) => {
    respond(200, body);

    expect(await fetchOwnProfile("t")).toEqual({ status: "read_failed" });
  });

  it("maps a 401 to unauthenticated, even with an unparseable body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, json: async () => { throw new Error("bad json"); } })));

    expect(await fetchOwnProfile("t")).toEqual({ status: "unauthenticated" });
  });

  it("maps a 500 and a thrown fetch to read_failed", async () => {
    respond(500, { error: "persistence_failed" });
    expect(await fetchOwnProfile("t")).toEqual({ status: "read_failed" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await fetchOwnProfile("t")).toEqual({ status: "read_failed" });
  });
});

describe("saveOwnProfile", () => {
  it("PUTs exactly {displayName} with the Authorization header — nothing else", async () => {
    const fetchMock = respond(200, { displayName: "Anna Berg" });

    await saveOwnProfile("an-id-token", "  Anna   Berg ");

    expect(fetchMock).toHaveBeenCalledWith("/api/me/profile", {
      method: "PUT",
      headers: { Authorization: "Bearer an-id-token", "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "  Anna   Berg " }),
    });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(Object.keys(sent)).toEqual(["displayName"]);
  });

  it("returns the server's canonical (normalised) value, not the input", async () => {
    respond(200, { displayName: "Anna Berg" });

    expect(await saveOwnProfile("t", "  Anna   Berg ")).toEqual({ ok: true, displayName: "Anna Berg" });
  });

  it("maps a validation error from the server", async () => {
    respond(400, { error: "invalid_input" });

    expect(await saveOwnProfile("t", "A")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("maps auth and persistence errors", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await saveOwnProfile("t", "Anna")).toEqual({ ok: false, error: "unauthenticated" });

    respond(500, { error: "persistence_failed" });
    expect(await saveOwnProfile("t", "Anna")).toEqual({ ok: false, error: "persistence_failed" });
  });

  it.each([
    ["an unknown error code", 400, { error: "invalid_request" }],
    ["a malformed success body", 200, { displayName: 5 }],
    ["an empty success body", 200, {}],
    ["a non-object body", 200, "nope"],
  ])("maps %s to unknown, never to success", async (_label, status, body) => {
    respond(status, body);

    expect(await saveOwnProfile("t", "Anna")).toEqual({ ok: false, error: "unknown" });
  });

  it("maps a thrown fetch to unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));

    expect(await saveOwnProfile("t", "Anna")).toEqual({ ok: false, error: "unknown" });
  });
});

describe("removeOwnProfile", () => {
  it("DELETEs /api/me/profile with only the Authorization header", async () => {
    const fetchMock = respond(200, { ok: true });

    const result = await removeOwnProfile("an-id-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/me/profile", {
      method: "DELETE",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true });
  });

  it("maps auth and persistence errors", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await removeOwnProfile("t")).toEqual({ ok: false, error: "unauthenticated" });

    respond(500, { error: "persistence_failed" });
    expect(await removeOwnProfile("t")).toEqual({ ok: false, error: "persistence_failed" });
  });

  it.each([
    ["a 200 without ok: true", 200, {}],
    ["a non-object body", 200, "nope"],
    ["an unknown error", 500, { error: "weird" }],
  ])("maps %s to unknown, never to success", async (_label, status, body) => {
    respond(status, body);

    expect(await removeOwnProfile("t")).toEqual({ ok: false, error: "unknown" });
  });
});
