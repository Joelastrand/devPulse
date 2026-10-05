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
 * A future C2 reader of skill profiles must deliberately edit BOTH allow-lists below (collection
 * references and module importers) as part of the approved security/privacy process. Nothing for C2
 * is pre-authorized here.
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

const isGuarded = (path: string) => path !== GUARD_FILE;

function collectionReferenceViolations(files: SourceFile[]): string[] {
  const allowed = new Set([...APPROVED_COLLECTION_REFERENCES, ...APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES]);
  return files
    .filter((file) => isGuarded(file.path) && COLLECTION_TOKEN.test(file.text) && !allowed.has(file.path))
    .map((file) => file.path);
}

function serverImportViolations(files: SourceFile[]): string[] {
  const allowed = new Set(APPROVED_SERVER_IMPORTERS);
  return files
    .filter((file) => isGuarded(file.path) && !file.path.startsWith(C1_FEATURE_DIR) && !allowed.has(file.path))
    .filter((file) => resolvedImports(file).some((target) => target.startsWith(C1_SERVER_DIR)))
    .map((file) => file.path);
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
    expect(importers.every((p) => APPROVED_SERVER_IMPORTERS.includes(p))).toBe(true);
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
