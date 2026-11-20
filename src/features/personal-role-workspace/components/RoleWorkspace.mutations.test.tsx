// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Identity = string | null;

/** Every identity subscriber (each `useAuthGatedResource` instance). Tests move the page between identities through all of them. */
let identitySubscribers = new Set<(token: Identity) => void>();
const observeIdTokenMock = vi.fn((callback: (token: Identity) => void) => {
  identitySubscribers.add(callback);
  callback("token-a");
  return () => {
    identitySubscribers.delete(callback);
  };
});
vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));

const { ResponsibilitiesSection } = await import("./ResponsibilitiesSection");
const { AchievementsSection } = await import("./AchievementsSection");
const { workspaceCopy } = await import("../copy");

const copy = workspaceCopy.responsibilities;
const achievementCopy = workspaceCopy.achievements;

/** A request the test answers by hand, so pending, late and failed responses can be simulated. */
interface PendingRequest {
  method: string;
  url: string;
  token: string;
  respond: (status: number, body: unknown) => void;
  fail: () => void;
}

let pending: PendingRequest[] = [];
let sentBodies: { method: string; url: string; body: unknown }[] = [];

const NOW = "2026-11-10T10:00:00.000Z";
const EMPTY_GOALS = { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false };

function responsibility(id: string, title: string, status: "active" | "completed" = "active") {
  return { id, title, description: null, status, relationToRole: "within", startDate: null, endDate: null, goalIds: [], createdAt: NOW, updatedAt: NOW };
}

function achievement(id: string, title: string) {
  return {
    id,
    title,
    description: "Syntetisk beskrivelse",
    outcome: null,
    relationToRole: "unspecified",
    periodStart: null,
    periodEnd: null,
    goalIds: [],
    responsibilityIds: [],
    missingLinks: { goalIds: [], responsibilityIds: [] },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function tokenOf(init: RequestInit | undefined): string {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization?.replace(/^Bearer /, "") ?? "";
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/me/goals") return Promise.resolve({ status: 200, json: async () => EMPTY_GOALS });
      sentBodies.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      return new Promise<Response>((resolve, reject) => {
        pending.push({
          method,
          url,
          token: tokenOf(init),
          respond: (status, body) => resolve({ status, json: async () => body } as Response),
          fail: () => reject(new TypeError("network down")),
        });
      });
    }),
  );
}

/** Finds and removes the earliest unanswered request, waiting until the component has sent it. */
async function takeRequest(method: string, url: string, token = "token-a"): Promise<PendingRequest> {
  let found: PendingRequest | undefined;
  await waitFor(() => {
    found = pending.find((item) => item.method === method && item.url === url && item.token === token);
    if (!found) throw new Error(`no pending ${method} ${url}`);
  });
  pending = pending.filter((item) => item !== found);
  return found as PendingRequest;
}

function setIdentity(token: Identity) {
  act(() => {
    for (const subscriber of identitySubscribers) subscriber(token);
  });
}

function listBody(records: unknown[]) {
  return { records, recoveryItems: [], unavailableCount: 0, truncated: false };
}

/** The `li` that holds one record's card, found by its title. */
/** Records are collapsed until opened; expands the row so its own edit and delete controls are reachable. */
async function openRow(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  const toggle = within(rowFor(title)).getByRole("button", { name: title });
  if (toggle.getAttribute("aria-expanded") === "false") await user.click(toggle);
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByRole("heading", { name: title }).closest("li");
  if (!row) throw new Error(`no row for ${title}`);
  return row;
}

beforeEach(() => {
  pending = [];
  sentBodies = [];
  identitySubscribers = new Set();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("responsibilities: pending completion toggle", () => {
  it("marks only the affected row as pending, blocks a repeat click, and confirms success after the server responds", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A"), responsibility("r2", "Driftsansvar B")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.complete }));
    const busyButton = within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.updating });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    expect((within(rowFor("Driftsansvar B")).getByRole("button", { name: copy.complete }) as HTMLButtonElement).disabled).toBe(false);

    // A second click before the server answers must not send another write.
    await user.click(busyButton);
    expect(sentBodies.filter((call) => call.method === "PATCH")).toHaveLength(1);

    (await takeRequest("PATCH", "/api/me/responsibilities/r1")).respond(200, responsibility("r1", "Driftsansvar A", "completed"));
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A", "completed"), responsibility("r2", "Driftsansvar B")]));

    expect(await screen.findByText(copy.success.completed)).toBeTruthy();
    expect(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.reopen })).toBeTruthy();
  });

  it("keeps the record unchanged, restores the control, and shows the error after a failed completion", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.complete }));
    (await takeRequest("PATCH", "/api/me/responsibilities/r1")).respond(500, { error: "persistence_failed" });

    expect(await screen.findByText(workspaceCopy.errors.persistence_failed)).toBeTruthy();
    expect(screen.queryByText(copy.success.completed)).toBeNull();
    const restored = within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.complete });
    expect((restored as HTMLButtonElement).disabled).toBe(false);
    expect(within(rowFor("Driftsansvar A")).getByText(workspaceCopy.statusLabels.active)).toBeTruthy();
  });

  it("shows the permission message, not success, when the session is no longer authorized", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.complete }));
    (await takeRequest("PATCH", "/api/me/responsibilities/r1")).respond(401, { error: "unauthenticated" });

    expect(await screen.findByText(workspaceCopy.errors.unauthenticated)).toBeTruthy();
    expect(screen.queryByText(copy.success.completed)).toBeNull();
  });
});

