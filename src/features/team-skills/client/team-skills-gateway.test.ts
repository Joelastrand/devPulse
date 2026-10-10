import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSkillNeeds } from "./team-skills-gateway";

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
    const fetchMock = respond(200, { needs: [], needsTruncated: false, viewer: VIEWER });

    await fetchSkillNeeds("a-token", "team/1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%2F1/skill-needs", {
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it("rebuilds needs and viewer from the contract fields only, dropping anything extra", async () => {
    respond(200, {
      needs: [{ ...NEED, uid: "u1", contributorCount: 4 }],
      catalog: [{ treeId: "t-a", name: "Testing" }],
      needsTruncated: true,
      viewer: { ...VIEWER, isAdmin: true },
      extra: 1,
    });

    expect(await fetchSkillNeeds("t", "team-1")).toEqual({
      status: "ok",
      needs: [NEED],
      needsTruncated: true,
      viewer: VIEWER,
    });
  });

  it("never carries an area name for an unavailable area", async () => {
    respond(200, {
      needs: [{ ...NEED, areaAvailable: false, areaName: "Stale name" }],
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
    respond(200, { needs: [need], needsTruncated: false, viewer: VIEWER });
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
