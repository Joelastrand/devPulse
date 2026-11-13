import { describe, expect, it, vi } from "vitest";
import { verifierFor } from "../../../../test/auth-fixtures";
import {
  getAuthUserDetail,
  listAuthUsers,
  MAX_PAGE_SIZE,
  setAuthUserDisabled,
  type AuthUserView,
  type UserAdminPort,
  type UserManagementDeps,
} from "./user-management";

const ADMIN = { uid: "admin-1", email: "admin@nve.no" };
const DEV = { uid: "dev-1", email: "dev@nve.no" };
const TARGET = { uid: "target-1", email: "target@nve.no" };
const GMAIL_SUPERADMIN = { uid: "owner-1", email: "owner@gmail.com" };
const SUPERADMINS = new Set([ADMIN.uid, GMAIL_SUPERADMIN.uid]);

function view(uid: string, email: string, overrides: Partial<AuthUserView> = {}): AuthUserView {
  return {
    uid,
    email,
    emailVerified: true,
    disabled: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSignInAt: null,
    ...overrides,
  };
}

/** An in-memory Auth fake. Every method is a spy so tests can prove what did and did not happen. */
function fakeUserAdmin(users: AuthUserView[]) {
  const store = new Map(users.map((user) => [user.uid, { ...user }]));
  const port = {
    listUsers: vi.fn(async (maxResults: number, pageToken: string | undefined) => {
      const all = [...store.values()];
      const start = pageToken === undefined ? 0 : Number(pageToken);
      const slice = all.slice(start, start + maxResults);
      const next = start + maxResults < all.length ? String(start + maxResults) : null;
      return { users: slice.map((user) => ({ ...user })), nextPageToken: next };
    }),
    getUserByEmail: vi.fn(async (email: string) => {
      const found = [...store.values()].find((user) => user.email === email);
      return found && { ...found };
    }),
    getUser: vi.fn(async (uid: string) => {
      const found = store.get(uid);
      return found && { ...found };
    }),
    setDisabled: vi.fn(async (uid: string, disabled: boolean) => {
      const found = store.get(uid);
      if (found) found.disabled = disabled;
    }),
    revokeRefreshTokens: vi.fn(async () => undefined),
  };
  return { port, store };
}

function depsFor(port: UserAdminPort, overrides: Partial<UserManagementDeps> = {}): UserManagementDeps {
  return {
    userAdmin: port,
    memberships: { listForUid: vi.fn(async () => [{ teamId: "team-1", role: "member" as const }]) },
    isSuperadmin: async (uid: string) => SUPERADMINS.has(uid),
    ...overrides,
  };
}

/** A caller's token verifier. Verified NVE by default; `registerClaims` inside `verifierFor` keeps the live read in step. */
const tokenFor = (who: { uid: string; email: string }, emailVerified = true) =>
  verifierFor({ uid: who.uid, email: who.email, emailVerified });

