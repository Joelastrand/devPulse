import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { GoalDto, GoalListResponse, GoalRecoveryDto, SkillOptionDto } from "./domain/goal";
import {
  GOAL_DTO_KEYS,
  GOAL_LIST_RESPONSE_KEYS,
  GOAL_PERSISTED_KEYS,
  GOAL_RECOVERY_DTO_KEYS,
} from "./domain/goal-constants";

/**
 * Static scope guard for Personal Development Goals (D1, TASK-003; SPEC "D1 static scope guard").
 *
 * It is CHANGE-DETECTION evidence, not a security boundary and not an authorization or privacy proof. It
 * makes an unexpected reader/writer of the `userDevelopment` collection, an unexpected importer of the
 * D1 server modules, a forbidden dependency, a new persisted/response key or a forbidden concept fail
 * visibly, so that it needs a deliberate, reviewed allow-list edit. Every allow-list below is an EXACT
 * list of files (or one anchored pattern for sibling test files of a named module); nothing is approved
 * by directory. Later D1 tasks extend only these lists, by file name, as they add their files.
 *
 * It does NOT prove: runtime behavior or authorization correctness (the operation, route and
 * authorization-matrix tests own those); dynamically built collection names or module paths; template-literal
 * or otherwise non-literal import specifiers; import aliases other than `@/`; code outside `src/` and `app/`;
 * Admin credential access; that routes build responses from DTOs only; absence of the *behavior* behind a
 * forbidden concept (name-based scans flag identifiers and strings, not behavior; copy-level terms are
 * checked by the UI copy test, so `copy.ts` is not name-scanned); logging of titles or raw documents (the
 * BR-54 logging tests own that, a regex cannot do it robustly). The scanners are lexical (regex over
 * comment-stripped text, not a TypeScript parser): a `//` inside a string literal can hide the rest of that
 * line from the comment-stripped scans, and a determined author can evade them. Code review remains the
 * check for those cases.
 *
 * The DTO check pins the declaration form (flat `export interface`, no `extends`, one member per line): a type
 * alias or any other form fails as "not found"/unparsed instead of silently skipping the check. The persisted-key
 * scan of the store writer (`goal-store.ts`) is defence in depth; the exact key tuple and the store-writer tests are the anchor.
 *
 * Structure: pure scanner functions run over (a) the real tree and (b) virtual negative fixtures. This
 * file is excluded from every scan of the real tree because it necessarily contains the tokens it searches
 * for; no other file is excluded.
 */

const ROOT = process.cwd();
const GUARD_FILE = "src/features/personal-goals/personal-goals-scope-guard.test.ts";
const D1_DIR = "src/features/personal-goals/";
const D1_SERVER_DIR = "src/features/personal-goals/server/";
const D1_ROUTE_DIRS = ["app/api/me/goals/", "app/me/goals/"];

interface SourceFile {
  path: string;
  text: string;
}

/* ------------------------------ approved allow-lists ------------------------------ */

/** Dimension 1: the only files that may contain the collection identifier (TASK-004: the store alone, plus its tests). */
const APPROVED_COLLECTION_REFERENCES = [
  "src/features/personal-goals/server/goal-store.ts",
  "src/features/personal-goals/server/goal-store.test.ts",
  // TASK-009: the authorization/reachability suite asserts the production default collection paths.
  "src/features/personal-goals/server/personal-goals-authz-matrix.test.ts",
  // TASK-005 (D2 persistence): the only D2 files that carry the protected `userDevelopment` namespace. This grants D2 no
  // D1 goal access; the snapshot seam (TASK-008) is a separate, importer-and-module-exact amendment.
  "src/features/development-conversations/server/conversation-store-types.ts",
  "src/features/development-conversations/server/conversation-store.test.ts",
];
/**
 * TASK-002 pins the rules block; allowed when present, never required. The pin lives beside the existing
 * deployment-config test (which cannot hold the identifier: it mentions collectionGroup for index checks).
 */
const APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES = [
  "src/lib/firebase/firestore-deployment-config.test.ts",
  "src/lib/firebase/firestore-user-development-rules.test.ts",
];

/** Dimension 2: files outside the feature that may import `personal-goals/server/**` (routes, their tests, page). */
const APPROVED_SERVER_IMPORTERS = [
  "app/api/me/goals/route.ts",
  "app/api/me/goals/route.test.ts",
  "app/api/me/goals/[goalId]/route.ts",
  "app/api/me/goals/[goalId]/route.test.ts",
  "app/me/goals/page.tsx",
  // TASK-008 (D2 snapshot seam): the one D2 module that reads D1 goals, by the verified owner uid (SPEC CL-5, BR-24).
  "src/features/development-conversations/server/read-owned-goal-snapshots.ts",
];

const STORE_MODULE = "src/features/personal-goals/server/goal-store";
/** Dimension 2, store: the only files that may import the store module (operations, the fake, their tests). */
const APPROVED_STORE_IMPORTERS = [
  "src/features/personal-goals/server/get-personal-goals.ts",
  "src/features/personal-goals/server/create-personal-goal.ts",
  "src/features/personal-goals/server/update-personal-goal.ts",
  "src/features/personal-goals/server/delete-personal-goal.ts",
  "src/features/personal-goals/server/fake-goal-store.ts",
  "src/features/personal-goals/server/fake-goal-store.test.ts",
  "src/features/personal-goals/server/goal-store.test.ts",
  "src/features/personal-goals/server/personal-goals-authz-matrix.test.ts",
  // TASK-016: the route-level logging/body sweep substitutes the default store with the in-memory fake.
  "src/features/personal-goals/personal-goals-cross-cutting.test.ts",
  // TASK-008 (D2 snapshot seam): the D2 snapshot module is the only non-D1 importer of the store module.
  "src/features/development-conversations/server/read-owned-goal-snapshots.ts",
];
/** Sibling test files of exactly the four operations: `<op>.test.ts` or `<op>-<suffix>.test.ts`. */
const OPERATION_TEST =
  /^src\/features\/personal-goals\/server\/(?:get-personal-goals|create-personal-goal|update-personal-goal|delete-personal-goal)(?:-[a-z0-9-]+)?\.test\.ts$/;
const isApprovedStoreImporter = (path: string) => APPROVED_STORE_IMPORTERS.includes(path) || OPERATION_TEST.test(path);

const CATALOG_MODULE = "src/features/personal-goals/server/skill-catalog";
/** Dimension 2, catalog (TASK-005): the only files that may import the SkillTree catalog seam (operations, its own test). */
const APPROVED_CATALOG_IMPORTERS = [
  "src/features/personal-goals/server/get-personal-goals.ts",
  "src/features/personal-goals/server/create-personal-goal.ts",
  "src/features/personal-goals/server/update-personal-goal.ts",
  // TASK-016: the route-level sweep substitutes the default SkillTree reader (see the store importer entry).
  "src/features/personal-goals/personal-goals-cross-cutting.test.ts",
  "src/features/personal-goals/server/skill-catalog.test.ts",
];
/** Sibling tests of exactly the three catalog-consuming operations; the delete operation never touches the catalog. */
const CATALOG_OPERATION_TEST =
  /^src\/features\/personal-goals\/server\/(?:get-personal-goals|create-personal-goal|update-personal-goal)(?:-[a-z0-9-]+)?\.test\.ts$/;
const isApprovedCatalogImporter = (path: string) => APPROVED_CATALOG_IMPORTERS.includes(path) || CATALOG_OPERATION_TEST.test(path);

/** Owner API surface: the exact production route files and methods (BR-23 routes); a new route is a deliberate change. */
const APPROVED_ROUTE_METHODS: Record<string, string[]> = {
  "app/api/me/goals/route.ts": ["GET", "POST"],
  "app/api/me/goals/[goalId]/route.ts": ["DELETE", "PATCH"],
};

/** Dimension 5: D1 production sources must not import these (resolved repo-relative prefixes). */
const FORBIDDEN_IMPORT_PREFIXES = [
  "src/features/skill-profiles/", // C1 persistence/server/domain, any layer: D1 never reads personal skill levels
  "src/features/teams/", // team authorization, roles, memberships, app-admin
  "src/features/roadmap/",
  "src/features/team-skills/", // C2 needs/coverage/matrix
  "src/features/skill-trees/server/", // skillProgress and tree administration; only skill-trees/domain is not forbidden
];
/**
 * Two of the identifiers below are assembled from fragments: the C1 and C2 guards scan the whole tree for those
 * exact tokens and exempt only their own files, and D1 must not edit them (TASK-003), so this file must not
 * contain them literally.
 */
