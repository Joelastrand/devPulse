import { describe, expect, it, vi } from "vitest";
import {
  cancelTeamInvitation,
  fetchTeamAccessRequests,
  fetchTeamInvitations,
  fetchTeamMembers,
  inviteTeamMember,
  removeAdminTeamMember,
  resolveAccessRequest,
} from "./admin-team-detail-gateway";

describe("fetchTeamMembers default gateway", () => {
  it("sends the Authorization header and requests the admin members endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ members: [{ uid: "uid-1", email: "a@example.com" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTeamMembers("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/members", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ status: "ok", members: [{ uid: "uid-1", email: "a@example.com" }] });

    vi.unstubAllGlobals();
  });

  it("returns read_failed for a malformed member entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ members: [{ uid: "", email: null }] }) })),
    );

    const result = await fetchTeamMembers("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error from the body (forbidden)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error: "forbidden" }) })));

    const result = await fetchTeamMembers("an-id-token", "team-1");

    expect(result).toEqual({ status: "forbidden" });

    vi.unstubAllGlobals();
  });

  it("returns read_failed if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await fetchTeamMembers("an-id-token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });
});

describe("removeAdminTeamMember default gateway", () => {
  it("DELETEs the existing TASK-002 endpoint with the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeAdminTeamMember("an-id-token", "team-1", "uid-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/members/uid-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("returns the server's error code on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 403, json: async () => ({ error: "forbidden" }) })),
    );

    const result = await removeAdminTeamMember("an-id-token", "team-1", "uid-1");

    expect(result).toEqual({ ok: false, error: "forbidden" });

    vi.unstubAllGlobals();
  });
});

describe("fetchTeamInvitations default gateway", () => {
  it("sends the Authorization header and requests the admin invitations endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        invitations: [{ email: "a@example.com", invitedBy: "admin-uid", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTeamInvitations("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/invitations", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({
      status: "ok",
      invitations: [
        { email: "a@example.com", invitedBy: "admin-uid", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });

    vi.unstubAllGlobals();
  });
});

describe("inviteTeamMember default gateway", () => {
  it("POSTs the email to the existing TASK-004 endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ outcome: "invitation_created" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await inviteTeamMember("an-id-token", "team-1", "a@example.com");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/invitations", {
      method: "POST",
      headers: { Authorization: "Bearer an-id-token", "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    });
    expect(result).toEqual({ ok: true, outcome: "invitation_created" });

    vi.unstubAllGlobals();
  });

  it("returns the server's error code on failure (team_disabled)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error: "team_disabled" }) })));

    const result = await inviteTeamMember("an-id-token", "team-1", "a@example.com");

    expect(result).toEqual({ ok: false, error: "team_disabled" });

    vi.unstubAllGlobals();
  });

  it("returns 'unknown' for an unrecognized response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ nonsense: true }) })));

    const result = await inviteTeamMember("an-id-token", "team-1", "a@example.com");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});

describe("cancelTeamInvitation default gateway", () => {
  it("DELETEs the existing TASK-004 endpoint with the email in the body", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelTeamInvitation("an-id-token", "team-1", "a@example.com");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/invitations", {
      method: "DELETE",
      headers: { Authorization: "Bearer an-id-token", "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });
});

describe("fetchTeamAccessRequests default gateway", () => {
  it("sends the Authorization header and requests the admin access-requests endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        requests: [{ uid: "uid-1", email: "a@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTeamAccessRequests("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/access-requests", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({
      status: "ok",
      requests: [{ uid: "uid-1", email: "a@example.com", createdAt: "2026-01-01T00:00:00.000Z" }],
    });

    vi.unstubAllGlobals();
  });
});

describe("resolveAccessRequest default gateway", () => {
  it("PATCHes the existing TASK-005 endpoint with the requested status (approved)", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ outcome: "approved" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAccessRequest("an-id-token", "team-1", "uid-1", "approved");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/access-requests/uid-1", {
      method: "PATCH",
      headers: { Authorization: "Bearer an-id-token", "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(result).toEqual({ ok: true, outcome: "approved" });

    vi.unstubAllGlobals();
  });

  it("PATCHes with the requested status (rejected)", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ outcome: "rejected" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAccessRequest("an-id-token", "team-1", "uid-1", "rejected");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team-1/access-requests/uid-1",
      expect.objectContaining({ body: JSON.stringify({ status: "rejected" }) }),
    );
    expect(result).toEqual({ ok: true, outcome: "rejected" });

    vi.unstubAllGlobals();
  });

  it("returns the server's error code on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ error: "persistence_failed" }) })),
    );

    const result = await resolveAccessRequest("an-id-token", "team-1", "uid-1", "approved");

    expect(result).toEqual({ ok: false, error: "persistence_failed" });

    vi.unstubAllGlobals();
  });
});
