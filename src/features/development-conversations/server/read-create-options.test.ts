import { describe, expect, it, vi } from "vitest";
import { READ_WINDOW } from "../domain/conversation-constants";
import { readCreateOptions } from "./read-create-options";
import type { RawOwnMembership, TeamChoiceReader } from "./team-eligibility";

/*
 * Create-options eligibility (SPEC create-options contract, TASK-027 amendment). Synthetic fixtures only. The reader is
 * an in-memory double: `memberships` are the caller's own `teamMemberships` rows, `teams` are `teams/{id}` documents.
 */

const UID = "caller-uid-0001";
const OTHER_UID = "other-uid-0002";

function membership(teamId: string, overrides: Record<string, unknown> = {}): RawOwnMembership {
  return {
    id: `${UID}__${teamId}`,
    data: { uid: UID, teamId, createdAt: new Date("2026-01-01T00:00:00Z"), createdVia: "invitation", grantedBy: "x", ...overrides },
  };
}

/**
 * Returns the seeded rows in order, up to `limit`, without filtering by uid. Production filters in the query. The fake
 * does not, so the operation's own uid and id checks are exercised even for a row the query should not have returned.
 */
function fakeReader(seed: { memberships?: RawOwnMembership[]; teams?: Record<string, unknown> }): TeamChoiceReader {
  return {
    async listOwnMemberships(_uid, limit) {
      return (seed.memberships ?? []).slice(0, limit);
    },
    async getTeams(teamIds) {
      return teamIds.map((teamId) => seed.teams?.[teamId]);
    },
  };
}

const activeTeam = (name: string, extra: Record<string, unknown> = {}) => ({ status: "active", name, ...extra });

describe("readCreateOptions: eligibility predicate", () => {
  it("offers an active team the caller genuinely belongs to, with only teamId and name", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({ memberships: [membership("team-a")], teams: { "team-a": activeTeam("Plattform") } }),
    });

    expect(result).toEqual({ ok: true, items: [{ teamId: "team-a", name: "Plattform" }], truncated: false });
    expect(Object.keys(result.ok ? result.items[0] : {}).sort()).toEqual(["name", "teamId"]);
  });

  it("offers an app admin's genuine active membership: admin status is not needed and does not hide membership", async () => {
    // The operation takes no admin input at all. A genuine member row is enough, whatever the caller's admin status.
    const result = await readCreateOptions(UID, {
      reader: fakeReader({ memberships: [membership("team-a")], teams: { "team-a": activeTeam("Plattform") } }),
    });

    expect(result).toEqual({ ok: true, items: [{ teamId: "team-a", name: "Plattform" }], truncated: false });
  });

  it("omits a team the caller has no membership in, even when the team is active and visible to an admin", async () => {
    // Admin visibility is not a membership: no row for the caller means no option, whatever teams exist.
    const result = await readCreateOptions(UID, {
      reader: fakeReader({ memberships: [], teams: { "team-b": activeTeam("Produkt") } }),
    });

    expect(result).toEqual({ ok: true, items: [], truncated: false });
  });

  it("omits a disabled team even when the caller holds a membership in it, so create never has to reject it", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [membership("team-off"), membership("team-on")],
        teams: { "team-off": { status: "disabled", name: "Avviklet" }, "team-on": activeTeam("Aktiv") },
      }),
    });

    expect(result).toEqual({ ok: true, items: [{ teamId: "team-on", name: "Aktiv" }], truncated: false });
  });

  it("offers a lead's active membership exactly as a member's: a lead role neither adds nor removes eligibility", async () => {
    const lead = await readCreateOptions(UID, {
      reader: fakeReader({ memberships: [membership("team-a", { role: "lead" })], teams: { "team-a": activeTeam("Plattform") } }),
    });
    const member = await readCreateOptions(UID, {
      reader: fakeReader({ memberships: [membership("team-a")], teams: { "team-a": activeTeam("Plattform") } }),
    });

    expect(lead).toEqual(member);
    expect(lead).toEqual({ ok: true, items: [{ teamId: "team-a", name: "Plattform" }], truncated: false });
  });

  it("omits a team whose team document is missing", async () => {
    const result = await readCreateOptions(UID, { reader: fakeReader({ memberships: [membership("team-gone")], teams: {} }) });

    expect(result).toEqual({ ok: true, items: [], truncated: false });
  });

  it("omits a team with a blank or non-string name, and a team with an unknown status", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [membership("t-blank"), membership("t-num"), membership("t-status")],
        teams: {
          "t-blank": activeTeam("   "),
          "t-num": { status: "active", name: 7 },
          "t-status": { status: "paused", name: "Pause" },
        },
      }),
    });

    expect(result).toEqual({ ok: true, items: [], truncated: false });
  });
});