describe("responsibilities: pending deletion", () => {
  it("shows the pending delete label on the confirmation, blocks a repeat confirm, and removes the row only after success", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A"), responsibility("r2", "Driftsansvar B")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await openRow(user, "Driftsansvar A");
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.delete }));
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.confirmDelete }));
    const busyConfirm = within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.deleting });
    expect((busyConfirm as HTMLButtonElement).disabled).toBe(true);

    await user.click(busyConfirm);
    expect(sentBodies.filter((call) => call.method === "DELETE")).toHaveLength(1);

    // Still visible until the server confirms the delete.
    expect(screen.getByRole("heading", { name: "Driftsansvar A" })).toBeTruthy();

    (await takeRequest("DELETE", "/api/me/responsibilities/r1")).respond(200, { deleted: true });
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r2", "Driftsansvar B")]));

    expect(await screen.findByText(copy.success.deleted)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Driftsansvar A" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Driftsansvar B" })).toBeTruthy();
  });

  it("restores the delete control and keeps the record after a failed delete", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await openRow(user, "Driftsansvar A");
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.delete }));
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.confirmDelete }));
    (await takeRequest("DELETE", "/api/me/responsibilities/r1")).respond(500, { error: "persistence_failed" });

    expect(await screen.findByText(workspaceCopy.errors.persistence_failed)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Driftsansvar A" })).toBeTruthy();
    await openRow(user, "Driftsansvar A");
    expect(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.delete })).toBeTruthy();
    expect(screen.queryByText(copy.success.deleted)).toBeNull();
  });
});

describe("responsibilities: identity changes during a write", () => {
  it("ignores a late completion success after an account switch, and shows no success message", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.complete }));
    const late = await takeRequest("PATCH", "/api/me/responsibilities/r1");
    setIdentity("token-b");
    (await takeRequest("GET", "/api/me/responsibilities", "token-b")).respond(200, listBody([responsibility("r9", "Driftsansvar B-konto")]));
    expect(await screen.findByRole("heading", { name: "Driftsansvar B-konto" })).toBeTruthy();

    late.respond(200, responsibility("r1", "Driftsansvar A", "completed"));
    await act(async () => {});

    expect(screen.queryByText(copy.success.completed)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Driftsansvar A" })).toBeNull();
  });

  it("ignores a late failure after sign-out and shows the signed-out state, not an error", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listBody([responsibility("r1", "Driftsansvar A")]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await openRow(user, "Driftsansvar A");
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.delete }));
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.confirmDelete }));
    const late = await takeRequest("DELETE", "/api/me/responsibilities/r1");
    setIdentity(null);
    expect(await screen.findByText(workspaceCopy.signedOut)).toBeTruthy();

    late.fail();
    await act(async () => {});

    expect(screen.queryByText(workspaceCopy.errors.read_failed)).toBeNull();
    expect(screen.queryByText(copy.success.deleted)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Driftsansvar A" })).toBeNull();
  });
});

