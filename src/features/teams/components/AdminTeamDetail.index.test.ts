import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_TEAM_TAB_IDS, tabForLegacyHash } from "../admin-team-tabs";

/**
 * Team administration page structure (`/admin/teams/[teamId]`, Phase 1 tab shell). Static checks on the source:
 * the seven tabs are declared, each tab panel is present, every legacy `#admin-section-*` anchor still resolves to a
 * tab, and the old sticky section index does not come back.
 */
const source = readFileSync(fileURLToPath(new URL("./AdminTeamDetail.tsx", import.meta.url)), "utf8");
// Sections moved into panel components during the redesign. Their legacy anchors still render, so they are read too.
const panelSources = ["./TeamMembersPanel.tsx", "./TeamInvitationsPanel.tsx"].map((file) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"),
);
const allSource = [source, ...panelSources].join("\n");

describe("admin team tab structure", () => {
  const panelIds = Array.from(source.matchAll(/<AdminTeamTabPanel id="([a-z]+)"/g)).map((m) => m[1]);
  const sectionIds = Array.from(allSource.matchAll(/<section id="(admin-section-[a-z]+)"/g)).map((m) => m[1]);

  it("renders one tab panel per primary tab in the declared order", () => {
    expect(panelIds).toEqual([...ADMIN_TEAM_TAB_IDS]);
  });

  it("renders its tab list through the URL-driven shell", () => {
    expect(source).toContain("<AdminTeamTabs label={adminCopy.detail.tabsLabel}>");
  });

  it("keeps every legacy section id and maps it to a tab", () => {
    expect(sectionIds).toHaveLength(8);
    for (const id of sectionIds) {
      expect(tabForLegacyHash(`#${id}`)).not.toBeNull();
    }
  });

  it("does not reintroduce the sticky section index", () => {
    expect(allSource).not.toMatch(/sticky/);
    expect(allSource).not.toContain("sectionIndexLabel");
  });
});
