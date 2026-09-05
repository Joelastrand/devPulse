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
  minimum response threshold) are visible to leads/admins.

## Future capabilities (not implemented yet)

- Anonymous challenges/problems: free-text reporting of issues, treated as
  highly sensitive.
- Team-based access: visibility scoped to a user's own team(s).
- Historical trends: aggregate trends over time, not individual tracking.
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
