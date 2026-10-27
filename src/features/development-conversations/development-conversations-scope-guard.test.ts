import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_PAYLOAD_KEYS } from "./domain/content-payload";
import * as dtoKeys from "./domain/dto-keys";
import { STORED_OWNER_PLAIN_KEYS } from "./domain/stored-owner-conversation";
import { PARTICIPATION_INDEX_KEYS } from "./domain/stored-participation-index";
import { SHARED_GOAL_SNAPSHOT_KEYS } from "./domain/shared-goal-snapshot";

/**
 * Static scope guard for Development Conversations (D2, TASK-004; SPEC D2-SI-16, D2-SI-18, CL-12, CL-14 to CL-16,
 * BR-52 static part, AD-10, IMPL-2; TASKS "TASK-004" dimensions 1 to 8).
 *
 * It is CHANGE-DETECTION evidence, not a security boundary and not an authorization or privacy proof. It makes an
 * unexpected storage reference, importer, forbidden dependency, forbidden name or concept, logging call, persisted
 * key or DTO key fail visibly, so that the change needs a deliberate, reviewed edit of an exact allow-list here.
 * Every allow-list is an EXACT list of files or of identifiers. Nothing is approved by directory or by prefix,
 * except the scanned roots themselves (`src/`, `app/`) and the D2 feature and route directories.
 *
 * It does NOT prove: runtime behaviour or authorization (the operation, route and authorization-matrix tests own
 * those, TASK-022 and TASK-034); dynamically built collection names, module paths or keys; template-literal or
 * otherwise non-literal import specifiers; import aliases other than `@/`; code outside `src/` and `app/`; that a
 * route builds responses from DTOs only; that a logger call with a safe variable name logs nothing sensitive; or the
 * absence of a forbidden behaviour (name scans flag identifiers and strings, not behaviour). The scanners are
 * lexical (regex over comment-stripped text, not a TypeScript parser). A `//` inside a string literal can hide the rest
 * of that line from the comment-stripped scans, and a determined author can evade them. Code review remains the check.
 *
 * Comment policy, per dimension (each scan states its own choice in its doc comment):
 * - Storage references (dimension 1) count comments. A comment that writes a live storage path is a construction hint
 *   and a cross-feature leak, as the D1 guard incident showed (TASKS "Findings"). Reword the comment instead.
 * - Imports, identifiers, concepts and logging calls (dimensions 2 to 7) use comment-stripped code. A comment is not a
 *   dependency, and a comment that explains a boundary (`// no score here`) must not fail.
 * - DTO and persisted key lists (dimension 8) are read from code only.
 *
 * Why some tokens are built from fragments in this file: the D1 guard's collection-token scan and the C1/C2 guards'
 * whole-tree scans read the raw text of every file, including this one. Fragments keep this file from failing them.
 *
 * Structure: pure scanners run over (a) the real tree and (b) virtual negative fixtures. This file is excluded from
 * every scan of the real tree because it necessarily contains the tokens it searches for.
 */

const ROOT = process.cwd();
const GUARD_FILE = "src/features/development-conversations/development-conversations-scope-guard.test.ts";
const D2_DIR = "src/features/development-conversations/";
const D2_SERVER_DIR = `${D2_DIR}server/`;
const D2_DOMAIN_DIR = `${D2_DIR}domain/`;
const D2_COMPONENTS_DIR = `${D2_DIR}components/`;
const DTO_KEYS_FILE = `${D2_DOMAIN_DIR}dto-keys.ts`;
const D2_ROUTE_DIRS = ["app/api/me/conversations/", "app/me/conversations/"];
const ENCRYPTION_DIR = "src/lib/encryption/";
const CODEC_MODULE = `${D2_SERVER_DIR}content-codec`;

interface SourceFile {
  path: string;
  text: string;
}

/* ------------------------------ approved allow-lists ------------------------------ */

/**
 * Dimension 1: the only files that may reference a D2 storage identifier (TASK-005). The types module is the single
 * production source of the path literals; the store and the fake import its path helpers and write no literal. The
 * Admin store test asserts the literal paths, so it is listed too. Nothing else is approved.
 */
const APPROVED_COLLECTION_REFERENCES: readonly string[] = [
  `${D2_SERVER_DIR}conversation-store-types.ts`,
  `${D2_SERVER_DIR}conversation-store.test.ts`,
];

/**
 * Dimension 5: the only files that may import the encryption helper module. The codec is the single D2 seam (AD-5).
 * Its own test imports the helper to pin `STORED_KEY_VERSION` against the helper's output and to compute the
 * `keyCheck` vector independently (TASK-003 handoff items 10 and 3). No other D2 file may import the helper.
 */
const APPROVED_ENCRYPTION_IMPORTERS: readonly string[] = [CODEC_MODULE + ".ts", `${D2_SERVER_DIR}content-codec.test.ts`];

/**
 * Dimension 3: D1 goal persistence is not readable by D2 except through the single snapshot seam that TASK-008 adds.
 * Each entry names one exact importer AND one exact D1 module, so an approved seam cannot also import goal-store
 * internals. Do not add a directory or a prefix here.
 */
const APPROVED_PERSONAL_GOALS_SEAMS: ReadonlyArray<{ importer: string; module: string }> = [
  // TASK-008: the snapshot seam is the only D2 module that reads D1 goals (BR-24, CL-5), and only through the store module.
  {
    importer: `${D2_SERVER_DIR}read-owned-goal-snapshots.ts`,
    module: "src/features/personal-goals/server/goal-store",
  },
];

/* -------------------------------- forbidden names -------------------------------- */

/** Dimension 3, prefixes: D2 production code must not import these (resolved repo-relative prefixes). */
const FORBIDDEN_IMPORT_PREFIXES = [
  "src/features/skill-profiles/", // C1 personal skill levels and their storage (D2-SI-5)
  "src/features/team-skills/", // C2 needs, coverage and matrix
  "src/features/roadmap/", // roadmap items
  "src/features/skill-trees/server/", // skill progress and tree administration; skill-trees/domain is not forbidden
  "src/features/results/",
  "src/features/forum/",
  "src/features/surveys/",
  "src/features/challenges/",
];

/**
 * Dimension 3, identifiers: membership and identity helpers that are never standalone D2 authorization (CL-7, CL-8,
 * D2-SI-2). The team-membership seam is reached through TASK-006 and TASK-007 only, and is not named here.
 */
const FORBIDDEN_AUTHORITY_IDENTIFIERS = ["authorizeTeamAccess", "resolveTeamRole", "requireAppAdmin", "isAppAdmin"];

/**
 * Dimension 4: identifiers that D2 production code must not contain. The C1, C2 and roadmap names and the collection
 * group name are built from fragments (see the header), so this file keeps no literal of them.
 */
const FORBIDDEN_IDENTIFIERS = [
  ["skill", "Profiles"].join(""),
  ["team", "SkillNeeds"].join(""),
  ["roadmap", "Items"].join(""),
  ["skill", "Progress"].join(""),
  "roleDefinitions",
  "checkIns",
  "notification",
  "email",
  "sendMail",
  "calendar",
  ["collection", "Group"].join(""),
];

/**
 * Dimension 7: forbidden concepts in D2 production text, matched as whole words (camelCase and snake_case split), or as
 * a phrase of whole words. Copy text is not exempt here: a future copy file that needs a negated phrase must go through a
 * deliberate edit (TASK-033 owns the copy test).
 */
const FORBIDDEN_CONCEPT_WORDS = ["score", "rating", "rank", "performance", "productivity"];
const FORBIDDEN_CONCEPT_PHRASES = ["read receipt", "last viewed", "on track", "manager note", "lead dashboard"];

/**
 * Dimension 8, internal-only keys. They are never valid in any public DTO allow-list. The DTO module's
 * `FORBIDDEN_DTO_KEYS` is the TASK-001 source and is not edited here (TASK-001 is closed). This list is the
 * additional, guard-owned source for the CL-27 and BR-51 internal fields. The two sets are additive, not contradictory.
 */
const INTERNAL_ONLY_KEYS = [
  "keyCheck", // CL-27: internal cryptographic metadata, not authorization, identity, memberRef or a recovery token
  "keyVersion",
  "ciphertext",
  "iv",
  "authTag",
  "participantUid",
  "participantMemberRef",
  "ownerUid", // the owner uid is never public; the pending DTO carries only the owner display identity (BR-42)
  "keyUnavailable", // internal key-failure metadata (BR-53)
  "keyMismatch",
  "payloadUnauthenticated",
  "authenticationFailure",
  "keyFailure",
];

/** Dimension 6: identifiers that must not be passed to a log call (static lexical check, limited to these names). */
const SENSITIVE_LOG_IDENTIFIERS = ["title", "notes", "body", "memberRef", "uid", "ownerUid", "participantUid"];

/* ------------------------------ expected key sets ------------------------------ */

