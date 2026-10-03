import { describe, expect, it, vi } from "vitest";
import type {
  GrantTeamMembershipCollection,
  MembershipGrantRecord,
} from "./grant-team-membership";
import { applyMembershipGrant, grantTeamMembership } from "./grant-team-membership";

const NOW = new Date("2026-09-01T00:00:00Z");
const MEMBER_REF = /^[0-9a-hjkmnp-tv-z]{26}$/;

function record(overrides: Partial<MembershipGrantRecord> = {}): MembershipGrantRecord {
  return {
    uid: "user-1",
    teamId: "team-1",
    createdAt: NOW,
    createdVia: "invitation",
    grantedBy: "admin-1",
    ...overrides,
  };
}

/**
 * Models the same first-committer-wins semantics the production Firestore
 * transaction provides: a `runGrant` call only ever writes when the
 * deterministic (uid, teamId) key is still absent, exactly like
 * `applyMembershipGrant` does inside a real transaction.
 */
function fakeCollection(
  seed: Record<string, MembershipGrantRecord> = {},
): GrantTeamMembershipCollection & { store: Record<string, MembershipGrantRecord>; calls: number } {
  const store: Record<string, MembershipGrantRecord> = { ...seed };
  let calls = 0;
  return {
    store,
    get calls() {
      return calls;
    },
    async runGrant(newRecord) {
      calls += 1;
      const key = `${newRecord.uid}__${newRecord.teamId}`;
      if (store[key]) {
        return "already_member";
      }
      store[key] = newRecord;
      return "created";
    },
  };
}

describe("grantTeamMembership", () => {
  it("creates a membership when none exists", async () => {
    const collection = fakeCollection();

    const outcome = await grantTeamMembership(record(), { collection });

    expect(outcome).toBe("created");
    expect(collection.store["user-1__team-1"]).toEqual(record());
  });

  it("returns already_member and does not overwrite an existing membership", async () => {
    const existing = record({ grantedBy: "admin-original" });
    const collection = fakeCollection({ "user-1__team-1": existing });

    const outcome = await grantTeamMembership(record({ grantedBy: "admin-new" }), { collection });

    expect(outcome).toBe("already_member");
    expect(collection.store["user-1__team-1"]).toEqual(existing);
  });

  it("deterministically attributes grantedBy to whichever attempt commits first, never the second (grantedBy race fix)", async () => {
    const collection = fakeCollection();

    const first = await grantTeamMembership(record({ grantedBy: "admin-A" }), { collection });
    const second = await grantTeamMembership(record({ grantedBy: "admin-B" }), { collection });

    expect(first).toBe("created");
    expect(second).toBe("already_member");
    expect(collection.store["user-1__team-1"].grantedBy).toBe("admin-A");
    expect(Object.keys(collection.store)).toHaveLength(1);
    expect(collection.calls).toBe(2);
  });

  it("propagates a transaction failure rather than reporting a false outcome", async () => {
    const collection: GrantTeamMembershipCollection = {
      runGrant: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    await expect(grantTeamMembership(record(), { collection })).rejects.toThrow(
      "simulated firestore outage",
    );
  });
});

describe("applyMembershipGrant", () => {
  function fakeTx() {
    return { set: vi.fn() } as unknown as Parameters<typeof applyMembershipGrant>[0];
  }
  function fakeRef() {
    return {} as Parameters<typeof applyMembershipGrant>[1];
  }

  it("writes and returns 'created' when the membership does not yet exist", () => {
    const tx = fakeTx();
    const ref = fakeRef();

    const outcome = applyMembershipGrant(tx, ref, false, record());

    expect(outcome).toBe("created");
    expect(tx.set).toHaveBeenCalledWith(ref, { ...record(), memberRef: expect.stringMatching(MEMBER_REF) });
  });

  it("gives each new membership its own fresh memberRef, independent of uid/team/e-mail", () => {
    const first = fakeTx();
    const second = fakeTx();

    applyMembershipGrant(first, fakeRef(), false, record());
    applyMembershipGrant(second, fakeRef(), false, record());

    const refOf = (tx: typeof first) =>
      (vi.mocked(tx.set).mock.calls[0][1] as { memberRef: string }).memberRef;
    expect(refOf(first)).toMatch(MEMBER_REF);
    expect(refOf(first)).not.toBe(refOf(second));
    expect(refOf(first)).not.toContain("user-1");
  });

  it("writes nothing and returns 'already_member' when the membership already exists", () => {
    const tx = fakeTx();
    const ref = fakeRef();

    const outcome = applyMembershipGrant(tx, ref, true, record());

    expect(outcome).toBe("already_member");
    expect(tx.set).not.toHaveBeenCalled();
  });
});
