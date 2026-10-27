import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_DTO_KEYS,
  OWNER_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_DTO_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  PENDING_DTO_KEYS,
  RECOVERY_ITEM_KEYS,
  SHARED_GOAL_DTO_KEYS,
} from "./dto-keys";

const ALLOW_LISTS = {
  PENDING_DTO_KEYS,
  OWNER_PARTICIPANT_KEYS,
  SHARED_GOAL_DTO_KEYS,
  OWNER_DTO_KEYS,
  PARTICIPANT_DTO_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  RECOVERY_ITEM_KEYS,
} as const;

describe("DTO key allow-lists (BR-41…BR-44)", () => {
  it("pins the pending DTO to the approved keys", () => {
    expect([...PENDING_DTO_KEYS]).toEqual(["conversationId", "state", "teamName", "invitedAt", "ownerDisplayName"]);
  });

  it("pins the owner DTO to the approved keys", () => {
    expect([...OWNER_DTO_KEYS]).toEqual([
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
    ]);
  });

  it("pins the participant DTO without the team id and with the owner display name", () => {
    expect([...PARTICIPANT_DTO_KEYS]).not.toContain("teamId");
    expect([...PARTICIPANT_DTO_KEYS]).toContain("ownerDisplayName");
  });

  it("pins the owner participant sub-object and the snapshot shape", () => {
    expect([...OWNER_PARTICIPANT_KEYS]).toEqual(["state", "displayName"]);
    expect([...SHARED_GOAL_DTO_KEYS]).toEqual(["goalTitle", "areaName", "targetDate", "status", "capturedAt"]);
  });

  it("pins the list summaries and the recovery item", () => {
    expect([...OWNER_SUMMARY_KEYS]).toEqual([
      "conversationId",
      "title",
      "status",
      "plannedFor",
      "participant",
      "sharedGoalCount",
      "createdAt",
      "updatedAt",
    ]);
    expect([...PARTICIPANT_SUMMARY_KEYS]).toEqual(["conversationId", "state", "title", "teamName", "invitedAt"]);
    expect([...RECOVERY_ITEM_KEYS]).toEqual(["conversationId"]);
  });

  it("never includes a forbidden identity or membership key in any allow-list", () => {
    for (const [name, keys] of Object.entries(ALLOW_LISTS)) {
      for (const forbidden of FORBIDDEN_DTO_KEYS) {
        expect(keys as readonly string[], `${name} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("pins the BR-46 forbidden concepts, so the list cannot be narrowed silently", () => {
    // One representative key per BR-46 concept: identity, membership, roles and admin markers, private notes,
    // performance vocabulary, engagement telemetry, and encrypted persistence internals.
    for (const key of [
      "uid",
      "ownerUid",
      "participantUid",
      "email",
      "memberRef",
      "participantMemberRef",
      "membershipId",
      "role",
      "isLead",
      "isAdmin",
      "managerNotes",
      "adminNotes",
      "privateNotes",
      "score",
      "rating",
      "rank",
      "progress",
      "level",
      "readReceipt",
      "lastViewed",
      "ciphertext",
      "iv",
      "authTag",
      "keyVersion",
    ]) {
      expect(FORBIDDEN_DTO_KEYS as readonly string[], key).toContain(key);
    }
  });

  it("forbids nothing that is a legitimate DTO key of this feature", () => {
    const allowed = new Set<string>([
      ...PENDING_DTO_KEYS,
      ...OWNER_DTO_KEYS,
      ...PARTICIPANT_DTO_KEYS,
      ...OWNER_SUMMARY_KEYS,
      ...PARTICIPANT_SUMMARY_KEYS,
      ...RECOVERY_ITEM_KEYS,
      ...SHARED_GOAL_DTO_KEYS,
      ...OWNER_PARTICIPANT_KEYS,
    ]);
    for (const forbidden of FORBIDDEN_DTO_KEYS) {
      expect(allowed.has(forbidden), forbidden).toBe(false);
    }
  });

  it("has no duplicate keys within any allow-list", () => {
    for (const [name, keys] of Object.entries(ALLOW_LISTS)) {
      expect(new Set(keys).size, name).toBe(keys.length);
    }
  });
});
