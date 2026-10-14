import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoal, deleteGoal, fetchGoals, updateGoal } from "./goals-gateway";

const goal = {
  id: "g1",
  title: "Lær Rust",
  status: "active",
  treeId: null,
  areaName: null,
  areaAvailable: true,
  targetDate: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};
const envelope = { goals: [goal], recoveryItems: [{ goalId: "r1" }], truncated: false, skillOptions: [], skillOptionsTruncated: false };

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchGoals", () => {
  it("issues exactly one GET with only a bearer header and returns the parsed envelope", async () => {
    const fetchMock = respond(200, envelope);
    const result = await fetchGoals("tok");
    expect(result).toEqual({ status: "ok", response: envelope });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/me/goals", { headers: { Authorization: "Bearer tok" } });
  });

  it("maps 401 to unauthenticated and other statuses to read_failed", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await fetchGoals("t")).toEqual({ status: "unauthenticated" });
    respond(500, { error: "persistence_failed" });
    expect(await fetchGoals("t")).toEqual({ status: "read_failed" });
  });

  it("fails closed on network errors and unparsable bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("x")));
    expect(await fetchGoals("t")).toEqual({ status: "read_failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => Promise.reject(new Error("x")) }));
    expect(await fetchGoals("t")).toEqual({ status: "read_failed" });
  });

  it.each([
    ["extra envelope key", { ...envelope, extra: 1 }],
    ["missing envelope key", { goals: [], recoveryItems: [], truncated: false, skillOptions: [] }],
    ["non-array goals", { ...envelope, goals: {} }],
    ["extra goal key", { ...envelope, goals: [{ ...goal, uid: "u" }] }],
    ["bad status", { ...envelope, goals: [{ ...goal, status: "late" }] }],
    ["linked area available without a name", { ...envelope, goals: [{ ...goal, treeId: "t", areaAvailable: true }] }],
    ["unlinked goal marked unavailable", { ...envelope, goals: [{ ...goal, areaAvailable: false }] }],
    ["recovery item with content", { ...envelope, recoveryItems: [{ goalId: "r", title: "x" }] }],
    ["non-boolean truncated", { ...envelope, truncated: "no" }],
    ["bad skill option", { ...envelope, skillOptions: [{ treeId: "t" }] }],
  ])("treats %s as a read failure, never partial data", async (_name, body) => {
    respond(200, body);
    expect(await fetchGoals("t")).toEqual({ status: "read_failed" });
  });

  it("accepts a linked-but-unavailable area", async () => {
    const unavailable = { ...goal, treeId: "t", areaName: null, areaAvailable: false };
    respond(200, { ...envelope, goals: [unavailable] });
    const result = await fetchGoals("t");
    expect(result.status).toBe("ok");
  });
});

describe("createGoal", () => {
  it("POSTs exactly the given body with a bearer header and parses the 201 goal", async () => {
    const fetchMock = respond(201, goal);
    const result = await createGoal("tok", { title: "Lær Rust", treeId: "t1", targetDate: "2020-01-01" });
    expect(result).toEqual({ status: "ok", goal });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/goals");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ title: "Lær Rust", treeId: "t1", targetDate: "2020-01-01" });
  });

  it("maps 401 to unauthenticated", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await createGoal("t", { title: "x" })).toEqual({ status: "unauthenticated" });
  });

  it.each([
    [400, "invalid_request"],
    [400, "invalid_title"],
    [400, "invalid_target_date"],
    [404, "skill_not_found"],
    [409, "goal_limit"],
    [500, "persistence_failed"],
  ])("maps %s %s to that error", async (status, error) => {
    respond(status, { error });
    expect(await createGoal("t", { title: "x" })).toEqual({ status: "error", error });
  });

  it.each([
    ["an error only PATCH knows", 404, { error: "goal_not_found" }],
    ["an arbitrary error string", 500, { error: "boom: firestore stack" }],
    ["a non-object body", 500, "oops"],
    ["a 200 instead of 201", 200, goal],
    ["a 201 with a malformed goal", 201, { ...goal, uid: "u" }],
  ])("treats %s as an unknown outcome", async (_name, status, body) => {
    respond(status, body);
    expect(await createGoal("t", { title: "x" })).toEqual({ status: "error", error: "unknown" });
  });

  it("treats network errors and unparsable bodies as an unknown outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("x")));
    expect(await createGoal("t", { title: "x" })).toEqual({ status: "error", error: "unknown" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 201, json: async () => Promise.reject(new Error("x")) }));
    expect(await createGoal("t", { title: "x" })).toEqual({ status: "error", error: "unknown" });
  });
});

