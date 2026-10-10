import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static scope/privacy guard for Team Skill Needs and Matrix (C2, TASK-017, SPEC BR-34).
 *
 * It is a CHANGE-DETECTION layer, not the security boundary. It makes an unexpected reader, writer,
 * importer, response field, cache or copy token in C2 visible so that it needs a deliberate, reviewed
 * allow-list edit. Every allow-list below is an EXACT list of files (or exact statements); nothing is
 * approved by directory, and a sibling or helper of an approved file is never implicitly approved.
 * The C1 guard (`skill-profiles-scope-guard.test.ts`) remains the owner of the importer maps for
 * `skill-profile-store` and `read-skill-levels-batch`; this guard only re-checks the C2 side and asserts
 * that both guards name the same approved coverage module (no second, contradictory definition).
 *
 * It does NOT prove: runtime behavior, authorization or threshold correctness (operation, route and
 * privacy-matrix tests own those); dynamically built collection names or module paths; import aliases
 * other than `@/`; code outside `src/` and `app/`; Admin-credential access; JSX text content (only string
 * literals and `copy.ts` are scanned for copy tokens). The scanners are lexical (regex over comment-stripped
 * text), not a TypeScript parser; they fail closed where they cannot resolve something, but a determined
 * author can evade them. Code review remains the check for those cases.
 *
 * Structure: pure scanner functions run over (a) the real tree and (b) virtual negative fixtures. This file
 * is excluded from every scan of the real tree because it necessarily contains the tokens it searches for.
 */

const ROOT = process.cwd();
const GUARD_FILE = "src/features/team-skills/team-skills-scope-guard.test.ts";
const C1_GUARD_FILE = "src/features/skill-profiles/skill-profiles-scope-guard.test.ts";
const C2_DIR = "src/features/team-skills/";
const C1_DIR = "src/features/skill-profiles/";
const C1_SERVER_DIR = "src/features/skill-profiles/server/";

interface SourceFile {
  path: string;
  text: string;
}

/* ------------------------------ approved exact lists ------------------------------ */

/** The one production module allowed to consume personal skill data (identity-stripped adapter only). */
const COVERAGE_MODULE = `${C2_DIR}server/get-team-skill-coverage.ts`;
const COVERAGE_TEST = /^src\/features\/team-skills\/server\/get-team-skill-coverage[^/]*\.test\.ts$/;
const BATCH_MODULE = `${C1_SERVER_DIR}read-skill-levels-batch`;
const STORE_MODULE = `${C1_SERVER_DIR}skill-profile-store`;
/** C1 write operations: no C2 file may import them. */
const C1_WRITE_OPERATIONS = ["set-own-skill-level", "clear-own-skill-level", "delete-own-skill-profile"].map(
  (name) => `${C1_SERVER_DIR}${name}`,
);

/** The exact production C2 route files and the operation modules each may import (nothing else). */
const C2_ROUTE_IMPORTS: Record<string, string[]> = {
  "app/api/teams/[teamId]/skill-contribution/route.ts": [
    "get-own-skill-contribution",
    "set-own-skill-contribution",
    "withdraw-own-skill-contribution",
  ],
  "app/api/teams/[teamId]/skill-coverage/route.ts": ["get-team-skill-coverage"],
  "app/api/teams/[teamId]/skill-needs/[treeId]/route.ts": ["delete-skill-need", "upsert-skill-need"],
  "app/api/teams/[teamId]/skill-needs/route.ts": ["list-skill-needs"],
};
const C2_ROUTE_METHODS: Record<string, string[]> = {
  "app/api/teams/[teamId]/skill-contribution/route.ts": ["DELETE", "GET", "PUT"],
  "app/api/teams/[teamId]/skill-coverage/route.ts": ["GET"],
  "app/api/teams/[teamId]/skill-needs/[treeId]/route.ts": ["DELETE", "PUT"],
  "app/api/teams/[teamId]/skill-needs/route.ts": ["GET"],
};
const C2_ROUTE_PATH = /^app\/api\/teams\/\[teamId\]\/skill-(?:needs|contribution|coverage)\//;
const COVERAGE_ROUTE = "app/api/teams/[teamId]/skill-coverage/route.ts";

/** Exact production importers of the two persistence modules (tests inside `team-skills/` are not listed). */
const STORE_IMPORTERS: Record<string, string[]> = {
  [`${C2_DIR}server/skill-needs-store`]: [
    `${C2_DIR}server/delete-skill-need.ts`,
    `${C2_DIR}server/get-team-skill-coverage.ts`,
    `${C2_DIR}server/list-skill-needs.ts`,
    `${C2_DIR}server/upsert-skill-need.ts`,
  ],
  [`${C2_DIR}server/skill-contribution-store`]: [
    `${C2_DIR}server/get-own-skill-contribution.ts`,
    `${C2_DIR}server/get-team-skill-coverage.ts`,
    `${C2_DIR}server/set-own-skill-contribution.ts`,
    `${C2_DIR}server/withdraw-own-skill-contribution.ts`,
  ],
};

/** Exact production files (anywhere in `src/` and `app/`) naming each protected identifier. */
const SKILL_NEEDS_COLLECTION_FILES = [`${C2_DIR}server/skill-needs-store.ts`];
const SKILL_NEEDS_COLLECTION_TEST_FILES = [
  "app/api/teams/[teamId]/skill-needs/[treeId]/route.test.ts",
  "src/features/team-skills/server/participation-non-exposure.test.ts",
  "src/features/team-skills/server/skill-needs-store.test.ts",
  "src/features/team-skills/server/skill-needs-write-store.test.ts",
  "src/features/skill-profiles/skill-profiles-cross-cutting.test.ts", // asserts C1 code never names it
  "src/features/skill-profiles/skill-profiles-scope-guard.test.ts", // C1 forbidden-identifier list
  "src/lib/firebase/firestore-deployment-config.test.ts", // the rules/config pin
];
const SKILL_CONTRIBUTION_FIELD_FILES = [`${C2_DIR}domain/skill-contribution.ts`];
const SKILL_CONTRIBUTION_FIELD_TEST_FILES = [
  "app/api/teams/[teamId]/skill-contribution/route.test.ts",
  "src/features/team-skills/domain/skill-contribution.test.ts",
  "src/features/team-skills/server/get-team-skill-coverage-privacy.test.ts",
  "src/features/team-skills/server/get-team-skill-coverage.test.ts",
  "src/features/team-skills/server/participation-boundary.test.ts",
  "src/features/team-skills/server/participation-non-exposure.test.ts",
];

/** Exact production consumers of membership-owned participation state, by exported identifier. */
const PARTICIPATION_CONSUMERS: Record<string, string[]> = {
  SKILL_CONTRIBUTION_FIELD: [
    `${C2_DIR}domain/skill-contribution.ts`,
    `${C2_DIR}server/skill-contribution-store.ts`,
    `${C2_DIR}server/withdraw-own-skill-contribution.ts`, // owner-only: checks presence on the caller's own membership
  ],
  listMembershipsForCoverage: [`${C2_DIR}server/get-team-skill-coverage.ts`, `${C2_DIR}server/skill-contribution-store.ts`],
  isEffectiveSkillContribution: [
    `${C2_DIR}domain/skill-contribution.ts`,
    `${C2_DIR}server/get-own-skill-contribution.ts`,
    `${C2_DIR}server/get-team-skill-coverage.ts`,
  ],
};

/** Exact production modules that may use the Admin SDK wrapper / write to Firestore. */
const ADMIN_DB_MODULES = [
  `${C2_DIR}server/genuine-team-membership.ts`,
  `${C2_DIR}server/skill-contribution-store.ts`,
  `${C2_DIR}server/skill-need-catalog.ts`,
  `${C2_DIR}server/skill-needs-store.ts`,
];
/** The only write statements in C2 production code (trimmed, whole line). */
const APPROVED_WRITE_STATEMENTS: Record<string, string[]> = {
  [`${C2_DIR}server/skill-needs-store.ts`]: [
    "tx.set(db.collection(SKILL_NEEDS_COLLECTION).doc(docId), record);",
    "tx.delete(db.collection(SKILL_NEEDS_COLLECTION).doc(docId));",
  ],
  [`${C2_DIR}server/skill-contribution-store.ts`]: [
    "tx.update(membershipRef(uid, teamId), { [SKILL_CONTRIBUTION_FIELD]: record });",
    "tx.update(membershipRef(uid, teamId), { [SKILL_CONTRIBUTION_FIELD]: FieldValue.delete() });",
  ],
};
/** Collections C2 production code may address. `skillProfiles`, `skillProgress`, `roadmapItems` are deliberately absent. */
const ALLOWED_COLLECTIONS = ["teams", "teamMemberships", "teamSkillNeeds", "skillTrees"];