/** Dimension 8: the expected sets are written out here on purpose. The guard pins them independently of the exports. */
const EXPECTED_STORED_OWNER_PLAIN_KEYS = [
  "teamId",
  "participantUid",
  "participantMemberRef",
  "participantState",
  "participantInvitedAt",
  "participantAcceptedAt",
  "plannedFor",
  "status",
  "completedAt",
  "createdAt",
  "updatedAt",
  "ciphertext",
  "iv",
  "authTag",
  "keyVersion",
  "keyCheck",
];
const EXPECTED_PARTICIPATION_INDEX_KEYS = ["ownerUid", "invitedAt"];
const EXPECTED_CONTENT_PAYLOAD_KEYS = ["title", "ownerNotes", "nextSteps", "participantNotes", "sharedGoals"];
const EXPECTED_SHARED_GOAL_SNAPSHOT_KEYS = ["goalTitle", "treeId", "targetDate", "status", "capturedAt"];
const EXPECTED_DTO_KEYS: Record<string, string[]> = {
  PENDING_DTO_KEYS: ["conversationId", "state", "teamName", "invitedAt", "ownerDisplayName"],
  OWNER_PARTICIPANT_KEYS: ["state", "displayName"],
  SHARED_GOAL_DTO_KEYS: ["goalTitle", "areaName", "targetDate", "status", "capturedAt"],
  OWNER_DTO_KEYS: [
    "conversationId",
    "title",
    "status",
    "plannedFor",
    "teamId",
    "participant",
    "ownerNotes",
    "nextSteps",
    "participantNotes",
    "sharedGoals",
    "createdAt",
    "updatedAt",
    "completedAt",
  ],
  PARTICIPANT_DTO_KEYS: [
    "conversationId",
    "title",
    "status",
    "plannedFor",
    "teamName",
    "ownerDisplayName",
    "ownerNotes",
    "nextSteps",
    "participantNotes",
    "sharedGoals",
    "createdAt",
    "updatedAt",
    "completedAt",
  ],
  OWNER_SUMMARY_KEYS: [
    "conversationId",
    "title",
    "status",
    "plannedFor",
    "participant",
    "sharedGoalCount",
    "createdAt",
    "updatedAt",
  ],
  PARTICIPANT_SUMMARY_KEYS: ["conversationId", "state", "title", "teamName", "invitedAt"],
  RECOVERY_ITEM_KEYS: ["conversationId"],
};

/* ---------------------------------- scanners ---------------------------------- */

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const isGuarded = (path: string) => path !== GUARD_FILE;
const isD2 = (path: string) => path.startsWith(D2_DIR) || D2_ROUTE_DIRS.some((dir) => path.startsWith(dir));
const isD2Production = (path: string) => isGuarded(path) && isD2(path) && !isTest(path);
const isServerProduction = (path: string) => isD2Production(path) && path.startsWith(D2_SERVER_DIR);

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*)(["'])([^"'\n]+)\1/g;

/**
 * Removes line and block comments. String, template and regex literals are copied through unchanged, so comment-like
 * text inside them (`"//"`, `"src/**"`, `` `a//b` ``) cannot hide the code after it. A `/` starts a regex literal only
 * where an expression may begin (after an operator, an opening bracket, a comma or the start of the file); a `/` inside
 * a regex character class does not end it. Limits: a `${…}` expression is scanned by brace depth only, and a regex after
 * a keyword such as `return` is read as division. Neither is used in the guarded patterns.
 */
function stripComments(text: string): string {
  let out = "";
  let lastSignificant = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end === -1 ? text.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const end = literalEnd(text, i);
      out += text.slice(i, end);
      lastSignificant = c;
      i = end;
    } else if (c === "/" && "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant || "(")) {
      const end = regexEnd(text, i);
      out += text.slice(i, end);
      lastSignificant = "/";
      i = end;
    } else {
      out += c;
      if (!/\s/.test(c)) lastSignificant = c;
      i++;
    }
  }
  return out;
}

/** End index (exclusive) of a string or template literal starting at `start`. A quoted string ends at its line end. */
function literalEnd(text: string, start: number): number {
  const quote = text[start];
  let depth = 0;
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (quote === "`" && c === "$" && text[i + 1] === "{") {
      depth++;
      i += 2;
    } else if (quote === "`" && depth > 0 && c === "}") {
      depth--;
      i++;
    } else if (depth === 0 && c === quote) return i + 1;
    else if (depth === 0 && quote !== "`" && c === "\n") return i;
    else i++;
  }
  return text.length;
}

/** End index (exclusive) of a regex literal starting at `start`, with flags. Stops at a line end if it never closes. */
function regexEnd(text: string, start: number): number {
  let inClass = false;
  let i = start + 1;
  while (i < text.length && text[i] !== "\n") {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === "[") {
      inClass = true;
      i++;
    } else if (c === "]") {
      inClass = false;
      i++;
    } else if (c === "/" && !inClass) {
      i++;
      while (i < text.length && /[a-z]/.test(text[i])) i++;
      return i;
    } else i++;
  }
  return Math.min(i, text.length);
}

/** The forbidden-key negative list in the DTO module. Its entries are data, not names this guard scans (see dimension 8). */
const FORBIDDEN_DTO_ARRAY = /export const FORBIDDEN_DTO_KEYS = \[[^\]]*\]/;

/** Comment-stripped code for the name scans (dimensions 3, 4 and 7). In the DTO module only the forbidden list is removed. */
function nameScanCode(file: SourceFile): string {
  const code = stripComments(file.text);
  return file.path === DTO_KEYS_FILE ? code.replace(FORBIDDEN_DTO_ARRAY, "") : code;
}

const moduleKey = (target: string) => target.replace(/\.(?:ts|tsx|js|mjs)$/, "").replace(/\/index$/, "");

function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) return posix.normalize(specifier.slice(2));
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), specifier));
  return undefined;
}

/** Every literal specifier form, including `export … from` (it contains `from`), `require`, `vi.mock` and dynamic import. */
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

const isClientFile = (file: SourceFile) =>
  /\/(client|components)\//.test(`/${file.path}`) || /^(["'])use client\1/.test(stripComments(file.text).trimStart());

/* --- dimension 1: storage identifiers (raw text, comments counted; see header) --- */

/**
 * The participant index and owner subtree identifiers, anywhere in the tree (src and app). The owner subtree is matched
 * as a quoted segment or as a segment right after an interpolated owner uid (`${uid}/conversations`), which is how a
 * storage path is built. A plain route path (`/conversations/route`) is not a storage reference and is not matched.
 */
const COLLECTION_IDENTIFIER = new RegExp(
  String.raw`\bconversationParticipations\b|["'\x60]conversations["'\x60]|\/conversations["'\x60]|\}\/conversations\b|\/conversations\/\$\{`,
);
/** The owner subtree parent name, as a word. Scanned in D2 files only; the D1 guard already owns it tree-wide. */
const USER_DEVELOPMENT_PARENT = new RegExp(String.raw`\b${["user", "Development"].join("")}\b`);

/**
 * A whole string literal that is one public owner route URL (TASK-023): an optional scheme and host, the exact prefix,
 * then at most one conversation-id segment and one known sub-resource. The public page route `/me/conversations` and its
 * detail segment (TASK-026) are exempt in the same way; they are UI paths, not storage paths. Route tests name these URLs, which are plain
 * paths and never storage paths, so only such a literal is removed before the scan. The quotes must match, and the
 * literal must start at its quote, so a route-shaped fragment inside a larger path or template is never removed, and
 * an arbitrary suffix (a second `conversations` segment, a `${uid}` prefix) stays in the scanned text.
 *
 * The create-options route (TASK-027 amendment) is exempt only as the exact whole literal `/api/me/conversations/create-options`.
 * It is excluded from the id branch, so `create-options` followed by a sub-resource or a further segment is never exempt.
 * The owner selector sub-resource (`selectable-members`, SPEC Amendment 2026-10-19) is one more exact name in the
 * sub-resource list, so a route test may name its URL and no other sub-resource is exempt.
 */
const PUBLIC_CONVERSATION_ROUTE_LITERAL = new RegExp(
  String.raw`(["'\x60])(?:(?:(?:GET|POST|PATCH|PUT|DELETE) )?(?:https?:\/\/[^\/"'\x60\n]+)?\/api\/me\/conversations(?:\/create-options|\/(?!create-options(?:["'\x60]|\/))(?:[A-Za-z0-9_-]+|\$\{[A-Za-z0-9_.]+\})(?:\/(?:participant-notes|participation(?:\/accept)?|selectable-members))?)?|\/me\/conversations(?:\/(?:[A-Za-z0-9_-]+|\$\{[A-Za-z0-9_.]+\}))?)\1`,
  "g",
);

function collectionReferenceViolations(
  files: SourceFile[],
  approved: readonly string[] = APPROVED_COLLECTION_REFERENCES,
): string[] {
  return files
    .filter((f) => isGuarded(f.path) && !approved.includes(f.path))
    .filter((f) => {
      const text = f.text.replace(PUBLIC_CONVERSATION_ROUTE_LITERAL, "$1$1");
      return COLLECTION_IDENTIFIER.test(text) || (isD2(f.path) && USER_DEVELOPMENT_PARENT.test(text));
    })
    .map((f) => f.path);
}

