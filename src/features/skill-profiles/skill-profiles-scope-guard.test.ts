import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_PROFILE_PERSISTED_KEYS } from "./domain/skill-profile";

/**
 * Static scope guard for Individual Skill Self-Assessment (C1, TASK-005).
 *
 * It is a CHANGE-DETECTION boundary, not a security proof. It makes an unexpected reader/writer of
 * the personal skill-profile collection, or an unexpected consumer of the skill-profiles server/store
 * modules, fail visibly so that it needs a deliberate, reviewed allow-list edit.
 *
 * It does NOT prove: runtime behavior or authorization correctness; a dynamically constructed
 * collection name or module path; an unresolvable re-export or dynamic import; references outside
 * the scanned directories (`src/`, `app/`); or Admin-credential access outside the application.
 * Code review remains the check for those.
 *
 * Any reader of skill profiles outside C1 must deliberately edit these allow-lists as part of the
 * approved security/privacy process. C2 (TASK-013) pre-authorizes exactly one outside importer,
 * `src/features/team-skills/server/get-team-skill-coverage.ts` and its sibling tests, and only for the
 * identity-stripping adapter `read-skill-levels-batch.ts`. The raw batch reader and the store stay
 * reachable only through explicit per-module importer lists (no directory-wide allowance).
 * The guard also does not prove that the approved module behaves correctly at runtime.
 *
 * Structure: pure scanner functions (guard implementation) run over (a) the real tree and (b) virtual
 * negative fixtures. This file is excluded from every scan of the real tree because it necessarily
 * contains the tokens it searches for.
 */

const ROOT = process.cwd();
const GUARD_FILE = "src/features/skill-profiles/skill-profiles-scope-guard.test.ts";
const C1_FEATURE_DIR = "src/features/skill-profiles/";
const C1_SERVER_DIR = "src/features/skill-profiles/server/";
const C1_ROUTE_DIR = "app/api/me/skills/";

interface SourceFile {
  path: string;
  text: string;
}

/* ------------------------------ approved allow-lists ------------------------------ */

/** Dimension 1: the only files in `src/` and `app/` that may reference the collection identifier. */
const APPROVED_COLLECTION_REFERENCES = [
  "src/features/skill-profiles/domain/skill-profile.ts",
  "src/features/skill-profiles/server/collection-independence.test.ts",
  "src/features/skill-profiles/server/delete-own-skill-profile.test.ts",
  "src/features/skill-profiles/server/delete-own-skill-profile.ts",
  "src/features/skill-profiles/server/skill-profile-store.ts",
];
/** Approved by the task for the deny-rule config pin (TASK-006); allowed but not required to exist yet. */
const APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES = ["src/lib/firebase/firestore-deployment-config.test.ts"];

/** Dimension 2: files outside the feature that may import `src/features/skill-profiles/server/**`. */
const APPROVED_SERVER_IMPORTERS = [
  "app/api/me/skills/[treeId]/route.test.ts",
  "app/api/me/skills/[treeId]/route.ts",
  "app/api/me/skills/owner-isolation.test.ts",
  "app/api/me/skills/route.test.ts",
  "app/api/me/skills/route.ts",
];

/**
 * Dimension 2, C2 (TASK-013): approved when present, so the guard passes before TASK-014/015 create them.
 * Exactly one production module plus its sibling tests; never a directory.
 */
const COVERAGE_MODULE = "src/features/team-skills/server/get-team-skill-coverage.ts";
const COVERAGE_TEST = /^src\/features\/team-skills\/server\/get-team-skill-coverage[^/]*\.test\.ts$/;

/**
 * Dimension 2, role profiles (TASK-013): the owner-only comparison module, approved by its exact path, when present. It
 * is the only outside importer of `skill-profiles/server` added by role-profiles. No directory allowance; its tests
 * receive the C1 read by injection and import nothing from C1.
 */
const ROLE_COMPARISON_MODULE = "src/features/role-profiles/server/get-own-role-comparison.ts";

const STORE_MODULE = "src/features/skill-profiles/server/skill-profile-store";
const BATCH_MODULE = "src/features/skill-profiles/server/read-skill-levels-batch";
const SERVER_DIR_PREFIX = "src/features/skill-profiles/server";

/** Module-level map: the only files that may import `skill-profile-store` (C1 owner operations, the adapter, tests). */
const APPROVED_STORE_IMPORTERS = [
  "app/api/me/skills/owner-isolation.test.ts",
  "src/features/skill-profiles/server/clear-own-skill-level.test.ts",
  "src/features/skill-profiles/server/clear-own-skill-level.ts",
  "src/features/skill-profiles/server/delete-own-skill-profile.ts",
  "src/features/skill-profiles/server/fake-skill-profile-store.ts",
  "src/features/skill-profiles/server/get-own-skills.test.ts",
  "src/features/skill-profiles/server/get-own-skills.ts",
  "src/features/skill-profiles/server/read-skill-levels-batch.test.ts",
  "src/features/skill-profiles/server/read-skill-levels-batch.ts",
  "src/features/skill-profiles/server/set-own-skill-level.test.ts",
  "src/features/skill-profiles/server/set-own-skill-level.ts",
  "src/features/skill-profiles/server/skill-profile-batch-read.test.ts",
  "src/features/skill-profiles/server/write-stamps.ts",
];

