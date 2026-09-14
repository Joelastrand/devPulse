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
| Team | Implemented (Firestore-backed) | A group users belong to, for access scoping. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teams/{teamId}` (`teamId` server-generated/opaque, `name`, `status: active/disabled`, `createdAt`, `createdBy`), admin-managed, server-only via the Firebase Admin SDK. `listActiveTeams` (`src/features/teams/server/list-active-teams.ts`) exposes only `{teamId, name}` for `active` teams and backs the `/teams` overview; every managed-survey operation instead scopes to one already-known `teamId` directly (an admin page route, or a survey's own persisted `teamId`), never a team-selection listing. The four legacy `ALLOWED_TEAM_IDS` values (from the retired pulse survey) are seeded once, with those exact strings as document IDs, via an app-admin-only, idempotent seed operation (`seed-legacy-teams.ts`). | No | No | No |
| TeamMembership | Implemented (Firestore-backed) | Links a User to a Team, for authorization. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamMemberships/{uid}__{teamId}` (`uid`, `teamId`, `createdAt`, `createdVia`, `grantedBy`) — `uid`-keyed, never email-keyed; server-only via the Firebase Admin SDK. `authorizeTeamAccess` (`src/features/teams/server/authorize-team-access.ts`) is the sole authorization boundary that reads it. | Yes (linkage) | No | No |
| TeamInvitation | Implemented (Firestore-backed) | An admin-initiated, email-addressed, pending grant of team membership. Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamInvitations/{teamId}__{normalizedEmail}` (`teamId`, `email`, `status: pending/accepted/canceled`, `invitedBy`, `createdAt`, `updatedAt`, `resolvedAt?`, `resolvedUid?`) — email-keyed only for matching a future verified sign-in, never copied into `teamMemberships`; server-only via the Firebase Admin SDK. `resolveInvitations` (`src/features/teams/server/resolve-invitations.ts`) resolves a pending invitation into a `uid`-based membership. | Yes (invited email) | No | No |
| TeamAccessRequest | Implemented (Firestore-backed) | A non-member's in-app request to join a team, resolved by an app admin into an approval (creates membership) or rejection (creates none). Firestore-backed as of `docs/features/team-management/SPEC.md`: `teamAccessRequests/{uid}__{teamId}` (`teamId`, `uid`, `status: pending/approved/rejected`, `createdAt`, `resolvedAt?`, `resolvedBy?`) — `uid`-keyed, deliberately no persisted email (requester email for admin display is resolved on demand from Firebase Auth, mirroring `TeamMembership`'s member-email pattern); server-only via the Firebase Admin SDK. `approveAccessRequest`/`rejectAccessRequest` (`src/features/teams/server/`) transactionally transition a request and, on approval, atomically grant the corresponding `uid`-based membership via the same `applyMembershipGrant` primitive `resolveInvitations` uses. | Yes (linkage) | No | No |
| Survey | Implemented (Firestore-backed, `docs/features/managed-surveys/SPEC.md`) | An admin-created, team-owned survey instance: `surveys/{surveyId}` (`teamId`, `title?`, `accessMode: public/authenticated`, `minimumResponses`, `startAt?`, `endAt?`, `openedAt?`, `closedAt?`, `archivedAt?`, `createdAt`, `createdBy`) — `surveyId` is an opaque, server-generated Firestore document ID. The fixed three-question Flow/Stress/Fun 1-5 answer set itself remains an implicit code-level constant, unchanged from Phase 1. Answerability (`scheduled`/`open`/`closed`) is always derived, never a stored status field (see `docs/ARCHITECTURE.md` → "Survey lifecycle"). | No | No | No |
| TeamSurveyState | Implemented (Firestore-backed, write-side coordination only) | `teamSurveyState/{teamId}` (`activeSurveyId: string \| null`, `updatedAt`) — enforces "at most one genuinely open survey per team" inside `openSurvey`'s/`closeSurvey`'s Firestore transactions; never read by any results/discovery path. | No | No | No |
| SurveyResponse | Implemented (Firestore-backed, `surveyResponses`) | One anonymous, encrypted set of answers to a Survey: `{surveyId, teamId, ciphertext, iv, authTag, keyVersion, submittedAt}` — random document ID, identical shape for either access mode. Replaces the retired `pulseSurveyResponses` (`docs/features/pulse-survey/SPEC.md`). | No (must not contain identity fields) | Yes | Yes |
| SurveyParticipation | Implemented (Firestore-backed), `authenticated`-mode surveys only | `surveyParticipations/{uid}__{surveyId}` (`{uid, surveyId}` only — deliberately no `submittedAt` or any other field), used solely to reject a second accepted submission from the same identity (BR-21/BR-22). Never joined to the specific `SurveyResponse` document it accompanies by any query, API, or UI this application provides (BR-18). Does not exist for `public` surveys. | Yes (linkage) | No | No |
| SurveyAggregate | Implemented as a computed value only (no persisted Firestore document/collection — computed server-side on demand per request; see `docs/features/managed-surveys/SPEC.md`) | Team/survey-instance-level rollup of a closed survey's responses, published only at or above that survey's own `minimumResponses` | No | Possibly (small-team re-identification risk) | No (derived; source responses are encrypted) |
| AnonymousChallenge | Implemented (Firestore-backed, `docs/features/anonymous-challenges/SPEC.md`) | A team member's free-text problem/friction/improvement report, scoped to one team, with no submitter identity ever persisted. Firestore-backed as of Phase 5: `challenges/{challengeId}` (`teamId`, `ciphertext`, `iv`, `authTag`, `keyVersion`, `submittedAt`, `resolvedAt?`, `resolvedBy?`, `archivedAt?`, `archivedBy?`) — `challengeId` is an opaque, Firestore-auto-generated document ID; `resolvedBy`/`archivedBy` identify the *acting admin*, never the submitter, and are never returned by any API response. Derived lifecycle (`"open" \| "resolved" \| "archived"`, `effectiveChallengeStatus`) is computed identically everywhere from `resolvedAt`/`archivedAt`, never a stored status field. Unlike `SurveyResponse`, content is individually visible to any authorized team member/admin once decrypted server-side — only submitter identity is unrecoverable, not content (see `docs/ARCHITECTURE.md`). Server-only via the Firebase Admin SDK; `firestore.rules` denies client-SDK access. | No (must not contain identity fields) | Yes (highly sensitive) | Yes |
| SkillTree | Not implemented (future) | Defines a capability progression (future) | No | No | No |
| SkillNode | Not implemented (future) | One stage within a SkillTree (future) | No | No | No |
| SkillProgress | Not implemented (future) | A team/section's progress against a SkillTree (future) | No | No | No |

## Notes

- `SurveyResponse` and `SurveyParticipation` are intentionally separate
  concepts so that "who participated" cannot be directly joined to "what
  they said" (invariant 7 in `docs/SECURITY.md`). For `authenticated`
  surveys, `SurveyParticipation` exists but shares no identifier, foreign
  key, or content field with the `SurveyResponse` document it accompanies;
  `public` surveys have no participation tracking at all, identical in
  spirit to Phase 1's fully anonymous, dedup-free model.
- `SurveyAggregate` is only computed and exposed when the underlying
  response count meets the configured minimum threshold (invariant 11/12).
  As of `docs/features/managed-surveys/SPEC.md` → "Per-survey result
  threshold," that threshold (`minimumResponses`) is configured per survey
  instance, not a single global value.
- For every concept above marked "Implemented," the relevant
  `docs/features/<feature-id>/SPEC.md` is authoritative for exact field
  names, state transitions, and indexes. For concepts not yet implemented
  (`SkillTree`, `SkillNode`, `SkillProgress`), Firestore collection design
  remains fully deferred to future feature-level work.
