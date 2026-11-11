import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Narrow source-level guard for the participation boundary (C2 TASK-007, BR-10).
 * It scans production TypeScript for three facts. It does not prove runtime
 * security; the behavioural proof is `participation-non-exposure.test.ts`, and the full
 * C2 static guard is TASK-017. The coverage operation is the one approved consumer of the
 * membership scan (TASK-014).
 */
const ROOT = process.cwd();
const STORE_FILE = "src/features/team-skills/server/skill-contribution-store.ts";
const DOMAIN_FILE = "src/features/team-skills/domain/skill-contribution.ts";
/** Account erasure registry (erasure-only persistence metadata; exact file, no directory exemption). */
const ERASURE_REGISTRY_FILE = "src/features/account-erasure/server/inventory.ts";
const OWN_STATE_OPERATIONS = [
  "src/features/team-skills/server/get-own-skill-contribution.ts",
  "src/features/team-skills/server/set-own-skill-contribution.ts",
  "src/features/team-skills/server/withdraw-own-skill-contribution.ts",
];

const COVERAGE_OPERATION = "src/features/team-skills/server/get-team-skill-coverage.ts";
/** Team-owned skill aggregate (team-owned-skills SPEC §6): the second, narrowly approved consumer of the membership scan. */
const TEAM_OWNED_AGGREGATE_OPERATION = "src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts";

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const production = [...walk("src"), ...walk("app")].map((path) => ({
  path,
  text: readFileSync(join(ROOT, path), "utf8"),
}));

const filesContaining = (needle: string | RegExp) =>
  production
    .filter(({ text }) => (typeof needle === "string" ? text.includes(needle) : needle.test(text)))
    .map(({ path }) => path)
    .sort();

describe("participation boundary (source scan)", () => {
  it("names listMembershipsForCoverage only in the store that defines it and the coverage operation — no route, DTO or UI", () => {
    expect(filesContaining("listMembershipsForCoverage")).toEqual([COVERAGE_OPERATION, STORE_FILE, TEAM_OWNED_AGGREGATE_OPERATION].sort());
  });

  it("imports the participation store only from the three own-state operations and the coverage operation (never a route, client or admin/lead path)", () => {
    expect(filesContaining(/skill-contribution-store/)).toEqual([...OWN_STATE_OPERATIONS, COVERAGE_OPERATION, TEAM_OWNED_AGGREGATE_OPERATION].sort());
  });

  it("keeps the literal membership field name in the domain module only (plus the erasure registry, file-exact)", () => {
    // Account erasure: the inventory registry names the persisted field so the erasure sweep can find it. Exact file only.
    expect(filesContaining("skillContribution").filter((p) => p !== ERASURE_REGISTRY_FILE)).toEqual([DOMAIN_FILE]);
  });

  it("the erasure registry is the only account-erasure file that names the membership field", () => {
    expect(filesContaining("skillContribution").filter((p) => p.startsWith("src/features/account-erasure/"))).toEqual([
      ERASURE_REGISTRY_FILE,
    ]);
  });

  it("keeps participation store and server internals out of client components", () => {
    const clientFiles = production.filter(({ text }) => /^\s*["']use client["']/m.test(text));
    for (const { path, text } of clientFiles) {
      expect(text, path).not.toMatch(/skill-contribution-store|domain\/skill-contribution["']|team-skills\/server/);
    }
  });
});
