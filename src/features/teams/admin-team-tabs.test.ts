import { describe, expect, it } from "vitest";
import { adminTeamTabHref, parseAdminTeamTab, tabForLegacyHash } from "./admin-team-tabs";

describe("parseAdminTeamTab", () => {
  it("returns the default tab when no value is given", () => {
    expect(parseAdminTeamTab([])).toBe("oversikt");
  });

  it("accepts each allowlisted URL value", () => {
    expect(parseAdminTeamTab(["undersokelser"])).toBe("undersokelser");
    expect(parseAdminTeamTab(["kompetanse"])).toBe("kompetanse");
  });

  it("falls back to the default for unknown, empty or differently cased values", () => {
    expect(parseAdminTeamTab(["unknown"])).toBe("oversikt");
    expect(parseAdminTeamTab([""])).toBe("oversikt");
    expect(parseAdminTeamTab(["Medlemmer"])).toBe("oversikt");
  });

  it("falls back to the default when the parameter is repeated", () => {
    expect(parseAdminTeamTab(["medlemmer", "roller"])).toBe("oversikt");
  });

  it("does not treat prototype property names as tabs", () => {
    expect(parseAdminTeamTab(["constructor"])).toBe("oversikt");
    expect(parseAdminTeamTab(["__proto__"])).toBe("oversikt");
  });
});

describe("tabForLegacyHash", () => {
  it("maps each legacy section anchor to the tab that now contains it", () => {
    expect(tabForLegacyHash("#admin-section-invite")).toBe("invitasjoner");
    expect(tabForLegacyHash("#admin-section-invitations")).toBe("invitasjoner");
    expect(tabForLegacyHash("#admin-section-requests")).toBe("invitasjoner");
    expect(tabForLegacyHash("#admin-section-members")).toBe("medlemmer");
    expect(tabForLegacyHash("#admin-section-roles")).toBe("roller");
    expect(tabForLegacyHash("#admin-section-surveys")).toBe("undersokelser");
    expect(tabForLegacyHash("#admin-section-challenges")).toBe("utfordringer");
    expect(tabForLegacyHash("#admin-section-skills")).toBe("kompetanse");
  });

  it("returns null for unknown hashes and an empty hash", () => {
    expect(tabForLegacyHash("#something-else")).toBeNull();
    expect(tabForLegacyHash("")).toBeNull();
  });
});

describe("adminTeamTabHref", () => {
  it("builds a path with only the encoded team id and the tab parameter", () => {
    expect(adminTeamTabHref("team 1", "medlemmer")).toBe("/admin/teams/team%201?tab=medlemmer");
  });
});
