import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSkillContribution,
  optInSkillContribution,
  withdrawSkillContribution,
} from "./team-skills-gateway";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSkillContribution", () => {
  it("GETs the own-participation route and keeps only the two booleans", async () => {
    const fetchMock = respond(200, { contributing: true, canOptIn: false, consentedAt: "x", uid: "u1" });

    const result = await fetchSkillContribution("a-token", "team/1");

    expect(result).toEqual({ status: "ok", contributing: true, canOptIn: false });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team%2F1/skill-contribution", {
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [500, "read_failed"],
  ])("maps HTTP %s to %s", async (status, expected) => {
    respond(status, { error: "x" });
    expect(await fetchSkillContribution("t", "team-1")).toEqual({ status: expected });
  });

  it("fails safe on a malformed body or a network error", async () => {
    respond(200, { contributing: "yes", canOptIn: true });
    expect(await fetchSkillContribution("t", "team-1")).toEqual({ status: "read_failed" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await fetchSkillContribution("t", "team-1")).toEqual({ status: "read_failed" });
  });
});

describe("optInSkillContribution / withdrawSkillContribution", () => {
  it("PUTs exactly the given notice version and nothing else", async () => {
    const fetchMock = respond(200, { contributing: true });

    expect(await optInSkillContribution("a-token", "team-1", 7)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/skill-contribution", {
      method: "PUT",
      headers: { Authorization: "Bearer a-token", "Content-Type": "application/json" },
      body: JSON.stringify({ noticeVersion: 7 }),
    });
  });

  it("DELETEs without a body", async () => {
    const fetchMock = respond(200, { contributing: false });

    expect(await withdrawSkillContribution("a-token", "team-1")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/skill-contribution", {
      method: "DELETE",
      headers: { Authorization: "Bearer a-token" },
    });
  });

  it.each([
    [401, {}, "unauthenticated"],
    [403, {}, "forbidden"],
    [409, { error: "notice_outdated" }, "notice_outdated"],
    [409, { error: "team_disabled" }, "team_disabled"],
    [500, { error: "persistence_failed" }, "persistence_failed"],
    [400, { error: "invalid_input" }, "unknown"],
    [409, { error: "something_else" }, "unknown"],
  ])("maps %s %j to the closed error %s", async (status, body, expected) => {
    respond(status, body);
    expect(await optInSkillContribution("t", "team-1", 1)).toEqual({ ok: false, error: expected });
    expect(await withdrawSkillContribution("t", "team-1")).toEqual({ ok: false, error: expected });
  });

  it("reports a network error as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await optInSkillContribution("t", "team-1", 1)).toEqual({ ok: false, error: "unknown" });
  });
});
