import { isMemberRef, memberRefOf } from "../../teams/domain/member-ref";
import { extractMemberUid } from "../../teams/domain/team-membership";
import { toPersistedParticipation, openParticipationDocument } from "../../team-projects/server/team-project-codec";
import { parseStoredParticipation } from "../../team-projects/domain/team-project-participation";
import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { DEMO_PARTICIPATIONS, participationInterval, type DemoParticipation } from "./fixtures";

/**
 * Pure planning for the fictional members' memberRef and their project participations (Phase D). It never reads or writes.
 * The runner supplies every observed document, so the same decisions run inside one Firestore transaction.
 *
 * memberRef: an absent value is materialized (a fresh CSPRNG handle, unique in the team); a valid value is kept as it is;
 * a malformed or duplicated value is a conflict. Nothing else on a membership is touched.
 *
 * Participations: an absent document is created; an existing document is skipped only when every domain field and the
 * decrypted note equal the fixture; anything else is a conflict. A project that is missing, archived, or belongs to another
 * team, or an interval that falls outside the project, is a conflict.
 */

export interface ObservedMember {
  /** Raw `teamMemberships/{uid}__{teamId}` document, or `undefined` when absent. */
  membership: unknown;
}

export interface ObservedProject {
  /** Stored project, opened: `teamId`, `archived`, `startDate`, `endDate`. `undefined` when absent, `null` when unreadable. */
  project: { teamId: string; archived: boolean; startDate: string; endDate: string } | null | undefined;
}

export interface ParticipationObservation {
  /** Raw `teamProjectParticipations/{id}` document, or `undefined` when absent. */
  raw: unknown;
}

export interface ParticipationPlanInput {
  teamId: string;
  members: ReadonlyMap<string, ObservedMember>;
  /** Every membership of the team, raw, for the memberRef uniqueness check. */
  teamMemberships: readonly unknown[];
  /** Members whose erasure record exists. Any such member is a conflict (BR-4(b) fence). */
  erasing: ReadonlySet<string>;
  projects: ReadonlyMap<string, ObservedProject>;
  participations: ReadonlyMap<string, ParticipationObservation>;
  fixtures?: readonly DemoParticipation[];
  createKey: () => string;
}

export type MemberRefAction = "keep" | "materialize" | "conflict";
export type ParticipationAction = "create" | "skip" | "conflict";

export interface MemberPlan {
  uid: string;
  action: MemberRefAction;
  /** The effective memberRef after this plan (kept or newly materialized). `null` on conflict. */
  memberRef: string | null;
  reason?: string;
}

export interface ParticipationPlan {
  participationId: string;
  projectId: string;
  uid: string;
  action: ParticipationAction;
  reason?: string;
  /** The exact domain fields the participation document must hold (plaintext note; sealed by the caller on write). */
  fields?: { teamId: string; projectId: string; memberRef: string; startDate: string; endDate: string; note: string; archived: false };
}

export interface ParticipationProvisioningPlan {
  members: MemberPlan[];
  participations: ParticipationPlan[];
  counts: { memberRef: Record<MemberRefAction, number>; participation: Record<ParticipationAction, number> };
  noConflicts: boolean;
}

const MEMBER_UIDS = DEMO_MEMBER_IDENTITIES.map((identity) => identity.uid);

function membershipOk(raw: unknown, uid: string, teamId: string): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return extractMemberUid(raw) === uid && r.teamId === teamId && r.role === undefined;
}

