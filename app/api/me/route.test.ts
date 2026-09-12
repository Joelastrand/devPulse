import { afterEach, describe, expect, it, vi } from "vitest";

const getOwnAdminStatusMock = vi.fn();

vi.mock("../../../src/features/teams/server/get-own-admin-status", () => ({
  getOwnAdminStatus: getOwnAdminStatusMock,
}));

const { GET } = await import("./route");

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/me", {
    headers: header ? { authorization: header } : {},
  });
}

describe("GET /api/me", () => {
  afterEach(() => {
    getOwnAdminStatusMock.mockReset();
  });

  it("returns exactly {isAdmin: true} for an app admin", async () => {
    getOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: true });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ isAdmin: true });
  });

  it("returns exactly {isAdmin: false} for a non-admin", async () => {
    getOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ isAdmin: false });
  });

  it("extracts exactly the bearer token", async () => {
    getOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    await GET(requestWithAuth("Bearer abc.def.ghi"));

    expect(getOwnAdminStatusMock).toHaveBeenCalledWith("abc.def.ghi");
  });

  it("returns 401 (never a boolean) when the Authorization header is missing", async () => {
    getOwnAdminStatusMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "unauthenticated" });
    expect(getOwnAdminStatusMock).toHaveBeenCalledWith("");
  });

  it("returns 401 for a malformed Authorization header", async () => {
    getOwnAdminStatusMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth("not-a-bearer-token"));

    expect(response.status).toBe(401);
    expect(getOwnAdminStatusMock).toHaveBeenCalledWith("");
  });

  it("never includes any field other than isAdmin in a successful response body", async () => {
    getOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: true });

    const response = await GET(requestWithAuth("Bearer valid-token"));
    const payload = await response.json();

    expect(Object.keys(payload)).toEqual(["isAdmin"]);
  });

  it("never logs the token or result for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    getOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: true });
    await GET(requestWithAuth("Bearer valid-token"));

    getOwnAdminStatusMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    await GET(requestWithAuth());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
