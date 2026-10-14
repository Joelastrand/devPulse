import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOAL_DTO_KEYS, GOAL_LIST_RESPONSE_KEYS, GOAL_RECOVERY_DTO_KEYS } from "./domain/goal-constants";
import { goalsCopy } from "./copy";
import { createFakeGoalStore } from "./server/fake-goal-store";
import type { GoalStore } from "./server/goal-store-types";

/**
 * D1 TASK-016: cross-cutting logging, response-body, copy and non-integration regression. The per-task suites and
 * `personal-goals-scope-guard.test.ts` own the detailed boundaries; this file adds only what they do not carry:
 * (1) all four route handlers run end-to-end over the production operations (fake store, no Firebase) with a
 * `console` spy and a body sweep across success AND failure paths, (2) static "no logging / no env / no extra
 * package" checks, (3) a forbidden-term sweep over every user-visible D1 string, (4) Demo Team / index
 * non-integration. Change-detection only, like the guard.
 */

const holder = vi.hoisted(() => ({ store: undefined as unknown, failing: false }));
const verifyIdTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("./server/goal-store", () => ({ getDefaultGoalStore: () => holder.store }));
vi.mock("./server/skill-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./server/skill-catalog")>()),
  getDefaultSkillCatalogReader: () => catalogReader,
}));

const SECRET_TITLE = "SECRET-GOAL-TITLE";
const SECRET_TREE = "SECRET-TREE-NAME";
const SECRET_FIELD = "SECRET-MALFORMED-FIELD";
const SECRET_FAILURE = "SECRET-STORE-FAILURE";
const OWNER = "owner-uid-sweep-7731";
const EMAIL = "sweep-owner@example.test";

const catalogReader = {
  async listOrderedByCreatedAt() {
    return [{ id: "tree1", data: { name: SECRET_TREE, nodes: [{ nodeId: "node-0", label: "A", order: 0 }, { nodeId: "node-1", label: "B", order: 1 }], createdAt: new Date(0), createdBy: "admin-uid" } }];
  },
  async getById(id: string) {
    return { id, data: id === "tree1" ? await this.listOrderedByCreatedAt().then((l) => l[0].data) : undefined };
  },
  async getManyByIds(ids: readonly string[]) {
    return Promise.all(ids.map((id) => this.getById(id)));
  },
};

const listRoute = await import("../../../app/api/me/goals/route");
const itemRoute = await import("../../../app/api/me/goals/[goalId]/route");

const AUTH = { authorization: "Bearer good.token", "content-type": "application/json" };
const ctx = (goalId: string) => ({ params: Promise.resolve({ goalId }) });
const itemUrl = (goalId: string) => `http://localhost/api/me/goals/${encodeURIComponent(goalId)}`;
const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = AUTH) =>
  new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

const bodies: string[] = [];
const record = async (response: Response) => {
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, text, json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
};

let fake: ReturnType<typeof createFakeGoalStore>;
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  fake = createFakeGoalStore();
  // Any store call throws while `failing`; the message is a sentinel that must never leave the server.
  holder.failing = false;
  holder.store = new Proxy(fake.store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (holder.failing) return Promise.reject(new Error(SECRET_FAILURE));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as GoalStore;
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: OWNER, email: EMAIL, emailVerified: true } });
  bodies.length = 0;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  const logged = consoleSpies.flatMap((spy) => spy.mock.calls);
  consoleSpies.length = 0;
  vi.restoreAllMocks();
  verifyIdTokenMock.mockReset();
  expect(logged).toEqual([]);
});

const FORBIDDEN_IN_BODIES = [OWNER, EMAIL, "ownerUid", "teamId", "memberRef", "displayName", "emailVerified", SECRET_FIELD, SECRET_FAILURE, "skillProfile", "level"];

