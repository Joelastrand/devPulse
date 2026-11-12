import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { openRoleDocument, toPersistedRole } from "./role-content-codec";

/** Storage boundary of a role: name and description are sealed; lifecycle and audit fields stay plaintext. */
const ROLE = "role-storage-1";
const OTHER_ROLE = "role-storage-2";
const data = {
  name: "Synthetic role title",
  description: "Synthetic role description",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "admin-1",
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

function refusedWithoutName(opened: Record<string, unknown>): Record<string, unknown> | null {
  return opened.name === undefined ? null : opened;
}

describe("role storage boundary", () => {
  it("persists no plaintext title or description, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedRole(ROLE, data);
    expectStorageBoundary({
      persisted,
      secrets: ["Synthetic role title", "Synthetic role description"],
      envelopeField: "content",
      // A role without its name is what the validator refuses; that is the refusal this boundary checks.
      open: (p) => refusedWithoutName(openRoleDocument(ROLE, p)),
      openAsOtherRecord: (p) => refusedWithoutName(openRoleDocument(OTHER_ROLE, p)),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openRoleDocument(ROLE, p);
      },
    });
  });

  it("keeps the lifecycle and audit fields plaintext", () => {
    const persisted = toPersistedRole(ROLE, data);
    expect(persisted).toMatchObject({ createdBy: "admin-1" });
    expect(persisted).not.toHaveProperty("name");
    expect(persisted).not.toHaveProperty("description");
  });

  it("restores the title and description for the owning role", () => {
    expect(openRoleDocument(ROLE, toPersistedRole(ROLE, data))).toMatchObject({
      name: "Synthetic role title",
      description: "Synthetic role description",
    });
  });

  it("returns metadata without a name when the envelope is missing, so the validator refuses the role", () => {
    const opened = openRoleDocument(ROLE, { createdBy: "admin-1", createdAt: data.createdAt });
    expect(opened).not.toHaveProperty("name");
  });
});
