/**
 * Aggregates and client-side filtering over an already-authorized system list
 * (docs/archive/features/team-system-overview/SPEC.md — BR-11, BR-12, BR-13). Counts
 * only; nothing is persisted, ranked, or attributed to a named person.
 */
import {
  KNOWLEDGE_RISK_LABELS,
  type BusinessCriticality,
  type KnowledgeRiskBand,
  type SystemClassification,
  type SystemType,
} from "./team-system";

/** The subset of a system view these rules read. */
export interface SystemSummaryInput {
  name: string;
  description: string | null;
  knowledgeRisk: KnowledgeRiskBand;
  knowledgeCount: number;
  attention: boolean;
  inGoodStanding: boolean;
  classification: SystemClassification;
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
export type SystemTypeFilter = "all" | SystemType;
export type CriticalityFilter = "all" | BusinessCriticality;

export interface SystemFilter {
  query: string;
  attention: AttentionFilter;
  knowledge: KnowledgeFilter;
  systemType: SystemTypeFilter;
  criticality: CriticalityFilter;
  /** "Kun favoritter": only the current user's favorite systems. Personal, so it is applied with the favorite ids. */
  favoritesOnly: boolean;
}

export const DEFAULT_SYSTEM_FILTER: SystemFilter = {
  query: "",
  attention: "all",
  knowledge: "all",
  systemType: "all",
  criticality: "all",
  favoritesOnly: false,
};

/** The fields filtering reads; a full system view satisfies this structurally. */
export type SystemFilterFields = Pick<
  SystemSummaryInput,
  "name" | "description" | "knowledgeRisk" | "attention" | "classification"
> & { systemId?: string };

/**
 * BR-13: case-insensitive substring over name and description; filters are exact. Never widens the input. `favoriteIds` is
 * the current user's favorite system ids. It is consulted only when `favoritesOnly` is set.
 */
export function filterSystems<T extends SystemFilterFields>(
  systems: readonly T[],
  filter: SystemFilter,
  favoriteIds: ReadonlySet<string> = new Set(),
): T[] {
  const needle = filter.query.trim().toLocaleLowerCase("nb");
  return systems.filter((system) => {
    if (needle.length > 0) {
      const haystack = `${system.name} ${system.description ?? ""}`.toLocaleLowerCase("nb");
      if (!haystack.includes(needle)) return false;
    }
    if (filter.attention === "attention" && !system.attention) return false;
    if (filter.knowledge !== "all" && system.knowledgeRisk !== filter.knowledge) return false;
    if (filter.systemType !== "all" && system.classification.systemType !== filter.systemType) return false;
    if (filter.criticality !== "all" && system.classification.businessCriticality !== filter.criticality) return false;
    if (filter.favoritesOnly && (system.systemId === undefined || !favoriteIds.has(system.systemId))) return false;
    return true;
  });
}

/**
 * Display and sort order, highest risk first. `none` (no known member) is a risk state, not an unknown or a low one,
 * so it sorts first on purpose. Missing risk is never treated as low risk.
 */
export const KNOWLEDGE_BAND_ORDER: readonly KnowledgeRiskBand[] = ["none", "high", "elevated", "lower"];

/** How many filter controls differ from the default: a non-blank search counts as one. Drives the "N aktive filtre" label. */
export function countActiveFilters(filter: SystemFilter): number {
  let count = filter.query.trim().length > 0 ? 1 : 0;
  if (filter.attention !== DEFAULT_SYSTEM_FILTER.attention) count += 1;
  if (filter.knowledge !== DEFAULT_SYSTEM_FILTER.knowledge) count += 1;
  if (filter.systemType !== DEFAULT_SYSTEM_FILTER.systemType) count += 1;
  if (filter.criticality !== DEFAULT_SYSTEM_FILTER.criticality) count += 1;
  if (filter.favoritesOnly) count += 1;
  return count;
}

export { KNOWLEDGE_RISK_LABELS };

/**
 * Sort orders for the system list. They order only the systems already loaded and visible. No numerical score is created.
 * - `name`: Norwegian collation, ties by id.
 * - `risk`: the existing knowledge-risk band order (`KNOWLEDGE_BAND_ORDER`, the same order the filter uses), then name.
 * - `attention`: systems that need follow-up first, then name.
 */
export type SystemSort = "name" | "risk" | "attention";

export const SYSTEM_SORTS: readonly SystemSort[] = ["name", "risk", "attention"];

export interface SystemSortFields {
  readonly systemId: string;
  readonly name: string;
  readonly knowledgeRisk: KnowledgeRiskBand;
  readonly attention: boolean;
}

function bandRank(band: KnowledgeRiskBand): number {
  const index = KNOWLEDGE_BAND_ORDER.indexOf(band);
  return index === -1 ? KNOWLEDGE_BAND_ORDER.length : index;
}

/** Returns a new, stably ordered array. The input array is never mutated. */
export function sortSystems<T extends SystemSortFields>(systems: readonly T[], sort: SystemSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "nb") || a.systemId.localeCompare(b.systemId);
  return systems.slice().sort((a, b) => {
    if (sort === "risk") return bandRank(a.knowledgeRisk) - bandRank(b.knowledgeRisk) || byName(a, b);
    if (sort === "attention") return Number(b.attention) - Number(a.attention) || byName(a, b);
    return byName(a, b);
  });
}
