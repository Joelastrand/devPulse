# DevPulse — Product

## Vision

DevPulse helps development organizations sense and improve team wellbeing and
delivery health over time, using short recurring pulse surveys, anonymous
challenges, team forums, and team-level skill-tracking progressions.

## Intended users

- Developers and team members (survey respondents, forum/community
  participants).
- Team leads / engineering managers (team-level aggregated insight).
- Admins (org-wide configuration, not raw individual data — see
  `docs/SECURITY.md`).

## Problem being solved

Teams and organizations often lack a lightweight, recurring signal for
sustainable workload, delivery flow, and morale — leaving problems invisible
until attrition, burnout, or delivery failure makes them obvious.

## Initial direction: pulse survey

- Recurring, short (target 1–2 minutes).
- Initial dimensions (approximate, subject to refinement):
  - Flow / delivery satisfaction
  - Stress / sustainable workload
  - Fun / motivation
- Individual responses are anonymous; only team-level aggregates (above a
  minimum response threshold) are visible to an authorized team member or
  app admin, scoped per-team (Phase 2; see
  `docs/features/results-dashboard/SPEC.md`). A global app-admin role now
  exists and manages teams and memberships (see "Delivered: multi-team
  membership and admin (Team Management)" below); admin access does not
  imply access to raw individual survey responses, and protected result
  access remains team-scoped and privacy-constrained — see
  `docs/SECURITY.md`.

## Delivered: authenticated team dashboard and trends (Phase 2, historical)

- Introduced authenticated, server-side-authorized team results: closed-
  period aggregate plus a 12-closed-period trend, never the current/open
  period's data. See `docs/features/results-dashboard/SPEC.md` for what
  this phase implemented.
- Phase 2's original access model (one static, deploy-time
  verified-email-to-team mapping per user, `/results` rendering results
  directly) has since been **superseded** by Team Management, below —
  `/results` is now a compatibility redirect, not a results page.

## Delivered: multi-team membership and admin (Team Management)

- Replaced the single-static-team-per-user model with a Firestore-backed
  model where a user can belong to zero, one, or many teams, and a global
  app-admin role can create teams and manage membership. See
  `docs/features/team-management/SPEC.md`.
- `/teams`: any authenticated, verified user can see every active team's
  name and their own relationship to it (`admin`, `member`, a pending or
  rejected access request, or none) and request access to a team they
  don't belong to — never another user's relationship or any team's
  results.
- `/teams/[teamId]`: a team member or app admin sees that team's own
  closed-period aggregate and 12-period trend (same semantics as the
  original Phase 2 dashboard); a non-member sees only a non-sensitive
  "request access" state, and the team's results are never fetched for
  them.
- `/admin/teams`: an app admin can see every team (including disabled
  ones), create a new team, and disable/re-enable an existing one; a
  non-admin gets a generic "no permission" state. `/admin/teams/[teamId]`:
  an app admin can invite a member by email, cancel a pending invitation,
  remove a member, and approve/reject a pending access request.
- `/results`: a thin, client-side compatibility redirect — a signed-in
  user with exactly one team membership lands on that team's
  `/teams/[teamId]`; every other state (signed out, zero or multiple
  memberships) lands on `/teams`. It no longer renders results itself.

## Delivered: product UX, localization and application shell (Phase 3)

- The entire user-facing application renders in Norwegian, sourced from
  per-feature/shared-area copy modules — English remains the language of
  code, docs, API contracts, and logs. See
  `docs/features/product-ux-shell/SPEC.md`.
- The site header/navigation is auth-aware and admin-aware: it shows Hjem/
  Pulsundersøkelse/Logg inn/Opprett konto when signed out; the same set
  minus sign-in/up plus Team/Logg ut when signed in; and additionally
  Admin for an app admin. Admin visibility is derived only from a new,
  minimal server-side own-admin-status read (`GET /api/me`) — never a
  client-side check against `APP_ADMIN_EMAILS` or any other allow-list.
