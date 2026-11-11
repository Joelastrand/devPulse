import {
  ACHIEVEMENT_CAP,
  DESCRIPTION_MAX_CODE_POINTS,
  LINK_MAX,
  OUTCOME_MAX_CODE_POINTS,
  RELATION_TO_ROLE_VALUES,
  TITLE_MAX_CODE_POINTS,
  isAddressableRecordId,
  type RelationToRole,
} from "./constants";
import type { RecordSchema } from "./record-schema";
import { datesInOrder, parseIdList, parseOptionalDate, parseOptionalText, parseRequiredText, parseTitle, type Parsed } from "./text";

/** An achievement's content (SPEC BR-20 to BR-24). */
export interface AchievementContent {
  title: string;
  description: string;
  outcome: string | null;
  relationToRole: RelationToRole;
  periodStart: string | null;
  periodEnd: string | null;
  goalIds: string[];
  responsibilityIds: string[];
}

export const ACHIEVEMENT_DTO_KEYS = [
  "id",
  "title",
  "description",
  "outcome",
  "relationToRole",
  "periodStart",
  "periodEnd",
  "goalIds",
  "responsibilityIds",
  "createdAt",
  "updatedAt",
] as const;

const isRelation = (value: unknown): value is RelationToRole =>
  typeof value === "string" && (RELATION_TO_ROLE_VALUES as readonly string[]).includes(value);

/** The full set of rules for an achievement content object, used for input and for stored records alike. */
export function validateAchievementContent(raw: Record<string, unknown>): Parsed<AchievementContent> {
  const title = parseTitle(raw.title, TITLE_MAX_CODE_POINTS);
  const description = parseRequiredText(raw.description, DESCRIPTION_MAX_CODE_POINTS);
  const outcome = parseOptionalText(raw.outcome, OUTCOME_MAX_CODE_POINTS);
  const periodStart = parseOptionalDate(raw.periodStart);
  const periodEnd = parseOptionalDate(raw.periodEnd);
  const goalIds = parseIdList(raw.goalIds, LINK_MAX, isAddressableRecordId);
  const responsibilityIds = parseIdList(raw.responsibilityIds, LINK_MAX, isAddressableRecordId);
  if (!title.ok || !description.ok || !outcome.ok || !periodStart.ok || !periodEnd.ok) return { ok: false };
  if (!goalIds.ok || !responsibilityIds.ok || !isRelation(raw.relationToRole)) return { ok: false };
  if (!datesInOrder(periodStart.value, periodEnd.value)) return { ok: false };
  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      outcome: outcome.value,
      relationToRole: raw.relationToRole,
      periodStart: periodStart.value,
      periodEnd: periodEnd.value,
      goalIds: goalIds.value,
      responsibilityIds: responsibilityIds.value,
    },
  };
}

export const achievementSchema: RecordSchema<AchievementContent> = {
  collection: "achievements",
  cap: ACHIEVEMENT_CAP,
  payloadKeys: ["title", "description", "outcome"],
  plainKeys: ["relationToRole", "periodStart", "periodEnd", "goalIds", "responsibilityIds"],
  fromInput: validateAchievementContent,
  split(content) {
    return {
      payload: { title: content.title, description: content.description, outcome: content.outcome },
      plain: {
        relationToRole: content.relationToRole,
        periodStart: content.periodStart,
        periodEnd: content.periodEnd,
        goalIds: content.goalIds,
        responsibilityIds: content.responsibilityIds,
      },
    };
  },
  toDto(id, content, createdAt, updatedAt) {
    return {
      id,
      title: content.title,
      description: content.description,
      outcome: content.outcome,
      relationToRole: content.relationToRole,
      periodStart: content.periodStart,
      periodEnd: content.periodEnd,
      goalIds: [...content.goalIds],
      responsibilityIds: [...content.responsibilityIds],
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  },
  dtoKeys: ACHIEVEMENT_DTO_KEYS,
};
