# DevPulse — Conceptual Data Model

This file describes DevPulse's conceptual data model. Some collection
shapes below are now durably decided and implemented — for those, the
relevant `docs/features/<feature-id>/SPEC.md` remains authoritative for
exact field names, state transitions, and required indexes; this file
tracks the conceptual shape and privacy implications, not the schema
source of truth. Concepts not yet implemented are marked accordingly in
the Status column below.
See `docs/SECURITY.md` for the invariants these concepts must respect.

| Concept | Status | Purpose | Personal data? | Sensitive data? | Encryption likely? |
|---|---|---|---|---|---|
| User | Implemented (Firebase Authentication) | An individual account (identity, via Firebase Auth) | Yes | No | No |
| Team | Implemented (Firestore-backed) | A group users belong to, for access scoping. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teams/{teamId}` (`teamId` server-generated/opaque, `name`, `status: active/disabled`, `createdAt`, `createdBy`), admin-managed, server-only via the Firebase Admin SDK. As of TASK-006, this is also the public pulse-survey's team source: `listActiveTeams` (`src/features/teams/server/list-active-teams.ts`) exposes only `{teamId, name}` for `active` teams, unauthenticated, replacing the prior static `ALLOWED_TEAM_IDS` array for both the survey selector and submission-time validation. The four legacy `ALLOWED_TEAM_IDS` values are seeded once, with those exact strings as document IDs, via an app-admin-only, idempotent seed operation (`seed-legacy-teams.ts`). | No | No | No |
| TeamMembership | Implemented (Firestore-backed) | Links a User to a Team, for authorization. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamMemberships/{uid}__{teamId}` (`uid`, `teamId`, `createdAt`, `createdVia`, `grantedBy`) — `uid`-keyed, never email-keyed; server-only via the Firebase Admin SDK. `authorizeTeamAccess` (`src/features/teams/server/authorize-team-access.ts`) is the sole authorization boundary that reads it. | Yes (linkage) | No | No |
| TeamInvitation | Implemented (Firestore-backed) | An admin-initiated, email-addressed, pending grant of team membership. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamInvitations/{teamId}__{normalizedEmail}` (`teamId`, `email`, `status: pending/accepted/canceled`, `invitedBy`, `createdAt`, `updatedAt`, `resolvedAt?`, `resolvedUid?`) — email-keyed only for matching a future verified sign-in, never copied into `teamMemberships`; server-only via the Firebase Admin SDK. `resolveInvitations` (`src/features/teams/server/resolve-invitations.ts`) resolves a pending invitation into a `uid`-based membership. | Yes (invited email) | No | No |
| TeamAccessRequest | Implemented (Firestore-backed) | A non-member's in-app request to join a team, resolved by an app admin into an approval (creates membership) or rejection (creates none). Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamAccessRequests/{uid}__{teamId}` (`teamId`, `uid`, `status: pending/approved/rejected`, `createdAt`, `resolvedAt?`, `resolvedBy?`) — `uid`-keyed, deliberately no persisted email (requester email for admin display is resolved on demand from Firebase Auth, mirroring `TeamMembership`'s member-email pattern); server-only via the Firebase Admin SDK. `approveAccessRequest`/`rejectAccessRequest` (`src/features/teams/server/`) transactionally transition a request and, on approval, atomically grant the corresponding `uid`-based membership via the same `applyMembershipGrant` primitive `resolveInvitations` uses. | Yes (linkage) | No | No |
| Survey | Implemented (fixed in-code question set; not a Firestore collection) | Defines a recurring pulse survey (questions/dimensions) | No | No | No |
| SurveyResponse | Implemented (Firestore-backed, `pulseSurveyResponses`) | One anonymous set of answers to a Survey | No (must not contain identity fields) | Yes | Yes |
| SurveyParticipation | **Not implemented** (conceptual/future only — no Firestore collection, field, or participation/deduplication tracking exists in the current implementation) | Records that a user completed a survey instance, separate from response content | Yes | No | No |
| SurveyAggregate | Implemented as a computed value only (no persisted Firestore document/collection — computed server-side on demand per request; see `docs/features/results-dashboard/SPEC.md`) | Team/period-level rollup of responses, above minimum threshold | No | Possibly (small-team re-identification risk) | No (derived; source responses are encrypted) |
| AnonymousChallenge | Not implemented (future — Phase 4) | Free-text anonymous problem/challenge report | No (must not contain identity fields) | Yes (highly sensitive) | Yes |
| SkillTree | Not implemented (future) | Defines a capability progression (future) | No | No | No |
| SkillNode | Not implemented (future) | One stage within a SkillTree (future) | No | No | No |
| SkillProgress | Not implemented (future) | A team/section's progress against a SkillTree (future) | No | No | No |

## Notes

- `SurveyResponse` and `SurveyParticipation` are intentionally separate
  concepts so that "who participated" cannot be directly joined to "what
  they said" (invariant 7 in `docs/SECURITY.md`) — this remains true even
  though `SurveyParticipation` itself is not implemented: the current
  implementation simply has no participant-identity linkage or
  deduplication tracking at all (anonymous responses only), which
  trivially satisfies invariant 7 without the future concept having been
  built yet.
- `SurveyAggregate` is only computed and exposed when the underlying
  response count meets the configured minimum threshold (invariant 11/12).
- For concepts already implemented (`Team`, `TeamMembership`,
  `TeamInvitation`, `TeamAccessRequest`, `SurveyResponse`), the relevant
  `docs/features/<feature-id>/SPEC.md` is authoritative for exact field
  names, state transitions, and indexes. For concepts not yet implemented,
  Firestore collection design remains fully deferred to future
  feature-level work.
