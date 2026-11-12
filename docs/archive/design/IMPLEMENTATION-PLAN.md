# DevPulse — Redesign Implementation Plan

**Status:** Working plan
**Task authority:** `docs/features/product-experience/TASKS.md` (UX-0 to UX-7). This plan does not define tasks; it maps the redesign onto them.
**Visual direction:** [DESIGN-README.md](./DESIGN-README.md), [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)

---

## 1. Reference mapping

All 14 references are present in `docs/design/references/` under normalized names. `generera 04-teams.png` was renamed to `04-teams.png` on 2026-11-03.

| Ref | File | Application route(s) | Status |
| --- | --- | --- | --- |
| 01 | `01-public-home.png` | `/` (signed-out) | Privacy line and signed-out top bar (TASK-010, TASK-014) |
| 02 | `02-sign-in.png` | `/sign-in` | Not yet evaluated against this plan |
| 03 | `03-app-home.png` | `/` (signed-in) | Not yet evaluated against this plan |
| 04 | `04-teams.png` | `/teams` | Containers and headers (TASK-015) |
| 05 | `05-team-overview.png` | `/teams/[teamId]` | Summary strip, section order, needs table (TASK-040 to TASK-045), results (TASK-050 to TASK-052) |
| 06 | `06-team-roadmap.png` | `/teams/[teamId]/roadmap` | Roadmap cards and stage transition (TASK-043) |
| 07 | `07-my-skills.png` | `/me/skills` | Private completion summary, role comparison rows (TASK-030, TASK-031) |
| 08 | `08-my-goals.png` | `/me/goals` | Status cards and inline editor (TASK-032) |
| 09 | `09-conversations.png` | `/me/conversations` | Grouped list and split layout (TASK-033) |
| 10 | `10-conversation-detail.png` | `/me/conversations/[conversationId]` | Split layout (TASK-033). Not a chat system. |
| 11 | `11-admin-teams.png` | `/admin/teams`, `/admin/teams/[teamId]` | Admin section index and tables (TASK-060, TASK-061) |
| 12 | `12-admin-roles.png` | `/admin/roles` | Competency role profiles only (TASK-063). Permission toggles are **not** implemented. |
| 13 | `13-my-profile.png` | `/me/profile` | Not yet evaluated against this plan |
| 14 | `14-mobile-survey.png` | `/survey/[surveyId]` | One-question stepper, intro, completion (TASK-020 to TASK-023) |

Rows marked "Not yet evaluated" have no dedicated task in the product-experience graph. They are covered by the final gates in §8.

## 2. Current-state assessment

Evidence is from the working tree on `main` (uncommitted changes from the product-experience run), verified 2026-11-03.

- **Foundation exists.** Semantic tokens, typography/spacing/radius/elevation/focus/motion tokens, the `Icon` wrapper on `lucide-react`, chart palette tokens and `ChartFrame` are in place (TASK-001 to TASK-008).
- **Route groups and shell exist.** Signed-out top bar, desktop sidebar `AppShell`, mobile drawer and team context are in place (TASK-010 to TASK-013).
- **Pages are partially redesigned.** TASK-015 and TASK-030 to TASK-063 are Done with recorded deviations. Details live in `VERIFICATION.md`.
- **Survey flow is redesigned.** Intro, one-question stepper, answer controls and completion are Done (TASK-020 to TASK-023).
- **Empty states and motion audit are Done.** TASK-070 and TASK-071 record static checks only.
- **Open gates.** TASK-072 (responsive), TASK-073 (accessibility) and TASK-074 (documentation closeout) are Ready and blocked on manual browser evidence.

### Verification run for this plan (2026-11-03)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | Pass |
| Lint | `pnpm lint` | Pass, 0 errors, 1 pre-existing warning (`create-reply.transaction.test.ts`, unused `attempts`) |
| Tests | `pnpm test` | Pass, 517 files passed, 1 skipped; 9148 tests passed, 2 skipped |
| Build | `pnpm build` | Pass |

### Problems from the brief, and their status

