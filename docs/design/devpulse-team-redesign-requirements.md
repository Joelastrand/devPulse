# DevPulse — Team workspace & Mine ferdigheter redesign

**Document type:** Product requirements and implementation contract for Claude Code  
**Status:** Draft for owner review; no implementation authorization implied  
**Language:** Norwegian Bokmål for all end-user UI; English technical identifiers where appropriate  
**Scope:** Team `Oversikt`, `Roadmap`, `Kompetanseplan`, `Teamkompetanse`, and `/me/skills` (`Mine ferdigheter`), including administration, privacy, APIs, data models, tests, accessibility, and visual verification.

> **Source of truth:** This document captures the owner's stated requirements and the design direction in the five generated mockups. Mockups illustrate visual intent, not verified functionality, real user data, or authorization to show individual scores. Where the mockups conflict with privacy requirements, the privacy requirements win.

## 0. Project context and non-negotiable constraints

DevPulse is a privacy-first Norwegian Next.js App Router / TypeScript / Firebase application. Firestore access is mediated by authorized server gateways; client Firestore rules are deny-all. Existing sensitive conversation data uses AES-256-GCM encryption. Preserve existing team membership authorization, team isolation, account-erasure contracts, and unrelated working-tree changes.

- Do not implement employee ranking, performance scoring, surveillance, gamification, utilization monitoring, inferred productivity, or fabricated competence metrics.
- Personal skill ratings are self-assessments, not certified qualifications or employment performance indicators.
- Team admins manage the **catalog and team relevance** of competence areas, not employees' private self-ratings.
- All team aggregates must be privacy-safe and explainable. No member drill-down to individual ratings, no identifiable contributions, and no individual-vs-team ranking.
- Never use invented values as real data. Mockup values are illustrative only.
- Preserve existing app architecture, established design system, Norwegian copy, keyboard support, responsive behavior, light/dark themes, and server-side authorization.
- Do not commit, push, deploy, reset, stash, clean, discard changes, or modify shared/production Firebase data without explicit owner authorization.

## 1. Visual reference inventory and handoff

Five design sketches were generated during this design discussion:

1. Redesigned Team **Oversikt**.
2. Redesigned Team **Roadmap**.
3. Redesigned Team **Kompetanseplan**.
4. Redesigned Team **Teamkompetanse** (radar, competence-area distribution, aggregated area table).
5. Redesigned **Mine ferdigheter** (`/me/skills`) (radar, compact skill table, role direction, and team-sharing control).

**Action required before implementation:** Save all five actual images into `docs/design/references/` with stable descriptive filenames and insert their verified exact paths here. Do not guess filenames or claim the assets exist in the repository. Claude Code must inspect the images, map each reference to its page, and record visual deviations. Earlier references `15-system-overview.png`, `16-system-overview-table.png`, and `17-system-overview-form.png` relate to Systemoversikt and are not substitutes for these five images.

Suggested filenames **only after the images have actually been copied**:

- `18-team-overview.png`
- `19-team-roadmap.png`
- `20-team-competence-plan.png`
- `21-team-competence.png`
- `22-my-skills.png`

The new screens should visually align with the established DevPulse style: dark forest-green sidebar, off-white page background, restrained emerald accents, rounded cards, clear typographic hierarchy, generous but efficient spacing, consistent iconography, readable tables, and accessible status indicators. Do not copy fake statistics or placeholder names into production.

## 2. Information architecture

Team detail should expose five coherent tabs:

| Route / tab | Purpose | Main content |
|---|---|---|
| `Oversikt` | Short, action-oriented team landing page | Few important summaries, current priorities, clear links |
| `Roadmap` | What products/projects the team plans to work on, and when | 3-/6-month Gantt, projects, planned participation |
| `Kompetanseplan` | Which team capabilities should be developed | Competence needs, target states, milestones, learning actions |
| `Teamkompetanse` | Privacy-safe aggregate of team capabilities | Radar, aggregate distribution, area coverage, disclosure |
| `Systemoversikt` | Existing system inventory and qualitative quality/risk | Preserve existing feature; only shared navigation/style alignment |

`/me/skills` remains a separate personal page and is the **source of members' self-assessments** for approved team aggregates. Do not make personal skills editable from the team dashboard.

The current very long Team overview contains survey history, survey trends, challenges, competence ladders, and member-related blocks. Move secondary content into existing appropriate routes or accessible secondary detail pages/sections; do not silently remove features or links. Provide a documented old-to-new content mapping and ensure navigation remains discoverable.