/** Closed allow-list of cross-feature imports for C2 `server/` and `domain/` production files. */
const CROSS_FEATURE_IMPORTS: Array<{ prefix: string; only?: string[] }> = [
  { prefix: "src/features/auth/server/verify-identity" },
  { prefix: "src/features/skill-profiles/domain/" },
  { prefix: "src/features/skill-trees/domain/" },
  { prefix: "src/features/teams/domain/" },
  { prefix: "src/features/teams/server/authorize-team-access", only: [`${C2_DIR}server/list-skill-needs.ts`] },
  { prefix: BATCH_MODULE, only: [COVERAGE_MODULE] },
  { prefix: "src/lib/firebase/admin", only: ADMIN_DB_MODULES },
];
/** Client-side C2 code (components/client): never these. */
const FORBIDDEN_CLIENT_PREFIXES = [
  `${C2_DIR}server/`,
  C1_SERVER_DIR,
  "src/features/teams/server/",
  "src/features/skill-trees/server/",
  "src/features/roadmap/",
  "src/lib/firebase/admin",
];

/** Exact seam call each operation must make (BR-5/BR-18); write operations must use the lead seam. */
const REQUIRED_SEAM: Record<string, string> = {
  [`${C2_DIR}server/upsert-skill-need.ts`]: "requireGenuineLead(",
  [`${C2_DIR}server/delete-skill-need.ts`]: "requireGenuineLead(",
  [`${C2_DIR}server/set-own-skill-contribution.ts`]: "requireGenuineMember(",
  [`${C2_DIR}server/get-team-skill-coverage.ts`]: "requireGenuineMember(",
  [`${C2_DIR}server/get-own-skill-contribution.ts`]: "resolveGenuineTeamMembership(",
  [`${C2_DIR}server/withdraw-own-skill-contribution.ts`]: "resolveGenuineTeamMembership(",
  [`${C2_DIR}server/list-skill-needs.ts`]: "resolveGenuineTeamMembership(",
};
const NEED_WRITE_OPERATIONS = [`${C2_DIR}server/upsert-skill-need.ts`, `${C2_DIR}server/delete-skill-need.ts`];

/* ---------------------------------- scanners ---------------------------------- */

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*)(["'])([^"'\n]+)\1/g;
const RE_EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])([^"'\n]+)\1/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const moduleKey = (target: string) => target.replace(/\.(?:ts|tsx|js|mjs)$/, "").replace(/\/index$/, "");
const isGuarded = (path: string) => path !== GUARD_FILE;
const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const isC2Route = (path: string) => C2_ROUTE_PATH.test(path);
const isC2 = (path: string) => path.startsWith(C2_DIR) || isC2Route(path);
const isC2Production = (path: string) => isGuarded(path) && isC2(path) && !isTest(path);
const isCoverageConsumer = (path: string) => path === COVERAGE_MODULE || COVERAGE_TEST.test(path);

/** Literal specifiers of one file (comments ignored): bare ones as-is, relative / `@/` ones repo-resolved. */
function specifiers(file: SourceFile): { resolved: string[]; bare: string[] } {
  const resolved: string[] = [];
  const bare: string[] = [];
  for (const match of stripComments(file.text).matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[2];
    if (specifier.startsWith("@/")) resolved.push(moduleKey(posix.normalize(specifier.slice(2))));
    else if (specifier.startsWith(".")) resolved.push(moduleKey(posix.normalize(posix.join(posix.dirname(file.path), specifier))));
    else bare.push(specifier);
  }
  return { resolved, bare };
}
const resolvedOf = (file: SourceFile) => specifiers(file).resolved;

function reExportTargets(file: SourceFile): string[] {
  const out: string[] = [];
  for (const match of stripComments(file.text).matchAll(RE_EXPORT_FROM)) {
    out.push(...resolvedOf({ path: file.path, text: `from "${match[2]}"` }));
  }
  return out;
}

const c2Files = (files: SourceFile[]) => files.filter((f) => isGuarded(f.path) && isC2(f.path));

/* (1) personal data: no collection naming, no store/raw reader, no C1 writes ------------------------- */

const PERSONAL_COLLECTION = /\bskillProfiles\b/;
const PROGRESS_OR_ROADMAP = /\b(?:skillProgress|roadmapItems)\b/;
const RAW_READER = /\breadSkillProfilesBatch\b/;
const ADAPTER = /\breadSkillLevelsBatch\b/;

function personalDataViolations(files: SourceFile[]): string[] {
  return c2Files(files).flatMap((file) => {
    const out: string[] = [];
    if (PERSONAL_COLLECTION.test(file.text)) out.push(`${file.path}: names skillProfiles`);
    if (RAW_READER.test(file.text)) out.push(`${file.path}: raw batch reader identifier`);
    if (ADAPTER.test(file.text) && !isCoverageConsumer(file.path)) out.push(`${file.path}: adapter identifier outside approved caller`);
    const code = stripComments(file.text);
    if (!isTest(file.path) && PROGRESS_OR_ROADMAP.test(code)) out.push(`${file.path}: skillProgress/roadmapItems`);
    for (const target of resolvedOf(file)) {
      if (target === STORE_MODULE) out.push(`${file.path}: imports skill-profile-store`);
      else if (C1_WRITE_OPERATIONS.includes(target)) out.push(`${file.path}: imports C1 write operation ${posix.basename(target)}`);
      else if (target.startsWith(C1_SERVER_DIR) && target !== BATCH_MODULE) out.push(`${file.path}: imports unapproved ${target}`);
      else if (target === BATCH_MODULE && !isCoverageConsumer(file.path)) out.push(`${file.path}: imports the batch adapter`);
    }
    for (const target of reExportTargets(file)) {
      if (target.startsWith(C1_DIR)) out.push(`${file.path}: re-exports ${target}`);
    }
    return out;
  });
}

/** Barrels: a C2 production file may not re-export anything (it would widen an importer set invisibly). */
function c2ReExportViolations(files: SourceFile[]): string[] {
  return files.filter((f) => isC2Production(f.path) && reExportTargets(f).length > 0).map((f) => f.path);
}

/* (2) client/server boundary --------------------------------------------------------------------- */

const isUseClient = (file: SourceFile) => /^(["'])use client\1/.test(stripComments(file.text).trimStart());
const isClientSide = (file: SourceFile) =>
  isUseClient(file) || file.path.startsWith(`${C2_DIR}components/`) || file.path.startsWith(`${C2_DIR}client/`);

function boundaryViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isC2Production(f.path) && f.path.startsWith(C2_DIR))
    .flatMap((file) => {
      const { resolved, bare } = specifiers(file);
      const out: string[] = [];
      if (isClientSide(file)) {
        for (const target of resolved) {
          if (FORBIDDEN_CLIENT_PREFIXES.some((p) => target.startsWith(p))) out.push(`${file.path}: client imports ${target}`);
        }
        if (bare.some((s) => s.startsWith("firebase-admin") || s === "server-only")) out.push(`${file.path}: client imports a server-only package`);
      }
      if (file.path.startsWith(`${C2_DIR}domain/`) && (resolved.some((t) => t.includes("/server/")) || bare.some((s) => s.startsWith("firebase")))) {
        out.push(`${file.path}: domain depends on server/firebase`);
      }
      if (file.path.startsWith(`${C2_DIR}server/`) && !stripComments(file.text).trimStart().startsWith('import "server-only";')) {
        out.push(`${file.path}: missing server-only`);
      }
      return out;
    });
}

/** No Firebase client SDK (`firebase/*`, `@firebase/*`) in any C2 file, tests included. */
function firebaseClientViolations(files: SourceFile[]): string[] {
  return c2Files(files)
    .filter((f) => specifiers(f).bare.some((s) => s === "firebase" || s.startsWith("firebase/") || s.startsWith("@firebase/")))
    .map((f) => f.path);
}

/* (3) importer maps for persistence modules, exact consumers of participation state ---------------- */

/** Anything outside `team-skills/` and outside the exact C2 route map importing `team-skills/server/**` fails. */
function outsideImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && !f.path.startsWith(C2_DIR))
    .flatMap((file) => {
      const targets = resolvedOf(file).filter((t) => t.startsWith(`${C2_DIR}server/`));
      if (targets.length === 0) return [];
      const allowed = (C2_ROUTE_IMPORTS[file.path] ?? []).map((name) => `${C2_DIR}server/${name}`);
      const isRouteTest = isC2Route(file.path) && isTest(file.path);
      return targets.filter((t) => !isRouteTest && !allowed.includes(t)).map((t) => `${file.path} -> ${t}`);
    });
}

