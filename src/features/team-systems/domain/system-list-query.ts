/**
 * Systemoversikt browsing state in the URL (Phase 2F.1). Only non-sensitive view state is carried: search text, the filter
 * choices, the favorites-only switch and the number of rows shown. No system names, descriptions, ids, tokens or user ids
 * ever enter the query string.
 *
 * Parsing is total: every unknown or malformed value falls back to its default, so a hand-edited URL shows the default list
 * and never an error. Serialization writes only the keys that differ from the default, so the default list has a clean URL.
 */
import {
  BUSINESS_CRITICALITIES,
  SYSTEM_TYPES,
  type BusinessCriticality,
  type SystemType,
} from "./team-system";
import {
  DEFAULT_SYSTEM_FILTER,
  KNOWLEDGE_BAND_ORDER,
  SYSTEM_SORTS,
  type CriticalityFilter,
  type KnowledgeFilter,
  type SystemFilter,
  type SystemSort,
  type SystemTypeFilter,
} from "./team-system-summary";

export const SYSTEM_PAGE_SIZE_STEP = 10;
export const SYSTEM_PAGE_SIZE_MAX = 500;
const QUERY_MAX_LENGTH = 100;

/** The URL keys. Short and stable; the names are part of the shareable link format. */
export const SYSTEM_QUERY_KEYS = {
  query: "q",
  systemType: "plassering",
  attention: "oppfolging",
  knowledge: "kompetanse",
  criticality: "kritikalitet",
  favoritesOnly: "favoritter",
  pageSize: "vis",
  sort: "sortering",
} as const;

export interface SystemListState {
  filter: SystemFilter;
  /** Rows shown from the start of the filtered list. A multiple of `SYSTEM_PAGE_SIZE_STEP`, at most `SYSTEM_PAGE_SIZE_MAX`. */
  pageSize: number;
  /** The order of the loaded, visible systems. `name` is the default and is not written to the URL. */
  sort: SystemSort;
}

export const DEFAULT_SYSTEM_LIST_STATE: SystemListState = {
  filter: DEFAULT_SYSTEM_FILTER,
  pageSize: SYSTEM_PAGE_SIZE_STEP,
  sort: "name",
};

type ParamSource = { get(name: string): string | null };

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function parsePageSize(value: string | null): number {
  if (value === null || !/^\d{1,4}$/.test(value)) return SYSTEM_PAGE_SIZE_STEP;
  const size = Number(value);
  if (size < SYSTEM_PAGE_SIZE_STEP || size > SYSTEM_PAGE_SIZE_MAX || size % SYSTEM_PAGE_SIZE_STEP !== 0) {
    return SYSTEM_PAGE_SIZE_STEP;
  }
  return size;
}

/** Reads the list state from any `get`-capable parameter source (`URLSearchParams`, Next's read-only params). Total. */
export function parseSystemListQuery(params: ParamSource): SystemListState {
  const query = (params.get(SYSTEM_QUERY_KEYS.query) ?? "").slice(0, QUERY_MAX_LENGTH);
  const systemType: SystemTypeFilter = pick<SystemType>(params.get(SYSTEM_QUERY_KEYS.systemType), SYSTEM_TYPES) ?? "all";
  const attention = params.get(SYSTEM_QUERY_KEYS.attention) === "attention" ? "attention" : "all";
  const knowledge: KnowledgeFilter = pick(params.get(SYSTEM_QUERY_KEYS.knowledge), KNOWLEDGE_BAND_ORDER) ?? "all";
  const criticality: CriticalityFilter =
    pick<BusinessCriticality>(params.get(SYSTEM_QUERY_KEYS.criticality), BUSINESS_CRITICALITIES) ?? "all";
  return {
    filter: {
      query,
      attention,
      knowledge,
      systemType,
      criticality,
      favoritesOnly: params.get(SYSTEM_QUERY_KEYS.favoritesOnly) === "1",
    },
    pageSize: parsePageSize(params.get(SYSTEM_QUERY_KEYS.pageSize)),
    sort: pick<SystemSort>(params.get(SYSTEM_QUERY_KEYS.sort), SYSTEM_SORTS) ?? "name",
  };
}

/** The query string without a leading `?`, holding only the keys that differ from the default. Empty for the default list. */
export function serializeSystemListQuery(state: SystemListState): string {
  const params = new URLSearchParams();
  const { filter } = state;
  if (filter.query.trim().length > 0) params.set(SYSTEM_QUERY_KEYS.query, filter.query.slice(0, QUERY_MAX_LENGTH));
  if (filter.systemType !== "all") params.set(SYSTEM_QUERY_KEYS.systemType, filter.systemType);
  if (filter.attention !== "all") params.set(SYSTEM_QUERY_KEYS.attention, filter.attention);
  if (filter.knowledge !== "all") params.set(SYSTEM_QUERY_KEYS.knowledge, filter.knowledge);
  if (filter.criticality !== "all") params.set(SYSTEM_QUERY_KEYS.criticality, filter.criticality);
  if (filter.favoritesOnly) params.set(SYSTEM_QUERY_KEYS.favoritesOnly, "1");
  if (state.pageSize !== SYSTEM_PAGE_SIZE_STEP) params.set(SYSTEM_QUERY_KEYS.pageSize, String(state.pageSize));
  if (state.sort !== "name") params.set(SYSTEM_QUERY_KEYS.sort, state.sort);
  return params.toString();
}

/**
 * The list route for a team, with the given state. `teamId` is URL-encoded and is the only path input; the query is rebuilt
 * from known keys, so the result can never leave the team's Systemoversikt route.
 */
export function systemsListHref(teamId: string, state: SystemListState): string {
  const base = `/teams/${encodeURIComponent(teamId)}/systems`;
  const query = serializeSystemListQuery(state);
  return query.length > 0 ? `${base}?${query}` : base;
}

/** The `from` parameter value a detail link carries, so its back link can restore the list. */
export function fromParamValue(state: SystemListState): string {
  return serializeSystemListQuery(state);
}

/** The list state a detail page should return to, read from its `from` parameter. Invalid or missing input is the default. */
export function returnStateFrom(raw: string | null): SystemListState {
  return parseSystemListQuery(new URLSearchParams(raw ?? ""));
}
