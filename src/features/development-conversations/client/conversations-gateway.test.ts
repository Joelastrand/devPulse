import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptInvitation,
  createConversation,
  deleteConversation,
  endParticipation,
  fetchConversation,
  fetchSelectableMembers,
  fetchConversationList,
  fetchCreateOptions,
  fetchOwnGoals,
  saveParticipantNotes,
  updateConversation,
  type CreateConversationInput,
  type OwnerPatchInput,
} from "./conversations-gateway";

const ISO = "2026-01-01T00:00:00.000Z";
const goal = { goalTitle: "Lær Rust", areaName: null, targetDate: null, status: "active", capturedAt: ISO };
const ownerParticipant = { state: "none", displayName: null };
const ownerSummary = {
  conversationId: "c1",
  title: "Plan",
  status: "open",
  plannedFor: null,
  participant: ownerParticipant,
  sharedGoalCount: 0,
  createdAt: ISO,
  updatedAt: ISO,
};
const participation = { conversationId: "c2", state: "pending", title: null, teamName: "Team A", invitedAt: ISO };
const envelope = {
  owned: { items: [ownerSummary, { conversationId: "r1" }], truncated: false },
  participating: { items: [participation], truncated: true },
};
const ownerDto = {
  conversationId: "c1",
  title: "Plan",
  status: "open",
  plannedFor: "2026-02-01",
  teamId: "t1",
  participant: ownerParticipant,
  ownerNotes: "owner text",
  nextSteps: ["step"],
  participantNotes: "",
  sharedGoals: [goal],
  createdAt: ISO,
  updatedAt: ISO,
  completedAt: null,
};
const participantDto = {
  conversationId: "c1",
  title: "Plan",
  status: "open",
  plannedFor: null,
  teamName: "Team A",
  ownerDisplayName: "Ola",
  ownerNotes: "owner text",
  nextSteps: [],
  participantNotes: "mine",
  sharedGoals: [goal],
  createdAt: ISO,
  updatedAt: ISO,
  completedAt: null,
};
const pendingDto = { conversationId: "c1", state: "pending", teamName: "Team A", invitedAt: ISO, ownerDisplayName: null };