/* --- dimension 2: no collection group, no client SDK (all D2 files, tests included; code only) --- */

function groupAndClientSdkViolations(files: SourceFile[]): string[] {
  const groupToken = new RegExp(String.raw`\b${["collection", "Group"].join("")}\b`);
  return files
    .filter((f) => isGuarded(f.path) && isD2(f.path))
    .flatMap((f) => {
      const { resolved, bare } = specifiers(f);
      const out = bare
        .filter((s) => s === "firebase" || s.startsWith("firebase/") || s.startsWith("@firebase/"))
        .map((s) => `${f.path}: client SDK ${s}`);
      for (const t of resolved) if (moduleKey(t) === "src/lib/firebase/client") out.push(`${f.path}: ${moduleKey(t)}`);
      if (groupToken.test(stripComments(f.text))) out.push(`${f.path}: collection group`);
      return out;
    });
}

/* --- dimension 3: forbidden imports and identity helpers (D2 production code) --- */

function forbiddenImportViolations(
  files: SourceFile[],
  seams: ReadonlyArray<{ importer: string; module: string }> = APPROVED_PERSONAL_GOALS_SEAMS,
): string[] {
  return files
    .filter((f) => isD2Production(f.path))
    .flatMap((f) => {
      const { resolved } = specifiers(f);
      const out = resolved
        .filter((t) => FORBIDDEN_IMPORT_PREFIXES.some((prefix) => t.startsWith(prefix)))
        .map((t) => `${f.path} -> ${t}`);
      for (const t of resolved) {
        const target = moduleKey(t);
        if (!target.startsWith("src/features/personal-goals/")) continue;
        if (seams.some((seam) => seam.importer === f.path && seam.module === target)) continue;
        out.push(`${f.path} -> ${target}`);
      }
      return out;
    });
}

function authorityIdentifierViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2Production(f.path))
    .flatMap((f) => {
      const code = nameScanCode(f);
      return FORBIDDEN_AUTHORITY_IDENTIFIERS.filter((id) => new RegExp(`\\b${id}\\b`).test(code)).map((id) => `${f.path}: ${id}`);
    });
}

/* --- dimension 4: forbidden identifiers (D2 production code) --- */

function forbiddenIdentifierViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2Production(f.path))
    .flatMap((f) => {
      const code = nameScanCode(f);
      return FORBIDDEN_IDENTIFIERS.filter((id) => new RegExp(`\\b${id}\\b`).test(code)).map((id) => `${f.path}: ${id}`);
    });
}

/* --- dimension 5: encryption helper imports, client boundary, server-only marker --- */

function encryptionImporterViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2(f.path) && isGuarded(f.path) && !APPROVED_ENCRYPTION_IMPORTERS.includes(f.path))
    .filter((f) => specifiers(f).resolved.some((t) => moduleKey(t).startsWith(ENCRYPTION_DIR)))
    .map((f) => f.path);
}

/** Client code (`client/`, `components/`, or a `"use client"` file) never imports D2 server modules or the codec. */
function clientBoundaryViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2(f.path) && isGuarded(f.path) && isClientFile(f))
    .filter((f) =>
      specifiers(f).resolved.some((t) => moduleKey(t).startsWith(D2_SERVER_DIR) || moduleKey(t).startsWith(ENCRYPTION_DIR)),
    )
    .map((f) => f.path);
}

/** Every D2 server production module declares `import "server-only"`, so a client bundle cannot pull it in silently. */
function serverOnlyViolations(files: SourceFile[]): string[] {
  return files.filter((f) => isServerProduction(f.path) && !specifiers(f).bare.includes("server-only")).map((f) => f.path);
}

/* --- dimension 6: logging of sensitive variables (all D2 files, tests included; code only, strings removed) --- */

const LOG_CALL = /\b(?:console\.(?:log|info|warn|error|debug|trace)|logger\.\w+)\s*\(/g;

/**
 * The argument text of each call that `callStart` matches, found by matching parentheses, so a nested call stays inside
 * its outer argument. `callStart` must end at the opening parenthesis and be global.
 */
function callArguments(code: string, callStart: RegExp): string[] {
  const args: string[] = [];
  for (const match of code.matchAll(callStart)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }
    args.push(code.slice(start, i - 1));
  }
  return args;
}

