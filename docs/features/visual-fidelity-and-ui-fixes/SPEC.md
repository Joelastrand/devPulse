# DevPulse Visual Fidelity and UI Fixes

## Status
Approved (2026-11-04) with the decisions D-1 to D-9 below, and the approved exceptions recorded in BR-11 notes, SPEC 07 and SPEC 11. The owner decisions for competency labels (SPEC 07) and the factual access-request and survey access-mode descriptions (SPEC 11) are approved (2026-11-04). No product code has changed for this feature at approval time. `TASKS.md` was created on 2026-11-04 by `split-tasks` and records task state.

### Approval decisions (2026-11-04)
- **D-1 Sign-in landing (BR-14).** After a successful sign-in, the app navigates automatically to `/`. The user is not left on a success screen that only offers a link. The default authenticated destination is `/`. The success message remains only as a fallback while navigation is in progress.
- **D-2 Survey continuation (BR-15, BR-16).** An authenticated visitor to `/sign-in?continue=/survey/{id}` is sent to that survey. The value is validated against the existing allow-list (exactly `/survey/{surveyId}`); no other internal route, absolute URL, protocol-relative value or encoded variant is accepted, so no open redirect is possible. An absent or invalid `continue` goes to `/`.
- **D-3 Illustrations (BR-10, BR-11, BR-12).** The budget stays at three approved unique illustration assets. They may be reused, cropped and repositioned. Standard interface icons from the existing `lucide-react` wrapper do not count as illustrations and must be restored where the references show them. No additional decorative artwork is introduced.
- **D-4 Mobile sign-out (BR-17, BR-18, BR-19).** `Logg ut` is removed from both the desktop sidebar and the mobile navigation drawer. Sign-out is available only in the account menu, on desktop and on mobile. The account menu must be reachable, operable and legible at mobile widths (BR-18).
- **D-5 Browser verification environment (2026-11-04 owner decision, reconciles BR-30 and BR-37).** The product owner confirmed that the Firebase environment currently configured for the local DevPulse application is a safe test environment, and explicitly authorized the owner's existing test account for authenticated browser verification against it. This is a user-approved exception to the isolation requirement in BR-30 and BR-37: no separate Firebase project or Firebase emulator is required, and browser verification is not blocked on proving that the environment is isolated. The exception does not extend to real employee wellbeing data: `SECURITY.md` invariant 15 is unchanged and still applies. The only account used is the owner's test account. See BR-30 and BR-37 for the rules that replace the isolation requirement.
- **D-6 Playwright as a development dependency (2026-11-04 owner approval).** Playwright is approved as a development dependency for browser verification, including the local browser installation it requires. This is the only browser-automation or visual-regression dependency approved by this feature. It is the exception recorded in "Out of scope" and BR-37. Adding it is a task in `TASKS.md`, not part of this planning step.
- **D-7 Conversation master-detail breakpoint (2026-11-04 owner decision, option A, amends BR-20, BR-21 and AD-5).** The in-place list and detail split on `/me/conversations` is used only at viewport widths of 1280 px (`xl`) and above. Below 1280 px the list is shown on its own and selecting a conversation navigates to the detail route, which uses the full content width, so the detail never shares the row with the list and no controls overlap or scroll horizontally. Where the side-by-side split is used, the detail column is at least 480 px wide. A 288 px detail panel is not an approved deviation. The Playwright bounding-box regression (`browser/conversation-overlap.spec.ts`) is kept and asserts the 480 px minimum at 1280 px. The inner context aside of the owner detail (participant and shared goals) sits beside the main column only at `2xl` (1536 px) so that the tab row is not squeezed inside the 1280 px detail pane; below `2xl` it stacks after the main content. This is a layout consequence of the same BR-22 cause, not a change to what the detail contains.
- **D-8 Team header deviation (2026-11-04 owner decision, amends BR-1 and the 05 criteria).** The existing team-detail read returns only the team name. The team overview header band therefore shows the identity art, the team name and the existing summary values, but no status badge and no description. This is an approved, narrowly scoped deviation (classification: data not returned by an existing read). No server read, DTO, route handler or data field is added or changed to reproduce the reference's badge or description, and no status or description text is invented. The reference's visual composition, typography, spacing and header-band treatment are otherwise preserved using the truthful available information.
- **D-9 Shared primitives (2026-11-04 owner decision, amends AD-3 and TASK-006).** `MasterDetail` and `SummaryStrip` are kept only where they are used by production views that the approved compositions need. Before final closeout, each is either (a) used by at least two production pages, or (b) removed together with its unit tests, and the AD-3 criterion is then explicitly reconciled in this SPEC as "not used; removed" with the reason. A usage count is never forced into an unrelated view to satisfy AD-3.
- **D-10 Signed-in home coverage card (2026-11-04 owner decision, amends TASK-027 and BR-28 for reference 03).** The reference's fourth categorical coverage card is omitted. The signed-in home top row keeps the two supported cards (team and team pulse; see D-13, which supersedes the earlier three-card wording). No coverage read is added to the home, and no coverage status is inferred from unrelated data or invented to reproduce the reference. This is an approved, data-driven visual deviation (classification: data not returned by an existing read on this page).
- **D-11 Signed-in home reads (2026-11-04 owner decision, conditional, TASK-027).** The four existing viewer-owned reads on `/` (own profile, own goals, own conversations, own role target) are approved for the middle row only if each uses an existing authorized server endpoint or gateway, keeps its established access controls, and exposes only information the signed-in viewer may already access. Verified 2026-11-04 in code: `GET /api/me/profile`, `GET /api/me/goals`, `GET /api/me/conversations` and `GET /api/me/role-target` each derive the subject from the verified bearer token (no uid in path, query or body); the client calls go through existing gateways; no route, rule or authorization file changed. No direct client Firestore access is added. A failed read leaves only its own panel in an error state.
- **D-12 Team overview omissions (2026-11-04 owner decision, amends TASK-028 and TASK-029 for reference 05).** The following reference elements are omitted because they cannot be derived directly from existing authorized data: header counts, last-updated information, the pulse visualization, the coverage card, and any other value that cannot be derived from existing reads. No count, timestamp, score or status is invented. The composition is kept visually coherent with the data available. The roadmap panel is retained only when its content comes from an existing authorized team data flow already loaded by the team overview; otherwise the approved empty state is used or the panel is omitted. No data read is moved or duplicated for visual fidelity.
- **D-13 Signed-in home greeting band (2026-11-05 owner decision, TASK-030).** The signed-in home keeps the two supported top-row cards (team card and team pulse). No third card is invented, no read is added and no metric is fabricated. The landscape greeting band art is omitted; no new illustration is added. The greeting stays "Hei, {name}" from the existing own-profile read.
- **D-14 Team overview members panel (2026-11-05 owner decision, TASK-031).** The members panel keeps the collapsed, lazily loaded roster (`docs/features/member-identity-and-team-roles/SPEC.md` BR-31: no roster read on load). The reference's avatar preview is not shown; this is accepted as a privacy-driven visual deviation (classification: data not loaded on page load).

