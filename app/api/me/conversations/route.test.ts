import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../src/features/development-conversations/domain/errors";
import {
  OWNER_PARTICIPANT_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  RECOVERY_ITEM_KEYS,
} from "../../../../src/features/development-conversations/domain/dto-keys";

const verifyIdTokenMock = vi.fn();
const createConversationMock = vi.fn();
const readOwnerConversationsMock = vi.fn();
const readParticipationsMock = vi.fn();
const readDepsMock = vi.fn();
const READ_DEPS = { fixture: "owner-read-deps" };

vi.mock("../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../src/features/development-conversations/server/create-conversation", () => ({
  createConversation: createConversationMock,
}));
vi.mock("../../../../src/features/development-conversations/server/read-owner-conversations", () => ({
  readOwnerConversations: readOwnerConversationsMock,
}));
vi.mock("../../../../src/features/development-conversations/server/read-participations", () => ({
  readParticipations: readParticipationsMock,
}));
vi.mock("../../../../src/features/development-conversations/server/owner-route-deps", () => ({
  productionOwnerReadDeps: readDepsMock,
}));

const routeModule = await import("./route");

const OWNER_A = "owner-a-uid-7731";
const OWNER_B = "owner-b-uid-4402";
const CONVERSATION_ID = "c0000000000000000001";
const url = "http://localhost/api/me/conversations";
const AUTH = { authorization: "Bearer good.token" };

const get = (headers: Record<string, string> = AUTH, query = "") => new Request(url + query, { method: "GET", headers });
const post = (body: unknown, headers: Record<string, string> = AUTH) =>
  new Request(url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const verifiedAs = (uid: string) =>
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid, email: "x@example.test", emailVerified: true } });
const expectNoStore = (response: Response) => expect(response.headers.get("cache-control")).toBe("no-store");

beforeEach(() => {
  verifiedAs(OWNER_A);
  readDepsMock.mockReturnValue(READ_DEPS);
});
afterEach(() => {
  verifyIdTokenMock.mockReset();
  createConversationMock.mockReset();
  readOwnerConversationsMock.mockReset();
  readParticipationsMock.mockReset();
  readDepsMock.mockReset();
  vi.restoreAllMocks();
});

/** A summary as the operation returns it, with fields that must never reach the client. */
const summaryFromOperation = {
  conversationId: CONVERSATION_ID,
  title: "Synthetic title",
  status: "open",
  plannedFor: null,
  participant: { state: "pending", displayName: "Kollega", uid: "leaked-uid", memberRef: "leaked-ref" },
  sharedGoalCount: 1,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-10-02T08:00:00.000Z"),
  ownerUid: "leaked-owner",
  ciphertext: "leaked-ciphertext",
};

const participationFromOperation = {
  conversationId: "c0000000000000000002",
  state: "accepted",
  title: "Synthetic participant title",
  teamName: "Team Synthetic",
  invitedAt: new Date("2026-10-03T08:00:00.000Z"),
  participantUid: "leaked-participant",
};

