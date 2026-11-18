import { describe, expect, it } from "vitest";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership, type DemoMemberIdentity } from "./fixtures";
import {
  classifyAuth,
  classifyMembership,
  classifyProfile,
  planIdentityProvisioning,
  verifyTargetTeam,
  type ObservedAuthAccount,
  type ObservedIdentity,
} from "./plan";

const TEAM = "8yB2bS8Jav69TCfDETON";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const AS_OF = new Date("2026-11-14T00:00:00.000Z");
const ID = DEMO_MEMBER_IDENTITIES[0];

function matchingAuth(overrides: Partial<ObservedAuthAccount> = {}): ObservedAuthAccount {
  return {
    uid: ID.uid,
    email: ID.email,
    disabled: true,
    hasPassword: false,
    hasCustomClaims: false,
    providerCount: 0,
    ...overrides,
  };
}

function absentObservation(): ObservedIdentity {
  return { accountById: null, accountByMail: null, membershipRaw: undefined, profileName: undefined };
}

function matchingObservation(identity: DemoMemberIdentity = ID): ObservedIdentity {
  const auth = matchingAuth({ uid: identity.uid, email: identity.email });
  return {
    accountById: auth,
    accountByMail: auth,
    membershipRaw: buildIdentityMembership(identity, TEAM, AS_OF),
    profileName: identity.fullName,
  };
}

describe("classifyAuth", () => {
  it("creates an account only when neither the uid nor the e-mail exists", () => {
    expect(classifyAuth(ID, absentObservation())).toEqual({ action: "create" });
  });

  it("skips an exact disabled match (idempotent rerun or resumed run)", () => {
    expect(classifyAuth(ID, matchingObservation())).toEqual({ action: "skip" });
  });

  it("conflicts on an enabled account, a password, custom claims, a linked provider or a mismatched e-mail", () => {
    const cases: Array<[Partial<ObservedAuthAccount>, string]> = [
      [{ disabled: false }, "account-enabled"],
      [{ hasPassword: true }, "password-set"],
      [{ hasCustomClaims: true }, "custom-claims-set"],
      [{ providerCount: 1 }, "federated-provider-linked"],
      [{ email: "other@example.com" }, "email-mismatch"],
    ];
    for (const [overrides, reason] of cases) {
      const observed = { ...matchingObservation(), accountById: matchingAuth(overrides), accountByMail: matchingAuth(overrides) };
      expect(classifyAuth(ID, observed)).toEqual({ action: "conflict", reason });
    }
  });

  it("never reuses an e-mail owned by a different account", () => {
    const observed = { ...absentObservation(), accountByMail: matchingAuth({ uid: "someone-else" }) };
    expect(classifyAuth(ID, observed)).toEqual({ action: "conflict", reason: "email-owned-by-other-account" });
  });

  it("conflicts when the uid exists but the e-mail lookup disagrees", () => {
    expect(classifyAuth(ID, { ...absentObservation(), accountById: matchingAuth() })).toEqual({
      action: "conflict",
      reason: "email-lookup-inconsistent",
    });
  });
});

describe("classifyMembership", () => {
  it("creates when absent, skips the exact fixture, and conflicts on any other shape", () => {
    expect(classifyMembership(ID, TEAM, undefined)).toEqual({ action: "create" });
    expect(classifyMembership(ID, TEAM, buildIdentityMembership(ID, TEAM, AS_OF))).toEqual({ action: "skip" });
    expect(classifyMembership(ID, TEAM, { ...buildIdentityMembership(ID, TEAM, AS_OF), role: "teamadmin" }).action).toBe("conflict");
    expect(classifyMembership(ID, TEAM, buildIdentityMembership(ID, "other-team", AS_OF)).action).toBe("conflict");
    expect(classifyMembership(ID, TEAM, "not-an-object").action).toBe("conflict");
  });
});