/** Stubs `fetch` with one response. `json` rejects when `body` is `undefined`, which models a non-JSON body. */
function respond(status: number, body?: unknown) {
  const json = body === undefined ? vi.fn().mockRejectedValue(new Error("not json")) : vi.fn().mockResolvedValue(body);
  const fetchMock = vi.fn().mockResolvedValue({ status, json });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A copy of a fixture with one key removed, to build a body that is missing a required field. */
function withoutKey(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

function failNetwork() {
  const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("request construction", () => {
  it("sends only the bearer header on a bodiless GET, with no Content-Type and no body", async () => {
    const fetchMock = respond(200, envelope);
    await fetchConversationList("tok");
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations", {
      method: "GET",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("encodes the conversation id as one path segment", async () => {
    const fetchMock = respond(200, ownerDto);
    await fetchConversation("tok", "a/b c?x=1#f%2e");
    // Each reserved character is encoded once, so the id stays one segment and `%` is not double-encoded.
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/me/conversations/a%2Fb%20c%3Fx%3D1%23f%252e");
  });
});

describe("fetchCreateOptions", () => {
  const options = { items: [{ teamId: "team-a", name: "Plattform" }], truncated: false };

  it("sends a bodiless GET to the create-options route with only the bearer header", async () => {
    const fetchMock = respond(200, options);
    await fetchCreateOptions("tok");
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/create-options", {
      method: "GET",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("returns the exact { items, truncated } shape, with each item exactly teamId and name", async () => {
    respond(200, options);
    expect(await fetchCreateOptions("tok")).toEqual({ status: "ok", response: options });
  });

  it("accepts an empty, truncated list as a successful read, distinct from a failure", async () => {
    respond(200, { items: [], truncated: true });
    expect(await fetchCreateOptions("tok")).toEqual({ status: "ok", response: { items: [], truncated: true } });
  });

  it("treats any extra or missing key as a read failure, at the envelope and at the item", async () => {
    respond(200, { ...options, status: "ok" });
    expect(await fetchCreateOptions("tok")).toEqual({ status: "error", error: "read_failed" });
    respond(200, { items: [{ teamId: "team-a", name: "P", role: "lead" }], truncated: false });
    expect(await fetchCreateOptions("tok")).toEqual({ status: "error", error: "read_failed" });
    respond(200, { items: [{ teamId: "team-a" }], truncated: false });
    expect(await fetchCreateOptions("tok")).toEqual({ status: "error", error: "read_failed" });
  });

  it("treats a non-boolean truncated flag and a non-array items field as a read failure", async () => {
    respond(200, { items: [], truncated: "no" });
    expect(await fetchCreateOptions("tok")).toEqual({ status: "error", error: "read_failed" });
    respond(200, { items: {}, truncated: false });
    expect(await fetchCreateOptions("tok")).toEqual({ status: "error", error: "read_failed" });
  });

  it("maps 401 to unauthenticated and the listed 500 code to persistence_failed", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await fetchCreateOptions("t")).toEqual({ status: "unauthenticated" });
    respond(500, { error: "persistence_failed" });
    expect(await fetchCreateOptions("t")).toEqual({ status: "error", error: "persistence_failed" });
  });

  it("maps an unlisted error code to unknown, and a network failure to read_failed", async () => {
    respond(500, { error: "invalid_input" });
    expect(await fetchCreateOptions("t")).toEqual({ status: "error", error: "unknown" });
    failNetwork();
    expect(await fetchCreateOptions("t")).toEqual({ status: "error", error: "read_failed" });
  });
});

describe("fetchConversationList", () => {
  it("returns the parsed envelope, with owner summaries and recovery items tagged and order kept", async () => {
    respond(200, envelope);
    expect(await fetchConversationList("tok")).toEqual({
      status: "ok",
      response: {
        owned: {
          items: [
            { kind: "summary", conversation: ownerSummary },
            { kind: "recovery", item: { conversationId: "r1" } },
          ],
          truncated: false,
        },
        participating: { items: [participation], truncated: true },
      },
    });
  });

  it("does not re-sort owner items: a recovery item listed first stays first", async () => {
    respond(200, { ...envelope, owned: { items: [{ conversationId: "r1" }, ownerSummary], truncated: false } });
    const result = await fetchConversationList("tok");
    expect(result.status === "ok" && result.response.owned.items.map((item) => item.kind)).toEqual(["recovery", "summary"]);
  });

  it("maps 401 to unauthenticated and a known 500 code to persistence_failed", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await fetchConversationList("t")).toEqual({ status: "unauthenticated" });
    respond(500, { error: "persistence_failed" });
    expect(await fetchConversationList("t")).toEqual({ status: "error", error: "persistence_failed" });
  });

  it("maps an unlisted error code, a non-JSON error body and a network failure safely", async () => {
    respond(400, { error: "invalid_input" });
    expect(await fetchConversationList("t")).toEqual({ status: "error", error: "unknown" });
    respond(502);
    expect(await fetchConversationList("t")).toEqual({ status: "error", error: "unknown" });
    failNetwork();
    expect(await fetchConversationList("t")).toEqual({ status: "error", error: "read_failed" });
  });

  it("accepts a participation summary with an accepted title", async () => {
    const accepted = { conversationId: "c3", state: "accepted", title: "Plan", teamName: "Team A", invitedAt: ISO };
    respond(200, { ...envelope, participating: { items: [accepted], truncated: false } });
    const result = await fetchConversationList("t");
    expect(result.status === "ok" && result.response.participating.items).toEqual([accepted]);
  });

  it.each([
    ["extra envelope key", { ...envelope, extra: 1 }],
    ["missing participating", { owned: envelope.owned }],
    ["non-boolean truncated", { ...envelope, owned: { items: [], truncated: "no" } }],
    ["non-array items", { ...envelope, owned: { items: {}, truncated: false } }],
    ["owner summary with a uid", { ...envelope, owned: { items: [{ ...ownerSummary, uid: "u" }], truncated: false } }],
    ["recovery item with a title", { ...envelope, owned: { items: [{ conversationId: "r1", title: "x" }], truncated: false } }],
    ["summary-shaped item with a non-text title", { ...envelope, owned: { items: [{ conversationId: "r1", title: 123 }], truncated: false } }],
    ["owner summary with a bad status", { ...envelope, owned: { items: [{ ...ownerSummary, status: "late" }], truncated: false } }],
    ["owner summary with a bad participant state", { ...envelope, owned: { items: [{ ...ownerSummary, participant: { state: "lead", displayName: null } }], truncated: false } }],
    ["owner summary with a negative count", { ...envelope, owned: { items: [{ ...ownerSummary, sharedGoalCount: -1 }], truncated: false } }],
    ["pending invitation with a title", { ...envelope, participating: { items: [{ ...participation, title: "Secret" }], truncated: false } }],
    ["accepted entry without a title", { ...envelope, participating: { items: [{ ...participation, state: "accepted" }], truncated: false } }],
    ["participation with an unknown state", { ...envelope, participating: { items: [{ ...participation, state: "declined" }], truncated: false } }],
    ["participation with extra key", { ...envelope, participating: { items: [{ ...participation, memberRef: "m" }], truncated: false } }],
  ])("treats %s as a read failure, never partial data", async (_name, body) => {
    respond(200, body);
    expect(await fetchConversationList("t")).toEqual({ status: "error", error: "read_failed" });
  });

  it("treats a 200 with a body that does not parse as a read failure", async () => {
    respond(200);
    expect(await fetchConversationList("t")).toEqual({ status: "error", error: "read_failed" });
  });
});

describe("createConversation", () => {
  it("POSTs JSON with exactly the public keys and returns the new id", async () => {
    const fetchMock = respond(201, { conversationId: "c9" });
    const input: CreateConversationInput = { title: "Plan", plannedFor: "2026-02-01", teamId: "t1" };
    expect(await createConversation("tok", input)).toEqual({ status: "created", conversationId: "c9" });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Plan", plannedFor: "2026-02-01", teamId: "t1" }),
    });
  });

  it("drops runtime fields that are not public create keys", async () => {
    const fetchMock = respond(201, { conversationId: "c9" });
    const input = { title: "Plan", uid: "u", ownerUid: "o" } as CreateConversationInput;
    await createConversation("tok", input);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: JSON.stringify({ title: "Plan" }) });
  });

  it("maps its stable codes and refuses an unlisted one", async () => {
    for (const error of ["invalid_input", "payload_too_large", "conversation_limit", "persistence_failed"] as const) {
      respond(400, { error });
      expect(await createConversation("t", { title: "x" })).toEqual({ status: "error", error });
    }
    respond(404, { error: "conversation_not_found" });
    expect(await createConversation("t", { title: "x" })).toEqual({ status: "error", error: "unknown" });
  });

  it("does not count a 200 on create as success, and reports it unknown", async () => {
    respond(200, { conversationId: "c9" });
    expect(await createConversation("t", { title: "x" })).toEqual({ status: "error", error: "unknown" });
  });

  it("treats a malformed 201 as a read failure and a network failure as unknown", async () => {
    respond(201, { conversationId: "c9", extra: true });
    expect(await createConversation("t", { title: "x" })).toEqual({ status: "error", error: "read_failed" });
    failNetwork();
    expect(await createConversation("t", { title: "x" })).toEqual({ status: "error", error: "unknown" });
  });
});

