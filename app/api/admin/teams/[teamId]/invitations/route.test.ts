import { afterEach, describe, expect, it, vi } from "vitest";

const createInvitationMock = vi.fn();
const cancelInvitationMock = vi.fn();
const listTeamInvitationsMock = vi.fn();

vi.mock("../../../../../../src/features/teams/server/create-invitation", () => ({
  createInvitation: createInvitationMock,
}));
vi.mock("../../../../../../src/features/teams/server/cancel-invitation", () => ({
  cancelInvitation: cancelInvitationMock,
}));
vi.mock("../../../../../../src/features/teams/server/list-team-invitations", () => ({
  listTeamInvitations: listTeamInvitationsMock,
}));

const { GET, POST, DELETE } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/invitations", {
    headers: header ? { authorization: header } : {},
  });
}

function bodyRequest(
  method: "POST" | "DELETE",
  body: unknown,
  header = "Bearer valid-token",
): Request {
  return new Request("http://localhost/api/admin/teams/team-1/invitations", {
    method,
    headers: { authorization: header, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/teams/[teamId]/invitations", () => {
  afterEach(() => {
    listTeamInvitationsMock.mockReset();
  });

  it("returns the pending invitation list for an app admin", async () => {
    const invitations = [{ email: "dev@example.com", invitedBy: "admin-1", createdAt: new Date() }];
    listTeamInvitationsMock.mockResolvedValue({ ok: true, invitations });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.invitations).toHaveLength(1);
  });

  it("passes the bearer token and teamId through", async () => {
    listTeamInvitationsMock.mockResolvedValue({ ok: true, invitations: [] });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(listTeamInvitationsMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns 401 when unauthenticated", async () => {
    listTeamInvitationsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    listTeamInvitationsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 500 on a read failure", async () => {
    listTeamInvitationsMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});

describe("POST /api/admin/teams/[teamId]/invitations", () => {
  afterEach(() => {
    createInvitationMock.mockReset();
  });

  it("returns 200 and the outcome for a valid admin invite", async () => {
    createInvitationMock.mockResolvedValue({ ok: true, outcome: "invitation_created" });

    const response = await POST(bodyRequest("POST", { email: "dev@example.com" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcome: "invitation_created" });
  });

  it("passes the bearer token, teamId, and email through to createInvitation", async () => {
    createInvitationMock.mockResolvedValue({ ok: true, outcome: "invitation_created" });

    await POST(
      bodyRequest("POST", { email: "dev@example.com" }, "Bearer abc.def.ghi"),
      params("team-42"),
    );

    expect(createInvitationMock).toHaveBeenCalledWith(
      "abc.def.ghi",
      "team-42",
      "dev@example.com",
    );
  });

  it("returns a generic 400 and never calls createInvitation for a malformed body", async () => {
    const request = new Request("http://localhost/api/admin/teams/team-1/invitations", {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await POST(request, params());

    expect(response.status).toBe(400);
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(bodyRequest("POST", { email: "dev@example.com" }, ""), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(bodyRequest("POST", { email: "dev@example.com" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 400 for an invalid email", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "invalid_email" });

    const response = await POST(bodyRequest("POST", { email: "  " }), params());

    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent team", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "team_not_found" });

    const response = await POST(bodyRequest("POST", { email: "dev@example.com" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 400 for a disabled team", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(bodyRequest("POST", { email: "dev@example.com" }), params());

    expect(response.status).toBe(400);
  });

  it("returns 500, not a partial success, on a lookup or persistence failure", async () => {
    createInvitationMock.mockResolvedValue({ ok: false, error: "lookup_failed" });

    const response = await POST(bodyRequest("POST", { email: "dev@example.com" }), params());

    expect(response.status).toBe(500);
  });

  it("never logs the token, email, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createInvitationMock.mockResolvedValue({ ok: true, outcome: "invitation_created" });
    await POST(bodyRequest("POST", { email: "dev@example.com" }), params());

    createInvitationMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    await POST(bodyRequest("POST", { email: "dev@example.com" }), params());

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("DELETE /api/admin/teams/[teamId]/invitations", () => {
  afterEach(() => {
    cancelInvitationMock.mockReset();
  });

  it("returns 200 for a valid admin cancel", async () => {
    cancelInvitationMock.mockResolvedValue({ ok: true });

    const response = await DELETE(bodyRequest("DELETE", { email: "dev@example.com" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it("passes the bearer token, teamId, and email through to cancelInvitation", async () => {
    cancelInvitationMock.mockResolvedValue({ ok: true });

    await DELETE(
      bodyRequest("DELETE", { email: "dev@example.com" }, "Bearer abc.def.ghi"),
      params("team-42"),
    );

    expect(cancelInvitationMock).toHaveBeenCalledWith(
      "abc.def.ghi",
      "team-42",
      "dev@example.com",
    );
  });

  it("returns a generic 400 and never calls cancelInvitation for a malformed body", async () => {
    const request = new Request("http://localhost/api/admin/teams/team-1/invitations", {
      method: "DELETE",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await DELETE(request, params());

    expect(response.status).toBe(400);
    expect(cancelInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    cancelInvitationMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await DELETE(bodyRequest("DELETE", { email: "dev@example.com" }, ""), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    cancelInvitationMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(bodyRequest("DELETE", { email: "dev@example.com" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 500, not a partial success, on a persistence failure", async () => {
    cancelInvitationMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await DELETE(bodyRequest("DELETE", { email: "dev@example.com" }), params());

    expect(response.status).toBe(500);
  });
});
