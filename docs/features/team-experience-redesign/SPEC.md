# Team Experience Redesign and My Skills Integration

## Status
Draft — awaiting owner approval. Two blocking decisions (D1, D2) conflict with `docs/SECURITY.md` invariants 32, 34 and 35 and must be resolved before the affected parts are implemented. Sources: `docs/design/devpulse-team-redesign-requirements.md` (the requirements, referred to as **REQ §n**) and the six reference images in `docs/design/references/`.

## Problem
The team workspace has grown into a long overview page, a competence-stage roadmap that mixes competence milestones with delivery planning, and a `/me/skills` page that does not show the user's own profile or sharing state. Team members cannot see a concise, privacy-safe picture of team competence.

## User outcome
- **Team members** get a concise Oversikt, a project roadmap with 3/6-month Gantt and planned project participation, a team competence plan, and a privacy-thresholded team competence view.
- **Individuals** get a redesigned `/me/skills` with a personal profile, a per-team sharing control and clear disclosure.
- **Team admins** manage the competence catalog and team targets without access to private ratings.

## Scope
- Team tabs `Oversikt`, `Roadmap`, `Kompetanseplan`, `Teamkompetanse`, `Systemoversikt`, with a shared header and tab navigation. Existing deep links are kept.
- Compact Team Oversikt with real-data summaries and a `Neste steg` list, and a documented old-to-new content mapping (REQ §2, §3).
- Project roadmap: products/projects, project status and priority, project-to-product link, and planned member participation. 3-month and 6-month Gantt with a mobile fallback (REQ §4).
- Kompetanseplan: team competence development plans with milestones (plan-step progress only) (REQ §5).
- Teamkompetanse: privacy-thresholded team view built on the existing C2 coverage model (REQ §8).
- `/me/skills`: redesigned layout with the personal profile, the four-level scale, and a per-team sharing control (REQ §7).
- Account-erasure inventory updates for every new user-linked record (REQ §10).

## Out of scope
- Employee ranking, productivity or utilization, performance scoring, gamification, surveillance (REQ §0).
- Notifications, calendar integration, external resource tracking (REQ §4.3).
- Any shared-data or production Firestore migration (REQ §6).
- Commit, push, deploy.
- Changes to `Systemoversikt` beyond shared navigation and styling (REQ §2).

## Key concepts
- **Competence area (katalogområde):** an admin-defined area a member can rate. Reuses the existing skill-tree catalog (see D4).
- **Rating levels:** `Grunnleggende kjennskap`, `Kan med støtte`, `Kan selvstendig`, `Avansert`. `Ikke vurdert` is missing data, not zero (REQ §6.2).
- **Team competence coverage:** the existing categorical, privacy-thresholded result from C2 (`team-skills`): `covered`, `gap`, `insufficient_data`.
- **Project:** a team-scoped delivery item with dates, status, priority and optional product link. Separate from competence (REQ §4.1).
- **Project participation:** an explicitly recorded member-to-project planning interval. Not a utilization measure.

## Actors and access
| Actor | Can |
|---|---|
| Team member | View Oversikt, Roadmap, Kompetanseplan, Teamkompetanse (aggregates only, when permitted). Own ratings and own sharing preference. |
| Team admin/lead (existing role model) | Manage projects, participation, competence plans and catalog/team targets. Cannot read individual ratings. |
| App admin | Nothing beyond existing rules. Cannot read private ratings or override opt-outs. |
| Owner of a rating | Read and write own ratings and sharing preferences. |

Authorization uses `authorizeTeamAccess` and `resolveTeamRole`. Client Firestore access is not added (REQ §8.3).

## User stories
1. As a team member, I want a short Oversikt so that I see what needs attention next.
2. As a team member, I want a 3/6-month project timeline so that I see what the team plans and when.
3. As a team admin, I want to plan project participation so that the team's planned work is visible.
4. As a team admin, I want to define competence development plans so that the team's capability goals are explicit.
5. As a team member, I want to rate my own competence areas so that I can track my own development.
6. As a team member, I want to control whether my ratings contribute to team aggregates so that I keep control over my data.
7. As a team member, I want to see a team competence view that never exposes individual ratings.

## Behavioral requirements
Requirement IDs `BR-n` are stable. The REQ section is noted for traceability.

