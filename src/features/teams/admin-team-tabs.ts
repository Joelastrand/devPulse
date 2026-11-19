/**
 * Tab model for the team administration page (`/admin/teams/[teamId]`).
 *
 * The selected tab lives in the `tab` query parameter. Values are an allowlist: a missing, empty, duplicated or unknown
 * value selects the default tab. Tabs only choose which already-loaded panel is visible. They are not an authorization
 * boundary; every server call stays permission-checked by its own route.
 */

export const ADMIN_TEAM_TAB_IDS = [
  "oversikt",
  "medlemmer",
  "roller",
  "invitasjoner",
  "undersokelser",
  "utfordringer",
  "kompetanse",
] as const;

export type AdminTeamTabId = (typeof ADMIN_TEAM_TAB_IDS)[number];

export const DEFAULT_ADMIN_TEAM_TAB: AdminTeamTabId = "oversikt";

const TAB_ID_SET: ReadonlySet<string> = new Set<string>(ADMIN_TEAM_TAB_IDS);

export function isAdminTeamTabId(value: string): value is AdminTeamTabId {
  return TAB_ID_SET.has(value);
}

/** Exactly one `tab` value selects a tab; anything else falls back to the default. */
export function parseAdminTeamTab(values: readonly string[]): AdminTeamTabId {
  if (values.length !== 1) return DEFAULT_ADMIN_TEAM_TAB;
  const [value] = values;
  return value !== undefined && isAdminTeamTabId(value) ? value : DEFAULT_ADMIN_TEAM_TAB;
}

/**
 * Section ids used by the pre-tab in-page index (`#admin-section-*`). Bookmarks to these anchors open the tab that now
 * contains the section. The section ids themselves are kept on the rendered sections.
 */
const LEGACY_SECTION_TABS: ReadonlyMap<string, AdminTeamTabId> = new Map<string, AdminTeamTabId>([
  ["admin-section-invite", "invitasjoner"],
  ["admin-section-invitations", "invitasjoner"],
  ["admin-section-requests", "invitasjoner"],
  ["admin-section-members", "medlemmer"],
  ["admin-section-roles", "roller"],
  ["admin-section-surveys", "undersokelser"],
  ["admin-section-challenges", "utfordringer"],
  ["admin-section-skills", "kompetanse"],
]);

/** Accepts a hash with or without its leading `#`. */
export function tabForLegacyHash(hash: string): AdminTeamTabId | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return LEGACY_SECTION_TABS.get(id) ?? null;
}

/** Path-only link to a tab. The team id is encoded; no other data goes into the URL. */
export function adminTeamTabHref(teamId: string, tab: AdminTeamTabId): string {
  return `/admin/teams/${encodeURIComponent(teamId)}?tab=${tab}`;
}
