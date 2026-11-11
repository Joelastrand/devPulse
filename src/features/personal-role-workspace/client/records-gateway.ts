/**
 * Browser-side gateway for the owner's responsibilities and achievements (SPEC BR-10 to BR-24). It only calls the
 * `/api/me/*` routes with the signed-in person's bearer token. It never reads Firestore and never sends a uid, a team id
 * or an e-mail address. Responses are validated before use; anything malformed is a read failure, never partial data.
 */

import type { RelationToRole, ResponsibilityStatus } from "../domain/constants";

export interface ResponsibilityDto {
  id: string;
  title: string;
  description: string | null;
  status: ResponsibilityStatus;
  relationToRole: RelationToRole;
  startDate: string | null;
  endDate: string | null;
  goalIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MissingLinks {
  goalIds: string[];
  responsibilityIds: string[];
}

export interface AchievementDto {
  id: string;
  title: string;
  description: string;
  outcome: string | null;
  relationToRole: RelationToRole;
  periodStart: string | null;
  periodEnd: string | null;
  goalIds: string[];
  responsibilityIds: string[];
  /** Present on list responses only (BR-22). A create or update response carries no marker. */
  missingLinks?: MissingLinks;
  createdAt: string;
  updatedAt: string;
}

export interface RecordList<T> {
  records: T[];
  recoveryItems: { id: string }[];
  unavailableCount: number;
  truncated: boolean;
}

export type GatewayError =
  | "unauthenticated"
  | "invalid_input"
  | "invalid_reference"
  | "not_found"
  | "record_limit"
  | "record_unavailable"
  | "payload_too_large"
  | "erasure_in_progress"
  | "read_failed"
  | "persistence_failed";

export type GatewayResult<T> = { ok: true; value: T } | { ok: false; error: GatewayError };

export interface ResponsibilityInput {
  title: string;
  description: string | null;
  status: ResponsibilityStatus;
  relationToRole: RelationToRole;
  startDate: string | null;
  endDate: string | null;
  goalIds: string[];
}

export interface AchievementInput {
  title: string;
  description: string;
  outcome: string | null;
  relationToRole: RelationToRole;
  periodStart: string | null;
  periodEnd: string | null;
  goalIds: string[];
  responsibilityIds: string[];
}

const RELATIONS: readonly string[] = ["within", "beyond", "unspecified"];
const STATUSES: readonly string[] = ["active", "completed"];
const RESPONSE_ERRORS: readonly string[] = [
  "unauthenticated",
  "invalid_input",
  "invalid_reference",
  "not_found",
  "record_limit",
  "record_unavailable",
  "payload_too_large",
  "erasure_in_progress",
  "persistence_failed",
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function isResponsibilityDto(value: unknown): value is ResponsibilityDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isStringOrNull(value.description) &&
    typeof value.status === "string" &&
    STATUSES.includes(value.status) &&
    typeof value.relationToRole === "string" &&
    RELATIONS.includes(value.relationToRole) &&
    isStringOrNull(value.startDate) &&
    isStringOrNull(value.endDate) &&
    isStringArray(value.goalIds) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isAchievementDto(value: unknown): value is AchievementDto {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    isStringOrNull(value.outcome) &&
    typeof value.relationToRole === "string" &&
    RELATIONS.includes(value.relationToRole) &&
    isStringOrNull(value.periodStart) &&
    isStringOrNull(value.periodEnd) &&
    isStringArray(value.goalIds) &&
    isStringArray(value.responsibilityIds) &&
    (value.missingLinks === undefined ||
      (isRecord(value.missingLinks) && isStringArray(value.missingLinks.goalIds) && isStringArray(value.missingLinks.responsibilityIds))) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecordList(value: unknown, isItem: (item: unknown) => boolean): value is RecordList<unknown> {
  return (
    isRecord(value) &&
    Array.isArray(value.records) &&
    value.records.every(isItem) &&
    Array.isArray(value.recoveryItems) &&
    value.recoveryItems.every((item) => isRecord(item) && typeof item.id === "string") &&
    typeof value.unavailableCount === "number" &&
    typeof value.truncated === "boolean"
  );
}

function errorFromBody(body: unknown): GatewayError {
  if (isRecord(body) && typeof body.error === "string" && RESPONSE_ERRORS.includes(body.error)) return body.error as GatewayError;
  return "persistence_failed";
}

async function request<T>(
  path: string,
  init: { method: string; token: string; body?: unknown },
  accept: (body: unknown) => body is T,
  expectedStatus: number,
): Promise<GatewayResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${init.token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, error: "read_failed" };
  }
  if (response.status === 401) return { ok: false, error: "unauthenticated" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: init.method === "GET" ? "read_failed" : "persistence_failed" };
  }
  if (response.status !== expectedStatus && init.method !== "GET") return { ok: false, error: errorFromBody(body) };
  if (!accept(body)) return { ok: false, error: init.method === "GET" ? "read_failed" : "persistence_failed" };
  return { ok: true, value: body };
}

const isResponsibilityList = (value: unknown): value is RecordList<ResponsibilityDto> => isRecordList(value, isResponsibilityDto);
const isAchievementList = (value: unknown): value is RecordList<AchievementDto> => isRecordList(value, isAchievementDto);

export function fetchResponsibilities(token: string) {
  return request("/api/me/responsibilities", { method: "GET", token }, isResponsibilityList, 200);
}

export function createResponsibility(token: string, input: ResponsibilityInput) {
  return request("/api/me/responsibilities", { method: "POST", token, body: input }, isResponsibilityDto, 201);
}

export function updateResponsibility(token: string, id: string, patch: Partial<ResponsibilityInput>) {
  return request(`/api/me/responsibilities/${encodeURIComponent(id)}`, { method: "PATCH", token, body: patch }, isResponsibilityDto, 200);
}

export function deleteResponsibility(token: string, id: string) {
  return request(`/api/me/responsibilities/${encodeURIComponent(id)}`, { method: "DELETE", token }, isDeleted, 200);
}

export function fetchAchievements(token: string) {
  return request("/api/me/achievements", { method: "GET", token }, isAchievementList, 200);
}

export function createAchievement(token: string, input: AchievementInput) {
  return request("/api/me/achievements", { method: "POST", token, body: input }, isAchievementDto, 201);
}

export function updateAchievement(token: string, id: string, patch: Partial<AchievementInput>) {
  return request(`/api/me/achievements/${encodeURIComponent(id)}`, { method: "PATCH", token, body: patch }, isAchievementDto, 200);
}

export function deleteAchievement(token: string, id: string) {
  return request(`/api/me/achievements/${encodeURIComponent(id)}`, { method: "DELETE", token }, isDeleted, 200);
}

function isDeleted(value: unknown): value is { deleted: true } {
  return isRecord(value) && value.deleted === true;
}