| # | Brief item | Status |
| --- | --- | --- |
| 1 | Inconsistent authenticated navigation | Addressed by TASK-011 to TASK-013; re-check in TASK-072 |
| 2 | Signed-in users see sign-in page | **Not verified in this plan.** Needs a browser or route test. |
| 3 | Sparse authenticated home | **Open.** No task covers signed-in `/` content. |
| 4 | Weak team directory | Addressed by TASK-015; visual check pending |
| 5 | Team overview hierarchy | Addressed by TASK-040 to TASK-042 |
| 6 | Duplicate React key `"2"` in TeamDetail | **Open.** See §4. |
| 7 | Roadmap readability | Addressed by TASK-043 |
| 8 | Form-heavy skills page | Addressed by TASK-030, TASK-031 |
| 9 | Personal goal presentation | Addressed by TASK-032 (editor-as-disclosure gap recorded) |
| 10 | Conversation usability | Addressed by TASK-033 (1280 px browser check not performed) |
| 11 | Admin screens | Addressed by TASK-060 to TASK-063 |
| 12 | Profile presentation | **Open.** No task covers `/me/profile`. |
| 13 | Mobile survey | Addressed by TASK-020 to TASK-023 (360 px check not performed) |
| 14 | Responsive layouts | Open until TASK-072 |
| 15 | Light/dark consistency | Tokens in place; visual theme check outstanding (TASK-070) |

## 3. Target design architecture

- **Tokens:** `app/globals.css` with `@theme inline` for Tailwind v4. Values follow `DESIGN-SYSTEM.md`. No second styling system.
- **Primitives:** `src/components/ui/` for presentation only (Button, Badge, StatusBadge, Card, PageHeader, PageShell, Section, Container, form controls, ChartFrame, Icon, illustrations).
- **Feature components:** stay in `src/features/<feature>/`. They compose primitives and do not own design tokens.
- **Routes:** `app/(app)/...` and `app/(public)/...` route groups. Route pages stay thin.
- **Theme:** `lys`, `mork`, `folg` stored in one local key, applied by an inline script before first paint (TASK-001).

## 4. Known open items

### 4.1 TeamDetail duplicate key `"2"`

Investigated on 2026-11-03. Not resolved.

- `TeamDetail.test.tsx` renders with no duplicate-key warning.
- The direct `key=` props in `TeamDetail.tsx` (`generation`, one per section) are not in an array and cannot collide.
- Candidate list keys that could hold numeric or colliding values were reviewed, but none is proven to produce `"2"`:
  - `src/features/results/components/TrendChart.tsx:148` (`key={key}` over `DIMENSION_LINES`)
  - `src/features/results/components/ResultsSummaryStrip.tsx:68` (`key={dimension}`)
  - `src/features/results/components/TrendTable.tsx:71` (`key={result.surveyId}`)
  - `src/features/teams/components/TeamRosterSection.tsx:125` (`${index}-${displayName}`, unique by construction)
  - `src/features/skill-trees/components/TeamSkillSection.tsx:124` (`${treeId}-${currentNodeId}`)
- **Next step:** reproduce with the demo team data (`pnpm seed:demo-team`) in a browser console and read the component stack from the warning. Do not apply a workaround before the source is identified.

### 4.2 Signed-in home, profile

No product-experience task covers `/` (signed-in) or `/me/profile`. These need a new task or an explicit scope decision before implementation. Product-facing copy must not invent profile fields or dashboard metrics.

### 4.3 Browser evidence

TASK-072, TASK-073 and TASK-074 depend on manual browser evidence at 320, 360, 768, 1280 px and 200% zoom, plus dark mode, keyboard, and screen-reader checks. No browser tool was available in the session that wrote this plan, so none of those checks is performed here.

## 5. Dependencies

- Icon dependency: `lucide-react` (pinned, TASK-004). No other icon package.
- Chart rendering: existing Recharts usage, through `ChartFrame` (TASK-008).
- No new backend persistence, routes, environment variables, Firestore rules, or Account Erasure changes.

## 6. Responsive requirements

- Widths: 320, 360, 768, 1280 px and 200% zoom.
- No unintended horizontal overflow.
- Mobile navigation through the drawer (TASK-012).
- Survey is the mobile-critical flow (TASK-020 to TASK-023).
- Charts remain usable at narrow widths, with the text alternative from TASK-051 and TASK-052.

## 7. Accessibility, privacy, test strategy

