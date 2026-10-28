import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const listActiveRolesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/features/auth/server/verify-identity", () => ({
  verifyIdToken: verifyIdTokenMock,
}));
vi.mock("../../../src/features/role-profiles/server/list-active-roles", () => ({
  listActiveRolesForPerson: listActiveRolesMock,
}));

const { GET } = await import("./route");

const ROLE = {
  roleId: "role-1",
  name: "Backend",
  selectable: true,
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
};

function request(query = "", header: string | undefined = "Bearer id-token"): Request {
  return new Request(`http://localhost/api/roles${query}`, {
    headers: header ? { authorization: header } : {},
  });
}

afterEach(() => {
  verifyIdTokenMock.mockReset();
  listActiveRolesMock.mockReset();
});

describe("GET /api/roles", () => {
  it("returns the active roles and truncated flag for any signed-in person, with no admin requirement", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: "member-1" } });
    listActiveRolesMock.mockResolvedValue({ ok: true, roles: [ROLE], truncated: false });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roles: [ROLE], truncated: false });
    expect(verifyIdTokenMock).toHaveBeenCalledWith("id-token");
  });

  it("returns 401 without calling the catalog for a missing or invalid token", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });

    const response = await GET(request("", undefined));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(listActiveRolesMock).not.toHaveBeenCalled();
  });

  it("reads no parameter from the query or the caller: the operation takes none", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: "member-1" } });
    listActiveRolesMock.mockResolvedValue({ ok: true, roles: [], truncated: false });

    await GET(request("?uid=other&includeArchived=true"));

    expect(listActiveRolesMock).toHaveBeenCalledWith();
  });

  it("applies the PG-8 allow-list even if the operation returned extra or internal fields", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: "member-1" } });
    listActiveRolesMock.mockResolvedValue({
      ok: true,
      roles: [{ ...ROLE, createdBy: "admin-1", updatedBy: "admin-2", archivedBy: "admin-3", uid: "admin-1" }],
      truncated: true,
    });

    const response = await GET(request());
    const body = (await response.json()) as { roles: Record<string, unknown>[]; truncated: boolean };

    expect(body.truncated).toBe(true);
    expect(Object.keys(body.roles[0]).sort()).toEqual(["expectations", "name", "roleId", "selectable"]);
    expect(JSON.stringify(body)).not.toMatch(/admin-1|admin-2|admin-3/);
  });

  it("returns a neutral 500 when the catalog read fails, with no role content", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: "member-1" } });
    listActiveRolesMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});
