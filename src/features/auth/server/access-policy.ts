import "server-only";
import { isNveEmail } from "../domain/nve-email";

/**
 * The account facts the access policy decides on. They come from the live Firebase Auth record, read on every protected
 * request, never from a client value. The token's `email` can be up to an hour old, so it is not used for this decision.
 */
export interface AccountFacts {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export type AccessDecision =
  | { readonly allowed: true; readonly basis: "nve_email" | "superadmin" }
  | { readonly allowed: false; readonly reason: "email_not_verified" | "email_domain_not_allowed" };

/**
 * DevPulse access policy (docs/SECURITY.md, "NVE access policy"):
 * - the e-mail must be verified; and then
 * - either the address is exactly `@nve.no`, or the UID is an active superadmin in the registry.
 *
 * The superadmin exemption is decided by the registry (`isSuperadmin`), never by the address. The registry is read only
 * when the domain check fails, so ordinary NVE requests do not add a registry read. A failing `isSuperadmin` rejects and
 * the caller fails closed.
 */
export async function decideAccess(
  facts: AccountFacts,
  isSuperadmin: (uid: string) => Promise<boolean>,
): Promise<AccessDecision> {
  if (!facts.emailVerified) return { allowed: false, reason: "email_not_verified" };
  if (isNveEmail(facts.email)) return { allowed: true, basis: "nve_email" };
  if (await isSuperadmin(facts.uid)) return { allowed: true, basis: "superadmin" };
  return { allowed: false, reason: "email_domain_not_allowed" };
}
