/**
 * Browser gateway for the caller's personal Systemoversikt favorites (Phase 2F.1). Requests carry the verified ID token as a
 * bearer credential; the server derives the owner from it. Responses are validated before use, and only error codes are
 * surfaced, never raw response text.
 */

export type FavoriteReadResult =
  | { status: "ok"; systemIds: string[] }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

export type FavoriteWriteError =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "not_found"
  | "erasure_in_progress"
  | "persistence_failed"
  /** No usable response (network or parse): the write may or may not have happened. */
  | "request_failed";

export type FavoriteWriteResult = { ok: true; favorite: boolean } | { ok: false; error: FavoriteWriteError };

const WRITE_ERRORS: readonly string[] = [
  "unauthenticated",
  "forbidden",
  "team_disabled",
  "invalid_request",
  "not_found",
  "erasure_in_progress",
  "persistence_failed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function favoritesUrl(teamId: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}/system-favorites`;
}

export async function fetchSystemFavorites(idToken: string, teamId: string): Promise<FavoriteReadResult> {
  try {
    const response = await fetch(favoritesUrl(teamId), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    const parsed = await readJson(response);
    if (response.ok && isRecord(parsed) && Array.isArray(parsed.systemIds) && parsed.systemIds.every((id) => typeof id === "string")) {
      return { status: "ok", systemIds: [...parsed.systemIds] as string[] };
    }
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    return { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

/**
 * Sets the favorite state for one system. The caller names the desired state, so a repeated call is harmless. A success is
 * reported only from the server's answer; the UI must not show it before this resolves.
 */
export async function setSystemFavorite(
  idToken: string,
  teamId: string,
  systemId: string,
  favorite: boolean,
): Promise<FavoriteWriteResult> {
  try {
    const response = await fetch(`${favoritesUrl(teamId)}/${encodeURIComponent(systemId)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    });
    const parsed = await readJson(response);
    if (response.ok && isRecord(parsed) && parsed.favorite === favorite) {
      return { ok: true, favorite };
    }
    if (isRecord(parsed) && typeof parsed.error === "string" && WRITE_ERRORS.includes(parsed.error)) {
      return { ok: false, error: parsed.error as FavoriteWriteError };
    }
    if (response.status === 401) return { ok: false, error: "unauthenticated" };
    if (response.status === 403) return { ok: false, error: "forbidden" };
    return { ok: false, error: "request_failed" };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}
