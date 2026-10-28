import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const getOwnRoleTargetMock = vi.hoisted(() => vi.fn());
const setOwnRoleTargetMock = vi.hoisted(() => vi.fn());
const clearOwnRoleTargetMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../src/features/role-profiles/server/get-own-role-target", () => ({
  getOwnRoleTarget: getOwnRoleTargetMock,
}));
vi.mock("../../../../src/features/role-profiles/server/set-own-role-target", () => ({
  setOwnRoleTarget: setOwnRoleTargetMock,
}));
vi.mock("../../../../src/features/role-profiles/server/clear-own-role-target", () => ({
  clearOwnRoleTarget: clearOwnRoleTargetMock,
}));

const { GET, PUT, DELETE } = await import("./route");

const SELECTED = { status: "selected", target: { roleId: "role-1", name: "Backend", archived: false } };
const OWNER = "member-1";

function request(method: string, body?: unknown, header: string | undefined = "Bearer id-token", query = ""): Request {
  return new Request(`http://localhost/api/me/role-target${query}`, {
    method,
    headers: {
      ...(header ? { authorization: header } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function signedIn() {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: OWNER } });
}

afterEach(() => {
  verifyIdTokenMock.mockReset();
  getOwnRoleTargetMock.mockReset();
  setOwnRoleTargetMock.mockReset();
  clearOwnRoleTargetMock.mockReset();
});

describe("/api/me/role-target — authentication", () => {
  function unauthenticated() {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
  }

  function expectNoOperationCalled() {
    expect(getOwnRoleTargetMock).not.toHaveBeenCalled();
    expect(setOwnRoleTargetMock).not.toHaveBeenCalled();
    expect(clearOwnRoleTargetMock).not.toHaveBeenCalled();
  }

  it("GET returns 401 without a valid token, with no operation called", async () => {
    unauthenticated();

    expect((await GET(request("GET", undefined, undefined))).status).toBe(401);
    expectNoOperationCalled();
  });

  it("PUT returns 401 without a valid token, with no operation called", async () => {
    unauthenticated();

    expect((await PUT(request("PUT", { roleId: "role-1" }, undefined))).status).toBe(401);
    expectNoOperationCalled();
  });

  it("DELETE returns 401 without a valid token, with no operation called", async () => {
    unauthenticated();

    expect((await DELETE(request("DELETE", undefined, undefined))).status).toBe(401);
    expectNoOperationCalled();
  });
});

describe("GET /api/me/role-target", () => {
  it("returns the owner's status with no-store caching", async () => {
    signedIn();
    getOwnRoleTargetMock.mockResolvedValue(SELECTED);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(SELECTED);
    expect(getOwnRoleTargetMock).toHaveBeenCalledWith(OWNER);
  });

  it("ignores a uid in the query: the subject is always the verified token uid", async () => {
    signedIn();
    getOwnRoleTargetMock.mockResolvedValue({ status: "none" });

    await GET(request("GET", undefined, "Bearer id-token", "?uid=someone-else"));

    expect(getOwnRoleTargetMock).toHaveBeenCalledWith(OWNER);
  });

  it("returns a neutral 500 when the read fails", async () => {
    signedIn();
    getOwnRoleTargetMock.mockRejectedValue(new Error("firestore unavailable"));

    const response = await GET(request("GET"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("PUT /api/me/role-target", () => {
  it("selects the role for the verified uid and returns the stored status with 200", async () => {
    signedIn();
    setOwnRoleTargetMock.mockResolvedValue({ ok: true });
    getOwnRoleTargetMock.mockResolvedValue(SELECTED);

    const response = await PUT(request("PUT", { roleId: "role-1" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SELECTED);
    expect(setOwnRoleTargetMock).toHaveBeenCalledWith(OWNER, "role-1");
  });

  it("refuses any key other than roleId with 400 and writes nothing, including a uid", async () => {
    signedIn();

    expect((await PUT(request("PUT", { roleId: "role-1", uid: "someone-else" }))).status).toBe(400);
    expect((await PUT(request("PUT", { roleId: "role-1", email: "x@example.com" }))).status).toBe(400);
    expect(setOwnRoleTargetMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed body with 400", async () => {
    signedIn();

    expect((await PUT(request("PUT", "{not json"))).status).toBe(400);
    expect((await PUT(request("PUT", { roleId: 42 }))).status).toBe(400);
    expect(setOwnRoleTargetMock).not.toHaveBeenCalled();
  });

  it("maps a missing or malformed role to 404 not_found, with no status read", async () => {
    signedIn();
    setOwnRoleTargetMock.mockResolvedValue({ ok: false, error: "not_found" });

    const response = await PUT(request("PUT", { roleId: "gone" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(getOwnRoleTargetMock).not.toHaveBeenCalled();
  });

  it("maps an archived, zero-expectation or unavailable role to 409 role_not_selectable", async () => {
    signedIn();
    setOwnRoleTargetMock.mockResolvedValue({ ok: false, error: "role_not_selectable" });

    const response = await PUT(request("PUT", { roleId: "role-1" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "role_not_selectable" });
  });

  it("returns a neutral 500 when the write fails", async () => {
    signedIn();
    setOwnRoleTargetMock.mockRejectedValue(new Error("firestore unavailable"));

    const response = await PUT(request("PUT", { roleId: "role-1" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("DELETE /api/me/role-target", () => {
  it("clears the owner's target and returns 204 with no body, and is idempotent", async () => {
    signedIn();
    clearOwnRoleTargetMock.mockResolvedValue(undefined);

    const first = await DELETE(request("DELETE"));
    const second = await DELETE(request("DELETE"));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await first.text()).toBe("");
    expect(clearOwnRoleTargetMock.mock.calls).toEqual([[OWNER], [OWNER]]);
  });

  it("returns a neutral 500 when the delete fails", async () => {
    signedIn();
    clearOwnRoleTargetMock.mockRejectedValue(new Error("firestore unavailable"));

    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});
