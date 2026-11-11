/**
 * Norwegian copy for the authenticated home (`/` when signed in).
 *
 * Every destination below already exists. The home adds no metric, no
 * summary of individual data and no new route (BR-38 privacy rules are
 * unchanged).
 */
export const authenticatedHomeCopy = {
  title: "Hjem",
  description: "Gå rett til teamene, målene og samtalene dine.",
  greeting: {
    context: "Her er en oversikt over din utvikling og teamet ditt.",
    withName: (name: string) => `Hei, ${name}`,
  },
  quickLinksLabel: "Snarveier",
  teamsSectionTitle: "Dine team",
  teamsSectionDescription: "Teamene du er medlem av, med pulsmåling og utvikling.",
  links: {
    teams: {
      label: "Team",
      description: "Resultater, roadmap og kompetansebehov for teamene dine.",
      href: "/teams",
    },
    skills: {
      label: "Ferdigheter",
      description: "Din egenvurdering, og hvordan den passer til rollen din.",
      href: "/me/skills",
    },
    goals: {
      label: "Mål",
      description: "Aktive mål, fremdrift og fullførte mål.",
      href: "/me/goals",
    },
    conversations: {
      label: "Samtaler",
      description: "Utviklingssamtalene du deltar i.",
      href: "/me/conversations",
    },
  },
  readError: "Kunne ikke laste dette nå. Prøv igjen senere.",
  tiles: {
    team: { label: "Teamoversikt", emptyText: "Du er ikke medlem av et team ennå.", emptyAction: "Se teamene" },
  },
  goals: {
    title: "Mine mål",
    all: "Alle mål",
    empty: "Du har ingen aktive mål ennå.",
    statusActive: "Aktivt",
    statusCompleted: "Fullført",
  },
  conversation: {
    title: "Neste samtale",
    empty: "Ingen planlagte samtaler.",
    open: "Gå til samtale",
    noDate: "Ingen dato satt",
    withPrefix: "Med",
  },
  development: {
    title: "Teamets utvikling",
    empty: "Det finnes ingen resultater for teamet ennå.",
  },
  pulse: {
    label: "Teamets puls",
    latest: "Siste undersøkelse",
  },
  teamPanelTitle: "Teamet ditt",
  teamPanelAction: "Teamoversikt",
  nextStepsTitle: "Neste steg",
  nextSteps: {
    teamNeeds: {
      label: "Se teamets kompetansebehov",
      description: "Vurder hvilke områder teamet bør styrke.",
      href: "/teams",
    },
    conversation: {
      label: "Planlegg neste utviklingssamtale",
      description: "Sett agenda og felles fokus i samtalene dine.",
      href: "/me/conversations",
    },
    roles: {
      label: "Vurder rolleforventninger",
      description: "Se hvordan ferdighetene dine passer til rollen din.",
      href: "/me/skills",
    },
  },
} as const;
