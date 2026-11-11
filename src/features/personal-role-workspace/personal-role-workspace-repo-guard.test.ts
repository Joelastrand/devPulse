import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Repository-wide static guard for the personal record import boundary (SECURITY.md PR-SI-2, SECURITY-REVIEW §11.4).
 *
 * This is a STATIC REGRESSION CHECK over the scanned source tree at test time. It is not runtime authorization, it authorizes
 * nothing, and it does not prove that no other path exists. It is lexical: it works on comment-stripped text, cannot follow
 * string-built paths and cannot see specifiers assembled at runtime. The enforceable boundaries are the verified-uid routes,
 * the deny-all client rules, the DTO allow-lists and the negative tests.
 */

const ROOT = process.cwd();
const SCANNED_ROOTS = ["src", "app", "scripts", "test", "browser"];
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", "dist", "coverage", "playwright-report", "test-results"]);

/** Path-string tokens of personal collections, assembled from fragments so this file does not contain them literally. */
const PERSONAL_PATH_TOKENS = new RegExp(
  [`["'\`/]${"responsi" + "bilities"}["'\`/]`, `["'\`/]${"achieve" + "ments"}["'\`/]`, `${"role" + "Assignments"}`].join("|"),
);

/**
 * Guard test files that contain their own fixture strings (import lines and path tokens), so a literal scan of them would
 * flag the fixtures. Each is a reviewed guard, not production code. The D1 and feature guards use the same convention.
 */
const GUARD_FILES = new Set([
  "src/features/personal-role-workspace/personal-role-workspace-repo-guard.test.ts",
  "src/features/personal-role-workspace/personal-role-workspace-scope-guard.test.ts",
  "src/features/personal-goals/personal-goals-scope-guard.test.ts",
  "src/features/development-conversations/development-conversations-scope-guard.test.ts",
  "src/features/role-profiles/role-profiles-scope-guard.test.ts",
]);

/** Importers of the personal record store module (production and test support). */
const STORE_IMPORTERS = new Set([
  "src/features/personal-role-workspace/server/record-engine.ts",
  "src/features/personal-role-workspace/server/record-operations.ts",
  "src/features/personal-role-workspace/server/fake-personal-record-store.ts",
  "src/features/personal-role-workspace/server/owned-evidence-source.ts",
  "src/features/personal-role-workspace/server/record-operations.test.ts",
]);

/** Importers of the operations module: the two route families and the operation tests. */
const OPERATION_IMPORTERS = new Set([
  "app/api/me/responsibilities/route.ts",
  "app/api/me/responsibilities/[recordId]/route.ts",
  "app/api/me/achievements/route.ts",
  "app/api/me/achievements/[recordId]/route.ts",
  "src/features/personal-role-workspace/server/record-operations.test.ts",
  "src/features/personal-role-workspace/server/personal-records.emulator.test.ts",
  "src/features/development-conversations/server/evidence.emulator.test.ts",
]);

/**
 * File-exact exceptions for scripts (SECURITY-REVIEW §11.4). Each entry lists the only local import prefixes the file may use.
 * `seed-demoteam.mjs` has no local import, so its allow-list is empty.
 */
const SCRIPT_LOCAL_IMPORT_EXCEPTIONS = new Map<string, readonly string[]>([
  ["scripts/seed-demoteam-conversations.ts", ["src/features/development-conversations/"]],
  ["scripts/seed-demoteam.mjs", []],
]);

const ALLOWED_PATH_ALIASES = ["@/*"];

type SourceFile = { path: string; text: string };

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path);
    return SCANNED_EXTENSIONS.test(entry.name) ? [path] : [];
  });
}

