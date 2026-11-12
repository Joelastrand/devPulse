import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { openUserProfileDocument, toPersistedUserProfile } from "./user-profile-content-codec";

/** Storage boundary of a profile: the display name is sealed; the document identity and timestamps stay plaintext. */
const UID = "uid-storage-1";
const OTHER_UID = "uid-storage-2";
const record = {
  displayName: "Synthetic Person",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("user profile storage boundary", () => {
  it("persists no plaintext display name, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedUserProfile(UID, record);
    expectStorageBoundary({
      persisted,
      secrets: ["Synthetic Person"],
      envelopeField: "content",
      open: (p) => openUserProfileDocument(UID, p),
      openAsOtherRecord: (p) => openUserProfileDocument(OTHER_UID, p),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openUserProfileDocument(UID, p);
      },
    });
  });

  it("restores the display name for the owning profile and keeps the timestamps", () => {
    expect(openUserProfileDocument(UID, toPersistedUserProfile(UID, record))).toMatchObject({
      displayName: "Synthetic Person",
      createdAt: record.createdAt,
    });
  });

  it("refuses a document that still carries a plaintext display name", () => {
    expect(openUserProfileDocument(UID, { ...toPersistedUserProfile(UID, record), displayName: "Synthetic Person" })).toBeNull();
  });
});
