# Visual Fidelity and UI Fixes — Verification Record

Specification: [SPEC.md](./SPEC.md) · Tasks: [TASKS.md](./TASKS.md)

This file records two statuses separately (BR-32):

- **Implementation status**: code, tests and repository gates passed for a task.
- **Visual status**: browser-verified in a real browser against the reference PNG, or *not visually verified*.

Implementation completion never sets a visual status. No reference is recorded as *Matches* without browser evidence from a run in this file (BR-1, BR-30). Screenshots are written to the git-ignored `.verify-output/` directory and are not committed.

## Run record template

Each browser run adds one entry using this structure.

| Field | Value |
|---|---|
| Run date and time | _pending_ |
| Tool | Playwright (`@playwright/test`, development dependency) with Chromium, run through `pnpm verify:browser` |
| Tool connected | _pending_ |
| Base URL | `http://localhost:3000` |
| Credentials | Owner's test account, supplied at run time through `DEVPULSE_VERIFY_EMAIL` and `DEVPULSE_VERIFY_PASSWORD`. Values are not recorded here. |
| Sign-in | Real sign-in form, used once per run (BR-37). Landing path observed: _pending_ |
| Viewports | 320, 360, 768, 1024, 1280 px |
| Zoom | 100 % at all viewports; 200 % at 1280 px |
| Themes | Light; dark; follow-system resolved to light and to dark |
| Environment | Owner-confirmed test environment (D-5). The production guard in `browser/guards.ts` checks the configured project identifier before any browser launch; it has not yet been exercised in a run. |
| Screenshot directory | `.verify-output/` (git-ignored) |
| Profile cleanup | No browser profile directory is written to disk; the context is in memory and discarded at the end of the run. |
| Outstanding checks | _pending_ |

## Harness smoke and guard checks (TASK-001)

| Check | Result | Date |
|---|---|---|
| Credentials absent: `pnpm verify:browser` stops before any browser launch with the *not verified* message | Passed (message: "NOT VERIFIED: browser verification did not run. Set DEVPULSE_VERIFY_EMAIL and DEVPULSE_VERIFY_PASSWORD …") | 2026-11-04 |
| Smoke run: signed-out home screenshot and signed-in landing through the real form | Passed (`pnpm verify:browser`, 1 test, 9.1 s, against a running `pnpm dev` on port 3000 with the owner's test account). Signed-in landing path observed: `/`. Screenshots written to the git-ignored `.verify-output/` (`smoke-signed-out-home.png`, `smoke-signed-in-landing.png`). Observation: the landing screenshot was captured while the home data cards still read "Laster…"; the screenshot is not a final-state verification. | 2026-11-04 |

## Reference audit (BR-1)

Result values: *Matches*, *Deviation (reason, classification)*, *Omitted (reason)*, or *not visually verified*.

| Ref | Route | Reference PNG | Implementation status | Visual status | Result |
|---|---|---|---|---|---|
| 01 | `/` signed out | `docs/design/references/01-public-home.png` | implemented in code (TASK-007, existing hero/value/trust structure; sign-in split at lg); tests and gates passed | visually compared 2026-11-04 (1280 px light capture `.verify-output/visual/ref-01-public-home-w1280-lys.png`): **does not match** | Not matched. Differences: the hero has an abstract placeholder panel instead of the product mockup with leaf art; the top nav differs (reference: Produkt, For team, Sikkerhet og personvern, Priser, Logg inn, Opprett konto; implementation: Hjem, Logg inn, Opprett konto); the trust band starts directly under the value items with no visible gap, so the value text touches the band. The BR-10 hero illustration is omitted (TASK-007). Needs a dedicated fix task |
| 02 | `/sign-in` | `docs/design/references/02-sign-in.png` | implemented in code (TASK-007, split layout at lg; visible labels; error text); tests and gates passed | not visually verified | pending browser evidence |
| 03 | `/` signed in | `docs/design/references/03-app-home.png` | implemented in code (TASK-008: status row and panel grid at lg); tests and gates passed | visually compared 2026-11-04 (1280 px light capture `.verify-output/visual/ref-03-app-home-w1280-lys.png`): **does not match** | Not matched. Differences: no greeting band with landscape art; the top status row is four text tiles (Teamet ditt, Aktive mål, Fullførte mål, Åpne samtaler) instead of the reference tiles (team card, team pulse, competency coverage percentage, activity); no team development chart; no recommended-steps panel with chart; a "Laster…" loading text stays visible in the left column; sidebar group headings are English ("Workspace", "Account") in a Norwegian UI. The reference shows a competency percentage, which BR-28 forbids in this implementation. Needs a dedicated redesign task; this is not a copy or spacing fix |
| 04 | `/teams` | `docs/design/references/04-teams.png` | implemented in code (TASK-009: card grid already present; no change); tests passed (39) | not visually verified | pending browser evidence; description not returned by the existing read |
| 05 | `/teams/[teamId]` | `docs/design/references/05-team-overview.png` | implemented in code (TASK-010: composition already present; no change); tests passed | not visually verified | pending browser evidence; status badge and description not returned by the existing read |
| 06 | `/teams/[teamId]/roadmap` | `docs/design/references/06-team-roadmap.png` | implemented in code (TASK-011: board and detail panel side by side at lg; no change); tests passed | not visually verified | pending browser evidence (board scroll and 360 px list at browser) |
| 07 | `/me/skills` | `docs/design/references/07-my-skills.png` | _pending_ | not visually verified | _pending_ |
| 08 | `/me/goals` | `docs/design/references/08-my-goals.png` | implemented in code (TASK-013: counts-only summary, Aktive/Fullførte/Alle tabs filter the list, owner-only data); tests passed; status tab icons not added (see icon inventory) | not visually verified | Deviation (visual, approved option B, D1 lucide guard kept): status tabs and goal action buttons are text-only; pending browser evidence |
| 09 | `/me/conversations` | `docs/design/references/09-conversations.png` | _pending_ | not visually verified | _pending_ |
| 10 | `/me/conversations/[conversationId]` | `docs/design/references/10-conversation-detail.png` | _pending_ | not visually verified | _pending_ |
| 11 | `/admin/teams` (and `/admin/teams/[teamId]`) | `docs/design/references/11-admin-teams.png` | _pending_ | not visually verified | _pending_ |
| 12 | `/admin/roles` | `docs/design/references/12-admin-roles.png` | _pending_ | not visually verified | _pending_ |
| 13 | `/me/profile` | `docs/design/references/13-my-profile.png` | implemented in code (TASK-018: header band with display name, team membership from existing overview read, "Rediger profil"; two-column panels; no excluded panels); tests passed | not visually verified | Deviation (layout, approved decision 3, narrow): the Account Erasure entry is in the main column, not the reference's aside; component, copy, behaviour and tests unchanged. Pending browser evidence |
| 14 | `/survey/[surveyId]` | `docs/design/references/14-mobile-survey.png` | _pending_ | not visually verified | _pending_ |

Per-reference viewport, zoom and theme matrix (TASK-020): _pending_.

## Icon inventory (BR-11)

Columns: location, reference element, implemented element, result (*present*, *missing*, or *not applicable*).

| Location | Reference element | Implemented element | Result |
|---|---|---|---|
| Sidebar | Hjem | `House` icon in `AppShell.tsx` sidebar link | implemented in code (TASK-005); browser check pending |
| Sidebar | Team | `Users` icon | implemented in code (TASK-005); browser check pending |
| Sidebar | Ferdigheter | `GraduationCap` icon | implemented in code (TASK-005); browser check pending |
| Sidebar | Mål | `Target` icon | implemented in code (TASK-005); browser check pending |
| Sidebar | Samtaler | `MessagesSquare` icon | implemented in code (TASK-005); browser check pending |
| Sidebar | Roller | `UserCog` icon (admin group) | implemented in code (TASK-005); browser check pending |
| Sidebar | Admin Team | `Building2` icon (admin group) | implemented in code (TASK-005); browser check pending |
| Top bar | Notification bell | Removed. Approved decision 1: DevPulse has no notification feature, so no disabled bell is shown | not applicable (removed in TASK-005 remediation; browser check pending) |
| Top bar | Account chevron | `ChevronDown` in the `Min konto` trigger (`AccountMenu`) | present in code; browser check pending |

| Tab (`/me/goals`) | Aktive / Fullførte / Alle tab icons (reference 08) | none | missing: deviation (approved option B, 2026-11-04). No shared component can supply the icon without a `lucide-react` import in `personal-goals`, which the D1 guard forbids; guard unchanged. Text-only tabs. |
| Action (`/me/goals`) | Goal card action icons (reference 08) | none | missing: same deviation as the tab row. |

Page header, card, action, tab and status icons are added per page by the page tasks (TASK-008 to TASK-018, TASK-020).

## Bounding-box measurements (BR-22, BR-25, BR-6)

### Conversation detail overlap (`/me/conversations` with a conversation selected)

The four-step sequence in BR-22 is recorded here. Steps are not reordered.

Harness: `browser/conversation-overlap.spec.ts` (run with `pnpm verify:browser`-style Playwright config). It signs in once, selects the first conversation through the real list, and records element geometry only (no conversation text). Output JSON is in the git-ignored `.verify-output/`. Overlap is measured between every visible leaf element pair (heading, paragraph, link, button, input, label, tab, tab panel, list item, span, time) that is not nested within the other.

| Step | Status |
|---|---|
| 1. Reproduce and record bounding boxes before any code change | **Done 2026-11-04.** Baseline (`.verify-output/conversation-overlap-BEFORE.json`): 0 overlaps at 320, 360, 768 and 1024 px; **5 overlapping pairs at 1280 px in light and dark**. All 5 pairs are tab buttons (`Oversikt`, `Notater`, `Oppfølging`, x 749–846 px, y 583–711) overlapping the content column (x 789, the `h2`, `p` and `h3` of the aside). No horizontal document scroll at any width. |
| 2. Identify the cause from the measurements | **Done.** Ancestor trace at 1280 px: the detail's tab list measured **0 px wide** inside the aside (323 px). Three causes in the layout chain: (a) `/me/conversations` used `PageShell width="2xl"`, which is the reading container (`max-w-reading`, 680 px), so the list/detail split had 616 px for both regions; (b) the split was `minmax(0,1fr)_minmax(0,1.2fr)`, which left the detail at 323 px and the list at about 269 px (BR-20 needs 320–400 px and at least 480 px); (c) `OwnerConversationEditor` switches to `xl:grid-cols-[minmax(0,1fr)_20rem]` (a fixed 320 px aside column), which in a 323 px pane leaves the tab column at 0 px, so the tab buttons overflow into the content. |
| 3. Fix the cause | **Done (TASK-015 remediation).** (a) `app/(app)/me/conversations/page.tsx`: `PageShell width="3xl"` (main container, 1200 px). (b) `ConversationsPage.tsx`: split changed to `xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]` (D-7: the in-place split starts at 1280 px, not 1024 px), so the list is 320–400 px and the detail takes the rest. (c) The owner detail's inner context aside (the fixed 20 rem column) was moved from `xl` to `2xl` (1536 px) in `OwnerConversationEditor.tsx` (D-7): at 1280 px the pane was 184 px wide for the tab row and "Oppfølging" wrapped, so the aside now stacks below the main content until 2xl. No font-size reduction or clipping was used. |
| 4. Re-measure the same elements | **Done.** After the fix (`.verify-output/conversation-overlap.json`): **0 overlapping pairs at 320, 360, 768, 1024 and 1280 px in light and dark**; no horizontal document scroll. At 1280 px the list is 400 px and the detail about 544 px (BR-20 satisfied). |

Overlap result by width and theme (after fix, all 0 pairs):

| Width | Light | Dark | Route | Note |
|---|---|---|---|---|
| 320 px | 0 | 0 | detail route (below `lg`, BR-21) | |
| 360 px | 0 | 0 | detail route | |
| 768 px | 0 | 0 | detail route | |
| 1024 px | 0 | 0 | detail route (no in-place split below `xl`, D-7) | Decision 1 (option A, D-7): the in-place split is used only from 1280 px. At 1024 px the list is shown alone and selecting a conversation opens the full-width detail route. Measured in the post-fix run (2026-11-04). |
| 1280 px | 0 | 0 | in-place split, `xl` | BR-20 met: list 400 px; detail pane ≥ 480 px asserted by the regression spec. Inner context aside moved to `2xl` (D-7) so the tab row is not squeezed (tabs were 184 px wide before this change). |

**Decision 1 (approved 2026-11-04, D-7, option A):** in-place split only at `xl` (1280 px) and above; the detail keeps at least 480 px where the split is used; below 1280 px the detail route is used with full content width. A 288 px detail is not approved. The 1024 px result above is the detail route, not an in-place split.

Layout notes for the 1280 px split (follow-ups from the TASK-014/015 review, 2026-11-04):

- The list scroll region is the element with `data-testid="conversation-list-column"`; the detail pane is `data-testid="conversation-detail-pane"`. The regression spec uses these test IDs (no structural DOM walks).
- The list column's `xl:max-h-[calc(100dvh-10rem)]` reserves 10 rem (160 px) below the top of the viewport for the app header and page chrome so the list scrolls inside the viewport rather than pushing the page taller. The 160 px value is a sizing choice, not measured. Its relationship to the actual header geometry is **not verified**: it is to be measured in TASK-020 (header bounding box at 1280 px against the list column's `max-height`), and the value changed there if the header is taller.