describe("achievements: pending deletion and identity safety", () => {
  it("blocks a repeat delete, keeps the record until success, and shows the pending label", async () => {
    const user = userEvent.setup();
    render(<AchievementsSection revision={0} />);
    (await takeRequest("GET", "/api/me/achievements")).respond(200, listBody([achievement("a1", "Rapport A"), achievement("a2", "Rapport B")]));
    await screen.findByRole("heading", { name: "Rapport A" });

    await openRow(user, "Rapport A");
    await user.click(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.delete }));
    await user.click(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.confirmDelete }));
    const busyConfirm = within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.deleting });
    expect((busyConfirm as HTMLButtonElement).disabled).toBe(true);
    await openRow(user, "Rapport B");
    expect((within(rowFor("Rapport B")).getByRole("button", { name: achievementCopy.edit }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(busyConfirm);
    expect(sentBodies.filter((call) => call.method === "DELETE" && call.url === "/api/me/achievements/a1")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Rapport A" })).toBeTruthy();

    (await takeRequest("DELETE", "/api/me/achievements/a1")).respond(200, { deleted: true });
    (await takeRequest("GET", "/api/me/achievements")).respond(200, listBody([achievement("a2", "Rapport B")]));

    expect(await screen.findByText(achievementCopy.success.deleted)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Rapport A" })).toBeNull();
  });

  it("restores the controls and does not claim success after a failed delete", async () => {
    const user = userEvent.setup();
    render(<AchievementsSection revision={0} />);
    (await takeRequest("GET", "/api/me/achievements")).respond(200, listBody([achievement("a1", "Rapport A")]));
    await screen.findByRole("heading", { name: "Rapport A" });

    await openRow(user, "Rapport A");
    await user.click(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.delete }));
    await user.click(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.confirmDelete }));
    (await takeRequest("DELETE", "/api/me/achievements/a1")).respond(500, { error: "persistence_failed" });

    expect(await screen.findByText(workspaceCopy.errors.persistence_failed)).toBeTruthy();
    await openRow(user, "Rapport A");
    expect(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.delete })).toBeTruthy();
    expect(screen.queryByText(achievementCopy.success.deleted)).toBeNull();
  });

  it("ignores a late delete result from the previous account after an account switch", async () => {
    const user = userEvent.setup();
    render(<AchievementsSection revision={0} />);
    (await takeRequest("GET", "/api/me/achievements")).respond(200, listBody([achievement("a1", "Rapport A")]));
    await screen.findByRole("heading", { name: "Rapport A" });

    await openRow(user, "Rapport A");
    await user.click(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.delete }));
    await user.click(within(rowFor("Rapport A")).getByRole("button", { name: achievementCopy.confirmDelete }));
    const late = await takeRequest("DELETE", "/api/me/achievements/a1");
    setIdentity("token-b");
    (await takeRequest("GET", "/api/me/achievements", "token-b")).respond(200, listBody([achievement("b1", "Rapport B-konto")]));
    expect(await screen.findByRole("heading", { name: "Rapport B-konto" })).toBeTruthy();

    late.respond(200, { deleted: true });
    await act(async () => {});

    expect(screen.queryByText(achievementCopy.success.deleted)).toBeNull();
    expect(screen.getByRole("heading", { name: "Rapport B-konto" })).toBeTruthy();
  });
});

function listWithRecovery(records: unknown[], recoveryItems: { id: string }[]) {
  return { records, recoveryItems, unavailableCount: 0, truncated: false };
}

const recoveryButton = (name: string) => screen.getByRole("button", { name });

