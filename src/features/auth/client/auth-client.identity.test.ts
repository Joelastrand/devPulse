import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises the production Firebase gateway (no injected fake) against a controllable Firebase observer, so the account
 * identity reported to the app and the ordering of asynchronous token reads are the real code under test.
 */
interface FakeUser {
  uid: string;
  getIdToken: () => Promise<string>;
}

const firebase = vi.hoisted(() => ({
  handler: null as null | ((user: FakeUser | null) => void | Promise<void>),
  auth: { currentUser: null as FakeUser | null },
}));

vi.mock("firebase/auth", () => ({
  onIdTokenChanged: (_auth: unknown, handler: (user: FakeUser | null) => void | Promise<void>) => {
    firebase.handler = handler;
    return () => {};
  },
  createUserWithEmailAndPassword: vi.fn(),
  reload: vi.fn(),
  sendEmailVerification: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../../lib/firebase/client", () => ({ getFirebaseAuth: () => firebase.auth }));

const { observeIdToken } = await import("./auth-client");

function user(uid: string, token: string): FakeUser {
  return { uid, getIdToken: async () => token };
}

function deferredUser(uid: string): { user: FakeUser; resolve: (token: string) => void; reject: () => void } {
  let resolve!: (token: string) => void;
  let reject!: () => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = () => rej(new Error("token refresh failed"));
  });
  return { user: { uid, getIdToken: () => promise }, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  firebase.handler = null;
  firebase.auth.currentUser = null;
});

describe("observeIdToken (production gateway): account identity", () => {
  it("reports the token together with the UID of the signed-in account", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    const a = user("uid-a", "token-a");
    firebase.auth.currentUser = a;

    await firebase.handler?.(a);
    await flush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("token-a", "uid-a");
  });

  it("reports sign-out as no token and no UID", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    firebase.auth.currentUser = null;

    await firebase.handler?.(null);

    expect(callback).toHaveBeenCalledWith(null, null);
  });

  it("drops account A's token read that finishes after the switch to account B, so A's token is never delivered last", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    const slowA = deferredUser("uid-a");
    firebase.auth.currentUser = slowA.user;
    const pendingA = firebase.handler?.(slowA.user);

    const b = user("uid-b", "token-b");
    firebase.auth.currentUser = b;
    await firebase.handler?.(b);
    slowA.resolve("token-a");
    await pendingA;
    await flush();

    expect(callback.mock.calls).toEqual([["token-b", "uid-b"]]);
  });

  it("drops a failed token read for an account that is no longer current, instead of reporting sign-out", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    const failingA = deferredUser("uid-a");
    firebase.auth.currentUser = failingA.user;
    const pendingA = firebase.handler?.(failingA.user);

    const b = user("uid-b", "token-b");
    firebase.auth.currentUser = b;
    await firebase.handler?.(b);
    failingA.reject();
    await pendingA;
    await flush();

    expect(callback.mock.calls).toEqual([["token-b", "uid-b"]]);
  });

  it("invalidates account A before account B's token is read, while B's token request is still unresolved", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    const a = user("uid-a", "token-a");
    firebase.auth.currentUser = a;
    await firebase.handler?.(a);
    await flush();
    callback.mockClear();

    const slowB = deferredUser("uid-b");
    firebase.auth.currentUser = slowB.user;
    const pendingB = firebase.handler?.(slowB.user);

    expect(callback.mock.calls).toEqual([[null, null, "account_changing"]]);

    slowB.resolve("token-b");
    await pendingB;
    await flush();
    expect(callback.mock.calls.at(-1)).toEqual(["token-b", "uid-b"]);
  });

  it("does not emit an account-change signal when the same account receives a refreshed token", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    const first = user("uid-a", "token-1");
    firebase.auth.currentUser = first;
    await firebase.handler?.(first);
    await flush();
    callback.mockClear();

    const refreshed = user("uid-a", "token-2");
    firebase.auth.currentUser = refreshed;
    await firebase.handler?.(refreshed);
    await flush();

    expect(callback.mock.calls).toEqual([["token-2", "uid-a"]]);
  });

  it("reports a failed token read for the still-current account as signed out (no token, no UID)", async () => {
    const callback = vi.fn();
    observeIdToken(callback);
    const failing = deferredUser("uid-a");
    firebase.auth.currentUser = failing.user;
    const pending = firebase.handler?.(failing.user);

    failing.reject();
    await pending;

    expect(callback).toHaveBeenCalledWith(null, null);
  });
});