## 3. Team `Oversikt`: compact landing page

### 3.1 Primary UX

- Team name and short description, optional existing team image/identity, and concise metadata.
- Three or four useful summary cards maximum, sourced from authorized real data; candidate summaries: open challenges, active projects, systems needing attention, current competence-plan priorities.
- A small `Neste steg` area with up to three actionable items and links to full tabs.
- Optionally a concise survey summary when a publishable survey exists, but not the entire history or large trend charts.
- Target: substantially shorter than the existing overview, ideally one screen or approximately one to two viewports on typical desktop, without arbitrarily truncating essential actions.
- Loading, empty, suppressed, and error states must be explicit. Never show a fake `0` when the result is still loading.

### 3.2 Consistency

- Roadmap status must use the existing approved effective-status/date resolver consistently: start date today/past => `Pågår`, except completed/terminal states; target date alone does not imply completion.
- Summary counts must agree with their respective detail pages, with consistent archive filters and team scope.
- Preserve privacy rules for survey publication thresholds and challenges.

## 4. Team `Roadmap`: project planning, not competence ladders

### 4.1 Purpose and data separation

The new Roadmap describes planned **products, initiatives, projects, and member participation**. The existing competence-area maturity ladder belongs in `Kompetanseplan`, not Roadmap. Do not conflate a competence milestone with a delivery project.

### 4.2 Planning model

- Team-scoped products/initiatives (where relevant), each containing zero or more projects.
- Project fields: stable ID, team ID, title, optional description, optional product link, start/end calendar dates, lifecycle status, priority, optional owner/contact, optional milestone list, created/updated audit fields, archive state.
- Planned project participation: member reference scoped to the same team, project ID, start/end dates or intervals, optional non-evaluative participation description; **no percentage utilization, capacity score, productivity, time tracking, or employee performance indicators**.
- A project may span multiple months and multiple participants; a participant may be associated with multiple projects.
- Explicitly validate date order, missing dates, overlapping assignments (informational only), team membership, project ownership, and archival behavior.
- Do not assume that current competence-roadmap documents can safely be reinterpreted as delivery projects. Plan a non-destructive migration/compatibility strategy, or create a separate model and preserve legacy competence plans.

### 4.3 Gantt UI

- Toggle `3 måneder` / `6 måneder`; clear current date, month headers, and accessible date ranges.
- Top level: grouped products/initiatives and their projects, with collapsible rows and milestone markers.
- Second level: `Prosjektdeltakelse` grouped by project or team member. Provide a reversible view toggle, not a separate hidden dataset.
- Desktop: synchronized sticky labels and horizontally scrollable timeline; no clipped bars or misaligned month columns.
- Mobile: accessible compact project cards and date ranges; do not force an unreadable miniature Gantt.
- Bar colors must be backed by text labels; status, date and priority must remain understandable without color.
- View filters for status, priority, project/product, and archive if supported; sensible sorting; clear empty state.
- Project create/edit and participation edit must be restricted to existing authorized team roles; ordinary members can view according to team membership policy.
- Avoid introducing notifications, calendar integrations, or external resource tracking unless separately approved.

### 4.4 Status/date rules

Reuse the established domain effective-status resolver. Start dates are calendar dates; test timezone, month/year boundaries, completed plans, and absent dates. A past start date means effective `Pågår` for eligible nonterminal plans, and all list, Gantt, filter, summary, and overview consumers must agree. Preserve explicit completion and archival semantics.

## 5. `Kompetanseplan`: team capability development

### 5.1 Purpose

Plan which competencies the **team** needs to strengthen, independent of individual self-assessment or project staffing. Reuse existing competence-area needs and maturity-step information where safe, but redesign the UI into compact, readable cards.

### 5.2 Data and actions

- Competence area selected from the admin-managed team catalog.
- Desired future capability or outcome, current plan stage, ordered milestones, target stage, optional target date, priority, optional rationale and learning activities.
- Explicit statuses such as `Planlagt`, `Pågår`, `Fullført` where appropriate; never infer a person's ability from completion of team milestones.
- Card shows area name, desired outcome, current/next stage, milestone progress **as plan-step completion only**, priority, and link to detail/edit.
- Expanded detail shows timeline/steps, rationale, optional activities and authorized edit actions.
- Add/edit/archive with existing team authorization; audit changes; maintain legacy records without destructive migration.
- Link to relevant Teamkompetanse aggregate where permitted, but do not auto-create individual development assignments or expose personal ratings.

