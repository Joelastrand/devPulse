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

## Delivered: authenticated team dashboard and trends (Phase 2)

- Team-based access: an authenticated, verified, team-assigned developer
  can view their own team's most recently closed period's aggregate plus a
  12-closed-period trend — never another team's data, and never the
  current/open period's data. See
  `docs/features/results-dashboard/SPEC.md`.

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
