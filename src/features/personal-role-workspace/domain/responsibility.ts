import {
  DESCRIPTION_MAX_CODE_POINTS,
  LINK_MAX,
  RELATION_TO_ROLE_VALUES,
  RESPONSIBILITY_CAP,
  RESPONSIBILITY_STATUS_VALUES,
  TITLE_MAX_CODE_POINTS,
  isAddressableRecordId,
  type RelationToRole,
  type ResponsibilityStatus,
} from "./constants";
import type { RecordSchema } from "./record-schema";
import { datesInOrder, parseIdList, parseOptionalDate, parseOptionalText, parseTitle, type Parsed } from "./text";

/** A responsibility's content (SPEC BR-10 to BR-16). Dates are `YYYY-MM-DD` or `null`. */
export interface ResponsibilityContent {
  title: string;
  description: string | null;
  status: ResponsibilityStatus;
  relationToRole: RelationToRole;
  startDate: string | null;
  endDate: string | null;
  goalIds: string[];
}

export const RESPONSIBILITY_DTO_KEYS = [
  "id",
  "title",
  "description",
  "status",
  "relationToRole",
  "startDate",
  "endDate",
  "goalIds",
  "createdAt",
  "updatedAt",
] as const;

const isStatus = (value: unknown): value is ResponsibilityStatus =>
  typeof value === "string" && (RESPONSIBILITY_STATUS_VALUES as readonly string[]).includes(value);
const isRelation = (value: unknown): value is RelationToRole =>
  typeof value === "string" && (RELATION_TO_ROLE_VALUES as readonly string[]).includes(value);

/** The full set of rules for a responsibility content object, used for input and for stored records alike. */
export function validateResponsibilityContent(raw: Record<string, unknown>): Parsed<ResponsibilityContent> {
  const title = parseTitle(raw.title, TITLE_MAX_CODE_POINTS);
  const description = parseOptionalText(raw.description, DESCRIPTION_MAX_CODE_POINTS);
  const startDate = parseOptionalDate(raw.startDate);
  const endDate = parseOptionalDate(raw.endDate);
  const goalIds = parseIdList(raw.goalIds, LINK_MAX, isAddressableRecordId);
  if (!title.ok || !description.ok || !startDate.ok || !endDate.ok || !goalIds.ok) return { ok: false };
  if (!isStatus(raw.status) || !isRelation(raw.relationToRole)) return { ok: false };
  if (!datesInOrder(startDate.value, endDate.value)) return { ok: false };
  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      status: raw.status,
      relationToRole: raw.relationToRole,
      startDate: startDate.value,
      endDate: endDate.value,
      goalIds: goalIds.value,
    },
  };
}

export const responsibilitySchema: RecordSchema<ResponsibilityContent> = {
  collection: "responsibilities",
  cap: RESPONSIBILITY_CAP,
  payloadKeys: ["title", "description"],
  plainKeys: ["status", "relationToRole", "startDate", "endDate", "goalIds"],
  fromInput: validateResponsibilityContent,
  split(content) {
    return {
      payload: { title: content.title, description: content.description },
      plain: {
        status: content.status,
        relationToRole: content.relationToRole,
        startDate: content.startDate,
        endDate: content.endDate,
        goalIds: content.goalIds,
      },
    };
  },
  toDto(id, content, createdAt, updatedAt) {
    return {
      id,
      title: content.title,
      description: content.description,
      status: content.status,
      relationToRole: content.relationToRole,
      startDate: content.startDate,
      endDate: content.endDate,
      goalIds: [...content.goalIds],
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  },
  dtoKeys: RESPONSIBILITY_DTO_KEYS,
};
