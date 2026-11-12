# Account erasure — Verification record

Evidence records for the verification tasks (TASK-001 to TASK-004). Each section states what was checked, how, and what remains open. A section does not close its task unless its acceptance criteria say so.

## Route authentication (TASK-001) — in progress, 2026-10-28

**Method (read-only).** A script walked the import graph of each `app/api/**/route.ts` (path alias `@/*` resolved, test files excluded) and reported whether a `verifyIdToken(...)` call is reachable from that route.

**Result.** 62 route files. 62 reach a `verifyIdToken` call. 0 reach none.

**Alternative authentication search.** `decodeIdToken`, `verifySessionCookie`, `createSessionCookie`, cookie-based auth, and `currentUser` in server code: none in `app/` or server modules. The only `getAdminAuth()` calls outside the seam are `getUserByEmail` / `getUser` lookups for other people (`create-invitation.ts`, `list-team-access-requests.ts`, `list-team-members.ts`). These are lookups, not caller authentication.

**Result handling spot-check.** Sampled routes (`app/api/me/goals/route.ts`, `app/api/me/role-target/route.ts`) use `authenticate()`: `verified.ok ? verified.identity.uid : null`, then respond 401 on `null`. This matches the seam contract.

**Call-transitive check (2026-10-28, second pass).** A stricter script strips comments and follows relative and `@/` imports. It counts a route as protected only when a real `verifyIdToken(` or `authenticate(` call is reachable, not an import or a comment. Result: 62 PROTECTED, 0 NO-SEAM.

**Ordering check (data access before verification).** For each non-test server module that calls `verifyIdToken`, the first Firestore access token (`runTransaction`, `.collection(`, `.doc(`, `getFirestoreDb(`) was compared with the first verification call. 21 modules showed an earlier token. Each was resolved to its enclosing construct: 19 are default-collection factory or path helpers, 2 (`create-roadmap-item.ts`, `update-roadmap-item.ts`) are interface declarations. None is a data read before verification. The check is positional and does not prove every control-flow path; it is evidence, not proof.

**Client identity scan.** No route reads `uid`, `email`, `actorUid`, `userId`, or `ownerUid` from query, params, or body. Every route inspects the result of its delegate (`ok`, `error`, or `status` present in all 62).

**Intentional unauthenticated routes (classified 2026-10-28, review repair).** Two routes accept requests without a verified token by design, both for `public` surveys (managed-surveys SPEC):
- `app/api/surveys/[surveyId]/route.ts` (GET): a missing or invalid bearer token is passed through as `undefined`. `resolveSurveyForParticipation` returns `sign_in_required` for `authenticated` surveys without a verified identity (`src/features/surveys/server/resolve-survey-for-participation.ts:219-229`). `public` surveys return metadata to any caller by design.
- `app/api/surveys/[surveyId]/responses/route.ts` (POST): an absent or invalid token yields no identity. `submitSurveyResponse` (`src/features/surveys/server/submit-survey-response.ts:352-361`) records an `authenticated` survey only with a verified identity (rejected as `unauthenticated` in Phase B). Public responses carry no identity.

Every other `app/api/**/route.ts` is either authenticated or a delegate of an authenticated module. The app-admin entry points (`admin/**`, `teams/seed-legacy`) reach `requireAppAdmin`, which calls `verifyIdToken`.

**Protected-entry control flow (review repair, 2026-10-28).** For every protected server entry point the first `verifyIdToken` / `requireAppAdmin` call was inspected together with the next lines. Each returns on a failed verification (`if (!verified.ok) return …`, or `if (!admin.ok) return …`) before any Firestore read or write. Entry points that call `authorizeTeamAccess(verified.identity, …)` (13 callers) pass only an identity produced by that verification. Not inspected line by line: the bodies of helper functions that run after the entry check; those were covered by the positional ordering scan above.

**Count reconciliation.** The earlier "44 / 46" figures were not comparable. 46 non-test files mention `verifyIdToken` (including the seam module, imports, and doc comments). 43 non-test call lines call it outside the seam module. Per the feature instructions, this file count is not a security acceptance criterion; the reachability register is the evidence.

**Error-mapping input for TASK-009.** 14 route files map `result.error === "unauthenticated"` to 401. 20 sites use `? 401 :` style conditionals. 21 routes switch on `result.error` inline. New error codes from TASK-009 must fall through to the same 401/500 branches these sites already use.

**Limitations (residual, non-blocking suggestion from the TASK-001 review; TASK-001 is Done).**
- The register proves that each handler reaches a real seam call and that no route bypasses the seam. It does not inspect every handler's control flow to confirm that every rejected path returns before data access. That per-handler control-flow review is the remaining work for this section.

### Route register (TASK-001)

Generated from the import graph of each `app/api/**/route.ts`. Mechanism column: `direct` = the route calls the seam itself; `delegated to <feature>` = the route calls a feature `server` module whose transitive import graph reaches the seam.

| Route | Mechanism |
| --- | --- |
| `app/api/admin/roles/[roleId]/archive/route.ts` | delegated to role-profiles |
| `app/api/admin/roles/[roleId]/route.ts` | delegated to role-profiles |
| `app/api/admin/roles/route.ts` | delegated to role-profiles |
| `app/api/admin/skills/[treeId]/route.ts` | delegated to skill-trees |
| `app/api/admin/skills/overview/route.ts` | delegated to skill-trees |
| `app/api/admin/skills/route.ts` | delegated to skill-trees |
| `app/api/admin/teams/[teamId]/access-requests/[uid]/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/access-requests/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/challenges/[challengeId]/archive/route.ts` | delegated to challenges |
| `app/api/admin/teams/[teamId]/challenges/[challengeId]/resolve/route.ts` | delegated to challenges |
| `app/api/admin/teams/[teamId]/challenges/[challengeId]/route.ts` | delegated to challenges |
| `app/api/admin/teams/[teamId]/challenges/route.ts` | delegated to challenges |
| `app/api/admin/teams/[teamId]/invitations/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/member-refs/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/members/[uid]/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/members/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/route.ts` | delegated to teams |
| `app/api/admin/teams/[teamId]/skills/[treeId]/route.ts` | delegated to skill-trees |
| `app/api/admin/teams/[teamId]/skills/route.ts` | delegated to skill-trees |
| `app/api/admin/teams/[teamId]/surveys/[surveyId]/close/route.ts` | delegated to surveys |
| `app/api/admin/teams/[teamId]/surveys/[surveyId]/open/route.ts` | delegated to surveys |
| `app/api/admin/teams/[teamId]/surveys/[surveyId]/route.ts` | delegated to surveys |
| `app/api/admin/teams/[teamId]/surveys/route.ts` | delegated to surveys |
| `app/api/admin/teams/route.ts` | delegated to teams |
| `app/api/admin/teams/seed-legacy/route.ts` | delegated to teams |
| `app/api/me/conversations/[conversationId]/participant-notes/route.ts` | delegated to development-conversations,development-conversations/domain/errors |
| `app/api/me/conversations/[conversationId]/participation/accept/route.ts` | delegated to development-conversations,development-conversations/domain/errors |
| `app/api/me/conversations/[conversationId]/participation/route.ts` | delegated to development-conversations,development-conversations/domain/errors |
| `app/api/me/conversations/[conversationId]/route.ts` | delegated to development-conversations,development-conversations/domain/dto-keys,development-conversations/domain/errors |
| `app/api/me/conversations/[conversationId]/selectable-members/route.ts` | delegated to development-conversations,development-conversations/domain/errors |
| `app/api/me/conversations/create-options/route.ts` | delegated to development-conversations,development-conversations/domain/errors |
| `app/api/me/conversations/route.ts` | delegated to development-conversations,development-conversations/domain/dto-keys,development-conversations/domain/errors |
| `app/api/me/goals/[goalId]/route.ts` | direct: authenticate in route |
| `app/api/me/goals/route.ts` | direct: authenticate in route |
| `app/api/me/profile/route.ts` | delegated to profiles |
| `app/api/me/role-comparison/route.ts` | delegated to role-profiles |
| `app/api/me/role-target/route.ts` | direct: authenticate in route |
| `app/api/me/route.ts` | delegated to teams |
| `app/api/me/skills/[treeId]/route.ts` | delegated to skill-profiles |
| `app/api/me/skills/route.ts` | delegated to skill-profiles |
| `app/api/roles/route.ts` | direct: verifyIdToken in route |
| `app/api/surveys/[surveyId]/responses/route.ts` | intentional unauthenticated (public surveys; optional token, see above) — delegated to surveys |
| `app/api/surveys/[surveyId]/route.ts` | intentional unauthenticated (public surveys; optional token, see above) — delegated to surveys |
| `app/api/teams/[teamId]/access-requests/route.ts` | delegated to teams |
| `app/api/teams/[teamId]/assignable-members/route.ts` | delegated to teams |
| `app/api/teams/[teamId]/challenges/route.ts` | delegated to challenges |
| `app/api/teams/[teamId]/current-survey/route.ts` | delegated to surveys |
| `app/api/teams/[teamId]/forum/threads/[threadId]/replies/[replyId]/route.ts` | delegated to forum |
| `app/api/teams/[teamId]/forum/threads/[threadId]/replies/route.ts` | delegated to forum |
| `app/api/teams/[teamId]/forum/threads/[threadId]/route.ts` | delegated to forum |
| `app/api/teams/[teamId]/forum/threads/route.ts` | delegated to forum |
| `app/api/teams/[teamId]/members/route.ts` | delegated to teams |
| `app/api/teams/[teamId]/results/route.ts` | delegated to results |
| `app/api/teams/[teamId]/roadmap-items/[treeId]/route.ts` | delegated to roadmap |
| `app/api/teams/[teamId]/roadmap-items/route.ts` | delegated to roadmap |
| `app/api/teams/[teamId]/skill-contribution/route.ts` | delegated to team-skills |
| `app/api/teams/[teamId]/skill-coverage/route.ts` | delegated to team-skills |
| `app/api/teams/[teamId]/skill-needs/[treeId]/route.ts` | delegated to team-skills |
| `app/api/teams/[teamId]/skill-needs/route.ts` | delegated to team-skills |
| `app/api/teams/[teamId]/skills/[treeId]/route.ts` | delegated to skill-trees |
| `app/api/teams/[teamId]/skills/route.ts` | delegated to skill-trees |
| `app/api/teams/route.ts` | delegated to teams |

## Write surfaces (TASK-002) — audit against the current repository, 2026-10-28

**Method (read-only).** Search of `src/**/*.ts` (tests, client gateways and components excluded) for `.add(`, `.set(`, `.update(`, `.delete(`, `.create(`, and `tx.`/`batch.` write calls, followed by a read of each flagged write path. Line numbers are the current ones. The planning-time W-1..W-18 list was checked against this inventory and extended.

**Columns.** Owner = feature module. Op = operation. Atomic = whether the write is inside a Firestore transaction together with its authorization reads. Fence today = whether the write reads `accountErasures/{uid}` (none does yet; no fence code exists before TASK-007/009). Recreate = whether the write can create a new document or stamp a person-linked field after erasure.

### A. Planning list W-1..W-18 (validated)

| ID | Surface (current location) | Op | Person-linked id | Atomic | Recreate risk | Owner task |
| --- | --- | --- | --- | --- | --- | --- |
| W-1 | `profiles/user-profile-store.ts:50-61` upsert (tx) / `:65` remove (plain `.delete()`) | set / delete | `userProfiles/{uid}` | set: yes; delete: **no** | set: yes (re-creates profile); delete: no | TASK-025 |
| W-2 | `skill-profiles/skill-profile-store.ts:102-108` (tx set/update) | set / clear level | `skillProfiles/{uid}` | yes | yes (set creates) | TASK-025 |
| W-3 | `skill-profiles/skill-profile-store.ts:85` (plain `.delete()`) via `delete-own-skill-profile.ts:30` | delete | `skillProfiles/{uid}` | **no** | no | TASK-025 |
| W-4 | `role-profiles/role-target-store.ts:57-59` (tx set in `runSelection`) and `:39` (plain `.delete()`, `clear-own-role-target.ts:14`) | set / delete | `userDevelopment/{uid}/roleTarget` | set: yes; delete: **no** | set: yes | TASK-026 |
| W-5 | `personal-goals/goal-store.ts:72` (`ref.create`, **non-transactional**), `:122` (tx set), `:129` (plain `.delete()`) | create / update / delete | `userDevelopment/{uid}/goals/*` | create: **no**; update: yes; delete: **no** | create: **yes** (new goal under erased uid) | TASK-026 |
| W-6 | `development-conversations/server/conversation-store.ts:96-115` (tx create/set/update/delete for owner documents and participation index) | owner and participant writes | `userDevelopment/{uid}/conversations/*`, participation index keyed by `callerUid` | yes | yes (create/set) | TASK-027 (owner routes), TASK-028 (participant routes) |
| W-7 | `forum/server/create-thread.ts:199` (`collection.add(record)`, not in a transaction; membership read earlier) | create | `authorUid` in the thread record | **no** | **yes** (creates a thread with `authorUid`) | TASK-029 |
| W-8 | `forum/server/create-reply.ts:295` (`collection.add(record)`; default implementation at `:33`). Membership read at `:216`, team status, thread and count reads all **outside** any transaction | create | `authorUid` in the reply record | **no** (confirmed) | **yes**: a reply can be written after the erasure fence is created, with a live `authorUid` | TASK-029 (conversion required) |
| W-9 | `forum/server/delete-thread.ts:42` (plain `.delete()`, via `threadDocs.delete` at `:193`), `delete-thread.ts:78` (batch delete of replies), `forum/server/delete-reply.ts:40-47` (`update` with `deletedBy` set and `authorUid` removed) | delete / tombstone | `deletedBy` = caller uid stamped on the tombstone | **no** (single `update`, not a transaction) | tombstone stamps `deletedBy` (a person-linked field) on a reply the erasure may be deleting; delete alone does not recreate | TASK-029 |
| W-10 | `team-skills/server/skill-contribution-store.ts:62-65` (tx update of `teamMemberships.skillContribution`) | set / withdraw | membership doc id contains uid | yes | update of a membership doc (no create) | TASK-031 |
| W-11 | `teams/server/create-access-request.ts:81` (tx set) | create | `teamAccessRequests` with uid | yes | yes (creates a request) | TASK-030 |
| W-12 | `challenges/server/submit-challenge.ts:213` (`collection.add(record)`, not transactional) | create | **none** (record holds team id, ciphertext, timestamp; no uid) | **no** | no personal id; W-12 requires the fence anyway (SPEC) | TASK-033 |
| W-13 | `surveys/server/submit-survey-response.ts:95, 248, 255` (tx set of response and participation) | create | response (anonymous, no uid), participation record with uid | yes | yes (participation creates a link) | TASK-033 |
| W-14 | `roadmap/server/create-roadmap-item.ts:113, 283` (tx create, `createdBy: uid` at `:273`); `update-roadmap-item.ts:124, 277, 358` (tx update, `updatedBy`) | create / update | `createdBy`, `updatedBy` = lead uid | yes | yes (stamps uid onto a roadmap item) | TASK-032 |
| W-15 | `skill-trees/server/report-team-skill-progress.ts:80, 297` (plain `.update`, outside transaction, `updatedBy` = uid); `update-team-skill-progress.ts:37, 206` (plain `.update`, `updatedBy`); `start-team-skill-tracking.ts:105, 214` (`.set`); `stop-team-skill-tracking.ts:26, 88` (plain `.delete`) | update / set / delete | `updatedBy` on `skillProgress/{teamId}__{treeId}` | **no** for the updates and the delete; the start path is `.set` | yes for update stamp and start set | TASK-031 |
| W-16 | `teams/server/resolve-invitations.ts:68, 94` (tx update, `resolvedUid`), `teams/server/create-invitation.ts:81` (`.set(record)`, not transactional, invitee e-mail), `:87` (`.update` accepted, `resolvedUid`), `teams/server/cancel-invitation.ts:30` (plain `.update`) | create / update | `teamInvitations` with e-mail, `resolvedUid` | mixed: `create-invitation` set **no**, `resolve-invitations` tx yes | yes | TASK-030 |
| W-17 | Admin stamp writes. Surveys: `surveys/create-survey.ts:173` (`collection.add`), `surveys/open-survey.ts:227-228` (tx), `surveys/close-survey.ts:191-198` (tx), `surveys/delete-or-archive-survey.ts:38, 41, 206` (plain `.delete`/`.update`), `results/get-team-survey-results.ts:149` (see B-1). Challenges: `challenges/archive-challenge.ts:41, 164`, `resolve-challenge.ts:39, 172`, `delete-challenge.ts:39, 151` (plain). Skill trees: `skill-trees/create-skill-tree.ts:88` (`add`), `update-skill-tree.ts:35, 165`. Roles: `role-profiles/role-store.ts:84, 117`. Teams: `teams/create-team.ts:80` (`add`), `set-team-status.ts:24`, `approve-access-request.ts:68`, `reject-access-request.ts:50` | create / update / delete with `createdBy`, `updatedBy`, `resolvedBy`, `archivedBy` | mixed (see right) | mixed: create via `add` **no**, plain delete/update **no**, tx open/close **yes** | yes: stamps of the admin uid | TASK-034 (surveys, challenges), TASK-035 (skill trees, roles, team management) |
| W-18 | `demo-team/adapters.ts:191-195`, `writer.ts:82-84` (`batch.create` / `batch.set`) | create / set | demo presenter uid | batch (not transaction) | yes | TASK-036 |

Every W-1..W-18 surface is assigned to exactly one of TASK-025..TASK-036 above (W-6 by route group, W-17 by part). No planning-list entry is missing from the current code.

### B. Surfaces discovered beyond the planning list

| ID | Surface | Op | Person-linked | Atomic | Recreate risk | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| B-1 | `results/get-team-survey-results.ts:149` `update({ closedAt })` on a survey (lazy close from a read) | update | none (survey and team level, no uid) | **no** | no | Not person-linked. No fence is required for the erasure guarantee. Keep out of the fence list; record here so it stays visible. |
| B-2 | `teams/server/grant-team-membership.ts:40-51` `applyMembershipGrant` (tx set, `memberRef` generated) called from `teams/server/approve-access-request.ts:61` and `teams/server/resolve-invitations.ts:87` | create | membership doc id contains uid | yes | **yes** (creates a membership for a uid) | `resolve-invitations` owned by TASK-030. `approve-access-request` (admin write) owned by TASK-035. Both callers must read the fence inside their transaction. |
| B-3 | `teams/server/remove-team-member.ts:24` plain `.delete()` on a membership | delete | membership id contains uid | **no** | no (delete only) | TASK-035 (team management). Conversion to a transaction with fence read recommended for consistency. |
| B-4 | `teams/server/set-team-member-role.ts:66, 148` tx update of a membership | update | membership | yes | update of an existing membership; no create | TASK-035 |
| B-5 | `teams/server/materialize-member-refs.ts:66` tx update of membership `memberRef` | update | membership | yes | update only | TASK-035 |
| B-6 | `teams/server/seed-legacy-teams.ts:67` `doc(teamId).create` | create | team (no uid stamp observed) | yes | no personal link found | TASK-035 (admin path, fence for consistency) |
| B-7 | `skill-trees/server/start-team-skill-tracking.ts` tx/`set` and `team-skills/server/skill-needs-store.ts:83-86` (tx set/delete on `teamSkillNeeds`) | create / delete | `SkillNeedRecord` holds `teamId`, `treeId`, levels and timestamps; **no uid** | yes | no personal id | Team-level writes with no person-linked field. Not in the fence list; recorded so the classification is explicit. |

### Authentication path for each write

Every write above sits behind `verifyIdToken` (member writes, owner writes) or `requireAppAdmin` (admin stamps), or is an anonymous write (challenges, public survey response). Route-level evidence is in "Route authentication". No write takes a uid from the client.

### Summary for downstream tasks

- **Non-transactional person-linked creates that must be converted:** W-7 (`create-thread`), W-8 (`create-reply`, confirmed), W-5 create (`goal-store.ts:72`), W-16 `create-invitation.ts:81`, W-17 `create-survey.ts:173`, `create-team.ts:80`, `create-skill-tree.ts:88`, `role-store.ts:84`, B-6.
- **Non-transactional plain deletes/updates on person-linked stores (no recreation, but listed for conversion):** W-1 delete, W-3, W-4 delete, W-5 delete, W-9, W-15 update/delete, W-16 cancel, B-3.
- **Race windows that the fence must close:** any write whose authorization read and write are in separate operations (W-7, W-8, W-12, W-16 create, W-17 add). The fence read must be inside the transaction that performs the write, with the authorization reads.
- **Not part of the fence:** erasure's own step writes (SPEC BR-4(b)), and B-1.

### Observations outside erasure scope (not fixed here)

- `create-reply.ts` counts replies (`countRepliesForThread`) outside its write. Two concurrent replies can exceed `REPLY_CAPACITY_LIMIT`. This is an existing capacity race, not an erasure finding. Recorded for TASK-029, which rewrites this path.

### Status

No product code changed. The audit results drive TASK-025..TASK-036. Every conversion needs its fence read inside its own transaction, so the transaction harness (TASK-004, D-EMU) is the proof point for that.

## Firebase Auth assumptions (TASK-003) — audit, 2026-10-28

**Scope and method.** Read-only inspection of the installed `firebase-admin` **14.3.0** (`node_modules/firebase-admin/lib/auth/`), the repository seam (`src/features/auth/server/verify-identity.ts`), and its test. No network call and no Firebase access. Nothing in this section claims a real-environment result.

### A. Proven from installed SDK source and repository tests

| # | Assumption (SPEC table / TASKS) | Status | Evidence |
| --- | --- | --- | --- |
| A-1 | `checkRevoked` is enabled on every verification | **source-verified + test** | `verify-identity.ts` `defaultVerifyToken` calls `verifyIdToken(token, true)`. Test `verify-identity.test.ts:112` asserts `toHaveBeenCalledWith("valid-token", true)`. |
| A-2 | `checkRevoked: true` calls `getUser(uid)` on every verification | **source-verified** | `base-auth.js:116-124` → `verifyDecodedJWTNotRevokedOrDisabled` → `base-auth.js:962` `this.getUser(decodedIdToken.sub)`. No cache is in this path. |
| A-3 | A deleted user rejects with `user-not-found` | **source-verified** | `getUser` → `getAccountInfoByUid` → `auth-api-request.js:552-567` response validator throws `USER_NOT_FOUND` when `data.users` is empty. `error.js:114` maps it to `auth/user-not-found`. The rejection propagates out of `verifyIdToken`. |
| A-4 | A disabled user rejects with `user-disabled` | **source-verified** | `base-auth.js:962-966` throws `USER_DISABLED` (`auth/user-disabled`) when `user.disabled`. The check runs before the revocation-time check. |
| A-5 | Revoked session (`tokensValidAfterTime`) rejects | **source-verified** | `base-auth.js:968-978`: a token with `auth_time*1000 < tokensValidAfterTime` throws `ID_TOKEN_REVOKED` (`auth/id-token-revoked`, `error.js:38, 174`). |
| A-6 | `deleteUser` exists on the Admin Auth API | **source-verified** | `base-auth.js:339` `deleteUser(uid)` → `auth-api-request.js:1132-1140` `POST /accounts:delete` with `localId`. The SDK rejects an invalid uid with `INVALID_UID` before the request. |
| A-7 | `auth_time` is present on decoded tokens and typed | **source-verified** | `token-verifier.d.ts:44` `auth_time: number` on `DecodedIdToken`. `base-auth.js:970` reads it for the revocation check. |
| A-8 | `auth_time` is the sign-in time, the same across ID-token refreshes in one session | **SDK-documented** (typings) | `token-verifier.d.ts:36-42`: "the same `auth_time` value" across refreshes; `iat` changes. This is the SDK's stated contract. It is not exercised against a live project (see B-2). |
| A-9 | The seam fails closed for any verification error | **source-verified + test** | `verify-identity.ts:49-50` catches every error from `verifyToken` and returns `invalid_token`. Tests `verify-identity.test.ts` cover a rejected verify. |
| A-10 | The emulator path also checks revocation | **source-verified** | `base-auth.js:117` `isEmulator` forces the revocation check. Not relevant to production, recorded for D-EMU only. |

**Contradicted items: none.** The SPEC's stated assumptions in its "Authentication and token lifecycle" table hold against the installed SDK.

### A-bis. Mapping of every SPEC "Authentication and token lifecycle" row (review repair, 2026-10-28)

| SPEC row | Status | Record |
| --- | --- | --- |
| Is `checkRevoked` enabled? | source-verified + test | A-1, A-2 |
| Does Auth deletion invalidate old ID tokens on all routes? | source-verified for the seam; route coverage is TASK-001 | A-2, A-3; route register in "Route authentication" |
| Can a stale token keep authenticating after Auth deletion? | source-verified (SDK path); live confirmation required | A-3; B-1 |
| Can a person sign in again during a partial erasure? | **environment-required** (client sign-in is outside the Admin SDK and cannot be run here). The Admin SDK does not block sign-in; the fence does, through `verifyIdToken`. | B-7 (below) |
| Is Auth deletion safe as the first step? | design consequence, not an Auth assumption. The SDK shows a deleted user cannot be verified (A-3), so the SPEC's last-step ordering (BR-6) is required. | A-3, A-6 |
| Are uids ever reused? | **environment-required** (AE-A1) | B-3 |
| Does the seam need a centralized fence? | design consequence. Only `verifyIdToken` verifies protected requests (TASK-001). | "Route authentication" |
| Is `auth_time` available? | source-verified | A-7 |