const stripStringContents = (text: string) =>
  text
    .replace(/"[^"\n]*"|'[^'\n]*'/g, '""')
    .replace(/`[^`]*`/g, (template) => (template.match(/\$\{[^}]*\}/g) ?? []).join(" "));

/** All D2 files, tests included (TASK-034): a test that logs a sensitive variable is the same leak as production code. */
function logViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2(f.path) && isGuarded(f.path))
    .flatMap((f) => {
      const args = callArguments(stripComments(f.text), LOG_CALL).map(stripStringContents).join(" ");
      return SENSITIVE_LOG_IDENTIFIERS.filter((id) => new RegExp(`\\b${id}\\b`).test(args)).map((id) => `${f.path}: ${id}`);
    });
}

/* --- dimension 7: forbidden concepts (D2 production code; comment-stripped; DTO module strings excluded) --- */

/** Words of identifiers and strings, camelCase and snake_case split, lower-cased, joined by single spaces. */
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
    .filter((f) => isD2Production(f.path))
    .flatMap((f) => {
      const words = ` ${conceptWords(nameScanCode(f))} `;
      const out = FORBIDDEN_CONCEPT_WORDS.filter((w) => words.includes(` ${w} `)).map((w) => `${f.path}: ${w}`);
      for (const phrase of FORBIDDEN_CONCEPT_PHRASES) if (words.includes(` ${phrase} `)) out.push(`${f.path}: ${phrase}`);
      return out;
    });
}

/* --- dimension 8: persisted and DTO key allow-lists --- */

/** Set equality of a key list, independent of order. Empty when the lists match. */
const keyMismatch = (actual: readonly string[], expected: readonly string[]): string[] => [
  ...actual.filter((k) => !expected.includes(k)).map((k) => `unexpected: ${k}`),
  ...expected.filter((k) => !actual.includes(k)).map((k) => `missing: ${k}`),
  ...(new Set(actual).size !== actual.length ? ["duplicate key"] : []),
];

const PERSISTED_PINS: Array<[string, readonly string[], readonly string[]]> = [
  ["STORED_OWNER_PLAIN_KEYS", STORED_OWNER_PLAIN_KEYS, EXPECTED_STORED_OWNER_PLAIN_KEYS],
  ["PARTICIPATION_INDEX_KEYS", PARTICIPATION_INDEX_KEYS, EXPECTED_PARTICIPATION_INDEX_KEYS],
  ["CONTENT_PAYLOAD_KEYS", CONTENT_PAYLOAD_KEYS, EXPECTED_CONTENT_PAYLOAD_KEYS],
  ["SHARED_GOAL_SNAPSHOT_KEYS", SHARED_GOAL_SNAPSHOT_KEYS, EXPECTED_SHARED_GOAL_SNAPSHOT_KEYS],
];

function persistedPinViolations(pins: ReadonlyArray<[string, readonly string[], readonly string[]]>): string[] {
  return pins.flatMap(([name, actual, expected]) => keyMismatch(actual, expected).map((m) => `${name} ${m}`));
}

/** Every DTO allow-list in the DTO module: the `export const <NAME>_KEYS = [ … ]` form, read from code. */
const DTO_ARRAY = /export const (\w+_KEYS) = \[([^\]]*)\]/g;
function keyArraysFromSource(text: string): Record<string, string[]> {
  return Object.fromEntries(
    [...stripComments(text).matchAll(DTO_ARRAY)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((s) => s[1])]),
  );
}

/** Forbidden keys in any DTO allow-list except the forbidden list itself. Current and future arrays are covered alike. */
const DTO_FORBIDDEN_KEYS: readonly string[] = [...dtoKeys.FORBIDDEN_DTO_KEYS, ...INTERNAL_ONLY_KEYS];
function dtoAllowListViolations(lists: Record<string, readonly string[]>): string[] {
  return Object.entries(lists)
    .filter(([name]) => name !== "FORBIDDEN_DTO_KEYS")
    .flatMap(([name, keys]) => keys.filter((k) => DTO_FORBIDDEN_KEYS.includes(k)).map((k) => `${name}: ${k}`));
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
const importLine = (specifier: string) => `import { x } from "${specifier}";`;
const UD = ["user", "Development"].join("");
const SF = ["skill", "Profiles"].join("");
const CG = ["collection", "Group"].join("");

/* ----------------------------------- tests ----------------------------------- */

describe("D2 scope guard — sanity", () => {
  it("scans the real tree and finds the D2 domain files, the codec and this guard", () => {
    expect(realFiles.some((f) => f.path === `${D2_DOMAIN_DIR}dto-keys.ts`)).toBe(true);
    expect(realFiles.some((f) => f.path === `${D2_SERVER_DIR}content-codec.ts`)).toBe(true);
    expect(realFiles.some((f) => f.path === GUARD_FILE)).toBe(true);
  });

  it("reads the DTO module's allow-lists from code, and sees every exported *_KEYS array", () => {
    const dtoText = realFiles.find((f) => f.path === DTO_KEYS_FILE)?.text ?? "";
    const runtimeNames = Object.keys(dtoKeys).filter((name) => name.endsWith("_KEYS")).sort();
    expect(Object.keys(keyArraysFromSource(dtoText)).sort()).toEqual(runtimeNames);
  });
});

describe("D2 scope guard — persistence identifiers (dimension 1)", () => {
  it("only the approved files reference a D2 storage identifier on the real tree", () => {
    expect(collectionReferenceViolations(realFiles)).toEqual([]);
  });

  it("fails for an unapproved reference in any form, and passes an approved file", () => {
    expect(
      collectionReferenceViolations([
        virtual(`${D2_SERVER_DIR}list.ts`, `const ref = db.doc("${UD}/u/conversations/c");`),
        virtual(`${D2_SERVER_DIR}index.ts`, `const c = "conversationParticipations";`),
        virtual(`${D2_SERVER_DIR}quoted.ts`, `const c = 'conversations';`),
        virtual(`${D2_DOMAIN_DIR}comment.ts`, `// stored under ${UD}\nexport const x = 1;`),
        virtual("app/api/admin/conversations/route.ts", 'const p = `${ownerUid}/conversations/x`;'),
        virtual("src/features/teams/server/x.ts", 'const p = `${uid}/conversations/abc`;'),
      ]),
    ).toEqual([
      `${D2_SERVER_DIR}list.ts`,
      `${D2_SERVER_DIR}index.ts`,
      `${D2_SERVER_DIR}quoted.ts`,
      `${D2_DOMAIN_DIR}comment.ts`,
      "app/api/admin/conversations/route.ts",
      "src/features/teams/server/x.ts",
    ]);
    expect(
      collectionReferenceViolations([virtual(`${D2_SERVER_DIR}store.ts`, `const c = "conversations";`)], [`${D2_SERVER_DIR}store.ts`]),
    ).toEqual([]);
  });

  it("ignores the public route URL in a test, but still flags a storage path in the same file", () => {
    expect(
      collectionReferenceViolations([
        virtual(`${D2_ROUTE_DIRS[0]}route.test.ts`, 'const url = "http://localhost/api/me/conversations/c1";'),
      ]),
    ).toEqual([]);
    expect(
      collectionReferenceViolations([
        virtual(`${D2_ROUTE_DIRS[0]}route.test.ts`, 'const url = "http://localhost/api/me/conversations/c1";\nconst p = `${uid}/conversations/c1`;'),
      ]),
    ).toEqual([`${D2_ROUTE_DIRS[0]}route.test.ts`]);
  });

  it("exempts only whole public route URL literals: bare, with an id, with an id and a sub-resource, and with a host", () => {
    const routes = [
      `const u = "/api/me/conversations";`,
      `const u = "/api/me/conversations/c0000000000000000001";`,
      "const u = `/api/me/conversations/${id}/participant-notes`;",
      `describe("GET /api/me/conversations", () => {});`,
      `const u = "/api/me/conversations/c1/participation/accept";`,
      `const u = "http://localhost/api/me/conversations/c1";`,
    ];
    for (const line of routes) {
      expect(collectionReferenceViolations([virtual(`${D2_ROUTE_DIRS[0]}route.test.ts`, line)])).toEqual([]);
    }
  });

  it("exempts only the exact public page route literal `/me/conversations`, with an id or interpolated id, in a UI file", () => {
    const uiFile = `${D2_COMPONENTS_DIR}Links.tsx`;
    const pageLiterals = [
      `const href = "/me/conversations";`,
      `const href = "/me/conversations/c0000000000000000001";`,
      "const href = `/me/conversations/${id}`;",
    ];
    for (const line of pageLiterals) {
      expect(collectionReferenceViolations([virtual(uiFile, line)])).toEqual([]);
    }
  });

  it("still flags the page route literal when it is not a whole quoted literal, or when it sits beside a storage reference", () => {
    const uiFile = `${D2_COMPONENTS_DIR}Links.tsx`;
    const flagged = [
      "const p = `${uid}/me/conversations/${id}`;",
      "const p = `/me/conversations/${uid}/conversations/${id}`;",
      `const p = "/me/conversations/c1/conversations";`,
      `const p = "/me/conversations-extra/conversations";`,
      `const p = "/me/conversations" + "/conversations";`,
      `const a = "/me/conversations"; const b = "conversations";`,
      `const p = "/me/conversations"; const root = "${["user", "Development"].join("")}";`,
    ];
    for (const line of flagged) {
      expect(collectionReferenceViolations([virtual(uiFile, line)])).toEqual([uiFile]);
    }
  });

  it("gives no blanket exemption to a route-shaped fragment inside a larger storage path or template", () => {
    const storageShaped = [
      "const p = `${uid}/api/me/conversations/${id}`;",
      "const p = `/api/me/conversations/${uid}/conversations/${id}`;",
      `const p = "/api/me/conversations/x/conversations";`,
      "const p = `base/api/me/conversations/${id}`;",
    ];
    for (const line of storageShaped) {
      expect(collectionReferenceViolations([virtual(`${D2_SERVER_DIR}store-shaped.ts`, line)])).toEqual([`${D2_SERVER_DIR}store-shaped.ts`]);
    }
  });

  it("still flags the owner subtree root and a participant index token beside a route URL in the same file", () => {
    expect(
      collectionReferenceViolations([
        virtual(`${D2_ROUTE_DIRS[0]}route.test.ts`, `const url = "/api/me/conversations/c1";\nconst root = "${["user", "Development"].join("")}";`),
      ]),
    ).toEqual([`${D2_ROUTE_DIRS[0]}route.test.ts`]);
    expect(
      collectionReferenceViolations([
        virtual(`${D2_ROUTE_DIRS[0]}route.test.ts`, `const url = "/api/me/conversations";\nconst i = "${["conversation", "Participations"].join("")}";`),
      ]),
    ).toEqual([`${D2_ROUTE_DIRS[0]}route.test.ts`]);
  });

  it("catches a segment joined to a constant base, which a plain-path pattern would miss", () => {
    expect(collectionReferenceViolations([virtual(`${D2_SERVER_DIR}join.ts`, `const p = base + "/conversations";`)])).toEqual([
      `${D2_SERVER_DIR}join.ts`,
    ]);
  });

  it("does not flag a plain route path or the feature name", () => {
    expect(
      collectionReferenceViolations([
        virtual(`${D2_SERVER_DIR}ok.ts`, `import { x } from "@/app/api/me/conversations/route";\nconst name = "development-conversations";`),
      ]),
    ).toEqual([]);
  });
});

describe("D2 scope guard — no collection group, no client SDK (dimension 2)", () => {
  it("the real tree has no collection group and no client SDK import", () => {
    expect(groupAndClientSdkViolations(realFiles)).toEqual([]);
  });

  it("fails for a client SDK import, the client helper and a collection group, including in tests", () => {
    expect(
      groupAndClientSdkViolations([
        virtual(`${D2_SERVER_DIR}a.ts`, importLine("firebase/firestore")),
        virtual(`${D2_SERVER_DIR}b.test.ts`, importLine("firebase/app")),
        virtual(`${D2_SERVER_DIR}c.ts`, importLine("@firebase/firestore")),
        virtual(`${D2_SERVER_DIR}d.ts`, importLine("firebase")),
        virtual(`${D2_SERVER_DIR}e.ts`, importLine("@/src/lib/firebase/client")),
        virtual(`${D2_SERVER_DIR}f.ts`, `const q = db.${CG}("x");`),
      ]).length,
    ).toBe(6);
  });

  it("does not let comment-like text inside a string hide a later collection-group call", () => {
    expect(groupAndClientSdkViolations([virtual(`${D2_SERVER_DIR}a.ts`, `const glob = "src/**";\ndb.${CG}("x");\n/** doc */\n`)])).toHaveLength(1);
    expect(groupAndClientSdkViolations([virtual(`${D2_SERVER_DIR}b.ts`, `const sep = "//"; db.${CG}("x");`)])).toHaveLength(1);
    expect(groupAndClientSdkViolations([virtual(`${D2_SERVER_DIR}c.ts`, `const r = /[/]+/; db.${CG}("x");`)])).toHaveLength(1);
  });

  it("allows the Admin SDK module and ignores a collection-group word in a comment", () => {
    expect(
      groupAndClientSdkViolations([
        virtual(`${D2_SERVER_DIR}ok.ts`, `${importLine("firebase-admin/firestore")}\n// no ${CG} here`),
      ]),
    ).toEqual([]);
  });
});

