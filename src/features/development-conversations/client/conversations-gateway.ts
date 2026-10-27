import { isConversationStatus, type ConversationStatus } from "../domain/conversation-status";
import {
  OWNER_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_DTO_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  PENDING_DTO_KEYS,
  RECOVERY_ITEM_KEYS,
  SHARED_GOAL_DTO_KEYS,
} from "../domain/dto-keys";
import { SNAPSHOT_GOAL_STATUSES, type SnapshotGoalStatus } from "../domain/shared-goal-snapshot";
import { hasExactKeys, isNonEmptyString, isPlainObject } from "../domain/stored-shape";

/**
 * Browser gateway for Development Conversations (SPEC API surface; TASK-025): thin `fetch` wrappers around the
 * `/api/me/conversations` routes, and one read of the owner's own D1 goal list for the snapshot selector (TASK-028). The subject is only the token's own identity. No uid, e-mail, memberRef or team
 * authority is ever sent, and the conversation id is the only path segment. Browser code never touches Firestore.
 *
 * Every call returns a result, never throws. Every response is parsed against the exact allow-lists in
 * `domain/dto-keys.ts`; any unexpected success shape is `read_failed`, never partial data. Error bodies are kept only
 * when the code is one the method lists, otherwise they are `unknown` and never echoed. Nothing retries and nothing
 * is cached.
 *
 * Wire types differ from the server types in one way: timestamps arrive as ISO strings (JSON), so the types here
 * use `string` where the server DTOs use `Date`.
 */

/* ------------------------------------ wire types ------------------------------------ */

export type OwnerParticipantState = "none" | "pending" | "accepted" | "unavailable";
const OWNER_PARTICIPANT_STATES = ["none", "pending", "accepted", "unavailable"] as const;

export interface OwnerParticipantWire {
  state: OwnerParticipantState;
  displayName: string | null;
}

export interface SharedGoalWire {
  goalTitle: string;
  areaName: string | null;
  targetDate: string | null;
  status: SnapshotGoalStatus;
  capturedAt: string;
}

/** BR-44 owner summary. */
export interface OwnerSummaryWire {
  conversationId: string;
  title: string;
  status: ConversationStatus;
  plannedFor: string | null;
  participant: OwnerParticipantWire;
  sharedGoalCount: number;
  createdAt: string;
  updatedAt: string;
}

/** BR-44 delete-only recovery item. Exactly `{ conversationId }`. */
export interface RecoveryItemWire {
  conversationId: string;
}

