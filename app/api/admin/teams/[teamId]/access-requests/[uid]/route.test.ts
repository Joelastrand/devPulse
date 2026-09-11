import { afterEach, describe, expect, it, vi } from "vitest";

const approveAccessRequestMock = vi.fn();
const rejectAccessRequestMock = vi.fn();

vi.mock("../../../../../../../src/features/teams/server/approve-access-request", () => ({
  approveAccessRequest: approveAccessRequestMock,
}));
vi.mock("../../../../../../../src/features/teams/server/reject-access-request", () => ({
  rejectAccessRequest: rejectAccessRequestMock,
}));

const { PATCH } = await import("./route");

function params(teamId = "team-1", uid = "user-1") {
  return { params: Promise.resolve({ teamId, uid }) };
}

function patchRequest(body: unknown, header = "Bearer valid-token"): Request {
  return new Request("http://localhost/api/admin/teams/team-1/access-requests/user-1", {
    method: "PATCH",
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/teams/[teamId]/access-requests/[uid]", () => {
  afterEach(() => {
    approveAccessRequestMock.mockReset();
    rejectAccessRequestMock.mockReset();
  });

  it("approves via approveAccessRequest when status is 'approved'", async () => {
    approveAccessRequestMock.mockResolvedValue({ ok: true, outcome: "approved" });

    const response = await PATCH(patchRequest({ status: "approved" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcome: "approved" });
    expect(rejectAccessRequestMock).not.toHaveBeenCalled();
  });

  it("rejects via rejectAccessRequest when status is 'rejected'", async () => {
    rejectAccessRequestMock.mockResolvedValue({ ok: true, outcome: "rejected" });

    const response = await PATCH(patchRequest({ status: "rejected" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcome: "rejected" });
    expect(approveAccessRequestMock).not.toHaveBeenCalled();
  });

  it("passes the bearer token, uid, and teamId through", async () => {
    approveAccessRequestMock.mockResolvedValue({ ok: true, outcome: "approved" });

    await PATCH(
      patchRequest({ status: "approved" }, "Bearer abc.def.ghi"),
      params("team-42", "user-99"),
    );

    expect(approveAccessRequestMock).toHaveBeenCalledWith("abc.def.ghi", "user-99", "team-42");
  });

  it("returns a generic 400 and calls neither operation for an invalid status value", async () => {
    const response = await PATCH(patchRequest({ status: "pending" }), params());

    expect(response.status).toBe(400);
    expect(approveAccessRequestMock).not.toHaveBeenCalled();
    expect(rejectAccessRequestMock).not.toHaveBeenCalled();
  });

  it("returns a generic 4xx and calls neither operation for a malformed body", async () => {
    const request = new Request("http://localhost/api/admin/teams/team-1/access-requests/user-1", {
      method: "PATCH",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await PATCH(request, params());

    expect(response.status).toBe(400);
    expect(approveAccessRequestMock).not.toHaveBeenCalled();
    expect(rejectAccessRequestMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    approveAccessRequestMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await PATCH(patchRequest({ status: "approved" }), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    rejectAccessRequestMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PATCH(patchRequest({ status: "rejected" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 500, not a partial success, on a persistence failure", async () => {
    approveAccessRequestMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await PATCH(patchRequest({ status: "approved" }), params());

    expect(response.status).toBe(500);
  });
});
