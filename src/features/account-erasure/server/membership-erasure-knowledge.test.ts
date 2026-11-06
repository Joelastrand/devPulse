import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runMembershipBatch, withoutMemberRef, type MembershipErasurePort, type MembershipTransaction } from "./membership-erasure";

// TASK-039 (team-system-overview, OQ-1 approved 2026-11-05): A-14, `teamSystems.knowledgeMemberRefs` DETACH, in the memberships
// step. Synthetic fixtures only. Matching is by the membership's opaque memberRef and team, never by uid. The system record
// is kept; only the ref list changes; the membership is deleted only after no system in the team still names its ref.

const UID = "erased-uid";
const TEAM = "team-1";
const OTHER_TEAM = "team-2";
const REF = "ref-erased-0000000000000001";
const OTHER_REF = "ref-other-0000000000000002";
const MEMBERSHIP = `${UID}__${TEAM}`;

interface SystemDoc {
  teamId: string;
  name: string;
  knowledgeMemberRefs: string[];
}

function fakeStore(options: { systems?: Record<string, SystemDoc>; failNextTransaction?: boolean } = {}) {
  const memberships = new Map<string, Record<string, unknown>>([
    [MEMBERSHIP, { uid: UID, teamId: TEAM, memberRef: REF }],
  ]);
  const systems = new Map<string, SystemDoc>(Object.entries(options.systems ?? {}));
  let failNext = options.failNextTransaction === true;
  const writes: string[] = [];

  const tx: MembershipTransaction = {
    async getMembership(id) {
      const data = memberships.get(id);
      return data === undefined ? undefined : { ...data };
    },
    async roadmapItemIdsOwnedBy() {
      return [];
    },
    clearRoadmapOwnerRef() {
      throw new Error("no roadmap fixture");
    },
    async systemsKnowingMemberRef(teamId, memberRef, limit) {
      return [...systems.entries()]
        .filter(([, system]) => system.teamId === teamId && system.knowledgeMemberRefs.includes(memberRef))
        .slice(0, limit)
        .map(([systemId, system]) => ({ systemId, knowledgeMemberRefs: [...system.knowledgeMemberRefs] }));
    },
    setKnowledgeMemberRefs(systemId, knowledgeMemberRefs) {
      writes.push(systemId);
      const system = systems.get(systemId);
      if (system) systems.set(systemId, { ...system, knowledgeMemberRefs: [...knowledgeMemberRefs] });
    },
    async participationIdsOf() {
      return [];
    },
    deleteParticipation() {
      throw new Error("no participation fixture");
    },
    deleteMembership(id) {
      writes.push(`delete:${id}`);
      memberships.delete(id);
    },
  };

  const port: MembershipErasurePort = {
    async runTransaction(work) {
      if (failNext) {
        failNext = false;
        throw new Error("simulated transaction failure before commit");
      }
      return work(tx);
    },
    async membershipIdsOf(uid, limit) {
      return [...memberships.keys()].filter((id) => id.startsWith(`${uid}__`)).slice(0, limit);
    },
  };

  return { port, memberships, systems, writes };
}

async function runToDone(port: MembershipErasurePort, maxWrites = 100): Promise<void> {
  for (let batch = 0; batch < 50; batch += 1) {
    if ((await runMembershipBatch({ port }, UID, maxWrites)) === "done") return;
  }
  throw new Error("step did not reach done");
}

