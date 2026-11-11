"use client";

/**
 * The signed-in person's own formal organizational role (`GET /api/me/role-assignment`). Only title and description are
 * returned; the server takes the subject from the verified token. The body is untrusted input, so only a fully shaped
 * response is accepted.
 */
export type OwnFormalRole = { status: "none" } | { status: "assigned"; title: string; description: string };

export type FetchOwnFormalRoleResult =
  | { status: "ok"; role: OwnFormalRole }
  | { status: "unauthenticated" }
  | { status: "read_failed" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseOwnFormalRole(body: unknown): OwnFormalRole | undefined {
  if (!isRecord(body)) return undefined;
  if (body.status === "none") return { status: "none" };
  if (body.status === "assigned" && typeof body.title === "string" && typeof body.description === "string") {
    return { status: "assigned", title: body.title, description: body.description };
  }
  return undefined;
}

/** Fetches the signed-in person's formal role. The server re-verifies the token on every call. */
export async function fetchOwnFormalRole(idToken: string): Promise<FetchOwnFormalRoleResult> {
  try {
    const response = await fetch("/api/me/role-assignment", {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "read_failed" };
    const role = parseOwnFormalRole(await response.json());
    return role ? { status: "ok", role } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}
