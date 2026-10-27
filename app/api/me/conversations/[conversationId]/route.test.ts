import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../src/features/development-conversations/domain/errors";
import {
  OWNER_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  PARTICIPANT_DTO_KEYS,
  PENDING_DTO_KEYS,
  SHARED_GOAL_DTO_KEYS,
} from "../../../../../src/features/development-conversations/domain/dto-keys";

const verifyIdTokenMock = vi.fn();
const readOwnerConversationMock = vi.fn();
const readConversationForCallerMock = vi.fn();
const viewDepsMock = vi.fn();
const VIEW_DEPS = { fixture: "conversation-view-deps" };
const updateOwnerSectionsMock = vi.fn();
const setSharedGoalsMock = vi.fn();
const changeParticipantMock = vi.fn();
const completeConversationMock = vi.fn();
const deleteConversationMock = vi.fn();
const readDepsMock = vi.fn();
const goalDepsMock = vi.fn();
const READ_DEPS = { fixture: "owner-read-deps" };
const GOAL_DEPS = { fixture: "set-shared-goals-deps" };

vi.mock("../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../src/features/development-conversations/server/read-owner-conversation", () => ({
  readOwnerConversation: readOwnerConversationMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/read-conversation-for-caller", () => ({
  readConversationForCaller: readConversationForCallerMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/conversation-view-route-deps", () => ({
  productionConversationViewDeps: viewDepsMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/update-owner-sections", () => ({
  updateOwnerSections: updateOwnerSectionsMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/set-shared-goals", () => ({
  setSharedGoals: setSharedGoalsMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/change-participant", () => ({
  changeParticipant: changeParticipantMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/complete-conversation", () => ({
  completeConversation: completeConversationMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/delete-conversation", () => ({
  deleteConversation: deleteConversationMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/owner-route-deps", () => ({
  productionOwnerReadDeps: readDepsMock,
  productionSetSharedGoalsDeps: goalDepsMock,
}));

const routeModule = await import("./route");

const OWNER_A = "owner-a-uid-7731";
const OWNER_B = "owner-b-uid-4402";
const CONVERSATION_ID = "c0000000000000000001";
const url = `http://localhost/api/me/conversations/${CONVERSATION_ID}`;
const AUTH = { authorization: "Bearer good.token" };

const context = (conversationId: string = CONVERSATION_ID) => ({ params: Promise.resolve({ conversationId }) });
const get = (headers: Record<string, string> = AUTH) => new Request(url, { method: "GET", headers });
const patch = (body: unknown, headers: Record<string, string> = AUTH) =>
  new Request(url, { method: "PATCH", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const del = (headers: Record<string, string> = AUTH) => new Request(url, { method: "DELETE", headers });

const verifiedAs = (uid: string) =>
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid, email: "x@example.test", emailVerified: true } });
const expectNoStore = (response: Response) => expect(response.headers.get("cache-control")).toBe("no-store");

const ALL_MOCKS = [
  verifyIdTokenMock,
  readOwnerConversationMock,
  readConversationForCallerMock,
  viewDepsMock,
  updateOwnerSectionsMock,
  setSharedGoalsMock,
  changeParticipantMock,
  completeConversationMock,
  deleteConversationMock,
  readDepsMock,
  goalDepsMock,
];

beforeEach(() => {
  verifiedAs(OWNER_A);
  readDepsMock.mockReturnValue(READ_DEPS);
  goalDepsMock.mockReturnValue(GOAL_DEPS);
  viewDepsMock.mockReturnValue(VIEW_DEPS);
});
afterEach(() => {
  for (const mock of ALL_MOCKS) mock.mockReset();
  vi.restoreAllMocks();
});

const expectNoOperationCall = () => {
  for (const mock of [readOwnerConversationMock, readConversationForCallerMock, updateOwnerSectionsMock, setSharedGoalsMock, changeParticipantMock, completeConversationMock, deleteConversationMock]) {
    expect(mock).not.toHaveBeenCalled();
  }
};

