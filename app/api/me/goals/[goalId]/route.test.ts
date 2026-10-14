import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOAL_BODY_MAX_BYTES, GOAL_DTO_KEYS } from "../../../../../src/features/personal-goals/domain/goal-constants";

const verifyIdTokenMock = vi.fn();
const updatePersonalGoalMock = vi.fn();
const deletePersonalGoalMock = vi.fn();

vi.mock("../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../src/features/personal-goals/server/update-personal-goal", () => ({
  updatePersonalGoal: updatePersonalGoalMock,
}));
vi.mock("../../../../../src/features/personal-goals/server/delete-personal-goal", () => ({
  deletePersonalGoal: deletePersonalGoalMock,
}));

const routeModule = await import("./route");

const OWNER_A = "owner-a-uid-7731";
const OWNER_B = "owner-b-uid-4402";
const GOAL_ID = "goal0000000000000001";

const goalDto = {
  id: GOAL_ID,
  title: "Lær Rust",
  status: "active",
  treeId: "tree1",
  areaName: "Testning",
  areaAvailable: true,
  targetDate: "2026-12-31",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

const GOOD = { authorization: "Bearer good.token" };
const ctx = (goalId: string = GOAL_ID) => ({ params: Promise.resolve({ goalId }) });
const url = (goalId: string = GOAL_ID, query = "") => `http://localhost/api/me/goals/${goalId}${query}`;
const patch = (body: BodyInit | null, headers: Record<string, string> = GOOD, query = "") =>
  new Request(url(GOAL_ID, query), { method: "PATCH", headers, body: typeof body === "string" || body === null ? body : body });
const patchJson = (body: unknown, headers: Record<string, string> = GOOD) => patch(JSON.stringify(body), headers);
const del = (headers: Record<string, string> = GOOD, query = "") =>
  new Request(url(GOAL_ID, query), { method: "DELETE", headers });

const verifiedAs = (uid: string) =>
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid, email: "x@example.test", emailVerified: true } });

beforeEach(() => verifiedAs(OWNER_A));
afterEach(() => {
  verifyIdTokenMock.mockReset();
  updatePersonalGoalMock.mockReset();
  deletePersonalGoalMock.mockReset();
  vi.restoreAllMocks();
});

const expectNoStore = (response: Response) => expect(response.headers.get("cache-control")).toBe("no-store");

const BAD_AUTH = [
  ["a missing header", {}],
  ["a non-bearer scheme", { authorization: "Basic abc" }],
  ["a bare Bearer", { authorization: "Bearer" }],
] as const;

describe("PATCH /api/me/goals/[goalId] — authentication", () => {
  it.each(BAD_AUTH)("returns 401 for %s without reading the body or calling the operation", async (_name, headers) => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const request = patchJson({ title: "x" }, headers);
    const text = vi.spyOn(request, "text");
    const json = vi.spyOn(request, "json");
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");
    const response = await routeModule.PATCH(request, ctx());
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(verifyIdTokenMock).toHaveBeenCalledWith("");
    expect(request.bodyUsed).toBe(false);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an unverifiable token without exposing the verifier error", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.PATCH(patchJson({ title: "x" }), ctx());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(verifyIdTokenMock).toHaveBeenCalledWith("good.token");
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });

  it("answers 401 (not 400) for an oversized or malformed body with bad auth", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    for (const body of ["{not json", "x".repeat(GOAL_BODY_MAX_BYTES + 1)]) {
      const request = patch(body);
      const response = await routeModule.PATCH(request, ctx());
      expect(response.status).toBe(401);
      expect(request.bodyUsed).toBe(false);
    }
  });
});

