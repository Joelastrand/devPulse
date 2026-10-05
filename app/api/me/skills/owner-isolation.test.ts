import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSkillProfileStore } from "../../../../src/features/skill-profiles/server/fake-skill-profile-store";

/**
 * Owner isolation across all four C1 endpoints (BR-17/BR-18), exercised through the real route handlers
 * and operations with an in-memory store. Verified tokens map to an ordinary user, a team lead and an
 * app admin; each may act only on its own uid. Role claims grant nothing.
 */
const NOW_TREE = {
  name: "TypeScript",
  nodes: [
    { nodeId: "node-0", label: "Stage A", order: 0 },
    { nodeId: "node-1", label: "Stage B", order: 1 },
  ],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "admin-uid",
};

const h = vi.hoisted(() => ({
  fake: undefined as undefined | ReturnType<typeof import("../../../../src/features/skill-profiles/server/fake-skill-profile-store").createFakeSkillProfileStore>,
}));

const TOKENS: Record<string, Record<string, unknown>> = {
  "token-user": { uid: "user-1", email: "user@example.com", email_verified: true },
  "token-lead": { uid: "lead-1", email: "lead@example.com", email_verified: true, teamRole: "lead" },
  "token-admin": { uid: "admin-1", email: "admin@example.com", email_verified: false, admin: true },
};

vi.mock("../../../../src/lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async (token: string) => {
      const claims = TOKENS[token];
      if (!claims) throw new Error("invalid token");
      return claims;
    },
  }),
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

vi.mock("../../../../src/features/skill-profiles/server/skill-profile-store", () => ({
  getDefaultSkillProfileStore: () => h.fake!.store,
}));

vi.mock("../../../../src/features/skill-profiles/server/skill-catalog", async (importActual) => ({
  ...(await importActual<typeof import("../../../../src/features/skill-profiles/server/skill-catalog")>()),
  getDefaultSkillCatalogReader: () => ({
    listOrderedByCreatedAt: async () => [{ id: "ts", data: NOW_TREE }],
  }),
}));

const collectionRoute = await import("./route");
const itemRoute = await import("./[treeId]/route");

const OTHER = { levels: { ts: 4 }, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z") };
const ctx = (treeId = "ts") => ({ params: Promise.resolve({ treeId }) });
const req = (method: string, token?: string, url = "http://localhost/api/me/skills", body?: unknown) =>
  new Request(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  h.fake = createFakeSkillProfileStore({ "someone-else": { ...OTHER, levels: { ts: 4 } } }, { ts: NOW_TREE });
});

describe.each([
  ["ordinary user", "token-user", "user-1"],
  ["team lead", "token-lead", "lead-1"],
  ["app admin", "token-admin", "admin-1"],
])("owner isolation for an %s", (_label, token, uid) => {
  it("GET returns only the caller's own level, never another person's", async () => {
    h.fake!.docs.set(uid, { levels: { ts: 2 } });
    const response = await collectionRoute.GET(req("GET", token, "http://localhost/api/me/skills?uid=someone-else"));
    expect(response.status).toBe(200);
    expect((await response.json()).skills).toEqual([{ treeId: "ts", name: "TypeScript", level: 2 }]);
  });

  it("PUT rejects a body naming a subject and otherwise writes only the caller's own document, ignoring any uid in the query", async () => {
    const withSubject = await itemRoute.PUT(
      req("PUT", token, "http://localhost/api/me/skills/ts", { level: 3, uid: "someone-else" }),
      ctx(),
    );
    expect(withSubject.status).toBe(400);
    expect(h.fake!.writes).toEqual([]);

    const response = await itemRoute.PUT(
      req("PUT", token, "http://localhost/api/me/skills/ts?uid=someone-else", { level: 3 }),
      ctx(),
    );
    expect(response.status).toBe(200);
    expect(h.fake!.writes.map((w) => w.uid)).toEqual([uid]);
    expect(h.fake!.docs.get("someone-else")).toEqual(OTHER);
    expect(h.fake!.docs.get(uid)?.levels).toEqual({ ts: 3 });
  });

  it("DELETE one clears only the caller's own level and leaves other people untouched", async () => {
    h.fake!.docs.set(uid, { levels: { ts: 2 }, createdAt: new Date(), updatedAt: new Date() });
    const response = await itemRoute.DELETE(req("DELETE", token, "http://localhost/api/me/skills/ts?uid=someone-else"), ctx());
    expect(response.status).toBe(200);
    expect(h.fake!.writes.map((w) => w.uid)).toEqual([uid]);
    expect(h.fake!.docs.get("someone-else")).toEqual(OTHER);
  });

  it("DELETE all erases only the caller's own document", async () => {
    h.fake!.docs.set(uid, { levels: { ts: 2 } });
    const response = await collectionRoute.DELETE(req("DELETE", token, "http://localhost/api/me/skills?uid=someone-else"));
    expect(response.status).toBe(200);
    expect(h.fake!.deletes).toEqual([uid]);
    expect(h.fake!.docs.has(uid)).toBe(false);
    expect(h.fake!.docs.get("someone-else")).toEqual(OTHER);
  });
});

describe("unauthenticated access", () => {
  it.each([[undefined], ["invalid-token"]])("returns 401 on all four endpoints and touches nothing (token: %s)", async (token) => {
    const responses = [
      await collectionRoute.GET(req("GET", token)),
      await collectionRoute.DELETE(req("DELETE", token)),
      await itemRoute.PUT(req("PUT", token, undefined, { level: 2 }), ctx()),
      await itemRoute.DELETE(req("DELETE", token), ctx()),
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(h.fake!.writes).toEqual([]);
    expect(h.fake!.deletes).toEqual([]);
    expect(h.fake!.docs.get("someone-else")).toEqual(OTHER);
  });
});