### 5.3 UX

- Search/filter by area, priority, status; clear planned/active/completed distinction.
- Responsive card layout, concise labels, no sprawling full-height stage ladders by default.
- Collapsible details and optional milestone timeline; strong empty state explaining how a team admin creates a plan.

## 6. Admin-managed competence catalog

### 6.1 Ownership

**Administrators define the competence areas that users can self-rate.** This must be implemented as an explicit catalog management workflow using the application's existing authorization model, not by granting broad Firestore client access.

- Inspect existing admin Team/Roller/competence-area models and decide whether the catalog is global, team-scoped, or a combination. Prefer reuse of existing entities, avoiding duplicate names and divergent IDs.
- An authorized team administrator can add, edit, reorder, activate/deactivate, and archive team-relevant areas.
- Each area has stable ID, Norwegian name, short description, optional icon/category, display order, active state, timestamps, and optional link to role expectation profiles.
- Users see only eligible areas for their current context; no need to invent skills outside the catalog.
- Admin can define **team targets/expectations**, but cannot read or modify an individual's private self-assessment.
- Changes to an area's name must not orphan existing self-assessments. Archive rather than destructive delete when referenced; document behavior when an area is removed from a team.
- Team A's catalog and aggregates must not leak into Team B. Shared/global catalog entities may be visible across teams only when intentionally designed and authorized.
- Existing `role expectation profiles` represent competency expectations, **not authorization roles**. Keep this distinction explicit.

### 6.2 Skill rating semantics

Retain or carefully map the current four-level self-assessment vocabulary:

1. `Grunnleggende kjennskap`
2. `Kan med støtte`
3. `Kan selvstendig`
4. `Avansert`

`Ikke vurdert` is missing data, not zero. Do not present the scale as an objective certification, employee grade, or universally comparable productivity score. Preserve existing data and audit semantics; any normalization must be versioned and tested.

## 7. `/me/skills` — redesigned `Mine ferdigheter`

### 7.1 Layout

Use the generated Mine ferdigheter mockup as the visual direction, subject to privacy corrections:

- Clear title and short explanation.
- Compact tabs/sections: `Oversikt`, `Ferdigheter`, `Utviklingsmål`, `Roller og karriere` where they correspond to real functionality; avoid dead tabs.
- Summary cards: assessed skills count, optional private personal average **only if a valid existing calculation is approved**, number of eligible areas; never manufacture a score.
- Personal radar chart using the user's own rated areas; do not invent values for unrated areas. A chart should only render if the number of comparable dimensions is sufficient; otherwise use a clear empty state.
- Compact list/table of admin-defined skills with one accessible rating control per area, level description, `Vurdert`/`Ikke vurdert` filters, save feedback, and optional detail.
- Role comparison remains **private to the user** and uses role expectation profiles, not team-admin access to personal data.
- Personal development suggestions must be optional and based on legitimate available data; no unsupported AI-derived claims.
- Avoid duplicated personal vs team comparison visuals that could reveal small-group private values.

### 7.2 Team-sharing control — explicit owner requirement

Provide a prominent control near the page header:

**`Del kompetanse med teamet`** / `Kompetanse deles med teamet`.

**Desired product default: ON for newly configured eligible team participation.** The user must be able to turn sharing OFF at any time, and turn it ON again later. For multiple teams, provide an explicit team-by-team setting, not an ambiguous global switch. Display the selected team and the current state. Persist choices securely.

**Critical privacy implementation rule:** Default ON is the owner's product preference, but it must **not silently publish previously private self-assessments** or override an existing opt-out. Before any rollout, inspect current privacy promises, consent contracts, and applicable legal/privacy requirements. If existing users were promised opt-in or private-only ratings, preserve those protections until a lawful, clearly disclosed transition is approved. If default-on cannot be safely supported, document the blocker and request a specific owner decision; do not quietly weaken privacy.

Required behavior:

- Clearly explain before or at first eligible use **what is shared**: eligible ratings contribute only to privacy-protected team aggregates, not individual ratings or identities.
- Clearly explain **who can see**: authorized team members see only aggregates that meet the publication threshold; admins do not get raw personal ratings.
- Show an obvious `Av` state and a confirmation/feedback when sharing changes.
- Turning OFF immediately excludes the user's contribution from future team aggregates and invalidates/recomputes cached aggregates. No previously exposed individual data may exist to retract.
- Turning ON includes only current eligible ratings after privacy checks, never unreviewed external data.
- A user with multiple teams controls each independently. Joining a new team must show a contextual explanation of its default sharing state.
- Leaving a team, account erasure, or revoked membership removes that person's contribution from that team's aggregates and refreshes derived views.
- An opt-out is durable across sessions, devices, team renames, and subsequent feature releases; do not silently reset it.
- Admins cannot override a user's opt-out or see which particular individuals opted out unless a narrowly justified existing authorization/consent model explicitly permits it; prefer no identifiable sharing-participation roster.
- Never show a user's own rating as a separate team-visible row or allow reverse engineering through filters or tiny groups.

Suggested explanatory Norwegian copy:

> `Når deling er på, kan vurderingene dine bidra til en samlet kompetanseoversikt for teamet. Ingen i teamet, heller ikke administratorer, kan se dine individuelle nivåer. Du kan slå av deling når som helst.`

Avoid the misleading label `Synlig for: Demoteam` if it suggests individual scores are visible. Prefer `Bidrar til aggregert oversikt for: Demoteam`.

### 7.3 Rating and save behavior

- Rating changes save via existing authorized server write paths, with visible success/error feedback and no silent loss.
- `Ikke vurdert` remains distinct from a low rating.
- Changes must update eligible aggregates safely and predictably; avoid stale cached values.
- Rating data is private at rest and in APIs; never return raw peer ratings through team endpoints, logs, analytics, browser payloads, or client caches.

## 8. `Teamkompetanse` — aggregated team competence

### 8.1 Content

- Team competency radar for selected admin-defined team areas **only where publishable**.
- Optional donut chart for the distribution of team **area statuses**, not people. Legend and counts must be internally consistent.
- Compact table of area names, qualitative aggregate coverage/status, and team target where permitted.
- Clear explanation of data origin, optional participation, threshold, and limitations.
- Show `Ikke nok grunnlag` or `Ikke vurdert` rather than fake zeros or averages when data are missing or suppressed.
- Optional historical trend only if snapshots are legitimate, comparable, privacy-safe, and already available or explicitly planned; do not fabricate history or backfill with synthetic points.
- Do not display `12 medlemmer har bidratt` or similar counts unless they are real and safe to publish; exact contributor counts can facilitate inference in small groups. Consider suppressed or coarse counts.

### 8.2 Aggregation and publication policy

**Privacy threshold must be explicitly decided and documented before implementation.** Existing DevPulse team competence-needs rules may already use a minimum of five contributors for coarse statuses. Inspect and reuse the actual applicable policy; do not assume that a threshold sufficient for a coarse `dekket/ikke dekket` signal also permits numeric averages, radar plots, trend lines, or fine-grained per-area comparisons.

Preferred safe baseline until a stronger approved privacy design exists:

- No public individual scores, identities, rankings, exact distribution by member, or per-member participation indicators.
- Only publish coarse area-level statuses (`Dekket`, `Delvis dekket`, `Behov for utvikling`, `Ikke nok grunnlag`) when an approved minimum cohort threshold and anti-inference checks are satisfied.
- Numeric averages and radar coordinates based on individual ratings require **separate explicit privacy review/approval**. If not approved, use a qualitative radar alternative or omit the radar rather than exposing disclosive precision.
- Apply suppression for small cohorts and for filtered subsets; avoid difference attacks across teams, time windows, or single-member membership changes.
- Do not reveal suppressed information through API response shape, sorting, chart tooltips, exports, loading behavior, or error text.
- Recompute after opt-out, membership change, deletion, or account erasure. Ensure historical trend views cannot be used to reconstruct a departed person's rating.
- If an area lacks enough data, hide/suppress its quantitative value and explain why; do not treat absent responses as `0` or `God`.
- An admin-defined target is a team aspiration, not an assessment of a particular employee.

### 8.3 Team membership and authorization

- Team aggregate read: only authorized members of the corresponding team.
- Catalog/target edit: only existing authorized team administration roles.
- Self-assessment write: only the authenticated user for their own skill record.
- Sharing preference write: only the authenticated user for their own team-specific preference.
- No cross-team joining of raw scores, no privileged admin bypass, and no client Firestore direct access.

## 9. Data contracts and migration

