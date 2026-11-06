import { describe, expect, it } from "vitest";
import { runMembershipBatch, type MembershipErasurePort, type MembershipTransaction } from "./membership-erasure";

// Synthetic, obviously fictional identifiers. Member refs use the opaque 26-character format.
const UID = "synthetic-uid-erased";
const MEMBER = "0123456789abcdefghjkmnpqrs";
const OTHER_MEMBER = "tvwxyz0123456789abcdefghjk";

interface Row {
  [field: string]: unknown;
}

/** In-memory port. Writes are applied only when the transaction body resolves, mirroring a committed transaction. */
function fakePort(init: { memberships: Record<string, Row>; participations: Record<string, Row> }) {
  const memberships = new Map(Object.entries(init.memberships));
  const participations = new Map(Object.entries(init.participations));

  const port: MembershipErasurePort = {
    async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
      const pending: Array<() => void> = [];
      const tx: MembershipTransaction = {
        async getMembership(id) {
          const row = memberships.get(id);
          return row === undefined ? undefined : { ...row };
        },
        async roadmapItemIdsOwnedBy() {
          return [];
        },
        clearRoadmapOwnerRef() {
          throw new Error("no roadmap fixture");
        },
        async systemsKnowingMemberRef() {
          return [];
        },
        setKnowledgeMemberRefs() {
          throw new Error("no system fixture");
        },
        async participationIdsOf(teamId, memberRef, limit) {
          return [...participations.entries()]
            .filter(([, row]) => row.teamId === teamId && row.memberRef === memberRef)
            .slice(0, limit)
            .map(([id]) => id);
        },
        deleteParticipation(id) {
          pending.push(() => participations.delete(id));
        },
        deleteMembership(id) {
          pending.push(() => memberships.delete(id));
        },
      };
      const result = await work(tx);
      for (const apply of pending) apply();
      return result;
    },
    async membershipIdsOf(uid) {
      return [...memberships.entries()].filter(([, row]) => row.uid === uid).map(([id]) => id);
    },
  };
  return { port, memberships, participations };
}

describe("erasure of a membership with project participations (A-15)", () => {
  it("deletes the erased member's participations in that team before the membership, then reports done", async () => {
    const h = fakePort({
      memberships: { [`${UID}__team-a`]: { uid: UID, teamId: "team-a", memberRef: MEMBER } },
      participations: {
        "pp-1": { teamId: "team-a", projectId: "p1", memberRef: MEMBER, startDate: "2026-06-01", endDate: "2026-06-30" },
        "pp-2": { teamId: "team-a", projectId: "p2", memberRef: MEMBER, startDate: "2026-07-01", endDate: "2026-07-10" },
      },
    });

    // First batch removes the participations and must not delete the membership yet.
    expect(await runMembershipBatch({ port: h.port }, UID, 500)).toBe("more");
    expect([...h.participations.keys()]).toEqual([]);
    expect(h.memberships.has(`${UID}__team-a`)).toBe(true);

    // Second batch deletes the membership; third finds nothing left.
    expect(await runMembershipBatch({ port: h.port }, UID, 500)).toBe("more");
    expect(h.memberships.has(`${UID}__team-a`)).toBe(false);
    expect(await runMembershipBatch({ port: h.port }, UID, 500)).toBe("done");
  });

  it("keeps participations of other members and of the same member in other teams", async () => {
    const h = fakePort({
      memberships: { [`${UID}__team-a`]: { uid: UID, teamId: "team-a", memberRef: MEMBER } },
      participations: {
        "pp-own": { teamId: "team-a", projectId: "p1", memberRef: MEMBER, startDate: "2026-06-01", endDate: "2026-06-30" },
        "pp-other-member": { teamId: "team-a", projectId: "p1", memberRef: OTHER_MEMBER, startDate: "2026-06-01", endDate: "2026-06-30" },
        "pp-other-team": { teamId: "team-b", projectId: "p9", memberRef: MEMBER, startDate: "2026-06-01", endDate: "2026-06-30" },
      },
    });

    while ((await runMembershipBatch({ port: h.port }, UID, 500)) === "more") {
      // Drain the batches until the membership is gone.
    }

    expect([...h.participations.keys()].sort()).toEqual(["pp-other-member", "pp-other-team"]);
    expect(h.memberships.size).toBe(0);
  });

  it("completes without touching participations when the member has none", async () => {
    const h = fakePort({
      memberships: { [`${UID}__team-a`]: { uid: UID, teamId: "team-a", memberRef: MEMBER } },
      participations: {},
    });

    expect(await runMembershipBatch({ port: h.port }, UID, 500)).toBe("more");
    expect(h.memberships.size).toBe(0);
  });
});