export function planParticipationProvisioning(input: ParticipationPlanInput): ParticipationProvisioningPlan {
  const fixtures = input.fixtures ?? DEMO_PARTICIPATIONS;

  // Refs already held by the team's memberships; a new ref must be unique against all of them and against the run's own.
  const held = new Set<string>();
  for (const raw of input.teamMemberships) {
    const ref = memberRefOf(raw);
    if (ref !== null) held.add(ref);
  }

  const memberPlans = new Map<string, MemberPlan>();
  for (const uid of MEMBER_UIDS) {
    const observed = input.members.get(uid);
    if (observed === undefined || observed.membership === undefined) {
      memberPlans.set(uid, { uid, action: "conflict", memberRef: null, reason: "membership-missing" });
      continue;
    }
    if (!membershipOk(observed.membership, uid, input.teamId)) {
      memberPlans.set(uid, { uid, action: "conflict", memberRef: null, reason: "membership-not-ordinary-member" });
      continue;
    }
    if (input.erasing.has(uid)) {
      memberPlans.set(uid, { uid, action: "conflict", memberRef: null, reason: "erasure-record-present" });
      continue;
    }
    const r = observed.membership as Record<string, unknown>;
    if (r.memberRef === undefined) {
      memberPlans.set(uid, { uid, action: "materialize", memberRef: "" });
      continue;
    }
    if (!isMemberRef(r.memberRef)) {
      memberPlans.set(uid, { uid, action: "conflict", memberRef: null, reason: "member-ref-malformed" });
      continue;
    }
    const duplicated = input.teamMemberships.filter((raw) => memberRefOf(raw) === r.memberRef).length > 1;
    if (duplicated) {
      memberPlans.set(uid, { uid, action: "conflict", memberRef: null, reason: "member-ref-duplicated" });
      continue;
    }
    memberPlans.set(uid, { uid, action: "keep", memberRef: r.memberRef });
  }

  // Materialize only after every kept ref is in `held`, so a fresh value can never collide with an existing one.
  for (const uid of MEMBER_UIDS) {
    const plan = memberPlans.get(uid);
    if (plan === undefined || plan.action !== "materialize") continue;
    let ref = input.createKey();
    while (held.has(ref)) ref = input.createKey();
    held.add(ref);
    memberPlans.set(uid, { uid, action: "materialize", memberRef: ref });
  }

  const participationPlans: ParticipationPlan[] = fixtures.map((fixture) => {
    const base = { participationId: fixture.participationId, projectId: fixture.projectId, uid: fixture.uid };
    const member = memberPlans.get(fixture.uid);
    if (member === undefined || member.action === "conflict" || member.memberRef === null) {
      return { ...base, action: "conflict", reason: "member-not-ready" };
    }
    const observedProject = input.projects.get(fixture.projectId);
    if (observedProject === undefined || observedProject.project === undefined) {
      return { ...base, action: "conflict", reason: "project-missing" };
    }
    if (observedProject.project === null) {
      return { ...base, action: "conflict", reason: "project-unreadable" };
    }
    const project = observedProject.project;
    if (project.teamId !== input.teamId) return { ...base, action: "conflict", reason: "project-other-team" };
    if (project.archived) return { ...base, action: "conflict", reason: "project-archived" };
    const interval = participationInterval(fixture, project);
    if (interval === null) return { ...base, action: "conflict", reason: "interval-outside-project" };

    const fields = {
      teamId: input.teamId,
      projectId: fixture.projectId,
      memberRef: member.memberRef,
      startDate: interval.startDate,
      endDate: interval.endDate,
      note: fixture.note,
      archived: false as const,
    };

    const existing = input.participations.get(fixture.participationId)?.raw;
    if (existing === undefined) return { ...base, action: "create", fields };
    return matchesFixture(existing, fixture.participationId, fields)
      ? { ...base, action: "skip", fields }
      : { ...base, action: "conflict", reason: "participation-differs", fields };
  });

  const memberList = [...memberPlans.values()];
  const counts: ParticipationProvisioningPlan["counts"] = {
    memberRef: { keep: 0, materialize: 0, conflict: 0 },
    participation: { create: 0, skip: 0, conflict: 0 },
  };
  for (const m of memberList) counts.memberRef[m.action] += 1;
  for (const p of participationPlans) counts.participation[p.action] += 1;
  const noConflicts = counts.memberRef.conflict === 0 && counts.participation.conflict === 0;
  return { members: memberList, participations: participationPlans, counts, noConflicts };
}

/** Compares a stored participation with the fixture on every domain field and the decrypted note. Never throws. */
function matchesFixture(
  raw: unknown,
  participationId: string,
  fields: NonNullable<ParticipationPlan["fields"]>,
): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const stored = raw as Record<string, unknown>;
  if ("deletedAt" in stored) return false;
  // The note is sealed, so the document is opened first (as production reads do) and only then parsed.
  const opened = openParticipationDocument(participationId, stored);
  const parsed = parseStoredParticipation(opened, participationId, fields.teamId);
  if (parsed === null) return false;
  if (parsed.projectId !== fields.projectId || parsed.memberRef !== fields.memberRef) return false;
  if (parsed.startDate !== fields.startDate || parsed.endDate !== fields.endDate || parsed.archived !== false) return false;
  return parsed.note === fields.note;
}

/** The exact document a participation create writes: the sealed note is produced by the codec, never stored in plaintext. */
export function participationDocumentFor(
  participationId: string,
  fields: NonNullable<ParticipationPlan["fields"]>,
): Record<string, unknown> {
  const { note, ...rest } = fields;
  return toPersistedParticipation(participationId, { ...rest, note });
}
