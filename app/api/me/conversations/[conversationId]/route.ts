import { NextResponse } from "next/server";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../src/features/development-conversations/domain/errors";
import {
  OWNER_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  PARTICIPANT_DTO_KEYS,
  PENDING_DTO_KEYS,
  SHARED_GOAL_DTO_KEYS,
} from "../../../../../src/features/development-conversations/domain/dto-keys";
import { changeParticipant } from "../../../../../src/features/development-conversations/server/change-participant";
import { completeConversation } from "../../../../../src/features/development-conversations/server/complete-conversation";
import { deleteConversation } from "../../../../../src/features/development-conversations/server/delete-conversation";
import { readConversationForCaller, type ConversationView } from "../../../../../src/features/development-conversations/server/read-conversation-for-caller";
import type { OwnerConversationDto } from "../../../../../src/features/development-conversations/server/read-owner-conversation";
import { readOwnerConversation } from "../../../../../src/features/development-conversations/server/read-owner-conversation";
import type { ParticipantConversationDto } from "../../../../../src/features/development-conversations/server/read-participant-conversation";
import {
  productionOwnerReadDeps,
  productionSetSharedGoalsDeps,
} from "../../../../../src/features/development-conversations/server/owner-route-deps";
import { productionConversationViewDeps } from "../../../../../src/features/development-conversations/server/conversation-view-route-deps";
import { setSharedGoals } from "../../../../../src/features/development-conversations/server/set-shared-goals";
import { updateOwnerSections } from "../../../../../src/features/development-conversations/server/update-owner-sections";
import { verifiedSubject } from "../_auth";
import { readConversationBody } from "../_body";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ conversationId: string }> };

/** Which operation a PATCH key belongs to. A body may name keys from one operation only (one operation per request). */
type PatchGroup = "sections" | "goals" | "participant" | "status";

const PATCH_GROUPS: ReadonlyMap<string, PatchGroup> = new Map<string, PatchGroup>([
  ["title", "sections"],
  ["plannedFor", "sections"],
  ["ownerNotes", "sections"],
  ["nextSteps", "sections"],
  ["sharedGoalIds", "goals"],
  ["participantMemberRef", "participant"],
  ["status", "status"],
]);
const PATCH_KEYS: ReadonlySet<string> = new Set(PATCH_GROUPS.keys());

type PatchPlan =
  | { kind: "sections"; fields: Record<string, unknown> }
  | { kind: "goals"; goalIds: unknown }
  | { kind: "participant"; memberRef: unknown }
  | { kind: "complete" }
  | { kind: "invalid" };

const INVALID_PLAN: PatchPlan = { kind: "invalid" };

/**
 * Conversation detail, delete and patch (SPEC BR-5, BR-14 to BR-19, BR-28, BR-35, BR-47; TASK-023, TASK-024). Thin: the
 * only subject is the uid of the verified bearer token, and the path supplies a conversation id only. The operation picks
 * the owner, accepted participant or pending view. A foreign id and a missing id get the same answer.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const { conversationId } = await params;
  const result = await readConversationForCaller(subject, conversationId, productionConversationViewDeps());
  if (!result.ok) return fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
  return json(viewDto(result.view), 200);
}

/**
 * One owner write per request. The body picks the operation: section keys, `sharedGoalIds`, `participantMemberRef`, or
 * `status: "completed"`. Mixed keys, any other status value and any unknown key are `invalid_input`, with no operation called.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readConversationBody(request, PATCH_KEYS);
  if (!body.ok) return fail(body.error, CONVERSATION_ERROR_STATUS[body.error]);

  const { conversationId } = await params;
  const plan = planPatch(body.body);
  switch (plan.kind) {
    case "invalid":
      return fail("invalid_input", CONVERSATION_ERROR_STATUS.invalid_input);
    case "sections":
      return outcome(await updateOwnerSections(subject, conversationId, plan.fields));
    case "goals":
      return outcome(await setSharedGoals(subject, conversationId, plan.goalIds, productionSetSharedGoalsDeps()));
    case "participant": {
      const result = await changeParticipant(subject, conversationId, { participantMemberRef: plan.memberRef });
      // SPEC Stable errors: a removal with no participant is an idempotent no-op that returns the current owner DTO.
      // Only that confirmed no-op reads the DTO. A real change keeps the `{ ok: true }` body.
      return result.ok && result.noop ? currentOwnerDto(subject, conversationId) : outcome(result);
    }
    case "complete":
      return outcome(await completeConversation(subject, conversationId));
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const { conversationId } = await params;
  return outcome(await deleteConversation(subject, conversationId));
}

/** Chooses the operation for a PATCH body. Keys from two operations, or a `status` other than `completed`, are refused. */
function planPatch(body: Record<string, unknown>): PatchPlan {
  const keys = Object.keys(body);
  const groups = [...new Set(keys.map((key) => PATCH_GROUPS.get(key)))];
  if (groups.length !== 1) return INVALID_PLAN;

  switch (groups[0]) {
    case "sections":
      return { kind: "sections", fields: pick(body, keys) };
    case "goals":
      return { kind: "goals", goalIds: body.sharedGoalIds };
    case "participant":
      return { kind: "participant", memberRef: body.participantMemberRef };
    case "status":
      return body.status === "completed" ? { kind: "complete" } : INVALID_PLAN;
    default:
      return INVALID_PLAN;
  }
}

/** The response for whichever view the operation chose. Each view has its own allow-list (SPEC BR-41, BR-42, BR-43). */
function viewDto(view: ConversationView): Record<string, unknown> {
  switch (view.kind) {
    case "owner":
      return pickOwnerDto(view.dto);
    case "participant":
      return pickParticipantDto(view.dto);
    case "pending":
      return pick(view.dto, PENDING_DTO_KEYS);
  }
}

/** The BR-42 owner DTO, built field by field. Nested participant and goal objects are allow-listed as well. */
function pickOwnerDto(dto: OwnerConversationDto): Record<string, unknown> {
  return {
    ...pick(dto, OWNER_DTO_KEYS),
    participant: pick(dto.participant, OWNER_PARTICIPANT_KEYS),
    sharedGoals: dto.sharedGoals.map((goal) => pick(goal, SHARED_GOAL_DTO_KEYS)),
  };
}

/** The BR-43 participant DTO. There is no uid, membership id or `memberRef` field in its allow-list. */
function pickParticipantDto(dto: ParticipantConversationDto): Record<string, unknown> {
  return {
    ...pick(dto, PARTICIPANT_DTO_KEYS),
    sharedGoals: dto.sharedGoals.map((goal) => pick(goal, SHARED_GOAL_DTO_KEYS)),
  };
}

/** Copies exactly `keys` from `source`. Nothing else is ever spread into a response. */
function pick(source: object, keys: readonly string[]): Record<string, unknown> {
  const record = source as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

/** A write's result: `{ ok: true }` as 200, or the stable code and its SPEC status. Nothing else is returned. */
function outcome(result: { ok: true } | { ok: false; error: ConversationErrorCode }) {
  return result.ok ? json({ ok: true }, 200) : fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
}

/**
 * The current owner DTO after a confirmed no-op (SPEC Stable errors). The same owner read as GET detail, so the same
 * allow-lists apply. A failed read keeps its owner-read code and status: no DTO is invented.
 */
async function currentOwnerDto(ownerUid: string, conversationId: string) {
  const result = await readOwnerConversation(ownerUid, conversationId, productionOwnerReadDeps());
  if (!result.ok) return fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
  return json(pickOwnerDto(result.conversation), 200);
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationErrorCode, status: number) => json({ error }, status);
