# DevPulse Visual Redesign

## Status
Approved (2026-11-03) with decisions Q-1 and Q-2 applied, the visual-fidelity clarification, the team-overview section-order decision, and the exclusion defaults below. No Open questions remain. Task splitting is complete: `TASKS.md` has 20 Ready tasks covering BR-1 to BR-38. No product code has changed for this feature yet.

### Approval decisions (2026-11-03)
- **Q-1 (roadmap timeline):** Option A. Quarter columns with plan cards positioned by target quarter. No Gantt chart, no spanning bars. The Phase B spanning-bar presentation is replaced. Composition, density and visual quality must still match reference 06 as closely as possible, using existing dates, statuses and plan details.
- **Q-2 (illustrations):** The three previously approved unique illustration assets are kept. They may be reused across screens with different positioning, cropping, scale and background treatment. No additional unique illustration asset is created without approval.
- **Visual fidelity clarification:** An excluded element must not make a page fall back to plain forms, lists or generic cards. Each excluded chart, metric or unsupported interaction gets a visually appropriate alternative built from existing supported data (BR-37).
- **Team overview section order:** The section-order test is kept as a reading-order requirement (WCAG 1.3.2 meaningful sequence). The dashboard composition is achieved with CSS layout. The DOM order is not changed.
- **Survey completion illustration, decision A (2026-11-03, user decision).** BR-25 is clarified to allow the approved `CompletionIllustration` on the survey completion screen, as an exception to the intro-only placement stated in the TASK-017 outcome. The approved illustration guard (`illustrations.usage.test.ts`) is unchanged. No fourth illustration is introduced, and survey behaviour, anonymity, question wording, submission and mobile sticky navigation are unchanged.
- **Team overview layout, decision B (2026-11-03, user decision; supersedes the layout half of the section-order decision above, not its reading-order requirement):** The "Teamaktivitet" zone and the results zone may be split across grid cells so the summary and the team development chart sit side by side, and competency needs and challenges sit side by side, on large screens. The BR-15 zone-grouping test is kept; its membership assertions still hold because each section remains inside its zone. The reading order (DOM order) is unchanged. Members stay in the activity zone, placed full width below the needs and challenges row, so the list is read after them. Real data sources, empty and insufficient-data states, privacy thresholds and permission checks are unchanged. Recorded in `TASKS.md` TASK-008.
- **Conversation detail sections, decision A (2026-11-03, user decision; presentation only).** The conversation detail (`10-conversation-detail.png`) presents its existing structured sections as tabs. The tabs are Oversikt (title, planned-for date, lifecycle actions), Notater (owner notes and participant notes) and Oppfølging (next steps). The participant view uses the same grouping, with the shared goals in Oppfølging and the leave action in Oversikt. Every section stays mounted; inactive panels are hidden with CSS, so an unsaved draft survives a tab switch and no workflow state resets. The tab row has tablist, tab (aria-selected, aria-controls) and tabpanel (aria-labelledby) semantics, with arrow, Home and End keys. The header and the aside composition are unchanged. No data model, encryption, authorization, persistence or workflow semantics change, and no chat-style control is introduced (BR-21). Recorded in `TASKS.md` TASK-013.
- **Account Erasure operator gate:** Not modified. Identified by its feature description only: "Account Erasure deployment, held behind an operator gate (`docs/features/product-experience/SPEC.md`, Account Erasure section)". The identifier TASK-045 is not used for it.
- **Navigation grouping (2026-11-03, decision on TASK-001):** BR-9 governs the visual organization of navigation: the Workspace and Account headings, and the Administrasjon items Team and Roller. Existing authorization, route access and fail-closed signed-out and loading behaviour take precedence over this visual requirement. Roller links only to `/admin/roles`, shown only to viewers the shell already shows the admin group to. No new route, permission or authorization logic. The product-experience BR-1 nav item set is superseded for presentation only; see the dated note in `docs/features/product-experience/SPEC.md` "Application shell".
- **Duplicate React key:** In scope. Investigated statically and with tests where possible. Not claimed resolved without evidence. Browser reproduction, if required, is recorded as a remaining verification item (BR-15).

## Problem
The visual direction is approved (`docs/design/DESIGN-README.md`, `docs/design/DESIGN-SYSTEM.md`, 14 references in `docs/design/references/`). The implementation is only partly redesigned:

- Tokens, typography, icons, the sidebar, the mobile drawer, the public header and the card primitives have been changed. Most page compositions have not. Team, roadmap, skills, goals, conversations, admin, profile and the survey still follow the old section-and-form structure in several places.
- The earlier passes record that signed-in pages were never rendered, so their result is unverified.
- Several reference images show elements the product does not support (chat, permission toggles, goal percentages, profile contact fields, Google sign-in). These must not be reproduced.

## User outcome
Each of the 14 experiences in the reference set looks and composes like its reference, using only data DevPulse already has. A first-time user can see where they are, what matters and what to do next. A returning user sees the same structure on every page. Every page works in light and dark theme, at phone and desktop widths, and by keyboard, with no change to privacy, authorization or domain behaviour.

