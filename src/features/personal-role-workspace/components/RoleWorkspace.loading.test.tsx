// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

type Identity = string | null;

/** Every identity subscriber (each `useAuthGatedResource` instance); tests move the page between identities through all of them. */
let identitySubscribers = new Set<(token: Identity) => void>();
let initialIdentity: Identity = "token-a";
const observeIdTokenMock = vi.fn((callback: (token: Identity) => void) => {
  identitySubscribers.add(callback);
  callback(initialIdentity);
  return () => {
    identitySubscribers.delete(callback);
  };
});
vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));

const { FormalRoleSection } = await import("./FormalRoleSection");
const { ResponsibilitiesSection } = await import("./ResponsibilitiesSection");
const { AchievementsSection } = await import("./AchievementsSection");
const { workspaceCopy } = await import("../copy");

/** A request the test resolves by hand, so late responses can be simulated. */
interface PendingRequest {
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

/** Goal choices resolve at once; every other owner read stays pending until the test answers it. */
function installDeferredFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/me/goals") {
        return Promise.resolve({ status: 200, json: async () => EMPTY_GOALS });
      }
      return new Promise<Response>((resolve, reject) => {
        pending.push({
          url,
          token: tokenOf(init),
          respond: (status, body) => resolve({ status, json: async () => body } as Response),
          fail: () => reject(new TypeError("network down")),
        });
      });
    }),
  );
}

function requestFor(path: string, token: string): PendingRequest {
  const request = pending.find((item) => item.url === path && item.token === token);
  if (!request) throw new Error(`no pending ${path} for ${token}`);
  pending = pending.filter((item) => item !== request);
  return request;
}

function setIdentity(token: Identity) {
  act(() => {
    for (const subscriber of identitySubscribers) subscriber(token);
  });
}