const SKILL_PROFILES = ["skill", "Profiles"].join("");
const TEAM_SKILL_NEEDS = ["team", "SkillNeeds"].join("");
const BATCH_READER = ["read", "SkillLevelsBatch"].join("");

/** Dimension 5: identifiers D1 production sources must not contain (word-bounded, case-sensitive). */
const FORBIDDEN_IDENTIFIERS = [
  "authorizeTeamAccess",
  "resolveTeamRole",
  "isAppAdmin",
  "requireAppAdmin",
  "skillProgress",
  "roadmapItems",
  TEAM_SKILL_NEEDS,
  SKILL_PROFILES,
  "teamMemberships",
];

/** Dimension 6: BR-7 keys that must never be keys of an object literal in the store writer. */
const FORBIDDEN_PERSISTED_KEYS = [
  "uid",
  "ownerUid",
  "email",
  "displayName",
  "teamId",
  "memberRef",
  "role",
  "score",
  "rank",
  "percentage",
  "level",
  "targetLevel",
  "areaName",
  "notes",
  "description",
  "journal",
  "history",
  "sharing",
  "sharedWith",
  "consent",
  "schemaVersion",
];

/** Dimension 8: whole words (camelCase / snake_case split) that D1 production identifiers and strings must not contain. */
const FORBIDDEN_CONCEPT_WORDS = [
  "share",
  "shared",
  "sharing",
  "consent",
  "rank",
  "ranking",
  "leaderboard",
  "score",
  "scoring",
  "percentage",
  "percent",
  "overdue",
  "manager",
];
const FORBIDDEN_CONCEPT_PHRASES = ["lead reader", "admin reader", "progress score"];
/** Copy is checked by the UI copy test (SPEC dimension 8 limitation), not by this name scan. */
const NAME_SCAN_EXCLUDED = [`${D1_DIR}copy.ts`];

/** The expected sets are written out here on purpose: the guard pins them independently of the exported tuples. */
const EXPECTED_PERSISTED_KEYS = ["completedAt", "createdAt", "status", "targetDate", "title", "treeId", "updatedAt"];
const EXPECTED_DTO_KEYS = [
  "areaAvailable",
  "areaName",
  "completedAt",
  "createdAt",
  "id",
  "status",
  "targetDate",
  "title",
  "treeId",
  "updatedAt",
];
const EXPECTED_RECOVERY_KEYS = ["goalId"];
const EXPECTED_ENVELOPE_KEYS = ["goals", "recoveryItems", "skillOptions", "skillOptionsTruncated", "truncated"];
const EXPECTED_SKILL_OPTION_KEYS = ["name", "treeId"];

/** The C1/C2/roadmap guards whose allow-lists D1 must not need to edit (dimension 9). */
const OTHER_GUARD_FILES = [
  "src/features/skill-profiles/skill-profiles-scope-guard.test.ts",
  "src/features/team-skills/team-skills-scope-guard.test.ts",
  "src/features/roadmap/roadmap-scope-guard.test.ts",
];
const D1_MARKERS = ["personal-goals", "userDevelopment", "app/api/me/goals", "app/me/goals"];

/* ---------------------------------- scanners ---------------------------------- */

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const isD1Feature = (path: string) => path.startsWith(D1_DIR);
const isD1 = (path: string) => isD1Feature(path) || D1_ROUTE_DIRS.some((dir) => path.startsWith(dir));
const isGuarded = (path: string) => path !== GUARD_FILE;
const isD1Production = (path: string) => isGuarded(path) && isD1(path) && !isTest(path);

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*)(["'])([^"'\n]+)\1/g;
const RE_EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])([^"'\n]+)\1/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const moduleKey = (target: string) => target.replace(/\.(?:ts|tsx|js|mjs)$/, "").replace(/\/index$/, "");

function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return posix.normalize(specifier.slice(2));
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), specifier));
  return undefined;
}

/** All literal specifiers (named, default, side-effect, multi-line, dynamic, `require`, `vi.mock`, re-export `from`). */
function specifiers(file: SourceFile): { resolved: string[]; bare: string[] } {
  const resolved: string[] = [];
  const bare: string[] = [];
  for (const match of stripComments(file.text).matchAll(SPECIFIER)) {
    const target = resolveSpecifier(file.path, match[2]);
    if (target === undefined) bare.push(match[2]);
    else resolved.push(target);
  }
  return { resolved, bare };
}

function reExportTargets(file: SourceFile): string[] {
  const targets: string[] = [];
  for (const match of stripComments(file.text).matchAll(RE_EXPORT_FROM)) {
    const target = resolveSpecifier(file.path, match[2]);
    if (target !== undefined) targets.push(target);
  }
  return targets;
}

const COLLECTION_TOKEN = /\buserDevelopment\b/;

/** Dimension 1. Raw text (comments included, conservatively). */
function collectionReferenceViolations(files: SourceFile[]): string[] {
  const allowed = new Set([...APPROVED_COLLECTION_REFERENCES, ...APPROVED_WHEN_PRESENT_COLLECTION_REFERENCES]);
  return files.filter((f) => isGuarded(f.path) && COLLECTION_TOKEN.test(f.text) && !allowed.has(f.path)).map((f) => f.path);
}

/** Dimension 2: outside the feature, only the approved route/page files may import `personal-goals/server/**`. */
function serverImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && !isD1Feature(f.path) && !APPROVED_SERVER_IMPORTERS.includes(f.path))
    .filter((f) => specifiers(f).resolved.some((t) => t.startsWith(D1_SERVER_DIR)))
    .map((f) => f.path);
}

/** Dimension 2, store: module-level importer list (any file, including inside the feature). */
function storeImporterViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && specifiers(f).resolved.map(moduleKey).includes(STORE_MODULE) && !isApprovedStoreImporter(f.path))
    .map((f) => `${f.path} -> goal-store`);
}

/** Dimension 2, catalog: module-level importer list (any file, including inside the feature). */
function catalogImporterViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && specifiers(f).resolved.map(moduleKey).includes(CATALOG_MODULE) && !isApprovedCatalogImporter(f.path))
    .map((f) => `${f.path} -> skill-catalog`);
}

/** SI-8: the catalog seam is read-only; it makes no write, transaction or batch call. Lexical, comments stripped. */
const CATALOG_WRITE_CALL = /\.\s*(?:set|update|create|delete|add|runTransaction|batch|bulkWriter|recursiveDelete)\s*\(/;
function catalogWriteViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && f.path === `${CATALOG_MODULE}.ts` && CATALOG_WRITE_CALL.test(stripComments(f.text)))
    .map((f) => `${f.path}: write call`);
}

const FAKE_STORE_MODULE = "src/features/personal-goals/server/fake-goal-store";
/**
 * Dimension 2, fake: the in-memory fake is test support. Only test files inside the D1 feature may import it
 * (any path form, `vi.mock` included); production code, helpers and out-of-feature tests may not.
 */
function fakeStoreImporterViolations(files: SourceFile[]): string[] {
  return files
    .filter(
      (f) =>
        isGuarded(f.path) &&
        specifiers(f).resolved.map(moduleKey).includes(FAKE_STORE_MODULE) &&
        !(isTest(f.path) && isD1Feature(f.path)),
    )
    .map((f) => `${f.path} -> fake-goal-store`);
}

/** The fake must stay Firebase-free: it imports neither the Admin SDK nor the Admin initialisation module. */
function fakeStoreFirebaseViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && moduleKey(f.path) === FAKE_STORE_MODULE)
    .flatMap((f) => {
      const { resolved, bare } = specifiers(f);
      return [
        ...bare.filter((s) => s === "firebase-admin" || s.startsWith("firebase-admin/") || s === "server-only"),
        ...resolved.map(moduleKey).filter((t) => t.startsWith("src/lib/firebase/") || t === STORE_MODULE),
      ].map((s) => `${f.path}: ${s}`);
    });
}

/** Dimension 2: no `export … from` into `personal-goals/server/**` from anywhere (no barrel can launder the allow-list). */
function serverReExportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path))
    .flatMap((f) =>
      reExportTargets(f)
        .filter((t) => moduleKey(t).startsWith(D1_SERVER_DIR))
        .map((t) => `${f.path} re-exports ${moduleKey(t)}`),
    );
}