## Relationship to existing specifications
- `docs/features/product-experience/SPEC.md` and `TASKS.md` own the foundation (tokens, primitives, shell, containers), the survey behaviour, the privacy copy, the open browser gates TASK-072, TASK-073 and TASK-074, and the Account Erasure operator gate. The Account Erasure operator gate is identified by its feature description, not by a task ID. This feature does not modify it. This feature does not replace or duplicate any of these. It defines the page-level composition and the acceptance standard for each reference.
- `docs/features/ui-refresh/` (Done) activated the Geist Sans typeface and the `PageShell` width tokens. This feature reuses both and does not reopen them.
- `docs/features/team-roadmap/SPEC.md` and `docs/PRODUCT.md` define the roadmap domain. Q-1 concerns a conflict with them.
- Where this specification and an approved feature specification differ, the approved feature specification wins. The difference is recorded as an Open question, not resolved here.
- Source-of-truth order from `DESIGN-README.md` §2 applies: security, privacy and authorization first, then approved specifications, then API contracts, then the design documents, then the images.

## Scope
- Page composition, layout, hierarchy, component usage, responsive behaviour, dark-theme behaviour, empty/loading/error presentation, and interaction clarity for the 14 reference experiences.
- The shared visual system those pages use: shell, page header, section, cards, status badges, tabs, buttons, empty states, chart containers, illustrations and icons. Only primitives the existing code already has, or that a task introduces under product-experience's rules, are used.
- Visual verification in a real browser against each reference, recorded as evidence (BR-35).
- Preservation of all existing behaviour, copy that is locked by a test or a specification, accessible names, and routes.

Reference-to-route mapping (from `IMPLEMENTATION-PLAN.md` §1; file names are the normalized names in `docs/design/references/`):

| Ref | File | Route(s) |
|---|---|---|
| 01 | `01-public-home.png` | `/` signed out |
| 02 | `02-sign-in.png` | `/sign-in` |
| 03 | `03-app-home.png` | `/` signed in |
| 04 | `04-teams.png` | `/teams` |
| 05 | `05-team-overview.png` | `/teams/[teamId]` |
| 06 | `06-team-roadmap.png` | `/teams/[teamId]/roadmap` |
| 07 | `07-my-skills.png` | `/me/skills` |
| 08 | `08-my-goals.png` | `/me/goals` |
| 09 | `09-conversations.png` | `/me/conversations` |
| 10 | `10-conversation-detail.png` | `/me/conversations/[conversationId]` |
| 11 | `11-admin-teams.png` | `/admin/teams` (and `/admin/teams/[teamId]` as the same visual family) |
| 12 | `12-admin-roles.png` | `/admin/roles` |
| 13 | `13-my-profile.png` | `/me/profile` |
| 14 | `14-mobile-survey.png` | `/survey/[surveyId]` |

Note: `DESIGN-README.md` §3 lists `01-landing.png`, while the file present is `01-public-home.png`. The files present are authoritative.

## Out of scope
- Any change to authentication, authorization, team isolation, anonymity, aggregation thresholds (k = 5 coverage and per-survey `minimumResponses`), encryption, Firestore rules, DTO content, the survey submission payload, public-survey access, or Account Erasure. Account Erasure deployment remains HELD (operator gate, see "Relationship to existing specifications").
- New domain functionality, new data, new metrics, new persistence, new routes, new API fields, new environment variables, new dependencies. Any of these needs its own approved specification.
- The reference elements listed in "Reference element classification" as **Excluded**.
- Real-time chat, message history, attachments, read receipts, notifications, employee scoring, rankings, XP, streaks, gamified progress, competitive comparison, and individual comparison charts.
- Permission or access-control toggles in role profiles.
- A `Min utvikling` overview route (product-experience decision 6).
- Google or other OAuth sign-in, password reset, "remember me" (current sign-in is Firebase email and password only; `ARCHITECTURE.md` "Authentication and authorization").

## Key concepts
- **Reference element classification.** Every visible element in a reference is classed as one of:
  - **Supported** — backed by data or a route the product already has. Implemented with real data.
  - **Presentational** — decorative or structural (landscape band, icon, layout). Implemented only within the illustration and icon rules.
  - **Excluded** — requires unsupported data, a new feature, or a privacy-sensitive path. Not implemented. The reference's visual intent may be met with a truthful alternative.
- **Implementation completion.** Code, tests, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass for the page's tasks. Says nothing about the rendered result.
- **Browser-based visual verification.** The page is rendered in a real browser, compared with its reference, at the widths and themes in BR-28 and BR-30, and the results are recorded. Says nothing about code correctness.
- **Insufficient data.** The state shown when a value is suppressed by a threshold or is not yet available. It is never shown as zero or as a blank chart.

## Actors and access
No change. Each page keeps the viewers it has today: signed-out visitors, authenticated members, team members, owners of personal data, and app admins. Navigation items are shown only where the viewer may already open the route (BR-9). Owner-only data (goals, self-assessments, conversations) stays owner-only or participant-only in every new composition (BR-27).