- **Accessibility:** semantic headings, visible `focus-ring` (TASK-003), reduced-motion override (TASK-003, TASK-071), accessible labels and error feedback in form primitives (TASK-007). WCAG 2.2 AA is a target. **No conformance claim is made** (TASK-002). Automated scan and keyboard walkthrough are part of TASK-073.
- **Privacy:** survey privacy wording and class A copy are preserved (TASK-014, TASK-020). Aggregation thresholds, individual skill privacy, goal ownership and conversation participant access are unchanged. No employee ranking, productivity scoring or new access-control roles. The reference 12 permission toggles are not implemented.
- **Tests:** unit tests on primitives, route-level tests for signed-out and signed-in navigation, static guards (raw palette allow-list in TASK-002, reduced motion, icon source), and the feature suites. Command gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Browser verification:** to run under TASK-072 and TASK-073, with screenshots stored as evidence in `docs/features/product-experience/VERIFICATION.md`, not as production UI.

## 8. Remaining work and phases

| Phase | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| P0 | Reference normalization, plan | 14 references present, `04-teams.png` named correctly, plan written | Done with this document |
| P1 | Foundation (tokens, primitives, shell) | TASK-001 to TASK-013 Done | Done (recorded) |
| P2 | Pages | TASK-015, TASK-030 to TASK-063 Done | Done with recorded deviations |
| P3 | Survey and empty states | TASK-020 to TASK-023, TASK-070, TASK-071 Done | Done, visual checks outstanding |
| P4 | Signed-in home, profile, sign-in | Needs new task or scope decision (§4.2) | Open |
| P5 | TeamDetail duplicate key | Reproduce, identify source, fix at source (§4.1) | Open |
| P6 | Browser, responsive, accessibility gates | TASK-072 to TASK-074 | Blocked on browser evidence |

## 9. Risks and intentional deviations

- **Reference 12** shows access-control permission toggles. DevPulse roles are competency profiles. The toggles are intentionally not implemented.
- **Reference 10** resembles a chat. The domain stays a structured development conversation. No new chat system.
- **Chart alternatives:** ChartFrame wrap, marker shapes and latest-point emphasis were not applied in TASK-051 (recorded).
- **Editor-as-disclosure** in goals and some form patterns differ from the references (TASK-032 recorded).
- **Risk:** visual regressions were verified by tests and code review only. Until P6 runs, the visual result is unverified in a browser.

---

## 10. Closeout pass: comparison, changes and evidence (2026-11-03, second pass)

This section supersedes §4.1, §4.2 and §4.3 where they differ.

**Functional completion and visual fidelity are separate columns below.** A completed product-experience task means behaviour and structure exist. It does not mean the page matches its reference. Visual fidelity is **not verified** for any page: no browser tool was available in this session (the tool search returned only WebFetch and Google Drive tools).

### 10.1 Changes made in this pass

| Area | Change | Files |
| --- | --- | --- |
| Home `/` | Route moved from `app/(public)/` to `app/` so one route can choose its shell. Signed out: public header and the same public content. Signed in: `AppShell` with the authenticated home. Before the first auth event, fails closed to signed out. URL unchanged. | `app/page.tsx`, `app/page.copy.ts`, `app/page.test.tsx`, `app/layout.tsx` |
| Authenticated home | New feature slice. Quick links to existing routes (Team, Ferdigheter, Mål, Samtaler, Profil) and the real team list via the existing `TeamsOverview`. No metrics, no computed personal data. | `src/features/home/copy.ts`, `src/features/home/components/AuthenticatedHome.tsx` |
| Sign-in redirect | A signed-in visitor opening `/sign-in` is sent to the validated `continue` target (default `/teams`). Only the first auth emission is acted on, so the existing success message after a fresh sign-in is unchanged. | `src/features/auth/components/SignedInRedirect.tsx` (+ test), `app/(public)/sign-in/page.tsx` |
| Profile | Restructured to a main column (existing display-name form) and an aside (team link, existing erasure entry). Only supported fields are shown. Account-erasure component unchanged. | `app/(app)/me/profile/page.tsx`, `src/features/profiles/copy.ts` |
| Raw-palette allow-list | Key renamed for the moved home route; count unchanged (4). | `src/lib/theme/raw-palette-allowlist.json` |
| Reference file | `generera 04-teams.png` renamed to `04-teams.png`. | `docs/design/references/` |