/** Dimension 2: a client component never imports D1 server modules (also inside the feature). */
function clientServerImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && /^(["'])use client\1/.test(stripComments(f.text).trimStart()))
    .filter((f) => specifiers(f).resolved.some((t) => moduleKey(t).startsWith(D1_SERVER_DIR)))
    .map((f) => f.path);
}

const HTTP_METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
/** HTTP method exports: `export [async] function|const|let|var X` and `export { h as X }` (also `export { X } from …`). */
function exportedMethods(text: string): string[] {
  const code = stripComments(text);
  const declared = [
    ...code.matchAll(new RegExp(`^export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var)\\s*(${HTTP_METHODS})\\b`, "gm")),
  ].map((m) => m[1]);
  const listed = [...code.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)]
    .flatMap((m) => m[1].split(","))
    .map((item) => item.trim().split(/\s+as\s+/).at(-1) ?? "")
    .filter((exported) => new RegExp(`^(?:${HTTP_METHODS})$`).test(exported));
  return [...new Set([...declared, ...listed])].sort();
}

/** The owner API surface: production files under `app/api/me/goals/` are exactly approved routes with the approved methods. */
function routeSurfaceViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && f.path.startsWith("app/api/me/goals/") && !isTest(f.path))
    .flatMap((f) => {
      const approved = APPROVED_ROUTE_METHODS[f.path];
      if (!approved) return [`${f.path}: unapproved route file`];
      const methods = exportedMethods(f.text);
      return methods.every((m) => approved.includes(m)) ? [] : [`${f.path}: methods ${methods.join(",")}`];
    });
}

/** Dimension 3: `collectionGroup` never appears in the D1 feature, and never beside goals/`userDevelopment` elsewhere. */
const COLLECTION_GROUP = /\bcollectionGroup\b/;
const GOALS_LITERAL = /["'`]goals["'`]/;
function collectionGroupViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && COLLECTION_GROUP.test(f.text))
    .filter((f) => isD1(f.path) || COLLECTION_TOKEN.test(f.text) || GOALS_LITERAL.test(f.text))
    .map((f) => f.path);
}

/** Dimension 4: no Firebase client SDK (`firebase`, `firebase/*`, `@firebase/*`) or client helper in any D1 file, tests included. */
function firebaseClientViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && isD1(f.path))
    .flatMap((f) => {
      const { resolved, bare } = specifiers(f);
      const out: string[] = [];
      for (const s of bare) if (s === "firebase" || s.startsWith("firebase/") || s.startsWith("@firebase/")) out.push(`${f.path}: ${s}`);
      for (const t of resolved) if (moduleKey(t) === "src/lib/firebase/client") out.push(`${f.path}: ${moduleKey(t)}`);
      return out;
    });
}

/** Dimension 5, imports: D1 production sources only (a test may legitimately import a fixture helper). */
function forbiddenImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD1Production(f.path))
    .flatMap((f) =>
      specifiers(f)
        .resolved.filter((t) => FORBIDDEN_IMPORT_PREFIXES.some((p) => t.startsWith(p)))
        .map((t) => `${f.path} -> ${t}`),
    );
}

/** Dimension 5, identifiers: D1 production sources, comments stripped (catches aliased imports of a forbidden name). */
function forbiddenIdentifierViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD1Production(f.path))
    .flatMap((f) => {
      const code = stripComments(f.text);
      return FORBIDDEN_IDENTIFIERS.filter((id) => new RegExp(`\\b${id}\\b`).test(code)).map((id) => `${f.path}: ${id}`);
    });
}

/**
 * A value that is only a primitive type name (optionally `[]`) ending at a type delimiter: `ownerUid: string`,
 * `ownerUid: string | null`, `ownerUid: string;`. A value merely STARTING with such a word (`Date.now()`,
 * `stringValue`, `String(v)`) is an expression, so the key is still reported.
 */
const TYPE_ANNOTATION_VALUE = String.raw`(?:string|number|boolean|unknown|Date)(?:\[\])?(?=\s*(?:[|&,;)}=\]>]|$))`;

/**
 * Dimension 6: BR-7 keys as object-literal keys (`key:`, `"key":`, computed `["key"]:`, shorthand `{ key }`) in
 * the store writer. Heuristic: `key: <primitive type name>` is read as a type annotation (the `ownerUid: string`
 * parameter every store function takes), not as a literal key. Dynamically built keys and spreads are not seen.
 * Once the store exists, the exact key tuple and the store-writer tests are the anchor; this scan is defence in depth.
 */
function storeWriterKeyViolations(files: SourceFile[]): string[] {
  const store = files.find((f) => f.path === `${STORE_MODULE}.ts`);
  if (!store) return [];
  const code = stripComments(store.text);
  return FORBIDDEN_PERSISTED_KEYS.filter((key) =>
    new RegExp(
      String.raw`(?:["'\`]${key}["'\`]\]?\s*:|(?<![.\w$])${key}\s*:(?!:)(?!\s*${TYPE_ANNOTATION_VALUE})|[{,]\s*${key}\s*(?=[,}]))`,
    ).test(code),
  ).map((key) => `${store.path}: ${key}`);
}

/** Dimension 6/7: set equality of a key list, independent of order. */
const keyMismatch = (actual: readonly string[], expected: readonly string[]): string[] => [
  ...actual.filter((k) => !expected.includes(k)).map((k) => `unexpected: ${k}`),
  ...expected.filter((k) => !actual.includes(k)).map((k) => `missing: ${k}`),
  ...(new Set(actual).size !== actual.length ? ["duplicate key"] : []),
];

/**
 * Member keys of `export interface <name> { … }`. The declaration form is pinned on purpose: no `extends`, no
 * generics, one `key: type;` member per line, closing brace at column 0. Anything else (a type alias, `extends`,
 * an index or method signature, two members on one line) yields "not found" or `<unparsed: …>`, so it fails closed.
 */
function interfaceKeys(text: string, name: string): string[] | undefined {
  const code = stripComments(text);
  const header = new RegExp(`export interface ${name}\\s*\\{`).exec(code);
  if (!header) return undefined;
  const open = header.index + header[0].length;
  const close = code.indexOf("\n}", open);
  if (close === -1) return undefined;
  return code
    .slice(open, close)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const member = /^(?:readonly\s+)?(?:([A-Za-z_$][\w$]*)|"([^"]+)")\??\s*:[^;]*;?$/.exec(line);
      return member ? (member[1] ?? member[2]) : `<unparsed: ${line}>`;
    });
}

/** Dimension 7: the declared interfaces equal the expected key sets (recovery DTO is exactly `{ goalId }`). */
function dtoInterfaceViolations(files: SourceFile[]): string[] {
  const goal = files.find((f) => f.path === `${D1_DIR}domain/goal.ts`);
  if (!goal) return ["domain/goal.ts missing"];
  const expectations: Array<[string, string[]]> = [
    ["GoalDto", EXPECTED_DTO_KEYS],
    ["GoalRecoveryDto", EXPECTED_RECOVERY_KEYS],
    ["SkillOptionDto", EXPECTED_SKILL_OPTION_KEYS],
    ["GoalListResponse", EXPECTED_ENVELOPE_KEYS],
  ];
  return expectations.flatMap(([name, expected]) => {
    const keys = interfaceKeys(goal.text, name);
    return keys === undefined ? [`${name}: not found`] : keyMismatch(keys, expected).map((m) => `${name} ${m}`);
  });
}

/** Dimension 8: words of identifiers/strings in D1 production sources (copy.ts excluded, comments stripped). */
function conceptWords(code: string): string {
  return [...code.matchAll(/[A-Za-z][A-Za-z0-9]*/g)]
    .flatMap((m) =>
      m[0]
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(" "),
    )
    .join(" ");
}
function forbiddenConceptViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD1Production(f.path) && !NAME_SCAN_EXCLUDED.includes(f.path))
    .flatMap((f) => {
      const code = stripComments(f.text);
      const words = ` ${conceptWords(code)} `;
      const out = FORBIDDEN_CONCEPT_WORDS.filter((w) => words.includes(` ${w} `)).map((w) => `${f.path}: ${w}`);
      for (const phrase of FORBIDDEN_CONCEPT_PHRASES) if (words.includes(` ${phrase} `)) out.push(`${f.path}: ${phrase}`);
      if (/dangerouslySetInnerHTML/.test(code)) out.push(`${f.path}: dangerouslySetInnerHTML`);
      return out;
    });
}

