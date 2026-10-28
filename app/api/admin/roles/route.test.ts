import { afterEach, describe, expect, it, vi } from "vitest";

const listRolesForAdminMock = vi.hoisted(() => vi.fn());
const createRoleMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/features/role-profiles/server/list-roles-for-admin", () => ({
  listRolesForAdmin: listRolesForAdminMock,
}));
vi.mock("../../../../src/features/role-profiles/server/create-role", () => ({
  createRole: createRoleMock,
}));

const { GET, POST } = await import("./route");

const ROLE_DTO = {
  roleId: "role-1",
  name: "Backend",
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
  archived: false,
  createdAt: "2026-10-01T10:00:00.000Z",
};

function getRequest(query = "", header = "Bearer id-token"): Request {
  return new Request(`http://localhost/api/admin/roles${query}`, { headers: { authorization: header } });
}

function postRequest(body: unknown, header: string | undefined = "Bearer id-token"): Request {
  return new Request("http://localhost/api/admin/roles", {
    method: "POST",
    headers: { ...(header ? { authorization: header } : {}), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  listRolesForAdminMock.mockReset();
  createRoleMock.mockReset();
});

describe("GET /api/admin/roles", () => {
  it("returns the window and truncated flag for an app admin", async () => {
    listRolesForAdminMock.mockResolvedValue({ ok: true, roles: [ROLE_DTO], truncated: true });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roles: [ROLE_DTO], truncated: true });
    expect(listRolesForAdminMock).toHaveBeenCalledWith("id-token", { includeArchived: undefined });
  });

  it("forwards includeArchived=true and includeArchived=false as booleans", async () => {
    listRolesForAdminMock.mockResolvedValue({ ok: true, roles: [], truncated: false });

    await GET(getRequest("?includeArchived=true"));
    await GET(getRequest("?includeArchived=false"));

    expect(listRolesForAdminMock).toHaveBeenNthCalledWith(1, "id-token", { includeArchived: true });
    expect(listRolesForAdminMock).toHaveBeenNthCalledWith(2, "id-token", { includeArchived: false });
  });

  it("maps an out-of-range includeArchived to 400 through the operation's invalid_input", async () => {
    listRolesForAdminMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await GET(getRequest("?includeArchived=yes"));

    expect(response.status).toBe(400);
    expect(listRolesForAdminMock).toHaveBeenCalledWith("id-token", { includeArchived: "yes" });
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["persistence_failed", 500],
  ] as const)("maps %s to %i", async (error, status) => {
    listRolesForAdminMock.mockResolvedValue({ ok: false, error });

    const response = await GET(getRequest());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("passes an absent bearer token as an empty string so the operation refuses it", async () => {
    listRolesForAdminMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(getRequest("", ""));

    expect(response.status).toBe(401);
    expect(listRolesForAdminMock).toHaveBeenCalledWith("", { includeArchived: undefined });
  });
});

describe("POST /api/admin/roles", () => {
  it("creates a role for an app admin and returns the admin DTO with 201", async () => {
    createRoleMock.mockResolvedValue({ ok: true, role: ROLE_DTO });

    const response = await POST(postRequest({ name: "Backend", expectations: [{ treeId: "api", expectedLevel: 3 }] }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(ROLE_DTO);
  });

  it("forwards only the role fields, never an identity or audit field from the body", async () => {
    createRoleMock.mockResolvedValue({ ok: true, role: ROLE_DTO });

    await POST(
      postRequest({ name: "Backend", expectations: [], uid: "spoofed", createdBy: "spoofed", archivedAt: "x" }),
    );

    expect(createRoleMock).toHaveBeenCalledWith("id-token", { name: "Backend", expectations: [] });
  });

  it("returns 400 for a malformed or non-object body without calling the operation", async () => {
    expect((await POST(postRequest("{not json"))).status).toBe(400);
    expect((await POST(postRequest(["array"]))).status).toBe(400);
    expect(createRoleMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_input", 400],
    ["skill_not_found", 404],
    ["cap_reached", 409],
    ["persistence_failed", 500],
  ] as const)("maps %s to %i with the neutral error body", async (error, status) => {
    createRoleMock.mockResolvedValue({ ok: false, error });

    const response = await POST(postRequest({ name: "Backend", expectations: [] }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
