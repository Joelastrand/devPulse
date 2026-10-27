import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { createFirestoreTeamEligibilityReader, ownerCanInvite, readGenuineActiveMembership } from "./team-eligibility";

const TEAM_ID = "team-alpha";
const OTHER_TEAM_ID = "team-beta";
const OWNER_UID = "owner-1";
const MEMBER_REF = "0123456789abcdefghjkmnpqrs";

function membershipDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { uid: OWNER_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: MEMBER_REF, ...overrides };
}

function state(overrides: Partial<FakeTeamEligibilityState> = {}): FakeTeamEligibilityState {
  return {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc() },
    ...overrides,
  };
}

describe("readGenuineActiveMembership", () => {
  it("treats an active member of an active team as eligible and returns the member reference", async () => {
    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(state()));

    expect(result).toEqual({ ok: true, memberRef: MEMBER_REF });
  });

  it("returns a null member reference for a legacy membership without one, and still treats it as eligible", async () => {
    const legacy = state({
      memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc({ memberRef: undefined }) },
    });

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(legacy));

    expect(result).toEqual({ ok: true, memberRef: null });
  });

  it("ignores the role field: a lead membership is eligible as an ordinary member", async () => {
    const lead = state({
      memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc({ role: "lead" }) },
    });

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(lead));

    expect(result.ok).toBe(true);
  });

  it.each([
    ["a disabled team", state({ teamStatus: { [TEAM_ID]: "disabled" } })],
    ["a missing team document", state({ teamStatus: {} })],
    ["a malformed team status", state({ teamStatus: { [TEAM_ID]: "Active" } })],
    ["a team status that is not a string", state({ teamStatus: { [TEAM_ID]: 1 } })],
    ["a missing membership", state({ memberships: {} })],
    [
      "a membership whose document uid belongs to another user",
      state({ memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc({ uid: "someone-else" }) } }),
    ],
    [
      "a membership whose document teamId belongs to another team",
      state({ memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc({ teamId: OTHER_TEAM_ID }) } }),
    ],
    [
      "a membership that exists only for another team",
      state({ memberships: { [`${OWNER_UID}__${OTHER_TEAM_ID}`]: membershipDoc({ teamId: OTHER_TEAM_ID }) } }),
    ],
  ])("is not eligible for %s", async (_label, fixture) => {
    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(fixture));

    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });

  it("does not let a membership of another team make an absent membership eligible", async () => {
    const fixture = state({
      teamStatus: { [TEAM_ID]: "active", [OTHER_TEAM_ID]: "active" },
      memberships: { [`${OWNER_UID}__${OTHER_TEAM_ID}`]: membershipDoc({ teamId: OTHER_TEAM_ID }) },
    });

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(fixture));

    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });

  it("does not consult app-admin status: a user with no membership is not eligible even on an active team", async () => {
    // The reader has no identity or admin input, so admin status cannot influence the decision by construction.
    const result = await readGenuineActiveMembership("app-admin-1", TEAM_ID, createFakeTeamEligibilityReader(state()));

    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });

  it.each([
    ["a disabled team", "disabled"],
    ["a missing team", undefined],
    ["a malformed status", 1],
    ["an unknown status", "suspended"],
    ["an empty status", ""],
  ])("does not read the membership at all for %s", async (_label, status) => {
    const getMembership = vi.fn(async () => membershipDoc());
    const reader = { getTeamStatus: async () => status, getMembership };

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, reader);

    expect(result).toEqual({ ok: false, error: "not_eligible" });
    expect(getMembership).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-opaque string", "not-a-ref"],
    ["an uppercase ref", MEMBER_REF.toUpperCase()],
    ["a non-string value", 42],
  ])("never passes a malformed memberRef (%s) through as a string", async (_label, rawRef) => {
    const malformed = state({
      memberships: { [`${OWNER_UID}__${TEAM_ID}`]: membershipDoc({ memberRef: rawRef }) },
    });

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(malformed));

    expect(result).toEqual({ ok: true, memberRef: null });
  });

  it("reports a team read failure as read_failed, never as not_eligible", async () => {
    const reader = createFakeTeamEligibilityReader(state({ failTeamRead: true }));

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, reader);

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports a membership read failure as read_failed, never as not_eligible", async () => {
    const reader = createFakeTeamEligibilityReader(state({ failMembershipRead: true }));

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, reader);

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("does not read the membership when the team read already fails", async () => {
    const getMembership = vi.fn(async () => membershipDoc());
    const reader = {
      getTeamStatus: async () => {
        throw new Error("unavailable");
      },
      getMembership,
    };

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, reader);

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(getMembership).not.toHaveBeenCalled();
  });
});