/** Subject boundary (heuristic): D1 routes/operations never read an owner id from the request. */
const REQUEST_OWNER_ID =
  /\b(?:body|payload|params|query|input|request|req)\s*(?:\??\.|\[\s*["'])\s*(?:uid|ownerUid)\b|["'`](?:uid|ownerUid)["'`]|\bsearchParams\b/;
function requestOwnerIdViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD1Production(f.path) && (f.path.startsWith(D1_SERVER_DIR) || f.path.startsWith("app/api/me/goals/")))
    .filter((f) => REQUEST_OWNER_ID.test(stripComments(f.text)))
    .map((f) => f.path);
}

/** Dimension 9: none of the other guards names a D1 file, collection or route. */
function otherGuardViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => OTHER_GUARD_FILES.includes(f.path))
    .flatMap((f) => D1_MARKERS.filter((m) => f.text.includes(m)).map((m) => `${f.path}: ${m}`));
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
const SRV = D1_SERVER_DIR;

/* ----------------------------------- tests ----------------------------------- */

describe("D1 scope guard — sanity", () => {
  it("scans the real tree and finds the D1 domain files", () => {
    expect(realFiles.some((f) => f.path === `${D1_DIR}domain/goal.ts`)).toBe(true);
    expect(realFiles.some((f) => f.path === GUARD_FILE)).toBe(true);
  });
});

describe("D1 scope guard — collection identifier (dimension 1)", () => {
  it("only the approved files reference the collection identifier", () => {
    expect(collectionReferenceViolations(realFiles)).toEqual([]);
  });

  it("fails for an unapproved file or a sibling of the store, and allows the store and the rules pin", () => {
    expect(
      collectionReferenceViolations([
        virtual(`${SRV}list-goals.ts`, `db.collection("userDevelopment")`),
        virtual(`${SRV}fake-goal-store.ts`, `const c = "userDevelopment";`),
        virtual("src/features/team-skills/server/x.ts", `// userDevelopment\nconst c = 1;`),
        virtual("app/api/admin/goals/route.ts", `doc("userDevelopment/u1")`),
        virtual(`${SRV}goal-store.ts`, `db.collection("userDevelopment")`),
        virtual("src/lib/firebase/firestore-deployment-config.test.ts", `/userDevelopment/`),
      ]),
    ).toEqual([
      `${SRV}list-goals.ts`,
      `${SRV}fake-goal-store.ts`,
      "src/features/team-skills/server/x.ts",
      "app/api/admin/goals/route.ts",
    ]);
  });

  it("keeps the D2 neighbours of the approved persistence files out of the exact allow-list", () => {
    // TASK-005 approved two exact D2 files. Each neighbour below carries the same protected namespace and must still fail.
    const D2_SRV = "src/features/development-conversations/server/";
    expect(
      collectionReferenceViolations([
        virtual(`${D2_SRV}conversation-store-contract.test.ts`, `const p = "userDevelopment/o/conversations/c";`),
        virtual(`${D2_SRV}conversation-store-test-support.ts`, `const p = "userDevelopment";`),
        virtual(`${D2_SRV}conversation-store.ts`, `const p = "userDevelopment";`),
        virtual(`${D2_SRV}fake-conversation-store.ts`, `const p = "userDevelopment";`),
      ]),
    ).toEqual([
      `${D2_SRV}conversation-store-contract.test.ts`,
      `${D2_SRV}conversation-store-test-support.ts`,
      `${D2_SRV}conversation-store.ts`,
      `${D2_SRV}fake-conversation-store.ts`,
    ]);
  });
});