describe("superadmin user management: authorization", () => {
  it("refuses a listing from a verified NVE user who is not a superadmin, and reads nothing", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);

    const result = await listAuthUsers("token", {}, depsFor(port, { verifyToken: tokenFor(DEV) }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(port.listUsers).not.toHaveBeenCalled();
  });

  it("refuses an unverified caller at the identity layer, before any registry or Auth read", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);

    const result = await listAuthUsers("token", {}, depsFor(port, { verifyToken: tokenFor(ADMIN, false) }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(port.listUsers).not.toHaveBeenCalled();
  });

  it("admits an active Gmail superadmin through the registry, and only through the registry", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);

    const result = await listAuthUsers("token", {}, depsFor(port, { verifyToken: tokenFor(GMAIL_SUPERADMIN) }));

    expect(result.ok).toBe(true);
  });

  it("refuses a Gmail caller who is not a registered superadmin, even with a verified address", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);
    const gmailUser = { uid: "gmail-user", email: "person@gmail.com" };

    const result = await listAuthUsers("token", {}, depsFor(port, { verifyToken: tokenFor(gmailUser) }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(port.listUsers).not.toHaveBeenCalled();
  });

  it("refuses detail and disable operations from a non-superadmin, without touching the target", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);
    const deps = depsFor(port, { verifyToken: tokenFor(DEV) });

    expect(await getAuthUserDetail("token", TARGET.uid, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await setAuthUserDisabled("token", TARGET.uid, true, true, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(port.setDisabled).not.toHaveBeenCalled();
    expect(port.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});

describe("superadmin user management: listing and search", () => {
  it("pages through users with an opaque token and clamps the page size", async () => {
    const users = Array.from({ length: 5 }, (_, i) => view(`u${i}`, `u${i}@nve.no`));
    const { port } = fakeUserAdmin(users);
    const deps = depsFor(port, { verifyToken: tokenFor(ADMIN) });

    const first = await listAuthUsers("token", { limit: 2 }, deps);
    expect(first).toMatchObject({ ok: true, nextPageToken: "2" });
    if (!first.ok) return;
    expect(first.users.map((user) => user.uid)).toEqual(["u0", "u1"]);

    const second = await listAuthUsers("token", { limit: 2, pageToken: first.nextPageToken }, deps);
    expect(second.ok && second.users.map((user) => user.uid)).toEqual(["u2", "u3"]);

    await listAuthUsers("token", { limit: 10_000 }, deps);
    expect(port.listUsers).toHaveBeenLastCalledWith(MAX_PAGE_SIZE, undefined);
  });

  it("falls back to the default page size for a malformed limit instead of listing everything", async () => {
    const { port } = fakeUserAdmin([]);
    await listAuthUsers("token", { limit: "all" }, depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(port.listUsers).toHaveBeenLastCalledWith(25, undefined);
  });

  it("refuses a non-string page token as invalid input", async () => {
    const { port } = fakeUserAdmin([]);
    const result = await listAuthUsers("token", { pageToken: { nope: true } }, depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("searches by a normalized exact e-mail and returns no match for an unknown address", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);
    const deps = depsFor(port, { verifyToken: tokenFor(ADMIN) });

    const hit = await listAuthUsers("token", { email: "  Target@NVE.no " }, deps);
    expect(hit).toMatchObject({ ok: true, users: [{ uid: TARGET.uid }], nextPageToken: null });

    const miss = await listAuthUsers("token", { email: "nobody@nve.no" }, deps);
    expect(miss).toEqual({ ok: true, users: [], nextPageToken: null });
  });

  it("rejects a malformed search value without querying Auth", async () => {
    const { port } = fakeUserAdmin([]);
    const result = await listAuthUsers("token", { email: "a@b@c" }, depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(port.getUserByEmail).not.toHaveBeenCalled();
  });

  it("returns a fixed persistence error without the underlying message", async () => {
    const { port } = fakeUserAdmin([]);
    port.listUsers.mockRejectedValueOnce(new Error("internal token detail"));
    const result = await listAuthUsers("token", {}, depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("internal token detail");
  });
});

describe("superadmin user management: detail", () => {
  it("shows the account with its team memberships", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email, { lastSignInAt: "2026-02-02T00:00:00.000Z" })]);

    const result = await getAuthUserDetail("token", TARGET.uid, depsFor(port, { verifyToken: tokenFor(ADMIN) }));

    expect(result).toEqual({
      ok: true,
      user: view(TARGET.uid, TARGET.email, { lastSignInAt: "2026-02-02T00:00:00.000Z" }),
      teams: [{ teamId: "team-1", role: "member" }],
    });
  });

  it("reports an unknown uid as user_not_found", async () => {
    const { port } = fakeUserAdmin([]);
    const result = await getAuthUserDetail("token", "missing", depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "user_not_found" });
  });

  it("rejects a uid containing a path separator as invalid input", async () => {
    const { port } = fakeUserAdmin([]);
    const result = await getAuthUserDetail("token", "a/b", depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("superadmin user management: disable and re-enable", () => {
  it("disables a user, revokes their refresh tokens, and reports the new state", async () => {
    const { port, store } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);

    const result = await setAuthUserDisabled("token", TARGET.uid, true, true, depsFor(port, { verifyToken: tokenFor(ADMIN) }));

    expect(result).toEqual({ ok: true, uid: TARGET.uid, disabled: true });
    expect(store.get(TARGET.uid)?.disabled).toBe(true);
    expect(port.revokeRefreshTokens).toHaveBeenCalledWith(TARGET.uid);
  });

  it("refuses to disable without the explicit confirmation, and changes nothing", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);

    const result = await setAuthUserDisabled("token", TARGET.uid, true, undefined, depsFor(port, { verifyToken: tokenFor(ADMIN) }));

    expect(result).toEqual({ ok: false, error: "confirmation_required" });
    expect(port.setDisabled).not.toHaveBeenCalled();
  });

  it("re-enables a user without revoking anything, and needs no disable confirmation", async () => {
    const { port, store } = fakeUserAdmin([view(TARGET.uid, TARGET.email, { disabled: true })]);

    const result = await setAuthUserDisabled("token", TARGET.uid, false, undefined, depsFor(port, { verifyToken: tokenFor(ADMIN) }));

    expect(result).toEqual({ ok: true, uid: TARGET.uid, disabled: false });
    expect(store.get(TARGET.uid)?.disabled).toBe(false);
    expect(port.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("refuses an operator disabling their own account", async () => {
    const { port } = fakeUserAdmin([view(ADMIN.uid, ADMIN.email)]);

    const result = await setAuthUserDisabled("token", ADMIN.uid, true, true, depsFor(port, { verifyToken: tokenFor(ADMIN) }));

    expect(result).toEqual({ ok: false, error: "self_action_refused" });
    expect(port.setDisabled).not.toHaveBeenCalled();
  });

  it("refuses to disable an active superadmin, so the last-superadmin rule stays in the registry operations", async () => {
    const { port } = fakeUserAdmin([view(GMAIL_SUPERADMIN.uid, GMAIL_SUPERADMIN.email)]);

    const result = await setAuthUserDisabled(
      "token",
      GMAIL_SUPERADMIN.uid,
      true,
      true,
      depsFor(port, { verifyToken: tokenFor(ADMIN) }),
    );

    expect(result).toEqual({ ok: false, error: "target_is_superadmin" });
    expect(port.setDisabled).not.toHaveBeenCalled();
    expect(port.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("reports an unknown target without writing", async () => {
    const { port } = fakeUserAdmin([]);
    const result = await setAuthUserDisabled("token", "missing", true, true, depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "user_not_found" });
    expect(port.setDisabled).not.toHaveBeenCalled();
  });

  it("fails closed without detail when the Auth write fails", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);
    port.setDisabled.mockRejectedValueOnce(new Error("secret project detail"));

    const result = await setAuthUserDisabled("token", TARGET.uid, true, true, depsFor(port, { verifyToken: tokenFor(ADMIN) }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret project detail");
    expect(port.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean disabled value as invalid input", async () => {
    const { port } = fakeUserAdmin([view(TARGET.uid, TARGET.email)]);
    const result = await setAuthUserDisabled("token", TARGET.uid, "yes", true, depsFor(port, { verifyToken: tokenFor(ADMIN) }));
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });
});
