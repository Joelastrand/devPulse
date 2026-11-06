import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { effectiveTeamVisibility } from "../domain/team-authority";
import { isValidTeamStatus } from "../domain/team";

const TEAMS_COLLECTION = "teams";

/**
 * The only shape an anonymous visitor ever receives for a team (docs/features/teamadmin-and-team-visibility/SPEC.md).
 * It is an explicit projection built field by field: no member data, no visibility or status fields, no timestamps,
 * no audit fields, and no content that requires a competence-consent or coverage decision.
 */
export interface PublicTeamView {
  teamId: string;
  name: string;
}

export type GetPublicTeamResult =
  | { ok: true; team: PublicTeamView }
  | { ok: false; error: "not_found" | "read_failed" };

/** Raw, unvalidated document read. Test seam; production reads `teams/{teamId}` through the Admin SDK. */
export interface PublicTeamReader {
  getTeam(teamId: string): Promise<unknown>;
}

export interface GetPublicTeamDeps {
  reader?: PublicTeamReader;
}

function getDefaultReader(): PublicTeamReader {
  return {
    async getTeam(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * Anonymous read of one team. Returns a team only when it exists, its status is exactly `active`, its persisted
 * visibility is exactly `public` (a missing or malformed value is private), and the name is a non-empty string. Every
 * other case, including a private team, a disabled team and an unknown id, is the same `not_found`, so a private team
 * cannot be discovered. Read failures are never reported as `not_found`.
 */
export async function getPublicTeam(teamId: string, deps: GetPublicTeamDeps = {}): Promise<GetPublicTeamResult> {
  if (typeof teamId !== "string" || teamId.length === 0 || teamId.includes("/")) {
    return { ok: false, error: "not_found" };
  }

  const reader = deps.reader ?? getDefaultReader();
  let raw: unknown;
  try {
    raw = await reader.getTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  if (typeof raw !== "object" || raw === null) return { ok: false, error: "not_found" };
  const record = raw as Record<string, unknown>;
  if (!isValidTeamStatus(record.status) || record.status !== "active") return { ok: false, error: "not_found" };
  if (effectiveTeamVisibility(record.visibility) !== "public") return { ok: false, error: "not_found" };
  if (typeof record.name !== "string" || record.name.trim().length === 0) return { ok: false, error: "not_found" };

  return { ok: true, team: { teamId, name: record.name } };
}
