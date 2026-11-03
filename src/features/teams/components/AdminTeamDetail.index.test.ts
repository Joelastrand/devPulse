import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * In-page section index on /admin/teams/[teamId] (Product Experience TASK-060): every
 * index link targets a section id that exists, and each top-level section has one.
 */
const source = readFileSync(fileURLToPath(new URL("./AdminTeamDetail.tsx", import.meta.url)), "utf8");

describe("admin team section index", () => {
  const links = Array.from(source.matchAll(/href="#(admin-section-[a-z]+)"/g)).map((m) => m[1]);
  const sections = Array.from(source.matchAll(/<section id="(admin-section-[a-z]+)"/g)).map((m) => m[1]);

  it("links to seven sections", () => {
    expect(links).toHaveLength(7);
  });

  it("links only to section ids that exist", () => {
    for (const id of links) expect(sections).toContain(id);
  });

  it("is a labelled navigation landmark", () => {
    expect(source).toContain("aria-label={adminCopy.detail.sectionIndexLabel}");
  });
});
