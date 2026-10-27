import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const readCreateOptionsMock = vi.fn();

vi.mock("../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../src/features/development-conversations/server/read-create-options", () => ({
  readCreateOptions: readCreateOptionsMock,
}));

const routeModule = await import("./route");

const OWNER = "owner-uid-7731";
const url = "http://localhost/api/me/conversations/create-options";
const AUTH = { authorization: "Bearer good.token" };

const get = (headers: Record<string, string> = AUTH, query = "") =>
  new Request(url + query, { method: "GET", headers });

beforeEach(() => {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: OWNER, email: "x@example.test", emailVerified: true } });
  readCreateOptionsMock.mockReset();
});

describe("GET /api/me/conversations/create-options", () => {
  it("rejects a missing bearer token with the unauthenticated code and never reads teams", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ ok: false, error: "unauthenticated" });

    const response = await routeModule.GET(get({}));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(readCreateOptionsMock).not.toHaveBeenCalled();
  });

  it("reads options for the verified token's uid only, ignoring any uid, team or email supplied in the request", async () => {
    readCreateOptionsMock.mockResolvedValue({ ok: true, items: [], truncated: false });

    await routeModule.GET(get(AUTH, "?uid=someone-else&teamId=team-x&email=a@b.test"));

    expect(readCreateOptionsMock).toHaveBeenCalledTimes(1);
    expect(readCreateOptionsMock).toHaveBeenCalledWith(OWNER);
  });

  it("returns exactly { items: [{ teamId, name }], truncated } with no-store, even if the operation carries extra fields", async () => {
    readCreateOptionsMock.mockResolvedValue({
      ok: true,
      items: [{ teamId: "team-a", name: "Plattform", status: "active", role: "lead", memberRef: "ref-1", uid: "x" }],
      truncated: true,
    });

    const response = await routeModule.GET(get());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [{ teamId: "team-a", name: "Plattform" }], truncated: true });
  });

  it("maps a failed read to the persistence_failed code with status 500 and no detail", async () => {
    readCreateOptionsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await routeModule.GET(get());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});
