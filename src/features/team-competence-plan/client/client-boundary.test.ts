import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard: no Node-only module may enter the client-reachable dependency graph. The walk starts at the
 * browser entry points that render the team competence plan and Teamoversikt, follows runtime relative imports, and
 * fails on any Node built-in, `node:` specifier, `firebase-admin`, or `server-only` marker found along the way.
 * `import type` statements are erased at build time and are not followed.
 */

const SRC_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const ENTRY_POINTS = [
  "features/team-competence-plan/client/competence-plan-gateway.ts",
  "features/team-competence-plan/client/use-competence-plans.ts",
  "features/team-competence-plan/components/CompetencePlanSection.tsx",
  "features/team-competence-plan/components/CompetencePlanOverview.tsx",
  "features/team-competence-plan/components/CompetencePlanEditor.tsx",
  "features/teams/components/TeamOversiktSummary.tsx",
  "features/teams/components/TeamDetail.tsx",
];

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const FORBIDDEN_SPECIFIER = /^(node:|firebase-admin|server-only$)/;

/**
 * Captures one import form per match: `import [type] clause from "x"`, side-effect `import "x"`, or dynamic `import("x")`.
 * Group 1 is set for `import type`, which is skipped.
 */
const IMPORT_PATTERN =
  /\bimport\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function runtimeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    if (match[1] !== undefined) continue;
    specifiers.push(match[3] ?? match[4] ?? match[5]);
  }
  return specifiers;
}

function clientGraphViolations(): { file: string; specifier: string }[] {
  const violations: { file: string; specifier: string }[] = [];
  const seen = new Set<string>();
  const queue = ENTRY_POINTS.map((entry) => join(SRC_ROOT, entry));

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
      if (NODE_BUILTINS.has(specifier) || FORBIDDEN_SPECIFIER.test(specifier)) {
        violations.push({ file: file.slice(SRC_ROOT.length), specifier });
        continue;
      }
      if (specifier.startsWith(".")) {
        const resolved = resolveRelative(file, specifier);
        if (resolved !== null) queue.push(resolved);
      }
    }
  }
  return violations;
}

describe("client boundary", () => {
  it("entry points exist", () => {
    for (const entry of ENTRY_POINTS) {
      expect(existsSync(join(SRC_ROOT, entry)), entry).toBe(true);
    }
  });

  it("no Node-only module is reachable from the client competence-plan and Teamoversikt graph", () => {
    expect(clientGraphViolations()).toEqual([]);
  });
});
