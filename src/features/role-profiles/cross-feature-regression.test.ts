import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Cross-feature regression (TASK-029, BR-15, BR-18). Role profiles imports no team, roadmap or progress module. Its
 * collections and concepts are pinned by the role-profiles scope guard (collection allow-list and forbidden concepts), and
 * the unmodified suites of the other features run alongside (see TASKS.md).
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

const PRODUCTION = [...walk("src/features/role-profiles"), ...walk("app/api/roles"), ...walk("app/api/me/role-target"), ...walk("app/api/me/role-comparison"), ...walk("app/api/admin/roles"), ...walk("app/admin/roles"), ...walk("app/me/skills")]
  .filter((path) => !/\.test\.tsx?$/.test(path));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("cross-feature boundary — team planning, roadmap and progress are untouched (BR-18)", () => {
  it("finds the role-profiles production tree it is meant to scan", () => {
    expect(PRODUCTION.length).toBeGreaterThan(20);
  });

  it("role-profiles code imports no team, roadmap or skill-progress server module", () => {
    // `teams/server/require-app-admin` is the shared app-admin boundary every admin operation uses; nothing else from teams.
    const forbidden = /from\s+["'][^"']*(team-skills|roadmap|skill-progress|skill-trees\/server|teams\/server\/(?!require-app-admin))/;
    expect(PRODUCTION.filter((path) => forbidden.test(read(path)))).toEqual([]);
  });
});
