# Loading UX audit

Status: **partial**. Stage A (inventory) is done at the level of code search. Stage B has one primitive set. No route has been migrated yet. CLS, Playwright, and emulator measurements have **not** been run.

## 1. Inventory (code search, not yet a full read of every file)

Search terms: `loading`, `isLoading`, `phase === "loading"`, `isPending`, `aria-busy`, `Suspense`, `skeleton`, `animate-pulse`, `loading.tsx`.

| Area | Only route-level `loading.tsx` | Loading UI today | Notes |
| --- | --- | --- | --- |
| `app/(app)/teams/[teamId]/loading.tsx` | yes | `LoadingState` text plus placeholder blocks | Only `loading.tsx` in the app. Reads no team data. Uses hard-coded label "Laster teamet…". |
| Team tabs (`TeamRouteNav`, team overview, roadmap, systemoversikt, etc.) | no | Mostly text-only `LoadingState` paragraphs | Client fetches start after hydration, so the route `loading.tsx` does not cover them. |
| Home (`features/home/components/HomePanels.tsx`) | no | `LoadingState` under the teams panel | Text only; no reserved space for cards. |
| Roadmap (`features/roadmap/components/RoadmapPage.tsx`, `RoadmapPlanning.tsx`) | no | `LoadingState` in several places, one `Suspense` fallback | Several independent loading flags. |
| Teamkompetanse, Systemoversikt, Results | not verified | Not inventoried in detail | Next step. |
| Forms and dialogs | n/a | `Button` `pending` prop exists; labels are caller-supplied | Button already sets `aria-busy` and disables. |

Counted by grep (non-test `.tsx`): 52 files reference a loading flag, and 56 `<LoadingState>` call sites render a plain text line.

## 2. Problems found (from code reading)

1. **Text-only loading in most places.** A paragraph replaces a whole region, so the final content (cards, charts, tables) appears with a layout jump. This is the most likely source of the CLS measured on home and team overview. The cause is not confirmed, and it still needs measuring before changing layout.
2. **Duplicate or inconsistent labels.** The same concept has different wording across features ("Laster teamet…", "Laster…", "Laster teamets status …").
3. **No shared placeholder surfaces.** Only the team route `loading.tsx` draws placeholder blocks, and it uses ad hoc classes.
4. **Motion constraint.** `motion-audit.test.ts` allows no looping animation (`animate-pulse` is not permitted). Placeholders must therefore be static.

## 3. Design principles adopted

- Placeholders are **static**, decorative, `aria-hidden`, and use the Card tokens (`rounded-surface`, `border-border-subtle`, `bg-surface`, `shadow-card`) and the block tokens (`rounded-control`, `bg-surface-subtle`).
- A loading **region** announces once through a visually hidden `role="status"` and carries `aria-busy="true"`. Individual skeleton blocks are never announced.
- `role="alert"` is not used for routine loading.

## 4. Shared components created

`src/components/ui/Skeleton.tsx`:

