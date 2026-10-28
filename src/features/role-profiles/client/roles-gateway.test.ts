import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminRoles } from "./roles-gateway";

const ROLE = {
  roleId: "role-1",
  name: "Backend",
  archived: false,
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
  createdAt: "2026-10-01T10:00:00.000Z",
};

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

describe("fetchAdminRoles", () => {
  it("calls the admin route with the bearer token and returns the validated roles", async () => {
    const fetchMock = stubFetch(json({ roles: [ROLE], truncated: true }));

    const result = await fetchAdminRoles("admin-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/roles", { headers: { Authorization: "Bearer admin-token" } });
    expect(result).toEqual({ status: "ok", roles: [ROLE], truncated: true });
  });

  it("maps 401 to unauthenticated and 403 to forbidden", async () => {
    stubFetch(json({ error: "unauthenticated" }, 401));
    expect(await fetchAdminRoles("t")).toEqual({ status: "unauthenticated" });

    stubFetch(json({ error: "forbidden" }, 403));
    expect(await fetchAdminRoles("t")).toEqual({ status: "forbidden" });
  });

  it("maps any other failing status to read_failed", async () => {
    stubFetch(json({ error: "persistence_failed" }, 500));

    expect(await fetchAdminRoles("t")).toEqual({ status: "read_failed" });
  });

  it("treats a body that does not match the expected shape as a read failure", async () => {
    stubFetch(json({ roles: [{ roleId: 1, name: "Backend" }], truncated: false }));
    expect(await fetchAdminRoles("t")).toEqual({ status: "read_failed" });

    stubFetch(json({ roles: [] }));
    expect(await fetchAdminRoles("t")).toEqual({ status: "read_failed" });
  });

  it("treats a network failure as read_failed", async () => {
    stubFetch(new Error("offline"));

    expect(await fetchAdminRoles("t")).toEqual({ status: "read_failed" });
  });
});