describe("fetchConversation", () => {
  it("returns the owner view, tagged from its exact key set", async () => {
    respond(200, ownerDto);
    expect(await fetchConversation("t", "c1")).toEqual({ status: "ok", view: { kind: "owner", conversation: ownerDto } });
  });

  it("returns the participant view, tagged from its exact key set", async () => {
    respond(200, participantDto);
    expect(await fetchConversation("t", "c1")).toEqual({ status: "ok", view: { kind: "participant", conversation: participantDto } });
  });

  it("returns the pending view with only its invitation fields", async () => {
    respond(200, pendingDto);
    expect(await fetchConversation("t", "c1")).toEqual({ status: "ok", view: { kind: "pending", invitation: pendingDto } });
  });

  it("maps 404 conversation_not_found and 500 persistence_failed, and refuses other codes", async () => {
    respond(404, { error: "conversation_not_found" });
    expect(await fetchConversation("t", "c1")).toEqual({ status: "error", error: "conversation_not_found" });
    respond(500, { error: "persistence_failed" });
    expect(await fetchConversation("t", "c1")).toEqual({ status: "error", error: "persistence_failed" });
    respond(409, { error: "conversation_completed" });
    expect(await fetchConversation("t", "c1")).toEqual({ status: "error", error: "unknown" });
    respond(401, { error: "unauthenticated" });
    expect(await fetchConversation("t", "c1")).toEqual({ status: "unauthenticated" });
  });

  it.each([
    ["pending invitation with a title", { ...pendingDto, title: "Secret" }],
    ["pending invitation with owner notes", { ...pendingDto, ownerNotes: "x" }],
    ["participant view with an owner uid", { ...participantDto, ownerUid: "u" }],
    ["owner view with a participant with extra key", { ...ownerDto, participant: { ...ownerParticipant, uid: "u" } }],
    ["owner view with a shared goal with extra key", { ...ownerDto, sharedGoals: [{ ...goal, goalId: "g" }] }],
    ["owner view with a participant-view field", { ...ownerDto, teamName: "Team A" }],
    ["participant view with an owner-view field", { ...participantDto, teamId: "t1" }],
    ["owner view missing participantNotes", withoutKey(ownerDto, "participantNotes")],
    ["owner view with a bad shared goal status", { ...ownerDto, sharedGoals: [{ ...goal, status: "late" }] }],
    ["owner view with a non-array nextSteps", { ...ownerDto, nextSteps: "step" }],
    ["unrecognised body", { hello: "world" }],
  ])("treats %s as a read failure, never a guessed view", async (_name, body) => {
    respond(200, body);
    expect(await fetchConversation("t", "c1")).toEqual({ status: "error", error: "read_failed" });
  });
});