Before coding, inventory existing Firestore collections, schemas, gateways, role profiles, competence-area IDs, participation preferences, privacy documentation, and account-erasure inventory. Write a compatibility/migration plan with no destructive changes.

Conceptual entities (adapt names to repository conventions):

- `CompetenceArea`: stable area ID, label, description, catalog scope, active/archived, order.
- `TeamCompetenceArea`: team-to-area association and optional team target, priority.
- `PersonalSkillAssessment`: owner user ID, area ID, level or unrated, timestamps; private.
- `TeamSkillSharingPreference`: user/team membership reference, enabled, consent/disclosure version if required, timestamps; private.
- `TeamCompetenceAggregate`: team ID, area ID, coarse status, threshold/suppression metadata, optional approved derived value, freshness timestamp; no member-level data.
- `TeamProject` / `TeamProjectParticipation`: project timeline and member participation, separate from skills.
- `TeamCompetencePlan`: team capability milestones and target states.

Requirements:

1. No breaking changes to existing `/me/skills` records or competence plans.
2. Legacy data remains readable; new fields default safely and do not misrepresent missing assessments.
3. Document treatment of existing users whose sharing preference is absent. **Do not automatically infer consent from missing preference for previously private data.**
4. Server validation for all IDs, team membership, dates, rating enums, descriptions, and permissions.
5. Firestore query/index plan, bounded pagination, and no arbitrary fixed member cap that silently changes aggregate results.
6. Account-erasure inventory must cover all new user/team references, cached aggregate dependencies, actor fields, and participation links.
7. Cache invalidation must handle rating changes, sharing toggle, team join/leave, area archive, and deletion.
8. No exposure of raw private ratings in client HTML, React server payloads, logs, or analytics.
9. Document whether aggregation is computed on demand or materialized, including privacy-safe invalidation and authorization.

## 10. Cross-page interaction contract

- Admin adds an area -> eligible members can see it in `/me/skills` and self-rate privately.
- Member rates an area -> personal UI updates; team aggregate updates **only if that member's team-specific sharing is enabled and privacy rules permit publication**.
- Member disables sharing -> team aggregates cease including their ratings; personal ratings remain intact.
- Admin adjusts a team target -> Teamkompetanse target changes; personal rating remains untouched.
- Admin creates a competence development plan -> Kompetanseplan shows milestones; no automatic member score assignment.
- Admin creates a project -> Roadmap Gantt and compact Oversikt summaries update.
- Team membership changes -> all team-scoped reads and aggregates remain isolated and correctly recalculated.
- User account erasure -> personal assessments and sharing records follow the existing deletion contract, team aggregates are recalculated/suppressed, and other members' data is preserved.

## 11. UX and accessibility acceptance

- Norwegian Bokmål labels, explanations, empty states, validation, and accessible names.
- Responsive widths at least 320, 360, 768, 1024, 1280, and 1440 px; light and dark themes.
- No horizontal page overflow, clipped headings, awkward word breaks, or misaligned controls. Localized text must wrap at natural word boundaries.
- Search icons must be vertically centered inside search inputs (a known prior UI defect).
- Keyboard operation for tabs, Gantt alternatives, dialogs, filters, dropdowns, toggles, chart data tables, and all save actions.
- Focus visible, appropriate labels and descriptions, WCAG AA contrast, touch targets, and semantic headings.
- Charts must have accessible summaries or equivalent data tables; do not rely on color alone.
- Info icons explaining each competence field, rating scale, aggregation and sharing; keyboard-accessible popover/dialog, not hover-only tooltip.
- Stable loading skeletons and explicit error/empty/suppressed states; no false metrics during loading.
- Compact desktop information hierarchy; mobile cards and progressive disclosure.
- Visual comparison against **each** saved sketch, documenting justified deviations (especially privacy-driven ones).

## 12. Verification matrix

### Unit tests

- Four rating levels and unrated semantics.
- Catalog create/edit/archive and stable ID behavior.
- Team-specific sharing defaults, explicit opt-out, persistence, re-enable, multi-team isolation, and legacy no-preference handling.
- Aggregate eligibility, threshold, suppression, missing values, small cohorts, changes in membership, and cache invalidation.
- Date-based roadmap effective status and 3-/6-month timeline boundaries.
- Competence-plan milestone progression without employee scoring.

### Integration / authorization tests

