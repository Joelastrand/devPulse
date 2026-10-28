import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static scope guard for Role profiles (TASK-003; SPEC "Scope guard").
 *
 * CHANGE-DETECTION evidence only, not a security boundary. It makes a new collection, an import from a
 * forbidden module, a forbidden concept or a demo/seed reference fail visibly. It does NOT prove
 * authorization or runtime behaviour; the route and authorization-matrix tests own those. The scanners are
 * lexical (regex over comment-stripped text), so a determined author can evade them.
 *
 * This file is excluded from the real-tree scan because it necessarily contains the tokens it searches for.
 */

const ROOT = process.cwd();
const FEATURE_DIR = "src/features/role-profiles";
const GUARD_FILE = `${FEATURE_DIR}/role-profiles-scope-guard.test.ts`;

/** The only collection paths this feature may name (BR-1, AD-1, AD-2). */
const ALLOWED_COLLECTIONS = new Set(["roleDefinitions", "userDevelopment", "roleTarget"]);

const FORBIDDEN_IMPORT_FRAGMENTS = [
  "skill-trees/server",
  "team-skills",
  "roadmap",
  "skill-progress",
  "development-conversations",
  "notification",
  "email",
];

const FORBIDDEN_CONCEPT_PATTERN =
  /\b(currentRole|currentRoleId|roleFamily|roleLevel|grade|teamRole|memberRef|percent\w*|readiness|promotion|score|rank)\b/i;

// PG-12 test-token technique: `collection\s*Group` as a pattern, so the D1 scan does not match this file's own text.
const FORBIDDEN_REFERENCE_PATTERN = /collection\s*Group|demo-team|seed:|Demo Team/;

interface SourceFile {
  path: string;
  text: string;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function listSourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [{ path: relative(ROOT, fullPath).split("\\").join("/"), text: readFileSync(fullPath, "utf8") }];
  });
}

