# Product Experience — Verification record

Specification: [SPEC.md](./SPEC.md) · Tasks: [TASKS.md](./TASKS.md)

This record holds evidence only. Contrast ratios are measured arithmetic on
token values. They are **not** a WCAG conformance claim for any page or
journey.

## TASK-001 — theme contract

- Unit tests (`src/lib/theme/theme.test.ts`): default light with every OS
  setting; stored `mork` gives dark; `folg` gives dark only with an OS dark
  preference; storage read/write and `matchMedia` failures fall back to light
  without throwing; the first-paint script is evaluated against the same matrix.
- Static tests (`app/theme-foundation.test.ts`): every SPEC token is defined in
  the light and dark blocks; `dark:` is bound to `data-theme`; the root HTML
  renders `data-theme="light"` before the theme script.
- `pnpm build` passed after the root layout change.
- Limitation: `folg` is read once at page load. It does not follow a live OS
  change during the session. No settings control writes the key yet.
- Dark subtle surfaces for success, warning, danger and info are not listed in
  the SPEC. They were chosen in TASK-001 and are measured below.

## TASK-002 — contrast record

Source: `app/globals.css`, measured by `src/lib/theme/token-contrast.test.ts`
(text pairs 4.5:1, non-text pairs 3:1). Ratios are rounded to two decimals.

| Foreground | Background | Kind | Light | Dark |
|---|---|---|---|---|
| text-primary | canvas | text | 15.92 | 16.62 |
| text-primary | surface | text | 17.21 | 15.30 |
| text-primary | surface-subtle | text | 14.98 | 14.17 |
| text-primary | surface-elevated | text | 17.21 | 14.49 |
| text-primary | primary-subtle | text | 14.62 | 12.39 |
| text-secondary | canvas | text | 8.56 | 11.01 |
| text-secondary | surface | text | 9.25 | 10.13 |
| text-secondary | surface-subtle | text | 8.05 | 9.39 |
| text-muted | canvas | text | 5.21 | 7.19 |
| text-muted | surface | text | 5.63 | 6.61 |
| text-muted | surface-subtle | text | 4.90 | 6.13 |
| text-muted | surface-elevated | text | 5.63 | 6.26 |
| primary-text | primary | text | 6.37 | 7.16 |
| primary-text | primary-hover | text | 8.66 | 9.05 |
| primary | canvas | text | 5.89 | 8.91 |
| primary | surface | text | 6.37 | 8.20 |
| primary | primary-subtle | text | 5.41 | 6.64 |
| success-text | surface | text | 6.51 | 8.17 |
| success-text | success-subtle | text | 5.62 | 6.79 |
| warning-text | surface | text | 7.20 | 8.85 |
| warning-text | warning-subtle | text | 6.36 | 7.34 |
| danger-text | surface | text | 7.44 | 7.13 |
| danger-text | danger-subtle | text | 6.13 | 6.32 |
| info-text | surface | text | 7.10 | 8.17 |
| info-text | info-subtle | text | 5.97 | 7.34 |
| focus-ring | surface | non-text | 6.37 | 10.36 |
| focus-ring | canvas | non-text | 5.89 | 11.26 |
| border-strong | surface | non-text | 3.61 | 3.76 |
| border-strong | canvas | non-text | 3.34 | 4.09 |

No pair fell below its threshold, so no token value was changed in TASK-002.

## TASK-002 — raw colour guard

`src/lib/theme/raw-palette.test.ts` scans `app/` and `src/` non-test source
files for hex values and Tailwind palette classes. `app/globals.css` is exempt.
`src/lib/theme/raw-palette-allowlist.json` records the exact count per file
(81 files, 842 occurrences at creation). The list shrinks as surfaces migrate.
A new raw value fails, and so does a stale count.

## TASK-004 — icon dependency and bundle record

- Package: `lucide-react@1.66.0`, exact pin (`package.json`), ISC licence, no
  runtime dependencies, `sideEffects: false`. No other icon package is
  declared or imported (`src/components/ui/icon-dependency.test.ts`).
- Wrapper: `src/components/ui/Icon.tsx`, decorative by default, sizes 16/20/24,
  stroke width 1.75 (`src/components/ui/Icon.test.tsx`).
- Bundle method: total of every `.next/static/chunks/**/*.js` file from
  `pnpm build`, measured with Node `zlib` gzip level 9.
  - Before install: 34 files, 1,634,384 bytes raw, 468,484 bytes gzipped.
  - After install and build: 34 files, 1,634,384 bytes raw, 468,484 bytes gzipped.
  - `lucide` references in client chunks: 0 (no route imports an icon yet).