describe("D1 scope guard — importer allow-list (dimension 2)", () => {
  it("passes on the real tree", () => {
    expect(serverImportViolations(realFiles)).toEqual([]);
    expect(storeImporterViolations(realFiles)).toEqual([]);
    expect(catalogImporterViolations(realFiles)).toEqual([]);
    expect(catalogWriteViolations(realFiles)).toEqual([]);
    expect(fakeStoreImporterViolations(realFiles)).toEqual([]);
    expect(fakeStoreFirebaseViolations(realFiles)).toEqual([]);
    expect(serverReExportViolations(realFiles)).toEqual([]);
    expect(clientServerImportViolations(realFiles)).toEqual([]);
    expect(routeSurfaceViolations(realFiles)).toEqual([]);
  });

  it("fails for team, admin, C1, C2, roadmap, forum, challenge or unrelated /me code importing D1 server modules", () => {
    const line = (rel: string) => `import { x } from "${rel}";`;
    expect(
      serverImportViolations([
        virtual("src/features/teams/server/a.ts", line("../../personal-goals/server/get-personal-goals")),
        virtual("app/api/admin/b/route.ts", line("../../../../src/features/personal-goals/server/goal-store")),
        virtual("src/features/skill-profiles/server/c.ts", line("@/src/features/personal-goals/server/get-personal-goals")),
        virtual("src/features/team-skills/server/d.ts", `import type { X } from '../../personal-goals/server/skill-catalog';`),
        virtual("src/features/roadmap/server/e.ts", `const m = await import("../../personal-goals/server/get-personal-goals");`),
        virtual("src/features/forum/server/f.ts", `import {\n  a,\n  b,\n} from "../../personal-goals/server/get-personal-goals.ts";`),
        virtual("src/features/challenges/server/g.ts", `vi.mock("../../personal-goals/server/goal-store");`),
        virtual("app/api/me/skills/route.ts", line("../../../../src/features/personal-goals/server/get-personal-goals")),
        virtual("app/api/me/goals/export/route.ts", line("../../../../../src/features/personal-goals/server/get-personal-goals")),
        virtual("src/features/results/server/ok.ts", line("../../personal-goals/domain/goal")),
      ]),
    ).toEqual([
      "src/features/teams/server/a.ts",
      "app/api/admin/b/route.ts",
      "src/features/skill-profiles/server/c.ts",
      "src/features/team-skills/server/d.ts",
      "src/features/roadmap/server/e.ts",
      "src/features/forum/server/f.ts",
      "src/features/challenges/server/g.ts",
      "app/api/me/skills/route.ts",
      "app/api/me/goals/export/route.ts",
    ]);
  });

  it("accepts exactly the approved route and page files", () => {
    const line = `import { getPersonalGoals } from "@/src/features/personal-goals/server/get-personal-goals";`;
    expect(serverImportViolations(APPROVED_SERVER_IMPORTERS.map((p) => virtual(p, line)))).toEqual([]);
  });

  it("admits the D2 snapshot seam as the only D2 importer of D1 goal server code, for the store and the store module alone", () => {
    const snapshot = "src/features/development-conversations/server/read-owned-goal-snapshots.ts";
    const storeLine = `import { getDefaultGoalStore } from "../../personal-goals/server/goal-store";`;
    expect(serverImportViolations([virtual(snapshot, storeLine)])).toEqual([]);
    expect(storeImporterViolations([virtual(snapshot, storeLine)])).toEqual([]);
    const second = "src/features/development-conversations/server/second-snapshot.ts";
    expect(serverImportViolations([virtual(second, storeLine)])).toEqual([second]);
    expect(storeImporterViolations([virtual(second, storeLine)])).toEqual([`${second} -> goal-store`]);
  });

  it("restricts the store module to the operations, the fake and their tests, by any path form", () => {
    expect(
      storeImporterViolations([
        virtual(`${SRV}get-personal-goals.ts`, `import { s } from "./goal-store";`),
        virtual(`${SRV}create-personal-goal.test.ts`, `import { s } from "./goal-store.ts";`),
        virtual(`${SRV}update-personal-goal-clock.test.ts`, `import { s } from "./goal-store";`),
        virtual(`${SRV}fake-goal-store.ts`, `import type { S } from "./goal-store";`),
        virtual(`${SRV}skill-catalog.ts`, `import { s } from "./goal-store";`),
        virtual(`${SRV}get-personal-goals-extra.ts`, `import { s } from "./goal-store";`),
        virtual(`${SRV}delete-personal-goalX.test.ts`, `import { s } from "./goal-store";`),
        virtual("app/api/me/goals/route.ts", `import { s } from "../../../../src/features/personal-goals/server/goal-store/index";`),
        virtual("src/features/teams/server/t.ts", `import { s } from "@/src/features/personal-goals/server/goal-store";`),
      ]),
    ).toEqual([
      `${SRV}skill-catalog.ts -> goal-store`,
      `${SRV}get-personal-goals-extra.ts -> goal-store`,
      `${SRV}delete-personal-goalX.test.ts -> goal-store`,
      "app/api/me/goals/route.ts -> goal-store",
      "src/features/teams/server/t.ts -> goal-store",
    ]);
  });

  it("restricts the catalog seam to the operations and its test, by any path form", () => {
    expect(
      catalogImporterViolations([
        virtual(`${SRV}get-personal-goals.ts`, `import { readSkillOptions } from "./skill-catalog";`),
        virtual(`${SRV}update-personal-goal.ts`, `import { readSkillTreeName } from "./skill-catalog.ts";`),
        virtual(`${SRV}skill-catalog.test.ts`, `import { readSkillOptions } from "./skill-catalog";`),
        virtual(`${SRV}get-personal-goals.test.ts`, `import { x } from "./skill-catalog";`),
        virtual(`${SRV}delete-personal-goal.ts`, `import { x } from "./skill-catalog";`),
        virtual(`${SRV}delete-personal-goal.test.ts`, `import { x } from "./skill-catalog";`),
        virtual(`${SRV}delete-personal-goal-extra.test.ts`, `import { x } from "./skill-catalog";`),
        virtual(`${SRV}goal-store.ts`, `import { x } from "./skill-catalog";`),
        virtual(`${SRV}fake-goal-store.ts`, `import { x } from "./skill-catalog/index";`),
        virtual("app/api/me/goals/route.ts", `import { x } from "@/src/features/personal-goals/server/skill-catalog";`),
        virtual("src/features/team-skills/server/t.ts", `import { x } from "../../personal-goals/server/skill-catalog";`),
        virtual("src/features/skill-profiles/server/c.test.ts", `vi.mock("../../personal-goals/server/skill-catalog");`),
      ]),
    ).toEqual([
      `${SRV}delete-personal-goal.ts -> skill-catalog`,
      `${SRV}delete-personal-goal.test.ts -> skill-catalog`,
      `${SRV}delete-personal-goal-extra.test.ts -> skill-catalog`,
      `${SRV}goal-store.ts -> skill-catalog`,
      `${SRV}fake-goal-store.ts -> skill-catalog`,
      "app/api/me/goals/route.ts -> skill-catalog",
      "src/features/team-skills/server/t.ts -> skill-catalog",
      "src/features/skill-profiles/server/c.test.ts -> skill-catalog",
    ]);
  });

  it("keeps the catalog seam read-only, and detects write calls in it only", () => {
    const catalog = (code: string) => virtual(`${CATALOG_MODULE}.ts`, code);
    expect(catalogWriteViolations([catalog(`const s = await trees().doc(id).get(); // .set(x)`)])).toEqual([]);
    for (const code of [`ref.set({ a: 1 })`, `ref.update({})`, `ref.delete()`, `col.add({})`, `db.runTransaction(f)`, `db.batch()`, `ref\n  .create(x)`]) {
      expect(catalogWriteViolations([catalog(code)]), code).toEqual([`${CATALOG_MODULE}.ts: write call`]);
    }
    expect(catalogWriteViolations([virtual(`${SRV}goal-store.ts`, `ref.set({})`)])).toEqual([]);
  });

  it("lets only D1 feature tests import the fake store, by any path form", () => {
    expect(
      fakeStoreImporterViolations([
        virtual(`${SRV}get-personal-goals.test.ts`, `import { createFakeGoalStore } from "./fake-goal-store";`),
        virtual(`${SRV}fake-goal-store.test.ts`, `import { createFakeGoalStore } from "./fake-goal-store.ts";`),
        virtual(`${SRV}get-personal-goals.ts`, `import { createFakeGoalStore } from "./fake-goal-store";`),
        virtual(`${SRV}goal-store.ts`, `import { createFakeGoalStore } from "@/src/features/personal-goals/server/fake-goal-store";`),
        virtual(`${SRV}test-support.ts`, `import type { X } from "./fake-goal-store";`),
        virtual("app/api/me/goals/route.ts", `import { f } from "../../../../src/features/personal-goals/server/fake-goal-store";`),
        virtual("app/api/me/goals/route.test.ts", `vi.mock("../../../../src/features/personal-goals/server/fake-goal-store");`),
        virtual("src/features/teams/server/t.test.ts", `const m = await import("../../personal-goals/server/fake-goal-store");`),
        virtual("src/features/personal-goals/components/Goals.test.tsx", `import { f } from "../server/fake-goal-store/index";`),
      ]),
    ).toEqual([
      `${SRV}get-personal-goals.ts -> fake-goal-store`,
      `${SRV}goal-store.ts -> fake-goal-store`,
      `${SRV}test-support.ts -> fake-goal-store`,
      "app/api/me/goals/route.ts -> fake-goal-store",
      "app/api/me/goals/route.test.ts -> fake-goal-store",
      "src/features/teams/server/t.test.ts -> fake-goal-store",
    ]);
  });

  it("keeps the fake store free of Firebase and of the real store", () => {
    expect(
      fakeStoreFirebaseViolations([
        virtual(`${SRV}fake-goal-store.ts`, `import "server-only";\nimport { Timestamp } from "firebase-admin/firestore";\nimport { getFirestoreDb } from "../../../lib/firebase/admin";\nimport { s } from "./goal-store";`),
        virtual(`${SRV}goal-store.ts`, `import { Timestamp } from "firebase-admin/firestore";`),
      ]),
    ).toEqual([
      `${SRV}fake-goal-store.ts: server-only`,
      `${SRV}fake-goal-store.ts: firebase-admin/firestore`,
      `${SRV}fake-goal-store.ts: src/lib/firebase/admin`,
      `${SRV}fake-goal-store.ts: ${STORE_MODULE}`,
    ]);
    expect(
      fakeStoreFirebaseViolations([
        virtual(`${SRV}fake-goal-store.ts`, `import { toStoredGoalData } from "../domain/goal";\nimport type { GoalStore } from "./goal-store-types";`),
      ]),
    ).toEqual([]);
  });

  it("fails for named, renamed, star, namespace, type and multi-line re-exports into the D1 server directory", () => {
    expect(
      serverReExportViolations([
        virtual("src/features/personal-goals/index.ts", `export * from "./server/get-personal-goals";`),
        virtual("src/features/teams/barrel.ts", `export { a as b } from "../personal-goals/server/goal-store";`),
        virtual("src/features/teams/ns.ts", `export * as g from "@/src/features/personal-goals/server/goal-store";`),
        virtual("src/features/teams/ty.ts", `export type { X } from "../personal-goals/server/get-personal-goals";`),
        virtual("src/features/teams/multi.ts", `export {\n  a,\n  b as c,\n} from "../personal-goals/server/skill-catalog.ts";`),
        virtual("src/features/teams/fine.ts", `export { y } from "../personal-goals/domain/goal"; // export * from "../personal-goals/server/a"`),
      ]),
    ).toEqual([
      `src/features/personal-goals/index.ts re-exports ${SRV}get-personal-goals`,
      `src/features/teams/barrel.ts re-exports ${SRV}goal-store`,
      `src/features/teams/ns.ts re-exports ${SRV}goal-store`,
      `src/features/teams/ty.ts re-exports ${SRV}get-personal-goals`,
      `src/features/teams/multi.ts re-exports ${SRV}skill-catalog`,
    ]);
  });

  it("a client module cannot import D1 server modules", () => {
    expect(
      clientServerImportViolations([
        virtual("src/features/personal-goals/components/GoalsPage.tsx", `"use client";\nimport { x } from "../server/get-personal-goals";`),
        virtual("src/features/personal-goals/components/Ok.tsx", `"use client";\nimport { x } from "../client/goals-gateway";`),
        virtual("src/features/personal-goals/server/server-side.ts", `import { x } from "./get-personal-goals";`),
      ]),
    ).toEqual(["src/features/personal-goals/components/GoalsPage.tsx"]);
  });

  it("detects non-async, let/var, listed, aliased and HEAD/OPTIONS method exports but not other route exports", () => {
    expect(exportedMethods(`export function PUT() {}`)).toEqual(["PUT"]);
    expect(exportedMethods(`export let POST = h;\nexport var GET = g;`)).toEqual(["GET", "POST"]);
    expect(exportedMethods(`const h = 1;\nexport { h as PUT, other };`)).toEqual(["PUT"]);
    expect(exportedMethods(`export { DELETE } from "./x";`)).toEqual(["DELETE"]);
    expect(exportedMethods(`export async function HEAD() {}\nexport function OPTIONS() {}`)).toEqual(["HEAD", "OPTIONS"]);
    expect(exportedMethods(`export const dynamic = "force-dynamic";\nexport const runtime = "nodejs";\n// export function PUT() {}`)).toEqual([]);
    expect(routeSurfaceViolations([virtual("app/api/me/goals/route.ts", `export function PUT() {}`)])).toEqual([
      "app/api/me/goals/route.ts: methods PUT",
    ]);
  });

  it("the owner API surface is exactly the approved routes with the approved methods; any other route fails", () => {
    expect(
      routeSurfaceViolations([
        virtual("app/api/me/goals/route.ts", `export async function GET() {}\nexport const POST = 1;`),
        virtual("app/api/me/goals/[goalId]/route.ts", `export async function PATCH() {}\nexport async function DELETE() {}`),
        virtual("app/api/me/goals/[goalId]/route.test.ts", `export const PUT = 1;`),
      ]),
    ).toEqual([]);
    expect(
      routeSurfaceViolations([
        virtual("app/api/me/goals/route.ts", `export async function GET() {}\nexport async function DELETE() {}`),
        virtual("app/api/me/goals/[goalId]/route.ts", `export async function PUT() {}`),
        virtual("app/api/me/goals/export/route.ts", `export async function GET() {}`),
        virtual("app/api/me/goals/helper.ts", `export const x = 1;`),
      ]),
    ).toEqual([
      "app/api/me/goals/route.ts: methods DELETE,GET",
      "app/api/me/goals/[goalId]/route.ts: methods PUT",
      "app/api/me/goals/export/route.ts: unapproved route file",
      "app/api/me/goals/helper.ts: unapproved route file",
    ]);
  });
});

