/** Norwegian UI copy for the `/me/conversations` list (SPEC BR-33, BR-34, BR-38, BR-44, D2-SI-13). Labels are the SPEC's. */
export const conversationsCopy = {
  pageTitle: "Samtaler",
  pageDescription: "Personlige utviklingssamtaler du har startet, eller som du er invitert til.",
  privacyNotice:
    "Samtalene er private. Ingen leder eller administrator kan se dem. Du kan dele en samtale med én kollega ved å invitere vedkommende.",
  loading: "Laster samtalene dine…",
  signInLink: "Logg inn",
  signInPrompt: "for å se samtalene dine.",
  loadError: "Kunne ikke laste samtalene dine. Prøv igjen.",
  retryButton: "Prøv igjen",
  empty: "Du har ingen samtaler ennå.",
  ownedHeading: "Dine samtaler",
  ownedEmpty: "Du har ingen samtaler du har startet.",
  participatingHeading: "Samtaler du er med i",
  participatingEmpty: "Du er ikke med i noen samtaler.",
  /** Shown once per list when either list is bounded. It states that not every item is shown, not how many exist. */
  truncatedNotice: "Ikke alle samtalene vises. Når du sletter eller forlater samtaler, kan flere bli synlige.",
  statusLabel: {
    open: "Åpen",
    completed: "Fullført",
  },
  participantStateLabel: {
    none: "Ingen deltaker ennå",
    pending: "Venter på svar",
    accepted: "Akseptert",
    unavailable: "Ikke lenger tilgjengelig",
  },
  /** BR-41/BR-44: the neutral name when an owner's display name is not available to this list. */
  anonymousColleague: "En kollega",
  pendingBadge: "Venter på svar",
  titleUnavailable: "Tittel ikke tilgjengelig",
  /** "Kompetanseområde" is a skill area in this product, so a team is labelled "Team" as in the teams and nav copy. */
  teamLabel: "Team",
  plannedForLabel: "Dato for samtalen",
  /** The accessible name adds the team, since the visible text is the same for every pending invitation. */
  openPendingLink: "Åpne invitasjon",
  openPendingName: (teamName: string) => `Åpne invitasjon fra ${teamName}`,
  recoveryHeading: "Samtaler som ikke kan vises",
  /** Recovery items carry no content, so the copy says only that the item cannot be shown and can be deleted. */
  recoveryNotice: (count: number) =>
    count === 1
      ? "En lagret samtale kan ikke vises. Du kan slette den."
      : `${count} lagrede samtaler kan ikke vises. Du kan slette dem.`,
  recoveryItemLabel: (index: number, total: number) => `Lagret samtale som ikke kan vises (${index} av ${total})`,
  recoveryDeleteButtonName: (index: number, total: number) => `Slett lagret samtale som ikke kan vises (${index} av ${total})`,
  deleteButton: "Slett",
  deleteConfirmRecovery: "Vil du slette denne lagrede samtalen permanent? Dette kan ikke angres.",
  deleteConfirmButton: "Slett permanent",
  deletingLabel: "Sletter…",
  cancelButton: "Avbryt",
  /** Delete may have committed even when the response was lost, so the copy never says nothing was deleted. */
  deleteFailed: "Vi kunne ikke bekrefte at sletting ble utført. Last siden på nytt for å se gjeldende samtaler, eller prøv å slette igjen.",
  deleteNotFound: "Samtalen finnes ikke lenger. Listen er oppdatert.",
  /** TASK-027 create form (SPEC BR-2, BR-6, BR-38, BR-39). The disclosure opens a form on the list page. */
  createToggle: "Ny samtale",
  createHeading: "Ny samtale",
  createTitleLabel: "Tittel",
  createTitleInvalid: "Skriv en tittel på 1 til 100 tegn, uten linjeskift.",
  createDateHint: "Valgfritt. Datoen er bare en merkelapp, ikke en påminnelse.",
  createDateInvalid: "Velg en gyldig dato mellom 2020 og 2100.",
  createPrivacy: "Samtalen starter privat og uten deltaker. Du velger selv om og når du inviterer en kollega.",
  createTeamHint: "Valgfritt. Teamet kan bare velges når samtalen opprettes, og kan ikke endres senere.",
  createTeamUnavailable: "Teamvalget kan ikke vises nå. Samtalen opprettes uten team.",
  /** Zero options with a complete read. It says nothing about the person's teams in general. */
  createTeamNone: "Ingen team kan velges for en ny samtale akkurat nå. Samtalen opprettes uten team.",
  /** The server window was full, so the list may be incomplete. It does not claim there are no other teams. */
  createTeamTruncated: "Ikke alle team kan vises her, så teamvalget kan være ufullstendig.",
  createNoTeam: "Ingen team",
  cancelCreate: "Avbryt",
  createSubmit: "Opprett samtale",
  createPending: "Oppretter…",
  createLimit: "Du har nådd grensen for antall samtaler. Slett en samtale for å opprette en ny.",
  /** The server returns only a code for invalid input, so the copy is general and names no field. */
  createInvalidInput: "Kontroller opplysningene og prøv igjen.",
  /** Persistence and unknown outcomes may still have created the conversation, so the copy never claims failure. */
  createAmbiguous: "Vi kunne ikke bekrefte om samtalen ble opprettet. Listen er oppdatert, så kontroller den før du prøver igjen.",
  /** TASK-028 owner detail editor (SPEC BR-19, BR-24 to BR-28, BR-38, BR-39, D2-SI-6). */
  detailHeading: "Samtale",
  detailLoading: "Laster samtalen…",
  detailLoadError: "Kunne ikke laste samtalen. Prøv igjen.",
  /** Forbidden, absent and wrong-view cases share this copy, so the page never reveals which one applies. */
  detailNotFound: "Samtalen finnes ikke, eller du har ikke tilgang til den.",
  backToList: "Tilbake til samtalene",
  detailPrivacy:
    "Bare du kan redigere denne samtalen. Feltene merket «synlige for deltakeren» blir synlige for deltakeren når deltakeren godtar invitasjonen.",
  /** TASK-029: removing the participant stays available after completion (BR-16), so the notice names it too. */
  detailCompleted: "Samtalen er fullført. Innholdet er skrivebeskyttet. Eventuell deltaker og eventuelle delte mål kan fortsatt fjernes.",
  refreshFailed: "Vi kunne ikke hente den nyeste versjonen av samtalen. Last siden på nytt før du lagrer igjen.",
  /** TASK-031 owner lifecycle: completion and delete. Each control states its consequence before it sends anything. */
  lifecycleSection: "Fullfør eller slett samtalen",
  completeConversationButton: "Fullfør samtale",
  completeConfirmHeading: "Fullføre samtalen?",
  completeReadOnly: "Innholdet blir skrivebeskyttet for deg og deltakeren.",
  completeNoReopen: "Samtalen kan ikke åpnes igjen.",
  /** Removal and clearing are conditional, so the line names no participant or shared goal as if one exists. */
  completeRemovalStillAvailable: "Eventuell deltaker og eventuelle delte mål kan fortsatt fjernes.",
  completeUnsavedLost: "Endringer du ikke har lagret, blir ikke lagret.",
  completePendingWithdrawn: "Invitasjonen til deltakeren trekkes tilbake, og deltakeren kan ikke godta den.",
  /** Continued access depends on the participant's team membership (BR-21), so the line does not promise it unconditionally. */
  completeAcceptedKeeps:
    "Deltakeren som har godtatt, beholder tilgangen og kan lese den fullførte samtalen, så lenge vedkommende fortsatt er medlem av teamet.",
  confirmComplete: "Fullfør samtale",
  keepOpen: "Behold åpen",
  completing: "Fullfører…",
  completeAlreadyDone: "Samtalen er allerede fullført.",
  completeNotConfirmed: "Vi kunne ikke bekrefte at samtalen ble fullført. Sjekk statusen før du prøver igjen.",
  deleteConversationButton: "Slett samtale",
  deleteConfirmHeading: "Slette samtalen?",
  deleteConsequence: "Samtalen og all tilgang for deltakeren fjernes. Ingenting beholdes.",
  deleteIrreversible: "Dette kan ikke angres.",
  confirmDelete: "Slett samtale",
  keepConversation: "Behold samtalen",
  deleteNotConfirmed: "Vi kunne ikke bekrefte at samtalen ble slettet. Last siden på nytt for å se om den finnes.",
  titleSection: "Tittel",
  plannedForSection: "Dato for samtalen",
  notesSection: "Notater (synlige for deltakeren etter aksept)",
  nextStepsSection: "Neste steg",
  saveTitle: "Lagre tittel",
  savePlannedFor: "Lagre dato",
  saveNotes: "Lagre notater",
  saveNextSteps: "Lagre neste steg",
  saving: "Lagrer…",
  saved: "Lagret.",
  plannedForClearHint: "Tomt felt betyr at samtalen ikke har dato.",
  notesHint: "Deltakeren ser notatet etter aksept. Tomt felt fjerner notatet.",
  nextStepsHint: "Ett steg per linje. Tomme linjer hoppes over.",
  nextStepsLimit: "Du kan ha høyst 10 neste steg.",
  nextStepInvalid: "Hvert steg må ha 1 til 200 tegn, uten linjeskift.",
  notesInvalid: "Notatet er for langt, eller inneholder tegn som ikke kan lagres.",
  noPlannedFor: "Ingen dato",
  noNextSteps: "Ingen neste steg ennå.",
  noNotes: "Ingen notater ennå.",
  participantNotesSection: "Notater fra deltakeren",
  participantNotesHint: "Deltakerens egne notater. Du kan lese dem, men ikke endre dem.",
  noParticipantNotes: "Deltakeren har ikke skrevet notater.",
  /** Shown on every owner section that the participant sees after acceptance (D2-SI-6, BR-22). */
  visibleToParticipant: "Synlig for deltakeren etter aksept.",
  sharedGoalsSection: "Delte mål",
  sharedGoalsVisibility:
    "Delte mål er kopier som er tatt nå. Deltakeren ser dem etter aksept. Når du endrer valget, endres det deltakeren ser.",
  noSharedGoals: "Ingen mål er delt.",
  goalDateLabel: "Dato",
  areaUnavailable: "Området er ikke tilgjengelig",
  goalStatusLabel: {
    active: "Aktivt",
    completed: "Fullført",
  },
  selectorHeading: "Velg mål å dele",
  selectorCopy: "Valget erstatter de delte målene. Hvert valgt mål blir en kopi som tas nå, og den oppdateres ikke når målet endres.",
  selectorLoading: "Laster målene dine…",
  selectorError: "Målene dine kan ikke vises nå. Prøv igjen senere.",
  selectorEmpty: "Du har ingen mål å dele ennå.",
  /** A truncated list makes replacement destructive: a goal that is not listed cannot be kept by saving. Say so. */
  selectorTruncated:
    "Ikke alle målene dine vises her. Lagring erstatter hele settet, så delte mål som ikke vises her, fjernes fra samtalen.",
  selectorNeedsGoal: "Velg minst ett mål for å lagre. Vil du fjerne alle delte mål, bruk knappen under.",
  clearGoalsCopy: "Deltakeren ser ingen delte mål etter at du fjerner dem.",
  selectorLimit: "Du kan dele høyst 5 mål.",
  saveGoals: "Lagre delte mål",
  clearGoals: "Fjern alle delte mål",
  goalsSaved: "De delte målene er lagret.",
  goalsCleared: "Alle delte mål er fjernet.",
  goalSelectionInvalid: "Ett eller flere valgte mål kan ikke deles. Oppdater valget og prøv igjen.",
  /** Shown when a write may or may not have been applied. The copy never says it failed. */
  writeAmbiguous: "Vi kunne ikke bekrefte at endringen ble lagret. Innholdet er hentet på nytt. Kontroller det før du lagrer igjen.",
  writeCompleted: "Samtalen er fullført, så endringen ble ikke lagret.",
  writeNotFound: "Samtalen finnes ikke lenger.",
  writeInvalid: "Kontroller opplysningene og prøv igjen.",
  /** TASK-029 owner participant panel (SPEC BR-8, BR-10, BR-16, BR-18, BR-38, CL-19 to CL-21, D2-SI-4). */
  participantSection: "Deltaker",
  participantSectionHint: "Deltakeren er en kollega i samme team. Samtalen kan ha høyst én deltaker om gangen.",
  /** The state is shown as text beside its label, so no state is conveyed by colour alone. */
  participantStateNote: {
    none: "Ingen deltaker er valgt.",
    pending: "Deltakeren ser bare invitasjonen til vedkommende godtar den.",
    accepted: "Deltakeren ser hele samtalen og kan skrive egne notater.",
    /** CL-21: access has ended, but nothing is hidden, and the owner can still read the participant's notes. */
    unavailable:
      "Deltakeren har ikke lenger tilgang til samtalen. Notatene deltakeren har skrevet, vises fortsatt til du fjerner deltakeren.",
  },
  noTeamForParticipant: "Samtalen har ikke et team, så det kan ikke velges en deltaker.",
  chooseColleague: "Velg en kollega",
  chooseReplacement: "Velg ny deltaker",
  colleagueOptionsLoading: "Laster teamet…",
  colleagueOptionsError: "Teamet kan ikke vises nå. Prøv igjen.",
  colleagueOptionsEmpty: "Ingen andre i teamet kan velges akkurat nå.",
  /** BR-8: members beyond the server's read bound cannot be selected, and the copy says so. */
  colleagueOptionsTruncated: "Ikke alle i teamet vises her. Medlemmer som ikke vises, kan ikke velges.",
  /** The fallback name for a member or owner with no display name. The same neutral name as the rest of D2 (BR-41). */
  colleagueUnnamed: "En kollega",
  inviteButton: "Inviter en kollega",
  replaceButton: "Bytt deltaker",
  removeButton: "Fjern deltaker",
  /** BR-38: shown before every invitation or replacement, and the invite cannot be sent without it. */
  inviteConfirmHeading: "Før du inviterer",
  inviteCopy: [
    "Bare du kan se samtalen før deltakeren godtar. Etter aksept ser dere begge alt i samtalen.",
    "Deltakeren ser bare invitasjonen til vedkommende godtar den.",
    "Når deltakeren godtar, blir alt i samtalen synlig, også notater du skrev før invitasjonen.",
    "Deltakeren ser den nyeste versjonen av innholdet du har skrevet.",
    "Deltakeren kan forlate samtalen når som helst. Da slettes notatene vedkommende har skrevet.",
    "Hvis deltakeren forlater teamet, mister vedkommende tilgangen til samtalen.",
    "Ingen leder eller administrator kan se samtalen.",
  ],
  /** The chosen colleague is named before the owner confirms. Only the display name is shown, never the opaque ref. */
  inviteTargetLine: (name: string) => `Valgt kollega: ${name}`,
  confirmInvite: "Send invitasjon",
  confirmReplace: "Send ny invitasjon",
  replaceWarning: "Den nåværende deltakeren mister tilgangen med en gang, og notatene vedkommende har skrevet, slettes.",
  /** A pending invitation has no notes yet, so replacing it names only the withdrawal. */
  replacePendingWarning: "Invitasjonen til den nåværende deltakeren trekkes tilbake, og vedkommende mister tilgangen med en gang.",
  /** A pending invitation has no notes yet, so the removal copy names only the withdrawal. */
  removePendingWarning: "Invitasjonen trekkes tilbake, og deltakeren mister tilgangen med en gang. Dette kan ikke angres.",
  removeActiveWarning:
    "Deltakeren mister tilgangen med en gang. Notatene vedkommende har skrevet, slettes. Dette kan ikke angres.",
  confirmRemove: "Fjern deltaker",
  inviteSent: "Invitasjonen er sendt. Deltakeren ser samtalen først etter at vedkommende har godtatt.",
  replaceSent: "Ny invitasjon er sendt. Den forrige deltakeren har mistet tilgangen.",
  participantRemoved: "Deltakeren er fjernet fra samtalen.",
  /** The selected colleague is refused by the server, so the list is refreshed and the person chooses again. */
  participantInvalid: "Den valgte kollegaen kan ikke velges nå. Teamlisten er oppdatert, så velg på nytt.",
  /** TASK-030 pending invitation view (SPEC BR-14, BR-15, BR-17, BR-23, BR-38, BR-41). Only approved pending data is shown. */
  pendingHeading: "Invitasjon til samtale",
  pendingOwnerLine: (name: string) => `${name} har invitert deg til en samtale.`,
  pendingInvitedLine: (date: string) => `Invitert ${date}`,
  /** The invitee sees no content before acceptance, so the copy says so and names nothing that is hidden. */
  pendingNoContent: "Du ser innholdet i samtalen først når du har godtatt invitasjonen.",
  /** BR-38 participant copy, shown before the invitee answers. */
  pendingCopy: [
    "Når du godtar, ser du alt i samtalen, også notater som er skrevet før invitasjonen.",
    "Du kan forlate samtalen når som helst. Da slettes notatene du har skrevet.",
    "Hvis du forlater teamet, mister du tilgangen til samtalen.",
    "Ingen leder eller administrator kan se samtalen.",
  ],
  acceptButton: "Godta invitasjon",
  declineButton: "Avslå",
  /** Notices are set by the page after an action, and each one states only what the server or a re-read proved. */
  acceptedNotice: "Invitasjonen er godtatt. Du ser nå hele samtalen.",
  declinedNotice: "Invitasjonen er avslått. Samtalen er fjernet fra listen din.",
  leftNotice: "Du har forlatt samtalen. Notatene dine er slettet.",
  acceptNotConfirmedPending: "Vi kunne ikke bekrefte at invitasjonen ble godtatt. Den venter fortsatt på svar.",
  declineNotConfirmedPending: "Vi kunne ikke bekrefte at invitasjonen ble avslått. Den venter fortsatt på svar.",
  /** A neutral result for an action whose outcome could not be confirmed. The action is never repeated automatically. */
  participationUnconfirmed:
    "Vi kunne ikke bekrefte utfallet av handlingen, så den er ikke gjentatt. Last samtalen på nytt for å se gjeldende status.",
  /** The accept was confirmed by the server, but the conversation could not be read again. */
  acceptedUnread: "Invitasjonen er godtatt, men samtalen kunne ikke hentes nå. Last samtalen på nytt for å se den.",
  /** The detail read proved the participant still has access, so a leave that was not confirmed did not happen. */
  participationStillActive: "Du er fortsatt med i samtalen.",
  reloadConversation: "Last på nytt",
  /** TASK-030 accepted participant view (SPEC BR-20, BR-22, BR-23, BR-43, BR-49, CL-21, CL-22). */
  participantHeading: "Samtale",
  participantPrivacy:
    "Du kan lese det eieren har skrevet, og skrive egne notater. Eieren kan lese notatene dine. Ingen leder eller administrator kan se dem.",
  ownerNameLabel: "Eier",
  ownerContentNote: "Dette er eierens nyeste innhold. Det kan endres.",
  ownerNotesSection: "Notater fra eieren",
  participantOwnNotesSection: "Dine notater",
  /** The editor label names the notes the owner reads, as the owner's view does. */
  participantNotesLabel: "Notater fra deltakeren",
  participantNotesVisibility: "Notatene dine er synlige for eieren av samtalen. De slettes hvis du forlater samtalen.",
  participantNotesEmpty: "Du har ikke skrevet notater ennå.",
  participantSharedGoalsNote: "Delte mål er kopier fra da de ble valgt. De oppdateres ikke når målet endres.",
  noOwnerNotes: "Eieren har ikke skrevet notater ennå.",
  participantCompleted: "Samtalen er fullført. Innholdet er skrivebeskyttet, og du kan ikke skrive notater lenger.",
  leaveButton: "Forlat samtalen",
  leaveConfirmHeading: "Vil du forlate samtalen?",
  /** Leaving deletes the participant's notes at once, so the consequence is stated before the person confirms. */
  leaveConfirmCopy:
    "Notatene dine slettes med en gang, og du mister tilgangen til samtalen. Dette kan ikke angres.",
  confirmLeave: "Ja, forlat samtalen",
} as const;
