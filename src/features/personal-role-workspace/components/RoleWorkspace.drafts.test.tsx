// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The auth stream emits the token together with the Firebase account UID, as the production gateway does. Tests move the
 * page between accounts (UID change), refresh a token (same UID), or sign out (no UID), through the real hooks.
 */
const auth = vi.hoisted(() => ({
  subscribers: new Set<(token: string | null, uid: string | null) => void>(),
  initial: { token: "token-a", uid: "uid-a" } as { token: string | null; uid: string | null },
}));

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: (callback: (token: string | null, uid: string | null) => void) => {
    auth.subscribers.add(callback);
    callback(auth.initial.token, auth.initial.uid);
    return () => {
      auth.subscribers.delete(callback);
    };
  },
}));

const { ResponsibilitiesSection } = await import("./ResponsibilitiesSection");
const { AchievementsSection } = await import("./AchievementsSection");
const { workspaceCopy } = await import("../copy");

const copy = workspaceCopy.responsibilities;
const achievementCopy = workspaceCopy.achievements;

interface PendingRequest {
  method: string;
  url: string;
  token: string;
  respond: (status: number, body: unknown) => void;
  fail: () => void;
}

let pending: PendingRequest[] = [];
const EMPTY_GOALS = { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false };

function tokenOf(init: RequestInit | undefined): string {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization?.replace(/^Bearer /, "") ?? "";
}

beforeEach(() => {
  pending = [];
  auth.subscribers = new Set();
  auth.initial = { token: "token-a", uid: "uid-a" };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/me/goals") return Promise.resolve({ status: 200, json: async () => EMPTY_GOALS });
      return new Promise<Response>((resolve, reject) => {
        pending.push({
          method: init?.method ?? "GET",
          url,
          token: tokenOf(init),
          respond: (status, body) => resolve({ status, json: async () => body } as Response),
          fail: () => reject(new TypeError("network down")),
        });
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function takeRequest(method: string, url: string, token: string): Promise<PendingRequest> {
  let found: PendingRequest | undefined;
  await waitFor(() => {
    found = pending.find((item) => item.method === method && item.url === url && item.token === token);
    if (!found) throw new Error(`no pending ${method} ${url} for ${token}`);
  });
  pending = pending.filter((item) => item !== found);
  return found as PendingRequest;
}

/** Emits an auth change to every subscriber, the way the observer delivers it (with the UID, or none on sign-out). */
function emit(token: string | null, uid: string | null) {
  act(() => {
    for (const subscriber of auth.subscribers) subscriber(token, uid);
  });
}

function listBody(records: unknown[] = []) {
  return { records, recoveryItems: [], unavailableCount: 0, truncated: false };
}

describe("responsibilities draft isolation (direct switch, same-account refresh, sign-out)", () => {
  it("removes account A's open draft when the page switches directly to account B", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities", "token-a")).respond(200, listBody());
    await user.click(await screen.findByRole("button", { name: copy.add }));
    await user.type(screen.getByLabelText(/Tittel/), "Utkast fra konto A");

    emit("token-b", "uid-b");

    expect(screen.queryByDisplayValue("Utkast fra konto A")).toBeNull();
    expect(screen.queryByLabelText(/Tittel/)).toBeNull();
  });

  it("keeps the open draft through a same-account token refresh", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities", "token-a")).respond(200, listBody());
    await user.click(await screen.findByRole("button", { name: copy.add }));
    await user.type(screen.getByLabelText(/Tittel/), "Utkast fra konto A");

    emit("token-a-refreshed", "uid-a");

    expect(screen.getByDisplayValue("Utkast fra konto A")).toBeTruthy();
    // The refresh re-reads the list for the same account; answer it so no request stays open.
    (await takeRequest("GET", "/api/me/responsibilities", "token-a-refreshed")).respond(200, listBody());
  });

  it("keeps account B's new draft through a refresh of B, and clears it on sign-out", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities", "token-a")).respond(200, listBody());
    await user.click(await screen.findByRole("button", { name: copy.add }));
    await user.type(screen.getByLabelText(/Tittel/), "Utkast fra konto A");

    emit("token-b", "uid-b");
    (await takeRequest("GET", "/api/me/responsibilities", "token-b")).respond(200, listBody());
    await user.click(await screen.findByRole("button", { name: copy.add }));
    await user.type(screen.getByLabelText(/Tittel/), "Utkast fra konto B");

    emit("token-b-refreshed", "uid-b");
    expect(screen.getByDisplayValue("Utkast fra konto B")).toBeTruthy();
    (await takeRequest("GET", "/api/me/responsibilities", "token-b-refreshed")).respond(200, listBody());

    emit(null, null);

    expect(screen.queryByDisplayValue("Utkast fra konto B")).toBeNull();
    expect(screen.queryByLabelText(/Tittel/)).toBeNull();
  });
});

describe("achievements draft isolation (direct switch, same-account refresh)", () => {
  it("removes account A's open draft when the page switches directly to account B", async () => {
    const user = userEvent.setup();
    render(<AchievementsSection revision={0} />);
    (await takeRequest("GET", "/api/me/achievements", "token-a")).respond(200, listBody());
    await user.click(await screen.findByRole("button", { name: achievementCopy.add }));
    await user.type(screen.getByLabelText(/Tittel/), "Utkast fra konto A");

    emit("token-b", "uid-b");

    expect(screen.queryByDisplayValue("Utkast fra konto A")).toBeNull();
  });

  it("keeps the open draft through a same-account token refresh", async () => {
    const user = userEvent.setup();
    render(<AchievementsSection revision={0} />);
    (await takeRequest("GET", "/api/me/achievements", "token-a")).respond(200, listBody());
    await user.click(await screen.findByRole("button", { name: achievementCopy.add }));
    await user.type(screen.getByLabelText(/Tittel/), "Utkast fra konto A");

    emit("token-a-refreshed", "uid-a");

    expect(screen.getByDisplayValue("Utkast fra konto A")).toBeTruthy();
    (await takeRequest("GET", "/api/me/achievements", "token-a-refreshed")).respond(200, listBody());
  });
});
