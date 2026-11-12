import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { openTeamDocument, toPersistedTeam } from "./team-content-codec";

/** Storage boundary of a team: the name is sealed; status, visibility, creator and timestamps stay plaintext. */
const TEAM = "team-storage-1";
const OTHER_TEAM = "team-storage-2";
const record = {
  name: "Synthetic team name",
  status: "active",
  visibility: "public",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "admin-1",
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("team storage boundary", () => {
  it("persists no plaintext team name, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedTeam(TEAM, record);
    expectStorageBoundary({
      persisted,
      secrets: ["Synthetic team name"],
      envelopeField: "content",
      open: (p) => openTeamDocument(TEAM, p),
      openAsOtherRecord: (p) => openTeamDocument(OTHER_TEAM, p),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openTeamDocument(TEAM, p);
      },
    });
  });

  it("keeps status, visibility, creator and timestamps plaintext for listing and authorization", () => {
    const persisted = toPersistedTeam(TEAM, record);
    expect(persisted).toMatchObject({ status: "active", visibility: "public", createdBy: "admin-1" });
    expect(persisted).not.toHaveProperty("name");
  });

  it("restores the team name for the owning team", () => {
    expect(openTeamDocument(TEAM, toPersistedTeam(TEAM, record))).toMatchObject({ name: "Synthetic team name", status: "active" });
  });

  it("refuses a document that still carries a plaintext name", () => {
    expect(openTeamDocument(TEAM, { ...toPersistedTeam(TEAM, record), name: "Synthetic team name" })).toBeNull();
  });
});