### 10.2 Comparison per reference

Columns: **Functional** = behaviour exists and is tested. **Visual** = matches the reference in composition (not verified by rendering for any row).

| Ref | Actual route | Functional | Visual differences | UX differences | Missing / incomplete | Required change | Privacy / domain constraint | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 public home | `/` (signed out) | Done | No hero illustration or brand composition; trust message is plain text | Two sign-in CTAs plus header "Logg inn" (duplicated, pre-existing) | Composition | Hero layout with original SVG/CSS illustration | Class A privacy line kept verbatim; no unsupported claims | Unit tests; not rendered |
| 02 sign-in | `/sign-in` | Redirect fixed this pass | Reference is a split layout with three value points and a card; current page is a single centred card | None | Split layout, value points | Visual split layout using existing copy only | Safe `continue` allow-list unchanged | Unit tests for gate and page; not rendered |
| 03 app home | `/` (signed in) | Done this pass | Reference has greeting, goals, conversation, roles, trend chart and next-steps cards. Implemented: quick links and team list only | Shell now used; before this pass signed-in users saw the public header | Greeting name, goals panel, next conversation, trend chart, recommended steps | Each needs a data source decision (see §10.4) | No invented metrics; goals and conversations only with their existing owner-only reads | Unit tests; not rendered |
| 04 teams | `/teams` | Done (TASK-015) | Team list uses existing containers; no team identity marks | Existing empty state | Team identity | Team card identity via existing data only | Team data is real | Existing suites; not rendered |
| 05 team overview | `/teams/[teamId]` | Done (TASK-040 to 052) | Section order and strip done; chart styling partly deviated (recorded in VERIFICATION.md) | Roadmap shortcuts present in sections | Visual match not checked | Rendered comparison (blocked) | Aggregation and thresholds unchanged | Suites pass; duplicate key unconfirmed (§10.3) |
| 06 roadmap | `/teams/[teamId]/roadmap` | Done (TASK-043) | Cards and stage transition; no timeline | Now/Next/Later grouping | Visual match not checked | Rendered comparison (blocked) | No invented dates or progress | Suites pass; not rendered |
| 07 my skills | `/me/skills` | Done (TASK-030, 031) | Completion summary and role rows; reference has bars per skill | Private summary | Per-skill bars | Rendered comparison (blocked) | Individual self-assessments stay private | Suites pass; not rendered |
| 08 my goals | `/me/goals` | Done (TASK-032) | Status cards; editor is disclosure, not reference's inline panel | Editor-as-disclosure gap (recorded) | Progress bars | Rendered comparison (blocked) | Goal ownership unchanged | Suites pass; not rendered |
| 09 conversations | `/me/conversations` | Done (TASK-033) | Grouped list and split layout | Participants, status, purpose visible | Visual match not checked | Rendered comparison (blocked) | Participant-only access unchanged | Suites pass; not rendered |
| 10 conversation detail | `/me/conversations/[id]` | Done (TASK-033) | Split layout, no chat. Intentional. | Structured conversation, not chat | Visual match not checked | Rendered comparison (blocked) | Encryption and participant-only access unchanged | Suites pass; not rendered |
| 11 admin teams | `/admin/teams`, `/admin/teams/[id]` | Done (TASK-060, 061) | Section index and tables; reference has denser tables | Admin actions unchanged | Density | Rendered comparison (blocked) | No new admin capabilities | Suites pass; not rendered |
| 12 admin roles | `/admin/roles` | Done (TASK-063) | Competency profiles, not permission toggles | Intentional | Permission toggles: **not implemented by design** | None | Roles are competency profiles, not access control | Suites pass; not rendered |
| 13 profile | `/me/profile` | Restructured this pass | Reference has bio, contact, role, team, skills and goals panels. Only display name is supported | Settings via inline form; no edit-profile button | Bio, phone, location, role, contact, skills and goals (no data) | None without a product and data decision (§10.4) | No invented fields; no private skills or goals on profile | Profile suites pass (621 of 621); not rendered |
| 14 mobile survey | `/survey/[surveyId]` | Done (TASK-020 to 023) | One-question stepper; 360 px check not performed | Previous/Next, progress | 360 px and reload checks | Rendered check (blocked) | Survey privacy wording unchanged; no autosave | Survey suites pass; not rendered |

