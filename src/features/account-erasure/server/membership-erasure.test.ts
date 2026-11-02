import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseRoadmapItem } from "../../roadmap/domain/roadmap-item";
import { ErasureStepFailure } from "./erasure-runner";
import { runMembershipBatch, type MembershipErasurePort, type MembershipTransaction } from "./membership-erasure";

// TASK-016: the memberships step. Fixtures are synthetic. Matching is by the membership's opaque memberRef and team, never
// by uid, and the membership is deleted only after its owner references are cleared.

const UID = "erased-uid";
const OTHER_UID = "other-uid";
const TEAM = "team-1";
const OTHER_TEAM = "team-2";
const REF = "ref-erased-0000000000000001";
const OTHER_REF = "ref-other-0000000000000000002";

interface Item {
  teamId: string;
  ownerRef: string | null;
}

function fakeMembershipStore(options: { memberships?: Record<string, Record<string, unknown>>; items?: Record<string, Item> } = {}) {
  const memberships = new Map<string, Record<string, unknown>>(Object.entries(options.memberships ?? {}));
  const items = new Map<string, Item>(Object.entries(options.items ?? {}));
  const log: string[] = [];

  const tx: MembershipTransaction = {
    async getMembership(id) {
      const data = memberships.get(id);
      return data === undefined ? undefined : { ...data };
    },
    async roadmapItemIdsOwnedBy(teamId, memberRef, limit) {
      return [...items.entries()]
        .filter(([, item]) => item.teamId === teamId && item.ownerRef === memberRef)
        .map(([id]) => id)
        .slice(0, limit);
    },
    clearRoadmapOwnerRef(itemId) {
      log.push(`clear:${itemId}`);
      const item = items.get(itemId);
      if (item) items.set(itemId, { ...item, ownerRef: null });
    },
    deleteMembership(id) {
      log.push(`delete:${id}`);
      memberships.delete(id);
    },
  };

  const port: MembershipErasurePort = {
    async runTransaction(work) {
      return work(tx);
    },
    async membershipIdsOf(uid, limit) {
      return [...memberships.entries()]
        .filter(([id, data]) => {
          if (data.uid !== undefined) return data.uid === uid;
          return id.startsWith(`${uid}__`);
        })
        .map(([id]) => id)
        .slice(0, limit);
    },
  };

  return { port, memberships, items, log };
}

/** Runs batches until the step reports `done`, with a hard cap so a looping step fails the test instead of hanging. */
async function runToDone(port: MembershipErasurePort, uid: string, maxWrites = 100): Promise<number> {
  let batches = 0;
  for (;;) {
    batches += 1;
    if (batches > 50) throw new Error("step did not reach done");
    const result = await runMembershipBatch({ port }, uid, maxWrites);
    if (result === "done") return batches;
  }
}

