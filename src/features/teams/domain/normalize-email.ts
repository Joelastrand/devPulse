/**
 * Normalizes an email address for storage/matching (trim + lowercase).
 * Used everywhere an email is compared or persisted as a matching key
 * (app-admin allow-list, invitations) so that casing/whitespace never
 * causes a false negative match.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