### 10.3 Duplicate React key `"2"` in TeamDetail: unconfirmed

- Ran 182 suites (3,460 tests) under `src/features/teams`, `results`, `roadmap`, `team-skills`, `skill-trees`, `challenges`, `forum` and `app/(app)/teams`. **No duplicate-key warning appears in stderr.**
- The seed (`pnpm seed:demo-team`) was **not run**. It writes to the Firebase project named by `.env.local`, and that project was not verified to be a local emulator. Running it needs explicit approval, or an emulator setup in `docs/DEVELOPMENT.md`.
- Keys reviewed without a proven source: see §4.1.
- Status: **open, unconfirmed.** Reproduce in a browser with an emulator-seeded team, read the component stack, then fix the root cause.

### 10.4 Proposed follow-up tasks (not in `TASKS.md`)

These are proposals only. They do not redefine the completed product-experience tasks and do not bypass TASK-072 to TASK-074.

- **UX-8-A Signed-in home panels.** Goals summary (reuse owner-only goals read), next conversation (reuse owner-only conversation read), recommended steps (static links). *Decision needed:* whether the trend chart on `/` may reuse team results, which are aggregated and thresholded; this plan does not assume it.
- **UX-8-B Profile fields.** Bio, contact, location and role. *Decision needed* with privacy review: these are new personal data fields and need a data-model change. Not recommended without explicit approval.
- **UX-8-C Sign-in split layout.** Visual only, using existing copy. No dependency on decisions.
- **UX-8-D Browser verification.** Run TASK-072 to TASK-074 once a browser tool is available. The manual steps are in §10.5.

### 10.5 Manual verification steps (browser unavailable in this session)

1. Signed out: open `/`. Expect the public header and two actions. At 320, 360, 768 and 1280 px and 200% zoom, check for horizontal overflow.
2. Signed in: open `/`. Expect the sidebar (desktop) or drawer (below `md`), greeting, five quick links, and the team list. Confirm no "Logg inn" or "Opprett konto" appears.
3. Signed in: open `/sign-in` and `/sign-in?continue=/survey/abc`. Expect a redirect to `/teams` and to `/survey/abc`. Repeat with `continue=https://example.com`: expect `/teams`.
4. Signed out: open `/sign-in`. Sign in and confirm the success message and continue link still appear (no redirect).
5. `/me/profile`: confirm the display-name form is the main column and the aside collapses below it on phone widths. Tab through the form and the erasure link, confirming visible focus.
6. Toggle dark mode (Mørk) and repeat 1 to 5. Check console for errors.
7. Team overview: open a team with several results and look for a React warning containing `same key` in the console (§10.3).

---

## 11. Visual pass 3: root cause, changes and evidence (2026-11-03, third pass)

### 11.1 Reference inspection

All 14 PNGs in `docs/design/references/` were opened and inspected visually in this pass (not by filename). Key observations used as targets:

- **Shell:** deep forest-green sidebar with brand mark, grouped navigation, active item in a lighter green pill, landscape band at the sidebar foot; cream canvas; white rounded cards with thin borders and soft shadow; emerald primary buttons.
- **01 public home:** two-column hero with product preview, value strip, dark green trust band.
- **02 sign-in:** split screen, value points on the left, card on the right.
- **03 app home:** greeting band with landscape, quick cards, goals, next conversation, trend and next steps.
- **04 teams:** team cards with identity illustration, metrics and an action button.
- **05 team overview:** header with team identity and tabs, metric cards, needs table, trend chart, challenges, members.
- **06 roadmap:** stat tiles, Gantt-style timeline with quarter columns and a detail panel.
- **07 skills:** radar profile, competency bars with status chips, role comparison, suggestions.
- **08 goals:** progress ring, stat strip with landscape, tabs, goal cards with progress.
- **09 conversations / 10 detail:** list with filter chips, split detail with tabs. Reference 10 shows a chat; DevPulse conversations are structured, so only the layout is taken.
- **11 admin teams:** team cards with identity images, grid/list toggle, pagination.
- **12 admin roles:** role list with detail panel. The permission toggles are **not** implemented (competency profiles, not access control).
- **13 profile:** header band with avatar and landscape, tabs, panels. Only supported fields are used.
- **14 mobile survey:** phone frame, one question, large radio options, Forrige/Neste.