/** Module-level map: `read-skill-levels-batch` is importable only by its own test and the approved C2 module/tests (when present). */
const APPROVED_BATCH_IMPORTERS = ["src/features/skill-profiles/server/read-skill-levels-batch.test.ts"];

/** Identifier scan: the only files that may contain the raw reader identifier. */
const RAW_READER_IDENTIFIER_FILES = [
  "src/features/skill-profiles/server/read-skill-levels-batch.ts",
  "src/features/skill-profiles/server/skill-profile-batch-read.test.ts",
  "src/features/skill-profiles/server/skill-profile-store.ts",
];
/** Identifier scan: the only files that may contain the adapter identifier (plus the C2 module/tests when present). */
const ADAPTER_IDENTIFIER_FILES = [
  "src/features/skill-profiles/server/read-skill-levels-batch.test.ts",
  "src/features/skill-profiles/server/read-skill-levels-batch.ts",
];
const RAW_READER_IDENTIFIER = /\breadSkillProfilesBatch\b/;
const ADAPTER_IDENTIFIER = /\breadSkillLevelsBatch\b/;

/** Exact production (non-test) files of the owner API surface; a new route is a deliberate change. */
const APPROVED_ROUTE_FILES = ["app/api/me/skills/[treeId]/route.ts", "app/api/me/skills/route.ts"];
const APPROVED_ROUTE_METHODS: Record<string, string[]> = {
  "app/api/me/skills/route.ts": ["DELETE", "GET"],
  "app/api/me/skills/[treeId]/route.ts": ["DELETE", "PUT"],
};

/** Skill-profiles sources must not import these (resolved repo-relative prefixes). */
const FORBIDDEN_C1_IMPORT_PREFIXES = [
  "src/features/teams/", // team authorization, roles, memberships, app-admin
  "src/features/roadmap/",
  "src/features/profiles/", // userProfiles
  "src/features/demo-team/",
  "src/features/skill-trees/server/", // skillProgress and tree administration (only the pure domain validator is used)
  "app/",
];

/** Concepts that belong to C2 or to non-goals; scanned only inside C1 production code. */
const FORBIDDEN_C1_IDENTIFIERS = [
  "teamSkillNeeds",
  "matrix",
  "aggregate",
  "threshold",
  "consent",
  "sharedWith",
  "sharing",
  "history",
  "ranking",
  "leaderboard",
];

/* ---------------------------------- scanners ---------------------------------- */

const COLLECTION_TOKEN = /\bskillProfiles\b/;
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*)(["'])([^"'\n]+)\1/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Repo-relative resolution of the literal relative / `@/` import specifiers of one file. */
function resolvedImports(file: SourceFile): string[] {
  const resolved: string[] = [];
  for (const match of file.text.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[2];
    if (specifier.startsWith("@/")) resolved.push(posix.normalize(specifier.slice(2)));
    else if (specifier.startsWith(".")) resolved.push(posix.normalize(posix.join(posix.dirname(file.path), specifier)));
  }
  return resolved;
}

/** Repo-relative module key without extension or `/index`, so `./x`, `./x.ts` and `./x/index` compare equal. */
const moduleKey = (target: string) => target.replace(/\.(?:ts|tsx|js|mjs)$/, "").replace(/\/index$/, "");

const RE_EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])([^"'\n]+)\1/g;

/** Resolved targets of every `export * from` / `export { … } from` (renamed or not) in one file; comments ignored. */
function reExportTargets(file: SourceFile): string[] {
  const targets: string[] = [];
  for (const match of stripComments(file.text).matchAll(RE_EXPORT_FROM)) {
    targets.push(...resolvedImports({ path: file.path, text: `from "${match[2]}"` }));
  }
  return targets;
}

/**
 * Self-files: each guard necessarily contains the tokens it searches for. The C2 guard (TASK-017) is a test-only
 * file with no imports of C1 modules (its path-like strings are fixtures); it is exempted by exact path and
 * asserts this exemption by name, so no other file gains it.
 */
const C2_GUARD_FILE = "src/features/team-skills/team-skills-scope-guard.test.ts";
const isGuarded = (path: string) => path !== GUARD_FILE && path !== C2_GUARD_FILE;

function collectionReferenceViolations(files: SourceFile[]): string[] {
  const allowed = new Set([...APPROVED_COLLECTION_REFERENCES, ...APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES]);
  return files
    .filter((file) => isGuarded(file.path) && COLLECTION_TOKEN.test(file.text) && !allowed.has(file.path))
    .map((file) => file.path);
}

function isApprovedServerImporter(path: string): boolean {
  return (
    APPROVED_SERVER_IMPORTERS.includes(path) ||
    path === COVERAGE_MODULE ||
    COVERAGE_TEST.test(path) ||
    path === ROLE_COMPARISON_MODULE
  );
}

function serverImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path) && !file.path.startsWith(C1_FEATURE_DIR) && !isApprovedServerImporter(file.path))
    .filter((file) => resolvedImports(file).some((target) => target.startsWith(C1_SERVER_DIR)))
    .map((file) => file.path);
}

