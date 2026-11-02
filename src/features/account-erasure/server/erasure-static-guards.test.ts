import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";

// TASK-040: static guards for the account-erasure invariants. Each guard has a negative test (the current tree passes) and a
// positive test (a planted violation is flagged). Guards read source text only. They are a regression net, not a proof.

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = posix.join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const isSource = (path: string) => /\.(ts|tsx)$/.test(path) && !isTest(path);

const PRODUCTION_FILES = [...walk("src"), ...walk("app")].filter(isSource);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

interface Source {
  readonly path: string;
  readonly text: string;
}

const REAL: readonly Source[] = PRODUCTION_FILES.map((path) => ({ path, text: read(path) }));

/* ----------------------------- guard 1: participantNotes is cleared only by the erasure binding function ---------------- */

/** A write that removes or nulls `participantNotes`. Reads and creations with content are not matched. */
const NOTES_CLEAR = /participantNotes\s*:\s*(null|undefined|FieldValue\.delete\(\))/;

/** The one production file allowed to clear participant notes: the erasure participant-binding function (TASK-019). */
const NOTES_CLEAR_ALLOWED = ["src/features/account-erasure/server/participant-bindings-erasure.ts"];

function notesClearOffenders(sources: readonly Source[]): string[] {
  return sources.filter((s) => NOTES_CLEAR.test(s.text) && !NOTES_CLEAR_ALLOWED.includes(s.path)).map((s) => s.path);
}

describe("guard: only the erasure participant-binding function clears participantNotes", () => {
  it("passes on the real tree", () => {
    expect(notesClearOffenders(REAL)).toEqual([]);
  });

  it("flags a planted clear of participantNotes in any other production file", () => {
    const planted: Source = {
      path: "src/features/development-conversations/server/rogue-clear.ts",
      text: "await tx.update(ref, { participantNotes: null });",
    };
    expect(notesClearOffenders([...REAL, planted])).toEqual([planted.path]);
  });
});

/* ----------------------------- guard 2: only the erasure step creates an erased-thread placeholder ------------------------ */

