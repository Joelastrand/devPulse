/**
 * Norwegian UI strings for the Kompetanseprofil radar (Teamkompetanse). No string claims anonymity, and none
 * states a count of members.
 */
export const KOMPETANSEPROFIL_COPY = {
  title: "Kompetanseprofil",
  legendTeam: "Teamets nivå",
  legendTarget: "Forventet nivå",
  tableCaption: "Kompetanseprofil per område",
  columnArea: "Kompetanseområde",
  columnTeam: "Teamets nivå",
  columnTarget: "Forventet nivå",
  unset: "Ikke satt",
  noTarget: "Ikke angitt",
  tooFew: "Legg til minst tre kompetanseområder for å se kompetanseprofilen.",
  tooMany: "Profilen vises for opptil åtte områder. Se tabellen for alle områder.",
  empty: "Ingen nivåer er satt ennå.",
  invalid: "Kompetanseprofilen kan ikke vises akkurat nå.",
  summary: (setCount: number, total: number) => `Teamets nivå er satt for ${setCount} av ${total} områder.`,
} as const;

