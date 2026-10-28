import { afterEach, describe, expect, it, vi } from "vitest";

const updateRoleMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../src/features/role-profiles/server/update-role", () => ({
  updateRole: updateRoleMock,
}));

const { PATCH } = await import("./route");

const ROLE_DTO = {
  roleId: "role-1",
  name: "Backend (renamed)",
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
  archived: false,
  createdAt: "2026-10-01T10:00:00.000Z",
};

function patchRequest(body: unknown, header: string | undefined = "Bearer id-token"): Request {
  return new Request("http://localhost/api/admin/roles/role-1", {
    method: "PATCH",
    headers: { ...(header ? { authorization: header } : {}), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function context(roleId: string) {
  return { params: Promise.resolve({ roleId }) };
}

afterEach(() => {
  updateRoleMock.mockReset();
});

describe("PATCH /api/admin/roles/[roleId]", () => {
  it("returns the updated admin DTO with 200 for an app admin", async () => {
    updateRoleMock.mockResolvedValue({ ok: true, role: ROLE_DTO });

    const response = await PATCH(patchRequest({ name: "Backend (renamed)" }), context("role-1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ROLE_DTO);
    expect(updateRoleMock).toHaveBeenCalledWith("id-token", "role-1", { name: "Backend (renamed)" });
  });

  it("takes the role id only from the route param and forwards only the present role fields", async () => {
    updateRoleMock.mockResolvedValue({ ok: true, role: ROLE_DTO });

    await PATCH(patchRequest({ roleId: "other", uid: "spoofed", updatedBy: "spoofed", description: "Kort" }), context("role-1"));

    expect(updateRoleMock).toHaveBeenCalledWith("id-token", "role-1", { description: "Kort" });
  });

  it("forwards an empty body as an empty patch so the operation returns invalid_input", async () => {
    updateRoleMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await PATCH(patchRequest({ uid: "spoofed" }), context("role-1"));

    expect(response.status).toBe(400);
    expect(updateRoleMock).toHaveBeenCalledWith("id-token", "role-1", {});
  });

  it("returns 400 for a malformed body without calling the operation", async () => {
    expect((await PATCH(patchRequest("{not json"), context("role-1"))).status).toBe(400);
    expect((await PATCH(patchRequest("text"), context("role-1"))).status).toBe(400);
    expect(updateRoleMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_input", 400],
    ["not_found", 404],
    ["skill_not_found", 404],
    ["role_archived", 409],
    ["persistence_failed", 500],
  ] as const)("maps %s to %i with the neutral error body", async (error, status) => {
    updateRoleMock.mockResolvedValue({ ok: false, error });

    const response = await PATCH(patchRequest({ name: "Backend" }), context("role-1"));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
