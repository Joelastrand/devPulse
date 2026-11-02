import { describe, expect, it } from "vitest";
import {
  COMPLETED_RECORD_TTL_MS,
  ERASED_ACTOR_MARKER,
  MAX_BATCHES_PER_REQUEST,
  RECENT_AUTH_WINDOW_SECONDS,
  REQUEST_WALL_BUDGET_MS,
  WRITES_PER_BATCH,
} from "./erasure-constants";

/**
 * Pins the SPEC defaults. If one of these values is changed, update the SPEC decision log and this test together
 * (TASKS.md ground rule). A silent change fails here.
 */
describe("erasure defaults", () => {
  it("pins the SPEC values", () => {
    expect(RECENT_AUTH_WINDOW_SECONDS).toBe(300);
    expect(MAX_BATCHES_PER_REQUEST).toBe(10);
    expect(WRITES_PER_BATCH).toBe(100);
    expect(REQUEST_WALL_BUDGET_MS).toBe(20_000);
    expect(COMPLETED_RECORD_TTL_MS).toBe(86_400_000);
    expect(ERASED_ACTOR_MARKER).toBe("erased");
  });
});