describe("DELETE /api/me/goals/[goalId] — authentication", () => {
  it.each(BAD_AUTH)("returns 401 for %s without calling the operation", async (_name, headers) => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.DELETE(del(headers), ctx());
    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(verifyIdTokenMock).toHaveBeenCalledWith("");
    expect(deletePersonalGoalMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an unverifiable token", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: false, error: "invalid_token" });
    const response = await routeModule.DELETE(del(), ctx());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(deletePersonalGoalMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/me/goals/[goalId] — subject binding and body forwarding", () => {
  beforeEach(() => updatePersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto }));

  it("calls the operation with the verified uid, the path goal id and the exact input", async () => {
    const response = await routeModule.PATCH(patchJson({ title: "Nytt", status: "completed" }), ctx());
    expect(response.status).toBe(200);
    expect(updatePersonalGoalMock).toHaveBeenCalledTimes(1);
    expect(updatePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, GOAL_ID, { title: "Nytt", status: "completed" });
  });

  it("passes the same goal id for another verified subject: the path never selects the owner", async () => {
    verifiedAs(OWNER_B);
    await routeModule.PATCH(patchJson({ title: "x" }), ctx());
    expect(updatePersonalGoalMock).toHaveBeenCalledWith(OWNER_B, GOAL_ID, { title: "x" });
  });

  it.each(["treeId", "targetDate"])("forwards a null %s as null (null means remove on PATCH)", async (key) => {
    await routeModule.PATCH(patchJson({ [key]: null }), ctx());
    const input = updatePersonalGoalMock.mock.calls[0][2];
    expect(input).toEqual({ [key]: null });
    expect(Object.keys(input)).toEqual([key]);
    expect(input[key]).toBeNull();
  });

  it("forwards string treeId and targetDate unchanged and never synthesises absent keys", async () => {
    await routeModule.PATCH(patchJson({ treeId: "t1", targetDate: "2026-12-31" }), ctx());
    const input = updatePersonalGoalMock.mock.calls[0][2];
    expect(input).toEqual({ treeId: "t1", targetDate: "2026-12-31" });
    expect(Object.keys(input)).toEqual(["treeId", "targetDate"]);

    await routeModule.PATCH(patchJson({ status: "active" }), ctx());
    expect(Object.keys(updatePersonalGoalMock.mock.calls[1][2])).toEqual(["status"]);
  });

  it("passes a whitespace-only title through: the operation owns title validity", async () => {
    await routeModule.PATCH(patchJson({ title: "   " }), ctx());
    expect(updatePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, GOAL_ID, { title: "   " });
  });

  it("hands the raw route goal id to the operation, which owns addressability", async () => {
    await routeModule.PATCH(patchJson({ title: "x" }), ctx("__x__"));
    expect(updatePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, "__x__", { title: "x" });
  });

  it("ignores query parameters: another owner cannot be selected", async () => {
    await routeModule.PATCH(patch(JSON.stringify({ title: "x" }), GOOD, `?uid=${OWNER_B}&ownerUid=${OWNER_B}&teamId=t1`), ctx());
    expect(updatePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, GOAL_ID, { title: "x" });
    expect(JSON.stringify(updatePersonalGoalMock.mock.calls)).not.toContain(OWNER_B);
  });
});

describe("PATCH /api/me/goals/[goalId] — request shape is invalid_request before any operation call", () => {
  it.each([
    ["uid", { title: "x", uid: OWNER_B }],
    ["ownerUid", { title: "x", ownerUid: OWNER_B }],
    ["teamId", { title: "x", teamId: "t1" }],
    ["memberRef", { title: "x", memberRef: "m" }],
    ["email", { title: "x", email: "a@b.c" }],
    ["createdAt", { title: "x", createdAt: "2026-01-01" }],
    ["updatedAt", { title: "x", updatedAt: "2026-01-01" }],
    ["completedAt", { title: "x", completedAt: null }],
    ["areaName", { title: "x", areaName: "n" }],
    ["an arbitrary extra key", { title: "x", extra: 1 }],
    ["an empty object", {}],
    ["a null title", { title: null }],
    ["a numeric title", { title: 5 }],
    ["a numeric treeId", { treeId: 5 }],
    ["a boolean targetDate", { targetDate: false }],
    ["an invalid status value", { status: "done" }],
    ["a capitalised status", { status: "Active" }],
    ["a null status", { status: null }],
    ["a non-string status", { status: 1 }],
  ])("rejects %s", async (_name, body) => {
    const response = await routeModule.PATCH(patchJson(body), ctx());
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{title:"],
    ["an empty body", ""],
    ["null", "null"],
    ["an array", '[{"title":"x"}]'],
    ["a string", '"x"'],
    ["a number", "42"],
  ])("rejects %s", async (_name, body) => {
    const response = await routeModule.PATCH(patch(body), ctx());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });

  it("rejects a body over the byte cap, whatever Content-Length claims", async () => {
    const big = JSON.stringify({ title: "x".repeat(GOAL_BODY_MAX_BYTES) });
    const response = await routeModule.PATCH(patch(big, { ...GOOD, "content-length": "10" }), ctx());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });

  it("does not echo any part of a rejected body", async () => {
    const response = await routeModule.PATCH(patchJson({ title: "SECRET-TITLE", ownerUid: "SECRET-UID" }), ctx());
    expect(await response.text()).not.toContain("SECRET");
  });
});

describe("PATCH /api/me/goals/[goalId] — response mapping", () => {
  it("returns 200 with exactly the allow-listed DTO keys and no-store", async () => {
    updatePersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    const response = await routeModule.PATCH(patchJson({ title: "Lær Rust" }), ctx());
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toEqual(goalDto);
    expect(Object.keys(body)).toEqual([...GOAL_DTO_KEYS]);
  });

  it("re-allow-lists the DTO: stray fields from the operation never reach the client", async () => {
    updatePersonalGoalMock.mockResolvedValue({ ok: true, dto: { ...goalDto, ownerUid: OWNER_A, email: "x@example.test", extra: "LEAK" } });
    const text = await (await routeModule.PATCH(patchJson({ title: "x" }), ctx())).text();
    expect(JSON.parse(text)).toEqual(goalDto);
    for (const leaked of ["LEAK", OWNER_A, "example.test"]) expect(text).not.toContain(leaked);
  });

  it("returns an unchanged goal as the normal 200 success (a semantic no-op is the operation's decision)", async () => {
    updatePersonalGoalMock.mockResolvedValue({ ok: true, dto: goalDto });
    const response = await routeModule.PATCH(patchJson({ status: "active" }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(goalDto);
  });

  it.each([
    ["goal_not_found", 404],
    ["invalid_title", 400],
    ["invalid_target_date", 400],
    ["skill_not_found", 404],
    ["clock_regressed", 500],
    ["persistence_failed", 500],
  ] as const)("maps %s to %i with a content-free {error} body and no-store", async (error, status) => {
    updatePersonalGoalMock.mockResolvedValue({ ok: false, error });
    const response = await routeModule.PATCH(patchJson({ title: "x" }), ctx());
    expect(response.status).toBe(status);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error });
  });

  it("gives missing, foreign, shape-invalid and malformed goals the same 404 body and headers", async () => {
    updatePersonalGoalMock.mockResolvedValue({ ok: false, error: "goal_not_found" });
    const responses = await Promise.all(
      [GOAL_ID, "foreign-goal", "__x__", "bad id"].map((id) => routeModule.PATCH(patchJson({ title: "x" }), ctx(id))),
    );
    const texts = await Promise.all(responses.map((r) => r.text()));
    expect(new Set(texts)).toEqual(new Set(['{"error":"goal_not_found"}']));
    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([404]));
    expect(new Set(responses.map((r) => r.headers.get("cache-control")))).toEqual(new Set(["no-store"]));
  });

  // persistence_failed is also what TASK-008 returns when the write COMMITTED and only the response-area
  // read failed (BR-40). The route sees the same typed result, adds no flag and reads nothing to tell them
  // apart: a 500 here does not mean "nothing was written", and an identical retry is a no-op success.
  it("maps a repeat of the same PATCH independently: 500 persistence_failed first, then 200 on the no-op retry", async () => {
    updatePersonalGoalMock
      .mockResolvedValueOnce({ ok: false, error: "persistence_failed" })
      .mockResolvedValueOnce({ ok: true, dto: goalDto });
    const first = await routeModule.PATCH(patchJson({ status: "completed" }), ctx());
    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: "persistence_failed" });
    const second = await routeModule.PATCH(patchJson({ status: "completed" }), ctx());
    expect(second.status).toBe(200);
    expect(updatePersonalGoalMock).toHaveBeenNthCalledWith(1, OWNER_A, GOAL_ID, { status: "completed" });
    expect(updatePersonalGoalMock).toHaveBeenNthCalledWith(2, OWNER_A, GOAL_ID, { status: "completed" });
  });
});