describe("D1 routes — nothing is logged and no body leaks identity, failure detail or malformed content (BR-54, BR-62, SI-11)", () => {
  it("success and failure paths of GET, POST, PATCH and DELETE log nothing and answer with allow-listed bodies only", async () => {
    // success: create (with tree), read, update, complete, delete
    const created = await record(await listRoute.POST(send("POST", "http://localhost/api/me/goals", { title: SECRET_TITLE, treeId: "tree1", targetDate: "2026-12-31" })));
    expect(created.status).toBe(201);
    expect(Object.keys(created.json ?? {}).sort()).toEqual([...GOAL_DTO_KEYS].sort());
    const id = created.json?.id as string;

    // a malformed document and a missing-createdAt document, both with secret content
    fake.seed(OWNER, "malformed1", { title: SECRET_FIELD, status: SECRET_FIELD, createdAt: new Date(5), extra: SECRET_FIELD });
    fake.seed(OWNER, "nocreated1", { title: SECRET_FIELD, status: "active", updatedAt: new Date(5) });

    const listed = await record(await listRoute.GET(send("GET", "http://localhost/api/me/goals")));
    expect(listed.status).toBe(200);
    expect(Object.keys(listed.json ?? {}).sort()).toEqual([...GOAL_LIST_RESPONSE_KEYS].sort());
    expect(listed.json?.recoveryItems).toEqual([{ goalId: "malformed1" }, { goalId: "nocreated1" }].map((r) => expect.objectContaining(r)));
    for (const item of listed.json?.recoveryItems as object[]) expect(Object.keys(item)).toEqual([...GOAL_RECOVERY_DTO_KEYS]);

    expect((await record(await itemRoute.PATCH(send("PATCH", itemUrl(id), { title: "Ny tittel", status: "completed" }), ctx(id)))).status).toBe(200);
    expect((await record(await itemRoute.DELETE(send("DELETE", itemUrl("malformed1")), ctx("malformed1")))).status).toBe(200);
    expect((await record(await itemRoute.DELETE(send("DELETE", itemUrl("nocreated1")), ctx("nocreated1")))).status).toBe(200);

    // failures that carry the title / secret content in the request
    expect((await record(await listRoute.POST(send("POST", "http://localhost/api/me/goals", { title: SECRET_TITLE, ownerUid: OWNER })))).json).toEqual({ error: "invalid_request" });
    expect((await record(await listRoute.POST(send("POST", "http://localhost/api/me/goals", { title: SECRET_TITLE, treeId: "missing-tree" })))).json).toEqual({ error: "skill_not_found" });
    expect((await record(await itemRoute.PATCH(send("PATCH", itemUrl("__x__"), { title: SECRET_TITLE }), ctx("__x__")))).json).toEqual({ error: "goal_not_found" });
    expect((await record(await itemRoute.PATCH(send("PATCH", itemUrl("nope0000000000000001"), { title: SECRET_TITLE }), ctx("nope0000000000000001")))).json).toEqual({ error: "goal_not_found" });
    expect((await record(await itemRoute.PATCH(send("PATCH", itemUrl(id), { title: "   " }), ctx(id)))).status).toBe(400);
    expect((await record(await itemRoute.DELETE(send("DELETE", itemUrl("__x__")), ctx("__x__")))).json).toEqual({ ok: true });
    verifyIdTokenMock.mockResolvedValueOnce({ ok: false, error: "invalid_token" });
    expect((await record(await listRoute.GET(send("GET", "http://localhost/api/me/goals", undefined, {})))).json).toEqual({ error: "unauthenticated" });

    // clock regression: a stored createdAt in the future makes a changed mutation fail with nothing written (BR-64)
    fake.seed(OWNER, "future0000000000001", { title: SECRET_TITLE, status: "active", createdAt: new Date(Date.now() + 86_400_000), updatedAt: new Date(Date.now() + 86_400_000) });
    const regressed = await record(await itemRoute.PATCH(send("PATCH", itemUrl("future0000000000001"), { title: "Endret" }), ctx("future0000000000001")));
    expect(regressed).toMatchObject({ status: 500, json: { error: "clock_regressed" } });
    expect(fake.peek(OWNER, "future0000000000001")?.title).toBe(SECRET_TITLE);

    // persistence failures: the store rejects with a secret message
    holder.failing = true;
    expect((await record(await listRoute.GET(send("GET", "http://localhost/api/me/goals")))).json).toEqual({ error: "persistence_failed" });
    expect((await record(await listRoute.POST(send("POST", "http://localhost/api/me/goals", { title: SECRET_TITLE })))).json).toEqual({ error: "persistence_failed" });
    expect((await record(await itemRoute.PATCH(send("PATCH", itemUrl(id), { title: SECRET_TITLE }), ctx(id)))).json).toEqual({ error: "persistence_failed" });
    expect((await record(await itemRoute.DELETE(send("DELETE", itemUrl(id)), ctx(id)))).json).toEqual({ error: "persistence_failed" });

    expect(bodies.length).toBeGreaterThan(15);
    for (const body of bodies) {
      for (const needle of FORBIDDEN_IN_BODIES) expect(body).not.toContain(needle);
    }
    // the tree name is only ever shown as the resolved area/option name of the owner's own successful reads
    for (const body of bodies.filter((b) => b.includes(SECRET_TREE))) {
      expect(() => JSON.parse(body)).not.toThrow();
    }
    // error bodies are exactly `{ error: <fixed code> }`
    for (const body of bodies) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if ("error" in parsed) expect(Object.keys(parsed)).toEqual(["error"]);
    }
  });

  it("no owner selector in the query string, path or body changes the subject or the response", async () => {
    fake.seed("other-uid-9", "othergoal0000000001", { title: SECRET_TITLE, status: "active", createdAt: new Date(1), updatedAt: new Date(1) });
    const listed = await record(
      await listRoute.GET(send("GET", `http://localhost/api/me/goals?uid=other-uid-9&ownerUid=other-uid-9&userId=other-uid-9&email=${EMAIL}`)),
    );
    expect(listed.json).toMatchObject({ goals: [], recoveryItems: [] });
    expect(listed.text).not.toContain(SECRET_TITLE);
    const patched = await record(await itemRoute.PATCH(send("PATCH", `${itemUrl("othergoal0000000001")}?uid=other-uid-9`, { title: "x" }), ctx("othergoal0000000001")));
    expect(patched.json).toEqual({ error: "goal_not_found" });
    await record(await itemRoute.DELETE(send("DELETE", `${itemUrl("othergoal0000000001")}?ownerUid=other-uid-9`), ctx("othergoal0000000001")));
    expect(fake.peek("other-uid-9", "othergoal0000000001")?.title).toBe(SECRET_TITLE);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Static, change-detection scans.
// ---------------------------------------------------------------------------------------------------------------

const ROOT = process.cwd();
function walk(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx|json|mjs)$/.test(entry.name) ? [path] : [];
  });
}
const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const D1_ROUTES = walk("app/api/me/goals");
const D1_PRODUCTION = [...walk("src/features/personal-goals"), ...D1_ROUTES, ...walk("app/me/goals")].filter(
  (p) => !isTest(p) && /\.tsx?$/.test(p) && !p.endsWith("fake-goal-store.ts"),
);

