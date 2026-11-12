/**
 * The only e-mail domain eligible for ordinary DevPulse access (docs/SECURITY.md, NVE access policy).
 *
 * Exact, normalized comparison only: the address is trimmed and lower-cased, split at its last `@`, and the domain must
 * equal `nve.no` exactly. A substring or suffix match is never used, so `person@nve.no.attacker.com` and
 * `person@fake-nve.no` are rejected. This is a pure check for UX and server policy; it does not prove ownership of the
 * address. Ownership comes from Firebase Auth's verified-email flag, which the server checks separately.
 */
export const NVE_EMAIL_DOMAIN = "nve.no";

export function isNveEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (/\s/.test(normalized)) return false;

  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;

  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (localPart.includes("@")) return false;

  return domain === NVE_EMAIL_DOMAIN;
}
