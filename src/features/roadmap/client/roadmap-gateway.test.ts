import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoadmapItem,
  fetchAssignableMembers,
  fetchRoadmapItems,
  updateRoadmapItem,
} from "./roadmap-gateway";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEM = {
  treeId: "tree-1",
  areaName: "Containers",
  targetNodeId: "node-2",
  targetLabel: "Production",
  targetAvailable: true,
  tracking: { state: "tracked", currentNodeId: "node-1" },
  priority: "high",
  status: "active",
  startDate: "2026-09-01",
  targetDate: null,
  owner: { state: "current", memberRef: "ref-1", displayName: "Alex", ordinal: 2, isSelf: false },
  targetReached: false,
  overdue: false,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  completedAt: null,
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchRoadmapItems", () => {
  it("calls the roadmap GET endpoint with the bearer token and no archived flag by default", async () => {
    const fetchMock = stubFetch(200, { items: [], canEdit: true, truncated: false });

    const result = await fetchRoadmapItems("tok", "team/1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%2F1/roadmap-items", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(result).toEqual({ status: "ok", items: [], canEdit: true, truncated: false });
  });

  it("requests archived plans only when asked", async () => {
    const fetchMock = stubFetch(200, { items: [], canEdit: false, truncated: false });

    await fetchRoadmapItems("tok", "team-1", { includeArchived: true });

    expect(fetchMock.mock.calls[0]).toEqual(["/api/teams/team-1/roadmap-items?archived=true", expect.anything()]);
  });

  it("preserves the owner union, an explicit targetReached boolean, and unmatched plans", async () => {
    stubFetch(200, {
      canEdit: false,
      truncated: false,
      items: [
        ITEM,
        { ...ITEM, treeId: "tree-2", owner: null, targetReached: undefined, tracking: { state: "not_tracked" } },
        { ...ITEM, treeId: "tree-3", owner: { state: "unavailable" }, targetReached: true },
      ],
    });

    const result = await fetchRoadmapItems("tok", "team-1");

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.items.map((item) => item.treeId)).toEqual(["tree-1", "tree-2", "tree-3"]);
    expect(result.items[0].owner).toEqual({ state: "current", memberRef: "ref-1", displayName: "Alex", ordinal: 2, isSelf: false });
    expect(result.items[0].targetReached).toBe(false);
    expect("targetReached" in result.items[1]).toBe(false);
    expect(result.items[1].owner).toBeNull();
    expect(result.items[2].owner).toEqual({ state: "unavailable" });
    expect(result.items[2].targetReached).toBe(true);
  });

  it("drops unexpected fields instead of passing them on", async () => {
    stubFetch(200, { items: [{ ...ITEM, uid: "u1", createdBy: "u2" }], canEdit: false, truncated: false });

    const result = await fetchRoadmapItems("tok", "team-1");

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.items[0]).not.toHaveProperty("uid");
    expect(result.items[0]).not.toHaveProperty("createdBy");
  });

  it("preserves a valid completedAt and the null legacy case unchanged", async () => {
    stubFetch(200, {
      canEdit: false,
      truncated: false,
      items: [
        { ...ITEM, status: "completed", completedAt: "2026-03-04T10:00:00.000Z" },
        { ...ITEM, treeId: "tree-2", status: "completed", completedAt: null },
      ],
    });

    const result = await fetchRoadmapItems("tok", "team-1");

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.items[0].completedAt).toBe("2026-03-04T10:00:00.000Z");
    expect(result.items[1].completedAt).toBeNull();
    expect(result.items[1].updatedAt).toBe(ITEM.updatedAt);
  });

  it.each([[42], [undefined], [{}]])("fails safe to read_failed on a malformed completedAt (%j)", async (bad) => {
    stubFetch(200, { items: [{ ...ITEM, completedAt: bad }], canEdit: false, truncated: false });
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "read_failed" });
  });

  it("fails safe to read_failed on a malformed item or body", async () => {
    stubFetch(200, { items: [{ ...ITEM, priority: "urgent" }], canEdit: false, truncated: false });
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "read_failed" });

    stubFetch(200, { nope: true });
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "read_failed" });
  });

  it("maps HTTP failures and network errors", async () => {
    stubFetch(401, { error: "unauthenticated" });
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "unauthenticated" });
    stubFetch(403, { error: "forbidden" });
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "forbidden" });
    stubFetch(500, { error: "read_failed" });
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "read_failed" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchRoadmapItems("tok", "team-1")).toEqual({ status: "read_failed" });
  });
});

describe("roadmap mutations and assignable members", () => {
  it("POSTs the given body with bearer and JSON headers; success drops the response item", async () => {
    const fetchMock = stubFetch(201, { item: ITEM });
    const body = { treeId: "tree-1", targetNodeId: "n2", priority: "medium" };

    const result = await createRoadmapItem("tok", "team/1", body);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%2F1/roadmap-items", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("PATCHes the tree path with the given minimal body", async () => {
    const fetchMock = stubFetch(200, { item: ITEM });

    expect(await updateRoadmapItem("tok", "team-1", "tree/1", { archived: true })).toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/roadmap-items/tree%2F1", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
  });

  it.each([
    ["plan_archived", 409],
    ["already_planned", 409],
    ["invalid_owner", 400],
    ["not_tracked", 404],
    ["target_not_ahead", 400],
    ["archived", 409],
    ["persistence_failed", 500],
  ])("passes through the %s error code", async (error, status) => {
    stubFetch(status, { error });
    expect(await createRoadmapItem("tok", "t", {})).toEqual({ ok: false, error });
  });

  it("maps an unknown or unparseable failure to request_failed and keeps 401/403", async () => {
    stubFetch(500, { error: "weird" });
    expect(await updateRoadmapItem("tok", "t", "x", {})).toEqual({ ok: false, error: "request_failed" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    expect(await updateRoadmapItem("tok", "t", "x", {})).toEqual({ ok: false, error: "request_failed" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await createRoadmapItem("tok", "t", {})).toEqual({ ok: false, error: "request_failed" });
    stubFetch(403, {});
    expect(await createRoadmapItem("tok", "t", {})).toEqual({ ok: false, error: "forbidden" });
  });

  it("parses assignable members field by field and drops extras", async () => {
    stubFetch(200, {
      members: [{ memberRef: "r1", displayName: null, ordinal: 2, isSelf: true, uid: "leak", email: "x@y" }],
      unavailableCount: 1,
      truncated: false,
    });
    const result = await fetchAssignableMembers("tok", "team-1");
    expect(result).toEqual({
      status: "ok",
      members: [{ memberRef: "r1", displayName: null, ordinal: 2, isSelf: true }],
      unavailableCount: 1,
      truncated: false,
    });
  });

  it("fails safe on malformed assignable members and maps statuses", async () => {
    stubFetch(200, { members: [{ memberRef: "" }], unavailableCount: 0, truncated: false });
    expect(await fetchAssignableMembers("tok", "t")).toEqual({ status: "read_failed" });
    stubFetch(403, { status: "forbidden" });
    expect(await fetchAssignableMembers("tok", "t")).toEqual({ status: "forbidden" });
  });
});