describe("updateConversation", () => {
  const patch = (input: OwnerPatchInput) => input;

  it("sends only the allow-listed keys present on the input", async () => {
    const fetchMock = respond(200, { ok: true });
    const input = { title: "New", ownerNotes: "n", uid: "u" } as OwnerPatchInput;
    expect(await updateConversation("tok", "c1", input)).toEqual({ status: "saved" });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/c1", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New", ownerNotes: "n" }),
    });
  });

  it("keeps an explicit null, which clears the participant selector", async () => {
    const fetchMock = respond(200, { ok: true });
    await updateConversation("t", "c1", patch({ participantMemberRef: null }));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: JSON.stringify({ participantMemberRef: null }) });
  });

  it("sends one shared-goal, participant or completion key per request", async () => {
    const fetchMock = respond(200, { ok: true });
    await updateConversation("t", "c1", patch({ sharedGoalIds: ["g1"] }));
    await updateConversation("t", "c1", patch({ status: "completed" }));
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ sharedGoalIds: ["g1"] }),
      JSON.stringify({ status: "completed" }),
    ]);
  });

  it("types both successful shapes: a real change is saved, and a no-op removal returns the owner DTO", async () => {
    respond(200, { ok: true });
    expect(await updateConversation("t", "c1", patch({ title: "x" }))).toEqual({ status: "saved" });
    respond(200, ownerDto);
    expect(await updateConversation("t", "c1", patch({ participantMemberRef: null }))).toEqual({
      status: "unchanged",
      conversation: ownerDto,
    });
  });

  it("does not accept a success body that is neither shape", async () => {
    respond(200, { ok: true, noop: true });
    expect(await updateConversation("t", "c1", patch({ title: "x" }))).toEqual({ status: "error", error: "read_failed" });
    respond(200, { ...ownerDto, uid: "u" });
    expect(await updateConversation("t", "c1", patch({ participantMemberRef: null }))).toEqual({ status: "error", error: "read_failed" });
  });

  it("maps its stable codes, refuses an unlisted one and keeps a network failure unknown", async () => {
    for (const error of [
      "invalid_input",
      "payload_too_large",
      "conversation_not_found",
      "conversation_completed",
      "invalid_transition",
      "invalid_participant",
      "invalid_goal_selection",
      "persistence_failed",
    ] as const) {
      respond(400, { error });
      expect(await updateConversation("t", "c1", patch({ title: "x" }))).toEqual({ status: "error", error });
    }
    respond(400, { error: "unauthenticated_user" });
    expect(await updateConversation("t", "c1", patch({ title: "x" }))).toEqual({ status: "error", error: "unknown" });
    failNetwork();
    expect(await updateConversation("t", "c1", patch({ title: "x" }))).toEqual({ status: "error", error: "unknown" });
  });
});

