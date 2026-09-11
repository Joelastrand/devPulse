# DevPulse — Product

## Vision

DevPulse helps development organizations sense and improve team wellbeing and
delivery health over time, using short recurring pulse surveys and (later)
anonymous challenges, team forums, and capability tracking.

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
  minimum response threshold) are visible, scoped to a signed-in user's own
  team (Phase 2; see `docs/features/results-dashboard/SPEC.md`). No admin
  role exists yet.

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

## Future capabilities (not implemented yet)

- Anonymous challenges/problems: free-text reporting of issues, treated as
  highly sensitive.
- Developer forums/communities.
- Skill/capability trees for teams and sections, e.g.:
  Container fundamentals → Evaluate alternatives → Build competence →
  Proof of concept → Pilot → Production rollout → Monitoring and
  operations → Mature production capability.

## Non-goals

- DevPulse is **not** an individual employee performance monitoring or
  ranking system.
- DevPulse does not surface individual wellbeing scores to anyone.
- The system emphasizes team/forum-level trends and sustainable development
  practices, not individual surveillance.
