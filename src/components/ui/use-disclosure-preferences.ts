"use client";

import { useState } from "react";

/**
 * Local, per-viewer presentation preferences for collapsible sections. Each section's expanded state is one boolean in
 * `localStorage`, scoped by feature, team and the Firebase account UID. Nothing else is stored: no section content,
 * names, survey results or e-mail addresses.
 *
 * Failures never break rendering. Unavailable or throwing storage falls back to the caller's defaults. With no UID (server
 * rendering, the first client render, sign-out), every section uses its default and nothing is read or written.
 */
export const DISCLOSURE_PREFERENCE_VERSION = 1;
const KEY_PREFIX = "devpulse.view-preference";
const SEPARATOR = "\u0000";

/**
 * Storage key for one section. Every segment is URI-encoded before joining, so a crafted value cannot produce a key that
 * collides with another scope or section.
 */
export function disclosureStorageKey(feature: string, teamId: string, uid: string, sectionId: string): string {
  return [KEY_PREFIX, `v${DISCLOSURE_PREFERENCE_VERSION}`, feature, teamId, uid, sectionId].map(encodeURIComponent).join(":");
}

function readStored(key: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    // Anything else is treated as absent. Obsolete or foreign values never break the UI.
    return null;
  } catch {
    return null;
  }
}

function writeStored(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Storage is unavailable: the in-memory state below still applies for this view.
  }
}

export interface DisclosurePreferences {
  /** The expanded state for `sectionId`: the stored value for this scope, else the default. */
  isOpen: (sectionId: string) => boolean;
  setOpen: (sectionId: string, open: boolean) => void;
  setAll: (sectionIds: readonly string[], open: boolean) => void;
}

interface LoadedValues {
  /** The scope the values belong to. Values for any other scope are never applied. */
  scope: string;
  /** The section IDs they were read for. A change of defaults also re-reads. */
  idsKey: string;
  values: Readonly<Record<string, boolean>>;
}

/**
 * Preferences for one page. `defaults` lists the section IDs this page knows; a stored value for any other ID is ignored,
 * so removed sections cannot affect the UI.
 *
 * Stored values are loaded during rendering, once the scope is known. This follows React's "adjust state when a value
 * changes" pattern: the state is set only when the scope or the section list differs from what was loaded, so it cannot
 * loop. It avoids a state update inside an effect, which would render twice and flash the defaults.
 */
export function useDisclosurePreferences(
  feature: string,
  teamId: string,
  uid: string | null,
  defaults: Readonly<Record<string, boolean>>,
): DisclosurePreferences {
  const idsKey = Object.keys(defaults).join(SEPARATOR);
  const scope = uid === null ? null : [feature, teamId, uid].join(SEPARATOR);
  const [loaded, setLoaded] = useState<LoadedValues | null>(null);

  if (uid !== null && scope !== null && (loaded === null || loaded.scope !== scope || loaded.idsKey !== idsKey)) {
    const values: Record<string, boolean> = {};
    for (const sectionId of idsKey.split(SEPARATOR)) {
      const stored = readStored(disclosureStorageKey(feature, teamId, uid, sectionId));
      if (stored !== null) values[sectionId] = stored;
    }
    setLoaded({ scope, idsKey, values });
  }

  // Values are used only when they were loaded for the current scope. A previous account's or team's values are never
  // applied, even for one render.
  const current = scope !== null && loaded !== null && loaded.scope === scope && loaded.idsKey === idsKey ? loaded.values : null;

  function setAll(sectionIds: readonly string[], open: boolean): void {
    if (uid === null || scope === null) return;
    setLoaded((previous) => {
      const base = previous !== null && previous.scope === scope && previous.idsKey === idsKey ? previous.values : {};
      const next: Record<string, boolean> = { ...base };
      for (const sectionId of sectionIds) next[sectionId] = open;
      return { scope, idsKey, values: next };
    });
    for (const sectionId of sectionIds) {
      writeStored(disclosureStorageKey(feature, teamId, uid, sectionId), open);
    }
  }

  return {
    isOpen: (sectionId) => current?.[sectionId] ?? defaults[sectionId] ?? false,
    setOpen: (sectionId, open) => setAll([sectionId], open),
    setAll,
  };
}
