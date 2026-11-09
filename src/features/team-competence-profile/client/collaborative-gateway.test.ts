import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignTeamArea,
  fetchCollaborativeProfile,
  fetchTeamAreas,
  saveCollaborativeLevel,
  saveCollaborativeMode,
  setTeamAreaStatus,
} from "./collaborative-gateway";

function respond(status: number, body: unknown = {}) {
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

describe("fetchCollaborativeProfile", () => {
  it("returns the stored mode and integer team levels for a member", async () => {
    const fetchMock = respond(200, { mode: "collaborative", levels: [{ treeId: "t-a", level: 3 }] });

    const result = await fetchCollaborativeProfile("tok", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/profile-settings", { headers: { Authorization: "Bearer tok" } });
    expect(result).toEqual({ status: "ok", mode: "collaborative", levels: [{ treeId: "t-a", level: 3 }] });
  });

  it("fails safe to read_failed when the mode is not a known value", async () => {
    respond(200, { mode: "numeric", levels: [] });
    expect(await fetchCollaborativeProfile("tok", "team-1")).toEqual({ status: "read_failed" });
  });

  it("fails safe to read_failed when a level is outside 1–4 instead of defaulting it", async () => {
    respond(200, { mode: "collaborative", levels: [{ treeId: "t-a", level: 5 }] });
    expect(await fetchCollaborativeProfile("tok", "team-1")).toEqual({ status: "read_failed" });
  });

  it("drops unexpected keys and never returns member data", async () => {
    respond(200, { mode: "automatic", levels: [{ treeId: "t-a", level: 2, uid: "member-1" }], extra: true });
    const result = await fetchCollaborativeProfile("tok", "team-1");
    expect(result).toEqual({ status: "ok", mode: "automatic", levels: [{ treeId: "t-a", level: 2 }] });
    expect(JSON.stringify(result)).not.toContain("member-1");
  });

  it("maps a refused read to forbidden", async () => {
    respond(403, { error: "forbidden" });
    expect(await fetchCollaborativeProfile("tok", "team-1")).toEqual({ status: "forbidden" });
  });
});

describe("saveCollaborativeMode", () => {
  it("sends exactly the mode as a PUT with a bearer token", async () => {
    const fetchMock = respond(200, { mode: "collaborative" });

    const result = await saveCollaborativeMode("tok", "team-1", "collaborative");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/profile-settings", {
      method: "PUT",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "collaborative" }),
    });
    expect(result).toEqual({ status: "ok" });
  });

  it("reports a non-teamadmin refusal as forbidden and does not claim success", async () => {
    respond(403, { error: "forbidden" });
    expect(await saveCollaborativeMode("tok", "team-1", "collaborative")).toEqual({ status: "forbidden" });
  });

  it("reports a network failure as write_failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await saveCollaborativeMode("tok", "team-1", "automatic")).toEqual({ status: "write_failed" });
  });
});

describe("saveCollaborativeLevel", () => {
  it("encodes the area id and sends the level, or null to clear it", async () => {
    const fetchMock = respond(200, { treeId: "t/a", level: null });

    const result = await saveCollaborativeLevel("tok", "team-1", "t/a", null);

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/profile-settings/levels/t%2Fa", {
      method: "PUT",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ level: null }),
    });
    expect(result).toEqual({ status: "ok" });
  });

  it("maps an invalid level to invalid_input", async () => {
    respond(400, { error: "invalid_input" });
    expect(await saveCollaborativeLevel("tok", "team-1", "t-a", 4)).toEqual({ status: "invalid_input" });
  });
});

describe("team competence areas", () => {
  it("reads areas with canEdit and never returns ratings", async () => {
    respond(200, {
      areas: [{ treeId: "t-a", name: "Testing", status: "active", sortOrder: 0 }],
      canEdit: true,
      truncated: false,
    });

    const result = await fetchTeamAreas("tok", "team-1");

    expect(result).toEqual({
      status: "ok",
      areas: [{ treeId: "t-a", name: "Testing", status: "active", sortOrder: 0 }],
      canEdit: true,
      truncated: false,
    });
  });

  it("fails safe when an area has an unknown status", async () => {
    respond(200, { areas: [{ treeId: "t-a", name: null, status: "deleted", sortOrder: 0 }], canEdit: false, truncated: false });
    expect(await fetchTeamAreas("tok", "team-1")).toEqual({ status: "read_failed" });
  });

  it("assigns an area with a POST body of exactly the tree id", async () => {
    const fetchMock = respond(201, { area: {} });
    expect(await assignTeamArea("tok", "team-1", "t-a")).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/competence-areas", expect.objectContaining({ method: "POST", body: JSON.stringify({ treeId: "t-a" }) }));
  });

  it("maps an already-assigned area to conflict", async () => {
    respond(409, { error: "already_assigned" });
    expect(await assignTeamArea("tok", "team-1", "t-a")).toEqual({ status: "conflict" });
  });

  it("changes an area status with PATCH", async () => {
    const fetchMock = respond(200, { area: {} });
    expect(await setTeamAreaStatus("tok", "team-1", "t-a", "archived")).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teams/team-1/competence-areas/t-a",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "archived" }) }),
    );
  });
});
