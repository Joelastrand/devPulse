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