describe("ownerCanInvite", () => {
  it("allows an owner who holds an active genuine membership", async () => {
    const result = await ownerCanInvite(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(state()));

    expect(result).toEqual({ ok: true });
  });

  it("does not expose the member reference to the owner check", async () => {
    const result = await ownerCanInvite(OWNER_UID, TEAM_ID, createFakeTeamEligibilityReader(state()));

    expect(JSON.stringify(result)).not.toContain(MEMBER_REF);
  });

  it("refuses an owner who has left the team, without treating it as a read failure", async () => {
    const result = await ownerCanInvite(
      OWNER_UID,
      TEAM_ID,
      createFakeTeamEligibilityReader(state({ memberships: {} })),
    );

    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });

  it("refuses an owner on a disabled team", async () => {
    const result = await ownerCanInvite(
      OWNER_UID,
      TEAM_ID,
      createFakeTeamEligibilityReader(state({ teamStatus: { [TEAM_ID]: "disabled" } })),
    );

    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });

  it("keeps a read failure as read_failed", async () => {
    const result = await ownerCanInvite(
      OWNER_UID,
      TEAM_ID,
      createFakeTeamEligibilityReader(state({ failMembershipRead: true })),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("team eligibility module boundary", () => {
  const source = readFileSync(resolve(__dirname, "team-eligibility.ts"), "utf8");

  it("imports no authorization helper, no app-admin helper and no teams server module", () => {
    for (const forbidden of ["authorizeTeamAccess", "resolveTeamRole", "requireAppAdmin", "isAppAdmin", "teams/server"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("never reads the role field for a decision", () => {
    expect(source).not.toMatch(/\.role\b|\["role"\]|"role"/);
  });
});

const firestore = vi.hoisted(() => ({
  docs: {} as Record<string, unknown>,
  reads: [] as string[],
  fail: false,
}));

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const path = `${name}/${id}`;
          firestore.reads.push(path);
          if (firestore.fail) {
            throw new Error(`simulated Firestore failure at ${path}`);
          }
          const exists = path in firestore.docs;
          return { exists, data: () => firestore.docs[path] };
        },
      }),
    }),
  }),
}));

describe("production team eligibility reader", () => {
  it("reads the exact team and membership documents and decides eligibility from them", async () => {
    firestore.reads = [];
    firestore.fail = false;
    firestore.docs = {
      [`teams/${TEAM_ID}`]: { status: "active" },
      [`teamMemberships/${OWNER_UID}__${TEAM_ID}`]: membershipDoc(),
    };

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFirestoreTeamEligibilityReader());

    expect(result).toEqual({ ok: true, memberRef: MEMBER_REF });
    expect(firestore.reads).toEqual([`teams/${TEAM_ID}`, `teamMemberships/${OWNER_UID}__${TEAM_ID}`]);
  });

  it("reports a Firestore failure as read_failed, never as not_eligible", async () => {
    firestore.fail = true;

    const result = await readGenuineActiveMembership(OWNER_UID, TEAM_ID, createFirestoreTeamEligibilityReader());
    firestore.fail = false;

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});
