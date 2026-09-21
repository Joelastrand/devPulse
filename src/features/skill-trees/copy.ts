/**
 * Norwegian user-facing copy for the TASK-005 admin SkillTree catalog/
 * creation/correction UI (`app/admin/skills/page.tsx`), per the copy-module
 * convention established in `teams/copy.ts`.
 *
 * Owner decision 4 (docs/features/team-skill-tree/SPEC.md): "skill" is the
 * only technical identifier used anywhere in this feature's routes, files,
 * types, and Firestore fields. Natural Norwegian wording such as
 * "Kompetanseområder"/"Rett opp" is localization, not a competing technical
 * identifier, and belongs only in this module's exported string values.
 */
export const adminSkillsCopy = {
  pageTitle: "Kompetanseområder",
  pageDescription: "Opprett kompetanseområder, og rett opp navn eller stadier i eksisterende områder.",
  loading: "Laster kompetanseområder…",
  signInPrompt: "for å administrere kompetanseområder.",
  signInLink: "Logg inn",
  forbidden: "Du har ikke tilgang til denne siden.",
  error: "Noe gikk galt under lasting av kompetanseområder. Prøv igjen senere.",
  empty: "Ingen kompetanseområder ennå.",
  creation: {
    sectionTitle: "Nytt kompetanseområde",
    nameLabel: "Navn på kompetanseområdet",
    stageLabelPrefix: "Stadium",
    addStageButton: "Legg til stadium",
    removeStageButton: "Fjern stadium",
    submitButton: "Opprett kompetanseområde",
    submittingButton: "Oppretter…",
    error: {
      invalidInput: "Kontroller navnet og alle stadienavn (3–100 tegn hver, 2–20 stadier totalt).",
      generic: "Noe gikk galt under opprettelsen. Prøv igjen.",
    },
  },
  correction: {
    openButton: "Rett opp",
    cancelButton: "Avbryt",
    nameLabel: "Navn på kompetanseområdet",
    stageLabelPrefix: "Stadium",
    submitButton: "Lagre rettelse",
    submittingButton: "Lagrer…",
    error: {
      invalidInput: "Kontroller navnet og alle stadienavn (3–100 tegn hver).",
      treeNotFound: "Dette kompetanseområdet finnes ikke lenger.",
      nodeCountMismatch: "Antall stadier kan ikke endres her.",
      generic: "Noe gikk galt under lagring av rettelsen. Prøv igjen.",
    },
  },
  catalog: {
    sectionTitle: "Eksisterende kompetanseområder",
    stagesLabel: "Stadier:",
  },
} as const;

/**
 * Norwegian user-facing copy for the TASK-006 `/admin/teams/[teamId]`
 * per-team skill-tracking section (`TeamSkillTrackingSection.tsx`). Same
 * "skill" (technical) / "Kompetanseområder" (UI copy) split as
 * `adminSkillsCopy` (Owner decision 4).
 */
export const teamSkillTrackingCopy = {
  sectionTitle: "Kompetanseområder",
  loading: "Laster kompetanseområder…",
  error: "Noe gikk galt under lasting av kompetanseområder. Prøv igjen senere.",
  empty: "Ingen kompetanseområder er opprettet ennå.",
  tracked: {
    sectionTitle: "Sporede kompetanseområder",
    empty: "Teamet sporer ingen kompetanseområder ennå.",
    currentStageLabel: "Nåværende steg",
    notStarted: "Ikke startet",
    stageSelectLabel: "Sett stadium",
    stopButton: "Stopp sporing",
    stoppingButton: "Stopper…",
    error: {
      notTracked: "Sporingen er allerede stoppet.",
      invalidInput: "Ugyldig stadium valgt.",
      generic: "Noe gikk galt. Prøv igjen.",
    },
  },
  untracked: {
    sectionTitle: "Start sporing",
    empty: "Alle kompetanseområder spores allerede av dette teamet.",
    startButton: "Start sporing",
    startingButton: "Starter…",
    disabledHint: "Teamet er deaktivert. Sporing kan først startes når teamet er aktivt igjen.",
    error: {
      teamDisabled: "Teamet er deaktivert – sporing kan ikke startes.",
      treeNotFound: "Dette kompetanseområdet finnes ikke lenger.",
      teamNotFound: "Fant ikke teamet.",
      generic: "Noe gikk galt under start av sporing. Prøv igjen.",
    },
  },
} as const;

/**
 * Norwegian user-facing copy for the `/admin/skills` cross-team overview
 * section (docs/features/org-skill-progress-overview/SPEC.md — TASK-002,
 * `OrgSkillProgressOverview.tsx`). `disabledLabel` reuses the exact
 * "Deaktivert" string `teams/copy.ts`'s `statusDisabled` already establishes
 * for the same concept, rather than duplicating a second, independent copy
 * value for the identical meaning. `notStarted` similarly reuses
 * `teamSkillTrackingCopy.tracked.notStarted`'s exact "Ikke startet" string —
 * this module defines only the copy genuinely new to this overview.
 */
export const orgSkillProgressOverviewCopy = {
  sectionTitle: "Sporing på tvers av team",
  loading: "Laster oversikt…",
  error: "Noe gikk galt under lasting av oversikten. Prøv igjen senere.",
  empty: "Ingen kompetanseområder spores av noe team ennå.",
  disabledLabel: "Deaktivert",
} as const;

/**
 * Norwegian user-facing copy for the `/teams/[teamId]` "Kompetanseområder"
 * section (`TeamSkillSection.tsx`) — originally read-only (Phase 7,
 * TASK-007), extended with a member self-report control by docs/features/
 * skill-progress-self-report/SPEC.md (TASK-002, BR-10 through BR-12). Same
 * "skill" (technical) / "Kompetanseområder" (UI copy) split as
 * `adminSkillsCopy`/`teamSkillTrackingCopy` (Owner decision 4). `report`'s
 * `authorizationError` deliberately covers both a non-member's `forbidden`
 * and a disabled team's `team_disabled` with one generic message — neither
 * ever reveals *why* the report failed (SPEC BR-10, "Disabled team").
 */
export const teamSkillSectionCopy = {
  sectionTitle: "Kompetanseområder",
  loading: "Laster kompetanseområder…",
  error: "Noe gikk galt under lasting av kompetanseområder. Prøv igjen senere.",
  empty: "Teamet sporer ingen kompetanseområder ennå.",
  currentStageLabel: "Nåværende steg",
  notStarted: "Ikke startet",
  report: {
    stageSelectLabel: "Sett stadium",
    submitButton: "Lagre",
    submittingButton: "Lagrer…",
    validationError: "Ugyldig stadium valgt.",
    authorizationError: "Du har ikke tilgang til å gjøre dette.",
    genericError: "Noe gikk galt. Prøv igjen.",
  },
} as const;