/** Exact production importer sets of the two persistence modules (inside and outside C2); tests are not production importers. */
function storeImporterMismatches(files: SourceFile[]): string[] {
  return Object.entries(STORE_IMPORTERS).flatMap(([module, expected]) => {
    const actual = files
      .filter((f) => isGuarded(f.path) && !isTest(f.path) && resolvedOf(f).includes(module))
      .map((f) => f.path)
      .sort();
    return [
      ...actual.filter((p) => !expected.includes(p)).map((p) => `unexpected importer of ${posix.basename(module)}: ${p}`),
      ...expected.filter((p) => !actual.includes(p)).map((p) => `missing importer of ${posix.basename(module)}: ${p}`),
    ];
  });
}

/** Test files outside `team-skills/` and the C2 routes may not import a persistence module either. */
function outsideStoreTestViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && isTest(f.path) && !isC2(f.path))
    .filter((f) => resolvedOf(f).some((t) => t in STORE_IMPORTERS))
    .map((f) => f.path);
}

function identifierSetMismatches(files: SourceFile[], identifier: RegExp, expected: string[], label: string): string[] {
  const actual = files
    .filter((f) => isGuarded(f.path) && !isTest(f.path) && identifier.test(stripComments(f.text)))
    .map((f) => f.path)
    .sort();
  return [
    ...actual.filter((p) => !expected.includes(p)).map((p) => `unexpected ${label}: ${p}`),
    ...expected.filter((p) => !actual.includes(p)).map((p) => `missing ${label}: ${p}`),
  ];
}

function testReferenceMismatches(files: SourceFile[], identifier: RegExp, allowed: string[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && isTest(f.path) && identifier.test(f.text) && !allowed.includes(f.path))
    .map((f) => `unexpected test reference: ${f.path}`);
}

/* (4) write boundary, collections, Admin SDK, aggregate persistence ---------------------------------- */

const WRITE_CALL = /\.(?:set|update|delete|create|commit|batch|bulkWriter)\(|\)\s*\.add\(/;
const COLLECTION_CALL = /\.(collection|collectionGroup)\(\s*([^)]*?)\s*\)/g;

function writeViolations(files: SourceFile[]): string[] {
  const production = files.filter((f) => isC2Production(f.path) && f.path.startsWith(C2_DIR));
  const out: string[] = [];
  for (const file of production) {
    const approved = APPROVED_WRITE_STATEMENTS[file.path] ?? [];
    const lines = stripComments(file.text)
      .split("\n")
      .map((l) => l.trim());
    const found = lines.filter((l) => WRITE_CALL.test(l));
    for (const line of found) if (!approved.includes(line)) out.push(`${file.path}: unapproved write call: ${line}`);
    for (const line of approved) if (!found.includes(line)) out.push(`${file.path}: approved write missing: ${line}`);
    if (/\bFieldValue\b/.test(file.text) && file.path !== `${C2_DIR}server/skill-contribution-store.ts`) out.push(`${file.path}: FieldValue outside the participation store`);
    if (/\bfirebase-admin\b/.test(stripComments(file.text)) && file.path !== `${C2_DIR}server/skill-contribution-store.ts`) out.push(`${file.path}: imports firebase-admin`);
  }
  return out;
}

function collectionViolations(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const file of files.filter((f) => isC2Production(f.path))) {
    const code = stripComments(file.text);
    const constants = new Map<string, string>();
    for (const m of code.matchAll(/\bconst\s+([A-Z_]*COLLECTION[A-Z_]*)\s*=\s*(["'])([^"']+)\2/g)) constants.set(m[1], m[3]);
    for (const m of code.matchAll(COLLECTION_CALL)) {
      const argument = m[2];
      const literal = /^(["'])([^"']+)\1$/.exec(argument)?.[2] ?? constants.get(argument);
      if (m[1] === "collectionGroup" || literal === undefined || !ALLOWED_COLLECTIONS.includes(literal)) {
        out.push(`${file.path}: collection(${argument}) is not an approved collection`);
      }
    }
    for (const [name, value] of constants) {
      if (!ALLOWED_COLLECTIONS.includes(value)) out.push(`${file.path}: ${name} = "${value}" is not an approved collection`);
    }
  }
  return out;
}

function adminDbViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isC2Production(f.path) && !ADMIN_DB_MODULES.includes(f.path))
    .filter((f) => resolvedOf(f).some((t) => t.startsWith("src/lib/firebase/admin")))
    .map((f) => f.path);
}

/** Closed cross-feature import list for C2 `server/` and `domain/` production files. */
function crossFeatureImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isC2Production(f.path) && (f.path.startsWith(`${C2_DIR}server/`) || f.path.startsWith(`${C2_DIR}domain/`)))
    .flatMap((file) =>
      resolvedOf(file)
        .filter((t) => !t.startsWith(C2_DIR))
        .filter((t) => {
          const rule = CROSS_FEATURE_IMPORTS.find((r) => t.startsWith(r.prefix));
          return !rule || (rule.only !== undefined && !rule.only.includes(file.path));
        })
        .map((t) => `${file.path} -> ${t}`),
    );
}

/* (5) authorization seam --------------------------------------------------------------------------- */

const FORBIDDEN_AUTH_IDENTIFIER = /\b(?:resolveTeamRole|isAppAdmin|requireAppAdmin|allowList|authorizeTeamAccess)\b/;

function authorizationViolations(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const file of files.filter((f) => isC2Production(f.path) && f.path.startsWith(C2_DIR))) {
    const code = stripComments(file.text);
    // `authorizeTeamAccess` (and the `allowList` seam it takes) is the need-READ decision only (list-skill-needs.ts);
    // nothing else may name any of these.
    const scanned = file.path === `${C2_DIR}server/list-skill-needs.ts` ? code.replace(/\b(?:authorizeTeamAccess|allowList)\b/g, "") : code;
    const hit = FORBIDDEN_AUTH_IDENTIFIER.exec(scanned);
    if (hit) out.push(`${file.path}: ${hit[0]}`);
  }
  for (const [path, seam] of Object.entries(REQUIRED_SEAM)) {
    const file = files.find((f) => f.path === path);
    if (!file) out.push(`${path}: missing operation`);
    else if (!stripComments(file.text).includes(seam)) out.push(`${path}: does not call ${seam}`);
  }
  for (const path of NEED_WRITE_OPERATIONS) {
    const file = files.find((f) => f.path === path);
    if (file && /\brequireGenuineMember\(|\bresolveGenuineTeamMembership\(/.test(stripComments(file.text))) out.push(`${path}: need write uses a non-lead seam`);
  }
  return out;
}

/* (6) routes -------------------------------------------------------------------------------------- */

function exportedMethods(text: string): string[] {
  return [...stripComments(text).matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)].map((m) => m[1]).sort();
}

function routeViolations(files: SourceFile[]): string[] {
  const out: string[] = [];
  const routes = files.filter((f) => isGuarded(f.path) && isC2Route(f.path) && !isTest(f.path));
  const expected = Object.keys(C2_ROUTE_IMPORTS).sort();
  const actual = routes.map((f) => f.path).sort();
  for (const p of actual.filter((p) => !expected.includes(p))) out.push(`${p}: unapproved C2 route file`);
  for (const route of routes.filter((r) => expected.includes(r.path))) {
    const { resolved, bare } = specifiers(route);
    const allowed = C2_ROUTE_IMPORTS[route.path].map((name) => `${C2_DIR}server/${name}`);
    for (const t of resolved) if (!allowed.includes(t)) out.push(`${route.path}: imports ${t}`);
    for (const b of bare) if (b !== "next/server") out.push(`${route.path}: imports ${b}`);
    if (exportedMethods(route.text).join() !== C2_ROUTE_METHODS[route.path].join()) out.push(`${route.path}: method surface changed`);
    const code = stripComments(route.text);
    for (const m of code.matchAll(/headers\.get\(\s*([^)]*)\)/g)) if (m[1] !== '"authorization"') out.push(`${route.path}: reads header ${m[1]}`);
    if (/\b(?:revalidate|dynamic\s*=|unstable_cache|force-static)\b|["']use cache["']/.test(code)) out.push(`${route.path}: caching directive`);
  }
  for (const p of expected.filter((p) => !actual.includes(p))) out.push(`${p}: approved route missing`);
  return out;
}

/** The coverage route reads only the path teamId and the bearer header, and holds no aggregation logic. */
function coverageRouteViolations(files: SourceFile[]): string[] {
  const route = files.find((f) => f.path === COVERAGE_ROUTE);
  if (!route) return [];
  const code = stripComments(route.text);
  const out: string[] = [];
  if (/\b(?:searchParams|nextUrl|URLSearchParams|request\.url|req\.url|\.url\b)/.test(code)) out.push(`${route.path}: reads the URL / query string`);
  if (/\.(?:json|text|formData|arrayBuffer|blob)\(\)|\bcookies\b|\bheaders\(\)/.test(code)) out.push(`${route.path}: reads body/cookies`);
  if (/\b(?:deriveCoverageState|SKILL_COVERAGE_MIN_CONTRIBUTORS|reduce)\b|\.length\b|\.filter\(/.test(code)) out.push(`${route.path}: aggregation logic`);
  return out;
}

/* (7) DTO key sets and field names ------------------------------------------------------------------ */

const FORBIDDEN_FIELD =
  /^(?:uid|userId|email|displayName|name_?uid|memberRef|membershipId|count|\w*Count|average|avg|rank|ranking|score|percent\w*|distribution|min|max|timestamp|consentedAt|noticeVersion|\w+At)$/;
const COVERAGE_ROW_KEYS = ["areaName", "requiredCoverage", "requiredLevel", "state", "treeId"];

function propertyNames(block: string): string[] {
  return [...block.matchAll(/(?:^|[\n{;,])\s*(?:readonly\s+)?([A-Za-z_]\w*)\??\s*:/g)].map((m) => m[1]);
}

function declarationBody(code: string, header: RegExp): string | undefined {
  const start = code.search(header);
  if (start < 0) return undefined;
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open, i + 1);
  }
  return undefined;
}

/** Text of one exported `interface` / `type` declaration: to the closing brace, or to the first top-level `;`. */
function declarationText(code: string, start: number): string {
  const isInterface = code.startsWith("export interface", start);
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (isInterface && depth === 0 && c === "}") return code.slice(start, i + 1);
    } else if (c === ";" && depth === 0 && !isInterface) return code.slice(start, i);
  }
  return code.slice(start);
}