## Problem
`visual-redesign` (BR-1 to BR-38) is implementation-complete, but real Chrome screenshots of the signed-in and signed-out pages show that many compositions still differ substantially from the 14 approved references in `docs/design/references/`. In addition:

- Pages keep the older section-and-form structure: narrow centred columns, long single-column lists and generous empty bands where the reference uses dense grids, split views and panels.
- Icons from the references are missing on several surfaces (sidebar, headings, card headers, actions, tabs, status indicators).
- After sign-in the user lands on `/teams`, not `/`. An authenticated visitor to `/sign-in` is redirected to `/teams`.
- Sign-out appears twice: in the top-bar account menu and in the sidebar Account group.
- On `/me/conversations`, selecting a conversation produces severe overlap between the tabs, heading, text, fields and buttons of the detail pane.
- No signed-in page has been verified in a real browser against its reference, so the earlier "implementation done" status says nothing about the rendered result.

This feature is corrective. It does not change the product model, data, server behaviour, or the approved decisions recorded in `visual-redesign` and `product-experience`.

## User outcome
Each of the 14 reference experiences looks and composes like its reference at phone, tablet and desktop widths, in light and dark theme, at 200 % zoom, using only the data DevPulse already has. Icons appear where the references show them and nowhere else. Sign-in and sign-out behave as a signed-in person expects. The conversation detail is readable and never overlaps.

## Relationship to existing specifications
- **Inherited without change:** `docs/SECURITY.md` invariants 1–72, AE-SI-1 to AE-SI-13, RP-SI-1 to RP-SI-12; the `product-experience` foundation (tokens, typography, breakpoints, containers, theme strategy, illustration rules, motion); the `visual-redesign` BR-1 to BR-38 and its exclusion lists; `visual-redesign` decisions Q-1 (quarter-column roadmap, no Gantt), Q-2 (three illustration assets), decision A (conversation detail tabs), decision B (team overview layout), and the survey completion illustration decision.
- **Partly superseded, recorded here:**
  - `visual-redesign` AD-8 and `product-experience` "Application shell" (dated 2026-11-03) keep Logg ut in the sidebar Account group and in the mobile drawer. BR-17 (D-4) removes that control from both. Min profil and Slett kontoen din stay in the sidebar Account group. The top-bar account menu is the only sign-out control.
  - `PRODUCT.md` ("After a successful sign-in … continues to `/teams`") and `managed-surveys` BR-40 (the `/teams` default) are superseded for the default destination by BR-14 and BR-15. Those documents are updated in the implementing task.
- Where this feature and an approved specification differ, the approved specification wins unless this file explicitly supersedes it, as listed above.
- Account Erasure is not modified (BR-36).

## Scope
- Page-level composition, layout, content width, spacing, typography, card hierarchy and responsive behaviour of the 14 reference experiences (routes in the table under "Per-page acceptance criteria").
- Icons for the sidebar, top bar, page headers, cards, action buttons, tabs and status indicators, using the existing `Icon` wrapper over `lucide-react`.
- Sign-in landing, authenticated `/sign-in` redirect, and the sign-out control location.
- The `/me/conversations` master-detail layout and its no-overlap guarantee.
- Visual verification in a real browser against each reference, at the widths, zoom levels and themes in BR-6 and BR-7, recorded in `docs/features/visual-fidelity-and-ui-fixes/VERIFICATION.md`.
- Keeping the three-asset illustration budget and restoring standard interface icons (D-3).

## Out of scope
- Any change to server code, route handlers, API contracts, DTOs, Firestore rules, environment variables, dependencies (other than the Playwright development dependency approved in D-6), or Firebase Auth configuration.
- Any change to authorization, team isolation, anonymity, aggregation thresholds (k = 5 coverage and per-survey `minimumResponses`), encryption, survey submission payloads, or Account Erasure.
- New routes, new domain functionality, new data, new persistence, new metrics.
- Anything in the reference "Excluded" lists of `visual-redesign` (see Constraints below), including: chat bubbles, message composer, attachments, emoji, read receipts; permission toggles and "Rettigheter" tab; "Nytt team" on the team directory; team-health counters not returned by an existing read; goal progress rings, percentages and "+0,6" deltas; radar chart average scores; bio, contact, location and skill-percentage panels on the profile; Google sign-in, "Husk meg", "Glemt passord?"; pricing, "Produkt", "Priser", "Sikkerhet og personvern" and "Kom i gang gratis" on the public home; calendar and "Kommende aktivitet" items; "Medlemmer", "Tilganger" and "Innstillinger" admin tabs that do not exist.
- A Gantt chart, spanning bars or a Måned/Kvartal/Halvår scale on the roadmap (decided in `visual-redesign` Q-1).
- New illustration assets beyond the three approved ones (D-3).
- Adding a browser-automation or visual-regression dependency other than Playwright (D-6). Playwright is the only exception; it is a development dependency only. Verification uses a real browser, and results are recorded in `VERIFICATION.md` (BR-30, BR-37).