describe("responsibilities: recovery-item deletion", () => {
  it("enters a pending state on confirm, blocks a second confirm, and keeps the item until the server confirms", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([responsibility("r1", "Driftsansvar A")], [{ id: "bad1" }]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(recoveryButton(copy.recoveryDelete));
    await user.click(recoveryButton(copy.confirmDelete));
    const busy = recoveryButton(copy.deleting);
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    await user.click(busy);
    expect(sentBodies.filter((call) => call.method === "DELETE" && call.url === "/api/me/responsibilities/bad1")).toHaveLength(1);
    expect(recoveryButton(copy.deleting)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Driftsansvar A" })).toBeTruthy();
  });

  it("removes only the confirmed recovery item after success and keeps the other items and records", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(
      200,
      listWithRecovery([responsibility("r1", "Driftsansvar A")], [{ id: "bad1" }, { id: "bad2" }]),
    );
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(screen.getAllByRole("button", { name: copy.recoveryDelete })[0]);
    await user.click(recoveryButton(copy.confirmDelete));
    (await takeRequest("DELETE", "/api/me/responsibilities/bad1")).respond(200, { deleted: true });
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([responsibility("r1", "Driftsansvar A")], [{ id: "bad2" }]));

    expect(await screen.findByText(copy.success.deleted)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: copy.recoveryDelete })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Driftsansvar A" })).toBeTruthy();
  });

  it("restores the recovery control and keeps every other record after a failed delete", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([responsibility("r1", "Driftsansvar A")], [{ id: "bad1" }]));
    await screen.findByRole("heading", { name: "Driftsansvar A" });

    await user.click(recoveryButton(copy.recoveryDelete));
    await user.click(recoveryButton(copy.confirmDelete));
    (await takeRequest("DELETE", "/api/me/responsibilities/bad1")).respond(500, { error: "persistence_failed" });

    expect(await screen.findByText(workspaceCopy.errors.persistence_failed)).toBeTruthy();
    expect((recoveryButton(copy.recoveryDelete) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("heading", { name: "Driftsansvar A" })).toBeTruthy();
    expect(screen.queryByText(copy.success.deleted)).toBeNull();
  });

  it("does not show success when the session is refused for the recovery delete", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([], [{ id: "bad1" }]));
    await screen.findByRole("button", { name: copy.recoveryDelete });

    await user.click(recoveryButton(copy.recoveryDelete));
    await user.click(recoveryButton(copy.confirmDelete));
    (await takeRequest("DELETE", "/api/me/responsibilities/bad1")).respond(401, { error: "unauthenticated" });

    expect(await screen.findByText(workspaceCopy.errors.unauthenticated)).toBeTruthy();
    expect(screen.queryByText(copy.success.deleted)).toBeNull();
  });

  it("ignores a late recovery-delete success after an account switch and does not update the new account's list", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([], [{ id: "bad1" }]));
    await screen.findByRole("button", { name: copy.recoveryDelete });
    await user.click(recoveryButton(copy.recoveryDelete));
    await user.click(recoveryButton(copy.confirmDelete));
    const late = await takeRequest("DELETE", "/api/me/responsibilities/bad1");

    setIdentity("token-b");
    (await takeRequest("GET", "/api/me/responsibilities", "token-b")).respond(200, listWithRecovery([responsibility("r9", "Konto B-ansvar")], []));
    expect(await screen.findByRole("heading", { name: "Konto B-ansvar" })).toBeTruthy();

    late.respond(200, { deleted: true });
    await act(async () => {});

    expect(screen.queryByText(copy.success.deleted)).toBeNull();
    expect(screen.getByRole("heading", { name: "Konto B-ansvar" })).toBeTruthy();
  });

  it("ignores a late recovery-delete failure after an account switch and shows no error for the new account", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([], [{ id: "bad1" }]));
    await screen.findByRole("button", { name: copy.recoveryDelete });
    await user.click(recoveryButton(copy.recoveryDelete));
    await user.click(recoveryButton(copy.confirmDelete));
    const late = await takeRequest("DELETE", "/api/me/responsibilities/bad1");

    setIdentity("token-b");
    (await takeRequest("GET", "/api/me/responsibilities", "token-b")).respond(200, listWithRecovery([responsibility("r9", "Konto B-ansvar")], []));
    expect(await screen.findByRole("heading", { name: "Konto B-ansvar" })).toBeTruthy();

    late.fail();
    await act(async () => {});

    expect(screen.queryByText(workspaceCopy.errors.read_failed)).toBeNull();
    expect(screen.queryByText(workspaceCopy.errors.persistence_failed)).toBeNull();
    expect(screen.getByRole("heading", { name: "Konto B-ansvar" })).toBeTruthy();
  });
});

describe("direct account switch (A -> B, no sign-out in between)", () => {
  it("responsibilities: clears account A's list while account B's read is pending", async () => {
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([responsibility("r1", "Konto A-ansvar")], []));
    await screen.findByRole("heading", { name: "Konto A-ansvar" });

    setIdentity("token-b");

    expect(screen.queryByRole("heading", { name: "Konto A-ansvar" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(copy.loading);
  });

  it("responsibilities: clears a success notice from account A after the switch", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([responsibility("r1", "Driftsansvar A")], []));
    await screen.findByRole("heading", { name: "Driftsansvar A" });
    await user.click(within(rowFor("Driftsansvar A")).getByRole("button", { name: copy.complete }));
    (await takeRequest("PATCH", "/api/me/responsibilities/r1")).respond(200, responsibility("r1", "Driftsansvar A", "completed"));
    (await takeRequest("GET", "/api/me/responsibilities")).respond(200, listWithRecovery([responsibility("r1", "Driftsansvar A", "completed")], []));
    expect(await screen.findByText(copy.success.completed)).toBeTruthy();

    setIdentity("token-b");

    expect(screen.queryByText(copy.success.completed)).toBeNull();
  });

  it("achievements: clears account A's list while account B's read is pending", async () => {
    render(<AchievementsSection revision={0} />);
    (await takeRequest("GET", "/api/me/achievements")).respond(200, listWithRecovery([achievement("a1", "Konto A-bidrag")], []));
    await screen.findByRole("heading", { name: "Konto A-bidrag" });

    setIdentity("token-b");

    expect(screen.queryByRole("heading", { name: "Konto A-bidrag" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(achievementCopy.loading);
  });
});