function importSpecifiers(text: string): string[] {
  const pattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
  return [...stripComments(text).matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function findImportViolations(files: SourceFile[]): string[] {
  return files.flatMap((file) =>
    importSpecifiers(file.text)
      .filter((specifier) => FORBIDDEN_IMPORT_FRAGMENTS.some((fragment) => specifier.includes(fragment)))
      .map((specifier) => `${file.path} imports ${specifier}`),
  );
}

function findCollectionViolations(files: SourceFile[]): string[] {
  return files.flatMap((file) => {
    const names = [...stripComments(file.text).matchAll(/\bcollection\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1] ?? "");
    return names.filter((name) => !ALLOWED_COLLECTIONS.has(name)).map((name) => `${file.path} uses collection ${name}`);
  });
}

function findConceptViolations(files: SourceFile[]): string[] {
  return files.flatMap((file) => {
    const match = FORBIDDEN_CONCEPT_PATTERN.exec(stripComments(file.text));
    return match ? [`${file.path} contains forbidden concept ${match[0]}`] : [];
  });
}

function findReferenceViolations(files: SourceFile[]): string[] {
  return files.flatMap((file) => {
    const match = FORBIDDEN_REFERENCE_PATTERN.exec(stripComments(file.text));
    return match ? [`${file.path} references ${match[0]}`] : [];
  });
}

function scanAll(files: SourceFile[]): string[] {
  return [
    ...findImportViolations(files),
    ...findCollectionViolations(files),
    ...findConceptViolations(files),
    ...findReferenceViolations(files),
  ];
}

describe("role-profiles scope guard", () => {
  const realFiles = listSourceFiles(join(ROOT, FEATURE_DIR)).filter((file) => file.path !== GUARD_FILE);

  it("scans the feature tree", () => {
    expect(realFiles.length).toBeGreaterThan(0);
  });

  it("passes on the current feature tree", () => {
    expect(scanAll(realFiles)).toEqual([]);
  });

  describe("negative fixtures", () => {
    const fixture = (text: string): SourceFile => ({ path: `${FEATURE_DIR}/fixture.ts`, text });

    it("accepts the approved collection names", () => {
      expect(findCollectionViolations([fixture(`db.collection("roleDefinitions")\ndb.collection("userDevelopment")`)])).toEqual([]);
    });

    it.each([
      ["a forbidden skill-trees server import", `import { x } from "@/features/skill-trees/server/list-skill-trees";`],
      ["a forbidden team-skills import", `import { x } from "@/features/team-skills/domain/skill-need";`],
      ["a forbidden roadmap import", `import { x } from "@/features/roadmap/domain/roadmap-item";`],
      ["a forbidden D2 import", `import { x } from "@/features/development-conversations/server/store";`],
      ["a forbidden notification import", `import { x } from "@/lib/notification";`],
      ["a dynamic forbidden import", `const m = await import("@/features/skill-progress/domain/x");`],
    ])("fails on %s", (_label, text) => {
      expect(findImportViolations([fixture(text)])).toHaveLength(1);
    });

    it("fails on an unapproved collection", () => {
      expect(findCollectionViolations([fixture(`db.collection("teamMemberships")`)])).toHaveLength(1);
    });

    it.each(["currentRole", "roleFamily", "memberRef", "readiness", "promotion", "score", "percentComplete"])(
      "fails on the forbidden concept %s",
      (concept) => {
        expect(findConceptViolations([fixture(`const ${concept} = 1;`)])).toHaveLength(1);
      },
    );

    it("fails on the collection-group query token and demo/seed references", () => {
      expect(findReferenceViolations([fixture(`db.collection Group("roleTarget")`)])).toHaveLength(1);
      expect(findReferenceViolations([fixture(`// ok\nconst x = "demo-team";`)])).toHaveLength(1);
      expect(findReferenceViolations([fixture(`run("seed:demo-team")`)])).toHaveLength(1);
    });

    it("ignores forbidden tokens that only appear in comments", () => {
      expect(scanAll([fixture(`// currentRole is out of scope\n/* memberRef */ const ok = 1;`)])).toEqual([]);
    });
  });
});

/* ------------------------- final pins (TASK-027) ------------------------- */

/** Every string literal in another guard's source that names a role-profiles path. */
function roleProfilesEntries(guardPath: string): string[] {
  const source = readFileSync(join(process.cwd(), guardPath), "utf8");
  return [...source.matchAll(/"(src\/features\/role-profiles\/[^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("role-profiles final pins (TASK-027, PG-12)", () => {
  it("C2 guard: the only role-profiles entry is the exact role store file", () => {
    expect(roleProfilesEntries("src/features/team-skills/team-skills-cross-cutting.test.ts")).toEqual([
      "src/features/role-profiles/server/role-store.ts",
    ]);
  });

  it("D1 guard: the only role-profiles entries are the role-target store, its path test and this guard's pin", () => {
    expect(roleProfilesEntries("src/features/personal-goals/personal-goals-scope-guard.test.ts").sort()).toEqual([
      "src/features/role-profiles/role-profiles-scope-guard.test.ts",
      "src/features/role-profiles/server/role-target-store.test.ts",
      "src/features/role-profiles/server/role-target-store.ts",
    ]);
  });

  it("C1 guard: the only role-profiles importer is the comparison module, by exact path", () => {
    const source = readFileSync(join(process.cwd(), "src/features/skill-profiles/skill-profiles-scope-guard.test.ts"), "utf8");
    expect(source.match(/const ROLE_COMPARISON_MODULE = "([^"]+)"/)?.[1]).toBe(
      "src/features/role-profiles/server/get-own-role-comparison.ts",
    );
  });

  it("no guard grants a directory-level role-profiles allowance or a query-group exception", () => {
    for (const guardPath of [
      "src/features/team-skills/team-skills-cross-cutting.test.ts",
      "src/features/personal-goals/personal-goals-scope-guard.test.ts",
      "src/features/skill-profiles/skill-profiles-scope-guard.test.ts",
    ]) {
      expect(roleProfilesEntries(guardPath).filter((entry) => entry.endsWith("/"))).toEqual([]);
    }
    // PG-12 test-token technique: the pattern is spelled `collection\s*Group`, so this file does not match its own scan.
    const collectionGroupUse = /\.collection\s*Group\(/;
    const productionFiles = (dir: string): string[] =>
      readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return productionFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    const offenders = productionFiles("src/features/role-profiles").filter((path) =>
      collectionGroupUse.test(readFileSync(join(process.cwd(), path), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
