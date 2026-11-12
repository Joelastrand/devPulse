# Visual Redesign — Verification record

Specification: [SPEC.md](./SPEC.md) · Tasks: [TASKS.md](./TASKS.md)

This file records implementation and test evidence per task. It does not claim visual fidelity. Browser evidence is the user's manual step (SPEC BR-34, BR-35) and is listed as pending until the user runs it.

## Duplicate React key on `/teams/[teamId]` (TASK-007, BR-15)

The warning reported in BR-15 names key `"2"`. The reproduction in this record produced the same warning shape with key `"1"`, which equals the `generation` value used in the test. The same source (identical `generation`-valued keys on sibling children) would produce `"2"` at generation 2; that value was not reproduced directly.

### Source (found and fixed)

`TeamDetail.tsx`, team overview render path, zone `TeamaktivitetZone` (both the normal and the `results_unavailable` branches). Three direct children of the zone carried the same key, `key={generation}`:

- `RoadmapPlanningScope`
- `TeamSkillNeedsSection`
- `TeamRosterSection`

The zone renders `{children}`. Multiple JSX children are passed to a component as one array, so React reconciles them as sibling array items and the identical keys collide. The earlier static reading ("direct children, not array items, cannot collide") was incorrect for this case: the children are array items at runtime.

Fix: each key is now prefixed per child, so the three siblings have distinct keys: `planning:${generation}`, `needs:${generation}`, `roster:${generation}`. The generation is still part of the key, so each section still remounts when the auth identity changes.

### Reproduction and regression test

- `src/features/teams/components/TeamDetail.test.tsx`, describe "TeamDetail duplicate-key boundary": renders the team overview with duplicate-prone results (two rows sharing a survey id) and asserts no `console.error` containing "same key".
- Before the fix: failed in a session run (the warning was recorded). That run is not stored as a repo script; it is recorded here as an observed session result.
- After the fix: passes. Session command: `pnpm exec vitest run src/features/teams/components/TeamDetail.test.tsx -t "duplicate-key boundary"` (1 of 1 passed).

### Rejected candidates (checked, not the source)

- `TrendChart.tsx`: line keys are fixed dimension names. Session observation (not stored in the repo): rendered alone, it logged no same-key error.
- `TrendTable.tsx`: rows were keyed by `surveyId`. Session observation before the fix (not stored in the repo): a duplicate id raised the warning when TrendTable was rendered alone. The regression test in `TrendTable.test.tsx` asserts only that no same-key error is logged after the fix. The row key is now `${surveyId}:${index}`. The server cannot produce duplicate ids, because `surveyId` comes from unique Firestore document ids (`get-team-survey-results.ts`). The TrendTable change is kept as defensive hardening, and it was not the cause of the live-page warning.
- `ResultsSummaryStrip.tsx`: fixed `DIMENSIONS` keys.
- Session bisection (observed in this session; the probe copies were deleted and are not in the repo): with results empty, the warning still occurred; with the forum disabled, it still occurred; stubbing the roadmap, skill-needs, team-skill, challenge, forum thread, roster and period summary sections in a temporary copy of the test did not remove it. The zone-key fix removed it.

### Verification

- Session runs after the fix: `pnpm exec vitest run src/features/results src/features/teams` (63 files, 1097 tests passed); `pnpm exec vitest run src/features/teams/components/TeamDetail.test.tsx src/features/results/components/TrendTable.test.tsx` (2 files, 118 tests passed); `pnpm typecheck` exit 0; `pnpm lint` 0 errors, 1 pre-existing warning; `pnpm build` exit 0.
- These results were observed in this session. The repository stores no script for them.

### Remaining browser item (not verified here)

- Reproduce on `/teams/[teamId]` with a seeded team in the emulator and confirm the browser console shows no `same key` message. Do not run `pnpm seed:demo-team` against a non-emulator project.
- BR-15 is treated as resolved at the test boundary. The live-page confirmation is pending until this browser check is recorded.

## Per-task implementation record

| Task | Status | Evidence |
|---|---|---|
| TASK-001 to TASK-004 | Done | see TASKS.md |
| TASK-005 Authenticated home | Done | `src/features/home`; home tests 10 of 10; full suite 521 files, 9196 tests passed |
| TASK-006 Team directory | Done | TeamsOverview tests 27 of 27; typecheck, lint (0 errors), build pass |
| TASK-007 Duplicate key | Source fixed in `TeamDetail.tsx` (zone child keys); regression test at TeamDetail boundary; browser item pending | this file; TeamDetail and TrendTable regression tests |

