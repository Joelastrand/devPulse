# DevPulse — Conceptual Data Model

Conceptual only — no Firestore collection/document schema is decided yet.
See `docs/SECURITY.md` for the invariants these concepts must respect.

| Concept | Purpose | Personal data? | Sensitive data? | Encryption likely? |
|---|---|---|---|---|
| User | An individual account (identity, later via Firebase Auth) | Yes | No | No |
| Team | A group users belong to, for access scoping. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teams/{teamId}` (`teamId` server-generated/opaque, `name`, `status: active/disabled`, `createdAt`, `createdBy`), admin-managed, server-only via the Firebase Admin SDK. As of TASK-006, this is also the public pulse-survey's team source: `listActiveTeams` (`src/features/teams/server/list-active-teams.ts`) exposes only `{teamId, name}` for `active` teams, unauthenticated, replacing the prior static `ALLOWED_TEAM_IDS` array for both the survey selector and submission-time validation. The four legacy `ALLOWED_TEAM_IDS` values are seeded once, with those exact strings as document IDs, via an app-admin-only, idempotent seed operation (`seed-legacy-teams.ts`). | No | No | No |
| TeamMembership | Links a User to a Team, for authorization. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamMemberships/{uid}__{teamId}` (`uid`, `teamId`, `createdAt`, `createdVia`, `grantedBy`) — `uid`-keyed, never email-keyed; server-only via the Firebase Admin SDK. `authorizeTeamAccess` (`src/features/teams/server/authorize-team-access.ts`) is the sole authorization boundary that reads it. | Yes (linkage) | No | No |
| TeamInvitation | An admin-initiated, email-addressed, pending grant of team membership. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamInvitations/{teamId}__{normalizedEmail}` (`teamId`, `email`, `status: pending/accepted/canceled`, `invitedBy`, `createdAt`, `updatedAt`, `resolvedAt?`, `resolvedUid?`) — email-keyed only for matching a future verified sign-in, never copied into `teamMemberships`; server-only via the Firebase Admin SDK. `resolveInvitations` (`src/features/teams/server/resolve-invitations.ts`) resolves a pending invitation into a `uid`-based membership. | Yes (invited email) | No | No |
| TeamAccessRequest | A non-member's in-app request to join a team, resolved by an app admin into an approval (creates membership) or rejection (creates none). Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamAccessRequests/{uid}__{teamId}` (`teamId`, `uid`, `status: pending/approved/rejected`, `createdAt`, `resolvedAt?`, `resolvedBy?`) — `uid`-keyed, deliberately no persisted email (requester email for admin display is resolved on demand from Firebase Auth, mirroring `TeamMembership`'s member-email pattern); server-only via the Firebase Admin SDK. `approveAccessRequest`/`rejectAccessRequest` (`src/features/teams/server/`) transactionally transition a request and, on approval, atomically grant the corresponding `uid`-based membership via the same `applyMembershipGrant` primitive `resolveInvitations` uses. | Yes (linkage) | No | No |
| Survey | Defines a recurring pulse survey (questions/dimensions) | No | No | No |
| SurveyResponse | One anonymous set of answers to a Survey | No (must not contain identity fields) | Yes | Yes |
| SurveyParticipation | Records that a user completed a survey instance, separate from response content | Yes | No | No |
| SurveyAggregate | Team/period-level rollup of responses, above minimum threshold | No | Possibly (small-team re-identification risk) | No (derived; source responses are encrypted) |
| AnonymousChallenge | Free-text anonymous problem/challenge report | No (must not contain identity fields) | Yes (highly sensitive) | Yes |
| SkillTree | Defines a capability progression (future) | No | No | No |
| SkillNode | One stage within a SkillTree (future) | No | No | No |
| SkillProgress | A team/section's progress against a SkillTree (future) | No | No | No |

## Notes

- `SurveyResponse` and `SurveyParticipation` are intentionally separate
  concepts so that "who participated" cannot be directly joined to "what
  they said" (invariant 7 in `docs/SECURITY.md`).
- `SurveyAggregate` is only computed and exposed when the underlying
  response count meets the configured minimum threshold (invariant 11/12).
- Firestore collection design, field names, and indexes are deferred to
  feature-level `docs/features/<feature-id>/SPEC.md` work.
