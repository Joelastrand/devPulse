import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Route groups (docs/archive/features/product-experience/SPEC.md — Application shell,
 * Structure). Groups are folders in parentheses and never change a URL. The
 * list below is the complete set of page URLs in the application.
 */

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));

const EXPECTED_URLS = [
  "/",
  "/admin/roles",
  "/admin/skills",
  "/admin/superadmins",
  "/admin/teams",
  "/admin/teams/[teamId]",
  "/me/conversations",
  "/me/conversations/[conversationId]",
  "/me/erasure",
  "/me/goals",
  "/me/profile",
  "/me/skills",
  "/public/teams/[teamId]",
  "/results",
  "/sign-in",
  "/sign-up",
  "/survey/[surveyId]",
  "/teams",
  "/teams/[teamId]",
  "/teams/[teamId]/competence",
  "/teams/[teamId]/competence-plan",
  "/teams/[teamId]/forum/[threadId]",
  "/teams/[teamId]/results",
  "/teams/[teamId]/roadmap",
  "/teams/[teamId]/settings",
  // Retired legacy page: redirects to /teams/[teamId]/competence (old links only, no competence entry point).
  "/teams/[teamId]/skills",
  "/teams/[teamId]/surveys",
  "/teams/[teamId]/systems",
];

function listPages(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "api") listPages(path, found);
    } else if (name === "page.tsx") {
      found.push(path);
    }
  }
  return found;
}

function toUrl(pageFile: string) {
  const segments = relative(APP_DIR, pageFile).split(sep).slice(0, -1);
  const urlSegments = segments.filter((segment) => !/^\(.+\)$/.test(segment));
  return `/${urlSegments.join("/")}`.replace(/\/$/, "") || "/";
}

describe("route groups", () => {
  it("resolves every existing page URL unchanged", () => {
    const urls = listPages(APP_DIR).map(toUrl).sort();
    expect(urls).toEqual([...EXPECTED_URLS].sort());
  });

  it("places the survey page in the survey group", () => {
    const surveyPage = listPages(APP_DIR).find((page) => toUrl(page) === "/survey/[surveyId]");
    expect(surveyPage).toBeTruthy();
    expect(relative(APP_DIR, surveyPage ?? "")).toMatch(/^\(survey\)/);
  });
});

describe("survey route group", () => {
  it("has a layout with no navigation import and no identity-bearing import", () => {
    const layout = readFileSync(join(APP_DIR, "(survey)", "layout.tsx"), "utf8");
    const imports = layout.split("\n").filter((line) => line.startsWith("import"));
    expect(imports.join("\n")).not.toMatch(/SiteHeader|PublicHeader|AppShell|Nav|useAuth|observeIdToken|useAuthGatedResource/);
  });
});

describe("root layout", () => {
  it("no longer renders the site header for every route", () => {
    const rootLayout = readFileSync(join(APP_DIR, "layout.tsx"), "utf8");
    expect(rootLayout).not.toMatch(/SiteHeader/);
  });
});
