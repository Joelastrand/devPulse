import { afterEach, describe, expect, it, vi } from "vitest";

const setRoleArchivedMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../src/features/role-profiles/server/set-role-archived", () => ({
  setRoleArchived: setRoleArchivedMock,
}));

const { POST } = await import("./route");

const ROLE_DTO = {
  roleId: "role-1",
  name: "Backend",
  expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
  archived: true,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-04T10:00:00.000Z",
};

function archiveRequest(body: unknown, header: string | undefined = "Bearer id-token"): Request {
  return new Request("http://localhost/api/admin/roles/role-1/archive", {
    method: "POST",
    headers: { ...(header ? { authorization: header } : {}), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function context(roleId: string) {
  return { params: Promise.resolve({ roleId }) };
}

afterEach(() => {
  setRoleArchivedMock.mockReset();
});

describe("POST /api/admin/roles/[roleId]/archive", () => {
  it("archives a role for an app admin and returns the admin DTO with 200", async () => {
    setRoleArchivedMock.mockResolvedValue({ ok: true, role: ROLE_DTO });

    const response = await POST(archiveRequest({ archived: true }), context("role-1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ROLE_DTO);
    expect(setRoleArchivedMock).toHaveBeenCalledWith("id-token", "role-1", true);
  });

  it("forwards a non-boolean archived value so the operation refuses it with 400", async () => {
    setRoleArchivedMock.mockResolvedValue({ ok: false, error: "invalid_input" });

    const response = await POST(archiveRequest({ archived: "yes" }), context("role-1"));

    expect(response.status).toBe(400);
    expect(setRoleArchivedMock).toHaveBeenCalledWith("id-token", "role-1", "yes");
  });

  it("returns 400 for a non-object body and forwards nothing else from the body", async () => {
    expect((await POST(archiveRequest("[true]"), context("role-1"))).status).toBe(400);
    expect(setRoleArchivedMock).not.toHaveBeenCalled();

    setRoleArchivedMock.mockResolvedValue({ ok: true, role: ROLE_DTO });
    await POST(archiveRequest({ archived: false, uid: "spoofed", archivedBy: "spoofed" }), context("role-1"));
    expect(setRoleArchivedMock).toHaveBeenCalledWith("id-token", "role-1", false);
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_input", 400],
    ["not_found", 404],
    ["persistence_failed", 500],
  ] as const)("maps %s to %i with the neutral error body", async (error, status) => {
    setRoleArchivedMock.mockResolvedValue({ ok: false, error });

    const response = await POST(archiveRequest({ archived: true }), context("role-1"));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
