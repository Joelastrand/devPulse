import { SKILL_TREE_MAX_NODES, SKILL_TREE_MIN_NODES, type SkillNode } from "./skill-tree";

/**
 * Bounds for a SkillTree's `name` (docs/features/team-skill-tree/SPEC.md —
 * "Data model", BR-2): non-empty after trimming, and between these two
 * lengths (inclusive), measured on the trimmed text. Reused unchanged by
 * both `createSkillTree` and `updateSkillTree` (TASK-002) — the same
 * validator applies at creation and at cosmetic correction.
 */
export const SKILL_TREE_NAME_MIN_LENGTH = 3;
export const SKILL_TREE_NAME_MAX_LENGTH = 100;

/**
 * Bounds for a single SkillNode's `label` (docs/features/team-skill-tree/
 * SPEC.md — "Data model", BR-2), measured the same way as
 * `SKILL_TREE_NAME_MIN_LENGTH`/`SKILL_TREE_NAME_MAX_LENGTH`.
 */
export const SKILL_NODE_LABEL_MIN_LENGTH = 3;
export const SKILL_NODE_LABEL_MAX_LENGTH = 100;

export type ValidateSkillTreeNameResult =
  | { ok: true; name: string }
  | { ok: false; error: "invalid_input" };

export type ValidateSkillNodeLabelsResult =
  | { ok: true; labels: string[] }
  | { ok: false; error: "invalid_input" };

/**
 * Validates and normalizes a raw, untrusted SkillTree `name` (docs/
 * features/team-skill-tree/SPEC.md — BR-2). This is the single canonical
 * trim path for a tree's name — callers must use the returned `name`, not
 * re-trim the original input themselves.
 *
 * Rejects (`invalid_input`, never throws): a non-string value; a value that
 * is empty or whitespace-only after trimming; a trimmed length below
 * `SKILL_TREE_NAME_MIN_LENGTH` or above `SKILL_TREE_NAME_MAX_LENGTH`. Never
 * truncates a too-long value — an over-length input is rejected outright,
 * not silently cut down to the limit.
 */
export function validateSkillTreeName(input: unknown): ValidateSkillTreeNameResult {
  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input" };
  }

  const name = input.trim();

  if (name.length < SKILL_TREE_NAME_MIN_LENGTH || name.length > SKILL_TREE_NAME_MAX_LENGTH) {
    return { ok: false, error: "invalid_input" };
  }

  return { ok: true, name };
}

/**
 * Validates and normalizes a raw, untrusted node-label array (docs/
 * features/team-skill-tree/SPEC.md — BR-2, BR-4): an array of
 * `SKILL_TREE_MIN_NODES`-`SKILL_TREE_MAX_NODES` entries, each trimmed to
 * `SKILL_NODE_LABEL_MIN_LENGTH`-`SKILL_NODE_LABEL_MAX_LENGTH` characters.
 * Rejects (`invalid_input`, never throws) a non-array input, an
 * out-of-range entry count, or any entry that isn't a string within the
 * per-label length bounds after trimming.
 *
 * Reused unchanged by both `createSkillTree` and `updateSkillTree`
 * (TASK-002) for per-label text validation. The length-match-to-existing-
 * tree check `updateSkillTree` additionally needs (`nodeLabels.length ===
 * existingTree.nodes.length`) is not part of this validator — it is a
 * cross-check against a specific fetched record, owned by TASK-002's own
 * operation logic.
 */
export function validateSkillNodeLabels(input: unknown): ValidateSkillNodeLabelsResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "invalid_input" };
  }

  if (input.length < SKILL_TREE_MIN_NODES || input.length > SKILL_TREE_MAX_NODES) {
    return { ok: false, error: "invalid_input" };
  }

  const labels: string[] = [];

  for (const rawLabel of input) {
    if (typeof rawLabel !== "string") {
      return { ok: false, error: "invalid_input" };
    }

    const label = rawLabel.trim();

    if (
      label.length < SKILL_NODE_LABEL_MIN_LENGTH ||
      label.length > SKILL_NODE_LABEL_MAX_LENGTH
    ) {
      return { ok: false, error: "invalid_input" };
    }

    labels.push(label);
  }

  return { ok: true, labels };
}

/**
 * Assigns deterministic, position-matching `nodeId`/`order` values to an
 * already-validated array of trimmed labels (docs/features/team-skill-tree/
 * SPEC.md — "Data model", BR-3): `node-<zero-based index>` in submitted
 * order, with `order` equal to that same index. This is the one place tree
 * creation derives node identity — `createSkillTree` (TASK-002) calls this
 * directly; `updateSkillTree` never does, since a cosmetic correction
 * always derives its `nodes` array by positional replacement over the
 * *existing* record instead (SPEC — "Cosmetic tree correction").
 */
export function buildSkillNodes(labels: string[]): SkillNode[] {
  return labels.map((label, index) => ({
    nodeId: `node-${index}`,
    label,
    order: index,
  }));
}
