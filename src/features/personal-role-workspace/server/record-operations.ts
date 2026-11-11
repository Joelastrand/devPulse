import "server-only";
import { achievementSchema, type AchievementContent } from "../domain/achievement";
import type { RecordCollection } from "../domain/record-schema";
import { responsibilitySchema, type ResponsibilityContent } from "../domain/responsibility";
import { getDefaultPersonalRecordStore, type PersonalRecordStore } from "./personal-record-store";
import { createRecord, deleteRecord, listRecords, updateRecord, type LinkChecker, type RecordError, type RecordListItem, type RecordListResult } from "./record-engine";
import { ownedGoalExists } from "./owned-goal-reader";

/**
 * Owner-only operations on responsibilities and achievements (SPEC BR-10 to BR-24; SECURITY.md PR-SI-1, PR-SI-5, PR-SI-6).
 * Every operation takes the verified owner uid as its first argument. No operation accepts a uid from a request.
 * Any unexpected store failure is reported as `persistence_failed`, never as a stack trace or raw error.
 */

export interface PersonalRecordDeps {
  store: PersonalRecordStore;
  goalExists: (ownerUid: string, goalId: string) => Promise<boolean>;
  clock: () => Date;
}

export function productionPersonalRecordDeps(): PersonalRecordDeps {
  return { store: getDefaultPersonalRecordStore(), goalExists: ownedGoalExists, clock: () => new Date() };
}

export type ResponsibilityDto = Record<string, unknown>;
export type AchievementDto = Record<string, unknown>;

async function allGoalsExist(deps: PersonalRecordDeps, ownerUid: string, goalIds: readonly string[]): Promise<boolean> {
  for (const goalId of goalIds) {
    if (!(await deps.goalExists(ownerUid, goalId))) return false;
  }
  return true;
}

function responsibilityLinks(deps: PersonalRecordDeps): LinkChecker<ResponsibilityContent> {
  return (ownerUid, content) => allGoalsExist(deps, ownerUid, content.goalIds);
}

function achievementLinks(deps: PersonalRecordDeps): LinkChecker<AchievementContent> {
  return async (ownerUid, content) => {
    if (!(await allGoalsExist(deps, ownerUid, content.goalIds))) return false;
    for (const responsibilityId of content.responsibilityIds) {
      if (!(await deps.store.exists(ownerUid, "responsibilities", responsibilityId))) return false;
    }
    return true;
  };
}

async function guarded<T>(work: () => Promise<T>): Promise<T | { ok: false; error: "persistence_failed" }> {
  try {
    return await work();
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

export function listResponsibilities(ownerUid: string, deps: PersonalRecordDeps) {
  return guarded(async () => {
    const result = await listRecords({ store: deps.store, checkLinks: responsibilityLinks(deps), clock: deps.clock }, ownerUid, responsibilitySchema, responsibilitySchema.toDto);
    return result.ok ? { ok: true as const, result: result.result as RecordListResult<ResponsibilityDto> } : result;
  });
}

export function createResponsibility(ownerUid: string, raw: Record<string, unknown>, deps: PersonalRecordDeps): Promise<{ ok: true; dto: ResponsibilityDto } | { ok: false; error: RecordError }> {
  return guarded(() => createRecord({ store: deps.store, checkLinks: responsibilityLinks(deps), clock: deps.clock }, ownerUid, responsibilitySchema, raw, responsibilitySchema.toDto));
}

export function updateResponsibility(ownerUid: string, id: string, patch: Record<string, unknown>, deps: PersonalRecordDeps): Promise<{ ok: true; dto: ResponsibilityDto } | { ok: false; error: RecordError }> {
  return guarded(() => updateRecord({ store: deps.store, checkLinks: responsibilityLinks(deps), clock: deps.clock }, ownerUid, responsibilitySchema, id, patch, responsibilitySchema.toDto));
}

export function deleteResponsibility(ownerUid: string, id: string, deps: PersonalRecordDeps): Promise<{ ok: true } | { ok: false; error: RecordError }> {
  return guarded(() => deleteRecord(deps.store, ownerUid, "responsibilities" satisfies RecordCollection, id));
}

/**
 * Lists achievements and marks each link that no longer resolves (SPEC BR-22, E-2, E-3). The stored link ids are kept
 * unchanged; the marker is computed on read and lists only ids the owner already holds. A missing link never fails the list.
 */
export function listAchievements(ownerUid: string, deps: PersonalRecordDeps) {
  return guarded(async () => {
    const result = await listRecords({ store: deps.store, checkLinks: achievementLinks(deps), clock: deps.clock }, ownerUid, achievementSchema, achievementSchema.toDto);
    if (!result.ok) return result;
    const checked = new Map<string, boolean>();
    const resolves = async (key: string, check: () => Promise<boolean>) => {
      const known = checked.get(key);
      if (known !== undefined) return known;
      const value = await check();
      checked.set(key, value);
      return value;
    };
    const items: RecordListItem<AchievementDto>[] = [];
    for (const item of result.result.items) {
      if (item.kind !== "record") {
        items.push(item);
        continue;
      }
      const dto = item.dto as AchievementDto & { goalIds: string[]; responsibilityIds: string[] };
      const missingGoalIds: string[] = [];
      for (const goalId of dto.goalIds) {
        if (!(await resolves(`goal:${goalId}`, () => deps.goalExists(ownerUid, goalId)))) missingGoalIds.push(goalId);
      }
      const missingResponsibilityIds: string[] = [];
      for (const responsibilityId of dto.responsibilityIds) {
        if (!(await resolves(`responsibility:${responsibilityId}`, () => deps.store.exists(ownerUid, "responsibilities", responsibilityId)))) {
          missingResponsibilityIds.push(responsibilityId);
        }
      }
      items.push({ kind: "record", dto: { ...dto, missingLinks: { goalIds: missingGoalIds, responsibilityIds: missingResponsibilityIds } } });
    }
    return { ok: true as const, result: { items, truncated: result.result.truncated } };
  });
}

export function createAchievement(ownerUid: string, raw: Record<string, unknown>, deps: PersonalRecordDeps): Promise<{ ok: true; dto: AchievementDto } | { ok: false; error: RecordError }> {
  return guarded(() => createRecord({ store: deps.store, checkLinks: achievementLinks(deps), clock: deps.clock }, ownerUid, achievementSchema, raw, achievementSchema.toDto));
}

export function updateAchievement(ownerUid: string, id: string, patch: Record<string, unknown>, deps: PersonalRecordDeps): Promise<{ ok: true; dto: AchievementDto } | { ok: false; error: RecordError }> {
  return guarded(() => updateRecord({ store: deps.store, checkLinks: achievementLinks(deps), clock: deps.clock }, ownerUid, achievementSchema, id, patch, achievementSchema.toDto));
}

export function deleteAchievement(ownerUid: string, id: string, deps: PersonalRecordDeps): Promise<{ ok: true } | { ok: false; error: RecordError }> {
  return guarded(() => deleteRecord(deps.store, ownerUid, "achievements" satisfies RecordCollection, id));
}
