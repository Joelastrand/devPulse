/**
 * Norwegian user-facing copy for the authenticated teams screens
 * (`app/teams/page.tsx`, `app/teams/[teamId]/page.tsx`, `TeamsOverview`,
 * `TeamDetail`), per the copy-module convention established in TASK-001
 * (docs/features/product-ux-shell/SPEC.md — BR-2).
 *
 * `requestAccessError` is shared by both `TeamsOverview` and `TeamDetail`
 * (via `request-access-messages.ts`) so the request-access affordance reads
 * identically wherever it appears — same non-sensitive wording as before
 * this task, only translated (BR-16 is unaffected: no new information is
 * disclosed).
 */
export const teamsCopy = {
  overview: {
    pageTitle: "Team",
    pageDescription: "Alle aktive team og din egen relasjon til dem.",
    loading: "Laster oversikt over team…",
    signInPrompt: "for å se oversikten over team.",
    signInLink: "Logg inn",
    error: "Noe gikk galt under lasting av team. Prøv igjen senere.",
    empty: "Ingen team er tilgjengelige ennå.",
  },
  detail: {
    loading: "Laster team…",
    signInPrompt: "for å se dette teamet.",
    signInLink: "Logg inn",
    error: "Noe gikk galt under lasting av dette teamet. Prøv igjen senere.",
    resultsUnavailable:
      "Noe gikk galt under lasting av teamets resultater. Prøv igjen senere.",
    fallbackName: "Team",
    /**
     * The two presentation-only visual zones `TeamDetail` groups its
     * already-rendered sections into (docs/features/ui-refresh/SPEC.md —
     * BR-15) — purely a heading/grouping label, never a new data concept,
     * route, or fetch boundary.
     */
    resultaterHeading: "Resultater",
    teamaktivitetHeading: "Teamaktivitet",
    relationshipMessages: {
      none: "Du har ikke tilgang til dette teamets resultater ennå.",
      request_pending:
        "Forespørselen din om å bli med i dette teamet venter på godkjenning.",
      request_rejected:
        "Den forrige forespørselen din om å bli med i dette teamet ble ikke godkjent.",
    },
  },
  /** The collapsed, read-only member roster on `/teams/[teamId]` (docs/features/member-identity-and-team-roles/SPEC.md — BR-31). */
  roster: {
    title: "Medlemmer",
    toggleButton: "Medlemsliste",
    listLabel: "Medlemmer i teamet",
    loading: "Laster medlemmer…",
    error: "Noe gikk galt under lasting av medlemmene. Prøv igjen.",
    forbidden: "Du har ikke tilgang til å se medlemmene i dette teamet.",
    retryButton: "Prøv igjen",
    empty: "Ingen medlemmer å vise.",
    unnamedMember: "Medlem uten navn",
    leadLabel: "Teamlead",
    selfLabel: "Deg",
    truncated: "Listen viser bare de første medlemmene og er ikke fullstendig.",
  },
  relationshipLabels: {
    admin: "Admin",
    member: "Medlem",
    request_pending: "Forespørsel venter",
    request_rejected: "Forespørsel avvist",
    none: "Ikke medlem",
  },
  requestAccess: "Be om tilgang",
  requestingAccess: "Sender forespørsel…",
  requestAccessError: {
    teamDisabled: "Dette teamet er for øyeblikket deaktivert.",
    unverified: "Bekreft e-posten din for å be om tilgang.",
    generic: "Noe gikk galt. Prøv igjen.",
  },
} as const;

/**
 * Norwegian user-facing copy for the admin screens
 * (`app/admin/teams/page.tsx`, `app/admin/teams/[teamId]/page.tsx`,
 * `AdminTeams`, `AdminTeamDetail`), per the copy-module convention
 * established in TASK-001 (docs/features/product-ux-shell/SPEC.md — BR-2).
 *
 * `forbidden` is deliberately generic on both screens — it must never
 * confirm or deny whether the caller's email is on the server-only
 * `APP_ADMIN_EMAILS` allow-list (docs/features/team-management/SPEC.md —
 * BR-15/BR-16), so localizing it must not make it any more specific than
 * the English wording it replaces.
 */