## Cross-page static sweep (TASK-018, BR-2, BR-8, BR-28, BR-30)

Static evidence only. No browser measurement was taken in this run.

- Raw colour values: `src/lib/theme/raw-palette.test.ts` passes. Allow-list entries are exact per file. One entry was lowered in this run: `SkillProfilePage.tsx` from 38 to 32, because raw classes that already existed were replaced with semantic tokens (TASK-011/TASK-012 remediation).
- Dark theme: the token contrast guard measures both themes (see the contrast record below). The new compositions use semantic tokens (`bg-surface`, `text-text-primary`, and similar). The allow-list still covers older raw usage that predates this feature.
- Reduced motion: `app/globals.css` has a global `@media (prefers-reduced-motion: reduce)` rule that sets `transition` and `animation` to `none !important` for all elements (line 210). New transitions added by this feature use the same tokens.
- Charts: each chart has a text or table alternative. The team development chart has the trend table (`TrendTable`); the roadmap uses the grouped list below md and a text board above it.
- Horizontal page scroll at 320, 360, 768 and 1280 px: NOT measured here. Static structure uses `min-w-0`, `overflow-x-auto` inside the board, the team and roadmap grids with breakpoints, and the stacked survey layout. A browser check is listed in the browser checklist below.

## Contrast record (TASK-019, BR-29, BR-3)

`src/lib/theme/token-contrast.test.ts` measures every pair in `CONTRAST_PAIRS` from the implemented token file, in light and dark themes. The list has 41 pairs, measured in 2 themes (82 cases), plus 2 arithmetic sanity tests: 84 tests, all passed in this run. Six pairs were added for the visual-redesign compositions: `text-secondary` on `surface-elevated`; `text-secondary` on `primary-subtle`; `text-primary` on `primary-subtle`; `primary` text on `surface-subtle`; `primary` non-text on `surface-subtle` (level bars); `primary` non-text on `surface` (selected tab and active marks).

Static accessibility checks in this run are covered by the existing suites: one `h1` per composition (`TeamDetail.test.tsx`, the "TeamDetail header" test; `app/(app)/me/profile/page.test.tsx`), accessible names on icon-only controls (`Icon.tsx` and `Icon.test.tsx` mark icons aria-hidden), and `aria-current` on the team route navigation (`TeamRouteNav.test.tsx`). The per-route heading and landmark tests were added later in this run; see "Per-route heading and landmark structure (TASK-019)" below. No WCAG conformance claim is made.

## Closeout (TASK-020, BR-31, BR-34, BR-35, BR-36, BR-38)

- Account Erasure: `git diff HEAD -- src/features/account-erasure docs/features/account-erasure` shows no change from this feature. The TASK-045 identifier is not used for the operator gate. The erasure entry on the profile page is rendered unchanged.
- Server, DTO and rules: no change from this feature to `app/api`, server modules, DTOs, Firestore rules or environment handling. Other working-tree changes in the repository predate or are outside this feature and are not attributed here.
- Survey and team overview: both changed presentation only. Survey payload, anonymity, answer handling and the no-storage rule are unchanged (existing survey-storage guard passes). Team overview data sources, thresholds and permission checks are unchanged. A focused security/privacy review was run for these surfaces; see the "Focused security and privacy review" section below (result, scope and remaining risks).
- Deviations (BR-36): the survey completion illustration is kept by decision A (BR-25 clarified in SPEC.md). The team overview side-by-side placement is decision B. The conversation detail tabs are decision A. The profile header shows the viewer's own display name (decision A). The admin roles below-desktop view is the existing full list (recorded reading in TASKS.md).
- Excluded reference items: two team overview values, competency coverage and ongoing initiatives, are not shown because no existing read returns them (SPEC BR-14; recorded in TASK-008). Every other excluded item has a BR-37 alternative (see the TASK records).

## Browser checklist (pending the user, BR-35)

No screenshot or browser measurement is claimed as passed. The user runs these checks:

1. Viewports 320, 360, 768, 1024, 1280 px and 200 % zoom: no unintended horizontal page scroll on the 14 routes below.
2. Light, dark and follow-system themes: each route, with the contrast of the live rendering.
3. Keyboard only: tabs (conversation detail, team tabs), filter chips, the survey bottom bar, the roadmap board buttons, the admin role list buttons.
4. Screen reader spot checks on the survey, the conversation detail tabs and the roadmap board.
5. The team overview `Kompetansebehov og dekning` placement at 1280 px and the side-by-side summary and chart at 1024 to 1100 px (TASK-004 recorded item).
6. Duplicate-key browser item (TASK-007): `/teams/[teamId]` with a seeded team in the emulator, console shows no `same key` message.
7. Survey bottom action bar on a phone width stays in view while scrolling (sticky behaviour is not verified in jsdom).

### The 14 references

| Ref | Route | Tasks | Implementation status | Visual status |
|---|---|---|---|---|
| 01 | `/` (signed out) | TASK-002, TASK-003 | Done | Not visually verified |
| 02 | `/sign-in` | TASK-004 | Done | Not visually verified (1024 to 1100 px check pending) |
| 03 | `/` (signed in) | TASK-005 | Done | Not visually verified |
| 04 | `/teams` | TASK-006 | Done | Not visually verified |
| 05 | `/teams/[teamId]` | TASK-007, TASK-008 | Done (browser duplicate-key item pending) | Not visually verified |
| 06 | `/teams/[teamId]/roadmap` | TASK-009 | Done | Not visually verified |
| 07 | `/me/skills` | TASK-010 | Done | Not visually verified |
| 08 | `/me/goals` | TASK-011 | Done | Not visually verified |
| 09 | `/me/conversations` | TASK-012 | Done | Not visually verified |
| 10 | `/me/conversations/[id]` | TASK-013 | Done | Not visually verified |
| 11 | `/admin/teams` and `/admin/teams/[teamId]` | TASK-014 | Done | Not visually verified |
| 12 | `/admin/roles` | TASK-015 | Done | Not visually verified |
| 13 | `/me/profile` | TASK-016 | Done (decision A applied) | Not visually verified |
| 14 | `/survey/[surveyId]` | TASK-017 | Done (completion illustration: decision A) | Not visually verified |

Omitted reference alternatives are listed under "Closeout" above; no alternative was omitted without a recorded reason.

## Focused security and privacy review (TASK-020, feature completion gate 7.5)

Result: PASS_WITH_RISKS. No Critical, High, Medium or Low finding. Static review of the visual-redesign surfaces (team overview, survey, conversations, profile, goals, roadmap, admin roles, skill profile and the signed-in home), with `docs/SECURITY.md` invariants checked. Evidence: no new endpoint, DTO field, persistence path, storage API, logging, external request, `dangerouslySetInnerHTML`, or server-module import in the changed client code; no change under `src/features/account-erasure`, `app/api` or `docs/features/account-erasure`; the team roster stays on the existing `{displayName, isLead, isSelf}` allow-list; the survey payload and anonymity are unchanged; suppression thresholds are unchanged; the raw-palette allow-list only tightened (SkillProfilePage 38 to 32).

Risks carried forward (not blockers):
- The signed-in home makes five existing owner-scoped reads on load plus the team results read for the first member team (BR-12). This is a behaviour change to note: more owner data is loaded on that page, through existing reads only.
- Browser and runtime behaviour (the survey sticky bar, the wide conversation pane, the home reads) is not verified here. It is part of the user's browser checklist.
- The working tree has CRLF line-ending churn across many files, so plain `git diff` is noisy. Reviews used `--ignore-cr-at-eol`.

## Per-route heading and landmark structure (TASK-019)

Helper: `src/components/ui/heading-structure.ts` (test-only; no application file imports it). `expectHeadingStructure(root, { ownsPageTitle })` reads the DOM a user can reach, skipping `aria-hidden` and `hidden`-attribute subtrees. It does not skip the CSS `hidden` class, because jsdom does not apply Tailwind and responsive variants such as `hidden lg:flex` are visible at larger widths. It requires at least one heading; with `ownsPageTitle` it requires exactly one visible level-1 heading, first in the document; and it fails when a heading level jumps down by more than one level. `expectMainLandmark(root)` requires exactly one `main` (or `role="main"`) landmark.

Each route has a route-level test that renders the route page, asserts one `main` landmark, and asserts the heading structure (`ownsPageTitle: true` where the route page renders the title through `PageHeader`). Where the route page only composes a client view that renders the title itself (team overview, admin team detail, roadmap), the route test asserts the landmark and the view's own suite asserts the heading.