### 11.2 Root cause of the old look

Checked in this pass:

- `app/globals.css` did define tokens, but with a restrained palette: a white sidebar (`bg-surface`), teal primary (`#0b6b63`) and a neutral canvas. The DESIGN-SYSTEM values (forest-green sidebar, cream canvas, emerald primary) were never applied.
- `AppShell` rendered the sidebar with `bg-surface`, so the sidebar was white. This is why the old design persisted after the previous passes.
- `Card` variants used raw Tailwind palette classes (`border-zinc-200`), so they did not follow the surface tokens at all.
- Sidebar, drawer and public header had no brand mark.

These are token-value and component-class causes, not a stylesheet loading problem. The stylesheet loads (verified: computed backgrounds in screenshots below).

### 11.3 Changes made in this pass

| Area | Change | Files |
| --- | --- | --- |
| Tokens | Light and dark semantic values taken from DESIGN-SYSTEM.md (canvas `#FAF9F6`, primary `#087B5B`, primary-subtle `#DDF3E7`, borders). Sidebar tokens added (`--sidebar-background` etc.). Brand scale exposed as `brand-*` utilities. `--shadow-card` added. Muted text and strong border values adjusted to pass the TASK-002 contrast thresholds (checked by the guard test, not assumed). | `app/globals.css` |
| Sidebar | Dark forest-green sidebar with brand mark and original landscape band (SVG). Navigation uses sidebar tokens. Mobile drawer uses the same dark surface. | `src/components/nav/AppShell.tsx`, `NavGroupList.tsx`, `MobileDrawer.tsx`, `SidebarLandscape.tsx` (new) |
| Brand | `BrandMark` (rounded green tile with rising bars), used in sidebar and public header. | `src/components/ui/BrandMark.tsx` (new), `PublicHeader.tsx` |
| Cards | `bordered` = white surface, subtle border, soft shadow. `elevated` = white surface, elevated shadow. Removes raw zinc classes. | `src/components/ui/Card.tsx` |
| Public home `/` | Hero (two columns: eyebrow, headline, copy, CTAs, privacy line; right: original app preview with no figures), value strip with icons, dark trust band. Copy describes existing features only. | `app/page.tsx`, `app/page.copy.ts`, `src/features/home/components/HomePreview.tsx` (new) |
| Sign-in `/sign-in` | Split screen: headline and three value points on the left, form card on the right. Redirect gate and form unchanged. | `app/(public)/sign-in/page.tsx` |
| Authenticated home `/` | Greeting band with landscape illustration; quick cards and team list unchanged. No metrics added. | `src/features/home/components/AuthenticatedHome.tsx` |
| Allow-list | Removed entries for files that no longer contain raw colours (`Card.tsx`, `app/page.tsx`, `app/(public)/sign-in/page.tsx`). Counts elsewhere unchanged. | `src/lib/theme/raw-palette-allowlist.json` |
| Tests | Home test heading updated to the new h1. Sign-in test mocks the router and auth observer. | `app/page.test.tsx`, `app/(public)/sign-in/page.test.tsx` |

### 11.4 Verification performed

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass, 0 errors, 1 pre-existing warning |
| `pnpm test` | Pass, 518 files, 9,153 tests passed, 2 skipped |
| `pnpm build` | Pass (after removing `.next`) |
| Rendered screenshots (headless Chrome, device-emulated, production build) | Signed-out `/` at 1280 px and 390 px; `/sign-in` at 1280 px, 390 px. Files: `scratchpad/shots/final-home-1280.png`, `final-signin-1280.png`, `cdp-home-390.png`, `cdp-signin-390.png`. |
| Horizontal overflow (DevTools measurement) | None at 320, 390 and 753 px on `/` and `/sign-in`. |

Note on method: an earlier 390 px check using a headless window size showed overflow that was an artefact of the window, not the page. Device-emulated measurement through DevTools does not show it. The screenshots above are from device emulation.

### 11.5 Not verified in this pass

