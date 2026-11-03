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
  quickLinksLabel: "Snarveier",
  teamsSectionTitle: "Dine team",
  teamsSectionDescription: "Teamene du er medlem av, med pulsmåling og utvikling.",
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
    profile: {
      label: "Profil",
      description: "Profilen din og kontoinnstillinger.",
      href: "/me/profile",
    },
  },
} as const;