### B. Requires a real environment or operator action (not claimed as proven)

| # | Item | Why it cannot be proven here | Carried to |
| --- | --- | --- | --- |
| B-1 | Live Auth returns an empty `users` list (so A-3 holds) for a deleted uid | The response validator is in the SDK, but the server behaviour is observed only against a live project. | TASK-045 |
| B-2 | `auth_time` after refresh vs fresh sign-in on the deployed project | A-8 is the SDK's contract; a live refresh is needed to confirm it for this project. | TASK-045 |
| B-3 | uid non-reuse after deletion (AE-A1) | The SDK lets the server generate the uid (`createNewAccount`). Non-reuse is a Firebase service property, not visible in the repo or the SDK. | TASK-045 (operator review) |
| B-4 | `deleteUser` permission for the production service account | The SDK call is visible; IAM is not. | TASK-045 |
| B-5 | `verifyIdToken(..., true)` on the deployed project, including the time the revocation check takes | Behaviour is source-proven (A-1 to A-5); end-to-end on the deployed project is not. | TASK-045 |
| B-7 | Client sign-in while the Auth user exists during a partial erasure | Client Auth flows are outside the Admin SDK. The seam makes a signed-in person fail `erasure_in_progress` via the fence (TASK-009), but whether sign-in succeeds is an Auth-service fact. | TASK-045 |
| B-6 | Real Auth outage behaviour | A failed `getUser` is caught by the seam and mapped to `invalid_token` (A-9). A real outage should instead yield a fail-closed `auth_unavailable`, which is a TASK-009 design item. | TASK-009 (design), TASK-045 |

### C. Risks recorded for later tasks (not findings against TASK-003)

- **R-1 (for TASK-009):** `verify-identity.ts:49-50` maps every verification error to `invalid_token`, including transient Auth or network failures. Fence code must keep failure classes distinct: `auth_unavailable` must fail closed without being reported as an expired or revoked token. The SPEC enum already includes `auth_unavailable`.
- **R-2 (for TASK-010):** `VerifiedIdentity` does not yet expose `auth_time`. A-7 confirms the field exists on the decoded token, so TASK-010 can add it without an SDK change.
- **R-3 (for TASK-009):** The fence design depends on A-2 (an extra `getUser` already runs when `checkRevoked` is true). The fence read of `accountErasures/{uid}` is additional, not a replacement.

### Conclusion

Every row in the SPEC "Authentication and token lifecycle" table is now classified: source-verified (A-1..A-7, A-9), or environment-required (B-1..B-5). The uid non-reuse property (AE-A1) remains an environment and operator assumption. No Firebase access was made. No product code changed.

## Transaction harness (TASK-004) — automated part Done (2026-10-29); D-EMU manual gate NOT RUN — superseded by the owner-provided PASS (see "D-EMU manual gate: owner-provided result (PASS)")

**Automated part (Done).** `src/features/auth/server/erasure-write-fence.ts` provides `runFencedTransaction(db, uid, write)` and `assertNoErasureRecordInTransaction(db, tx, uid)`. The fence read is `tx.get` on `accountErasures/{uid}`, in the same transaction as the write; the write runs only after the admit. Any record (`in_progress`, `auth_deleted`, `completed`, malformed) throws `ErasureWriteRefused` (`erasure_in_progress`) and performs no write. A failed read rejects and the write does not run. Only the `Transaction` type is accepted, so a plain document `get` cannot stand in for the fence read at the type level, and the test asserts the document `get` spy is never called. Evidence (2026-10-29): `pnpm vitest run src/features/auth/server/erasure-write-fence.test.ts` 10/10; `pnpm vitest run src/features/auth src/features/account-erasure` 17 files, 294/294; `pnpm typecheck` exit 0; `pnpm eslint` on the two new files exit 0.

