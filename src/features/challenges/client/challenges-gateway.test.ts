import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTeamChallenges, submitChallenge } from "./challenges-gateway";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchTeamChallenges", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed challenge list on a well-formed ok response", async () => {
    const challenges = [
      { challengeId: "c1", text: "Deploy process has no owner", status: "open", submittedAt: "2026-01-10" },
      { challengeId: "c2", text: "Code review is slow", status: "resolved", submittedAt: "2026-01-05" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { status: "ok", challenges, canSubmit: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "ok", challenges, canSubmit: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/team-1/challenges",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } }),
    );
  });

  it("forwards canSubmit: false for an app-admin-only viewer, without treating it as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", challenges: [], canSubmit: false })),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "ok", challenges: [], canSubmit: false });
  });

  it("rejects an ok response missing canSubmit as read_failed rather than trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", challenges: [] })),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("rejects an ok response whose canSubmit is not a boolean as read_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { status: "ok", challenges: [], canSubmit: "true" }),
      ),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("passes through a known read error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { status: "forbidden" })));

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "forbidden" });
  });

  it("rejects a malformed response body as read_failed rather than trusting it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })));

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("rejects a response whose challenges array contains a malformed item", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          status: "ok",
          challenges: [{ challengeId: "c1", text: "ok text", status: "open" /* missing submittedAt */ }],
        }),
      ),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("rejects an archived status item as malformed for this member-facing operation, never rendering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          status: "ok",
          challenges: [
            {
              challengeId: "canary-1",
              text: "ARCHIVED-CANARY-should-never-render",
              status: "archived",
              submittedAt: "2026-01-01",
            },
          ],
        }),
      ),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("strips/ignores identity-shaped extra fields on an otherwise-valid item, never surfacing them", async () => {
    const rawChallenge = {
      challengeId: "c1",
      text: "Legit challenge text",
      status: "open",
      submittedAt: "2026-01-10",
      uid: "identity-canary-uid",
      email: "identity-canary@example.com",
      resolvedBy: "identity-canary-admin",
      archivedBy: "identity-canary-admin-2",
      ciphertext: "identity-canary-ciphertext",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, { status: "ok", challenges: [rawChallenge], canSubmit: true }),
      ),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.challenges).toEqual([
        { challengeId: "c1", text: "Legit challenge text", status: "open", submittedAt: "2026-01-10" },
      ]);
      expect(Object.keys(result.challenges[0])).toEqual(["challengeId", "text", "status", "submittedAt"]);
    }
  });

  it("falls back to read_failed on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });

  it("falls back to read_failed on a non-JSON response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );

    const result = await fetchTeamChallenges("token-1", "team-1");

    expect(result).toEqual({ status: "read_failed" });
  });
});

describe("submitChallenge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok on a 201 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));

    const result = await submitChallenge("token-1", "team-1", "Some challenge text");

    expect(result).toEqual({ status: "ok" });
  });

  it("sends only the text field, never an identity/team-override field, to the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await submitChallenge("token-1", "team-1", "Some challenge text");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/team-1/challenges");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Some challenge text" });
    expect(init.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer token-1",
    });
  });

  it("maps a known error status through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_input" })),
    );

    const result = await submitChallenge("token-1", "team-1", "no");

    expect(result).toEqual({ status: "invalid_input" });
  });

  it("maps encryption_failed and persistence_failed through as distinct gateway statuses (component maps both to one generic message)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { error: "encryption_failed" })),
    );
    const encryptionResult = await submitChallenge("token-1", "team-1", "x".repeat(10));
    expect(encryptionResult).toEqual({ status: "encryption_failed" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { error: "persistence_failed" })),
    );
    const persistenceResult = await submitChallenge("token-1", "team-1", "x".repeat(10));
    expect(persistenceResult).toEqual({ status: "persistence_failed" });
  });

  it("falls back to read_failed on an unrecognized error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(418, { error: "totally_unexpected" })),
    );

    const result = await submitChallenge("token-1", "team-1", "x".repeat(10));

    expect(result).toEqual({ status: "read_failed" });
  });

  it("falls back to read_failed on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await submitChallenge("token-1", "team-1", "x".repeat(10));

    expect(result).toEqual({ status: "read_failed" });
  });
});