/** Comment stripping is lexical: block comments and whole-line `//` comments only. Strings are not parsed. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const repoSources = (): SourceFile[] =>
  SCANNED_ROOTS.flatMap((root) => walk(root))
    .filter((path) => !GUARD_FILES.has(path))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n") }));

/** Literal specifiers from static import/export, dynamic import(), side-effect import and CommonJS require(). */
function literalSpecifiers(text: string): string[] {
  const code = stripComments(text);
  return [
    ...code.matchAll(/(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']/g),
    ...code.matchAll(/(?:^|[^\w.$])import\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/(?:^|[^\w.$])require\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/(?:^|[^\w.$])import\s+["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

/**
 * Non-literal dynamic import or require: the argument starts with an identifier or a template literal. A quote is literal.
 * Lexical: a regex literal containing `import (` followed by a non-identifier character is not flagged.
 */
function hasNonLiteralSpecifier(text: string): boolean {
  const code = stripComments(text);
  return /(?:^|[^\w.$])import\s*\(\s*(?=[A-Za-z_$`])/.test(code) || /(?:^|[^\w.$])require\s*\(\s*(?=[A-Za-z_$`])/.test(code);
}

const isLocalSpecifier = (specifier: string) => specifier.startsWith(".") || specifier.startsWith("@/");

/** Resolves a local specifier to a repository-relative path prefix (without extension). */
function resolveLocal(fromPath: string, specifier: string): string {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  const parts = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

const storeSpecifier = /(^|\/)personal-record-store$/;
const operationsSpecifier = /(^|\/)record-operations$/;

/**
 * Violations of the personal-record store and operations allow-lists for one file.
 * The D1 goal store is deliberately NOT checked here: it holds personal goals, which PR-SI-2 does not cover. Its importers
 * are checked by the feature guard. D2 `read-owned-goal-snapshots.ts` is the documented D2 reader of owner-selected goals
 * (BR-24, CL-5), reviewed individually in SECURITY-REVIEW §11.4.
 */
function importViolations(file: SourceFile): string[] {
  const violations: string[] = [];
  const specifiers = literalSpecifiers(file.text);
  if (specifiers.some((s) => storeSpecifier.test(s)) && !STORE_IMPORTERS.has(file.path)) violations.push("store-import");
  if (specifiers.some((s) => operationsSpecifier.test(s)) && !OPERATION_IMPORTERS.has(file.path)) violations.push("operations-import");
  return violations;
}

/** Non-literal specifiers are rejected in every scanned file. */
function specifierViolations(file: SourceFile): string[] {
  return hasNonLiteralSpecifier(file.text) ? ["non-literal-specifier"] : [];
}

/** Path-string checks apply to non-TypeScript files and to script, test and browser sources. */
function pathStringViolations(file: SourceFile): string[] {
  const isNonTypeScript = /\.(js|mjs)$/.test(file.path);
  const isSupportRoot = /^(scripts|test|browser)\//.test(file.path);
  if (!isNonTypeScript && !isSupportRoot) return [];
  return PERSONAL_PATH_TOKENS.test(stripComments(file.text)) ? ["personal-path-string"] : [];
}

/** Script exceptions: a listed script may import only its listed local prefixes. */
function scriptExceptionViolations(file: SourceFile): string[] {
  const allowed = SCRIPT_LOCAL_IMPORT_EXCEPTIONS.get(file.path);
  if (!allowed) return [];
  const violations: string[] = [];
  for (const specifier of literalSpecifiers(file.text)) {
    if (!isLocalSpecifier(specifier)) continue;
    const target = resolveLocal(file.path, specifier);
    if (!allowed.some((prefix) => target.startsWith(prefix))) violations.push(`exception-import:${specifier}`);
  }
  return violations;
}

/** Path aliases in tsconfig.json: only `@/*` is allowed. */
function aliasViolations(tsconfigText: string): string[] {
  const parsed = JSON.parse(tsconfigText) as { compilerOptions?: { paths?: Record<string, unknown> } };
  return Object.keys(parsed.compilerOptions?.paths ?? {}).filter((alias) => !ALLOWED_PATH_ALIASES.includes(alias));
}

describe("personal record repository guard (PR-SI-2, static regression check, not runtime authorization)", () => {
  const sources = repoSources();

  it("scans the required roots and extensions", () => {
    const scanned = new Set(sources.map((file) => file.path.split("/")[0]));
    for (const root of SCANNED_ROOTS) expect(scanned.has(root)).toBe(true);
    expect(sources.some((file) => file.path.endsWith(".mjs"))).toBe(true);
    expect(sources.some((file) => file.path.startsWith("scripts/") && file.path.endsWith(".ts"))).toBe(true);
  });

  it("only the approved files import the personal record store, anywhere in the scanned tree", () => {
    const offenders = sources.filter((file) => importViolations(file).includes("store-import")).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("only the approved files import the operations module, anywhere in the scanned tree", () => {
    const offenders = sources.filter((file) => importViolations(file).includes("operations-import")).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("rejects non-literal import() and require() specifiers in every scanned file", () => {
    const offenders = sources.filter((file) => specifierViolations(file).length > 0).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("keeps personal collection path strings out of scripts, tests, browser specs and non-TypeScript sources", () => {
    const offenders = sources.filter((file) => pathStringViolations(file).length > 0).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("holds the file-exact script exceptions to their documented local imports", () => {
    const offenders = sources.filter((file) => scriptExceptionViolations(file).length > 0).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("allows only the @/* path alias in tsconfig.json", () => {
    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    expect(aliasViolations(tsconfig)).toEqual([]);
  });

  it("fails for a violating fixture in each rule (negative fixtures)", () => {
    const fixture = (path: string, text: string): SourceFile => ({ path, text });
    const storeLine = `import { x } from "@/src/features/personal-role-workspace/server/${"personal-record" + "-store"}";`;

    expect(importViolations(fixture("src/features/teams/server/leaky.ts", storeLine))).toContain("store-import");
    expect(
      importViolations(fixture("scripts/leaky.mjs", `import("@/src/features/personal-role-workspace/server/${"record-" + "operations"}")`)),
    ).toContain("operations-import");
    expect(specifierViolations(fixture("src/x.ts", "const m = await import(name);"))).toContain("non-literal-specifier");
    expect(specifierViolations(fixture("src/x.ts", "const m = require(`./${name}`);"))).toContain("non-literal-specifier");
    expect(specifierViolations(fixture("src/x.ts", 'const m = await import("./safe");'))).toEqual([]);
    const ownerSubtree = "user" + "Development";
    expect(pathStringViolations(fixture("browser/x.ts", `const p = "${ownerSubtree}/u1/${"responsi" + "bilities"}";`))).toContain(
      "personal-path-string",
    );
    expect(pathStringViolations(fixture("scripts/x.mjs", `doc("${"role" + "Assignments"}/u1")`))).toContain("personal-path-string");
    expect(pathStringViolations(fixture("src/x.ts", `const p = "${"achieve" + "ments"}";`))).toEqual([]);
    expect(
      scriptExceptionViolations(fixture("scripts/seed-demoteam.mjs", 'import { x } from "../src/features/personal-role-workspace/server/x.ts";')),
    ).not.toEqual([]);
    expect(
      scriptExceptionViolations(
        fixture("scripts/seed-demoteam-conversations.ts", 'import { x } from "../src/features/development-conversations/server/content-codec";'),
      ),
    ).toEqual([]);
    expect(aliasViolations(JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"], "~/*": ["./src/*"] } } }))).toEqual(["~/*"]);
  });

  it("ignores commented-out imports (lexical limit documented above)", () => {
    expect(hasNonLiteralSpecifier("// const m = await import(name);")).toBe(false);
    expect(literalSpecifiers("/* import x from '@/src/features/personal-role-workspace/server/personal-record-store' */")).toEqual([]);
  });
});
