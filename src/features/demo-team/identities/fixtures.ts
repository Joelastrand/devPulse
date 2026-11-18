/**
 * The 10 fictional team members shown in the demo team's member list (Phase C, step 2). They are demo-only identities:
 * their Firebase Auth accounts are provisioned DISABLED, without a password, with reserved `example.com` addresses and
 * without custom claims, so they can never sign in or use protected APIs. The presenter remains the team's only real
 * administrator; every fictional member is an ordinary `member`.
 *
 * Pure data and pure builders only: no clock, no randomness, no I/O. UIDs and addresses are fixed, so reruns target the
 * same identities.
 */

export const IDENTITY_UID_PREFIX = "demo-member-";
export const IDENTITY_EMAIL_DOMAIN = "example.com";
/** Audit actor for fixture-provisioned records (same convention as the team seed's `DEMO_AUDIT_ACTOR`). */
export const IDENTITY_AUDIT_ACTOR = "demo-seed";

export interface DemoMemberIdentity {
  uid: string;
  fullName: string;
  email: string;
  specialization: string;
  description: string;
  /** Intended team role. Only ordinary members are fixtures; the presenter is the team's administrator. */
  teamRole: "member";
}

export const DEMO_MEMBER_IDENTITIES: readonly DemoMemberIdentity[] = Object.freeze([
  {
    uid: "demo-member-01",
    fullName: "Ingrid Solberg",
    email: "ingrid.solberg@example.com",
    specialization: "Frontend-utvikler",
    description: "Bygger brukergrensesnitt i React med fokus på ytelse og gjenbrukbare komponenter. Har ansvar for designsystemet i teamets produkter.",
    teamRole: "member",
  },
  {
    uid: "demo-member-02",
    fullName: "Magnus Eriksen",
    email: "magnus.eriksen@example.com",
    specialization: "Backend-utvikler",
    description: "Utvikler API-er og domenelogikk i TypeScript og Node.js. Jobber tett med datamodellen og har ansvar for integrasjonene mot eksterne systemer.",
    teamRole: "member",
  },
  {
    uid: "demo-member-03",
    fullName: "Sara Haugen",
    email: "sara.haugen@example.com",
    specialization: "Fullstack-utvikler",
    description: "Leverer funksjonalitet fra database til brukergrensesnitt. Tar gjerne oppgaver på tvers av frontend og backend for å få ende-til-ende-flyten til å fungere.",
    teamRole: "member",
  },
  {
    uid: "demo-member-04",
    fullName: "Emil Dahl",
    email: "emil.dahl@example.com",
    specialization: "UX- og tilgjengelighetsspesialist",
    description: "Arbeider med brukerundersøkelser, prototyper og WCAG-vurderinger. Sørger for at løsningene fungerer for alle brukere, også med hjelpemidler.",
    teamRole: "member",
  },
  {
    uid: "demo-member-05",
    fullName: "Thea Berg",
    email: "thea.berg@example.com",
    specialization: "Sky- og infrastrukturingeniør",
    description: "Har ansvar for drift av containere, infrastruktur som kode og overvåking. Holder fokus på pålitelighet, kostnad og trygge utrullinger.",
    teamRole: "member",
  },
  {
    uid: "demo-member-06",
    fullName: "Jonas Lund",
    email: "jonas.lund@example.com",
    specialization: "Sikkerhetsingeniør",
    description: "Gjennomgår tilgangsstyring, trusselmodeller og sårbarhetsrapporter. Følger opp sikkerhetskrav fra design til produksjon.",
    teamRole: "member",
  },
  {
    uid: "demo-member-07",
    fullName: "Nora Vik",
    email: "nora.vik@example.com",
    specialization: "Dataingeniør",
    description: "Bygger datapipeliner og analysemodeller for teamets måledata. Har ansvar for kvaliteten og dokumentasjonen av datasettene.",
    teamRole: "member",
  },
  {
    uid: "demo-member-08",
    fullName: "Henrik Strand",
    email: "henrik.strand@example.com",
    specialization: "QA- og testautomatiseringsingeniør",
    description: "Planlegger testdekning og automatiserer regresjonstester i Playwright og Vitest. Følger opp feil fra testmiljø til produksjon.",
    teamRole: "member",
  },
  {
    uid: "demo-member-09",
    fullName: "Mari Aas",
    email: "mari.aas@example.com",
    specialization: "Teknisk arkitekt",
    description: "Holder oversikt over arkitektur, tekniske valg og avhengigheter. Leder arkitekturdiskusjoner og skriver beslutningsnotater.",
    teamRole: "member",
  },
  {
    uid: "demo-member-10",
    fullName: "Lars Bjørnstad",
    email: "lars.bjornstad@example.com",
    specialization: "Produkt- og leveranseansvarlig",
    description: "Prioriterer backlog, følger opp leveranser og er bindeledd mellom teamet og interessentene. Har ansvar for målbare leveransemål.",
    teamRole: "member",
  },
]);

