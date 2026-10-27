import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../../src/features/development-conversations/domain/errors";

const verifyIdTokenMock = vi.fn();
const writeParticipantNotesMock = vi.fn();

vi.mock("../../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../../src/features/development-conversations/server/write-participant-notes", () => ({
  writeParticipantNotes: writeParticipantNotesMock,
}));

const routeModule = await import("./route");

// Synthetic identifiers only (invariant 15).
const PARTICIPANT_A = "participant-a-uid-5510";
const OTHER_UID = "owner-uid-9911";
const CONVERSATION_ID = "c0000000000000000003";
const url = `http://localhost/api/me/conversations/${CONVERSATION_ID}/participant-notes`;
const AUTH = { authorization: "Bearer good.token", "content-type": "application/json" };

const context = (conversationId: string = CONVERSATION_ID) => ({ params: Promise.resolve({ conversationId }) });
const put = (body: unknown, headers: Record<string, string> = AUTH, target = url) =>
  new Request(target, { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const expectNoStore = (response: Response) => expect(response.headers.get("cache-control")).toBe("no-store");

beforeEach(() => {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: PARTICIPANT_A, email: "x@example.test", emailVerified: true } });
});
afterEach(() => {
  verifyIdTokenMock.mockReset();
  writeParticipantNotesMock.mockReset();
});

describe("PUT /api/me/conversations/[conversationId]/participant-notes", () => {
  it("rejects a missing or unverifiable token with 401 and writes nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.PUT(put({ notes: "Synthetic note" }, {}), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(writeParticipantNotesMock).not.toHaveBeenCalled();
  });

  it("writes the notes for the verified caller and the path id, and returns 200 { ok: true }", async () => {
    writeParticipantNotesMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PUT(put({ notes: "Synthetic note" }), context());
    expect(writeParticipantNotesMock).toHaveBeenCalledWith(PARTICIPANT_A, CONVERSATION_ID, "Synthetic note");
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("forwards an empty string unchanged, because it clears the notes (BR-20)", async () => {
    writeParticipantNotesMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PUT(put({ notes: "" }), context());
    expect(writeParticipantNotesMock).toHaveBeenCalledWith(PARTICIPANT_A, CONVERSATION_ID, "");
    expect(response.status).toBe(200);
  });

  it("refuses a uid in the body and ignores a uid in the query, writing only for the verified subject", async () => {
    writeParticipantNotesMock.mockResolvedValue({ ok: true });
    const queried = await routeModule.PUT(put({ notes: "Synthetic note" }, AUTH, `${url}?uid=${OTHER_UID}`), context());
    expect(queried.status).toBe(200);
    expect(writeParticipantNotesMock).toHaveBeenCalledWith(PARTICIPANT_A, CONVERSATION_ID, "Synthetic note");
    writeParticipantNotesMock.mockClear();

    writeParticipantNotesMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PUT(
      put({ notes: "Synthetic note", uid: OTHER_UID }, AUTH, `${url}?uid=${OTHER_UID}`),
      context(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    expect(writeParticipantNotesMock).not.toHaveBeenCalled();
  });

  it("refuses any body key other than notes, with the code only and no operation call", async () => {
    for (const body of [{ notes: "x", participantUid: OTHER_UID }, { ownerNotes: "x" }, { participantMemberRef: "x" }]) {
      const response = await routeModule.PUT(put(body), context());
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('{"error":"invalid_input"}');
    }
    expect(writeParticipantNotesMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a JSON object, with no operation call", async () => {
    for (const body of ["[]", '"notes"', "not json", "null"]) {
      const response = await routeModule.PUT(put(body), context());
      expect(response.status).toBe(400);
    }
    expect(writeParticipantNotesMock).not.toHaveBeenCalled();
  });

  it("refuses a body over the 32 KiB cap with 413 before parsing, with no operation call", async () => {
    const oversize = `{"notes":"${"a".repeat(32 * 1024 + 1)}"}`;
    const response = await routeModule.PUT(put(oversize), context());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(writeParticipantNotesMock).not.toHaveBeenCalled();
  });

  it("maps each stable operation error to its SPEC status, with the code only", async () => {
    const cases: Array<[ConversationErrorCode, number]> = [
      ["conversation_not_found", 404],
      ["conversation_completed", 409],
      ["persistence_failed", 500],
    ];
    for (const [error, status] of cases) {
      writeParticipantNotesMock.mockResolvedValueOnce({ ok: false, error });
      const response = await routeModule.PUT(put({ notes: "Synthetic note" }), context());
      expect(response.status).toBe(status);
      expect(response.status).toBe(CONVERSATION_ERROR_STATUS[error]);
      expect(await response.text()).toBe(JSON.stringify({ error }));
    }
  });

  it("returns invalid_input with no field name when the operation rejects the note value", async () => {
    writeParticipantNotesMock.mockResolvedValue({ ok: false, error: "invalid_input", field: "notes" });
    const response = await routeModule.PUT(put({ notes: "Synthetic note" }), context());
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":"invalid_input"}');
  });

  it("keeps access, completion and key decisions out of the route file", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/conversation-store|content-codec|team-eligibility|lib\/encryption|firebase|authorizeParticipant|bindingMatches|getTeamStatus|getMembership/);
  });
});

describe("route file method allow-list", () => {
  it("exports only PUT", () => {
    const methods = Object.keys(routeModule).filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(name));
    expect(methods).toEqual(["PUT"]);
  });
});