function dtoViolations(files: SourceFile[]): string[] {
  const out: string[] = [];
  const coverageModule = files.find((f) => f.path === COVERAGE_MODULE);
  if (coverageModule) {
    const code = stripComments(coverageModule.text);
    const row = declarationBody(code, /export interface SkillCoverageRow\b/);
    const rowKeys = row ? propertyNames(row).sort() : [];
    if (rowKeys.join() !== COVERAGE_ROW_KEYS.join()) out.push(`${coverageModule.path}: SkillCoverageRow keys ${rowKeys.join(",") || "(none)"}`);
    const responseStart = code.indexOf("export type SkillCoverageResponse");
    const response = responseStart < 0 ? "" : code.slice(responseStart, code.indexOf(";\n", responseStart));
    const responseKeys = [...new Set([...response.matchAll(/(\w+)\s*:/g)].map((m) => m[1]))].sort();
    if (responseKeys.join() !== "availability,rows") out.push(`${coverageModule.path}: SkillCoverageResponse keys ${responseKeys.join(",") || "(none)"}`);
  }
  const route = files.find((f) => f.path === COVERAGE_ROUTE);
  if (route) {
    const code = stripComments(route.text);
    const mapped = [...code.matchAll(/(\w+):\s*row\.(\w+)/g)].filter((m) => m[1] === m[2]).map((m) => m[1]).sort();
    if (mapped.join() !== COVERAGE_ROW_KEYS.join() || !/availability:\s*result\.availability/.test(code)) out.push(`${route.path}: response is not the field-by-field allow-list`);
  }
  // Response-bearing types: every declared property name in C2 operation/route response declarations.
  for (const file of files.filter((f) => isC2Production(f.path) && (f.path.startsWith(`${C2_DIR}server/`) || isC2Route(f.path)))) {
    const code = stripComments(file.text);
    const blocks = [...code.matchAll(/export (?:interface|type) \w+/g)].map((m) => declarationText(code, m.index));
    for (const name of blocks.flatMap(propertyNames)) {
      if (FORBIDDEN_FIELD.test(name)) out.push(`${file.path}: response type declares ${name}`);
    }
  }
  return out;
}

/* (8) copy ----------------------------------------------------------------------------------------- */

const COPY_FORBIDDEN =
  /\b(?:rank\w*|rangering\w*|rangert|score\w*|poeng\w*|prosent\w*|gjennomsnitt\w*|svak\w*|sterk\w*|ytelse\w*|prestasjon\w*|performance|toppliste\w*|leaderboard)\b|%/i;

function stringLiterals(text: string): string[] {
  return [...stripComments(text).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** `copy.ts` and component string literals; "anonym" is allowed only in a negated sentence ("ikke …"). */
function copyViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isC2Production(f.path) && (f.path === `${C2_DIR}copy.ts` || f.path.startsWith(`${C2_DIR}components/`)))
    .flatMap((file) =>
      stringLiterals(file.text).flatMap((literal) => {
        const out: string[] = [];
        const hit = COPY_FORBIDDEN.exec(literal);
        if (hit && !/^[\w./-]+$/.test(literal)) out.push(`${file.path}: "${hit[0]}"`);
        if (/anonym/i.test(literal) && !/\bikke\b/i.test(literal)) out.push(`${file.path}: unqualified "anonym"`);
        return out;
      }),
    );
}

/* (9) no persisted aggregate, cache, env/config ---------------------------------------------------- */

function stateAndConfigViolations(files: SourceFile[]): string[] {
  const out: string[] = [];
  for (const file of files.filter((f) => isC2Production(f.path))) {
    const code = stripComments(file.text);
    if (/\bprocess\.env\b|\bimport\.meta\.env\b/.test(code)) out.push(`${file.path}: reads env/config`);
    if (/\bunstable_cache\b|["']use cache["']|\bcacheLife\b|\bcacheTag\b|from\s*["']react["'][^;]*\bcache\b|\brevalidate(?:Tag|Path)?\b/.test(code)) out.push(`${file.path}: cache`);
    if (/^(?:let|var)\s/m.test(code)) out.push(`${file.path}: module-level mutable binding`);
    if (/^(?:export\s+)?const\s+\w+(?::[^=]+)?\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b/m.test(code)) out.push(`${file.path}: module-level Map/Set`);
  }
  // Single owner of the policy constants; the literals are never re-declared elsewhere.
  for (const file of files.filter((f) => isC2Production(f.path) && f.path !== `${C2_DIR}domain/skill-coverage-policy.ts`)) {
    if (/\b(?:SKILL_COVERAGE_MIN_CONTRIBUTORS|SKILL_CONTRIBUTION_NOTICE_VERSION|TEAM_SKILL_COHORT_SCAN_MAX)\s*(?::[^=]+)?=[^=]/.test(stripComments(file.text))) {
      out.push(`${file.path}: redeclares a policy constant`);
    }
  }
  return out;
}

/* ------------------------------- C1 regression helpers ------------------------------------------- */

function c1ReverseViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isGuarded(f.path) && f.path.startsWith(C1_DIR) && !isTest(f.path))
    .filter((f) => resolvedOf(f).some((t) => t.startsWith(C2_DIR) || t.startsWith("app/api/teams/")))
    .map((f) => f.path);
}

function interfaceKeys(text: string, name: string): string[] {
  const body = declarationBody(stripComments(text), new RegExp(`export interface ${name}\\b`));
  return body ? [...body.matchAll(/^\s{2}(\w+)(?:<[^>]*>)?\(/gm)].map((m) => m[1]).sort() : [];
}

function exportedNames(text: string): string[] {
  return [...stripComments(text).matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|interface|type|class)\s+([\w$]+)/gm)].map((m) => m[1]).sort();
}

/* ------------------------------- real tree access ------------------------------------------------ */

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
const real = (path: string) => realFiles.find((f) => f.path === path)!;
const virtual = (path: string, text: string): SourceFile => ({ path, text });

