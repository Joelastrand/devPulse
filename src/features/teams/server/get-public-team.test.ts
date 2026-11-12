import { toPersistedTeam } from "../domain/team-content-codec";
import { describe, expect, it, vi } from "vitest";
import { getPublicTeam, type PublicTeamReader } from "./get-public-team";

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

// Teams are read sealed, as in production: a document that carries a name is sealed under its own id.
const sealedTeam = (teamId: string, doc: unknown): unknown =>
  typeof doc === "object" && doc !== null && typeof (doc as { name?: unknown }).name === "string"
    ? toPersistedTeam(teamId, doc as Record<string, unknown> & { name: string })
    : doc;
const readerFor = (doc: unknown): PublicTeamReader => ({ getTeam: vi.fn().mockResolvedValue(sealedTeam("team-1", doc)) });

const publicDoc = {
  name: "Team Alfa",
  status: "active",
  visibility: "public",
  createdBy: "admin-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  visibilityUpdatedAt: new Date("2026-02-01T00:00:00Z"),
};

describe("getPublicTeam", () => {
  it("returns an explicit {teamId, name} projection for an active public team", async () => {
    const result = await getPublicTeam("team-1", { reader: readerFor(publicDoc) });
    expect(result).toEqual({ ok: true, team: { teamId: "team-1", name: "Team Alfa" } });
  });

  it("never exposes audit, timestamp, status or visibility fields", async () => {
    const result = await getPublicTeam("team-1", { reader: readerFor(publicDoc) });
    expect(JSON.stringify(result)).not.toMatch(/createdBy|admin-1|createdAt|visibility|status|Updated/);
  });

  it.each([
    ["a private team", { ...publicDoc, visibility: "private" }],
    ["a team with no visibility field", { name: "Team Alfa", status: "active" }],
    ["a malformed visibility", { ...publicDoc, visibility: "PUBLIC" }],
    ["a disabled team", { ...publicDoc, status: "disabled" }],
    ["a team with malformed status", { ...publicDoc, status: "bogus" }],
    ["a team with a blank name", { ...publicDoc, name: "   " }],
    ["a missing team", undefined],
  ])("answers the same not_found for %s, so private teams cannot be discovered", async (_label, doc) => {
    expect(await getPublicTeam("team-1", { reader: readerFor(doc) })).toEqual({ ok: false, error: "not_found" });
  });

  it("reports a read failure as read_failed, never as not_found", async () => {
    const reader: PublicTeamReader = { getTeam: vi.fn().mockRejectedValue(new Error("boom")) };
    expect(await getPublicTeam("team-1", { reader })).toEqual({ ok: false, error: "read_failed" });
  });

  it("rejects a path-like team id without reading", async () => {
    const reader = readerFor(publicDoc);
    expect(await getPublicTeam("a/b", { reader })).toEqual({ ok: false, error: "not_found" });
    expect(reader.getTeam).not.toHaveBeenCalled();
  });
});