- **All signed-in routes** (sidebar at desktop, drawer on mobile, `/`, `/teams`, team pages, skills, goals, conversations, admin, profile, survey): they require a Firebase sign-in that is not available here. The sidebar and card changes apply to them in code but have **not been rendered**.
- **Pages 04 to 14 are not visually redesigned in this pass.** Their structure is unchanged; they inherit the new tokens, sidebar and cards only. Page-specific composition (team header, roadmap timeline, skill radar, goal ring, conversation split, admin cards, profile band, phone survey frame) is still open.
- **Dark mode**: token values were changed, but no rendered dark-mode screenshot was taken.
- **Breakpoints 360, 768 px and 200% zoom**: only 320 and 390 px were measured for overflow; 768 px for overflow only. No zoom check.
- **Accessibility**: contrast of the token pairs is checked by the guard test. No keyboard, screen-reader or axe run was performed in this pass.

### 11.6 Remaining work, in order

1. Render the signed-in shell: needs a test sign-in or an emulator session to capture `/`, `/teams`, `/teams/[teamId]`.
2. Page composition per reference: team overview header and metric row; roadmap timeline; skill radar and status chips; goal ring and cards; conversation split; admin cards and grid; profile header band; phone survey frame (14).
3. Dark-mode and 360/768/200% zoom captures, then axe and keyboard checks.
4. Duplicate key `"2"` in TeamDetail: still unconfirmed (see §10.3).

---

## 12. Phase B: Teams (2026-11-03, fourth pass)

### 12.1 Changes

| Route | Change | Files |
| --- | --- | --- |
| `/teams` | List rows replaced by a responsive card grid (1 / 2 / 3 columns). Each card has an original landscape identity derived from the team id, a larger team name, the relationship badge and the existing request-access button. No team metrics are shown: this list endpoint returns only name and relationship. | `src/features/teams/components/TeamsOverview.tsx`, `TeamIdentity.tsx` (new) |
| `/teams/[teamId]` | Header is a surface band with the team identity and an `h1`. Tabs are underlined navigation tabs with a border. The summary strip uses the surface and shadow tokens. Zone headings use the section-title token. Section order is unchanged (a test locks it). | `src/features/teams/components/TeamDetail.tsx`, `TeamRouteNav.tsx`, `TeamSummaryStrip.tsx` |
| `/teams/[teamId]/roadmap` | New quarter-axis timeline above the existing grouped list. Bars use only plans with both `startDate` and `targetDate`, placed by those dates. Nothing is estimated, and no progress is drawn. Hidden below `md`; the list remains the mobile view and the accessible source. | `src/features/roadmap/components/RoadmapGantt.tsx` (new), `RoadmapPage.tsx`, `copy.ts` |

### 12.2 Verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass, 0 errors, 1 pre-existing warning |
| `pnpm test` | Pass, 518 files, 9,153 tests passed, 2 skipped |
| `pnpm build` | Pass |
| Rendered | **No.** Team routes require Firebase sign-in, which is not available here. |

### 12.3 Not done in Phase B (open)

- **Team overview dashboard composition**: no metric-tile row, no two-column layout (needs/trend beside roadmap shortcuts and calendar), no members avatars. The zones are restyled, not recomposed. The section order test prevents a free re-layout without updating the test.
- **Roadmap milestones and Now / Next / Later panel**: the reference's detail side panel and quarter gridlines are not implemented.
- **Team identity imagery** is original and generic. It does not represent any team property.

### 12.4 Authenticated browser verification (Phase B request, item 1)

- Repository check: `src/lib/firebase/client.ts` takes `NEXT_PUBLIC_FIREBASE_*` values with no emulator connection. `firebase.json` configures only Firestore rules and indexes. `firebase-tools` is not installed. `.firebaserc` names `devpulse-ac26e` as the default project.
- No emulator or test-authentication path exists. Adding one would change the client auth path, which is security-sensitive, and needs an explicit decision.
- No Chrome-session automation tool was available in this session.
- Manual checklist for the user (run locally against an isolated project):
  1. `pnpm dev`, then open `http://localhost:3000/teams` after signing in. Check cards at 320, 768 and 1280 px.
  2. Open `http://localhost:3000/teams/<teamId>`. Check the header, tabs, summary strip and zone headings.
  3. Open `http://localhost:3000/teams/<teamId>/roadmap?view=timeline` at 1280 px. Check the chart bars match each plan's start and target dates. At 390 px the chart is hidden and the list is shown.
  4. Check dark mode (Mørk) on the same pages, and the browser console for errors.