describe("readCreateOptions: malformed membership rows (fail closed)", () => {
  it("omits a row whose document id does not match its uid and teamId", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [{ id: "wrong-id", data: { uid: UID, teamId: "team-a" } }],
        teams: { "team-a": activeTeam("Plattform") },
      }),
    });

    expect(result).toEqual({ ok: true, items: [], truncated: false });
  });

  it("omits a row whose uid is another person's, so one caller never receives another caller's membership", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [{ id: `${UID}__team-a`, data: { uid: OTHER_UID, teamId: "team-a" } }],
        teams: { "team-a": activeTeam("Plattform") },
      }),
    });

    expect(result).toEqual({ ok: true, items: [], truncated: false });
  });

  it("omits a row with a teamId that is not a valid team path segment", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [{ id: `${UID}__a/b`, data: { uid: UID, teamId: "a/b" } }],
        teams: { "a/b": activeTeam("Ugyldig") },
      }),
    });

    expect(result).toEqual({ ok: true, items: [], truncated: false });
  });

  it("omits a row that is not an object, without failing the whole list", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [{ id: `${UID}__x`, data: "not-an-object" }, membership("team-a")],
        teams: { "team-a": activeTeam("Plattform") },
      }),
    });

    expect(result).toEqual({ ok: true, items: [{ teamId: "team-a", name: "Plattform" }], truncated: false });
  });
});

describe("readCreateOptions: bounded window", () => {
  it("queries the caller's uid with READ_WINDOW + 1 as the limit, and never a team scan", async () => {
    const listOwnMemberships = vi.fn(async () => []);
    const getTeams = vi.fn(async () => []);

    await readCreateOptions(UID, { reader: { listOwnMemberships, getTeams } });

    expect(listOwnMemberships).toHaveBeenCalledWith(UID, READ_WINDOW + 1);
    expect(getTeams).not.toHaveBeenCalled();
  });

  it("sets truncated when the raw window is full, and examines only the first READ_WINDOW raw rows", async () => {
    const memberships = Array.from({ length: READ_WINDOW + 1 }, (_, index) => membership(`team-${String(index).padStart(3, "0")}`));
    const teams = Object.fromEntries(memberships.map((row) => [(row.data as { teamId: string }).teamId, activeTeam("Team")]));
    const result = await readCreateOptions(UID, { reader: fakeReader({ memberships, teams }) });

    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.items).toHaveLength(READ_WINDOW);
    expect(result.ok && result.items.some((item) => item.teamId === `team-${String(READ_WINDOW).padStart(3, "0")}`)).toBe(false);
  });

  it("does not refill: malformed rows in the window consume slots, so a valid row past the window is not offered", async () => {
    const malformed = Array.from({ length: READ_WINDOW }, (_, index) => ({ id: `bad-${index}`, data: { uid: UID } }));
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [...malformed, membership("team-late")],
        teams: { "team-late": activeTeam("Sent") },
      }),
    });

    expect(result).toEqual({ ok: true, items: [], truncated: true });
  });
});

describe("readCreateOptions: ordering and deduplication", () => {
  it("orders items by name, then teamId, in code-unit order", async () => {
    const result = await readCreateOptions(UID, {
      reader: fakeReader({
        memberships: [membership("team-c"), membership("team-a"), membership("team-b")],
        teams: { "team-a": activeTeam("Data"), "team-b": activeTeam("Plattform"), "team-c": activeTeam("Data") },
      }),
    });

    expect(result).toEqual({
      ok: true,
      items: [
        { teamId: "team-a", name: "Data" },
        { teamId: "team-c", name: "Data" },
        { teamId: "team-b", name: "Plattform" },
      ],
      truncated: false,
    });
  });
});

describe("readCreateOptions: operational failures", () => {
  it("returns persistence_failed when the membership query fails, never an empty list", async () => {
    const result = await readCreateOptions(UID, {
      reader: {
        listOwnMemberships: async () => {
          throw new Error("firestore unavailable");
        },
        getTeams: async () => [],
      },
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("returns persistence_failed when the team batch read fails, never an empty list or invalid_input", async () => {
    const result = await readCreateOptions(UID, {
      reader: {
        listOwnMemberships: async () => [membership("team-a")],
        getTeams: async () => {
          throw new Error("firestore unavailable");
        },
      },
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});