describe("GET /api/me/conversations", () => {
  it("rejects a missing or unverifiable token with 401 and reads nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.GET(get({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(readOwnerConversationsMock).not.toHaveBeenCalled();
    expect(readParticipationsMock).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it("lists the verified caller only, and ignores any uid in the query", async () => {
    readOwnerConversationsMock.mockResolvedValue({ ok: true, conversations: [], recovery: [], truncated: false });
    readParticipationsMock.mockResolvedValue({ ok: true, participations: [], truncated: false });
    await routeModule.GET(get(AUTH, `?uid=${OWNER_B}&ownerUid=${OWNER_B}`));
    expect(verifyIdTokenMock).toHaveBeenCalledWith("good.token");
    expect(readOwnerConversationsMock).toHaveBeenCalledWith(OWNER_A, READ_DEPS);
    expect(readParticipationsMock).toHaveBeenCalledWith(OWNER_A);
  });

  it("returns the owned envelope with summaries first, then recovery items, and passes truncated through", async () => {
    readOwnerConversationsMock.mockResolvedValue({
      ok: true,
      conversations: [summaryFromOperation],
      recovery: [{ conversationId: "c0000000000000000003", ciphertext: "leaked" }],
      truncated: true,
    });
    readParticipationsMock.mockResolvedValue({ ok: true, participations: [], truncated: false });

    const response = await routeModule.GET(get());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["owned", "participating"]);
    expect(Object.keys(body.owned)).toEqual(["items", "truncated"]);
    expect(body.owned.truncated).toBe(true);
    expect(body.owned.items).toHaveLength(2);
    expect(Object.keys(body.owned.items[0])).toEqual([...OWNER_SUMMARY_KEYS]);
    expect(Object.keys(body.owned.items[0].participant)).toEqual([...OWNER_PARTICIPANT_KEYS]);
    expect(body.owned.items[1]).toEqual({ conversationId: "c0000000000000000003" });
    expect(Object.keys(body.owned.items[1])).toEqual([...RECOVERY_ITEM_KEYS]);
  });

  it("returns the participating envelope with exactly the BR-44 keys and passes its truncated flag through", async () => {
    readOwnerConversationsMock.mockResolvedValue({ ok: true, conversations: [], recovery: [], truncated: false });
    readParticipationsMock.mockResolvedValue({ ok: true, participations: [participationFromOperation], truncated: true });

    const body = await (await routeModule.GET(get())).json();
    expect(Object.keys(body.participating)).toEqual(["items", "truncated"]);
    expect(body.participating.truncated).toBe(true);
    expect(Object.keys(body.participating.items[0])).toEqual([...PARTICIPANT_SUMMARY_KEYS]);
    expect(body.participating.items[0].title).toBe("Synthetic participant title");
  });

  it("never returns uid, memberRef, ciphertext or owner fields that the operation carried", async () => {
    readOwnerConversationsMock.mockResolvedValue({ ok: true, conversations: [summaryFromOperation], recovery: [], truncated: false });
    readParticipationsMock.mockResolvedValue({ ok: true, participations: [participationFromOperation], truncated: false });
    const text = JSON.stringify(await (await routeModule.GET(get())).json());
    for (const leaked of ["leaked-uid", "leaked-ref", "leaked-owner", "leaked-ciphertext", "leaked-participant", "ownerUid", "memberRef"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("maps an operational failure of either list to 500 persistence_failed with no detail", async () => {
    readOwnerConversationsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    readParticipationsMock.mockResolvedValue({ ok: true, participations: [], truncated: false });
    const owned = await routeModule.GET(get());
    expect(owned.status).toBe(500);
    expect(await owned.json()).toEqual({ error: "persistence_failed" });

    readOwnerConversationsMock.mockResolvedValue({ ok: true, conversations: [], recovery: [], truncated: false });
    readParticipationsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const participating = await routeModule.GET(get());
    expect(participating.status).toBe(500);
    expect(await participating.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("route file method allow-list", () => {
  it("exports only GET and POST", () => {
    const methods = Object.keys(routeModule).filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(name));
    expect(methods.sort()).toEqual(["GET", "POST"]);
  });
});

describe("POST /api/me/conversations", () => {
  it("rejects an unverifiable token with 401 and creates nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.POST(post({ title: "Tittel" }, {}));
    expect(response.status).toBe(401);
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("creates for the verified caller with the three allowed keys and returns 201 with the conversation id", async () => {
    createConversationMock.mockResolvedValue({ ok: true, conversationId: CONVERSATION_ID });
    const response = await routeModule.POST(post({ title: "Tittel", plannedFor: "2026-11-01", teamId: "team-a" }));
    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(await response.json()).toEqual({ conversationId: CONVERSATION_ID });
    expect(createConversationMock).toHaveBeenCalledWith(OWNER_A, { title: "Tittel", plannedFor: "2026-11-01", teamId: "team-a" });
  });

  it("refuses an owner, uid or participant selector in the body as an unknown key, without calling the operation", async () => {
    for (const key of ["ownerUid", "uid", "participantUid", "participantMemberRef", "status"]) {
      const response = await routeModule.POST(post({ title: "Tittel", [key]: OWNER_B }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("maps malformed JSON, an empty body, an array and a primitive to 400 invalid_input", async () => {
    for (const bad of ["{", "", "[]", "42", "null", '"text"']) {
      const response = await routeModule.POST(post(bad));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("maps a body over the cap to 413 payload_too_large before the operation is called", async () => {
    const oversize = JSON.stringify({ title: "a".repeat(40000) });
    const response = await routeModule.POST(post(oversize));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it.each<ConversationErrorCode>(["invalid_input", "conversation_limit", "persistence_failed"])(
    "maps the operation error %s to its stable status and returns only the code",
    async (code) => {
      createConversationMock.mockResolvedValue({ ok: false, error: code, detail: "firebase internal text", field: "title" });
      const response = await routeModule.POST(post({ title: "Tittel" }));
      expect(response.status).toBe(CONVERSATION_ERROR_STATUS[code]);
      expect(await response.json()).toEqual({ error: code });
    },
  );
});