**Team Oversikt**
- BR-1: Oversikt shows at most four summary cards with real counts: open challenges, active projects, systems needing follow-up, and competence-plan priorities (REQ §3.1).
- BR-2: Summary counts agree with their detail tabs under the same team scope and archive filters (REQ §3.2).
- BR-3: `Neste steg` shows at most three items, each linking to a detail tab (REQ §3.1).
- BR-4: Loading, empty, suppressed and error states are explicit. A loading count is never shown as `0` (REQ §3.1).
- BR-5: Survey history, survey trends and large competence ladders move to existing routes (old-to-new mapping in the SPEC appendix, to be completed in TASK-010) (REQ §2, OQ-4).

**Roadmap (projects)**
- BR-6: A team can create, edit, archive and restore projects. Required fields are title, start date, end date and status. End date must not be before start date (REQ §4.2).
- BR-7: A project may link to a team product. The product must belong to the same team (REQ §4.2).
- BR-8: Project participation records link a same-team member and a same-team project with a date interval. Overlapping intervals are shown informationally only (REQ §4.2). A team lead may reassign an existing record to another active same-team member or project, and change its dates, in one atomic update that keeps the record's identity: no delete-then-create, no second record. The member and project must each belong to the team and be current (a removed member or an archived project is refused).
- BR-9: Effective status uses the existing resolver: a non-terminal project whose start date is today or earlier shows `Pågår`. A completed project stays completed. A target date alone does not imply completion (REQ §4.4).
- BR-10: The Gantt has 3-month and 6-month views, month headers, a today marker, bars positioned from real start and end dates, and text labels for status, dates and priority (REQ §4.3).
- BR-11: On mobile (below 768 px), a Gantt is replaced by accessible project cards with date ranges (REQ §4.3).
- BR-12: Member participation is grouped by project and by member, with a reversible view toggle (REQ §4.3).
- BR-13: Only explicitly recorded participation is shown. No utilization, capacity, productivity or performance values are computed (REQ §4.2, §0).
- BR-14: Existing competence-stage roadmap records are not reinterpreted as projects (REQ §4.2, §6).

**Kompetanseplan**
- BR-15: A team can create, edit and archive competence development plans for a team competence area. Plans have a priority, a target stage and an ordered list of milestones (REQ §5.2).
- BR-16: Progress is the count of completed milestones out of the total. It is plan-step completion only and is never a person's skill level (REQ §5.2).
- BR-17: Existing competence-stage records remain readable and are shown in the Kompetanseplan, unchanged (REQ §9.2).

**Catalog and ratings**
- BR-18: Team admins can create, rename, reorder, activate, deactivate and archive team competence areas. Areas referenced by a rating are archived, not deleted (REQ §6.1).
- BR-19: A rating is saved only by its owner, through an authorized server write. Each rating is one of the four levels or `Ikke vurdert`, and `Ikke vurdert` is never stored as a low level (REQ §6.2, §7.3).
- BR-20: The personal profile on `/me/skills` shows only the user's own ratings. **Amended by owner decision OD-1 (2026-11-06): no radar or other skills chart is rendered.** The profile uses competence cards, the four existing levels, clear level labels, non-chart progress indicators, development actions and empty/unassessed states (REQ §7.1). No numeric competence score is computed or persisted.

**Sharing**
- BR-21: Sharing is a per-team preference owned by the user. The control on `/me/skills` names the team and shows its state (REQ §7.2).
- BR-22: Turning sharing off removes the user's contribution from future team aggregates. Turning it on includes only current eligible ratings after privacy checks (REQ §7.2).
- BR-23: The sharing explanation dialog states what is shared, who can see it, what stays private, how aggregation works, and what happens when sharing is turned off or the user leaves a team (REQ §7.2).
- BR-24: Sharing defaults for new eligible participation and for existing users are set by decision D1 (blocked).