| Reference | Route | Route-level test (landmark and heading) | Title owner |
|---|---|---|---|
| 01 | `/` signed out | `app/page.test.tsx`; `app/page.structure.test.tsx` | page |
| 02 | `/sign-in` | `app/(public)/sign-in/page.test.tsx` | page |
| 03 | `/` signed in | `src/features/home/components/AuthenticatedHome.test.tsx` (heading; landmark via AppShell is not in this component test) | component |
| 04 | `/teams` | `app/(app)/teams/page.test.tsx` | page |
| 05 | `/teams/[teamId]` | `app/(app)/teams/[teamId]/page.test.tsx` (landmark); `src/features/teams/components/TeamDetail.test.tsx` (heading) | component |
| 06 | `/teams/[teamId]/roadmap` | `app/(app)/teams/[teamId]/roadmap/page.test.tsx` (landmark); `RoadmapPage.view.test.tsx` (heading) | component |
| 07 | `/me/skills` | `app/(app)/me/skills/page.test.tsx` | page |
| 08 | `/me/goals` | `app/(app)/me/goals/page.test.tsx` | page |
| 09 | `/me/conversations` | `app/(app)/me/conversations/page.test.tsx` | page |
| 10 | `/me/conversations/[id]` | `app/(app)/me/conversations/[conversationId]/page.test.tsx` | page |
| 11 | `/admin/teams` | `app/(app)/admin/teams/page.test.tsx` | page |
| 11 | `/admin/teams/[teamId]` | `app/(app)/admin/teams/[teamId]/page.test.tsx` (landmark); `AdminTeamDetail.test.tsx` (heading) | component |
| 12 | `/admin/roles` | `app/(app)/admin/roles/page.test.tsx` | page |
| 13 | `/me/profile` | `app/(app)/me/profile/page.test.tsx` | page |
| 14 | `/survey/[surveyId]` | `app/(survey)/survey/[surveyId]/page.test.tsx` (the view is mocked there); the real title is checked in `src/features/surveys/components/SurveyParticipationView.test.tsx` | component (`SurveyParticipationView` renders the `PageHeader` h1; the route test mocks it) |

Checks applied to every route-level test: `expectMainLandmark` (one `main`), `expectHeadingStructure` (title rules and level order, now counting `role="heading"` with `aria-level`), and `expectNamedControls` (every visible button and link has a name). A composed view that does not own the title must add no level-1 heading, so the route title stays the only h1.

Coverage notes, stated plainly:
- The survey route test mocks `SurveyParticipationView` to a level-1 title, so it checks the page shell's landmark and the heading rule, not the real survey title.
- The signed-in home (reference 03) has a route-level test in `app/page.structure.test.tsx`: the real AppShell plus the real PageShell from AuthenticatedHome (mocked only for the panels), asserting one `main` and the heading structure.
- Global navigation `aria-current` is covered by `src/components/nav/AppShell.test.tsx` (and `PersonalNav.test.tsx`, `PublicHeader.test.tsx`, `AccountMenu.test.tsx`). Team route navigation is covered by `TeamRouteNav.test.tsx`.
- Landmarks other than `main` (for example `navigation`, `complementary`) are not asserted by the route-level tests; they are covered only where pre-existing suites test them.
- Reference 11 appears on two routes, so the table has 15 rows for 14 references. Routes outside the 14 references (`/me/erasure`, `/sign-up`, `/results`, `/teams/[teamId]/forum/[threadId]`) have no structure test in this feature; whether "per route" includes them is a decision for the user.
- Team overview, admin team detail and roadmap page tests mock the composed view, so their headings are not checked at page level.

Helper unit tests: `src/components/ui/heading-structure.test.ts` (8 tests) prove the failure paths: a second visible level-1 heading fails for a title-owning route and for a composed view; a level jump fails; aria-hidden and hidden subtrees are ignored; `role="heading"` reads its `aria-level` (default 2); an unnamed icon-only button and an unnamed link fail, a named one passes.

Named controls on composed views: `expectNamedControls` runs in the four composed-view suites as well (`TeamDetail.test.tsx`, `RoadmapPage.view.test.tsx`, `AdminTeamDetail.test.tsx`, `SurveyParticipationView.test.tsx`); all pass, so no unnamed control was found in those views.

Results (final gate, this run): full `pnpm test`: 530 files passed, 9304 tests passed, 2 skipped. Typecheck exit 0. Lint 0 errors, 1 pre-existing warning (`create-reply.transaction.test.ts`). Build exit 0.