/** Exact `teamMemberships` / `userProfiles` document shapes the fixtures are checked against. */
export interface IdentityMembershipFixture {
  uid: string;
  teamId: string;
  createdAt: Date;
  createdVia: "admin_direct";
  grantedBy: string;
}

export interface IdentityProfileFixture {
  uid: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Fixed uid shape: the prefix plus two digits. Anything else is not a fixture. */
const IDENTITY_UID_PATTERN = /^demo-member-\d{2}$/;
const DOC_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface IdentityFixtureProblem {
  category: "count" | "uid" | "uid-duplicate" | "email-domain" | "email-duplicate" | "email-format" | "name" | "role";
  subject: string;
}

/**
 * Offline fixture validation. Returns every problem found (empty array when valid) and never throws. Also rejects a uid
 * that collides with the presenter.
 */
export function validateDemoMemberIdentities(
  identities: readonly DemoMemberIdentity[] = DEMO_MEMBER_IDENTITIES,
  presenterUid?: string,
): IdentityFixtureProblem[] {
  const problems: IdentityFixtureProblem[] = [];
  if (identities.length !== 10) problems.push({ category: "count", subject: String(identities.length) });

  const uids = new Set<string>();
  const emails = new Set<string>();
  for (const identity of identities) {
    if (!IDENTITY_UID_PATTERN.test(identity.uid) || !DOC_ID_SAFE.test(identity.uid)) {
      problems.push({ category: "uid", subject: identity.uid });
    }
    if (uids.has(identity.uid)) problems.push({ category: "uid-duplicate", subject: identity.uid });
    uids.add(identity.uid);
    if (presenterUid !== undefined && identity.uid === presenterUid) {
      problems.push({ category: "uid-duplicate", subject: identity.uid });
    }

    const at = identity.email.lastIndexOf("@");
    const domain = at === -1 ? "" : identity.email.slice(at + 1);
    if (domain !== IDENTITY_EMAIL_DOMAIN) problems.push({ category: "email-domain", subject: identity.uid });
    if (!/^[a-z]+\.[a-z]+@example\.com$/.test(identity.email)) {
      problems.push({ category: "email-format", subject: identity.uid });
    }
    if (emails.has(identity.email)) problems.push({ category: "email-duplicate", subject: identity.uid });
    emails.add(identity.email);

    if (identity.fullName.trim() !== identity.fullName || identity.fullName.length === 0 || identity.fullName.length > 80) {
      problems.push({ category: "name", subject: identity.uid });
    }
    if (identity.teamRole !== "member") problems.push({ category: "role", subject: identity.uid });
  }
  return problems;
}

/** The Firebase Auth account shape for one fictional member: disabled, no password, no claims. Nothing else. */
export interface IdentityAuthCreateRequest {
  uid: string;
  email: string;
  emailVerified: false;
  disabled: true;
}

export function buildIdentityAuthRequest(identity: DemoMemberIdentity): IdentityAuthCreateRequest {
  return { uid: identity.uid, email: identity.email, emailVerified: false, disabled: true };
}

export function buildIdentityMembership(identity: DemoMemberIdentity, teamId: string, asOf: Date): IdentityMembershipFixture {
  return {
    uid: identity.uid,
    teamId,
    createdAt: asOf,
    createdVia: "admin_direct",
    grantedBy: IDENTITY_AUDIT_ACTOR,
  };
}

export function buildIdentityProfile(identity: DemoMemberIdentity, asOf: Date): IdentityProfileFixture {
  return { uid: identity.uid, displayName: identity.fullName, createdAt: asOf, updatedAt: asOf };
}
