import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contract for evidence selection (SPEC BR-40 to BR-47; SECURITY-REVIEW N-E2, N-E4, N-E5, N-E7). The operations are mocked
 * so this file tests only what the route owns: the verified subject, the one-operation body rule, the response mapping and
 * the owner-only list. Synthetic identifiers only (invariant 15).
 */

const verifyIdTokenMock = vi.fn();
const setSharedEvidenceMock = vi.fn();
const listSelectableEvidenceMock = vi.fn();
const evidenceDepsMock = vi.fn(() => ({ deps: "evidence" }));
const selectableDepsMock = vi.fn(() => ({ deps: "selectable" }));

vi.mock("../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../src/features/development-conversations/server/set-shared-evidence", () => ({
  setSharedEvidence: setSharedEvidenceMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/list-selectable-evidence", () => ({
  listSelectableEvidenceForOwner: listSelectableEvidenceMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/owner-route-deps", () => ({
  productionOwnerReadDeps: vi.fn(),
  productionSetSharedGoalsDeps: vi.fn(),
  productionSetSharedEvidenceDeps: evidenceDepsMock,
  productionSelectableEvidenceDeps: selectableDepsMock,
}));
vi.mock("../../../../../src/features/development-conversations/server/conversation-view-route-deps", () => ({
  productionConversationViewDeps: vi.fn(),
}));

const detailModule = await import("./route");
const evidenceListModule = await import("./evidence-sources/route");

const CONVERSATION_ID = "conv-1";
/** The owner read version the client echoes (E-1). Synthetic. */
const VERSION = "2026-10-17T09:30:00.000Z";
const OWNER = "owner-1";
const SUBJECT_HEADER = { authorization: "Bearer synthetic-token" };

function patch(body: unknown): Request {
  return new Request("https://example.test/api/me/conversations/conv-1", {
    method: "PATCH",
    headers: { ...SUBJECT_HEADER, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = () => ({ params: Promise.resolve({ conversationId: CONVERSATION_ID }) });

beforeEach(() => {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: OWNER, email: "x@example.test", emailVerified: true } });
  setSharedEvidenceMock.mockResolvedValue({ ok: true });
  listSelectableEvidenceMock.mockResolvedValue({
    ok: true,
    items: [{ kind: "responsibility", id: "resp-1", title: "Synthetic", status: "active" }],
    truncated: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH sharedEvidence: one operation, the verified subject only", () => {
  it("routes a sharedEvidence body to the evidence write with the verified uid and the selection only", async () => {
    const response = await detailModule.PATCH(patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: ["resp-1"], achievementIds: [] } }), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(setSharedEvidenceMock).toHaveBeenCalledWith(OWNER, CONVERSATION_ID, { responsibilityIds: ["resp-1"], achievementIds: [] }, VERSION, {
      deps: "evidence",
    });
  });

  it("refuses a sharedEvidence body without the version precondition (E-1), with no call", async () => {
    const response = await detailModule.PATCH(patch({ sharedEvidence: { responsibilityIds: [], achievementIds: [] } }), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input" });
    expect(setSharedEvidenceMock).not.toHaveBeenCalled();
  });

  it("refuses a top-level uid in the body with invalid_input and calls no operation (N-E7)", async () => {
    const response = await detailModule.PATCH(patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: [], achievementIds: [] }, uid: "other" }), context());

    expect(response.status).toBe(400);
    expect(setSharedEvidenceMock).not.toHaveBeenCalled();
  });

  it("refuses sharedEvidence mixed with another operation's key, with invalid_input and no call", async () => {
    const response = await detailModule.PATCH(
      patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: [], achievementIds: [] }, sharedGoalIds: [] }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(setSharedEvidenceMock).not.toHaveBeenCalled();
  });

  it("maps an invalid evidence selection to 400 with the stable code only", async () => {
    setSharedEvidenceMock.mockResolvedValue({ ok: false, error: "invalid_evidence_selection" });
    const response = await detailModule.PATCH(patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: ["x"], achievementIds: [] } }), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_evidence_selection" });
  });

  it("maps a completed conversation to 409 conversation_completed, with no snapshot in the response", async () => {
    setSharedEvidenceMock.mockResolvedValue({ ok: false, error: "conversation_completed" });
    const response = await detailModule.PATCH(patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: ["resp-1"], achievementIds: [] } }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conversation_completed" });
  });

  it("answers a foreign or non-owned conversation with conversation_not_found (N-E4, N-E5)", async () => {
    setSharedEvidenceMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const response = await detailModule.PATCH(patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: [], achievementIds: [] } }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation_not_found" });
  });

  it("refuses an unauthenticated request before reading the body", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "missing" });
    const response = await detailModule.PATCH(patch({ expectedUpdatedAt: VERSION, sharedEvidence: { responsibilityIds: [], achievementIds: [] } }), context());

    expect(response.status).toBe(401);
    expect(setSharedEvidenceMock).not.toHaveBeenCalled();
  });
});

describe("GET evidence-sources: owner-only selectable list (N-E2, N-E4, N-E5)", () => {
  function get(): Request {
    return new Request("https://example.test/api/me/conversations/conv-1/evidence-sources", { headers: SUBJECT_HEADER });
  }

  it("returns the owner's selectable items with exactly the source keys", async () => {
    const response = await evidenceListModule.GET(get(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      items: [{ kind: "responsibility", id: "resp-1", title: "Synthetic", status: "active" }],
      truncated: false,
    });
    expect(listSelectableEvidenceMock).toHaveBeenCalledWith(OWNER, CONVERSATION_ID, { deps: "selectable" });
  });

  it("returns conversation_not_found for a non-owned or unknown conversation, with no item", async () => {
    listSelectableEvidenceMock.mockResolvedValue({ ok: false, error: "conversation_not_found" });
    const response = await evidenceListModule.GET(get(), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation_not_found" });
  });

  it("returns persistence_failed without an item list when a read fails", async () => {
    listSelectableEvidenceMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const response = await evidenceListModule.GET(get(), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});
