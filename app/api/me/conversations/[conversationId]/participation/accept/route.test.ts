import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../../../src/features/development-conversations/domain/errors";

const verifyIdTokenMock = vi.fn();
const acceptInvitationMock = vi.fn();

vi.mock("../../../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../../../src/features/development-conversations/server/respond-to-participation", () => ({
  acceptInvitation: acceptInvitationMock,
}));

const routeModule = await import("./route");

// Synthetic identifiers only (invariant 15).
const INVITEE_A = "invitee-a-uid-6620";
const OTHER_UID = "owner-uid-9912";
const CONVERSATION_ID = "c0000000000000000004";
const url = `http://localhost/api/me/conversations/${CONVERSATION_ID}/participation/accept`;
const AUTH = { authorization: "Bearer good.token" };

const context = (conversationId: string = CONVERSATION_ID) => ({ params: Promise.resolve({ conversationId }) });
const post = (body: string | undefined, headers: Record<string, string> = AUTH, target = url) =>
  new Request(target, { method: "POST", headers: body === undefined ? headers : { ...headers, "content-type": "application/json" }, body });
const expectNoStore = (response: Response) => expect(response.headers.get("cache-control")).toBe("no-store");

beforeEach(() => {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: INVITEE_A, email: "x@example.test", emailVerified: true } });
});
afterEach(() => {
  verifyIdTokenMock.mockReset();
  acceptInvitationMock.mockReset();
});

describe("POST /api/me/conversations/[conversationId]/participation/accept", () => {
  it("rejects a missing or unverifiable token with 401 and accepts nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.POST(post(undefined, {}), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it("accepts for the verified caller and the path id, and returns 200 with the accepted state only", async () => {
    acceptInvitationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.POST(post(undefined), context());
    expect(acceptInvitationMock).toHaveBeenCalledWith(INVITEE_A, CONVERSATION_ID);
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ state: "accepted" });
  });

  it("accepts a request with an empty body, since the route takes no body", async () => {
    acceptInvitationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.POST(post(""), context());
    expect(response.status).toBe(200);
    expect(acceptInvitationMock).toHaveBeenCalledWith(INVITEE_A, CONVERSATION_ID);
  });

  it("ignores a uid in the query and the body, and accepts only for the verified subject", async () => {
    acceptInvitationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.POST(post(JSON.stringify({ uid: OTHER_UID })), context());
    expect(response.status).toBe(400);
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    const queried = await routeModule.POST(post(undefined, AUTH, `${url}?uid=${OTHER_UID}`), context());
    expect(queried.status).toBe(200);
    expect(acceptInvitationMock).toHaveBeenCalledWith(INVITEE_A, CONVERSATION_ID);
  });

  it("refuses any body with keys, with the code only and no operation call", async () => {
    for (const body of ['{"participantState":"accepted"}', '{"participantAcceptedAt":"x"}', "[]"]) {
      const response = await routeModule.POST(post(body), context());
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('{"error":"invalid_input"}');
    }
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it("refuses a body over the 32 KiB cap with 413 before any operation call", async () => {
    const response = await routeModule.POST(post(`{"x":"${"a".repeat(32 * 1024 + 1)}"}`), context());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  it("answers a foreign or missing invitation with the same 404 body", async () => {
    acceptInvitationMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const foreign = await routeModule.POST(post(undefined), context("c0000000000000000009"));
    const missing = await routeModule.POST(post(undefined), context("c0000000000000000008"));
    expect(foreign.status).toBe(404);
    const foreignBody = await foreign.text();
    expect(foreignBody).toBe(await missing.text());
    expect(JSON.parse(foreignBody)).toEqual({ error: "conversation_not_found" });
  });

  it("maps an operational failure to 500 persistence_failed with no detail", async () => {
    acceptInvitationMock.mockResolvedValue({ ok: false, error: "persistence_failed" as ConversationErrorCode });
    const response = await routeModule.POST(post(undefined), context());
    expect(response.status).toBe(CONVERSATION_ERROR_STATUS.persistence_failed);
    expect(await response.text()).toBe('{"error":"persistence_failed"}');
  });

  it("keeps eligibility, membership and key decisions out of the route file", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/conversation-store|content-codec|team-eligibility|lib\/encryption|firebase|bindingMatches|getTeamStatus|getMembership|probeKey/);
  });
});

describe("route file method allow-list", () => {
  it("exports only POST", () => {
    const methods = Object.keys(routeModule).filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(name));
    expect(methods).toEqual(["POST"]);
  });
});