- Gate result: increase 0 bytes; the gate does not trigger. The package is
  installed but tree-shaken out of the client bundle until the first icon
  consumer (TASK-005). That consumer's increase is measured again in TASK-005.

## TASK-005 — bundle re-measurement (first icon consumer)

Same method as TASK-004 (gzip level 9 over `.next/static/chunks/**/*.js`).

| Build | Raw bytes | Gzip bytes |
|---|---|---|
| Baseline (before lucide) | 1,634,384 | 468,484 |
| StatusBadge without icons (attribution experiment) | 1,634,644 | 468,779 |
| StatusBadge with five icons (current) | 1,666,837 | 481,864 |

- Increase from the icon-bearing StatusBadge: +32,193 raw, +13,085 gzip (about
  2.8% of gzipped client JS). The experiment isolates it: the StatusBadge code
  itself adds +260 raw and +295 gzip; the rest comes from the lucide runtime
  and the five icons imported (`CircleCheck`, `TriangleAlert`, `CircleX`, `Info`,
  `CircleDot`).
- Gate reading: the increase is attributable to the icons in use, so it is not
  unexplained, and the stop condition is not met. The per-icon cost is higher
  than a typical icon set suggests. It is recorded here for owner awareness.
  Each later task that adds icons re-measures the bundle against this row.

## Test-run record (TASK-005)

- Full affected-suite run under parallel load: two 5-second timeouts,
  `RoadmapPage.verification.test.tsx` (TASK-012 mid-session permission loss) and
  `AdminSkills.test.tsx` (collapses the creation form). Both were run in
  isolation and pass (32 of 32). Recorded as load-dependent timing flakes, not
  behaviour failures. A full-suite rerun follows at the checkpoint.
- `RoadmapPage.view.test.tsx` failed on an `svg` selector after StatusBadge icons
  were added. The assertion was narrowed to the Recharts wrapper and progress bar,
  which is the intent of the test (no chart, no progress bar in the timeline).

## Checkpoint 1 (after TASK-001 to TASK-006)

- `pnpm typecheck`: passes. `pnpm lint`: 0 errors, 1 pre-existing warning
  (`create-reply.transaction.test.ts`, unused `attempts`, not touched by this feature).
- `pnpm test`, first run: 4 failed of 9024. Two were 5-second timeouts, one was
  the demo-team dependency allow-list (see below), one was a timeout in the
  skill-tree form.
- Demo-team dependency test (`src/features/demo-team/cli.test.ts`, BR-32): it
  asserts an exact runtime dependency list. `lucide-react` is the approved
  Product Experience dependency (TASK-004), so the list gained that one entry.
  The test's other checks (no `tsx`, no `allowImportingTsExtensions`) are unchanged.
