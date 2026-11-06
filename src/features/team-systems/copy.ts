/**
 * Norwegian product copy for Systemoversikt (docs/features/team-system-overview/
 * SPEC.md). Code identifiers stay English; user-facing text lives here.
 */
export const systemsCopy = {
  pageTitle: "Systemoversikt",
  pageDescription: "Systemene teamet har ansvar for, med kvalitet, kompetanse og teknisk dokumentasjon.",
  loading: "Laster systemoversikt…",
  signInPrompt: "for å se systemoversikten.",
  signInLink: "Logg inn",
  readError: "Noe gikk galt under lasting av systemene. Prøv igjen.",
  retry: "Prøv igjen",
  forbidden: "Du har ikke tilgang til systemene i dette teamet.",
  truncated: "Listen viser bare de første systemene og er ikke fullstendig.",

  summary: {
    systems: "Systemer",
    systemsHelp: "Registrert av teamet",
    inGoodStanding: "I god stand",
    inGoodStandingHelp: "Alle vurderinger er «God»",
    attention: "Trenger oppfølging",
    attentionHelp: "Minst én vurdering er kritisk eller trenger oppfølging",
    knowledgeRisk: "Kompetanserisiko",
    knowledgeRiskHelp: "Systemer med ingen eller én kjent person",
  },

  empty: {
    noSystemsTitle: "Ingen systemer registrert ennå",
    noSystemsBody: "Legg til systemene teamet eier, så vises kvalitet, kompetanse og dokumentasjon her.",
    noAssessmentsTitle: "Ingen vurderinger ennå",
    noAssessmentsBody: "Vurderingene er ikke gjort for systemene. «Ikke vurdert» betyr ikke at systemet er i god stand.",
    noSearchResultsTitle: "Ingen treff",
    noSearchResultsBody: "Prøv et annet søk eller fjern filtrene.",
    noKnowledgeTitle: "Ingen kjent kompetanse registrert",
    noBackstageLink: "Ingen Backstage-lenke",
    noDescription: "Ingen beskrivelse",
  },

  search: {
    label: "Søk etter system",
    placeholder: "Søk etter navn eller beskrivelse",
  },
  filters: {
    attentionLabel: "Oppfølging",
    attentionAll: "Alle systemer",
    attentionOnly: "Trenger oppfølging",
    knowledgeLabel: "Kompetanserisiko",
    knowledgeAll: "Alle nivåer",
  },

  matrix: {
    // Compact headers (reference 16). The full names are the accessible names via <abbr title>.
    headers: {
      availability: "Tilgj.",
      reliability: "Pålit.",
      maintainability: "Vedl./endr.",
      security: "Sikkerh.",
      testability: "Test",
      deployability: "Utrull.",
      observability: "Observ.",
    },
    knowledgeHeader: "Kompetanserisiko",
    actionsHeader: "Handlinger",
    legend: "Vurderingsstatus",
    edit: "Rediger",
  },

  explanation: {
    open: "Forklaring",
    title: "Forklaring av kvalitetsvurderinger",
    intro:
      "Vurderingene er kvalitative egenvurderinger fra teamet, ikke automatiske målinger eller sikkerhetsskanninger.",
    statusTitle: "Vurderingsstatus",
    statusHelp: {
      god: "Teamet mener egenskapen fungerer tilfredsstillende.",
      trenger_oppfolging: "Egenskapen har forbedringspunkter som bør følges opp.",
      kritisk: "Egenskapen er en vesentlig risiko og bør prioriteres.",
      ikke_vurdert: "Ingen vurdering er gjort ennå. Dette betyr ikke at systemet er i god stand.",
    },
    close: "Lukk",
    infoFor: (name: string) => `Forklaring: ${name}`,
  },

  formHints: {
    availability: "Hvorvidt systemet er tilgjengelig når brukerne trenger det.",
    reliability: "Systemets evne til å fungere korrekt og stabilt over tid.",
    maintainability: "Hvor enkelt systemet kan vedlikeholdes, forstås og endres.",
    security: "Hvordan system, data og brukere beskyttes mot kjente risikoer.",
    testability: "Hvor enkelt systemet kan testes og kvalitetssikres.",
    deployability: "Hvor enkelt og trygt endringer kan settes i produksjon.",
    observability: "Hvor godt teamet kan forstå systemets tilstand gjennom logger, målinger og spor.",
  },

  addSystem: "Legg til system",
  editSystem: "Rediger",
  cancel: "Avbryt",
  saving: "Lagrer…",

  columns: {
    system: "System",
    attention: "Oppmerksomhet",
    assessments: "Vurderinger",
    knowledge: "Teamkompetanse",
    backstage: "Backstage",
    risk: "Kompetanserisiko",
    actions: "Handlinger",
    assessedAt: "Sist vurdert",
  },

  attentionState: {
    attention: "Trenger oppfølging",
    ok: "Ingen markert behov",
    notAssessed: "Ikke vurdert",
  },

  backstage: {
    open: "Åpne i Backstage",
    openFor: (name: string) => `Åpne ${name} i Backstage (åpnes i ny fane)`,
  },

  knowledgeCount: (count: number) =>
    count === 0 ? "Ingen" : count === 1 ? "1 person" : `${count} personer`,

  knowledgeRiskPanel: {
    title: "Kompetanserisiko",
    description:
      "Vurdering basert på hvor mange teammedlemmer som har kjent systemet. Dette er en indikasjon for kunnskapsdeling, ikke en vurdering av enkeltpersoner.",
    singlePerson: (count: number) =>
      count === 1 ? "1 system har kun én kjent person" : `${count} systemer har kun én kjent person`,
    singlePersonHelp: "Kunnskapsdeling kan redusere sårbarhet ved fravær eller endring i teamet.",
  },

  qualityPanel: {
    title: "Kvalitetsegenskaper (fokus for teamet)",
    description:
      "Vurderingene er kvalitative egenvurderinger fra teamet. De er ikke automatiske sikkerhetsskanninger eller sertifiseringer.",
    availability: {
      title: "Tilgjengelighet",
      body: "Hvorvidt systemet er tilgjengelig når brukerne trenger det. Ikke en målt oppetid.",
    },
    reliability: {
      title: "Pålitelighet",
      body: "Systemets evne til å fungere korrekt og stabilt over tid. Tilgjengelig betyr ikke at resultatene er riktige.",
    },
    maintainability: {
      title: "Vedlikehold og endring",
      body: "Hvor enkelt systemet kan vedlikeholdes, forstås og endres på en trygg måte.",
    },
    security: {
      title: "Sikkerhet",
      body: "Vurdering av kjente sårbarheter, oppdatering og tilgangsstyring. Ikke en sikkerhetsgaranti.",
    },
    testability: {
      title: "Testbarhet",
      body: "Hvor enkelt systemet kan testes og kvalitetssikres.",
    },
    deployability: {
      title: "Utrullingsbarhet",
      body: "Hvor enkelt og trygt endringer kan settes i produksjon.",
    },
    observability: {
      title: "Observerbarhet",
      body: "Hvor godt teamet kan forstå systemets tilstand gjennom logger, målinger og spor.",
    },
  },

  assessmentLabels: {
    availability: "Tilgjengelighet",
    reliability: "Pålitelighet",
    maintainability: "Vedlikehold og endring",
    security: "Sikkerhet",
    testability: "Testbarhet",
    deployability: "Utrullingsbarhet",
    observability: "Observerbarhet",
  },

  form: {
    createTitle: "Legg til system",
    editTitle: "Rediger system",
    name: "Navn",
    nameHelp: "Maks 120 tegn.",
    description: "Beskrivelse",
    descriptionHelp: "Kort beskrivelse, maks 1000 tegn.",
    backstageUrl: "Backstage-lenke",
    backstageUrlHelp: "Må være en https-adresse uten brukernavn eller passord.",
    assessmentsTitle: "Vurderinger",
    rowExpand: (name: string) => `Vis begrunnelse for ${name}`,
    rowCollapse: (name: string) => `Skjul begrunnelse for ${name}`,
    rationale: "Begrunnelse (valgfritt)",
    assessmentValue: "Vurdering",
    assessmentNote: "Begrunnelse",
    assessmentNoteHelp: "Valgfritt, maks 500 tegn.",
    knowledgeTitle: "Teammedlemmer med kjent kompetanse",
    knowledgeHelp: "Velg teammedlemmer som har kjent systemet. Dette er en selvrapportert kobling, ikke en sertifisering.",
    knowledgeEmpty: "Ingen teammedlemmer å velge mellom.",
    knowledgeUnavailable: "Teammedlemmene kunne ikke lastes. Prøv igjen senere.",
    unnamedMember: "Medlem uten navn",
    save: "Lagre system",
    saved: "Systemet er lagret.",
    nameRequired: "Navn er påkrevd.",
    nameTooLong: "Navnet er for langt.",
    descriptionTooLong: "Beskrivelsen er for lang.",
    backstageInvalid: "Lenken må være en gyldig https-adresse uten brukernavn eller passord.",
    noteTooLong: "Begrunnelsen er for lang.",
    knowledgeTooMany: "Du kan knytte maks 50 personer til ett system.",
    genericError: "Noe gikk galt. Prøv igjen.",
    accessDenied: "Du kan ikke endre systemer i dette teamet.",
    teamDisabled: "Teamet er deaktivert, og systemer kan ikke endres.",
    invalidKnowledge: "En av de valgte personene kan ikke knyttes til systemet. Oppdater listen og prøv igjen.",
    limitReached: "Teamet har nådd maks antall systemer.",
    notFound: "Systemet finnes ikke lenger. Oppdater siden.",
    requestFailed: "Forespørselen kunne ikke fullføres. Prøv igjen.",
  },
} as const;