export const adminCopy = {
  teams: {
    pageTitle: "Admin: Team",
    pageDescription: "Opprett team, og aktiver eller deaktiver eksisterende.",
    loading: "Laster team…",
    signInPrompt: "for å administrere team.",
    signInLink: "Logg inn",
    forbidden: "Du har ikke tilgang til denne siden.",
    error: "Noe gikk galt under lasting av team. Prøv igjen senere.",
    empty: "Ingen team ennå.",
    newTeamButton: "Nytt team",
    newTeamNameLabel: "Nytt teamnavn",
    createButton: "Opprett team",
    creatingButton: "Oppretter…",
    cancelButton: "Avbryt",
    createError: {
      invalidName: "Skriv inn et teamnavn.",
      generic: "Noe gikk galt under opprettelsen av teamet. Prøv igjen.",
    },
    /** Purely derived from the already-loaded team list — no new fetch (docs/features/ui-refresh/SPEC.md — BR-19). */
    summary: (active: number, disabled: number) => `${active} aktive · ${disabled} deaktiverte`,
    statusActive: "Aktivt",
    statusDisabled: "Deaktivert",
    /**
     * Labels the opaque Firestore-generated `teamId` shown next to a team's
     * status in admin screens (AdminTeams, AdminTeamDetail) — kept for
     * admin/debugging usefulness, but unlabeled it read as accidental/
     * garbled UI (review-change finding, product-ux-shell user-review).
     */
    teamIdLabel: "Team-ID:",
    disableButton: "Deaktiver team",
    enableButton: "Aktiver team",
    updatingButton: "Oppdaterer…",
    statusUpdateError: "Noe gikk galt under oppdatering av dette teamet. Prøv igjen.",
  },
  detail: {
    loading: "Laster team…",
    signInPrompt: "for å administrere dette teamet.",
    signInLink: "Logg inn",
    forbidden: "Du har ikke tilgang til denne siden.",
    error: "Noe gikk galt under lasting av dette teamet. Prøv igjen senere.",
    notFound: "Dette teamet ble ikke funnet.",
    inviteSectionTitle: "Inviter et medlem",
    emailLabel: "E-postadresse",
    inviteButton: "Inviter",
    invitingButton: "Inviterer…",
    inviteError: {
      invalidEmail: "Skriv inn en gyldig e-postadresse.",
      teamDisabled: "Dette teamet er deaktivert. Aktiver det på nytt før du inviterer medlemmer.",
      generic: "Noe gikk galt under sending av invitasjonen. Prøv igjen.",
    },
    membersSectionTitle: "Medlemmer",
    noMembers: "Ingen medlemmer ennå.",
    removeButton: "Fjern",
    removingButton: "Fjerner…",
    unnamedMember: "Medlem uten navn",
    leadMarker: "Teamlead",
    leadMarkerDormant: "Teamlead (lagret rolle, ikke aktiv mens teamet er deaktivert)",
    makeLeadButton: "Gjør til teamlead",
    makeMemberButton: "Gjør til vanlig medlem",
    savingRoleButton: "Lagrer…",
    leadRoleHint: "Teamlead er en rolle på medlemskapet og gir foreløpig ingen ekstra tilganger.",
    prepareMemberRefsHint:
      "Noen medlemmer er ikke klargjort for medlemsvelgeren ennå. Klargjøring er en engangsjobb per team og endrer ikke roller eller tilganger.",
    prepareMemberRefsButton: "Klargjør medlemsvelger",
    preparingMemberRefsButton: "Klargjør…",
    prepareMemberRefsSuccess: "Medlemsvelgeren er klargjort.",
    prepareMemberRefsTruncated:
      "Teamet har flere medlemmer enn én klargjøring kan behandle. Noen medlemmer er fortsatt ikke klargjort.",
    prepareMemberRefsError: {
      teamNotFound: "Teamet ble ikke funnet.",
      generic: "Noe gikk galt under klargjøring. Ingenting ble endret. Prøv igjen.",
    },
    leadDisabledTeamNote:
      "Mens dette teamet står som deaktivert kan nye teamledere ikke utnevnes, men en teamlead kan fortsatt gjøres til vanlig medlem.",
    roleError: {
      teamDisabled: "Dette teamet er deaktivert. Aktiver det på nytt før du utnevner en teamlead.",
      notAMember: "Personen er ikke lenger medlem av dette teamet.",
    },
    invitationsSectionTitle: "Ventende invitasjoner",
    noInvitations: "Ingen ventende invitasjoner.",
    cancelInvitationButton: "Avbryt invitasjon",
    cancelingButton: "Avbryter…",
    requestsSectionTitle: "Ventende tilgangsforespørsler",
    noRequests: "Ingen ventende tilgangsforespørsler.",
    approveButton: "Godkjenn",
    approvingButton: "Godkjenner…",
    rejectButton: "Avvis",
    rejectingButton: "Avviser…",
    rowError: "Noe gikk galt. Prøv igjen.",
  },
} as const;
