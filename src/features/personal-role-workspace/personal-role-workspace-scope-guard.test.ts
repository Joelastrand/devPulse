import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Static architecture guard for the personal role workspace (SECURITY.md PR-SI-2, SECURITY-REVIEW §11.4).
 *
 * This is CHANGE DETECTION, not an access control and not runtime authorization. It fails the build when a new file imports
 * the personal record store, reads the D1 goal store from a new place, uses a collection group on personal records, or reads the
 * target or assigned role from this feature. The real owner-only guarantee is the verified-uid server routes, the Firestore
 * deny-only rule, the authorization matrix and the negative cross-user tests. Lexical limits: string-built paths and non-literal
 * specifiers are not seen here (SECURITY-REVIEW §11.4).
 */

const ROOT = process.cwd();
const FEATURE = "src/features/personal-role-workspace/";

function walk(dir: string): string[] {
  return readdirSync(`${ROOT}/${dir}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** This file necessarily contains the tokens it searches for (fixtures), so it is excluded from the scan, as in the D1 guard. */
const GUARD_FILE = `${FEATURE}personal-role-workspace-scope-guard.test.ts`;
/** The repository-wide guard file contains the same fixture tokens, so it is excluded here as well. */
const REPO_GUARD_FILE = `${FEATURE}personal-role-workspace-repo-guard.test.ts`;

const sources = [...walk("src/features/personal-role-workspace"), ...walk("app/api/me/responsibilities"), ...walk("app/api/me/achievements")]
  .filter((path) => path !== GUARD_FILE && path !== REPO_GUARD_FILE)
  .sort()
  .map((path) => ({ path, text: readFileSync(`${ROOT}/${path}`, "utf8").replace(/\r\n/g, "\n") }));

/** Files that may import the personal record store module (production and test support only). */
const STORE_IMPORTERS = new Set([
  `${FEATURE}server/record-engine.ts`,
  `${FEATURE}server/record-operations.ts`,
  `${FEATURE}server/fake-personal-record-store.ts`,
  `${FEATURE}server/owned-evidence-source.ts`,
  `${FEATURE}server/record-operations.test.ts`,
]);

/** Files that may import the operations module: the two route families and the operation tests. */
const OPERATION_IMPORTERS = new Set([
  "app/api/me/responsibilities/route.ts",
  "app/api/me/responsibilities/[recordId]/route.ts",
  "app/api/me/achievements/route.ts",
  "app/api/me/achievements/[recordId]/route.ts",
  `${FEATURE}server/record-operations.test.ts`,
  `${FEATURE}server/personal-records.emulator.test.ts`,
  "src/features/development-conversations/server/evidence.emulator.test.ts",
]);

/** The only file that may import the D1 goal store or its helpers. */
const GOAL_STORE_IMPORTERS = new Set([`${FEATURE}server/owned-goal-reader.ts`]);

const importsOf = (text: string): string[] =>
  [...text.matchAll(/(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1] ?? match[2],
  );

const importsModule = (text: string, pattern: RegExp) => importsOf(text).some((specifier) => pattern.test(specifier));

describe("personal role workspace static guard (PR-SI-2, change detection only)", () => {
  it("only the approved files import the personal record store", () => {
    const offenders = sources
      .filter((file) => importsModule(file.text, /(^|\/)personal-record-store$/) && !STORE_IMPORTERS.has(file.path))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("only the approved files import the operations module", () => {
    const offenders = sources
      .filter((file) => importsModule(file.text, /(^|\/)record-operations$/) && !OPERATION_IMPORTERS.has(file.path))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("only the owned-goal reader imports the D1 goal store from this feature", () => {
    const offenders = sources
      .filter((file) => importsModule(file.text, /personal-goals\/server\/goal-store$/) && !GOAL_STORE_IMPORTERS.has(file.path))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("uses no collection group and no query across owners", () => {
    // The token is assembled from fragments so this file does not contain it (the D1 guard uses the same convention).
    const forbidden = new RegExp(["collection", "Group", "\\s*\\("].join(""));
    const offenders = sources.filter((file) => forbidden.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("never reads the target role or an assigned role from this feature (PR-SI-4)", () => {
    const offenders = sources
      .filter((file) => /roleTarget|roleAssignments/.test(file.text) && !file.path.endsWith(".test.ts"))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("the store module is the only file of this feature that builds a userDevelopment path", () => {
    const offenders = sources
      .filter((file) => /["'`]userDevelopment["'`]/.test(file.text) && file.path !== `${FEATURE}server/personal-record-store.ts` && !file.path.endsWith(".test.ts"))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("the guard itself would catch a new importer (negative fixture)", () => {
    const fixture = `import { getDefaultPersonalRecordStore } from "@/src/features/personal-role-workspace/server/personal-record-store";`;
    expect(importsModule(fixture, /(^|\/)personal-record-store$/)).toBe(true);
    expect(STORE_IMPORTERS.has("src/features/teams/server/new-leaky.ts")).toBe(false);
  });
});
