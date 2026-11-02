import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// TASK-009 propagation on the conversation routes: a rejected token is 401 (`unauthenticated`), an erasure in progress is
// 403, and auth unavailable is 503 (D-AUTHFAIL). The mapping is what each route answers with. Fixtures are synthetic.

const verifyIdToken = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken }));

import { verifiedSubject } from "./_auth";

function request(token: string): Request {
  return new Request("https://example.test/api/me/conversations", { headers: { authorization: `Bearer ${token}` } });
}

describe("conversation route subject (TASK-009 propagation)", () => {
  it("returns the verified uid for a valid token", async () => {
    verifyIdToken.mockResolvedValueOnce({ ok: true, identity: { uid: "user-1" } });
    expect(await verifiedSubject(request("t"))).toEqual({ ok: true, uid: "user-1" });
  });

  it("maps a rejected token to unauthenticated (401)", async () => {
    verifyIdToken.mockResolvedValueOnce({ ok: false, error: "invalid_token" });
    expect(await verifiedSubject(request("t"))).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("maps an erasure in progress to erasure_in_progress (403)", async () => {
    verifyIdToken.mockResolvedValueOnce({ ok: false, error: "erasure_in_progress" });
    expect(await verifiedSubject(request("t"))).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("maps an unavailable auth check to auth_unavailable (503)", async () => {
    verifyIdToken.mockResolvedValueOnce({ ok: false, error: "auth_unavailable" });
    expect(await verifiedSubject(request("t"))).toEqual({ ok: false, error: "auth_unavailable" });
  });
});
