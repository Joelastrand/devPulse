import "server-only";
import { authRefusalStatus, isAuthRefusal } from "../../auth/server/auth-refusal";
import type { ListSuperadminsResult, RevokeSuperadminResult, GrantSuperadminResult, SuperadminOperationError } from "./superadmin-operations";

/**
 * HTTP mapping for the superadmin management routes. Kept out of the route files (Next route files export only HTTP methods),
 * so the status contract is one tested function. Bodies carry only fixed codes, UIDs and grant times, never an e-mail address.
 */

const BEARER_PATTERN = /^Bearer (.+)$/;

export function bearerTokenFrom(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

export function superadminErrorStatus(error: SuperadminOperationError): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  switch (error) {
    case "forbidden":
      return 403;
    case "invalid_input":
      return 400;
    case "target_not_found":
      return 404;
    case "target_unverified":
    case "target_disabled":
    case "not_superadmin":
    case "last_superadmin":
    case "already_superadmin_bootstrap_refused":
      return 409;
    case "persistence_failed":
      return 500;
  }
}

export function grantResponse(result: Extract<GrantSuperadminResult, { ok: true }>) {
  return { outcome: result.outcome, uid: result.targetUid };
}

export function revokeResponse(result: Extract<RevokeSuperadminResult, { ok: true }>) {
  return { outcome: "revoked", uid: result.targetUid };
}

export function listResponse(result: Extract<ListSuperadminsResult, { ok: true }>) {
  return {
    superadmins: result.superadmins.map((entry) => ({
      uid: entry.uid,
      grantedAt: entry.grantedAt === null ? null : entry.grantedAt.toISOString(),
    })),
  };
}