describe("D1 static regression — logging, env, packages, Demo Team, indexes (BR-54, BR-55, BR-45)", () => {
  it("finds the production tree it is meant to scan", () => {
    expect(D1_PRODUCTION.length).toBeGreaterThan(15);
    expect(D1_ROUTES.filter((p) => !isTest(p)).length).toBe(2);
  });

  it("D1 production code has no console, stdout/stderr or logger call", () => {
    const offenders = D1_PRODUCTION.filter((p) => /\bconsole\b|process\.(stdout|stderr)|\blogger\b|\blog(Error|Warn|Info)\b/.test(stripComments(read(p))));
    expect(offenders).toEqual([]);
  });

  it("D1 production code reads no environment variable", () => {
    expect(D1_PRODUCTION.filter((p) => /process\.env|import\.meta\.env/.test(stripComments(read(p))))).toEqual([]);
  });

  it("D1 production code imports no package beyond those the repository already depends on for it", () => {
    const allowed = new Set(["react", "next", "firebase-admin", "server-only", "react-dom"]);
    const used = new Set<string>();
    for (const p of D1_PRODUCTION) {
      for (const match of stripComments(read(p)).matchAll(/(?:from|import)\s*\(?\s*["']([^"'.][^"']*)["']/g)) {
        used.add(match[1].startsWith("@") ? match[1].split("/").slice(0, 2).join("/") : match[1].split("/")[0]);
      }
    }
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
    const manifest = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
    for (const name of used) expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).toContain(name === "server-only" ? "server-only" : name);
  });

  it("Demo Team fixtures, plan, seed and writer name no personal-goal data", () => {
    const demo = walk("src/features/demo-team").filter((p) => !isTest(p));
    expect(demo.length).toBeGreaterThan(5);
    expect(demo.filter((p) => /user-?development|personal-?goals?|developmentGoals/i.test(read(p)))).toEqual([]);
  });

  it("firestore.indexes.json is unchanged by D1: no goal index and the same four collection-group indexes", () => {
    const indexes = read("firestore.indexes.json");
    expect(indexes).not.toMatch(/goals|user-?development/i);
    // The first key of every entry names its scope; the four existing indexes are the only ones.
    const names = (JSON.parse(indexes) as { indexes: Array<Record<string, unknown>> }).indexes.map((entry) => Object.values(entry)[0]);
    expect(names).toEqual(["teamInvitations", "teamAccessRequests", "forumThreads", "forumReplies"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Copy sweep (BR-49, BR-50, BR-21).
// ---------------------------------------------------------------------------------------------------------------

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (...args: unknown[]) => unknown)(2, 3, "Eksempel"));
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const FORBIDDEN_TERMS =
  /score|poeng|ranking|rangering|ytelse|prestasjon|forsinket|overskredet|administrator|samtaler|leaderboard|streak|badge|prosent|fremdrift|vurdering|sammenlign|%/i;

describe("D1 user-visible copy — forbidden-term sweep (BR-50, BR-21)", () => {
  it("every copy string, including expanded function entries, avoids the forbidden terms and names team leads only in the privacy sentence", () => {
    const all = strings(goalsCopy);
    expect(all.length).toBeGreaterThan(30);
    const leadMentions = all.filter((s) => /leder/i.test(s));
    expect(leadMentions).toEqual([goalsCopy.privacyNotice]);
    for (const text of all) expect(text).not.toMatch(FORBIDDEN_TERMS);
  });

  it("literal strings in the client gateway and components stay free of the forbidden terms", () => {
    const files = D1_PRODUCTION.filter((p) => /(components|client)\/[^/]+\.tsx?$/.test(p));
    expect(files.length).toBeGreaterThan(2);
    for (const p of files) {
      const literals = [...stripComments(read(p)).matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
      for (const text of literals.filter((l) => /\s/.test(l) && /[A-Za-zÆØÅæøå]{4}/.test(l))) {
        expect(text, `${p}: ${text}`).not.toMatch(FORBIDDEN_TERMS);
      }
    }
  });
});
