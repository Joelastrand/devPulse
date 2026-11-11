# Team-Owned Skills — Tasks

Specification: [SPEC.md](./SPEC.md) (Approved, owner decision Option A).

## Status
Ready: 0  In Progress: 0  Done: 7

Task ground rules: one task at a time; no commit, push, deploy or Firestore rules deployment; no change to global
`skillTrees`, `skillProfiles`, C2 thresholds or `authorizeTeamAccess`.

## TASK-001 — Domain: team skill and assessment shapes — Done
`src/features/team-owned-skills/domain/`: ids, limits, record validation, body parsers, criteria-version rule, the
per-rating document shape and its fail-closed reader.

## TASK-002 — Server store and team-skill operations — Done
`server/team-skill-store.ts` (Firestore), `server/fake-team-skill-store.ts`, `server/manage-team-skills.ts`: list, create,
update (criteria version, duplicate rule), set and clear own rating. Gates run inside the transaction. Tests in
`server/team-skills.test.ts`.

## TASK-003 — Aggregate view (privacy-thresholded) — Done
`src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts` (single approved C2 scan consumer, SPEC §6),
`read-team-skill-ratings-batch.ts` (identity-free exact-document reader), route `team-skills/aggregate`, and the member-visible
`TeamSkillStatus` on the Kompetanser tab. Threshold 5, opted-in members only, current criteria version, suspect ratings suppress.
Tests: `get-team-owned-skill-aggregate.test.ts`; C2 guard allowlists updated exactly.

## TASK-004 — API routes — Done
`app/api/teams/[teamId]/team-skills/` (list and create; patch; own rating put and delete). Status mapping in
`server/team-skill-http.ts`. No route tests were written for this increment; behaviour is covered by the operation tests.

## TASK-005 — Rules and erasure registration — Done
`firestore.rules` deny blocks for `teamSkills` and `teamSkillAssessments`. Inventory rows I-19 (`teamSkillAssessments`,
uidField, DELETE) and A-17 (`teamSkills` actor fields, ANONYMIZE). Personal-data step, production port, sweep counter,
actor-audit targets and owning-step map updated. The erasure guard's reviewed dynamic-key exception is **unchanged**.

## TASK-006 — Team Kompetanser administration tab — Done
`app/(app)/teams/[teamId]/skills/page.tsx`, a sixth tab in `TeamRouteNav`, and `components/TeamSkillsAdmin.tsx`: active and
inactive groups, counts, create, edit (including per-level guidance), deactivate and reactivate, with loading, empty, error
and success states. The navigation guard in `team-skills-cross-cutting.test.ts` was updated to approve the `skills` route.

## TASK-007 — Personal assessment UI — Done (accepted for the private test environment)
Completed UX improvements (`/me/skills`, accepted as implemented):
- `components/OwnTeamSkillsSection.tsx` on the Kompetansekart view, grouped by team, with the compact four-option
  radiogroup (`TeamSkillRatingControl.tsx`, keyboard-tested: arrow keys do not save), the level guidance disclosure, the
  outdated-criteria flag, All/Assessed/Not-assessed filters, and a read-only group for inactive skills.
- Global skill list (`skill-profiles/components/SkillProfilePage.tsx`) uses the same four-option control instead of a
  select; "Ikke vurdert" is a separate action; the level legend is collapsed by default. Save semantics are unchanged.
- Overview (`SkillOverview.tsx`) ordered as next steps, progress, profile; the separate development banner is folded into
  the suggestions card; an unassessed-skills hint links to Kompetansekart.
- Sharing tab (`team-skills/components/OwnCompetenceSharing.tsx`): one-line summary with the full consent wording in a
  disclosure. Sharing defaults and authorization are unchanged.
- Role tab (`personal-role-workspace/components/RoleWorkspace.tsx`): tighter spacing and a card for the formal role.
- Tabs on `/me/skills` carry decorative icons; labels and `?vy=` links are unchanged.
- Scope guard: the only raw-reader mention in `team-owned-skills/server/read-team-skill-ratings-batch.ts` was a comment,
  reworded without behaviour change. The guard itself is unchanged.

Refinement increment (personal skills UX, 2026-11-11):
- Competence map: each global skill row shows one level line ("Nivå 3 · Kan selvstendig" or "Ikke vurdert") and the
  shared four-option control. The control shows plain numbers; the full level name is in each option's accessible label
  and title. The reset action is labelled "Fjern vurdering" and appears only when a level is set. The duplicate
  four-segment indicator is removed. Save semantics are unchanged: arrow keys do not save, selecting the current level is
  a no-op, rows are disabled while saving, and errors stay per row.
- Same-name skills: rows that share a name show "Kompetanseområde N av M med dette navnet". Identity is still treeId;
  nothing is merged, renamed or deduplicated.
- Overview: the competence profile is the primary visualization, one row per skill with level text, a four-step bar and
  the target's expectation marked on the bar. The radar is an optional view opened by a button. Suggestions show the
  current and expected level ("Nivå 2 nå · forventet nivå 3"). Next steps come first in reading order.
- Role comparison: the target comparison is a labelled grid on wide screens (skill, own level, expected, status, action)
  and stacked rows on narrow screens. Cell text is unchanged, and no calculation changed.
- Sharing: the panel shows a status badge ("Deling aktiv" or "Deling av"). The consent notice is shown in full before the
  person shares. While sharing, it is collapsed into one disclosure and remains on the page. The page intro states the
  default only. Opt-in, opt-out, consent storage and authorization are unchanged.
- Scope guard: `PersonalRadar.tsx` is kept because the cross-cutting guard approves that file for the chart library.

Remaining (not done, not blocking acceptance):
- Responsibilities and contributions: no layout or empty-state restructuring yet. Primary add actions and compact empty
  states are still the original design.
- Mobile and tablet: no browser-based visual or overflow check has been run for this increment. Only component tests
  and typecheck/lint were run.
- Team-owned skills: the populated view was reviewed only through component tests and fixtures, not with live team data.
  Its rating control is now the same numeric control as the global list.
- Demo duplicate name: "Demo – Testautomatisering" appears twice because two distinct global skill trees share that
  display name. `demo-skill-testing` comes from `src/features/demo-team/fixtures.ts`, and `demoteam-test-automation` comes
  from `scripts/seed-demoteam.mjs`. Both are seeded, and the demo member has a level on each. Both records are preserved.
  Renaming one of the demo trees is a demo-data decision and was not made here.
