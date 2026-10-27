import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../../src/features/development-conversations/domain/errors";

const verifyIdTokenMock = vi.fn();
const leaveParticipationMock = vi.fn();

vi.mock("../../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../../src/features/development-conversations/server/respond-to-participation", () => ({
  leaveParticipation: leaveParticipationMock,
}));

const routeModule = await import("./route");

// Synthetic identifiers only (invariant 15).
const PARTICIPANT_A = "participant-a-uid-7720";
const OTHER_UID = "owner-uid-9913";
const CONVERSATION_ID = "c0000000000000000005";
const url = `http://localhost/api/me/conversations/${CONVERSATION_ID}/participation`;
const AUTH = { authorization: "Bearer good.token" };

const context = (conversationId: string = CONVERSATION_ID) => ({ params: Promise.resolve({ conversationId }) });
const del = (body: string | undefined, headers: Record<string, string> = AUTH, target = url) =>
  new Request(target, { method: "DELETE", headers: body === undefined ? headers : { ...headers, "content-type": "application/json" }, body });

beforeEach(() => {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: PARTICIPANT_A, email: "x@example.test", emailVerified: true } });
});
afterEach(() => {
  verifyIdTokenMock.mockReset();
  leaveParticipationMock.mockReset();
});

describe("DELETE /api/me/conversations/[conversationId]/participation", () => {
  it("rejects a missing or unverifiable token with 401 and changes nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.DELETE(del(undefined, {}), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(leaveParticipationMock).not.toHaveBeenCalled();
  });

  it("ends the verified caller's participation for the path id and returns 204 with no body", async () => {
    leaveParticipationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.DELETE(del(undefined), context());
    expect(leaveParticipationMock).toHaveBeenCalledWith(PARTICIPANT_A, CONVERSATION_ID);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("accepts a DELETE with an empty body, and with a body that is an empty object", async () => {
    leaveParticipationMock.mockResolvedValue({ ok: true });
    expect((await routeModule.DELETE(del(""), context())).status).toBe(204);
    expect((await routeModule.DELETE(del("{}"), context())).status).toBe(204);
    expect(leaveParticipationMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a uid in the query, and removes only the verified subject's participation", async () => {
    leaveParticipationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.DELETE(del(undefined, AUTH, `${url}?uid=${OTHER_UID}`), context());
    expect(response.status).toBe(204);
    expect(leaveParticipationMock).toHaveBeenCalledWith(PARTICIPANT_A, CONVERSATION_ID);
  });

  it("refuses any body with keys, with the code only and no operation call", async () => {
    for (const body of [JSON.stringify({ participantUid: OTHER_UID }), JSON.stringify({ state: "accepted" }), "[]"]) {
      const response = await routeModule.DELETE(del(body), context());
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('{"error":"invalid_input"}');
    }
    expect(leaveParticipationMock).not.toHaveBeenCalled();
  });

  it("refuses a body over the 32 KiB cap with 413 before any operation call", async () => {
    const response = await routeModule.DELETE(del(`{"x":"${"a".repeat(32 * 1024 + 1)}"}`), context());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(leaveParticipationMock).not.toHaveBeenCalled();
  });

  it("answers a participation with no index entry with 404 conversation_not_found", async () => {
    leaveParticipationMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const response = await routeModule.DELETE(del(undefined), context());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('{"error":"conversation_not_found"}');
  });

  it("maps an operational failure, including a key failure during an accepted leave, to 500 persistence_failed with no detail", async () => {
    leaveParticipationMock.mockResolvedValue({ ok: false, error: "persistence_failed" as ConversationErrorCode });
    const response = await routeModule.DELETE(del(undefined), context());
    expect(response.status).toBe(CONVERSATION_ERROR_STATUS.persistence_failed);
    expect(await response.text()).toBe('{"error":"persistence_failed"}');
  });

  it("keeps eligibility, membership and key decisions out of the route file", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/conversation-store|content-codec|team-eligibility|lib\/encryption|firebase|bindingMatches|getTeamStatus|getMembership|probeKey/);
  });
});

describe("route file method allow-list", () => {
  it("exports only DELETE", () => {
    const methods = Object.keys(routeModule).filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(name));
    expect(methods).toEqual(["DELETE"]);
  });
});
