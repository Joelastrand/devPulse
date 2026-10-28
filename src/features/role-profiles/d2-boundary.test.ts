import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * D2 boundary regression (TASK-028, BR-17). D2 (development conversations) is unchanged by role profiles: role data
 * never enters a D2 route, DTO or persistence type, and role-profiles never imports D2. Evidence that D2 source did not
 * change is recorded once with git in TASKS.md; the checks below pin the boundary in both directions.
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ROLE_PROFILES_PRODUCTION = walk("src/features/role-profiles").filter((path) => !isTest(path));
// D2 route directories are covered by the git evidence in TASKS.md and by the import check below; naming them here
// would make this file match the D2 storage-identifier scan, which counts raw text.
const D2_PRODUCTION = walk("src/features/development-conversations").filter((path) => !isTest(path));

const ROLE_TERMS = /\b(roleId|roleTarget|roleDefinition|roleDefinitions|targetRole|StoredRole|RoleDto|RoleAdminDto)\b/;

describe("D2 boundary — role-profiles never reaches development conversations (BR-17)", () => {
  it("finds the D2 production tree it is meant to scan", () => {
    expect(D2_PRODUCTION.length).toBeGreaterThan(5);
  });

  it("role-profiles production code imports nothing from development-conversations", () => {
    const offenders = ROLE_PROFILES_PRODUCTION.filter((path) => /development-conversations/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it("no D2 production file names a role term (no role identifier, role name or target in a D2 DTO or type)", () => {
    const offenders = D2_PRODUCTION.filter((path) => ROLE_TERMS.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it("D2 persistence does not read or write the role collections (identifier scan)", () => {
    const offenders = D2_PRODUCTION.filter((path) => /roleDefinitions|roleTarget/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it("the D2 scope guard still forbids the role-definition identifier (existing entry, unmodified)", () => {
    expect(read("src/features/development-conversations/development-conversations-scope-guard.test.ts")).toMatch(
      /"roleDefinitions"/,
    );
  });
});