describe("deleteConversation", () => {
  it("DELETEs with no body and returns deleted on { ok: true }", async () => {
    const fetchMock = respond(200, { ok: true });
    expect(await deleteConversation("tok", "c1")).toEqual({ status: "deleted" });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/c1", { method: "DELETE", headers: { Authorization: "Bearer tok" } });
  });

  it("maps its stable codes and treats a malformed success body as a read failure", async () => {
    respond(404, { error: "conversation_not_found" });
    expect(await deleteConversation("t", "c1")).toEqual({ status: "error", error: "conversation_not_found" });
    respond(500, { error: "persistence_failed" });
    expect(await deleteConversation("t", "c1")).toEqual({ status: "error", error: "persistence_failed" });
    respond(200, { ok: true, extra: 1 });
    expect(await deleteConversation("t", "c1")).toEqual({ status: "error", error: "read_failed" });
  });
});

describe("saveParticipantNotes", () => {
  it("PUTs exactly { notes } and returns saved on { ok: true }", async () => {
    const fetchMock = respond(200, { ok: true });
    const input = { notes: "mine", participantUid: "p", ownerUid: "o" } as { notes: string };
    expect(await saveParticipantNotes("tok", "c1", input)).toEqual({ status: "saved" });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/c1/participant-notes", {
      method: "PUT",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "mine" }),
    });
  });

  it("sends an empty note, which clears the notes", async () => {
    const fetchMock = respond(200, { ok: true });
    await saveParticipantNotes("t", "c1", { notes: "" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: JSON.stringify({ notes: "" }) });
  });

  it("maps its stable codes and keeps a network failure unknown", async () => {
    for (const error of ["invalid_input", "payload_too_large", "conversation_not_found", "conversation_completed", "persistence_failed"] as const) {
      respond(400, { error });
      expect(await saveParticipantNotes("t", "c1", { notes: "x" })).toEqual({ status: "error", error });
    }
    failNetwork();
    expect(await saveParticipantNotes("t", "c1", { notes: "x" })).toEqual({ status: "error", error: "unknown" });
  });
});

describe("acceptInvitation", () => {
  it("POSTs with no request body and returns accepted on { state: 'accepted' }", async () => {
    const fetchMock = respond(200, { state: "accepted" });
    expect(await acceptInvitation("tok", "c1")).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/c1/participation/accept", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("treats a success body that is not exactly the accepted state as a read failure", async () => {
    respond(200, { state: "accepted", ownerNotes: "x" });
    expect(await acceptInvitation("t", "c1")).toEqual({ status: "error", error: "read_failed" });
    respond(200, { ok: true });
    expect(await acceptInvitation("t", "c1")).toEqual({ status: "error", error: "read_failed" });
  });

  it("maps its stable codes and keeps a network failure unknown", async () => {
    respond(404, { error: "conversation_not_found" });
    expect(await acceptInvitation("t", "c1")).toEqual({ status: "error", error: "conversation_not_found" });
    respond(500, { error: "persistence_failed" });
    expect(await acceptInvitation("t", "c1")).toEqual({ status: "error", error: "persistence_failed" });
    failNetwork();
    expect(await acceptInvitation("t", "c1")).toEqual({ status: "error", error: "unknown" });
  });
});