## Key concepts
- **Reference audit.** A recorded comparison of one implemented view with its reference PNG against the criteria in this file. It results in a pass, a deviation with a reason, or an omission.
- **Implementation completion** (`visual-redesign`). Code, tests and repository gates pass. It says nothing about the rendered result.
- **Browser verification.** A rendered page, observed in a real browser at the specified widths, zoom levels and themes, compared with the reference and recorded. It says nothing about code correctness.
- **Master-detail.** A list region and a detail region shown side by side, where the detail follows the list selection. On phones only one region is shown at a time, and the detail has its own route.
- **Overlap.** Two rendered elements whose bounding boxes intersect where neither is an intentional child or overlay of the other (for example, a tooltip over its trigger is not overlap; a tab label drawn over a heading is).
- **Categorical coverage.** The per-need state (`covered`, `gap`, `insufficient_data`, `area_unavailable`) returned by the existing C2 coverage read. It is never a percentage, ratio or count (`SECURITY.md` invariants 32, 34, 35).

## Actors and access
No change. Signed-out visitors, authenticated members, team members, owners of personal data and app admins keep exactly the access they have today. Navigation items remain visible only where the viewer may open the route (`visual-redesign` BR-9). Owner-only and participant-only data stays owner-only and participant-only.

## User stories
1. As a signed-out visitor, I want the home page to look like the approved reference, so that I can understand DevPulse quickly.
2. As a person who has just signed in, I want to land on the home page, so that I can see my work immediately.
3. As a signed-in person who opens the sign-in page by mistake, I want to be taken to the home page, so that I am not asked to sign in again.
4. As a person who wants to sign out, I want one clear sign-out control in the account menu, so that I do not have to look for it in two places.
5. As a person with several development conversations, I want the list and the selected conversation side by side on a desktop, so that I can move between them without losing my place.
6. As a person reading a conversation on a phone, I want the conversation to open on its own page with a way back to the list, so that the text is readable.
7. As a team member, I want team, roadmap, skills, goals and profile pages to use the space the way the reference does, so that they are scannable rather than sparse.
8. As a keyboard or screen-reader user, I want every icon-only control to have a name and every decorative icon to be hidden, so that I hear only meaningful text.
9. As a user who prefers dark mode or a large zoom level, I want every page to remain readable with no overlap and no horizontal page scroll, so that the product works for my settings.

## Behavioural requirements