/** A persistence call in the same file: a write through a transaction, a port, or a document reference. */
const PERSIST_CALL = /\b(tx\.(set|create|update)|setThread|setReply|\.set\(|\.create\()/;

/** The placeholder status literal or its constant, used as an object value. Read-side comparisons are not matched. */
const PLACEHOLDER_VALUE = /status:\s*(ERASED_THREAD_STATUS|"erased")/;

const PLACEHOLDER_WRITERS_ALLOWED = ["src/features/account-erasure/server/forum-erasure.ts"];

function placeholderWriterOffenders(sources: readonly Source[]): string[] {
  return sources
    .filter((s) => PLACEHOLDER_VALUE.test(s.text) && PERSIST_CALL.test(s.text) && !PLACEHOLDER_WRITERS_ALLOWED.includes(s.path))
    .map((s) => s.path);
}

describe("guard: only the erasure step creates an erased-thread placeholder", () => {
  it("passes on the real tree (readers and DTO parsers do not persist)", () => {
    expect(placeholderWriterOffenders(REAL)).toEqual([]);
  });

  it("flags a planted placeholder write outside the erasure step", () => {
    const planted: Source = {
      path: "src/features/forum/server/rogue-placeholder.ts",
      text: "await tx.set(ref, { teamId, status: ERASED_THREAD_STATUS, erasedAt: now });",
    };
    expect(placeholderWriterOffenders([...REAL, planted])).toEqual([planted.path]);
  });
});

/* ----------------------------- guard 3: the auth boundary never imports the erasure feature ----------------------------- */

function authImportOffenders(sources: readonly Source[]): string[] {
  return sources
    .filter((s) => s.path.startsWith("src/features/auth/") && /from\s+["'][^"']*account-erasure/.test(s.text))
    .map((s) => s.path);
}

describe("guard: src/features/auth never imports account-erasure", () => {
  it("passes on the real tree", () => {
    expect(authImportOffenders(REAL)).toEqual([]);
  });

  it("flags a planted import from the auth feature", () => {
    const planted: Source = {
      path: "src/features/auth/server/rogue.ts",
      text: 'import { startOrResumeErasure } from "../../account-erasure/server/start-erasure";',
    };
    expect(authImportOffenders([...REAL, planted])).toEqual([planted.path]);
  });
});

/* ----------------------------- guard 4: no route other than POST /api/me/erasure touches erasure (BR-22, AE-SI-1) ------- */

const ERASURE_ENTRY_ROUTE = "app/api/me/erasure/route.ts";

/** Route files whose path names a non-approved erasure, deletion-of-account, export, leave or undo surface. */
const FORBIDDEN_ROUTE_NAME = /(erasure|delete-account|account-delete|self-leave|leave|export|undo|erase)/i;

function routeOffenders(files: readonly string[], sources: readonly Source[]): string[] {
  const named = files
    .filter((path) => path.startsWith("app/api/") && path.endsWith("/route.ts") && path !== ERASURE_ENTRY_ROUTE)
    .filter((path) => FORBIDDEN_ROUTE_NAME.test(path.slice("app/api/".length)));
  const touching = sources
    .filter((s) => s.path.startsWith("app/api/") && s.path !== ERASURE_ENTRY_ROUTE)
    .filter((s) => /account-erasure|startOrResumeErasure|runAuthDeletion|runErasure|accountErasures/.test(s.text))
    .map((s) => s.path);
  return [...named, ...touching];
}

describe("guard: no other route touches erasure (BR-22, AE-SI-1)", () => {
  it("passes on the real tree: only POST /api/me/erasure names the erasure operation", () => {
    const routes = walk("app/api").filter((p) => p.endsWith("/route.ts"));
    expect(routeOffenders(routes, REAL)).toEqual([]);
  });

  it("flags a planted admin-triggered erasure route", () => {
    const planted = { path: "app/api/admin/erasure/route.ts", text: "export async function POST() {}" };
    expect(routeOffenders([planted.path], [...REAL, { path: planted.path, text: planted.text }])).toContain(planted.path);
  });

  it("flags a planted route that names the erasure operation", () => {
    const planted: Source = { path: "app/api/teams/x/route.ts", text: "import { startOrResumeErasure } from 'x';" };
    expect(routeOffenders([], [...REAL, planted])).toContain(planted.path);
  });
});

/* ----------------------------- guard 5: erasure code never logs identifiers, e-mails, content or payloads (AE-SI-12) ---- */

const ERASURE_CODE = (path: string) =>
  (path.startsWith("src/features/account-erasure/") || path.startsWith("src/features/auth/server/erasure") || path === ERASURE_ENTRY_ROUTE) &&
  isSource(path);

function logOffenders(sources: readonly Source[]): string[] {
  return sources.filter((s) => ERASURE_CODE(s.path) && /\bconsole\.(log|info|warn|error|debug)\b/.test(s.text)).map((s) => s.path);
}

describe("guard: erasure code does not log (AE-SI-12)", () => {
  it("passes on the real tree", () => {
    expect(logOffenders(REAL)).toEqual([]);
  });

  it("flags a planted console call in erasure code", () => {
    const planted: Source = {
      path: "src/features/account-erasure/server/rogue-log.ts",
      text: "console.error('failed for', uid);",
    };
    expect(logOffenders([...REAL, planted])).toEqual([planted.path]);
  });
});

/* ----------------------------- guard 6: the write surfaces read the erasure fence (W-1..W-18 owners, BR-4(b)) ------------- */

/**
 * SPEC "W-1 to W-18" write surfaces, each mapped to the production module(s) that own its writes, or excluded with a reason.
 * A surface with owners must have each owner read the fence in code (the test below). An excluded surface must name its reason.
 * A new write surface needs a row here (SPEC write-surface table). Test files are not scanned (their planted cases are the proof).
 */
const W_SURFACES: Readonly<Record<string, { readonly owners: readonly string[] } | { readonly excluded: string }>> = {
  "W-1": { owners: ["src/features/profiles/server/user-profile-store.ts"] },
  "W-2": { owners: ["src/features/skill-profiles/server/skill-profile-store.ts"] },
  "W-3": { owners: ["src/features/skill-profiles/server/skill-profile-store.ts"] },
  "W-4": { owners: ["src/features/role-profiles/server/role-target-store.ts"] },
  "W-5": { owners: ["src/features/personal-goals/server/goal-store.ts"] },
  "W-6": { owners: ["src/features/development-conversations/server/conversation-store.ts"] },
  "W-7": { owners: ["src/features/forum/server/create-thread.ts"] },
  "W-8": { owners: ["src/features/forum/server/create-reply.ts"] },
  "W-9": { owners: ["src/features/forum/server/delete-thread.ts", "src/features/forum/server/delete-reply.ts"] },
  "W-10": { owners: ["src/features/team-skills/server/skill-contribution-store.ts"] },
  "W-11": { owners: ["src/features/teams/server/create-access-request.ts"] },
  "W-12": { owners: ["src/features/challenges/server/submit-challenge.ts"] },
  "W-13": { owners: ["src/features/surveys/server/submit-survey-response.ts"] },
  "W-14": { owners: ["src/features/roadmap/server/create-roadmap-item.ts", "src/features/roadmap/server/update-roadmap-item.ts"] },
  "W-15": {
    owners: [
      "src/features/skill-trees/server/report-team-skill-progress.ts",
      "src/features/skill-trees/server/update-team-skill-progress.ts",
      "src/features/skill-trees/server/start-team-skill-tracking.ts",
      "src/features/skill-trees/server/stop-team-skill-tracking.ts",
    ],
  },
  "W-16": { owners: ["src/features/teams/server/resolve-invitations.ts"] },
  "W-17": {
    owners: [
      "src/features/surveys/server/create-survey.ts",
      "src/features/surveys/server/open-survey.ts",
      "src/features/surveys/server/close-survey.ts",
      "src/features/surveys/server/delete-or-archive-survey.ts",
      "src/features/skill-trees/server/create-skill-tree.ts",
      "src/features/skill-trees/server/update-skill-tree.ts",
      "src/features/teams/server/create-team.ts",
      "src/features/teams/server/set-team-member-role.ts",
      "src/features/teams/server/approve-access-request.ts",
      "src/features/teams/server/reject-access-request.ts",
      "src/features/teams/server/grant-team-membership.ts",
      "src/features/teams/server/create-invitation.ts",
      "src/features/challenges/server/archive-challenge.ts",
      "src/features/challenges/server/resolve-challenge.ts",
      "src/features/role-profiles/server/role-store.ts",
      "src/features/account-erasure/server/membership-destruction-adapter.ts",
      "src/features/teams/server/materialize-member-refs.ts",
    ],
  },
  "W-18": {
    excluded: "Demo tooling, not an HTTP write. The CLI refuses a presenter with an accountErasures record or no Auth user (BR-20), per SPEC W-18.",
  },
};

const FENCED_WRITE_OWNERS: readonly string[] = Object.values(W_SURFACES).flatMap((row) => ("owners" in row ? [...row.owners] : []));

// `accountErasures` covers the direct transactional read of the record (open, close and survey submission read it with
// `tx.get` before their writes). The behavioural tests of each owner prove the ordering; this guard proves that a transactional read or fence helper call exists in the owner's code, not that it reads accountErasures; the behavioural tests and the D-EMU race evidence prove the ordering.
// A call form only: an import, a path constant or a string that names the record is not a fence read (review, 2026-11-02).
const FENCE_TOKEN = /\b(?:tx\.get|runFencedTransaction|assertNoErasureRecordInTransaction|runWriteTransaction|writeRefusalFor)\s*\(/;

/** Removes comments, so a token that only appears in a comment is not a fence read. Strings are not parsed (a known limit). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function unfencedOwners(sources: readonly Source[]): string[] {
  return FENCED_WRITE_OWNERS.filter((path) => {
    const source = sources.find((s) => s.path === path);
    return source === undefined || !FENCE_TOKEN.test(withoutComments(source.text));
  });
}

describe("guard: every fenced write owner reads the erasure fence (BR-4(b))", () => {
  it("passes on the real tree", () => {
    expect(unfencedOwners(REAL)).toEqual([]);
  });

  it("flags a planted owner that drops its fence token", () => {
    const stripped = REAL.map((s) =>
      s.path === "src/features/forum/server/create-reply.ts" ? { path: s.path, text: "// fence removed" } : s,
    );
    expect(unfencedOwners(stripped)).toEqual(["src/features/forum/server/create-reply.ts"]);
  });

  it("flags an owner whose only mention of the fence is inside a comment", () => {
    const commentOnly = REAL.map((s) =>
      s.path === "src/features/teams/server/create-access-request.ts"
        ? { path: s.path, text: "/* runFencedTransaction(db, uid, write) */\n// assertNoErasureRecordInTransaction\nexport {};" }
        : s,
    );
    expect(unfencedOwners(commentOnly)).toEqual(["src/features/teams/server/create-access-request.ts"]);
  });

  it("every SPEC write surface W-1 to W-18 has a row that names owners or a non-empty exclusion reason", () => {
    const ids = Object.keys(W_SURFACES).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    expect(ids).toEqual(Array.from({ length: 18 }, (_, i) => `W-${i + 1}`));
    for (const id of ids) {
      const row = W_SURFACES[id];
      const named = "owners" in row ? row.owners.length > 0 : row.excluded.trim().length > 0;
      expect(named, id).toBe(true);
    }
  });

  it("the W table owners are all files that exist in the repository tree (the real-tree test checks their fence)", () => {
    const paths = new Set(REAL.map((s) => s.path));
    for (const path of FENCED_WRITE_OWNERS) expect(paths.has(path), path).toBe(true);
  });

  it("flags an owner that only imports the fence helper, without calling it", () => {
    const importOnly = REAL.map((s) =>
      s.path === "src/features/teams/server/create-access-request.ts"
        ? { path: s.path, text: "import { runFencedTransaction } from \"../../auth/server/erasure-write-fence\";\nexport {};" }
        : s,
    );
    expect(unfencedOwners(importOnly)).toEqual(["src/features/teams/server/create-access-request.ts"]);
  });

  it("flags an owner that only names the erasure collection in a string, without a read", () => {
    const stringOnly = REAL.map((s) =>
      s.path === "src/features/teams/server/create-access-request.ts"
        ? { path: s.path, text: "const PATH = \"accountErasures\";\nexport { PATH };" }
        : s,
    );
    expect(unfencedOwners(stringOnly)).toEqual(["src/features/teams/server/create-access-request.ts"]);
  });

  it("the real tree passes with the expanded owner list (every added owner reads the fence in code)", () => {
    expect(FENCED_WRITE_OWNERS).toContain("src/features/teams/server/resolve-invitations.ts");
    expect(unfencedOwners(REAL)).toEqual([]);
  });
});