const SRV = `${C2_DIR}server/`;
const IMPORT_BATCH = `import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";`;

/* ----------------------------------------- tests ----------------------------------------- */

describe("C2 scope guard — personal data boundary (BR-34 #1, #2; BR-23)", () => {
  it("passes on the real tree: only the approved coverage module reaches personal skill data", () => {
    expect(personalDataViolations(realFiles)).toEqual([]);
    expect(c2ReExportViolations(realFiles)).toEqual([]);
    const batchImporters = realFiles
      .filter((f) => isGuarded(f.path) && resolvedOf(f).includes(BATCH_MODULE) && !isTest(f.path) && !f.path.startsWith(C1_DIR))
      .map((f) => f.path);
    expect(batchImporters).toEqual([COVERAGE_MODULE]);
    const c1Importers = realFiles.filter((f) => isGuarded(f.path) && !f.path.startsWith(C1_DIR) && resolvedOf(f).some((t) => t.startsWith(C1_SERVER_DIR)));
    expect(c1Importers.filter((f) => f.path.startsWith(C2_DIR) && !isTest(f.path)).map((f) => f.path)).toEqual([COVERAGE_MODULE]);
  });

  it("names the same approved coverage caller as the C1 guard (no second, contradictory definition)", () => {
    const c1 = real(C1_GUARD_FILE).text;
    expect(c1).toContain(`"${COVERAGE_MODULE}"`);
    expect(c1).toContain(String(COVERAGE_TEST));
    // The only self-file exemption the C1 guard grants this guard, by exact path.
    expect(c1).toContain(`const C2_GUARD_FILE = "${GUARD_FILE}";`);
  });

  it("accepts the approved caller and its sibling tests, and nothing else", () => {
    expect(personalDataViolations([virtual(COVERAGE_MODULE, IMPORT_BATCH), virtual(`${SRV}get-team-skill-coverage.test.ts`, IMPORT_BATCH)])).toEqual([]);
    expect(personalDataViolations([virtual(`${SRV}get-team-skill-coverage-helper.ts`, IMPORT_BATCH), virtual(`${SRV}other.ts`, IMPORT_BATCH)])).toEqual([
      `${SRV}get-team-skill-coverage-helper.ts: adapter identifier outside approved caller`,
      `${SRV}get-team-skill-coverage-helper.ts: imports the batch adapter`,
      `${SRV}other.ts: adapter identifier outside approved caller`,
      `${SRV}other.ts: imports the batch adapter`,
    ]);
  });

  it("fails for a team-skills module importing the raw reader, the store or the collection, even renamed", () => {
    expect(
      personalDataViolations([
        virtual(`${SRV}a.ts`, `import { readSkillProfilesBatch as load } from "../../skill-profiles/server/skill-profile-store";`),
        virtual(`${SRV}b.ts`, `import { getDefaultSkillProfileStore } from "@/src/features/skill-profiles/server/skill-profile-store";`),
        virtual(`${SRV}c.ts`, `const c = db.collection("skillProfiles");`),
        virtual(COVERAGE_MODULE, `import { x } from "../../skill-profiles/server/skill-profile-store";`),
        virtual("app/api/teams/[teamId]/skill-coverage/route.ts", `const c = "skillProfiles";`),
      ]),
    ).toEqual([
      `${SRV}a.ts: raw batch reader identifier`,
      `${SRV}a.ts: imports skill-profile-store`,
      `${SRV}b.ts: imports skill-profile-store`,
      `${SRV}c.ts: names skillProfiles`,
      `${COVERAGE_MODULE}: imports skill-profile-store`,
      "app/api/teams/[teamId]/skill-coverage/route.ts: names skillProfiles",
    ]);
  });

  it("fails for C1 write operations, other C1 server modules and skill-profiles re-exports from C2", () => {
    expect(
      personalDataViolations([
        virtual(`${SRV}w.ts`, `import { setOwnSkillLevel } from "../../skill-profiles/server/set-own-skill-level";`),
        virtual(`${SRV}x.ts`, `import { clearOwnSkillLevel } from "../../skill-profiles/server/clear-own-skill-level.ts";`),
        virtual(`${SRV}y.ts`, `import { deleteOwnSkillProfile } from "@/src/features/skill-profiles/server/delete-own-skill-profile";`),
        virtual(`${SRV}z.ts`, `import { getOwnSkills } from "../../skill-profiles/server/get-own-skills";`),
        virtual(`${SRV}barrel.ts`, `export * from "../../skill-profiles/domain/skill-profile";`),
      ]),
    ).toEqual([
      `${SRV}w.ts: imports C1 write operation set-own-skill-level`,
      `${SRV}x.ts: imports C1 write operation clear-own-skill-level`,
      `${SRV}y.ts: imports C1 write operation delete-own-skill-profile`,
      `${SRV}z.ts: imports unapproved src/features/skill-profiles/server/get-own-skills`,
      `${SRV}barrel.ts: re-exports src/features/skill-profiles/domain/skill-profile`,
    ]);
  });

  it("fails for skillProgress/roadmapItems access from C2 production code, but not for tests asserting its absence", () => {
    expect(
      personalDataViolations([
        virtual(`${SRV}p.ts`, `db.collection("skillProgress")`),
        virtual(`${SRV}r.ts`, `const r = "roadmapItems";`),
        virtual(`${SRV}ok.ts`, `// no skillProgress here`),
        virtual(`${SRV}ok.test.ts`, `expect(collections).not.toContain("roadmapItems");`),
      ]),
    ).toEqual([`${SRV}p.ts: skillProgress/roadmapItems`, `${SRV}r.ts: skillProgress/roadmapItems`]);
  });

  it("fails for any C2 production re-export or barrel", () => {
    expect(
      c2ReExportViolations([
        virtual(`${SRV}index.ts`, `export * from "./list-skill-needs";`),
        virtual(`${SRV}renamed.ts`, `export { getTeamSkillCoverage as g } from "./get-team-skill-coverage";`),
        virtual(`${SRV}fine.ts`, `// export * from "./x"\nexport const a = 1;`),
        virtual(`${SRV}t.test.ts`, `export * from "./x";`),
      ]),
    ).toEqual([`${SRV}index.ts`, `${SRV}renamed.ts`]);
  });
});

