# DevPulse — Roadmap

- **Phase 0 — Foundation** *(complete)*: repo structure, docs, skill
  placeholders. No product features yet.
- **Phase 1 — Pulse Survey MVP** *(complete)*: anonymous survey submission
  and storage, application-level encryption of sensitive fields. See
  `docs/features/pulse-survey/SPEC.md`.
- **Phase 2 — Authentication, Teams, Dashboard and Trends** *(complete,
  historical)*: Firebase Auth, team membership, server-side authorized team
  dashboard showing only closed-period aggregates (the open/current period
  is never exposed) plus historical trends over a rolling 12-closed-period
  window. Trend scope was folded in from the original Phase 3 split; see
  `docs/features/results-dashboard/SPEC.md`. Its original static,
  single-team-per-user access model has since been superseded by Team
  Management (below).
- **Team Management — Multi-Team Membership and Admin** *(complete)*:
  replaces Phase 2's static, deploy-time email-to-team mapping with a
  Firestore-backed, `uid`-keyed multi-team membership model plus a global
  app-admin role (create/disable teams, invite members, approve/reject
  access requests); `/results` is now a thin compatibility redirect to
  `/teams`/`/teams/[teamId]`. See
  `docs/features/team-management/SPEC.md`.
- **Phase 3 — Anonymous Challenges**: anonymous free-text challenge
  submission.
- **Phase 4 — Developer Forum capabilities**.
- **Phase 5 — Skill / Capability Trees**.

Phase 1, Phase 2, and Team Management are complete; Phase 3 has not
started. See `docs/PRODUCT.md` for the underlying vision and non-goals.