- Only self can read/write private ratings and sharing settings.
- Team admin can manage catalog/targets but cannot access private member ratings.
- Team A cannot access Team B catalog-specific data, projects, participation, or aggregates.
- Opt-out affects only selected team and preserves private ratings.
- Erasure and team leave remove contributions and do not leave revealing cached summaries.
- Legacy records remain readable; no accidental migration of competence ladder into project Gantt.
- All dashboard counts and statuses agree with detail pages.

### Browser / accessibility tests

- Five redesigned views plus catalog admin workflow.
- End-to-end: admin adds competence area -> user rates -> team-sharing state -> publishable/suppressed team view -> user opts out -> aggregate changes.
- 3-/6-month Gantt, member grouping, mobile fallback, filters, empty states.
- Keyboard navigation, screen-reader spot check where available, automated axe checks, focus, chart alternatives, themes, and viewport screenshots.
- Isolated fixtures only; never write to shared/production Firebase data.
- Record each test's actual exit code and screenshots. Unavailable browser or assistive technology checks must be `not_verified`, never `passed`.

### Quality gates

Run after final changes: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Distinguish pre-existing warnings from regressions. Do not report a command as passed without reading its exit code.

## 13. Implementation workflow for Claude Code

1. **Inspect:** working tree, existing features, schemas, security/erasure rules, app routes, available design references and established Claude Code skills.
2. **Plan:** use existing `/plan-feature` skill and write a cohesive SPEC with owner decisions, non-goals, privacy review, migration, acceptance criteria and exact reference image paths.
3. **Split:** use `/split-tasks` to create dependency-ordered tasks. Suggested sequence: catalog/data audit -> privacy/sharing contract -> personal skills UI -> aggregate gateway -> Teamkompetanse -> competence plan -> project Gantt -> compact overview -> full integration/visual tests.
4. **Implement:** use `/implement-feature`; proceed autonomously through approved, non-destructive work; do not stop after foundation-only changes or request already-settled decisions again.
5. **Verify:** run focused and full tests, browser comparisons, accessibility, authorization and account-erasure regression checks.
6. **Document:** keep SPEC/TASKS/VERIFICATION aligned with actual behavior and unresolved owner decisions.
7. **Report:** changed routes/components, migrations, privacy decisions, verified screenshots, test results, known limitations, and working-tree status.

**Do not silently reinterpret requirements.** If a genuinely unresolved product/privacy decision blocks safe implementation, present the narrow decision with options and proceed with independent work. Never claim the UI is finished when only domain/storage code is finished.

## 14. Explicit decisions and remaining approval gates

### Already specified by owner

- Team overview should be short and focused.
- Roadmap should show products/projects and planned member participation with 3-/6-month Gantt horizons.
- Competence planning gets its own tab, replacing the sprawling ladder presentation.
- Team competence gets its own tab with a visual profile inspired by Mine ferdigheter.
- `/me/skills` should be visually redesigned and connected to team competence.
- Administrators define the competence areas users may self-rate.
- Team competence sharing should be **enabled by default for new eligible participation**, with an obvious user-controlled OFF switch.

### Must be confirmed or justified during planning

1. Exact sharing transition for **existing** users with private ratings and no explicit prior sharing choice. Preserve current privacy promises until approved.
2. Whether the existing five-contributor publication rule applies to this data and whether **numeric team averages, radar polygons, and trends** are permitted. Default to coarse protected statuses pending approval.
3. Exact administrator role and catalog scope (global/team/both), based on existing authorization architecture.
4. Which current survey/challenge/history blocks move to which existing routes, ensuring none disappear.
5. Whether member project participation is visible to all team members or a narrower authorized audience; it must never become employee monitoring.
6. Verified actual filesystem paths for the five design references.

## 15. Definition of done

The redesign is complete only when:

- All five views exist and match the approved design intent within documented responsive/accessibility/privacy constraints.
- Admin-managed competence areas flow into personal self-assessments.
- Per-team default-sharing behavior is implemented with clear disclosure, durable opt-out, safe legacy handling, and no individual rating exposure.
- Teamkompetanse shows **only privacy-approved publishable aggregates** and handles suppression correctly.
- Roadmap has genuine project/participation data and usable 3-/6-month Gantt plus mobile alternative.
- Kompetanseplan contains team capability milestones, separate from projects and individual scores.
- Oversikt is concise, accurate, and linked to the deeper views.
- Authorization, team isolation, account erasure, compatibility, accessibility and quality gates are verified.
- No unauthorized commit, push, deploy or destructive data operation occurs.