**Teamkompetanse**
- BR-25: Teamkompetanse shows categorical per-area coverage (`Dekket`, `Delvis dekket`, `Behov for utvikling`, `Ikke nok grunnlag`) for team areas that have enough eligible contributors. Areas below the threshold show `Ikke nok grunnlag` (REQ §8.2).
- BR-26: No per-member data, contributor counts or trends are shown. Automatic mode shows one numeric aggregated team level per competence area (the rounded arithmetic mean of eligible members' valid levels, three contributors minimum; owner decisions R-1 and R-2, 2026-11-07), only where the publication under invariant 35 permits it. Missing or suppressed values are unavailable, never zero. Averages across areas, per-member values and trends remain not shown. The numeric publication needs security and privacy review before activation (Amendment A §A.14).
- BR-27: Every chart has a text alternative and an equivalent data table (REQ §8.1, §11).

**Compatibility and erasure**
- BR-28: Personal assessments, team needs, competence plans, roadmap records, survey records and System Overview records remain readable. No destructive migration (REQ §9).
- BR-29: Account erasure removes or detaches all new user-linked records: sharing preferences, project participation, audit actor fields and derived views (REQ §10).

**Navigation**
- BR-30: The team header (name, description, member/system/area counts) and five tabs are shared by all team pages. The active tab has `aria-current`, tabs are keyboard operable, and existing `/teams/[teamId]/roadmap` and `/teams/[teamId]/systems` links keep working (REQ §2, §4).

## Edge cases and failure behavior
- A project's product is archived: the project remains visible and is labelled `Ingen produkt` in the link field.
- A participant leaves the team: their participation records are removed from the team roadmap view.
- A catalog area is archived while a team plan references it: the plan keeps its reference and shows the area as archived.
- A cohort is below k=5: the area shows `Ikke nok grunnlag`, and the response has the same shape as other suppressed states.
- Invalid or missing persisted data (dates, enums): the read returns an explicit error state for that record and does not coerce it to a default.

## Security and privacy
The feature touches team authorization, personal skill assessments, sharing preferences, aggregates and account erasure. The implications below apply `docs/SECURITY.md`; the document itself is not copied here.

- **Personal assessments remain owner-only.** No team admin, lead, app admin or other member can read them (SECURITY invariant 31; `skillProfiles` is owner-only in C1).
- **Team aggregates use the existing C2 reader.** Only the single batch module may read `skillProfiles`, and only for participants with an effective per-team participation record. The `k = 5` threshold is not configurable (SECURITY invariants 32–34).
- **Existing sharing control.** C2 already implements the per-team opt-in as `teamMemberships.skillContribution` (presence = opt-in, no negative state, lapses on a notice-version bump; see `docs/DATA-MODEL.md`). The redesigned control reuses this record rather than adding a second preference store.
- **Derived data is not persisted.** Aggregates are recomputed per request. No snapshot, cache or trend is stored (SECURITY invariant 35). **This conflicts with REQ §8.2 and §9.9 if caching is wanted; see D2.**
- **Participation is opt-in and revocable.** The requirement for default-on sharing conflicts with invariant 32 (opt-in). **See D1.**
- **Project participation is planning data.** It must not feed any skill, coverage or performance output.
- **Erasure:** the new records are added to the account-erasure inventory with their detachment contracts (SECURITY erasure section).
- **Logs and errors** do not contain ratings, levels, project participation per person, or aggregates.

## Architecture decisions

| ID | Decision | Status |
|---|---|---|
| AD-1 | Project and participation records are new team-scoped collections. Existing `roadmapItems` (competence stages) are not reused for projects. | Proposed — no migration needed |
| AD-2 | Competence areas reuse the existing skill-tree catalog (`skillTrees`) as the stable area ID source. | Proposed, see D4 |
| AD-3 | Team sharing preference is stored on the existing per-team membership record (`teamMemberships.skillContribution`) to reuse the C2 participation model. | Proposed; blocked on D1 for defaults |
| AD-4 | Teamkompetanse reuses `get-team-skill-coverage`. No new aggregate store. | Proposed; blocked on D2 for anything beyond categories |
| AD-5 | Gantt date math is pure domain code (`src/features/team-projects/domain`), tested independently of the UI. | Proposed |
| AD-6 | Client components use the existing gateway pattern. No direct Firestore access. | Required |

## Decisions

| ID | Question | Status | Recommended default |
|---|---|---|---|
| **D1** | **Default-on sharing.** Owner wants sharing ON for new eligible participation (REQ §7.2). SECURITY invariant 32 says participation is opt-in, and the C2 notice version lapses existing participation if changed. | **RESOLVED** — owner decision: keep explicit opt-in, default OFF, as required by SECURITY invariant 32. No default-ON rollout. | Keep opt-in (default OFF). The control is shown OFF until the user explicitly turns it on. Existing users with no record are not opted in (D3). |
| **D2** | **Radar, numeric averages and trends in Teamkompetanse.** Invariant 35 forbids persisted aggregates and history, except as amended by Amendment A. | **PARTLY SUPERSEDED (owner, 2026-11-07).** Radar approved, and a numeric team level per area in automatic mode approved as product direction (R-1). Averages across areas and trends **not approved**. The invariant 35 change is pending security and privacy review. | One numeric team level per area, only where publication is permitted. No averages, no trend. The trend panel stays disabled. |
| D8 | **Product association for projects (owner decision).** No Product entity exists or is approved. Projects must work without one. | **RESOLVED** — product association is optional and unsupported until an approved Product domain exists. No Product collection, placeholder records or fake product IDs. Writes do not accept `productId`; a stored non-null `productId` fails the read closed. BR-7 is deferred, not tested as satisfied. | Deferred. Revisit only on a concrete security or data-integrity conflict. |
| D3 | Existing users with no sharing preference: do not infer consent. | Resolved by REQ §9.3 | Treated as not sharing until an explicit choice. |
| D4 | Competence catalog scope: global, team, or both. | Open, non-blocking | Reuse the admin-defined skill-tree catalog as global area IDs; team scope is a per-team active/archived assignment. |
| D5 | Project participation visibility: all members or a narrower audience. | Open, non-blocking | All team members can view planning intervals. No ratings are attached. |
| D6 | Survey and challenge blocks moved from the old overview. | Open, non-blocking | Survey history to `/teams/[teamId]/results`; challenges stay in Oversikt as a summary and link to the existing challenge list. |
| D7 | Project participant names in member-grouped view. | Open, non-blocking | Show the team roster name only, no competence data. |

## Test boundaries

| Boundary | Covers |
|---|---|
| Domain unit tests (`team-projects/domain`, `team-experience/domain`) | BR-6, BR-9, BR-10, BR-12, BR-13, BR-16, BR-19, BR-22 |
| Server gateway tests (`server/*.test.ts`, with the Firebase fake) | BR-6–BR-8, BR-15, BR-18, BR-19, BR-21, BR-22, BR-25, BR-28, BR-29 |
| Authorization tests | Team isolation, self-only ratings and preferences, admin cannot read ratings (cross-cutting) |
| API route tests (`app/api/teams/[teamId]/...`) | Response shape without suppressed data, error mapping |
| Component tests (Vitest + Testing Library) | Tabs, Gantt labels, sharing dialog focus, chart text alternatives |
| Browser (Playwright, isolated fixtures) | Navigation, Gantt, sharing toggle, responsive layouts, axe |

## Acceptance criteria
- [ ] Each team tab renders with the shared header and keyboard-accessible tab navigation.
- [ ] Oversikt summary counts match the detail tabs in tests (BR-1, BR-2).
- [ ] Gantt bars match project dates in 3-month and 6-month views (BR-10).
- [ ] Project create, edit and archive are authorized and validated (BR-6–BR-8).
- [ ] Participation is visible only as planning intervals (BR-13).
- [ ] Teamkompetanse shows only approved values at the k in force: categorical coverage at k=5 until the R-2 security change is applied (BR-25, BR-26).
- [ ] Sharing defaults follow the resolved D1 decision (BR-24).
- [ ] Turning sharing off removes the contribution from the next team read (BR-22).
- [ ] Account erasure covers every new user-linked record (BR-29).
- [ ] Existing competence records and personal assessments remain readable (BR-17, BR-28).
- [ ] Visual comparisons recorded for all five references in `VERIFICATION.md`.

## Owner decisions (2026-11-06)

Recorded from the owner's instruction to resume TASK-006 and TASK-009. Where an earlier draft conflicts, these apply. Note on numbering: the instruction cited "BR-29" for the `/me/skills` visualization. In this SPEC BR-29 is account erasure; the skills-visualization requirement is **BR-20**, amended below.

| ID | Decision | Applied in |
|---|---|---|
| OD-1 | `/me/skills` shows no radar or other skills chart. Use competence cards, the four existing levels, text level labels, non-chart indicators and development actions. Reference 22 is illustrative; the written requirement takes precedence. No numeric competence score is computed or persisted. | BR-20 (amended) |
| OD-2 | Private role direction reuses the existing owner-only role target (`role-profiles`, BR-8/BR-10, erasure I-4). No new role catalog, persistence or erasure row. It is personal development information: not a team role, authorization role, evaluation, manager rating or public profile. It does not change membership roles and is not read by team aggregation. | TASK-009 |
| OD-3 | Kompetanseplan milestone model: stable id, title, optional target date (`YYYY-MM-DD`), status `planned` / `in_progress` / `completed`, at most 20 per plan, one plan per assigned competence area (`teamCompetencePlans/{teamId}__{treeId}`). Progress is the count of completed milestones out of the total. No person-based or skill-based percentage. | BR-15, BR-16; TASK-006 |
| OD-4 | Target stage uses the four existing self-assessment levels (`SELF_ASSESSED_LEVELS`, labels from `SELF_ASSESSED_LEVEL_COPY`). A target stage is a planned goal, never an observed level and never copied from a member's self-assessment. | BR-15; TASK-006 |
| OD-5 | `teamCompetencePlans` stores no uid, actor, memberRef or member assessment. It is classified as non-person-owned and allow-listed with a reason in `inventory-allow-list.ts`, like `teamCompetenceAreas`. Client rules deny all access. | Erasure inventory; TASK-006 |
| OD-6 | `/me/skills` sharing control is "Del kompetanse med teamet", one per member team. It uses the existing C2 record `teamMemberships.skillContribution` through the owner-only endpoint. It is OFF by default, opt-in, revocable, and lapses on a notice-version bump (SECURITY invariants 32, 36). No second preference store. | BR-21–BR-24; TASK-009 (control), TASK-010 remaining dialog work |

## Owner decisions (2026-11-07): radar and k = 3 — approved product direction

Status: **approved product direction (owner, 2026-11-07).** These are product requirements. They do not change the enforceable security contract: SECURITY.md invariants 32–36 and the code constant `SKILL_COVERAGE_MIN_CONTRIBUTORS` = 5 stay in force until the formal security, privacy and legal approvals listed per row are recorded and the change is applied. Nothing below activates k = 3, default-on sharing or collaborative persistence.

| ID | Owner decision | Effect on this SPEC | Status |
|---|---|---|---|
| R-1 | **Approved product direction (numeric, 2026-11-07).** Teamkompetanse uses a radar chart. Automatic mode shows a green polygon of one aggregated team level per area and a neutral dashed target polygon. Missing or suppressed values are unavailable, never zero. | Supersedes D2 and BR-26 for the radar visualization. Averages across areas and trends stay out. | Product approved. Activation blocked until security review (G1), privacy and legal review (G2), notice (G5), UI-UX (G3) and copy (G4) are recorded, and invariants 35 and 36 are amended. See Amendment A §A.14. |
| R-2 | **Approved product direction.** Automatic aggregation supports a minimum of **3** eligible contributors per area: 3 or more permits automatic aggregation when the approved publication safeguards allow it; 1–2 gives `insufficient_data`. No team-size floor; a team of exactly 3 participating members must be supported. | Supersedes the k = 5 product requirement. Does **not** yet change SECURITY invariant 34 or the constant. Three contributors do not provide anonymity. | **Security change pending.** Required before activation: G0 and G1 (security review), G2 (legal/privacy), G5 (notice version bump), G7 (retire old A3), then the §A.10 activation step. **Not activated.** |
| R-3 | **Approved product direction.** The teamadmin chooses automatic or collaborative assessment mode. Automatic is the intended default. | Adds the mode control. Collaborative values are teamadmin-entered. | Product: approved. Persistence of mode and values pending G1, G3 (UI-UX), G4 (Norwegian copy). |
| R-4 | **Approved product direction.** Each member controls sharing of their own private self-assessments. | Default-on sharing is **not** part of this approval. The opt-in, default-OFF contract (invariant 32) stays in force. | Amendment B, default-on and rejoin preservation: separate legal/privacy review (L1–L3). **Not activated.** |

Security-contract changes **still require formal review and are not applied**: SECURITY invariant 34 (k = 3 wording and residual statement), invariants 32 and 35 where affected, the notice text and notice version, and the `SKILL_COVERAGE_MIN_CONTRIBUTORS` constant. Notice versions, active consent rules and Firebase rules are unchanged.

## Open questions
Resolved:
1. **D1** — RESOLVED: explicit opt-in, default OFF (SECURITY invariant 32).
2. **D2** — RESOLVED: categorical coverage only; no radar coordinates, numeric averages or trends (SECURITY invariant 35).

Non-blocking: D4–D7, with the recommended defaults above.