- Every existing screen (home, pulse survey, sign-in/up, `/teams`,
  `/teams/[teamId]`, `/admin/teams`, `/admin/teams/[teamId]`, `/results`)
  shares one application shell and a small set of reusable UI primitives
  (`src/components/ui/`), with consistent loading/empty/success/
  validation-error/authorization-failure/infrastructure-failure states.
- After a successful sign-in, the confirmation state continues to `/teams`
  (previously `/results`).
- A team's results view gained a Recharts-based 12-period trend chart,
  additive to the existing accessible `TrendTable` (unchanged). A
  suppressed (`insufficient`/`not_available`) period is never rendered as
  zero or visually indistinguishable from a real published value.
- Every screen in scope is responsive at common phone widths and passes an
  accessibility pass (labels, heading order, keyboard operability, visible
  focus, no color-only signaling).
- This phase changed no authentication, authorization, anonymity,
  aggregation, or privacy behavior — every guarantee described in
  `docs/features/pulse-survey/SPEC.md`, `docs/features/results-dashboard/
  SPEC.md`, and `docs/features/team-management/SPEC.md` holds unchanged.

## Delivered: managed surveys and survey-based insights (Phase 4)

- Replaced the implicit, always-on, calendar-week-driven survey model with
  explicit, admin-managed survey instances: an app admin creates a survey
  for one team, choosing an access mode (`public`, anonymous/link-only, or
  `authenticated`, requiring a signed-in, server-verified team member) and
  optionally a title and availability window, then explicitly opens and
  closes it. See `docs/features/managed-surveys/SPEC.md`.