### Visual composition (all 14 references)
- **BR-1 Reference audit record.** Each of the 14 references is audited against its criteria in "Per-page acceptance criteria" and against the cross-cutting criteria. The result per reference is recorded in `VERIFICATION.md` as one of: *Matches*, *Deviation (reason, classification)*, or *Omitted (reason)*. A deviation that changes a visible structure requires a stated reason from the Excluded list or the Presentational rule. No reference is recorded as *Matches* without browser evidence (BR-30).
- **BR-2 Content width.** On desktop (≥ 1024 px) the page content uses the full available width inside the sidebar layout, bounded by the existing `PageShell` width tokens. Primary content is never a narrow centred column with empty side bands on the references that show a multi-column composition (refs 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13). The survey (ref 14) keeps its single column, centred at about 560 px.
- **BR-3 Split and grid composition.** Where a reference shows a split view, a grid or a multi-panel layout, the implementation uses the same composition at desktop width: refs 03 (status row and panels), 04 (team card grid), 05 (summary row, two-panel middle row, two-panel lower row), 06 (status tiles, board and detail panel), 07 (summary row and three-panel row), 08 (summary strip and two-column list), 09 and 10 (list and detail), 11 (card grid), 12 (role list and detail), 13 (header band and two-column panels). Stacking below the breakpoints in BR-6 is allowed; a single-column list at desktop width is not, except where the reference itself is a single column.
- **BR-4 Spacing.** Gaps between sections and cards use the existing spacing tokens only. The vertical gap between two stacked sections is at most 24 px (`space-6` in the product-experience scale) on desktop. A card with a body shorter than its header is not stretched to fill empty space; cards in one row share the row height, and the content inside a card is top-aligned.
- **BR-5 Card hierarchy.** Each page has one primary panel (the reference's main content panel, for example the team overview summary row, the roadmap board, the conversation detail, the role detail) and secondary panels with less visual weight (smaller titles, no large numerals). Status tiles and summary cards use the same card primitive with the same padding.
- **BR-6 Responsive behaviour.** Verified widths: 320, 360, 768, 1024 and 1280 px, and 200 % zoom at 1280 px. No page has unintended horizontal scroll at any of them. Wide content (the roadmap board, data tables, the trend chart) scrolls inside its own container with a visible scrollbar or an equivalent text alternative (`visual-redesign` BR-28, BR-17).
- **BR-7 Themes.** Every page is verified in light, dark and follow-system (resolved to light and to dark). Surfaces, borders, badges, charts and illustrations use dark tokens. No hard-coded light surface appears in a dark-theme component.
- **BR-8 Consistency.** The same page header (breadcrumb or context line, title, one-sentence purpose, at most one primary action), tab row style, status badge style and section heading style are used on every page. A page does not restyle these locally.
- **BR-9 Typography.** Each page has one `h1` in the page header. Section headings use the `h2` scale; card titles use the card-title scale. Long Norwegian labels wrap and do not truncate essential text or cause overflow at 320 px.
- **BR-10 Illustrations.** Only the three approved illustration assets are used, as `visual-redesign` BR-7 and Q-2 allow (D-3). They may be reused, cropped, scaled and repositioned. The decorative landscape bands shown in the references are reproduced only where an approved asset can be placed and cropped without obscuring content; otherwise the band is omitted and the reason is recorded (BR-1). No additional decorative artwork is introduced.

### Icons
- **BR-11 Icon inventory.** Each reference's icons are inventoried in `VERIFICATION.md` with: location (sidebar, top bar, page header, card header, tab, action, status indicator, list item), reference element, implemented element, and result. Minimum set that must be present where the reference shows it:
  - Sidebar: Hjem, Team, Ferdigheter, Mål, Samtaler, Roller and the admin Team entry; a section icon is not required on the group heading.
  - Top bar: account chevron. The notification bell is not shown: approved decision 1 (2026-11-03/04) removed it because DevPulse has no notification feature. The bell named here is therefore not implemented.
  - Page headers: the reference's section or purpose icon where the page has one (for example the roadmap target icon, the team overview heading icons).
  - Cards: the icon that identifies the card's content (team, pulse, competency, initiatives, goals, conversations, roles, suggestions, team members, calendar).
  - Actions and tabs: the existing "new", "edit", "more", "next", "back", "close" and "calendar" icons next to their labels.
  - Status indicators: an icon plus text, never colour alone. Approved labels (2026-11-04): *Dekket* for `meets`, *Utviklingsmulighet* for `development_opportunity`. *Gap* and *Lavt nivå* are not part of this feature's status set.
- **BR-12 Icon source.** Icons come only from the `Icon` wrapper over `lucide-react` (`product-experience` TASK-004). No emoji. No decorative icon without a function in BR-11. No new icon library or SVG set.
- **BR-13 Icon accessibility.** An icon that duplicates adjacent text is `aria-hidden`. An icon-only control (for example the account chevron button, the notification bell, the "more" menu trigger, the close button, the drawer toggle, a card's arrow link) has an accessible name that matches its visible purpose and the existing copy, and no new copy is invented for it except where a label is missing, in which case the name is added in the component's copy module.

### Authentication
- **BR-14 Sign-in landing (D-1).** After a successful sign-in on `/sign-in`, the app navigates automatically to `/` when there is no valid continuation. The success message is shown only as a fallback while navigation is in progress; its link target is `/`, not `/teams`. The user is never left on a success screen that offers only a link.
- **BR-15 Authenticated visitors (D-2).** A visitor who is already signed in and opens `/sign-in` without a valid continuation is redirected to `/`. A visitor who opens `/sign-in?continue=/survey/{id}` with a valid survey continuation is redirected to that survey. The existing `SignedInRedirect` mechanism is used; the default destination changes from `/teams` to `/`.
- **BR-16 Preservation and safe continuation (D-2).** Firebase Auth behaviour, the sign-in form, error and success copy, and the redirect guard are unchanged except for the default destination. The `continue` value is accepted only if it matches the existing allow-list in `src/features/auth/domain/continuation.ts` (exactly `/survey/{surveyId}`). Any other value, including absolute and protocol-relative URLs, other internal routes, encoded or double-encoded variants, and values with extra path segments, falls back to `/`. No new redirect target, query parameter or open redirect is introduced, and the allow-list is not widened.

### Navigation and sign-out
- **BR-17 Single sign-out control (D-4).** On desktop and on mobile, the sign-out action (`Logg ut`) appears only in the account menu in the top bar. The sidebar Account group keeps `Min profil` and `Slett kontoen din` and no longer shows `Logg ut`. The mobile navigation drawer no longer shows `Logg ut` either.
- **BR-18 Mobile account menu (D-4).** At 320, 360 and 768 px the top-bar account menu is visible, reachable by keyboard and touch, and functional. Its trigger is at least 44 × 44 px, has a visible focus state, and is not covered by the drawer, the top bar or any other element (BR-22 applies). Its menu panel fits inside the viewport at 320 px and does not require horizontal scroll. The `Logg ut` item inside it is at least 44 px tall. Sign-out from this menu works at every width. Because the drawer no longer offers sign-out, the account menu is the only sign-out control on mobile, so this requirement is not optional.
- **BR-19 Sign-out behaviour.** The account-menu sign-out keeps its existing behaviour: the `signOut` call, the pending state (`navCopy.signingOut`), the existing post-sign-out destination and its accessible name. The account menu trigger has an accessible name, `aria-expanded` and `aria-haspopup` state, and is operable with Enter, Space, arrow keys and Escape. The menu closes on Escape and returns focus to its trigger.

### Conversation detail and master-detail
- **BR-20 Master-detail at desktop (amended by D-7).** At ≥ 1280 px `/me/conversations` shows the conversation list and the selected conversation side by side. The list column is 320–400 px wide; the detail column takes the remaining width and is at least 480 px wide. The list scrolls inside its own region; the page does not scroll horizontally.
- **BR-21 Phone and tablet (amended by D-7).** Below 1280 px only one region is shown at a time. On phones (< 768 px) the list is shown on `/me/conversations` and selecting a conversation navigates to `/me/conversations/[conversationId]`, which shows the detail with a visible back link to the list. The detail route is not split into two columns below 1280 px.
- **BR-22 No overlap.** At every width in BR-6 and in both themes, no two of these elements overlap: page header title and description, the conversation title, the status badge, the start date and participant line, the tab row, the tab panel content, form fields, field labels and helper text, buttons, and the list items. Verification is by browser measurement of bounding boxes for each element on `/me/conversations` with a conversation selected, recorded in `VERIFICATION.md`. A fix must address the cause identified in that measurement; hiding a symptom (for example by reducing font size or clipping) does not satisfy this requirement. Sequence is mandatory: (1) reproduce the overlap and record bounding-box measurements of the overlapping elements before any code change, including the element, its CSS box, its container and the viewport; (2) identify the cause from those measurements; (3) fix that cause; (4) re-measure the same elements. If browser access is unavailable, no measurement is claimed, the overlap is recorded as *reported, not measured*, and no fix is claimed as verified.
- **BR-23 Conversation detail structure.** The detail keeps `visual-redesign` BR-21 and decision A: a header (title, status badge, start date, participants), tabs for the existing structured sections (Oversikt, Notater, Oppfølging), a focused content column and an aside only where the model stores next meeting and goals. The tab row follows the `tablist`, `tab` and `tabpanel` semantics and keyboard model already in `visual-redesign` decision A. Every section stays mounted (hidden panels are not unmounted), so an unsaved draft survives a tab switch.
- **BR-24 Conversation data and authorization unchanged.** Structured encrypted conversations, the owner and participant sections, the participant-only visibility rule, the existing save actions and labels, and the API surface are unchanged (`SECURITY.md` invariants 55–72). No chat, message history, composer, attachment, emoji or read receipt is introduced.

### Pages and states
- **BR-25 Sections not overlapping on other pages.** No page-level element overlaps another on any page at any verified width, including the team overview summary row, the roadmap board and detail panel, the admin role list and detail, and the profile header band.
- **BR-26 Section-scoped states.** Loading, error and empty states remain scoped to their section (`visual-redesign` BR-32). A failed section never hides another section.
- **BR-27 Truthful data.** Every value, label and status is returned by an existing read the viewer may already make, or is computed from such values without new meaning (`visual-redesign` BR-26). The reference's sample numbers, names and dates are never reproduced.
- **BR-28 Team overview coverage.** The coverage presentation on the team overview and the home page uses only the categorical per-need states of the existing C2 coverage read where that read is already used by the page. A coverage percentage, ratio, bar length derived from a count, or any number from the coverage read is not shown (`SECURITY.md` invariants 32, 34, 35). Where the page does not already load that read, the section shows its existing state and this feature adds no read.
- **BR-29 Privacy copy.** Class A privacy notices are reproduced verbatim where they appear and keep their existing placement rules (`visual-redesign` BR-27). No notice is shortened, moved into a tooltip only, or hidden behind an icon.

### Verification
- **BR-37 Authenticated browser verification environment (2026-11-04 owner authorization).** The product owner authorized use of their own test account for local browser verification against `http://localhost:3000` only, using real Firebase Authentication with no bypass of authentication or authorization. Rules that apply to every run:
  - Credentials are supplied at run time by the operator, typed or provided through an environment variable that is not written to any file. They are never stored in the repository, in `.env*` files committed or not, in screenshots, reports, logs, fixtures or task files, and never committed in any form.
  - Session tokens, cookies and browser profile or storage state are never written to the repository, to reports or to logs. Any browser profile used is a throwaway directory outside the repository and is deleted at the end of the run.
  - Testing is non-destructive: no create, edit, delete, archive, invitation, erasure, sign-out-everywhere or conversation-state change is performed. Read, navigation, resizing, zoom, theme toggle and interaction with controls that do not persist data are allowed. Form submissions that persist data are not performed; the sign-in form is used only once per run.
  - No production data or production project is accessed or modified. The Firebase environment configured for the local application is the test environment confirmed by the owner (D-5). Isolation is not required and is not a precondition for a run. If the configured environment is identified as production, the run stops and is reported.
  - The test account is the only account used. No real employee wellbeing data is viewed, used or captured; `SECURITY.md` invariant 15 applies to every run.
  - Account Erasure is never triggered (BR-36).
  - Browser tooling: Playwright is the approved browser-automation dependency (D-6), used as a development dependency with its local browser. Claude in Chrome or another already-available browser tool may also be used. No other browser-automation or visual-regression dependency is added.
  - Availability is recorded per run in `VERIFICATION.md`: the tool used, whether it connected, and the exact limitation if it did not. A run that cannot connect records *not verified* and lists the outstanding checks; it never records a pass.
- **BR-30 Browser verification.** Each reference is verified in a real browser, in light and dark, at 320, 360, 768, 1024 and 1280 px and at 200 % zoom at 1280 px, with the browser, viewport sizes, zoom and results recorded in `VERIFICATION.md` with screenshot file paths. Signed-in pages are verified in the owner-confirmed test environment with the owner's test account (D-5, BR-37), which replaces the earlier requirement for an isolated environment (Firebase emulator or isolated project with demo data). Real employee wellbeing data is never used (`SECURITY.md` invariant 15). Where an environment or browser is unavailable, the page is recorded as *not visually verified* and the exact outstanding checks are listed. No screenshot is presented as evidence for a page it was not taken from.
- **BR-31 Keyboard and accessibility.** Every page is checked with the keyboard only (visible focus, logical order, no keyboard trap, drawer and account menu close on Escape), and with an automated accessibility scan where a browser is available. Results are recorded; no WCAG conformance is claimed without evidence (`product-experience` decision 8).
- **BR-32 Implementation vs visual status.** `VERIFICATION.md` records implementation status (code, tests and gates passed) and visual status (browser-verified or not) separately for each reference, as `visual-redesign` BR-34 requires.
- **BR-33 Preservation.** Routes, URLs, accessible names of existing controls, locked copy, authorization checks, server contracts and DTOs are unchanged. Tests that assert obsolete markup (the old sidebar sign-out, the `/teams` default, the old conversation grid) are updated in the task that changes that markup.

### Cross-cutting
- **BR-34 Dark theme and tokens.** No palette value or raw Tailwind colour is added outside the existing allow-list. The token contrast record (`visual-redesign` contrast record) is extended for any new text or UI pair, measured in both themes.
- **BR-35 Motion.** Transitions added by this feature respect `prefers-reduced-motion: reduce` through the existing global rule, and no page requires motion to function.
- **BR-36 Account Erasure unchanged.** No file, route, copy, test or configuration of the Account Erasure feature is modified. The entry on `/me/profile` is rendered as it is today. The held Account Erasure operator gate (identified by its feature description, as in `visual-redesign`) is neither changed nor satisfied. Any change that touches Account Erasure stops and is reported.

## Per-page acceptance criteria

The criteria below apply at the verified widths in BR-6 and in both themes. "Desktop" means ≥ 1024 px; "phone" means 320–360 px.

| Ref | Route | Reference composition the page must reach on desktop |
|---|---|---|
| 01 | `/` signed out | Two-column hero, value strip, trust band |
| 02 | `/sign-in` | Split layout, form card on the right |
| 03 | `/` signed in | Greeting band, status row, panel grid |
| 04 | `/teams` | Team card grid |
| 05 | `/teams/[teamId]` | Header band, summary row, two-panel rows, side aside |
| 06 | `/teams/[teamId]/roadmap` | Header, status tiles, quarter board with detail panel |
| 07 | `/me/skills` | Summary row, three-panel row with level bars |
| 08 | `/me/goals` | Summary strip, status tabs, goal list with side panels |
| 09 | `/me/conversations` | Master-detail (BR-20) |
| 10 | `/me/conversations/[conversationId]` | Header, tabs, content, aside, no overlap (BR-22, BR-23) |
| 11 | `/admin/teams` (and `/admin/teams/[teamId]` in the same family) | Admin scope marker, header, team card grid |
| 12 | `/admin/roles` | Role list left, role detail right |
| 13 | `/me/profile` | Header band, two-column panels |
| 14 | `/survey/[surveyId]` | Single column, centred, bottom action bar on phones |

### 01 Signed-out home
- [ ] At 1280 px the headline and the primary and secondary actions are on the left and the product preview on the right.
- [ ] A value strip of three or four statements, each describing an existing feature, sits below the hero.
- [ ] The trust band shows the locked class A home line verbatim (`product-experience`).
- [ ] No pricing, "gratis", "Produkt", "Priser" or "Sikkerhet og personvern" navigation item is visible.
- [ ] No sample figure (for example "3,9" or "78 %") appears in the preview.

### 02 Sign-in
- [ ] At ≥ 1024 px the page is split: value points on the left, one form card on the right.
- [ ] The form has visible labels; the error is announced and identified by text.
- [ ] No Google button, "Husk meg" or "Glemt passord?" control is visible.
- [ ] A signed-in visitor is redirected to `/`, or to a valid survey continuation (BR-15).

### 03 Signed-in home
- [ ] The greeting band shows the display name and one sentence of context above the status row.
- [ ] The status row has up to four cards in one row at ≥ 1024 px, each mapped to an existing read.
- [ ] The panel grid has goals, next conversation, role and the team development chart, with recommended next steps alongside the chart (BR-3).
- [ ] With no role selected the role panel shows "Ingen rolle valgt" and one action.
- [ ] Insufficient data is shown as a gap or text state, never as zero.
- [ ] No calendar, "pågående tiltak" counter or invented delta appears.

### 04 Team directory
- [ ] Teams are a card grid: one column at 320 px, two columns at 768 px, two or three at 1280 px.
- [ ] Each card has the team's identity art, name, description when present, relationship badge and the existing action.
- [ ] No member count, metric, search, filter or tab control is shown unless an existing read returns it.

### 05 Team overview
- [ ] The header band shows identity art, name and existing summary values. The status badge and description are not shown: the existing read returns only the name (D-8, approved deviation).
- [ ] Tabs point only to existing team routes.
- [ ] At ≥ 1024 px the team development chart sits beside the competency needs panel, challenges sit beside the members panel, and the forum spans the full width below (reference 05, amended by TASK-029 on 2026-11-04; this replaces the earlier wording that placed the chart beside the summary row). The summary row and roadmap next-steps panel sit above the results zone at ≥ 1280 px (TASK-028).
- [ ] Members are initials on neutral tones, not photos.
- [ ] No coverage percentage is shown (BR-28); suppressed values show the insufficient-data state.
- [ ] Reading order at 360 px matches the tested section order (`TeamDetail` test).

### 06 Team roadmap
- [ ] The header, tabs and Tidslinje/Liste switch match the existing behaviour.
- [ ] Status tiles use only the existing derived states.
- [ ] At ≥ 1024 px the quarter board and the detail panel are side by side. The board is a quarter-column board, not a Gantt chart (`visual-redesign` Q-1).
- [ ] Plans without a target date are in "Uten måldato" and not on the axis.
- [ ] The detail panel shows existing fields only; no progress percentage unless the model has one.
- [ ] At 360 px the grouped list replaces the board with no page-level horizontal scroll.

### 07 My skills
- [ ] The summary row shows existing counts only; no average score is shown.
- [ ] Competency areas are shown with level bars, in a panel of the same weight as the reference's radar panel (`visual-redesign` BR-37). No radar chart.
- [x] Each competency row carries its level name as visible text (for example *Grunnleggende*, *Kan med støtte*). The level name is the textual label of the row (owner decision, 2026-11-04). Decorative level bars are never the only representation of the competency information.
- [x] The comparison statuses are shown only in the role comparison panel, with the approved labels (2026-11-04 decision): `meets` → *Dekket*; `development_opportunity` → *Utviklingsmulighet*. These labels are not added to individual competency rows, because the competency rows have no comparison-status data. No new competency statuses, severity thresholds or calculations are introduced.
- [ ] Class A notices appear verbatim before the list.

### 08 My goals
- [ ] The summary strip shows counts only; no progress ring, bar or percentage appears.
- [ ] Status tabs Aktive, Fullførte and Alle show counts and filter the list.
- [ ] Each goal card shows title, status badge, optional linked area, optional target date and the existing completion and edit controls.
- [ ] Side panels show existing linked skill areas only.

### 09 Conversations
- [ ] Master-detail at ≥ 1280 px; list with separate detail route below 1280 px (BR-20, BR-21, D-7).
- [ ] Filter chips show only domain statuses that exist.
- [ ] Each item shows title, counterpart display name, status badge and the existing date line; participants are initials.
- [ ] The "Ny samtale" action uses the existing flow.
- [ ] No overlap (BR-22).

### 10 Conversation detail
- [ ] Header with title, status badge, start date and participants (BR-23).
- [ ] Tabs are the existing structured sections; a hidden tab keeps its unsaved draft.
- [ ] No chat bubble, composer, attachment, emoji, read receipt or message history is visible.
- [ ] Existing save actions and labels are unchanged.
- [ ] No overlap at any verified width (BR-22).

### 11 Admin teams
- [ ] The admin scope marker is visible. Tabs are only the existing admin sections.
- [ ] Team cards show identity art, name, the existing status and existing counts.
- [ ] Pagination or "Viser n av m" appears only if the page paginates.
- [x] No new permission or access-control wording is introduced. Existing factual descriptions of functionality are exempt from this prohibition (owner decision, 2026-11-04). The exempt items are: the access-request section title "Ventende tilgangsforespørsler" and its empty state "Ingen ventende tilgangsforespørsler.", which describe the existing approve/reject access-request workflow; and the survey response-access labels "Alle med lenken", "Kun medlemmer av teamet" and "Hvem kan svare?" with their explanatory hints (including "Alle som har lenken kan svare anonymt…" and "Deltakeren må logge inn…"), which describe the existing survey response modes (owner decision, 2026-11-04, second decision). The exempt text keeps its approved Norwegian product meaning. This exemption covers descriptions only; it does not modify authorization, authentication, survey eligibility, anonymity rules, access-request behaviour or data reads. The prohibition on inventing new authorization controls, permissions or administrative roles remains in force. No survey eligibility, access check, membership rule, read or authorization behaviour is changed by this exemption.

### 12 Admin roles
- [ ] At ≥ 1024 px the role list is on the left and the selected role on the right, with name, description, expectation count and archived state (BR-3).
- [ ] Selected role detail shows the existing expected competency levels and areas (the competency-expectation panel of `visual-redesign` BR-37).
- [ ] No permission toggle, "Rettigheter" tab or role-assignment control is visible.

### 13 My profile
- [ ] Header band with display name (existing editable field), team membership from existing data and the existing "Rediger profil" action.
- [ ] Account Erasure entry is present and unchanged (BR-36).
- [ ] No bio, contact, location, job title, skill-percentage or goal panel is visible.

### 14 Pulse survey (phone)
- [ ] At 320 and 360 px one question is shown with five options, each at least 44 × 44 px.
- [ ] Progress reads "Spørsmål N av 3" with a visible bar; the question count is the real one.
- [ ] Forrige and Neste sit in the bottom bar on phones; Neste is disabled with its text until an answer is selected.
- [ ] The locked survey notice is visible on the intro before the first question.
- [ ] No time estimate or percentage text is shown.
- [ ] The survey route shows no sidebar, team navigation or account menu (`product-experience` BR-S8).

## Edge cases and failure behaviour
- A viewer with no teams sees the home and team directory empty states with one existing action, or a plain explanation where no action exists.
- Sign-in with a `continue` value that fails the allow-list lands on `/` (BR-16).
- A signed-in visitor to `/sign-in?continue=` with a valid survey path is sent to that survey (D-2). With an invalid value, the visitor is sent to `/` (BR-16).
- A conversation list or detail section that fails to load shows an error for that section only (BR-26); an empty list shows the existing empty state.
- A narrow phone at 320 px with a long Norwegian title wraps; the status badge and date wrap below the title rather than overlapping it.
- A conversation selected on desktop that is then deleted or becomes inaccessible: the detail pane shows the existing not-found state, and the list selection is cleared. No overlap occurs in the not-found state.
- The mobile drawer open at 320 px: its content does not overlap the top bar, it does not contain `Logg ut`, and it closes on Escape.
- Reduced motion: no transition, drawer or tab animation is needed for the page to function.

## Security and privacy
Feature-specific implications of `docs/SECURITY.md`. The policy itself is not repeated here.

- No new endpoint, read, write, persistence, client storage, logging, external request or DTO field. A change that adds any of these stops the feature and is reported.
- The conversation detail keeps its encryption, owner and participant rules, and the conversation response and error shapes (`SECURITY.md` invariants 55–72). The layout change must not render any field the participant or owner is not already authorized to see.
- The sign-in change alters only the post-sign-in destination. Firebase Auth, token handling and the continuation allow-list are unchanged (BR-16). No open redirect is introduced.
- Sign-out keeps its existing server-side and client-side behaviour. Removing the sidebar control does not remove the only way to sign out (BR-17, BR-18).
- Coverage and team results: categorical or thresholded values only; no percentage or count is derived from them (BR-28; `SECURITY.md` invariants 10, 11, 32, 34, 35).
- Profile, goals and conversations: owner-only or participant-only; no new cross-person display (BR-24, BR-27).
- Error and status text shown to users does not expose technical internals (`product-experience` BR-11).
- No real employee data is used in screenshots or fixtures. Verification uses demo data in an isolated environment (BR-30).

No additional requirements beyond the above.

## Architecture decisions
- **AD-1 Presentation and routing-entry changes only.** Changes are confined to `app/` route pages (composition), `src/components/` primitives and layout (`nav`, `ui`, `layout`), `src/features/<feature>/components/` presentation, `src/features/auth/domain/continuation.ts` (default destination only) and token files. Server code, route handlers, domain modules, DTOs and Firestore rules are not changed.
- **AD-2 Layout by CSS grid, DOM order kept.** Multi-panel layouts use CSS grid areas; reading order is the existing DOM order (`visual-redesign` AD-2).
- **AD-3 Primitives first.** Pages compose the existing primitives. A new primitive is added only where at least two pages repeat the pattern and only under `src/components/ui/` or `src/components/layout/`. Candidate patterns that already repeat: master-detail split container, summary strip and status tile row, panel with header icon. **Reconciled (D-9, 2026-11-04):** the candidate `MasterDetail` and `SummaryStrip` primitives were not used by two or more production pages and were removed together with their unit tests. The conversation split is implemented in its feature component (`ConversationsPage.tsx`), and summary strips remain feature components (`TeamSummaryStrip`, `ResultsSummaryStrip`). No new shared primitive was added under `src/components/ui/` by this feature. Status tiles and panels reuse existing `Card`, `SummaryPanel` and `StatTile` primitives.
- **AD-4 Icons.** Icons use the `Icon` wrapper over `lucide-react` (`product-experience` TASK-004). Icon-to-element mapping is recorded in `VERIFICATION.md` (BR-11).
- **AD-5 Master-detail breakpoint (amended by D-7).** The split is applied at `xl` (1280 px) for `/me/conversations`. Below this breakpoint the split is not used (D-7); 1024 px cannot hold a 320–400 px list and a 480 px detail beside the 248 px sidebar. The phone route split at `md` (768 px) is kept for the route that follows the list selection.
- **AD-6 Sign-in default.** `DEFAULT_SIGN_IN_PATH` becomes `/`. The survey continuation pattern and its `isSurveyContinuation` behaviour stay (D-2). The success state navigates automatically to the resolved destination (D-1).
- **AD-7 Sidebar, drawer and account menu.** The sidebar Account group and the mobile drawer lose `Logg ut`. The `NavSignOut` action is provided to the top-bar account menu only, on desktop and mobile (D-4). `NavGroupList` no longer renders a sign-out item for the account group.

## Test boundaries
| Boundary | Covers |
|---|---|
| Sign-in and continuation unit tests (`src/features/auth/domain/continuation.test.ts`) | BR-14, BR-15, BR-16 (default `/`, allow-list unchanged, invalid `continue` falls back to `/`) |
| Sign-in form and `SignedInRedirect` component tests (Vitest, Testing Library, Firebase client mocked) | BR-14 (success navigates to `/` or offers `/`), BR-15 |
| `AppShell`, `NavGroupList`, `AccountMenu`, `MobileDrawer` component tests | BR-17 (no `Logg ut` in sidebar or drawer), BR-18 (account menu present and sized at mobile widths), BR-19 (account-menu keyboard and Escape behaviour), BR-13 (accessible names of icon-only controls) |
| Icon guard and `Icon` tests | BR-11, BR-12, BR-13 (decorative `aria-hidden`, no emoji in UI copy) |
| Route-level tests for the 14 references with mocked reads (existing `app/**/page.test.tsx` and `*.structure.test.tsx`) | Composition presence (BR-3, BR-5, BR-8), states (BR-26), absence of excluded elements (BR-27), privacy copy (BR-29), coverage absence of percentages (BR-28) |
| `/me/conversations` component tests (`ConversationsPage`, `ConversationDetail`) | Master-detail structure and route behaviour (BR-20, BR-21), tab semantics and draft retention (BR-23), no chat controls (BR-24) |
| Existing development-conversations, goals, skills, roadmap, teams, admin, profile, survey and role-profile suites | Preservation (BR-16, BR-24, BR-33) |
| Static guards: raw palette allow-list, reduced-motion rule, token contrast record | BR-34, BR-35 |
| Browser verification in a real browser against each reference (manual, recorded in `VERIFICATION.md`) | BR-1, BR-2, BR-4 to BR-7, BR-9, BR-10, BR-22, BR-25, BR-30, BR-31 |
| Browser measurement of bounding boxes on `/me/conversations` with a conversation selected, at the widths in BR-6 and both themes | BR-20, BR-21, BR-22 |

Jsdom does not measure layout. Overlap, column widths, horizontal scroll and visual likeness are therefore verified only in a browser. Browser verification may use Playwright (D-6) for measurement and screenshots; no automated layout test is claimed as passing unless it has been run. No other browser-automation dependency is added.

## Acceptance criteria

### Implementation (repository-verifiable)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass with the change set, and the results are recorded in `VERIFICATION.md`.
- [ ] No palette value, raw Tailwind colour, emoji in UI copy or whole-library icon import is added outside the allow-listed token file (BR-12, BR-34).
- [ ] `DEFAULT_SIGN_IN_PATH` resolves to `/`; the allow-list tests for `/survey/{surveyId}` pass unchanged (BR-14 to BR-16).
- [ ] The sidebar Account group and the mobile drawer render no `Logg ut` control; the account menu renders one (BR-17).
- [ ] The account menu trigger and its `Logg ut` item meet the 44 px target size and have accessible names (BR-18, BR-13).
- [ ] The `/me/conversations` master-detail composition has route and component tests for desktop and phone structure (BR-20, BR-21).
- [ ] No server, route handler, DTO, Firestore rule, environment variable, dependency other than the Playwright development dependency (D-6) or Account Erasure file is changed (BR-36).
- [ ] Every existing test that asserted the old `/teams` default, the sidebar sign-out or the old conversation grid is updated in the same task that changes that behaviour, and no test is deleted to pass (BR-33).
- [ ] The reference icon inventory (BR-11) and the reference audit record (BR-1) exist in `VERIFICATION.md`.

### Browser verification (manual, recorded; BR-30 to BR-32)
- [ ] Each of the 14 references is compared with its reference PNG at 320, 360, 768, 1024 and 1280 px and at 200 % zoom at 1280 px, in light and dark.
- [ ] `/me/conversations` with a conversation selected: bounding-box measurement shows no overlap between any pair listed in BR-22, at 320, 360, 768, 1024 and 1280 px, and in both themes.
- [ ] Sign-in with valid credentials navigates to `/` without a further click; `/sign-in` opened while signed in lands on `/`; `/sign-in?continue=/survey/{id}` lands on that survey; `/sign-in?continue=` with an invalid value (for example an absolute URL) lands on `/`.
- [ ] Sign-out from the account menu works by mouse and keyboard at 320, 768 and 1280 px; no sidebar or drawer sign-out control is visible.
- [ ] The account menu at 320 px: trigger and menu fully visible, measured at 44 px or more, not covered by any other element.
- [ ] Keyboard-only pass on each page; a screen-reader spot check on the conversation detail tabs, the sign-out menu and the roadmap board.
- [ ] No page has unintended horizontal scroll at the verified widths.
- [ ] Any page not verified is recorded as *not visually verified* with the exact outstanding checks.

## Open questions
None. The four planning questions were decided on 2026-11-04 (see "Approval decisions" under Status). The browser-measurement dependency for the conversation-detail overlap (BR-22) is an execution prerequisite, not an open product decision: if browser access is unavailable at implementation time, that work is recorded as *reported, not measured*.

## Next workflow command
`/split-tasks visual-fidelity-and-ui-fixes`, producing `docs/features/visual-fidelity-and-ui-fixes/TASKS.md`, then `/implement-feature visual-fidelity-and-ui-fixes`. The tasks must reference the `visual-redesign` tasks they supersede and must not duplicate the open browser gates of `visual-redesign` (TASK-072 to TASK-074 of `product-experience`) or the Account Erasure operator gate.