describe("memberships erasure step (TASK-016)", () => {
  it("clears the owner references that name this membership before the membership is deleted", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: REF } },
      items: { "item-a": { teamId: TEAM, ownerRef: REF }, "item-b": { teamId: TEAM, ownerRef: REF } },
    });

    await runToDone(store.port, UID);

    expect(store.log).toEqual(["clear:item-a", "clear:item-b", `delete:${UID}__${TEAM}`]);
    expect(store.memberships.has(`${UID}__${TEAM}`)).toBe(false);
    expect(store.items.get("item-a")?.ownerRef).toBeNull();
    expect(store.items.get("item-b")?.ownerRef).toBeNull();
  });

  it("does not delete the membership while an owner reference remains, even when the batch budget is small", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: REF } },
      items: { "item-a": { teamId: TEAM, ownerRef: REF }, "item-b": { teamId: TEAM, ownerRef: REF } },
    });

    await runMembershipBatch({ port: store.port }, UID, 1);
    expect(store.memberships.has(`${UID}__${TEAM}`)).toBe(true);
    expect(store.log).toEqual(["clear:item-a"]);

    await runToDone(store.port, UID, 1);
    expect(store.log).toEqual(["clear:item-a", "clear:item-b", `delete:${UID}__${TEAM}`]);
  });

  it("leaves an owner reference whose value equals the erased uid untouched (matching is by memberRef only)", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: REF } },
      items: { "item-uid-valued": { teamId: TEAM, ownerRef: UID }, "item-a": { teamId: TEAM, ownerRef: REF } },
    });

    await runToDone(store.port, UID);

    expect(store.items.get("item-uid-valued")?.ownerRef).toBe(UID);
    expect(store.log).not.toContain("clear:item-uid-valued");
  });

  it("fails closed on an empty memberRef as malformed, so the membership is not silently deleted", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: "" } },
    });

    await expect(runMembershipBatch({ port: store.port }, UID, 100)).rejects.toMatchObject({
      code: "verification_failed",
    });
    expect(store.memberships.has(`${UID}__${TEAM}`)).toBe(true);
  });

  it("removes a legacy membership with no uid field by its uid__ document-id prefix", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { teamId: TEAM } },
    });

    await runToDone(store.port, UID);

    expect(store.memberships.size).toBe(0);
    expect(store.log).toEqual([`delete:${UID}__${TEAM}`]);
  });

  it("leaves other members' memberships and their owner references untouched", async () => {
    const store = fakeMembershipStore({
      memberships: {
        [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: REF },
        [`${OTHER_UID}__${TEAM}`]: { uid: OTHER_UID, teamId: TEAM, memberRef: OTHER_REF },
      },
      items: { "item-a": { teamId: TEAM, ownerRef: REF }, "item-other": { teamId: TEAM, ownerRef: OTHER_REF } },
    });

    await runToDone(store.port, UID);

    expect(store.memberships.has(`${OTHER_UID}__${TEAM}`)).toBe(true);
    expect(store.items.get("item-other")?.ownerRef).toBe(OTHER_REF);
    expect(store.log.some((entry) => entry.includes("other"))).toBe(false);
  });

  it("does not touch an owner reference to the same memberRef in a different team", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: REF } },
      items: { "item-same-team": { teamId: TEAM, ownerRef: REF }, "item-other-team": { teamId: OTHER_TEAM, ownerRef: REF } },
    });

    await runToDone(store.port, UID);

    expect(store.items.get("item-other-team")?.ownerRef).toBe(REF);
    expect(store.items.get("item-same-team")?.ownerRef).toBeNull();
  });

  it("deletes a membership with no memberRef directly, since no owner reference can name it", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM } },
    });

    await runToDone(store.port, UID);

    expect(store.log).toEqual([`delete:${UID}__${TEAM}`]);
  });

  it("reports done only when no membership of the uid is left", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM } },
    });

    expect(await runMembershipBatch({ port: store.port }, UID, 100)).toBe("more");
    expect(await runMembershipBatch({ port: store.port }, UID, 100)).toBe("done");
  });

  it("fails closed, with no write, when a membership's uid field belongs to someone else", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: OTHER_UID, teamId: TEAM, memberRef: REF } },
      items: { "item-a": { teamId: TEAM, ownerRef: REF } },
    });

    // A faulty port that returns the other member's membership for this uid. The step must still refuse it.
    const faultyPort: MembershipErasurePort = {
      ...store.port,
      membershipIdsOf: async () => [`${UID}__${TEAM}`],
    };

    await expect(runMembershipBatch({ port: faultyPort }, UID, 100)).rejects.toMatchObject({
      code: "verification_failed",
    });
    expect(store.log).toEqual([]);
  });

  it("fails closed on a malformed membership field such as a non-string memberRef", async () => {
    const store = fakeMembershipStore({
      memberships: { [`${UID}__${TEAM}`]: { uid: UID, teamId: TEAM, memberRef: 42 } },
    });

    await expect(runMembershipBatch({ port: store.port }, UID, 100)).rejects.toBeInstanceOf(ErasureStepFailure);
    expect(store.memberships.has(`${UID}__${TEAM}`)).toBe(true);
  });

  it("refuses a zero write budget as a programming error, not as a batch result", async () => {
    const store = fakeMembershipStore();
    await expect(runMembershipBatch({ port: store.port }, UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });
});

describe("roadmap reader accepts a null ownerRef (TASK-016 cross-feature)", () => {
  const base = {
    teamId: TEAM,
    treeId: "tree-1",
    targetNodeId: "node-2",
    priority: "medium",
    status: "planned",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    createdBy: "uid-1",
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedBy: "uid-1",
  };

  it("reads an item whose ownerRef was cleared to null as an unowned item, not as unreadable", () => {
    const parsed = parseRoadmapItem({ ...base, ownerRef: null });
    expect(parsed).toBeDefined();
    expect(parsed).not.toHaveProperty("ownerRef");
  });
});