/** An owner DTO as the operation returns it, with fields that must never reach the client. */
const ownerDtoFromOperation = {
  conversationId: CONVERSATION_ID,
  title: "Synthetic title",
  status: "open",
  plannedFor: "2026-11-01",
  teamId: "team-a",
  participant: { state: "accepted", displayName: "Kollega", uid: "leaked-uid", memberRef: "leaked-ref" },
  ownerNotes: "Notat",
  nextSteps: ["Steg"],
  participantNotes: "Deltakerens notat",
  sharedGoals: [
    {
      goalTitle: "Synthetic goal",
      areaName: "Testområde",
      targetDate: null,
      status: "active",
      capturedAt: new Date("2026-10-10T08:00:00.000Z"),
      treeId: "leaked-tree-id",
      goalId: "leaked-goal-id",
    },
  ],
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-10-02T08:00:00.000Z"),
  completedAt: null,
  ownerUid: "leaked-owner",
  keyCheck: "leaked-key-check",
  ciphertext: "leaked-ciphertext",
};

describe("GET /api/me/conversations/[conversationId]", () => {
  it("rejects a missing or unverifiable token with 401 and reads nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.GET(get({}), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expectNoOperationCall();
  });

  it("reads the caller's view for the verified caller and the path id, and nothing else", async () => {
    readConversationForCallerMock.mockResolvedValue({ ok: true, view: { kind: "owner", dto: ownerDtoFromOperation } });
    await routeModule.GET(get(), context());
    expect(readConversationForCallerMock).toHaveBeenCalledWith(OWNER_A, CONVERSATION_ID, VIEW_DEPS);
  });

  it("returns exactly the owner DTO keys, with exact nested participant and goal keys, and no leaked field", async () => {
    readConversationForCallerMock.mockResolvedValue({ ok: true, view: { kind: "owner", dto: ownerDtoFromOperation } });
    const response = await routeModule.GET(get(), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();

    expect(Object.keys(body)).toEqual([...OWNER_DTO_KEYS]);
    expect(Object.keys(body.participant)).toEqual([...OWNER_PARTICIPANT_KEYS]);
    expect(Object.keys(body.sharedGoals[0])).toEqual([...SHARED_GOAL_DTO_KEYS]);
    const text = JSON.stringify(body);
    for (const leaked of ["leaked-uid", "leaked-ref", "leaked-tree-id", "leaked-goal-id", "leaked-owner", "leaked-key-check", "leaked-ciphertext"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("answers a foreign id and a missing id with the same 404 body", async () => {
    readConversationForCallerMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const foreign = await routeModule.GET(get(), context("c0000000000000000009"));
    const missing = await routeModule.GET(get(), context("c0000000000000000008"));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    const foreignBody = await foreign.text();
    expect(foreignBody).toBe(await missing.text());
    expect(JSON.parse(foreignBody)).toEqual({ error: "conversation_not_found" });
  });

  it("maps an operational failure to 500 persistence_failed with no detail", async () => {
    readConversationForCallerMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const response = await routeModule.GET(get(), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("PATCH /api/me/conversations/[conversationId]", () => {
  it("rejects a missing or unverifiable token with 401 and writes nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.PATCH(patch({ title: "x" }, {}), context());
    expect(response.status).toBe(401);
    expectNoOperationCall();
  });

  it("routes owner section keys to the section write for the verified caller, and returns 200 { ok: true }", async () => {
    updateOwnerSectionsMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PATCH(patch({ title: "Ny tittel", plannedFor: null, ownerNotes: "Notat", nextSteps: ["Steg"] }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ ok: true });
    expect(updateOwnerSectionsMock).toHaveBeenCalledWith(OWNER_A, CONVERSATION_ID, {
      title: "Ny tittel",
      plannedFor: null,
      ownerNotes: "Notat",
      nextSteps: ["Steg"],
    });
  });

  it("routes sharedGoalIds to the goal-set write with the production goal seam", async () => {
    setSharedGoalsMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PATCH(patch({ sharedGoalIds: ["goal00000000000000001"] }), context());
    expect(response.status).toBe(200);
    expect(setSharedGoalsMock).toHaveBeenCalledWith(OWNER_A, CONVERSATION_ID, ["goal00000000000000001"], GOAL_DEPS);
  });

  it("routes participantMemberRef, including null for removal, to the participant change", async () => {
    changeParticipantMock.mockResolvedValue({ ok: true });
    await routeModule.PATCH(patch({ participantMemberRef: "ref-abc" }), context());
    expect(changeParticipantMock).toHaveBeenLastCalledWith(OWNER_A, CONVERSATION_ID, { participantMemberRef: "ref-abc" });
    await routeModule.PATCH(patch({ participantMemberRef: null }), context());
    expect(changeParticipantMock).toHaveBeenLastCalledWith(OWNER_A, CONVERSATION_ID, { participantMemberRef: null });
  });

  it("answers a confirmed removal no-op with 200 and the exact current owner DTO, never { ok: true } (SPEC Stable errors)", async () => {
    changeParticipantMock.mockResolvedValue({ ok: true, noop: true });
    readOwnerConversationMock.mockResolvedValue({ ok: true, conversation: ownerDtoFromOperation });

    const response = await routeModule.PATCH(patch({ participantMemberRef: null }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();

    expect(body).not.toEqual({ ok: true });
    expect(readOwnerConversationMock).toHaveBeenCalledWith(OWNER_A, CONVERSATION_ID, READ_DEPS);
    expect(Object.keys(body)).toEqual([...OWNER_DTO_KEYS]);
    expect(Object.keys(body.participant)).toEqual([...OWNER_PARTICIPANT_KEYS]);
    expect(Object.keys(body.sharedGoals[0])).toEqual([...SHARED_GOAL_DTO_KEYS]);
    const text = JSON.stringify(body);
    for (const leaked of ["leaked-uid", "leaked-ref", "leaked-tree-id", "leaked-goal-id", "leaked-owner", "leaked-key-check", "leaked-ciphertext"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("keeps the { ok: true } body for an ordinary participant change, and reads no owner DTO", async () => {
    changeParticipantMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PATCH(patch({ participantMemberRef: "ref-abc" }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readOwnerConversationMock).not.toHaveBeenCalled();
  });

  it("maps a failed owner read after a confirmed no-op to its own code and status, with no DTO invented", async () => {
    changeParticipantMock.mockResolvedValue({ ok: true, noop: true });
    readOwnerConversationMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const gone = await routeModule.PATCH(patch({ participantMemberRef: null }), context());
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "conversation_not_found" });

    readOwnerConversationMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const failed = await routeModule.PATCH(patch({ participantMemberRef: null }), context());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "persistence_failed" });
  });

  it("keeps membership and eligibility decisions out of the route file", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/team-eligibility|teamMemberships|readGenuineActiveMembership|authorizeTeamAccess|bindingMatches/);
  });

  it("routes status completed to completion, and refuses any other status value without a write", async () => {
    completeConversationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.PATCH(patch({ status: "completed" }), context());
    expect(response.status).toBe(200);
    expect(completeConversationMock).toHaveBeenCalledWith(OWNER_A, CONVERSATION_ID);

    for (const status of ["open", "active", "cancelled", "COMPLETED"]) {
      const refused = await routeModule.PATCH(patch({ status }), context());
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: "invalid_input" });
    }
    expect(completeConversationMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a body that mixes keys from different operations, without calling any operation", async () => {
    const mixes = [
      { title: "x", sharedGoalIds: [] },
      { status: "completed", title: "x" },
      { participantMemberRef: null, ownerNotes: "x" },
    ];
    for (const body of mixes) {
      const response = await routeModule.PATCH(patch(body), context());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expectNoOperationCall();
  });

  it("refuses an empty object, an unknown key, an owner selector and a non-object body", async () => {
    for (const body of [{}, { uid: OWNER_B }, { ownerUid: OWNER_B, title: "x" }, { participantUid: OWNER_B }, { email: "a@example.test" }, "[]", "42", "{"]) {
      const response = await routeModule.PATCH(patch(body), context());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expectNoOperationCall();
  });

  it("maps a body over the cap to 413 before any operation", async () => {
    const response = await routeModule.PATCH(patch({ ownerNotes: "a".repeat(40000) }), context());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expectNoOperationCall();
  });

  it.each<[ConversationErrorCode, () => void]>([
    ["invalid_input", () => updateOwnerSectionsMock.mockResolvedValue({ ok: false, error: "invalid_input", field: "title" })],
    ["conversation_completed", () => updateOwnerSectionsMock.mockResolvedValue({ ok: false, error: "conversation_completed" })],
    ["conversation_not_found", () => updateOwnerSectionsMock.mockResolvedValue({ ok: false, error: "conversation_not_found" })],
    ["persistence_failed", () => updateOwnerSectionsMock.mockResolvedValue({ ok: false, error: "persistence_failed" })],
  ])("maps a section-write %s to its stable status and returns only the code", async (code, arrange) => {
    arrange();
    const response = await routeModule.PATCH(patch({ title: "x" }), context());
    expect(response.status).toBe(CONVERSATION_ERROR_STATUS[code]);
    expect(await response.json()).toEqual({ error: code });
  });

  it("maps goal, participant and completion refusals to their stable statuses", async () => {
    setSharedGoalsMock.mockResolvedValue({ ok: false, error: "invalid_goal_selection" });
    const goals = await routeModule.PATCH(patch({ sharedGoalIds: ["bad"] }), context());
    expect(goals.status).toBe(400);
    expect(await goals.json()).toEqual({ error: "invalid_goal_selection" });

    changeParticipantMock.mockResolvedValue({ ok: false, error: "invalid_participant" });
    const participant = await routeModule.PATCH(patch({ participantMemberRef: "ref" }), context());
    expect(participant.status).toBe(400);
    expect(await participant.json()).toEqual({ error: "invalid_participant" });

    completeConversationMock.mockResolvedValue({ ok: false, error: "invalid_transition" });
    const completed = await routeModule.PATCH(patch({ status: "completed" }), context());
    expect(completed.status).toBe(409);
    expect(await completed.json()).toEqual({ error: "invalid_transition" });
  });

  it("maps an operational failure of the goal write to 500 persistence_failed", async () => {
    setSharedGoalsMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const response = await routeModule.PATCH(patch({ sharedGoalIds: [] }), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});

describe("DELETE /api/me/conversations/[conversationId]", () => {
  it("rejects an unverifiable token with 401 and deletes nothing", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.DELETE(del({}), context());
    expect(response.status).toBe(401);
    expectNoOperationCall();
  });

  it("deletes the conversation for the verified caller and returns 200 { ok: true }", async () => {
    deleteConversationMock.mockResolvedValue({ ok: true });
    const response = await routeModule.DELETE(del(), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ ok: true });
    expect(deleteConversationMock).toHaveBeenCalledWith(OWNER_A, CONVERSATION_ID);
  });

  it("answers a foreign or missing id with 404, and an operational failure with 500", async () => {
    deleteConversationMock.mockResolvedValueOnce({ ok: false, error: "conversation_not_found" });
    const missing = await routeModule.DELETE(del(), context());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "conversation_not_found" });

    deleteConversationMock.mockResolvedValueOnce({ ok: false, error: "persistence_failed" });
    const failed = await routeModule.DELETE(del(), context());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "persistence_failed" });
  });
});

// Synthetic values only (invariant 15). Each `leaked-*` value is a field an operation must never send to a client.
const LEAKED = [
  "leaked-owner",
  "leaked-participant",
  "leaked-uid",
  "leaked-ref",
  "leaked-email",
  "leaked-tree-id",
  "leaked-ciphertext",
  "leaked-iv",
  "leaked-tag",
  "leaked-key-check",
  "leaked-title",
];

describe("GET /api/me/conversations/[conversationId]: participant and pending views (TASK-024)", () => {
  it("returns exactly the participant DTO keys, nested goal keys and no leaked field for an accepted participant", async () => {
    readConversationForCallerMock.mockResolvedValue({
      ok: true,
      view: {
        kind: "participant",
        dto: {
          conversationId: CONVERSATION_ID,
          title: "Synthetic title",
          status: "open",
          plannedFor: null,
          teamName: "Synthetic team",
          ownerDisplayName: "Kollega",
          ownerNotes: "Synthetic owner note",
          nextSteps: ["Synthetic step"],
          participantNotes: "Synthetic participant note",
          sharedGoals: [
            {
              goalTitle: "Synthetic goal",
              areaName: null,
              targetDate: null,
              status: "active",
              capturedAt: new Date("2026-10-10T08:00:00.000Z"),
              treeId: "leaked-tree-id",
              memberRef: "leaked-ref",
            },
          ],
          createdAt: new Date("2026-10-01T08:00:00.000Z"),
          updatedAt: new Date("2026-10-02T08:00:00.000Z"),
          completedAt: null,
          ownerUid: "leaked-owner",
          participantUid: "leaked-participant",
          uid: "leaked-uid",
          memberRef: "leaked-ref",
          email: "leaked-email",
          ciphertext: "leaked-ciphertext",
          iv: "leaked-iv",
          authTag: "leaked-tag",
          keyCheck: "leaked-key-check",
        },
      },
    });

    const response = await routeModule.GET(get(), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();

    expect(Object.keys(body)).toEqual([...PARTICIPANT_DTO_KEYS]);
    expect(Object.keys(body.sharedGoals[0])).toEqual([...SHARED_GOAL_DTO_KEYS]);
    const text = JSON.stringify(body);
    for (const leaked of LEAKED) expect(text).not.toContain(leaked);
  });

  it("returns exactly the pending DTO keys and no content, identifier or key field for a pending invitee", async () => {
    readConversationForCallerMock.mockResolvedValue({
      ok: true,
      view: {
        kind: "pending",
        dto: {
          conversationId: CONVERSATION_ID,
          state: "pending",
          teamName: "Synthetic team",
          invitedAt: new Date("2026-10-03T08:00:00.000Z"),
          ownerDisplayName: null,
          title: "leaked-title",
          ownerNotes: "leaked-title",
          nextSteps: ["leaked-title"],
          participantNotes: "leaked-title",
          sharedGoals: [{ goalTitle: "leaked-title" }],
          uid: "leaked-uid",
          ownerUid: "leaked-owner",
          memberRef: "leaked-ref",
          email: "leaked-email",
          ciphertext: "leaked-ciphertext",
          keyCheck: "leaked-key-check",
        },
      },
    });

    const response = await routeModule.GET(get(), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();

    expect(Object.keys(body)).toEqual([...PENDING_DTO_KEYS]);
    expect(body.state).toBe("pending");
    const text = JSON.stringify(body);
    for (const leaked of LEAKED) expect(text).not.toContain(leaked);
  });

  it("returns 404 with the same body for a participation that is not visible to the caller", async () => {
    readConversationForCallerMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const response = await routeModule.GET(get(), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation_not_found" });
  });
});

describe("route file method allow-list", () => {
  it("exports only GET, PATCH and DELETE", () => {
    const methods = Object.keys(routeModule).filter((name) => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(name));
    expect(methods.sort()).toEqual(["DELETE", "GET", "PATCH"]);
  });
});
