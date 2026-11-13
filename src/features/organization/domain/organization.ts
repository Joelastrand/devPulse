/**
 * The single NVE organization record (docs/DATA-MODEL.md, "Organization").
 *
 * DevPulse is exclusively for NVE, so there is one organization, with the stable id `nve`. The record is descriptive
 * configuration only. It grants nothing: ordinary access is decided by the verified-e-mail and `@nve.no` policy
 * (docs/SECURITY.md), superadmin access by the registry, and team access by team membership. No code path reads this
 * record to authorize anything.
 *
 * The record holds no personal data and no survey data, so it is stored as plain configuration and is not encrypted
 * (docs/DATA-MODEL.md, "Organization", explains the classification).
 */

export const ORGANIZATION_ID = "nve";
export const ORGANIZATION_NAME = "Norges vassdrags- og energidirektorat";
/** The domain the access policy also uses. Kept as a literal here so this module has no import from the auth feature. */
export const ORGANIZATION_EMAIL_DOMAIN = "nve.no";
export const ORGANIZATION_COLLECTION = "organizations";
export const ORGANIZATION_PATH = `${ORGANIZATION_COLLECTION}/${ORGANIZATION_ID}`;

/** The stored shape. Timestamps are set once, at creation. */
export interface OrganizationRecord {
  readonly id: typeof ORGANIZATION_ID;
  readonly name: typeof ORGANIZATION_NAME;
  readonly emailDomain: typeof ORGANIZATION_EMAIL_DOMAIN;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function buildOrganizationRecord(now: Date): OrganizationRecord {
  return {
    id: ORGANIZATION_ID,
    name: ORGANIZATION_NAME,
    emailDomain: ORGANIZATION_EMAIL_DOMAIN,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * True when a stored document has exactly the canonical identity fields. Timestamps are not compared, so re-running the
 * initializer on an existing record is a no-op. Any other shape is a conflict, which the initializer reports and never
 * repairs silently.
 */
export function isCanonicalOrganization(stored: unknown): boolean {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return false;
  const record = stored as Record<string, unknown>;
  return (
    record.id === ORGANIZATION_ID &&
    record.name === ORGANIZATION_NAME &&
    record.emailDomain === ORGANIZATION_EMAIL_DOMAIN
  );
}
