import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOwnRoleTarget, fetchOwnRoleTarget, fetchRoleCatalog, setOwnRoleTarget } from "./role-target-gateway";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOwnRoleTarget", () => {
  it("returns each of the three statuses with the bearer token", async () => {
    const fetchMock = stubFetch(json({ status: "none" }));

    expect(await fetchOwnRoleTarget("member-token")).toEqual({ status: "ok", view: { status: "none" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/role-target", { headers: { Authorization: "Bearer member-token" } });

    stubFetch(json({ status: "unavailable" }));
    expect(await fetchOwnRoleTarget("t")).toEqual({ status: "ok", view: { status: "unavailable" } });
  });

  it("treats a malformed selected body as a read failure rather than guessing a state", async () => {
    stubFetch(json({ status: "selected", target: { roleId: "role-1" } }));

    expect(await fetchOwnRoleTarget("t")).toEqual({ status: "read_failed" });
  });

  it("maps 401 to unauthenticated and any other failure to read_failed", async () => {
    stubFetch(json({ error: "unauthenticated" }, 401));
    expect(await fetchOwnRoleTarget("t")).toEqual({ status: "unauthenticated" });

    stubFetch(json({ error: "persistence_failed" }, 500));
    expect(await fetchOwnRoleTarget("t")).toEqual({ status: "read_failed" });

    stubFetch(new Error("offline"));
    expect(await fetchOwnRoleTarget("t")).toEqual({ status: "read_failed" });
  });
});

describe("fetchRoleCatalog", () => {
  it("accepts a shaped catalog and rejects a body with a non-boolean selectable flag", async () => {
    stubFetch(json({ roles: [{ roleId: "r", name: "Backend", selectable: true, expectations: [] }], truncated: false }));
    expect(await fetchRoleCatalog("t")).toEqual({
      status: "ok",
      roles: [{ roleId: "r", name: "Backend", selectable: true, expectations: [] }],
      truncated: false,
    });

    stubFetch(json({ roles: [{ roleId: "r", name: "Backend", selectable: "yes", expectations: [] }], truncated: false }));
    expect(await fetchRoleCatalog("t")).toEqual({ status: "read_failed" });
  });
});

describe("setOwnRoleTarget and clearOwnRoleTarget", () => {
  it("sends only { roleId } to the put route and returns the stored status", async () => {
    const fetchMock = stubFetch(json({ status: "selected", target: { roleId: "r", name: "Backend", archived: false } }));

    expect(await setOwnRoleTarget("t", "r")).toEqual({
      ok: true,
      view: { status: "selected", target: { roleId: "r", name: "Backend", archived: false } },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/role-target", {
      method: "PUT",
      headers: { Authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ roleId: "r" }),
    });
  });

  it("returns the server's refusal code for a failed selection", async () => {
    stubFetch(json({ error: "role_not_selectable" }, 409));

    expect(await setOwnRoleTarget("t", "r")).toEqual({ ok: false, error: "role_not_selectable" });
  });

  it("treats a 204 clear as success and a failed clear as a neutral error", async () => {
    stubFetch(new Response(null, { status: 204 }));
    expect(await clearOwnRoleTarget("t")).toEqual({ ok: true });

    stubFetch(json({ error: "persistence_failed" }, 500));
    expect(await clearOwnRoleTarget("t")).toEqual({ ok: false, error: "persistence_failed" });
  });
});
