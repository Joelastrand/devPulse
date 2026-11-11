import { describe, expect, it } from "vitest";
import { areaStatus, countStatuses } from "./area-status";

describe("areaStatus", () => {
  it("meets the need when the team level equals or exceeds the target", () => {
    expect(areaStatus(3, 3)).toBe("meets");
    expect(areaStatus(4, 3)).toBe("meets");
  });

  it("is near the need when the team is exactly one level below the target", () => {
    expect(areaStatus(2, 3)).toBe("near");
  });

  it("is under development when the team is two or more levels below the target", () => {
    expect(areaStatus(1, 3)).toBe("under");
    expect(areaStatus(1, 4)).toBe("under");
  });

  it("is unrated when either the level or the target is missing, never zero", () => {
    expect(areaStatus(null, 3)).toBe("unrated");
    expect(areaStatus(2, null)).toBe("unrated");
    expect(areaStatus(null, null)).toBe("unrated");
  });
});

describe("countStatuses", () => {
  it("counts every status, including zero counts", () => {
    expect(countStatuses(["meets", "meets", "under", "unrated"])).toEqual({ meets: 2, near: 0, under: 1, unrated: 1 });
  });
});