describe("endParticipation", () => {
  it("DELETEs with no request body and succeeds on 204 without reading a JSON body", async () => {
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, json });
    vi.stubGlobal("fetch", fetchMock);
    expect(await endParticipation("tok", "c1")).toEqual({ status: "ended" });
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/c1/participation", {
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("does not treat a non-204 success status as the ended state", async () => {
    respond(200, { ok: true });
    expect(await endParticipation("t", "c1")).toEqual({ status: "error", error: "unknown" });
  });

  it("maps 401 and its stable codes, and keeps a network failure unknown", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await endParticipation("t", "c1")).toEqual({ status: "unauthenticated" });
    respond(404, { error: "conversation_not_found" });
    expect(await endParticipation("t", "c1")).toEqual({ status: "error", error: "conversation_not_found" });
    respond(500, { error: "persistence_failed" });
    expect(await endParticipation("t", "c1")).toEqual({ status: "error", error: "persistence_failed" });
    failNetwork();
    expect(await endParticipation("t", "c1")).toEqual({ status: "error", error: "unknown" });
  });
});

describe("fetchOwnGoals (D1 goal list for the snapshot selector, TASK-028)", () => {
  const d1Goal = { id: "g1", title: "Lær Rust", status: "active", treeId: null, areaName: null, areaAvailable: true, targetDate: null, createdAt: ISO, updatedAt: ISO, completedAt: null };

  it("sends a bodiless GET to the D1 goal list with only the bearer header", async () => {
    const fetchMock = respond(200, { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false });
    await fetchOwnGoals("tok");
    expect(fetchMock).toHaveBeenCalledWith("/api/me/goals", { method: "GET", headers: { Authorization: "Bearer tok" } });
  });

  it("returns only the id, title and status of each goal, and the truncation flag", async () => {
    respond(200, { goals: [d1Goal], recoveryItems: [], truncated: true, skillOptions: [], skillOptionsTruncated: false });
    expect(await fetchOwnGoals("tok")).toEqual({
      status: "ok",
      response: { goals: [{ id: "g1", title: "Lær Rust", status: "active" }], truncated: true },
    });
  });

  it("maps 500 persistence_failed, refuses other codes and reports 401 as unauthenticated", async () => {
    respond(500, { error: "persistence_failed" });
    expect(await fetchOwnGoals("tok")).toEqual({ status: "error", error: "persistence_failed" });
    respond(404, { error: "conversation_not_found" });
    expect(await fetchOwnGoals("tok")).toEqual({ status: "error", error: "unknown" });
    respond(401, { error: "unauthenticated" });
    expect(await fetchOwnGoals("tok")).toEqual({ status: "unauthenticated" });
  });

  it.each([
    ["a non-array goals value", { goals: "g1", truncated: false }],
    ["a goal without an id", { goals: [withoutKey(d1Goal, "id")], truncated: false }],
    ["a goal with an unknown status", { goals: [{ ...d1Goal, status: "archived" }], truncated: false }],
    ["a goal with a non-text title", { goals: [{ ...d1Goal, title: 3 }], truncated: false }],
    ["a missing truncated flag", { goals: [] }],
  ])("treats %s as a read failure, never a partial list", async (_name, body) => {
    respond(200, body);
    expect(await fetchOwnGoals("tok")).toEqual({ status: "error", error: "read_failed" });
  });

  it("reports a network failure on the read as read_failed", async () => {
    failNetwork();
    expect(await fetchOwnGoals("tok")).toEqual({ status: "error", error: "read_failed" });
  });
});