describe("D1 scope guard — no collectionGroup (dimension 3)", () => {
  it("passes on the real tree", () => {
    expect(collectionGroupViolations(realFiles)).toEqual([]);
  });

  it("fails inside the D1 feature in any form, and elsewhere only beside goals or the collection", () => {
    expect(
      collectionGroupViolations([
        virtual(`${SRV}a.ts`, `db.collectionGroup("goals").get()`),
        virtual(`${SRV}b.ts`, `import { collectionGroup as cg } from "x"; cg(db, "anything");`),
        virtual(`${SRV}c.ts`, `const f = db["collectionGroup"]; f("g");`),
        virtual("app/me/goals/page.tsx", `db.collectionGroup("x")`),
        virtual("src/features/teams/server/d.ts", `db.collectionGroup("goals")`),
        virtual("src/features/teams/server/e.ts", `db.collectionGroup("g"); const c = "userDevelopment";`),
        virtual("src/features/teams/server/ok.ts", `db.collectionGroup("teamMemberships")`),
        virtual("src/features/teams/server/ok2.ts", `db.collection("goals")`),
      ]),
    ).toEqual([
      `${SRV}a.ts`,
      `${SRV}b.ts`,
      `${SRV}c.ts`,
      "app/me/goals/page.tsx",
      "src/features/teams/server/d.ts",
      "src/features/teams/server/e.ts",
    ]);
  });
});

describe("D1 scope guard — no client Firestore (dimension 4)", () => {
  it("passes on the real tree", () => {
    expect(firebaseClientViolations(realFiles)).toEqual([]);
  });

  it("fails for the client SDK, @firebase packages and the app client helper in production or tests, but not the Admin SDK", () => {
    expect(
      firebaseClientViolations([
        virtual(`${SRV}a.ts`, `import { getFirestore } from "firebase/firestore";`),
        virtual(`${D1_DIR}components/B.tsx`, `import {\n  collection,\n} from 'firebase/firestore/lite';`),
        virtual(`${SRV}c.test.ts`, `import { x } from "@firebase/app";`),
        virtual(`${D1_DIR}client/d.ts`, `import { getFirebaseAuth } from "../../../lib/firebase/client";`),
        virtual("app/me/goals/page.tsx", `import { y } from "@/src/lib/firebase/client";`),
        virtual(`${SRV}ok.ts`, `import { FieldValue } from "firebase-admin/firestore";\nimport { getFirestoreDb } from "../../../lib/firebase/admin";`),
        virtual("src/features/teams/client/other.ts", `import { x } from "firebase/auth";`),
      ]),
    ).toEqual([
      `${SRV}a.ts: firebase/firestore`,
      `${D1_DIR}components/B.tsx: firebase/firestore/lite`,
      `${SRV}c.test.ts: @firebase/app`,
      `${D1_DIR}client/d.ts: src/lib/firebase/client`,
      "app/me/goals/page.tsx: src/lib/firebase/client",
    ]);
  });
});