describe("classifyProfile", () => {
  it("creates when absent, skips the same name, conflicts on a different or unreadable name", () => {
    expect(classifyProfile(ID, undefined)).toEqual({ action: "create" });
    expect(classifyProfile(ID, ID.fullName)).toEqual({ action: "skip" });
    expect(classifyProfile(ID, "Someone Else")).toEqual({ action: "conflict", reason: "profile-name-differs" });
    expect(classifyProfile(ID, null)).toEqual({ action: "conflict", reason: "profile-unreadable" });
  });
});

describe("verifyTargetTeam", () => {
  const admin = { uid: PRESENTER, teamId: TEAM, role: "teamadmin" };

  it("accepts an existing team whose presenter is its teamadmin", () => {
    expect(verifyTargetTeam({ teamId: TEAM, presenterUid: PRESENTER, teamExists: true, presenterMembershipRaw: admin })).toEqual({ ok: true });
  });

  it("refuses a missing team or a presenter without the teamadmin role", () => {
    expect(verifyTargetTeam({ teamId: TEAM, presenterUid: PRESENTER, teamExists: false, presenterMembershipRaw: admin })).toEqual({
      ok: false,
      reason: "team-missing",
    });
    expect(
      verifyTargetTeam({ teamId: TEAM, presenterUid: PRESENTER, teamExists: true, presenterMembershipRaw: { ...admin, role: undefined } }),
    ).toEqual({ ok: false, reason: "presenter-not-teamadmin" });
  });
});

describe("planIdentityProvisioning", () => {
  function observedFor(build: (uid: string) => ObservedIdentity): Map<string, ObservedIdentity> {
    return new Map(DEMO_MEMBER_IDENTITIES.map((i) => [i.uid, build(i.uid)]));
  }

  it("is a clean no-op on rerun once every record matches", () => {
    const plan = planIdentityProvisioning({
      identities: DEMO_MEMBER_IDENTITIES,
      teamId: TEAM,
      observed: observedFor((uid) => matchingObservation(DEMO_MEMBER_IDENTITIES.find((i) => i.uid === uid)!)),
    });
    expect(plan.noConflicts).toBe(true);
    expect(plan.counts.auth).toEqual({ create: 0, skip: 10, conflict: 0 });
    expect(plan.counts.membership).toEqual({ create: 0, skip: 10, conflict: 0 });
    expect(plan.counts.profile).toEqual({ create: 0, skip: 10, conflict: 0 });
  });

  it("creates only the missing records after a partial run and skips the rest", () => {
    const plan = planIdentityProvisioning({
      identities: DEMO_MEMBER_IDENTITIES,
      teamId: TEAM,
      observed: observedFor((uid) => {
        const identity = DEMO_MEMBER_IDENTITIES.find((i) => i.uid === uid);
        return uid <= "demo-member-03" && identity !== undefined ? matchingObservation(identity) : absentObservation();
      }),
    });
    expect(plan.noConflicts).toBe(true);
    expect(plan.counts.auth).toEqual({ create: 7, skip: 3, conflict: 0 });
    expect(plan.counts.membership).toEqual({ create: 7, skip: 3, conflict: 0 });
    expect(plan.counts.profile).toEqual({ create: 7, skip: 3, conflict: 0 });
  });

  it("blocks the whole plan when a single record conflicts", () => {
    const observed = observedFor(() => absentObservation());
    observed.set(ID.uid, { ...absentObservation(), membershipRaw: { uid: ID.uid, teamId: TEAM, role: "teamadmin" } });
    const plan = planIdentityProvisioning({ identities: DEMO_MEMBER_IDENTITIES, teamId: TEAM, observed });
    expect(plan.noConflicts).toBe(false);
    expect(plan.counts.membership.conflict).toBe(1);
  });

  it("treats an identity that was not observed as a conflict, never as a create", () => {
    const plan = planIdentityProvisioning({ identities: DEMO_MEMBER_IDENTITIES, teamId: TEAM, observed: new Map() });
    expect(plan.noConflicts).toBe(false);
    expect(plan.counts.auth.create).toBe(0);
  });
});
