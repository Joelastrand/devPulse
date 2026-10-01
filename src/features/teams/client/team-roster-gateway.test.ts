import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTeamRoster } from "./team-roster-gateway";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ status, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTeamRoster", () => {
  it("GETs the member-facing roster endpoint for the team with only the Authorization header", async () => {
    const fetchMock = respond(200, { status: "ok", members: [], truncated: false });

    await fetchTeamRoster("an-id-token", "team 1/x");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%201%2Fx/members", {
      headers: { Authorization: "Bearer an-id-token" },
    });
  });

  it("parses a valid roster: names, null names, lead and self flags", async () => {
    respond(200, {
      status: "ok",
      truncated: false,
      members: [
        { displayName: "Anna Berg", isLead: true, isSelf: false },
        { displayName: null, isLead: false, isSelf: true },
        { displayName: "Bo", isLead: true, isSelf: true },
      ],
    });

    expect(await fetchTeamRoster("t", "team-1")).toEqual({
      status: "ok",
      truncated: false,
      members: [
        { displayName: "Anna Berg", isLead: true, isSelf: false },
        { displayName: null, isLead: false, isSelf: true },
        { displayName: "Bo", isLead: true, isSelf: true },
      ],
    });
  });

  it("reports truncation and accepts an empty roster", async () => {
    respond(200, { status: "ok", members: [], truncated: true });

    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "ok", members: [], truncated: true });
  });

  it("keeps only the three public fields: anything else in an entry is dropped, never passed on", async () => {
    respond(200, {
      status: "ok",
      truncated: false,
      members: [{ displayName: "Anna", isLead: false, isSelf: false, uid: "secret-uid", email: "a@example.com", teamId: "team-1" }],
    });

    const result = await fetchTeamRoster("t", "team-1");

    expect(result.status === "ok" && Object.keys(result.members[0]).sort()).toEqual(["displayName", "isLead", "isSelf"]);
    expect(JSON.stringify(result)).not.toContain("secret-uid");
    expect(JSON.stringify(result)).not.toContain("a@example.com");
  });

  it.each([
    ["a missing members array", { status: "ok", truncated: false }],
    ["a missing truncated flag", { status: "ok", members: [] }],
    ["a non-boolean truncated flag", { status: "ok", members: [], truncated: "no" }],
    ["a non-object body", "nope"],
    ["a null body", null],
    ["an unknown status", { status: "weird", members: [], truncated: false }],
  ])("fails safe to read_failed for %s", async (_label, body) => {
    respond(200, body);

    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "read_failed" });
  });

  it.each([
    ["a non-boolean isLead", { displayName: "A", isLead: "yes", isSelf: false }],
    ["a non-boolean isSelf", { displayName: "A", isLead: false, isSelf: 1 }],
    ["a numeric displayName", { displayName: 5, isLead: false, isSelf: false }],
    ["an empty displayName", { displayName: "", isLead: false, isSelf: false }],
    ["a missing displayName", { isLead: false, isSelf: false }],
    ["a non-object entry", "Anna"],
    ["a null entry", null],
  ])("rejects the whole roster when one entry is malformed (%s) rather than rendering partial data", async (_label, entry) => {
    respond(200, {
      status: "ok",
      truncated: false,
      members: [{ displayName: "Fine", isLead: false, isSelf: false }, entry],
    });

    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "read_failed" });
  });

  it("maps unauthenticated and forbidden from the body or the HTTP status", async () => {
    respond(401, { status: "unauthenticated" });
    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "unauthenticated" });

    respond(403, { status: "forbidden" });
    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "forbidden" });

    respond(403, undefined);
    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "forbidden" });
  });

  it("maps a 500, an unparseable body and a thrown fetch to read_failed", async () => {
    respond(500, { status: "read_failed" });
    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "read_failed" });

    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => { throw new Error("bad json"); } })));
    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "read_failed" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await fetchTeamRoster("t", "team-1")).toEqual({ status: "read_failed" });
  });
});
