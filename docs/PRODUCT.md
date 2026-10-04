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

## Future capabilities (not implemented yet)

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