/** BR-42 owner DTO. */
export interface OwnerConversationWire {
  conversationId: string;
  title: string;
  status: ConversationStatus;
  plannedFor: string | null;
  teamId: string | null;
  participant: OwnerParticipantWire;
  ownerNotes: string;
  nextSteps: string[];
  participantNotes: string;
  sharedGoals: SharedGoalWire[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** BR-43 participant DTO. There is no uid, membership id or memberRef field. */
export interface ParticipantConversationWire {
  conversationId: string;
  title: string;
  status: ConversationStatus;
  plannedFor: string | null;
  teamName: string;
  ownerDisplayName: string | null;
  ownerNotes: string;
  nextSteps: string[];
  participantNotes: string;
  sharedGoals: SharedGoalWire[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** BR-41 pending DTO. Invitation metadata only; no content field exists. */
export interface PendingInvitationWire {
  conversationId: string;
  state: "pending";
  teamName: string;
  invitedAt: string;
  ownerDisplayName: string | null;
}

/** BR-44 participation summary. `title` is `null` while pending. */
export interface ParticipationSummaryWire {
  conversationId: string;
  state: "pending" | "accepted";
  title: string | null;
  teamName: string;
  invitedAt: string;
}

/**
 * One owner-list item. The gateway tags it from the exact key set that matched (recovery is exactly
 * `{ conversationId }`), so a caller never has to infer which kind it holds from which fields are present.
 */
export type OwnedListItem = { kind: "summary"; conversation: OwnerSummaryWire } | { kind: "recovery"; item: RecoveryItemWire };

export interface ConversationListResponse {
  owned: { items: OwnedListItem[]; truncated: boolean };
  participating: { items: ParticipationSummaryWire[]; truncated: boolean };
}

/**
 * The detail view the server chose for the caller (owner, accepted participant or pending invitee). The tag is set
 * from the exact key set that matched; the server, not the browser, decides which view applies.
 */
export type ConversationView =
  | { kind: "owner"; conversation: OwnerConversationWire }
  | { kind: "participant"; conversation: ParticipantConversationWire }
  | { kind: "pending"; invitation: PendingInvitationWire };

/**
 * One of the owner's goals, as the D1 goal list returns it. Only the three fields the snapshot selector shows and sends
 * are kept. D1 owns the rest of that response, so nothing else is parsed or stored here.
 */
export interface OwnGoalWire {
  id: string;
  title: string;
  status: SnapshotGoalStatus;
}

export interface OwnGoalsResponse {
  goals: OwnGoalWire[];
  truncated: boolean;
}

/**
 * One teammate the owner may choose as a participant (TASK-029, SPEC BR-8, Amendment 2026-10-19). `memberRef` is an opaque,
 * team-scoped selection handle. It is never authorization and the server re-checks it on every write. No uid, e-mail or
 * membership id exists here.
 */
export interface SelectableMemberWire {
  memberRef: string;
  displayName: string | null;
  ordinal: number | null;
  isSelf: boolean;
}

export interface SelectableMembersResponse {
  members: SelectableMemberWire[];
  /** Rows the server did not offer (malformed or ambiguous). Counted, never identified. */
  unavailableCount: number;
  /** Members beyond the server's read bound. They cannot be selected (BR-8). */
  truncated: boolean;
}

/* ----------------------------------- request types ----------------------------------- */

/** One team the caller may choose. Only the stable id and the display name. */
export interface CreateTeamChoiceWire {
  teamId: string;
  name: string;
}

/** `GET /api/me/conversations/create-options`. `truncated` means teams beyond the server window may exist. */
export interface CreateOptionsResponse {
  items: CreateTeamChoiceWire[];
  truncated: boolean;
}

/** `POST` body. `plannedFor` absent or `null` means no planned date. `teamId` is a choice, never authority. */
export interface CreateConversationInput {
  title: string;
  plannedFor?: string | null;
  teamId?: string;
}

/**
 * Owner `PATCH`. The server accepts one operation per request (sections, shared goals, participant, or completion).
 * The gateway sends only the keys present on the input, from the allow-list below, and never anything else.
 */
export type OwnerPatchInput =
  | { title?: string; plannedFor?: string | null; ownerNotes?: string; nextSteps?: string[] }
  | { sharedGoalIds: string[] }
  | { participantMemberRef: string | null }
  | { status: "completed" };

/** Participant notes `PUT` body. Exactly `{ notes }`. */
export interface ParticipantNotesInput {
  notes: string;
}

/* ------------------------------------- results -------------------------------------- */

/** A failure the gateway reports. `unauthenticated` is a 401; `error` carries a stable code or `read_failed` / `unknown`. */
export type GatewayFailure<E extends string> = { status: "unauthenticated" } | { status: "error"; error: E };

export type GatewayResult<S, E extends string> = S | GatewayFailure<E>;

/**
 * Codes a method may return. `read_failed` means the response could not be read (network failure on a read, or an
 * unexpected success shape). `unknown` means an error the method does not list, a non-JSON error body, or a
 * network failure on a write, whose outcome is then not known.
 */
type Known<K extends readonly string[]> = K[number] | "read_failed" | "unknown";

/** Stable codes per method, from SPEC "Stable errors" for the routes each method calls. */
const LIST_ERRORS = ["persistence_failed"] as const;
const CREATE_OPTIONS_ERRORS = ["persistence_failed"] as const;
const DETAIL_ERRORS = ["conversation_not_found", "persistence_failed"] as const;
const CREATE_ERRORS = ["invalid_input", "payload_too_large", "conversation_limit", "persistence_failed"] as const;
const UPDATE_ERRORS = [
  "invalid_input",
  "payload_too_large",
  "conversation_not_found",
  "conversation_completed",
  "invalid_transition",
  "invalid_participant",
  "invalid_goal_selection",
  "persistence_failed",
] as const;
const DELETE_ERRORS = ["conversation_not_found", "persistence_failed"] as const;
const NOTES_ERRORS = [
  "invalid_input",
  "payload_too_large",
  "conversation_not_found",
  "conversation_completed",
  "persistence_failed",
] as const;
const PARTICIPATION_ERRORS = ["invalid_input", "payload_too_large", "conversation_not_found", "persistence_failed"] as const;
const OWN_GOALS_ERRORS = ["persistence_failed"] as const;
/** SPEC Amendment 2026-10-19 selector read: the stable codes it can return. Any other refusal is `unknown`. */
const SELECTABLE_MEMBERS_ERRORS = ["conversation_not_found", "invalid_participant", "conversation_completed", "persistence_failed"] as const;

export type ListConversationsSuccess = { status: "ok"; response: ConversationListResponse };
export type FetchConversationSuccess = { status: "ok"; view: ConversationView };
export type CreateConversationSuccess = { status: "created"; conversationId: string };
export type CreateOptionsSuccess = { status: "ok"; response: CreateOptionsResponse };
/** `saved` for a real change (`{ ok: true }`). `unchanged` for a removal with no participant set (SPEC Stable errors). */
export type UpdateConversationSuccess = { status: "saved" } | { status: "unchanged"; conversation: OwnerConversationWire };
export type DeleteConversationSuccess = { status: "deleted" };
export type SaveParticipantNotesSuccess = { status: "saved" };
export type AcceptInvitationSuccess = { status: "accepted" };
/** Decline (pending) and leave (accepted) are one route; both succeed with `204` and no body. */
export type EndParticipationSuccess = { status: "ended" };
export type FetchOwnGoalsSuccess = { status: "ok"; response: OwnGoalsResponse };
export type FetchSelectableMembersSuccess = { status: "ok"; response: SelectableMembersResponse };

export type ListConversationsResult = GatewayResult<ListConversationsSuccess, Known<typeof LIST_ERRORS>>;
export type FetchCreateOptionsResult = GatewayResult<CreateOptionsSuccess, Known<typeof CREATE_OPTIONS_ERRORS>>;
export type FetchConversationResult = GatewayResult<FetchConversationSuccess, Known<typeof DETAIL_ERRORS>>;
export type CreateConversationResult = GatewayResult<CreateConversationSuccess, Known<typeof CREATE_ERRORS>>;
export type UpdateConversationResult = GatewayResult<UpdateConversationSuccess, Known<typeof UPDATE_ERRORS>>;
export type DeleteConversationResult = GatewayResult<DeleteConversationSuccess, Known<typeof DELETE_ERRORS>>;
export type SaveParticipantNotesResult = GatewayResult<SaveParticipantNotesSuccess, Known<typeof NOTES_ERRORS>>;
export type AcceptInvitationResult = GatewayResult<AcceptInvitationSuccess, Known<typeof PARTICIPATION_ERRORS>>;
export type EndParticipationResult = GatewayResult<EndParticipationSuccess, Known<typeof PARTICIPATION_ERRORS>>;
export type FetchOwnGoalsResult = GatewayResult<FetchOwnGoalsSuccess, Known<typeof OWN_GOALS_ERRORS>>;
export type FetchSelectableMembersResult = GatewayResult<FetchSelectableMembersSuccess, Known<typeof SELECTABLE_MEMBERS_ERRORS>>;

/* ----------------------------------- transport ------------------------------------ */

const CONVERSATIONS_PATH = "/api/me/conversations";
/** D1's own goal list. Read only, and used only to choose snapshot candidates (SPEC BR-24). */
const OWN_GOALS_PATH = "/api/me/goals";
const CREATE_OPTIONS_PATH = `${CONVERSATIONS_PATH}/create-options`;

interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** The body, already built field by field. Absent for routes that take no body; no `{}` is ever invented. */
  body?: Record<string, unknown>;
}

const conversationPath = (conversationId: string) => `${CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}`;

/** Sends one request. `undefined` means the request did not complete (network or runtime failure). */
async function send(idToken: string, spec: RequestSpec): Promise<Response | undefined> {
  const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` };
  const init: RequestInit = { method: spec.method, headers };
  if (spec.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(spec.body);
  }
  try {
    return await fetch(spec.path, init);
  } catch {
    return undefined;
  }
}

/** A JSON body, or `undefined` when it does not parse. A body that does not parse never reaches a parser as data. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Builds a body reader from a parser. An unparsable or unexpected success body yields `undefined`. */
function jsonBody<S>(parse: (body: unknown) => S | undefined): (response: Response) => Promise<S | undefined> {
  return async (response) => parse(await readJson(response));
}

/** A non-success response. 401 is `unauthenticated`; a body code is kept only if this method lists it. */
async function failureOf<K extends readonly string[]>(response: Response, known: K): Promise<GatewayFailure<Known<K>>> {
  if (response.status === 401) return { status: "unauthenticated" };
  const body = await readJson(response);
  const code = isPlainObject(body) ? body.error : undefined;
  return { status: "error", error: known.find((error) => error === code) ?? "unknown" };
}

/**
 * One exchange. `success.read` decides what a success body means, so a `204` is never sent to `json()`. A success
 * that does not parse is `read_failed`. Any other status goes to the error path.
 */
async function exchange<S, K extends readonly string[]>(
  idToken: string,
  spec: RequestSpec,
  success: { status: number; read: (response: Response) => Promise<S | undefined> },
  known: K,
  networkError: "read_failed" | "unknown",
): Promise<GatewayResult<S, Known<K>>> {
  const response = await send(idToken, spec);
  if (!response) return { status: "error", error: networkError };
  if (response.status === success.status) {
    return (await success.read(response)) ?? { status: "error", error: "read_failed" };
  }
  return failureOf(response, known);
}

/* ------------------------------------- parsers ------------------------------------ */

const isText = (value: unknown): value is string => typeof value === "string";
const isNullableText = (value: unknown): value is string | null => value === null || typeof value === "string";
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => (values as readonly unknown[]).includes(value);

/** `{ ok: true }` and nothing else. */
function isOkBody(body: unknown): boolean {
  return isPlainObject(body) && hasExactKeys(body, ["ok"]) && body.ok === true;
}

function parseOwnerParticipant(value: unknown): OwnerParticipantWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, OWNER_PARTICIPANT_KEYS)) return undefined;
  const { state, displayName } = value;
  if (!isOneOf(OWNER_PARTICIPANT_STATES, state) || !isNullableText(displayName)) return undefined;
  return { state, displayName };
}

function parseSharedGoal(value: unknown): SharedGoalWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, SHARED_GOAL_DTO_KEYS)) return undefined;
  const { goalTitle, areaName, targetDate, status, capturedAt } = value;
  if (!isText(goalTitle) || !isNullableText(areaName) || !isNullableText(targetDate)) return undefined;
  if (!isOneOf(SNAPSHOT_GOAL_STATUSES, status) || !isText(capturedAt)) return undefined;
  return { goalTitle, areaName, targetDate, status, capturedAt };
}

function parseSharedGoals(value: unknown): SharedGoalWire[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const goals: SharedGoalWire[] = [];
  for (const raw of value) {
    const goal = parseSharedGoal(raw);
    if (!goal) return undefined;
    goals.push(goal);
  }
  return goals;
}

function parseOwnerSummary(value: unknown): OwnerSummaryWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, OWNER_SUMMARY_KEYS)) return undefined;
  const { conversationId, title, status, plannedFor, participant, sharedGoalCount, createdAt, updatedAt } = value;
  const parsedParticipant = parseOwnerParticipant(participant);
  if (!isNonEmptyString(conversationId) || !isText(title) || !isConversationStatus(status)) return undefined;
  if (!isNullableText(plannedFor) || !parsedParticipant || !isCount(sharedGoalCount)) return undefined;
  if (!isText(createdAt) || !isText(updatedAt)) return undefined;
  return {
    conversationId,
    title,
    status,
    plannedFor,
    participant: parsedParticipant,
    sharedGoalCount,
    createdAt,
    updatedAt,
  };
}

function parseOwnedItem(value: unknown): OwnedListItem | undefined {
  if (isPlainObject(value) && hasExactKeys(value, RECOVERY_ITEM_KEYS)) {
    const conversationId = value.conversationId;
    return isNonEmptyString(conversationId) ? { kind: "recovery", item: { conversationId } } : undefined;
  }
  const conversation = parseOwnerSummary(value);
  return conversation ? { kind: "summary", conversation } : undefined;
}

function parseParticipationSummary(value: unknown): ParticipationSummaryWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, PARTICIPANT_SUMMARY_KEYS)) return undefined;
  const { conversationId, state, title, teamName, invitedAt } = value;
  if (!isNonEmptyString(conversationId) || !isText(teamName) || !isText(invitedAt)) return undefined;
  // BR-44 and CL-19: a pending invitation carries no title. A title on a pending entry is refused, not shown.
  if (state === "pending") {
    return title === null ? { conversationId, state, title: null, teamName, invitedAt } : undefined;
  }
  if (state !== "accepted" || !isText(title)) return undefined;
  return { conversationId, state, title, teamName, invitedAt };
}

/** The `owned` and `participating` envelope: exact keys, a boolean `truncated`, and every item parsed. */
function parseEnvelope<T>(value: unknown, parseItem: (raw: unknown) => T | undefined): { items: T[]; truncated: boolean } | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, ["items", "truncated"])) return undefined;
  const { items, truncated } = value;
  if (!Array.isArray(items) || typeof truncated !== "boolean") return undefined;
  const parsed: T[] = [];
  for (const raw of items) {
    const item = parseItem(raw);
    if (item === undefined) return undefined;
    parsed.push(item);
  }
  return { items: parsed, truncated };
}

/** Exact success shape `{ items, truncated }`. Each item is exactly `{ teamId, name }` with non-empty strings. */
function toCreateOptions(body: unknown): CreateOptionsSuccess | undefined {
  if (!isPlainObject(body) || !hasExactKeys(body, ["items", "truncated"])) return undefined;
  if (!Array.isArray(body.items) || typeof body.truncated !== "boolean") return undefined;
  const items: CreateTeamChoiceWire[] = [];
  for (const raw of body.items) {
    if (!isPlainObject(raw) || !hasExactKeys(raw, ["teamId", "name"])) return undefined;
    if (!isNonEmptyString(raw.teamId) || !isNonEmptyString(raw.name)) return undefined;
    items.push({ teamId: raw.teamId, name: raw.name });
  }
  return { status: "ok", response: { items, truncated: body.truncated } };
}

function toListResponse(body: unknown): ConversationListResponse | undefined {
  if (!isPlainObject(body) || !hasExactKeys(body, ["owned", "participating"])) return undefined;
  const owned = parseEnvelope(body.owned, parseOwnedItem);
  const participating = parseEnvelope(body.participating, parseParticipationSummary);
  return owned && participating ? { owned, participating } : undefined;
}

function parseOwnerConversation(value: unknown): OwnerConversationWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, OWNER_DTO_KEYS)) return undefined;
  const { conversationId, title, status, plannedFor, teamId, participant, ownerNotes, nextSteps } = value;
  const { participantNotes, sharedGoals, createdAt, updatedAt, completedAt } = value;
  const parsedParticipant = parseOwnerParticipant(participant);
  const parsedGoals = parseSharedGoals(sharedGoals);
  if (!isNonEmptyString(conversationId) || !isText(title) || !isConversationStatus(status)) return undefined;
  if (!isNullableText(plannedFor) || !isNullableText(teamId) || !parsedParticipant) return undefined;
  if (!isText(ownerNotes) || !isText(participantNotes) || !Array.isArray(nextSteps) || !nextSteps.every(isText)) return undefined;
  if (!parsedGoals || !isText(createdAt) || !isText(updatedAt) || !isNullableText(completedAt)) return undefined;
  return {
    conversationId,
    title,
    status,
    plannedFor,
    teamId,
    participant: parsedParticipant,
    ownerNotes,
    nextSteps,
    participantNotes,
    sharedGoals: parsedGoals,
    createdAt,
    updatedAt,
    completedAt,
  };
}

function parseParticipantConversation(value: unknown): ParticipantConversationWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, PARTICIPANT_DTO_KEYS)) return undefined;
  const { conversationId, title, status, plannedFor, teamName, ownerDisplayName, ownerNotes, nextSteps } = value;
  const { participantNotes, sharedGoals, createdAt, updatedAt, completedAt } = value;
  const parsedGoals = parseSharedGoals(sharedGoals);
  if (!isNonEmptyString(conversationId) || !isText(title) || !isConversationStatus(status)) return undefined;
  if (!isNullableText(plannedFor) || !isText(teamName) || !isNullableText(ownerDisplayName)) return undefined;
  if (!isText(ownerNotes) || !isText(participantNotes) || !Array.isArray(nextSteps) || !nextSteps.every(isText)) return undefined;
  if (!parsedGoals || !isText(createdAt) || !isText(updatedAt) || !isNullableText(completedAt)) return undefined;
  return {
    conversationId,
    title,
    status,
    plannedFor,
    teamName,
    ownerDisplayName,
    ownerNotes,
    nextSteps,
    participantNotes,
    sharedGoals: parsedGoals,
    createdAt,
    updatedAt,
    completedAt,
  };
}

function parsePendingInvitation(value: unknown): PendingInvitationWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, PENDING_DTO_KEYS)) return undefined;
  const { conversationId, state, teamName, invitedAt, ownerDisplayName } = value;
  if (!isNonEmptyString(conversationId) || state !== "pending") return undefined;
  if (!isText(teamName) || !isText(invitedAt) || !isNullableText(ownerDisplayName)) return undefined;
  return { conversationId, state, teamName, invitedAt, ownerDisplayName };
}

/**
 * The detail view, matched by exact key set. The three allow-lists differ, so at most one matches. A body that matches
 * none is a read failure, never a guessed view.
 */
function toConversationView(body: unknown): ConversationView | undefined {
  const pending = parsePendingInvitation(body);
  if (pending) return { kind: "pending", invitation: pending };
  const owner = parseOwnerConversation(body);
  if (owner) return { kind: "owner", conversation: owner };
  const participant = parseParticipantConversation(body);
  return participant ? { kind: "participant", conversation: participant } : undefined;
}

function toCreated(body: unknown): CreateConversationSuccess | undefined {
  if (!isPlainObject(body) || !hasExactKeys(body, ["conversationId"])) return undefined;
  const conversationId = body.conversationId;
  return isNonEmptyString(conversationId) ? { status: "created", conversationId } : undefined;
}

function toOwnGoals(body: unknown): FetchOwnGoalsSuccess | undefined {
  if (!isPlainObject(body) || !Array.isArray(body.goals) || typeof body.truncated !== "boolean") return undefined;
  const goals: OwnGoalWire[] = [];
  for (const entry of body.goals) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.id) || !isText(entry.title) || !isOneOf(SNAPSHOT_GOAL_STATUSES, entry.status)) {
      return undefined;
    }
    goals.push({ id: entry.id, title: entry.title, status: entry.status });
  }
  return { status: "ok", response: { goals, truncated: body.truncated } };
}

function parseSelectableMember(value: unknown): SelectableMemberWire | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, ["memberRef", "displayName", "ordinal", "isSelf"])) return undefined;
  const { memberRef, displayName, ordinal, isSelf } = value;
  if (!isNonEmptyString(memberRef) || !isNullableText(displayName) || typeof isSelf !== "boolean") return undefined;
  if (ordinal !== null && !(isCount(ordinal) && ordinal >= 1)) return undefined;
  return { memberRef, displayName, ordinal, isSelf };
}

/** Exact top-level keys and a strict member list. Any other shape is `read_failed`, and no raw body is kept. */
function toSelectableMembers(body: unknown): FetchSelectableMembersSuccess | undefined {
  if (!isPlainObject(body) || !hasExactKeys(body, ["members", "unavailableCount", "truncated"])) return undefined;
  if (!Array.isArray(body.members) || !isCount(body.unavailableCount) || typeof body.truncated !== "boolean") return undefined;
  const members: SelectableMemberWire[] = [];
  for (const raw of body.members) {
    const member = parseSelectableMember(raw);
    if (!member) return undefined;
    members.push(member);
  }
  return { status: "ok", response: { members, unavailableCount: body.unavailableCount, truncated: body.truncated } };
}

function toUpdated(body: unknown): UpdateConversationSuccess | undefined {
  if (isOkBody(body)) return { status: "saved" };
  const conversation = parseOwnerConversation(body);
  return conversation ? { status: "unchanged", conversation } : undefined;
}

/* ------------------------------------- operations ------------------------------------ */

/**
 * Teams the caller may choose for a new conversation (`GET`, 200). Discovery only: it grants nothing, and `createConversation`
 * re-checks eligibility on every create. Read-only. No retry, no cache.
 */
export function fetchCreateOptions(idToken: string): Promise<FetchCreateOptionsResult> {
  return exchange(
    idToken,
    { method: "GET", path: CREATE_OPTIONS_PATH },
    { status: 200, read: jsonBody(toCreateOptions) },
    CREATE_OPTIONS_ERRORS,
    "read_failed",
  );
}

/** Reads the caller's own owner list and participation list (`GET`, 200). Order and truncation are kept as sent. */
export function fetchConversationList(idToken: string): Promise<ListConversationsResult> {
  return exchange(
    idToken,
    { method: "GET", path: CONVERSATIONS_PATH },
    {
      status: 200,
      read: jsonBody((body): ListConversationsSuccess | undefined => {
        const response = toListResponse(body);
        return response ? { status: "ok", response } : undefined;
      }),
    },
    LIST_ERRORS,
    "read_failed",
  );
}

/** Creates an owner conversation (`POST`, 201). The body carries only the three public keys. */
export function createConversation(idToken: string, input: CreateConversationInput): Promise<CreateConversationResult> {
  const body: Record<string, unknown> = { title: input.title };
  if (input.plannedFor !== undefined) body.plannedFor = input.plannedFor;
  if (input.teamId !== undefined) body.teamId = input.teamId;
  return exchange(idToken, { method: "POST", path: CONVERSATIONS_PATH, body }, { status: 201, read: jsonBody(toCreated) }, CREATE_ERRORS, "unknown");
}

/** Reads one conversation's view as the server chose it (`GET`, 200). Only the conversation id is sent. */
export function fetchConversation(idToken: string, conversationId: string): Promise<FetchConversationResult> {
  return exchange(
    idToken,
    { method: "GET", path: conversationPath(conversationId) },
    {
      status: 200,
      read: jsonBody((body): FetchConversationSuccess | undefined => {
        const view = toConversationView(body);
        return view ? { status: "ok", view } : undefined;
      }),
    },
    DETAIL_ERRORS,
    "read_failed",
  );
}

/** Builds the owner `PATCH` body from the allow-list only. Any other property on the input is never sent. */
const OWNER_PATCH_KEYS = ["title", "plannedFor", "ownerNotes", "nextSteps", "sharedGoalIds", "participantMemberRef", "status"] as const;

function ownerPatchBody(input: OwnerPatchInput): Record<string, unknown> {
  const source: Partial<Record<(typeof OWNER_PATCH_KEYS)[number], unknown>> = input;
  return Object.fromEntries(OWNER_PATCH_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

/**
 * Applies one owner change (`PATCH`). Success is `{ ok: true }` for a real change, or the current owner DTO for a
 * removal with no participant set. Both are typed here, so neither is mistaken for the other.
 */
export function updateConversation(idToken: string, conversationId: string, input: OwnerPatchInput): Promise<UpdateConversationResult> {
  return exchange(
    idToken,
    { method: "PATCH", path: conversationPath(conversationId), body: ownerPatchBody(input) },
    { status: 200, read: jsonBody(toUpdated) },
    UPDATE_ERRORS,
    "unknown",
  );
}

/** Permanently deletes an owner conversation (`DELETE`, 200 `{ ok: true }`). No request body. */
export function deleteConversation(idToken: string, conversationId: string): Promise<DeleteConversationResult> {
  return exchange(
    idToken,
    { method: "DELETE", path: conversationPath(conversationId) },
    { status: 200, read: jsonBody((body): DeleteConversationSuccess | undefined => (isOkBody(body) ? { status: "deleted" } : undefined)) },
    DELETE_ERRORS,
    "unknown",
  );
}

/** Replaces the caller's participant notes (`PUT`, 200 `{ ok: true }`). The body is exactly `{ notes }`. */
export function saveParticipantNotes(idToken: string, conversationId: string, input: ParticipantNotesInput): Promise<SaveParticipantNotesResult> {
  return exchange(
    idToken,
    { method: "PUT", path: `${conversationPath(conversationId)}/participant-notes`, body: { notes: input.notes } },
    { status: 200, read: jsonBody((body): SaveParticipantNotesSuccess | undefined => (isOkBody(body) ? { status: "saved" } : undefined)) },
    NOTES_ERRORS,
    "unknown",
  );
}

/** Accepts a pending invitation (`POST`, 200 `{ state: "accepted" }`). No request body. */
export function acceptInvitation(idToken: string, conversationId: string): Promise<AcceptInvitationResult> {
  return exchange(
    idToken,
    { method: "POST", path: `${conversationPath(conversationId)}/participation/accept` },
    {
      status: 200,
      read: jsonBody((body): AcceptInvitationSuccess | undefined => {
        const accepted = isPlainObject(body) && hasExactKeys(body, ["state"]) && body.state === "accepted";
        return accepted ? { status: "accepted" } : undefined;
      }),
    },
    PARTICIPATION_ERRORS,
    "unknown",
  );
}

/**
 * Declines a pending invitation or leaves an accepted one (`DELETE`, `204` with no body). The success body is never
 * read, so an empty response is success and no JSON parse is attempted. No request body.
 */
export function endParticipation(idToken: string, conversationId: string): Promise<EndParticipationResult> {
  return exchange(
    idToken,
    { method: "DELETE", path: `${conversationPath(conversationId)}/participation` },
    { status: 204, read: async (): Promise<EndParticipationSuccess> => ({ status: "ended" }) },
    PARTICIPATION_ERRORS,
    "unknown",
  );
}

/**
 * The owner's own goals, for choosing snapshot candidates (`GET` D1, 200). Read only: nothing is written and nothing is
 * cached. The server re-checks every selected id on write, so this list grants nothing by itself.
 */
export function fetchOwnGoals(idToken: string): Promise<FetchOwnGoalsResult> {
  return exchange(idToken, { method: "GET", path: OWN_GOALS_PATH }, { status: 200, read: jsonBody(toOwnGoals) }, OWN_GOALS_ERRORS, "read_failed");
}

/**
 * The teammates the owner may choose for a conversation (`GET .../selectable-members`, 200; SPEC Amendment 2026-10-19). The
 * path names only the conversation: the team is never sent, and the server decides owner eligibility. Read only, nothing is
 * cached. The list is discovery: the owner's `PATCH` re-resolves the chosen `memberRef`, so this grants nothing. Self is kept
 * in the answer and is filtered by the caller. A refusal keeps its stable code, and a bad body is `read_failed`. No other
 * route is ever used as a fallback.
 */
export function fetchSelectableMembers(idToken: string, conversationId: string): Promise<FetchSelectableMembersResult> {
  return exchange(
    idToken,
    { method: "GET", path: `${conversationPath(conversationId)}/selectable-members` },
    { status: 200, read: jsonBody(toSelectableMembers) },
    SELECTABLE_MEMBERS_ERRORS,
    "read_failed",
  );
}