beforeEach(() => {
  pending = [];
  initialIdentity = "token-a";
  identitySubscribers = new Set();
  observeIdTokenMock.mockClear();
  installDeferredFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("formal role (read-only): loading and identity safety", () => {
  it("shows a decorative placeholder under one busy status, never the 'no role' message, while loading", () => {
    const { container } = render(<FormalRoleSection />);

    expect(screen.getByRole("status").textContent).toBe(workspaceCopy.formalRole.loading);
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(workspaceCopy.formalRole.none)).toBeNull();
    const decorative = container.querySelector('[aria-hidden="true"]');
    expect(decorative).not.toBeNull();
    expect(decorative?.textContent).toBe("");
  });

  it("shows the empty role message only after an authorized successful read", async () => {
    render(<FormalRoleSection />);
    requestFor("/api/me/role-assignment", "token-a").respond(200, { status: "none" });

    expect(await screen.findByText(workspaceCopy.formalRole.none)).toBeTruthy();
  });

  it("keeps a read failure distinct from the empty state", async () => {
    render(<FormalRoleSection />);
    requestFor("/api/me/role-assignment", "token-a").respond(500, {});

    expect(await screen.findByText(workspaceCopy.formalRole.readFailed)).toBeTruthy();
    expect(screen.queryByText(workspaceCopy.formalRole.none)).toBeNull();
  });

  it("ignores a late success after sign-out", async () => {
    render(<FormalRoleSection />);
    const late = requestFor("/api/me/role-assignment", "token-a");
    setIdentity(null);
    expect(await screen.findByText(workspaceCopy.formalRole.signedOut)).toBeTruthy();

    late.respond(200, { status: "assigned", title: "Teamleder", description: "Ansvar A" });
    await act(async () => {});

    expect(screen.queryByText("Teamleder")).toBeNull();
    expect(screen.getByText(workspaceCopy.formalRole.signedOut)).toBeTruthy();
  });

  it("ignores a late success from the previous identity after an account switch", async () => {
    render(<FormalRoleSection />);
    const previous = requestFor("/api/me/role-assignment", "token-a");
    setIdentity("token-b");
    requestFor("/api/me/role-assignment", "token-b").respond(200, { status: "assigned", title: "Rolle B", description: "B" });

    expect(await screen.findByText("Rolle B")).toBeTruthy();
    previous.respond(200, { status: "assigned", title: "Rolle A", description: "A" });
    await act(async () => {});

    expect(screen.queryByText("Rolle A")).toBeNull();
    expect(screen.getByText("Rolle B")).toBeTruthy();
  });

  it("ignores a late failure from the previous identity after an account switch", async () => {
    render(<FormalRoleSection />);
    const previous = requestFor("/api/me/role-assignment", "token-a");
    setIdentity("token-b");
    requestFor("/api/me/role-assignment", "token-b").respond(200, { status: "none" });
    expect(await screen.findByText(workspaceCopy.formalRole.none)).toBeTruthy();

    previous.fail();
    await act(async () => {});

    expect(screen.queryByText(workspaceCopy.formalRole.readFailed)).toBeNull();
    expect(screen.getByText(workspaceCopy.formalRole.none)).toBeTruthy();
  });
});

describe("responsibilities and achievements: loading placeholders", () => {
  it("shows a decorative list placeholder, not the empty message, while the list is pending", async () => {
    const { container } = render(<ResponsibilitiesSection />);

    expect(screen.getByRole("status").textContent).toBe(workspaceCopy.responsibilities.loading);
    expect(screen.queryByText(workspaceCopy.responsibilities.empty)).toBeNull();
    expect(container.querySelectorAll('[aria-hidden="true"] li').length).toBeGreaterThan(0);

    requestFor("/api/me/responsibilities", "token-a").respond(200, {
      records: [],
      recoveryItems: [],
      unavailableCount: 0,
      truncated: false,
    });
    expect(await screen.findByText(workspaceCopy.responsibilities.empty)).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("does not show the achievements empty message while the list is pending", () => {
    render(<AchievementsSection revision={0} />);

    expect(screen.getByRole("status").textContent).toBe(workspaceCopy.achievements.loading);
    expect(screen.queryByText(workspaceCopy.achievements.empty)).toBeNull();
  });

  it("ignores a late responsibilities list after sign-out", async () => {
    render(<ResponsibilitiesSection />);
    const late = requestFor("/api/me/responsibilities", "token-a");
    setIdentity(null);
    expect(await screen.findByText(workspaceCopy.signedOut)).toBeTruthy();

    late.respond(200, {
      records: [{ id: "r1", title: "Hemmelig ansvar", description: null, status: "active", relationToRole: "within", startDate: null, endDate: null, goalIds: [], createdAt: "", updatedAt: "" }],
      recoveryItems: [],
      unavailableCount: 0,
      truncated: false,
    });
    await act(async () => {});

    expect(screen.queryByText("Hemmelig ansvar")).toBeNull();
  });
});

describe("formal role: direct account switch (A -> B, no sign-out in between)", () => {
  it("clears account A's role while account B's read is pending, and shows no 'no role' message", async () => {
    render(<FormalRoleSection />);
    requestFor("/api/me/role-assignment", "token-a").respond(200, { status: "assigned", title: "Rolle A", description: "Ansvar A" });
    expect(await screen.findByText("Rolle A")).toBeTruthy();

    setIdentity("token-b");

    expect(screen.queryByText("Rolle A")).toBeNull();
    expect(screen.queryByText("Ansvar A")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(workspaceCopy.formalRole.loading);
    expect(screen.queryByText(workspaceCopy.formalRole.none)).toBeNull();
  });

  it("ignores a late role from account A after the switch and shows only account B's role", async () => {
    render(<FormalRoleSection />);
    const lateA = requestFor("/api/me/role-assignment", "token-a");
    setIdentity("token-b");
    requestFor("/api/me/role-assignment", "token-b").respond(200, { status: "assigned", title: "Rolle B", description: "B" });
    expect(await screen.findByText("Rolle B")).toBeTruthy();

    lateA.respond(200, { status: "assigned", title: "Rolle A", description: "A" });
    await act(async () => {});

    expect(screen.queryByText("Rolle A")).toBeNull();
    expect(screen.getByText("Rolle B")).toBeTruthy();
  });
});
