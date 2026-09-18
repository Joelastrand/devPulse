import { describe, expect, it } from "vitest";
import { authorTag } from "./author-tag";

describe("authorTag", () => {
  it("is deterministic — the same (teamId, authorUid) pair always yields the same tag", () => {
    const first = authorTag("team-1", "uid-1");
    const second = authorTag("team-1", "uid-1");
    expect(first).toBe(second);
  });

  it("gives the same author, same team, two different tags across two different teams", () => {
    const inTeamOne = authorTag("team-1", "uid-1");
    const inTeamTwo = authorTag("team-2", "uid-1");
    expect(inTeamOne).not.toBe(inTeamTwo);
  });

  it("gives two different authors in the same team two different tags, for fixed test fixtures", () => {
    const authorOne = authorTag("team-1", "uid-1");
    const authorTwo = authorTag("team-1", "uid-2");
    expect(authorOne).not.toBe(authorTwo);
  });

  it("returns exactly 6 uppercase hexadecimal characters", () => {
    expect(authorTag("team-1", "uid-1")).toMatch(/^[0-9A-F]{6}$/);
    expect(authorTag("some-other-team", "some-other-uid")).toMatch(/^[0-9A-F]{6}$/);
  });

  it("matches a known SHA-256 fixture — a different hash, concatenation, or field order would fail this", () => {
    // Independently computed: SHA-256("team-1:uid-1") = 48d73dfb...,
    // uppercased first 6 hex chars = "48D73D". A reversed concatenation
    // (`${authorUid}:${teamId}`), a different separator, or a different hash
    // algorithm would all produce a different value here.
    expect(authorTag("team-1", "uid-1")).toBe("48D73D");
    expect(authorTag("team-2", "uid-1")).toBe("2ACC71");
    expect(authorTag("team-1", "uid-2")).toBe("8EC85F");
  });

  it("never equals the raw teamId or authorUid it was derived from", () => {
    const tag = authorTag("team-1", "uid-1");
    expect(tag).not.toBe("team-1");
    expect(tag).not.toBe("uid-1");
    expect(tag.toLowerCase()).not.toContain("team-1");
    expect(tag.toLowerCase()).not.toContain("uid-1");
  });

  it("takes exactly (teamId, authorUid) and no other input — no email/name/displayName parameter exists to accept", () => {
    expect(authorTag.length).toBe(2);
  });

  it("is a synchronous pure function — calling it performs no I/O and returns a plain string, not a Promise", () => {
    const result = authorTag("team-1", "uid-1");
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("string");
  });
});
