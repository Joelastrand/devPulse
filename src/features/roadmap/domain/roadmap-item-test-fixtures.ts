import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { openRoadmapItemDocument, toPersistedRoadmapItem } from "./roadmap-item-content-codec";

/**
 * Test-only helpers for stored roadmap plans. A stored plan keeps its business content sealed and its owner as a keyed index,
 * so a fixture that seeds a fake store is built with the same codec the production read path opens. Call
 * `stubRoadmapKey()` once at module load, before a fixture is built.
 */
export function stubRoadmapKey(): void {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
}

/** A plan as stored: the given fields sealed, the owner (when given) indexed. */
export function sealedPlanFixture(teamId: string, treeId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return toPersistedRoadmapItem({ teamId, treeId, ...fields });
}

/** The plaintext view of a stored plan (the owner, when present, is restored from the envelope). */
export function openedPlanFixture(stored: unknown): Record<string, unknown> | null {
  const opened = openRoadmapItemDocument(stored);
  return typeof opened === "object" && opened !== null ? (opened as Record<string, unknown>) : null;
}