## User stories
1. As a signed-out visitor, I want to understand what DevPulse is and how it protects privacy, so that I can decide whether to sign in or create an account.
2. As a signed-in member, I want a home page that shows my teams, goals and next conversation, so that I can continue my work quickly.
3. As a team member, I want the team overview to show the team's current state in a clear order, so that I can decide what to discuss.
4. As a team member, I want to see the team's plans on a timeline grouped by quarter, so that I know what is planned and what is in progress.
5. As a person developing my skills, I want my self-assessment and role comparison presented as a clear workspace, so that I know what to work on next.
6. As a person with goals, I want active and completed goals separated and easy to update, so that I can follow up without pressure.
7. As a person in development conversations, I want the list and the selected conversation side by side, so that I can move between conversations without losing context.
8. As an app admin, I want team and role administration to be dense and scannable, so that routine maintenance is quick.
9. As a survey participant on a phone, I want one question per screen with clear progress, so that I can finish the survey comfortably.
10. As a user who prefers dark mode or reduced motion, I want every page to remain readable and usable, so that the product works for my settings.

## Behavioural requirements

### Foundation
- **BR-1** Every authenticated page uses the same application shell: the dark sidebar on desktop, the mobile drawer below the breakpoint defined in `product-experience` "Breakpoints and containers", a top bar with the notification and account controls, and a page header.
- **BR-2** Light is the default theme. Dark and Follow-system apply only when chosen. Both are fully designed, not inverted (`DESIGN-SYSTEM.md` §5.4). Theme behaviour is that defined in `product-experience` "Theme strategy".
- **BR-3** Colours come only from semantic tokens. No page or feature component contains a palette value. The token guard in `product-experience` TASK-002 continues to pass without new allow-list entries.
- **BR-4** Typography uses the scale in `product-experience` "Typography" on the Geist Sans face activated by `ui-refresh`. No second typeface and no second type scale.
- **BR-5** Pages compose the shared primitives: page header (context, title, one-sentence purpose, at most one primary action), section (heading, optional description, content), card, status badge, tabs, button hierarchy, empty state, loading state, error state, chart frame, form fields and dialog. A page does not restyle these locally.
- **BR-6** Icons come from the `Icon` wrapper over `lucide-react` only (`product-experience` TASK-004). Icons are decorative beside text and `aria-hidden` when they duplicate it.
- **BR-7** Landscape illustrations are original SVG or CSS. Exactly three unique illustration assets exist (approved, `product-experience` decision 9). They may be reused across screens with different positioning, cropping, scale and background treatment. No additional unique illustration asset is created without approval. They are decorative, `aria-hidden`, never obscure content, and are not cropped from the reference images.
- **BR-8** Motion uses the durations in `product-experience` "Motion strategy". Every transition is disabled or reduced under `prefers-reduced-motion: reduce`, and the page remains fully usable.
- **BR-9** Navigation groups are Workspace (Hjem, Team), Min utvikling (Ferdigheter, Mål, Samtaler), Administrasjon (Team, Roller) and Account (Min profil, Logg ut). Only destinations the viewer may open are shown. Account actions stay reachable from the top bar account menu as shown in the references. The current route is marked with `aria-current="page"` and a non-colour indicator.

### Public and authentication
- **BR-10** Signed-out home (ref 01) shows: a two-column hero with headline, one-sentence value statement, primary action "Opprett konto", secondary action "Logg inn", and a supporting product preview built from original SVG/CSS, with no invented figures; a value strip with three to four short statements that describe existing features; and a trust band that contains the locked class A home line from `product-experience` verbatim. Shortened privacy claims from the reference ("Svar uten navn eller e-postadresse" alone) are not used. Reference items "Produkt", "Priser", "Sikkerhet og personvern", "Kom i gang gratis", "Se hvordan det fungerer", "Skaper engasjement" and "Enkel å bruke" are **Excluded** (pages, pricing or outcome claims that do not exist).
- **BR-11** Sign-in (ref 02) uses a split layout on desktop: on the left a headline and up to three value points with existing copy; on the right a single card with the existing email and password form, visible labels, the existing error and success states, and the existing "Opprett konto" link. The redirect gate and the safe `continue` allow-list in `product-experience` are unchanged. **Excluded:** "Logg inn med Google", "Husk meg", "Glemt passord?", and the eye toggle if no equivalent exists.

