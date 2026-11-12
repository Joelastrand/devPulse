import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of a skill tree's authored content in `skillTrees/{treeId}`: the tree name and every node label. They are
 * sealed together as one v2 envelope bound to `skill-tree:<treeId>`, so the content cannot be moved to another tree.
 *
 * Plaintext stays for the tree identifier, the stable node identifiers and their order (the hierarchy that progress,
 * roadmap targets and team needs refer to), and the audit fields. No label or name is persisted in plaintext, not even
 * as a duplicate.
 *
 * Fail-closed: a document without a valid envelope, or whose envelope fails authentication, opens as `null`, which the
 * domain validator refuses. A document that still carries a plaintext name or label is refused the same way.
 */

export const SKILL_TREE_CONTENT_FIELD = "content";
export type SealSkillTreeContent = (plaintext: string, context: string) => RecordEnvelope;
export type OpenSkillTreeContent = (envelope: RecordEnvelope, context: string) => string;

export function skillTreeContext(treeId: string): string {
  return `skill-tree:${treeId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface AuthoredNode {
  nodeId: string;
  label: string;
}

/**
 * Persisted shape of one skill tree: structural node metadata (`nodeId`, `order`) plaintext, the name and labels sealed.
 * `record` is a domain tree record; the seal function is injectable for seeders that use their own crypto.
 */
export function toPersistedSkillTree(
  treeId: string,
  record: { name: string; nodes: { nodeId: string; label: string; order: number }[] } & Record<string, unknown>,
  seal: SealSkillTreeContent = encryptRecord,
): Record<string, unknown> {
  const { name, nodes, ...metadata } = record;
  const structure = nodes.map(({ nodeId, order }) => ({ nodeId, order }));
  const authored = { name, nodes: nodes.map(({ nodeId, label }) => ({ nodeId, label })) };
  return {
    ...metadata,
    nodes: structure,
    [SKILL_TREE_CONTENT_FIELD]: seal(JSON.stringify(authored), skillTreeContext(treeId)),
  };
}

/**
 * Opens a stored skill tree back to its domain shape (name and labels restored). Returns `undefined` for an absent
 * document and `null` when it cannot be opened, when a plaintext name or label is present, or when the sealed node set does
 * not match the plaintext node structure.
 */
export function openSkillTreeDocument(treeId: string, data: unknown, open: OpenSkillTreeContent = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [SKILL_TREE_CONTENT_FIELD]: sealed, nodes, ...metadata } = data;
  if (Object.hasOwn(metadata, "name")) return null;
  if (!Array.isArray(nodes)) return null;
  const authored = openAuthored(treeId, sealed, open);
  if (authored === null) return null;
  const labelById = new Map(authored.nodes.map((node) => [node.nodeId, node.label]));
  const restoredNodes: { nodeId: unknown; order: unknown; label: string }[] = [];
  for (const node of nodes) {
    if (!isPlainRecord(node) || Object.hasOwn(node, "label")) return null;
    const label = labelById.get(String(node.nodeId));
    if (label === undefined) return null;
    restoredNodes.push({ nodeId: node.nodeId, order: node.order, label });
  }
  if (restoredNodes.length !== authored.nodes.length) return null;
  return { ...metadata, name: authored.name, nodes: restoredNodes };
}

function openAuthored(treeId: string, value: unknown, open: OpenSkillTreeContent): { name: string; nodes: AuthoredNode[] } | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, skillTreeContext(treeId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed) || typeof parsed.name !== "string" || !Array.isArray(parsed.nodes)) return null;
  const nodes = parsed.nodes.filter(isPlainRecord).map((node) => ({ nodeId: String(node.nodeId), label: String(node.label) }));
  return { name: parsed.name, nodes };
}
