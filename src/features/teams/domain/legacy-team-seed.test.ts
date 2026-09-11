import { describe, expect, it } from "vitest";
import { LEGACY_TEAM_SEEDS } from "./legacy-team-seed";

describe("LEGACY_TEAM_SEEDS", () => {
  it("contains exactly the four legacy team ids as teamId, unmodified", () => {
    expect(LEGACY_TEAM_SEEDS.map((seed) => seed.teamId)).toEqual([
      "platform",
      "web-app",
      "mobile",
      "data-platform",
    ]);
  });

  it("uses the legacy teamId itself as the initial display name", () => {
    for (const seed of LEGACY_TEAM_SEEDS) {
      expect(seed.name).toBe(seed.teamId);
    }
  });
});
