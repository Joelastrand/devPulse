import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeRegistry, USERS, verifyToken } from "../../../../src/features/superadmins/server/superadmin-registry.test-helper";

const holder = vi.hoisted(() => ({ registry: undefined as undefined | { store: unknown } }));

vi.mock("../../../../src/features/superadmins/server/superadmin-store", () => ({
  getDefaultSuperadminStore: () => holder.registry?.store,
}));

vi.mock("../../../../src/lib/firebase/admin", () => ({
  // Only the Firebase boundary is faked: token verification and Auth lookup by e-mail. Everything else runs for real.
  getAdminAuth: () => ({
    verifyIdToken: (token: string) => verifyToken(token),
    getUserByEmail: async (email: string) => {
      const user = Object.values(USERS).find((candidate) => candidate.email === email);
      if (!user) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
      return { uid: user.uid, emailVerified: user.emailVerified !== false, disabled: user.disabled === true };
    },
  }),
  getFirestoreDb: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
  }),
}));

const { GET, POST } = await import("./route");
const { DELETE } = await import("./[uid]/route");

const ADMIN = "Bearer admin-uid";
const SECOND = "Bearer second-uid";
const DEV = "Bearer dev-uid";

function seedRegistry(records: Record<string, { active: boolean }>) {
  const registry = createFakeRegistry({ records });
  holder.registry = registry;
  return registry;
}

function listRequest(header?: string): Request {
  return new Request("http://localhost/api/admin/superadmins", { headers: header ? { authorization: header } : {} });
}

function grantRequest(body: unknown, header = ADMIN): Request {
  return new Request("http://localhost/api/admin/superadmins", {
    method: "POST",
    headers: { authorization: header, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function revoke(uid: string, header = ADMIN) {
  const request = new Request(`http://localhost/api/admin/superadmins/${uid}`, {
    method: "DELETE",
    headers: { authorization: header },
  });
  return DELETE(request, { params: Promise.resolve({ uid }) });
}

afterEach(() => {
  holder.registry = undefined;
});

describe("GET /api/admin/superadmins", () => {
  it("lists active superadmins for an active superadmin, as UIDs and grant times only", async () => {
    seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true }, "old-uid": { active: false } });

    const response = await GET(listRequest(ADMIN));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { superadmins: Array<{ uid: string }> };
    expect(body.superadmins.map((entry) => entry.uid)).toEqual(["admin-uid", "second-uid"]);
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("refuses a verified user who is not a superadmin with 403", async () => {
    seedRegistry({ "admin-uid": { active: true } });
    expect((await GET(listRequest(DEV))).status).toBe(403);
  });

  it("refuses a request without a token with 401", async () => {
    seedRegistry({ "admin-uid": { active: true } });
    expect((await GET(listRequest())).status).toBe(401);
  });

  it("refuses a superadmin whose registry record was revoked, on the very next request", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true } });
    expect((await GET(listRequest(SECOND))).status).toBe(200);

    registry.setRecord("second-uid", { active: false });

    expect((await GET(listRequest(SECOND))).status).toBe(403);
  });
});

describe("POST /api/admin/superadmins (grant)", () => {
  it("grants superadmin to an existing verified Auth user, resolved by e-mail", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await POST(grantRequest({ email: USERS.second.email }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "granted", uid: "second-uid" });
    expect(registry.record("second-uid")).toMatchObject({ active: true, grantedByUid: "admin-uid" });
  });

  it("is idempotent: granting an existing superadmin again succeeds without a second write", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true } });
    const writesBefore = registry.stats.writes;

    const response = await POST(grantRequest({ email: USERS.second.email }));

    expect(await response.json()).toEqual({ outcome: "already_superadmin", uid: "second-uid" });
    expect(registry.stats.writes).toBe(writesBefore);
  });

  it("refuses a grant from a non-superadmin with 403 and grants nothing", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await POST(grantRequest({ email: USERS.third.email }, DEV));

    expect(response.status).toBe(403);
    expect(registry.record("third-uid")).toBeUndefined();
  });

  it("does not accept a client-supplied uid as the target, so a uid alone grants nothing (400)", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await POST(grantRequest({ uid: "dev-uid" }));

    expect(response.status).toBe(400);
    expect(registry.record("dev-uid")).toBeUndefined();
  });

  it("does not create an Auth user: an unknown e-mail is 404 and nothing is granted", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await POST(grantRequest({ email: "nobody@example.test" }));

    expect(response.status).toBe(404);
    expect(registry.stats.writes).toBe(0);
  });

  it("rejects an unverified target account with 409 and writes nothing", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await POST(grantRequest({ email: USERS.unverified.email }));

    expect(response.status).toBe(409);
    expect(registry.record("unverified-uid")).toBeUndefined();
  });

  it("rejects a disabled target account with 409 and writes nothing", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await POST(grantRequest({ email: USERS.disabled.email }));

    expect(response.status).toBe(409);
    expect(registry.record("disabled-uid")).toBeUndefined();
  });

  it("rejects a malformed body with 400", async () => {
    seedRegistry({ "admin-uid": { active: true } });
    expect((await POST(grantRequest("not json"))).status).toBe(400);
    expect((await POST(grantRequest([]))).status).toBe(400);
  });
});

describe("DELETE /api/admin/superadmins/[uid] (revoke)", () => {
  it("revokes another superadmin when at least one other active superadmin remains", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true } });

    const response = await revoke("second-uid");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "revoked", uid: "second-uid" });
    expect(registry.record("second-uid")).toMatchObject({ active: false });
    expect(registry.activeCount()).toBe(1);
  });

  it("refuses to revoke the last active superadmin with 409 last_superadmin", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true } });

    const response = await revoke("admin-uid");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "last_superadmin" });
    expect(registry.record("admin-uid")).toMatchObject({ active: true });
    expect(registry.activeCount()).toBe(1);
  });

  it("lets two concurrent revocations of the two remaining superadmins never remove the last one", async () => {
    const registry = createFakeRegistry({
      records: { "admin-uid": { active: true }, "second-uid": { active: true } },
      barrier: { size: 2 },
    });
    holder.registry = registry;

    const [a, b] = await Promise.all([revoke("admin-uid", ADMIN), revoke("second-uid", SECOND)]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(registry.activeCount()).toBe(1);
    expect(["admin-uid", "second-uid"].filter((uid) => registry.record(uid)?.active === true)).toHaveLength(1);
  });

  it("refuses a revocation from a non-superadmin with 403 and changes nothing", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true } });

    expect((await revoke("admin-uid", DEV)).status).toBe(403);
    expect(registry.record("admin-uid")).toMatchObject({ active: true });
  });

  it("refuses a revoked superadmin's own later request with 403", async () => {
    const registry = seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true } });
    expect((await revoke("second-uid", ADMIN)).status).toBe(200);

    expect((await revoke("admin-uid", SECOND)).status).toBe(403);
    expect(registry.record("admin-uid")).toMatchObject({ active: true });
  });

  it("answers a target that is not an active superadmin with 409 not_superadmin", async () => {
    seedRegistry({ "admin-uid": { active: true }, "second-uid": { active: true } });
    expect(await (await revoke("dev-uid")).json()).toEqual({ error: "not_superadmin" });
  });
});