const isApprovedBatchImporter = (path: string) =>
  APPROVED_BATCH_IMPORTERS.includes(path) || path === COVERAGE_MODULE || COVERAGE_TEST.test(path);

const isApprovedAdapterIdentifierFile = (path: string) =>
  ADAPTER_IDENTIFIER_FILES.includes(path) || path === COVERAGE_MODULE || COVERAGE_TEST.test(path);

/** Module-level maps: who may import `skill-profile-store` and `read-skill-levels-batch` (any file, including inside C1). */
function moduleImporterViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path))
    .flatMap((file) => {
      const targets = resolvedImports(file).map(moduleKey);
      const out: string[] = [];
      if (targets.includes(STORE_MODULE) && !APPROVED_STORE_IMPORTERS.includes(file.path)) out.push(`${file.path} -> skill-profile-store`);
      if (targets.includes(BATCH_MODULE) && !isApprovedBatchImporter(file.path)) out.push(`${file.path} -> read-skill-levels-batch`);
      return out;
    });
}

/**
 * Exact importer-set check for one module. `required` files must import it; any other importer must satisfy
 * `isApprovedWhenPresent` (pre-authorized future files). Presence-aware: absent pre-authorized files are not required.
 */
function importerSetMismatches(
  files: SourceFile[],
  moduleKeyToCheck: string,
  required: string[],
  isApprovedWhenPresent: (path: string) => boolean,
): string[] {
  const actual = files
    .filter((f) => isGuarded(f.path) && resolvedImports(f).map(moduleKey).includes(moduleKeyToCheck))
    .map((f) => f.path);
  return [
    ...actual.filter((p) => !required.includes(p) && !isApprovedWhenPresent(p)).map((p) => `unexpected: ${p}`),
    ...required.filter((p) => !actual.includes(p)).map((p) => `missing: ${p}`),
  ];
}

/** Identifier scan over raw text (comments included, conservatively): catches aliases and renamed re-exports. */
function identifierViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path))
    .flatMap((file) => {
      const out: string[] = [];
      if (RAW_READER_IDENTIFIER.test(file.text) && !RAW_READER_IDENTIFIER_FILES.includes(file.path)) out.push(`${file.path}: readSkillProfilesBatch`);
      if (ADAPTER_IDENTIFIER.test(file.text) && !isApprovedAdapterIdentifierFile(file.path)) out.push(`${file.path}: readSkillLevelsBatch`);
      return out;
    });
}

/** Any `export * from` / `export { … } from` resolving into `skill-profiles/server/**`, from any file, fails. */
function serverReExportViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path))
    .flatMap((file) =>
      reExportTargets(file)
        .filter((target) => moduleKey(target).startsWith(`${SERVER_DIR_PREFIX}/`))
        .map((target) => `${file.path} re-exports ${moduleKey(target)}`),
    );
}

/** Client components must not import skill-profiles server modules (also inside the C1 feature). */
function clientServerImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path) && /^(["'])use client\1/.test(stripComments(file.text).trimStart()))
    .filter((file) => resolvedImports(file).some((target) => moduleKey(target).startsWith(`${SERVER_DIR_PREFIX}/`)))
    .map((file) => file.path);
}

/** The approved C2 module (when present) has no `export … from` and exports only the operation, its factory and types. */
function coverageModuleViolations(files: SourceFile[]): string[] {
  const file = files.find((f) => f.path === COVERAGE_MODULE);
  if (!file) return [];
  const code = stripComments(file.text);
  const problems: string[] = [];
  if (reExportTargets(file).length > 0 || /\bexport\s*(?:type\s*)?(?:\*|\{[^}]*\})\s*from\b/.test(code)) problems.push(`${file.path}: export … from`);
  const approvedRuntime = new Set(["getTeamSkillCoverage", "createGetTeamSkillCoverage"]);
  for (const match of code.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|enum)\s+([\w$]+)/gm)) {
    if (!approvedRuntime.has(match[1])) problems.push(`${file.path}: unapproved export ${match[1]}`);
  }
  if (/^export\s+default\b/m.test(code)) problems.push(`${file.path}: default export`);
  if (/^export\s*(?:type\s*)?\{[^}]*\}(?!\s*from)/m.test(code)) problems.push(`${file.path}: export list`);
  return problems;
}