describe("D2 scope guard — forbidden imports and identity helpers (dimension 3)", () => {
  it("the real tree imports no forbidden module and names no authority helper in D2 production code", () => {
    expect(forbiddenImportViolations(realFiles)).toEqual([]);
    expect(authorityIdentifierViolations(realFiles)).toEqual([]);
  });

  it("fails for C1, C2, roadmap, skill-tree server, results, forum, surveys, challenges and D1 goal imports", () => {
    expect(
      forbiddenImportViolations([
        virtual(`${D2_SERVER_DIR}a.ts`, importLine("../../skill-profiles/domain/x")),
        virtual(`${D2_SERVER_DIR}b.ts`, importLine("../../team-skills/server/x")),
        virtual(`${D2_SERVER_DIR}c.ts`, importLine("../../skill-trees/server/x")),
        virtual(`${D2_SERVER_DIR}d.ts`, importLine("../../results/domain/x")),
        virtual(`${D2_SERVER_DIR}e.ts`, importLine("../../personal-goals/server/goal-store")),
        virtual(`${D2_SERVER_DIR}f.ts`, `const m = await import("../../forum/server/x");`),
      ]),
    ).toHaveLength(6);
  });

  it("accepts only the exact importer and module pair of an approved D1 seam", () => {
    const seam = [{ importer: `${D2_SERVER_DIR}snapshot.ts`, module: "src/features/personal-goals/server/goal-snapshot" }];
    expect(forbiddenImportViolations([virtual(`${D2_SERVER_DIR}snapshot.ts`, importLine("../../personal-goals/server/goal-snapshot"))], seam)).toEqual([]);
    expect(forbiddenImportViolations([virtual(`${D2_SERVER_DIR}snapshot.ts`, importLine("../../personal-goals/server/goal-store"))], seam)).toHaveLength(1);
    expect(forbiddenImportViolations([virtual(`${D2_SERVER_DIR}other.ts`, importLine("../../personal-goals/server/goal-snapshot"))], seam)).toHaveLength(1);
  });

  it("admits the snapshot seam only for the D1 store module, and never for D1 domain or route code", () => {
    const snapshot = `${D2_SERVER_DIR}read-owned-goal-snapshots.ts`;
    expect(forbiddenImportViolations([virtual(snapshot, importLine("../../personal-goals/server/goal-store"))])).toEqual([]);
    expect(forbiddenImportViolations([virtual(snapshot, importLine("../../personal-goals/domain/goal"))])).toHaveLength(1);
    expect(forbiddenImportViolations([virtual(snapshot, importLine("../../personal-goals/server/get-personal-goals"))])).toHaveLength(1);
    expect(forbiddenImportViolations([virtual(`${D2_SERVER_DIR}second.ts`, importLine("../../personal-goals/server/goal-store"))])).toHaveLength(1);
  });

  it("allows the D2-local skill-tree domain and rejects an authority helper in production code", () => {
    expect(forbiddenImportViolations([virtual(`${D2_SERVER_DIR}ok.ts`, importLine("../../skill-trees/domain/x"))])).toEqual([]);
    expect(
      authorityIdentifierViolations([
        virtual(`${D2_SERVER_DIR}a.ts`, `import { isAppAdmin } from "@/src/lib/auth";`),
        virtual(`${D2_SERVER_DIR}b.ts`, `const ok = resolveTeamRole(x);`),
        virtual(`${D2_SERVER_DIR}c.test.ts`, `const ok = isAppAdmin(x);`),
      ]),
    ).toEqual([`${D2_SERVER_DIR}a.ts: isAppAdmin`, `${D2_SERVER_DIR}b.ts: resolveTeamRole`]);
  });
});

describe("D2 scope guard — forbidden identifiers (dimension 4)", () => {
  it("the real tree contains no forbidden identifier in D2 production code", () => {
    expect(forbiddenIdentifierViolations(realFiles)).toEqual([]);
  });

  it("scans the allow-lists of the DTO module, and skips only its forbidden negative list", () => {
    expect(
      forbiddenIdentifierViolations([virtual(DTO_KEYS_FILE, 'export const NEW_DTO_KEYS = ["conversationId", "calendar"] as const;')]),
    ).toEqual([`${DTO_KEYS_FILE}: calendar`]);
    expect(forbiddenIdentifierViolations([virtual(DTO_KEYS_FILE, 'export const FORBIDDEN_DTO_KEYS = ["calendar"] as const;')])).toEqual([]);
  });

  it("fails for a forbidden identifier, and ignores it in a comment", () => {
    expect(
      forbiddenIdentifierViolations([
        virtual(`${D2_SERVER_DIR}a.ts`, `const ${SF} = 1;`),
        virtual(`${D2_SERVER_DIR}b.ts`, `const sendMail = () => 1;`),
        virtual(`${D2_SERVER_DIR}c.ts`, `const data = { email: "x" };`),
        virtual(`${D2_SERVER_DIR}d.ts`, `// ${SF} and calendar are not used here`),
        virtual(`${D2_SERVER_DIR}e.test.ts`, `const notification = 1;`),
      ]),
    ).toEqual([`${D2_SERVER_DIR}a.ts: ${SF}`, `${D2_SERVER_DIR}b.ts: sendMail`, `${D2_SERVER_DIR}c.ts: email`]);
  });
});

describe("D2 scope guard — encryption helper and client boundary (dimension 5)", () => {
  it("only the codec and its test import the encryption helper, and client code imports no server module", () => {
    expect(encryptionImporterViolations(realFiles)).toEqual([]);
    expect(clientBoundaryViolations(realFiles)).toEqual([]);
  });

  it("fails for a raw helper import, a re-export, a require and a client importing the codec", () => {
    expect(
      encryptionImporterViolations([
        virtual(`${D2_SERVER_DIR}store.ts`, importLine("../../../lib/encryption/encryption")),
        virtual(`${D2_SERVER_DIR}barrel.ts`, `export { encrypt } from "../../../lib/encryption/encryption";`),
        virtual(`${D2_SERVER_DIR}req.ts`, `const h = require("@/src/lib/encryption/encryption");`),
        virtual(`${D2_SERVER_DIR}fake-content-codec.ts`, importLine("../../../lib/encryption/encryption")),
        virtual(`${D2_SERVER_DIR}content-codec.test.ts`, importLine("../../../lib/encryption/encryption")),
      ]),
    ).toEqual([
      `${D2_SERVER_DIR}store.ts`,
      `${D2_SERVER_DIR}barrel.ts`,
      `${D2_SERVER_DIR}req.ts`,
      `${D2_SERVER_DIR}fake-content-codec.ts`,
    ]);
    expect(
      clientBoundaryViolations([
        virtual(`${D2_DIR}client/gateway.ts`, importLine("../server/content-codec")),
        virtual(`${D2_DIR}components/list.tsx`, importLine("../../../lib/encryption/encryption")),
        virtual(`${D2_DIR}page-view.tsx`, `"use client";\n${importLine("./server/get-conversation")}`),
        virtual(`${D2_DIR}domain/ok.ts`, importLine("./text-rules")),
      ]),
    ).toEqual([`${D2_DIR}client/gateway.ts`, `${D2_DIR}components/list.tsx`, `${D2_DIR}page-view.tsx`]);
  });

  it("requires the server-only marker on every D2 server production module, and not on tests", () => {
    expect(serverOnlyViolations(realFiles)).toEqual([]);
    expect(
      serverOnlyViolations([
        virtual(`${D2_SERVER_DIR}bare.ts`, `export const x = 1;`),
        virtual(`${D2_SERVER_DIR}marked.ts`, `import "server-only";\nexport const x = 1;`),
        virtual(`${D2_SERVER_DIR}bare.test.ts`, `export const x = 1;`),
      ]),
    ).toEqual([`${D2_SERVER_DIR}bare.ts`]);
  });
});

describe("D2 scope guard — logging of sensitive variables (dimension 6)", () => {
  it("the real tree passes the lexical log check", () => {
    expect(logViolations(realFiles)).toEqual([]);
  });

  it("fails for a sensitive variable in a log call in production code or in a D2 test, and passes a safe message or a comment", () => {
    expect(
      logViolations([
        virtual(`${D2_SERVER_DIR}a.ts`, `console.error(title);`),
        virtual(`${D2_SERVER_DIR}b.ts`, `logger.warn("failed", { ownerUid: x });`),
        virtual(`${D2_SERVER_DIR}c.ts`, `console.log(\`note \${notes}\`);`),
        virtual(`${D2_SERVER_DIR}d.ts`, `console.error("title missing", { code: "invalid_input" });`),
        virtual(`${D2_SERVER_DIR}e.ts`, `// console.log(title);\nconst t = 1;`),
        virtual(`${D2_SERVER_DIR}f.test.ts`, `console.log(uid);`),
      ]),
    ).toEqual([`${D2_SERVER_DIR}a.ts: title`, `${D2_SERVER_DIR}b.ts: ownerUid`, `${D2_SERVER_DIR}c.ts: notes`, `${D2_SERVER_DIR}f.test.ts: uid`]);
  });
});

