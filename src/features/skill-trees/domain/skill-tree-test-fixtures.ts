import { vi } from "vitest";
import { openSkillProgressDocument, toPersistedSkillProgress } from "../server/skill-progress-content-codec";
import { randomBytes } from "node:crypto";
import { toPersistedSkillTree } from "../domain/skill-tree-content-codec";

/**
 * Test-only helpers for persisted skill-tree documents. A stored tree keeps its name and labels sealed, so a fixture that
 * seeds a fake store must be built with the same codec the production read path opens.
 */
const TEST_KEY_BYTES = randomBytes(32);

export function stubSkillTreeEncryptionKey(): void {
  vi.stubEnv("ENCRYPTION_KEY", TEST_KEY_BYTES.toString("base64"));
}

/**
 * Seals a plain tree fixture. Input that is not shaped like a tree (a malformed fixture a test uses on purpose) is
 * returned unchanged, so the operation under test refuses it as it would refuse any malformed document.
 */
export function sealedSkillTreeFixture(treeId: string, plain: unknown): unknown {
  if (typeof plain !== "object" || plain === null) return plain;
  const candidate = plain as Record<string, unknown>;
  if (typeof candidate.name !== "string" || !Array.isArray(candidate.nodes)) return plain;
  return toPersistedSkillTree(treeId, candidate as Parameters<typeof toPersistedSkillTree>[1]);
}

/**
 * A progress fixture as stored: the stage (`currentNodeId`) sealed. Input without a team, a tree and a stage is returned
 * unchanged, so the operation under test refuses it as it would refuse any malformed document.
 */
export function sealedProgressFixture(plain: unknown): unknown {
  if (typeof plain !== "object" || plain === null) return plain;
  const candidate = plain as Record<string, unknown>;
  if (typeof candidate.teamId !== "string" || typeof candidate.treeId !== "string" || !Object.hasOwn(candidate, "currentNodeId")) {
    return plain;
  }
  return toPersistedSkillProgress(candidate as Parameters<typeof toPersistedSkillProgress>[0]);
}

/** The stage carried by a stored progress update (a `content` envelope without the team or tree in the payload). */
export function stageOfProgressUpdate(teamId: string, treeId: string, update: Record<string, unknown>): unknown {
  const opened = openSkillProgressDocument({ teamId, treeId, ...update }) as Record<string, unknown> | null;
  return opened === null ? undefined : opened.currentNodeId;
}
