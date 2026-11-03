# DevPulse Product Experience

## Status
Approved (revision 3, 2026-11-02): implementation-ready for task splitting. Every owner decision is resolved (see "Owner decisions"). Task splitting has not been run. `TASKS.md` does not exist yet. No dependency is installed and no product code has changed.

## Problem
DevPulse has substantial functionality (Phases 0–9 and the Team & Personal Development initiative), but the interface still reads as an internal prototype. Verified in the application: a black or near-black canvas with large empty areas; text-first primary workflows; many similar outlined rectangles; development progress shown as forms, lists or prose; a survey that is not mobile-first; no icon system; weak action hierarchy; dense privacy explanations in the primary path; charts that are functional but not productized; and a top-only header that cannot scale with the product's breadth.

## User outcome
A user can open DevPulse and quickly tell where they are, what matters, what changed, and what they can do next. The product reads as a focused workspace for team and individual development rather than an HR administration system, and every authorization, anonymity, aggregation, encryption and Account Erasure boundary stays exactly as it is.

## Design identity
DevPulse should feel **clear, professional, simple, necessary, rewarding, calm and trustworthy.** Three core concepts govern decisions:

- **CLARITY** — the user knows the location, the state and the next action without reading everything.
- **PROGRESS** — development and movement are the primary story; administration is secondary.
- **REFLECTION** — conversation, self-assessment and team learning get room and calm; the product never judges.

Governing test: *a focused workspace for team and individual development, not an HR administration system.* Every navigation grouping, page composition, chart, sentence and interaction is checked against it.

## Scope
- Presentation, interaction, navigation, page composition, content design, responsive behaviour, accessibility, and the shared visual system (tokens, typography, spacing, radii, borders, elevation, focus, icons, motion, breakpoints, containers, shell, headers, sections, actions, forms, status, chart palette, light and dark behaviour) across the 19 existing page routes and their feature components.
- Re-presentation of data the server already returns to the same caller. No new server field unless a later, separately specified task says so.

## Out of scope
- Any change to authentication, authorization, anonymity, aggregation, the fixed k=5 coverage threshold, the per-survey `minimumResponses` threshold, encryption, Firestore rules, DTO content, the survey submission payload, public-survey access, or Account Erasure behaviour.
- Survey answer persistence across reload or navigation (see "Survey experience" → interruption decision).
- A `Min utvikling` overview route.
- Any item in "Future product ideas".
- Drag-and-drop, Kanban, Gantt, roadmap history, dependencies, ranking, scores, leaderboards, XP, streak pressure, public comparison, performance badges.
- TASK-045 (operator gate). This initiative does not satisfy it, does not change it, and does not deploy anything. **Account Erasure deployment remains HELD.**

## Visual reference analysis