/** Admin/team route trees may neither name the collection nor import anything from the feature. */
function adminAndTeamRouteViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path) && /^app\/api\/(admin|teams)\//.test(file.path))
    .filter(
      (file) =>
        COLLECTION_TOKEN.test(file.text) || resolvedImports(file).some((target) => target.startsWith(C1_FEATURE_DIR)),
    )
    .map((file) => file.path);
}

/** Reverse/static BR-23 (production sources; the catalog parity test legitimately imports `listSkillTrees`): skill-profiles code depends on no team, roadmap, profile or progress code. */
function forbiddenC1ImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => isGuarded(file.path) && file.path.startsWith(C1_FEATURE_DIR) && !/\.test\.tsx?$/.test(file.path))
    .flatMap((file) =>
      resolvedImports(file)
        .filter((target) => FORBIDDEN_C1_IMPORT_PREFIXES.some((prefix) => target.startsWith(prefix)))
        .map((target) => `${file.path} -> ${target}`),
    );
}

/** Production sources only (tests legitimately describe prohibited concepts); comments stripped. */
function forbiddenIdentifierViolations(files: SourceFile[]): string[] {
  return files
    .filter(
      (file) =>
        isGuarded(file.path) &&
        (file.path.startsWith(C1_FEATURE_DIR) || file.path.startsWith(C1_ROUTE_DIR)) &&
        !/\.test\.tsx?$/.test(file.path),
    )
    .flatMap((file) => {
      const code = stripComments(file.text).toLowerCase();
      return FORBIDDEN_C1_IDENTIFIERS.filter((id) => code.includes(id.toLowerCase())).map((id) => `${file.path}: ${id}`);
    });
}

function exportedMethods(text: string): string[] {
  return [...text.matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]).sort();
}

/* ------------------------------- real tree access ------------------------------- */