- `Skeleton`: one decorative block (size comes from the caller's `className`).
- `SkeletonText`: paragraph-shaped lines; the last line is shorter.
- `SkeletonCard`: placeholder with the Card surface.
- `LoadingRegion`: wrapper with `aria-busy` and a single status message.

`src/components/ui/Skeleton.test.tsx` covers hidden blocks, line count, card surface, and single announcement per region.

Existing `LoadingState` (text, `role="status"`) is kept as is.

## 5. Routes improved

None yet. The primitives exist but no route uses them.

## 6. Before and after behaviour

Not measured. No before/after UI has been captured in a browser.

## 7. Accessibility

Implemented in the primitives: decorative blocks are hidden; one status message per region; no `role="alert"`.

Not yet verified: keyboard focus behaviour when content replaces placeholders; contrast of `bg-surface-subtle` in both themes; screen-reader output in a real assistive technology.

## 8. CLS measurements

Not measured. The brief reports CLS 0.142 (home) and 0.118 (team overview) from earlier Lighthouse runs. The shifting elements have not been identified yet.

## 9. Performance impact

The new primitives are plain React components with no dependencies and no animation. They add a small amount of JavaScript to any bundle that imports them. Not measured.

## 10. Test results

- `pnpm test:quick --files src/components/ui/Skeleton.tsx src/components/ui/Skeleton.test.tsx`: passed (related set of 57 files; 754 tests passed, 4 expected fail, 19 skipped).
- `pnpm test:standard --files src/components/ui/Skeleton.tsx src/components/ui/Skeleton.test.tsx`: passed (same counts).
- `npx tsc --noEmit -p .`: run; no errors in the new files. The repository has other uncommitted changes, so the full typecheck result was not reviewed.
- Not run: `pnpm test:full`, `pnpm test:emulator`, ESLint, Playwright.

## 11. Remaining issues

- Stages C–E are not started: no route migrated, no before/after measurement, no cleanup of ad hoc loading text.
- Measure CLS on home and team overview (Playwright or Lighthouse) before choosing layout changes.
- Identify the actual shifting elements before changing layout.
- Add regression tests for account switch during loading, permission loss, late responses, and duplicate-submit prevention in the affected hooks. These need reading of `use-auth-gated-resource` consumers first.
- Check the team route `loading.tsx` label consistency with the rest of the app.
- Decide whether to unify the loading wording in `copy` modules. This is a copy change and affects several features.
- Security-sensitive areas (erasure, admin identity changes, Teamkompetanse suppression) need a dedicated review before loading changes there; they are out of scope for the primitive work.

## Phase 2A — Home and Team Overview implementation

### Components changed

- `src/features/teams/components/TeamOverviewSkeleton.tsx` (new): layout-matched team overview placeholder (identity square and title, metrics row, five-tab row, four KPI cards, two lower panels). Built from `LoadingRegion` and `Skeleton`.
- `src/features/teams/components/TeamOverviewSkeleton.test.tsx` (new): one announcement in a busy region, placeholders hidden, grid slot counts, no animation class.
- `src/features/teams/components/TeamDetail.tsx`: the pending state renders `TeamOverviewSkeleton` instead of the one-line text.
- `app/(app)/teams/[teamId]/loading.tsx`: now renders the same `TeamOverviewSkeleton`, so the route boundary and the client view share one shape.
- `src/features/teams/components/TeamOversiktSummary.tsx`: KPI card pending value is a value-sized placeholder. The `aria-live` region is removed, so four cards no longer each announce "Laster…". A visually hidden "Laster…" stays for readers browsing the card.
- `src/features/teams/components/TeamOversiktProjects.tsx`: the project list pending state is three row placeholders, with the same hidden text and no live region.
- `src/features/home/components/HomePanels.tsx`: pending states are placeholders with the loaded panel's rows:
  - Team entry tile: label, name and link rows.
  - Team pulse: date line and three dimension rows.
  - Goals panel: three goal rows.
  - Next conversation: title, subtitle and button rows.
  - Team development panel (teams pending or results pending): the same chart-shaped card as the lazy-chart fallback, so the card no longer grows when the chart arrives.
  - Teams section: `LoadingRegion` with two card placeholders. This is the only live status on the home page.
- `src/features/home/components/AuthenticatedHome.test.tsx`: one test waited for the heading, which the chart placeholder now also shows. It now waits for the loaded chart's Recharts wrapper. One new test covers the pending state (chart height reserved, no empty-state copy, one status).

No fetch was added, removed or reordered. The `/api/teams` requests, the generation guards, the `TeamHeaderMetrics` and `TeamOversiktSummary` reads, and the permission-denied branches are unchanged.

### Loading patterns replaced

| Where | Before | After |
| --- | --- | --- |
| Team overview pending (client) | one line of text in an otherwise empty page | layout-matched skeleton inside one busy region |
| Team route `loading.tsx` | own placeholder blocks with different heights | the same skeleton as the client view |
| Oversikt KPI cards | text per card, each in an `aria-live` region | value-sized placeholder, no live region |
| Oversikt project list | text line in an `aria-live` region | row placeholders, no live region |
| Home team entry and pulse tiles | text line (card height changes on load) | rows matching the loaded tile |
| Home goals and next conversation | text line | rows matching the loaded panel |
| Home team development chart | text line, then a full chart card | chart-shaped card, same as the chart's own fallback |
| Home teams section | text line | two card placeholders in one region |

### Before and after behaviour

- Team overview: the page previously shrank to a single line during the pending state, then grew to the full layout. The skeleton keeps the loaded shape through the pending state. Heights follow the loaded components in code. No browser comparison was taken.
- Home: the largest height change was the development panel's text line replaced by the chart card. The placeholder now reserves the chart's `h-64` plot height inside the same card.

### Accessibility

- Each pending region has one visually hidden status message. Placeholder blocks are `aria-hidden`.
- The four KPI cards and the project list no longer use `aria-live`, so they don't announce on insertion.
- Nothing uses `role="alert"` for loading. No looping animation was added (`motion-audit.test.ts` enforces this).
- Not verified: screen-reader output and focus behaviour in a real assistive technology; contrast of the placeholder surfaces in both themes.

### Layout stability findings

- The code-level causes of layout change are the text-line-to-card swaps listed above. The suspected largest one is the home development panel, because the chart card is far taller than the text line. This is an inference from the code. It is not confirmed by a measurement.
- The home greeting shows the generic title until the profile name arrives. Its height is one line in both states, so it is not expected to shift, but it has not been measured.
- The team header (identity square and name) is not rendered during the pending state, so the title's appearance is the header's only shift on the team page. The skeleton reserves the title and identity height. Whether those heights match the loaded header is unmeasured.

### Measurements

- **CLS, LCP, API request counts, time to meaningful content: not measured.** Browser verification exists (`pnpm verify:browser`, Playwright Chromium present), but it needs the Firebase emulators and a signed-in fictional account. A dev server is already running on port 3000 and shares the `.next` directory, so starting a second Next process or a production build here would conflict with it. The brief forbids interrupting that server or overwriting its artifacts. Measurement is therefore not done. Measure before and after on an isolated copy or in an agreed window.
- The earlier figures (home CLS ≈ 0.142, team overview ≈ 0.118) are the brief's previous local numbers, not re-measured baselines.

### Tests

- `pnpm test:quick --files …` on the changed set (12 files, including the new tests): 62 files passed, 852 tests passed, 4 expected fail, 19 skipped, 3 files skipped.
- `pnpm test:standard --files …` on the same set: 124 files passed, 1822 tests passed, 4 expected fail, 19 skipped, 3 files skipped; exit 0.
- ESLint on the changed source and test files: exit 0.
- `npx tsc --noEmit -p .`: exit 0, zero errors across the repository.
- Not run: `pnpm test:full`, `pnpm test:emulator`, Playwright verification, and any desktop, tablet or mobile visual check.

### Remaining limitations

- No measured CLS or LCP before or after. The layout claims above are code-derived.
- No visual verification at desktop, tablet or mobile width, and no light or dark theme check.
- Authentication-initializing state, sign-out during a pending request, account switch during a pending request, and permission loss during a request are unchanged in logic and not exercised by new tests. The existing generation-guard tests still pass.
- Duplicate team-system reads remain: `TeamHeaderMetrics` and `TeamOversiktSummary` each call `fetchTeamSystems`. This predates this phase, and changing it would change request behaviour, so it was left alone.
- Other sections of the app (roadmap, Teamkompetanse, systems, results, surveys, personal and admin pages) are not migrated. The rest of the loading-state migration is not complete.
  (Phase 2B below migrates parts of these routes. Personal and admin pages are still untouched.)

## Phase 2B — Remaining Team Routes

Status: implemented and test-verified at the code and unit level. No browser verification and no measured CLS. The security check in step 2 is code-reviewed only, not exercised by new tests, and one finding needs approval before it is fixed.

### Phase 2A security check (step 2)

Reviewed the Phase 2A transitions for: auth initializing, sign-out during a request, account switch, membership revoked, late response after access loss, authorization error.

- `TeamDetail`, `AuthenticatedHome`, `TeamResultsView` and the team-skill read use the existing generation guard (`isCurrentGeneration`). A late response for an earlier generation is discarded there. The new skeletons render no data, so they cannot reveal protected content.
- `TeamSystemsPage` scopes its read by `token:teamId` and discards a superseded read with a `cancelled` flag in the effect cleanup.
- **Fixed (approved): stale response in `TeamCompetenceWorkspace`.** The request callback previously wrote `setLoaded({ token, ... })` without a generation check, so a read from a previous account, team or session that resolved late could write its data into the page. The callback now receives `generation` and `isCurrentGeneration` from `useAuthGatedResource` and applies a response only while its generation is current. Protected state is still cleared at the start of every auth change, team change and reload.
- **Fixed: rejected read.** The same request had no rejection handler, so an unexpected rejection left the skeleton up indefinitely. A rejection now sets a read-failed state, guarded by the same generation check, and renders the existing `read_failed` message (`Teamkompetansen kan ikke lastes akkurat nå.`). Authorization outcomes (`forbidden`, `team_disabled`, `unauthenticated`) are unchanged.
- **Reverted: Roadmap reload retention** (`use-team-project-roadmap.ts`). The phase 2B change that kept the last loaded plan visible during a reload is removed. A client cannot see a permission revocation until the server answers, and the brief requires protected data to be cleared at once when access becomes invalid. A save now shows the loading placeholder again while the plan reloads. This costs some visual stability, and it is the accepted trade-off.

### Routes migrated

| Route | Component | Before | After |
| --- | --- | --- | --- |
| Results (Resultater og trender) | `TeamResultsView.tsx` | one text line, then the full page; trend chart fallback text | `ResultsViewSkeleton` (summary row, current survey, period, trend table, chart) in one region; chart chunk uses `TrendChartSkeleton` |
| Results: survey results section | `TeamSurveyResultsSection.tsx` | two text lines (list and expanded details) | row placeholders (list) and text placeholders (details), each in one region |
| Systemoversikt | `TeamSystemsPage.tsx` | one text line (pre-auth and list read) | `SystemListSkeleton`: filter row and three card placeholders, no text values |
| Undersøkelser (surveys) | `SurveyWorkspace.tsx` | one text line under the stable header | three survey-card placeholders in one region; the "new survey" action is not shown until the read succeeds |
| Teamkompetanse | `TeamCompetenceWorkspace.tsx` | one text line replaced the whole page | `TeamCompetenceSkeleton`: heading, mode toggle, radar and bar areas at the loaded heights (`h-[280px]`), table placeholder; no text beyond the label |
| Roadmap | `TeamProjectRoadmap.tsx` | one text line for the initial load (a reload also shows the line) | `TeamRoadmapSkeleton` for the initial load and for each reload. The loaded plan is not kept during a reload (reverted, see step 2). |

### New shared components and skeletons

- `src/features/results/components/TrendChartSkeleton.tsx`: chart-shaped card with the real heading and description, plot box `h-64`. It moves the placeholder out of `HomePanels.tsx` so home and results share it. The label is optional; home stays silent, results announces once.
- `src/features/teams/components/TeamOverviewSkeleton.tsx` (phase 2A) is unchanged.
- `src/features/team-systems/components/SystemListSkeleton.tsx`, `src/features/team-owned-skills/components/TeamCompetenceSkeleton.tsx`, `src/features/team-projects/components/TeamRoadmapSkeleton.tsx`, and a `ResultsViewSkeleton` local to `TeamResultsView.tsx`.
- Everything is built from `Skeleton`, `SkeletonCard` and `LoadingRegion`. No new primitives, no looping animation.

### Behaviour changes that matter beyond looks

- **Roadmap reload:** no longer changed. `useTeamProjectRoadmap` is back to its original logic. Test: `does not keep the previously loaded plan on screen while the reload after a save is pending`.
- Teamkompetanse, systems, results and surveys: no request, aggregation, suppression or authorization logic changed. The Teamkompetanse placeholder shows only generic blocks and the label, so no competency, suppression or member information can appear while loading.

### Accessibility

- Each migrated region announces its label once with `role="status"` inside a `LoadingRegion` with `aria-busy`. Placeholder blocks are `aria-hidden`. No `role="alert"` is used for loading.
- The Results chart placeholder is silent on the home page and announces once on the results route.

### Tests added or updated

- `src/features/results/components/TrendChartSkeleton.test.tsx` (new, 3 tests): heading, description and plot height; silent by default; one announcement when labelled.
- `src/features/team-owned-skills/components/TeamCompetenceSkeleton.test.tsx` (new, 2 tests): one announcement, no text beyond the label, radar and bar heights reserved.
- `src/features/team-systems/components/SystemListSkeleton.test.tsx` (new, 2 tests): one announcement, no classification text, three cards.
- `src/features/team-projects/components/TeamProjectRoadmap.test.tsx`: loading test extended (placeholder hidden from AT, one status); new test for the reload-keeps-plan behaviour.
- `src/features/home/components/AuthenticatedHome.test.tsx`: the suppressed-chart test now waits for the loaded chart's Recharts wrapper, not the heading the placeholder also shows. Assertions unchanged. Phase 2A pending-state test kept.
- Existing text-based tests (`"Laster…"`, `"Laster prosjektplan …"`, `role="status"` labels) still pass because the labels remain as visually hidden text inside the placeholders.

### Test results

- `pnpm test:quick --files …` on the full Phase 2B set: 67 files passed, 896 tests passed, 4 expected fail, 19 skipped, 3 skipped files, 1 failed. The failure was a selector bug in my new Teamkompetanse test. It was fixed, and that file alone then passed (54 files, 752 tests, quick tier). The full set was not re-run in quick, but the standard run below covers it after the fix.
- `pnpm test:standard --files …` on the full Phase 2B changed set (20 paths): 194 files passed, 4 skipped; 2849 tests passed, 4 expected fail, 24 skipped; exit 0.
- ESLint on the changed source, test and `loading.tsx` files: exit 0.
- `npx tsc --noEmit -p .`: exit 0, zero errors across the repository.
- Not run: `pnpm test:full`, `pnpm test:emulator`, browser verification, and visual checks at any width or theme.

### Visual verification and CLS

Not done. The same constraint as Phase 2A applies: a dev server already runs on port 3000 and shares `.next`, and the authenticated routes need the Firebase emulators plus a signed-in test account. No CLS was measured before or after. Placeholder heights follow the loaded components in code (for example `h-[280px]` for the Teamkompetanse charts, `h-64` for the trend chart), but the match is unmeasured.

### Remaining problems

- Stale-response guard and rejection handling in `TeamCompetenceWorkspace`: fixed (see Security fix below). Phase 2B's previous approval item is closed.
- Teamkompetanse: the manual-assessment save path and the collaborative-mode switch were not reviewed for pending states; only the initial load was migrated.
- Roadmap: create, edit and archive pending states are the existing per-project busy flags; they were not restyled. Participation editing was not reviewed.
- Systemoversikt: the system edit form, save and update pending states were not reviewed.
- Surveys: submission and participation flows (`SurveyParticipationView`, `SurveyResponseForm`) were not reviewed. Their submit buttons already disable during submit in tests; a full pending-state review is still needed.
- Results: the empty case still removes the chart card after load, so the card height changes when a team has no results. That is a content change, and it is noted rather than changed.
- Duplicate team-system read (phase 2A) remains.
- No measured CLS or LCP for any route.
- Personal and admin pages: untouched.

## Security fix — stale responses in Teamkompetanse (approved)

**Changed:** `src/features/team-owned-skills/components/TeamCompetenceWorkspace.tsx` only, plus its test file. The Roadmap hook change from phase 2B was reverted (`src/features/team-projects/client/use-team-project-roadmap.ts`, and the matching test in `TeamProjectRoadmap.test.tsx` now asserts the opposite).

**Fixed:**
1. A response from an earlier authentication generation (previous account, previous team, sign-out, or a superseded reload) can no longer call `setLoaded`. The generation comes from the existing `useAuthGatedResource` guard, which is bumped on every auth change, team change and reload. A token-string comparison was not used.
2. A rejected read ends in the existing read-failed message, guarded by the same generation check. It no longer leaves an indefinite skeleton.
3. Protected state is still cleared at the start of each auth change. Authorization outcomes are unchanged.

**Tests (all in `TeamCompetenceWorkspace.test.tsx`, which now runs the real `useAuthGatedResource` against a controllable `observeIdToken` stream):**
- Account A's request is deferred; the session switches to account B, which renders; A's late response resolves; A's data is not visible and B's data remains.
- Sign-out during an in-flight request: the sign-out message shows, and the late response is not visible.
- Team switch during an in-flight request: team 2 renders; team 1's late response is not visible.
- Unexpected rejection of the aggregate read: the read-failed message shows and the skeleton's loading label is gone.
- Rejection from a superseded account is not applied.

**Mutation check:** the generation check was removed from the component temporarily (the file was backed up and restored, and the restore was verified with `cmp`). Three of the four stale-response tests failed without it: account switch, team switch, and superseded rejection. The sign-out test still passed without the check. That is because the unauthenticated branch renders before the loaded data is used, so the sign-out case is protected by render order, not by the generation check. The stored data is still held in memory until the component unmounts.

**Results:**
- `pnpm test:quick` on the changed set and the related competence route test: 57 files passed, 815 tests passed, 4 expected fail, 19 skipped.
- `pnpm test:standard --files` on the five changed files: 77 files passed, 4 skipped; 1100 tests passed, 4 expected fail, 24 skipped; exit 0.
- ESLint on the five changed files: exit 0.
- `npx tsc --noEmit -p .`: exit 0, zero errors.

**Not verified:**
- `pnpm test:emulator` and `pnpm test:full` were not run. Emulator tests need the Firestore and Auth emulators, and none was running on ports 8080 or 9099. Starting them was not part of this scope.
- No browser run. The fix's behaviour in a real signed-in session (token refresh timing, real `observeIdToken` events) is not exercised.
- The sign-out path is protected by render order, not by the generation guard. If that branch changes, the generation guard becomes the only protection, and the sign-out test would catch it only if the render order changes too.
- The Roadmap hook's behaviour on a real permission revocation during a reload is unchanged from the original code (the revert restores it).
- Other components with the same request pattern (for example, the Teamkompetanse manual-assessment save) were not reviewed for the same guard. (Reviewed in Phase 2C below.)

## Phase 2C — Interactive Loading and Mutation UX

Status: the mutation flows listed below are implemented and covered by focused tests. There is no browser verification and no emulator run. Phase 2C is functionally complete for the flows listed. It is not fully verified. Unreviewed flows are listed under "Remaining".

### Flows changed

| Route | Flow | Change |
| --- | --- | --- |
| Teamkompetanse | Manual assessment save (collaborative mode) | Pending label "Lagrer …" on the button. A ref blocks a second submit before a re-render. A refused write shows its own message (`denied`) instead of the generic failure. Success is confirmed at page level and survives the reload. |
| Teamkompetanse | Mode switch, radar selection, table expansion | Reviewed: local state only, no request. No change. |
| Systemoversikt | Create or edit system (`SystemForm`) | A ref blocks a double submit. Success closes the form only after the server confirms. A refused save keeps the typed draft (existing behaviour, now tested). |
| Undersøkelser | Survey response submission (`SurveyResponseForm`) | A ref blocks a double submit. A response that resolves after the signed-in token changed is dropped. The previous session's answers are cleared, and the form returns to idle. |
| Undersøkelser | Create survey (`CreateSurveyPanel`) | A ref blocks a double submit. A create response that resolves after the token changed does not open the created survey. |
| Undersøkelser | Results of one survey (`TeamSurveyResultsSection`) | An on-demand result is cached only if the auth generation is still current. Before this change, a late result from a previous account or team stayed in the cache and was shown later for the next one. |
| Roadmap | Project create, update, archive, restore; participation create, update, remove | A ref blocks a second write while one is in flight. The scope (team and token) is captured when a write starts, and a result for another scope is not shown. Busy state always clears, so a superseded write cannot leave controls disabled. |
| Resultater og trender | Filters, time ranges, refresh | Reviewed: the route has no filters, time-range selector, export or refresh control. Nothing to change. |

### Mutation UX pattern applied

- **Denied versus failed:** an authorization outcome (`forbidden`, `unauthenticated`, `team_disabled`) is shown as an info message with no retry. A generic failure invites a retry.
- **Pending:** only the submitting control is disabled, and its label changes ("Lagrer …"). The rest of the page stays usable.
- **Duplicate submit:** a ref is checked and set synchronously. A state-based check can still pass a second submit before a re-render (Enter key).
- **Success:** shown only after the server confirms. Where the view reloads after a write, the confirmation is held in page state and scoped to the current token and team.
- **Input preserved:** a failed write keeps the typed values.
- **Identity change:** a result that resolves after the token or team changed is not applied, and the UI is reset to a usable state.

### Stale-response review of the manual-assessment save

The row's write is sent with the token captured when the user clicked. A client-side guard does **not** cancel a write that has already reached the server. The server authorizes it under that token, so it may complete after sign-out. The UI does not claim success in that case. The row is unmounted by the reload, and the confirmation is scoped to the token and team that wrote it. The confirmation contains no protected data, only "Lagret.".

The notice has two guards. The auth callback clears any notice whose token or team differs from the new one. The render also checks the notice against the current scope. The callback guard covers the common case. The render check closes a window: the success and the reload's state updates are batched into one commit, so a stale notice could render for one frame before the effect clears it. No test observes that single frame.

### Tests

- `TeamCompetenceWorkspace.test.tsx`: manual-save tests cover pending and duplicate submit (button and Enter), page-level success across the reload, a failed save keeping its values, a refused save showing the access message, and sign-out, account switch and team switch during a pending write. The existing save assertion was changed to check the page-level confirmation. Mutation-checking the notice scope check left the tests passing, because the callback clear covers those cases. The one-frame window is not testable.
- `SystemForm.test.tsx` (new, 3 tests): a second submit while saving sends one write; the form closes only after confirmation; a refused save keeps the typed name.
- `SurveyResponseForm.test.tsx`: three new tests: one request for a repeated submit while pending; no success after sign-out; no error after an account switch, with the form not stuck in a busy state.
- `CreateSurveyPanel.submit.test.tsx` (new, 2 tests): one create request for a repeated submit; no opening of a created survey for a superseded token.
- `TeamSurveyResultsSection.staleness.test.tsx` (new, 2 tests): account A's late result is not shown or cached for account B; a previous team's late result is not cached for the next team. Mutation-checked: removing the guard fails both tests. The sed used for the check matched two identical guards (list load and result toggle), so both were disabled together. The file was restored from a backup and verified with `cmp`.
- `TeamProjectRoadmap.test.tsx`: a late write failure from a previous team does not show an alert on the new team's page, and the archive control is usable again. Mutation-checked: removing the scope guard fails the test.

### Validation

- `pnpm test:standard --files …` on the 14 Phase 2C paths: 120 files passed, 4 skipped; 1708 tests passed, 4 expected fail, 24 skipped; exit 0.
- ESLint on the same 14 paths: exit 0.
- `npx tsc --noEmit -p .`: exit 0, zero errors.
- Focused quick runs during development were passing for each feature group.
- Not run: `pnpm test:full`, `pnpm test:emulator`, browser verification.

### Accessibility

- Pending buttons carry `aria-busy` and a changed label. Only the submitting controls are disabled.
- Success and denial messages use the existing `Alert` roles. No new `aria-live` regions were added.
- Not verified with assistive technology.

### Remaining

- **Roadmap editing:** the project and participation forms use the existing per-project busy flags, which were not restyled. The participation edit flow has no test for a stale response within the same team.
- **Systemoversikt:** a save still reloads the whole list. The brief asked to avoid this where safe. It was not changed, because the reload keeps the list and its classification values consistent with the server.
- **Undersøkelser:** survey participation flows (`SurveyParticipationView`) were reviewed only through the response form. Opening a survey (loading state) was not changed.
- **Teamkompetanse:** no consent controls were found on this route, so none were changed.
- **Token-refresh trade-off:** the scope keys (Roadmap, survey response, create survey) use the token string. A token refresh during a pending write counts as a new identity, so that write's outcome is not shown, and the survey response clears its answers. Refreshes are rare during a write, but the user may need to reload to see the result. A stable identity key would avoid this. That change belongs in the auth client, which is out of scope.
- **Server-side writes after sign-out:** a write that has reached the server completes regardless of the client. Nothing in the UI claims cancellation or rollback.
- **Browser and emulator verification:** not run. The same dev-server constraint as earlier phases applies, and the emulators were not running.

## Phase 2D — Personal and Administrative Routes

Status: partial. Two personal flows are migrated and tested (profile and goals). Most personal and administrative routes are not reviewed in depth. This phase is **not** functionally complete.

### Route tree reviewed

Source of truth: `app/(app)/me/*` and `app/(app)/admin/*`.

| Route | Reviewed | Status |
| --- | --- | --- |
| `/me/profile` | yes | migrated: loading skeleton, duplicate-submit guard |
| `/me/goals` | yes | migrated: loading skeleton |
| `/me/skills` | no | not reviewed in depth (`skill-profiles`: `SkillOverview`, `SkillProfilePage` still use text loading) |
| `/me/conversations` | no | not reviewed in depth (`ConversationsPage`, `ConversationDetail`, selectors, `ParticipantPanel` still use text loading) |
| `/me/conversations/[conversationId]` | no | not reviewed in depth |
| `/me/erasure` | no | not reviewed. Security-sensitive; must not be changed without the erasure owner's review |
| `/admin/teams`, `/admin/teams/[teamId]` | no | not reviewed in depth (`AdminTeams`, `AdminTeamDetail` still use text loading) |
| `/admin/roles` | no | not reviewed in depth (`AdminRoles`, `MemberRoleAssignments`) |
| `/admin/skills` | no | not reviewed in depth (`AdminSkills`, `SkillTreeCatalogList`) |
| `/admin/superadmins` | no | not reviewed in depth (`AdminSuperadmins`, `AdminUsers`). Security-sensitive; not changed |

Personal goal responsibilities, achievements and formal role sections (`personal-role-workspace`) were not reviewed in this phase.

### Routes migrated

- **Profile (`ProfileForm.tsx`):** the loading state is a card-shaped skeleton (sentence line, field, action row) in one busy region, with no name or text. Save and remove share one ref-based guard, so a second submit before a re-render (Enter key) is blocked and the guard is cleared in `finally`. Before, the guard read state from the closure.
- **Goals (`GoalsPage.tsx`):** the initial load is a list of three goal-row placeholders in one busy region, replacing the text line. The mutation flows were reviewed, not changed: each change refetches the page and unmounts the view when the generation changes, so a late result cannot apply to the wrong identity.

### Skeleton components

- `GoalsListSkeleton` (local to `GoalsPage.tsx`) and `ProfileFormSkeleton` (local to `ProfileForm.tsx`). Both are built from `LoadingRegion`, `Skeleton` and `SkeletonCard`. No new shared primitive was needed.

### Stale-response review (section 10)

- **Profile:** every load and save result passes through `isCurrentGeneration`. A save that resolves after sign-out or an account switch is not shown, and the save button is not left busy. Covered by two new tests.
- **Goals:** a mutation result is returned to a view that unmounts on an identity change, and the follow-up refetch uses the captured generation, so its result is discarded. The refetch still runs with the previous token, which the server authorizes. This is an extra read for an identity that is no longer current. It is documented and not changed, since changing it would alter request behaviour.
- **Token refresh:** the profile and goals guards use the existing generation guard, not the token string. A token refresh does not discard a profile save. The Roadmap, survey response and create-survey flows from Phase 2C are still token-scoped (see the Phase 2C limitation). This phase did not change them, as the brief requires.

### Security findings

- None requiring approval in this phase. No authorization, consent or encryption behaviour was changed.
- **Not reviewed for stale-response safety:** erasure (`/me/erasure`) and superadmin screens. Both are security-sensitive and need their owners' review before any loading change.

### Tests

- `ProfileForm.test.tsx`: two new tests: a save that resolves after sign-out is not confirmed; a save failure from a previous account after a switch is not shown and the button is not left busy.
- `GoalsPage.test.tsx`: the loading test additionally checks that the placeholder is decorative and that the region is busy.
- Focused quick runs: profile files 55 files / 787 tests; goals files 58 files / 836 tests. All passing.
- `pnpm test:standard --files` on the four changed files (`ProfileForm.tsx`, `ProfileForm.test.tsx`, `GoalsPage.tsx`, `GoalsPage.test.tsx`): 85 files passed, 3 skipped; 1625 tests passed, 4 expected fail, 19 skipped; exit 0.
- ESLint on the same four files: exit 0.
- `npx tsc --noEmit -p .`: exit 0, zero errors.

### Accessibility

- Placeholders are decorative and hidden from assistive technology. Each loading region announces once and is marked `aria-busy`.
- The profile save button keeps its own pending label and `aria-busy`. Nothing else is disabled.
- Not verified with assistive technology, and no visual check at any width or theme.

### Remaining generic loading states

- `<LoadingState` call sites in `src`/`app`: **41** occurrences across **36** non-test files. These are the generic loading states that remain. Those in personal skills, conversations, team administration, role and skill administration, and superadmin screens are the main groups.
- Button-local pending labels were left as they are, as the brief asks.

### Not done in Phase 2D

- Personal competency profile (`/me/skills`): not migrated.
- Personal responsibilities, achievements and formal role: not migrated.
- Conversations (list, detail, notes, create and edit): not migrated.
- Team administration (members, roles, invitations, dialogs): not migrated.
- Global administration (roles, skills, superadmins): not migrated.
- Erasure: not changed. Requires the erasure owner's review.
- No browser verification and no emulator run.

## Phase 2D.2 — Personal Skills, Responsibilities, Achievements and Formal Roles

Status: **partial, not functionally complete.** Loading states are migrated for all four areas. Mutation UX is migrated only where stated below. No browser verification and no emulator run were done in this phase.

### Components and routes inspected

- `/me/skills?vy=oversikt` → `SkillOverview.tsx` (summary, radar, next steps).
- `/me/skills?vy=rediger` → `SkillProfilePage.tsx` (per-skill level saves, clear, reset-all), `OwnTeamSkillsSection`.
- `/me/skills?vy=rolle` → `RoleWorkspace.tsx`, which renders `FormalRoleSection.tsx` (read-only, `GET /api/me/role-assignment`), `ResponsibilitiesSection.tsx` and `AchievementsSection.tsx` (both via `useOwnerRecords`).
- `/me/skills?vy=deling` is outside this phase.
- The page is one route with `?vy=` tabs; only the selected view mounts.

### Loading states migrated

| Area | Before | After |
| --- | --- | --- |
| Skills overview | `LoadingState` text | `SkillOverviewSkeleton`: three summary tiles and a 300px radar box, the same height as the lazy radar placeholder |
| Skills editing | `LoadingState` text | `SkillListSkeleton`: heading and three skill rows |
| Formal role | plain text paragraph | `FormalRoleSkeleton`: title line and two text lines |
| Responsibilities list | `LoadingState` text | `RecordListSkeleton`: two record cards (title, text lines, action row) |
| Achievements list | `LoadingState` text | `RecordListSkeleton` (same component) |

Each loading region has one `role="status"` announcement with the existing label, and `aria-busy`. Placeholders are `aria-hidden`. The lazy-loaded chart is still not imported on the initial load. No `animate-pulse` or looping animation was added.

### New and reused skeletons

- New, feature-local: `features/personal-role-workspace/components/RoleSkeletons.tsx` (`RecordListSkeleton`, `FormalRoleSkeleton`), and `features/skill-profiles/components/SkillSkeletons.tsx` (`SkillOverviewSkeleton`, `SkillListSkeleton`).
- Reused: `LoadingRegion`, `Skeleton`, `SkeletonText` from `src/components/ui/Skeleton.tsx`. `SkeletonCard` was not used because its padding does not match the real record cards.
- New copy keys: `responsibilities.loading`, `achievements.loading` (Norwegian).

### Mutation UX

- Responsibilities and achievements: no change in this phase. Save already shows its pending label (`Button pending`) and the form guard. Toggle-complete and delete actions have no per-action pending indicator; this is a remaining gap.
- Skills rows: no change. Existing per-row pending, duplicate guard and reset confirmation were reviewed and kept.
- Formal role: read-only. No editing controls were added.

### Stale-response and session review

- Formal role, responsibilities and achievements use the existing generation guard (`useAuthGatedResource` through `useOwnerRecords`). Late successes and late failures from a previous identity are discarded. The tests cover sign-out, account switch, and late success and failure.
- No token is compared as an identity. No auth, role, claim, encryption or rule was changed.

### Tests

- New `RoleWorkspace.loading.test.tsx`: loading placeholder hidden from assistive technology and announced once with `aria-busy`; no empty message while pending; empty state only after success; failure distinct from empty; late success after sign-out ignored; late success and late failure from the previous identity ignored; responsibilities late list after sign-out ignored.
- New `SkillSkeletons.test.tsx`: single announcement, decorative blocks with no text, radar height reserved.
- Existing `RoleWorkspace.test.tsx` and `SkillProfilePage.test.tsx` loading assertions still pass.

### Validation (this phase)

- `pnpm test:quick --files` (changed role and skills files plus new tests): 64 files passed, 3 skipped; 886 tests passed, 4 expected fail, 19 skipped; exit 0. Quick is task-scoped feedback only.
- `pnpm test:standard --files` with the ten changed source and test files listed above: 83 files passed, 4 skipped; 1274 tests passed, 4 expected fail, 24 skipped; exit 0. The run is scoped to these files, not the full suite.
- `npx tsc --noEmit -p .`: exit 0.
- ESLint on the changed source and test files: exit 0.
- Emulator tests: not run. These areas have no persistence change in this phase.

### Browser and visual verification

- **Unverified.** No browser check at desktop, tablet or mobile width, light or dark theme, reduced motion, or keyboard focus. No CLS measurement was made, so no layout-shift improvement is claimed.

### Remaining issues

- Responsibilities and achievements: toggle, delete and recovery actions lack a per-action pending indicator and duplicate-submit guard.
- Achievements: loading is covered only by the shared placeholder test; no full-flow mutation test was added.
- Skills `vy=deling` and `OwnTeamSkillsSection` loading were not reviewed.
- Browser and emulator verification are outstanding (see above).
- Phase 2D.2 is **not** functionally complete under the brief's definition of done (mutation pending/error behavior is incomplete for responsibilities and achievements).

## Phase 2D.3 — Personal Loading and Mutation Completion

Status: **partial.** Mutation pending, duplicate-action protection and identity-change handling are done for responsibilities, achievements and team-owned skill ratings. Browser and emulator verification were **not** run. Two scope-guard tests fail for reasons outside this phase's edits (see Validation).

### Components reviewed

- `ResponsibilitiesSection.tsx`: toggle (complete and reopen), delete (including recovery items), create and edit save.
- `AchievementsSection.tsx`: edit save, delete (including recovery items). Achievements have **no completion toggle**, so none was added.
- `FormalRoleSection.tsx`: read-only; no mutation exists.
- `OwnTeamSkillsSection.tsx` (`/me/skills?vy=rediger`): loading, team blocks, per-skill rating writes.
- `OwnCompetenceSharing.tsx` (`/me/skills?vy=deling`): one sharing panel per member team, read from the overview. Its writes live in `SkillContributionPanel`, which was not changed.
- `SkillOverview.tsx` and `SkillProfilePage.tsx`: reviewed in Phase 2D.2; unchanged here.

### Mutations improved

- **Responsibilities, complete/reopen:** the row's toggle shows `Oppdaterer…` and is disabled; the row's edit and delete are disabled too. Other rows stay usable. A repeat click is blocked by a ref before the next render. Success appears only after the server confirms and the list is re-read.
- **Responsibilities, delete:** the confirmation keeps its place and its button shows `Sletter…` while pending. The row stays visible until the server confirms. A failed delete restores the controls and keeps the record.
- **Responsibilities, save:** the save button shows `Lagrer…`; a second submit is blocked by a ref.
- **Achievements, delete:** same pattern as responsibilities. The edit form closes only after a successful delete, so a failed delete keeps the draft.
- **Achievements, save:** `Lagrer…` label and a ref guard.
- **Team-owned skill ratings:** the affected skill's control and clear button are disabled and show `Lagrer …` while pending. Repeat clicks on the same skill are blocked; other skills stay usable.

### Shared behaviour added

- `useOwnerRecords.mutate` now returns `{ status: "done", result }` or `{ status: "superseded" }`. A write that finishes after the auth generation changed shows **neither** success nor failure. The canonical list is re-read for the current state.
- A token refresh also bumps the generation. A write that completes during a refresh is therefore reported as superseded (no message), and the list is re-read. This is the existing token-refresh behaviour; the auth lifecycle was not changed.

### Skills loading changes

- `OwnCompetenceSharing`: the loading text became a `LoadingRegion` placeholder (one announcement, decorative blocks). **Fixed:** after sign-out the view showed "Laster…" indefinitely. It now shows a sign-in message, and the previous account's team list is dropped.
- `OwnTeamSkillsSection`: the loading text became `OwnTeamSkillsSkeleton` (heading, filter line, one team card with three skill rows). **Fixed:** the overview and per-team reads, and the reload after a rating, were not checked against the auth generation, so a late result from a previous account could be applied. They now are.
- The existing 300 px radar placeholder and lazy Recharts loading are unchanged. No new API request was added.

### Formal role: review outcome

No change. Evidence:

- Initial loading shows a placeholder under one busy status (Phase 2D.2 test).
- The "no role" message appears only after `status: "none"` from a successful 200.
- `401` maps to the signed-out text. Any other failure (including `403`) maps to "could not be shown now" and is never displayed as "no role".
- Success and failure are applied only after `isCurrentGeneration`. Covered by `RoleWorkspace.loading.test.tsx` (late success after sign-out; late success and late failure after an account switch).
- No editing or assignment exists, so none was added.

### Permission denial

The personal records routes (`/api/me/responsibilities`, `/api/me/achievements`) return `401` for unauthenticated, `404` for a missing record, and `persistence_failed` or `invalid_input` otherwise. They do **not** return `403`. The distinct denial message shown is the existing `unauthenticated` copy ("Logg inn på nytt for å fortsette."). No 403 handling was invented.

### Security checks

- No authorization, ownership, achievement calculation, role policy, claims, encryption, consent or Firestore rule changed.
- Identity: each changed read or write is checked against the generation it started under. No UID-only matching was introduced; no protected data is cached across identities.
- Known gap: an account switch **without** an intervening sign-out is not distinguished from a token refresh by these components (the token is not compared as an identity). The team-owned and sharing views keep the previous team list until the new read completes in that case. Sign-out clears it. Documented, not changed: fixing it needs an identity signal from the auth client, which is out of scope.

### Tests

- New `RoleWorkspace.mutations.test.tsx` (10 tests). Responsibilities: pending completion; duplicate completion blocked; successful completion after confirmation; failed completion keeps state; unauthorized shows the unauthenticated message and no success; pending delete; duplicate delete blocked; failed delete keeps the row; late success after an account switch ignored; late failure after sign-out ignored. Achievements: pending delete with duplicate blocked and unaffected rows enabled; failed delete keeps the row; late delete from the previous account ignored.
- New `OwnTeamSkillsSection.test.tsx` (8 tests): placeholder announced once and decorative; loaded content replaces it; empty only after a successful empty read; failed overview distinct from empty; pending rating blocks a repeat and disables only that row; write error keeps controls usable; late team list from a previous account ignored; rating outcome after sign-out not shown as saved. Gateways are mocked at the module boundary; the component and its generation logic are real.
- New `OwnCompetenceSharing.loading.test.tsx` (3 tests): single announcement; sign-in message, not the placeholder, after sign-out; previous team list not shown after sign-out.
- Existing `RoleWorkspace.test.tsx`, `RoleWorkspace.loading.test.tsx`, `OwnCompetenceSharing.test.tsx` and the skills tests still pass.

### Validation

- Focused runs: all new and changed test files pass. `RoleWorkspace.mutations.test.tsx` run directly: 10 passed. `OwnTeamSkillsSection.test.tsx` run directly: 8 passed. `OwnCompetenceSharing.loading.test.tsx` with `OwnCompetenceSharing.test.tsx`: 11 passed.
- `pnpm test:standard --files` on the nine changed source and test files (`use-owner-records.ts`, `copy.ts`, `ResponsibilitiesSection.tsx`, `AchievementsSection.tsx`, `RoleWorkspace.mutations.test.tsx`, `OwnTeamSkillsSection.tsx`, `OwnTeamSkillsSection.test.tsx`, `OwnCompetenceSharing.tsx`, `OwnCompetenceSharing.loading.test.tsx`): **98 files passed, 4 skipped, 1 failed**. Tests: **1679 passed, 2 failed, 4 expected fail, 24 skipped**. The run is scoped with `--files`; it is not a full-suite pass.
- The two failures are in `src/features/team-skills/team-skills-cross-cutting.test.ts`:
  1. "Demo Team fixtures, plan, seed and writer name no C2 or personal-assessment data": the guard flags files under `src/features/demo-team/`.
  2. "team navigation exposes only the approved destinations": the guard flags `src/features/teams/components/TeamRouteNav.tsx`.
  Both files already had uncommitted changes from the user before this phase (`git status` lists them as modified), and this phase did not touch either. I did not verify against a clean baseline, so the cause is not proven; the evidence is that the failing guards point only at those files. Not fixed here: the fix belongs to the demo-team and navigation work.
- `npx tsc --noEmit -p .`: exit 0, zero errors.
- ESLint on the changed source and test files: exit 0 (one unused-import warning was fixed).
- Emulator tests: not run. No persistence, Firestore rule or transaction change in this phase.

### Browser verification

- **Not performed.** No authenticated browser environment was used. Nothing is claimed about desktop, tablet or mobile layout, light or dark theme, reduced motion, focus order, horizontal overflow, or chart-placeholder dimensions. No CLS was measured.

### Remaining issues

- Responsibilities recovery-item delete: covered by code, not by a dedicated test.
- Account switch without sign-out: see Security checks.
- Token refresh during a write: a completed write is reported as superseded, with no message (documented above).
- Browser and emulator verification: outstanding.
- The two failing scope guards above: outside this phase; need the owners of the demo-team and navigation changes.

**Phase 2D.3 is not functionally complete and not fully verified.** Mutation feedback is in place for the listed actions and the focused tests pass, but browser verification is missing and the scoped standard run has two failures in code this phase did not touch.

## Phase 2D.4 — Identity Isolation and Regression Closure

Status: **partial.** One identity-isolation defect was reproduced and fixed in the sharing view, and a notice leak was reproduced and fixed in the record sections. One identity-isolation risk (drafts across a direct switch) cannot be closed without an auth-client signal, and is **approval-blocked**. The two scope-guard failures from Phase 2D.3 are root-caused to uncommitted work outside this phase; they remain failing and need a decision. Browser and emulator verification were not run.

### Current state inspected

- `git status` was checked before editing. Files this phase touched were re-read from disk, and the working tree was not reverted. Several files outside this phase carry uncommitted work from the user (demo-team, `TeamRouteNav.tsx`, team-owned competence components, the new `teamkompetanse/rating-update*.ts` files).
- During the work, `ResponsibilitiesSection.tsx` and `copy.ts` changed on disk between reads. The current content was used; nothing was reverted.

### Auth signal: what the client actually guarantees

- `observeIdToken` (`src/features/auth/client/auth-client.ts`) emits the current ID token, or `null` when signed out, on **every** token change. That includes sign-out, an account switch, and a token refresh.
- It exposes **no user identifier, session identifier, or generation**. A component therefore cannot tell an account switch from a token refresh.
- `useAuthGatedResource` bumps its generation on every emission. A generation is a staleness check, not an identity. It does not prove that the account is the same.
- Token comparison is not used as an identity or authorization decision. The client forwards the token for the server to verify; the server re-checks verification, the disabled flag, and the team/role rules on every protected request.

### Account-switch finding (reproduced)

Scenario: account A loads protected data, the token changes directly to account B (no `null` in between), and B's request is still pending.

- **`OwnCompetenceSharing`: reproduced, fixed.** A's member-team list stayed rendered until B's overview resolved. Three new tests failed before the fix: the loaded-A-visible-during-B-pending test, the late-A-after-switch test, and the late-A-failure test (the first two showed A's team button still present). The fix resets the team list and the open explanation dialog on every auth change. Mutation check: removing the reset makes the direct-switch test fail; restoring it passes.
- **`OwnTeamSkillsSection`: not reproduced.** The section already clears its blocks on every auth change and checks the generation before applying a read or a rating outcome. Two new tests pass against the current code (direct switch clears A's blocks and skills; a late rating from A is not shown for B).
- **`TeamCompetenceWorkspace` (team-scoped competence view): not reproduced.** It already clears its loaded state on every auth change and on every team change. Two new tests (direct account switch, and team 1 to team 2 with loaded data) pass once the emit is wrapped in `act`. The first attempt failed because the emit was not flushed to the DOM, which was a harness issue, not a component defect.
- **`ResponsibilitiesSection`, `AchievementsSection`, `FormalRoleSection`: the list is not reproduced as exposed.** Each list resets to loading on every auth change through `useOwnerRecords` or its own callback. New tests cover this.
- **Success notice leak (record sections): reproduced, fixed.** A success notice from A (for example "Ansvarsområdet er markert som fullført.") stayed visible in B's UI after a direct switch. Fix: `useOwnerRecords` now exposes an `authEpoch` counter that changes on every auth change. The two record sections clear their notice and any open delete confirmation during render when the epoch changes, so the old message never paints. Mutation check: removing that block makes the notice test fail; restoring it passes.
- **Draft leak across a direct switch: NOT fixed (approval required).** An open responsibility or achievement draft (A's typed text) remains in the form after a direct switch to B. The fix would clear drafts on every auth change, but the browser cannot tell a switch from a refresh, and tokens refresh about hourly. Clearing drafts on every change would discard a user's input mid-edit. The draft is cleared on sign-out (`signed_out`), not on a switch. **Required to fix safely:** the auth client must expose a stable account identifier, or a session generation that changes only when the signed-in account changes, so a component can reset drafts on a real switch and keep them on a refresh. Changing the auth client is outside this phase's approval boundary, so this is not implemented here.

### Team switching

The personal skills views (`OwnTeamSkillsSection`, `OwnCompetenceSharing`) list all memberships at once and have no team selector, so there is no team-to-team transition to test there. Team switching is covered for `TeamCompetenceWorkspace` (the team-scoped view), as described above.

### Scope-guard failures from Phase 2D.3: root cause

The two failures are in `src/features/team-skills/team-skills-cross-cutting.test.ts`. I reproduced them in isolation and in the scoped and full standard runs.

1. **"team navigation exposes only the approved destinations"**: the guard expects the five SPEC BR-30 tabs. The working copy of `src/features/teams/components/TeamRouteNav.tsx` adds two sub-routes, `${base}/results` and `${base}/surveys`. At `HEAD` the file has five tabs and passes. This is an uncommitted scope change by the user, and the guard is correct to flag it. **Decision needed:** either the two tabs are approved (then the SPEC BR-30 list and this guard must be updated together), or they should be removed. I have not changed either.
2. **"Demo Team fixtures, plan, seed and writer name no C2 or personal-assessment data"**: the guard flags `src/features/demo-team/teamkompetanse/rating-update.ts` and `src/features/demo-team/teamkompetanse/rating-update-cli.ts`. These are untracked new files (`git status`: `?? src/features/demo-team/teamkompetanse/`) that mention team-skill names. **Decision needed:** these files are in-progress demo work. Either they must be named to match the approved C2 exception list (which is a scope decision) or reworded. I have not changed the guard or the files.

Neither failure is caused by a Phase 2D change; no file this phase touched is involved. Both guards are correct against the current content, so I have not weakened or changed them.

### Recovery-item deletion coverage

Added to `RoleWorkspace.mutations.test.tsx` (responsibilities; these pass against the current code):

1. Confirm enters a pending state; a second click cannot issue another DELETE; the item stays visible until the server confirms.
2. Success removes only the confirmed item; other recovery items and records remain.
3. Failure restores the recovery control and keeps every other record.
4. A refused session (401) does not show success.
5. A late success after an account switch does not update the new account's list or show a success message.
6. A late failure after an account switch shows no error in the new account's UI.

Permission note: the records routes return 401 for an unauthenticated request, not 403. The 401 case is tested as the refused-session case.

### Late-response and mutation guards: review

- Generation invalidation: all changed reads and writes are checked against the generation they started under (`useOwnerRecords.mutate`, `OwnCompetenceSharing`, `OwnTeamSkillsSection`, `TeamCompetenceWorkspace`).
- Pending cleanup: each row or form clears its pending ref and state in `finally`. A superseded write's `finally` only removes its own key.
- Duplicate-submit protection: ref guards before the next render for row toggles, row deletes, saves, and team-skill ratings.
- The `{ status: "done", result } | { status: "superseded" }` contract is handled by both callers. A superseded outcome shows neither success nor failure. In the two record sections it returns `false` from `run`, which closes no form and clears no draft.
- Sign-out: clears the list and, for record sections, the open draft (`signed_out` → draft cleared during render).

### Token-refresh behaviour (documented, not changed)

- A normal refresh emits a new token, so every auth-gated view reloads its list: the responsibilities, achievements, formal-role, team-owned skills, sharing and team-competence views briefly return to their loading placeholder. This is a UX cost, not a leak; the data is re-read for the same account.
- A write that completes while a refresh is in progress is reported as `superseded`: no success or failure message is shown, and the list is re-read. The server may already have applied the write, and the UI must not describe it as cancelled.
- An open draft survives a refresh (deliberately; see "Draft leak").

### Tests added this phase

- `OwnCompetenceSharing.identity.test.tsx` (new, 4 tests): direct switch clears A's teams while B is pending; late A success after switch ignored; late A failure after switch ignored; token refresh re-reads and shows the same account's teams.
- `OwnTeamSkillsSection.test.tsx` (+2 tests, now 10): direct switch clears A's blocks and skills; late rating from A not shown for B.
- `RoleWorkspace.mutations.test.tsx` (+9 tests, now 19): recovery-item deletion (6) and direct-switch tests for responsibilities (2) and achievements (1).
- `RoleWorkspace.loading.test.tsx` (+2 tests, now 11): formal role direct switch clears A's role while B is pending; late A role after switch ignored.
- `TeamCompetenceWorkspace.test.tsx` (+2 tests, now 39): loaded profile cleared on direct account switch; loaded profile cleared on team change, while the new read is pending.

### Validation

- Focused runs: each new and changed test file was run directly and passes (`OwnCompetenceSharing.identity.test.tsx` 4/4; `OwnTeamSkillsSection.test.tsx` 10/10; `RoleWorkspace.mutations.test.tsx` 19/19; `RoleWorkspace.loading.test.tsx` 11/11; `TeamCompetenceWorkspace.test.tsx` 39/39; `OwnCompetenceSharing` suites 11/11).
- Mutation checks (temporary removal, then restore, each verified): sharing team reset → direct-switch test fails; record notice clearing → notice test fails.
- `npx tsc --noEmit -p .`: exit 0, zero `error TS` lines.
- ESLint on all changed source and test files: exit 0, no warnings.
- Scoped `pnpm test:standard --files` on the nine changed source and test files: 99 files passed, 4 skipped, 1 failed; tests 1698 passed, 2 failed, 4 expected fail, 24 skipped; exit 1. The two failures are the scope-guard failures above; the run is scoped, not a full-suite pass.
- Full `pnpm test:standard` (no `--files`): see the result line below.

### Browser and emulator verification

- **Browser: not performed.** No isolated authenticated browser environment was used, so account switching, pending reads and writes, sign-out, keyboard focus, layout at each width and theme, and reduced motion are **not verified**. Unit tests are not presented as browser verification.
- **Emulator: not run.** No persistence, rules, transaction, or superadmin code changed; the changes are client-side. The emulator suite was not run in this phase.

### Remaining issues

1. Draft leak across a direct account switch: approval-blocked. Needs an auth-client account identifier or session generation (see above).
2. Scope-guard failures: need the user's decision on the `results`/`surveys` navigation tabs and the `teamkompetanse/rating-update*` demo files.
3. Token-refresh reload flicker and superseded write results, documented above.
4. Browser and emulator verification: not performed.

**Phase 2D.4 is not functionally complete and not fully verified.** The reproduced sharing and notice issues are fixed with mutation-checked tests. The draft risk is unresolved and needs approval. The standard run still has the two scope-guard failures, which need a decision.

## Phase 2D.5 — Auth Identity and Regression Guard Closure

Status: **partial.** The account-identity signal is implemented and tested, and direct account switches now clear account-scoped drafts. The navigation guard is resolved. The demo-team guard is **approval-blocked**. A residual risk remains in the window before Firebase's switch is delivered (see below). Browser and emulator verification were not run.

### Phase 2D.4 full-suite result, recovered

The Phase 2D.4 background `pnpm test:full` had finished (log `C:\Users\joela\AppData\Local\Temp\full-suite.log`). The wrapper's exit code was not the test run's. The real result:

- Test step: `Test Files 8 failed | 666 passed | 14 skipped (688)`; `Tests 13 failed | 10889 passed | 4 expected fail | 76 skipped (10982)`.
- The run then continued to typecheck (`error TS` lines: 0) and lint (0 errors, 22 warnings). The script exited with **`FULL_EXIT=1`**.
- Failing tests, and how each was classified:
  1. `app/(public)/sign-in/page.test.tsx` (2): timeouts under full-run load. **Pass when run alone.**
  2. `development-conversations/conversations-ui-regression.test.tsx` (3): timeouts (5–6 s). **Pass when run alone.**
  3. `development-conversations/development-conversations-scope-guard.test.ts` (1): timeout (5.3 s). **Passes alone.**
  4. `personal-goals/components/GoalsPage.mutations.test.tsx` (1): timeout. **Passes alone.**
  5. `team-skills/components/TeamSkillNeedsSection.manage.test.tsx` (1): timeout (5.6 s). **Passes alone.**
  6. `team-systems/components/SystemMatrix.test.tsx` (1): timeout (5.1 s). **Passes alone.**
  7. `team-skills/team-skills-cross-cutting.test.ts` (2): navigation guard and demo-team guard. Root causes below.
  8. `lib/theme/raw-palette.test.ts` (1): **real**, not a timeout. Count mismatch: an untracked `src/features/results/components/TrendChartSkeleton.tsx` has raw colour values and is not on `raw-palette-allowlist.json`. It is outside this work and untouched here.
- The timeout classification is evidence-based (isolated runs), not a claim that the cause is the same for each file.

### Identity signal: what was selected, and why

- Reused the existing Firebase observer: `onIdTokenChanged` already delivers the Firebase `user`, whose `uid` is a trustworthy value from the SDK. The gateway previously discarded it.
- `AuthGateway.subscribeToIdToken` and `observeIdToken` now deliver `(token, uid)`. Both are `null` on sign-out. The UID is a **client-side change signal only**; it is never sent to the server as an authorization input, and it is not used as a cache key for protected data.
- `useAuthGatedResource` derives a change kind from the UID and passes it as a fourth argument (`AuthChange`):
  - `signed_in`: first sign-in, or sign-in after sign-out.
  - `refreshed`: the same UID received a new token. Drafts may be kept.
  - `switched`: a different UID with no sign-out in between. Account-scoped state is dropped.
  - `signed_out`: no account.
  - A token without a UID is `switched` (fail closed).
- Existing callers that ignore the fourth argument are unaffected. Two existing exact-argument assertions were updated to state the expected change kind (`"signed_out"`, `"signed_in"`); they were not weakened.

### Gateway race fixed (found while selecting the signal)

The production subscription awaits `user.getIdToken()` before calling back. If account A's token read finished after the switch to account B, A's token could be delivered last. The gateway now drops a result whose UID is no longer `auth.currentUser`. A later emission reports the current account. Mutation check: removing the check fails 2 of 5 gateway tests; restoring it passes all 5.

### Token-refresh behaviour

- A refresh for the same account is reported as `refreshed`. Account-scoped drafts and the signed-in account are kept.
- The record lists still return to their loading placeholder on every auth change (including refresh), because the existing hooks re-read on each change. This is a UX cost, not a leak. Not changed in this phase.
- A write that completes while a refresh is in progress still returns `superseded` (no message), and the list is re-read. This is the existing contract; the UID now shows the write was for the same account, so a future change could show it. Not changed here.

### Direct-switch behaviour, and the residual window

- On a real switch, the record sections drop their draft, open confirmation and notice at the moment the new account's token is delivered. The record list resets to its loading placeholder at the same point.
- **Residual window:** Firebase's account change happens before the observer delivers the new token (after `getIdToken` resolves). Until then the page still shows account A's state, and requests sent in that window still carry A's last token. Their responses are applied because the generation has not yet changed. The client has no synchronous identity event to close this window. This is documented, not closed. The server still authorizes A's token as A; the risk is that the same browser's new user could briefly see A's already-loaded data.

### Draft-isolation regression evidence

New `RoleWorkspace.drafts.test.tsx` (5 tests, real hooks, UID-aware emitter):

1. Responsibilities: a direct switch from A to B removes A's open draft.
2. Responsibilities: a same-account refresh keeps the open draft.
3. Responsibilities: B's new draft survives a refresh of B; sign-out clears it.
4. Achievements: a direct switch removes A's open draft.
5. Achievements: a same-account refresh keeps the open draft.

Mutation check: with the account-epoch reset disabled, tests 1, 3 and 4 fail (the leak reproduces); tests 2 and 5 still pass. Restored: 5/5 pass.

Other draft-bearing consumers reviewed (not refactored):
- `TeamManualLevelEditor` (team competence): holds a note draft. It is inside `TeamCompetenceWorkspace`, which clears its loaded state (and so unmounts the editor) on every identity or team change. **Not tested directly in this phase.**
- `OwnTeamSkillsSection`, `OwnCompetenceSharing`, `FormalRoleSection`, `SkillProfilePage`: no unsaved draft.
- Personal goals form (`GoalsPage`) and conversations forms: not reviewed in this phase; document as a follow-up consumer.
- Recovery items have no editing form, so there is no recovery-item draft to isolate.

### TeamRouteNav guard: resolved (the guard was outdated)

- `docs/ROUTES.md` (the durable route document) says `TeamRouteNav` shows **seven** tabs in order: Oversikt, Roadmap, Kompetanseplan, Teamkompetanse, Systemoversikt, Resultater og trender (`/results`), Undersøkelser (`/surveys`). Both routes exist under `app/(app)/teams/[teamId]/`.
- `TeamRouteNav.test.tsx` already expects exactly these seven destinations.
- The guard's regex and its `SPEC BR-30` five-tab list were outdated. The implementation is not an invariant violation.
- Change: the guard's approved list now includes `results` and `surveys` (the regex and the accept-list test), and the test name and comment now say seven documented tabs. Unapproved sub-routes are still rejected (`skill-needs`, `competence-plan/extra`, `competence-x`, `forum`).
- Team authorization is unchanged. The two routes are member-level in `docs/ROUTES.md` and are not added to any new surface by this change.
- Active-tab matching: the component uses an **exact pathname** match, not longest-prefix; `TeamRouteNav.test.tsx` covers it. No prefix matching was added.
- Result: `team-skills-cross-cutting.test.ts` navigation test passes; `TeamRouteNav.test.tsx` passes.

### Demo-team guard: investigated, approval-blocked

Files: `src/features/demo-team/teamkompetanse/rating-update.ts` (224 lines), `rating-update-cli.ts` (84 lines), plus `rating-update.test.ts` and `rating-update.emulator.test.ts`. The guard flags the two non-test files.

1. **What it does:** an approved one-off update of 20 existing synthetic team-skill levels (for example, `demo-member-03` from 2 to 3 on `skCiCd`) in the simulated contribution team. It changes only the `level` envelope and `updatedAt`. Nothing else changes; 109 ratings and every contributor count stay the same.
2. **Production or test code, or a migration tool:** a **one-off migration tool**, shipped as a process boundary (CLI).
3. **Can it write to live Firebase:** **yes.** `REQUIRED_PROJECT_ID` is `devpulse-nve`. It uses `firebase-admin` with service-account credentials and a Firestore transaction in `--mode write`. `--mode preflight` is read-only. `docs/ARCHITECTURE.md` names `devpulse-nve` as the production project. **Not run in this phase.**
4. **Real identities:** the uids are fictional (`demo-member-*`). The CLI also calls `auth.getUser` on those uids to check the disabled flag. This is a read of Auth for the demo uids only; no real user is named.
5. **Simulated consent records:** the update reads and checks the consent records (`consent.identical === 10` is a precondition). It does not write consent. The aggregate and k≥3 rules are not changed.
6. **Changes competency ratings or aggregates:** it changes 20 **stored assessment levels**, which feed the team aggregate. The aggregate is recomputed from the stored ratings, not by this code.
7. **Violated guard invariant:** the demo-team naming test (`demoC2NamingOffenders`) flags the two files because their text names team-skill modules and C2 assessment data (`team-skills`, `skill-contribution`, `team-owned-skills`). The file is not in the approved exception list (`DEMO_C2_NAMING_EXCEPTIONS` covers `cli.ts` and `fixtures.ts` of the approved demo-team, not `rating-update*`).
8. **Approved feature:** **no approval record exists in `docs/`.** The only references are in the audit documents, which the earlier sessions wrote. The 2026-11-16 update is described in code comments as "approved", but no decision document is in the repo. Repo policy points the other way: `docs/KNOWN-LIMITATIONS.md` §4 says the one-off migration scripts were **removed from the repository on purpose**, and that porting demo-team tooling to target `devpulse-nve` is still an open task.

Outcome: **not resolved, and not exempted.** Adding `rating-update*.ts` to the exception list would be a security-sensitive exemption for a tool that writes to the live project, and it is not approved. Moving or deleting the untracked files would be destructive without approval. Both were refused.

Decisions requested (specific):
- Is the 2026-11-16 rating update approved? If yes, where is the decision recorded? If no, the files stay out of the tree.
- If approved: should the guard's exception list add exactly these two files, with the `devpulse-nve` write path documented and reviewed?
- Should the write-mode CLI remain able to target `devpulse-nve` at all, or should it be restricted to the emulator?

### Tests (Phase 2D.5)

- `use-auth-gated-resource.identity.test.tsx` (new, 6): first sign-in; same-UID refresh; different-UID switch; sign-out then sign-in; token without UID fails closed to `switched`; refresh after a switch compares to the last account.
- `auth-client.identity.test.ts` (new, 5, production gateway with mocked `firebase/auth`): UID delivered with the token; sign-out delivers no token and no UID; A's late token dropped after a switch; A's late failure dropped after a switch; a failure for the still-current account reports signed out.
- `use-auth-gated-resource.test.tsx` (existing, 2 assertions updated to the four-argument contract).
- `RoleWorkspace.drafts.test.tsx` (new, 5): draft isolation tests above.
- `team-skills-cross-cutting.test.ts`: navigation guard now passes (seven documented tabs); the navigation rejection test still rejects unapproved sub-routes.

### Validation

- Focused runs: all Phase 2D.5 test files pass. Combined run over `src/features/auth`, `src/features/personal-role-workspace`, `src/features/team-skills`, `OwnTeamSkillsSection.test.tsx`, `TeamCompetenceWorkspace.test.tsx`, `TeamRouteNav.test.tsx`: **1101 passed, 4 expected fail, 10 skipped; 1 failed** (the demo-team guard, approval-blocked).
- Mutation checks: account-epoch reset disabled (drafts fail 3 tests); gateway stale-account check removed (2 gateway tests fail); both restored and passing.
- `npx tsc --noEmit -p .`: exit 0, 0 `error TS` lines.
- ESLint on every Phase 2D.5 changed source and test file: exit 0, no warnings.
- Full suite (`pnpm test:full`): `pnpm test:full` exit **1** (`FULL_EXIT=1`). Test files: 2 failed, 675 passed, 14 skipped (691). Tests: **2 failed, 10916 passed, 4 expected fail, 76 skipped (10998)**. Typecheck: 0 `error TS`. Lint: 0 errors, 22 warnings. The two failures are: (1) the demo-team naming guard, approval-blocked; (2) `raw-palette.test.ts`, caused by the untracked `TrendChartSkeleton.tsx`. The 2D.4 timeout-only failures did not recur. The Phase 2D.4 run is recorded above.

### Browser and emulator verification

- **Browser: not performed.** No isolated authenticated browser environment was used. Direct switching, draft preservation, sign-out, pending writes, navigation tabs, loading placeholders and keyboard focus are **not verified** in a browser. The tests use mocked identity streams.
- **Emulator: not run.** The changes are client-side. No persistence, rules, transactions or superadmin code changed. The emulator suite was not run.

### Remaining risks and approval requests

1. Demo-team guard: approval-blocked (decisions above).
2. Residual window before a direct switch is delivered (see "Direct-switch behaviour"). Needs an identity event from the Firebase SDK, or an approved change to how the app orders auth delivery. Not closed here.
3. Record lists reload on every token refresh (UX, not a leak).
4. Other draft consumers not tested directly: `TeamManualLevelEditor`, personal goals and conversations forms.
5. `TrendChartSkeleton.tsx` (raw colours, untracked, not on the allow-list) and the 2D.4 timeout-only failures: outside this phase.
6. Browser and emulator verification: not performed.

**Phase 2D.5 is not functionally complete and not fully verified.** The identity signal, draft isolation and navigation guard are fixed and tested. The demo-team guard needs a decision. The residual window needs an auth-layer change that is out of this approval boundary, and the full-suite run has the failures listed above.

## Phase 2D.6 — Production-Visible Demo Data Management in devpulse-nve

Status: **the controlled workflow is implemented and tested. No live write was performed.** The read-only preview found that the 20 approved target levels are **already stored** in `devpulse-nve` (109 of 109 planned assessments are `identical`). A write would therefore change zero records. The open question is when those values were stored, which needs a separate read-only check of `updatedAt`. Browser verification was not performed.

### Decision and environment

- Product decision (confirmed by the user): demo data stays in the existing project `devpulse-nve`. No separate project, no migration away, no duplicate demo team.
- Preserved identifiers: project `devpulse-nve`; demo team `8yB2bS8Jav69TCfDETON` (`SIMULATED_CONTRIBUTION_TEAM_ID`, verified in `skill-contribution.ts`); fictional uids `demo-member-01` … `demo-member-10` (`SIMULATED_CONTRIBUTION_UIDS`, verified).
- `.env.local` holds the admin credentials and the encryption key. Its `FIREBASE_PROJECT_ID` was checked to equal `devpulse-nve` without printing the value. No value was printed in this session.

### Existing architecture (inspected)

1. Collections: `teamSkillAssessments` (the demo ratings), plus the demo-team seed collections (memberships, teams, catalog, consent records, roadmaps, forum, etc.) under `src/features/demo-team/`.
2. Identification: fixed document ids `teamSkillAssessments/{uid}__{skillId}`; fixed fictional uids; the fixed demo team id.
3. Belonging to the demo team: `teamId` on each record, checked against `8yB2bS8Jav69TCfDETON`.
4. Simulated data: the `simulated` field and the simulated-contribution context (`isSimulatedContributionContext`), both restricted to the demo team and its fictional uids.
5. Real-user records could be reached only if a uid or team outside the fixed lists were passed in. The update path rejects that by construction.
6. Existing update paths: `rating-update.ts` (`runRatingUpdate`) and the CLI. The seed runners (`runTeamkompetanseSeed`) are create-oriented; the rating update does not use them to write.
7. Encryption: `rating-update.ts` reads through `openAssessmentDocument` and writes through `sealAssessmentLevel` (the same codec as the application, record-specific AAD). Verified by reading both files. Plaintext levels are never persisted by this path.
8. Intended 20 updates: they are described in code as "approved", but no decision record is in `docs/`. The preflight shows they are already present in the live project (see preview).

### Rating-update tool findings

- Unsafe implicit execution: none in the runner. `--mode` is required; there is no default write. The gap was that a write needed no confirmation tied to the reviewed batch. **Fixed:** see below.
- Read-only preview: the existing `preflight` mode performs reads only (`classifyAll` over `db.get`; no transaction is opened). Verified by reading the code path before `input.mode === "write"`.
- Target validation present: project and team must equal the constants; consent must be identical (10); catalog must resolve; the seed preflight must report no structural blockers; the 109 records must classify as `identical` or `update` with no `conflict` or `unreadable`.
- Partial failures: a write runs in one transaction. A post-write verification reclassifies every record and reports `post-write-verification-failed` when the state is not complete.

### Controlled workflow implemented

Changes (all client-independent server-side tooling):

- `src/features/demo-team/teamkompetanse/rating-update.ts`:
  - `ratingUpdatePlanDigest({ requiredProjectId, teamId })`: a deterministic 16-hex-digit SHA-256 over the project, team and each approved `(uid, fixtureSkillId, from, to)` in list order. It contains no envelopes and no secrets.
  - `runRatingUpdate` takes `confirmDigest`. For `mode: "write"` it returns `confirmation-required` (no digest) or `confirmation-mismatch` (wrong digest) **before any read or write**. Every report includes `planDigest`.
- `src/features/demo-team/teamkompetanse/rating-update-cli.ts`: accepts `--confirm <planDigest>` and passes it through. Usage text and header comment updated. The existing argument and project/team checks are unchanged.
- `src/features/team-skills/team-skills-cross-cutting.test.ts`: the demo-team naming guard gets a separate, exact-path set `CONTROLLED_DEMO_MAINTENANCE_FILES` (the two rating-update files only). A test asserts that each file contains the write gate and the fixed project and team. A lookalike file in the same directory is still flagged. The original exception list is unchanged.
- `docs/DEMO-DATA-MAINTENANCE.md` (new): purpose, preserved identifiers, what may be updated, architecture, preview, write confirmation, approval, production-visibility verification, recovery, prohibited operations, guard rationale, the current preview, and the proposed command (not executed).
- `docs/KNOWN-LIMITATIONS.md` §4: the rating-update tool is recorded as retained (gated), not retired.

### Demo-team guard outcome

- Passes, with the two files exempted by exact path under the controlled workflow, and with a test that the exemption requires the write gate.
- Rationale preserved: the guard still flags every other demo-team file that names C2 data, including lookalike names. No privacy rule (consent, k ≥ 3, suspect fail-closed, erasure) was changed.
- The exemption is a design decision that the user should review. It is recorded in the test file and the document.

### Tests

- `rating-update.test.ts`, new "controlled write gate" block (6 tests): stable 16-hex digest; digest changes with project or team; write with no confirmation refused with no database access; write with a wrong digest refused with no database access; every report carries `planDigest`; wrong project refused before the confirmation check, with no database access.
- Mutation check: removing the digest comparison fails the mismatch test; restoring it passes (18/18 in the file).
- `team-skills-cross-cutting.test.ts`: the controlled exemption is exactly the two files and each carries the gate; a lookalike `rating-update-2.ts` and the test file itself are still flagged.
- Existing read-only and approval tests in the file (classification, the 20 approved changes, fixture alignment) still pass.
- Read-only default: the CLI requires an explicit `--mode`; without `--mode` it prints usage and exits 2 (verified by reading `parseArgs` and `main`; no test was added for the CLI process boundary).
- Encryption preservation, no plaintext persistence, no Auth or role changes: verified by reading (`sealAssessmentLevel` only; the transaction updates only `level` and `updatedAt`; the runner never calls Auth writes). Not covered by a new automated test in this phase.
- Safe repeated execution: a run where every record is `identical` returns a zero-write success (existing `allowsWrite` logic; covered by the existing emulator tests where present). Not re-tested in this phase.
- Partial-failure reporting: `post-write-verification-failed` and `assessment-gate-failed` paths exist; not newly tested here.

### Production visibility (verified by code reading, not by a live request)

- The aggregate route `app/api/teams/[teamId]/team-skills/aggregate/route.ts` delegates to `src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts`.
- That module requires a genuine member of an active team (`requireGenuineMemberWith`), uses `SKILL_COVERAGE_MIN_CONTRIBUTORS` as the suppression threshold, and fails closed on a suspect rating.
- The maintenance tool changes none of this. Whether the demo team's data appears in the signed-in UI was **not verified in a browser**.

### Read-only preview (2026-11-17)

Command (preflight, reads only):

```
node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs --env-file-if-exists=.env.local src/features/demo-team/teamkompetanse/rating-update-cli.ts --mode preflight --project devpulse-nve --team 8yB2bS8Jav69TCfDETON
```

Result: exit 0; `planDigest` `d31ef7e4eb4cc9b6`; `assessments` `identical` 109, `update` 0, `conflict` 0, `unreadable` 0; `expectedUpdates` 20; `blockers` `[]`; `ok` `true`.

Interpretation: the live project already holds every planned target value. A write would change 0 records. Fields that would change: none (the transaction would update `level` and `updatedAt` only on records still at their old value, and there are none). Expected production UI effect: none from a write. Records that failed validation: none.

Open question (not resolved here): when the 20 target values were stored. The classifier compares levels, not `updatedAt`. A separate read-only check of `updatedAt` on the 20 documents would show whether they were written by an earlier run or seeded from the updated fixture. It was not run.

Proposed approved command, **not executed** (it changes zero records as things stand):

```
node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs --env-file-if-exists=.env.local src/features/demo-team/teamkompetanse/rating-update-cli.ts --mode write --project devpulse-nve --team 8yB2bS8Jav69TCfDETON --confirm d31ef7e4eb4cc9b6
```

### Validation

- Focused: `src/features/demo-team` and `team-skills-cross-cutting.test.ts`: 24 files passed, 7 skipped; 567 tests passed, 40 skipped (607). Exit 0.
- `npx tsc --noEmit -p .`: exit 0, 0 `error TS` lines.
- ESLint on the four changed source and test files: exit 0, no warnings.
- Full suite (`pnpm test:full`): `pnpm test:full` exit **1** (`FULL_EXIT=1`). Test files: 1 failed, 676 passed, 14 skipped (691). Tests: **1 failed, 10925 passed, 4 expected fail, 76 skipped (11006)**. The one failure is `raw-palette.test.ts`, caused by the untracked `src/features/results/components/TrendChartSkeleton.tsx` (not on the allow-list; not part of this work). The demo-team guard now passes. Typecheck: 0 `error TS`. Lint: 0 errors, 22 warnings.

### Browser and emulator

- **Browser: not performed.** Production UI visibility of the demo team is unverified.
- **Emulator: not run.** The emulator rating-update suite (`rating-update.emulator.test.ts`) was not run in this phase.
- No live write was performed. The only live contact was the read-only preflight.

### Remaining risks and approval requests

1. Approval to write: none is needed if the live state (109 identical) is the desired state; a write would change nothing. If you want a write anyway, approve the specific digest `d31ef7e4eb4cc9b6` explicitly.
2. Open question: when the 20 values were stored (needs read-only `updatedAt` check, separate approval if you want it run).
3. Guard exemption design: the two controlled files are exempt by exact path. Please confirm this is the design you want.
4. Production UI visibility: needs an authorized signed-in browser check.
5. The rating-update tool's `--mode write` path remains able to target `devpulse-nve`. Restricting it to the emulator is a separate decision.
6. Other demo-team tools that still target `devpulse-nve` (from `KNOWN-LIMITATIONS.md` §4) were not reviewed in this phase.

**Phase 2D.6 is not functionally complete as a live maintenance run, because no approved batch exists to execute, and it is not fully verified (no browser or emulator check).** The workflow, gate, guard and documentation are implemented and tested.

## Phase 2D.7 (2026-11-17): raw-palette fix and account-switch timing

- **Raw palette (`raw-palette.test.ts`).** The failure was `TrendChartSkeleton.tsx`, an untracked file with four raw Tailwind palette classes (`text-zinc-900`, `dark:text-zinc-50`, `text-zinc-500`, `dark:text-zinc-400`). The component now uses the semantic tokens `text-text-primary` (heading) and `text-text-muted` (description), which already map light and dark values in `app/globals.css`. Size, heading, skeleton box, `aria-hidden` plot and the optional `role="status"` label are unchanged. The component has no animation, so there is no reduced-motion change. The guard and its allow-list were not changed.
- **Account switch.** `observeIdToken` now reports `account_changing` (with no token and no UID) synchronously when Firebase reports a different account than the last one delivered. It fires before the new account's `getIdToken()` resolves, so the previous account's protected state is dropped at once. The hook treats it as `switched` without updating its last-known UID, so the new account's delivery is still classified as `switched` and drafts are still cleared. A same-account token refresh emits nothing extra. The server token checks, rules and authorization are unchanged. See `src/features/auth/client/auth-client.ts`, `use-auth-gated-resource.ts`, and the identity tests.
- **Tests.** Regression test "invalidates account A before account B's token is read, while B's token request is still unresolved" fails if the early `callback(null, null, "account_changing")` is removed. Also "does not emit an account-change signal when the same account receives a refreshed token". Existing switch tests were not changed (account A was never delivered in those cases, so no early signal is correct).
- **Not covered by a hook-level test:** the hook's handling of `account_changing` (generation bump, `switched` classification) is verified only through the gateway emission. A component-level test of the 10-point scenario list is still outstanding.

## Phase 2E (implementation, not verified)

Implementation only. No test suite, emulator, Lighthouse or browser check was run in this phase, so none of the changes below is verified.

### Components changed

- `src/features/development-conversations/components/ConversationSkeletons.tsx` (new): `ConversationsListSkeleton` (intro, create-form block, filter chips, list rows) and `ConversationDetailSkeleton` (back link, title and metadata, editor and section cards). Both use `LoadingRegion` and the existing `Skeleton` / `SkeletonCard` / `SkeletonText` primitives.
- `ConversationsPage.tsx`: the `loading` phase renders `ConversationsListSkeleton` instead of a text `LoadingState`. The label is unchanged, so the single `role="status"` announcement is kept.
- `ConversationDetail.tsx`: the `loading` phase renders `ConversationDetailSkeleton` instead of a text `LoadingState`. The back link stays outside the body, as before.
- `src/features/teams/components/TeamAdminSkeletons.tsx` (new): `AdminTeamDetailSkeleton` (header, invitation form, member rows, settings block), `AdminTeamsListSkeleton` (table rows), and `TeamRosterSkeleton` (avatar rows).
- `AdminTeamDetail.tsx`, `AdminTeams.tsx`, `TeamRosterSection.tsx`: the loading branch uses the matching skeleton. Unused `LoadingState` imports were removed.

### Mutation feedback

- Reviewed, not changed. Conversation create, edit/save, accept/decline, leave, complete and delete already show a pending label and disable the submit control (`useSingleFlight`, `pending` on `Button`, `SaveRow`). Drafts are kept by the existing `nextState` / `keepsDraft` logic.
- Team administration already shows per-row pending labels and ignores a second click while an action is pending (`AdminTeamDetail.tsx`).

### Security-sensitive behavior preserved

- No change to authorization, Firebase claims, security rules, superadmin logic, encryption, consent or privacy thresholds.
- The stale-response guards (`isCurrentGeneration`), the account-change handling and the draft isolation in the conversation and team admin components are untouched.
- Skeletons are static (no `animate-pulse`, no shimmer) and decorative (`aria-hidden`). The one announcement per region comes from `LoadingRegion`.

### Remaining loading UX gaps

- Conversation evidence, goal and colleague selectors (`EvidenceSelector`, `GoalSnapshotSelector`, `ParticipantPanel`) still show a text `LoadingState` inside their forms.
- `TeamOverviewSummary` (roadmap panels), `TeamVisibilitySettings`, `PublicTeamPage` and `TeamsOverview` still show text loading states.
- `RecoveryRegion` and `PendingInvitation` have no skeleton; they render only after a read succeeds.

### Blockers and unverified behavior

- Not verified: the skeleton heights against the loaded layouts in a browser, light and dark themes, and mobile widths.
- Not verified: the existing `*.test.tsx` files for these components. Tests that assert on the loading text other than the `role="status"` label may need updates.
- Not type-checked in this phase.

## Phase 2E.1 (implementation, not verified)

Implementation only. No test suite, typecheck, lint, emulator, Lighthouse or browser check was run in this phase.

### Components changed

- `development-conversations/components/ConversationSkeletons.tsx`: added `SelectorOptionsSkeleton` (checkbox-list rows, used by evidence and goal selectors) and `SelectorControlSkeleton` (one dropdown-height block, used by the colleague picker). Both use `LoadingRegion`, so each selector announces its own loading once.
- `EvidenceSelector.tsx`, `GoalSnapshotSelector.tsx`: loading branch uses `SelectorOptionsSkeleton` with the existing label.
- `ParticipantPanel.tsx`: loading branch uses `SelectorControlSkeleton` with the existing label.
- `teams/components/TeamAdminSkeletons.tsx`: added `TeamMetricSkeleton`, `TeamNextStepsSkeleton`, `TeamsGridSkeleton`, `PublicTeamHeadingSkeleton`, `VisibilitySettingsSkeleton`.
- `TeamOverviewSummary.tsx`: the "active plans" metric uses `TeamMetricSkeleton` (no status role, so loading is announced once by the sibling "next steps" panel); the "next steps" panel uses `TeamNextStepsSkeleton`.
- `TeamVisibilitySettings.tsx`: loading uses `VisibilitySettingsSkeleton`. The visibility policy, the mutation guards and the pending and error branches are unchanged.
- `PublicTeamPage.tsx`: loading uses `PublicTeamHeadingSkeleton` in the heading position.
- `TeamsOverview.tsx`: loading uses `TeamsGridSkeleton`, which uses the same column breakpoints as the loaded list.

Unused `LoadingState` imports were removed from each file. Grep confirms no `LoadingState` remains in `development-conversations` or `teams` components.

### Recovery and pending invitations

- Reviewed, not changed. `RecoveryRegion` and `PendingInvitation` have no asynchronous read of their own. They render from props passed by the parent, and their `useEffect` hooks only manage focus. Nothing loads asynchronously here, so no skeleton was added. Recovery permissions, invitation authorization, confirmation flows and pending labels are untouched.

### Team pages and fetching

- No new team fetch was added. Each placeholder replaces only the loading branch of an existing read, so request count, the team context cache and the authorization path are unchanged.
- Stale-response and account-change guards in the replaced components are untouched.

### Security-sensitive behavior preserved

- No change to the authentication gateway, identity-change handling, server authorization, security rules, encryption, consent, privacy thresholds, superadmin rules or team membership rules.
- Skeletons are static and decorative (`aria-hidden`), with no looping animation and no raw palette classes.

### Remaining loading UX gaps

- The team roster and admin pages were improved in Phase 2E; the team roadmap page already uses `TeamRoadmapSkeleton`.
- `TeamResultsView` still shows a text loading state. It was outside this phase's scope. (`TeamOversiktProjects` already renders skeleton rows and was not changed.)
- `ProfileHeaderTeams`, `ResultsRedirect` and other non-team loaders were not reviewed.
- Visual fit of every placeholder against its loaded layout (heights, wrapping, mobile widths, light and dark themes) is unverified.

## Phase 2E.2 (implementation, not verified)

Implementation only. No test suite, typecheck, lint, emulator, Lighthouse, browser check or production build was run in this phase. Nothing below is tested or visually verified.

### Components changed

- `teams/components/TeamResultsView.tsx`: `ResultsViewSkeleton` now mirrors the loaded order and shapes: summary strip (bordered term list, date row, three dimension cells), current-survey card, latest-period card (heading, date line, three values, response count), trend table (plain section, header row and three body rows, clipped on narrow screens), then the chart card via the existing `TrendChartSkeleton`. Loading label and the single `role="status"` announcement are unchanged.
- `development-conversations/components/ConversationSkeletons.tsx`:
  - List: the create-form placeholder is now one button-sized block, because the loaded form is only a toggle button while closed.
  - Detail: the placeholder no longer repeats the back link (rendered by `ConversationDetail` outside the body). It mirrors the owner editor's header (privacy line, status and planned date, participant line), the section tab row, and one editor section (heading, visibility note, input, save row).
  - Colleague selector: a label line plus a full-width control, matching the loaded `Select`.
- `teams/components/TeamAdminSkeletons.tsx`:
  - `AdminTeamDetailSkeleton` now follows the loaded page's plain-section structure, not generic cards. It shows a header, a facts row, an invitation section and a member list with content, then heading-only placeholders for the remaining sections.
  - `AdminTeamsListSkeleton` is now a card grid with the loaded breakpoints (1 / 2 / 3 columns), not a table.
  - `TeamRosterSkeleton` names are allowed to wrap (`max-w-full`), matching long member names.
  - Long-text placeholders on the visibility and admin skeletons got `max-w-full`, so they do not force horizontal overflow on narrow screens.

### Responsive and accessibility

- Mobile: placeholders use the same stacking rules as the loaded components (for example, the summary strip and period values stay three-column as loaded; the admin invitation row stacks on small screens).
- Tablet and desktop: grid breakpoints for the teams overview and admin team list match the loaded grids.
- Announcements: each independent region keeps one `role="status"` announcement. Decorative blocks are `aria-hidden`. The metric and sibling placeholders on the team overview do not add their own announcement.
- The results chart card keeps its real heading and description as text; only the plot box is decorative.

### Security-sensitive areas left unchanged

- No change to results calculations, filtering, authorization or data fetching; `TeamResultsView`'s `loadResultsView` and the stale-response guard are untouched.
- No change to team membership, admin actions, the authentication gateway, identity handling, security rules, encryption, consent, privacy thresholds or superadmin rules.

### Remaining visual gaps

- Page-level heading and the back link on `/teams/[teamId]/results` are rendered by the route and `TeamPageHeader`, not by the loading view, so the view-level placeholder does not include them.
- The participant view of a conversation (`ParticipantConversation`) is not separately skeletoned; the owner-editor layout is used for both.
- Admin detail heading-only sections are approximations. Their real height depends on the content inside each section.
- `TeamResultsView` also shows the team survey-results section (`TeamSurveyResultsSection`) below the chart. That section loads on its own and has its own placeholder path, which was not reviewed here.
- Visual fit of all placeholders (heights, wrapping, mobile widths, light and dark themes) is unverified.

## Phase 2E.3 (partial: skeleton changes, checks run; browser and emulator not run)

### UI changes

- `surveys/components/TeamSurveyResultsSection.tsx`: the list loading state now renders two rows shaped like the loaded survey list (title on the left, show/hide button on the right) inside the existing single `LoadingRegion`. Heading and hint were already shown during loading and are unchanged. The per-survey results skeleton is unchanged.
- `teams/components/TeamAdminSkeletons.tsx` (`AdminTeamDetailSkeleton`): heading-only placeholders replaced with the loaded shapes: a roles description line and two member-role control rows, bordered invitation and request rows (`AdminRowSkeleton`), a surveys header with its button, challenge rows, and a skills description with a control. Section order is unchanged. No control the viewer cannot use is represented.
- `development-conversations/components/ConversationSkeletons.tsx`: new `ParticipantConversationSkeleton` mirroring the participant layout (privacy line, owner/team/status lines, section tabs, overview sections). It contains no owner editor or owner-only controls.

### Wiring gap (not done)

- `ParticipantConversationSkeleton` is not yet wired into `ConversationDetail`. The `loading` phase is entered before the server reports whether the viewer is owner or participant, and the detail route carries only the conversation id. Choosing the participant skeleton would require a role hint from the link or a change to the read contract, which this phase excludes. The owner skeleton therefore still covers both roles during loading.

### Tests

- `development-conversations/components/ParticipantConversationSkeleton.test.tsx` (new): one busy announcement, no interactive controls, decorative blocks hidden.
- Existing tests for `TeamSurveyResultsSection`, `AdminTeamDetail`, `ConversationDetail` and `ParticipantConversation` pass unchanged.

### Checks run

- `npx tsc --noEmit`: exit 0.
- ESLint on the four changed files: exit 0.
- `pnpm test:quick` on the affected component tests: 59 files passed, 3 skipped; then 55 passed, 3 skipped (including the new test).
- `pnpm test:standard --files` on the changed files: 227 files passed, 4 skipped; 3870 passed, 4 expected fail, 23 skipped.

### Not verified

- Browser and responsive checks: not run. No layout-stability or CLS claim is made.
- Emulator tests: not run in this phase.
- Account and team switching regressions for the new skeletons: covered only by the existing suites above, not by new integration tests.

## Phase 2E.4 (role resolution, neutral loading, account-isolation tests)

### How the viewer role is resolved

1. The route passes only the conversation id to `ConversationDetail`. Nothing in the URL, the link or client state states the viewer's role.
2. `useAuthGatedResource` observes the Firebase identity. On a token it moves to the loading phase (kept if a draft is on screen) and calls `fetchConversation`.
3. The server decides the view from the caller's authorized relationship to the conversation and returns `owner`, `participant` or `pending`. `viewFor` renders only that kind.
4. The role is therefore trustworthy only after that response. Until then the page shows the neutral loading skeleton.

### Loading skeleton before role resolution

- `ConversationDetailSkeleton` is the only skeleton for the first read. It contains the shared header lines, the section tabs and one generic section (a heading and two text lines). It has no input, save control or owner-only element, so it does not pretend the viewer is an owner or a participant.
- The participant-specific skeleton is removed. `ParticipantConversation` has no loading state of its own: a re-read keeps the mounted view, and the only other loading path is the same first read. Connecting it would need a role hint that the phase excludes, so it was removed rather than left unused. This supersedes the Phase 2E.3 "created, not wired" entry above, and its test file is deleted.

### Account-isolation coverage added

New integration tests in `ConversationDetail.test.tsx` drive the real auth observer with captured callbacks and deferred reads:

- Unknown-role loading shows only the neutral skeleton, with no textbox, button or section heading.
- Account A's owner content disappears at the early `account_changing` signal, before B's token resolves.
- A late response for account A does not restore A's view after the switch to B; B's own content is shown.
- Sign-out clears the protected owner view and shows the sign-in prompt.
- A same-account token refresh re-reads in place and keeps an unsaved participant-notes draft.

Existing tests already cover: a participant view with no owner controls, a not-found or 401 read with neutral copy, a failed read that shows a retry rather than an endless skeleton, and a pending invitation with no owner content.

### Defects found

- None in product code. The first version of the late-response test asserted the owner title by text; the title is an input value, so the assertion now uses the display value. This was a test defect and is fixed.

### Checks run

- `npx tsc --noEmit`: exit 0.
- ESLint on the changed files (`ConversationSkeletons.tsx`, `ConversationDetail.test.tsx`): exit 0.
- Focused quick run (`ConversationDetail`, `ParticipantConversation`, `conversations-ui-regression`, the conversation route page test, `use-auth-gated-resource`): all passed after the fix above.
- `pnpm test:standard --files` on the changed phase files (conversation skeletons and detail, participant, regression, auth gate and client tests, survey section, team admin skeletons): 232 files passed, 4 skipped; 3919 passed, 4 expected fail, 23 skipped.

### Not verified

- Emulator: the emulator suites skip without `FIRESTORE_EMULATOR_HOST`. Not run in this phase.
- Browser: not run. No visual, mobile or theme verification and no layout-stability claim.
- Account switching against real Firebase: covered by the mocked observer only.

### Remaining limitations

- During an account switch the page briefly shows the signed-out prompt (the early signal sets the state to signed out) until B's token arrives. This shows no protected data, but it is a visible state change.
- The first-read skeleton is generic, so its shape differs from both loaded views. Its real fit is unverified without a browser check.

## Phase 2F — System overview, detail route, loading and timeline polish (partial)

Scope: the seven requirements of the Phase 2F brief. This section records what is implemented, what is not, and why. Implemented items are covered by focused tests; browser and emulator verification were not performed.

### Implemented

- **Kompetanseplan loading.** The text-only `Laster kompetanseplanen…` branch is now `CompetencePlanSkeleton`: a placeholder for the heading and intro, the link row, the overview card, and two plan cards with their progress rows. It reuses `LoadingRegion`, `Skeleton` and `SkeletonCard`; one `role="status"` announces the Norwegian label, and the blocks are `aria-hidden`. No looping animation. Fetching, permissions and calculations are unchanged.
- **Systemoversikt progressive disclosure.** The list shows the first 10 matches and states `Viser X av Y systemer`. `Vis flere` adds 10 at a time. Any filter change returns to the first page. Search and the four existing filters still combine as before.
- **Filter summary and reset.** When any filter differs from its default, the filter row shows `N aktive filtre` and `Nullstill filtre`. The no-match state also offers `Nullstill filtre`.
- **Dedicated system detail page.** `/teams/[teamId]/systems/[systemId]` (`app/(app)/teams/[teamId]/systems/[systemId]/page.tsx`). It reads the team's list through the existing authorized gateway and shows the matching system. A system id outside the team's list, or a missing one, shows a not-found state, so no other team's data is revealed. It shows name, description, system classification (existing `systemType`, `businessCriticality`, `userReach`), knowledge risk, Backstage link and the seven quality assessments. Authorized editors can edit through the shared `SystemEditorPanel`, which is the same form and gateway the list used.
- **Navigation.** `Tilbake til systemoversikt` returns to the list. Systemoversikt stays highlighted on its detail pages. This is the only longest-prefix match in `TeamRouteNav`; every other tab still matches exactly.
- **Table action.** The row's `Rediger` button is replaced by a `Detaljer` link with a chevron icon, a 40px minimum touch target on small screens, and an accessible name that names the system. The whole row is not clickable.
- **Forklaring removed.** The `Forklaring` button and its dialog are removed. Its status meanings (God, Trenger oppfølging, Kritisk, Ikke vurdert) now appear as a legend inside the existing `Kvalitetsegenskaper (fokus for teamet)` panel, so no explanation is lost. The per-attribute info buttons are unchanged.
- **Redundant back links.** `Tilbake til Oversikt` is removed from `Resultater og trender` and `Undersøkelser`. The page headers and spacing are otherwise unchanged. The in-workspace `Tilbake til oversikten` inside the survey workspace is a different control and is left as it is.
- **Timeline colours.** The Prosjektplan Gantt and the teammember participation timeline both took their bar and dot colours from the shared `chart-*` tokens. Those tokens are also used by results and skill charts, so they were not changed. Instead, six `--timeline-1..6` tokens were added to `app/globals.css` (teal, blue, violet, fuchsia, slate, green, with dark-theme values), and `PROJECT_TONE_CLASSES` maps to them. The colour identifies a project only and encodes no status. Both views share the same mapping, so a project keeps its colour across them. Dashed outlines, text labels and gridlines are unchanged.

### Not implemented

- **Internal/external classification (`systemExposure`).** Not implemented. The existing `systemType` already has the values `internt` (`Internt system`) and `eksternt` (`Eksternt produkt eller tjeneste`), with help text that describes intended audience. A separate field with the same meaning would duplicate it, and the brief says not to overload existing fields. This is an open product decision: either reuse `systemType` for the Plassering/Eksponering filter and add the `Ikke vurdert` option, or define a different meaning for the new field.
- **Per-user favourites.** Not implemented. Persisting favourites needs a new server-side store, which in turn needs an erasure classification (`docs/DATA-MODEL.md`) and a decision on encryption of the favourite list. Neither was decided, so no store was added.
- **Filter state across navigation.** Search, filters and the page size reset when a detail page is left, because they are component state. The brief's preferred URL-parameter approach was not added.
- **Browser and emulator verification.** Not performed. No visual, mobile, theme or 30-system screenshot claim is made.

### Tests added or changed

- `TeamSystemsPage.paging.test.tsx`: 10-of-30 first page, `Vis flere`, no control when all shown, search combined with paging, active-filter count and reset, and the no-match reset.
- `TeamSystemDetailPage.test.tsx`: loaded content, back link, missing system, forbidden, retry, edit control only with edit rights, and the shared editor opening.
- `SystemMatrix.test.tsx`: the Forklaring button is gone; status meanings stay in the Kvalitetsegenskaper panel; the Detaljer link targets the detail route; the editing tests now open the editor on the detail page.
- `TeamRouteNav.test.tsx`: Systemoversikt is current on a detail page and not on a similarly named path.
- `CompetencePlanSection.test.tsx`: skeleton announced once, decorative, no empty state.
- `results-route.test.tsx`: the removed back link is not rendered.
- `project-presentation.test.ts`: tones map to timeline tokens; no brown or gold hue (20°–65°) in either theme.
- `token-contrast.test.ts`: timeline tokens are checked for non-text contrast on the surface in both themes.

### Checks run

- `npx tsc --noEmit`: exit 0.
- ESLint on the changed areas: 0 errors. 13 warnings, all in test files, most of them predating this phase.
- `pnpm test:standard --files` on the changed areas: 157 files passed, 4 skipped; 2397 passed, 4 expected fail, 24 skipped; exit 0.
- `pnpm test:full`: first run had one failure, `app/route-groups.test.ts`, because the complete page-URL list did not include the new detail route. The list was updated, and the rerun passed: 680 files passed, 14 skipped; 10,964 passed, 4 expected fail, 76 skipped; exit 0. The previous baseline was 10,933 passing, 4 expected fail, 76 skipped.

### Remaining limitations

- Favourites, classification and the Plassering filter are open, as listed above.
- Layout and colour changes were not checked in a browser, so contrast is verified only by the token test, and no screenshot exists.
