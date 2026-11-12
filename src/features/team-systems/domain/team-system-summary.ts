/**
 * Aggregates and client-side filtering over an already-authorized system list
 * (docs/archive/features/team-system-overview/SPEC.md — BR-11, BR-12, BR-13). Counts
 * only; nothing is persisted, ranked, or attributed to a named person.
 */
import { KNOWLEDGE_RISK_LABELS, type KnowledgeRiskBand } from "./team-system";

/** The subset of a system view these rules read. */
export interface SystemSummaryInput {
  name: string;
  description: string | null;
  knowledgeRisk: KnowledgeRiskBand;
  knowledgeCount: number;
  attention: boolean;
  inGoodStanding: boolean;
}

export interface TeamSystemSummary {
  total: number;
  inGoodStanding: number;
  needingAttention: number;
  knowledgeRiskCount: number;
  /** Systems per knowledge-risk band (BR-9). */
  byBand: Record<KnowledgeRiskBand, number>;
  /** Systems where exactly one person is the knowledge member (BR-12). Count only; no names. */
  singleKnowledgePersonCount: number;
}

export function summarizeSystems(systems: readonly SystemSummaryInput[]): TeamSystemSummary {
  const byBand: Record<KnowledgeRiskBand, number> = { none: 0, high: 0, elevated: 0, lower: 0 };
  let inGoodStanding = 0;
  let needingAttention = 0;
  let singleKnowledgePersonCount = 0;

  for (const system of systems) {
    byBand[system.knowledgeRisk] += 1;
    if (system.inGoodStanding) inGoodStanding += 1;
    if (system.attention) needingAttention += 1;
    if (system.knowledgeCount === 1) singleKnowledgePersonCount += 1;
  }

  return {
    total: systems.length,
    inGoodStanding,
    needingAttention,
    // BR-11: "Kompetanserisiko" counts systems with at most one knowledgeable member.
    knowledgeRiskCount: byBand.none + byBand.high,
    byBand,
    singleKnowledgePersonCount,
  };
}

export type AttentionFilter = "all" | "attention";
export type KnowledgeFilter = "all" | KnowledgeRiskBand;

export interface SystemFilter {
  query: string;
  attention: AttentionFilter;
  knowledge: KnowledgeFilter;
}

export const DEFAULT_SYSTEM_FILTER: SystemFilter = { query: "", attention: "all", knowledge: "all" };

/** The fields filtering reads; a full system view satisfies this structurally. */
export type SystemFilterFields = Pick<SystemSummaryInput, "name" | "description" | "knowledgeRisk" | "attention">;

/** BR-13: case-insensitive substring over name and description; filters are exact. Never widens the input. */
export function filterSystems<T extends SystemFilterFields>(systems: readonly T[], filter: SystemFilter): T[] {
  const needle = filter.query.trim().toLocaleLowerCase("nb");
  return systems.filter((system) => {
    if (needle.length > 0) {
      const haystack = `${system.name} ${system.description ?? ""}`.toLocaleLowerCase("nb");
      if (!haystack.includes(needle)) return false;
    }
    if (filter.attention === "attention" && !system.attention) return false;
    if (filter.knowledge !== "all" && system.knowledgeRisk !== filter.knowledge) return false;
    return true;
  });
}

export const KNOWLEDGE_BAND_ORDER: readonly KnowledgeRiskBand[] = ["none", "high", "elevated", "lower"];

export { KNOWLEDGE_RISK_LABELS };
