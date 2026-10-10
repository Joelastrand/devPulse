import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSkillNeed, fetchSkillNeeds, putSkillNeed } from "./team-skills-gateway";

const VIEWER = { canManageNeeds: false, canReadCoverage: true };
const NEED = { treeId: "t-a", areaName: "Testing", areaAvailable: true, requiredLevel: 3, requiredCoverage: 2 };

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSkillNeeds", () => {
  it("calls the skill-needs route for the (URL-encoded) team with a bearer token and nothing else", async () => {
    const fetchMock = respond(200, { needs: [], catalog: [], catalogTruncated: false, needsTruncated: false, viewer: VIEWER });

    await fetchSkillNeeds("a-token", "team/1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%2F1/skill-needs", {
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it("rebuilds needs and viewer from the contract fields only, dropping anything extra", async () => {
    respond(200, {
      needs: [{ ...NEED, uid: "u1", contributorCount: 4 }],
      catalog: [{ treeId: "t-a", name: "Testing", ownerUid: "u1" }],
      catalogTruncated: false,
      needsTruncated: true,
      viewer: { ...VIEWER, isAdmin: true },
      extra: 1,
    });

    expect(await fetchSkillNeeds("t", "team-1")).toEqual({
      status: "ok",
      needs: [NEED],
      catalog: [{ treeId: "t-a", name: "Testing" }],
      catalogTruncated: false,
      needsTruncated: true,
      viewer: VIEWER,
    });
  });

  it("never carries an area name for an unavailable area", async () => {
    respond(200, {
      needs: [{ ...NEED, areaAvailable: false, areaName: "Stale name" }],
      catalog: [],
      catalogTruncated: false,
      needsTruncated: false,
      viewer: VIEWER,
    });

    const result = await fetchSkillNeeds("t", "team-1");
    expect(result).toMatchObject({ status: "ok", needs: [{ areaAvailable: false, areaName: null }] });
  });

  it.each([
    ["a level outside 2–4", { ...NEED, requiredLevel: 1 }],
    ["a coverage outside 1–20", { ...NEED, requiredCoverage: 21 }],
    ["a missing tree id", { ...NEED, treeId: "" }],
    ["a non-boolean availability", { ...NEED, areaAvailable: "yes" }],
  ])("fails safe to read_failed for %s", async (_label, need) => {
    respond(200, { needs: [need], catalog: [], catalogTruncated: false, needsTruncated: false, viewer: VIEWER });
    expect(await fetchSkillNeeds("t", "team-1")).toEqual({ status: "read_failed" });
  });

  it.each([
    ["no viewer hints", { needs: [], needsTruncated: false }],
    ["non-boolean hints", { needs: [], needsTruncated: false, viewer: { canManageNeeds: 1, canReadCoverage: true } }],
    ["no truncation flag", { needs: [], viewer: VIEWER }],
    ["a non-array needs list", { needs: {}, needsTruncated: false, viewer: VIEWER }],
  ])("fails safe to read_failed for %s", async (_label, body) => {
    respond(200, body);
    expect(await fetchSkillNeeds("t", "team-1")).toEqual({ status: "read_failed" });
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [500, "read_failed"],
  ])("maps HTTP %i to %s", async (httpStatus, expected) => {
    respond(httpStatus, { error: "x" });
    expect(await fetchSkillNeeds("t", "team-1")).toEqual({ status: expected });
  });

  it("maps a network failure and an unparsable body to read_failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchSkillNeeds("t", "team-1")).toEqual({ status: "read_failed" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => Promise.reject(new Error("bad")) }),
    );
    expect(await fetchSkillNeeds("t", "team-1")).toEqual({ status: "read_failed" });
  });
});

describe("putSkillNeed / deleteSkillNeed", () => {
  it("PUTs only the two planning fields to the per-tree route with a JSON body and bearer token", async () => {
    const fetchMock = respond(200, { need: { ...NEED, uid: "u1" } });

    const result = await putSkillNeed("a-token", "team/1", "t/a", { requiredLevel: 3, requiredCoverage: 2 });

    expect(result).toEqual({ ok: true, need: NEED });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%2F1/skill-needs/t%2Fa", {
      method: "PUT",
      headers: { Authorization: "Bearer a-token", "Content-Type": "application/json" },
      body: JSON.stringify({ requiredLevel: 3, requiredCoverage: 2 }),
    });
  });

  it.each([
    ["level 1", { requiredLevel: 1, requiredCoverage: 2 }],
    ["level 5", { requiredLevel: 5, requiredCoverage: 2 }],
    ["coverage 0", { requiredLevel: 3, requiredCoverage: 0 }],
    ["coverage 21", { requiredLevel: 3, requiredCoverage: 21 }],
    ["a fractional coverage", { requiredLevel: 3, requiredCoverage: 1.5 }],
  ])("rejects %s without sending a request", async (_label, input) => {
    const fetchMock = respond(200, { need: NEED });

    const result = await putSkillNeed("t", "team-1", "t-a", input as never);

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [403, { error: "forbidden" }, "forbidden"],
    [400, { error: "invalid_input" }, "invalid_input"],
    [400, { error: "invalid_request" }, "invalid_input"],
    [404, { error: "skill_unavailable" }, "skill_unavailable"],
    [409, { error: "team_disabled" }, "team_disabled"],
    [500, { error: "persistence_failed" }, "persistence_failed"],
    [500, { error: "something_else" }, "unknown"],
    [418, undefined, "unknown"],
  ])("maps PUT HTTP %i %j to %s", async (httpStatus, body, expected) => {
    respond(httpStatus, body);
    expect(await putSkillNeed("t", "team-1", "t-a", { requiredLevel: 2, requiredCoverage: 1 })).toEqual({
      ok: false,
      error: expected,
    });
  });

  it("treats a malformed success body as unknown rather than passing it on", async () => {
    respond(200, { need: { ...NEED, requiredLevel: 9 } });
    expect(await putSkillNeed("t", "team-1", "t-a", { requiredLevel: 2, requiredCoverage: 1 })).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it("DELETEs the per-tree route with only a bearer token, and maps outcomes", async () => {
    const fetchMock = respond(200, { ok: true });
    expect(await deleteSkillNeed("a-token", "team-1", "t-a")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/skill-needs/t-a", {
      method: "DELETE",
      headers: { Authorization: "Bearer a-token" },
    });

    respond(409, { error: "team_disabled" });
    expect(await deleteSkillNeed("t", "team-1", "t-a")).toEqual({ ok: false, error: "team_disabled" });
    respond(403, { error: "forbidden" });
    expect(await deleteSkillNeed("t", "team-1", "t-a")).toEqual({ ok: false, error: "forbidden" });
  });

  it("maps a network failure to unknown for both writes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await putSkillNeed("t", "team-1", "t-a", { requiredLevel: 2, requiredCoverage: 1 })).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(await deleteSkillNeed("t", "team-1", "t-a")).toEqual({ ok: false, error: "unknown" });
  });
});

describe("fetchSkillNeeds catalog parsing", () => {
  it.each([
    ["a non-array catalog", { needs: [], catalog: {}, catalogTruncated: false, needsTruncated: false, viewer: VIEWER }],
    ["a missing catalog flag", { needs: [], catalog: [], needsTruncated: false, viewer: VIEWER }],
    ["a malformed entry", { needs: [], catalog: [{ treeId: "t-a" }], catalogTruncated: false, needsTruncated: false, viewer: VIEWER }],
  ])("fails safe to read_failed for %s", async (_label, body) => {
    respond(200, body);
    expect(await fetchSkillNeeds("t", "team-1")).toEqual({ status: "read_failed" });
  });
});