describe("DELETE /api/me/goals/[goalId]", () => {
  it("deletes for the verified subject and returns 200 {ok:true} with no-store", async () => {
    deletePersonalGoalMock.mockResolvedValue({ ok: true });
    const response = await routeModule.DELETE(del(), ctx());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ ok: true });
    expect(deletePersonalGoalMock).toHaveBeenCalledTimes(1);
    expect(deletePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, GOAL_ID);
  });

  it("binds the operation to the verified subject for the same goal id", async () => {
    deletePersonalGoalMock.mockResolvedValue({ ok: true });
    verifiedAs(OWNER_B);
    await routeModule.DELETE(del(), ctx());
    expect(deletePersonalGoalMock).toHaveBeenCalledWith(OWNER_B, GOAL_ID);
  });

  it.each(["__x__", "a/b", "..", "x".repeat(129)])(
    "hands the raw id %j to the operation and returns its success, with no route-level 400/404",
    async (id) => {
      deletePersonalGoalMock.mockResolvedValue({ ok: true });
      const response = await routeModule.DELETE(del(), ctx(id));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(deletePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, id);
    },
  );

  it("is sufficient for a recovery item: only the goal id is needed, nothing is read first", async () => {
    deletePersonalGoalMock.mockResolvedValue({ ok: true });
    const response = await routeModule.DELETE(del(), ctx("badgoal1"));
    expect(response.status).toBe(200);
    expect(deletePersonalGoalMock.mock.calls).toEqual([[OWNER_A, "badgoal1"]]);
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });

  it("maps persistence_failed to 500 with a content-free body", async () => {
    deletePersonalGoalMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const response = await routeModule.DELETE(del(), ctx());
    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });

  it("ignores query parameters and never reads a body", async () => {
    deletePersonalGoalMock.mockResolvedValue({ ok: true });
    const request = del(GOOD, `?uid=${OWNER_B}&ownerUid=${OWNER_B}`);
    const text = vi.spyOn(request, "text");
    const json = vi.spyOn(request, "json");
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");
    await routeModule.DELETE(request, ctx());
    expect(deletePersonalGoalMock).toHaveBeenCalledWith(OWNER_A, GOAL_ID);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("never calls the update operation", async () => {
    deletePersonalGoalMock.mockResolvedValue({ ok: true });
    await routeModule.DELETE(del(), ctx());
    expect(updatePersonalGoalMock).not.toHaveBeenCalled();
  });
});

describe("route surface", () => {
  it("exports exactly PATCH and DELETE", () => {
    const methods = Object.keys(routeModule).filter((key) => /^[A-Z]+$/.test(key));
    expect(methods.sort()).toEqual(["DELETE", "PATCH"]);
  });
});