describe("D2 scope guard — forbidden concepts (dimension 7)", () => {
  it("the real tree names no forbidden concept in D2 production text", () => {
    expect(forbiddenConceptViolations(realFiles)).toEqual([]);
  });

  it("fails for a forbidden word or phrase in an identifier or string, and ignores a comment", () => {
    expect(
      forbiddenConceptViolations([
        virtual(`${D2_SERVER_DIR}a.ts`, `const score = 1;`),
        virtual(`${D2_SERVER_DIR}b.ts`, `const lastViewed = 1;`),
        virtual(`${D2_SERVER_DIR}c.ts`, `const s = "last_viewed";`),
        virtual(`${D2_SERVER_DIR}d.ts`, `const s = "a manager note";`),
        virtual(`${D2_SERVER_DIR}e.ts`, `// no score, no rating, no read receipt\nconst ok = "sharedGoals";`),
        virtual(`${D2_SERVER_DIR}f.ts`, `const uptime = 1; const ranking = 2;`),
      ]),
    ).toEqual([`${D2_SERVER_DIR}a.ts: score`, `${D2_SERVER_DIR}b.ts: last viewed`, `${D2_SERVER_DIR}c.ts: last viewed`, `${D2_SERVER_DIR}d.ts: manager note`]);
  });
});

describe("D2 scope guard — persisted and DTO key allow-lists (dimension 8)", () => {
  const dtoLists = Object.fromEntries(
    Object.entries(dtoKeys)
      .filter(([name]) => name.endsWith("_KEYS"))
      .map(([name, keys]) => [name, [...(keys as readonly string[])]]),
  );

  it("pins the persisted key sets to the TASK-002 exports on the real tree", () => {
    expect(persistedPinViolations(PERSISTED_PINS)).toEqual([]);
  });

  it("pins each DTO allow-list to its expected key set on the real tree", () => {
    for (const [name, expected] of Object.entries(EXPECTED_DTO_KEYS)) {
      expect(keyMismatch(dtoLists[name] as string[], expected), name).toEqual([]);
    }
  });

  it("fails when a persisted key set gains plaintext content or loses a metadata key", () => {
    expect(
      persistedPinViolations([
        ["PARTICIPATION_INDEX_KEYS", ["ownerUid", "invitedAt", "title"], EXPECTED_PARTICIPATION_INDEX_KEYS],
        ["STORED_OWNER_PLAIN_KEYS", EXPECTED_STORED_OWNER_PLAIN_KEYS.filter((k) => k !== "keyCheck"), EXPECTED_STORED_OWNER_PLAIN_KEYS],
      ]),
    ).toEqual(["PARTICIPATION_INDEX_KEYS unexpected: title", "STORED_OWNER_PLAIN_KEYS missing: keyCheck"]);
  });

  it("the real DTO allow-lists contain no forbidden or internal-only key, current or future", () => {
    expect(dtoAllowListViolations(dtoLists)).toEqual([]);
    expect(dtoAllowListViolations(keyArraysFromSource(realFiles.find((f) => f.path === DTO_KEYS_FILE)?.text ?? ""))).toEqual([]);
  });

  it("fails for a forbidden key in a future DTO allow-list, from the module or from the source text", () => {
    expect(dtoAllowListViolations({ FUTURE_DTO_KEYS: ["conversationId", "keyCheck"] })).toEqual(["FUTURE_DTO_KEYS: keyCheck"]);
    expect(dtoAllowListViolations({ FORBIDDEN_DTO_KEYS: ["keyCheck"] })).toEqual([]);
    expect(
      dtoAllowListViolations(keyArraysFromSource(`export const NEW_DTO_KEYS = [\n  "conversationId",\n  "ciphertext",\n] as const;`)),
    ).toEqual(["NEW_DTO_KEYS: ciphertext"]);
  });

  it("the keyCheck boundary holds: no public allow-list contains keyCheck, and the internal-only list pins it", () => {
    expect(INTERNAL_ONLY_KEYS).toContain("keyCheck");
    for (const [name, keys] of Object.entries(dtoLists)) {
      expect(keys, name).not.toContain("keyCheck");
    }
    expect(dtoAllowListViolations({ PROBE_DTO_KEYS: ["keyCheck"] })).toEqual(["PROBE_DTO_KEYS: keyCheck"]);
  });
});

/* --- owner-read boundaries (TASK-011): exact importer files, D2 production code --- */

const OWNER_LIST_FILE = `${D2_SERVER_DIR}read-owner-conversations.ts`;
const OWNER_SHARED_FILE = `${D2_SERVER_DIR}owner-read.ts`;
const OWNER_DETAIL_FILE = `${D2_SERVER_DIR}read-owner-conversation.ts`;
const ROSTER_NAME_FILE = `${D2_SERVER_DIR}participant-presentation.ts`;
const CATALOG_SEAM_FILE = `${D2_SERVER_DIR}area-names.ts`;
const SKILL_TREES_PREFIX = "src/features/skill-trees/";
const DISPLAY_NAMES_MODULE = "src/features/profiles/server/get-display-names";
const AREA_NAMES_MODULE = `${D2_SERVER_DIR}area-names`;
const DETAIL_MODULE = `${D2_SERVER_DIR}read-owner-conversation`;
const SNAPSHOT_SEAM_MODULE = `${D2_SERVER_DIR}read-owned-goal-snapshots`;

/** D2 production files, other than the approved ones, that import a module matching `matches`. */
function unapprovedImporters(files: SourceFile[], matches: (target: string) => boolean, approved: readonly string[]): string[] {
  return files
    .filter((f) => isD2Production(f.path) && !approved.includes(f.path))
    .filter((f) => specifiers(f).resolved.some((t) => matches(moduleKey(t))))
    .map((f) => f.path);
}

/**
 * Owner reads never import the D1 goal snapshot reader (live D1 goals are read only at selection, BR-24), and never
 * import SkillTree code except through the area-name seam. The owner list and its shared module also never import the
 * area-name seam or the detail operation, so no area name can reach the list path (product-owner decision, 2026-10-17).
 */
function ownerReadViolations(files: SourceFile[]): string[] {
  const listAndShared = [OWNER_LIST_FILE, OWNER_SHARED_FILE];
  const ownerReads = [...listAndShared, OWNER_DETAIL_FILE];
  return files.flatMap((f) => {
    const forbidden = (target: string): boolean => {
      if (!ownerReads.includes(f.path)) return false;
      if (target === SNAPSHOT_SEAM_MODULE || target.startsWith("src/features/personal-goals/")) return true;
      if (target.startsWith(SKILL_TREES_PREFIX)) return true;
      return listAndShared.includes(f.path) && (target === AREA_NAMES_MODULE || target === DETAIL_MODULE);
    };
    return specifiers(f)
      .resolved.map(moduleKey)
      .filter(forbidden)
      .map((target) => `${f.path} -> ${target}`);
  });
}

describe("D2 scope guard — owner-read boundaries (TASK-011)", () => {
  it("the real tree has one SkillTree importer (the area-name seam) and one getDisplayNames importer (the roster module)", () => {
    expect(realFiles.some((f) => f.path === CATALOG_SEAM_FILE && specifiers(f).resolved.some((t) => moduleKey(t).startsWith(SKILL_TREES_PREFIX)))).toBe(true);
    expect(realFiles.some((f) => f.path === ROSTER_NAME_FILE && specifiers(f).resolved.some((t) => moduleKey(t) === DISPLAY_NAMES_MODULE))).toBe(true);
    expect(unapprovedImporters(realFiles, (t) => t.startsWith(SKILL_TREES_PREFIX), [CATALOG_SEAM_FILE])).toEqual([]);
    expect(unapprovedImporters(realFiles, (t) => t === DISPLAY_NAMES_MODULE, [ROSTER_NAME_FILE])).toEqual([]);
  });

  it("fails for a SkillTree import or a getDisplayNames import outside its approved file, and passes the approved file", () => {
    expect(
      unapprovedImporters(
        [
          virtual(`${D2_SERVER_DIR}extra.ts`, importLine("../../skill-trees/domain/skill-tree")),
          virtual(CATALOG_SEAM_FILE, importLine("../../skill-trees/domain/skill-tree")),
        ],
        (t) => t.startsWith(SKILL_TREES_PREFIX),
        [CATALOG_SEAM_FILE],
      ),
    ).toEqual([`${D2_SERVER_DIR}extra.ts`]);
    expect(
      unapprovedImporters([virtual(OWNER_DETAIL_FILE, importLine("../../profiles/server/get-display-names"))], (t) => t === DISPLAY_NAMES_MODULE, [
        ROSTER_NAME_FILE,
      ]),
    ).toEqual([OWNER_DETAIL_FILE]);
  });

  it("the real tree keeps the owner reads off the snapshot seam, D1 goals and the catalog, and the list off the area-name seam", () => {
    expect(ownerReadViolations(realFiles)).toEqual([]);
  });

  it("fails for a list or shared import of the area-name seam or the detail, and for any owner-read import of the snapshot seam or SkillTree code", () => {
    expect(
      ownerReadViolations([
        virtual(OWNER_LIST_FILE, importLine("./area-names")),
        virtual(OWNER_SHARED_FILE, importLine("./read-owner-conversation")),
        virtual(OWNER_DETAIL_FILE, importLine("./read-owned-goal-snapshots")),
        virtual(OWNER_DETAIL_FILE, importLine("./area-names")),
        virtual(OWNER_LIST_FILE, importLine("../../skill-trees/domain/skill-tree")),
      ]),
    ).toEqual([
      `${OWNER_LIST_FILE} -> ${AREA_NAMES_MODULE}`,
      `${OWNER_SHARED_FILE} -> ${DETAIL_MODULE}`,
      `${OWNER_DETAIL_FILE} -> ${SNAPSHOT_SEAM_MODULE}`,
      `${OWNER_LIST_FILE} -> src/features/skill-trees/domain/skill-tree`,
    ]);
  });
});