describe("fetchSelectableMembers (owner selector, SPEC Amendment 2026-10-19, TASK-029 I-1)", () => {
  const member = { memberRef: "ref-synthetic-1", displayName: "Kari Testperson", ordinal: null, isSelf: false };
  const body = { members: [member], unavailableCount: 0, truncated: false };

  it("sends a bodiless GET to the conversation's selectable-members route with only the bearer header, and no team id", async () => {
    const fetchMock = respond(200, body);
    await fetchSelectableMembers("tok", "conv-synthetic-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/conv-synthetic-1/selectable-members", {
      method: "GET",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("encodes the conversation id in the path", async () => {
    const fetchMock = respond(200, body);
    await fetchSelectableMembers("tok", "conv/with space");
    expect(fetchMock).toHaveBeenCalledWith("/api/me/conversations/conv%2Fwith%20space/selectable-members", expect.anything());
  });

  it("never calls the generic team assignable-members endpoint (no fallback, I-1)", async () => {
    const fetchMock = respond(200, body);
    await fetchSelectableMembers("tok", "conv-synthetic-1");
    for (const [path] of fetchMock.mock.calls) {
      expect(String(path)).not.toContain("/api/teams/");
      expect(String(path)).not.toContain("assignable-members");
    }
  });

  it("returns the members, the unavailable count and the truncation flag, keeping self so the caller can filter it", async () => {
    const self = { memberRef: "ref-synthetic-2", displayName: null, ordinal: 2, isSelf: true };
    respond(200, { members: [member, self], unavailableCount: 3, truncated: true });
    expect(await fetchSelectableMembers("tok", "c")).toEqual({
      status: "ok",
      response: { members: [member, self], unavailableCount: 3, truncated: true },
    });
  });

  it("maps 401 to unauthenticated, and each stable refusal to its own code", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await fetchSelectableMembers("tok", "c")).toEqual({ status: "unauthenticated" });
    for (const error of ["conversation_not_found", "invalid_participant", "conversation_completed", "persistence_failed"] as const) {
      respond(error === "persistence_failed" ? 500 : 404, { error });
      expect(await fetchSelectableMembers("tok", "c")).toEqual({ status: "error", error });
    }
  });

  it("maps an unlisted or unreadable refusal to unknown, with no echoed body", async () => {
    respond(403, { status: "forbidden", uid: "uid-synthetic" });
    expect(await fetchSelectableMembers("tok", "c")).toEqual({ status: "error", error: "unknown" });
    respond(500, "not json at all");
    expect(await fetchSelectableMembers("tok", "c")).toEqual({ status: "error", error: "unknown" });
  });

  it.each([
    ["a member with an extra uid key", { members: [{ ...member, uid: "uid-synthetic" }], unavailableCount: 0, truncated: false }],
    ["a member with an empty memberRef", { members: [{ ...member, memberRef: "" }], unavailableCount: 0, truncated: false }],
    ["a member with a zero ordinal", { members: [{ ...member, ordinal: 0 }], unavailableCount: 0, truncated: false }],
    ["a member whose isSelf is not a boolean", { members: [{ ...member, isSelf: "no" }], unavailableCount: 0, truncated: false }],
    ["a missing unavailableCount", { members: [member], truncated: false }],
    ["an extra top-level key", { members: [member], unavailableCount: 0, truncated: false, teamId: "t" }],
    ["a non-array members value", { members: "x", unavailableCount: 0, truncated: false }],
  ])("treats %s as a read failure, never a partial list", async (_name, bad) => {
    respond(200, bad);
    expect(await fetchSelectableMembers("tok", "c")).toEqual({ status: "error", error: "read_failed" });
  });

  it("reports a network failure on the read as read_failed", async () => {
    failNetwork();
    expect(await fetchSelectableMembers("tok", "c")).toEqual({ status: "error", error: "read_failed" });
  });
});