describe("updateGoal", () => {
  it("PATCHes the encoded goal path with exactly the given body and parses the 200 goal", async () => {
    const fetchMock = respond(200, goal);
    const result = await updateGoal("tok", "g/1 ?x", { treeId: null, targetDate: null });
    expect(result).toEqual({ status: "ok", goal });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/goals/g%2F1%20%3Fx");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(init.body).toBe('{"treeId":null,"targetDate":null}');
  });

  it("carries a lifecycle change as status only", async () => {
    const fetchMock = respond(200, goal);
    await updateGoal("t", "g1", { status: "completed" });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe('{"status":"completed"}');
  });

  it("maps 401 to unauthenticated", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await updateGoal("t", "g", { status: "active" })).toEqual({ status: "unauthenticated" });
  });

  it.each([
    [400, "invalid_request"],
    [400, "invalid_title"],
    [400, "invalid_target_date"],
    [404, "goal_not_found"],
    [404, "skill_not_found"],
    [500, "clock_regressed"],
    [500, "persistence_failed"],
  ])("maps %s %s to that error", async (status, error) => {
    respond(status, { error });
    expect(await updateGoal("t", "g", { status: "active" })).toEqual({ status: "error", error });
  });

  it.each([
    ["goal_limit, which PATCH never returns", 409, { error: "goal_limit" }],
    ["an arbitrary error string", 500, { error: { nested: true } }],
    ["a 201 instead of 200", 201, goal],
    ["a 200 with a malformed goal", 200, { id: "g" }],
  ])("treats %s as an unknown outcome", async (_name, status, body) => {
    respond(status, body);
    expect(await updateGoal("t", "g", { status: "active" })).toEqual({ status: "error", error: "unknown" });
  });

  it("does not retry a failed PATCH or POST", async () => {
    const fetchMock = respond(500, { error: "persistence_failed" });
    await updateGoal("t", "g", { status: "active" });
    await createGoal("t", { title: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["PATCH", "POST"]);
  });
});

describe("deleteGoal", () => {
  it("issues DELETE to the encoded goal path with only a bearer header and no body", async () => {
    const fetchMock = respond(200, { ok: true });
    expect(await deleteGoal("tok", "g/1 ?x")).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/me/goals/g%2F1%20%3Fx", {
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("maps 401 to unauthenticated", async () => {
    respond(401, { error: "unauthenticated" });
    expect(await deleteGoal("t", "g")).toEqual({ status: "unauthenticated" });
  });

  it.each([
    ["persistence_failed", 500, { error: "persistence_failed" }],
    ["an unexpected status", 404, { error: "goal_not_found" }],
    ["a 200 without ok", 200, {}],
    ["a 200 with ok false", 200, { ok: false }],
    ["a 200 with an extra key", 200, { ok: true, extra: "x" }],
    ["a 200 with a non-object body", 200, "ok"],
    ["a 204", 204, null],
  ])("treats %s as an unconfirmed delete", async (_name, status, body) => {
    respond(status, body);
    expect(await deleteGoal("t", "g")).toEqual({ status: "error", error: "unconfirmed" });
  });

  it("treats network errors and unparsable 200 bodies as unconfirmed and never retries", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("x"));
    vi.stubGlobal("fetch", failing);
    expect(await deleteGoal("t", "g")).toEqual({ status: "error", error: "unconfirmed" });
    expect(failing).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => Promise.reject(new Error("x")) }));
    expect(await deleteGoal("t", "g")).toEqual({ status: "error", error: "unconfirmed" });
  });
});