/* --- teams imports (AD-1 enumerated list; TASK-027 amendment) --- */

const TEAMS_PREFIX = "src/features/teams/";
const TEAMS_DOMAIN_PREFIX = "src/features/teams/domain/";

/**
 * AD-1 names the pure `teams/domain` membership helpers as the only teams module D2 may import. A D2 production file that
 * imports any other teams module, including `teams/client` and `teams/server`, is a violation. Type-only imports count too.
 */
function teamsImportViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2Production(f.path))
    .filter((f) =>
      specifiers(f).resolved.some((t) => {
        const target = moduleKey(t);
        return target.startsWith(TEAMS_PREFIX) && !target.startsWith(TEAMS_DOMAIN_PREFIX);
      }),
    )
    .map((f) => f.path);
}

describe("D2 scope guard — teams imports (AD-1)", () => {
  it("the real D2 production tree imports teams only through teams/domain", () => {
    expect(teamsImportViolations(realFiles)).toEqual([]);
  });

  it("flags a D2 client or server import of teams/client, teams/server or a teams gateway", () => {
    expect(
      teamsImportViolations([
        virtual(`${D2_DIR}client/x.ts`, 'import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";'),
        virtual(`${D2_SERVER_DIR}y.ts`, 'import type { TeamOverviewEntry } from "../../teams/server/get-teams-overview";'),
      ]),
    ).toEqual([`${D2_DIR}client/x.ts`, `${D2_SERVER_DIR}y.ts`]);
  });

  it("allows teams/domain, and ignores a teams path that is only mentioned in a comment", () => {
    expect(
      teamsImportViolations([
        virtual(`${D2_SERVER_DIR}z.ts`, 'import { isValidMembershipFor } from "../../teams/domain/team-membership";\n// teams/client is not used'),
      ]),
    ).toEqual([]);
  });
});

describe("D2 scope guard — create-options route literal (TASK-027 amendment)", () => {
  const CREATE_OPTIONS_ROUTE = `${D2_ROUTE_DIRS[0]}route.test.ts`;

  it("exempts the exact create-options literal, with and without a host or method", () => {
    const lines = [
      'const url = "/api/me/conversations/create-options";',
      'const url = "http://localhost/api/me/conversations/create-options";',
      'const url = "GET /api/me/conversations/create-options";',
    ];
    for (const line of lines) {
      expect(collectionReferenceViolations([virtual(CREATE_OPTIONS_ROUTE, line)])).toEqual([]);
    }
  });

  it("does not exempt create-options with a sub-resource or a further conversations segment", () => {
    expect(
      collectionReferenceViolations([virtual(CREATE_OPTIONS_ROUTE, 'const p = "/api/me/conversations/create-options/conversations";')]),
    ).toEqual([CREATE_OPTIONS_ROUTE]);
    expect(
      collectionReferenceViolations([
        virtual(CREATE_OPTIONS_ROUTE, 'const p = "/api/me/conversations/create-options/participant-notes/conversations";'),
      ]),
    ).toEqual([CREATE_OPTIONS_ROUTE]);
  });
});

/* ------------------ selector read boundaries (SPEC Amendment 2026-10-19, TASK-029 I-1) ------------------ */

const GENERIC_ASSIGNABLE_MODULE = "src/features/teams/server/list-assignable-members";
const GENERIC_ASSIGNABLE_PATH = /\/assignable-members\b/;
const SELECTOR_OPERATION_FILE = `${D2_SERVER_DIR}read-selectable-members.ts`;
const SELECTOR_ROUTE_FILE = "app/api/me/conversations/[conversationId]/selectable-members/route.ts";
const OWNER_PREDICATE_MODULE = `${D2_SERVER_DIR}team-eligibility`;

/** The real-tree file at `path`. A missing file fails the test that asks for it. */
function fileAt(files: SourceFile[], path: string): SourceFile {
  const found = files.find((f) => f.path === path);
  if (!found) throw new Error(`expected a real D2 file at ${path}`);
  return found;
}

/** D2 production code that reaches the generic team endpoint, by importing its operation or by naming its path (no fallback). */
function genericEndpointViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2Production(f.path))
    .filter((f) => specifiers(f).resolved.some((t) => moduleKey(t) === GENERIC_ASSIGNABLE_MODULE) || GENERIC_ASSIGNABLE_PATH.test(nameScanCode(f)))
    .map((f) => f.path);
}

describe("D2 scope guard — selector read boundaries (SPEC Amendment 2026-10-19, TASK-029 I-1)", () => {
  it("the real tree has the owner selector operation and route, and the operation uses the D2 owner predicate", () => {
    expect(realFiles.some((f) => f.path === SELECTOR_ROUTE_FILE)).toBe(true);
    expect(specifiers(fileAt(realFiles, SELECTOR_OPERATION_FILE)).resolved.map(moduleKey)).toContain(OWNER_PREDICATE_MODULE);
  });

  it("no D2 production file reaches the generic team endpoint, by import or by path, on the real tree", () => {
    expect(genericEndpointViolations(realFiles)).toEqual([]);
  });

  it("fails for a D2 route or operation that imports the generic operation or names its path, and passes one that names neither", () => {
    expect(
      genericEndpointViolations([
        virtual(SELECTOR_ROUTE_FILE, importLine("../../../../../../src/features/teams/server/list-assignable-members")),
      ]),
    ).toEqual([SELECTOR_ROUTE_FILE]);
    expect(
      genericEndpointViolations([virtual(SELECTOR_OPERATION_FILE, 'const p = `/api/teams/${teamId}/assignable-members`;')]),
    ).toEqual([SELECTOR_OPERATION_FILE]);
    expect(
      genericEndpointViolations([virtual(SELECTOR_OPERATION_FILE, "// the generic assignable-members list is not used here\nexport const x = 1;")]),
    ).toEqual([]);
  });
});

/* ----------------- TASK-034 completion: CL-24, hidden fields, collection pins, AD-7 callers, rules block ----------------- */

/** Dimension 9: CL-24 (no notifications, no invitation expiry). Whole words of identifiers and strings, tests included. */
const CL24_FORBIDDEN_WORDS = ["notify", "notified", "notification", "notifications", "reminder", "reminders", "expire", "expires", "expired", "expiry", "expiration"];

function cl24Violations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2(f.path) && isGuarded(f.path))
    .flatMap((f) => {
      const words = ` ${conceptWords(nameScanCode(f))} `;
      return CL24_FORBIDDEN_WORDS.filter((w) => words.includes(` ${w} `)).map((w) => `${f.path}: ${w}`);
    });
}

/**
 * Dimension 10: the hidden-content invariant (TASK-034). No DTO or stored key may name a hidden role, a private area, an
 * admin view, an internal store or an assessment. Matched as a case-insensitive substring of each key, so `managerNote`
 * and `AdminFlag` are both caught. The real lists are the runtime exports of the DTO and persistence modules.
 */
const HIDDEN_FIELD_WORDS = ["private", "manager", "admin", "internal", "assessment"];

function hiddenFieldViolations(lists: Record<string, readonly string[]>): string[] {
  // The DTO module's negative list names these words on purpose, so it is skipped, as in dimension 8.
  return Object.entries(lists)
    .filter(([name]) => name !== "FORBIDDEN_DTO_KEYS")
    .flatMap(([name, keys]) => keys.filter((k) => HIDDEN_FIELD_WORDS.some((w) => k.toLowerCase().includes(w))).map((k) => `${name}: ${k}`));
}

const RUNTIME_DTO_LISTS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(dtoKeys)
    .filter(([name]) => name.endsWith("_KEYS"))
    .map(([name, keys]) => [name, [...(keys as readonly string[])]]),
);
const REAL_PERSISTED_LISTS: Record<string, readonly string[]> = {
  STORED_OWNER_PLAIN_KEYS: [...STORED_OWNER_PLAIN_KEYS],
  PARTICIPATION_INDEX_KEYS: [...PARTICIPATION_INDEX_KEYS],
  CONTENT_PAYLOAD_KEYS: [...CONTENT_PAYLOAD_KEYS],
  SHARED_GOAL_SNAPSHOT_KEYS: [...SHARED_GOAL_SNAPSHOT_KEYS],
};

