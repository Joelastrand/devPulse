import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillNeedsReader } from "./skill-needs-store";

// Representative service-level propagation test (TASK-009). The setup file mocks the fence reader for feature tests;
// this file restores the real production reader so the verifier's real fence path runs under the protected service.
vi.unmock("../../auth/server/erasure-fence");

const state = vi.hoisted(() => ({ records: new Map<string, unknown>(), failRead: false }));

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (state.failRead) throw new Error("firestore unavailable");
          if (name !== "accountErasures") throw new Error(`unexpected collection ${name}`);
          return state.records.has(id)
            ? { exists: true, data: () => state.records.get(id) }
            : { exists: false, data: () => undefined };
        },
      }),
    }),
  }),
}));

const { listSkillNeeds } = await import("./list-skill-needs");
const { getDefaultSkillNeedsStore } = await import("./skill-needs-store");

afterEach(() => {
  state.records.clear();
  state.failRead = false;
});

const TEAM = "team-1";
const UID = "u-member";

/** Every data source a protected read would touch. A refused caller must leave all of them untouched. */
function dataAccessSpies() {
  const listByTeam = vi.fn(async (): Promise<Array<{ id: string; data: unknown }>> => []);
  const listOrderedByCreatedAt = vi.fn(async () => []);
  const getSkillTree = vi.fn(async () => undefined);
  const getTeamStatus = vi.fn(async () => "active");
  const getMembership = vi.fn(async (uid: string, teamId: string) => ({ uid, teamId, role: "member" }));
  return {
    listByTeam,
    listOrderedByCreatedAt,
    getSkillTree,
    getTeamStatus,
    getMembership,
    untouched: () =>
      [listByTeam, listOrderedByCreatedAt, getSkillTree, getTeamStatus, getMembership].every(
        (spy) => spy.mock.calls.length === 0,
      ),
  };
}

function run(fence: "none" | "in_progress" | "terminal" | "malformed" | "read_failure") {
  if (fence === "read_failure") state.failRead = true;
  else if (fence === "in_progress") state.records.set(UID, { status: "in_progress" });
  else if (fence === "terminal") state.records.set(UID, { status: "completed" });
  else if (fence === "malformed") state.records.set(UID, { status: "reopened" });

  const spies = dataAccessSpies();
  const reader: SkillNeedsReader = { listByTeam: spies.listByTeam };
  const result = listSkillNeeds("token", TEAM, {
    verifyToken: async () => ({ uid: UID, email: "member@example.com", email_verified: true }) as never,
    isSuperadmin: async () => false,
    collection: { getTeamStatus: spies.getTeamStatus, getMembership: spies.getMembership },
    reads: { getTeamStatus: spies.getTeamStatus, getMembership: spies.getMembership },
    store: getDefaultSkillNeedsStore(reader),
    catalogReader: { listOrderedByCreatedAt: spies.listOrderedByCreatedAt, getSkillTree: spies.getSkillTree },
  });
  return { result, spies };
}

describe("protected service under the real erasure fence (TASK-009 representative propagation)", () => {
  it("control: a member with no erasure record reads the list (the fake path is live)", async () => {
    const { result, spies } = run("none");
    expect((await result).ok).toBe(true);
    expect(spies.listByTeam).toHaveBeenCalledTimes(1);
  });

  it("refuses an in-progress erasure with erasure_in_progress and touches no protected data", async () => {
    const { result, spies } = run("in_progress");
    expect(await result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(spies.untouched()).toBe(true);
  });

  it("fails closed with auth_unavailable when the fence read fails, never reading data", async () => {
    const { result, spies } = run("read_failure");
    expect(await result).toEqual({ ok: false, error: "auth_unavailable" });
    expect(spies.untouched()).toBe(true);
  });

  it("refuses a malformed fence record as auth_unavailable, never reading data", async () => {
    const { result, spies } = run("malformed");
    expect(await result).toEqual({ ok: false, error: "auth_unavailable" });
    expect(spies.untouched()).toBe(true);
  });

  it("refuses a terminal erasure as unauthenticated (invalid_token), never reading data", async () => {
    const { result, spies } = run("terminal");
    expect(await result).toEqual({ ok: false, error: "unauthenticated" });
    expect(spies.untouched()).toBe(true);
  });
});