describe("C2 scope guard — client/server and Firebase boundaries (BR-34 #5)", () => {
  it("passes on the real tree", () => {
    expect(boundaryViolations(realFiles)).toEqual([]);
    expect(firebaseClientViolations(realFiles)).toEqual([]);
  });

  it("fails for a client module importing C2 server code, personal-data server code or the Admin SDK", () => {
    expect(
      boundaryViolations([
        virtual(`${C2_DIR}components/Matrix.tsx`, `"use client";\nimport { x } from "../server/get-team-skill-coverage";`),
        virtual(`${C2_DIR}components/Raw.tsx`, `import { x } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual(`${C2_DIR}client/api.ts`, `import { db } from "../../../lib/firebase/admin";`),
        virtual(`${C2_DIR}components/Admin.tsx`, `import { FieldValue } from "firebase-admin/firestore";`),
        virtual(`${C2_DIR}components/Ok.tsx`, `"use client";\nimport { x } from "../domain/skill-need";`),
      ]),
    ).toEqual([
      `${C2_DIR}components/Matrix.tsx: client imports ${SRV}get-team-skill-coverage`,
      `${C2_DIR}components/Raw.tsx: client imports ${BATCH_MODULE}`,
      `${C2_DIR}client/api.ts: client imports src/lib/firebase/admin`,
      `${C2_DIR}components/Admin.tsx: client imports a server-only package`,
    ]);
  });

  it("fails for a domain file depending on server code and for a server file without server-only", () => {
    expect(
      boundaryViolations([
        virtual(`${C2_DIR}domain/d.ts`, `import { x } from "../server/skill-needs-store";`),
        virtual(`${SRV}s.ts`, `export const a = 1;`),
        virtual(`${SRV}ok.ts`, `import "server-only";\nexport const a = 1;`),
      ]),
    ).toEqual([`${C2_DIR}domain/d.ts: domain depends on server/firebase`, `${SRV}s.ts: missing server-only`]);
  });

  it("fails for a Firebase client SDK import anywhere in C2, tests included", () => {
    expect(
      firebaseClientViolations([
        virtual(`${C2_DIR}components/A.tsx`, `import { getFirestore } from "firebase/firestore";`),
        virtual(`${SRV}b.test.ts`, `import { x } from "@firebase/app";`),
        virtual(`${SRV}ok.ts`, `import { FieldValue } from "firebase-admin/firestore";`),
      ]),
    ).toEqual([`${C2_DIR}components/A.tsx`, `${SRV}b.test.ts`]);
  });
});

describe("C2 scope guard — persistence ownership and participation consumers (BR-34 #4)", () => {
  it("exact sets: teamSkillNeeds and skillContribution are named only by their owners (production) and listed tests", () => {
    expect(identifierSetMismatches(realFiles, /\bteamSkillNeeds\b/, SKILL_NEEDS_COLLECTION_FILES, "teamSkillNeeds reference")).toEqual([]);
    expect(testReferenceMismatches(realFiles, /\bteamSkillNeeds\b/, SKILL_NEEDS_COLLECTION_TEST_FILES)).toEqual([]);
    expect(identifierSetMismatches(realFiles, /\bskillContribution\b/, SKILL_CONTRIBUTION_FIELD_FILES, "skillContribution reference")).toEqual([]);
    expect(testReferenceMismatches(realFiles, /\bskillContribution\b/, SKILL_CONTRIBUTION_FIELD_TEST_FILES)).toEqual([]);
  });

  it("fails for a second file naming the needs collection or the participation field, in production or in an unlisted test", () => {
    const owners = [virtual(SKILL_NEEDS_COLLECTION_FILES[0], `const c = "teamSkillNeeds";`)];
    expect(
      identifierSetMismatches(
        [...owners, virtual(`${SRV}other.ts`, `db.collection("teamSkillNeeds")`), virtual("app/api/admin/x/route.ts", `get("teamSkillNeeds")`)],
        /\bteamSkillNeeds\b/,
        SKILL_NEEDS_COLLECTION_FILES,
        "teamSkillNeeds reference",
      ),
    ).toEqual([`unexpected teamSkillNeeds reference: app/api/admin/x/route.ts`, `unexpected teamSkillNeeds reference: ${SRV}other.ts`]);
    expect(
      identifierSetMismatches([], /\bskillContribution\b/, SKILL_CONTRIBUTION_FIELD_FILES, "skillContribution reference"),
    ).toEqual([`missing skillContribution reference: ${SKILL_CONTRIBUTION_FIELD_FILES[0]}`]);
    expect(
      identifierSetMismatches(
        [virtual(SKILL_CONTRIBUTION_FIELD_FILES[0], `x`), virtual("src/features/teams/server/leak.ts", `m["skillContribution"]`)],
        /\bskillContribution\b/,
        SKILL_CONTRIBUTION_FIELD_FILES,
        "skillContribution reference",
      ),
    ).toEqual([`unexpected skillContribution reference: src/features/teams/server/leak.ts`, `missing skillContribution reference: ${SKILL_CONTRIBUTION_FIELD_FILES[0]}`]);
    expect(testReferenceMismatches([virtual("src/features/forum/x.test.ts", `"teamSkillNeeds"`)], /\bteamSkillNeeds\b/, SKILL_NEEDS_COLLECTION_TEST_FILES)).toEqual([
      "unexpected test reference: src/features/forum/x.test.ts",
    ]);
  });

  it("exact sets: production consumers of the participation state and the two stores equal the approved lists", () => {
    for (const [identifier, expected] of Object.entries(PARTICIPATION_CONSUMERS)) {
      expect(identifierSetMismatches(realFiles, new RegExp(`\\b${identifier}\\b`), expected, identifier), identifier).toEqual([]);
    }
    expect(storeImporterMismatches(realFiles)).toEqual([]);
    expect(outsideStoreTestViolations(realFiles)).toEqual([]);
  });

  it("fails for an arbitrary module reading participation state or importing a store (renamed or not)", () => {
    expect(
      identifierSetMismatches(
        [virtual("src/features/roadmap/server/peek.ts", `import { isEffectiveSkillContribution as ok } from "@/src/features/team-skills/domain/skill-contribution";`)],
        /\bisEffectiveSkillContribution\b/,
        PARTICIPATION_CONSUMERS.isEffectiveSkillContribution,
        "isEffectiveSkillContribution",
      ).filter((m) => m.startsWith("unexpected")),
    ).toEqual(["unexpected isEffectiveSkillContribution: src/features/roadmap/server/peek.ts"]);
    const store = `${SRV}skill-contribution-store`;
    expect(
      storeImporterMismatches([
        virtual(`${SRV}helper.ts`, `import { getDefaultSkillContributionStore as s } from "./skill-contribution-store";`),
        virtual("src/features/teams/server/x.ts", `import { s } from "../../team-skills/server/skill-needs-store.ts";`),
        virtual(`${SRV}list-skill-needs.ts`, `import { s } from "./skill-needs-store";`),
      ]).filter((m) => m.startsWith("unexpected")),
    ).toEqual([
      `unexpected importer of skill-needs-store: src/features/teams/server/x.ts`,
      `unexpected importer of skill-contribution-store: ${SRV}helper.ts`,
    ]);
    expect(store).toContain("skill-contribution-store");
    expect(outsideStoreTestViolations([virtual("src/features/teams/server/x.test.ts", `import { s } from "../../team-skills/server/skill-needs-store";`)])).toEqual([
      "src/features/teams/server/x.test.ts",
    ]);
  });

  it("only the approved route files (and their tests) import C2 server code from outside team-skills", () => {
    expect(outsideImportViolations(realFiles)).toEqual([]);
    expect(
      outsideImportViolations([
        virtual("app/api/teams/[teamId]/skill-coverage/route.ts", `import { g } from "../../../../../src/features/team-skills/server/skill-needs-store";`),
        virtual("app/api/teams/[teamId]/skill-needs/export/route.ts", `import { listSkillNeeds } from "../../../../../../src/features/team-skills/server/list-skill-needs";`),
        virtual("src/features/results/server/x.ts", `import { y } from "../../team-skills/server/get-team-skill-coverage";`),
        virtual("app/api/teams/[teamId]/skill-coverage/route.ts.test", `x`),
        virtual("app/api/teams/[teamId]/skill-needs/route.ts", `import { listSkillNeeds } from "../../../../../src/features/team-skills/server/list-skill-needs";`),
      ]),
    ).toEqual([
      `app/api/teams/[teamId]/skill-coverage/route.ts -> ${SRV}skill-needs-store`,
      `app/api/teams/[teamId]/skill-needs/export/route.ts -> ${SRV}list-skill-needs`,
      `src/features/results/server/x.ts -> ${SRV}get-team-skill-coverage`,
    ]);
  });
});

describe("C2 scope guard — write boundary, collections and aggregate persistence (BR-34 #4, #9; BR-20, BR-23)", () => {
  it("passes on the real tree: the only writes are the two approved statements per store", () => {
    expect(writeViolations(realFiles)).toEqual([]);
    expect(collectionViolations(realFiles)).toEqual([]);
    expect(adminDbViolations(realFiles)).toEqual([]);
    expect(crossFeatureImportViolations(realFiles)).toEqual([]);
  });

  it("fails for a coverage module (or anything else) writing personal profiles or any new write", () => {
    expect(
      writeViolations([
        virtual(COVERAGE_MODULE, `await db.collection("skillProfiles").doc(uid).set({ levels: {} });\nawait ref.delete();`),
        virtual(`${SRV}helper.ts`, `batch.update(ref, { a: 1 });`),
        virtual(`${SRV}skill-needs-store.ts`, `tx.set(db.collection(SKILL_NEEDS_COLLECTION).doc(docId), { coverage: 1 });`),
        virtual(`${SRV}skill-contribution-store.ts`, `tx.update(membershipRef(uid, teamId), { role: "lead" });\nimport { FieldValue } from "firebase-admin/firestore";`),
      ]),
    ).toEqual([
      `${COVERAGE_MODULE}: unapproved write call: await db.collection("skillProfiles").doc(uid).set({ levels: {} });`,
      `${COVERAGE_MODULE}: unapproved write call: await ref.delete();`,
      `${SRV}helper.ts: unapproved write call: batch.update(ref, { a: 1 });`,
      `${SRV}skill-needs-store.ts: unapproved write call: tx.set(db.collection(SKILL_NEEDS_COLLECTION).doc(docId), { coverage: 1 });`,
      `${SRV}skill-needs-store.ts: approved write missing: tx.set(db.collection(SKILL_NEEDS_COLLECTION).doc(docId), record);`,
      `${SRV}skill-needs-store.ts: approved write missing: tx.delete(db.collection(SKILL_NEEDS_COLLECTION).doc(docId));`,
      `${SRV}skill-contribution-store.ts: unapproved write call: tx.update(membershipRef(uid, teamId), { role: "lead" });`,
      `${SRV}skill-contribution-store.ts: approved write missing: tx.update(membershipRef(uid, teamId), { [SKILL_CONTRIBUTION_FIELD]: record });`,
      `${SRV}skill-contribution-store.ts: approved write missing: tx.update(membershipRef(uid, teamId), { [SKILL_CONTRIBUTION_FIELD]: FieldValue.delete() });`,
    ]);
  });

  it("fails for a collection outside the approved four, including skillProfiles, skillProgress, roadmapItems and persisted aggregates", () => {
    const code = (body: string) => virtual(`${SRV}c.ts`, `const TEAMS_COLLECTION = "teams";\n${body}`);
    expect(collectionViolations([code(`db.collection(TEAMS_COLLECTION); db.collection("teamMemberships");`)])).toEqual([]);
    expect(
      collectionViolations([
        code(`db.collection("skillProfiles"); db.collection("skillProgress"); db.collection("roadmapItems");`),
        code(`const COVERAGE_COLLECTION = "teamSkillCoverage"; db.collection(COVERAGE_COLLECTION);`),
        code(`db.collection(name); db.collectionGroup("teamMemberships");`),
      ]),
    ).toEqual([
      `${SRV}c.ts: collection("skillProfiles") is not an approved collection`,
      `${SRV}c.ts: collection("skillProgress") is not an approved collection`,
      `${SRV}c.ts: collection("roadmapItems") is not an approved collection`,
      `${SRV}c.ts: collection(COVERAGE_COLLECTION) is not an approved collection`,
      `${SRV}c.ts: COVERAGE_COLLECTION = "teamSkillCoverage" is not an approved collection`,
      `${SRV}c.ts: collection(name) is not an approved collection`,
      `${SRV}c.ts: collection("teamMemberships") is not an approved collection`,
    ]);
  });

  it("fails for the Admin SDK wrapper or an unlisted cross-feature module in a new C2 file", () => {
    expect(adminDbViolations([virtual(`${SRV}new.ts`, `import { getFirestoreDb } from "../../../lib/firebase/admin";`)])).toEqual([`${SRV}new.ts`]);
    expect(
      crossFeatureImportViolations([
        virtual(`${SRV}a.ts`, `import { x } from "../../roadmap/server/list-roadmap-items";`),
        virtual(`${SRV}b.ts`, `import { x } from "../../skill-trees/server/get-team-skill-progress";`),
        virtual(`${SRV}c.ts`, `import { x } from "../../teams/server/resolve-team-role";`),
        virtual(`${SRV}d.ts`, `import { authorizeTeamAccess } from "../../teams/server/authorize-team-access";`),
        virtual(`${SRV}list-skill-needs.ts`, `import { authorizeTeamAccess } from "../../teams/server/authorize-team-access";`),
        virtual(`${SRV}e.ts`, `import { y } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual(COVERAGE_MODULE, `import { y } from "../../skill-profiles/server/read-skill-levels-batch";`),
        virtual(`${SRV}ok.ts`, `import { z } from "../../skill-trees/domain/skill-tree";`),
      ]),
    ).toEqual([
      `${SRV}a.ts -> src/features/roadmap/server/list-roadmap-items`,
      `${SRV}b.ts -> src/features/skill-trees/server/get-team-skill-progress`,
      `${SRV}c.ts -> src/features/teams/server/resolve-team-role`,
      `${SRV}d.ts -> src/features/teams/server/authorize-team-access`,
      `${SRV}e.ts -> ${BATCH_MODULE}`,
    ]);
  });

  it("fails for env/config reads, caches, module-level mutable state and redeclared policy constants", () => {
    expect(stateAndConfigViolations(realFiles)).toEqual([]);
    expect(
      stateAndConfigViolations([
        virtual(`${SRV}a.ts`, `const k = Number(process.env.SKILL_K);`),
        virtual(`${SRV}b.ts`, `import { unstable_cache } from "next/cache";`),
        virtual(`${SRV}c.ts`, `const byTeam = new Map<string, number>();`),
        virtual(`${SRV}d.ts`, `let lastCoverage = null;`),
        virtual(`${SRV}e.ts`, `export const SKILL_COVERAGE_MIN_CONTRIBUTORS = 3;`),
        virtual(`${C2_DIR}domain/skill-coverage-policy.ts`, `export const SKILL_COVERAGE_MIN_CONTRIBUTORS = 5;`),
        virtual("app/api/teams/[teamId]/skill-coverage/route.ts", `export const revalidate = 60;`),
        virtual(`${SRV}ok.ts`, `// process.env, unstable_cache\nconst STATUS = { a: 1 };`),
      ]),
    ).toEqual([
      `${SRV}a.ts: reads env/config`,
      `${SRV}b.ts: cache`,
      `${SRV}c.ts: module-level Map/Set`,
      `${SRV}d.ts: module-level mutable binding`,
      `app/api/teams/[teamId]/skill-coverage/route.ts: cache`,
      `${SRV}e.ts: redeclares a policy constant`,
    ]);
  });
});

describe("C2 scope guard — authorization seam and routes (BR-34 #6, #7; BR-5, BR-16, BR-18)", () => {
  it("passes on the real tree", () => {
    expect(authorizationViolations(realFiles)).toEqual([]);
    expect(routeViolations(realFiles)).toEqual([]);
    expect(coverageRouteViolations(realFiles)).toEqual([]);
  });

  it("fails for admin-first role helpers, authorizeTeamAccess outside need read, or a missing/weaker seam", () => {
    const base = Object.keys(REQUIRED_SEAM).map((p) => virtual(p, REQUIRED_SEAM[p]));
    expect(authorizationViolations(base)).toEqual([]);
    const withViolations = base.map((f) =>
      f.path === `${SRV}get-team-skill-coverage.ts`
        ? virtual(f.path, `${f.text}\nimport { resolveTeamRole } from "../../teams/server/resolve-team-role";`)
        : f.path === `${SRV}upsert-skill-need.ts`
          ? virtual(f.path, `requireGenuineMember(\nauthorizeTeamAccess(`)
          : f.path === `${SRV}delete-skill-need.ts`
            ? virtual(f.path, `isAppAdmin(`)
            : f,
    );
    expect(authorizationViolations(withViolations)).toEqual([
      `${SRV}upsert-skill-need.ts: authorizeTeamAccess`,
      `${SRV}delete-skill-need.ts: isAppAdmin`,
      `${SRV}get-team-skill-coverage.ts: resolveTeamRole`,
      `${SRV}upsert-skill-need.ts: does not call requireGenuineLead(`,
      `${SRV}delete-skill-need.ts: does not call requireGenuineLead(`,
      `${SRV}upsert-skill-need.ts: need write uses a non-lead seam`,
    ]);
  });

  it("fails for a new route file, an extra method, a direct store/domain/reader import or an extra header", () => {
    const route = (name: string, body: string) => virtual(name, body);
    const ok = Object.keys(C2_ROUTE_IMPORTS).map((p) =>
      route(
        p,
        `import { NextResponse } from "next/server";\n${C2_ROUTE_IMPORTS[p]
          .map((m) => `import { ${m} } from "${"../".repeat(p.split("/").length - 1)}src/features/team-skills/server/${m}";`)
          .join("\n")}\n${C2_ROUTE_METHODS[p].map((m) => `export async function ${m}() {}`).join("\n")}\nrequest.headers.get("authorization");`,
      ),
    );
    expect(routeViolations(ok)).toEqual([]);
    const mutated = ok.map((f) =>
      f.path === COVERAGE_ROUTE
        ? route(f.path, `${f.text}\nimport { s } from "../../../../../src/features/team-skills/server/skill-needs-store";\nimport { b } from "../../../../../src/features/skill-profiles/server/read-skill-levels-batch";\nexport async function POST() {}\nrequest.headers.get("x-k");\nexport const revalidate = 5;`)
        : f,
    );
    expect(routeViolations([...mutated, route("app/api/teams/[teamId]/skill-coverage/matrix/route.ts", `export async function GET() {}`)])).toEqual([
      "app/api/teams/[teamId]/skill-coverage/matrix/route.ts: unapproved C2 route file",
      `${COVERAGE_ROUTE}: imports ${SRV}skill-needs-store`,
      `${COVERAGE_ROUTE}: imports ${BATCH_MODULE}`,
      `${COVERAGE_ROUTE}: method surface changed`,
      `${COVERAGE_ROUTE}: reads header "x-k"`,
      `${COVERAGE_ROUTE}: caching directive`,
    ]);
  });

  it("fails when the coverage route reads the query string, body or duplicates aggregation", () => {
    expect(coverageRouteViolations([])).toEqual([]);
    expect(coverageRouteViolations([virtual(COVERAGE_ROUTE, `const level = new URL(request.url).searchParams.get("level");`)])).toEqual([
      `${COVERAGE_ROUTE}: reads the URL / query string`,
    ]);
    expect(coverageRouteViolations([virtual(COVERAGE_ROUTE, `const b = await request.json(); const c = request.nextUrl;`)])).toEqual([
      `${COVERAGE_ROUTE}: reads the URL / query string`,
      `${COVERAGE_ROUTE}: reads body/cookies`,
    ]);
    expect(coverageRouteViolations([virtual(COVERAGE_ROUTE, `const n = result.rows.filter((r) => r.state === "gap").length;`)])).toEqual([
      `${COVERAGE_ROUTE}: aggregation logic`,
    ]);
  });
});

describe("C2 scope guard — response shape (BR-34 #3; BR-15, BR-22)", () => {
  it("the real coverage DTO and route carry exactly the approved keys and no identity or count field", () => {
    expect(dtoViolations(realFiles)).toEqual([]);
  });

  it("fails for an extra row key, an extra response key, or a count/identity/timestamp field in a response type", () => {
    const coverageFile = (row: string, response: string, extra = "") =>
      virtual(COVERAGE_MODULE, `export interface SkillCoverageRow {\n${row}\n}\n${response}\n${extra}`);
    const okRow = `  treeId: string;\n  areaName: string | null;\n  requiredLevel: number;\n  requiredCoverage: number;\n  state: string;`;
    const okResponse = `export type SkillCoverageResponse =\n  | { availability: "available"; rows: SkillCoverageRow[] }\n  | { availability: "incomplete"; rows: [] };`;
    expect(dtoViolations([coverageFile(okRow, okResponse)])).toEqual([]);
    expect(dtoViolations([coverageFile(`${okRow}\n  contributorCount: number;`, okResponse)])).toEqual([
      `${COVERAGE_MODULE}: SkillCoverageRow keys areaName,contributorCount,requiredCoverage,requiredLevel,state,treeId`,
      `${COVERAGE_MODULE}: response type declares contributorCount`,
    ]);
    expect(dtoViolations([coverageFile(okRow, okResponse.replace("rows: []", "rows: []; total: number"))])).toEqual([
      `${COVERAGE_MODULE}: SkillCoverageResponse keys availability,rows,total`,
    ]);
    for (const field of ["uid", "email", "displayName", "memberRef", "count", "average", "rank", "score", "percent", "distribution", "min", "max", "timestamp", "consentedAt"]) {
      expect(
        dtoViolations([virtual(`${SRV}list-skill-needs.ts`, `export interface NeedView {\n  treeId: string;\n  ${field}: number;\n}\n`)]),
        field,
      ).toEqual([`${SRV}list-skill-needs.ts: response type declares ${field}`]);
    }
  });

  it("fails when the coverage route stops mapping field by field (spread or raw document)", () => {
    expect(
      dtoViolations([virtual(COVERAGE_ROUTE, `return NextResponse.json({ availability: result.availability, rows: result.rows.map((row) => ({ ...row })) });`)]),
    ).toEqual([`${COVERAGE_ROUTE}: response is not the field-by-field allow-list`]);
  });
});

describe("C2 scope guard — copy (BR-34 #8; BR-21, BR-24)", () => {
  it("passes on the real tree (copy.ts and components are scanned when present)", () => {
    expect(copyViolations(realFiles)).toEqual([]);
  });

  it("fails for count, rank, score, strength, performance and unqualified-anonymity wording", () => {
    expect(
      copyViolations([
        virtual(`${C2_DIR}copy.ts`, `export const a = "Teamet har svak dekning";\nexport const b = "Rangering av ansatte";\nexport const c = "Du er anonym";\nexport const d = "Score: 80 %";`),
        virtual(`${C2_DIR}components/X.tsx`, `const e = 'Ytelse per person';\nconst f = "Ikke absolutt anonymitet — ikke anonym";`),
      ]),
    ).toEqual([
      `${C2_DIR}copy.ts: "svak"`,
      `${C2_DIR}copy.ts: "Rangering"`,
      `${C2_DIR}copy.ts: unqualified "anonym"`,
      `${C2_DIR}copy.ts: "Score"`,
      `${C2_DIR}components/X.tsx: "Ytelse"`,
    ]);
  });
});

describe("C2 scope guard — C1 regression evidence (BR-23, BR-30)", () => {
  const APPROVED_C1_ROUTES: Record<string, string[]> = {
    "app/api/me/skills/route.ts": ["DELETE", "GET"],
    "app/api/me/skills/[treeId]/route.ts": ["DELETE", "PUT"],
  };

  it("the C1 route files and method surface are unchanged", () => {
    const productionRoutes = realFiles.filter((f) => f.path.startsWith("app/api/me/skills/") && !isTest(f.path)).map((f) => f.path).sort();
    expect(productionRoutes).toEqual(Object.keys(APPROVED_C1_ROUTES).sort());
    for (const [path, methods] of Object.entries(APPROVED_C1_ROUTES)) expect(exportedMethods(real(path).text), path).toEqual(methods);
  });

  it("the SkillProfileStore seam keeps exactly read / runTransaction / delete and does not expose the batch reader", () => {
    const store = real(`${STORE_MODULE}.ts`).text;
    expect(interfaceKeys(store, "SkillProfileStore")).toEqual(["delete", "read", "runTransaction"]);
    expect(store).toMatch(/export async function readSkillProfilesBatch\b/);
  });

  it("the C1 operation modules keep their exported surface", () => {
    const exportsOf = (name: string) => exportedNames(real(`${C1_SERVER_DIR}${name}.ts`).text);
    expect(exportsOf("get-own-skills")).toEqual(["GetOwnSkillsDeps", "GetOwnSkillsResult", "getOwnSkills"]);
    expect(exportsOf("set-own-skill-level")).toEqual(["SetOwnSkillLevelDeps", "SetOwnSkillLevelResult", "setOwnSkillLevel"]);
    expect(exportsOf("clear-own-skill-level")).toEqual(["ClearOwnSkillLevelDeps", "ClearOwnSkillLevelResult", "clearOwnSkillLevel"]);
    expect(exportsOf("delete-own-skill-profile")).toEqual(["DeleteOwnSkillProfileDeps", "DeleteOwnSkillProfileResult", "deleteOwnSkillProfile"]);
  });

  it("the batch adapter is read-only and exports only its function, bounds and types; C1 does not depend on C2", () => {
    const adapter = real(`${BATCH_MODULE}.ts`).text;
    expect(WRITE_CALL.test(stripComments(adapter))).toBe(false);
    expect(exportedNames(adapter)).toEqual([
      "ReadSkillLevelsBatchDeps",
      "ReadSkillLevelsBatchResult",
      "SKILL_LEVELS_BATCH_MAX_TREES",
      "SKILL_LEVELS_BATCH_MAX_UIDS",
      "readSkillLevelsBatch",
    ]);
    expect(c1ReverseViolations(realFiles)).toEqual([]);
    expect(
      c1ReverseViolations([
        virtual(`${C1_SERVER_DIR}x.ts`, `import { a } from "../../team-skills/server/list-skill-needs";`),
        virtual(`${C1_SERVER_DIR}y.ts`, `import { a } from "@/app/api/teams/route";`),
        virtual(`${C1_SERVER_DIR}ok.ts`, `import { a } from "../domain/skill-profile";`),
      ]),
    ).toEqual([`${C1_SERVER_DIR}x.ts`, `${C1_SERVER_DIR}y.ts`]);
  });

  it("the C1 forbidden-identifier list is unchanged", () => {
    const c1 = real(C1_GUARD_FILE).text;
    const list = /const FORBIDDEN_C1_IDENTIFIERS = \[([\s\S]*?)\];/.exec(c1)?.[1] ?? "";
    expect([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([
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
    ]);
  });
});
