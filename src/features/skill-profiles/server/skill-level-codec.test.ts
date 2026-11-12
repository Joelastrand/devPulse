import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptRecord } from "../../../lib/encryption/record-envelope";
import { openSkillLevels, openSkillProfileDocument, sealSkillLevel } from "./skill-level-codec";

describe("skill level codec (personal skill levels)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("seals a level as a v2 envelope that does not contain the raw level", () => {
    const sealed = sealSkillLevel("uid-1", "tree-a", 3);
    expect(sealed.keyVersion).toBe("v2");
    expect(JSON.stringify(sealed)).not.toContain("level");
    expect(Buffer.from(sealed.ciphertext, "base64").toString("utf8")).not.toBe('{"level":3}');
  });

  it("round-trips every valid level for its own person and skill", () => {
    const levels = { "tree-a": sealSkillLevel("uid-1", "tree-a", 1), "tree-b": sealSkillLevel("uid-1", "tree-b", 4) };
    expect(openSkillLevels("uid-1", levels)).toEqual({ "tree-a": 1, "tree-b": 4 });
  });

  it("refuses a ciphertext moved to another person's profile (substitution across owners)", () => {
    const levels = { "tree-a": sealSkillLevel("uid-1", "tree-a", 2) };
    expect(openSkillLevels("uid-2", levels)).toEqual({});
  });

  it("refuses a ciphertext moved to another skill of the same profile", () => {
    const levels = { "tree-b": sealSkillLevel("uid-1", "tree-a", 2) };
    expect(openSkillLevels("uid-1", levels)).toEqual({});
  });

  it("drops a tampered envelope without affecting the other levels", () => {
    const good = sealSkillLevel("uid-1", "tree-a", 2);
    const bad = { ...sealSkillLevel("uid-1", "tree-b", 3) };
    const flipped = Buffer.from(bad.ciphertext, "base64");
    flipped[0] ^= 0xff;
    bad.ciphertext = flipped.toString("base64");
    expect(openSkillLevels("uid-1", { "tree-a": good, "tree-b": bad })).toEqual({ "tree-a": 2 });
  });

  it("drops legacy plaintext numeric levels instead of reading them (no plaintext fallback)", () => {
    expect(openSkillLevels("uid-1", { "tree-a": 3, "tree-b": "4" })).toEqual({});
  });

  it("drops an envelope whose decrypted payload is not a valid level", () => {
    const notALevel = encryptRecord(JSON.stringify({ level: 9 }), "skill-profile:uid-1:tree-a");
    expect(openSkillLevels("uid-1", { "tree-a": notALevel })).toEqual({});
  });

  it("fails closed when the encryption key is missing (no silent empty profile)", () => {
    const levels = { "tree-a": sealSkillLevel("uid-1", "tree-a", 2) };
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openSkillLevels("uid-1", levels)).toThrow();
  });

  it("refuses to seal without a key", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => sealSkillLevel("uid-1", "tree-a", 1)).toThrow();
  });

  it("leaves a non-object levels container unchanged so the domain marks it unreadable", () => {
    const raw = { levels: "not-a-map", updatedAt: new Date(0) };
    expect(openSkillProfileDocument("uid-1", raw)).toBe(raw);
  });

  it("opens the levels of a profile document and keeps its other fields", () => {
    const updatedAt = new Date(0);
    const opened = openSkillProfileDocument("uid-1", { levels: { "tree-a": sealSkillLevel("uid-1", "tree-a", 1) }, updatedAt });
    expect(opened).toEqual({ levels: { "tree-a": 1 }, updatedAt });
  });

  it("returns undefined for an absent document", () => {
    expect(openSkillProfileDocument("uid-1", undefined)).toBeUndefined();
  });
});