### Authenticated home
- **BR-12** Signed-in home (ref 03) at `/` shows, in this order: a greeting band with the viewer's display name and one sentence of context, then a row of up to four status cards, then the panels below. Panels are **Supported** only if they use existing reads the viewer may already make:
  - Team entry card (the viewer's team, linked to its overview).
  - Goals panel (owner-only goal read; titles, status and target dates only).
  - Next conversation (owner-only conversation read).
  - Role panel (the viewer's selected role, or "Ingen rolle valgt" with an action).
  - Team development chart, using the existing team results read for teams the viewer belongs to. It uses the same thresholds and suppression as the team overview. Its range control is shown only if the existing results read supports that range.
  - Recommended next steps, as links to existing pages only.
  **Excluded:** "4 pågående tiltak", "2 nærmer seg ferdig", "Kommende aktivitet" and calendar events, activity counters, "+0,6" style deltas not returned by an existing read, and any percentage that is not returned by an existing read.

### Team directory
- **BR-13** Team directory (ref 04) at `/teams` shows a responsive card grid (one column on phones, two or three on wider screens). Each card has the team's original identity art derived from its id (`TeamIdentity`), its name, its description when present, its relationship badge, and the existing action (open team or request access). The list endpoint returns name and relationship only; cards show no metrics, member counts or activity until an existing read returns them. **Excluded:** "Nytt team" on this page, the "Mine team / Alle team" tabs, the search field, status and sort filters, and the team-health numbers in the reference, unless a separate approved specification adds them (`DESIGN-README.md` §9.4).

### Team
- **BR-14** Team overview (ref 05) at `/teams/[teamId]` shows: a header band with team identity art, name, activity status badge (only if the team already has a status), description, and any existing summary values; a tab row whose items are the existing team routes only; a summary row of existing values (pulse, competency coverage, ongoing initiatives); and sections for competency needs and coverage, team development chart, challenges, roadmap next steps, upcoming items already in the product, and team members. Reading order (DOM order) matches the section order the `TeamDetail` test asserts (`Kompetansebehov og dekning` after `Kompetanseområder` and before the roster). That test is kept: it protects a reading-order requirement (WCAG 1.3.2 meaningful sequence). The reference's grid placement is achieved with CSS grid areas, not by reordering the DOM. Members appear as initials on neutral tones, not photos. Coverage states use the existing labels. Calendar items and any value not returned by an existing read are **Excluded**. Suppressed or insufficient values use the insufficient-data state (BR-9 in `product-experience` chart rules) and are never zero.
- **BR-15** The React warning `Encountered two children with the same key, "2"` does not occur on `/teams/[teamId]`. The duplicate-key source is identified from the component stack in a real render before any fix. The fix changes identity at the source, and a regression test fails before and passes after the fix. A `key` workaround that does not address the source does not satisfy this requirement. The root cause is currently unknown (`product-experience` plan §10.3). Investigation (2026-11-03, TASK-007): the source is the three sibling children of `TeamaktivitetZone` in `TeamDetail.tsx` that shared `key={generation}`; they are array items at runtime and collided. The keys are now distinct (`planning:`, `needs:`, `roster:` prefixes). The record is in `VERIFICATION.md`. The array-based keys in `TrendChart`, `ResultsSummaryStrip`, `TrendTable`, `TeamRosterSection` and `TeamSkillSection` are checked against the data they are built from. Where no collision can be proven statically, the team-overview tests render duplicate-prone data and assert that no duplicate-key error is logged. Browser reproduction with a seeded team is a remaining verification item in `VERIFICATION.md`. The item is not claimed resolved until evidence exists.
- **BR-16** Team roadmap (ref 06) at `/teams/[teamId]/roadmap` shows: the same team header and tabs as BR-14; a page header with "Kompetanseroadmap", its purpose sentence, and the existing Tidslinje/Liste view switch (`?view=timeline`, `view=list`); a row of status tiles built from the roadmap's existing derived states (planned, active, completed, overdue as defined by the roadmap copy, archived shown only through the existing "Vis arkiverte" control); the quarter-column timeline; and a detail panel for the selected plan. The timeline is a quarter-column board: one column per calendar quarter, each plan a card in the column of its `targetDate` quarter. No Gantt chart and no bars spanning start and target dates. Plans without a `targetDate` are listed in an "Uten måldato" group, not placed on the axis. Each column header shows the quarter label and month range; the current quarter is marked "I dag". Each card shows title, status badge, and competency area, plus priority or owner where the existing plan model has them. Quarter navigation and a Måned/Kvartal/Halvår scale are **Excluded** unless the existing view already supports them. The detail panel shows only existing fields: title, status, period (existing dates), owner, competency area, and existing next steps. It shows no progress percentage unless a checklist value exists in the model. **Excluded:** the "Fokus fremover" banner unless it is an existing field, drag-and-drop, dependencies and history.
- **BR-17** Below the `md` breakpoint the timeline is replaced by the grouped plan list, which carries the same text and status as the timeline. Quarter columns never require horizontal page scrolling; if the timeline needs internal scroll, that scroll is contained in the timeline region.

### Personal development
- **BR-18** My skills (ref 07) at `/me/skills` shows: a page header with title, purpose and the existing self-assessment entry; a summary row of existing counts ("Vurderte ferdigheter n av m", "Utviklingsområder" count) with no averages or scores that the page does not already show; a competency area list with the viewer's own levels as level bars, each row with a text status label; a role comparison panel that uses only active role profiles, with states for no role selected, no roles available, role selected, and role archived or unavailable; and up to three next-step links to existing pages. Class A privacy notices are shown verbatim in a compact structure placed before the list. **Excluded:** the radar chart in the reference (presentational alternative: the level bars), average scores such as "3,6 / 4,0", the "Fortsett utviklingen din" banner, and role recommendations beyond existing links. Self-assessments remain person-owned (BR-27).
- **BR-19** My goals (ref 08) at `/me/goals` shows: a page header with title, purpose and the existing "Nytt mål" primary action; a summary strip of existing counts (active, completed) with no progress ring; status tabs Aktive, Fullførte and Alle with counts; goal cards with title, optional linked skill area, optional target date, status badge (Aktivt or Fullført), the existing completion control, and the existing edit control. The editor opens as the existing disclosure or dialog. **Excluded:** progress bars and percentages (goals have no progress value, `PRODUCT.md` "Mål"), "Utviklingsfokus" and "Inspirasjon" panels unless they show existing linked skill areas, streaks, XP, and any "+0,6" style figure. Goal visibility stays owner-only (BR-27).
- **BR-20** Conversations overview (ref 09) at `/me/conversations` shows, on desktop, a list on the left and the selected conversation on the right; on phones, the list only, with the detail on its own route. The list shows a search field only if the existing list supports search; filter chips reflect the domain statuses that exist (open and completed, plus the existing "created by me / participating" distinction). Each item shows title, counterpart's display name, status badge and the existing last-activity or date. The counterpart is shown with initials, not photos. The "Ny samtale" primary action is the existing creation flow. The existing privacy copy remains visible where the reference shows the purpose line.
- **BR-21** Conversation detail (ref 10) at `/me/conversations/[conversationId]` shows: a header with title, status badge, start date and participants; tabs whose items are the existing structured sections (for example notes, goals and follow-up as defined in `development-conversations`); a focused content column; and an aside with next meeting and related goals only where the existing model stores them. **Excluded, and not to be introduced:** chat bubbles, a message composer, attachments, emoji, read receipts, message history and any real-time messaging (`DESIGN-README.md` §9.10). The reference's chat layout is visual inspiration only. Existing save actions and their labels are unchanged.
- **BR-22** My profile (ref 13) at `/me/profile` shows: a header band with the display name (the existing editable field), team membership from existing data, and the existing account actions, including the Account Erasure entry with its existing safeguards. The primary action "Rediger profil" opens the existing display-name form. **Excluded:** bio ("Om meg"), contact details, location, job title, skill-percentage panels, and goal and skill summaries on the profile. Those are not approved fields (`DESIGN-README.md` §9.13). Skill and goal detail remains on their own pages.

### Administration
- **BR-23** Admin teams (ref 11) at `/admin/teams` shows: the admin scope marker (BR-14 of `product-experience`); a page header with the existing "Opprett team" action; tabs whose items are the existing admin sections only; a team card grid (or the existing list) with identity art, name, the existing status badge, and existing counts only; and the existing pagination or "Viser n av m" line only if the page already paginates. Grid/list toggle, search and status filters are added only if they already exist. **Excluded:** "Medlemmer", "Tilganger" and "Innstillinger" tabs that do not exist, invented team status values ("Pauset") unless the product has them, and invented counts.
- **BR-24** Admin roles (ref 12) at `/admin/roles` shows a split view on desktop: the role profile list on the left (name, description, expectation count, archived state) and the selected role on the right (name, description, expected competency levels and areas, archived state, and the existing edit and archive actions). On phones the detail opens as the existing route or view. Role profiles are competency expectations, not authorization. **Excluded and not to be introduced:** permission toggles, "Rettigheter" tab, role-to-member assignment, and any access-control wording (`DESIGN-SYSTEM.md` §18).

### Survey
- **BR-25** Pulse survey (ref 14) at `/survey/[surveyId]` keeps the layout and behaviour of `product-experience` BR-S1 to BR-S9 and presents them as in the reference: a single column at every width, centred at about 560 px on desktop; a header with the survey title, team name and the existing progress text "Spørsmål N av 3" with a visible bar; one question per screen with five labelled answer options, each at least 44 × 44 px; the selected state uses border, text weight and a tint; Forrige and Neste in a bottom action bar on phones and under the card on desktop; Neste disabled with the text "Velg et svar for å fortsette" until the question is answered. The intro shows the locked survey notice and the collapsed "Mer om personvernet" disclosure. The completion state uses the existing copy. **Excluded:** time estimates ("ca. 3 minutter"), percentage text, a question count other than the real count, a phone frame in the application, and any answer persistence (`product-experience` interruption decision). The survey route has no team navigation, sidebar or account menu (BR-S8). Illustration (decision A, 2026-11-03): the survey introduction may show the approved survey illustration, and the already approved `CompletionIllustration` (one of the three approved assets, `product-experience` illustration strategy) may appear on the survey completion screen. No fourth illustration is introduced.

### Cross-cutting
- **BR-26** Every value, label, status and count on a page is either returned by an existing read the viewer may already make, or is computed from such values without new meaning. The reference's sample numbers, names and dates are not reproduced.
- **BR-27** No new personal-data path. Owner-only and participant-only data stays where it is. Class A privacy statements are reproduced verbatim where they appear. No new storage is used for answers, drafts, filters or preferences except the theme preference already defined in `product-experience`.
- **BR-28** Responsive layouts are verified at 320, 360, 768 and 1280 px and at 200 % zoom. No page has unintended horizontal scroll. Charts and wide tables scroll inside their own container or switch to a stacked text alternative carrying the same information.
- **BR-29** Accessibility: one `h1` per page, logical heading order, visible focus, keyboard operation for every control, accessible names that match the existing ones, status conveyed by text and icon as well as colour, text alternatives for every chart, contrast measured from the implemented tokens for every text and UI pair in both themes. Status messages that appear after an action are announced politely. No WCAG conformance is claimed without evidence (`product-experience` decision 8).
- **BR-30** Dark theme: every page composition in BR-10 to BR-25 works in dark. Surfaces, borders, charts, badges and illustrations use dark tokens. No hard-coded light surface appears in a dark-theme component.
- **BR-31** Preservation: existing routes, URLs, accessible names, copy locked by a test or specification, authorization checks, server contracts and DTOs are unchanged. Tests that assert obsolete markup may be updated in the task that changes that markup, following the `product-experience` convention.
- **BR-32** Loading, error and empty states are scoped to each section. A failure in one section never hides another. A failure is never shown as an empty state. Empty states follow `product-experience` BR-10 (what the feature is, why to use it, what to do next, with locked copy where a test requires it).
- **BR-33** Every page has one primary action in its header at most. Secondary actions are ghost or outline. Destructive actions are labelled as such and keep their existing confirmation.

### Completion and verification
- **BR-34** Implementation completion for a page is recorded separately from its visual verification. Implementation completion means code, tests and the repository gates have passed for that page's tasks. A page may be implementation-complete and still not visually verified. Neither status is recorded as the other.
- **BR-35** Visual verification is recorded per reference in `docs/features/visual-redesign/VERIFICATION.md`, with: the browser used, the viewport widths and zoom, light and dark results, keyboard and screen-reader spot checks, the automated accessibility scan, comparison notes against the reference, and screenshot file paths. Signed-in pages require an authenticated session in an isolated environment. Where that environment is not available, the page is recorded as "not visually verified". No screenshot is presented as evidence for a page it was not taken from.
- **BR-36** Intentional deviations from a reference are recorded per reference in the same file, with the classification (Supported, Presentational or Excluded) and the reason.
- **BR-37 Visual alternatives for excluded elements.** An excluded chart, metric or interaction is replaced by a visually appropriate alternative built from existing supported data. The page keeps the reference's hierarchy, density, composition and card-and-panel structure. A page must not fall back to plain forms, lists or generic cards because an element is excluded. Examples of required alternatives:
  - Radar chart (ref 07) → competency level bars grouped by area, with the same visual weight as the radar panel.
  - Goal progress ring and bars (ref 08) → a status summary panel (active, completed) with a status-coloured stat tile and the goal cards' status badges.
  - Chat thread (ref 10) → a structured notes and follow-up composition using the existing sections, with the same tabbed header, split layout and summary panels.
  - Permission toggles (ref 12) → a competency-expectation panel (expected levels and areas per role) with the same detail-panel composition.
  - Profile bio, contact and skill panels (ref 13) → the header band, team membership and existing settings composition, plus the existing skill-area and goal summary only on their own pages.
  - Calendar and activity counters (ref 03, 05) → the existing next-conversation and roadmap next-steps panels.
  Alternatives never invent a value, a status, a count or a capability. An alternative that cannot be built from existing data is omitted, and the omission is recorded in `VERIFICATION.md` (BR-36).
- **BR-38 Account Erasure gate unchanged.** No file, route, copy, test or configuration of the Account Erasure feature is modified by this feature. The held deployment gate is not changed, satisfied or re-identified by ID. Any change that touches Account Erasure stops and is reported.

## Edge cases and failure behaviour
- A viewer with no teams sees the team directory and home empty states with one next action that exists (for example "Be om tilgang" only where request-access exists; otherwise a plain explanation).
- A team with no results, or with results below threshold, shows the insufficient-data state in the summary, chart and needs sections (BR-14). No zero is shown.
- A role profile that is archived or no longer returned shows the archived/unavailable state in the skills comparison (BR-18). No expectation is invented.
- A goal or conversation list that fails to load shows an error for that section only (BR-32).
- A user who has chosen Follow-system with no OS preference sees light.
- Long Norwegian labels (for example "Kompetanseområder", "Utviklingsundersøkelse") wrap, never truncate essential privacy text, and do not cause horizontal overflow at 320 px.
- Reduced motion: no chart, tab or drawer animation is required for the page to function.

## Security and privacy
Feature-specific implications of `docs/SECURITY.md`. The policy itself is not repeated here.

- No additional authentication, authorization, persistence or encryption requirements. This feature adds no read, write or endpoint.
- Survey: the locked notice, the disclosure, the answer payload, the no-persistence behaviour and the minimal-chrome rule are unchanged. The visual change must not imply that answers are saved between visits (BR-25).
- Results and charts: aggregates only where the existing threshold rules return them. Suppressed values stay suppressed (BR-14, BR-12). No individual response is shown.
- Skills, goals and conversations: owner-only or participant-only. New compositions must not show another person's data or a summary of it (BR-18, BR-19, BR-21).
- Profile and team members: no photos, contact details or identity fields beyond existing ones. Initials are derived from the existing display name and are not a new data field.
- Admin: role profiles are not access control. No permission toggles, role assignment or access-related copy is added (BR-24).
- Account Erasure: the existing entry, its confirmation and its safeguards are unchanged. Deployment remains HELD.
- No new client-side storage for filters, drafts or answers. The theme preference is the only one, as already defined.
- Logging and error reporting are unchanged. Error text shown to users does not expose technical internals (`product-experience` BR-11 and `DESIGN-SYSTEM.md` §11.10).

## Architecture decisions
- **AD-1 Visual layer only.** Changes are confined to `app/` route pages (presentation composition), `src/components/` primitives and layout, `src/features/<feature>/components/` presentation, and token and theme files. Server code, route handlers, domain modules and DTOs are not changed unless a task says so and a security review approves it.
- **AD-2 Composition by layout, not by DOM reordering.** Where a reference shows a grid that differs from the reading order, the grid is built with CSS layout and the DOM order is kept (BR-14).
- **AD-3 Primitives first.** A page composes existing primitives. A new primitive is added only when at least two pages repeat the same pattern, and only in `src/components/ui/` or `src/components/layout/`.
- **AD-4 Illustrations are originals.** The three approved landscape assets are original SVG or CSS shapes, reused with varied placement, cropping, scale and background. No reference crop, third-party artwork, new image dependency or additional unique asset is used.
- **AD-5 Timeline form.** Decided (Q-1, option A): quarter-column board, plan cards by target quarter, no spanning bars. The Phase B `RoadmapGantt` spanning-bar layer and its Gantt legend are removed.
- **AD-6 Chart form.** Existing `ChartFrame` and Recharts usage. No radar chart. Level bars are the default for competency levels (BR-18).
- **AD-7 Theme.** Existing `lys`, `mork` and `folg` contract (`product-experience` "Theme strategy"). No new theme.
- **AD-8 Top-bar account menu.** The references place the account menu at the top right, and the design system places Account in the sidebar. Both must be reachable. The top-bar menu is the composition used in the references. Account items remain in the sidebar's Account group as well. This is a recorded default, not an open question.

## Test boundaries
| Boundary | Covers |
|---|---|
| Presentational component tests (Vitest, Testing Library) for shell, page header, section, cards, badges, tabs, empty/loading/error states, chart frame | BR-1, BR-5, BR-6, BR-29, BR-32, BR-33 |
| Route-level tests for each of the 14 pages with mocked reads, covering composition, states and the absence of excluded elements | BR-10 to BR-25, BR-26, BR-32 |
| Static guards: raw palette allow-list, icon import guard, reduced-motion rule, contrast record | BR-3, BR-4, BR-6, BR-8, BR-29 |
| Duplicate-key regression on the team overview render | BR-15 |
| Existing feature suites for skills, goals, conversations, roadmap, teams, survey, role profiles, profiles, admin | BR-27, BR-31 (preservation) |
| Visual verification in a real browser at the widths and themes in BR-28 and BR-30 | BR-28, BR-30, BR-34, BR-35 |
| Keyboard and screen-reader spot checks, automated accessibility scan | BR-29 |

## Acceptance criteria

### Implementation acceptance (repository-verifiable)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass with the change set, and the results are recorded.
- [ ] No palette value, raw Tailwind colour or whole-library icon import is added outside the allow-listed token file.
- [ ] The duplicate-key investigation is recorded in `VERIFICATION.md` with the static findings and test evidence. The fix, if a source is found, is covered by a regression test that fails before the fix. The issue is not reported as resolved without evidence; any browser reproduction still required is listed as a remaining item.
- [ ] Each excluded element in BR-37 has a visible alternative on its page, or an omission recorded in `VERIFICATION.md`.
- [ ] No file of the Account Erasure feature is modified (BR-38).
- [ ] The team-overview section-order test is kept and passes.
- [ ] Every route in the reference table renders its composition in automated tests with mocked reads.
- [ ] No test or component in the change set introduces a control, copy or field named in the "Excluded" lists.
- [ ] Existing privacy copy, class A copy and locked survey text are unchanged (verified by the existing tests).
- [ ] No server, route handler, DTO, Firestore rule, environment variable or Account Erasure file is changed.

### Visual acceptance — browser-verified (BR-34, BR-35)

**01 Signed-out home**
- [ ] At 1280 px the hero shows the headline on the left, the primary and secondary actions, and a product preview on the right, with no invented figures.
- [ ] The trust band shows the locked class A line verbatim.
- [ ] No pricing, "gratis", or unsupported navigation item is visible.

**02 Sign-in**
- [ ] At 1280 px the page is a split layout with value points on the left and one form card on the right.
- [ ] No Google button, "Husk meg" or "Glemt passord?" link is visible.
- [ ] The form has visible labels, and an error is announced and identified by text.

**03 Signed-in home**
- [ ] The greeting band shows the display name and sits above the status cards.
- [ ] Every card and panel maps to an existing read. No "pågående tiltak", calendar or invented delta is visible.
- [ ] With no role selected, the role panel shows "Ingen rolle valgt" and one action.
- [ ] The team development chart shows insufficient data as a gap or a text state, never as zero.

**04 Team directory**
- [ ] Teams display as a card grid, one column at 320 px and two or more at 1280 px.
- [ ] No member count, metric or search/filter control appears unless it is returned by an existing read.

**05 Team overview**
- [ ] The header shows the team identity art, name and existing status badge. Tabs point only to existing team routes.
- [ ] The summary row and sections follow the reference's grid at 1280 px, and the reading order at 360 px matches the tested section order.
- [ ] Members appear as initials, with no photos.
- [ ] A suppressed value shows the insufficient-data state.

**06 Team roadmap**
- [ ] The header, tabs and view switch match BR-16, and the status tiles use only existing derived states.
- [ ] The timeline is a quarter-column board with plan cards placed by target quarter. No bar spans two quarters, and no Gantt legend is shown.
- [ ] Plans without a target date appear in the "Uten måldato" group, not on the axis.
- [ ] The detail panel shows existing fields only. No progress percentage is shown unless the model has one.
- [ ] At 360 px the grouped list replaces the timeline with no page-level horizontal scroll.

**07 My skills**
- [ ] The summary row shows existing counts only. No average score is shown.
- [ ] Competency rows show level bars with text status labels. No radar chart is shown.
- [ ] The role panel shows each state in BR-18: no role selected, no roles available, role selected, role archived or unavailable.
- [ ] Class A notices appear verbatim before the list.

**08 My goals**
- [ ] The summary strip shows counts only. No progress ring, bar or percentage is shown on any goal.
- [ ] Status tabs Aktive, Fullførte and Alle show counts and filter the list.
- [ ] Each goal card shows title, status badge, optional target date and the existing completion and edit controls.

**09 Conversations**
- [ ] At 1280 px a list is shown beside the selected conversation. At 360 px only the list is shown.
- [ ] Filter chips show only domain statuses that exist.
- [ ] Participants appear as initials. No photos or chat preview appears in the list.

**10 Conversation detail**
- [ ] The header shows title, status badge, start date and participants. Tabs are the existing structured sections.
- [ ] No chat bubble, composer, attachment, emoji or read receipt is visible.
- [ ] The existing save actions and labels are unchanged.

**11 Admin teams**
- [ ] The admin scope marker is visible. Tabs are existing admin sections only.
- [ ] Team cards show identity art, name, the existing status and existing counts. Pagination appears only if the page paginates.
- [ ] No permission or access-control wording appears.

**12 Admin roles**
- [ ] At 1280 px the role list is on the left and the selected role is on the right, with name, description, expectation count and archived state.
- [ ] No permission toggle or "Rettigheter" tab is visible.

**13 My profile**
- [ ] The header shows display name, team membership and the existing edit action. The Account Erasure entry is present and unchanged.
- [ ] No bio, contact, location, job title, skill-percentage or goal panel is visible.

**14 Pulse survey (phone)**
- [ ] At 360 px one question is shown with five options, each at least 44 × 44 px.
- [ ] Progress reads "Spørsmål N av 3" with a visible bar and the number of questions is the real one.
- [ ] Forrige and Neste sit in the bottom bar. Neste is disabled with its text until an answer is selected.
- [ ] The locked notice is visible on the intro before the first question.
- [ ] No time estimate or percentage text is shown.

### Cross-cutting visual acceptance (browser-verified)
- [ ] Every page in the table is checked at 320, 360, 768 and 1280 px and at 200 % zoom with no unintended horizontal page scroll.
- [ ] Every page is checked in light and dark theme with no hard-coded light surface.
- [ ] Every page is checked with keyboard only: visible focus, logical order, no keyboard trap, drawer closes on Escape.
- [ ] Reduced motion is respected on a page with a transition.
- [ ] An automated accessibility scan is run on each page and its result recorded. A screen-reader spot check is recorded for the survey, drawer, roadmap and a chart.
- [ ] `VERIFICATION.md` records each page's implementation status and visual status separately, with screenshots and deviations (BR-35, BR-36).

## Open questions

None. Q-1 and Q-2 were resolved on 2026-11-03 (see Status).

<!-- Resolved questions retained for the record. -->

**Q-1 Roadmap timeline form — RESOLVED: option A.**
The reference shows bars spanning start and target dates, with a Gantt-style legend. The approved specifications say otherwise: `docs/features/team-roadmap/SPEC.md` ("target-quarter timeline … is not a Gantt chart") and `docs/PRODUCT.md` ("no board or Gantt view"). The Phase B implementation in the working tree draws spanning bars and a Gantt legend, which conflicts with those specifications.
- **Option A (recommended, no spec change):** quarter columns; each plan is a card in its target-quarter column; no spanning bars. The reference's quarter header, status tiles and detail panel are kept. The Phase B spanning-bar layer is removed.
- **Option B:** approve a bounded start-to-target span view and amend `team-roadmap` and `PRODUCT.md` to allow it.

**Q-2 Illustration budget — RESOLVED: keep three approved assets, reuse them with varied treatment.**
`product-experience` decision 9 limits illustrations to three, within the approved grammar. The references show landscape bands on about ten screens (sidebar foot, page header bands, empty states, stat strips).
- **Option A (recommended):** keep three approved assets: the sidebar foot band, the sign-in/public hero art, and one survey/empty-state illustration. Other reference bands are omitted and the pages use the approved surfaces instead.
- **Option B:** approve a larger budget (for example page-header bands on pages 03, 05, 08 and 13) and amend `product-experience` decision 9.

## Next workflow command
`/split-tasks visual-redesign`, producing `docs/features/visual-redesign/TASKS.md`, then `/implement-feature visual-redesign`. Tasks must reference `product-experience` tasks for foundation work and must not duplicate the open browser gates (TASK-072 to TASK-074) or the Account Erasure operator gate.