**Independent review (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS. Important (stale 2026-10-28 cross-document status) repaired by a dated update in the milestone section. Suggestion applied: a test that a record with unreadable data is still refused. The reviewer confirmed that the D-EMU race is not claimed as proven and that TASK-041 stays blocked on it.

**Scope limit of the automated part.** These tests are structural and use an in-memory fake. They do **not** prove Firestore's commit-ordering race. They also do not prove that every person-owned writer uses the helper: that is the job of TASK-025..036.

**Status of the proof.** The Firestore Emulator race proof has **NOT been performed**. No result is recorded below. TASK-004 does not claim it passed. (Superseded: the owner-provided PASS is recorded in "D-EMU manual gate: owner-provided result (PASS)".)

**Open item for the manual gate.** The procedure below names `src/features/auth/server/erasure-fence.race.emulator.test.ts`. That file does not exist yet. It must be written, targeting only the emulator host, before the manual run. Writing it is part of the D-EMU gate, not of the automated part.

**D-EMU (updated 2026-10-28).** The proof is a manual verification gate against the local Firestore Emulator, performed before final closeout. The repository adds no Java, emulator tooling, or emulator dependency for it. No real Firebase project is used.

**Prerequisite status.** No Java runtime was found on the development machine at 2026-10-28 (`java` not on PATH; no JDK under `JAVA_HOME`, `C:\Program Files\Java`, `C:\Program Files\Eclipse Adoptium`, or `C:\Program Files (x86)\Java`). This blocks only the manual run.

### D-EMU manual gate — procedure (Windows PowerShell)

Run this only against the local emulator. Do not run it against a real project.

1. Verify Java 21+ (install a JDK 21+ first if the check fails):
   ```powershell
   java -version
   ```
2. Start ONLY the local Firestore Emulator, from the repository root (the project ID is a placeholder; it must not be a real project):
   ```powershell
   npx firebase emulators:start --only firestore --project demo-erasure-race
   ```
3. In a second PowerShell window, run the race proof against the emulator (the script is written in TASK-004 to target the emulator host only):
   ```powershell
   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
   pnpm vitest run src/features/auth/server/erasure-fence.race.emulator.test.ts
   ```
4. Expected result: the test passes. The transaction that read "no record" before the fence was created fails to commit after the fence is created.
5. Shut down the emulator: press Ctrl+C in the first window.
6. Record the evidence below: date, Java version, emulator version (`npx firebase --version`), exact command, pass/fail, and the vitest summary line.

**Evidence (fill in only after the run):**
- Date: —
- Java version: —
- Emulator / firebase-tools version: —
- Result: NOT RUN (historical template value of 2026-10-28; superseded by the owner-provided PASS)
- Test output summary: —

Closeout (TASK-041 / final security verification) stays blocked until the Result above reads PASS with a summary line.


## Invitations and access requests (TASK-017), 2026-10-29

**Implementation.** `src/features/account-erasure/server/invitations-erasure.ts`. Four categories, in order, one target per batch in a transaction that re-checks the predicate: (1) own `teamAccessRequests` by uid field or legacy `uid__` prefix, deleted (I-10); (2) `teamInvitations` whose stored email normalizes to the erased normalized email, or whose `resolvedUid` is the uid, in any status, deleted (I-11); (3) others' `teamAccessRequests.resolvedBy` set to null (A-9); (4) others' `teamInvitations.invitedBy` set to null (A-10). The erased person's normalized email comes from an injected resolver, since it is not in the runner's input (production: the Auth record, which still exists before `auth_delete`). A failed resolution fails closed as `auth_unavailable`. Tests `invitations-erasure.test.ts` 15/15 (as of the review 2 repair; the 11 of the first implementation plus the document-id and null-actor tests).

**Resolved 2026-10-29 (approved option (a)).** See "Resolution (2026-10-29)" at the end of this section. The text below is the state as it was before the decision, kept as history.

**Blocking decision (historical): A-10 and the invitation read path.** The SPEC requires `invitedBy` to be nulled and the invitation kept ("preserved for other emails"). The task text also says the teams invitation read path stays unchanged. Those two cannot both hold today:
- `src/features/teams/domain/team-invitation.ts`: `isValidPendingInvitationFor` and `isValidPendingInvitationForTeam` reject a record whose `invitedBy` is not a non-empty string. A nulled invitation would be treated as malformed.
- `src/features/teams/client/admin-team-detail-gateway.ts`: `invitedBy` must be a non-empty string, so the admin client drops the record.
- `src/features/teams/server/list-team-invitations.ts` maps `invitedBy` as a string.

The failure is fail-closed (the invitation is hidden), not a leak. It is still a visible change for the inviting admin's list, and the display of an erased inviter is a product decision the SPEC does not settle. **Decision needed (smallest form):** choose one of
- (a) keep the A-10 null and allow `invitedBy: null` in the teams validators, the admin gateway, and `list-team-invitations`, with the admin list showing the invitation with no inviter name; this changes the read path, so the task text needs a dated amendment;
- (b) keep the A-10 null and hide an invitation whose inviter is erased from the admin list (no other read change), recorded as a visible behaviour;
- (c) change A-10 to delete those invitations instead, which contradicts the SPEC's "preserved for other emails" and needs a SPEC decision.
Record the answer in SPEC (D5/A-10) and in TASKS TASK-017; then TASK-017 can be re-checked and closed.

Until then the step is not wired to production (`PRODUCTION_HANDLERS_READY` is false, TASK-038 wires it). The other three categories are independent of this decision.

**Commands (2026-10-29).** `pnpm vitest run src/features/account-erasure/server/invitations-erasure.test.ts`: 15/15 at review 2 (12/12 after the document-id match was added, then 15 with the null-actor regression tests). The focused pair `invitations-erasure.test.ts` and `erased-inviter-invitations.test.ts`: 27/27. `pnpm typecheck`: exit 0. `pnpm eslint` on the step and its test: exit 0.

### Resolution (2026-10-29)

**Decision:** option (a), approved. A preserved invitation with an erased inviter keeps its business data, and `invitedBy` is `null`. The null is a valid post-erasure state. Malformed inviter values remain rejected.

**Read-path changes (narrow, per the TASKS.md dated amendment):**
- `src/features/teams/domain/team-invitation.ts`: `TeamInvitationRecord.invitedBy` is `string | null`. `isValidPendingInvitationFor` and `isValidPendingInvitationForTeam` accept exactly `null` or a non-empty string, through a single helper `isValidInviter`.
- `src/features/teams/server/list-team-invitations.ts`: the admin row type is `invitedBy: string | null`. The row carries no other inviter field.
- `src/features/teams/client/admin-team-detail-gateway.ts`: the entry accepts exactly `null` or a non-empty string. Any other value still fails the whole list closed.
- `src/features/teams/domain/team-membership.ts` and `src/features/teams/server/grant-team-membership.ts`: `grantedBy` is `string | null`, so a resolved preserved invitation records `grantedBy: null`.
- No UI change. `AdminTeamDetail.tsx` shows only the invitation email; it never rendered the inviter.

**Verification (each item from the approval):**
1. A normal invitation with an existing inviter: valid for the team and for its email (`erased-inviter-invitations.test.ts`).
2. A preserved invitation with `invitedBy: null`: valid for the team and for its email; kept in the admin list (`invitedBy: null`).
3. The null state is visible where authorized: the admin list returns it (test asserts the row).
4. No inviter uid, name, or email leaks: the row has exactly `email`, `invitedBy`, `createdAt`; the serialized row contains no `uid`, `erased`, or `deleted` text (test asserts it).
5. Malformed inviter values stay rejected: missing, empty, number, object, boolean for both predicates (`it.each`), and the admin list drops such a row while keeping a valid neighbour. The gateway rejects the whole list on a malformed value.
6. Authorization and visibility are otherwise unchanged: a non-admin still gets `ok: false` with a null-inviter invitation present (test asserts it). The list stays app-admin only.
7. TASK-017 focused tests: `pnpm vitest run src/features/account-erasure/server/invitations-erasure.test.ts` 15/15 (and 27/27 with `erased-inviter-invitations.test.ts`).
8. Affected teams, roadmap, and erasure tests: `pnpm vitest run src/features/account-erasure src/features/teams src/features/roadmap`: 84 files, 1862/1862 passed (2026-10-29).
9. `pnpm typecheck`: exit 0. `pnpm eslint` on the changed teams and account-erasure files: exit 0.

**Historical email limitation (documented, for TASK-044 OPERATIONS).** Only the current verified email is used to locate invitations. An invitation sent to an address the person no longer uses cannot be linked to them and is not erased by this step.

**Document-id email (approved requirement).** The step matches a document id ending in `__${normalizedEmail}` even when the stored `email` field differs. The production adapter must cover that match without a new `normalizedEmail` field. Its approach (for example a bounded scan) and cost are an explicit TASK-038 acceptance item.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** CHANGES_REQUIRED. Blocking (confirmed from the code): `parseRecord` dropped the whole record when `resolvedBy` or `invitedBy` was an explicit `null`. That is the state an earlier A-9 or A-10 step leaves behind, so an own access request whose approver was erased, or a matching invitation whose inviter was erased, failed as `verification_failed` and the erasure stalled. That contradicted the approved "null is a valid post-erasure state" rule. Important: no test re-ran the step over a cleared record, which is why 12/12 did not catch it. Suggestion: the non-admin visibility test now also checks a string inviter as a contrast.

**Repair.** `resolvedBy` and `invitedBy` now read an explicit `null` as "no actor" (`optionalActor`). `uid`, `email`, and `resolvedUid` still reject `null` as malformed. Regression tests in `invitations-erasure.test.ts`: an own access request with `resolvedBy: null` is deleted; a matching invitation with `invitedBy: null` is deleted; a `null` uid still fails closed. After the repair: `pnpm vitest run src/features/account-erasure src/features/teams src/features/roadmap`: 84 files, 1865/1865; typecheck exit 0; eslint exit 0.

**Independent review 2 (fresh read-only re-reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS. The Blocking defect is fixed: a null `resolvedBy` or `invitedBy` is absent, so the own access request and the matching invitation are deleted, and the null-uid case still fails closed. Categories 3 and 4 match by exact equality, so a null never matches and a cleared record cannot loop. The null-inviter read path is unchanged. Suggestion applied: the stale 12/12 counts above are corrected to 15/15 (27/27 for the pair). Nothing else open.

## Memberships erasure step (TASK-016), 2026-10-29

**Implementation.** `src/features/account-erasure/server/membership-erasure.ts`. Per membership, one transaction: read the membership; if it has a `memberRef`, clear every `roadmapItems.ownerRef` in the same team that equals that `memberRef` (bounded by `maxWrites`, and the membership is not deleted while any remain); then delete the membership document. Matching is by the opaque `memberRef` and team, never by uid (A-5). A legacy membership with no `uid` field is found by its `uid__` prefix. A membership whose `uid` belongs to someone else, or a malformed field, fails closed with `verification_failed` and writes nothing. The step reports `done` only when no membership of the uid is left. The Admin SDK port is deferred to TASK-038, as for the forum step.

**Cross-feature.** Roadmap readers already drop a non-string `ownerRef` to an unowned item (`parseRoadmapItem`), so a cleared reference reads as unowned; a test asserts it. Roadmap writers already accept `ownerRef: null` as a clear (`update-roadmap-item.ts`, existing tests).

**Tests and commands (2026-10-29).** `membership-erasure.test.ts` 11/11. `pnpm vitest run src/features/account-erasure`: 11 files, 227/227. `pnpm vitest run src/features/roadmap src/features/teams`: 71 files, 1609/1609. `pnpm typecheck`: exit 0. `pnpm eslint` on the step and its test: exit 0.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS, no Blocking or Important. Ordering and termination traced: the membership is deleted only after its owner-reference query returns nothing, and `done` only when no membership is left. Suggestions, all applied:
- The budget test now runs to done with `maxWrites` 1 and asserts the full order `clear:item-a, clear:item-b, delete`.
- A negative test: an owner reference whose value equals the erased uid is left alone. Matching is by `memberRef` only.
- The describe title is now "roadmap reader accepts a null ownerRef". The writer claim rests on the existing roadmap tests (`update-roadmap-item.ts` clears on null), and TASKS.md is reconciled to say no roadmap source change was needed.
- **Decision (recorded):** an empty or whitespace-only `memberRef` or `teamId` is malformed and fails closed with `verification_failed`, so the membership is kept and the step does not silently delete it. Tested with `memberRef: ""`. The trade-off: such a membership would stall erasure for an operator to resolve. That is the intended fail-closed choice.
- A comment now records the legacy-id assumption: a generated uid does not contain `__`. The uid-field check is the primary guard where a uid field exists.
- Noted, no change: a membership that disappears between discovery and its transaction returns `more` without a write. It cannot loop, because the next discovery no longer returns it and the runner budget bounds retries.

**Commands after review (2026-10-29).** `pnpm vitest run src/features/account-erasure`: 11 files, 229/229. `pnpm typecheck`: exit 0. `pnpm eslint src/features/account-erasure`: exit 0.

## Survey participations (TASK-021), 2026-10-29

**Implementation.** `src/features/account-erasure/server/survey-participations-erasure.ts`. One participation per batch, in a transaction that re-reads it and re-checks ownership before the delete. Ownership is the `uid` field; a legacy record with no `uid` field is owned only when its id is exactly `${uid}__${surveyId}` for its own `surveyId` (reconciled after review 3; the earlier prefix wording is superseded). A foreign or unattributable record fails closed as `verification_failed`. The port exposes no `surveyResponses` access, so anonymous responses (P-1, AE-SI-8) cannot be read or written by this step. Open authenticated surveys are included, since the document is deleted without a survey-state check.

**Tests and commands (2026-10-29).** `survey-participations-erasure.test.ts` 8/8: uid-field deletion including an open survey; legacy prefix deletion; another person's participations untouched; the port has only `runTransaction` and `participationIdsFor`, and the response map is unchanged; a foreign uid field fails closed with no delete; a legacy record outside the erased uid's prefix fails closed; done when none is left; zero-budget refusal. `pnpm vitest run src/features/account-erasure/server/survey-participations-erasure.test.ts src/features/surveys`: 18 files, 324/324. `pnpm typecheck`: exit 0. `pnpm eslint src/features/account-erasure`: exit 0.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** CHANGES_REQUIRED. Important: the response-isolation test asserted the keys of its own fake, so it could not fail on the step's behaviour and did not meet the "no surveyResponses access (test)" criterion. Repaired: the test now asserts the step's own port type at compile time (`expectTypeOf` on `keyof SurveyParticipationsErasurePort` and on the transaction type), and asserts from the step source that its only import is the erasure runner, so a surveys import would fail. A runtime test checks that every delete targets a participation document. Suggestions, applied: the legacy-mismatch test asserts the code `verification_failed`; a ghost-id test asserts that a listed id with no record is never deleted, and that the step still reaches done. The ownership rule was confirmed correct, the id scheme matches the surveys domain, and open surveys are not special-cased, as the SPEC requires. After the repairs: `pnpm vitest run src/features/account-erasure src/features/surveys`: 32 files, 600/600; typecheck exit 0; eslint exit 0.

**Independent review 2 (fresh read-only reviewer, 2026-10-29).** CHANGES_REQUIRED, three Important. Repairs:
- The source check now reads every module specifier in the step file (static, multi-line, and dynamic imports) and asserts that the list is exactly `["./erasure-runner"]`. The earlier line-based check missed multi-line imports.
- The runtime "responses unchanged" assertion and the weak log check were removed. They could not fail on the step's behaviour. The response-isolation claim now rests only on the compile-time port-type check and the complete import check, and nothing else is described as runtime proof.
- A real ownership hole was fixed. A legacy record with no `uid` field was owned by a prefix `uid__`, so for erased uid `a`, a legacy record `a__b__s` owned by uid `a__b` would have been deleted. The legacy rule is now exact: the id must equal `${uid}__${surveyId}` for the record's own `surveyId`. The regression test asserts `verification_failed` and no delete.
- Suggestion applied: a listed id with no record now fails closed as `verification_failed` (nothing is deleted). A record that was really removed is no longer listed on the next request, so the step proceeds then.
After the repairs: `pnpm vitest run src/features/account-erasure src/features/surveys`: 32 files, 600/600; typecheck exit 0; eslint exit 0.

**Independent review 3.** CHANGES_REQUIRED, three Important, all repaired: the ghost test asserted a log that could never change (now a local deletes array); the module header described the old prefix rule (now the exact-id rule and the ghost rule); and TASKS/VERIFICATION still described the prefix rule and an unprovable runtime claim (restated; the import check is the compile-time plus source check). The import check now also covers `require`.

**Independent review 4 (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS, no Blocking or Important. Verified: the ghost test is not vacuous; the header matches the code; the stale wording is gone; the import check catches `from`, `import`, `import()` and `require`; ownership is exact and re-checked inside the transaction. Suggestions, applied: the import regex covers the no-space forms (`import"x"`, `from"x"`); the port contract now documents that an unowned listed id blocks erasure until resolved, and that a production adapter should use an exact-id filter where it can. Final: `pnpm vitest run src/features/account-erasure src/features/surveys`: 32 files, 600/600; typecheck exit 0; eslint exit 0. TASK-021 is Done.

## Personal data erasure (TASK-022), 2026-10-29

**Implementation.** `src/features/account-erasure/server/personal-data-erasure.ts`. Raw, idempotent, existence-based deletion of: the skill profile (I-1), the user profile (I-2), the whole role-target subtree (I-4, paged), and the personal goals (I-3, paged). Order per batch: skill profile, user profile, role targets, goals. The port hides the store paths; the production adapter is a TASK-038 item.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS, with one Important: I-4 is the whole `roleTarget` subtree, not only `current`, and the step had covered only `current`. Repaired: role targets are now paged over the subtree (`roleTargetIds`, `deleteRoleTarget(uid, id)`), like goals, and a test removes every role-target document. Suggestions, applied or recorded: the TASK-038 adapter must cover the whole roleTarget and goals subtrees, and its tests must assert that a delete removes the id it was given (a silent no-op would repeat a page). The malformed-data test is now labelled as a port-contract test; malformed removal against the real store is a TASK-038 adapter test.

**Tests and commands (after the repair, 2026-10-29).** `personal-data-erasure.test.ts` 8/8. `pnpm vitest run src/features/account-erasure src/features/personal-goals src/features/profiles src/features/skill-profiles`: 60 files, 1574/1574. `pnpm typecheck`: exit 0. `pnpm eslint src/features/account-erasure`: exit 0.

**Independent review 2 (fresh read-only re-reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS. No code finding. Termination confirmed (every "more" follows at least one delete, because each listed id is deleted in the same batch and the limit is at least 1); coverage confirmed (skill profile, user profile, the whole role-target subtree, goals, then done only when all four are empty); the step touches only the erased uid's four stores. Its two Important items were documentation accuracy and are corrected: the TASKS Outcome now names the whole `roleTarget/*` subtree, and the TASKS status now says 8/8 and labels the malformed case as a port-contract test with the real malformed removal in the TASK-038 adapter test. One test was renamed so it does not over-claim. Suggestion (optional): the role-target test could also assert the batch count; not applied, because the log assertion already shows the three deletes. Verification after these corrections: `pnpm vitest run src/features/account-erasure/server/personal-data-erasure.test.ts`: 8/8; typecheck exit 0; eslint exit 0. TASK-022 is Done.

## Full-suite checkpoint after TASK-023 (2026-10-29)

**Result.** `pnpm test`: 444 files, 8581 tests, exit 0. `pnpm typecheck`: exit 0. `pnpm lint`: exit 0.

**One failure found on the first run and repaired.** The team-skills guard `team-skills-cross-cutting.test.ts` ("no production code introduces D1/D2 concepts") flags the literal `roleDefinitions` outside its exempt files. The TASK-023 step named that collection in its own target list. The list now lives in the account-erasure registry (`inventory.ts`, already an exempt file, because the registry is the approved home of erasure collection names), and the step imports it. No guard allow-list was widened.

## Actor audit: survey, catalogue and challenge fields (TASK-023), 2026-10-29

**Approach.** The same approved rule as TASK-017 applies: a preserved record keeps its business data, and its erased actor field becomes exactly `null`. A `null` actor is valid; any other malformed value stays rejected. No value is derived from the uid (AE-SI-7).

**Erasure step.** `src/features/account-erasure/server/actor-audit-erasure.ts`. A closed list of eight actor fields: `surveys.createdBy` (A-1); `skillTrees.createdBy`, `updatedBy` (A-2); `roleDefinitions.createdBy`, `updatedBy`, `archivedBy` (A-3); `challenges.resolvedBy`, `archivedBy` (A-7). One document per batch, in a transaction that re-reads it and checks that the field equals the uid before clearing it. A listed document that does not match or does not read back fails closed as `verification_failed`. Only the one field is cleared; challenge ciphertext and timestamps are kept.

**Validators and readers (cross-feature, required by the SPEC).** Each actor field accepts exactly `null` or a non-empty uid:
- `surveys/domain/survey.ts`: `createdBy`; the admin list DTO (`surveys/server/list-team-surveys.ts`) and admin gateway (`surveys/client/admin-survey-gateway.ts`) carry `createdBy: string | null`. The surveys UI never renders this field, so no UI change was needed (checked by grep).
- `skill-trees/domain/skill-tree.ts`: `createdBy`; the `updatedBy` pair rule accepts a `null` updater alongside its timestamp, and still rejects an updater without a timestamp.
- `role-profiles/domain/role-definition.ts`: `createdBy`, `updatedBy`, `archivedBy` in the stored-role parser.
- `challenges/domain/challenge.ts`: the `resolvedBy` and `archivedBy` pairs accept `null` with their timestamps.
`pnpm typecheck` lists no other consumer that needed a change.

**Tests and commands (2026-10-29).** `actor-audit-erasure.test.ts` 6/6: the eight fields are cleared and nothing else changes, with challenge ciphertext kept; another person's fields are untouched; a null field is not rewritten; a listed document whose field no longer names the uid fails closed; a ghost listing fails closed; zero-budget refusal. `actor-audit-validators.test.ts` 22/22: `null` accepted for each field, and empty, number, object, boolean and missing values rejected. `pnpm vitest run src/features/account-erasure src/features/surveys src/features/skill-trees src/features/role-profiles src/features/challenges`: 102 files, 1648/1648. `pnpm typecheck`: exit 0. `pnpm lint` on the changed feature folders: exit 0.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS, no Blocking or Important. Verified: the eight fields match SPEC A-1, A-2, A-3 and A-7 exactly (A-6, A-10, A-11, A-12 are absent); the step clears only the one field, re-reads inside the transaction, and fails closed on a mismatch or ghost; no replacement value is derived from the uid; challenge ciphertext, iv, authTag, submittedAt and timestamps are untouched; each validator accepts only `null` or a non-empty value, and the skill-tree updater still requires its timestamp; no authorization decision reads these actor fields against a uid. Suggestions: the test title now says eight (it said nine); the runner registration and Firestore adapter are owned by TASK-038 and recorded there. Noted, no change: the demo-team preflight reads `createdBy` on team and roadmap documents, and a null there fails closed (a conflict, not a grant), outside these eight fields. Final: `pnpm vitest run src/features/account-erasure src/features/surveys src/features/skill-trees src/features/role-profiles src/features/challenges`: 102 files, 1648/1648; typecheck exit 0; eslint exit 0. TASK-023 is Done.

## Neutral removed-participant DTO (TASK-020), 2026-10-29: blocked on a decision

**Conflict.** SPEC "Neutral presentation" says that after the participant binding is erased, the owner's DTO participant block is `{ state: "removed" }`. The persisted result of TASK-019 is identical to an ordinary owner removal: all five binding fields are `null`, the index is deleted, and no marker is written. The current owner DTO (`owner-read.ts`, `OwnerParticipantState = "none" | "pending" | "accepted" | "unavailable"`) maps that to `none`. So `removed` cannot be shown for the erased state without a decision.

**Options (smallest form for the decision).**
- (a) A new persisted, non-identifying marker on the owner document (for example `participantRemovedBy: "erasure"`). This adds a key to the canonical 16-key owner shape and changes its strict validators and the TASK-019 write. It is a data-model decision.
- (b) Show `removed` for every `none` state, including ordinary owner removals made by the owner. This changes existing D2 UI behaviour for every owner who removes a participant.
- (c) Keep `none` for the erased state. It is neutral, and it is the same state as the invite flow. This needs a dated SPEC amendment ("Neutral presentation") and no data change.

No marker, `deletedBy`, or erased-user state was added. TASK-020 stays Ready and blocked until the decision is recorded.

## Full-suite checkpoint after TASK-019 (2026-10-29)

**Result.** `pnpm test`: 440 files, 8535 tests, exit 0. `pnpm typecheck`: exit 0. `pnpm lint`: exit 0. This run covers TASK-016 to TASK-019, including the D2 store additions and the D2 scope guards.

## Participant bindings on conversations owned by others (TASK-019), 2026-10-29

**Storage and codec, read from the code (not from TASKS.md).**
- Owner document, `userDevelopment/{ownerUid}/conversations/{conversationId}` (`OWNER_DOCUMENT_KEYS`): plain fields `teamId`, `participantUid`, `participantMemberRef`, `participantState`, `participantInvitedAt`, `participantAcceptedAt`, `plannedFor`, `status`, `completedAt`, `createdAt`, `updatedAt`, and the envelope `ciphertext`, `iv`, `authTag`, `keyVersion`, `keyCheck`.
- The whole content is ONE encrypted JSON object with exactly five keys (`CONTENT_PAYLOAD_KEYS`): `title`, `ownerNotes`, `nextSteps`, `participantNotes`, `sharedGoals`. `participantNotes` is therefore inside the ciphertext, not a plain field. Removing it needs a decrypt, a drop of that one key, and a re-encrypt.
- Participant index, `userDevelopment/{participantUid}/conversationParticipations/{conversationId}`: `ownerUid`, `invitedAt`. It grants access only through the owner document's participant binding.
- There is no separate notes, shared-goals, or participant-notes collection. The store has exactly two subtrees (AD-2), so the owner document and its index are the whole persisted footprint.
- The codec (`content-codec.ts`) is the only D2 encrypt and decrypt seam. `decodeContent` validates strictly (`parseConversationContent`), so a payload that does not validate is never re-encoded. Key failures (`key_unavailable`, `key_mismatch`) throw a `ContentKeyError` on the classification path and are never reported as malformed.

**Why not reuse `change-participant`'s removal as-is.** `removeInTransaction` already does the same kind of cleanup, and BR-18 allows owner removal in completed conversations too. It is not reused directly because it (a) removes whichever participant is current, with no check that it is the erased uid; (b) returns `conversation_not_found` for an unreadable payload, which would hide the resumable `payload_unreadable` outcome; and (c) is an owner-session API, so the erasure path would have to pose as the owner. The new erasure function reuses the same primitives instead: the D2 classifier (`classifyOwnerDocument`), the production codec encoder, and the store's transaction, with the same clearing rule.

**Implementation.** `src/features/account-erasure/server/participant-bindings-erasure.ts`.
- `eraseParticipantBinding`: one store transaction (spans the owner subtree and the participant index, BR-48). Reads the owner document. An undecryptable or malformed owner document, or a malformed payload, returns `payload_unreadable` with no write. A key outage, or any throw from the decrypt or encrypt seam, returns `store_unavailable` with no write. If the owner document binds the erased uid, it clears the five binding fields to null, sets `participantNotes` to the empty note, carries title, owner notes, next steps, shared goals and `status` / `completedAt` over unchanged, updates `updatedAt`, and deletes the erased person's index entry. Otherwise (no participant, stale binding, or owner gone) the owner document is untouched and only the erased person's index entry is removed.
- Discovery (I-8) is a port, `ParticipantBindingDiscovery.listBoundTo`. It is NOT in the D2 store, because the D2 scope guard forbids collection groups there. Production implements it as a collection-group query on `conversations` where `participantUid == uid`, which needs the approved index AE-IDX-1. That adapter is a TASK-038 item.
- `runParticipantBindingsBatch`: one binding per batch. A `payload_unreadable` or `store_unavailable` outcome throws `ErasureStepFailure` so the runner records a resumable failure. A listed id that is not a valid conversation id fails closed as `verification_failed`.

**Completed-conversation exception boundary.** The function is erasure-only and does not check status, so a completed conversation is cleaned. No ordinary D2 API changes. A static test asserts that only files under `src/features/account-erasure/server/` import the module, never a route, UI file, or development-conversations module. No `allowCompleted` or `force` option was added.

**Tests (2026-10-29).** `participant-bindings-erasure.test.ts`: 17 tests. Active cleanup (fields cleared, notes removed, owner content preserved, index removed); completed cleanup (status kept); notes already empty; already-cleaned binding (skipped, owner unchanged); stale binding (skipped, other participant untouched); orphaned index; undecryptable payload (`payload_unreadable`, no write); malformed owner (`payload_unreadable`); key outage (`store_unavailable`, no write); failed re-encryption (no partial write); no erased uid or memberRef left; no access afterwards; the static import-boundary test; the step across two owners with another participant untouched; done when nothing is bound; step raises `payload_unreadable`; invalid id fails closed; zero budget refused.

**Commands (2026-10-29).** `pnpm vitest run src/features/account-erasure src/features/development-conversations`: 72 files, 1836/1836 (including the D2 scope guard). `pnpm typecheck`: exit 0. `pnpm eslint`: exit 0.

**Guard notes.** A first attempt added a collection-group method to the D2 store. Two D2 guards failed (no collection group in D2 production code; the static store test). The method was removed from the store and the discovery moved to the erasure port. A first draft also used `erasedUid` as an object key, which the inventory tripwire flags, so the uid is now a positional argument.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS, no Blocking or Important. The reviewer traced the owner content and the failure paths: the re-encrypt path writes exactly the five payload keys with `participantNotes` emptied; status and completedAt are untouched; payload failures return `payload_unreadable` before any encode; key outages and encode failures return `store_unavailable` before any owner write; the owner update and the index deletion are in one transaction, and a throw aborts all of it; the cleaned binding is only the one whose uid equals the erased uid; the stale branch removes only the erased uid's index entry; no erased uid, memberRef, deletedBy or marker is written; the D2 store has no collection group; there is no `allowCompleted` or `force` option, and no route or UI imports the module. Suggestions, with the response:
- (catch-all) The broad catch in `eraseParticipantBinding` maps programmer errors to `store_unavailable`, which the runner retries. The reviewer judged this no data risk, since nothing commits on a throw. It is kept, because it is what guarantees a key outage is never reported as malformed data. The trade-off is now documented in the code, and TASK-038 must revisit it once the real codec and store are wired.
- (skipped results) A skipped result for a discovered conversation deletes the erased uid's index entry in the same transaction, so it cannot repeat for the same conversation. This is now documented in the code.
- (wiring) The module is not imported anywhere yet, which is the intended state. TASK-038 wires the real content codec and the collection-group discovery.

**Commands after review (2026-10-29).** `pnpm vitest run src/features/account-erasure src/features/development-conversations`: 72 files, 1836/1836. `pnpm typecheck`: exit 0. `pnpm eslint`: exit 0.

## Owned conversations and locators (TASK-018), 2026-10-29

**Design.** The `conversations_owned` step calls the existing `deleteConversation` core for each owned conversation, with no change to the core and no user session needed, so the owner-delete semantics are not duplicated. One transaction per conversation removes the owner document (which holds the encrypted owner notes, next steps, participant notes and shared goals) and the participant's index entry. The core reads plain fields only, so a malformed owned conversation is removed (BR-29). The `locators` step deletes the erased person's own index entries, including orphans whose owner document is gone. Neither step notifies anyone, and neither creates a general completed-conversation mutation: a completed owned conversation is removed by the same owner-delete rule, and the participant-side cleanup for other people's conversations stays in TASK-019.

**Store additions (erasure only, additive).** `listOwnerIdsForErasure(ownerUid, limit)` and `listParticipationIdsForErasure(callerUid, limit)` are keys-only reads (`select()`), so malformed and `createdAt`-less documents are included. The windowed listers were not used because they skip documents without `createdAt`. No user-facing route calls the new methods.

**Fail-closed.** A listed id that is not a valid conversation id is `verification_failed`, so it cannot loop. A failed delete transaction is `store_unavailable` and the conversation stays.

**Tests and commands (2026-10-29).** `conversations-erasure.test.ts` 12/12 (owned conversation with its index entry removed in the step; malformed owned conversation removed; another owner untouched; a completed owned conversation removed; done when empty; invalid id fails closed; a failed transaction keeps the conversation; zero-budget refusal; locators: own entries including an orphan removed; another person's entries untouched; done when empty; invalid id fails closed). `pnpm vitest run src/features/development-conversations src/features/account-erasure`: 71 files, 1818/1818. `pnpm typecheck`: exit 0. `pnpm eslint`: exit 0.

**Guard note.** The D2 scope guard (`development-conversations-scope-guard.test.ts`) flags the literal `conversationParticipations` and the owner-subtree name anywhere in src. The first run failed on a doc comment in the new step file; the comment was reworded to describe the subtree without the literal. The guard allow-list was not widened.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS, no Blocking or Important. The reviewer confirmed: the core `deleteConversation` and the user-facing delete semantics are unchanged; the index is removed in the same transaction; the owner document holds all content (encrypted payload with title, owner notes, next steps, participant notes, shared goals; plus the plain participant fields), and there is no separate notes or shared-goals collection, so deleting the owner document covers them; malformed records are removed; other people's data is untouched; the new methods are keys-only and bounded; no TASK-019 or general mutation code was added. Suggestions, all recorded in TASKS.md: the step handlers are registered by TASK-038 (not in the runner yet); the Admin SDK runtime test is added to TASK-038 acceptance; the `app/api/me/conversations/[conversationId]/route.ts` working-tree change is from TASK-009, and the DELETE success path is unchanged. The scope-guard pin change is a narrower rewrite (exact constant names), documented around the development-conversations guard note.

## Full-suite checkpoint after TASK-018 (2026-10-29)

**Result.** `pnpm test`: 439 files, 8517 tests, exit 0. `pnpm typecheck`: exit 0. `pnpm lint`: exit 0. This run is the fresh verification after TASK-016, TASK-017, and TASK-018.

## Full-suite checkpoint after TASK-017 (2026-10-29)

**Result.** `pnpm test`: 438 files, 8505 tests, exit 0. `pnpm typecheck`: exit 0. `pnpm lint`: exit 0. This run is the fresh verification after TASK-016 and TASK-017. The earlier 435 files and 8465 tests predate them and are not counted as covering them.

**One failure found on the first run and repaired.** The cross-feature guard `src/features/team-skills/server/participation-boundary.test.ts` (C2 TASK-007) allows the literal `skillContribution` only in the domain module and the account-erasure registry. A doc comment in the new `membership-erasure.ts` contained that literal. The step never names the field, since it deletes the whole membership document. The comment is reworded without the literal, and no guard allow-list was widened.

## Erased-thread copy approval (2026-10-29)

**Previous copy (exact, as implemented before this decision; recorded because it implied account-deletion status and the approved direction rules that out).**
- heading: `Tråden er fra en slettet konto`
- description: `Personen som startet tråden har slettet kontoen sin. Svarene fra andre er bevart.`

**Approved copy (`src/features/forum/copy.ts`, `erasedThread`).**
- heading: `Slettet tråd`
- description: `Innholdet i denne tråden er ikke lenger tilgjengelig. Svarene fra andre er bevart.`

The approved copy communicates only that the content is no longer available. It does not state who deleted the thread, why, or that the author performed the deletion, and it does not mention account erasure or moderation. The description's second sentence describes the replies that are still shown. The forum suite passes (347/347) after the change. No test asserts the literal text; the tests use the copy keys.

## Forum erased-content reader (TASK-015), 2026-10-29

**Server.** `getThreadWithReplies` returns `{threadId, status:"erased", createdAt}` for a valid placeholder (`isErasedForumThread`), with the team check and the same reply classification as an active thread (shared `readReplyViews`: fail-closed validation, team cross-check, tombstones kept in position, other people's replies keep their own tag). It never decrypts the placeholder. A placeholder with an extra key fails closed as `read_failed`. A placeholder of another team is `not_found`. A non-member is `forbidden` before the thread is read. `createReply` against a placeholder returns `not_found` and writes nothing (existing `isValidForumThread` path, now tested).

**Client.** The gateway parses the placeholder and rejects a missing `createdAt`. The component shows the erased heading and the others' replies. It shows no body, no author line, and no reply form. The delete action is for app admins only.

**Open (not blocking).** The new Norwegian copy in `copy.ts` (`erasedThread`) must be reviewed against `docs/UI-UX.md` and the product copy rules. The reader DTO now nests `replies` inside the placeholder object, as the SPEC specifies (see the re-review entry below). The earlier beside-the-thread shape is superseded.

**Commands (2026-10-29).** `pnpm vitest run src/features/forum`: 20 files, 337/337. `pnpm typecheck`: exit 0. `pnpm eslint src/features/forum app/api/teams`: exit 0.

**Independent review 1 (fresh read-only reviewer, 2026-10-29).** CHANGES_REQUIRED, no Blocking; three Important findings and suggestions. Repairs:
- (Important, fail closed) The validator `isValidForumThread` now rejects any record that carries `status` or `erasedAt`, even with every active field present. No active write sets either key (checked in create-thread and create-reply). A placeholder with ciphertext now fails as `read_failed` and is never decrypted (test `erased-thread.test.ts`, and `forum-thread.test.ts`).
- (Important, admin delete) `deleteThread` accepts an erased-thread placeholder for app admins only, in the same team. A plain member gets `forbidden`, and another team's placeholder gets `not_found`. The reply cascade then runs as for any thread. Tests in `delete-thread.test.ts` ("an erased-thread placeholder").
- (Important, vacuous assertion) The header check now asserts the exact erased description and date, and that no author label ("Medlem") is rendered. Non-admin negative case added. A positive control shows that an active thread renders the reply form.
- (Suggestion) The erased heading is now "Tråden er fra en slettet konto", because the thread still exists and only its author was erased. The copy is still not reviewed against `docs/UI-UX.md`.
- (Suggestion, recorded) `getThreadWithReplies` now maps the refusal with `authRefusalFor`, so the fence codes (`erasure_in_progress`, `auth_unavailable`) no longer collapse into `unauthenticated`. This matches the TASK-009 caller propagation used by create-reply and the other protected reads.

**Commands after repairs (2026-10-29).** `pnpm vitest run src/features/forum`: 20 files, 344/344. `pnpm typecheck`: exit 0. `pnpm eslint src/features/forum`: exit 0.

**Independent re-review (fresh read-only reviewer, 2026-10-29).** PASS_WITH_SUGGESTIONS. Its checks passed for: the validator rejects `status`/`erasedAt`; the placeholder never decrypts; the admin-only delete; the exact non-vacuous UI assertions; the refusal mapping (`invalid_token` to `unauthenticated`; `erasure_in_progress` and `auth_unavailable` pass through). Its findings, and what was done:
- (Important) Stale test counts in TASKS.md. Corrected to the actual counts: `ThreadDetail.erased.test.tsx` 5/5, `erased-thread.test.ts` 9/9, the refusal test 3/3, and the forum suite 21 files, 347/347.
- (Suggestion, applied) A table test for the refusal mapping. `getThreadWithReplies` now passes `readFence` through (`GetThreadWithRepliesDeps.readFence`), so `erasure_in_progress` and `auth_unavailable` can be driven in a test. See `get-thread-with-replies-refusal.test.ts`.
- (Suggestion, applied) The DTO shape now follows the SPEC, which puts `replies` inside the placeholder object. The result for an erased thread is `{ok:true, thread:{threadId, status:"erased", createdAt, replies}}`. An active thread keeps `{ok:true, thread, replies}`. The route emits the same two shapes, and the gateway reads the nested replies for the placeholder. This is an alignment to the SPEC, not a new decision. The change was made after the re-review, and it is verified by the forum suite (347/347), typecheck, and lint. It was not re-reviewed by an independent agent.
- (Suggestion, open) The erased copy. `copy.ts` `erasedThread` (heading "Tråden er fra en slettet konto", description "Personen som startet tråden har slettet kontoen sin. Svarene fra andre er bevart.") is Norwegian and uses the non-identifying framing that `docs/UI-UX.md` requires. The UI-UX rules do not prescribe this wording, so it is a product decision that **needs product-owner approval**. It is recorded as an open item, not presented as approved.

## Start/resume endpoint (TASK-013), 2026-10-29

**Operation.** `src/features/account-erasure/server/start-erasure.ts` (`startOrResumeErasure`). It verifies the token with `allowDuringErasure: true`, the only caller of that option. Semantics follow the SPEC "Start/resume contract". No record: recent auth (300 s), a matching normalized confirmation, then the production-readiness check, then `createErasureInTransaction`. `in_progress` (including a resumable failed step): resume, with no sign-in or confirmation. `completed`: `{status:"completed"}`, no restart. `auth_deleted` or malformed: `erasure_unavailable`, fail closed.

**Production-not-ready gate (temporary, approved option 1).** `PRODUCTION_HANDLERS_READY = false` in `production-erasure.ts`. While it is false, every path that would create a record or run the runner returns `erasure_unavailable` (HTTP 503) first. Proof that no record is created: `production-erasure.test.ts` and `start-erasure-http.test.ts` assert the store has zero documents, and `start-erasure.test.ts` asserts no handler is called. TASK-038 must flip the flag and remove any reliance on it in the same reviewed change (TASKS.md TASK-038 acceptance).

**HTTP contract.** `app/api/me/erasure/route.ts` is a thin `POST`; the logic is in `start-erasure-http.ts`.
- 200 `{status:"in_progress", step}` or `{status:"completed"}`.
- 400 `invalid_request` for an extra key (uid, email, team), a non-string confirmation, or invalid JSON. The body is `{}` or `{confirmation}`; an empty body is allowed for resume.
- 400 `confirmation_mismatch`; 403 `recent_auth_required`.
- 401 `unauthenticated`; 403 `erasure_in_progress` (not reachable from this endpoint, since it passes the bypass); 503 `auth_unavailable`.
- 503 `erasure_unavailable`: the public code for a resumable operational failure and for the production-not-ready refusal. The persisted `errorCode` and error detail are never returned. The code is added to the closed `ERASURE_API_ERROR_CODES`.

**allowDuringErasure allow-list (TASK-009 S1 made actionable).** `auth-refusal.test.ts` now asserts that only `src/features/account-erasure/server/start-erasure.ts` mentions `allowDuringErasure`, that it passes the literal `true` there, and that no `app/api/` file mentions it. Ordinary protected routes cannot opt out of the fence.

**Terminal state.** A completed record returns `completed` at the operation level only. The fence still refuses a terminal record as `invalid_token` before the operation runs, so the HTTP route may not reach that result. This is intentional, and the fence is not weakened.

**Tests.** `start-erasure.test.ts` 14/14 (production-not-ready, new start, recent-auth, confirmation, resume with an in-progress fence and no second record, resumable failure and retry, operational failure with no leaked detail, malformed fail-closed, auth_deleted, completed/no-restart, not-ready resume, invalid token). `start-erasure-http.test.ts` (body contract, HTTP mapping, empty body resume, extra-key rejection before verification). `production-erasure.test.ts` (readiness flag false, empty handler map, endpoint refuses with no record).

**Full repository checks (2026-10-29).** `pnpm test`: second run 432 files, 8440 tests, exit 0. The first run had one failure, `TeamDetail.test.tsx` (a `findByRole` wait for a `fetchSkillNeeds` call). It passed alone (109/109) and in the second full run, so it is recorded as timing flakiness in a jsdom component test, not caused by this task. `pnpm typecheck`: exit 0. `pnpm eslint` on the changed erasure, auth, and route files: exit 0.

**Independent review (fresh read-only reviewer, 2026-10-29).** Result: PASS_WITH_SUGGESTIONS, with no Blocking finding. The reviewer traced every branch for readiness: no record is created and no runner step runs while `PRODUCTION_HANDLERS_READY` is false, on the no-record, in_progress, completed, auth_deleted, and malformed paths. Its three Important findings are repaired: (1) the TASKS.md outcome and the SPEC contract item 3 now say that over HTTP the fence refuses a terminal record first (401), and that `completed` is the operation-level result only; (2) the completed and auth_deleted operation tests use the real no-record fence, and a new HTTP test runs a terminal record through the real fence and asserts 401 `unauthenticated`; (3) this review record now exists. Suggestion applied: a Content-Length bound of 1 KB, rejected with 400 `invalid_request` before the body is read (`isBodyTooLarge`, tested). Residual risk, recorded and accepted for now: the allow-list guard matches the identifier name only, so a bypass passed through a spread or a variable would not be caught. Chunked bodies without a Content-Length are still read whole, since the endpoint body is one short string and the framework limits apply. After these repairs, `pnpm vitest run src/features/account-erasure src/features/auth`: 22 files, 341/341; `pnpm typecheck`: exit 0; `pnpm eslint` on the changed files: exit 0. The full `pnpm test` was last run before these repairs (432 files, 8440 tests, exit 0 on the second run) and is re-run at the next checkpoint.

## Recent authentication (TASK-010), 2026-10-29

**Implementation.** `src/features/auth/server/recent-auth.ts` (`isRecentAuth(authTimeSeconds, nowSeconds, windowSeconds)`, pure). The window is an argument because auth must not import account-erasure; erasure passes `RECENT_AUTH_WINDOW_SECONDS` (300). `VerifiedIdentity.verifiedAuthTime` is optional and is set only when the decoded token has a numeric `auth_time` (conditional spread, so the key is absent otherwise).

**Rules.** `now - auth_time <= window` is accepted (boundary included). A missing or non-finite `auth_time` is not recent. An `auth_time` later than `now` is not recent.

**Tests.** `recent-auth.test.ts` 8/8; `verify-identity-auth-time.test.ts` 2/2; existing `verify-identity.test.ts` unchanged (`git diff --stat` empty).

**Independent review (2026-10-29, fresh read-only reviewer).** PASS_WITH_SUGGESTIONS. No Blocking or Important finding in the code. Suggestion (applied): the record for this section was missing, so the TASKS.md pointer was unbacked; this section is that record. Suggestion (open, optional): a test that imports `RECENT_AUTH_WINDOW_SECONDS` would catch drift between the constant and the helper's use.

**Commands run (2026-10-29).** `pnpm vitest run src/features/auth src/features/account-erasure`: 17 files, 294/294. `pnpm test`: 429 files, 8405 tests, exit 0. `pnpm typecheck`: exit 0. `pnpm eslint src/features/auth/server`: exit 0.

## Milestone review (after TASK-001, TASK-002, TASK-003, TASK-005), 2026-10-28

**Scope.** Accumulated account-erasure evidence and the code under `src/features/account-erasure/domain/`. Cross-checked SPEC.md, TASKS.md and this file for consistency, and checked the TASK-002 inventory and TASK-003 Auth assumptions against the TASK-005 vocabulary.

**Result: PASS for the closed tasks. One open decision is recorded for TASK-009.** No Blocking finding. No closed task was reopened.

### Findings

- **Important (open decision, owner TASK-009). Client-facing semantics of an Auth or fence-read failure.** The fence must fail closed (SPEC "Writes" and resume rule 4; TASKS TASK-009 step 5). The SPEC gives no client-facing code for an infrastructure failure. The current seam (`src/features/auth/server/verify-identity.ts:49-50`) maps every verification error to `invalid_token`, which is fail-closed. Two options change what clients observe, and both need an explicit decision:
  - (a) keep `invalid_token` for every failure, so an Auth or Firestore outage looks like a sign-out (401);
  - (b) add a distinct failure (for example `auth_unavailable` or a fence-read failure) that 62 route handlers must map to a 5xx. Route mappings today fall through to 401 or 500 (see "Route authentication", error-mapping input).
  Both options keep access fail-closed. Choosing between them changes the external API. It is not an invented detail to settle here. **TASK-009 must stop for this decision before it starts.** The record-level code `auth_unavailable` (TASK-005 enum, TASK-003 B-6) is a persisted status, not an API response.
- **Consistent (no action):** the TASK-005 record-error enum includes `auth_unavailable`, matching TASKS TASK-037 (transient Auth failure stores `auth_unavailable`) and TASK-003 B-6. The step enum matches the SPEC step table in order. The TASK-002 owners cover W-1..W-18 with TASK-025..036, which matches the TASKS task list.
- **Suggestion (fixed):** TASK-001 limitations heading still said "open for full TASK-001 Done" after TASK-001 was closed. Reworded as a residual, non-blocking suggestion.
- **Suggestion (open):** SPEC "Authentication and token lifecycle" row "46 source files reference `verifyIdToken`" is a stale planning count (route register: 62 routes). Update the SPEC wording when the SPEC is next revised. TASKS does not depend on the number.

### Cross-document checks

- TASKS.md statuses: 4 Done, 41 Ready, 0 In Progress. The header matches. TASK-004 remains Ready and is explained in the header.
  - Update 2026-10-29 (dated history, superseded): TASK-004 automated part is Done; the D-EMU manual gate is still NOT RUN. See "Transaction harness (TASK-004)" below.
- TASK-004 remains a manual-gate dependency. Its automated part waits for TASK-007/009. Its race evidence waits for D-EMU.
- VERIFICATION.md: sections for TASK-001, TASK-002, TASK-003, TASK-004 (D-EMU, not run) and this milestone are consistent with the TASKS statuses. (TASK-004 D-EMU status: superseded by the owner-provided PASS)

## Inventory registry and coverage guard (TASK-006), 2026-10-28

**Registry.** `src/features/account-erasure/server/inventory.ts` holds every SPEC row exactly once: I-1..I-15, A-1..A-12, P-1..P-6, E-1..E-4 (37 rows). The test `inventory.test.ts` checks the id set against the SPEC list.

**A-5 correction (recorded as required by TASK-006).** `roadmapItems.ownerRef` holds a membership `memberRef`, not a uid. It is registered as `memberRef` kind. `uidEqualityQueries` never produces a query for it. The same applies to I-7 `participantMemberRef` and I-9 `memberRef`. The test "generates no uid equality query for a memberRef field" fails if the correction is reverted.

**SPEC wording note.** The SPEC describes each A-row as one field. Several A-rows list more than one field (for example A-2 `createdBy`, `updatedBy`). The registry keeps the SPEC row ids and lists each field under its row. No row was dropped.

**Guard (`inventory-guard.ts`, `inventory-allow-list.ts`).** The guard scans every non-test `.ts`/`.tsx` file under `src/features` and `app`, excluding the three account-erasure registry files. It fails on:
- a uid-bearing field name (`uid`, `*Uid`, `*By`, `*Ref`, `*Email`, and similar) that is neither registered nor allow-listed;
- a collection path segment that is neither registered nor allow-listed;
- an allow-list entry that no longer occurs in source (stale).
The repository test also asserts a non-vacuous scan (over 100 source files, at least 15 collection segments, at least 10 uid-bearing names), so an empty scan cannot pass.

**Field positions scanned.** Quoted literals, object keys and type members (`name:` after `{`, `,`, or the start of a line), and member access are matched. Local bindings and parameter-list annotations are not. Scanning every identifier was tried first and rejected: it reported local variables such as `membershipRef`, which are not stored names.

**Allow-list (reviewed; each entry has a reason in `inventory-allow-list.ts`).** `presenterUid` (demo operator input), `callerUid`, `viewerUid`, `subjectUid`, `candidateUid` (function parameters), `hasMemberRef` (dependency key), `clientEmail` (demo service-account credential field, not a person's e-mail), `regionRef`, `feedbackRef`, `invalidEmail`, `invitationEmail` (UI names), `normalizedEmail` (parameter name; see the document-id risk below), `membershipRef` (Firestore reference variable).

**Known limitations (recorded; not hidden).**
- **Object shorthand is not matched.** `{ authorUid }` with no colon is not detected. A pattern that matches shorthand also matches every comma-separated identifier list (arguments, arrays, imports), so it was reverted. Mitigation for the write-fence tasks (TASK-025..036): persisted writes must use explicit keys, and the review checks each new write for shorthand.
- **Name-based.** A registered name is treated as covered wherever it appears. The guard does not prove that a name is persisted; review still decides that.

**Risk recorded for the invitation tasks (TASK-017, TASK-030).** Invitation documents are keyed `teamInvitations/{teamId}__{normalizedEmail}` (`teams/domain/team-invitation.ts:35-36`). The person's e-mail is therefore part of the document id, not only the `email` field that I-11 queries. Deleting by an `email` field query removes the document, but a document whose `email` field is missing or malformed would keep the e-mail in its id. The invitation erasure must also match the document id, or treat a missing `email` field as a failure, not as "no match".

**Verification run.** `pnpm vitest run src/features/account-erasure` 28/28 pass (3 files). `pnpm typecheck` exit 0. `pnpm exec eslint src/features/account-erasure` exit 0.

## Firestore rules and index configuration (TASK-008), 2026-10-28

**Repository configuration only. Nothing here is deployed, and no claim is made that the rules or indexes are live.**

- `firestore.rules`: `match /accountErasures/{document=**} { allow read, write: if false; }` is placed before the `match /{document=**}` catch-all, in the existing deny-block style.
- `firestore.indexes.json`: AE-IDX-1 is declared as a `fieldOverrides` entry (`conversations` / `participantUid` / `queryScope: COLLECTION_GROUP`). A single-field collection-group index is configured as a field override, not as a composite `indexes` entry. The SPEC's wording "collection-group index" is read this way.
- AE-IDX-2 is verified by test: no `fieldOverrides` entry exempts `uid`, `authorUid`, `participantUid`, `createdBy`, `updatedBy`, `archivedBy`, `resolvedBy`, `deletedBy`, `grantedBy`, `roleUpdatedBy`, `invitedBy`, `resolvedUid`, or `email`. An exemption is an override with an empty `indexes` list.
- Tests: `src/lib/firebase/firestore-deployment-config.test.ts`, the block "account-erasure Firestore configuration (TASK-008)". 26/26 pass in the file.

**Operator actions (not in this repository, carried to TASK-045).**
- Deploy the AE-IDX-1 index before the first erasure (SPEC Operational requirement 3).
- Configure the Firestore TTL policy on `accountErasures.expireAt` at project level (SPEC BR-6). It cannot be represented in `firestore.indexes.json`.
- Validate `firestore.indexes.json` against the Firebase CLI for the real project. Not done here; no Firebase access.

## Open decisions found during implementation (stop conditions, not resolved here)

**D-AUTHFAIL — APPROVED, option (b) (2026-10-28).** Missing, invalid, revoked, disabled, or otherwise genuinely rejected authentication keeps the existing unauthenticated/invalid-token path (401 as appropriate). A temporary inability to establish authentication or fence state (required Auth verification or fence read unavailable) fails closed with the server-side result `auth_unavailable`, mapped to HTTP 503. It is never reported as `invalid_token`, never permits protected data access, and is not an erasure-fence bypass. The narrow resume/status bypass remains the only exception. Recorded in SPEC "Start/resume contract" (D-AUTHFAIL paragraph). Implementation: TASK-009, with guards that protected handlers map `auth_unavailable` to 503 rather than falling through to 401/500.

**D-VERIFY-BACK — APPROVED, option (a) (2026-10-28).** The erasure state machine stays forward-only; no backward transition is added. `verify_data` runs a bounded verification sweep. Residual matches cause the appropriate idempotent cleanup to be re-run while the persisted step remains `verify_data`, with retry/resume state persisted. The step advances to `auth_delete` only when the sweep finds zero matches covered by the inventory. Recorded in SPEC "Steps" (`verify_data` row) and "Transitions". Implementation: TASK-012, with tests for no backward transition, residual retention at verification, retry removal, zero-residual progress, and idempotent repeats.

## Forum erasure step (TASK-014), 2026-10-28

- Handler: `src/features/account-erasure/server/forum-erasure.ts`, with the port, fake and 22 tests (the TASK-014 repair tests included, plus the review-round tests). Reports `done` only when all three verification queries are empty (I-13 threads, I-14 own replies, A-8 tombstones).
- Predicate: `src/features/forum/domain/forum-erased-thread.ts`, `isErasedForumThread`, exact shape `{ teamId, createdAt, erasedAt, status: "erased" }`. `isValidForumThread` is unchanged and still rejects a placeholder.
- **Implementation consequence (not a semantic change).** Replies are capped at 500 (`REPLY_CAPACITY_LIMIT`), and a Firestore transaction allows at most 500 writes. A thread with the cap of replies plus the thread document needs 501 writes, so "one transaction per thread" cannot delete it. The step removes the thread's replies in chunks of at most `maxWrites`, and then removes the thread in a transaction that reads the replies again. The observable invariant is the same. A retry re-runs the decision from current data.
- **Fail-closed.** A malformed reply in a thread, a malformed thread authored by the erased person, or a malformed reply authored by the erased person fails as `payload_unreadable`, and nothing is changed.
- **Not yet built.** The Admin SDK adapter for `ForumErasurePort` belongs to the wiring task (TASK-038). It is not tested here.

## Baseline scope-guard amendments (2026-10-28, approved)

Account-erasure introduced the inventory registry, which names persisted collections and fields. Nine existing guard assertions failed on the real tree. Each amendment below is file-exact. No directory, glob, substring or concept exemption was added, and each guard keeps a sibling negative test.

| Guard test | Original invariant | Amendment (exact file) |
| --- | --- | --- |
| development-conversations: D2 collection identifier | Only D2 files name `conversations` | `account-erasure/server/inventory.ts`, `inventory.test.ts`, `src/lib/firebase/firestore-deployment-config.test.ts` (AE-IDX-1), `roadmap/roadmap-scope-guard.test.ts` (AE-IDX-1 pin) |
| personal-goals: D1 collection identifier | Only D1 files name `userDevelopment` | `inventory.ts`, `inventory.test.ts` |
| personal-goals: no collectionGroup | No D1 collectionGroup | `inventory.ts` and `inventory.test.ts` only (`APPROVED_ERASURE_COLLECTION_GROUP_REFERENCES`) |
| skill-profiles: C1 allow-list and reverse independence | Only C1 files name `skillProfiles` | `inventory.ts`, `inventory.test.ts` (the `APPROVED_ERASURE_METADATA_COLLECTION_REFERENCES` list is defined in `src/features/skill-profiles/skill-profiles-scope-guard.test.ts:57`) |
| team-skills: owner sets for `teamSkillNeeds` and `skillContribution` | Named only by owners and listed tests | `inventory.ts` only (`ERASURE_PERSISTENCE_METADATA_FILES`) |
| team-skills: participation boundary (literal field) | Literal in the domain module only | `inventory.ts` only |
| team-skills: no production D1/D2 concepts (semantic rule) | No `roleDefinitions`, `developmentGoals`, `progressEntries`, `checkIns` in production code | `inventory.ts` only (`D1_D2_CONCEPT_EXEMPT_FILES`) |
| roadmap: Firestore index pin | `fieldOverrides: []` | The exact AE-IDX-1 entry (`conversations` / `participantUid` / `COLLECTION_GROUP`) and nothing else |

**Decision record (semantic rule, approved 2026-10-28).** The team-skills "no production code introduces D1/D2 concepts" rule is a semantic rule, not only a list. The exemption above is approved as erasure-only persistence metadata. It is file-exact, creates no team-skills → account-erasure dependency (`team-skills-cross-cutting.test.ts` asserts no team-skills or team route imports the registry), and leaves the rule in force for every other production file (sibling negatives in the same test). The inventory is kept in `server/` and is not moved to evade the guard.

**Pre-existing, unrelated.** `src/features/teams/components/TeamDetail.test.tsx` ("loading needs for this team") failed in the baseline full run and in an isolated run. The same failure reproduced on a clean `HEAD` worktree without any account-erasure files. It passed in a later full run and in two later isolated runs. It is not explained, and it is not caused by this feature.

**Verification.** Full suite (`pnpm test`): 421 files, 8256 tests passed. `pnpm typecheck` exit 0.

## TASK-006 round-3 review repairs (2026-10-28)

Independent review (read-only) returned CHANGES_REQUIRED with no Blocking findings and three Important ones. Repairs:
- **Collection positions.** The guard now also matches `collectionGroup(...)`, template-literal collection paths, and `.doc("collection/id")` path literals. Only the collection segments of a document path (even indices) are checked. Tests added in `inventory.test.ts`.
- **Member access.** The documented `doc.authorUid` position is now matched, and method calls (`.lookupUid(`) are skipped. The real tree surfaced two dependency-injection members (`deps.getUserByEmail`, `deps.generateRef`). They are functions, not stored fields, and are recorded with reasons in `inventory-allow-list.ts`.
- **Governance.** The team-skills semantic exemption is recorded in the decision record above.
- **Limitation, unchanged.** The allow-list is name-global (review finding 4). Shorthand is still not matched (documented gap).

## Round-4 review repairs and open decision (2026-10-28)

**TASK-006 (inventory guard).** Independent re-review of round 3 found the following. Each is repaired in code with a synthetic negative test:
- Modular `collection(db, "x")` and `doc(db, "a/b")` forms, and single-quoted literals, are now matched.
- Identifier-suffixed owner names (`ownerId`, `authorId`, `personId`, `employeeId`) are now registered as uid-bearing.
- The two injected dependency names (`getUserByEmail`, `generateRef`) are now allowed only as member reads (`ALLOWED_MEMBER_ACCESS_NAMES`). A persisted key or quoted field with the same name is still flagged. A member-only allow-list entry is also checked for staleness.

**Remaining limitations (recorded, not fixed):**
- A collection or document path held in a variable (`collection(db, NAME)`) is not a literal and is not checked.
- Object shorthand (`{ authorUid }`) is not matched.
- Type members on one line after `;` (`type T = { a: string; ownerUid: string }`) are not matched. Multi-line members are matched.
- The scan roots are `src/features`, `src/lib`, `src/components` and `app`. Root-level `.ts`/`.mjs` files and `scripts/` are not scanned.
- The guard is name-based. A registered name is covered wherever it appears.

**TASK-014 (forum step).** Round-4 review found two Important items:
- **Fixed: write budget.** One batch wrote up to `maxWrites` conversions and then up to `maxWrites` A-8 markers, so one batch could write up to twice the BR-14 budget. The two loops now share one budget, and a test asserts at most `maxWrites` writes per batch.
- **Open decision: other people's tombstones on thread delete.** When no other person has an active reply, the delete branch removes every reply in the thread, including tombstones authored by other members. SPEC "Decision rule", step 2, says "the thread and its own tombstone replies are physically deleted", and "no other person's content is removed". SPEC does not define "own" for a tombstone, because a tombstone carries no `authorUid`. The options are: (a) keep the current behaviour (delete all tombstones in the thread, which matches "no other person's content" because a tombstone holds no content); (b) delete only tombstones with `deletedBy` = the erased uid and keep other tombstones, which leaves them pointing at a deleted thread. The choice changes approved behaviour, so the human decides. Recorded here; code unchanged. Blocks TASK-014 closure until decided.

## Round-5 review repairs and open decision, TASK-006 (2026-10-28)

Round-4 re-review (read-only) returned CHANGES_REQUIRED with four Important items:
- **Fixed:** optional members (`ownerId?:`) and one-line type members after `;` are now matched as keys. Synthetic tests added.
- **Fixed:** backtick document paths, and a call expression as the first argument (`collection(getDb(), "x")`, `doc(getDb(), "a/b")`) are now checked. Synthetic tests added.
- **Open decision (Important):** the member-only exemption cannot hold. `getUserByEmail` and `generateRef` are declared as optional dependency members (`create-invitation.ts`, `materialize-member-refs.ts`), so they are keys as well as member reads. The guard therefore cannot exempt them as member reads only. The two names are back on the name-global allow-list, which is the round-3 state. A persisted field with either name would pass unnoticed. Options: (a) rename the injected dependencies to non-uid-bearing names, a change inside the teams feature and its tests; (b) accept the name-global exemption with this record. Decision needed before TASK-006 closes.
- **Remaining recorded limitations:** object shorthand, variable paths, the scan roots, and a `(`-free first argument of unbounded length (the lazy match can span a call chain; false positives would show in the real-tree scan).

Verification: `pnpm vitest run src/features/account-erasure src/features/teams src/features/forum src/lib/firebase` 74 files, 1424 tests pass. `pnpm typecheck` exit 0.

## Supporting rename: injected teams dependencies (TASK-006 round-5 decision, option (a), approved)

Two injected dependency members in the owning teams feature were renamed to neutral names, so they no longer look like persisted identity fields. This removes the last name-global exemption from the inventory guard.
- `create-invitation.ts`: dependency `getUserByEmail` → `findAccount`; type `GetUserByEmail` → `FindAccount`; `defaultGetUserByEmail` → `defaultFindAccount`. The Firebase Admin call `getAdminAuth().getUserByEmail(email)` is an external API and is unchanged.
- `materialize-member-refs.ts`: dependency `generateRef` → `createKey`.
- Tests: `create-invitation.test.ts` and `materialize-member-refs.test.ts` renamed the same way. No behaviour, persistence schema or API change.
- `inventory-allow-list.ts`: both names removed from the global allow-list. `ALLOWED_MEMBER_ACCESS_NAMES` is now empty.
- Negative coverage: `inventory.test.ts` "rejects persisted fields named as the former injected dependencies, under the real allow-lists". A persisted `getUserByEmail` or `generateRef` key is rejected by the real allow-lists.
- Verification: `pnpm vitest run src/features/account-erasure src/features/teams src/features/forum src/lib/firebase` 74 files, 1425 tests pass. `pnpm typecheck` exit 0.

## TASK-014 tombstone decision: resolved (2026-10-28)

The open decision in "Round-4 review repairs and open decision" is resolved. Option (a) was approved, and it is recorded in SPEC under the forum decision rule, step 2 ("Decision (approved 2026-10-28): tombstone ownership after identity removal"). A thread with no other member's active content is deleted whole, including tombstones. A thread with another member's active content keeps the placeholder. The existing code already implements this, so no behaviour changed. TASK-014 still needs an independent re-review before it closes.

## TASK-006 round-6 repairs (2026-10-28)

Fresh read-only review of the rename returned CHANGES_REQUIRED with three Important items. All three are repaired, each with a synthetic negative test:
- **Quoted or backtick field names** (`where('ownerUid', …)`, `` `ownerUid` ``) are now matched as keys.
- **Call paths behind a quoted first argument** (`collection(getDb("prod"), "x")`, `doc(getDb("prod"), "a/b")`) and **single-quoted `_COLLECTION` constants** are now matched. Collection and document paths use a balanced-argument scan that reads the last argument, not a regex.
- Key matches on comment lines (backtick code spans in doc comments) are skipped. The real tree surfaced about twenty such comment-only hits, and no real persisted field was among them.

**Remaining limitations (recorded):** object shorthand (`{ ownerUid }`), variable paths (`collection(db, NAME)`), scan roots (`src/features`, `src/lib`, `src/components`, `app`), and comment-only prose is not scanned for keys by design.

## TASK-006 round-7 repairs (2026-10-28)

Round-6 re-review (read-only) returned CHANGES_REQUIRED with three Important items. Repaired, each with a synthetic negative test:
- **Trailing comma** (`collection(db, "x",)`, Prettier's multi-line output): empty trailing arguments are dropped before the literal is read.
- **Modified members** (`readonly ownerUid: string`): key matching allows `readonly`, `public`, `private`, `protected`, `static`, `declare`.
- **Comments**: comments are now blanked before scanning (`blankComments`), replacing the comment-line skip. A block comment before code no longer hides a key. An apostrophe inside a comment no longer opens a string.

**Structural note (open).** Each review round has found further syntax edge cases in this text scanner. The scanner is a tripwire over text, not a parser. An AST-based check using the repository's existing `typescript` devDependency would close this class of gap. That change is a design decision, so it is recorded for the user rather than made here.

## TASK-006 AST scanner (approved option (a), 2026-10-28)

**Implementation.** `inventory-guard.ts` now reads syntax with the TypeScript compiler API (`typescript`, an existing devDependency; no new dependency). It no longer uses text patterns. Each file is parsed and walked structurally:
- **Keys and names:** object keys, shorthand properties, property signatures and declarations, and every string literal (quoted, single, or static backtick) are checked as candidate field names. Modifiers, optional markers, trailing commas, comments and layout do not change the result.
- **Member reads:** `x.name` is checked. Method calls such as `auth.lookupUid(id)` are not stored fields and are skipped.
- **Collection paths:** `collection`, `collectionGroup` and `doc` calls resolve their path from the modular form (`collection(db, path)`, path at index 1) or the method form (`db.collection(path)`, index 0). A static path is split on `/`, and only even-indexed segments are collection names. A same-file `const NAME = "static"` is resolved. `*_COLLECTION` constants are checked where they are defined.
- **Fail closed:** a `collection` or `collectionGroup` path that is not statically resolvable is a violation (`unresolvable-collection`). Ambiguous same-file constants are dropped and therefore fail closed.

**Tests.** The synthetic negative cases from previous rounds are retained and pass: single and double quotes, static backticks, apostrophes and code-like text in comments, block comments before code, trailing commas, optional, readonly and one-line members, `collection(db, …)`, `collection(getDb(), …)`, `collectionGroup`, identifier-suffixed owner names, and doc path locators. Dependency renames (`findAccount`, `createKey`) remain outside the allow-list, so persisted `getUserByEmail` or `generateRef` fields are rejected. Stale `membershipRef` and `invitationEmail` entries were removed because they now occur only as local identifiers.

**Remaining static-analysis limitations (recorded).**
- A dynamic element access `x[expr]` is not resolved. A computed key `{ [expr]: v }` is not resolved. Persisted writes must use explicit keys, and review checks each new write.
- `doc()` with a non-literal path is not resolved, because modular `doc(ref, id)` takes dynamic identifiers.
- A name is covered wherever it appears. The guard does not prove that a name is persisted.
- The scan roots are unchanged (`src/features`, `src/lib`, `src/components`, `app`).

**Open decision (blocks TASK-006 closure).** One real-tree finding remains: `src/features/development-conversations/server/conversation-store.ts` has a generic path builder whose collection names are dynamic (`const [parent, parentId, subcollection, id] = segments; db.collection(parent)…collection(subcollection)`). The callers pass names from outside the function, so the scanner cannot resolve them. Fail closed is the correct result. Two options: (i) a file-exact exemption for this one helper, recorded as an approved exception with a negative test that the same pattern elsewhere still fails; or (ii) refactor the helper so every call site passes a literal or same-file constant. The guard test is currently red for this reason. The choice is the user's.

## Conversation-store refactor for the AST guard (approved option (ii), 2026-10-28)

**Decision.** The dynamic path helper in `conversation-store.ts` is refactored so its collection names are statically resolvable. No file-exact exemption was added for `conversation-store.ts`.

**Change.** The generic `documentRef(db, segments)` and `subtree(db, uid, subcollection)` helpers are replaced by four explicit builders: `ownerDocumentRef`, `participationDocumentRef`, `ownerConversationsCollection`, `participationIndexCollection`. Each writes the collection names as named constants (`USER_DEVELOPMENT_COLLECTION`, `OWNER_CONVERSATIONS_SUBCOLLECTION`, `PARTICIPATION_INDEX_SUBCOLLECTION`). The document builders still call the types module's validators (`ownerDocumentPath`, `participationDocumentPath`), so the same inputs are rejected and the same references are produced. Firestore paths, the persisted schema, the transactions, the DTOs and the error semantics are unchanged.

**Guard change found by the refactor (a blind spot, now closed).** The collection-constant rule only covered `_COLLECTION` names. `OWNER_CONVERSATIONS_SUBCOLLECTION` and `PARTICIPATION_INDEX_SUBCOLLECTION` are `_SUBCOLLECTION` constants, so their values were not checked at their definitions. The rule now covers `_(SUB)?COLLECTION` names, both at the definition (checked against the registry) and at a reference (accepted, because the definition is checked). New negative tests: an unregistered `*_SUBCOLLECTION` value is flagged, and a dynamic subcollection helper is flagged as `unresolvable-collection`.

**Pins updated (narrow).** The D2 scope-guard collection-argument pin for `conversation-store.ts` now lists the two named constants instead of the removed `parent` and `subcollection` helper parameters. The static list-query test now searches for the new helper names. The D2 persistence-identifier comments no longer contain literal storage paths.

**Verification.** Full suite (`pnpm test`): 421 files, 8280 tests pass. `pnpm typecheck` exit 0. ESLint is clean on the touched files.

**Exemptions.** No new exemption was added. `conversation-store.ts` is not on any allow-list.

## TASK-006 review (AST boundary) repairs and one open decision (2026-10-28)

Review of the AST boundary returned CHANGES_REQUIRED with two Important items. Status:
- **Fixed: single-segment modular `doc(db, "coll", id)`.** The collection name is now checked. A method `.doc(id)` still takes a document ID, so only its multi-segment path counts. Synthetic test added.
- **Fixed: destructured reads** (`const { ownerUid } = data`) are now detected as keys.
- **Narrowed: dynamic keys.** A computed key or element access with a non-static name now fails closed when it sits inside the arguments of a Firestore write or query call (`set`, `update`, `create`, `add`, `where`, `orderBy`, and similar). Applied to every element access, the rule flagged about 100 array and label-map lookups across the repository, which cannot be exempted without broad exceptions. The narrowed rule does not cover a dynamic key built into a variable first.
- **Fixed: `*_FIELD` constants.** A cross-file field-name constant (`SKILL_CONTRIBUTION_FIELD`) is checked where it is declared and accepted at its reference, the same way collection constants are handled.

**Open decision (blocks TASK-006 closure).** `src/features/skill-profiles/server/skill-profile-store.ts`: `tx.set(profileRef, { levels: { [treeId]: level }, ...stamps }, { merge: true })`. `treeId` is a runtime parameter, so the guard cannot tell whether the key is a uid-bearing name. The levels map is keyed by a skill-tree id, not a person identifier. Failing closed is the correct result. Options: (i) an exact-file exception for this one write, with a negative test that any other dynamic key in a write still fails; (ii) a data-model change. The choice is the user's.

## C1 persistence-model exception: approved SkillTree dynamic key (TASK-006, option (i), 2026-10-28)

**Status.** Approved option (i). The C1 `levels` data model is not changed. The exception is the narrowest structural form the AST guard supports, and it is recorded here as an approved C1 persistence-model exception.

**The one approved shape** (`APPROVED_DYNAMIC_KEYS` in `inventory-allow-list.ts`, matched by `isApprovedDynamicKey` in `inventory-guard.ts`). All of these must hold:
- the file is `src/features/skill-profiles/server/skill-profile-store.ts` (exact path);
- the computed key is the identifier `treeId`, which is a SkillTree id and not a person identifier;
- the key is the only property of an object literal that is the value of a `levels` property;
- that outer object literal is an argument of a call to `set` (`tx.set(profileRef, { levels: { [treeId]: level }, …stamps }, { merge: true })`).

No line number is used. The exception is not a file exemption, not a global dynamic-key allowance, and not a `levels`-wide allowance.

**What it does not cover (synthetic negative tests, `inventory.test.ts`):**
- another computed key inside a Firestore write in the same file still fails;
- the same approved shape in another file still fails;
- another dynamic property beside `levels[treeId]` still fails, both inside the `levels` object and as a sibling of it;
- `ownerUid` and `uid` computed keys inside the `levels` shape still fail;
- the same shape with `update` instead of `set` still fails;
- the exception list holds exactly one entry.

**Real-tree evidence.** The real skill-profile write is covered by the positive real-tree guard test. The guard test is green.

**Limitation kept for this task.** A dynamic key built into an intermediate variable before the write is not resolved. Its review is handled in the fresh independent review of TASK-006.

## TASK-006 review round 8 repairs and one open decision (2026-10-28)

Review of the AST boundary (CHANGES_REQUIRED, three Important items) and repairs:
- **Fixed: dotted field-path literals.** Each segment of a string literal split on `.` or `/` is checked, so `"levels.ownerUid"` is caught. Test added.
- **Fixed: dynamic query and update field names.** A non-static first argument of `where`, `orderBy`, `startAt`, `endAt`, `startAfter`, `endBefore` fails closed. A non-static field at position 1 of the variadic `update` / `updateDoc` form (three or more arguments) fails closed. Test added.
- **Fixed: modular write names.** `setDoc`, `updateDoc`, `addDoc`, `deleteDoc` are in the write set, along with the query bounds above.
- **Fixed: approved shape receiver.** The approved `levels` shape now also requires the receiver to be `tx`, so `map.set(id, { levels: { [treeId]: v } })` is not accepted. Test added.
- **Static: `FieldPath.documentId()`.** Firestore's fixed document-ID ordering field is a static field path, not a dynamic name.

**Recorded limitations (updated).** The method-form variadic `update` with a dynamic field at position 0 (`docRef.update(field, value)`) is not resolved. A dynamic key or field built into a variable first is not resolved. Method signatures and parameter names are not scanned; the scanned declarations are property signatures and property declarations.

**Open decision (blocks TASK-006 closure).** `src/features/skill-profiles/server/skill-profile-store.ts`, `removeLevel`: `tx.update(profileRef, new FieldPath("levels", treeId), FieldValue.delete(), "updatedAt", stamps.updatedAt)`. This is the same `levels.<treeId>` C1 field as the approved `set` shape, but it is a different write shape (variadic `update` with a `FieldPath`). The approval covers only the `set` merge shape, so this write is flagged. Options: (i) approve a second exact shape for `removeLevel` (receiver `tx`, `update`, a `FieldPath("levels", treeId)` field position), with negative tests; (ii) keep it flagged and change the delete path. The choice is the user's.

## C1 persistence-model exception: approved removeLevel FieldPath delete (TASK-006, option (i), approved 2026-10-28)

The user approved a second, exact shape for the existing `removeLevel` operation. It is the delete-side equivalent of the approved `set` shape. The production write is unchanged.

**Approved shape** (`APPROVED_DYNAMIC_FIELD_PATHS` in `inventory-allow-list.ts`, matched by `inventory-guard.ts`):
- file `src/features/skill-profiles/server/skill-profile-store.ts`;
- call `tx.update(ref, new FieldPath("levels", treeId), FieldValue.delete(), …)`, the variadic transaction update, at argument position 1 with `FieldValue.delete()` at position 2;
- the FieldPath has exactly two arguments: the static string `"levels"` and the identifier `treeId`;
- the call sits directly inside the method `removeLevel`, and that method declares the parameter `treeId`. A closure inside the method is not approved.

This approves only "the existing `removeLevel` operation may delete `levels.<treeId>`". It does not approve dynamic FieldPath values under `levels` in general.

**Negative coverage** (`inventory.test.ts`, "approved removeLevel FieldPath delete"): each of these fails closed.
1. `new FieldPath("levels", ownerUid)`;
2. `new FieldPath("levels", uid)`;
3. `new FieldPath("otherMap", treeId)`;
4. the same shape in an unrelated file;
5. the same shape through `map.update`;
6. a non-delete value (`level`, `FieldValue.serverTimestamp()`) in place of `FieldValue.delete()`;
7. a dynamic first segment, an extra segment, or the same shape in another method (`setLevel`);
8. a `treeId` that is not a parameter of `removeLevel`, or the shape inside a closure within it;
9. the modular `updateDoc` form, and a dynamic `new FieldPath` in a query `where`.

The existing negative coverage for the approved `set` shape is preserved and still passes. The existing round-8 repairs (dotted segments, dynamic query/update fields fail closed, modular write calls, `tx` receiver binding, `FieldPath.documentId()`) are unchanged.

**Verification run (2026-10-28, this repository):**
- `pnpm vitest run src/features/account-erasure/server/inventory.test.ts`: 54/54 (includes the real-tree guard test).
- `pnpm vitest run src/features/skill-profiles src/features/account-erasure`: 24 files, 555/555.
- `pnpm test` (full suite): 421 files, 8299/8299.
- `pnpm typecheck`: exit 0.
- `pnpm eslint` on the touched inventory files: exit 0.

**Limitations kept (unchanged).** A dynamic key or FieldPath built into a variable before the write is not resolved. A method-form variadic `update` with a dynamic field at position 0 is not resolved. These are recorded in the round-8 section and are the subject of the fresh independent review.

## TASK-006 review round 10 repairs (2026-10-28)

The fresh independent review of the removeLevel exception returned CHANGES_REQUIRED (one Blocking, two Important, one Suggestion). Each was checked against the code. The repairs are limited to the demonstrated gaps:

- **Blocking, fixed: extra field/value pairs in a variadic update.** The guard checked only argument index 1. It now checks every field position of `update(ref, f1, v1, f2, v2, …)` (indices 1, 3, 5, …). The approved FieldPath delete is accepted only at index 1, and a spread in a field position must list only static names at its even elements. A spread of a dynamic name fails closed. The approved shape therefore cannot carry a second `levels.<uid>` delete. Tests cover an extra `new FieldPath("levels", uid)` pair, a dynamic field after a valid pair, and dynamic spreads.
- **Important, fixed: block-scoped shadow of `treeId`.** The approved shape required the segment to be named `treeId`, but not to be the method parameter. The method body must now neither declare nor assign `treeId` (`const`, block binding, nested parameter, reassignment, `++`/`--`). Tests cover an inner `const treeId`, a reassignment, and a closure parameter.
- **Important, fixed: same-file names treated as static.** A constant is static only when its one declaration in the scan is a `const` string literal and nothing assigns it. A parameter that shadows a module constant, a `*_FIELD` name with a dynamic initializer, and a reassigned `let` now fail closed. Tests cover each.
- **Consequence, handled: imported `*_FIELD` constants.** `SKILL_CONTRIBUTION_FIELD` is imported by `skill-contribution-store.ts`. The guard resolves a `*_FIELD` name across the scanned source when it has exactly one declaration (an import is not a declaration) and no assignment. The scan therefore still resolves the real import, and a second declaration of the same name fails closed. A test covers both cases. No production file changed for this. An attempted workaround (a literal key in `skill-contribution-store.ts`) was reverted because the team-skills scope guard pins that name to the domain module.
- **Suggestion, recorded as a limitation (not widened).** Read paths with a dynamic field (`snap.get(field)`, `ref.select(field)`) are not checked. Adding `get` would flag every `Map.get`, so the guard stays on the write and query calls. Each read-field use must be reviewed.

**Recorded limitations (unchanged or new):**
- A dynamic key or FieldPath built into a variable before the write is not resolved.
- A method-form variadic update with a dynamic field at position 0 is not resolved.
- An imported `*_FIELD` constant whose definition lies outside the scanned roots is not resolved (fails closed). The approved scan roots are `src/features`, `src/lib`, `src/components`, and `app`.
- Dynamic read fields (`get`, `select`) are not checked (see above).

**Verification (2026-10-28, after round-10 repairs):**
- `pnpm vitest run src/features/account-erasure/server/inventory.test.ts`: 59/59 (real-tree test included).
- `pnpm vitest run src/features/team-skills`: all pass, including the team-skills scope guards.
- `pnpm test` (full suite): 421 files, 8304/8304.
- `pnpm typecheck`: exit 0.
- `pnpm eslint` on the touched inventory files: exit 0.

## TASK-006 review round 11 repairs (2026-10-28)

The re-review of round 10 returned CHANGES_REQUIRED (one Blocking, one Important). Both were verified against the code and repaired:

- **Blocking, fixed: spread arguments in a variadic update.** A two-argument `update(ref, ...pairs)` returned early and a spread in a value position shifted parity unseen. A spread is now accepted only as the final argument, in a field position (odd index, >= 3), with a static array-literal form. Any other spread fails closed, and every field position after a spread is also reported. Tests cover `update(ref, ...pairs)`, `update(ref, "updatedAt", ...pairs)`, and a spread followed by a dynamic name.
- **Important, fixed: the approved set shape was not bound to `setLevel`.** A `treeId` rebound inside any method in `skill-profile-store.ts` was accepted. The set shape now requires `enclosingMethod: "setLevel"`, `treeId` as its parameter, and no rebinding, matching the delete shape. Tests cover a rebinding, a reassignment, another method name, and a shadowing parameter.

**Verification (2026-10-28, after round-11 repairs):**
- `pnpm vitest run src/features/account-erasure/server/inventory.test.ts`: 60/60 (real-tree test included).
- `pnpm test` (full suite): 421 files, 8305/8305.
- `pnpm typecheck`: exit 0.
- `pnpm eslint src/features/account-erasure/server`: exit 0.

## TASK-006 review round 12 — CHANGES_REQUIRED, remediation limit reached (2026-10-28)

The fresh review after round 11 returned CHANGES_REQUIRED (one Blocking, one Important). The implement-feature workflow allows two review-remediation cycles per task, and both are used (rounds 10 and 11). TASK-006 stays **Reopened**. A third repair cycle needs a decision from the user (see TASKS.md).

**Open Blocking: persistence-call detection is bypassed by non-identifier callees.** `callHeadName` returns `undefined` for an element-access callee (`tx["set"]`) and a parenthesized callee (`(tx.set)`). Reported probes (not yet re-run by the implementer):
- `tx["set"](ref, { [ownerUid]: true })` → 0 violations;
- `(tx.set)(ref, { [ownerUid]: true })` → 0 violations;
- `tx["update"](ref, new FieldPath("levels", ownerUid), FieldValue.delete())` → 0 violations;
- `q["where"](ownerUid, "==", 1)` → 0 violations;
- `db["collection"]("personalMailbox")` and `(db.collection)("personalMailbox")` → 0 violations.

**Open Important: exceptions are keyed by method name, not by the one method.** `enclosingMethodOf` accepts any named `MethodDeclaration`. A same-named method in the approved file (for example a class method `removeLevel(treeId, tx, ref)`, or a second object literal) matches the approved delete. Impact is limited to the same `levels.<treeId>` delete, but the exception is wider than the approved "the existing removeLevel operation".

**Accepted limitations (unchanged):** a dynamic key or FieldPath built into a variable first; a method-form variadic update with a dynamic field at position 0; dynamic read fields (`get`, `select`); an imported `*_FIELD` defined outside the scanned roots.

**What is verified (rounds 10–12):** spread as the two-argument update; spread at field position 1 with the approved delete; spread literal carrying an identity name; value-position spread; block-scoped `const treeId` in removeLevel; `for (const treeId …)` rebinding and reassignment in setLevel; static spread pairs in the approved set shape. `inventory.test.ts` 60/60 (real-tree test included); full suite 421 files / 8305 tests; typecheck and lint exit 0.

**Observation for the decision.** Each review round since round 9 has found a new syntactic escape in the AST scanner. The remaining classes are the same family (call shapes and same-named methods). A closed-world rule would close the family rather than the next instance: fail closed on any callee that is not a plain identifier or a `.name` access and receives a dynamic argument; compare the enclosing method by the object-literal or class identity that holds the approved write, not by name alone.

## TASK-006 final bounded cycle — closed-world callees and exact approved context (round 12 repair, 2026-10-28)

Approved by the user as the single, explicit final cycle after the round-12 review (CHANGES_REQUIRED: one Blocking, one Important). No product policy changed. Production code is unchanged.

**Finding 1 (Blocking), closed-world persistence-call recognition.**
- The callee is normalized before it is classified: parentheses and non-null assertions are removed, and a static string element access names its method (`tx["set"]` is `tx.set`; `(tx.set)` is `tx.set`). The same analysis then applies to both forms.
- A callee that cannot be named statically (`getRef()(…)`, `handlers[kind](…)`) is not silently ignored. Within the persistence boundary it fails closed (`unresolvable-call`) when its arguments carry a computed key, a dynamic element access, or a FieldPath, or when it is a dynamic element access receiving a static string path (`db[name]("…")`).
- Scope: an unnameable callee with none of these is outside the boundary and is not reported (for example `import("…")`, `super("…")`, or a function value called on a list). A first attempt that also flagged any identity-bearing argument was too broad (it flagged these) and was narrowed.

**Finding 2 (Important), exact approved context.** Both approved shapes (`setLevel` set, `removeLevel` delete) now bind to `SKILL_PROFILE_TRANSACTION_CONTEXT`: the method must be a member of the object literal passed to `work(...)`, inside method `runTransaction`, whose object literal is returned by top-level function `getDefaultSkillProfileStore`. The name `removeLevel` or `setLevel` alone is not enough. Classes, other objects, and a second object inside the same factory do not match. No line numbers are used.

**Reproduced reviewer probes (regression tests in `inventory.test.ts`):**
- `tx["set"](ref, { [ownerUid]: true })`, `(tx.set)(ref, { [ownerUid]: true })`, `tx["update"](profileRef, new FieldPath("levels", ownerUid), FieldValue.delete())`, `q["where"](ownerUid, "==", 1)`: each rejected.
- `db["collection"]("personalMailbox")` and `(db.collection)("personalMailbox")`: unregistered collection rejected.
- `handlers[kind](ref, { [k]: v })`: unresolvable call rejected.
- `tx.set` with an identity computed key and `tx.update(ref, "updatedAt", v, dyn, w)`: still checked.
- `import("…")`, `super("…")`, `(deps.getNames ?? fallback)(offered.map((row) => row.uid))`: not reported.
- A same-named `removeLevel` or `setLevel` in an object, a class, or a second object in the factory: rejected.
- The approved set and delete shapes in their exact context: accepted; the real-tree test passes.

**Remaining static-analysis limitations (recorded; not findings):**
- A dynamic key or FieldPath built into a variable first is not resolved.
- A method-form variadic update with a dynamic field at position 0 is not resolved.
- An unnameable callee with no computed key, dynamic element access, FieldPath, or static string path (see scope above) is not reported.
- Dynamic read fields (`get`, `select`) are not checked.
- An imported `*_FIELD` whose definition lies outside the scanned roots is not resolved (fails closed).
- Static analysis of the `removeLevel`/`setLevel` context is by structure and name, not by type. A renamed factory or transaction method changes the approved context and must be reviewed.

**Verification (2026-10-28, after the final cycle):**
- `pnpm vitest run src/features/account-erasure/server/inventory.test.ts`: all pass (real-tree guard included).
- `pnpm vitest run src/features/skill-profiles src/features/team-skills src/features/development-conversations`: 99 files, 2624 tests.
- `pnpm test` (full suite): 421 files, 8310 tests.
- `pnpm typecheck`: exit 0.
- `pnpm eslint src/features/account-erasure/server`: exit 0.

## TASK-006 final-cycle review: STOP (2026-10-28)

The single final review of the closed-world cycle returned CHANGES_REQUIRED with three Blocking and one Important finding (and one Suggestion). Per the approved stop condition, TASK-006 stops here and no further scanner patch cycle is started. The findings are recorded as they were reported; they were reproduced by the reviewer's direct probes of `checkInventoryCoverage` and are not downgraded:

- **Blocking, rebinding through destructuring or for-of.** `rebindsName` checks declarations and `=`/`++`/`--` on identifiers only. `[treeId] = [uid]`, `({ treeId } = { treeId: uid })`, and `for (treeId of …)` / `for (treeId in …)` rebind the name without a declaration, so the approved set (`levels[treeId]`) and delete (`new FieldPath("levels", treeId)`) shapes still match with an identity-valued key.
- **Blocking, collection paths through callee aliasing or wrappers.** `db.collection.call(db, "…")`, an aliased import (`collection as col`), a destructured method (`const { update: u } = tx; u(…)`), and `tx.update.call(…)` leave the callee unnameable. The closed-world rule only reports computed keys, dynamic element access, or FieldPath arguments, so an unregistered collection or a dynamic field name is not reported.
- **Blocking, `*_COLLECTION` names passed as values.** `collectionPathSegments` returns early for a `*_COLLECTION` reference and defers to the constant's definition. A parameter or `let` with that name is never checked, so `collection(db, PERSONAL_COLLECTION)` with a caller-supplied value is not reported.
- **Important, dynamic element-access fallback limited to literals.** `db[k](P)` where `P` is a same-file static constant, or a template with a substitution, is not reported because only a string literal first argument triggers the rule.
- **Suggestion.** The approved receiver is matched by name (`tx`). A method-local `const tx = otherRef` would match. Binding the receiver to the `work` callback parameter would close it.

**Invariant that cannot be enforced reliably by this analyzer:** every person-keyed Firestore read, write or query is classified by the inventory, and no approved exception applies except to its exact structure. The analyzer works on call and declaration syntax. TypeScript offers many equivalent ways to reach the same Firestore operation (aliases, destructuring, `.call`/`.apply`, rebinding by loop or destructuring, constants passed as values), and each review round has found more. A complete, syntax-level closed world over the Firestore API cannot be established by a finite set of rules.

**Recommended architectural alternative (not adopted; a decision for the user).** A constrained, typed persistence wrapper: every person-owned Firestore access goes through a module that accepts only registered collection and field descriptors (typed constants, no string paths, no dynamic field names). The guard then enforces where the Firestore SDK may be imported (a lint or static import ban outside that module) and checks the wrapper's descriptors against the registry. The approved C1 `levels.<treeId>` operations would be expressed as typed descriptors inside the wrapper, so no syntax exception is needed. This moves the enforcement point from the shape of calls to the import boundary and the descriptor types, which can be enforced.

**Status.** TASK-006 remains Reopened (blocked). The inventory registry (I/A/P/E rows), the registry guard test, and the approved C1 exceptions are in the repository and green, but the guard is not a complete enforcement of the invariant above. TASK-012 depends on TASK-006 and is not started. TASK-009 was started under the approved scheduling decision (its dependencies TASK-001, TASK-003 and TASK-007 are Done).

## TASK-009 — centralized erasure fence in `verifyIdToken` (2026-10-28, IN PROGRESS: core done, caller propagation open)

**Implemented (core):**
- `src/features/auth/server/erasure-fence.ts` (owned by auth; auth does not import account-erasure). It reads `accountErasures/{uid}` directly and interprets it: `in_progress`, `auth_deleted`/`completed` (terminal), `malformed` for any other record, and `none` when absent.
- `src/features/auth/server/verify-identity.ts`: after the existing `checkRevoked` verification and the email check, the fence runs before any caller's role logic. `in_progress` → `erasure_in_progress` unless the narrow option `allowDuringErasure: true` is passed; `auth_deleted`/`completed` → `invalid_token`; `malformed` or a failed read → `auth_unavailable`. The identity shape for a uid with no record is unchanged.
- Genuine rejection stays `invalid_token`. Only Firebase Admin infrastructure codes map to `auth_unavailable`. The codes were checked against the installed firebase-admin 14.3.0 source (`internal-error`, `network-error`, `network-timeout`, `service-unavailable`, with the `auth/` or `app/` prefix). Any other error, including a plain `Error`, stays `invalid_token`, which keeps the existing test passing.

**Test infrastructure change (recorded deviation).** Every caller test injects only `verifyToken`, so the production Firestore fence read would fail 76 test files. `vitest.config.ts` now has `setupFiles: ["./test/erasure-fence-default.ts"]`. That file mocks `readErasureFenceFromFirestore` to return "no record" for all tests. Product code is not changed. `erasure-fence.test.ts` unmocks the real reader and covers the production path (no record, in-progress with and without `allowDuringErasure`, terminal, malformed, and a failed read). `verify-identity-fence.test.ts` covers the injected branches. The existing `verify-identity.test.ts` passes unchanged.

**Not done (blocks closure).**
- **Caller propagation and HTTP mapping.** 39 non-test files reference `verifyIdToken` (45 call sites). Each collapses `!verified.ok` into its own generic error (`unauthenticated`, `sign_in_required`, `null`). The route status mappers have their own unions. As a result, `erasure_in_progress` and `auth_unavailable` reach the response as 401-style errors, not the 403-style and 503 responses the spec requires (D-AUTHFAIL; TASK-009 Implementation notes). No protected data is reached in any case, because every caller refuses on `!ok`. This is a spec-conformance gap, not a data-exposure gap.
- **Guard tests** that protected handlers map `auth_unavailable` to 503 and do not fall through to 401/500, and that public survey routes keep their unauthenticated behaviour.
- **Static test** that `allowDuringErasure` is accepted only from the erasure endpoint (TASK-013 does not exist yet).
- **Independent review** has not run, because the propagation is incomplete.
- **Docs:** `docs/ARCHITECTURE.md` cross-reference is TASK-042.

**Verification so far (2026-10-28):**
- `pnpm vitest run src/features/auth`: 8 files, 90 tests.
- `pnpm test` (full suite): 423 files, 8325 tests.
- `pnpm typecheck`: exit 0.
- `pnpm eslint src/features/auth test vitest.config.ts`: exit 0.

## TASK-006 architecture decision and scope stop (2026-10-28)

The user approved the direction in place of the AST scanner: a constrained typed persistence boundary plus a simple import/use boundary (SPEC "Decision log: TASK-006 persistence boundary"). The earlier "TASK-006 final-cycle review: STOP" section remains historical evidence and is not rewritten.

Before any production change, the minimum coherent boundary was measured:
- 75 non-test production files call `.collection(` or `collectionGroup(` (about 229 call sites).
- 25 of those files import the Firestore SDK directly; 50 use `getFirestoreDb()` from `src/lib/firebase/admin.ts`.
- An import-only boundary does not close the invariant: any holder of the handle can make an unregistered call.
- A closed boundary means routing person-linked call sites through typed descriptors across the repository. The approved instruction stops in that case ("materially broader than a bounded persistence boundary").

No production code was changed for TASK-006. The replacement architecture is proposed for a decision, not implemented. The inventory registry and its existing guard remain as they were.

## TASK-009 caller propagation (2026-10-28)

**Shared refusal mapping (narrow, approved).** `src/features/auth/server/auth-refusal.ts` (pure, no verifier import, so route and service tests that mock `verify-identity` do not hide it) defines:
- `AuthRefusal = "unauthenticated" | "erasure_in_progress" | "auth_unavailable"`;
- `authRefusalFor(failure)`: `invalid_token` becomes `unauthenticated`; the two fence codes keep their own names;
- `isAuthRefusal(error)` and `authRefusalStatus(refusal)`: 401 genuine rejection, 403 `erasure_in_progress`, 503 `auth_unavailable`.

**Services (38 files that call `verifyIdToken`, plus the feature unions that reach them).** Every `if (!verified.ok)` guard now returns `authRefusalFor(verified)` instead of a literal `unauthenticated`. Result unions were widened to `AuthRefusal`. The five sign-in files (`challenges/submit`, `forum/create-reply`, `create-thread`, `delete-reply`, `delete-thread`) keep `sign_in_required` for a genuine rejection and propagate the two fence codes. TypeScript enforces the widening: an unhandled code fails `pnpm typecheck`.

**Routes.** Every `if (error === "unauthenticated") return 401` and every `error === "unauthenticated" ? 401` status mapping now calls `authRefusalStatus`. The `me/*` helpers (`verifiedSubject`, `authenticate`) return `{ ok, uid } | { ok, error: AuthRefusal }` instead of `string | null`, so a refusal keeps its code. `app/api/roles` answers through the same helpers. Record status maps that listed only `unauthenticated` gain `erasure_in_progress: 403` and `auth_unavailable: 503`.

**Survey paths (deliberate, recorded).**
- `submit-survey-response`: for an **authenticated** survey, a token refused by the fence now yields `erasure_in_progress` or `auth_unavailable` (the route maps them to 403 and 503). A genuine rejection still yields `unauthenticated`. A **public** survey keeps the anonymous path: a token is ignored, and anonymous responses carry no identity. Public behavior is unchanged.
- `resolve-survey-for-participation`: returns `sign_in_required` for any failed verification. It returns no protected data and is a public lookup. Recorded as a deliberate exception and covered by the static guard allow-list.

**Test default and per-test state (TASK-009 approved conditions).**
- `erasure-fence.test.ts` now clears the fake record store and resets the read-failure flag after each test.
- `auth-refusal.test.ts` (new) covers the mapping, the protected route answers (in-progress 403, unavailable 503, genuine 401, each with no catalog read), and static guards: no inline 401 collapse in `app/api` and `src` (the public survey route is excluded); no literal refusal after `!verified.ok` outside the reviewed public lookup; the survey route maps both codes; `allowDuringErasure` is read only by the verifier; the auth boundary imports nothing from `account-erasure`; production code never references `erasure-fence-default`.

**Allow-list entries (narrow, file-exact).** `team-skills-scope-guard.test.ts` gains `src/features/auth/server/auth-refusal` as one cross-feature import and as one route-level import for the C2 route set. Nothing else in the guard changed.

**Test edits (behavior-preserving).** `development-conversations-cross-cutting.test.ts` asserts the new `{ ok, uid }` shape of `verifiedSubject` instead of a bare `null`. The genuine-rejection case still asserts the refusal. No existing auth assertion was weakened, and `verify-identity.test.ts` is unchanged.

**Verification (2026-10-28, after propagation).**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm test`: 424 files, 8338 tests, all passing.

**Open for the independent review.** Whether the global test default (`test/erasure-fence-default.ts`) can mask a fence regression on a protected route; route coverage is limited to `roles` plus the static guards; the `resolve-survey-for-participation` exception; and whether the widened unions leave any caller that still maps an unknown code to 500.

### TASK-009 independent review (2026-10-28): CHANGES_REQUIRED, remediated

A fresh read-only review of the caller propagation returned CHANGES_REQUIRED. Remediation:

- **Blocking, fixed.** Three protected POST status tables (`app/api/teams/[teamId]/challenges/route.ts`, `forum/threads/route.ts`, `forum/threads/[threadId]/replies/route.ts`) lacked the fence keys and fell through to `?? 400`. Each now maps `erasure_in_progress: 403` and `auth_unavailable: 503`.
- **Important, fixed.** `app/api/me/route.ts` answered every refusal with a literal 401. It now uses `authRefusalStatus`.
- **Important, fixed (test masking).** The static guards exempted any file that merely contained a fence string, and the inline-401 check missed table forms. They now (a) flag any literal 401 beside a refusal in `app/api` (except the conversation error table, which maps only a genuine rejection), and (b) require every status table that maps `sign_in_required` or `unauthenticated` to also map both fence codes. Both rules pass on the current tree.
- **Suggestion, fixed.** The conversation error-code contract comment now states that the fence codes come only from the shared refusal mapping.

**Open decisions for the user (not decided here; TASK-009 stays In Progress until resolved):**

1. **Survey resolve on an authenticated survey** (`src/features/surveys/server/resolve-survey-for-participation.ts`): every verifier failure, including an erasure or outage, returns `sign_in_required`. No protected data is returned, but the response does not show 403 or 503. Options: (a) map the refusal to its status, changing the public lookup response shape; (b) keep it as a documented public-lookup exception. The static guard currently exempts the whole file.
2. **Public survey submission from a fenced token** (`src/features/surveys/server/submit-survey-response.ts`): a token whose uid is `in_progress` or `auth_unavailable` is ignored and the submission proceeds anonymously (200). No identity is stored, so no erased identity is recreated. SPEC line 673 says the fence "blocks new survey submissions for the uid", which this contradicts for public surveys. Options: (a) keep anonymous acceptance and amend SPEC 673 to say so; (b) refuse fenced tokens on public surveys too, which changes public behavior the approval protected.

**Noted, not changed.** `src/features/team-skills/team-skills-scope-guard.test.ts` has an `ERASURE_PERSISTENCE_METADATA_FILES` entry that predates this session's TASK-009 work. This session added only the `auth-refusal` entries.

**Verification after remediation:** `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test` 424 files, 8339 tests, all passing.

## TASK-009 survey-path decisions implemented (2026-10-28)

**Decision 1 (authenticated survey resolve, approved).** `resolveSurveyForParticipation` returns `sign_in_required` only for a genuine rejection (`invalid_token`). `erasure_in_progress` returns `{ok:false, error:"erasure_in_progress"}` and `auth_unavailable` returns `{ok:false, error:"auth_unavailable"}`. `app/api/surveys/[surveyId]/route.ts` maps them to 403 and 503 with `{status: <code>}`. Behavioral coverage: `resolve-survey-for-participation.test.ts` ("refuses an authenticated survey with erasure_in_progress…", "reports auth_unavailable, never sign_in_required…"). Both assert that no membership or team read occurs.

**Decision 2 (public anonymous submission, approved).** The SPEC was amended ("Survey consequences" and "Decision log: TASK-009 survey paths"). Regression coverage in `submit-survey-response.test.ts`: a fenced token on a public survey gives the same result, the same write count, the same response shape, and no participation as the request without a token. A failing fence read on a public survey also yields anonymous success with no participation. For authenticated submission, `erasure_in_progress` and `auth_unavailable` are refused with no writes.

**Seam.** `readFence` is now an optional dependency on the resolve and submit deps, forwarded to `verifyIdToken`. Production behavior is unchanged when it is not supplied.

**Verification (2026-10-28):** focused survey and auth tests 175/175 across 11 files; `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test` 424 files, 8345 tests, all passing.

**Still open for TASK-009:** the service-level representative propagation test (one protected service, `erasure_in_progress` to refusal with no protected data access) and the fresh independent TASK-009 review. TASK-009 stays In Progress.

## TASK-009 representative service test and fresh independent review (2026-10-28): PASS_WITH_SUGGESTIONS, closed

**Representative service-level propagation test.** `src/features/team-skills/server/list-skill-needs-erasure-fence.test.ts` (5 cases) unmocks the real production fence reader (`readErasureFenceFromFirestore`) and backs it with a fake `accountErasures` store, so the real verifier path runs under `listSkillNeeds`. Cases: no record (control, reads succeed); `in_progress` gives `erasure_in_progress` with no membership, team, catalog, or store read; a failing fence read and a malformed record give `auth_unavailable` with no data read; a terminal record gives `unauthenticated` with no data read. The in-progress refusal would not occur under the global default mock, so it proves the real fence ran.

**Fresh independent review.** A new `review-task-for-feature` run (read-only, new agent) returned PASS_WITH_SUGGESTIONS: zero Blocking, zero Important. Items D-AUTHFAIL, 403, 503, refusal-before-data, `allowDuringErasure` scope, authenticated resolve mapping, public anonymous submission with a fenced token, authenticated submission fencing, the Vitest default, and the representative test were each checked and passed. Caveat stated by the reviewer: the review boundary was reconstructed from the untracked fence files and the propagation diffs, because the working tree is uncommitted.

**Optional suggestions (not blocking; recorded for follow-up).**
- S1: `auth-refusal.test.ts` "allowDuringErasure is passed by no production caller" bans all callers outside `verify-identity.ts`. When TASK-013 lands, replace it with an exact file allow-list for the erasure start/resume route only.
- S2: protected route status mapping for skill-needs, skill-coverage, skill-contribution, roadmap-items, and survey routes is covered only by string-presence guards. Only `app/api/roles` has a behavioural 401/403/503 route test. Optionally add one route-level 503/403 test per protected surface.
- S3: the global default (`test/erasure-fence-default.ts`) means a new service test that does not inject `readFence` silently sees "no record". The representative test is the template for each protected service.

**Status:** TASK-009 Done (2026-10-28). The review verdict gates closure; the suggestions do not.

## TASK-006 narrowed invariant (2026-10-29)

Scope: the approved narrowed invariant in SPEC "Decision log: TASK-006 narrowed invariant". TASK-006 is an inventory-completeness and change-control gate for the current known erasure-relevant persistence surfaces. It does not prove that future TypeScript cannot introduce an unregistered Firestore surface. The historical sections "TASK-006 final-cycle review: STOP" and "TASK-006 architecture decision and scope stop" are unchanged.

### Both-direction reconciliation (current production tree)

**Direction 1 (each registered row against production).** Checked by targeted search of non-test production code:
- I-1 `skillProfiles` (doc id = uid), I-2 `userProfiles` (doc id = uid): document-ID locator confirmed.
- I-9 `teamMemberships`, I-10 `teamAccessRequests`, I-12 `surveyParticipations`: document IDs `uid__<teamId | surveyId>` (`membershipDocId`, `accessRequestDocId`, `participationDocId`). Prefix locator confirmed.
- I-11 `teamInvitations`: document ID `${teamId}__${normalizedEmail}` (`invitationDocId`, team-invitation.ts:36). The e-mail is in the document ID as well as the `email` field, and `resolvedUid` is written by `markAccepted` (create-invitation.ts:87). Both recorded as registered; `normalizedEmail` is registered as `docIdSuffix` only, not as a new field.
- I-3..I-6 `userDevelopment/{uid}/...` subtree: confirmed in `goal-store.ts`, `role-target-store.ts`, and `conversation-store-types.ts` (owner `userDevelopment/{ownerUid}/conversations`, participant index `userDevelopment/{participantUid}/conversationParticipations`). I-6 `ownerUid` is registered on the participant index.
- I-7 `conversations` collection group: `participantUid` and `participantMemberRef` confirmed in `stored-owner-conversation.ts`. Both are registered; `participantMemberRef` is kind `memberRef`.
- A-5 `roadmapItems.ownerRef`: a string holding the membership ref, registered as `memberRef` (no uid query). Confirmed in `roadmap-item.ts` and `create-roadmap-item.ts`.
- C1 `skillProfiles` `levels.<treeId>`: domain-keyed map (`skill-profile-store.ts`, merge-set and FieldPath delete of `levels.<treeId>`). Registered as I-1 `levels` (plain). The approved dynamic-key exceptions are the tripwire's exceptions, not a schema change.
- P-1 `surveyResponses`: no identity field in `submit-survey-response.ts` or the stored shape. Registered as P-1 with no fields.
- P-4 `teamSkillNeeds`: `skill-need.ts` has no uid or e-mail field; the document ID is `teamId__treeId`, team-scoped. No person linkage.
- A-1..A-12 actor fields (`createdBy`, `updatedBy`, `archivedBy`, `resolvedBy`, `deletedBy`, `grantedBy`, `roleUpdatedBy`, `invitedBy`): each occurrence in production is on a registered collection (challenges, roleDefinitions, roadmapItems, forumReplies, teamMemberships, teamInvitations, teamAccessRequests, teams, skillTrees, skillProgress, surveys).
- Collection names used in production that the registry does not list: none found by targeted search. `tree-copies` appears only in test code. `teamSurveyState` (P-3) has no uid, e-mail, or actor field in `team-survey-state.ts`.

**Direction 2 (each known person-linked surface against the registry).** The guard `checkInventoryCoverage` (non-vacuous: more than 100 source files, at least 15 collection segments, at least 10 uid-bearing names) reports no unregistered literal name or collection. The team-scoped document IDs `teamId__treeId` (`roadmapItems`, `skillProgress`, `teamSkillNeeds`) carry no person identifier and need no row.

**Known registry note (not a missing surface).** The SPEC P-3 through P-6 rows name several collections (for example P-4 names `skillTrees`, `roleDefinitions`, `roadmapItems`, `skillProgress`, `teamSkillNeeds`), but the registry gives each P-row its primary collection. Each of the other collections is registered under its own A-row (`skillTrees` A-2, `roleDefinitions` A-3, `roadmapItems` A-4, `skillProgress` A-6, `surveys` A-1, `teams` A-12). No collection is unregistered. Registry rows are not changed for this reason.

### RETAIN / DEMOTE / REMOVE classification

| Control | Class | What it enforces (and does not) |
| --- | --- | --- |
| `inventory.ts` registry and the row-set test (every SPEC id exactly once) | RETAIN | Mechanical: the row set matches the SPEC list. Does not prove the rows describe production behaviour; the reconciliation above does. |
| A-5, I-7 `participantMemberRef`, I-9 `memberRef` generate no uid equality query (test "never emits a uid or email field query for a memberRef field") | RETAIN | Mechanical: sweep descriptors for memberRef kinds never use a uid query. |
| Sweep shape tests per locator (I-1/I-2 doc id, I-9/I-10/I-12 prefix, I-3..I-6 subtree, I-8 discovery, I-11 ID tail) | RETAIN | Mechanical: descriptor shapes equal the registry. |
| `registeredFields()` throws when one field name has two kinds | RETAIN | Mechanical consistency of the registry itself. |
| Allow-list stale-entry check (an entry no longer present in source fails) | RETAIN | Mechanical: the allow-list cannot silently go stale. |
| Non-vacuous scan assertions (more than 100 files, 15 segments, 10 uid names) | RETAIN | Sanity: the tripwire is not an empty pass. |
| `inventory-guard.ts` AST tripwire: uid-bearing names and collection literals in common syntactic forms | DEMOTE | Change-detection tripwire only. Not a completeness proof: it misses aliases, destructuring, `.call`, rebinding, constants passed as values, and dynamic keys built into variables. Header and test names say so. |
| Approved C1 exceptions (`APPROVED_DYNAMIC_KEYS`, `APPROVED_DYNAMIC_FIELD_PATHS`, `SKILL_PROFILE_TRANSACTION_CONTEXT`) | DEMOTE | Tripwire exceptions bound to one exact structure. They document the approved `levels.<treeId>` shape; they are not a schema proof. |
| Scope-guard file-exact allow-lists in other features | DEMOTE | Feature-level tripwires for their own scope. Not inventory proofs. |
| "Closed-world" callee, receiver-binding and rebinding rules inside the scanner | DEMOTE (kept, not removed) | They remain part of the tripwire. Removing them would turn the real-tree C1 shapes into failures and would not change what is proven. Not claimed as coverage. |
| Claim that the scanner proves whole-program coverage | REMOVE | Removed from the code header and SPEC wording; superseded by the narrowed decision. No code path enforces it. |

No scanner code was deleted in this pass: the demoted rules still catch the literal forms they were written for. A later task can delete them if the change-control rule proves sufficient.

### Verification (2026-10-29)

- `pnpm vitest run src/features/account-erasure`: 6 files, 145/145 pass (focused, after the wording edits).
- `pnpm typecheck`: exit 0.
- `pnpm exec eslint src/features/account-erasure src/features/auth/server/erasure-fence.ts`: exit 0.
- `pnpm test` (full suite): 425 files, 8350/8350 tests pass.

### Independent review

- **Review 1 (fresh, read-only, narrowed question):** CHANGES_REQUIRED, no Blocking. Important: (1) TASKS.md still described TASK-006 as simply BLOCKED with no scope decision; (2) the "Baseline scope-guard amendments" row named the wrong file for `APPROVED_ERASURE_METADATA_COLLECTION_REFERENCES`. Suggestion: cross-reference the demoted scanner from the superseded persistence-boundary entry. Direction-1 and direction-2 checks found no current surface without a row; the classification matched the code.
- **Repairs:** TASKS.md header and TASK-006 status updated; the VERIFICATION row now names `src/features/skill-profiles/skill-profiles-scope-guard.test.ts:57`; SPEC cross-reference added and the superseded persistence-boundary status annotated.
- **Review 2 (fresh, focused re-review of the repairs):** PASS on all four items. Its one gap (the stale "BLOCKED" wording in the superseded SPEC entry) was annotated as historical and superseded. `pnpm vitest run src/features/account-erasure`: 6 files, 145/145.
- **Result: TASK-006 Done (2026-10-29)** under the narrowed invariant. Full suite, typecheck and lint were run after the wording edits and before the doc-only repairs (see Verification above); the doc-only repairs do not change code.

## TASK-012 verification sweep and D-VERIFY-BACK (2026-10-29)

**Implementation.** `src/features/account-erasure/server/verification-sweep.ts`:
- `runVerificationSweep(counter, binding)` runs every non-deferred query from `inventorySweeps()` and returns counts grouped by owning step (`residualsByStep`), the per-membership rows deferred to TASK-016 (`deferredRowIds`), and `complete`. It returns no uid, e-mail, document id or content.
- `ROW_OWNING_STEP` maps each sweepable row to its owning step (SPEC "Steps"). The test fails if a sweepable row has no owner.
- `createVerifyHandler` (the `verify_data` handler). A clean sweep returns `done`. A residual re-runs one bounded batch of the owning step's idempotent cleanup and returns `more`, so the persisted step stays at `verify_data` (D-VERIFY-BACK option (a)). The runner never writes a previous step.
- Fail-closed: an e-mail-bound sweep without a normalized e-mail throws `unexpected`; a residual with no cleanup handler throws `unexpected`.

**Deferred on purpose.** A-5, and the `memberRef` fields of I-7 and I-9, are per-membership checks in TASK-016. `complete` covers the uid and e-mail sweeps only. The verify handler must not be wired to final closeout until TASK-016 adds the per-membership check. The Firestore Admin adapter for `SweepCounter` is not built here (wiring task, as for the forum port).

**Tests.** `verification-sweep.test.ts`: 35 tests pass.
- Owning-step coverage: every sweepable row has exactly one owner, and every owner is a real step before `auth_delete`.
- Zero matches pass; A-5 and the I-9 memberRef are reported as deferred.
- One remaining match in each of the 25 non-deferred rows (I-1..I-14, A-1..A-4, A-6..A-12) returns to that row's owning step. A-5 is covered by the deferred assertion.
- The report contains no uid or e-mail. A missing normalized e-mail fails closed.
- Verify handler: a clean sweep runs no cleanup; a residual runs only the owning cleanup and returns `more`; a residual without a cleanup fails closed.
- Through the real runner: a residual keeps the persisted step at `verify_data` (budget exhausted, never a previous step); with the residual cleared, the runner advances to the `auth_delete` hand-off.

**Verification (2026-10-29).**
- `pnpm vitest run src/features/account-erasure`: 7 files, 180/180 pass.
- `pnpm typecheck`: exit 0.
- `pnpm exec eslint src/features/account-erasure`: exit 0, no warnings.
- `pnpm test` (full suite): 426 files, 8385/8385 tests pass.

**Independent review 1:** CHANGES_REQUIRED. Blocking: A-8 through A-11 were routed to `forum` and `memberships`, but SPEC "Steps" assigns A-1 to A-12 to `actor_audit`, and the `memberships` cleanup does not clear those actor fields, so a residual could not converge. Important: the owner test was tautological (it compared the map with itself). Suggestions: exclude `verify_data` as an owner, and assert the exact report keys. Repairs: the map now follows SPEC (A-8..A-12 to `actor_audit`); a new test compares the map row by row with an explicit table written from SPEC, not derived from the map; a test asserts no owner is `verify_data`, `auth_delete` or `final_sweep`; the report key set is asserted exactly. Noted for the Firestore counter adapter task: it receives the uid and e-mail, so its own no-identifier behaviour is untested here.

**Independent review 2 (focused re-review of the repairs):** PASS on all four items: ROW_OWNING_STEP matches the SPEC "Steps" table for all 26 rows; the test compares against an explicit SPEC table; no owner is verify_data, auth_delete or final_sweep; the report key set is exact; 35/35 sweep tests pass. Result: TASK-012 Done (2026-10-29).

## Carry-forward documentation (2026-10-29)

- **Reverse-independence guard expectation (factual record).** In `src/features/skill-profiles/skill-profiles-scope-guard.test.ts`, the reverse-independence expectation changed from an ordered comparison to a sorted comparison, and the erasure-metadata exemption constant (`APPROVED_ERASURE_METADATA_COLLECTION_REFERENCES`, TASK-006, see the "skill-profiles: C1 allow-list and reverse independence" row above) was included in the allowed set. The change predates TASK-025 and is in the working tree only (uncommitted). It was not rewritten or discarded to restore the historical ordering. No TASK-025 to TASK-029 task amended that guard's allow-lists.
- **TASK-006 inventory exemption status.** The narrowed inventory model (TASK-006 "narrowed invariant") is unchanged. Its RETAIN/DEMOTE documentation cleanup is carried to TASK-042.
- **`teams/server/list-teams.ts` raw `createdBy`.** The server response passes the raw field; the admin client drops it, so no UI leak is claimed. Carried to TASK-042 (server DTO minimisation).

## Owner clarification: additional fencing of admin lifecycle writes (2026-10-29)

Decision (owner-approved, 2026-10-29): W-17's named stamping writes define the required fence coverage. They do not prohibit transactional account-erasure fencing of additional protected admin mutations of the same resource. Survey and challenge `open`, `close`, survey `delete` and `archive`, and challenge `archive` and `resolve` are authenticated protected mutations. They read `accountErasures/{adminUid}` in the same transaction as the write, and a refusal writes nothing. Existing authorization and domain semantics are unchanged. Anonymous and public read paths are not fenced by this clarification. The SPEC is not reopened.

## TASK-034 and TASK-035 refusal coverage (2026-10-29)

Defect found and repaired by the new refusal tests: `teams/server/create-invitation.ts` mapped a fenced `setPending` refusal to `persistence_failed`. It now maps through `writeRefusalFor` to `erasure_in_progress`. No business write occurred in either case.

Tests added: `surveys/server/admin-stamp-fence.test.ts` (survey delete and archive refusal, plus an unchanged-behaviour delete), `teams/server/admin-write-fence.refusal.test.ts` (role set, access-request reject and approve, admin grant, invitation setPending, legacy seed), `skill-trees/server/update-skill-tree.refusal.test.ts` (tree update refusal and unchanged-behaviour update).

Independent review of TASK-031 through TASK-035 is pending and is not represented as passed here.

## TASK-038: production handler composition (2026-11-02)

Approved decisions applied in this change:

- Normalized e-mail provenance (owner approval, 2026-11-02). The invitation step, the verification sweep and the final sweep use the normalized e-mail of the verified identity of the same authenticated start/resume request. It never comes from body input, query parameters, a persisted historical e-mail field, or unrelated records. An empty normalized e-mail returns `erasure_unavailable` before any step runs, and the record does not advance (`toErasureRequest` in `start-erasure.ts`). Historical addresses that cannot be linked remain the documented limitation.
- `allowDuringErasure` boundary. The boolean option is replaced by an opaque capability (`src/features/auth/server/erasure-resume-capability.ts`): a branded type plus a WeakSet runtime check, so a plain object or `true` is refused. Issuance is restricted to `start-erasure.ts`, by the static boundary test in `auth-refusal.test.ts`.
- Auth deletion. After the runner hands off at `auth_delete`, `completeAfterHandoff` calls `runAuthDeletion` (TASK-037). The first call deletes Auth and marks `auth_deleted`; the second advances to `final_sweep` and completes only when the sweep is clean. Any other outcome is the resumable unavailable response.

Production handler graph (`production-erasure-handlers.ts`), in SPEC step order:

| Step | Production handler | Port / store |
| --- | --- | --- |
| forum | `createForumStepHandler` | `erasure-adapters-forum.ts` (transactional thread and reply reads, transactional `threadId` query) |
| memberships | phased: `createMembershipStepHandler`, then `createInvitationsStepHandler` | `erasure-adapters-team.ts` (roadmap ownerRef query inside the membership transaction) |
| conversations_owned | `createOwnedConversationsStepHandler` | existing `getDefaultConversationStore` (erasure list methods, runtime-tested) |
| participant_bindings | `createParticipantBindingsStepHandler` | production codec `content-codec.ts`, discovery `erasure-adapters-conversations.ts` (collection group, AE-IDX-1) |
| locators | `createLocatorsStepHandler` | existing conversation store |
| personal_data | `createPersonalDataStepHandler` | `erasure-adapters.ts` |
| survey_participations | `createSurveyParticipationsStepHandler` | `erasure-adapters.ts` (uid field and `uid__` id-range queries) |
| actor_audit | `createActorAuditStepHandler` | `erasure-adapters.ts` (closed table of the 15 approved targets, literal names) |
| verify_data | `createVerifyHandler` with a cleanup for each owning step | `erasure-adapters-sweep.ts` (40 counters, completeness-tested) |
| auth_delete, final_sweep | `runAuthDeletion` after handoff | `auth-deletion-adapter.ts` (`getAdminAuth().deleteUser`) |

Ordering. The membership phase runs first: each membership is removed in a transaction that nulls its roadmap ownerRef values before deleting the membership. Invitation cleanup starts only after the membership phase is `done`, so it never runs ahead of the membership cleanup. Auth deletion is reachable only through the runner's handoff, which happens only after `verify_data` advances.

Verification sweep. Per-membership rows (A-5 roadmap ownerRef, conversation participantMemberRef) are deferred by `runVerificationSweep`, as recorded in TASK-012. The membership step checks them inside its own transaction before deletion. The per-membership counters stay in the table so the completeness test covers every registry sweep.

Known limits, recorded for TASK-042 and TASK-045:

- Invitation document-id suffix match (`__${normalizedEmail}`). Firestore cannot filter by suffix. `erasure-adapters-team.ts` reads the keys of the whole `teamInvitations` collection once per `invitationIdsFor` call. Cost is O(number of invitations) per call. The result is correct and idempotent, and it adds no `normalizedEmail` field.
- Subtree rows (goals, roleTarget, conversations, conversationParticipations) are counted as direct documents. The approved rows hold documents directly under these collections. A nested sub-collection below such a document is not counted; the SPEC names no such sub-collection.
- The collection-group discovery needs the AE-IDX-1 index (`conversations.participantUid`). The index is repository configuration (TASK-008). Its deployment is an operator action (TASK-045).
- The Admin SDK adapters are tested over a structural recording double (`admin-firestore.test-helper.ts`), not over the real SDK or a Firestore emulator. Transaction conflict behaviour is the D-EMU gate. These tests do not claim it.

Dated scope-guard approval (2026-11-02). The D2 scope guard's approved collection-reference list names five exact erasure-only files: `erasure-adapters-conversations(.test).ts`, `erasure-adapters-sweep(.test).ts` and `production-composition.test.ts`. Each reads D2 collections for the approved erasure graph. No D2 store, route or feature module imports them.

`PRODUCTION_HANDLERS_READY` is `true` in the same change as the complete wiring above. The readiness test asserts the flag, the composition and the refusal paths without reaching any service.

## TASK-038 independent review result and readiness hold (2026-11-02)

An independent security-focused review of the production wiring returned CHANGES_REQUIRED, with one Important finding that gates the readiness flip. The flag is therefore `false` in this state.

Finding (Important, unresolved, owner decision required). `runVerificationSweep` skips every `perMembership` inventory row. The sweep therefore never checks A-5 (`roadmapItems.ownerRef`), I-7 (`participantMemberRef`) or I-9 (`memberRef`) for the final sweep. SPEC BR-17(1) requires the final sweep to find zero matches for I-1 to I-14 and A-1 to A-12. The TASK-012 and TASK-016 record states that closeout must not be wired until a per-membership check exists. The membership step checks each membership's roadmap ownerRefs inside its own transaction before deletion, but no check runs after memberships are gone. The per-membership counters exist in the table, but they cannot run after deletion, because a membership's `memberRef` is needed to find its residuals and the record must not store it (AE-SI-5).

Decision needed from the owner (architecture and security). Choose one:
(a) Store nothing new, and accept the transactional argument: the membership step clears every ownerRef and each participant binding is cleared together with its memberRef, so no per-membership residual can exist after the membership and binding steps. Record that acceptance explicitly as a BR-17(1) amendment for these three rows.
(b) Require a durable, non-identifying per-request residual check, for example a bounded set of opaque memberRef digests held only for the duration of one erasure, with a defined storage and deletion rule. This is a new persistence decision and needs its own SPEC amendment.
(c) Keep the flag `false` until the SPEC is amended.

Until the owner decides, `PRODUCTION_HANDLERS_READY` stays `false`. The complete chain is wired and tested behind the flag. The end-to-end suite drives the chain with `ready: true` on its own dependency object, and does not claim the flag.

Other review findings (resolved in this change): the empty-e-mail fail-closed branch is now tested through a whitespace e-mail that verifies but normalizes to empty, with `erasure_unavailable`, no record and no Auth call. The guard's `authTestsOfTheBoundary` entries are test-only and are kept as documentation.

## Owner decisions (2026-11-02): BR-17(1) membership-instance rows and account-erasure scope exemptions

Decision 1 (option a, approved). BR-17(1) is amended narrowly, in SPEC.md, for A-5, I-7 `participantMemberRef` and I-9 `memberRef`. They are discharged by a transactional cleanup invariant, not a post-deletion zero. No new durable history or marker is added. The SPEC decision log "BR-17(1) membership-instance rows (approved 2026-11-02)" is the authority.

Code evidence for the invariant (what the production code does, verified by reading it):
- A-5 (`roadmapItems.ownerRef`): `membership-erasure.ts` runs one transaction per membership. It queries the roadmap items with `teamId` and `ownerRef == memberRef` inside the transaction, clears them, and returns. The membership is deleted only in a later transaction that finds no items. The deletion is never in the same batch as a clear that is still pending.
- Writers that set an ownerRef (`create-roadmap-item.ts`, `update-roadmap-item.ts`) read the acting lead's membership and the team's memberships inside their own transactions.
- I-7 `participantMemberRef`: the participant-binding step clears `participantUid`, `participantMemberRef` and the other binding fields in one transaction per owner document. It discovers bindings by `participantUid`, not by memberRef. The uid-addressable sweep (`conversations|collectionGroupFieldEquals|participantUid`) still runs at final sweep.
- I-9 `memberRef`: the membership document itself is the row. It is uid-addressable (`teamMemberships` by `uid` field and by id prefix), so the final sweep still checks it.

Residual concurrency risk, stated for the reviewer and for D-EMU. A roadmap writer that commits after a membership's items were queried, but before that membership's deletion commits, could leave an ownerRef that names the deleted memberRef. The writer read the membership, and the deletion did not write any document the writer read. Whether Firestore transactions detect that phantom through query read sets is a commit-ordering property, which only the real emulator can show. Until the D-EMU race evidence exists for this case, the invariant is established only under serializable transaction semantics. The readiness decision depends on that stated assumption, and the D-EMU gate (TASK-041 closeout) must exercise this ordering.

Decision 2 (ratified, narrow). The account-erasure scope exemptions are exact files, with reasons, in the existing guard lists:
- personal-goals D1 collection identifier: `erasure-adapters.ts`, `erasure-adapters-sweep.ts`, `erasure-adapters-conversations.ts`, `erasure-end-to-end.test.ts`, `production-composition.test.ts`, and their `.test.ts` siblings.
- personal-goals D1 collectionGroup: `erasure-adapters-conversations.ts`, `erasure-adapters-sweep.ts`.
- skill-profiles C1 deletion and residual check: `erasure-adapters.ts`, `erasure-adapters-sweep.ts`, `erasure-end-to-end.test.ts`, and their `.test.ts` siblings.
- team-skills C2 concept rule: `erasure-adapters.ts`, `erasure-adapters-sweep.ts`. The rule is restated as "no unauthorized production consumer may introduce or consume protected D1/D2 concepts". The new test in `team-skills-cross-cutting.test.ts` proves the exempt modules are server modules, not routes, components, client modules, domain modules or DTOs.
- D2 (dated 2026-11-02 earlier): `erasure-adapters-conversations(.test).ts`, `erasure-adapters-sweep(.test).ts`, `production-composition.test.ts`.

The exemptions grant cleanup and residual verification only. They grant no product display, aggregation, analytics, ranking, admin inspection, feature reuse or new business behaviour. No directory or prefix is exempt.

## D-EMU manual gate: updated procedure (2026-11-02). Procedure; the owner-provided result is PASS (see "D-EMU manual gate: owner-provided result (PASS)")

The real-emulator race test is `src/features/auth/server/erasure-fence.race.emulator.test.ts`. It runs against the local Firestore Emulator only. It is skipped unless `FIRESTORE_EMULATOR_HOST` is set and `DEVPULSE_EMULATOR_PROJECT` is a `demo-` project. A skipped run is not a pass.

Procedure (Windows PowerShell, from the repository root, owner runs it locally):

1. Confirm a JDK 21 or newer is installed. The repository does not install one.
   ```powershell
   java -version
   ```
2. Terminal A: start only the Firestore emulator (default port 8080 unless `firebase.json` says otherwise).
   ```powershell
   npx firebase emulators:start --only firestore --project demo-erasure-race
   ```
3. Terminal B: run the race test against that emulator.
   ```powershell
   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
   $env:DEVPULSE_EMULATOR_PROJECT = "demo-erasure-race"
   pnpm vitest run src/features/auth/server/erasure-fence.race.emulator.test.ts
   ```
4. Expected PASS evidence: the vitest summary reads `Tests  2 passed (2)`, and both cases run (not skipped): the protected transaction whose fence read was absent does not commit once the fence is created concurrently, and an unrelated uid's write still commits.
5. Terminal A: stop the emulator with Ctrl+C.
6. Record in this section: date, `java -version` output, `npx firebase --version`, the exact commands, the vitest summary line, and pass or fail. The owner-provided result is recorded in "D-EMU manual gate: owner-provided result (PASS)"; the fields above are the procedure's record template.

Evidence fields (fill in only after the run):
- Date: —
- Java version: —
- firebase-tools version: —
- Vitest summary line: —
- Result: see "D-EMU manual gate: owner-provided result (PASS)" below; this procedure was run by the owner.

## TASK-038 fresh review (2026-11-02): CHANGES_REQUIRED, one Blocking open, one Blocking repaired

Finding 2 (Blocking, repaired). Invitation ownership used the id suffix `__${normalizedEmail}` as an independent match. A
different person's invitation whose id ends with that address, and whose stored e-mail is different, was deleted. The
ownership rule is now a single pure predicate in `src/features/account-erasure/server/invitation-match.ts`:
- a stored `email` that normalizes to the erased address matches;
- a stored `email` that is present and different never matches by id;
- the id suffix is trusted only when no `email` field is stored, and only for the exact id `${teamId}__${normalizedEmail}`;
- a record with `resolvedUid` equal to the uid matches (I-11).
The step, the adapter's candidate filter (`erasure-adapters-team.ts`) and the residual counter (`erasure-adapters-sweep.ts`) use this same rule. The adapter and counter now read full invitation documents, because ownership needs the stored fields. The cost is recorded in the TASK-038 limits. Tests: `invitations-erasure.test.ts` (keeps a contradicting invitation; deletes an exact-id one), `erasure-adapters-team.test.ts`, `erasure-adapters-sweep.test.ts` (a coincident suffix is not a residual).

Finding 1 (Blocking, OPEN, owner decision required). The reviewer and I agree on this analysis. A membership can be deleted while a roadmap `ownerRef` equal to its `memberRef` is committed after the erasure's query. Sequence: the erasure transaction queries roadmap items and finds none. A roadmap writer then reads the membership (still present), sets `ownerRef`, and commits. The erasure transaction deletes the membership and commits. The writer only read the membership, and the erasure never read the new roadmap document, so neither transaction's read set is violated. The membership deletion therefore leaves a dependent `ownerRef`, and the final sweep does not check A-5 (`perMembership` rows are skipped by design). Nothing in account-erasure can close this without changing code outside it. Closing it requires either:
(a) every roadmap transaction that sets `ownerRef` to a memberRef also writes (touches) that target membership document in the same transaction, so a writer that commits first invalidates the erasure transaction's read of the membership and forces a retry; this changes membership writes in the roadmap feature; or
(b) a per-team document that both the membership-erasure transaction and every such roadmap writer write, which is a new persistence surface; or
(c) accept the residual with an explicit BR-17(1) decision for the concurrent-insert window, and keep `PRODUCTION_HANDLERS_READY` false until the D-EMU evidence covers this ordering.
Adding a post-hoc check without persistence cannot satisfy BR-17(1), because the memberRef cannot be recovered after deletion. `PRODUCTION_HANDLERS_READY` stays false.

## Membership/roadmap race repair (approved 2026-11-02): concurrency argument and code evidence

Read and write sets, verified in the code.

A-5 `roadmapItems.ownerRef`.
- Introduction (create, `create-roadmap-item.ts`; update, `update-roadmap-item.ts` when `ownerRef` changes to a non-null value). Reads in the transaction: the team's memberships by query (`listMemberships`, which includes the target membership document), the actor's membership, team status, and the slot. Writes: the roadmap item, and, new in this repair, `tx.set(teamMemberships/{uid}__{teamId}, { memberRef }, { merge: true })` for the target membership, with its own unchanged `memberRef`. The touch is the last write, after every validation, so a refusal writes nothing.
- Clearing or an unchanged `ownerRef` adds no touch (tests: "an unchanged owner adds no membership touch", "clearing the owner adds no membership touch").
- Erasure (`membership-erasure.ts`, `runMembershipBatch`): one transaction per membership. Reads the membership (`tx.getMembership`), then queries roadmap items where `teamId == T` and `ownerRef == memberRef` (transactional query), clears them, and returns. The membership is deleted only in a later transaction that found no items.
- Ordering. (i) Erasure commits its deletion first: the writer's transaction read the membership at version v, the deletion changed it, so the writer's commit conflicts; it retries, finds the membership missing, and refuses (`invalid_owner`). (ii) Writer commits first: its touch changed the membership after the erasure transaction read it, so the erasure's commit conflicts; it retries, its query now returns the new item, the item is cleared, and only then is the membership deleted. No successful ordering leaves an ownerRef that names a destroyed membership.
- The argument depends on the membership document being both read and written by both transactions. The touch is what makes (ii) conflict. Without it, the writer could commit a read-only dependency that the deletion never observes, which was the gap in the TASK-038 review.

I-7 `participantMemberRef`.
- Introduction: the invitation (`invite-participant.ts`). Reads: the owner conversation (in the transaction), and the invitee's membership is resolved by a plain read before the transaction (`resolveParticipantRef`), which is an authorization check. Writes: the owner conversation's binding fields, and the invitee's participation index.
- Before this repair the owner transaction was fenced only on the owner uid, so the invitee's index could be written after the invitee's erasure record existed. The repair adds `secondFence` to `runOwnerTransaction`: the owner and the invitee erasure records are both read in the same transaction before any write. The invitation refuses while the invitee's record exists, and an invitation that commits before the record is created is cleaned by the binding step (discovery by `participantUid`).
- Binding cleanup (`participant-bindings-erasure.ts`) clears all five binding fields, including `participantMemberRef`, in one transaction per owner document, and discovers bindings by `participantUid` through the collection-group query (AE-IDX-1). The final sweep's `participantUid` row is uid-addressable and remains zero-residual.

I-9 `memberRef`.
- The row is the membership document itself. It is uid-addressable (uid field and id prefix). The membership is created only by fenced grant paths on the target uid (TASK-030), and destroyed only by the membership-erasure transaction. Role updates (`set-team-member-role.ts`) and member-ref materialization (`materialize-member-refs.ts`) use `tx.update`, which fails on a missing document, so they cannot recreate a deleted membership. The earlier wording that every membership write is fenced on the target uid was too broad, and is withdrawn.

Tests added: `update-roadmap-item.test.ts` ("owner assignment coordinates with membership erasure", five cases including the touch inside the transaction and the no-touch cases); `roadmap-writer-fence.test.ts` (a refused owner assignment writes nothing); `roadmap-scope-guard.test.ts` narrowed to exactly one approved membership write per owner-assignment file, with the exact merge-only form; `invite-participant.test.ts` (the invitee is passed as the second fence). These are structural tests over recording doubles. They prove the read and write sets above, not Firestore's conflict behaviour. The real interleaving is the D-EMU gate and is not claimed here.

## TASK-038 re-review (2026-11-02, fresh reviewer): repairs and the open owner decision

Repaired:
- Replacement candidate fence (Blocking). `change-participant.ts` replacement now passes `{ secondFence: candidateUid }` to `runOwnerTransaction`, so the candidate's erasure record is read in the same transaction before the binding and participation-index writes. Test: `change-participant.test.ts` ("the replacement candidate is fenced in the same transaction").
- Roadmap touch is `tx.update` (fails on a missing membership), not a merge set, which could have created a stub. The guard recognises the update form.
- Wording: membership fencing is stated precisely (creation is fenced on the target uid; role update and materialization update only and cannot recreate).

Open, owner decision required (Blocking, not repaired here). `remove-team-member.ts` (`removeTeamMember`) destroys a membership without the coordination that membership-erasure uses: it neither clears roadmap `ownerRef` values equal to that memberRef nor clears `participantMemberRef` on owned conversations. Ordinary removal therefore leaves a memberRef-linked value that no uid-addressable row can find later. The product contract for roadmap says an unresolved `ownerRef` is "unavailable or null" (preserved behaviour), so dangling references may be intended for ordinary removal. Two options:
(a) Ordinary removal performs the same clears as membership erasure before deleting (a behaviour change to the removal contract and to BR-10 "no dangling link"), in one transaction per membership.
(b) Ordinary removal stays as it is, and the owner records that the amendment's invariant covers erasure-driven destruction only. A later erasure of a person already removed by an admin cannot see the dangling value, which is a residual the owner must accept or close.
Until this decision is recorded, `PRODUCTION_HANDLERS_READY` stays `false`.

## Ordinary admin removal: lifecycle cleanup (owner decision, 2026-11-02)

Decision. Ordinary `removeTeamMember` clears the memberRef-dependent references of the destroyed membership instance. It does not accept the dangling residual. It is a lifecycle-integrity change, not an account erasure. The rule is recorded as the amendment of team-management SPEC BR-29 (2026-11-02). Note: an earlier review round cited "BR-10 no dangling link". That citation was wrong. BR-10 in team-management concerns cross-team access, and it is not amended.

Implementation (one destruction boundary for both erasure and ordinary removal, `src/features/account-erasure/server/membership-destruction.ts` and `membership-destruction-adapter.ts`):
- Each round first clears the participant bindings that name the membership's memberRef, one owner transaction per conversation, through the existing neutral removal (`eraseParticipantBinding`: five binding fields set to null, participation index deleted, participant notes dropped by re-encryption). The binding set comes from the collection group `conversations` where `participantMemberRef == memberRef` (the AE-IDX-1 index).
- Then a FINAL transaction reads, in this order: the membership document (`teamMemberships/{uid}__{teamId}`); the roadmap items with `teamId == T and ownerRef == memberRef` (transactional query); the bindings with `participantMemberRef == memberRef` (transactional collection-group query). If the roadmap set is non-empty, it sets those `ownerRef` values to null and returns, so the membership survives. If the binding set is non-empty it returns and the next round clears them. Only when both are empty does it delete the membership, in the same transaction.
- A membership with no memberRef (a legacy record) has no dependent references, and is deleted directly. A malformed memberRef, or a binding that cannot be cleared (for example an unreadable payload), fails closed: the membership stays and the removal returns an error. Nothing is partially deleted before the membership.
- Rounds are bounded (MAX_DESTRUCTION_ROUNDS). Exhausting them is a failure, not a success.

Read and write sets (verified in the code):
- Final transaction, reads: `teamMemberships/{id}`; roadmap query (`teamId`, `ownerRef`); conversations collection-group query (`participantMemberRef`). Writes: `roadmapItems/{id}.ownerRef = null` (up to the batch size) or `delete teamMemberships/{id}`, never both in one round.
- Binding cleanup, per owner transaction: reads and writes the owner conversation and the participant's index (existing removal semantics).
- Concurrent introduction of a reference to this memberRef: a roadmap owner assignment writes `teamMemberships/{id}` (same value) in its own transaction, so it conflicts with the final transaction's membership read in either order (A-5). A participant invitation or replacement writes the candidate membership in its owner transaction and reads the candidate's erasure record there (I-7).
- What is established by document conflicts: the membership read and the membership writes conflict in both orders. What relies on query read-set semantics (a binding or roadmap item created after the final transaction's query but before its commit): this is the Firestore serializability question, and it is the D-EMU gate. These tests do not prove it.

Tests:
- `membership-destruction.test.ts` (10): ordinary removal clears the matching roadmap ownerRef and deletes only in the final transaction (ordering proven by the recorded log); unrelated ownerRefs and the roadmap business record are unchanged; bindings naming the membership are cleared through the approved binding cleanup; a failed binding cleanup keeps the membership; atomicity order; no uid, e-mail or marker is written; absent membership is done with no writes; legacy membership is deleted without dependent cleanup; malformed memberRef is refused; zero budget is refused.
- `membership-role-regression.test.ts` (existing, 28 pass): ordinary removal still denies access on the next check, and rejoin receives a new ref. The fake Firestore was extended with collection-group queries, select, size, transactional query reads and delete, without changing its existing behaviour.
- `roadmap` owner tests (existing and new): owner assignment, changed owner, cleared owner, unchanged owner (no touch), stale owner refused with no touch, refused erasure writes nothing, no uid or e-mail in the roadmap record.
- `invite-participant.test.ts` and `change-participant.test.ts`: the candidate is passed as the second fence.

Known limit (fail closed). A binding whose `participantMemberRef` matches but whose `participantUid` differs from the membership's uid is skipped by the binding cleanup, so it would keep the removal from completing and stop after the bounded rounds. Such inconsistent data is not produced by the product's write paths, and the removal then fails rather than leaving a dangling reference. This is recorded for the operator.

## TASK-038 fresh independent review (2026-11-02): CHANGES_REQUIRED, readiness held

- Fresh read-only reviewer result: CHANGES_REQUIRED (no clean PASS). `PRODUCTION_HANDLERS_READY` stays `false`.
- Important 1 (doc/code mismatch): the `membership-destruction.ts` header said the boundary served erasure too. Repaired by correcting the header: ordinary admin removal uses the boundary; erasure's membership step (`membership-erasure.ts`) does not, and discovers I-7 bindings by `participantUid` in its later uid-addressed bindings step (SPEC BR-17(1) reasoning, I-1). No erasure behaviour changed.
- Important 2 (perMembership rows skipped by the verification sweep): this is the owner-approved BR-17(1) option (a), recorded in the SPEC decision log. Accepted, and the final sweep stays a transactional argument, not a zero check. Still needs the D-EMU evidence.
- Suggestions, not yet actioned: `deleteConversation` `unfenced?: true` (caller-controlled bypass, used only by `conversations-erasure.ts`; should move behind an erasure-only capability or get a caller-restriction test); ordinary removal does not read `accountErasures/{uid}` in its final transaction (decide whether removal is person-owned under BR-4(b)); unused variable at `create-reply.transaction.test.ts:100` (lint warning).
- Readiness: held for two reasons. A clean independent review is required first, and the D-EMU race ordering (lines above, "Residual concurrency risk") must be evidenced before the flag can flip. D-EMU: NOT RUN at the time of this review (superseded by the owner-provided PASS).
- Verification run: full `pnpm test` exit 0 (477 files passed, 1 skipped; 8821 tests passed, 2 skipped). The UI load timeouts (SkillTreeCreationForm x2, TeamDetail x1) passed in isolation (118/118). `pnpm typecheck` exit 0. `pnpm lint` exit 0 (0 errors, 1 pre-existing warning).

## TASK-038 remediation of the 2026-11-02 review: both owner decisions applied (2026-11-02)

- **Decision 1, ordinary removal fenced by the target person.** `destroyMembershipInstance` takes the target `{ membershipId, uid }`. The `uid` is the member being removed. It is never the admin's uid. Each round first runs a pre-check transaction that reads `accountErasures/{targetUid}`, so a fenced removal writes nothing. The final transaction reads the same record with `tx.get` before the membership read, the roadmap clears and the delete. A stored membership uid that differs from the target is `membership_malformed`. `removeTeamMember` maps a fence refusal to `erasure_in_progress`. Authorization is unchanged. Tests: `membership-destruction.test.ts` (new block, 6 cases: fenced refusal with no writes, target not actor, fence read in the final transaction before membership read and delete, unreadable fence fails closed, malformed uid, normal removal). `remove-team-member.default.test.ts` (target uid passed, `erasure_in_progress` mapping).
- **Decision 2, `deleteConversation` unfenced option removed.** The erasure-only path is `deleteConversationForErasure(capability, ...)`, which requires an `ErasureOwnerCleanupCapability` minted by `issueErasureOwnerCleanupCapability()`, minted only by the three approved erasure modules: `conversations-erasure.ts` (owner delete and locators), `production-erasure-handlers.ts` (the erasure binding step), and `membership-destruction-adapter.ts` (ordinary removal's binding cleanup, 2026-11-02). The static test pins that exact list. Tests: `delete-conversation-boundary.test.ts` (8 cases incl. static guards: no `unfenced` token in `delete-conversation.ts`, one minter, one importer outside D2). `owner-write-fence.test.ts` erasure case now passes the capability.
- **Header.** The `membership-destruction.ts` header correction from the earlier review is retained.
- **Residual, stated in SPEC.** A round's binding clears commit separately from its pre-check. A fence that appears between them stops the delete and the roadmap clears. The binding clears already committed remain (they clear only this membership's references).
- **Not yet proven.** The adapter wiring (`membership-destruction-adapter.ts` calling `assertNoErasureRecordInTransaction` on the real Firestore transaction) is reviewed by reading only. Same-transaction conflict behaviour is the D-EMU gate and is not claimed.
- **Verification (this step).** `membership-destruction.test.ts`, `remove-team-member.default.test.ts`, `membership-role-regression.test.ts`, `skill-contribution.test.ts`: 4 files, 89/89 passed, exit 0. `development-conversations` and `account-erasure` focused run: 93 files, 2029/2029 passed, exit 0 (after adding `import "server-only"` to the new capability module, which the D2 guard requires). Full suite, typecheck and lint: not yet re-run after this step.
- **Readiness.** `PRODUCTION_HANDLERS_READY` stays `false`. TASK-038 awaits a fresh independent re-review and the D-EMU evidence.

## Remediation of the 2026-11-02 independent reviews (TASK-038, TASK-039, TASK-040)

- **TASK-038 re-review (fresh reviewer): one Important finding, repaired.** `startOrResumeErasure` used the token's e-mail for invitation matching without requiring `emailVerified`. Repair: `toErasureRequest` takes `emailVerified` and returns no request when it is not true. Both the create and resume paths then fail closed with `erasure_unavailable` before any record or step. Tests: `start-erasure.test.ts` (unverified start creates no record and runs no step; unverified resume of an in-progress record runs no step and leaves it unchanged). `start-erasure.test.ts` 36/36, exit 0. TASK-038 stays Ready (readiness held by D-EMU). A fresh re-review is required after this repair.
- **TASK-039 review: CHANGES_REQUIRED, repaired.**
  - Identity binding (Important): re-authentication signed in with the TYPED e-mail, so a password for a different account could replace the session. Repair: the gateway re-authenticates the SIGNED-IN account's own e-mail (`signedInEmail`, `reauthenticate(password)`), and the flow refuses with `unauthenticated` when no account is signed in. The typed e-mail is now only the confirmation sent to the server.
  - Call cap (Important): the test now asserts exactly `MAX_ERASURE_CALLS` POST calls, so lowering the cap fails it.
  - Focus after error and live region (Important): the focus call ran before the disabled e-mail field re-enabled, so it could not focus. Focus now runs in an effect after the render. New tests: focus after a failed attempt; progress announced in a `role="status"` region.
  - Suggestions applied: the token is read on every call; the flow is total (a rejected gateway call maps to `generic`); `progressAnnouncement` removed (unused). Not applied: a dedicated gateway test (mocked `firebase/auth`), recorded as an open suggestion.
  - Copy review against `docs/UI-UX.md`: NOT EVIDENCED. No copy review is recorded; it is not claimed here.
  - Tests: `src/features/account-erasure/client` and `components`: 25/25, exit 0.
- **TASK-040 review: CHANGES_REQUIRED, partly repaired.**
  - Blocking, owner list incomplete: nine fenced write owners are added to `FENCED_WRITE_OWNERS` (profiles, skill-profiles, role-target, personal-goals, conversation-store, forum create/delete thread, teams create-access-request and resolve-invitations). Each already reads the fence in code, so the real tree passes. The list is still a curated list, not a mechanical enumeration of every write surface. An EXCLUDED map with reasons is not yet added; that is an open item.
  - Important, comments count as a fence: `withoutComments` strips block and line comments before the token match. Planted test: a comment-only fence is flagged. Known limit: string literals are not parsed.
  - Important, D2 scope-guard entries for `conversation-store.ts`: at HEAD the entry was `USER_DEVELOPMENT_COLLECTION`, `parent`, `subcollection`. Now it is `USER_DEVELOPMENT_COLLECTION`, `OWNER_CONVERSATIONS_SUBCOLLECTION`, `PARTICIPATION_INDEX_SUBCOLLECTION`, `MEMBERSHIPS_COLLECTION`. The two subcollection names replace the generic tokens for the same paths. `MEMBERSHIPS_COLLECTION` supports the membership touch in the owner-approved race repair (this file, the touch in `invite-participant` and `change-participant`). OPEN FOR OWNER REVIEW: confirm this entry, or move the touch out of `conversation-store.ts`. TASK-040 is not closed until this is confirmed.
  - Suggestions not applied: dynamic `import()` and `require()` are not matched by the auth-import guard (planned); the scan excludes test files by design (to be stated in the header).
  - Tests: `erasure-static-guards.test.ts` 15/15, exit 0.

## TASK-044 review repairs (2026-11-02)

- Independent review 1: CHANGES_REQUIRED (six Important documentation findings), all repaired: TTL stated as an operator action in the Firebase project; checklist rows 1-10 map to TASKS items 1-10; historical e-mail limitation (item 11) and E-2 and E-3 recorded as documented limitations with owner role and blank evidence; item 4 uses a disposable test account under the TASK-045 gate; the section 8 precondition gates 8a and 8b; TASKS status set to In Progress.
- Independent review 2: CHANGES_REQUIRED, one Important and suggestions, all repaired: `AE-IDX-1` is a collection-group `fieldOverrides` entry in `firestore.indexes.json`, not a composite index (corrected in the runbook); the precondition moved to the top of section 8; the TASK-045 gate sentence added to the checklist; the SPEC heading reference corrected to "Invitations and email (BR-13)"; an owner and evidence field added to the document-id limitation.
- Re-review: pending. TASK-044 stays In Progress until the fresh review passes. D-EMU was NOT RUN at the time of this entry, superseded by the owner-provided PASS; it is not part of TASK-044 closure.
- Review 3 (2026-11-02): CHANGES_REQUIRED, one Important (the checklist gate sentence named rows 2 to 4 and 8, but TASK-045 covers rows 2 to 10). Repaired: the sentence now names rows 2 to 10 under the TASK-045 gate and places row 11 (D-EMU) under its own gate.
- Review cycle limit: TASK-044 has now used the two remediation cycles the workflow allows, so this repair is not followed by an automatic re-review. TASK-044 stays In Progress until a human decides whether the remaining runbook wording is acceptable or a further cycle should run.

## TASK-039 copy review against docs/UI-UX.md (2026-11-02): no mismatch

Checked `src/features/account-erasure/copy.ts` and the confirmation screen against docs/UI-UX.md:
- Language: all user-facing copy is Norwegian (UI-UX "Language").
- Delete pattern: the confirmation states that the deletion is permanent and cannot be undone, and offers a submit action and a cancel action (*Avbryt*), as the delete guidance requires (UI-UX "Delete", lines 670-671; the "explicit confirm/cancel step" rule at lines 296-297).
- Privacy copy: the copy never claims encryption, anonymity, or that operators cannot access data (UI-UX "Privacy copy").
- Account claims: no deletion from provider logs is claimed (BR-19), no undo or recovery is offered (AE-SI-11), and no identifier, e-mail or raw error text is shown (AE-SI-2).
- Observation, not a mismatch: the consequences list names "Firebase" as the provider whose login account is deleted. This is factual; no UI-UX rule forbids it.

Result: no code change required. TASK-039's "Copy reviewed against docs/UI-UX.md" acceptance criterion is now evidenced by this entry. TASK-039 still awaits its fresh re-review before it can be closed.

## TASK-040 final re-review repairs (2026-11-02)

- Re-review result: PASS_WITH_SUGGESTIONS on the verdict line, with two Important findings. Repaired:
  - Fence token (Important): the token check matched any mention of a helper name or of the erased-record collection name, so an import or a string alone passed. The check now requires a call form (`tx.get(`, `runFencedTransaction(`, `assertNoErasureRecordInTransaction(`, `runWriteTransaction(`, `writeRefusalFor(`) on comment-stripped text. Planted cases: an owner with only an import is flagged, and an owner with only a string is flagged. The 19 guard tests pass against the real tree, so every current owner has a real call.
  - W-17 completeness: `membership-destruction-adapter.ts` (the admin removal write path) is added to the W-17 owners. It reads the fence (the fence is read before each round and in the final transaction).
  - Stale JSDoc removed; the header states that test files are not scanned.
- Not repaired, recorded for review: `challenges/server/delete-challenge.ts` (`docs.delete`) and `team-skills/server/upsert-skill-need.ts` / `delete-skill-need.ts` are not in any W row. The reviewer did not verify whether they stamp an actor uid. They are not added here without that check; a human or a further review must decide.
- OPEN OWNER DECISION (blocks TASK-040 closure): the D2 scope-guard entry `MEMBERSHIPS_COLLECTION` for `conversation-store.ts` (the membership touch for invitation and replacement, `conversation-store.ts` `touchMembership`). The earlier line in this file that said "conversation-store.ts is not on any allow-list" is superseded by this entry. The owner must confirm the entry, or the touch moves out of `conversation-store.ts`.
- Verification: `erasure-static-guards.test.ts` 19/19, exit 0. Full repository checks are recorded in the checkpoint report.

## D-EMU manual gate: owner-provided result (PASS)

Provenance: this result was run by the owner, on the owner's Windows PowerShell, against the local Firestore Emulator. Claude did
not execute the emulator test and did not install Java or the JDK. No real Firebase project was used.

- D-EMU: PASS
- Environment: local Firestore Emulator
- Platform: Windows PowerShell
- Race test: `src/features/auth/server/erasure-fence.race.emulator.test.ts`
- Result: 2 tests passed, 0 skipped
- Protected transaction case: a transaction that had previously observed no erasure fence did not commit the protected business write after the fence was concurrently created.
- Control case: the unrelated uid write committed successfully.

Metadata not supplied by the owner, recorded as absent rather than invented: date of the run, `java -version` output, `npx firebase --version` output, and the exact vitest summary line. The SPEC and TASKS do not make these fields mandatory for the gate; they are recorded here as missing.

Scope of the evidence: it covers the transaction behaviour of the erasure fence (the race test). Code changed after the run (the target-person fence in ordinary removal; the erasure-only owner-delete capability; the verified-e-mail requirement in start-erasure) is reviewed separately under TASK-038 closure. Closure review must confirm those changes do not alter the fence transaction that the race test exercised.

## Owner decisions and closure record (2026-11-02)

- D2 `MEMBERSHIPS_COLLECTION` (APPROVED by the owner): the exact server-only D2 scope-guard exemption for `MEMBERSHIPS_COLLECTION` in `conversation-store.ts` is kept. It serves the approved transactional membership touch for invitation and replacement lifecycle correctness. No route, component, client or DTO exemption is approved. The earlier note that "conversation-store.ts is not on any allow-list" is superseded.
- Closure cycles (APPROVED): one additional independent closure review each for TASK-039 and TASK-044. Suggestions alone do not block closure.

### Unverified write surfaces, classified (2026-11-02)

- `src/features/challenges/server/delete-challenge.ts`: OUT OF SCOPE. An app-admin-only delete of a team challenge document (`requireAppAdmin`). It stamps no uid, writes no person-linked data, and creates nothing. The fence (BR-4(b)) applies to person-owned writes and to writes that stamp the acting uid (W-17); neither applies here. No fence added.
- `src/features/team-skills/server/upsert-skill-need.ts` and `delete-skill-need.ts`: OUT OF SCOPE. The team-level skill-need catalog. The stored record is exactly six keys (`teamId`, `treeId`, `requiredLevel`, `requiredCoverage`, `createdAt`, `updatedAt`) and holds no actor, uid or e-mail. The write mutates team catalog data, not person-owned data. No fence added. The write authorization (a team lead or admin, checked through the existing team seam) is unchanged.

## TASK-044 closure review 4 repairs (2026-11-02)

- Review 4 (closure, fresh reviewer): CHANGES_REQUIRED with two Important wording findings, both repaired:
  - The runbook's D-EMU paragraph said "NOT RUN" with no reference to the owner's PASS. It now refers to the owner-provided PASS section. The VERIFICATION heading that still said "Result: NOT RUN" is renamed to a procedure heading that points to the PASS section. Row 11's evidence cell stays blank.
  - Sections 1 to 3 (row 1 included) act on a real Firebase project, so the TASK-045 operator gate now covers them, and rows 2 to 10 are recorded under that gate.
- Suggestions applied: the quoted VERIFICATION heading is now exact; section 1 is labelled as covering E-4; the TASK-044 status line lists the review 2 and review 3 repairs.
- Narrow re-review: pending (authorised as the one closure re-review for the repairs).

## TASK-040 closure review (2026-11-02): PASS_WITH_SUGGESTIONS, Done

- Fresh closure review: PASS_WITH_SUGGESTIONS, next step "close". Items 1-7 PASS: W_SURFACES has W-1..W-18 with a reason for the excluded W-18; each owner has a call-form fence read in code; the planted tests would each fail if their check were removed; W-17 includes the membership adapter that reads the fence; the D2 exemption is exact and server-only; the out-of-scope classifications match the code.
- Important (repaired): the fence-token comment overstated what the check proves. It now says the guard proves that a transactional read or fence helper call exists, not that it reads accountErasures; the behavioural tests and the D-EMU evidence prove the ordering.
- Suggestion applied: `const MEMBERSHIPS_COLLECTION` moved below the imports in `conversation-store.ts`.
- Suggestions not applied: the W table is curated (future write surfaces add a row); the out-of-scope classifications are documentation only.
- Verification after the repair: guard tests 19/19, scope-guard tests 63/63, development-conversations server tests, exit 0 (39 files, 927 tests).

## TASK-038 closure review (2026-11-02): code-level PASS; evidence anchoring recorded

- Fresh closure review: READINESS CONFIRMED_TRUE_OK at code level. Items 1-10 PASS (fence transaction, target-person fence in ordinary removal, roadmap and membership coordination, erasure-only deleteConversation capability with its compile check, A-5/I-7/I-9 reasoning, handler graph and order, verified-e-mail provenance, invitation predicate, narrow exemptions, Auth deletion ordering). Item 11 FAIL on evidence anchoring only.
- Important (evidence anchoring, repaired as far as the repository allows): the D-EMU owner result is not tied to a commit. The repository has no commit that contains these files (HEAD `1f2e2ce` does not include them; the race test is untracked). The owner did not supply a run date or file hashes. To anchor the evidence, the SHA-256 of the files the race evidence depends on, as they stand on 2026-11-02, is recorded below. Committing is not done here (the user forbids it), so the tree is not tied to a commit.
- SHA-256 at this closure (files as they stand after the closure edits):
  - `src/features/auth/server/erasure-write-fence.ts` 3fd0f3b0dc87fe9ad407cb3e40f45d5c22cd80c8e0bf94e56c6324342b5042ed
  - `src/features/auth/server/erasure-fence.race.emulator.test.ts` 702deaf2bb41f757778dd7817984a9cce28cbf4456cc56f589edbca9dc261a89
  - `src/features/account-erasure/server/invitation-match.ts` b34df816435601596c7722e21e5124f521422e3a4ac6d4f1b1e6a228cd0b57c3
  - `src/features/account-erasure/server/production-erasure.ts` 8829b008e59dbf078c16c16e926b923f91ca5b8181382c0c4850f14b33bc4929
  - `src/features/teams/server/remove-team-member.ts` 043a4bfa402758d8ddd7a45b8c0df87309e44106948d77f2b4a8242021929ad6
  - `src/features/account-erasure/server/membership-destruction.ts` ae934e124829e5dceb84138b6df5c72771c2f49129c5d222b0dd3848d97ca7ef
  - `src/features/account-erasure/server/membership-destruction-adapter.ts` cc3b2ce2649ac0a6d34fcdc8d560516b8dabf4a087fbce3574958cf606453f51
  - `src/features/development-conversations/server/delete-conversation.ts` 48d559b13411417f99e7b907068c1e4ae12dd054c876356097a7706f835f2182
  - `src/features/development-conversations/server/conversation-store.ts` 84234591e379100d898b0cc49f086ab0bf874436e372aa05731e45140352544f
- Residual, stated and not hidden: the owner's run date and whether the owner's run used these exact bytes of the race test and `erasure-write-fence.ts` are not recorded. The owner is asked to confirm this. If the owner cannot confirm it, the D-EMU race must be rerun on the current bytes, which is a manual step.
- Code-level readiness does not depend on this residual. The fence transaction design (`runFencedTransaction`, `assertNoErasureRecordInTransaction`) is the one the race test exercises, and no reviewed file changed the ordering of its reads and writes.

## TASK-039 closure (2026-11-02): Done

- Fresh closure review: CHANGES_REQUIRED on the profile entry link (no test) and the cap assertion. Repaired: the link is the component `ErasureEntryLink`, rendered by the profile page and tested (href `/me/erasure`, the approved label). The cap test also asserts the literal 200.
- Narrow re-review of those repairs: PASS (`ErasureEntryLink.test.tsx`; `run-erasure-flow.test.ts` literal assertion).
- Verification: `src/features/account-erasure/components` and `client`: 27/27, exit 0.
- Copy review against docs/UI-UX.md: recorded earlier in this file, no mismatch.
- Suggestions not applied (not blocking): a dedicated gateway test with mocked `firebase/auth`; a permanently mounted status region for the completion announcement.

## TASK-041 final verification (2026-11-02): automated gates run on the current tree

- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0, 0 errors, 1 pre-existing warning (`src/features/forum/server/create-reply.transaction.test.ts:100`, unused `attempts`; outside this feature).
- `pnpm test`: exit 0. Test Files 479 passed, 1 skipped (480). Tests 8853 passed, 2 skipped (8855). The skipped file is the D-EMU race test when `FIRESTORE_EMULATOR_HOST` is not set; its PASS is the owner-provided result recorded above.
- `pnpm build`: exit 0 (Next.js production build completed; route table printed).
- TASK-004 evidence: the D-EMU owner-provided PASS (2 tests passed, 0 skipped, local Firestore Emulator, Windows PowerShell) is recorded. Its date, Java and firebase-tools versions and vitest summary line are not supplied and are not invented.

## TASK-042 and TASK-043 documentation closeout (2026-11-02)

- `docs/SECURITY.md`: AE-SI-1 to AE-SI-13 added as a numbered section, with the SPEC wording (AE-SI-8 includes the `authorTag` sentence). Invariant 52 (the "no deletion flow" limitation, SI-16) replaced by a pointer that states the current state and that provider logs and backups are not claimed erased.
- `docs/DATA-MODEL.md`: `accountErasures`, the erased-thread placeholder, the erased-actor marker and the neutral participant block are described. The TTL policy is named as an operator action under the TASK-045 gate, and no deployment is stated.
- `docs/ARCHITECTURE.md`: the `verifyIdToken` fence read is recorded as an intentional per-request cost. The transactional fence (BR-4(b)), the target-person fence in ordinary removal, and the erasure contract are recorded, with `PRODUCTION_HANDLERS_READY` and the TASK-045 operator gate named. Known limits (E-1 to E-3, historical invitations under BR-13) are listed.
- SPECs superseded (pointer to `docs/features/account-erasure/SPEC.md`): `development-conversations` (inline supersession at the three erasure statements; BR-20 erasure-only override recorded), `personal-development-goals` (SI-16 row), `individual-skill-self-assessment` (the account-deletion statements), `member-identity-and-team-roles` and `team-forum` (pointer section; these had no literal limitation wording). One-line behaviour notes added to `team-management` (ordinary removal clears references and is fenced) and `team-roadmap` (owner assignment touches the membership). No other SPEC content was rewritten, and the account-erasure SPEC was not changed.
- Privacy: no document claims deletion from provider logs or backups (BR-19, E-1 to E-3), or encryption or anonymity beyond the SPEC.
- Verification by reading: the invariant IDs match the SPEC definitions (AE-SI-1 to AE-SI-13), and the cross-references point at existing files. No code changed in this step.

## TASK-044 closure (2026-11-02): Done

- Closure review 4 (CHANGES_REQUIRED on the D-EMU wording and the TASK-045 gate scope) repaired; narrow re-review found remaining stale "NOT RUN" wording, repaired and re-checked. Final narrow re-check: PASS_WITH_SUGGESTIONS, next step "close".
- Applied from the final re-check: the item mapping now states that TASKS item 11 (the historical e-mail limitation) has no checklist row, and that checklist row 11 is the D-EMU gate.
- Runbook state: all eleven checklist rows have owner roles and blank evidence fields; no evidence was invented. Row 11 is the D-EMU gate, whose owner result is recorded in VERIFICATION.md.

## D-EMU owner confirmation of current state (2026-11-02)

- The owner states that the D-EMU manual test was performed by the owner and PASSED against the current repository state: 2 tests passed, 0 skipped, local Firestore Emulator, no real Firebase used. This is owner-provided manual evidence; Claude did not execute the emulator test.
- This confirmation answers the residual recorded in the TASK-038 closure section (whether the run used the current bytes of the race test and `erasure-write-fence.ts`). The SHA-256 values recorded there are kept for later comparison.
- Not supplied and not invented: the run date, Java version, Firebase CLI version and the vitest summary line.
- TASK-045 (operator and production checks) has NOT been performed and stays open. Nothing in this section counts as a TASK-045 check.

## Deployment decision (owner, 2026-11-02): production deployment HELD

- `PRODUCTION_HANDLERS_READY = true` is KEPT. Meaning: code-level account-erasure readiness has passed.
- TASK-045 is Ready. Meaning: production/operator readiness has NOT passed. TASK-045 is not Done, and the D-EMU PASS does not satisfy it.
- Deployment is HELD: not authorized while TASK-045 is incomplete. Nothing was deployed, and no Firebase configuration, index, TTL, production Auth test, APP_ADMIN_EMAILS change, real Firebase access, commit, push or seed was performed for this decision.
- Current feature state: TASK-001 to TASK-044 Done; TASK-045 Ready; D-EMU PASS (owner-provided manual evidence); no unresolved implementation Blocking or Important findings.
- The operator checklist is the one in `OPERATIONS.md` (rows 1 to 11, sections 1 to 10), reproduced from the approved repository documents. No evidence has been entered or inferred.

## Closeout repairs and aggregate security review (2026-11-02)

Owner decisions applied and independently reviewed:
- **Erasure-only conversation transaction.** The generic `ConversationStore.runTransaction` is removed from the production interface. The erasure path is `runErasureCleanupTransaction(capability, work)`, which rejects any value not minted by an approved module before any read or write. Minters are exactly `conversations-erasure.ts`, `production-erasure-handlers.ts` and `membership-destruction-adapter.ts`. Callers are `conversations-erasure.ts`, `participant-bindings-erasure.ts` and `delete-conversation.ts`. The fake's test-only transaction stays on `FakeConversationStore`. The static guard in `delete-conversation-boundary.test.ts` pins these lists, walks `src/` and `app/`, and rejects a generic transaction member on the production interface.
- **Final-sweep failure (start-erasure error mapping).** A thrown final-sweep error maps to `store_unavailable`, and the start path answers with the fixed `erasure_unavailable` response with no detail. The record stays where the state machine left it. This matches runbook section 8b (operator-resumed).
- **Member-ref backfill (`materialize-member-refs.ts`).** The write set is fenced by each written member's uid in the same transaction. A refusal aborts the whole run with `erasure_in_progress` (403), writes nothing, and never fences the admin. The W-17 inventory lists the file.
- **Malformed invitation e-mail (AE-SI-7).** A usable string e-mail matches by normalization only. A missing, blank, null or non-string e-mail matches only by the exact id `${teamId}__${normalizedEmail}`. A valid different e-mail never matches by suffix. The predicate has its own test file.
- **Documentation.** The team-management lifecycle wording now states the actual sequence (per-round fence check, per-conversation binding transactions, final transaction). The `verification-sweep.ts` header cites the approved BR-17(1) option (a). The capability minting text in SPEC and VERIFICATION names the three approved modules.

Reviews:
- Independent review of the four security repairs: PASS_WITH_SUGGESTIONS. The Important finding (the static guard walked only `src/`) is repaired: the guard now walks `app/` too.
- Fresh aggregate account-erasure security diff review: PASS_WITH_SUGGESTIONS. The Important finding (SPEC and VERIFICATION naming one minter) is repaired. Suggestions left as recorded: the owner-accepted residual of binding clears committed before a fence appears (already stated in the SPEC); the whole-collection `teamInvitations` reads (cost, documented in the module note).

Verification on the current tree (real exit codes):
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0, 0 errors, 1 pre-existing warning (`create-reply.transaction.test.ts:100`). The unused-import warnings introduced by the repairs are removed.
- `pnpm test`: exit 0. Test Files 480 passed, 1 skipped (481). Tests 8868 passed, 2 skipped (8870). The skipped file is the D-EMU race test when no emulator host is set.
- `pnpm build`: exit 0.

D-EMU: the repairs changed neither `src/features/auth/server/erasure-write-fence.ts` nor `src/features/auth/server/erasure-fence.race.emulator.test.ts` (SHA-256 unchanged: 3fd0f3b0…042ed and 702deaf2…9a89, as recorded at closure). The fence transaction semantics the race test exercises are unchanged: `runFencedTransaction` and `assertNoErasureRecordInTransaction` are not modified, and the owner-only transactions keep their fence reads. The owner-provided D-EMU PASS therefore remains valid. No rerun is required.

Task status: TASK-038, TASK-040 and TASK-041 were reopened for these repairs and are closed again on the review and gate results above. TASK-039, TASK-042, TASK-043 and TASK-044 were not affected by the repairs.

## TASK-039 — teamSystems coverage: A-13 (ANONYMIZE) and A-14 (DETACH), 2026-11-05

Owner decision OQ-1 (approved 2026-11-05) from `docs/features/team-system-overview/SPEC.md`. Decision log: SPEC "Decision log: teamSystems erasure coverage".

- Registry: `inventory.ts` holds A-13 and A-14. `inventory.test.ts` expects A-1 to A-14 and passes without a weakened guard.
- Actor audit: five closed targets (`createdBy`, `updatedBy`, `availability|maintainability|security.assessedBy`); nested field nulled, `assessedAt` kept. Tests: `actor-audit-team-systems.test.ts`.
- Membership: A-14 detached in the `memberships` step and in ordinary removal, in the same transaction that deletes the membership. Tests: `membership-erasure-knowledge.test.ts`.
- Sweep: A-13 by field equality (three nested paths summed); A-14 deferred per membership and cleared by the `memberships` step.
- Independent security/privacy review: PASS WITH RISKS (no Critical, High or Medium). Details in `docs/features/team-system-overview/VERIFICATION.md`.
- Gates (2026-11-05): `pnpm test` 9468 passed, 2 skipped; `pnpm typecheck` clean; `pnpm build` exit 0; `pnpm lint` 0 errors.