describe("memberships step: A-14 knowledge-ref detach (TASK-039)", () => {
  it("removes the erased ref from every system that names it and keeps the other members in order", async () => {
    const store = fakeStore({
      systems: {
        "sys-a": { teamId: TEAM, name: "Billing", knowledgeMemberRefs: [OTHER_REF, REF, "ref-third-0000000000000003"] },
        "sys-b": { teamId: TEAM, name: "Portal", knowledgeMemberRefs: [REF] },
      },
    });

    await runToDone(store.port);

    expect(store.systems.get("sys-a")).toEqual({
      teamId: TEAM,
      name: "Billing",
      knowledgeMemberRefs: [OTHER_REF, "ref-third-0000000000000003"],
    });
    expect(store.systems.get("sys-b")).toEqual({ teamId: TEAM, name: "Portal", knowledgeMemberRefs: [] });
  });

  it("keeps a system whose only knowledgeable member is erased, with an empty list, and never deletes the record", async () => {
    const store = fakeStore({ systems: { "sys-a": { teamId: TEAM, name: "Billing", knowledgeMemberRefs: [REF] } } });

    await runToDone(store.port);

    expect(store.systems.has("sys-a")).toBe(true);
    expect(store.systems.get("sys-a")?.knowledgeMemberRefs).toEqual([]);
    expect(store.memberships.has(MEMBERSHIP)).toBe(false);
  });

  it("leaves systems with empty lists, unrelated members, and systems of another team untouched", async () => {
    const store = fakeStore({
      systems: {
        "sys-empty": { teamId: TEAM, name: "Empty", knowledgeMemberRefs: [] },
        "sys-other-member": { teamId: TEAM, name: "Other", knowledgeMemberRefs: [OTHER_REF] },
        "sys-other-team": { teamId: OTHER_TEAM, name: "Elsewhere", knowledgeMemberRefs: [REF] },
      },
    });

    await runToDone(store.port);

    expect(store.systems.get("sys-empty")).toEqual({ teamId: TEAM, name: "Empty", knowledgeMemberRefs: [] });
    expect(store.systems.get("sys-other-member")).toEqual({ teamId: TEAM, name: "Other", knowledgeMemberRefs: [OTHER_REF] });
    expect(store.systems.get("sys-other-team")).toEqual({ teamId: OTHER_TEAM, name: "Elsewhere", knowledgeMemberRefs: [REF] });
  });

  it("does not delete the membership while a system still names its ref, even with a small batch budget", async () => {
    const store = fakeStore({
      systems: {
        "sys-a": { teamId: TEAM, name: "A", knowledgeMemberRefs: [REF] },
        "sys-b": { teamId: TEAM, name: "B", knowledgeMemberRefs: [REF] },
      },
    });

    await runMembershipBatch({ port: store.port }, UID, 1);
    expect(store.memberships.has(MEMBERSHIP)).toBe(true);

    await runToDone(store.port, 1);
    expect(store.memberships.has(MEMBERSHIP)).toBe(false);
    expect(store.writes.at(-1)).toBe(`delete:${MEMBERSHIP}`);
    expect(store.systems.get("sys-a")?.knowledgeMemberRefs).toEqual([]);
    expect(store.systems.get("sys-b")?.knowledgeMemberRefs).toEqual([]);
  });

  it("is idempotent: a repeated erasure run after completion changes nothing", async () => {
    const store = fakeStore({ systems: { "sys-a": { teamId: TEAM, name: "A", knowledgeMemberRefs: [REF, OTHER_REF] } } });
    await runToDone(store.port);
    const afterFirst = structuredClone([...store.systems.entries()]);

    await runToDone(store.port);

    expect([...store.systems.entries()]).toEqual(afterFirst);
    expect(store.systems.get("sys-a")?.knowledgeMemberRefs).toEqual([OTHER_REF]);
  });

  it("recovers from a failed transaction: the retry re-reads current data and completes with the same result", async () => {
    const store = fakeStore({ systems: { "sys-a": { teamId: TEAM, name: "A", knowledgeMemberRefs: [REF, OTHER_REF] } }, failNextTransaction: true });

    await expect(runMembershipBatch({ port: store.port }, UID, 100)).rejects.toThrow("simulated transaction failure");
    expect(store.systems.get("sys-a")?.knowledgeMemberRefs).toEqual([REF, OTHER_REF]);
    expect(store.memberships.has(MEMBERSHIP)).toBe(true);

    await runToDone(store.port);
    expect(store.systems.get("sys-a")?.knowledgeMemberRefs).toEqual([OTHER_REF]);
    expect(store.memberships.has(MEMBERSHIP)).toBe(false);
  });

  it("leaves the ref list untouched when the erased ref was never present (matching is by memberRef, not by uid)", async () => {
    const store = fakeStore({ systems: { "sys-a": { teamId: TEAM, name: "A", knowledgeMemberRefs: [OTHER_REF] } } });

    await runToDone(store.port);

    expect(store.systems.get("sys-a")?.knowledgeMemberRefs).toEqual([OTHER_REF]);
    expect(store.writes.some((write) => write === "sys-a")).toBe(false);
  });
});

describe("withoutMemberRef (A-14 pure filter)", () => {
  it("removes every occurrence and keeps the order of the remaining entries", () => {
    expect(withoutMemberRef([OTHER_REF, REF, OTHER_REF, REF], REF)).toEqual([OTHER_REF, OTHER_REF]);
  });

  it("returns an empty list for a single-member list and for an empty list", () => {
    expect(withoutMemberRef([REF], REF)).toEqual([]);
    expect(withoutMemberRef([], REF)).toEqual([]);
  });
});