### Supplied references and their status
- **Leapsome screenshots (11, `C:\Users\joela\Desktop\Leapsome\`, 2026-10-29).** Analysed. Inspiration only; no asset, icon, illustration or layout is copied.
- **Current DevPulse screenshots (10, `C:\Users\joela\Pictures\Screenshots\`, 2026-11-02 21:03–21:27).** Analysed. They show the current build in development mode; the "2 Issues" overlay is a development-only indicator, not product UI.
- **Excluded:** five unlabelled captures in `C:\Users\joela\Downloads\` (2026-10-29, 18:58–18:59) are a third-party habit-tracking app, and four further captures in the same folder are not part of the brief.

### Leapsome: principles extracted (not copied)
- **Persistent navigation** in a dark sidebar, with the active section expanding to show its sub-pages. Adopted: one-level expansion of the current group.
- **Page containers**: a white content panel on a grey canvas, title row, tabs directly under the title, and a toolbar (search, filter chips, view switch, one primary button at the top right).
- **Summary strips** above tables, one number per concept with a delta.
- **Status chips with text** (Open, Active, On track), never colour alone.
- **Progress bars** inside cards. Adopted as visual progress only where the model supports it (see "Progress and gamification").
- **Survey analytics**: categories as rows, teams as columns, with an explicit "n" per column.
- **Contextual secondary panel** that opens beside content. Adopted for conversation context and roadmap plan details.

### Leapsome: what not to copy
- **Heatmap cells for groups of n = 2 or 4.** Violates DevPulse's k=5 rule and invariant 10–11. Rule: no group-level cell below threshold, and no "n" shown where it helps identify individuals.
- **Individual performance views**: the Talent Density dashboard, the 9-box calibration grid with named avatars, per-person review scores and key-role risk. Prohibited for DevPulse.
- **Benchmarking and "Ask AI"** on every surface.
- **Excessive navigation depth**: about twelve top-level items plus nested sub-items. DevPulse needs five groups at most.
- **Dense HR administration tables** (payroll and insurance columns, employee IDs).
- **Floating "Book a demo" button and onboarding overlay tours.**
- **Excess KPI tiles** per screen, and **avatars on every person row** (DevPulse must not expose individual identity in team surfaces).

### Current DevPulse: problems confirmed in the captures
- **Large black empty areas.** Home and team list are single-column text on near-black with no visual anchor.
- **Weak hierarchy and nested rectangles.** Team names are underlined links inside outlined boxes; `Teamaktivitet` contains `Utfordringer`, a bordered card inside a bordered card. The personal skills page nests a bordered panel inside a bordered panel.
- **Text-first results.** The three headline values (4.0, 4.2, 4.3) are the most useful information and the least emphasised.
- **Progress as forms and text.** The competency progress path is good (numbered steps, text state, `aria-current`), but the plan line, owner and status are dense text, and "Sett stadium" with "Lagre" sits beside it as a form.
- **Weak action hierarchy.** "Vis arkiverte", "Planlegg", "Lagre", "Send inn" and "Bidra til teamets kompetanseoversikt" look alike.
- **No iconography** anywhere.
- **Dense privacy text in the primary path.** The personal skills page places a three-paragraph privacy and role explanation above the skill list; the coverage section places a five-point participation notice above its single action. Consent content must stay visible before the decision, but it can be structured (see "Privacy copy").
- **Forms before lists.** The conversation creation form is the first element of `/me/conversations`.
- **Functional charts.** Bare axes, default legend, no latest-value emphasis.
- **Mixed purposes on one page.** The team page sequences results (analysis), current survey (action), competency and roadmap (planning), and challenges and forum (participation) in one column.

## Experience principles
1. **Progress over administration.**
2. **Data answers questions.** Team: how are we doing, what changed, what needs attention, what are we developing, what have we planned, where are the competency needs. Personal: where am I, what am I developing, what am I aiming for, what next, what have I discussed or committed to.
3. **Progressive disclosure without hiding consent.** Summary first, detail on demand, and anything that informs a consent decision visible before the decision.
4. **Privacy stays visible where it matters**, concisely, once per decision point.
5. **Calm hierarchy**: whitespace, typography, grouping, one accent; fewer borders and cards; one primary action per region.
6. **Desktop-first analysis, responsive everywhere.**
7. **Survey participation is mobile-first.**
8. **Progress visualization, not employee gamification.**

## Actors and access
Unchanged. Signed-out visitor; signed-in member; team lead (membership role, managing needs and roster where already allowed); app admin; survey participant (public-link or authenticated team member, as configured per survey). Every navigation entry, control and section derives from server-supplied capability (`isAdmin`, `canEdit`, `canReportProgress`, and similar). Hiding a control is never authorization.

## User stories
1. As a signed-in member, I want my team, my development and what needs attention on arrival, so that I know what to do next.
2. As a team member, I want the team overview to summarise state and change, so that I understand the team without reading every section.
3. As a survey respondent on a phone in a meeting, I want one question at a time with large answer controls and visible progress, so that I can answer quickly.
4. As a person developing a skill, I want my progression and target-role opportunities shown visually, so that I know what I am working toward.
5. As an admin, I want dense, scannable admin surfaces clearly marked as admin scope.
6. As any user, I want privacy decisions explained concisely with optional detail, so that I can give informed consent without a privacy wall.

## Behavioural requirements
Verified at UI boundaries (see "Test boundaries").

- **BR-1** One shell for authenticated pages, with navigation whose items are exactly those the existing contracts expose (`product-ux-shell` BR-4 to BR-7 and BR-46; `team-roadmap`; `development-conversations`). No new destination for any role.
- **BR-2** Active navigation is `aria-current="page"` on the exact path and visually distinct, not colour alone.
- **BR-3** Pages follow the composition in "Page composition". Long explanations are collapsed unless consent requires them visible.
- **BR-4** All colours come from semantic tokens defined once for light and dark. No component contains a palette value. Each text and UI pair meets WCAG 2.2 AA for its use, measured from the implemented token file.
- **BR-5** Every status, validation error, privacy state and chart series is distinguishable without colour.
- **BR-6** Every control keeps its accessible name, label, disabled/pending semantics and keyboard behaviour. Visual change must not rename or remove an accessible name that a test or spec requires.
- **BR-7** Icons come from `lucide-react` only, are `aria-hidden` when they duplicate text, and never stand alone as the label of a non-conventional action.
- **BR-8** Survey participation shows **one question or task per screen at every width.** Desktop uses the same flow in a centred column of about 560 px. Payload, anonymity behaviour and the signed-in/anonymous distinction are unchanged.
- **BR-9** Charts render only server-returned values, never turn a suppressed or insufficient value into zero or blank, and always have a text or table equivalent.
- **BR-10** Empty states answer what the feature is, why to use it and what to do next, using locked copy where a test or spec requires it.
- **BR-11** Loading and error states stay scoped per section. A failure is never an empty state, and one failure never hides another section.
- **BR-12** No horizontal page scroll at 360 px. Wide tables scroll in their own container or switch to a stacked alternative carrying the same text.
- **BR-13** Motion communicates state only, uses the durations in "Motion strategy", and is disabled under `prefers-reduced-motion: reduce`.
- **BR-14** Admin surfaces use the same tokens, primitives and typography as member surfaces, may be denser, and are labelled as admin scope.
- **BR-15** **Light is the default theme.** Dark applies only when the user selects it. "Følg enhet" follows the operating-system preference only when the user has explicitly selected it (see "Theme strategy").

## Edge cases and failure behaviour
- A theme change must not make a suppressed or insufficient state look like a valid value.
- Navigation renders the signed-out set before the first auth emission (fail closed), as `SiteHeader` does today.
- Focus returns sensibly after dialogs, drawers and confirmations close.
- The survey keeps answers across Back and Next within the page session only, as today. Reload or navigation discards them, and the survey tells the user so (see "Survey experience").
- Locked copy is not replaced by a shorter or friendlier phrasing unless its class allows it (see "Privacy copy").

## Survey experience

### Current behaviour (verified in code, 2026-11-02)
- **Route.** `/survey/[surveyId]` renders `SurveyParticipationView`. It fetches the outcome through `fetchSurveyParticipation`, with the caller's ID token if signed in, otherwise without one. Outcomes: `answerable` (form), `scheduled`, `closed`, `forbidden`, `not_found`, `sign_in_required`, `read_failed`. Only `answerable` renders the form.
- **Answer state.** `SurveyResponseForm` keeps answers in React `useState` (`{flow, stress, fun}`, each `number | null`). **No answer is written to `localStorage`, `sessionStorage`, IndexedDB, a cookie or the server before submission.** A grep of production code under `src/` and `app/` (excluding tests) found no storage API.
- **Questions.** Three fixed questions, each a `fieldset` and `legend` with five native radio inputs labelled `1`…`5`. Fifteen radio controls and one submit control in total.
- **Completeness.** Submit is disabled until all three are answered. This is a UX convenience only; the server validates.
- **Submission.** `submitSurveyResponse(surveyId, [flow, stress, fun], idToken?)`. The token is sent only for authenticated surveys. `ok` shows a success alert and replaces the form. `already_submitted` shows an info alert. Any other failure shows an error alert and **keeps the answers in memory** so the user can retry on the same page.
- **Pending.** Button disabled, `aria-busy`, pending label.
- **Reload and navigation.** Discard all answers, including partial ones. For authenticated surveys, `sign_in_required` links to `/sign-in?continue=/survey/{id}`, and answers are lost on that round trip too. A reload after a successful submission shows the server's `already_submitted` outcome.
- **Privacy notice.** None on the survey page before this revision (resolved below).
- **Participation DTO.** `fetchSurveyParticipation` returns the survey's `title` and never `accessMode`, `createdBy`, `archivedAt` or `minimumResponses`. **The survey page therefore cannot know the access mode or the per-survey threshold, and its notice must be true for both modes and must not name a number.**

### Privacy model the notice must describe (verified against the implementation and approved specs)
- **Responses.** A `SurveyResponse` never contains `uid`, `email`, `displayName`, IP, user agent or session identifier, in either access mode (managed-surveys BR-17, BR-24). Answers are encrypted server-side (BR-24).
- **Authenticated surveys.** The server accepts a response only from a verified identity with actual membership of the team, re-checked at commit time, and writes a `SurveyParticipation {uid, surveyId}` record in the same transaction (BR-21). That record exists only to block a second response from the same person (BR-22). It is never returned to any client, and no app path joins it to a specific response (managed-surveys "Authentication vs anonymity distinction").
- **Public surveys.** No identity is checked or stored, and **no duplicate detection is performed.** The same visitor may submit more than once (BR-23; "Abuse/duplicate-response threat model", non-blocking).
- **Results.** A closed survey's aggregate is published only when its response count reaches that survey's own `minimumResponses` (an integer 3–20, default 5, immutable after creation; BR-26). Below that, no count or aggregate of any kind is shown, to anyone including admins. Scheduled and open surveys never show aggregates (BR-27). Members and admins see means per dimension and the response count, never individual answers.
- **Threshold wording.** The threshold itself may be named (managed-surveys "Per-survey result threshold"), but the survey page cannot read it (see the DTO note above). The survey notice therefore names no number. The results pages keep their existing "Resultatet vises når minst N personer har svart." wording.

### Locked privacy notice for the survey page (approved 2026-11-02, class A)
Visible on the intro screen, before the first question. Mode-neutral and true for both modes:

> **Svaret ditt lagres uten navn eller e-postadresse.** Teamet ser bare samlede resultater, og først når undersøkelsen er avsluttet og nok personer har svart.

A collapsed, keyboard-operable disclosure **"Mer om personvernet"** contains, in this order:

1. DevPulse viser aldri enkeltsvar, og viser ikke hvem som har svart.
2. Undersøkelser for teamet krever innlogging og medlemskap. Da kan du bare svare én gang.
3. Undersøkelser som er åpne for alle med lenken, krever ikke innlogging. Da kan DevPulse ikke hindre at samme person svarer flere ganger, og svarene kan ikke knyttes til en person i DevPulse.
4. Resultatene vises først når undersøkelsen er avsluttet og minst det angitte antallet personer har svart. Før det vises ingen tall.
5. Svar som ikke er sendt inn, lagres ikke. Har du ikke sendt inn, må du åpne siden på nytt og svare igjen.

Claims are limited to what the implementation provides. The notice does not say "anonym" for an authenticated survey, does not promise that operators or the database cannot see data, and does not claim one-response-per-person for public surveys.

### Locked home-page privacy line (approved 2026-11-02, class A)
Replaces "Individuelle svar er anonyme. Bare teamets samlede trender vises, aldri individuelle poeng.":

> Svarene lagres uten navn eller e-postadresse. Individuelle svar vises aldri. Teamet ser bare samlede resultater, og først når nok personer har svart.

Verification: no identity field in responses (BR-17); no screen or endpoint returns an individual response (managed-surveys BR-25, BR-27; team results DTO); aggregates only when the threshold is met (BR-26). The word "anonym" is removed because the product has two access modes and an authenticated, non-anonymous forum; a bare "anonym" claim would be broader than the implementation.

The admin create-form hint "Alle som har lenken kan svare anonymt uten å logge inn." is accurate for public surveys and is unchanged.

### Interruption and recovery (decided 2026-11-02)
- **No new answer persistence in Product Experience.** Answers stay in the page session, as today.
- Reload and navigation recovery (for example a session-scoped draft, or a server draft) introduces data-lifecycle and privacy questions and is **a separate future feature**, not part of this initiative.
- The notice above tells users that unsent answers are not saved, so the behaviour is disclosed and not hidden.

### Target behaviour (presentation only)
- **BR-S1** Intro screen: survey title (or the existing fallback), team name, the locked notice (BR-S1a), and a "Start" action.
- **BR-S1a** The "Mer om personvernet" disclosure is collapsed by default. The locked notice line stays visible on the intro screen.
- **BR-S2** Progress reads "Spørsmål N av 3" with a visible bar that also has text.
- **BR-S3** Answers persist across Back and Next within the page session only, in memory. Back never clears an answer.
- **BR-S4** One question per screen: question text; five answer controls, each at least 44×44 px on mobile, labelled by its number (the existing scale; no descriptors added, because that would change the scale's wording); a visible selected state using border and text; a keyboard-operable radio group.
- **BR-S5** Back and Next in a bottom action bar on mobile and under the card on desktop. Next is disabled until the current question is answered, and the disabled state carries text ("Velg et svar for å fortsette").
- **BR-S6** Review screen lists the three answers as text, with the submit action. The payload is identical to today's.
- **BR-S7** Completion: the existing success copy in a calm completion state. No additional data is collected.
- **BR-S8** Minimal chrome: no team navigation, sidebar or account menu. The route uses its own layout group.
- **BR-S9** Reload or navigation starts the survey again, as today, and the notice says so.

## Application shell

### Structure (conceptual; no route changes)
- **Overview:** `Hjem` (`/`) and `Team` (`/teams`).
- **Team** (contextual): the current team's `Oversikt` and `Roadmap` (`/teams/[teamId]`, `/teams/[teamId]/roadmap`), with the team name visible. Forum and challenges remain sections of Oversikt.
- **Personal development** (group heading only, no new route): `Ferdigheter` (`/me/skills`, with the role section), `Mål` (`/me/goals`), `Samtaler` (`/me/conversations`). The heading is the visual name for the existing `Min utvikling` entry.
- **Administration** (only for `isAdmin`, visibly labelled "Administrasjon"): `Team` (`/admin/teams`, page title "Admin: Team"), `Kompetanseområder` (`/admin/skills`), `Roller` (`/admin/roles`).
- **User** (sidebar footer): `Min profil` (`/me/profile`), `Slett kontoen din` (`/me/erasure`, the existing label in `account-erasure/copy.ts`), `Logg ut`.

### Geometry (contract)
- Desktop (≥ 768 px, `md`): persistent sidebar 248 px wide, full height, on the light canvas with a quiet surface. Content to its right.
- Desktop content: main column max 1200 px; reading column max 680 px; centred survey column 560 px.
- Mobile (< 768 px): 56 px top bar with product name, current page title and a "Meny" button. The page title stays visible.
- Desktop page header row: 64 px, page context only. Sign-out and the user entry move to the sidebar footer.
- Signed-out pages: simple top bar (product name, Logg inn, Opprett konto), no sidebar. The survey uses the minimal group (BR-S8).

### Mobile navigation drawer (decided 2026-11-02)
- **Trigger.** A button labelled "Meny" with an icon, `aria-expanded`, and `aria-controls` pointing at the drawer.
- **Drawer.** `role="dialog"`, `aria-modal="true"`, named "Meny". It contains the same grouped destinations as the sidebar, inside a `<nav aria-label="Hovednavigasjon">`.
- **Open.** Focus moves to the link marked `aria-current` if one exists, otherwise to the first link. The application root is made `inert` and `aria-hidden`, so background content cannot be reached by keyboard, pointer or assistive technology. Page scroll is locked. A focus trap keeps Tab and Shift+Tab inside the drawer.
- **Close paths (exactly these four):** the navigation (choosing a destination), an explicit "Lukk meny" button with an X icon, the Escape key, and click or tap on the scrim outside the drawer. The scrim is `aria-hidden` and not focusable.
- **Focus on close.** Closing by the button, Escape or the scrim returns focus to the "Meny" trigger. Closing by navigation moves focus to the new page's `h1` instead, because the trigger may be stale and the user has changed page.
- **Restore.** `inert`, `aria-hidden` and the scroll lock are removed on close, including on unmount.
- **Motion.** 200 ms slide-in, disabled under reduced motion.
- **Desktop.** The drawer is not rendered at `md` and above, so it cannot enter the tab order there. The sidebar is not compressed into a mobile sidebar.
- **Discoverability.** Page title and team name stay in the top bar; primary page actions stay in the page header.

## Theme strategy

### Decision (approved 2026-11-02)
- **Lys is the initial and default DevPulse experience.** The default ignores the operating-system dark preference.
- **Mørk** is a complete theme with its own tokens and contrast gate.
- **Følg enhet** follows the operating-system preference **only when the user has explicitly selected it.**
- **Storage.** The explicit choice may be stored locally as a viewer preference (for example `localStorage` under one key holding one of three values). No server-side profile field is added. The stored value is not sent to any service and is not linked to identity.
- **No identifying telemetry** for theme selection. No analytics event, no per-user record.
- Both themes use the same semantic token names; no component branches on theme.

### Implementation contract
- The active theme is set by a `data-theme` attribute on `<html>`: `light` by default, `dark` when the stored choice is Mørk, and the operating-system-derived value only when the stored choice is Følg enhet.
- A small inline script before first paint reads the stored value and sets the attribute, to avoid a flash. The script reads and writes only this one key and never throws: every access is wrapped, and the default (light) applies if storage is unavailable.
- The server renders `data-theme="light"` so the initial HTML is light.

### Token contract (candidate values; contrast measured in planning, re-measured from the implemented file in UX-0)

| Token | Light | Dark | Use |
|---|---|---|---|
| canvas | `#F7F6F3` | `#111210` | page background (warm neutral) |
| surface | `#FFFFFF` | `#1A1B19` | cards, panels, inputs |
| surface-subtle | `#F1EFEA` | `#202220` | grouped regions, table headers, sidebar hover |
| surface-elevated | `#FFFFFF` + level-2 shadow | `#1F201D` + level-2 shadow | drawer, dialog, popover |
| text-primary | `#1C1B19` | `#F2F1ED` | headings, body |
| text-secondary | `#4A4742` | `#C9C6BE` | descriptions |
| text-muted | `#6B675F` | `#A3A097` | help text, metadata |
| border-subtle | `#E4E1DA` | `#2E2F2B` | dividers |
| border-strong | `#8C867B` | `#75766E` | control borders |
| primary | `#0B6B63` | `#5FC3B5` | the single accent: primary actions, current state |
| primary-text | `#FFFFFF` | `#0B2B28` | text on primary |
| primary-hover | `#09554F` | `#7FD8CB` | hover and pressed |
| primary-subtle | `#E0F0EC` | `#18302D` | current-state background |
| success (growth) | text `#1E6B3E`, subtle `#E3F2E8` | text `#6CC48F` | completed, positive change |
| warning | text `#7A4E00`, subtle `#FBF0D9` | text `#E0B354` | attention, overdue |
| danger | text `#A4221B`, subtle `#FBE4E2` | text `#F08A82` | destructive, errors |
| info | text `#2456A6`, subtle `#E4ECF8` | text `#8DB4F0` | information |
| focus-ring | `#0B6B63` | `#7FD8CB` | focus outline |

**Candidate measurements (WCAG relative-luminance formula, planning pass):**
- Light: text-primary on canvas 15.9:1 and on surface 17.2:1; text-secondary on canvas 8.6:1; text-muted on canvas 5.2:1 and on surface 5.6:1; primary-text on primary 6.4:1; primary on canvas 5.9:1; focus-ring on surface 6.4:1; border-strong on surface 3.6:1; semantic text on subtle backgrounds 5.6–6.4:1.
- Dark: text-primary on canvas 16.6:1; text-secondary on surface-subtle 9.4:1; text-muted on surface 6.6:1; primary-text on primary 7.2:1; focus-ring on surface 10.4:1; border-strong on surface 3.8:1; semantic text on surface 7.1–8.9:1.
- Chart palette against its surface, 3:1 minimum for graphics: light 5.0–7.6:1; dark 6.3–8.9:1.

These are candidates. UX-0 re-measures from the implemented file and records the results. They do not establish WCAG conformance for any page.

### Chart palette
Six categorical colours in order: teal, indigo, amber, rose, slate, green. Each series also has a distinct line style or marker shape. Suppressed or insufficient values are gaps, never zero. No decorative gradients.

## Iconography

### Dependency decision (approved 2026-11-02, conditional on UX-0 verification)
`lucide-react` may be introduced during UX-0. It is the **only** icon family. No other icon package, no downloaded icon set and no hand-maintained SVG icon set is introduced.

### Dependency record
- **Package and licence.** `lucide-react`, licence **ISC** (permissive, commercial use permitted; keep the licence notice with the package).
- **Version.** Latest at the time of installation is `1.66.0` (registry metadata, read-only check, 2026-11-02). The package is released very frequently (1.64.0 on 2026-10-29, 1.65.0 on 2026-10-30, 1.66.0 on 2026-10-31), so **UX-0 pins an exact version** and upgrades are deliberate changes.
- **Runtime dependencies.** None declared.
- **Peer dependencies.** `react` `^16.5.1 || ^17 || ^18 || ^19`, which covers this repository's React 19.2.8. `@types/react` `*`.
- **Module shape.** Declares `sideEffects: false`. ESM and CJS exports; named imports resolve to per-icon modules, so bundlers can drop unused icons.
- **Package size.** About 38 MB unpacked across 4,632 files. This is the npm tarball, which contains every icon and build variant. It is not the shipped bundle size.
- **Next.js handling.** Next 16.3.4 (this repository's version) includes `lucide-react` in its default `optimizePackageImports` list (`node_modules/next/dist/server/config.js`, line 1125). Named imports from `lucide-react` are therefore rewritten to per-icon imports in production builds. This is a static reading of Next's code, not a measured result.
- **Expected usage.** About 25–35 distinct symbols across navigation, actions and status, imported by name.
- **Existing alternative.** None. The repository has no icon package or icon asset. `recharts` provides no icons. Hand-maintained SVG was rejected for maintainability.
- **Competitor icons.** None copied.

### Material-issue assessment
No material issue is identified from the registry metadata, the peer ranges, the absence of runtime dependencies, the `sideEffects: false` declaration, or Next's optimisation list. **The shipped bundle size is not measured.** Measurement requires installing the package, which this planning pass does not do. It is a UX-0 gate: UX-0 records the production client bundle before and after the install, and the increase must be explained. If the increase is material and not explained by the icons used, UX-0 stops and reports.

### Usage rules
- Sizes: 16 px beside `text-sm`; 20 px for navigation and buttons; 24 px for empty-state and feature icons. Stroke width 1.75 throughout.
- Concept mapping (confirmed in UX-0): overview → `House`; team → `Users`; competency → `Layers`; roadmap → `Route`; results → `Activity`; skills → `Target`; goals → `Flag`; conversations → `MessagesSquare`; forum → `MessageSquare`; challenges → `Lightbulb`; administration → `ShieldCheck`; archive → `Archive`; edit → `Pencil`; delete → `Trash2`; filter → `SlidersHorizontal`; search → `Search`; privacy → `Lock`; help → `CircleHelp`; complete → `CircleCheck`; current → `CircleDot`; warning → `TriangleAlert`; menu → `Menu`; close → `X`.
- Icons accompany labels for primary actions. Icon-only controls are limited to menu, close and search, each with an accessible name. Decorative icons are `aria-hidden`. Status icons always accompany text.

## Illustration strategy (decided 2026-11-02)
- **Maximum of three original DevPulse illustrations** in the first Product Experience iteration. They do not need separate owner approval one by one, provided they follow the grammar below and this SPEC.
- **Where they may appear (only):** these three states:
  1. `/me/goals` with no goals yet ("Ingen mål ennå").
  2. `/me/conversations` with no conversations yet ("Ingen samtaler ennå").
  3. Survey completion (after successful submission).
- **Not allowed:** decorative use on any data-rich surface (team overview, pulse analytics, roadmap, competency, admin, tables, charts, forms), in cards, in table rows, or on every page header.
- **Source:** original SVG drawn for DevPulse. No third-party or competitor artwork. Each asset is listed with its origin and licence in `docs/UI-UX.md` before it is committed.
- **Grammar:** stroke 1.5 px at native size; rounded line caps and joins; geometric forms only (circles, rounded rectangles, one path per concept); palette limited to `primary`, `primary-subtle`, `border-strong` and `text-muted` token values, with light and dark variants derived from tokens; no text inside the artwork; a shared 160 × 120 px frame; the SVG is `aria-hidden`, and the surrounding copy carries the meaning.
- **Timing:** UX-7, after the shell and every page have migrated. Not earlier.

## Motion strategy (approved 2026-11-02)
- **Durations:** micro-interactions (selected state, hover, focus) 120 ms; accordion, panel and drawer 200 ms; progress width 300 ms; chart introduction 300 ms once on first paint. Easing `cubic-bezier(0.2, 0, 0, 1)`.
- **Allowed (state change only):** progress change; accordion expansion; dialog and drawer entrance; selected state; save success (a brief text and colour confirmation); goal completion (one node fills); roadmap stage transition (a node moves from *Kommende* to *Nåværende*); chart introduction.
- **Forbidden:** constant or looping animation, bouncing or elastic controls, parallax, decoration unrelated to state, page-to-page transitions, animation tied to an individual's score.
- **Reduced motion:** every transition and transform is disabled under `prefers-reduced-motion: reduce`. A test confirms that each state is present as text with motion disabled.
- **Implementation:** CSS transitions and Tailwind utilities. No animation library.

## Progress and gamification

### Boundary (revised 2026-11-02)
**Allowed:**
- Private completion progress. For example "3 av 5 ferdigheter vurdert" (the default), and a completion percentage where it materially improves comprehension.
- Milestone completion and completed / current / next states, including competency paths and roadmap nodes.
- Target markers and target-role development opportunities, using existing comparison text.
- Goal progress **only where the underlying model genuinely supports it.** See the note below.

**Not allowed:**
- Employee performance scores, readiness scores, productivity scores.
- Comparative ranking, leaderboard percentages, public individual comparison.
- Inferred employee quality or any inferred standing of a person.
- Gamified pressure (streaks, countdowns of obligation, "behind schedule" framing on personal data).

**Principle.** A private completion percentage is not inherently a performance score. Counts such as "3 av 5" are preferred where they are clearer than a percentage.

### Goals model check
The D1 personal goal model stores an *Aktivt* or *Fullført* status, an optional skill link and an optional target date. It has **no progress field**. Therefore goal progress percentages are **not supported by the model** and are not introduced. Goals show status as text and a completion node. Any goal progress measure would need its own approved model change.

### Boundary rules
- Progress shows **stored** state only. Nothing is inferred or computed from levels.
- "Completed" is always set by the user or an admin, never inferred.
- Positional text ("Tidligere steg") is never a completion claim (existing `SkillProgressPath` rule).
- Team progress never shows an individual's node.

## Privacy copy

### Classification
- **A — Exact or test-locked.** Changing a word requires an updated approved SPEC and test. Placement and disclosure may change; the text may not.
- **B — Meaning-locked, presentation-flexible.** Every claim, limit and consequence must be kept. Wording may change for clarity if the relevant meaning test still passes.
- **C — Ordinary UX copy.** May be rewritten for clarity.

### A — Exact or test-locked (verified)
| Copy (location) | Protected by |
|---|---|
| Skill-profile privacy notice "Egenvurderingen din er din egen. …" (`skill-profiles/copy.ts` → `privacyNotice`) | `skill-profiles-cross-cutting.test.ts`, `SkillProfilePage.test.tsx`; C2 BR-29 |
| Role comparison notice "Dine ferdighetsvurderinger er private. …" (`roleComparisonNotice`) | `skill-profiles-cross-cutting.test.ts` (`toBe(APPROVED_ROLE_COMPARISON_NOTICE)`) |
| Role-profile comparison `PRIVACY_NOTICE` | `role-profiles/copy.test.ts`, `ComparisonRows.test.tsx` (`toBe`) |
| Goals privacy notice "Målene dine er personlige. …" (`personal-goals/copy` → `privacyNotice`) | `personal-goals/copy.test.ts` (substrings and forbidden terms); `personal-goals-cross-cutting.test.ts` |
| Team-coverage participation notice, five approved points including "Dette er ikke full anonymitet…" (`participationCopy.noticePoints`) | `team-skills-cross-cutting.test.ts`; `SkillContributionPanel.test.tsx` |
| "minst 5 bidragsytere" (generated from `SKILL_COVERAGE_MIN_CONTRIBUTORS = 5`) | `team-skills-cross-cutting.test.ts` |
| Four coverage states and the visibility rules "Dekning vises bare for teamets medlemmer." and "Dekning vises ikke for deaktiverte team." | `TeamSkillNeedsSection` tests; C2 SPEC |
| Challenge anonymity copy "Innsendingen er anonym — vi lagrer ikke hvem som sendte den inn." and "Ikke inkluder navn…" | `ChallengeSubmissionPanel.test.tsx`; anonymous-challenges SPEC |
| Development-conversation privacy copy "Samtalene er private. …" and "Samtalen starter privat og uten deltaker…" (`createPrivacy`) | `CreateConversationForm.test.tsx`; `conversations-ui-regression.test.tsx`; D2 BR-38 |
| Conversation consequence statements before confirmation | D2 BR-38; dialog tests |
| Erasure confirmation copy | `ErasureConfirmation.test.tsx`, `ErasureEntryLink.test.tsx`; account-erasure SPEC |
| Forum erased-reply placeholder "Innlegget er fjernet" and thread-delete consequence text | `team-forum` SPEC; `ThreadDetail.erased.test.tsx` |
| **Survey privacy notice and "Mer om personvernet" points (new, 2026-11-02)** | Locked by this SPEC; to be covered by UX-2 tests |
| **Home-page privacy line (new, 2026-11-02)** | Locked by this SPEC; to be covered by a copy test in UX-1 |

### B — Meaning-locked
| Copy | Locked meaning |
|---|---|
| Team-coverage disclosure points ("Slik fungerer personvernet") | Each claim and limit: levels never shown to the team; no history stored; not an assessment; leads can compare over time; homogeneous groups reduce uncertainty |
| Personal skill-level names and descriptions (`SELF_ASSESSED_LEVEL_COPY`) | Canonical meaning in `domain/self-assessed-level.ts` |
| Coverage intro "Kompetansebehov er teamets plan… Det er ikke en vurdering av enkeltpersoner." | Plan, not an assessment of people |
| "Teamet ser aldri nivåene du har satt." and the withdrawal point | Team never sees levels; withdrawal consequence |
| Date hint "Valgfritt. Datoen er bare en merkelapp, ikke en påminnelse." | Date is a label, not a reminder |
| Insufficient-result wording "Resultatet vises når minst N personer har svart." (`results/copy`) | Threshold named, never a count |

### C — Ordinary UX copy
Page titles and eyebrows; headings without a privacy claim; button and tab labels; empty-state hints without a privacy fact; loading and generic retry text; field labels; toolbar and filter labels.

### Summary of changes made in this revision
- The home-page line changes wording (class A, new). Its meaning was broader than the implementation supports; the replacement matches BR-17, BR-25–27.
- The survey page gains a locked notice (class A, new), mode-neutral, with a disclosure.

## Page composition
1. **Context** (eyebrow, muted text).
2. **Title** (`h1`, one per page).
3. **Purpose** (one sentence).
4. **Primary action** (at most one, header row).
5. **Current-state summary** (text counts or statuses from existing data).
6. **Primary content.**
7. **Secondary detail** (collapsed where possible).

Tabs and segmented controls sit directly under the title for sub-views. A toolbar above a list holds search, removable filter chips and one view switch.

## Typography
- Geist Sans for all UI text (already configured). Geist Mono remains configured and unused.
- Scale:
  - Eyebrow 13/18, regular, muted.
  - Page title 28/34, semibold.
  - Page description 15/24, regular, secondary.
  - Section title 18/26, semibold.
  - Panel title 15/22, semibold.
  - Metric 32/36, semibold, tabular numerals.
  - Body 15/24, regular.
  - Secondary body 14/22, regular, secondary.
  - Label 14/20, medium.
  - Help text 13/20, regular, muted.
  - Survey question (mobile) 20/28, semibold; survey body 17/26.
- Weight rule: semibold for titles and key values, medium for labels, regular elsewhere.

## Spacing, radii, borders, elevation
- **Spacing:** 4 px base scale (4, 8, 12, 16, 24, 32, 48, 64). Section gap 32 px; card padding 16 px mobile and 20 px desktop; page padding 16 px mobile and 32 px desktop.
- **Radii:** 6 px (inputs, badges, chips); 10 px (buttons, cards, panels); 14 px (drawer, dialog, survey card). Pill-shaped buttons are replaced by 10 px radius.
- **Borders:** 1 px. `border-subtle` by default; `border-strong` for controls. A surface inside a surface uses a fill, not a second border.
- **Elevation:** level 0 canvas (flat); level 1 surface (border only); level 2 drawer, dialog and popover (one soft shadow). No shadows on cards.

## Focus
- Every interactive element: 2 px `focus-ring` outline with 2 px offset on `:focus-visible`. Never removed.
- Dialogs and drawers trap focus and restore it on close.
- Skip-to-content link on every layout (new).

## Breakpoints and containers
- Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Mobile below `md`; tablet `md` to `lg`; desktop `lg` and up.
- Verification widths: 360, 768, 1280 px, plus 200% zoom and reflow at 320 px.
- Containers: main 1200 px max with 16 px (mobile) or 32 px (desktop) side padding; reading column 680 px; survey column 560 px; auth pages 420 px. These replace the `PageShell` width scale in UX-1.

## Form hierarchy
- Label above input; help text below the label; error text below help text, linked with `aria-describedby` and `aria-invalid`.
- Required and optional marked in text ("valgfritt" for optional).
- One primary button per form. Cancel is secondary. Destructive confirmation uses a danger button inside a dialog that states the consequence.
- Inputs 44 px tall on mobile, 40 px on desktop. Date inputs native.
- Long forms open as a disclosure or inline editor, not as the first element of a page. The conversation creation form moves behind "Ny samtale".

## Action hierarchy
- One primary action per region (filled, `primary`).
- Secondary: outlined, `border-strong`.
- Tertiary: text link or text button.
- Destructive: outlined danger, only in a confirmation dialog or a clearly labelled danger area.
- Disabled: muted text, with the reason in text when it is not otherwise visible.

## Status representation
- A status is a badge or status text with an icon, a text label and a tone (success, warning, danger, info, neutral). Never colour alone.
- Vocabulary is existing (for example "Aktiv", "Arkivert", "Åpen", "Fullført", "Deaktivert", "Ikke startet", "Nåværende steg", "Kommende steg", "Dekket", "Ikke dekket ennå", "Ikke nok data").
- The tone is decided by the component's existing state, never by a new UI computation.

## Section hierarchy
- Section title (`h2`), optional one-line description, optional action on the right.
- Sub-section (`h3`) only inside a section.
- Sections separated by space (32 px), not borders.
- Collapsible only if the content is secondary or is a privacy disclosure.

## Content design
- Concise Norwegian product language, consistent with the current copy modules.
- Headings name the thing ("Kompetansebehov og dekning"), not the process.
- Explanations go into a collapsed "Slik fungerer…" disclosure unless consent requires them visible.
- Copy changes follow the privacy classes above.

## Desktop strategy
- Sidebar and main content column.
- Team overview: summary-first, with the summary in the left column on desktop, stacked on mobile.
- Conversations: split layout at `xl` and up (conversation left, context panel right: shared goals, participant state, metadata). Below `xl`, the context becomes a section below the main content.
- Roadmap and competency paths use the full width; tables scroll in their container with sticky headers when long.

## Mobile and responsive strategy
- Below `md`: top bar and drawer (see "Mobile navigation drawer"). No bottom navigation bar.
- All essential authenticated actions reachable at 360 px.
- Tables become stacked cards with the same text (the coverage pattern is reused).
- No horizontal page scroll; wide tables scroll only inside their container.

## Survey: mobile strategy
See "Survey experience" (BR-S1 to BR-S9).

## Empty, loading and error states
- **Empty:** what this is · why use it · what next. Illustration only for the three approved states.
- **Loading:** skeleton rows for lists and metric strips; inline "Laster …" for small sections; reserved heights to avoid layout shift.
- **Error:** scoped, with retry, distinct from empty and from authorization failure. Privacy-sensitive read failures stay distinguishable where existing semantics require.
- No failure is shown as an empty state.

## Chart and analytics presentation (pulse results)
- **Summary strip:** latest published value per dimension as a metric, change from the previous published survey as text with a direction word ("steg opp", "steg ned", "uendret"), and the survey date.
- **Chart:** existing Recharts line chart, visible legend, categorical axis labelled with actual dates, gaps for suppressed values with a text note, and a table alternative.
- **Latest point** emphasised by marker size and label.
- **Tooltips** on hover and focus; their content is also in the table.
- **Insufficient data:** flat, non-quantified state with the existing threshold wording.
- **Not added:** period selector, averages, overall scores, per-person breakdowns.

## Team experience structure
- Overview order: pulse summary (state, change, attention), competency (progress paths with current, next and target), needs and coverage (table with categorical states), roadmap summary, forum and challenges, members.
- Each section keeps its failure isolation.

## Journey baseline (UX-0 audit, completed 2026-11-02)

### Method
This baseline is **static and code-derived.** It counts the route transitions and interactive controls each journey requires, using the components as they exist in the repository. It is **not** a timed usability test and **not** measured in a running browser; the application was not started, and no account or Firebase configuration was used. Where a count depends on data (for example the number of skills in the catalog), the count is shown as a per-item rate.

### Counts (from the repository)
| Journey (existing route) | Page transitions | Interactive steps to primary completion | Notes |
|---|---|---|---|
| J1 Sign-in and reach a team (`/sign-in` → `/teams` → `/teams/[teamId]`) | 2 | 3 form controls (two fields and submit) + 1 link = **4** | Post-sign-in continues to `/teams` |
| J2 Survey answer, authenticated or public (`/survey/[surveyId]`) | 0 after the link | **16**: 15 radio controls + 1 submit | All three questions on one page; no progress indicator; no Back |
| J3 Personal skill assessment (`/me/skills`) | 1 (header "Min utvikling") | **2 per skill** (one select per row, then the option) | Privacy and role text (about 3 paragraphs) sits above the list |
| J4 Create a personal goal (`/me/goals`) | 1 (header, then personal nav) | **5**: open form, title (required), skill select, date, submit (form has 3 controls) | `GoalForm` uses 3 controls, one marked required |
| J5 Create a development conversation (`/me/conversations`) | 1, then 1 to the detail page after create | **5** to create (toggle, title (required), date, team select, submit) | Form is the first element of the page; invitation is a further step on the detail page |
| J6 Member sets a competency stage (`/teams/[teamId]`, section Kompetanseområder) | 1 (header Team, then the team) | **2** (select, "Lagre") for one tree | Requires scrolling past the earlier team sections; the team overview has **6** section or heading markers |
| J7 Plan a competency area (`/teams/[teamId]/roadmap`) | 2 (team → roadmap) | **6** editor controls (target, priority, dates, owner, status, save) | Editor reached from a row or from "Områder uten plan" |
| J8 Submit an anonymous challenge (team page, Teamaktivitet) | 1 | **2**: textarea and "Send inn" | Sits in the team's second zone, after results |
| J9 Admin creates a team (`/admin/teams`) | 1 (header Admin) | **Not counted precisely**: the creation form lives in a child component and its controls are not in the parent file | Measured as a page-level structure only |
| J10 Admin team management (`/admin/teams/[teamId]`) | 1 | Page structure: **14 section or heading markers** on one page | The longest admin surface; sections are not navigable in place |

### Findings from the baseline
- The survey is the only journey with a per-question burden on mobile (16 controls on one page). This supports UX-2 and the one-question-per-screen decision.
- Forms precede lists on two personal journeys (J4, J5). This supports the "Ny samtale"-style disclosure pattern.
- The team overview requires passing six sections to reach competency actions (J6). This supports summary-first ordering in UX-4.
- The admin team page (J10) has 14 section or heading markers on one page. This supports a section index in UX-6.
- The journeys with the fewest steps (J1, J8) are not the usability problem; the problem is placement and copy density.

### Remaining work for a complete baseline
A timed or observed walkthrough in a running build, with real data, remains valuable evidence. It is not required for implementation to start, because the fixes it would guide are already set by the findings above. It belongs in UX-7's final review.

## Security and privacy regression analysis
| Area | Risk | Control |
|---|---|---|
| Authorization | UI shows or hides controls wrongly | Server remains authority; capability-gated tests retained |
| Survey anonymity | Identity-bearing client state or persisted answers | In-memory only; no storage added; `security-review` before UX-2 merges |
| Survey submission | Payload drift | Payload test unchanged |
| Survey notice | New claim broader than the implementation | Locked notice verified against BR-17, BR-21–27; no "anonym" for authenticated |
| Home claim | Broad anonymity wording | Replaced with verified wording |
| Forum and challenge anonymity | Colour-per-author, avatars or "you" markers | Forbidden; `authorTag` text only |
| Aggregation and thresholds | Suppressed value shown as zero; small groups shown | BR-9; existing tests; no group cell below threshold |
| Copy | Privacy meaning changed by shortening | Classes A, B, C |
| Member roster and memberRef | New places that render names or refs | Existing DTO rules |
| Role target | Shown on team or admin surfaces | Owner-only retained |
| Account Erasure | Consent or flow changed by copy or layout | Erasure copy class A; no flow change |
| Theme preference | Identity-linked storage | Local viewer setting only; no telemetry; no server field |
| Telemetry | New analytics or session replay | Forbidden without separate review |
| Dependencies | Icon library egress | No runtime dependencies; no network access in the package; bundle measured in UX-0 |

Conclusion: no server-side requirement arises. The risks are client-state drift, copy drift and new group-level displays, each with a control.

## Account Erasure and TASK-045 (unchanged)
- Account Erasure implementation is complete through TASK-044. TASK-045 remains Ready as a production/operator gate. **Deployment is HELD.**
- Product Experience does not change any erasure flow, fence, cleanup, copy class A item or runbook. `/me/erasure` moves into the User group only.

## Architecture decisions
- **AD-1 Reuse primitives.** Extend `src/components/ui/`. Retire variants only when UX-0 shows the replacement covers every use.
- **AD-2 Tokens in `app/globals.css`.** Semantic tokens for light and dark, exposed to Tailwind v4 through `@theme inline`, applied by `data-theme` (see "Implementation contract").
- **AD-3 Icons.** `lucide-react`, pinned exactly, wrapped by one `Icon` component in `src/components/ui/`.
- **AD-4 Shell.** `AppShell` (sidebar and drawer) for authenticated routes; simple top bar for signed-out routes; a minimal route group for `/survey/[surveyId]`. Route paths do not change.
- **AD-5 Client-stored values.** One viewer-preference key for theme. No other client-stored value is introduced.
- **AD-6 Charts.** Recharts only.
- **AD-7 Motion.** CSS transitions and Tailwind utilities only.
- **AD-8 Containers.** The three named containers replace the `PageShell` width scale.

## Test boundaries
| Boundary | Covers |
|---|---|
| Presentation components (Vitest + Testing Library) | BR-2, BR-5, BR-6, BR-7, BR-10, BR-11, BR-14 |
| Shell render with mocked auth (`SiteHeader.test.tsx` pattern; superseded explicitly in UX-1) | BR-1, BR-2, fail-closed signed-out rendering |
| Drawer behaviour (Testing Library): opens focused on the current link; Escape, close button, scrim and navigation close it; focus returns to "Meny" or to the new `h1`; background `inert`; scroll lock released | Drawer decisions |
| Capability-gated visibility (existing gateways and routes) | BR-1 |
| Survey UI (Testing Library, existing gateway mock) | BR-8, BR-S1 to BR-S9; payload unchanged; no identity state; answers kept across Back and Next; notice text verbatim |
| Copy and forbidden-term tests (existing suites) | Class A exact copy, class B claims, forbidden terms; new copy tests for the home line and the survey notice |
| Theme (Testing Library and a static check) | Light default with no OS influence; Følg enhet only when chosen; storage failure falls back to light; no telemetry call |
| Token and colour guard (static test) | BR-4: no raw palette value outside the token file |
| Contrast record (UX-0) | BR-4 from the implemented file |
| Icon guard (static test) | BR-7: only `lucide-react` imports for icons |
| Accessibility (automated scan on key routes; keyboard walkthrough; screen-reader spot check on survey, drawer and coverage) | BR-5, BR-6, BR-12 |
| Reduced motion (CSS and component test) | BR-13 |
| Reflow and zoom (manual, 360 px and 200%, recorded) | BR-12 |
| Visual regression | Only if the owner approves the tooling |

Tests asserting obsolete class names, header layout or pill buttons may change. Tests protecting authorization, class A copy, aggregation display, anonymity and the survey payload must not be weakened or removed.

## Acceptance criteria
- [ ] Every existing route renders in the new visual system with no unauthorized navigation entry.
- [ ] No server file, DTO, route handler, Firestore rule, environment variable or erasure file changes in any UX phase unless its approved task names it.
- [ ] No raw palette value in app code outside the token file.
- [ ] Contrast for every pair in the token contract is recorded from the implemented file and meets its threshold in both themes.
- [ ] Lys is the default with any OS setting; Mørk applies only when chosen; Følg enhet applies only when chosen.
- [ ] The survey shows one question per screen at 360 px and at desktop widths, answer targets of at least 44 px on mobile, the identical submission payload, and answers kept across Back and Next.
- [ ] The survey notice and its disclosure appear verbatim.
- [ ] The home line appears verbatim.
- [ ] No page has horizontal scroll at 360 px.
- [ ] Every class A item appears verbatim; every class B item keeps its claims and limits.
- [ ] The drawer meets the focus, inert, scroll-lock and close-path requirements, verified by test.
- [ ] Reduced-motion users see no transform or transition beyond instant state change, and state remains readable as text.
- [ ] `lucide-react` is pinned to an exact version. The production client bundle is measured before and after the install, and the increase is explained.
- [ ] All existing authorization, copy, aggregation and anonymity tests remain green, and none is removed to pass.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass per phase, with the actual output recorded.
- [ ] No WCAG conformance is claimed without recorded evidence.

## Phase structure (final)

### Dependency shape
```
UX-0 Experience foundation
        ↓
UX-1 Application shell · navigation · page composition
        ↓
UX-2 Survey (mobile-first, one question per screen)
        ↓
UX-3 Personal development   ·   UX-4 Team experience   ·   UX-5 Pulse analytics   ·   UX-6 Administration
        ↓
UX-7 Final polish (empty states, the three approved illustrations, motion review, final accessibility and responsive pass)
```

### Phases
- **UX-0 Experience foundation.** Light and dark token file and measured contrast record; typography scale; spacing, radii, borders, elevation; focus; `lucide-react` (exact version) and the `Icon` wrapper; status components (`StatusBadge`, text-first); motion tokens and reduced-motion handling; breakpoint and container definitions; chart palette tokens and a `ChartFrame` contract (no chart migrated); page-header, section, action and form hierarchy components; theme switch with the implementation contract; bundle measurement before and after the install. **No page layout changes.**
- **UX-1 Application shell, navigation and page composition.** `AppShell` with sidebar and drawer; team context; admin scope marker; skip link; signed-out top bar; survey route group; containers applied to existing pages without changing their content; explicit supersession of the `product-ux-shell` header contract, with updated `SiteHeader.test.tsx`; the home-line copy change and its test.
- **UX-2 Survey participation.** Intro with the locked notice and disclosure; one question per screen at all widths; progress with text; Back and Next; review; submission; completion. Requires `security-review` before merge.
- **UX-3 Personal development.** Ferdigheter (summary, grouped rows, role section, private completion as counts with an optional percentage); Mål (status cards, inline editor, completion node, no progress percentage); Samtaler (grouped list, split layout at `xl`, form behind "Ny samtale").
- **UX-4 Team experience.** Summary-first overview; competency progress paths; needs and coverage table with the disclosure; roadmap cards and milestones; challenges and forum list and detail; members.
- **UX-5 Pulse analytics.** Summary strip; chart frame; chart with table alternative; insufficient-data states; latest-point emphasis.
- **UX-6 Administration.** Admin section navigation; dense tables; forms behind disclosures; destructive confirmations; archive and restore patterns; in-page section index for the team admin page with 14 section or heading markers.
- **UX-7 Final polish.** Empty-state copy; the three illustrations; motion review; reduced-motion audit; final responsive pass at 360, 768 and 1280 px; final accessibility pass; visual consistency review.

### Recommended order
1. **UX-0** in full, including the bundle measurement, before any page changes.
2. **UX-1** next: every later page depends on the shell, route groups and containers.
3. **UX-2 survey** immediately after UX-1. It is the highest-priority user gain, sits in its own layout group, and is the most privacy-sensitive presentation, so it is reviewed by `security-review`.
4. **UX-3 personal**, then **UX-4 team**, **UX-5 pulse**, **UX-6 admin**. Personal comes first because it is smaller and exercises the status, path and form components with less privacy exposure; team reuses those proven components.
5. **UX-7** last.

An alternative is to start UX-2 right after UX-0, in parallel with UX-1. It is not recommended by default, because two phases would change the same primitives and layout files at once.

## Future product ideas (not approved; after this initiative)
- Owner-private D2 notes
- Notifications
- Invitation expiry
- Current role
- Lead-initiated check-ins
- Multiple conversation participants
- Mentor or cross-team conversation sharing (CL-2)
- Role-definition proposals
- Multiple target roles
- Role families
- Role levels
- Role comparison summaries beyond the current rows
- Additional roadmap views (history, Gantt, Kanban, dependencies, challenge links)
- Cross-team or Section/department grouping
- Survey answer persistence across reload or navigation (a separate feature, see "Interruption and recovery")
- Goal progress measure (requires a model change)
- Any readiness, competency or employee score, ranking or leaderboard

## Owner decisions

### Resolved
1. Roadmap and Account Erasure wording: resolved; HELD, TASK-045 Ready.
2. Privacy copy classes A, B, C: resolved.
3. Survey experience: one question per screen at all widths; no new answer persistence; locked survey notice and disclosure; interruption recovery is a future separate feature.
4. Theme: Lys default; Mørk and Følg enhet as explicit choices; local viewer preference; no telemetry.
5. Icons: `lucide-react` approved conditional on UX-0 bundle verification; one family only.
6. No `Min utvikling` overview route.
7. Drawer: four close paths; focus management specified.
8. No WCAG claim without evidence.
9. Illustrations: maximum three, approved without per-asset approval, within the grammar.
10. Motion: restrained, state-only, reduced-motion respected.
11. Home-page privacy claim: replaced with the verified wording above.
12. Progress boundary: private completion progress and percentages allowed where helpful; performance, readiness, productivity, ranking and gamified pressure forbidden.

### Remaining owner decisions
None that block implementation.

## Non-blocking implementation questions (for UX-0 and later)
- Exact token values: re-measure from the implemented file; adjust only if a pair fails.
- Icon mapping: confirm the concept-to-icon assignments in UX-0.
- Bundle impact of `lucide-react`: measured in UX-0 after the install; stop and report if material and unexplained.
- Drawer implementation details: whether to use the native `<dialog>` element or an equivalent `role="dialog"` container, provided the four close paths, focus rules and inert behaviour are met.
- Survey intro layout: whether the notice sits above or under the title, provided it is visible before the first question.
- Whether the "Mer om personvernet" disclosure uses native `<details>`/`<summary>` or the existing disclosure pattern.
- Final text of the three illustrations (titles and alt copy), within the approved states.
- The exact set of skills shown in the illustrated empty state for goals.

## Explicit non-decisions
- The Leapsome screenshots are inspiration only.
- The HabitNow and Duolingo captures are off-brief and unused.
- Contrast numbers are candidate measurements; UX-0 measures the implemented file.
- The journey baseline is static and code-derived, not a timed walkthrough.
- The bundle size of `lucide-react` is not measured until it is installed.

## Next workflow command
`/split-tasks product-experience`, producing `docs/features/product-experience/TASKS.md` with UX-0 as the first Ready phase.
