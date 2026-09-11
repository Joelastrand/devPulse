export type TeamStatus = "active" | "disabled";

const TEAM_STATUSES: readonly TeamStatus[] = ["active", "disabled"];

/**
 * Runtime-validates a raw Firestore field value as a `TeamStatus` before
 * it drives an authorization decision (`authorize-team-access.ts`) —
 * never trusted via an unchecked cast. Returns `false` (fail closed,
 * never throws) for `undefined` (a nonexistent `teams` document — Firestore
 * returns `undefined` for a missing field) and for any other
 * malformed/unrecognized value.
 */
export function isValidTeamStatus(value: unknown): value is TeamStatus {
  return (
    typeof value === "string" &&
    (TEAM_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * A Firestore `teams` document. `teamId` is a stable, server-generated,
 * opaque identifier (a Firestore auto-generated document ID) — never
 * derived from `name` (docs/features/team-management/SPEC.md —
 * Architecture decisions → "Team identifier scheme").
 */
export interface Team {
  teamId: string;
  name: string;
  status: TeamStatus;
  createdAt: Date;
  createdBy: string;
}
