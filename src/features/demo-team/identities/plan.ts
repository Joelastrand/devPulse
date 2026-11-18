import { membershipDocId } from "../../teams/domain/team-membership";
import { IDENTITY_AUDIT_ACTOR, type DemoMemberIdentity } from "./fixtures";

/**
 * Pure classification for the fictional-member provisioning (Phase C, step 2). Given what is observed in Firebase Auth
 * and Firestore, it decides per record: `create` (absent, safe to write), `skip` (already exactly the fixture — an
 * idempotent rerun or a resumed run), or `conflict` (anything else: fail closed, never overwrite). It never writes and
 * never throws. Conflict reasons are fixed categories; no observed value is echoed.
 */

export type ProvisionAction = "create" | "skip" | "conflict";

export interface ProvisionDecision {
  action: ProvisionAction;
  /** Fixed category, present only for `conflict`. */
  reason?: string;
}

/** The observed state of one Firebase Auth account, reduced to the fields the decision depends on. */
export interface ObservedAuthAccount {
  uid: string;
  email: string | null;
  disabled: boolean;
  hasPassword: boolean;
  hasCustomClaims: boolean;
  providerCount: number;
}

/** What the runner observed for one fictional member, before any write. */
export interface ObservedIdentity {
  /** Auth account with this uid, or `null` when absent. */
  accountById: ObservedAuthAccount | null;
  /** Auth account with this e-mail, or `null` when absent. */
  accountByMail: ObservedAuthAccount | null;
  /** Raw `teamMemberships/{uid}__{teamId}` data, or `undefined` when absent. */
  membershipRaw: unknown;
  /** Opened `userProfiles/{uid}` display name: a string, `undefined` when absent, `null` when unreadable. */
  profileName: string | null | undefined;
}

export function classifyAuth(identity: DemoMemberIdentity, observed: ObservedIdentity): ProvisionDecision {
  const { accountById, accountByMail } = observed;

  if (accountByMail !== null && accountByMail.uid !== identity.uid) {
    return { action: "conflict", reason: "email-owned-by-other-account" };
  }
  if (accountById === null) {
    return accountByMail === null ? { action: "create" } : { action: "conflict", reason: "email-lookup-inconsistent" };
  }
  if (accountById.uid !== identity.uid) return { action: "conflict", reason: "uid-mismatch" };
  if (accountById.email?.toLowerCase() !== identity.email) return { action: "conflict", reason: "email-mismatch" };
  if (accountByMail === null) return { action: "conflict", reason: "email-lookup-inconsistent" };
  if (!accountById.disabled) return { action: "conflict", reason: "account-enabled" };
  if (accountById.hasPassword) return { action: "conflict", reason: "password-set" };
  if (accountById.hasCustomClaims) return { action: "conflict", reason: "custom-claims-set" };
  if (accountById.providerCount > 0) return { action: "conflict", reason: "federated-provider-linked" };
  return { action: "skip" };
}

/** `teamMemberships` document exactly as the fixture writes it. Any other shape (including a team role) is a conflict. */
export function classifyMembership(identity: DemoMemberIdentity, teamId: string, raw: unknown): ProvisionDecision {
  if (raw === undefined) return { action: "create" };
  if (typeof raw !== "object" || raw === null) return { action: "conflict", reason: "membership-malformed" };
  const record = raw as Record<string, unknown>;
  const matches =
    record.uid === identity.uid &&
    record.teamId === teamId &&
    record.createdVia === "admin_direct" &&
    record.grantedBy === IDENTITY_AUDIT_ACTOR &&
    record.role === undefined;
  return matches ? { action: "skip" } : { action: "conflict", reason: "membership-differs" };
}

/** `userProfiles/{uid}` whose opened display name equals the fixture name. */
export function classifyProfile(identity: DemoMemberIdentity, profileName: string | null | undefined): ProvisionDecision {
  if (profileName === undefined) return { action: "create" };
  if (profileName === null) return { action: "conflict", reason: "profile-unreadable" };
  return profileName === identity.fullName ? { action: "skip" } : { action: "conflict", reason: "profile-name-differs" };
}

/** The team the fixtures join must exist and the presenter must already be its teamadmin. Fail closed otherwise. */
export function verifyTargetTeam(input: {
  teamId: string;
  presenterUid: string;
  teamExists: boolean;
  presenterMembershipRaw: unknown;
}): { ok: true } | { ok: false; reason: "team-missing" | "presenter-not-teamadmin" } {
  if (!input.teamExists) return { ok: false, reason: "team-missing" };
  const raw = input.presenterMembershipRaw;
  const isTeamAdmin =
    typeof raw === "object" &&
    raw !== null &&
    (raw as Record<string, unknown>).uid === input.presenterUid &&
    (raw as Record<string, unknown>).teamId === input.teamId &&
    (raw as Record<string, unknown>).role === "teamadmin";
  return isTeamAdmin ? { ok: true } : { ok: false, reason: "presenter-not-teamadmin" };
}

export interface IdentityItemPlan {
  uid: string;
  auth: ProvisionDecision;
  membership: ProvisionDecision;
  profile: ProvisionDecision;
}

export interface IdentityProvisioningPlan {
  items: IdentityItemPlan[];
  counts: Record<"auth" | "membership" | "profile", Record<ProvisionAction, number>>;
  /** `true` only when no record is in conflict. A plan with conflicts is never written. */
  noConflicts: boolean;
}

/** Classifies every fictional member. `observed` is keyed by uid and must cover every identity. */
export function planIdentityProvisioning(input: {
  identities: readonly DemoMemberIdentity[];
  teamId: string;
  observed: ReadonlyMap<string, ObservedIdentity>;
}): IdentityProvisioningPlan {
  const counts: IdentityProvisioningPlan["counts"] = {
    auth: { create: 0, skip: 0, conflict: 0 },
    membership: { create: 0, skip: 0, conflict: 0 },
    profile: { create: 0, skip: 0, conflict: 0 },
  };

  const items = input.identities.map((identity): IdentityItemPlan => {
    const observed = input.observed.get(identity.uid);
    if (observed === undefined) {
      const missing: ProvisionDecision = { action: "conflict", reason: "not-observed" };
      counts.auth.conflict += 1;
      counts.membership.conflict += 1;
      counts.profile.conflict += 1;
      return { uid: identity.uid, auth: missing, membership: missing, profile: missing };
    }
    const item: IdentityItemPlan = {
      uid: identity.uid,
      auth: classifyAuth(identity, observed),
      membership: classifyMembership(identity, input.teamId, observed.membershipRaw),
      profile: classifyProfile(identity, observed.profileName),
    };
    counts.auth[item.auth.action] += 1;
    counts.membership[item.membership.action] += 1;
    counts.profile[item.profile.action] += 1;
    return item;
  });

  const noConflicts = counts.auth.conflict + counts.membership.conflict + counts.profile.conflict === 0;
  return { items, counts, noConflicts };
}

/** Document path for a membership of a fictional member in the target team. */
export function identityMembershipPath(uid: string, teamId: string): string {
  return `teamMemberships/${membershipDocId(uid, teamId)}`;
}
