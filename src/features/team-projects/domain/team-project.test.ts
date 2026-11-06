import { describe, expect, it } from "vitest";
import {
  isProjectInTeam,
  isSameTeamProductLink,
  parseStoredTeamProject,
  PROJECT_TITLE_MAX_LENGTH,
  resolveEffectiveProjectStatus,
  resolveEffectiveProjectStatusAt,
  validateProjectFields,
} from "./team-project";

const valid = {
  title: "  Ny betalingsløsning  ",
  startDate: "2026-06-01",
  endDate: "2026-09-30",
  lifecycleStatus: "planned",
  priority: "high",
};

describe("validateProjectFields", () => {
  it("accepts a complete project and trims the title", () => {
    const result = validateProjectFields(valid);
    expect(result).toEqual({
      ok: true,
      value: { title: "Ny betalingsløsning", startDate: "2026-06-01", endDate: "2026-09-30", lifecycleStatus: "planned", priority: "high" },
    });
  });

  it("keeps an optional product link only when it is a non-empty string", () => {
    expect(validateProjectFields({ ...valid, productId: "prod-1" })).toMatchObject({ ok: true, value: { productId: "prod-1" } });
    const withoutProduct = validateProjectFields({ ...valid, productId: "" });
    expect(withoutProduct.ok && "productId" in withoutProduct.value).toBe(false);
  });

  it("reports every issue at once", () => {
    const result = validateProjectFields({ title: "   ", startDate: undefined, endDate: "2026-02-30", lifecycleStatus: "active", priority: "urgent" });
    expect(result).toEqual({
      ok: false,
      issues: ["title_required", "start_date_invalid", "end_date_invalid", "lifecycle_status_invalid", "priority_invalid"],
    });
  });

  it("rejects a missing start or end date rather than defaulting it", () => {
    expect(validateProjectFields({ ...valid, startDate: undefined })).toEqual({ ok: false, issues: ["start_date_invalid"] });
    expect(validateProjectFields({ ...valid, endDate: "" })).toEqual({ ok: false, issues: ["end_date_invalid"] });
  });

  it("rejects end before start and accepts equal dates", () => {
    expect(validateProjectFields({ ...valid, startDate: "2026-09-01", endDate: "2026-08-31" })).toEqual({ ok: false, issues: ["end_before_start"] });
    expect(validateProjectFields({ ...valid, startDate: "2026-09-01", endDate: "2026-09-01" }).ok).toBe(true);
  });

  it("checks the year boundary for ordering", () => {
    expect(validateProjectFields({ ...valid, startDate: "2026-12-31", endDate: "2027-01-01" }).ok).toBe(true);
    expect(validateProjectFields({ ...valid, startDate: "2027-01-01", endDate: "2026-12-31" })).toEqual({ ok: false, issues: ["end_before_start"] });
  });

  it("enforces the title length bound and rejects non-object input", () => {
    expect(validateProjectFields({ ...valid, title: "a".repeat(PROJECT_TITLE_MAX_LENGTH + 1) })).toEqual({ ok: false, issues: ["title_too_long"] });
    expect(validateProjectFields({ ...valid, title: "a".repeat(PROJECT_TITLE_MAX_LENGTH) }).ok).toBe(true);
    expect(validateProjectFields(null).ok).toBe(false);
    expect(validateProjectFields("x").ok).toBe(false);
  });

  it("does not accept the derived status as a stored lifecycle value", () => {
    expect(validateProjectFields({ ...valid, lifecycleStatus: "active" })).toEqual({ ok: false, issues: ["lifecycle_status_invalid"] });
  });
});

describe("resolveEffectiveProjectStatus", () => {
  const planned = { lifecycleStatus: "planned" as const, startDate: "2026-06-01" };

  it("shows Pågår when the start date is today or earlier", () => {
    expect(resolveEffectiveProjectStatus(planned, "2026-06-02")).toBe("active");
    expect(resolveEffectiveProjectStatus(planned, "2026-06-01")).toBe("active");
  });

  it("stays planned before the start date", () => {
    expect(resolveEffectiveProjectStatus(planned, "2026-05-31")).toBe("planned");
  });

  it("keeps completed projects completed regardless of dates", () => {
    const completed = { lifecycleStatus: "completed" as const, startDate: "2027-01-01" };
    expect(resolveEffectiveProjectStatus(completed, "2026-06-01")).toBe("completed");
    expect(resolveEffectiveProjectStatus({ ...completed, startDate: "2020-01-01" }, "2026-06-01")).toBe("completed");
  });

  it("does not treat a passed end date as completion", () => {
    const pastEnd = { lifecycleStatus: "planned" as const, startDate: "2020-01-01" };
    expect(resolveEffectiveProjectStatus(pastEnd, "2026-12-31")).toBe("active");
  });

  it("uses the Oslo calendar day for the injected instant at the midnight boundary", () => {
    // 2026-06-01T22:30Z is already 2026-06-02 00:30 in Europe/Oslo (UTC+2 in summer).
    expect(resolveEffectiveProjectStatusAt({ lifecycleStatus: "planned", startDate: "2026-06-02" }, new Date("2026-06-01T22:30:00Z"))).toBe("active");
    // 2026-06-01T21:30Z is still 2026-06-01 23:30 in Oslo.
    expect(resolveEffectiveProjectStatusAt({ lifecycleStatus: "planned", startDate: "2026-06-02" }, new Date("2026-06-01T21:30:00Z"))).toBe("planned");
  });
});

describe("team ownership", () => {
  it("only matches the same team", () => {
    expect(isProjectInTeam({ teamId: "team-a" }, "team-a")).toBe(true);
    expect(isProjectInTeam({ teamId: "team-a" }, "team-b")).toBe(false);
    expect(isProjectInTeam({ teamId: "team-a" }, "")).toBe(false);
  });

  it("accepts a product link only when the product belongs to the same team", () => {
    expect(isSameTeamProductLink("team-a", "team-a")).toBe(true);
    expect(isSameTeamProductLink("team-b", "team-a")).toBe(false);
    expect(isSameTeamProductLink(undefined, "team-a")).toBe(false);
    expect(isSameTeamProductLink(null, "team-a")).toBe(false);
    expect(isSameTeamProductLink("", "")).toBe(false);
  });
});

describe("parseStoredTeamProject", () => {
  const stored = {
    teamId: "team-a",
    title: "Ny betalingsløsning",
    startDate: "2026-06-01",
    endDate: "2026-09-30",
    lifecycleStatus: "planned",
    priority: "high",
    archived: false,
  };

  it("parses a valid stored record for its own team", () => {
    expect(parseStoredTeamProject(stored, "p1", "team-a")).toEqual({ projectId: "p1", teamId: "team-a", ...valid, title: "Ny betalingsløsning", archived: false });
  });

  it("rejects a record that belongs to another team", () => {
    expect(parseStoredTeamProject(stored, "p1", "team-b")).toBeNull();
  });

  it("rejects a non-null productId because no product entity exists", () => {
    expect(parseStoredTeamProject({ ...stored, productId: "prod-1" }, "p1", "team-a")).toBeNull();
    expect(parseStoredTeamProject({ ...stored, productId: "" }, "p1", "team-a")).toBeNull();
  });

  it("accepts a stored record with productId set to null", () => {
    expect(parseStoredTeamProject({ ...stored, productId: null }, "p1", "team-a")).not.toBeNull();
  });

  it("rejects an invalid stored date order instead of coercing it", () => {
    expect(parseStoredTeamProject({ ...stored, endDate: "2026-05-01" }, "p1", "team-a")).toBeNull();
  });
});
