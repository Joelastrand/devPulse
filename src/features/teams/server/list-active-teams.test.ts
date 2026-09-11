import { describe, expect, it, vi } from "vitest";
import type { ActiveTeamsCollection } from "./list-active-teams";
import { listActiveTeams } from "./list-active-teams";

function fakeCollection(
  docs: Array<{ id: string; name: unknown; status: unknown }>,
): ActiveTeamsCollection {
  return { listActive: vi.fn().mockResolvedValue(docs) };
}

describe("listActiveTeams", () => {
  it("returns every active team's id and name only, unauthenticated", async () => {
    const collection = fakeCollection([
      { id: "team-1", name: "Platform", status: "active" },
      { id: "team-2", name: "Web App", status: "active" },
    ]);

    const result = await listActiveTeams({ collection });

    expect(result).toEqual({
      ok: true,
      teams: [
        { teamId: "team-1", name: "Platform" },
        { teamId: "team-2", name: "Web App" },
      ],
    });
  });

  it("excludes a disabled team", async () => {
    const collection = fakeCollection([
      { id: "team-1", name: "Platform", status: "active" },
      { id: "team-2", name: "Retired", status: "disabled" },
    ]);

    const result = await listActiveTeams({ collection });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Platform" }],
    });
  });

  it("excludes a malformed team document (missing/invalid status or name) rather than failing the whole read", async () => {
    const collection = fakeCollection([
      { id: "team-1", name: "Platform", status: "active" },
      { id: "team-2", name: "No Status", status: undefined },
      { id: "team-3", name: "Bad Status", status: "archived" },
      { id: "team-4", name: 42, status: "active" },
      { id: "team-5", name: "", status: "active" },
      { id: "team-6", name: "   ", status: "active" },
    ]);

    const result = await listActiveTeams({ collection });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Platform" }],
    });
  });

  it("exposes no field beyond teamId and name", async () => {
    const collection = fakeCollection([
      { id: "team-1", name: "Platform", status: "active" },
    ]);

    const result = await listActiveTeams({ collection });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.teams[0]).sort()).toEqual(["name", "teamId"]);
    }
  });

  it("fails closed, not with a partial list, when the Firestore read fails", async () => {
    const collection: ActiveTeamsCollection = {
      listActive: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listActiveTeams({ collection });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never logs on a read failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const collection: ActiveTeamsCollection = {
      listActive: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await listActiveTeams({ collection });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
