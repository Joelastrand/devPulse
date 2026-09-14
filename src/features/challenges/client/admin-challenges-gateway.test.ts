import { describe, expect, it, vi } from "vitest";
import {
  archiveAdminChallenge,
  deleteAdminChallenge,
  fetchAdminChallenges,
  resolveAdminChallenge,
} from "./admin-challenges-gateway";

const OPEN_ENTRY = {
  challengeId: "challenge-1",
  text: "Deploys have no clear owner",
  status: "open",
  submittedAt: "2026-01-01",
};

const ARCHIVED_ENTRY = {
  challengeId: "challenge-2",
  text: "Old, already archived friction",
  status: "archived",
  submittedAt: "2025-12-01",
};

describe("fetchAdminChallenges default gateway", () => {
  it("sends the Authorization header and requests the admin challenges endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ status: "ok", challenges: [OPEN_ENTRY] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdminChallenges("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/challenges", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ status: "ok", challenges: [OPEN_ENTRY] });

    vi.unstubAllGlobals();
  });

  it("URL-encodes the teamId", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ status: "ok", challenges: [] }) }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdminChallenges("token", "team/with slash");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team%2Fwith%20slash/challenges",
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });

  it("accepts an archived-status item — the admin operation's one deliberate difference from the member-facing gateway, which structurally rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ status: "ok", challenges: [ARCHIVED_ENTRY] }) })),
    );

    const result = await fetchAdminChallenges("token", "team-1");

    expect(result).toEqual({ status: "ok", challenges: [ARCHIVED_ENTRY] });

    vi.unstubAllGlobals();
  });

  it("rebuilds each item field-by-field, stripping any extra crypto/identity/audit-shaped field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          status: "ok",
          challenges: [
            {
              ...OPEN_ENTRY,
              uid: "identity-canary-uid",
              email: "identity-canary@example.com",
              resolvedBy: "identity-canary-admin-1",
              archivedBy: "identity-canary-admin-2",
              ciphertext: "identity-canary-ciphertext",
              iv: "identity-canary-iv",
              authTag: "identity-canary-authtag",
              keyVersion: "v1",
            },
          ],
        }),
      })),
    );

    const result = await fetchAdminChallenges("token", "team-1");

    expect(result).toEqual({ status: "ok", challenges: [OPEN_ENTRY] });
    if (result.status === "ok") {
      expect(Object.keys(result.challenges[0])).toEqual(["challengeId", "text", "status", "submittedAt"]);
    }
  });

  it("returns read_failed for a malformed challenge entry (unknown status)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          status: "ok",
          challenges: [{ ...OPEN_ENTRY, status: "unknown-status" }],
        }),
      })),
    );

    const result = await fetchAdminChallenges("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("returns read_failed for a minimal/malformed payload shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));

    const result = await fetchAdminChallenges("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error from the body (unauthenticated)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ status: "unauthenticated" }) })));

    const result = await fetchAdminChallenges("token", "team-1");

    expect(result).toEqual({ status: "unauthenticated" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error from the body (forbidden)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ status: "forbidden" }) })));

    const result = await fetchAdminChallenges("token", "team-1");

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

    const result = await fetchAdminChallenges("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });
});

describe("resolveAdminChallenge default gateway", () => {
  it("POSTs to the resolve endpoint with the bearer token", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAdminChallenge("an-id-token", "team-1", "challenge-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/challenges/challenge-1/resolve", {
      method: "POST",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("never sends a request body — no client-supplied resolvedBy/resolvedAt is possible", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveAdminChallenge("token", "team-1", "challenge-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("maps 401/403/404/409/500 to controlled error results", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [500, "persistence_failed"],
    ];

    for (const [status, error] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => ({ status, json: async () => ({}) })));
      const result = await resolveAdminChallenge("token", "team-1", "challenge-1");
      expect(result).toEqual({ ok: false, error });
      vi.unstubAllGlobals();
    }
  });

  it("returns unknown for an unrecognized status/malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 418, json: async () => ({}) })));

    const result = await resolveAdminChallenge("token", "team-1", "challenge-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });

  it("returns unknown if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await resolveAdminChallenge("token", "team-1", "challenge-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});

describe("archiveAdminChallenge default gateway", () => {
  it("POSTs to the archive endpoint with the bearer token", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await archiveAdminChallenge("an-id-token", "team-1", "challenge-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/challenges/challenge-1/archive", {
      method: "POST",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("never sends a request body — no client-supplied archivedBy/archivedAt is possible", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    await archiveAdminChallenge("token", "team-1", "challenge-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("maps a persistence failure to a controlled error result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 500, json: async () => ({}) })));

    const result = await archiveAdminChallenge("token", "team-1", "challenge-1");

    expect(result).toEqual({ ok: false, error: "persistence_failed" });

    vi.unstubAllGlobals();
  });

  it("returns unknown if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await archiveAdminChallenge("token", "team-1", "challenge-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});

describe("deleteAdminChallenge default gateway", () => {
  it("sends a DELETE request with the bearer token", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteAdminChallenge("an-id-token", "team-1", "challenge-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/challenges/challenge-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("maps a not_found result to a controlled error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404, json: async () => ({}) })));

    const result = await deleteAdminChallenge("token", "team-1", "challenge-1");

    expect(result).toEqual({ ok: false, error: "not_found" });

    vi.unstubAllGlobals();
  });

  it("returns unknown if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await deleteAdminChallenge("token", "team-1", "challenge-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});
