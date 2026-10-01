import { afterEach, describe, expect, it, vi } from "vitest";

const getOwnProfileMock = vi.fn();
const setOwnProfileMock = vi.fn();
const deleteOwnProfileMock = vi.fn();

vi.mock("../../../../src/features/profiles/server/get-own-profile", () => ({
  getOwnProfile: getOwnProfileMock,
}));
vi.mock("../../../../src/features/profiles/server/set-own-profile", () => ({
  setOwnProfile: setOwnProfileMock,
}));
vi.mock("../../../../src/features/profiles/server/delete-own-profile", () => ({
  deleteOwnProfile: deleteOwnProfileMock,
}));

const { GET, PUT, DELETE } = await import("./route");

function request(method: string, header?: string, body?: unknown): Request {
  return new Request("http://localhost/api/me/profile", {
    method,
    headers: {
      ...(header ? { authorization: header } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  getOwnProfileMock.mockReset();
  setOwnProfileMock.mockReset();
  deleteOwnProfileMock.mockReset();
});

describe("GET /api/me/profile", () => {
  it("returns exactly {displayName} for the caller", async () => {
    getOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna Berg" });

    const response = await GET(request("GET", "Bearer abc.def"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ displayName: "Anna Berg" });
    expect(getOwnProfileMock).toHaveBeenCalledWith("abc.def");
  });

  it("returns {displayName: null} when no name is set", async () => {
    getOwnProfileMock.mockResolvedValue({ ok: true, displayName: null });

    const response = await GET(request("GET", "Bearer t"));

    expect(await response.json()).toEqual({ displayName: null });
  });

  it("ignores a uid supplied in the query string", async () => {
    getOwnProfileMock.mockResolvedValue({ ok: true, displayName: null });

    await GET(new Request("http://localhost/api/me/profile?uid=someone-else", { headers: { authorization: "Bearer t" } }));

    expect(getOwnProfileMock).toHaveBeenCalledWith("t");
  });

  it("returns 401 for a missing Authorization header", async () => {
    getOwnProfileMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(getOwnProfileMock).toHaveBeenCalledWith("");
  });

  it("returns 500 with only a generic error code on persistence failure", async () => {
    getOwnProfileMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await GET(request("GET", "Bearer t"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("PUT /api/me/profile", () => {
  it("sets the name and returns the normalised value the server stored", async () => {
    setOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna Berg" });

    const response = await PUT(request("PUT", "Bearer tok", { displayName: "  Anna   Berg " }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ displayName: "Anna Berg" });
    expect(setOwnProfileMock).toHaveBeenCalledWith("tok", "  Anna   Berg ");
  });

  it("maps invalid_input to 400", async () => {
    setOwnProfileMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PUT(request("PUT", "Bearer t", { displayName: "A" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
  });

  it("maps unauthenticated to 401 and persistence_failed to 500", async () => {
    setOwnProfileMock.mockResolvedValueOnce({ ok: false, error: "unauthenticated" });
    setOwnProfileMock.mockResolvedValueOnce({ ok: false, error: "persistence_failed" });

    expect((await PUT(request("PUT", undefined, { displayName: "Anna" }))).status).toBe(401);
    expect((await PUT(request("PUT", "Bearer t", { displayName: "Anna" }))).status).toBe(500);
  });

  it("passes a non-string displayName through so the server operation rejects it", async () => {
    setOwnProfileMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    await PUT(request("PUT", "Bearer t", { displayName: 42 }));

    expect(setOwnProfileMock).toHaveBeenCalledWith("t", 42);
  });

  it.each([
    ["an extra key (uid)", { displayName: "Anna", uid: "someone-else" }],
    ["an extra key (email)", { displayName: "Anna", email: "a@example.com" }],
    ["a missing displayName key", {}],
    ["a wrong key", { name: "Anna" }],
    ["an array body", ["Anna"]],
    ["a null body", "null"],
    ["malformed JSON", "{not json"],
  ])("rejects %s with 400 before calling the operation", async (_label, body) => {
    const response = await PUT(request("PUT", "Bearer t", body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(setOwnProfileMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/profile", () => {
  it("deletes the caller's own profile", async () => {
    deleteOwnProfileMock.mockResolvedValue({ ok: true });

    const response = await DELETE(request("DELETE", "Bearer tok"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deleteOwnProfileMock).toHaveBeenCalledWith("tok");
  });

  it("returns 401 when unauthenticated and 500 on persistence failure", async () => {
    deleteOwnProfileMock.mockResolvedValueOnce({ ok: false, error: "unauthenticated" });
    deleteOwnProfileMock.mockResolvedValueOnce({ ok: false, error: "persistence_failed" });

    expect((await DELETE(request("DELETE"))).status).toBe(401);
    expect((await DELETE(request("DELETE", "Bearer t"))).status).toBe(500);
  });
});