/**
 * Dimension 11: collection access (TASK-034, "no new collection outside user-development"). Each D2 production file may call
 * `.collection(…)` only with the arguments pinned here, which are exact source texts. A new collection name, or a new file
 * that calls `.collection(…)`, is a violation until this pin is edited on purpose. The pins are read-only reads of team,
 * membership and skill-tree documents, plus the owner subtree helper that writes only under `user-development`.
 *
 * Limit: the guard compares the argument text at each call site, whole and with nested parentheses included. It does not
 * resolve an identifier (a pinned `parent` is pinned as the word, not as the collection it holds), and it does not follow
 * a name computed in another function. Those are reviewed by hand; this guard only fails closed on any new text.
 */
const PINNED_COLLECTION_ARGUMENTS: Record<string, readonly string[]> = {
  [`${D2_SERVER_DIR}area-names.ts`]: ["SKILL_TREES_COLLECTION"],
  [`${D2_SERVER_DIR}conversation-store.ts`]: ["USER_DEVELOPMENT_COLLECTION", "parent", "subcollection"],
  [`${D2_SERVER_DIR}member-ref-binding.ts`]: ["MEMBERSHIPS_COLLECTION"],
  [`${D2_SERVER_DIR}read-pending-invitation.ts`]: ['"teams"'],
  [`${D2_SERVER_DIR}read-selectable-members.ts`]: ["MEMBERSHIPS_COLLECTION"],
  [`${D2_SERVER_DIR}team-eligibility.ts`]: ["MEMBERSHIPS_COLLECTION", "TEAMS_COLLECTION"],
};

const COLLECTION_CALL = /\.collection\(/g;

function collectionCallViolations(files: SourceFile[], pins: Record<string, readonly string[]> = PINNED_COLLECTION_ARGUMENTS): string[] {
  return files
    .filter((f) => isD2Production(f.path))
    .flatMap((f) => {
      const args = callArguments(stripComments(f.text), COLLECTION_CALL).map((a) => a.replace(/\s+/g, " ").trim());
      const pinned = pins[f.path] ?? [];
      return [...new Set(args)].filter((a) => !pinned.includes(a)).map((a) => `${f.path}: ${a}`);
    });
}

/**
 * AD-7 and IMPL-4: `getDisplayNames` is imported or mocked only by the roster module, in D2 code and D2 tests alike. The
 * `vi.mock` form counts as a reference, because a test that mocks the module is a caller that could drift into the route.
 */
function displayNamesCallerViolations(files: SourceFile[]): string[] {
  return files
    .filter((f) => isD2(f.path) && isGuarded(f.path) && f.path !== ROSTER_NAME_FILE)
    .filter((f) => specifiers(f).resolved.some((t) => moduleKey(t) === DISPLAY_NAMES_MODULE))
    .map((f) => f.path);
}

/** Counts the `user-development` recursive blocks that deny every access and nothing else (D2-SI-1, AD-10, BR-44). */
function recursiveDenyBlockCount(rulesText: string): number {
  const block = new RegExp(String.raw`match \/${UD}\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}`, "g");
  return [...rulesText.matchAll(block)].length;
}

describe("D2 scope guard — no notification or invitation expiry (CL-24, dimension 9)", () => {
  it("the real tree names no notification, reminder or expiry concept in D2 code and tests", () => {
    expect(cl24Violations(realFiles)).toEqual([]);
  });

  it("fails for a notification, reminder or expiry word in an identifier or string, and ignores a comment", () => {
    expect(
      cl24Violations([
        virtual(`${D2_SERVER_DIR}a.ts`, `const expiresAt = 1;`),
        virtual(`${D2_SERVER_DIR}b.ts`, `const s = "send a reminder";`),
        virtual(`${D2_SERVER_DIR}c.test.ts`, `const notified = true;`),
        virtual(`${D2_SERVER_DIR}d.ts`, `// no notifications and no expiry\nconst ok = "sharedGoals";`),
        virtual(`${D2_SERVER_DIR}e.ts`, `const invitationExpiry = 1;`),
      ]),
    ).toEqual([`${D2_SERVER_DIR}a.ts: expires`, `${D2_SERVER_DIR}b.ts: reminder`, `${D2_SERVER_DIR}c.test.ts: notified`, `${D2_SERVER_DIR}e.ts: expiry`]);
  });
});

describe("D2 scope guard — hidden-content field names (dimension 10)", () => {
  it("the real DTO and persisted shapes name no private, manager, admin, internal or assessment field", () => {
    expect(hiddenFieldViolations({ ...RUNTIME_DTO_LISTS, ...REAL_PERSISTED_LISTS })).toEqual([]);
  });

  it("fails for such a field name in a DTO, in a future allow-list or in a stored shape, in any case", () => {
    expect(
      hiddenFieldViolations({
        NEW_DTO_KEYS: ["conversationId", "managerNote", "AdminFlag", "privateNotes", "internalRef", "assessmentScore", "title"],
        STORED_OWNER_PLAIN_KEYS: ["status", "createdAt"],
      }),
    ).toEqual([
      "NEW_DTO_KEYS: managerNote",
      "NEW_DTO_KEYS: AdminFlag",
      "NEW_DTO_KEYS: privateNotes",
      "NEW_DTO_KEYS: internalRef",
      "NEW_DTO_KEYS: assessmentScore",
    ]);
  });
});

describe("D2 scope guard — collection access pins (dimension 11)", () => {
  it("the real D2 production tree calls .collection() only with the pinned arguments of each file", () => {
    expect(collectionCallViolations(realFiles)).toEqual([]);
  });

  it("fails for a new collection argument and for a new file that calls .collection(), and passes a pinned call", () => {
    expect(collectionCallViolations([virtual(`${D2_SERVER_DIR}area-names.ts`, 'getFirestoreDb().collection("tree-copies").doc(id)')])).toEqual([
      `${D2_SERVER_DIR}area-names.ts: "tree-copies"`,
    ]);
    expect(collectionCallViolations([virtual(`${D2_SERVER_DIR}new-store.ts`, "db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid)")])).toEqual([
      `${D2_SERVER_DIR}new-store.ts: USER_DEVELOPMENT_COLLECTION`,
    ]);
    expect(collectionCallViolations([virtual(`${D2_SERVER_DIR}area-names.ts`, "getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(id)")])).toEqual([]);
  });

  it("ignores a .collection() call that appears only in a comment", () => {
    expect(collectionCallViolations([virtual(`${D2_SERVER_DIR}new-store.ts`, '// db.collection("tree-copies") is not used\nexport const x = 1;')])).toEqual([]);
  });

  it("rejects an unauthorized collection hidden inside nested parentheses in a pinned file (permanent negative fixture)", () => {
    // The argument of `.collection(` contains its own call. A scanner that stops at the first `)` misses this call.
    const nested = ["getFirestoreDb()", '  .collection(pathOf("tree-copies"))', "  .doc(id)"].join("\n");
    expect(collectionCallViolations([virtual(`${D2_SERVER_DIR}area-names.ts`, nested)])).toEqual([
      `${D2_SERVER_DIR}area-names.ts: pathOf("tree-copies")`,
    ]);
  });

  it("reports a deeper nested argument as one whole text, even when its inner name is a pinned constant", () => {
    expect(
      collectionCallViolations([virtual(`${D2_SERVER_DIR}area-names.ts`, 'db.collection(wrapper(pathOf("tree-copies"))).doc(id)')]),
    ).toEqual([`${D2_SERVER_DIR}area-names.ts: wrapper(pathOf("tree-copies"))`]);
    expect(collectionCallViolations([virtual(`${D2_SERVER_DIR}area-names.ts`, "db.collection(wrapper(SKILL_TREES_COLLECTION)).doc(id)")])).toEqual([
      `${D2_SERVER_DIR}area-names.ts: wrapper(SKILL_TREES_COLLECTION)`,
    ]);
  });
});

describe("D2 scope guard — getDisplayNames callers, tests included (AD-7, IMPL-4)", () => {
  it("the real D2 tree imports or mocks getDisplayNames only in the roster module", () => {
    expect(displayNamesCallerViolations(realFiles)).toEqual([]);
  });

  it("fails for a D2 test that mocks the module, and passes the roster module", () => {
    expect(
      displayNamesCallerViolations([
        virtual(`${D2_SERVER_DIR}probe.test.ts`, 'vi.mock("../../profiles/server/get-display-names", () => ({}));'),
        virtual(ROSTER_NAME_FILE, importLine("../../profiles/server/get-display-names")),
      ]),
    ).toEqual([`${D2_SERVER_DIR}probe.test.ts`]);
  });
});

describe("D2 scope guard — user-development recursive deny block (D2-SI-1, AD-10)", () => {
  it("the real rules file keeps exactly one recursive deny block over user-development, and no conversation rule", () => {
    const rules = readFileSync(`${ROOT}/firestore.rules`, "utf8");
    expect(recursiveDenyBlockCount(rules)).toBe(1);
    expect(rules).not.toMatch(/conversation/i);
  });

  it("does not count a user-development block that allows any access", () => {
    expect(recursiveDenyBlockCount(`match /${UD}/{document=**} {\n  allow read: if request.auth != null;\n}`)).toBe(0);
    expect(recursiveDenyBlockCount(`match /${UD}/{document=**} {\n  allow read, write: if false;\n}`)).toBe(1);
  });
});