Rerun after the test-ID change (2026-11-04, `pnpm verify:browser browser/conversation-overlap.spec.ts`, owner's test account, dev server on port 3000): **passed**. 0 overlapping pairs and no horizontal document scroll at 320, 360, 768, 1024 and 1280 px in light (`lys`) and dark (`mork`). Detail route at 320–1024 px; in-place split at 1280 px with the detail pane ≥ 480 px and the list column 320–400 px, scrolling (`overflow-y: auto`). Element geometry only; no conversation content recorded.

Also observed: at 1280 px a list click selects in place (no route change); at 320–768 px it navigates to `/me/conversations/[conversationId]`, as BR-21 requires.

### Page-level horizontal scroll and overlap (BR-6, BR-25)

| Page | Width | Theme | `scrollWidth` > `clientWidth` | Page-level overlap | Result |
|---|---|---|---|---|---|
| All 11 signed-in routes (refs 03 to 13), `/` and `/sign-in` (refs 01, 02) | 320, 360, 375, 768, 1024, 1280 px | light and dark | 0 of 156 captures | Pairs found; all classified below. No genuine page-level overlap | Pass (see run 11) |

Run 11 measurement: `browser/page-overlap.spec.ts`, 156 captures (11 signed-in routes plus 2 public, 6 widths, 2 themes). Ref 14 not reachable (approved not_verified). Overlap is measured as non-nested pairs of page-level elements (headings, sections, asides, headers, forms, lists, buttons, links, inputs, tables, SVG roots, `data-testid` nodes) whose boxes intersect by more than 1 px in both axes. Classification of the pairs found:

- **Skip link (`SkipLink`, `sr-only focus:not-sr-only`)** overlapping the top header on public and sign-in pages, the sticky sidebar on 768 px and wider signed-in pages, and the team overview: 31 by 15 px box, hidden until focused. Intentional.
- **Decorative SVG artwork (`aria-hidden`, `position: absolute`)** under the sign-in card and heading at 320 to 1280 px: the card floats over the art by design (BR-10). Checked in `.verify-output/visual/ref-02-sign-in-w1024-lys.png`: no text sits on the art. Intentional layering.
- **Chart legend list over the chart SVG box** (`TrendChart`, refs 03 and 05): the HTML legend sits in the area below the axis; the SVG box includes that space. Checked in `ref-03-app-home-w320-lys.png`: no visible collision. Intentional, bounding-box only.
- **Next.js development indicator** (dev overlay, bottom left) over card content on the 320 px home capture: a development-server element, not part of the production build. Not a product overlap.

No horizontal scroll at any of the 156 captures. Measured with `document.documentElement` `scrollWidth` vs `clientWidth`.

**Dark-theme contrast defect found and fixed (run 11):** axis tick text in `TrendChart` (Recharts default fill) measured `rgb(102,102,102)` on the dark card, 2.65:1 at 320 and 768 px, below AA 4.5:1 (`browser/contrast-dark-and-occlusion.spec.ts`, `.verify-output/a11y/contrast-dark-and-occlusion.json`). Fix: `AXIS_TICK` sets `style.fill` to `var(--color-text-muted)` (`src/features/results/components/TrendChart.tsx`). Re-measured: dark 6.01:1, light 5.22:1, 0 AA failures in 82 probes (routes `/` and team overview, 320 and 768 px, both themes).

## Visual comparison run (2026-11-04, after TASK-022 to TASK-026)

Run: `pnpm exec playwright test -c browser/playwright.config.ts browser/visual-references.spec.ts` against `pnpm dev` on port 3000, owner's test account through the real sign-in form. Result: 2 tests passed. 93 of 100 entries captured to `.verify-output/visual/` (light and dark, 375 / 768 / 1280 px, plus a 640 px reflow proxy in light). Geometry in `.verify-output/visual/report.json`. Earlier captures (before these changes) are kept in `.verify-output/visual-before-task026/`.

Readiness (TASK-026): every capture waits (bounded, 25 s) until no loading copy (`Laster` followed by an ellipsis on the same line) is in the page text. All 93 captures report `ready: true`. Before this change, captures of refs 05 and 06 showed "Laster kompetansebehov…" and "Laster planer…" as if complete; those captures are superseded. Team and conversation links are now waited for before selection.

Horizontal scroll: none at 375, 768, 1280 px or the 640 px proxy (`horizontalScroll` false in every entry).

**Not measured in this run:** true 200 % browser zoom (the 640 px capture is a reflow proxy, not 200 % zoom; TASK-020 requirement still open). Reference 14 (`/survey/[surveyId]`): no open survey exists for the test account, and creating one would write data, so it is not captured (owner decision needed).

Per-reference result (1280 px light compared with the PNG; "spec exclusion" = excluded by SPEC BR-27, BR-28, BR-24, BR-10, D-8 or an approved deviation):

| Ref | Result | Basis |
|---|---|---|
| 01 | Deviation (spec exclusion) | Nav items "Produkt", "Priser", "Sikkerhet og personvern", the word "gratis" and sample figures are excluded by TASK-007. Hero illustration omitted (BR-10). Value strip to trust band gap fixed by TASK-022 (`md:pb-6`); measured 2026-11-04 at 768, 1024 and 1280 px, light and dark: 24 px at every point (value-strip text bottom to band top). Copy decision (owner, 2026-11-04, TASK-022): trust band = "Personvern først" with the locked class A line verbatim, and "Bygget for team". "Enkel å bruke" is **not** shown: visual-redesign BR-10 lists it as Excluded, and it is in no approved copy source, so the owner's conditional ("if part of the approved copy") is not met. |
| 02 | Deviation (spec exclusion) | Google button, "Husk meg" and "Glemt passord?" are excluded. The decorative band is a cropped placeholder. Email label is "E-postadresse" (owner decision 3, 2026-11-04; display label only, matching reference 02). |
| 03 | Not matched | Greeting band art, the coverage percentage (BR-28 excludes it), and the team development chart (needs a new read, BR-27) are missing or excluded. Top-bar and sidebar English labels fixed by TASK-023. |
| 04 | Deviation (spec exclusion) | Metrics, search and filters are excluded (BR-27). Identity art is a placeholder; the card description is not returned by the existing read. |
| 05 | Deviation | Capture is the team "Utviklerforum" (a different team from the reference's "Demo Team"). Status badge and description excluded (D-8); coverage percentage excluded (BR-28). The layout does not follow the reference's grid. |
| 06 | Captured; compared with reservations | Demo Team roadmap captured at 1280 px light (`.verify-output/visual/manual/ref-06-demo-roadmap-w1280.png`): loaded, no loading copy, no horizontal scroll. The default view is the list ("Liste"); the quarter board is the "Tidslinje" toggle. The reference board is not the default view, which is an unresolved visual deviation from the reference (not a spec exclusion). |
| 07 | Deviation (spec exclusion), layout defect open | Three panels at 1280 px now have readable widths (TASK-024). The radar chart and average score are excluded (SPEC 07). Defect open: "Testautomatisering" breaks mid-word in the competency list. |
| 08 | Deviation (approved) | Full content width after TASK-025. Tab icons are the approved text-only deviation (TASK-013, option B). |
| 09 | Captured with a real conversation selected (2026-11-04) | 1280 px light (`.verify-output/visual/manual/ref-10-detail-w1280-r2.png`): list column and detail editor side by side (in-place split, D-7); no horizontal scroll at 1280 px or 375 px. The reference shows a chat view, which BR-24 excludes. |
| 10 | Deviation (spec exclusion), captured with a selected conversation | The owner editor (tabs Oversikt, Notater, Oppfølging) at 1280 px: tab row 704 to 1248 px, aside present, no horizontal scroll at 1280 px or 375 px. The reference chat with message bubbles and composer is excluded by BR-24. |
| 11 | Deviation, open items (captured 2026-11-04) | Admin teams page captured at 1280 px. Admin tabs are "Team" and "Roller" in the sidebar Administrasjon group; no "Medlemmer", "Tilganger" or "Innstillinger" tab exists (excluded). Rest of the row analysis unchanged: pagination only where the page paginates. |
| 12 | Deviation (spec exclusion) | Permission toggles, the "Rettigheter" tab and the assignment tab are excluded. The list and selected-role structure is present. |
| 13 | Deviation (spec exclusion, approved) | Bio, skill-percentage and goal panels are excluded. The Account Erasure entry is in the main column (approved decision 3). |
| 14 | Not verified | No survey was created or modified (owner decision 2). The isolated environment for a synthetic survey is not available (the configured Firebase project is the owner test environment, not an isolated survey environment). Precise blocker: no existing survey is reachable from the test account, and creating one needs an isolated environment or emulator. Recorded as not_verified. |

Open items from this run, not yet tasks: the reference 07 mid-word wrap; the reference 09 and 10 capture state (select the first conversation); the reference 11 admin tab row; the reference 06 Demo Team capture; the reference 02 "E-post" label question; the reference 14 survey capture decision; the true 200 % zoom measurement.

## Continuation run (2026-11-04, owner decisions 1 to 3)

**Decisions applied**
- Decision 1 (TASK-022, home copy): the trust band shows "Personvern først" with the locked class A line verbatim (`product-experience` SPEC, "Locked home-page privacy line") and "Bygget for team". "Enkel å bruke" is not shown: visual-redesign BR-10 lists it as Excluded, and it appears in no approved copy source, so the owner's condition (only if part of the approved copy) is not met. Rationale recorded here so the decision can be reversed by the owner if they read it differently.
- Decision 2 (reference 14): no survey was created or modified, and no survey ID was invented. Reference 14 is **not_verified**. Blocker: no existing survey is reachable from the owner's test account, and creating one would write data outside an isolated environment or emulator.
- Decision 3 (reference 02): the sign-in email label is "E-postadresse" (`src/features/auth/copy.ts` `authCopy.signIn.emailLabel`). Display label only; input type, validation, and authentication are unchanged. The sign-up label stays "E-post" (not part of the decision).

**Measured in this run (2026-11-04, Chromium via `@playwright/test`, owner test account, `localhost:3000`)**

| Check | Result |
|---|---|
| TASK-022 value strip to trust band gap, `/` signed out | 24 px at 768, 1024 and 1280 px, light and dark |
| Reference 09 (conversations) with a real conversation | 1280 px light: list and detail side by side (in-place split); no horizontal scroll at 1280 or 375 px |
| Reference 10 (conversation detail) | 1280 px light: tab row 704 to 1248 px, aside present; no horizontal scroll at 1280 or 375 px |
| Reference 06 (Demo Team roadmap) | 1280 px light: loaded, no loading copy, no horizontal scroll |
| Reference 11 (admin teams) | 1280 px light captured. Admin navigation shows "Team" and "Roller" only; "Medlemmer", "Tilganger" and "Innstillinger" do not exist |
| Account menu, keyboard | Enter opens, Escape closes, focus returns to the trigger |
| Account-menu trigger at 320 px | 44 px high (145 px wide) |
| Drawer at 375 px | opens from "Meny", Escape closes, focus returns to "Meny"; no `Logg ut` inside the drawer dialog |
| Sidebar `Logg ut` | none (count 0 in `nav`) |
| Sign-in landing (valid credentials, no continue) | `/` |
| Sign-out from the account menu, mouse, 1280 px | landed on `/` |

**Limits and deviations recorded honestly**
- **Form use under BR-37.** BR-37 asks that the sign-in form is used once per run. Several scratch browser scripts in this continuation each signed in through the real form (about five times) to take the captures and checks. This is a deviation from BR-37 and is recorded here. Future runs must sign in once and reuse the session.
- **True 200 % browser zoom: not verified.** Playwright headless Chromium exposes no browser-zoom control, and the 640 px viewport is not 200 % zoom. Not claimed.
- **Keyboard-only pass for all 14 pages: not performed.** Only the account-menu and drawer keyboard behaviour listed above was checked.
- **Sign-out at 320, 768 and 1280 px by mouse and by keyboard: not performed as a set.** Only one mouse sign-out at 1280 px was run, as the final step of the run.
- **`continue` redirect for a survey (`/sign-in?continue=/survey/{id}`): not verified**, because no survey is available (reference 14 blocker).
- **Visual comparison of references 04 to 13:** not completed in this run. Reference 06 uses the list view by default; reference 09 and 10 composition is captured but not reviewed line by line against the reference.
- **Reference 01 and 03:** reference 01 is compared in the table above; reference 03 remains not matched (see the table).

**Security and privacy review (2026-11-04, independent read-only subagent): PASS_WITH_RISKS, no blocking findings.** Checked: sign-in `continue` allow-list unchanged (`/survey/{id}` only; invalid falls back to `/`); no open redirect; sign-out remains in the account menu only, rendered only when signed in; the signed-out home shows no team data; no server, route-handler or authorization file changed in this feature; the browser harness reads credentials only from env vars and writes only geometry and status to `.verify-output/` (git-ignored). Important, to confirm: `src/features/teams/components/TeamDetail.tsx` (section reorder and wrappers) changed beyond copy and classes; props, `forumEnabled` gating and `token`/`teamId` are unchanged in the diff, and the full test suite (9319 tests) passes, but the reviewer did not confirm equivalence by reading the tests. Suggestion, placement: the privacy line now sits in the trust band, not the hero (verbatim, visible; BR-29 satisfied). Suggestion: `browser/` is untracked and must be reviewed before it is committed.

## Continuation run 3 (2026-11-04): reviews and reference 07 fix

**Independent reviews**
- `src/features/teams/components/TeamDetail.tsx` behavioural equivalence (read-only subagent): EQUIVALENT_WITH_NOTES, no behavioural must-fix. Props, data reads, `forumEnabled` and chart gates, and interactions are unchanged; only `key` values changed. Notes for owner sign-off: (1) the summary strip moved into the header, before the route navigation, in DOM order (presentation only); (2) the strip renders only when `latest` is non-null (`TeamSummaryStrip` already returned nothing for null, so the visible result is the same); (3) a `<dd>` without a `<dt>` in `TeamSummaryStrip.tsx` is a minor `<dl>` content-model nit. The reviewer did not run tests.
- TASK-026 independent re-review (read-only subagent): PASS_WITH_SUGGESTIONS, with two Important items. Both were fixed in `browser/visual-references.spec.ts`: (1) a `page.goto` failure printed the resolved URL, which contains team, conversation or survey ids; `gotoRoute` now throws a message that names only the route template; (2) `report.json` was written only after the loop, so a timeout lost the per-capture readiness record; it is now written in a `finally` block, and the signed-in test budget is 7,200 s (navigation time added to the worst case). Suggestions not taken: a `not_verified` capture still writes a PNG with the same name pattern (the report row carries `status`); the readiness check is a regex, not copy keys (recorded deviation); `conversation-overlap.spec.ts` has no readiness wait, but it writes no screenshots. The reviewer could not verify, from code, that signed-in screenshots show no account name or email; this is not yet checked. Typecheck and lint pass after the edit (`pnpm typecheck` no errors; `pnpm lint` 0 errors, 1 pre-existing warning). The harness was not re-run, so no new capture exists.
- TASK-026 targeted re-check of the two fixes: see the next entry.

**Change made**
- `SkillProfilePage.tsx` competency card: the row is now stacked (`flex flex-col gap-2`) instead of side-by-side from `sm`, so the competency name has the full column width. Reference 07 at 1280 px had "Testautomatisering" and "Observerbarhet" breaking mid-word inside a ~345 px column. Skill-profile and skills-route tests pass (23 files, 439 tests). Re-capture of reference 07 is **not yet done**: it needs the browser harness, and repeating the real sign-in for a screenshot is deferred to avoid another BR-37 deviation.

## Continuation run 4 (2026-11-04): owner decisions and corrective tasks

**Owner decisions applied**
- Decision 1 (references 03 and 05): substantial composition mismatches are implemented as round 2 corrective tasks TASK-027 (home), TASK-028 (team overview header and summary row), TASK-029 (team overview lower panels). They are not accepted deviations and do not close TASK-020 on their own. They use only existing reads, approved illustrations and supported functionality.
- Decision 2 (authenticated browser session): one real sign-in per verification run, with the session reused for screenshots, keyboard and accessibility checks. Earlier runs signed in several times (the BR-37 deviation recorded in "Continuation run" and "Continuation run 2"); those are historical evidence and are not repeated.
- Decision 3 (team detail semantics): the summary strip before the route navigation in DOM order is approved, provided keyboard and screen-reader order stays logical. The orphan `<dd>` in `TeamSummaryStrip.tsx` now has a "Status" `<dt>` (existing copy key `status`; no new status value; the underlying status value is unchanged). Teams feature and route tests pass after the change (58 files, 1,018 tests).

**Reviews**
- TASK-026 re-review: the two Important findings were fixed (navigation error text now names only the route template; report.json is written in a `finally`). A targeted read-only re-check returned PASS.

## Browser run 5 (2026-11-04): TASK-026 harness re-run and reference 07 re-capture

Run: `pnpm exec playwright test -c browser/playwright.config.ts browser/visual-references.spec.ts` against `pnpm dev` on port 3000. Decision 2 applied: one real sign-in in the signed-in test, session reused for all signed-in captures; the signed-out test (references 01 and 02) uses no sign-in. Result: 2 tests passed (exit 0).

- Captures: 93 captured, 7 `not_found` (reference 14, `/survey/[surveyId]`: no survey is reachable from the test account; not captured, recorded as not verified).
- Readiness: all 93 captured entries report `ready: true` after the bounded loading wait (no loading copy at capture time).
- Horizontal scroll: none in any captured entry.
- Report: `.verify-output/visual/report.json` records route templates only (no resolved team, conversation or survey IDs). Checked by aggregate summary.
- Reference 07 at 1280 px light re-captured after the competency-card fix: "Testautomatisering" and "Observerbarhet" are on one line each, and the level selects show their full text. The mid-word break and the select truncation recorded above are resolved for this capture.
- Reference 03 and 05 captures in this run reflect the state before the round 2 corrective tasks (TASK-027 is implemented but not accepted; TASK-028 and TASK-029 are not implemented). They are not final evidence for those references.
- BR-37: this run is one sign-in. Earlier multiple-sign-in runs stay recorded as historical deviations.

## Browser run 7 (2026-11-05): 320, 360 and 1024 px review, fixes and re-capture

Run: `pnpm exec playwright test -c browser/playwright.config.ts browser/visual-references.spec.ts` against `pnpm dev` on port 3000, one real sign-in for the signed-in test (BR-37). Result: 2 tests passed. 171 captured, 13 `not_found` (reference 14 at each width and theme; no survey reachable). Readiness: 0 entries not ready. Horizontal scroll: 0 entries at 320, 360, 375, 640, 768, 1024 and 1280 px.

Visual review at 360 and 1024 px (read-only subagents compared each capture with its reference PNG and the SPEC criteria; the main session re-checked the changed captures):

| Ref | 1024 px light | 360 px light | Dark | Status |
|---|---|---|---|---|
| 01 | Match. Trust band shows 2 items where the reference shows 4; the approved copy decision (TASK-022) is the basis. | OK | OK | Deviation (approved copy decision) |
| 02 | Match. No Google, "Husk meg" or "Glemt passord?". Right panel is a flat colour, not the reference illustration (BR-10 crop). | OK | OK | Deviation (BR-10, SPEC 02) |
| 03 | Partial (superseded by continuation run 8, 2026-11-05). Greeting band with display name is present ("Hei, {name}", D-13); the landscape art is omitted (D-13); the top row has two approved cards (D-10, D-13). "Neste steg" column narrow at 1024 px. | OK | OK | Not matched; open (see below) |
| 04 | Match. Three cards in a row, identity art, relationship badge, action. | OK | OK | Deviation (SPEC 04 exclusions) |
| 05 | Partial. Header band and two-column rows present. No three-card summary row, no aside. **Medlemmer panel empty** for this team's data: investigated 2026-11-05 (TASK-031). The roster is collapsed by design (BR-31, lazy load on first expand); the zero-member team shows the correct empty state. Not a defect. | OK | OK | Not matched; open (see below) |
| 06 | Not verifiable with this data: the owner's team has no plans, so the empty state is captured. Minor: "DevPulse" brand text duplicated in the 360 px header. | OK | OK | Not verifiable with this data |
| 07 | Stacked, not three panels, at 1024 px. TASK-024 moved the three-panel row to `xl` because the competency column was 228 px at 1024 px. Recorded as the approved TASK-024 layout consequence. | OK | OK | Deviation (TASK-024) |
| 08 | Match for required items. Buttons Rediger / Fullfør / Slett about 36 px tall at 360 px. | OK (touch target 36 px) | OK | Deviation (minor, see below) |
| 09 | Match: list only below `xl` (D-7). Chips about 28 px tall at 360 px. | OK (chips 28 px) | OK | Match with minor touch-target note |
| 10 | **Defect fixed in this run**: the header lacked status badge, start date and participant (BR-23). Now shown (see fix below). Dev-overlay text ignored. | OK. "Ingen andre i teamet…" lines use a larger font than body text (minor, not changed). | OK | Fixed; re-captured |
| 11 | Match on composition. Absent: tabs, search, filter (not approved for this page). Buttons "Nytt team" and "Deaktiver team" about 34 px. | OK (34 px buttons) | OK | Deviation; minor touch-target note |
| 12 | Match on composition: role list left, detail right, no permission toggles. Role list items have no role icon (BR-11). Buttons about 34 px at 360 px. | OK (34 px) | OK | Minor defect: role icons missing (open) |
| 13 | **Blocking defect fixed in this run**: the decorative header artwork sat behind the text at 1024 and 360 px and had a light fill that made white text unreadable in dark theme. Artwork removed (BR-10 omission; reason: the band cannot be placed without covering content). Re-captured: 1024 light and 360 dark show readable text and no artwork. Card icons (Team, Visningsnavn, Konto) and the "Rediger profil" icon are still missing (BR-11), recorded as open. | OK (no overlap after fix) | OK after fix | Fixed; minor icon gaps open |

**Fixes made in this run**
- `app/(app)/me/profile/page.tsx`: removed the decorative header SVG (BR-10 omission). The change is presentation only; no read, data or copy changed.
- `src/features/development-conversations/components/OwnerConversationEditor.tsx`: added a header summary above the tabs with the existing status badge (`conversationsCopy.statusLabel`), the planned date (`plannedForLabel`) and the participant state line, from the owner read already loaded. No new read, no new copy key. Colour uses the existing `text-muted` token, because the raw-palette allow-list test counts raw zinc classes per file.

**Gates (2026-11-05, after the fixes)**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0; 0 errors, 1 pre-existing warning (forum test).
- `pnpm test`: exit 0; 533 files passed, 1 skipped; 9340 tests passed, 2 skipped.
- `pnpm build`: exit 0. Note: the build ran while `pnpm dev` was on port 3000; the dev server was not restarted.

**Open after run 7 (not fixed here; recorded, not passed)**
- Reference 03: resolved as approved deviations in continuation run 8 (D-10, D-13): two top-row cards, landscape art omitted, greeting "Hei, {name}" kept.
- Reference 05: the Medlemmer panel is collapsed by design; TASK-031 found no defect (D-14). Avatar preview is an approved privacy-driven deviation.
- Reference 13 and 12: BR-11 card and action icons missing (Team, Visningsnavn, Konto, role list items, "Rediger profil").
- Touch targets of about 28 to 36 px on refs 08, 09, 11 and 12 at 360 px. The 44 px rule in SPEC applies to the account menu and the survey; these are minor and not claimed as failures of a stated criterion.
- Reference 06 empty state: the owner's team has no roadmap plans, so the board, tiles and detail panel are not visually verified. A seeded capture is needed.
- Reference 14: not_verified (no reachable survey).
- True 200 % zoom: not verified.
- TASK-021 (keyboard-only pass on all 14 pages, automated accessibility scan, screen-reader spot check): not performed in this run.

## Accessibility scan and keyboard pass (2026-11-05, TASK-021 partial)

Source: `.verify-output/a11y/report.json` (`browser/accessibility-keyboard.spec.ts`, written 2026-11-05 14:03). Tool: `@axe-core/playwright` 4.14.0 with axe-core 4.14, WCAG 2.0/2.1 A and AA tags, 11 routes at 320 and 768 px. No WCAG conformance is claimed from these results.

- **axe violations:** 0 at every route and width (22 scans).
- **axe incomplete checks:** 26 in total (13 per width). These need manual review and are **not yet resolved or documented by rule id**: the report stores counts only. Next step: rerun the scan recording the rule ids of the incomplete results.
- **Keyboard pass (Tab order, geometry and outline only):** 11 routes at 320 and 768 px, 120 to 150 focus stops per route, 0 hidden or off-screen stops, main content reached on every route. Flagged: `/me/conversations/[conversationId]` at 320 px (7 stops) and 768 px (5 stops), both on `input[type=date]`, reported as "no focus indicator".
- **Date-input focus, isolated re-measurement (2026-11-05, one signed-in session, 320 px):** the planned-for date input (`OwnerConversationEditor`) has `:focus-visible` true and a 2 px solid outline (`rgb(8,123,91)`) both after programmatic focus and after Tab focus. The earlier "no indicator" result is therefore **not reproduced** in isolation. Classification: most likely a measurement artifact of the full pass (the Tab sequence may land on the inner date segments, where the outer `input` has no own outline), not a missing focus ring. Not fully explained; recorded as open. No code change was made for it. Screenshots: `.verify-output/a11y/date-focus-0.png`.
- **Sign-out by keyboard at 320 and 768 px:** the trigger opened with Enter, the `Logg ut` item was reached by Tab, and the signed-out state was observed at both widths (`.verify-output/a11y/signout.json`).
- **BR-37 deviation:** the accessibility run signed in through the real form three times (once for the scan and keyboard pass, once per width in the sign-out test), and the isolated date check signed in once more. This is recorded as a deviation, not repeated.
- **Dependency note:** `@axe-core/playwright` was added to `devDependencies` next to `@playwright/test`. SPEC D-6 approved Playwright as the only browser-automation dependency, and the SPEC lists "no axe-core dependency". This needs an owner decision (accept, or remove and run axe without the wrapper).
- **Screen-reader spot check:** not performed.

## Continuation run 8 (2026-11-05): keyboard detector, axe review, TASK-030 and TASK-031

Owner decisions applied: `@axe-core/playwright` approved and kept as a development dependency. Stale "owner decision pending" entries removed from this file and TASKS.md.

**Sign-in count (BR-37 deviation, recorded):** the accessibility scan and keyboard pass ran in one run with one real sign-in (decision 2). The sign-out test ran in a separate run with one sign-in per width (two sign-ins). The first scan attempt failed at sign-in (the post-sign-in navigation was not detected within 30 s; the failed run was not a scan result). The sign-in wait was changed to a 60 s location poll and the run repeated.

**Keyboard detector fix (TASK-021 step 1).** `browser/accessibility-keyboard.spec.ts` now tracks element identity per Tab stop. It separates:
- *repeated stops*: Tab presses where `document.activeElement` is the same element as the previous stop (the native date input segments);
- *distinct targets*: unique elements that received focus;
- *focus outside the document*: Tab presses after which no page element is focused (for example browser UI at the end of the tab cycle; a calendar picker is browser UI and cannot be distinguished from this signal alone);
- *indicator*: outline or box-shadow on the element, plus `:focus-visible`.
A screenshot is taken at the first stop of each native date input.

**Keyboard re-run at 320 and 768 px (11 routes each, 160 Tab presses per route; one run, 2026-11-05):**

| Measure | 320 px | 768 px |
|---|---|---|
| Hidden or off-screen stops (all routes) | 0 | 0 |
| Distinct focus targets without an indicator (all routes) | 0 | 0 |
| Main content reached (all routes) | yes | yes |
| Native date input (`/me/conversations/[conversationId]`) | 1 distinct target; `:focus-visible` true; outline present; 22 repeated stops | 1 distinct target; `:focus-visible` true; outline present; 15 repeated stops |
| Raw stops without an indicator | 7, all repeated stops on the date input (no distinct target lacks an indicator) | 5, same |
| Focus outside the document (Tab presses with no page element focused) | 5 to 20 per route; 219 in total at 320 px and 768 px combined | same range; not classified further. Likely end-of-tab-cycle focus in browser UI; not confirmed as a date-picker or any other control |

Screenshot of the date input at 320 px, first stop (`.verify-output/a11y/date-focus-me-conversations-conversationid-w320-1.png`): a green focus ring is visible around the input. **Result: passed for the date input at the element level.** The earlier "no focus indicator" result is classified as a measurement artifact of repeated stops. **Not verified:** the ring on the internal segment that has focus during repeated stops (browser shadow tree, not visible to page script; the screenshot is the only evidence), and the calendar picker (not reached by Tab in this sequence; not inspected).

**Keyboard sign-out (separate run, 2026-11-05):** at 320 and 768 px the account trigger was reached by Tab, opened with Enter, the `Logg ut` item reached by Tab and activated with Enter; the signed-out state was observed at both widths (`.verify-output/a11y/signout.json`: all true).

**Axe review (TASK-021 step 3).** 22 scans (11 routes × 320 and 768 px), WCAG 2.0/2.1 A and AA. Violations: 0 before and after the fix. Incomplete checks: 26 before the fix, 4 after.

| Rule | Impact | Affected element | Incomplete reason (axe) | Classification |
|---|---|---|---|---|
| aria-valid-attr-value (22 nodes, route `/` and every authenticated route) | critical | Account trigger (`aria-haspopup`) | "Unable to determine if aria-controls referenced ID exists" | **Confirmed defect, fixed.** `AccountMenu.tsx` set `aria-controls` to the panel id while the panel is rendered only when open, so a closed trigger referenced a missing id. Fix: `aria-controls={open ? panelId : undefined}`. Nav tests 6 files / 71 tests passed. Re-scan: 0 incomplete for this rule. |
| color-contrast (route `/`, 320 and 768 px) | serious | Recharts legend text and SVG axis text (`.legend-item-*`, `tspan`, `text[y]`) on the team trend chart | "background color could not be determined because element contains an image node" | **not_verified.** Chart text is SVG on a chart background that axe cannot resolve. Not measured by hand in this run. |
| color-contrast (route `/teams/[teamId]`, 320 and 768 px) | serious | Team detail chart and roster toggle text (`button[aria-controls="team-roster-panel"] > span`, `.text-text-muted`) | "not determinable: overlapped by another element" or "contains an image node"; some nodes "contains only non-text characters" | **not_verified.** Overlapping or image-backed backgrounds; needs a manual foreground and background colour check (for example via the computed colour of the nearest opaque ancestor). Not done in this run. |

**Screen-reader spot check:** not performed (no screen reader in this environment).

**Keyboard coverage:** 11 routes at 320 and 768 px (the authenticated and home routes reachable by the owner account). Not included in this pass: `/sign-in` (public form) and `/survey/[surveyId]` (reference 14, no survey reachable; not_verified).

**Reviews.** TASK-030 and TASK-031 read-only independent review (fresh subagent, code and document inspection only): TASK-030 PASS_WITH_SUGGESTIONS; TASK-031 PASS_WITH_SUGGESTIONS. Important items fixed in this run: VERIFICATION.md rows for references 03 and 05 updated (they described the old state); SPEC D-10 wording aligned to D-13 (two top-row cards); the D-14 citation path corrected to `docs/features/member-identity-and-team-roles/SPEC.md`. Suggestion, not changed: "no new read" in TASK-030 is relative to this task (the home makes the reads listed in TASK-027, which are existing gateways).

**Gates (2026-11-05, this run):**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0; 0 errors, 1 pre-existing warning (forum test).
- `pnpm test`: exit 0; 533 files passed, 1 skipped; 9340 tests passed, 2 skipped.

## Continuation run 9 (2026-11-05): BR-11 icon gaps, visual capture

**Code changes (icons only, presentation):**
- `app/(app)/me/profile/page.tsx`: `Pencil` icon on "Rediger profil"; `IdCard` icon on the Visningsnavn card heading.
- `src/features/role-profiles/components/AdminRoles.tsx`: `UserCog` icon on each role list row (split list, `lg`).
- Icons come from the `Icon` wrapper over `lucide-react` (decorative, `aria-hidden`); `icon-dependency` guard passes.
- Tests: `src/features/role-profiles` and `app/(app)/me/profile` 35 files / 379 tests passed; `pnpm typecheck` exit 0.

**Capture:** `browser/visual-references.spec.ts`, one real sign-in, 2 tests passed. 171 captured, 13 not_found (reference 14 only), 0 not ready, 0 horizontal scroll. Two harness fixes were needed before the run completed: the sign-in wait was a location poll (60 s), and the link read retries when the page navigates mid-read. Earlier failed runs did not write a report.

**BR-11 icon result (refs 12 and 13):**

| Ref | Location | Reference element | Implemented element | Result |
|---|---|---|---|---|
| 13 | Button | Edit action | `Pencil` in "Rediger profil" | present (1280 px capture) |
| 13 | Card header | Visningsnavn | `IdCard` heading icon | present (1280 px capture) |
| 13 | Card row | Konto | `UserRound` in the erasure row | present |
| 13 | Card row | Team | `Users` in the team link | present |
| 13 | Card header | Team, Konto headings | none | missing (minor, open) |
| 12 | List item | Role | `UserCog` in each role row | present in code; split list at `lg`; not inspected in the capture image (see note) |

**Not verified:** the `UserCog` role row was not inspected in the capture image; the presence is from code and the capture report only.

## Continuation run 10 (2026-11-05): contrast review, sign-in page, 1280 px sign-out, card icons

**Sign-ins in this run (BR-37, decision 2):** one real sign-in in `browser/contrast-and-signout-1280.spec.ts` (sign-in with `continue=//evil.example`: landed on `/`, the invalid-continue fallback). One sign-in in the signed-in scan (`accessibility-keyboard.spec.ts`, automated scan and keyboard pass). The public `/sign-in` scan and keyboard pass signs in to nothing. One sign-in in the visual capture run (see the capture entry below).

**Code changes (presentation only):**
- `src/components/ui/Section.tsx`: optional decorative `icon` prop, rendered inside the `h2` before the title. Existing callers do not pass it, so their output is unchanged.
- `app/(app)/me/profile/page.tsx`: the Konto heading has a `UserRound` icon and the Team heading has a `Users` icon (reference 13, BR-11 card-header rows). No read, copy or behaviour changed.

**Contrast review (TASK-021 step 1): the four incomplete `color-contrast` checks, measured.** Source: `.verify-output/a11y/contrast-and-signout-1280.json`. Method: computed foreground (`fill` for SVG text, `color` for HTML) times effective opacity, against the first opaque ancestor background (white in the light theme). Measured at 320 and 768 px on `/` and `/teams/[teamId]`:

| Element (axe target) | Foreground | Background | Ratio | Size | AA normal text (4.5:1) |
|---|---|---|---|---|---|
| Recharts legend text (`.recharts-legend-item-text`, 3 series) | rgb(11,107,99), rgb(154,100,0), rgb(79,70,176) | white | 6.37, 5.00, 7.41 | 16 px | pass |
| Recharts axis tick text (`tspan`, `text[y]`) | rgb(102,102,102) | white | 5.74 | 12 px | pass |
| Roster toggle and muted label (`.text-text-muted`, `dt`) | rgb(95,111,118) and rgb(20,36,43) | white | 5.22 and 15.95 | 14 px | pass |

**Result: no confirmed contrast defect; no code change.** Every measured pair meets 4.5:1. Limits: the measurement is the first matching element per axe selector (all chart ticks share one fill, so this is representative), the background is the computed opaque ancestor rather than a rendered pixel sample, and axe's "overlapped by another element" reason (one 768 px roster label) is not tested by an occlusion probe. The four axe items therefore remain **incomplete in axe's own terms**, with the element-level evidence above recorded as the manual assessment. The light theme only was measured.

**Automated scan (TASK-021):** signed-in re-scan after the `aria-controls` fix and the profile icon change: 22 scans (11 routes at 320 and 768 px), 0 violations, 4 incomplete (all `color-contrast`, the items above). `aria-valid-attr-value` is no longer incomplete. Signed-out `/sign-in` scan at 320 and 768 px: 0 violations, 0 incomplete, 26 passes each width.

**Keyboard pass (TASK-021):** signed-in re-run, 11 routes at 320 and 768 px: 0 hidden or off-screen stops and 0 distinct targets without an indicator. Signed-out `/sign-in` at 320 and 768 px: 128 focus stops, 8 distinct targets, 0 hidden, 0 without indicator, main content reached. Routes now covered: 11 signed-in routes plus `/sign-in` (13 of 14 reference pages). `/survey/[surveyId]` (reference 14) is not reachable, so it is not covered: not_verified.

**Keyboard sign-out at 1280 px (TASK-021, keyboard, one sign-in):** the account trigger was reached by Tab (aria-haspopup), opened with Enter, `Logg ut` reached by Tab and activated with Enter. Landing path `/`, account trigger absent, `Logg inn` link present. Earlier keyboard sign-out at 320 and 768 px is recorded in continuation run 8.

**Screen-reader spot check (TASK-021 step 2): not performed.** No screen reader is installed in this environment (NVDA is absent; Narrator exists but cannot be driven from this session). Not claimed from the automated scan.

**Reference 13 card-header icons (BR-11):** the Konto and Team headings now have icons; the card-header rows in the icon inventory for reference 13 move from "missing" to "present in code (Section icon); the capture run below reports the page as captured and ready, but the icon was not inspected by eye".

**Small touch targets (refs 08, 09, 11, 12 at 360 px, 28 to 36 px):** reviewed against WCAG 2.2 AA target size (2.5.8, 24 px minimum): all measured targets are at or above 24 px, so they are not AA failures. The 44 px rule applies to the account menu and the survey (SPEC). No change made. Not a confirmed accessibility defect under the stated criteria.

**Visual capture run 10 (2026-11-05):** `browser/visual-references.spec.ts`, one real sign-in for the signed-in test, 2 tests passed. 170 captured, 1 `not_verified`, 13 `not_found` (reference 14 only). Horizontal scroll: 0 entries. Readiness: 1 entry not ready: reference 03 at 1280 px in dark theme (`note`: captured while loading text was still visible; the bounded wait ended first). That capture is recorded as not_verified and is not used as evidence. The reference 13 captures at 320 and 360 px are ready with no horizontal scroll.

**Sign-ins in run 10, total:** three runs, each with one real sign-in (contrast and sign-out; signed-in scan; visual capture). Within the scan run, the signed-out `/sign-in` test signs in to nothing. BR-37 is met per run; the earlier per-width sign-out deviation still stands.

## Continuation run 11 (2026-11-05): final verification pass

**1. Reference 03, dark, 1280 px.** Re-captured in `browser/visual-references.spec.ts` (final run, below). The capture is ready: no loading copy remains in the screenshot (`.verify-output/visual/ref-03-app-home-w1280-mork.png`). The run 10 "not ready" flag is a readiness false negative of the harness, not a product defect: a diagnostic sampled the home page over 20 s and the loading copy ("Laster…", a help paragraph) cleared after 3.9 to 5.1 s in all six settle runs (light and dark). The run 10 cause is not proven (the file it wrote shows no loading copy). Product defect: none found.

**2. TASK-020 page-level overlap:** see the overlap table above and the run 11 measurement notes.

**3. TASK-021 mouse sign-out at 320 and 768 px** (`browser/signout-mouse.spec.ts`, one sign-in per run, BR-37; `.verify-output/a11y/signout-mouse-w320.json` and `-w768.json`):

| Width | Input | Landing after sign-in | Account trigger height | Final path | Account trigger after sign-out | Logg inn link | Reload stays signed out |
|---|---|---|---|---|---|---|---|
| 320 px | mouse | `/` | 44 px | `/` | absent | present | yes |
| 768 px | mouse | `/` | 44 px | `/` | absent | present | yes |

Keyboard sign-out at 320 and 768 px (run 8) and at 1280 px (run 10), and mouse at 1280 px (run 10), are already recorded. The sign-out criterion is therefore met at all three widths by both inputs.

**4. Accessibility.**
- Dark-theme contrast (`browser/contrast-dark-and-occlusion.spec.ts`): the four axe `color-contrast` incomplete items were measured in both themes at 320 and 768 px on `/` and the team overview (82 probes). One real defect (TrendChart axis tick text, 2.65:1 in dark) was found and fixed; the re-run has 0 AA failures. Lowest ratios after the fix: dark tick text 6.01:1, dark legend 6.78:1, light tick text 5.22:1, light legend 5.00:1 (yellow series on white; passes 4.5:1).
- Axe "overlapped" reason (team overview roster label, `dt`, 768 px): the occlusion probe samples the element centre with `elementFromPoint` after scrolling it into view. No element covers the sample point in any of the 82 probes (`occluded: false` everywhere). The axe heuristic is recorded as incomplete for its own reason; the measured background is the card, and the ratio clears AA in both themes. Not claimed as a conformance result.
- Remaining axe incomplete items: the four `color-contrast` items above, which are now measured as passing. The full-rule scan (run 10, `accessibility-keyboard.spec.ts`) reported only these four; run 11 re-checked colour contrast only and did not re-run the full-rule scan.
- Screen-reader spot check: **not performed; not_verified.** Checked this run: no NVDA or JAWS installed or running; Narrator exists but cannot be driven from this session. No WCAG conformance is claimed.

**5. Reference 13 header icons** (`ref-13-my-profile-w1280-lys.png` and `-mork.png`): the Team (`Users`) and Konto (`UserRound`) icons render beside their headings in light and dark themes, matching the Visningsnavn heading icon. No rendering or accessibility defect found. No change.

**6. Reference 06** (`ref-06-team-roadmap-w1280-lys.png`): the genuine empty roadmap state is shown ("Ingen planer ennå. Planer opprettes for kompetanseområder teamet følger."). No plans were created and no shared data was modified. The board and detail panel with plans are **not visually verified** (no seeded data; seeding would modify shared Firebase data, which the owner decision rules out).

**Final visual capture (2026-11-05, `browser/visual-references.spec.ts`, 2 tests passed):** 184 entries; 171 captured; 0 `not_verified`; 13 `not_found` (reference 14 only, approved); 0 horizontal scroll; readiness: all captured entries ready (includes reference 03 dark 1280).

**Gates (2026-11-05, after the TrendChart fix and the TeamDetail test fix below):**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0; 0 errors; 1 pre-existing warning (`src/features/forum/server/create-reply.transaction.test.ts`).
- `pnpm test`: exit 0; 533 files passed, 1 skipped; 9340 tests passed, 2 skipped.
- `pnpm build`: exit 0.

**Test fixes made in this run (not behaviour changes):**
- `TeamDetail.test.tsx` «Kompetansebehov og dekning»: the two fetch assertions now `waitFor` the call. The needs and contribution reads start after the token subscription resolves, which can be after the heading renders; the synchronous assertion raced it. The test still asserts the same token and team id.
- `raw-palette.test.ts` allow-list: a comment briefly contained a raw hex value in `TrendChart.tsx`; reworded, so the count is back to the allow-listed value.

**Browser harness (untracked, `browser/`, not committed):** `page-overlap.spec.ts`, `contrast-dark-and-occlusion.spec.ts`, `signout-mouse.spec.ts` added in this run. Reports are in `.verify-output/` (git-ignored) and contain route templates, tags, test ids, positions and sizes only; no page text, names or resolved URLs. Browser contexts are in-memory; no profile directory is written and none needs deleting.

**Security and privacy reassessment:** the changes in this run are presentation (`style.fill` on axis ticks), a test timing change, and harness specs using the existing credential and production guards (`browser/guards.ts`, `global-setup.ts`). No new data category, persistence, endpoint or auth path. The previous security review scope is unchanged. No new finding.

## Outstanding checks

- Smoke run with the owner's test account (TASK-001). Needs `DEVPULSE_VERIFY_EMAIL` and `DEVPULSE_VERIFY_PASSWORD` in the runtime environment and `pnpm dev` on port 3000.
- All reference audits, icon inventory rows, bounding-box measurements and keyboard checks listed above (TASK-020 and TASK-021).

## Gates

| Task | Command | Result |
|---|---|---|
| TASK-001 | `pnpm typecheck` | Passed (2026-11-04) |
| TASK-001 | `pnpm lint` | Passed, 0 errors; 1 pre-existing warning in `src/features/forum/server/create-reply.transaction.test.ts` (unrelated) |
| TASK-001 | `pnpm test` | Passed: 530 files passed, 1 skipped; 9304 tests passed, 2 skipped |

## Continuation run 2 (2026-11-04): measurements and remediation

Sign-in: one real-form sign-in per browser run (several runs in this session; see the BR-37 note above).

**Remediation made in this run**
- TASK-024: the three-panel skills row moved from `lg` to `xl` (`SkillProfilePage.tsx`). Measured competency row width: 228 px at 1024 px before (failed the 320 px criterion), 678 px at 1024 px after, 328 px at 1280 px.
- Horizontal overflow at 320 px: the cause was a 1 px overflowing `select` in `TeamSkillSection.tsx`; fixed with `min-w-0 max-w-full`. After the fix: 0 pages overflow at 320 or 768 px (signed-in routes 03 to 13, plus 10).
- Home read failures: home panels stayed on "Laster…" when a fetch rejected, because the `.then` handlers had no rejection path (`AuthenticatedHome.tsx`, `HomePanels.tsx`). Each now shows the existing error state on rejection. Regression test added (`AuthenticatedHome.test.tsx`, "a rejected read leaves no panel stuck on loading"). After the fix, reference 03 at 1280 px loaded fully (no loading copy).
- TASK-026 review: the stale `.verify-output/visual/report.json` (which held resolved ids) was deleted; it is regenerated only by the spec run. The readiness regex is `Laster\b[^\n]*…`, which matches every loading string in the copy modules (all are `Laster … ` with the ellipsis character); the copy-key list was not used, and this is recorded as a deliberate deviation from the TASK-026 implementation note.

**Measured evidence (1280 px light unless stated)**

| Check | Result |
|---|---|
| TASK-025 goals main column | 712 px at 1024 px (70 % of viewport), 968 px at 1280 px (76 %); criterion ≥ 60 % met |
| TASK-024 competency column | 678 px at 1024 px; 328 px at 1280 px; criterion ≥ 320 px met |
| Horizontal overflow at 320 and 768 px | none on routes 03 to 13 and the conversation detail |
| Account trigger at 320 and 768 px | 44 px high; Escape closes; focus returns |
| Sign-out, mouse (1280 px) and keyboard (768 px) | trigger disappears; signed-out shell shows "Logg inn" links; reload stays signed out (both paths verified in separate runs) |
| Sidebar and drawer sign-out | no `Logg ut` in `nav` or in the drawer dialog |

**Visual comparison (1280 px light capture against the reference PNG)**

| Ref | Result | Basis |
|---|---|---|
| 03 | Deviation; composition comparable, not Matches | Greeting band, four status tiles, goals/conversation/role panels, trend chart and next steps are present in the reference order. Excluded items (bell, avatar, coverage percentage, progress rings) and this account's data differ. Not a Matches result. |
| 04 | Deviation (spec exclusion) | Reference shows tabs, search, filters, metrics and "Nytt team" (excluded by BR-27). What is in scope is present: identity art, name, relationship badge, card grid. |
| 05 | **Not matched (open)** | The capture is a results-first layout with a different team's content, not the reference's header band, four stat cards, needs and challenges panels. The reference's sections (Kompetansebehov og dekning, Aktive utfordringer, Teammedlemmer, Roadmap neste steg, Kommende aktivitet) are not in the same arrangement. The TASK-010 note that the composition "already exists" is not supported by this capture. Open: a composition change for the team overview is needed. |
| 06 to 13 | **Not compared in this run** | Captures exist in `.verify-output/visual/run6/` (1280 px light); comparison against the references is still open. |

**Not verified in this run**
- True 200 % browser zoom: not verified (Playwright headless Chromium has no browser-zoom control; a 640 px viewport is not zoom).
- Reference 14 (`/survey/[surveyId]`): not verified (decision 2).
- Keyboard-only pass for all 14 pages: not performed. Only the account-menu and drawer keyboard checks above were done.
- Screen-reader spot check: not performed.
- Automated accessibility scan: not performed.

## Continuation run 6 (2026-11-04): TASK-027 to TASK-029 and browser comparison

**Harness fix before this run.** The capture `settle` check passed on the first poll, which could happen before the client rendered its loading states. Earlier captures of the signed-in home (ref 03) were therefore recorded as settled while they still showed "Laster…". `settle` now requires the loading copy to be absent for a continuous 1.5 s quiet window (`browser/visual-references.spec.ts`). Every capture below is from the rerun after that fix: 93 of 100 captured, 0 not ready, 0 horizontal scroll; the 7 `not_found` captures are reference 14 (no survey link in the signed-in UI).

**Decisions applied to this run.** D-10 (home: three-card top row, no coverage card), D-11 (four viewer-owned home reads, verified in code for authorization and per-panel errors), D-12 (team overview omissions: header counts, last-updated, pulse visualisation, coverage card). Independent review of TASK-027 (PASS_WITH_SUGGESTIONS, 2026-11-04) is recorded in TASKS.md.

**Tasks in this run.** TASK-028 Done (independent re-review PASS). TASK-029 Done (independent re-review 2 PASS_WITH_SUGGESTIONS). The TASK-029 layout decision (chart beside needs, challenges beside members) amends the SPEC 05 wording; recorded in SPEC.md.

### Visual comparison, 1280 px light (captures in `.verify-output/visual/`)

| Ref | Capture | Result | Evidence and reason |
|---|---|---|---|
| 02 sign-in | `ref-02-sign-in-w1280-lys.png` | Partial match | Split layout and value points match. Justified: no Google, "Husk meg" or "Glemt passord?" (SPEC 02). Deviation: no logo or "Fortsett til DevPulse" line inside the card; the illustration is a crop, not the full background. |
| 03 signed-in home | `ref-03-app-home-w1280-lys.png` | Partial match | Settled (no loading copy). Greeting band with the existing heading "Hjem" and purpose line, not "God morgen, Joel" (copy decision not made). Top row has team card and pulse card; coverage card omitted (D-10). Middle row Mine mål, Neste samtale, Rolle og utvikling. Lower row chart beside Neste steg. Team cards below. |
| 04 teams | `ref-04-teams-w1280-lys.png` | Justified deviation | SPEC 04 card grid (3 columns at 1280 px) with identity art, name, relationship badge and action. Reference metrics, search, filter and status tabs are excluded by SPEC 04 (not returned by the read). |
| 05 team overview | `ref-05-team-overview-w1280-lys.png` | Partial match | Header with identity art, name and existing summary text (D-8: no status badge). Summary row: two cards (open challenges, active plans) plus the roadmap next-steps panel at xl. Results zone stacked, then needs beside chart, challenges beside members, forum full width. Omitted: pulse, coverage, header counts, last-updated, calendar (D-12). |
| 06 team roadmap | `ref-06-team-roadmap-w1280-lys.png` | Not verifiable with this data | The owner's test team has no roadmap plans, so the capture shows the empty state. Header and tiles are absent from the capture. Mismatch recorded: the team roadmap page has no identity header band. |
| 07 my skills | `ref-07-my-skills-w1280-lys.png` | Justified deviation | SPEC 07 summary counts (no average), three-panel row with level names and bars, no radar. Reference radar and average are excluded by SPEC 07. |
| 08 my goals | `ref-08-my-goals-w1280-lys.png` | Justified deviation | SPEC 08 summary counts (no progress ring or percentage), status tabs with counts, goal cards with status and linked area. Reference progress ring and inspiration panel are excluded (SPEC 08 and no data). |
| 09 conversations | `ref-09-conversations-w1280-lys.png` | Partial match | Master list at 1280 px with a placeholder in the detail column ("Velg en samtale i listen…"). The reference shows a selected conversation; no selection was made in the capture. |
| 10 conversation detail | `ref-10-conversation-detail-w1280-lys.png` | Justified deviation with gap | The reference is a chat thread. SPEC 10 excludes chat bubbles, composer and message history, so the owner's structured editor (tabs Oversikt, Notater, Oppfølging) is shown. Gap: the page header does not show a status badge or participants in this capture. |
| 11 admin teams | `ref-11-admin-teams-w1280-lys.png` | Justified deviation | SPEC 11 scope marker, header and card grid with identity art and actions. Reference tabs, search, counts and pagination are excluded (no existing routes or data). |
| 12 admin roles | `ref-12-admin-roles-w1280-lys.png` | Justified deviation | Role list left and role detail right (SPEC 12). Reference permission toggles and assignment tab are excluded (TASK-017). |
| 13 my profile | `ref-13-my-profile-w1280-lys.png` | Partial match | Header band with two-column panels. Content differs: no skills, goals or contact panels, because the profile read does not return them (SPEC 13). Avatar shows an initial, not a photo. |
| 14 survey | not captured | not_verified | No survey link was found in the owner's signed-in UI (SPEC 14). Reference 14 remains not_verified. |

### Widths and zoom

- Captured widths: 375, 768 and 1280 px in light and dark, plus a 640 px reflow proxy in light. Not captured: 320, 360 and 1024 px (the harness does not include them). 200 % browser zoom was not performed; the 640 px proxy is not zoom and is not claimed as 200 % evidence.
- Horizontal scroll: none at any captured width (`report.json`).
- Loading copy after settle: none in any capture (quiet-window check).

### Outstanding for this feature

- Keyboard-only navigation, automated accessibility checks and sign-out at 320 and 768 px (TASK-021): not performed in this run. No axe-core dependency exists in the repository.
- 320, 360 and 1024 px captures, and genuine 200 % zoom (TASK-020): not performed.
- Panel positions and overlap measurements at 1024 px for TASK-028 and TASK-029: not recorded.

### Gates (this run, 2026-11-04)

- `pnpm test`: exit 0. 533 files passed, 1 skipped; 9340 tests passed, 2 skipped.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0; 0 errors, 1 pre-existing warning (forum test).
- `pnpm build`: exit 0.

### Security and privacy review (2026-11-04, read-only subagent)

RESULT: PASS. No Blocking or Important findings. Checked: the six signed-in home reads (profile, goals, conversation list, role target, teams overview, team results) use existing client gateways, with no new route, rule or server file changed; each read has its own generation check and error phase. The pulse tile shows means only for a published result (invariant 11). The team overview's roadmap read is a single `RoadmapPlanningScope` with no new fetch; the next-steps panel renders only area name, status and target date. Verification browser script reads credentials only from environment variables, writes only to the git-ignored `.verify-output/`, and logs nothing. Suggestion: the open-challenge count is not a suppressed survey aggregate (challenges are individually visible by design), so it needs no threshold; keep it that way if the challenge list gains a threshold.