describe("D1 scope guard — forbidden imports and identifiers (dimension 5)", () => {
  it("D1 production sources import no C1, team, roadmap, C2 or skill-trees/server code and name no forbidden identifier", () => {
    expect(forbiddenImportViolations(realFiles)).toEqual([]);
    expect(forbiddenIdentifierViolations(realFiles)).toEqual([]);
  });

  it("fails for skill-profiles (any layer), team authorization/membership, roadmap, team-skills and skill-trees/server imports", () => {
    expect(
      forbiddenImportViolations([
        virtual(`${SRV}a.ts`, `import { ${BATCH_READER} } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual(`${D1_DIR}domain/b.ts`, `import type { S } from "@/src/features/skill-profiles/domain/skill-profile";`),
        virtual(`${SRV}c.ts`, `import { authorizeTeamAccess } from "../../teams/server/authorize-team-access";`),
        virtual(`${SRV}d.ts`, `import { m } from "../../teams/server/membership";`),
        virtual(`${SRV}e.ts`, `import { r } from "../../roadmap/server/list-roadmap-items";`),
        virtual(`${SRV}f.ts`, `import { t } from "../../team-skills/server/get-team-skill-coverage";`),
        virtual(`${SRV}g.ts`, `export * from "../../skill-trees/server/update-team-skill-progress";`),
        virtual("app/api/me/goals/route.ts", `import {\n  x,\n} from "../../../../src/features/teams/server/authorize-team-access";`),
        virtual(`${SRV}ok.ts`, `import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";`),
        virtual(`${SRV}ok.test.ts`, `import { x } from "../../teams/server/fixtures";`),
        virtual("src/features/results/server/unrelated.ts", `import { a } from "../../teams/server/authorize-team-access";`),
      ]),
    ).toEqual([
      `${SRV}a.ts -> src/features/skill-profiles/server/read-skill-levels-batch`,
      `${D1_DIR}domain/b.ts -> src/features/skill-profiles/domain/skill-profile`,
      `${SRV}c.ts -> src/features/teams/server/authorize-team-access`,
      `${SRV}d.ts -> src/features/teams/server/membership`,
      `${SRV}e.ts -> src/features/roadmap/server/list-roadmap-items`,
      `${SRV}f.ts -> src/features/team-skills/server/get-team-skill-coverage`,
      `${SRV}g.ts -> src/features/skill-trees/server/update-team-skill-progress`,
      "app/api/me/goals/route.ts -> src/features/teams/server/authorize-team-access",
    ]);
  });

  it("allows the shared SkillTree domain predicate in the catalog seam but still rejects C1 profile persistence, batch readers, C1 catalog and C2 coverage", () => {
    const catalog = (code: string) => virtual(`${CATALOG_MODULE}.ts`, code);
    expect(forbiddenImportViolations([catalog(`import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";`)])).toEqual([]);
    expect(
      forbiddenImportViolations([
        catalog(`import { ${BATCH_READER} } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual(`${SRV}skill-catalog-extra.ts`, `import { s } from "../../skill-profiles/server/skill-profile-store";`),
        virtual(`${SRV}other.ts`, `import { readSkillCatalog } from "../../skill-profiles/server/skill-catalog";`),
        virtual(`${SRV}cov.ts`, `import { c } from "../../team-skills/server/get-team-skill-coverage";`),
      ]),
    ).toEqual([
      `${CATALOG_MODULE}.ts -> src/features/skill-profiles/server/read-skill-levels-batch`,
      `${SRV}skill-catalog-extra.ts -> src/features/skill-profiles/server/skill-profile-store`,
      `${SRV}other.ts -> src/features/skill-profiles/server/skill-catalog`,
      `${SRV}cov.ts -> src/features/team-skills/server/get-team-skill-coverage`,
    ]);
    expect(forbiddenIdentifierViolations([catalog(`db.collection("${SKILL_PROFILES}")`)])).toEqual([`${CATALOG_MODULE}.ts: ${SKILL_PROFILES}`]);
  });

  it("fails for forbidden identifiers (including aliases) in production code, not in comments, tests or look-alike names", () => {
    expect(
      forbiddenIdentifierViolations([
        virtual(`${SRV}a.ts`, `const r = await requireAppAdmin(req);`),
        virtual(`${SRV}b.ts`, `import { resolveTeamRole as role } from "x"; role();`),
        virtual(`${SRV}c.ts`, `db.collection("${SKILL_PROFILES}"); db.collection("teamMemberships");`),
        virtual(`${SRV}d.ts`, `export const roadmapItems = 1; const skillProgress = 2; const ${TEAM_SKILL_NEEDS} = 3;`),
        virtual(`${SRV}e.ts`, `if (isAppAdmin(u) || authorizeTeamAccess(u)) {}`),
        virtual(`${SRV}ok.ts`, `// never calls authorizeTeamAccess\n/* ${SKILL_PROFILES} */ const myskillProgressX = 1;`),
        virtual(`${SRV}ok.test.ts`, `expect(authorizeTeamAccess).not.toHaveBeenCalled();`),
        virtual("src/features/teams/server/other.ts", `authorizeTeamAccess()`),
      ]),
    ).toEqual([
      `${SRV}a.ts: requireAppAdmin`,
      `${SRV}b.ts: resolveTeamRole`,
      `${SRV}c.ts: ${SKILL_PROFILES}`,
      `${SRV}c.ts: teamMemberships`,
      `${SRV}d.ts: skillProgress`,
      `${SRV}d.ts: roadmapItems`,
      `${SRV}d.ts: ${TEAM_SKILL_NEEDS}`,
      `${SRV}e.ts: authorizeTeamAccess`,
      `${SRV}e.ts: isAppAdmin`,
    ]);
  });
});

describe("D1 scope guard — persisted keys (dimension 6)", () => {
  it("the persisted-key tuple equals the BR-6 set", () => {
    expect(keyMismatch(GOAL_PERSISTED_KEYS, EXPECTED_PERSISTED_KEYS)).toEqual([]);
  });

  it("detects an added, removed or duplicated persisted key", () => {
    expect(keyMismatch([...GOAL_PERSISTED_KEYS, "ownerUid"], EXPECTED_PERSISTED_KEYS)).toEqual(["unexpected: ownerUid"]);
    expect(keyMismatch(GOAL_PERSISTED_KEYS.filter((k) => k !== "treeId"), EXPECTED_PERSISTED_KEYS)).toEqual(["missing: treeId"]);
    expect(keyMismatch([...GOAL_PERSISTED_KEYS, "title"], EXPECTED_PERSISTED_KEYS)).toEqual(["duplicate key"]);
  });

  it("the store writer (once present) names no BR-7 key as an object key", () => {
    expect(storeWriterKeyViolations(realFiles)).toEqual([]);
  });

  it("flags BR-7 keys in the store writer in key, quoted, shorthand and multi-line forms, but not parameters or member access", () => {
    const store = (code: string) => virtual(`${STORE_MODULE}.ts`, code);
    expect(
      storeWriterKeyViolations([
        store(`const data = { title, uid: ownerUid, "email": e, role,\n  teamId: t, description: d };`),
      ]),
    ).toEqual([
      `${STORE_MODULE}.ts: uid`,
      `${STORE_MODULE}.ts: email`,
      `${STORE_MODULE}.ts: teamId`,
      `${STORE_MODULE}.ts: role`,
      `${STORE_MODULE}.ts: description`,
    ]);
    expect(
      storeWriterKeyViolations([
        store(`async function create(ownerUid: string) { return db.collection("c").doc(ownerUid).set({ title, status, createdAt, updatedAt }); }\n// uid: x`),
      ]),
    ).toEqual([]);
    expect(storeWriterKeyViolations([store(`set({ ownerUid: ownerUid, uid: "x" })`)])).toEqual([
      `${STORE_MODULE}.ts: uid`,
      `${STORE_MODULE}.ts: ownerUid`,
    ]);
    expect(storeWriterKeyViolations([virtual(`${SRV}other.ts`, `{ uid: 1 }`)])).toEqual([]);
  });

  it("does not let a value that merely starts with a type word, or a computed literal key, hide a BR-7 key", () => {
    const store = (code: string) => virtual(`${STORE_MODULE}.ts`, code);
    const flagged = [
      `set({ ownerUid: value })`,
      `set({ ownerUid: someString })`,
      `set({ ownerUid: String(value) })`,
      `set({ ownerUid: input.ownerUid })`,
      `set({ ownerUid: c ? a : b })`,
      `set({ ownerUid: undefined })`,
      `set({\n  ownerUid:\n    value\n})`,
      `set({ "ownerUid": value })`,
      `set({ ["ownerUid"]: value })`,
      `set({ ['ownerUid']: value })`,
      `set({ ownerUid })`,
      `set({ title, ownerUid })`,
      `set({ ownerUid: Date.now() })`,
      `set({ ownerUid: stringValue })`,
      `set({ ownerUid: numberOfX })`,
      `set({ ownerUid: unknownUid })`,
    ];
    for (const code of flagged) expect(storeWriterKeyViolations([store(code)]), code).toEqual([`${STORE_MODULE}.ts: ownerUid`]);
    const benign = [
      `async function f(ownerUid: string) {}`,
      `async function f(ownerUid?: string) {}`,
      `interface A { readonly ownerUid: string }`,
      `interface B {\n  ownerUid: string;\n}`,
      `type C = { ownerUid: string | null };`,
      `function g(opts: { ownerUid: string; limit: number }) {}`,
      `function h(opts: { ownerUid: string, limit: number }) {}`,
      `const k: { ownerUid: string[] } = x;`,
      `const v = input.ownerUid;`,
    ];
    for (const code of benign) expect(storeWriterKeyViolations([store(code)]), code).toEqual([]);
  });
});

describe("D1 scope guard — DTO, recovery DTO and envelope keys (dimension 7)", () => {
  it("the exported key tuples equal the SPEC sets", () => {
    expect(keyMismatch(GOAL_DTO_KEYS, EXPECTED_DTO_KEYS)).toEqual([]);
    expect(keyMismatch(GOAL_RECOVERY_DTO_KEYS, EXPECTED_RECOVERY_KEYS)).toEqual([]);
    expect(keyMismatch(GOAL_LIST_RESPONSE_KEYS, EXPECTED_ENVELOPE_KEYS)).toEqual([]);
  });

  it("the declared interfaces equal the SPEC sets, and the recovery DTO is distinct from GoalDto", () => {
    expect(dtoInterfaceViolations(realFiles)).toEqual([]);
    const types: { dto: keyof GoalDto; recovery: keyof GoalRecoveryDto; option: keyof SkillOptionDto; envelope: keyof GoalListResponse } = {
      dto: "areaAvailable",
      recovery: "goalId",
      option: "name",
      envelope: "skillOptionsTruncated",
    };
    expect(types.recovery).toBe("goalId");
    expect(EXPECTED_RECOVERY_KEYS).not.toEqual(EXPECTED_DTO_KEYS);
  });

  it("fails when the recovery DTO acquires content, or GoalDto/envelope/option keys change", () => {
    const goal = (extra: { recovery?: string; dto?: string; envelope?: string; option?: string }) =>
      virtual(
        `${D1_DIR}domain/goal.ts`,
        [
          `export interface GoalDto {\n  id: string;\n  title: string;\n  status: GoalStatus;\n  treeId: string | null;\n  areaName: string | null;\n  areaAvailable: boolean;\n  targetDate: string | null;\n  createdAt: string;\n  updatedAt: string;\n  completedAt: string | null;\n${extra.dto ?? ""}}`,
          `export interface GoalRecoveryDto {\n  goalId: string;\n${extra.recovery ?? ""}}`,
          `export interface SkillOptionDto {\n  treeId: string;\n  name: string;\n${extra.option ?? ""}}`,
          `export interface GoalListResponse {\n  goals: GoalDto[];\n  recoveryItems: GoalRecoveryDto[];\n  truncated: boolean;\n  skillOptions: SkillOptionDto[];\n  skillOptionsTruncated: boolean;\n${extra.envelope ?? ""}}`,
        ].join("\n"),
      );
    expect(dtoInterfaceViolations([goal({})])).toEqual([]);
    expect(dtoInterfaceViolations([goal({ recovery: "  title: string;\n  status?: string;\n  treeId: string;\n  createdAt: string;\n" })])).toEqual([
      "GoalRecoveryDto unexpected: title",
      "GoalRecoveryDto unexpected: status",
      "GoalRecoveryDto unexpected: treeId",
      "GoalRecoveryDto unexpected: createdAt",
    ]);
    expect(dtoInterfaceViolations([goal({ dto: "  ownerUid: string;\n" })])).toEqual(["GoalDto unexpected: ownerUid"]);
    expect(dtoInterfaceViolations([goal({ envelope: "  total: number;\n" })])).toEqual(["GoalListResponse unexpected: total"]);
    expect(dtoInterfaceViolations([goal({ option: "  level: number;\n" })])).toEqual(["SkillOptionDto unexpected: level"]);
    expect(dtoInterfaceViolations([goal({ recovery: "  readonly title: string;\n" })])).toEqual(["GoalRecoveryDto unexpected: title"]);
    expect(dtoInterfaceViolations([goal({ recovery: '  "title": string;\n' })])).toEqual(["GoalRecoveryDto unexpected: title"]);
    expect(dtoInterfaceViolations([goal({ recovery: "  [key: string]: unknown;\n" })])).toEqual([
      "GoalRecoveryDto unexpected: <unparsed: [key: string]: unknown;>",
    ]);
    expect(dtoInterfaceViolations([goal({ recovery: "  targetDate: string | null; other: string;\n" })])).toEqual([
      "GoalRecoveryDto unexpected: <unparsed: targetDate: string | null; other: string;>",
    ]);
    expect(dtoInterfaceViolations([goal({ recovery: "  title(): string;\n" })])).toEqual([
      "GoalRecoveryDto unexpected: <unparsed: title(): string;>",
    ]);
    const base = goal({}).text;
    const goalFile = (text: string) => virtual(`${D1_DIR}domain/goal.ts`, text);
    expect(
      dtoInterfaceViolations([goalFile(base.replace("export interface GoalRecoveryDto {", "export interface GoalRecoveryDto extends GoalDto {"))]),
    ).toEqual(["GoalRecoveryDto: not found"]);
    expect(
      dtoInterfaceViolations([
        goalFile(base.replace("export interface GoalRecoveryDto {\n  goalId: string;\n}", "export type GoalRecoveryDto = { goalId: string; title: string };")),
      ]),
    ).toEqual(["GoalRecoveryDto: not found"]);
    expect(dtoInterfaceViolations([virtual(`${D1_DIR}domain/goal.ts`, `export interface GoalDto {\n  id: string;\n}`)])).toEqual(
      expect.arrayContaining(["GoalRecoveryDto: not found", "GoalDto missing: title"]),
    );
  });
});

describe("D1 scope guard — forbidden concepts and subject boundary (dimension 8)", () => {
  it("D1 production sources contain no forbidden concept and read no owner id from a request", () => {
    expect(forbiddenConceptViolations(realFiles)).toEqual([]);
    expect(requestOwnerIdViolations(realFiles)).toEqual([]);
  });

  it("flags sharing, consent, ranking, scoring, percentage, overdue and raw HTML in identifiers and strings", () => {
    expect(
      forbiddenConceptViolations([
        virtual(`${SRV}a.ts`, `export const sharedWith = [];`),
        virtual(`${SRV}b.ts`, `const goal_score = 1; const totalPercentage = 2;`),
        virtual(`${D1_DIR}components/C.tsx`, `<div dangerouslySetInnerHTML={{ __html: t }} />`),
        virtual(`${SRV}d.ts`, `const isOverdue = (d: string) => true; const consentGiven = 1;`),
        virtual(`${SRV}e.ts`, `const leadReader = 1; const progressScore = 2; const adminReader = 3;`),
        virtual(`${SRV}f.ts`, `const label = "ranking";`),
      ]),
    ).toEqual([
      `${SRV}a.ts: shared`,
      `${SRV}b.ts: score`,
      `${SRV}b.ts: percentage`,
      `${D1_DIR}components/C.tsx: dangerouslySetInnerHTML`,
      `${SRV}d.ts: consent`,
      `${SRV}d.ts: overdue`,
      `${SRV}e.ts: score`,
      `${SRV}e.ts: lead reader`,
      `${SRV}e.ts: admin reader`,
      `${SRV}e.ts: progress score`,
      `${SRV}f.ts: ranking`,
    ]);
  });

  it("splits acronym boundaries and snake_case; unrelated compound words stay benign", () => {
    expect(
      forbiddenConceptViolations([
        virtual(`${SRV}a.ts`, `const HTTPScore = 1;`),
        virtual(`${SRV}b.ts`, `const manager_score = 1; const ManagerView = 2;`),
        virtual(`${SRV}c.ts`, `const progressBar = 1; const sharePoint = 2;`),
        virtual(`${SRV}d.ts`, `const scoreboardless = 1; const userId = 2;`),
      ]),
    ).toEqual([`${SRV}a.ts: score`, `${SRV}b.ts: score`, `${SRV}b.ts: manager`, `${SRV}c.ts: share`]);
  });

  it("does not flag look-alike words, comments, tests or the copy file", () => {
    expect(
      forbiddenConceptViolations([
        virtual(`${SRV}a.ts`, `const underscore = 1; const sharedness = 2; const scoreboardless = 3;`),
        virtual(`${SRV}b.ts`, `// never shared, no ranking, no score\n/* overdue */ export const ok = 1;`),
        virtual(`${SRV}c.test.ts`, `it("has no score or sharing", () => {});`),
        virtual(`${D1_DIR}copy.ts`, `export const t = "Aldri delt eller sharing score";`),
        virtual("src/features/results/server/aggregate-score.ts", `const score = 1;`),
      ]),
    ).toEqual([]);
  });

  it("flags a request-supplied owner id in routes and operations, but not a verified-token uid", () => {
    expect(
      requestOwnerIdViolations([
        virtual("app/api/me/goals/route.ts", `const { uid } = await requireUser(request); const id = body.ownerUid;`),
        virtual(`${SRV}a.ts`, `const o = input["uid"];`),
        virtual(`${SRV}b.ts`, `const o = params.uid;`),
        virtual("app/api/me/goals/[goalId]/route.ts", `const q = new URL(request.url).searchParams.get("uid");`),
        virtual(`${SRV}c.ts`, `async function f(ownerUid: string) { return db.doc(ownerUid); }`),
        virtual("app/api/me/goals/ok/route.ts", `const { uid } = await requireUser(request);`),
        virtual(`${D1_DIR}domain/d.ts`, `const x = body.uid;`),
      ]),
    ).toEqual(["app/api/me/goals/route.ts", `${SRV}a.ts`, `${SRV}b.ts`, "app/api/me/goals/[goalId]/route.ts"]);
  });
});

describe("D1 scope guard — no other guard weakened (dimension 9)", () => {
  it("the C1, C2 and roadmap guards exist and do not name any D1 file, collection or route", () => {
    for (const path of OTHER_GUARD_FILES) expect(realFiles.some((f) => f.path === path), path).toBe(true);
    expect(otherGuardViolations(realFiles)).toEqual([]);
  });

  it("flags a guard that gained a D1 allow-list entry", () => {
    expect(
      otherGuardViolations([
        virtual(OTHER_GUARD_FILES[0], `const APPROVED = ["src/features/personal-goals/server/x.ts"];`),
        virtual(OTHER_GUARD_FILES[1], `"userDevelopment"`),
        virtual(OTHER_GUARD_FILES[2], `const ok = 1;`),
        virtual("src/features/other/other-guard.test.ts", `"userDevelopment"`),
      ]),
    ).toEqual([`${OTHER_GUARD_FILES[0]}: personal-goals`, `${OTHER_GUARD_FILES[1]}: userDevelopment`]);
  });
});