- Every survey, of either access mode, is reachable at one opaque,
  server-generated URL, `/survey/{surveyId}` — there is no longer a single
  static public survey page, and public survey discovery happens only
  through a generated link (a team's own page, or shared externally), never
  a generic Home/nav entry point.
- A team can have at most one genuinely open survey at a time; cadence is
  entirely admin-driven per team, with no fixed global or per-team schedule.
- Authenticated-mode participation is tracked (`SurveyParticipation`, `{uid,
  surveyId}` only) solely to prevent a second accepted submission from the
  same identity — it is never linked to the specific response it
  accompanies, and does not exist for `public` surveys, which remain as
  identity-free and dedup-free as Phase 1.
- The publication threshold (`minimumResponses`) is now configured per
  survey instance (an integer in `[3, 20]`, default 5 in the admin creation
  form, immutable after creation) rather than one global constant.
- A team's results/history are now its own closed survey instances, shown
  in actual chronological order with real dates, replacing the fixed
  "12 closed calendar periods" grid.
- Retired: the static, always-on `/pulse-survey` page and `POST
  /api/pulse-survey` endpoint, the implicit weekly calendar-period concept,
  and the calendar-period-scoped results aggregation path — see
  `docs/features/pulse-survey/SPEC.md` and `docs/features/
  results-dashboard/SPEC.md` for the historical record of what those
  superseded.
- This phase also fixed the signed-in-user experience on Home so a
  signed-in visitor is never offered "Logg inn"/"Opprett konto".

## Delivered: Anonymous Challenges (Phase 5)

- Let an actual member of a team submit a free-text "challenge" (friction,
  problem, or improvement suggestion) for that team, with no submitter
  identity ever persisted or recoverable through the application. See
  `docs/features/anonymous-challenges/SPEC.md`.
- `/teams/[teamId]`: an authorized real team member sees a "Meld en
  utfordring" submission panel; every member/admin of the team sees a
  read-only, newest-first list of the team's `open`/`resolved` challenges —
  unlike survey responses, challenge content is shown individually, since
  the point of the feature is that someone can act on it; a non-member sees
  no challenge content or data.
- `/admin/teams/[teamId]`: an app admin additionally sees `archived`
  challenges and can resolve, archive, or permanently delete a challenge
  (delete requires explicit confirmation) — a minimal, one-way lifecycle
  (`open → resolved → archived`, no reversal) so a team's challenge list
  stays usable over time.
- No public/anonymous-link submission, no comments/voting/reactions, no
  categories/tags, and no AI classification of challenge text exist for this
  feature — a challenge always requires real, authenticated team membership
  to submit.

## Delivered: Team Forum (Phase 6)

- **Current state**: the Forum UI described below is hidden by default,
  behind a server-only product/UI-availability flag
  (`FEATURE_FORUM_ENABLED`) — it is not a security control, and every
  guarantee below is otherwise unaffected. See
  `docs/features/team-forum/SPEC.md` ("Feature flag") and
  `docs/DEVELOPMENT.md`'s environment-variable table.
- Let a real member of a team start a titled discussion thread and reply to
  one, scoped to that team, with ordinary attribution — a reader can tell
  which posts share an author, without learning that author's real name,
  email, or `uid`. See `docs/features/team-forum/SPEC.md`.
- `/teams/[teamId]`: an authorized member/admin sees a "Forum" section — a
  newest-first thread list (title, `authorTag`, date) and, for a real team
  member, a "start a new thread" action; a non-member sees no forum content
  or data.
- A new `/teams/[teamId]/forum/[threadId]` detail view shows a thread's
  title/body/`authorTag`, every one of its replies in chronological order
  (a deleted reply renders only a fixed, non-identifying placeholder, never
  omitted or showing its original content), and a reply-submission panel
  for a real team member (disabled once a thread reaches its 500-reply
  capacity).
- A thread's own author, or an app admin, can permanently delete that
  thread — this genuinely removes the thread and every one of its replies
  from Firestore, for everyone, including an app admin with direct
  database access. A reply's own author, or an app admin, can delete that
  one reply, leaving a content-erased placeholder in its place so the
  thread's other replies keep their position.
- Attribution is deliberately **pseudonymous, not real-name**: this is the
  first feature in DevPulse where persisted, member-visible author
  attribution is the point, rather than something the product avoids
  (contrast with the pulse survey and Anonymous Challenges, both
  identity-free by design). A genuine display-name/profile system, and a
  cross-team/org-wide "developer forum" beyond this team-scoped v1 slice,
  both remain future scope.
- No edit, no restore/undelete, no reactions/voting/categories/tags/
  mentions/notifications/search, and no rate limiting exist for this
  feature (explicit v1 non-goals).

## Delivered: Team Skill Tree (Phase 7)

- Let an app admin define a **SkillTree**: a name plus an ordered,
  2-20-stage progression (e.g. Container fundamentals → Evaluate
  alternatives → Build competence → Proof of concept → Pilot → Production
  rollout → Monitoring and operations → Mature production capability), and
  track which stage a specific team has reached against it. See
  `docs/features/team-skill-tree/SPEC.md`.
- This is **team-level, not individual/person-level**, data — there is no
  "a person's skill level" anywhere in this feature; a team's members/
  admins can see their own team's progress, never another team's.
- `/admin/skills`: an app admin can create a SkillTree and cosmetically
  correct an existing one's name/stage-label text — **never** its stage
  count, order, or identity, which are permanently immutable after
  creation; no structural editing or deletion of a SkillTree exists.
  `/admin/teams/[teamId]` gains a per-team section to start tracking a
  catalog tree (rejected for a disabled team), advance/reverse its current
  stage, and stop tracking (both remain available regardless of team
  status). `/teams/[teamId]` gains a read-only section for an authorized
  member/admin.
- Every write (create/correct a tree; start/update/stop a team's tracking)
  is **app-admin-only** in v1 — a deliberate scope-minimization decision
  for the smallest v1 surface, not one this feature's individual-data
  non-goal itself requires; a future member-initiated write path remains
  possible as a pure addition later.
- SkillTree names/stage labels are short, structured, admin-authored text —
  not encrypted, matching `teams.name`/`surveys.title`'s existing trust
  level (see `docs/DATA-MODEL.md` for the accepted residual risk this
  carries).

## Delivered: Member Skill Progress Self-Report (Phase 8)

- A **second, additive write path** for `skillProgress.currentNodeId`:
  `reportTeamSkillProgress`, usable by any real member of a team, alongside
  the unchanged app-admin path from Phase 7. A member can set their team's
  current stage — forward or backward, identical to the admin contract —
  on any SkillTree the team already tracks, without needing an app admin
  to do it for them. See
  `docs/features/skill-progress-self-report/SPEC.md`.
- A member cannot start or stop tracking, and cannot define/correct
  SkillTree structure — self-report only ever updates the stage of a tree
  the team is *already* tracking. `/admin/skills` and
  `/admin/teams/[teamId]`'s tracking controls are unchanged.
- Unlike Phase 7's admin-only `updateTeamSkillProgress` (unaffected by team
  status), this member path requires an `active` team — matching this
  codebase's established pattern for every other member-originated write
  (`submitChallenge`, `createThread`, `createReply`).
- No visible attribution: a member's update is recorded exactly like an
  admin's (`updatedBy: uid`, never returned by any API response). No new
  Firestore collection, field, or index — the identical `skillProgress`
  document shape from Phase 7 is reused unchanged.

## Delivered: Cross-Team Skill Progress Overview (Phase 9)

- A read-only, app-admin-only view at `/admin/skills`: for every SkillTree
  at least one team tracks, every tracking team's current stage, side by
  side — so an app admin responsible for a capability across the
  organization can see adoption without opening each team's own
  `/admin/teams/[teamId]` page individually. See
  `docs/features/org-skill-progress-overview/SPEC.md`.
- Composes existing team-level data only (`SkillTree`, `SkillProgress`,
  `Team`), computed fresh on every call like `SurveyAggregate` — no new
  Firestore collection, no new write path, and no individual/per-person
  data of any kind.
- **Deliberately narrower than a true organizational hierarchy**: "org-wide"
  here means exactly the set of teams the existing app-admin model already
  sees, using no new grouping concept above `Team`. A genuine Section/
  department-scoped entity, or org-wide SkillTree *ownership/tracking*
  itself (as opposed to today's per-team tracking model read through a new
  cross-team view), both remain unimplemented future scope — this phase
  does not deliver either (see "Future capabilities" below).
- A disabled team's existing tracking remains visible here too, labeled
  ("Deaktivert," never color alone) — the same "no team-status read gate"
  precedent every other `SkillProgress` read in this codebase already
  follows (Phase 7's `getTeamSkillProgress`/admin tracking view).
- No new suppression/minimum-team-count threshold: `SkillTree`/
  `SkillProgress` are non-sensitive, non-anonymous, team-level reference
  data, unlike `SurveyAggregate` — a tree tracked by exactly one team
  appears, same as it would to that team's own admin page.

## Delivered: Team Skill Planning (Feature A)

- A team can record a simple plan for each competency area it tracks — the
  target stage it wants to reach, a priority, a status and optional dates —
  inside the existing *Kompetanseområder* view, so intent sits next to the
  team's current stage. A plan may optionally name one team member as the
  responsible contact; this is coordination metadata only, grants no
  permissions, and is never an individual performance measure. Planning stays
  team-level and carries no per-person scoring or ranking.
- See `docs/features/team-skill-planning/SPEC.md` and `docs/ROADMAP.md`.

## Delivered: Team Roadmap (Feature B)

- A dedicated Roadmap page per team (`/teams/[teamId]/roadmap`, reached from
  an `Oversikt · Roadmap` navigation) shows the team's **current** plans across
  competency areas together, so the team sees shared direction: what is
  active, planned, completed or undated, and when. It presents the same plans
  as *Kompetanseområder* — there is one current plan per team and competency
  area, with priority, status, optional dates and an optional owner.
- Plans can be read as a grouped list (default) or a lightweight timeline
  grouped by target quarter, filtered by status and priority, with archived
  plans revealed on request. Members of an active team can edit, archive,
  restore and create plans from here with the same controls and rules as in
  *Kompetanseområder*; everyone else reads.
- It shows the current plan only. Replanning overwrites the plan; there is no
  plan history, no board or Gantt view and no link to challenges. The plan
  count line counts plans, not people. The owner is coordination metadata: it
  grants no permission, and there is no owner filter, ranking, completion rate
  or performance score.

## Delivered: Individual Skill Self-Assessment (Feature C1)

- A signed-in person opens **Mine ferdigheter** (`/me/skills`, one header link) and
  states, for each organization-defined skill area (*Ferdigheter*), how they
  assess themselves on a four-level ordinal scale: *Grunnleggende kjennskap*,
  *Kan med støtte*, *Kan selvstendig*, *Avansert*. A skill with no level is simply
  "Ikke vurdert". Selections save immediately and can be changed or cleared at
  any time; a person can also reset all of their own assessments. The page shows
  counts only — no chart, no overall score, no average.
- **In C1 the self-assessment is owner-only**: it is available only to the
  signed-in owner. Other users, team leads and app admins cannot read it
  through any DevPulse product or API surface, and a role never widens access.
  The page notice says exactly that and makes no promise about future use.
- It is development-oriented, self-reported and person-owned. It is not a
  rating by anyone else and not a performance, productivity or readiness
  measure. The skill-area names come from the existing org-wide SkillTree
  catalog (the same names the team sees as *Kompetanseområder*); no separate
  personal catalog exists.
- **Not delivered in C1:** `teamSkillNeeds`, a team skill matrix,
  gap or coverage analysis, any aggregate of personal assessments, privacy
  thresholds, consent/inclusion decisions, role expectations and any sharing.
  C1 adds no Demo Team personal data. *(Amended 2026-10-10: C2 has since
  delivered the needs, the opt-in and the thresholded coverage — see the next
  entry; role expectations and any individual-level sharing remain
  undelivered.)*
- See `docs/features/individual-skill-self-assessment/SPEC.md`, `docs/SECURITY.md`
  (invariant 31) and `docs/ROADMAP.md`.

## Delivered: Team Skill Needs and Privacy-Thresholded Coverage (Feature C2)

- A team **lead** records, per competency area (*Kompetanseområde*), a team
  skill need: "at least *r* contributors at personal level *L* or higher"
  (*L* is 2–4, *r* is 1–20). All genuine team members, and app admins, can read
  the needs; only a genuine lead of an active team can create, change or delete
  them. Needs are a team planning statement, not a requirement on any person.
- Each person decides, **per team and revocably**, whether their own C1
  self-assessments may count towards that team's coverage ("Bidra til teamets
  kompetanseoversikt"). It is opt-in, never pre-selected, never required to view
  coverage, ends when the person withdraws or leaves the team, and has to be
  chosen again after rejoining. No lead or admin can opt anyone in.
- Genuine members of an active team see, per need, only a **categorical**
  status: *Behovet er dekket*, *Behovet er ikke dekket ennå* or *Ikke nok data
  til å vise dekning ennå*. A skill is evaluated only when at least **5**
  eligible contributors have assessed it (fixed, not configurable); there are no
  counts, percentages, levels, distributions or names, and no way to see who
  contributes. The section is *Kompetansebehov og dekning* on the team Overview.
  The output is **privacy-thresholded team coverage**, not anonymity: the
  participation notice states that status changes can in some cases give rough
  information about the group, and the SPEC/`docs/SECURITY.md` record the
  residual risks (including that a lead who changes needs over time can learn
  approximate counts).
- Coverage is derived on each request and never stored; a gap creates no
  assignment, goal, notification or roadmap item. The C1 `/me/skills` notice
  now says that participation is optional and team-level only. The self-assessment
  itself stays person-owned, and no lead, admin or teammate can read another
  person's levels.
- **Not delivered:** an employee-by-skill matrix or any per-person view (not
  planned), counts/distributions, a configurable threshold, history or trends,
  automatic roadmap prefill from a gap, role expectations (then labelled D1/D2;
  see "Delivered: Personal Development Goals (Feature D1)" below), assignments,
  goals or notifications, and Demo Team coverage data (no personal assessments
  are seeded, so the Demo cannot show *dekket*/*ikke dekket*).
- See `docs/features/team-skill-needs-and-matrix/SPEC.md`, `docs/SECURITY.md`
  (invariants 32–36) and `docs/ROADMAP.md`.

## Delivered: Personal Development Goals (Feature D1)

- A signed-in person opens **Min utvikling** (one header link, to `/me/skills`) and
  uses the personal navigation `Ferdigheter · Mål`. **Mål** (`/me/goals`) lets the
  person create, edit, complete, reopen and permanently delete their own
  development goals. A goal has a title, an optional link to an organization
  SkillTree skill area, an optional target date (past dates are accepted; there is
  no overdue state) and a simple status, *Aktivt* or *Fullført*.
- **Owner-only and private**: no teammate, team lead or app admin can read a goal
  through any DevPulse surface, and a role never widens access. Goals are not part
  of any team, roadmap, skill matrix, coverage or maturity view and are not a
  performance or appraisal signal. The page says that goals are personal and that
  sensitive or confidential information should not be written in a title (titles
  are stored unencrypted; see `docs/SECURITY.md`, invariants 37–54).
- The SkillTree link only names a skill area. D1 does not read the person's C1
  self-assessment, creates no goal from it and records no level, progress history,
  percentage or score. A person holds at most 100 goals.
- **Label resolution (2026-10-11).** "D1/D2" was used ambiguously. Now: **D1** =
  person-owned development goals (this feature); **D2** = check-ins/conversations,
  any two-party development interaction or sharing with leads or mentors
  (planned, not built); **role expectations** (`roleDefinitions`, role profiles,
  manager development views) = a separate feature (dated pointer 2026-10-28: built as `role-profiles`; this is the 2026-10-14 planning statement),
  neither implemented nor cancelled. Earlier text above that says "D1/D2" in the
  role-expectation sense is historical.
- **Not delivered in D1:** check-ins or conversations (`Samtaler`), sharing with
  anyone, manager/lead/admin goal views, role profiles or expectations, progress
  entries or history, target levels, notifications, assignments, analytics, and Demo
  Team goal data (the presenter creates goals through the UI).
- See `docs/features/personal-development-goals/SPEC.md`, `docs/SECURITY.md`
  (invariants 37–54) and `docs/ROADMAP.md`.
- **Delivered: development conversations (D2, 2026-10-21).** A person creates a conversation at
  `/me/conversations` (`Samtaler`), writes notes, optionally shares up to five copies of their own goals,
  and optionally invites **one** consenting teammate from the same team. The invitee sees only the
  invitation until accepting; after acceptance both parties see the same content. Leads, managers and app
  admins get no access. Mentors or guests from outside the team are not part of D2 and remain future
  cross-team scope (CL-2). See `docs/features/development-conversations/SPEC.md` and `docs/SECURITY.md`
  (invariants 55–72).

## Future capabilities (not implemented yet)

- **D2 — check-ins/conversations** and any sharing of goals with leads or mentors:
  not built and not authorized by D1; each needs its own approved SPEC, privacy
  design and consent decision.
  - *Dated pointer (2026-10-21; the entry above is the D1-era planning statement and is not rewritten):* D2 was
    subsequently implemented in the repository as the consent-first, same-team development conversations feature
    (`Samtaler`) described under "Delivered" above. Deployment is separate and has not been performed. Sharing with
    a mentor from outside the team remains not built and is future cross-team scope (CL-2). Current D2 behaviour is
    defined by `docs/features/development-conversations/SPEC.md` and its closeout record.
- **Role expectations** (`roleDefinitions`; built 2026-10-28 as the role-profiles feature, see `docs/features/role-profiles/SPEC.md`; formerly unscheduled, separate from D2) and any
  use of skill needs or coverage as an expectation on a role or person: not built
  and not authorized by C2 or D1; each needs its own approved SPEC.
- A cross-team/org-wide "developer forum" or community, beyond Team
  Forum's team-scoped v1 slice, and real-name/display-name attribution for
  it (see "Delivered: Team Forum (Phase 6)" above).
- A genuine Section/department-scoped grouping entity above `Team`, or
  org-wide (multi-team) SkillTree *ownership/tracking* itself — beyond both
  Team Skill Tree's team-scoped v1 tracking model (Phase 7) and the
  Cross-Team Skill Progress Overview (Phase 9). Phase 9 is a read-only
  *view* composed over already-existing per-team tracking data through the
  existing app-admin model, not a new hierarchy, grouping, or ownership
  concept — that distinction is deliberate (see "Delivered: Cross-Team
  Skill Progress Overview (Phase 9)" above) and remains separately
  deferred, unaffected by Phase 8's member self-report or by Phase 9.

## Non-goals

- DevPulse is **not** an individual employee performance monitoring or
  ranking system.
- DevPulse does not surface individual wellbeing scores to anyone.
- The system emphasizes team/forum-level trends and sustainable development
  practices, not individual surveillance.

### Clarification (2026-10-05, Individual Skill Self-Assessment C1)

The first non-goal above prohibits *others* assessing, ranking or monitoring a
person. It does not prohibit a person recording their own development-oriented
self-assessment, which C1 now delivers.

| | |
|---|---|
| **Allowed (C1)** | personal, self-reported, person-owned, development-oriented self-assessment, owner-only in C1 |
| **Still not allowed** | manager, lead, admin or team assessment of an individual; performance evaluation; surveillance or monitoring use; ranking; productivity scoring; named comparison; inferred competence |

This is an approved, deliberate narrowing of the earlier blanket wording
about per-person skill ratings (historically in
`docs/features/team-skill-tree/SPEC.md`). It weakens no anti-surveillance rule.
Any future use of personal assessments beyond the owner (Feature C2) is not
authorized by C1 and requires its own approved specification, an updated
privacy notice and a security/privacy review (`docs/SECURITY.md`, invariant 31).

### Clarification (2026-10-10, Team Skill Needs and Privacy-Thresholded Coverage C2)

C2 extends the 2026-10-05 clarification to a **team-level** use of self-assessments
without making any individual visible. It weakens no anti-surveillance rule.

| | |
|---|---|
| **Allowed (C2)** | an opt-in, per-team, revocable contribution of one's own self-assessment to a fixed-threshold (5 contributors per skill), categorical, derived team coverage; one lead capability: managing the team's skill needs |
| **Still not allowed** | any individual-level output (named or employee rows, per-person cells, who contributes, who lacks a skill, counts or distributions); lead, manager or admin access to a person's levels; ranking, scoring or performance use; a configurable or lowerable threshold; claims of anonymity |

The threshold limits what the output shows; it does not make the output anonymous in a
formal sense, and the residual risks are recorded in `docs/SECURITY.md` (invariants 32–36).
Any consumer of C2 output beyond team planning information needs its own approved SPEC.

### Clarification (2026-10-14, Personal Development Goals D1)

D1 records a person's *own* development goals. It does not weaken the first
non-goal: nobody else can read, assess or rank them.

| | |
|---|---|
| **Allowed (D1)** | personal, person-owned, owner-only development goals with an optional skill-area link and optional target date |
| **Still not allowed** | lead, manager or admin access to goals; sharing; use of goals for performance evaluation, ranking, scoring or monitoring; deriving goals from, or goal status into, C1/C2/roadmap data; claims of anonymity or encryption of titles |

Any reader of goals other than the owner (D2 or otherwise) needs its own approved
SPEC, privacy notice and security review.
