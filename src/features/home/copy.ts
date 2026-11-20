/**
 * Norwegian copy for the authenticated home (`/` when signed in).
 *
 * Every destination below already exists. The home adds no metric, no
 * summary of individual data and no new route (BR-38 privacy rules are
 * unchanged).
 */
export const authenticatedHomeCopy = {
  title: "Hjem",
  description: "Din oversikt over det som er viktig nå.",
  readError: "Kunne ikke laste dette nå. Prøv igjen senere.",
  loading: "Laster…",
  attention: {
    title: "Dette er viktig nå",
    empty: "Ingen oppgaver som trenger oppmerksomhet akkurat nå.",
    conversationTitle: "Neste utviklingssamtale",
    conversationNoDate: "Ingen dato satt",
    conversationWithPrefix: "Med",
    conversationAction: "Åpne samtale",
    taskOverdue: "Forfalt",
    taskDueSoon: "Forfaller",
    taskHighPriority: "Høy prioritet",
    taskNoDate: "Ingen frist",
    taskAction: "Se oppgaver",
  },
  development: {
    title: "Min utvikling",
    goals: { label: "Aktive mål", action: "Se alle mål", href: "/me/goals" },
    conversations: { label: "Åpne samtaler", action: "Se samtaler", href: "/me/conversations" },
    tasks: { label: "Åpne oppgaver", action: "Se oppgaver", href: "/tasks" },
  },
  teams: {
    title: "Mine team",
    empty: "Du er ikke medlem av et team ennå.",
    emptyAction: "Se teamene",
    openTeam: "Åpne team",
    allTeams: "Se alle team",
    listLabel: "Mine team",
  },
  teamUpdate: {
    title: "Siste nytt fra teamet",
    teamPrefix: "Team",
    latestPublished: "Siste publiserte måling",
    insufficient: "Siste måling har for få svar til å vises.",
    noSurveys: "Det finnes ingen målinger for teamet ennå.",
    action: "Se resultater",
    noTeam: "Du har ingen team å vise resultater for ennå.",
  },
} as const;
