import { describe, expect, it, vi } from "vitest";
import {
  cancelTeamInvitation,
  fetchTeamAccessRequests,
  fetchTeamInvitations,
  fetchTeamMembers,
  inviteTeamMember,
  removeAdminTeamMember,
  resolveAccessRequest,
  setAdminTeamMemberRole,
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
    expect(result).toEqual({
      status: "ok",
      members: [{ uid: "uid-1", email: "a@example.com", displayName: null, role: "member" }],
    });

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

describe("fetchTeamMembers — additive displayName/role fields", () => {
  function respondWith(members: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ members }) })));
  }

  it("parses the new shape: display name and a lead role", async () => {
    respondWith([{ uid: "uid-1", email: "a@example.com", displayName: "Anna Berg", role: "lead" }]);

    const result = await fetchTeamMembers("t", "team-1");

    expect(result).toEqual({
      status: "ok",
      members: [{ uid: "uid-1", email: "a@example.com", displayName: "Anna Berg", role: "lead" }],
    });
    vi.unstubAllGlobals();
  });

  it("keeps an explicit null displayName and an explicit member role", async () => {
    respondWith([{ uid: "uid-1", email: null, displayName: null, role: "member" }]);

    const result = await fetchTeamMembers("t", "team-1");

    expect(result).toEqual({ status: "ok", members: [{ uid: "uid-1", email: null, displayName: null, role: "member" }] });
    vi.unstubAllGlobals();
  });

  it.each([
    ["an unknown string", "admin"],
    ["a differently-cased string", "Lead"],
    ["a number", 1],
    ["null", null],
    ["an object", { lead: true }],
  ])("treats a malformed role (%s) as member, never as lead", async (_label, role) => {
    respondWith([{ uid: "uid-1", email: "a@example.com", displayName: null, role }]);

    const result = await fetchTeamMembers("t", "team-1");

    expect(result.status === "ok" && result.members[0].role).toBe("member");
    vi.unstubAllGlobals();
  });

  it.each([
    ["a number", 7],
    ["an empty string", ""],
    ["an object", { name: "x" }],
  ])("treats a malformed displayName (%s) as null without failing the row", async (_label, displayName) => {
    respondWith([{ uid: "uid-1", email: "a@example.com", displayName, role: "lead" }]);

    const result = await fetchTeamMembers("t", "team-1");

    expect(result).toEqual({
      status: "ok",
      members: [{ uid: "uid-1", email: "a@example.com", displayName: null, role: "lead" }],
    });
    vi.unstubAllGlobals();
  });

  it("still rejects the whole list when uid or email is malformed (existing strictness)", async () => {
    respondWith([{ uid: "uid-1", email: "a@example.com", displayName: "Ok", role: "lead" }, { uid: 5, email: null }]);

    expect(await fetchTeamMembers("t", "team-1")).toEqual({ status: "read_failed" });
    vi.unstubAllGlobals();
  });
});

describe("setAdminTeamMemberRole default gateway", () => {
  it("PATCHes the existing member endpoint with exactly {role} and the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true, role: "lead" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setAdminTeamMemberRole("an-id-token", "team-1", "uid 1/x", "lead");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/members/uid%201%2Fx", {
      method: "PATCH",
      headers: { Authorization: "Bearer an-id-token", "Content-Type": "application/json" },
      body: JSON.stringify({ role: "lead" }),
    });
    expect(result).toEqual({ ok: true, role: "lead" });
    vi.unstubAllGlobals();
  });

  it("supports returning a member to the ordinary role", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ ok: true, role: "member" }) })));

    expect(await setAdminTeamMemberRole("t", "team-1", "uid-1", "member")).toEqual({ ok: true, role: "member" });
    vi.unstubAllGlobals();
  });

  it.each(["unauthenticated", "forbidden", "invalid_input", "not_a_member", "team_disabled", "persistence_failed"])(
    "maps the known server error %s",
    async (error) => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error }) })));

      expect(await setAdminTeamMemberRole("t", "team-1", "uid-1", "lead")).toEqual({ ok: false, error });
      vi.unstubAllGlobals();
    },
  );

  it.each([
    ["an unknown error code", { error: "weird" }],
    ["an ok body with an invalid role", { ok: true, role: "admin" }],
    ["a non-object body", "nope"],
    ["an empty body", {}],
  ])("maps %s to unknown, never to success", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => body })));

    expect(await setAdminTeamMemberRole("t", "team-1", "uid-1", "lead")).toEqual({ ok: false, error: "unknown" });
    vi.unstubAllGlobals();
  });

  it("maps a thrown fetch to unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );

    expect(await setAdminTeamMemberRole("t", "team-1", "uid-1", "lead")).toEqual({ ok: false, error: "unknown" });
    vi.unstubAllGlobals();
  });
});
