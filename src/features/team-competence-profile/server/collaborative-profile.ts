import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";
import { COMPETENCE_AREAS_PER_TEAM_MAX, competenceAreaDocId } from "../../team-competence-catalog/domain/competence-area";
import {
  requireGenuineMember,
  requireTeamAdministrator,
  type GenuineMembershipDeps,
} from "./genuine-membership";
import {
  COLLABORATIVE_LEVELS_COLLECTION,
  PROFILE_SETTINGS_COLLECTION,
  collaborativeLevelDocId,
  isValidCollaborativeLevel,
  isValidProfileSettings,
  parseCollaborativeLevelBody,
  parseProfileSettingsBody,
  type CollaborativeLevelRecord,
  type ProfileSettingsRecord,
} from "../domain/collaborative-records";
import { DEFAULT_PROFILE_MODE, type ProfileMode } from "../domain/collaborative-profile";
import type { SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";

const COMPETENCE_AREAS_COLLECTION = "teamCompetenceAreas";

/** Team-readable values only: a mode and integer team levels. No uid, no member data, no counts. */
export interface TeamProfileView {
  mode: ProfileMode;
  levels: Array<{ treeId: string; level: SelfAssessedLevel }>;
}

export type CollaborativeProfileError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "not_found"
  | "read_failed"
  | "persistence_failed";

export type CollaborativeProfileResult<T> = ({ ok: true } & T) | { ok: false; error: CollaborativeProfileError };

export interface RawDoc {
  id: string;
  data: unknown;
}

/**
 * Persistence seam. It has no method that reads member data, skill profiles or participation records. The collaborative
 * level write checks the assignment status and writes in one transaction, so an archived area cannot receive a value.
 */
export interface CollaborativeProfileStore {
  getSettings(teamId: string): Promise<unknown>;
  setSettings(teamId: string, record: ProfileSettingsRecord): Promise<void>;
  listLevels(teamId: string, limit: number): Promise<RawDoc[]>;
  writeLevelIfActiveArea(
    teamId: string,
    treeId: string,
    record: CollaborativeLevelRecord | null,
  ): Promise<"written" | "area_not_active">;
}

export interface CollaborativeProfileDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  membership?: GenuineMembershipDeps;
  store?: CollaborativeProfileStore;
  now?: () => Date;
}

function mapDates(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  if (typeof out.updatedAt === "object" && out.updatedAt !== null && "toDate" in out.updatedAt) {
    out.updatedAt = (out.updatedAt as { toDate(): Date }).toDate();
  }
  return out;
}

function getDefaultStore(db: () => Firestore = getFirestoreDb): CollaborativeProfileStore {
  return {
    async getSettings(teamId) {
      const snapshot = await db().collection(PROFILE_SETTINGS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? mapDates(snapshot.data()) : undefined;
    },
    async setSettings(teamId, record) {
      await db().collection(PROFILE_SETTINGS_COLLECTION).doc(teamId).set(record);
    },
    async listLevels(teamId, limit) {
      const snapshot = await db().collection(COLLABORATIVE_LEVELS_COLLECTION).where("teamId", "==", teamId).limit(limit).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data()) }));
    },
    writeLevelIfActiveArea(teamId, treeId, record) {
      const firestore = db();
      return firestore.runTransaction(async (tx) => {
        const area = await tx.get(firestore.collection(COMPETENCE_AREAS_COLLECTION).doc(competenceAreaDocId(teamId, treeId)));
        if (!area.exists || area.data()?.status !== "active") return "area_not_active" as const;
        const ref = firestore.collection(COLLABORATIVE_LEVELS_COLLECTION).doc(collaborativeLevelDocId(teamId, treeId));
        if (record === null) tx.delete(ref);
        else tx.set(ref, record);
        return "written" as const;
      });
    },
  };
}

export function createCollaborativeProfile(deps: CollaborativeProfileDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const store = () => deps.store ?? getDefaultStore();

  /** Any authenticated genuine member of an active team (teamadmins and superadmins included). */
  async function gate(
    idToken: string,
    teamId: string,
    authorize: typeof requireGenuineMember | typeof requireTeamAdministrator,
  ): Promise<{ ok: true } | { ok: false; error: CollaborativeProfileError }> {
    const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
    if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
    const result = await authorize(verified.identity, teamId, deps.membership);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
  }

  /** Mode and team levels for any genuine member. Missing mode defaults to automatic; any invalid stored value fails. */
  async function getTeamProfile(idToken: string, teamId: string): Promise<CollaborativeProfileResult<TeamProfileView>> {
    const access = await gate(idToken, teamId, requireGenuineMember);
    if (!access.ok) return access;
    try {
      const rawSettings = await store().getSettings(teamId);
      let mode: ProfileMode = DEFAULT_PROFILE_MODE;
      if (rawSettings !== undefined) {
        if (!isValidProfileSettings(rawSettings, teamId)) return { ok: false, error: "read_failed" };
        mode = rawSettings.mode;
      }

      const raw = await store().listLevels(teamId, COMPETENCE_AREAS_PER_TEAM_MAX + 1);
      if (raw.length > COMPETENCE_AREAS_PER_TEAM_MAX) return { ok: false, error: "read_failed" };
      const levels: TeamProfileView["levels"] = [];
      for (const doc of raw) {
        if (!isValidCollaborativeLevel(doc.data, doc.id)) return { ok: false, error: "read_failed" };
        levels.push({ treeId: doc.data.treeId, level: doc.data.level });
      }
      return { ok: true, mode, levels };
    } catch {
      return { ok: false, error: "read_failed" };
    }
  }

  /** Teamadmin only. Authorization runs before the body is read, so a non-admin learns nothing from the payload. */
  async function setTeamProfileMode(
    idToken: string,
    teamId: string,
    body: unknown,
  ): Promise<CollaborativeProfileResult<{ mode: ProfileMode }>> {
    const access = await gate(idToken, teamId, requireTeamAdministrator);
    if (!access.ok) return access;
    const parsed = parseProfileSettingsBody(body);
    if (!parsed.ok) return parsed;
    try {
      await store().setSettings(teamId, { teamId, mode: parsed.value.mode, updatedAt: now() });
      return { ok: true, mode: parsed.value.mode };
    } catch {
      return { ok: false, error: "persistence_failed" };
    }
  }

  /**
   * Teamadmin only, for one active competence area. The value is entered by hand and is independent of member
   * assessments: nothing here reads a profile or a participation record, and the mode is not consulted, so the value
   * is kept when the mode changes. `level: null` clears the team value.
   */
  async function setCollaborativeLevel(
    idToken: string,
    teamId: string,
    treeId: string,
    body: unknown,
  ): Promise<CollaborativeProfileResult<{ treeId: string; level: SelfAssessedLevel | null }>> {
    const access = await gate(idToken, teamId, requireTeamAdministrator);
    if (!access.ok) return access;
    if (!isWellFormedTreeId(treeId)) return { ok: false, error: "invalid_input" };
    const parsed = parseCollaborativeLevelBody(body);
    if (!parsed.ok) return parsed;
    const { level } = parsed.value;
    try {
      const record: CollaborativeLevelRecord | null = level === null ? null : { teamId, treeId, level, updatedAt: now() };
      const outcome = await store().writeLevelIfActiveArea(teamId, treeId, record);
      if (outcome === "area_not_active") return { ok: false, error: "not_found" };
      return { ok: true, treeId, level };
    } catch {
      return { ok: false, error: "persistence_failed" };
    }
  }

  return { getTeamProfile, setTeamProfileMode, setCollaborativeLevel };
}

export const collaborativeProfile = createCollaborativeProfile();
