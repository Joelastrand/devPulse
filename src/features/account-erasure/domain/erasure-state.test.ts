import { describe, expect, it } from "vitest";
import {
  ERASURE_API_ERROR_CODES,
  ERASURE_RECORD_ERROR_CODES,
  ERASURE_STATUSES,
  ERASURE_STEPS,
  isAllowedStatusTransition,
  isAllowedStepTransition,
  isErasureRecordErrorCode,
  isErasureStatus,
  isErasureStep,
  type ErasureStatus,
} from "./erasure-state";

describe("erasure status transitions", () => {
  const allowed: Array<[ErasureStatus, ErasureStatus]> = [
    ["in_progress", "in_progress"],
    ["in_progress", "auth_deleted"],
    ["auth_deleted", "auth_deleted"],
    ["auth_deleted", "completed"],
    ["completed", "completed"],
  ];

  const forbidden: Array<[ErasureStatus, ErasureStatus]> = [
    ["in_progress", "completed"],
    ["auth_deleted", "in_progress"],
    ["completed", "in_progress"],
    ["completed", "auth_deleted"],
  ];

  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(isAllowedStatusTransition(from, to)).toBe(true);
  });

  it.each(forbidden)("refuses %s -> %s", (from, to) => {
    expect(isAllowedStatusTransition(from, to)).toBe(false);
  });

  it("classifies every ordered pair of statuses exactly once", () => {
    const listed = [...allowed, ...forbidden].map(([from, to]) => `${from}->${to}`);
    const every = ERASURE_STATUSES.flatMap((from) => ERASURE_STATUSES.map((to) => `${from}->${to}`));
    expect([...listed].sort()).toEqual([...every].sort());
  });
});

describe("erasure step transitions", () => {
  it("allows staying on a step and moving forward", () => {
    expect(isAllowedStepTransition("forum", "forum")).toBe(true);
    expect(isAllowedStepTransition("forum", "memberships")).toBe(true);
    expect(isAllowedStepTransition("verify_data", "auth_delete")).toBe(true);
  });

  it("refuses every backward move", () => {
    expect(isAllowedStepTransition("memberships", "forum")).toBe(false);
    expect(isAllowedStepTransition("forum", "conversations_owned")).toBe(false);
    expect(isAllowedStepTransition("forum", "auth_delete")).toBe(false);
    expect(isAllowedStepTransition("verify_data", "final_sweep")).toBe(false);
    expect(isAllowedStepTransition("final_sweep", "auth_delete")).toBe(false);
    expect(isAllowedStepTransition("verify_data", "actor_audit")).toBe(false);
  });

  it("keeps the SPEC step order", () => {
    expect(ERASURE_STEPS).toEqual([
      "forum",
      "memberships",
      "conversations_owned",
      "participant_bindings",
      "locators",
      "personal_data",
      "survey_participations",
      "actor_audit",
      "verify_data",
      "auth_delete",
      "final_sweep",
    ]);
  });
});

describe("closed enums", () => {
  it("exposes exactly the SPEC record error codes", () => {
    expect([...ERASURE_RECORD_ERROR_CODES]).toEqual([
      "payload_unreadable",
      "store_unavailable",
      "auth_unavailable",
      "verification_failed",
      "unexpected",
    ]);
  });

  it("exposes exactly the SPEC API error codes", () => {
    expect([...ERASURE_API_ERROR_CODES]).toEqual([
      "erasure_in_progress",
      "recent_auth_required",
      "confirmation_mismatch",
      "erasure_unavailable",
      "last_superadmin",
    ]);
  });

  it("rejects values outside the enums, including API codes used as record codes", () => {
    expect(isErasureRecordErrorCode("erasure_in_progress")).toBe(false);
    expect(isErasureRecordErrorCode("uid:abc123")).toBe(false);
    expect(isErasureRecordErrorCode("payload_unreadable")).toBe(true);
    expect(isErasureStatus("deleted")).toBe(false);
    expect(isErasureStep("forum")).toBe(true);
    expect(isErasureStep("Forum")).toBe(false);
  });
});
