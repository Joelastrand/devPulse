/**
 * Client gateway for the signed-in user's own display name (docs/features/
 * member-identity-and-team-roles/SPEC.md — BR-1 through BR-3): thin `fetch`
 * wrappers around `GET`/`PUT`/`DELETE /api/me/profile`. The subject is
 * always the token's own identity — no `uid` or e-mail is ever sent. Each
 * parser trusts the response body's own semantic shape and fails safely to a
 * generic `"read_failed"`/`"unknown"` rather than fabricating or partially
 * rendering untrusted data. The server remains the only authority on what a
 * valid name is; nothing here validates it.
 */

export type FetchOwnProfileResult =
  | { status: "ok"; displayName: string | null }
  | { status: "unauthenticated" | "read_failed" };

export type SaveOwnProfileResult =
  | { ok: true; displayName: string }
  | { ok: false; error: "unauthenticated" | "invalid_input" | "persistence_failed" | "unknown" };

export type RemoveOwnProfileResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "persistence_failed" | "unknown" };

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorCodeOf(status: number, body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const { error } = body as { error?: unknown };
    if (typeof error === "string") {
      return error;
    }
  }
  return status === 401 ? "unauthenticated" : undefined;
}

function isDisplayNameValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function parseFetchResponse(status: number, body: unknown): FetchOwnProfileResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { displayName } = body as { displayName?: unknown };
    if (isDisplayNameValue(displayName)) {
      return { status: "ok", displayName };
    }
  }
  return errorCodeOf(status, body) === "unauthenticated" ? { status: "unauthenticated" } : { status: "read_failed" };
}

function parseSaveResponse(status: number, body: unknown): SaveOwnProfileResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { displayName } = body as { displayName?: unknown };
    if (typeof displayName === "string" && displayName.length > 0) {
      return { ok: true, displayName };
    }
  }
  const code = errorCodeOf(status, body);
  if (code === "unauthenticated" || code === "invalid_input" || code === "persistence_failed") {
    return { ok: false, error: code };
  }
  return { ok: false, error: "unknown" };
}

function parseRemoveResponse(status: number, body: unknown): RemoveOwnProfileResult {
  if (status === 200 && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
    return { ok: true };
  }
  const code = errorCodeOf(status, body);
  if (code === "unauthenticated" || code === "persistence_failed") {
    return { ok: false, error: code };
  }
  return { ok: false, error: "unknown" };
}

export interface OwnProfileGateway {
  fetchOwnProfile(idToken: string): Promise<FetchOwnProfileResult>;
  saveOwnProfile(idToken: string, displayName: string): Promise<SaveOwnProfileResult>;
  removeOwnProfile(idToken: string): Promise<RemoveOwnProfileResult>;
}

const PROFILE_URL = "/api/me/profile";

function getDefaultGateway(): OwnProfileGateway {
  return {
    async fetchOwnProfile(idToken) {
      try {
        const response = await fetch(PROFILE_URL, { headers: { Authorization: `Bearer ${idToken}` } });
        return parseFetchResponse(response.status, await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
    async saveOwnProfile(idToken, displayName) {
      try {
        const response = await fetch(PROFILE_URL, {
          method: "PUT",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        });
        return parseSaveResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
    async removeOwnProfile(idToken) {
      try {
        const response = await fetch(PROFILE_URL, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseRemoveResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface OwnProfileGatewayDeps {
  gateway?: OwnProfileGateway;
}

/** Reads the caller's own display name; `displayName: null` (no name set) is a normal, successful result. */
export async function fetchOwnProfile(idToken: string, deps: OwnProfileGatewayDeps = {}): Promise<FetchOwnProfileResult> {
  return (deps.gateway ?? getDefaultGateway()).fetchOwnProfile(idToken);
}

/** Saves the caller's display name; on success `displayName` is the server's canonical (normalised) value. */
export async function saveOwnProfile(
  idToken: string,
  displayName: string,
  deps: OwnProfileGatewayDeps = {},
): Promise<SaveOwnProfileResult> {
  return (deps.gateway ?? getDefaultGateway()).saveOwnProfile(idToken, displayName);
}

/** Removes only the caller's display name (`userProfiles/{uid}`) — not an account deletion. */
export async function removeOwnProfile(idToken: string, deps: OwnProfileGatewayDeps = {}): Promise<RemoveOwnProfileResult> {
  return (deps.gateway ?? getDefaultGateway()).removeOwnProfile(idToken);
}
