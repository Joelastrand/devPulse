/**
 * Exact response key allow-lists (SPEC BR-41…BR-44). Route and mapper code builds each DTO field by field from
 * these lists; nothing is spread from a stored object. Keys are listed here so tests can pin them.
 *
 * Owner and participant DTOs never carry a uid, e-mail, membership id or `memberRef` (BR-42, BR-43, BR-46).
 * The owner's `teamId` is an opaque team identifier and is allowed.
 */

export const PENDING_DTO_KEYS = [
  "conversationId",
  "state",
  "teamName",
  "invitedAt",
  "ownerDisplayName",
] as const;

/** `participant` sub-object of the owner DTO and summary (BR-42, BR-44). */
export const OWNER_PARTICIPANT_KEYS = ["state", "displayName"] as const;

/** One goal snapshot as returned to either party (BR-42, BR-43). */
export const SHARED_GOAL_DTO_KEYS = [
  "goalTitle",
  "areaName",
  "targetDate",
  "status",
  "capturedAt",
] as const;

export const OWNER_DTO_KEYS = [
  "conversationId",
  "title",
  "status",
  "plannedFor",
  "teamId",
  "participant",
  "ownerNotes",
  "nextSteps",
  "participantNotes",
  "sharedGoals",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const;

export const PARTICIPANT_DTO_KEYS = [
  "conversationId",
  "title",
  "status",
  "plannedFor",
  "teamName",
  "ownerDisplayName",
  "ownerNotes",
  "nextSteps",
  "participantNotes",
  "sharedGoals",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const;

export const OWNER_SUMMARY_KEYS = [
  "conversationId",
  "title",
  "status",
  "plannedFor",
  "participant",
  "sharedGoalCount",
  "createdAt",
  "updatedAt",
] as const;

export const PARTICIPANT_SUMMARY_KEYS = [
  "conversationId",
  "state",
  "title",
  "teamName",
  "invitedAt",
] as const;

/** Delete-only recovery item for an owner document that cannot be shown (BR-33, BR-44). */
export const RECOVERY_ITEM_KEYS = ["conversationId"] as const;

/**
 * Keys that must never appear in any DTO allow-list above (SPEC BR-46, BR-42, BR-43), grouped by the BR-46
 * concept they guard. Tests pin this list and assert that no allow-list contains any of its keys, so a later
 * edit that adds one fails in the domain layer rather than in a route.
 */
export const FORBIDDEN_DTO_KEYS = [
  // Identity and membership (BR-42, BR-43, BR-46): raw uids, e-mail, membership ids, member references.
  "uid",
  "ownerUid",
  "participantUid",
  "email",
  "memberRef",
  "participantMemberRef",
  "membershipId",
  "membershipDocId",
  "grantedBy",
  "roleUpdatedBy",
  "createdBy",
  "updatedBy",
  // Roles and admin markers (BR-46): no lead, manager or admin flag or note.
  "role",
  "isLead",
  "isAdmin",
  "lead",
  "manager",
  "admin",
  "managerNotes",
  "adminNotes",
  "leadNotes",
  // Hidden or private notes (SPEC D2-SI-6): no owner-only or participant-only text field.
  "privateNotes",
  "internalNotes",
  "ownerOnlyNotes",
  "participantOnlyNotes",
  "assessment",
  // Performance and surveillance vocabulary (BR-46).
  "score",
  "rating",
  "rank",
  "progress",
  "progressPercent",
  "onTrack",
  "level",
  "performance",
  "productivity",
  "activityCount",
  // Engagement telemetry (BR-46).
  "readReceipt",
  "lastViewed",
  "lastViewedAt",
  "viewedAt",
  // Encrypted persistence internals (BR-51): ciphertext, IV, tag, key version and the payload itself.
  "ciphertext",
  "iv",
  "authTag",
  "keyVersion",
  "content",
] as const;