function walk(dir: string): string[] {
  return readdirSync(`${ROOT}/${dir}`, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".next")
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

const realFiles: SourceFile[] = [...walk("src"), ...walk("app")]
  .sort()
  .map((path) => ({ path, text: readFileSync(`${ROOT}/${path}`, "utf8").replace(/\r\n/g, "\n") }));

const virtual = (path: string, text: string): SourceFile => ({ path, text });

/* ----------------------------------- tests ----------------------------------- */

describe("C1 scope guard — collection reference allow-list (Dimension 1)", () => {
  it("the files that reference the collection identifier equal the approved C1 set", () => {
    const found = realFiles.filter((f) => isGuarded(f.path) && COLLECTION_TOKEN.test(f.text)).map((f) => f.path);
    const required = new Set(APPROVED_COLLECTION_REFERENCES);
    expect(found.filter((p) => !required.has(p) && !APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES.includes(p))).toEqual([]);
    expect(APPROVED_COLLECTION_REFERENCES.filter((p) => !found.includes(p))).toEqual([]);
    expect(collectionReferenceViolations(realFiles)).toEqual([]);
  });

  it("fails for an unapproved file referencing the collection, including a C2-style reader", () => {
    const violations = collectionReferenceViolations([
      virtual("src/features/skill-profiles/server/list-all-profiles.ts", `db.collection("skillProfiles").get()`),
      virtual("src/features/team-skill-needs/server/read-team-profiles.ts", `const c = "skillProfiles";`),
      virtual("src/features/skill-profiles/server/skill-profile-store.ts", `const c = "skillProfiles";`),
    ]);
    expect(violations).toEqual([
      "src/features/skill-profiles/server/list-all-profiles.ts",
      "src/features/team-skill-needs/server/read-team-profiles.ts",
    ]);
  });

  it("fails for admin and team route files that reference the collection or import the feature", () => {
    expect(adminAndTeamRouteViolations(realFiles)).toEqual([]);
    expect(
      adminAndTeamRouteViolations([
        virtual("app/api/admin/skill-profiles/route.ts", `db.collection("skillProfiles")`),
        virtual("app/api/teams/[teamId]/skills/route.ts", `import { x } from "../../../../../src/features/skill-profiles/domain/skill-profile";`),
        virtual("app/api/teams/[teamId]/roadmap-items/route.ts", `import { y } from "../../../../../src/features/roadmap/server/a";`),
      ]),
    ).toEqual(["app/api/admin/skill-profiles/route.ts", "app/api/teams/[teamId]/skills/route.ts"]);
  });
});

describe("C1 scope guard — module/import allow-list (Dimension 2)", () => {
  it("only the approved owner routes (and their tests) outside the feature import skill-profiles server modules", () => {
    expect(serverImportViolations(realFiles)).toEqual([]);
    const importers = realFiles
      .filter((f) => isGuarded(f.path) && !f.path.startsWith(C1_FEATURE_DIR))
      .filter((f) => resolvedImports(f).some((t) => t.startsWith(C1_SERVER_DIR)))
      .map((f) => f.path);
    expect(importers.every(isApprovedServerImporter)).toBe(true);
    expect(importers).toEqual(expect.arrayContaining(APPROVED_ROUTE_FILES));
  });

  it("fails for an unapproved route, page or feature importing an operation or the store seam", () => {
    const violations = serverImportViolations([
      virtual("app/api/me/skills/export/route.ts", `import { getOwnSkills } from "../../../../../src/features/skill-profiles/server/get-own-skills";`),
      virtual("app/api/me/team-skills/route.ts", `import { getDefaultSkillProfileStore } from "@/src/features/skill-profiles/server/skill-profile-store";`),
      virtual("app/teams/page.tsx", `const m = await import("../../src/features/skill-profiles/server/get-own-skills");`),
      virtual("src/features/team-skill-needs/server/matrix.ts", `import type { SkillProfileStore } from "../../skill-profiles/server/skill-profile-store";`),
      virtual("app/api/me/skills/route.ts", `import { getOwnSkills } from "../../../../src/features/skill-profiles/server/get-own-skills";`),
      virtual("src/features/skill-profiles/server/get-own-skills.ts", `import { x } from "./skill-profile-store";`),
    ]);
    expect(violations).toEqual([
      "app/api/me/skills/export/route.ts",
      "app/api/me/team-skills/route.ts",
      "app/teams/page.tsx",
      "src/features/team-skill-needs/server/matrix.ts",
    ]);
  });

  it("approves the role-profiles comparison module by exact path only, not its sibling files", () => {
    expect(
      serverImportViolations([
        virtual(ROLE_COMPARISON_MODULE, `import { getOwnSkills } from "../../skill-profiles/server/get-own-skills";`),
        virtual("src/features/role-profiles/server/get-own-role-target.ts", `import { getOwnSkills } from "../../skill-profiles/server/get-own-skills";`),
      ]),
    ).toEqual(["src/features/role-profiles/server/get-own-role-target.ts"]);
  });

  it("a new file inside app/api/me/skills/ is not implicitly approved", () => {
    expect(
      serverImportViolations([
        virtual("app/api/me/skills/[treeId]/share/route.ts", `import { setOwnSkillLevel } from "../../../../../../src/features/skill-profiles/server/set-own-skill-level";`),
      ]),
    ).toEqual(["app/api/me/skills/[treeId]/share/route.ts"]);
  });

  it("the owner API surface is exactly the two approved route files with the approved methods", () => {
    const productionRouteFiles = realFiles
      .filter((f) => f.path.startsWith(C1_ROUTE_DIR) && !/\.test\.tsx?$/.test(f.path))
      .map((f) => f.path);
    expect(productionRouteFiles).toEqual([...APPROVED_ROUTE_FILES].sort());
    for (const file of realFiles.filter((f) => productionRouteFiles.includes(f.path))) {
      expect(exportedMethods(file.text), file.path).toEqual(APPROVED_ROUTE_METHODS[file.path]);
    }
  });
});

describe("C1 scope guard — module-level importer maps, identifier and re-export scans (C2, TASK-013)", () => {
  it("passes on the real tree: store, batch module, identifiers, re-exports and client boundary", () => {
    expect(moduleImporterViolations(realFiles)).toEqual([]);
    expect(identifierViolations(realFiles)).toEqual([]);
    expect(serverReExportViolations(realFiles)).toEqual([]);
    expect(clientServerImportViolations(realFiles)).toEqual([]);
    expect(coverageModuleViolations(realFiles)).toEqual([]);
  });

  it("the approved importer lists are exact: the store and batch importer sets on disk equal the lists", () => {
    expect(importerSetMismatches(realFiles, STORE_MODULE, APPROVED_STORE_IMPORTERS, () => false)).toEqual([]);
    expect(importerSetMismatches(realFiles, BATCH_MODULE, APPROVED_BATCH_IMPORTERS, isApprovedBatchImporter)).toEqual([]);
  });

  it("the exact importer-set check is presence-aware: it accepts the exact future C2 files when present, never other siblings", () => {
    const importLine = `import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";`;
    const current = APPROVED_BATCH_IMPORTERS.map((path) => virtual(path, `import { x } from "./read-skill-levels-batch";`));
    const check = (extra: SourceFile[]) =>
      importerSetMismatches([...current, ...extra], BATCH_MODULE, APPROVED_BATCH_IMPORTERS, isApprovedBatchImporter);

    expect(check([])).toEqual([]);
    expect(check([virtual(COVERAGE_MODULE, importLine)])).toEqual([]);
    expect(
      check([
        virtual(COVERAGE_MODULE, importLine),
        virtual("src/features/team-skills/server/get-team-skill-coverage.test.ts", importLine),
        virtual("src/features/team-skills/server/get-team-skill-coverage-privacy.test.ts", importLine),
      ]),
    ).toEqual([]);

    const helper = "src/features/team-skills/server/get-team-skill-coverage-helper.ts";
    const other = "src/features/team-skills/server/other.ts";
    expect(check([virtual(COVERAGE_MODULE, importLine), virtual(helper, importLine), virtual(other, importLine)])).toEqual([
      `unexpected: ${helper}`,
      `unexpected: ${other}`,
    ]);
    expect(importerSetMismatches([], BATCH_MODULE, APPROVED_BATCH_IMPORTERS, isApprovedBatchImporter)).toEqual(
      APPROVED_BATCH_IMPORTERS.map((p) => `missing: ${p}`),
    );
  });

  it("the raw reader identifier appears in exactly the approved files; the adapter identifier only in approved files", () => {
    const raw = realFiles.filter((f) => isGuarded(f.path) && RAW_READER_IDENTIFIER.test(f.text)).map((f) => f.path);
    expect(raw.sort()).toEqual([...RAW_READER_IDENTIFIER_FILES].sort());
    const adapter = realFiles.filter((f) => isGuarded(f.path) && ADAPTER_IDENTIFIER.test(f.text)).map((f) => f.path);
    expect(adapter.filter((p) => !isApprovedAdapterIdentifierFile(p))).toEqual([]);
    expect(adapter).toContain("src/features/skill-profiles/server/read-skill-levels-batch.ts");
  });

  it("the store and the batch adapter stay server-only, and the store interface does not expose the raw batch reader", () => {
    for (const path of [`${STORE_MODULE}.ts`, `${BATCH_MODULE}.ts`]) {
      const file = realFiles.find((f) => f.path === path);
      expect(file?.text.startsWith('import "server-only";'), path).toBe(true);
    }
    const store = realFiles.find((f) => f.path === `${STORE_MODULE}.ts`)!.text;
    const start = store.indexOf("export interface SkillProfileStore");
    expect(start).toBeGreaterThan(-1);
    expect(store.slice(start, store.indexOf("\n}\n", start))).not.toContain("readSkillProfilesBatch");
  });

  it("approves exactly the C2 caller and its sibling tests; any other team-skills module still fails", () => {
    const importLine = `import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";`;
    const approved = [
      virtual(COVERAGE_MODULE, importLine),
      virtual("src/features/team-skills/server/get-team-skill-coverage.test.ts", importLine),
      virtual("src/features/team-skills/server/get-team-skill-coverage-privacy.test.ts", importLine),
    ];
    expect(serverImportViolations(approved)).toEqual([]);
    expect(moduleImporterViolations(approved)).toEqual([]);
    expect(identifierViolations(approved)).toEqual([]);

    const unapproved = [
      virtual("src/features/team-skills/server/get-team-skill-coverage-helper.ts", importLine),
      virtual("src/features/team-skills/server/other.ts", importLine),
    ];
    expect(serverImportViolations(unapproved)).toEqual(unapproved.map((f) => f.path));
    expect(moduleImporterViolations(unapproved)).toEqual(unapproved.map((f) => `${f.path} -> read-skill-levels-batch`));
    expect(identifierViolations(unapproved)).toEqual(unapproved.map((f) => `${f.path}: readSkillLevelsBatch`));
  });

  it("the C2 caller may not import the store or use the raw reader", () => {
    expect(
      moduleImporterViolations([
        virtual(COVERAGE_MODULE, `import { getDefaultSkillProfileStore } from "../../skill-profiles/server/skill-profile-store";`),
      ]),
    ).toEqual([`${COVERAGE_MODULE} -> skill-profile-store`]);
    expect(identifierViolations([virtual(COVERAGE_MODULE, `readSkillProfilesBatch(uids)`)])).toEqual([
      `${COVERAGE_MODULE}: readSkillProfilesBatch`,
    ]);
  });

  it("fails for a second team-skills module, a route, or any other file importing the batch module", () => {
    expect(
      moduleImporterViolations([
        virtual("src/features/team-skills/server/other.ts", `import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual("app/api/teams/[teamId]/skill-coverage/route.ts", `import { readSkillLevelsBatch } from "@/src/features/skill-profiles/server/read-skill-levels-batch";`),
        virtual("src/features/skill-profiles/server/get-own-skills.ts", `import { x } from "./read-skill-levels-batch.ts";`),
        virtual("src/features/team-skills/server/index.ts", `import("../../skill-profiles/server/read-skill-levels-batch/index");`),
      ]),
    ).toEqual([
      "src/features/team-skills/server/other.ts -> read-skill-levels-batch",
      "app/api/teams/[teamId]/skill-coverage/route.ts -> read-skill-levels-batch",
      "src/features/skill-profiles/server/get-own-skills.ts -> read-skill-levels-batch",
      "src/features/team-skills/server/index.ts -> read-skill-levels-batch",
    ]);
  });

  it("fails for a file importing the store directly, from outside or inside C1, by any path form", () => {
    expect(
      moduleImporterViolations([
        virtual("src/features/team-skills/server/x.ts", `import { getDefaultSkillProfileStore } from "../../skill-profiles/server/skill-profile-store";`),
        virtual("app/api/me/team-skills/route.ts", `import type { SkillProfileStore } from "@/src/features/skill-profiles/server/skill-profile-store";`),
        virtual("src/features/skill-profiles/server/new-reader.ts", `import { readSkillProfilesBatch } from "./skill-profile-store";`),
        virtual("src/features/skill-profiles/server/get-own-skills.ts", `import { getDefaultSkillProfileStore } from "./skill-profile-store";`),
      ]),
    ).toEqual([
      "src/features/team-skills/server/x.ts -> skill-profile-store",
      "app/api/me/team-skills/route.ts -> skill-profile-store",
      "src/features/skill-profiles/server/new-reader.ts -> skill-profile-store",
    ]);
  });

  it("fails when a C1 owner operation calls the batch function or the raw reader", () => {
    expect(
      identifierViolations([
        virtual("src/features/skill-profiles/server/get-own-skills.ts", `const r = await readSkillLevelsBatch(deps, [uid], ids);`),
        virtual("src/features/skill-profiles/server/set-own-skill-level.ts", `const r = await readSkillProfilesBatch([uid]);`),
      ]),
    ).toEqual([
      "src/features/skill-profiles/server/get-own-skills.ts: readSkillLevelsBatch",
      "src/features/skill-profiles/server/set-own-skill-level.ts: readSkillProfilesBatch",
    ]);
  });

  it("identifier scan catches aliased imports and renamed re-exports, but not look-alike names", () => {
    expect(
      identifierViolations([
        virtual("src/features/team-skills/server/a.ts", `import { readSkillProfilesBatch as load } from "@/x";`),
        virtual("src/features/team-skills/server/b.ts", `export { readSkillLevelsBatch as readLevels } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual("src/features/team-skills/server/ok.ts", `const readSkillLevelsBatchResult = 1; const myreadSkillProfilesBatch2 = 2;`),
      ]),
    ).toEqual([
      "src/features/team-skills/server/a.ts: readSkillProfilesBatch",
      "src/features/team-skills/server/b.ts: readSkillLevelsBatch",
    ]);
  });

  it("re-export scan fails for named, renamed, star, namespace, type and multi-line re-exports into skill-profiles/server/**", () => {
    expect(
      serverReExportViolations([
        virtual("src/features/team-skills/server/barrel.ts", `export * from "../../skill-profiles/server/skill-profile-store";`),
        virtual("src/features/team-skills/server/intermediate.ts", `export * from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual("src/features/team-skills/server/renamed.ts", `export { readSkillProfilesBatch as somethingElse } from "../../skill-profiles/server/skill-profile-store";`),
        virtual("src/features/team-skills/server/ns.ts", `export * as raw from "@/src/features/skill-profiles/server/skill-profile-store";`),
        virtual("src/features/team-skills/server/ty.ts", `export type { X } from "../../skill-profiles/server/get-own-skills";`),
        virtual("src/features/team-skills/server/multi.ts", `export {\n  a,\n  b as c,\n} from "../../skill-profiles/server/read-skill-levels-batch.ts";`),
        virtual("src/features/skill-profiles/index.ts", `export * from "./server/skill-profile-store";`),
        virtual("src/features/team-skills/server/fine.ts", `export { y } from "../../teams/domain/x"; // export * from "../../skill-profiles/server/a"`),
      ]),
    ).toEqual([
      "src/features/team-skills/server/barrel.ts re-exports src/features/skill-profiles/server/skill-profile-store",
      "src/features/team-skills/server/intermediate.ts re-exports src/features/skill-profiles/server/read-skill-levels-batch",
      "src/features/team-skills/server/renamed.ts re-exports src/features/skill-profiles/server/skill-profile-store",
      "src/features/team-skills/server/ns.ts re-exports src/features/skill-profiles/server/skill-profile-store",
      "src/features/team-skills/server/ty.ts re-exports src/features/skill-profiles/server/get-own-skills",
      "src/features/team-skills/server/multi.ts re-exports src/features/skill-profiles/server/read-skill-levels-batch",
      "src/features/skill-profiles/index.ts re-exports src/features/skill-profiles/server/skill-profile-store",
    ]);
  });

  it("a client module cannot import skill-profiles server modules", () => {
    expect(
      clientServerImportViolations([
        virtual("src/features/team-skills/components/Matrix.tsx", `"use client";\nimport { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual("src/features/skill-profiles/components/Page.tsx", `"use client";\nimport { x } from "../server/get-own-skills";`),
        virtual("src/features/skill-profiles/components/Ok.tsx", `"use client";\nimport { x } from "../client/api";`),
        virtual("src/features/team-skills/server/server-side.ts", `import { x } from "../../skill-profiles/server/get-own-skills";`),
      ]),
    ).toEqual(["src/features/team-skills/components/Matrix.tsx", "src/features/skill-profiles/components/Page.tsx"]);
  });

  it("once the approved C2 module exists it has no export … from and exports only the operation, its factory and types", () => {
    expect(coverageModuleViolations([])).toEqual([]);
    expect(
      coverageModuleViolations([
        virtual(
          COVERAGE_MODULE,
          `import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";\nexport type TeamSkillCoverageDeps = {};\nexport interface X {}\nexport function createGetTeamSkillCoverage() {}\nexport const getTeamSkillCoverage = 1;`,
        ),
      ]),
    ).toEqual([]);
    expect(
      coverageModuleViolations([
        virtual(
          COVERAGE_MODULE,
          `export * from "../../skill-profiles/server/read-skill-levels-batch";\nexport { readSkillLevelsBatch as r } from "x";\nexport const readLevels = 1;\nexport default 1;\nexport { a };`,
        ),
      ]),
    ).toEqual([
      `${COVERAGE_MODULE}: export … from`,
      `${COVERAGE_MODULE}: unapproved export readLevels`,
      `${COVERAGE_MODULE}: default export`,
      `${COVERAGE_MODULE}: export list`,
    ]);
  });

  it("fails for a new production collection reference, even beside the approved C2 caller", () => {
    expect(
      collectionReferenceViolations([
        virtual(COVERAGE_MODULE, `db.collection("skillProfiles")`),
        virtual("src/features/skill-profiles/server/second-store.ts", `const c = "skillProfiles";`),
      ]),
    ).toEqual([COVERAGE_MODULE, "src/features/skill-profiles/server/second-store.ts"]);
  });
});

describe("C1 scope guard — reverse/static independence (BR-23/BR-24 reverse direction)", () => {
  it("skill-profiles sources import no team-authorization, membership, roadmap, profile, progress or route code", () => {
    expect(forbiddenC1ImportViolations(realFiles)).toEqual([]);
  });

  it("fails for a skill-profiles source importing team-authorization, roadmap or progress code", () => {
    expect(
      forbiddenC1ImportViolations([
        virtual("src/features/skill-profiles/server/x.ts", `import { authorizeTeamAccess } from "../../teams/server/authorize-team-access";`),
        virtual("src/features/skill-profiles/server/y.ts", `import { z } from "../../skill-trees/server/update-team-skill-progress";`),
        virtual("src/features/skill-profiles/domain/w.ts", `import { r } from "@/src/features/roadmap/domain/roadmap-item";`),
        virtual("src/features/skill-profiles/server/ok.ts", `import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";`),
        virtual("src/features/results/server/unrelated.ts", `import { a } from "../../teams/server/authorize-team-access";`),
      ]),
    ).toEqual([
      "src/features/skill-profiles/server/x.ts -> src/features/teams/server/authorize-team-access",
      "src/features/skill-profiles/server/y.ts -> src/features/skill-trees/server/update-team-skill-progress",
      "src/features/skill-profiles/domain/w.ts -> src/features/roadmap/domain/roadmap-item",
    ]);
  });

  it("only the collection-owning C1 files can reference the collection, so no other feature code (e.g. skill progress) can", () => {
    const outsideC1 = realFiles.filter(
      (f) => isGuarded(f.path) && !f.path.startsWith(C1_FEATURE_DIR) && !f.path.startsWith(C1_ROUTE_DIR) && COLLECTION_TOKEN.test(f.text),
    );
    expect(outsideC1.map((f) => f.path)).toEqual(
      APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES.filter((p) => outsideC1.some((f) => f.path === p)),
    );
  });
});

describe("C1 scope guard — persisted shape and forbidden C2 concepts (C1 surfaces only)", () => {
  it("pins the persisted key set to levels, createdAt, updatedAt", () => {
    expect([...SKILL_PROFILE_PERSISTED_KEYS].sort()).toEqual(["createdAt", "levels", "updatedAt"]);
  });

  it("C1 production code contains no C2, sharing, history, ranking or aggregate identifiers", () => {
    expect(forbiddenIdentifierViolations(realFiles)).toEqual([]);
  });

  it("flags a forbidden identifier inside a C1 path but not the same word elsewhere, in comments or in tests", () => {
    expect(
      forbiddenIdentifierViolations([
        virtual("src/features/skill-profiles/server/a.ts", `export const teamSkillNeeds = 1;`),
        virtual("app/api/me/skills/route.ts", `const thresholdK = 3;`),
        virtual("src/features/results/server/aggregate-results.ts", `const threshold = 5; const matrix = [];`),
        virtual("src/features/skill-profiles/server/b.ts", `// no history, no matrix\n/* aggregate */ export const ok = 1;`),
        virtual("src/features/skill-profiles/server/c.test.ts", `it("replaces the level without history", () => {});`),
      ]),
    ).toEqual([
      "src/features/skill-profiles/server/a.ts: teamSkillNeeds",
      "app/api/me/skills/route.ts: threshold",
    ]);
  });
});
