/**
 * Norwegian user-facing copy for the authenticated teams screens
 * (`app/teams/page.tsx`, `app/teams/[teamId]/page.tsx`, `TeamsOverview`,
 * `TeamDetail`), per the copy-module convention established in TASK-001
 * (docs/archive/features/product-ux-shell/SPEC.md — BR-2).
 *
 * `requestAccessError` is shared by both `TeamsOverview` and `TeamDetail`
 * (via `request-access-messages.ts`) so the request-access affordance reads
 * identically wherever it appears — same non-sensitive wording as before
 * this task, only translated (BR-16 is unaffected: no new information is
 * disclosed).
 */
export const teamsCopy = {
  overview: {
    pageTitle: "Mine team",
    pageDescription: "Teamene du er medlem av, og andre aktive team du kan se.",
    loading: "Laster oversikt over team…",
    signInPrompt: "for å se oversikten over team.",
    signInLink: "Logg inn",
    error: "Noe gikk galt under lasting av team. Prøv igjen senere.",
    empty: "Ingen team er tilgjengelige ennå.",
    /** Section headings on the Team page (`layout="page"`). "Andre team" appears only when such teams are visible. */
    mineSectionTitle: "Mine team",
    otherSectionTitle: "Andre team",
    notMemberOfAny: "Du er ikke medlem av noen team ennå.",
    /** Count strip above the cards. Both values count teams, never people. */
    summaryMine: "Mine team",
    summaryTeamAdmin: "Teamadmin",
    search: {
      label: "Søk etter team",
      noResults: "Ingen team samsvarer med søket.",
      reset: "Nullstill søk",
    },
    /** Visible affordance on a card the caller can open. The card's link keeps only the team name as its accessible name. */
    openTeam: "Åpne team",
  },
  detail: {
    loading: "Laster team…",
    signInPrompt: "for å se dette teamet.",
    signInLink: "Logg inn",
    error: "Noe gikk galt under lasting av dette teamet. Prøv igjen senere.",
    resultsUnavailable:
      "Noe gikk galt under lasting av teamets resultater. Prøv igjen senere.",
    fallbackName: "Team",
    /** Header action on the overview: opens the team settings page (Teaminnstillinger). */
    editTeam: "Rediger team",
    /** Identity count under the team name (TASK-008, reference 18). Only a count already loaded on Oversikt is shown. */
    competenceAreas: (count: number) => `${count} ${count === 1 ? "kompetanseområde" : "kompetanseområder"}`,
    /**
     * The two presentation-only visual zones `TeamDetail` groups its
     * already-rendered sections into (docs/archive/features/ui-refresh/SPEC.md —
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
  /** Route-level team navigation (docs/archive/features/team-roadmap/SPEC.md — BR-2). */
  nav: {
    label: "Teamnavigasjon",
    overview: "Oversikt",
    roadmap: "Roadmap",
    competencePlan: "Kompetanseplan",
    competence: "Teamkompetanse",
    systems: "Systemoversikt",
    results: "Resultater og trender",
    surveys: "Undersøkelser",
  },
  /**
   * `/teams/[teamId]/results` (BR-5): survey history, trends and the long
   * competence ladder moved out of Oversikt. Not a sixth tab — reached from
   * Oversikt and returned to via `backToOverview`.
   */
  results: {
    title: "Resultater",
    description: "Undersøkelser, trender og kompetansestiger for teamet.",
    loading: "Laster resultater…",
    forbidden: "Du har ikke tilgang til resultatene for dette teamet.",
    error: "Resultatene kunne ikke lastes. Prøv igjen senere.",
    signIn: "Logg inn for å se resultatene for teamet.",
  },
  /** The collapsed, read-only member roster on `/teams/[teamId]` (docs/archive/features/member-identity-and-team-roles/SPEC.md — BR-31). */
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
    leadLabel: "Teamadmin",
    selfLabel: "Deg",
    truncated: "Listen viser bare de første medlemmene og er ikke fullstendig.",
  },
  relationshipLabels: {
    teamadmin: "Teamadmin",
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
 * established in TASK-001 (docs/archive/features/product-ux-shell/SPEC.md — BR-2).
 *
 * `forbidden` is deliberately generic on both screens — it must never
 * confirm or deny whether the caller's email is on the server-only
 * superadmin registry (docs/archive/features/team-management/SPEC.md —
 * BR-15/BR-16), so localizing it must not make it any more specific than
 * the English wording it replaces.
 */
export const adminCopy = {
  teams: {
    pageTitle: "Team",
    pageDescription: "Opprett og administrer team, medlemmer og tilgang.",
    competenceAreasLink: "Kompetanseområder",
    rolesLink: "Roller",
    relatedAreasLabel: "Relaterte administrasjonsområder",
    activeTeamsLabel: "Aktive team",
    disabledTeamsLabel: "Deaktiverte team",
    totalTeamsLabel: "Totalt",
    searchLabel: "Søk etter team",
    filterLabel: "Filtrer team etter status",
    filterAll: "Alle",
    filterActive: "Aktive",
    filterDisabled: "Deaktiverte",
    noSearchResults: "Ingen team funnet.",
    noActiveTeams: "Ingen aktive team.",
    noDisabledTeams: "Ingen deaktiverte team.",
    tryAnotherSearch: "Prøv et annet søk.",
    administerTeamButton: "Administrer team",
    loading: "Laster team…",
    signInPrompt: "for å administrere team.",
    signInLink: "Logg inn",
    forbidden: "Kunne ikke vise siden. Prøv igjen senere.",
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
    /** Purely derived from the already-loaded team list — no new fetch (docs/archive/features/ui-refresh/SPEC.md — BR-19). */
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
    /** Accessible name for the team administration tab list (Phase 1 tab shell). */
    tabsLabel: "Administrasjon av teamet",
    tabs: {
      oversikt: "Oversikt",
      medlemmer: "Medlemmer",
      roller: "Roller",
      invitasjoner: "Invitasjoner",
      undersokelser: "Undersøkelser",
      utfordringer: "Utfordringer",
      kompetanse: "Kompetanse",
    },
    overview: {
      summaryLabel: "Sammendrag",
      members: "Medlemmer",
      invitations: "Ventende invitasjoner",
      requests: "Ventende tilgangsforespørsler",
      surveys: "Undersøkelser",
      challenges: "Utfordringer",
    },
    loading: "Laster team…",
    signInPrompt: "for å administrere dette teamet.",
    signInLink: "Logg inn",
    forbidden: "Kunne ikke vise siden. Prøv igjen senere.",
    error: "Noe gikk galt under lasting av dette teamet. Prøv igjen senere.",
    notFound: "Dette teamet ble ikke funnet.",
    inviteSectionTitle: "Inviter medlem",
    inviteSectionDescription: "Send en invitasjon til en person som skal bli medlem av teamet.",
    inviteTabTitle: "Invitasjoner og tilgang",
    inviteTabDescription: "Inviter nye medlemmer og administrer ventende forespørsler.",
    inviteSuccess: "Invitasjonen er sendt.",
    pendingInvitationsStat: "Ventende invitasjoner",
    pendingRequestsStat: "Tilgangsforespørsler",
    sentOn: (date: string) => `Sendt ${date}`,
    requestedOn: (date: string) => `Forespurt ${date}`,
    requestAddressMissing: "E-postadresse ikke tilgjengelig",
    emailLabel: "E-postadresse",
    inviteButton: "Send invitasjon",
    invitingButton: "Sender invitasjon…",
    inviteError: {
      invalidEmail: "Skriv inn en gyldig e-postadresse.",
      teamDisabled: "Dette teamet er deaktivert. Aktiver det på nytt før du inviterer medlemmer.",
      generic: "Noe gikk galt under sending av invitasjonen. Prøv igjen.",
    },
    membersSectionTitle: "Medlemmer",
    noMembers: "Ingen medlemmer ennå.",
    removeButton: "Fjern",
    removeFromTeamButton: "Fjern fra teamet",
    removeConfirm: (name: string) => `Fjerne ${name} fra teamet? Personen mister medlemskapet i teamet.`,
    cancelRemoval: "Avbryt",
    moreActions: "Flere handlinger",
    moreActionsFor: (name: string) => `Flere handlinger for ${name}`,
    memberCount: (count: number) => (count === 1 ? "1 medlem" : `${count} medlemmer`),
    memberSearchResult: (shown: number, total: number) => `Viser ${shown} av ${total} medlemmer`,
    membersSectionDescription: "Administrer teammedlemmer og tilgang.",
    memberSearchLabel: "Søk etter medlem",
    memberSearchReset: "Nullstill søk",
    noMatchingMembers: "Ingen medlemmer funnet.",
    inviteMemberLink: "Inviter medlem",
    memberBadge: "Medlem",
    leadBadge: "Teamadmin",
    removingButton: "Fjerner…",
    unnamedMember: "Medlem uten navn",
    leadMarker: "Teamadmin",
    leadMarkerDormant: "Teamadmin (ikke aktiv mens teamet er deaktivert)",
    makeLeadButton: "Gjør til teamadmin",
    makeMemberButton: "Gjør til vanlig medlem",
    savingRoleButton: "Lagrer…",
    leadRoleHint: "Teamadmin er en rolle som kun superadmin kan gi eller fjerne. Teamadmin kan administrere teamets innhold og innstillinger.",
    prepareMemberRefsHint:
      "Noen medlemmer er ikke klargjort for medlemsvelgeren ennå. Klargjøring gjøres én gang per team.",
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
      "Mens dette teamet står som deaktivert kan nye teamadmins ikke utnevnes, men en teamadmin kan fortsatt fjernes.",
    roleError: {
      teamDisabled: "Dette teamet er deaktivert. Aktiver det på nytt før du utnevner en teamadmin.",
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