- The four failing tests passed when run in isolation (151 of 151).
- `pnpm test`, rerun (the policy's one full-suite rerun): 5 failed, a different
  set of load-dependent timeouts in `RoadmapPage.verification`,
  `SkillTreeCreationForm` (two) and `TeamDetail`. One `TeamDetail` ordering test
  failed on a mock with zero calls, after an earlier timeout in the same file
  left async work running. All of these passed when run in isolation.
- Status: the full suite is **not green** at this checkpoint. The failures are
  timing-dependent under load and do not reproduce in isolation. Worker settings
  were not changed. The baseline before this feature passed in full (480 files,
  8868 tests).
## TASK-008 — chart palette and frame

- Categorical palette (SPEC order: teal, indigo, amber, rose, slate, green) as
  tokens `--chart-1` to `--chart-6` in both themes. Contrast against the surface,
  3:1 non-text threshold, measured by `src/lib/theme/token-contrast.test.ts`:

| Series | Light on surface | Dark on surface |
|---|---|---|
| chart-1 (teal) | 6.37 | 8.20 |
| chart-2 (indigo) | 7.41 | 7.72 |
| chart-3 (amber) | 5.00 | 8.85 |
| chart-4 (rose) | 5.84 | 7.32 |
| chart-5 (slate) | 7.17 | 7.95 |
| chart-6 (green) | 5.10 | 8.17 |

- `ChartFrame` (`src/components/ui/ChartFrame.tsx`): title, legend, note, a required
  table alternative for every shown chart, and an empty slot for insufficient data.
  The frame takes no data props. No existing chart was migrated.

## Route groups and public header (TASK-010)

- Full build passes after the moves (`pnpm build`). Typecheck reports no errors.
- `app/route-groups.test.ts`: all 19 page URLs unchanged; survey group has no navigation import.
- `src/components/nav/PublicHeader.test.tsx`: signed-out set is exactly Hjem, Logg inn, Opprett konto.
- Stale `.next/dev/types` (generated by an earlier dev run, git-ignored) referenced the pre-move paths and broke the build type-check; it was removed and regenerated by `pnpm build`.
- Known timing-sensitive test: `RoadmapPage.verification.test.tsx` (TASK-012 mid-session permission loss) takes about 5 s and times out only under parallel full-folder load; it passes alone (20 of 20).

## TASK-011 — desktop sidebar AppShell

- `src/components/nav/AppShell.test.tsx` (26 tests): signed-out, loading, member and
  admin link sets; exact `aria-current` for each personal entry; admin group only
  for an admin; fail-closed admin reads (failed, in flight); sign-out returns to the
  signed-out set; auth-race guards from the former header are kept.
- `pnpm build` and `pnpm typecheck` pass.
- Gap until TASK-012: below `md` the authenticated routes show no navigation. The
  mobile drawer is the next task and must land before the shell is judged on mobile.
- `PersonalNav` (in-page personal navigation) is unchanged; it duplicates the
  sidebar's personal entries until the personal pages are migrated (UX-3).
- Timing note: `RoadmapPage.verification` and `RoadmapPage.create` time out under
  parallel folder load and pass when run alone (20 of 20; 24 of 24).

## TASK-012 — mobile navigation drawer

- `src/components/nav/AppShell.drawer.test.tsx` (15 tests): opens from Meny; focus
  opens on the current link, else the first; the four close paths (Escape, Lukk
  meny, scrim, navigation); focus returns to Meny on the non-navigation closes and
  moves to the page h1 after navigation; page content inert and aria-hidden while
  open and restored on close; scroll locked and restored; Tab trapped; scrim is
  aria-hidden and not focusable; the panel carries the 200 ms state animation
  class and no transition class; the panel is `md:hidden`.
- Reduced motion: the slide-in is `animation` only, and the global
  `prefers-reduced-motion: reduce` rule in `app/globals.css` disables it. The rule
  is asserted by `app/design-tokens.test.ts`.
- **Not performed:** the manual check at 360 px in a real browser. No browser was
  driven in this run, so this item remains open and must be recorded by a person
  or a browser run before the mobile shell is judged.
- Allow-list update: after the TASK-010 page moves the allow-list still held the
  old paths. Regenerated; the counts are unchanged for the moved files, and the
  removed `SiteHeader.tsx` entries dropped out.

## Team context, admin scope and skip link (TASK-013)

- `src/components/nav/TeamContext.test.tsx`: announced team name shows in the shell; none without an announcement; cleared on unmount.
- `src/components/ui/SkipLink.test.tsx`: link targets the content region; first focusable element.
- `app/layout-skip-link.test.ts`: skip link is the first body child; each layout renders the target region; the three admin pages and the admin team detail carry the eyebrow (static checks on source).
- Scope note: the skip target is the content region wrapper that holds each page's own `<main>`, not `<main>` itself, because pages render their own `<main>` element.

## TASK-015 — containers on existing pages

- `PageShell` maps its width tokens onto the containers (`CONTAINER_FOR_WIDTH`);
  route content, copy and guards are unchanged. Build passes.
- Interpretation to confirm: admin pages use the main container. The SPEC names a
  "wide variant of the main container" but gives no separate width, so none was
  invented.
- Guard tests that scan real page paths were updated for the route-group move
  (`app/(app)/me/goals`, `app/(app)/me/skills`): the approved-importer list and
  the two cross-cutting walks. Synthetic `virtual(...)` inputs are unchanged.
- **Not performed:** the rendered horizontal-overflow check at 360 px on the three
  widest routes. jsdom has no layout engine, and no browser run was done. It
  remains open.

## Milestone check — UX-0 and UX-1 (after TASK-015)

- Shared primitives and the shell (`Container`, `Section`, `StatusBadge`,
  `ChartFrame`, `FieldLabel`, `Icon`, `SkipLink`, `PageHeader`, `Button`,
  `TextField`, `Select`, `TextArea`, `Badge`, `PageShell`, `AppShell`,
  `MobileDrawer`, `NavGroupList`, `PublicHeader`, `TeamContext`) contain no raw
  Tailwind palette classes or hex values.
- Icons: every lucide import is either the `Icon` wrapper's own component or an
  icon constant passed to `Icon`. There is one icon convention.
- Remaining raw colour: 72 files and 789 occurrences in unmigrated feature
  surfaces. They are listed in `raw-palette-allowlist.json` and shrink as those
  surfaces migrate (UX-2 onward). No later slice may add to the list.
- Buttons: one hierarchy (`primary`, `secondary`, `tertiary`, `destructive`).
- Status: `StatusBadge` is the only status presentation; the plain `Badge` is kept
  for markers (lead, self, relationship) only.
- Recorded divergence for owner awareness: the `Icon` wrapper's bundle cost is
  about 13 KB gzipped for the five icons in use (see the TASK-005 record).

## TASK-020 — survey intro and locked privacy notice

- The intro (`src/features/surveys/components/SurveyIntro.tsx`) shows the survey
  title, team name, the locked class A notice verbatim, the collapsed
  "Mer om personvernet" disclosure with its five points in SPEC order, and a Start
  action. Verified by `SurveyIntro.test.tsx` (6 tests): verbatim notice and points,
  the word "anonym" absent, no digit threshold, collapsed by default, opens on the
  native summary.
- Mode-neutral: the notice does not read `accessMode` and the survey page gets no new fetch or
  DTO field (the view is unchanged apart from the intro step).
- Not performed: a keyboard-only check of the disclosure in a real browser. The
  native `<summary>` is keyboard-operable by the platform; jsdom's key simulation
  did not toggle it, so the keyboard behaviour is not verified by a test here.
- `SurveyParticipationView.test.tsx` updated: the form now appears after Start.

## TASK-021 — one-question stepper

- `SurveyStepper.test.tsx` (5 tests): one question per screen with "Spørsmål N av 3"
  progress text and a visual bar; Next disabled until the current question is
  answered, with the text "Velg et svar for å fortsette"; Back keeps the answer; all
  three values survive forward and backward navigation; Back disabled on question 1.
- Storage guard: `src/features/surveys/survey-storage-guard.test.ts` fails on any
  `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` or `cookieStore`
  in the survey feature or the `(survey)` route group.
- Not performed: a 360 px visual check in a browser.

## TASK-022 — answer controls, review and unchanged submission

- `SurveyAnswerControls.test.tsx` (5 tests): each answer control is 44 px minimum
  (`min-h-11 min-w-11`); the selected answer uses a primary border and text on the
  primary-subtle fill; arrow keys move and select through the radio group (native
  radio behaviour, confirmed in jsdom); the review step lists the three answers as
  text with the submit action; the request body is exactly `{ answers: [4, 2, 5] }`.
- The review list is an `<ul>` with the question labels and the chosen values.
- The submission gateway, token rule, pending state and copy are unchanged.

## Security and privacy review — survey participation (TASK-023)

Scope: `/survey/[surveyId]` as changed by TASK-020 to TASK-023 (intro notice and
disclosure, in-memory stepper and review list, `(survey)` layout, storage guard).
Reviewed, not changed: the submission gateway, the `POST /api/surveys/[surveyId]/responses`
route and `submit-survey-response.ts` (`git diff` of these paths is empty).

**Outcome: PASS WITH RISKS.** No open Critical, High or Medium finding. Two Low
risks, both pre-existing and not introduced by this change. TASK-023's requirement
(no open blocking finding) is met.

Findings:

- [Low] Bearer token forwarded to the public-survey endpoint.
  Asset: signed-in user's ID token.
  Location: `SurveyResponseForm` → `submitSurveyResponse` (`idToken ?? undefined`).
  Invariant: `docs/features/product-experience` TASK-022 notes ("token rule sent only for authenticated surveys").
  Path: the form forwards the token whatever the access mode, because the DTO carries no `accessMode`. A signed-in visitor to a public survey sends a bearer token to the same-origin endpoint. The server ignores it for `public` surveys (no participation write).
  Impact: no third-party exposure and no change in authorization. It is a deviation from the stated token rule and widens the credential's exposure to one more request.
  Remediation: decide whether the rule is worth a DTO change (owner decision: that would be an API contract change). Not changed in this feature.

- [Low] Exact response timestamp alongside participation records.
  Asset: anonymity of authenticated responses.
  Location: `submit-survey-response.ts` (`submittedAt: now` on `surveyResponses`; `surveyParticipations` written in the same transaction).
  Invariant: SECURITY.md item 7 and the managed-surveys "Authentication vs anonymity distinction".
  Path: a reader with database access could match a participation write and a response by commit time. No application path does this join.
  Impact: re-linking needs operator-level database access. It is a known, documented residual risk. Not changed.

Checks passed:
- Anonymous response record contains no `uid`, `email` or name field (SECURITY.md item 6).
- Participation record is written only for authenticated surveys and carries no submission time.
- Results gated on `closed` status (`get-team-survey-results.ts`) and on the threshold.
- The notice matches the implementation. "Lagres uten navn eller e-postadresse" is true. "Da kan du bare svare én gang" holds for authenticated surveys because of the participation record. "Ikke hindre … flere ganger" holds for public surveys, where no dedup runs. "Svar som ikke er sendt inn, lagres ikke" holds because nothing is stored. The notice names no threshold and says no "anonym".
- No logging of payloads, tokens or identity in the survey server code (`grep` found no `console`/logger calls).
- No storage API in the survey feature or route group (`survey-storage-guard.test.ts`).
- Server-side authorization is unchanged; the client adds no access decision.

Review gaps (not verified here):
- A real-browser check of what survives reload and of network traffic (no browser run).
- A runtime test that a public-survey request with a token is handled identically with and without it. The current tests don't cover that case.

Verification run for this review: `pnpm vitest run src/features/surveys` (340 tests passing at the time of the TASK-022 run, plus the completion test); `survey-storage-guard.test.ts` passing.

## TASK-030 — Ferdigheter private completion summary

- The summary "Du har vurdert N av M ferdigheter." now leads the page, before the
  C1 privacy notice and the role-comparison notice (both unchanged, verbatim).
  Tested in `SkillProfileSummary.test.tsx` (3 tests): order, count equal to the
  rendered list, and no percentage, score, points or ranking wording.
- Rows are already one per skill tree (`treeId`), so the tree grouping holds.
- The optional percentage bar is not added (the SPEC marks it optional).
- Skill-profile suites: 433 of 433 passing.

## TASK-031 — target-role comparison rows

- Each state renders through `StatusBadge` (icon, text label, tone): meets (success),
  development opportunity (info), not assessed and unavailable (neutral). Tested in
  `ComparisonRows.status.test.tsx` (5 tests): text and decorative icon for each state;
  response order kept; no totals or sorting.
- Owner-only behaviour and class A/B labels are unchanged. Role-profile suites: 364 of 364.

## TASK-032 — goals cards, completion node and editor

- Status text ("Aktivt" / "Fullført") is a `StatusBadge` on every card. A decorative
  completion node fills on completion over the 300 ms progress duration; the reduced-
  motion rule disables the change. Tested in `GoalCompletionNode.test.tsx` (3 tests).
- Completed goals stay in the native collapsed `<details>` group. The creation form is
  behind the "Ny mål" button and is not the first element of the page. The privacy notice
  stays first.
- No progress percentage: no `%` in the goals page or node source.
- Gap: the goal editor replaces the card inline (the existing edit flow). It is not
  rebuilt as a disclosure in this task. Recorded as a deviation from the SPEC's "inline
  as a disclosure" wording.
- Personal-goals suites: 729 of 729 passing.

## TASK-033 — Samtaler: grouping, form disclosure and split layout

- Grouping by state: invitations (pending), open (owned, status open) and completed
  (owned, status completed), then accepted participations. Headings: "Invitasjoner",
  "Dine samtaler", "Fullførte samtaler", "Samtaler du er med i". Tested in
  `ConversationsGrouping.test.tsx` (3 tests), which also checks the create form stays
  hidden until "Ny samtale".
- Split layout: at `xl` a 20 rem context aside (participant state and shared goals)
  sits beside the main conversation; below `xl` it stacks after the main content.
  Checked by `conversation-layout.test.ts` (source check, 2 tests).
- Consequence statements, dialogs, D2 encryption and participant boundaries are
  unchanged. The development-conversations suite passes 1516 of 1516.
- Not performed: a 1280 px browser check of the split layout.

## TASK-040 — team overview summary strip and section order

- `TeamSummaryStrip` shows the latest survey's title and its published or
  insufficient status as text. It is absent when no latest survey exists. It uses
  only the already-loaded results response. Tested in `TeamSummaryStrip.test.tsx` (3 tests).
- Section order is Pulse, Competency (planning scope), Needs and coverage,
  Forum and challenges, Members, in both the authorized and the results-unavailable
  branches. Checked by `team-overview-order.test.ts` (static, 3 tests).
- Gap: "change since the last published survey", "attention items" and "what the team is
  working toward" are not in the loaded data here. They are omitted, not zeroed.
  The Roadmap summary is not a separate section in this view.
- Team suites: 986 of 986 passing.

## TASK-041 — competency progress paths and plan lines

- `SkillProgressPath` uses design tokens (zinc removed). The current stage has
  `aria-current="step"` and the text "Nåværende steg"; every stage carries its state in
  text, so none is colour-only. Tests: `SkillProgressPath.tokens.test.tsx` (2) and
  `SkillProgressPath.tokens.static.test.ts` (1, static: no raw palette classes).
- The stage select ("Sett stadium") moved directly under the path inside the same card.
- Plan line values (target, priority, period, owner, status) render as text chips
  (`CardField` value style). Labels and text are unchanged.
- Action hierarchy: "Planlegg" is secondary and "Lagre" is primary, already matching the spec.
- Skill-tree suites: 449 of 449 passing. Roadmap suites passing when run as a set.

## Checkpoint 3 (after TASK-040 and TASK-041, 24 of 40 Done)

- `pnpm typecheck`: 0 errors. `pnpm lint`: 0 errors, one pre-existing warning.
- `pnpm test` (full suite): **510 files passed, 1 skipped; 9128 tests passed, 2 skipped; 0 failed.** This run is clean, and the flaky timeouts from checkpoints 1 and 2 did not recur.
- Intermediate breakage during this phase, found and fixed before the run above:
  an earlier scripted edit inserted text into the first line of `ConversationsPage.tsx`, which broke three conversation suites. It was restored from the intended change and verified by the typecheck and by the development-conversations folder (63 files, 1597 tests). A grouping test helper had lost its render call and was repaired.
- The raw-colour allow-list was regenerated (70 files, 757 occurrences).
- Lucide attribution is still a finding for the final gate (see TASK-005): verify direct named imports and the chunk comparison before completion.

## TASK-042 — needs and coverage table with privacy disclosure

- The coverage states and the members-only and disabled-team lines are unchanged, verbatim.
- The participation notice keeps all five approved points visible and "Slik fungerer
  personvernet" is a native collapsed `<details>` in `SkillContributionPanel`. This
  was already the structure, so no code changed.
- Deviation, recorded: the SPEC's "short primary notice" is **not** introduced. Shortening
  the approved points would change class A claims, which the SPEC does not allow.
- Stacked cards below `sm` carry the same coverage text (`sm:hidden` list beside the
  `sm:table` table). The table's text labels are covered by `TeamSkillNeedsSection.a11y.test.tsx`.
- No individual level, count or person row was added.

## TASK-043 — roadmap cards, milestones and stage transition

- Status and priority render as text on each roadmap card (`CardField` chips, TASK-041).
- The stage marker (Tidligere / Nåværende / Kommende steg) transitions over the 300 ms
  progress duration. The global reduced-motion rule disables it (`design-tokens.test.ts`).
  Tested in `SkillProgressPath.tokens.test.tsx` (stage transition test).
- Filters, the view switch (`aria-pressed` buttons, `?view=timeline`) and the archive
  toggle are not changed. Roadmap suites pass.

## TASK-044 — challenges and forum visual alignment

- Forum dates are `<time dateTime>` elements (thread list and reply). Static checks in
  `src/features/forum/components/ForumDates.test.ts` (3 tests), including no avatar or
  per-author colour in the forum markup.
- Challenge status is a `StatusBadge` (TASK-005). The challenge submission has one
  submit action. The anonymity copy and the identity warning are unchanged.
- Admin challenge rows still carry several buttons; they belong to the admin pages (UX-6).
- Forum suite: 369 of 369 passing before the static assertion was added; the new file passes.

## TASK-045 — remove nested cards and keep failure isolation

- New `Card` variant `nested` (subtle fill, no border) for a surface inside a bordered
  surface. Used for the item rows inside the team sections: challenge rows, forum thread
  rows, competency rows and needs rows. Test: `src/components/ui/Card.nested.test.tsx`.
- Each team section keeps its single bordered container; the team activity zone itself
  has no border. Loading, error and empty states are unchanged.
- The structure check is by component usage, not a rendered DOM walk over the whole team
  overview. That walk is not built here, so the "no nested bordered containers" check is
  a review finding, not an automated proof.
- Team, challenge, forum, skill-tree and need suites: 2180 of 2180 passing.

## TASK-050 — results summary strip

- `ResultsSummaryStrip` (`src/features/results/components/ResultsSummaryStrip.tsx`) shows
  the latest published mean per dimension (one decimal, Norwegian comma), the survey date,
  and a change direction in words: "steg opp", "steg ned" or "uendret". The threshold for
  "uendret" is 0.05 on a 1–5 scale. This band is a presentation choice I made, not an
  approved figure, and is flagged for owner awareness.
- A change is shown only when the latest and the previous survey are both published.
- An unpublished latest survey shows the flat "For få svar ennå" state with no number.
- Tests: `ResultsSummaryStrip.test.tsx` (5 tests). Team and results suites: 791 of 791.
- Placed at the head of the authorized results section in the team overview.

## TASK-051 — trend chart

- Series colours come from the chart tokens (`--chart-1` to `--chart-3`), not hex.
- The legend is the Recharts legend. Suppressed points are gaps (`connectNulls={false}`,
  mapped to `null`). Each series has a distinct dash pattern, so series are distinguishable
  without colour. Existing trend tests pass (82 of 82 with TrendTable).
- **Deviations, recorded, not claimed:**
  - The chart is not wrapped in `ChartFrame`. The table alternative (`TrendTable`) is a
    sibling kept outside the chart error boundary, so a chart failure does not remove it.
    Moving it inside the frame would couple it to the boundary.
  - Marker *shape* is not added; the dash patterns carry the distinction.
  - No latest-point emphasis is added.
  - The 360 px no-horizontal-scroll check is not performed in a browser.

## TASK-052 — insufficient-data and history states

- Insufficient state: the existing threshold wording ("Resultatet vises når minst N
  personer har svart.") names the configured threshold, never a response count. The strip
  shows the flat "For få svar ennå" state with no number (`ResultsSummaryStrip.test.tsx`).
- History: `TrendTable` keeps its existing presentation; the suppressed rows are not
  numbers.
- Loading, error and empty states in the results section are separate components and
  are covered by the existing results suites (passing).

## TASK-060 — admin section index

- `/admin/teams/[teamId]` has an in-page section index (`nav`, labelled "Seksjoner på siden") with seven links to the top-level section anchors. Each link reads "Gå til <section>". The index is visible at every width and sticks on `lg` and up. The "hidden below lg" option was not chosen; the list wraps instead.
- Static test `AdminTeamDetail.index.test.ts` (3 tests): seven links, each targeting an existing section id, labelled landmark.
- No section content, guard or fetch changed. Team suites pass.

## TASK-061 — admin teams and member tables

- Admin team lists are a card list at every width (not a table), with status badges as
  text (`StatusBadge`). Stacked-card text equals the list text by construction.
- **Not applied:** a filter toolbar. The page has no filter today, and adding one would be
  new product behaviour, which the guardrails exclude. Recorded as a gap.
- Destructive confirmations are unchanged. The promote action and its hint are unchanged.
- Admin team suites: passing (see the admin folder run for TASK-062/063).

## TASK-062 — admin survey, challenge and skill sections

- Challenges: "Arkiver" (secondary) and "Slett" (destructive) have distinct labels and
  variants. Verified in `AdminChallengeList.tsx`.
- **Gap, owner decision needed:** the survey removal control is one button labelled
  "Slett/arkiver". Its outcome depends on whether the survey has responses (managed-surveys
  BR-35/36), so there is one action rather than two. A single label that says either is
  the owner's copy decision. Not changed here.
- Access-mode copy is verbatim. The create form uses the existing disclosure.

## TASK-063 — admin skills and roles pages

- The pages carry the "Administrasjon" eyebrow through `PageHeader` (TASK-013).
- The correction form keeps its fixed row count. The role notice is verbatim.
- Admin-related suites (admin pages, challenges, skill trees, teams): 1672 of 1672 passing.

## TASK-070 — empty states and illustrations

- Three original SVG illustrations (`src/components/ui/illustrations/illustrations.tsx`):
  goals, conversations and completion. Tests: 160 x 120 frame, `aria-hidden`, no text
  nodes (`illustrations.test.tsx`, 3 tests). Usage: exactly three references, each in its
  allowed state only (`illustrations.usage.test.ts`).
- Empty-state copy is the existing copy, with the illustration above it.
- Build passes. **Not performed:** the visual check of the illustrations in both themes in a
  browser. This remains outstanding manual evidence.

## TASK-071 — motion and reduced-motion audit

- Static audit (`src/components/ui/motion-audit.test.ts`, 3 tests): only the SPEC durations
  (`duration-micro` 120 ms, `duration-panel` 200 ms, `duration-progress` 300 ms) are used;
  every `transition-colors` names a duration; no looping or constant animation (no
  `infinite`, no `animate-*` other than the one-shot drawer slide-in).
- Reduced motion: the global `prefers-reduced-motion: reduce` rule in `app/globals.css`
  disables transitions and animations (`design-tokens.test.ts`).
- **Not performed:** a rendered reduced-motion check in a browser, on the drawer, the goal node
  and the survey stepper. The static checks above are not a rendered proof.

## Lucide bundle attribution (final gate, owner request)

- Import audit: every lucide import is a direct named import (`Menu`, `X`, `CircleCheck`,
  `CircleDot`, `CircleX`, `Info`, `TriangleAlert`) or a type-only import. No wildcard, no
  namespace import, no dynamic icon registry, no barrel that imports the whole library.
  Lucide references in the built client chunks are present only for these icons.
- Bundle, gzip level 9 over `.next/static/chunks/**/*.js`:

| Build | Files | Raw bytes | Gzip bytes |
|---|---|---|---|
| Baseline, before lucide (TASK-004) | 34 | 1,634,384 | 468,484 |
| Current, lucide imports stubbed (attribution experiment) | 35 | 1,684,813 | 488,236 |
| Current, real build | 35 | 1,696,255 | 492,471 |

- Lucide's own contribution to the current build: **+11,442 raw, +4,235 gzip** (the
  difference between the real build and the stubbed build; the stub kept the `Icon` wrapper
  and all other code).
- The rest of the increase since the baseline is product code added by this feature (the
  shell, drawer, navigation, components and their state logic), not icons.
- **Correction to earlier records.** The TASK-005 record attributed about 13 KB gzip to the
  five icons. That figure compared against a build that also removed the `Icon` wrapper, so it
  overstated the icon share. The attribution above supersedes it.
- Conclusion: no unintended whole-library inclusion was found. The lucide share is about 4 KB
  gzip for seven icons, so no remediation is needed. Lucide is not removed.

## Final feature gate — record (2026-11-03)

### Automated verification (run in this session)
- `pnpm typecheck`: 0 errors.
- `pnpm lint`: 0 errors, 1 pre-existing warning (`create-reply.transaction.test.ts`, unused `attempts`).
- `pnpm build`: passes.
- `pnpm test`, final run: 516 files passed, 1 skipped; 9147 tests passed, 2 skipped; **1 failed**:
  `TeamDetail.test.tsx` › "renders after Kompetanseområder and before the roster" —
  `AssertionError: expected "vi.fn()" to be called with arguments: ['a-token', 'team-1']; Number of calls: 0`.
  This is the same cascade seen at checkpoints 1 and 2 (an earlier timeout in the same file
  leaves async work running). It passes in isolation (109 of 109). Recorded as a load-dependent
  failure, not reconciled as passing. Worker settings were not changed.
- Raw colour allow-list: 70 files, 754 occurrences. Shrink-only since the last regeneration.

### Requirement coverage (honest)
- Covered by implemented tasks with automated tests: BR-4 (token contrast), BR-7 (icons),
  BR-8 to BR-10 (survey stepper, controls and notices), BR-14 (admin markers and index),
  BR-15 (theme), and most of the progress, team and admin requirements listed in TASKS.md.
- Partly covered, with deviations recorded in the task records: BR-3, BR-5 and BR-6 (ChartFrame
  and the editor-as-disclosure gaps), BR-9 and BR-12 (chart frame and wide container), BR-11
  (team strip items omitted), BR-13 (motion checked statically only).
- Not verified by any evidence in this session: BR-1 and BR-2 at 360 px, BR-12 rendered widths.

### Security and privacy
- Survey participation: PASS WITH RISKS, in-context review (not independent). Recorded risks:
  the signed-in ID token forwarded to public-survey requests, and the exact response timestamp
  correlated only by someone with database access.
- Auth gating in the shell (`AppShell`) was moved unchanged from the former header; its
  race and fail-closed tests pass. No separate security review was run for the shell.
- Account Erasure TASK-045 was not touched.

### Manual browser evidence — NOT PERFORMED (outstanding, not passed)
1. TASK-012: 360 px check of the mobile drawer.
2. TASK-015: 360 px horizontal-overflow check on the three widest routes; reload check.
3. TASK-020: keyboard check of the survey "Mer om personvernet" disclosure.
4. TASK-023: 360 px survey check, including reload.
5. TASK-033: 1280 px check of the conversation split layout.
6. TASK-051: 360 px scroll check of the trend chart.
7. TASK-070: visual check of the three illustrations in both themes.
8. TASK-071: rendered reduced-motion check (drawer, goal node, survey stepper).
9. TASK-072: responsive pass at 360, 768 and 1280 px, 200% zoom and 320 px reflow (not started).
10. TASK-073: automated accessibility scan, keyboard walkthrough, screen-reader spot check
    (not started).
11. Light and dark theme consistency across all routes (not performed in a browser).

### Open tasks
- TASK-072, TASK-073: need the browser evidence above. Not started.
- TASK-074: documentation closeout depends on TASK-072 and TASK-073. ROADMAP status
  line updated; the full closeout is pending.
