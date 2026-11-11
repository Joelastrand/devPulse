# Account erasure (AE)

## Status

Product, privacy and security decisions D1–D9 and the D2 participant-data
exception were approved 2026-10-28. This SPEC is the durable contract for
implementation. **Planned; implementation-ready** (2026-10-28). `TASKS.md`
(owned by `/split-tasks account-erasure`) defines the task graph.

Reconciled 2026-10-28, before implementation (no new product scope):
- D-EMU (updated 2026-10-28): the Firestore-specific transaction race proof is a
  **manual verification gate** against the local Firestore Emulator, performed before
  final closeout. It is not an automated repository test. The repository adds no Java,
  emulator tooling, or emulator dependency for it. Automated tests cover the fence and
  transaction logic with the existing test infrastructure. No real Firebase project is
  used. See Concurrency and fencing.
- `POST /api/me/erasure` start/resume contract is reconciled with BR-2 and the
  Continue section (see "Start/resume contract").
- `roadmapItems.ownerRef` and other `memberRef` values are a distinct identifier kind
  (see "Identifier kinds").
- The stuck state after Auth deletion has an explicit operator procedure (see
  Operational requirement 8b).

Decisions of record:

- **D1 Scope.** Erase the person's DevPulse-controlled personal data *and* their
  Firebase Auth account. A successful erasure leaves no live Auth identity.
- **D2 Team membership.** All of the person's memberships are removed. This is
  not a general self-leave capability.
- **D2 exception (participant data).** Erasure removes the erased person's
  participant data from conversations owned by others, including completed
  ones. This is an explicit override of BR-20 of the development-conversations
  SPEC (see BR-9). It exists only for irreversible erasure.
- **D3 Forum.** Authored content and identity linkage are removed. Threads keep
  a content-free placeholder only when other people's replies need the
  structure. No cascade delete of other people's content.
- **D4 Owned conversations.** Every development conversation owned by the
  person is deleted, including shared goal snapshots and owner notes.
- **D5 Audit fields.** Actor identities on records that must be preserved are
  nulled. Business records are not deleted for that reason.
- **D6 Survey participation.** `surveyParticipations` are deleted, including for
  open authenticated surveys. Anonymous `surveyResponses` are preserved.
- **D7 Confirmation.** Typed confirmation plus a recent-authentication
  requirement. Irreversible. No grace period. No recovery.
- **D8 Execution.** Resumable, bounded-batch workflow with a fence. Not atomic
  across Firestore and Auth. Retry-safe and idempotent.
- **D9 Retention.** No legal hold or retention requirement exists in the
  repository. Platform and infrastructure logs are an explicit operational
  limitation.

## Scope

In scope: the erasure initiation and resume endpoint; the erasure fence in the
centralized token verification seam; erasure of person-linked application data
listed in the inventory; deletion of the Firebase Auth account; neutral
post-erasure presentation for other people; the Firestore rules, index, and
operational requirements that erasure depends on.

Out of scope: see "Explicit non-goals".

## Repository evidence (2026-10-28)

- `src/features/auth/server/verify-identity.ts` calls
  `getAdminAuth().verifyIdToken(token, true)`. `checkRevoked` is **enabled**.
  The verifier also reads `decoded.auth_time` through the token; the
  `VerifiedIdentity` returned to callers does not carry it yet.
- Every protected route calls `verifyIdToken` (46 call sites under `app/api` and
  `src/features/**/server`).
- firebase-admin 14.3.0 (`lib/auth/base-auth.js`): with `checkRevoked`,
  `verifyDecodedJWTNotRevokedOrDisabled` calls `getUser(uid)` on every
  verification. A deleted user therefore fails with `user-not-found`, a disabled
  user with `user-disabled`. Revocation of refresh tokens alone does not stop a
  person from signing in again.
- Sign-in is email and password only (`src/features/auth/client/auth-client.ts`:
  `signInWithEmailAndPassword`). Self sign-up exists
  (`createUserWithEmailAndPassword`). The app never supplies a uid; Firebase
  generates it.
- App-admin status is derived from the verified identity: `isAppAdmin` requires
  `emailVerified` and an active record in the Firestore superadmin registry
  (`superadmins/{uid}`, `src/features/teams/domain/app-admin.ts`). An Auth identity that cannot
  verify therefore cannot be admin. (Amended 2026-11-06: the former `APP_ADMIN_EMAILS` match is no longer read.)
- **Superadmin start rule (2026-11-06).** Starting an erasure for an active superadmin revokes that privilege in the same
  Firestore transaction that creates the erasure fence (`erasure-start-atomic.ts`). A failed fence leaves the privilege in
  place. The last active superadmin is refused with `last_superadmin` (HTTP 409), and no fence is created.
- No account-deletion code, scheduled job, worker, or cron exists in the
  repository. Any erasure must be driven by requests.
- Team invitations resolve on a read path (`get-teams-overview.ts` calls
  `resolveInvitations`). A new sign-up with a matching email can therefore gain
  memberships from a pending invitation.
- `authorTag` is derived at read time from `(teamId, authorUid)` and is not
  persisted (`src/features/forum/domain/author-tag.ts`). No stored record carries
  it.
- The development-conversations index document lives at
  `userDevelopment/{participantUid}/conversationParticipations/{id}` with
  `{ownerUid, invitedAt}`. The participant binding lives on the owner's
  conversation document in plain fields (`participantUid`,
  `participantMemberRef`, `participantState`, `participantInvitedAt`,
  `participantAcceptedAt`) and inside the encrypted payload (`participantNotes`,
  shared goal snapshots, owner content).
- `isValidForumReply` requires a non-empty `deletedBy` on a tombstone
  (`src/features/forum/domain/forum-reply.ts`). The tombstone DTO is
  `{ body: null, authorTag: null, isOwnReply: false, isDeleted: true }`
  (`src/features/forum/client/forum-gateway.ts`).
- The demo tooling (`src/features/demo-team/`) takes `--presenter-uid` and
  creates no Auth users (verified: no `createUser` or `getAdminAuth` usage under
  that directory).
- `firestore.rules` denies all client access to every feature collection.
  `firestore.indexes.json` holds composite indexes only.

## Authentication and token lifecycle (findings)

| Question | Finding (evidence) | Consequence for this SPEC |
|---|---|---|
| Is `checkRevoked` enabled? | Yes (`verify-identity.ts`) | Every verification performs `getUser(uid)`. |
| Does Auth deletion invalidate old ID tokens on all routes? | Yes, for every route that verifies through the seam: `getUser` fails on a deleted user, and verification rejects the token. 46 source files reference `verifyIdToken`. A complete route-by-route audit (confirming no protected route authenticates some other way) is a task requirement. | Auth deletion is an effective, immediate fence **for the seam**. The audit is a verification item, not an accepted gap. |
| Can a stale token keep authenticating after Auth deletion? | No, per the above. | A stale request cannot recreate data once Auth is deleted. |
| Can a person sign in again during a partial erasure? | Yes, while the Auth user exists. | The fence must block everything except erasure resume while the record is in progress. |
| Is Auth deletion safe as the first step? | No. The person can no longer authenticate to resume, and no worker exists. | Auth deletion is the **final** Auth step (BR-6). |
| Are uids ever reused? | The app never chooses a uid. Firebase generates it. Reuse is not expected. | Assumption AE-A1 (below). |
| Does the seam need a centralized fence? | Yes. The seam is the only verifier for protected routes. | Fence check inside `verifyIdToken` (BR-4). |
| Is `auth_time` available? | Yes, in the decoded ID token; not yet exposed in `VerifiedIdentity`. | Additive field (BR-3). |

**Authentication-contract change (classified).** `verifyIdToken` gains:
(a) one read of `accountErasures/{uid}`, and (b) an optional
`verifiedAuthTime` on the returned identity. The change belongs to this
feature because it is the fence. Normal users, with no record, keep unchanged
authorization behaviour. The additional read on every authenticated request
is an intentional, documented cost of the erasure authentication contract.

**Assumption AE-A1 (uid non-reuse).** Firebase does not reuse a deleted user's
uid, and the application cannot choose one. Operations must verify this
property during deployment review (see Operational requirements).

## Glossary

- **Person / erased person**: the Firebase Auth user whose uid is erased.
- **Owner**: the person who owns a development conversation.
- **Participant**: the person a conversation owner invited, located through the
  conversation document's participant fields.
- **Fence**: the `accountErasures/{uid}` record, read by `verifyIdToken` and by
  every person-owned write transaction.
- **Erased-actor marker**: the constant `"erased"`, used only where a validator
  requires a non-empty string (forum tombstone `deletedBy`).

## Stable security and privacy invariants

Numbered `AE-SI-n` and cross-referenced from `docs/SECURITY.md` once this SPEC
is implemented.

- **AE-SI-1 Self-only initiation.** Only the verified person, for their own uid,
  can start or resume an erasure. No admin, lead, team member, operator-facing
  route, or other user can initiate it for someone else.
- **AE-SI-2 No cross-person exposure.** Erasure responses, errors, and status
  never contain another person's data, uid, email, or membership identifier.
- **AE-SI-3 Fence.** While a record exists for a uid, no person-owned data is
  created or mutated for that uid, and no protected route accepts the uid's
  requests except the erasure endpoint.
- **AE-SI-4 Ordering.** Auth deletion is the last step that depends on the
  person's authentication. No state exists in which Auth is deleted while
  person-owned data is still reachable through a route.
- **AE-SI-5 Residual record.** The only record that may still carry the uid is
  the fence record. It holds the uid as its document id, a status, a step, timestamps,
  an `expireAt`, and an error code from a fixed enum. It holds no email, team,
  memberRef, content, or free text.
- **AE-SI-6 Content removal.** Erased authored content (forum title and body and
  ciphertext, reply content, `participantNotes`, the person's owned conversations
  including owner notes and next steps) is removed, not retained in plain or
  encrypted form.
- **AE-SI-7 No retained linkage.** After completion no stored record contains the
  erased uid, email, `participantUid`, `authorUid`, or `memberRef` for that person,
  except the transient fence record (AE-SI-5). Nulled actor fields are nulled, not
  replaced with anything derived from the uid.
- **AE-SI-8 Anonymity preserved.** Erasure does not join, infer, or delete
  anonymous `surveyResponses` or challenge content. It does not make an
  anonymous record easier to correlate with a person. Erasing forum authorship
  does not reveal or preserve a former `authorTag`.
- **AE-SI-9 No collateral deletion.** Erasure never deletes another person's
  authored content, owner-authored content in another person's conversation,
  team, survey, challenge, skill tree, or role definition merely because the
  erased person acted on or participated in it.
- **AE-SI-10 Recent authentication.** Starting an erasure requires a verified
  token whose `auth_time` is within the window (BR-3). Possession of an older
  bearer token is not sufficient.
- **AE-SI-11 Irreversible.** No undo, recovery, grace period, or restore exists.
- **AE-SI-12 No content logging.** Erasure logs only status, step, and error code.
  It never logs uid, email, content, ciphertext, or payloads in application logs.
- **AE-SI-13 Demo isolation.** Demo tooling never creates, recreates, or writes
  person-owned data for a uid that has an erasure record or no current Auth user.

## Erasure inventory

Classification key: **DELETE**, **ANONYMIZE** (identity nulled, record kept),
**DETACH** (identity link removed, record kept), **PRESERVE** (no person
linkage), **EXTERNAL** (outside the product-controlled stores).

Every row is the authoritative inventory. The implementation must derive the
verification sweep (BR-5, BR-17) from a single registry module, so the list
cannot drift from the code.

### Person-owned stores

| # | Source (collection / path) | Personal linkage | Class | Evidence / note |
|---|---|---|---|---|
| I-1 | `skillProfiles/{uid}` | self-assessment levels | DELETE | Document id is the uid. |
| I-2 | `userProfiles/{uid}` | display name | DELETE | Document id is the uid. |
| I-3 | `userDevelopment/{uid}/goals/*` | owner goals | DELETE | Owner subtree; paged. |
| I-4 | `userDevelopment/{uid}/roleTarget/current` | role target | DELETE | Owner subtree. |
| I-5 | `userDevelopment/{uid}/conversations/*` (owned) | owner content, participant binding, shared snapshots | DELETE | D4. Cascade to the participant index (I-7) and to the binding is performed by the existing owner-delete semantics, with participants losing the conversation. |
| I-6 | `userDevelopment/{uid}/conversationParticipations/*` | participant locator `{ownerUid, invitedAt}` | DELETE | Own subtree. Discovery of bindings uses I-8, not this index. |
| I-7 | Participant binding in others' owned conversations: plain fields `participantUid`, `participantMemberRef`, `participantState`, `participantInvitedAt`, `participantAcceptedAt`, and encrypted `participantNotes` | participant identity and notes | DETACH + DELETE (content) | D2 exception (BR-9). Owner content is kept. |
| I-8 | Discovery of I-7 through a collection-group query on `conversations` with `participantUid == uid` | discovery only | — | Requires index AE-IDX-1. |
| I-9 | `teamMemberships/{uid}__{teamId}` (found by document-id prefix `uid__` and by `uid` field) | membership, `role: lead`, `memberRef`, `skillContribution` consent | DELETE | D2. The membership carries every field listed. |
| I-10 | `teamAccessRequests/{uid}__{teamId}` | pending or resolved request | DELETE | Found by document-id prefix and `uid` field. |
| I-11 | `teamInvitations/*` where `email` equals the normalized erased email, or `resolvedUid` equals the uid | invited email, resolved uid | DELETE | See Invitations and email. |
| I-12 | `surveyParticipations/{uid}__{surveyId}` | `{uid, surveyId}` linkage | DELETE | D6. Found by document-id prefix and `uid` field. |
| I-13 | `forumThreads` where `authorUid == uid` | title, body, ciphertext, `authorUid` | DELETE, or ANONYMIZE to placeholder | D3 and BR-7. |
| I-14 | `forumReplies` where `authorUid == uid` | content, `authorUid` | ANONYMIZE to tombstone | D3 and BR-7. |
| I-15 | `accountErasures/{uid}` | fence state | transient; see AE-SI-5 | Created by BR-2; expires by TTL (BR-6). |

### Actor and audit identities on preserved records (D5)

Each row is one field that can hold a uid. Setting it to null (or the erased-actor
marker for the forum tombstone) is the only change to the record.

| # | Collection | Field | Class | Note |
|---|---|---|---|---|
| A-1 | `surveys` | `createdBy` | ANONYMIZE | Survey preserved. |
| A-2 | `skillTrees` | `createdBy`, `updatedBy` | ANONYMIZE | Admin-defined catalogue preserved. |
| A-3 | `roleDefinitions` | `createdBy`, `updatedBy`, `archivedBy` | ANONYMIZE | Role catalogue preserved. |
| A-4 | `roadmapItems` | `createdBy`, `updatedBy`, `archivedBy` | ANONYMIZE | Team plans preserved. |
| A-5 | `roadmapItems` | `ownerRef` (a membership `memberRef`) | DETACH | Null when it matches an erased membership (BR-10). |
| A-6 | `skillProgress` | `updatedBy` | ANONYMIZE | Team tracking preserved. |
| A-7 | `challenges` | `resolvedBy`, `archivedBy` | ANONYMIZE | Challenge content is anonymous and preserved (AE-SI-8). |
| A-8 | `forumReplies` (other people's tombstones) | `deletedBy` | ANONYMIZE | Erased-actor marker (not a uid). |
| A-9 | `teamAccessRequests` (others) | `resolvedBy` | ANONYMIZE | |
| A-10 | `teamInvitations` (others) | `invitedBy` | ANONYMIZE | Invitation preserved for other emails. |
| A-11 | `teamMemberships` (others) | `grantedBy`, `roleUpdatedBy` | ANONYMIZE | Other members' memberships preserved. |
| A-12 | `teams` | `createdBy` | ANONYMIZE | Team preserved. |
| A-13 | `teamSystems` | `createdBy`, `updatedBy`, `assessedBy` (`assessedBy` inside each of `availability`, `maintainability`, `security`) | ANONYMIZE | System preserved; the assessment value, note and `assessedAt` are kept; only the actor is nulled (OQ-1 approved 2026-11-05). |
| A-14 | `teamSystems` | `knowledgeMemberRefs` (membership `memberRef` values) | DETACH | The erased membership's ref is removed from the array; other members and the system record are kept (OQ-1 approved 2026-11-05). Membership-instance row; see the decision log below. |
| A-15 | `teamProjectParticipations` | `memberRef` (membership `memberRef` value) | DELETE | The participation record is deleted, because a planning interval has no meaning once its member ref is destroyed. Membership-instance row, processed in the `memberships` step before the membership delete, scoped to the membership's team. Owner decision 2026-11-06 (TASK-004); see the decision log below. |

Identifier kinds (reconciled 2026-10-28). Each row is one of two kinds:

- **uid-kind**: holds the Firebase uid. Verified by `where(field, '==', uid)` on the
  collection. Every uid-kind row is a single-field equality query. No composite index is
  expected (verify in task; see AE-IDX-2).
- **memberRef-kind**: holds the opaque, team-scoped `memberRef` generated for a
  membership (`generateMemberRef`). It is never derived from a uid and is never
  queried by uid. This applies to A-5 `roadmapItems.ownerRef`, A-14
  `teamSystems.knowledgeMemberRefs` (array elements), I-7 `participantMemberRef`, and I-9
  `memberRef`.

A-5 is handled in the `memberships` step, per membership, while that membership's
`memberRef` still exists (BR-10). Preserved roadmap behaviour applies: an `ownerRef`
whose membership no longer resolves is unavailable or null. No uid is written into
`roadmapItems`.

### Derived, DTO-only, and non-persisted values

These are not stored, so they are not erased. They disappear with their sources.

- `authorTag` (forum DTO): derived from `(teamId, authorUid)`. Removing
  `authorUid` from I-13 and I-14 removes the only input. No stored record holds a
  tag. Existing reader-side derivation is unchanged.
- `memberRef` in DTOs (roster and conversation participant views): read from the
  membership, which is deleted (I-9).
- `isSelf`, `isOwnThread`, `isOwnReply`, `viewer.*`: computed per request.
- Team skill coverage, survey aggregates, organisation overviews: recomputed.
  Coverage may change when a contributor leaves; this is expected.
- Admin member-email lookups from Firebase Auth: not stored.

### Preserved records (no person linkage, or anonymous)

| # | Collection | Why it does not contradict the erasure promise |
|---|---|---|
| P-1 | `surveyResponses` | Anonymous, encrypted, with no identity field (BR-18 of managed-surveys). Not joined to a person (AE-SI-8). |
| P-2 | `challenges` (content) | Anonymous, encrypted; no submitter field exists. Only the actor fields in A-7 change. |
| P-3 | `teamSurveyState`, `surveys` (non-actor fields), `teams` (non-actor fields) | No person linkage. |
| P-4 | `skillTrees`, `roleDefinitions`, `roadmapItems` (non-actor fields), `skillProgress` (non-actor fields), `teamSkillNeeds` | Team or catalogue data with no person linkage after A-rows are nulled. |
| P-5 | Other people's forum threads and replies | Their own content and `authorTag`; they are not the erased person's content. |
| P-6 | Other people's owned conversations | Owner content is owner-owned (AE-SI-9); the erased person's participant data is removed (I-7). |

### External (outside product-controlled stores)

| # | Source | Class | Why it does not contradict the promise |
|---|---|---|---|
| E-1 | Hosting, Firebase, and platform logs that may contain uid or email | EXTERNAL | Not controlled by this repository. Not claimed as erased. Operational limitation (see Platform logs). |
| E-2 | Provider backups and retention of Firestore and Auth | EXTERNAL | Governed by the provider. Not claimed as erased. Operational limitation. |
| E-3 | Browser state of the erased person's client | EXTERNAL | The client signs out on completion (BR-18). Local caches are not claimed as erased. |
| E-4 | Superadmin registry verification after erasure (`superadmins/{uid}`, control count) | EXTERNAL | Operator read-only check. See OPERATIONS.md section 1. |

## Actor × operation matrix

Outcomes: **allow**, **deny** (with error code), **n/a**.

| Actor \ Operation | Start erasure (`POST /api/me/erasure`, no record) | Resume erasure (same endpoint, record in progress) | Any other protected route for the erased uid | Read team data (others) | Write person-owned data | Admin actions on the erased person |
|---|---|---|---|---|---|---|
| Erased person, no record | allow (BR-2, BR-3) | n/a | allow | allow for own team scope | allow | n/a |
| Erased person, record in progress | allow: same endpoint resumes and returns the current state (BR-2, Continue section) | allow (BR-4) | deny `erasure_in_progress` (BR-4) | n/a | deny | n/a |
| Erased person, record auth_deleted or completed | n/a (no valid token: Auth gone) | n/a | deny `invalid_token` (verification fails) | n/a | deny | n/a |
| Another team member / participant | n/a | n/a | allow, except references to the erased person are removed or neutral | allow (degraded only during progress, BR-16) | allow for own data | n/a |
| Team lead | n/a | n/a | allow | allow | allow for own data | n/a |
| App admin (not the erased person) | n/a | n/a | allow | allow | allow | Admin may still perform admin actions unrelated to the erased person. |
| App admin who is the erased person | Same as "Erased person" | Same | Same | Same | Same | Admin status ends when the Auth identity ends. |
| Unauthenticated | deny | deny | deny | deny | deny | deny |
| Operator (out of band) | n/a | n/a | n/a | n/a | n/a | Procedure in Operational requirements only; no product route. |

No actor other than the erased person can start or resume an erasure. No admin
route can erase another person.

**Start/resume contract (reconciled 2026-10-28; authoritative for `POST /api/me/erasure`).**
The endpoint is one start-or-resume operation:

1. No record: start, subject to recent authentication (BR-3) and the typed
   confirmation (BR-2).
2. `in_progress`: resume from the stored step and return the current state. No fresh
   sign-in and no confirmation is required.
3. `completed`: do not start another erasure. The operation returns `{ status: "completed" }`
   (idempotent, operation level). Over HTTP the centralized fence refuses a terminal record
   first as `invalid_token` (401), so the route may not reach this result (decision log,
   TASK-013).
4. Malformed or unreadable record: fail closed. Never start over and never
   reinterpret the record.

`erasure_in_progress` is the fence response for every other protected operation for
the uid. The endpoint never returns it for its own start or resume. The fence bypass
(`allowDuringErasure`) is granted only to this endpoint's in-progress path. No generic
caller-controlled bypass exists.

**Auth and fence infrastructure failure (D-AUTHFAIL, approved 2026-10-28, option b).**
Two outcomes are kept distinct:

- Genuine rejection (missing, invalid, revoked, disabled, or otherwise rejected token;
  record `auth_deleted` or `completed`) stays on the existing unauthenticated path
  (`invalid_token`, HTTP 401 as appropriate).
- Temporary inability to establish authentication or fence state, because the required
  Auth verification or fence-record read is unavailable, fails closed with the server-side
  result `auth_unavailable` and HTTP 503. It is never reported as `invalid_token`.
  Protected data access is never permitted on `auth_unavailable`, and it is not an
  erasure-fence bypass. Protected handlers map it to 503 explicitly, not through their
  default 401/500 handling. Public survey routes keep their intentionally unauthenticated
  behaviour.

## Erasure state machine

Persistent record `accountErasures/{uid}` (server-only, see BR-4 and BR-6):

```
{
  status: "in_progress" | "auth_deleted" | "completed",
  step: <step id from the table below>,
  startedAt: Timestamp,
  updatedAt: Timestamp,
  completedAt?: Timestamp,      // set on completed
  expireAt?: Timestamp,         // set on completed, TTL field
  errorCode?: <enum>,           // last failure code only
}
```

No email, team identifier, membership identifier, content, count, or free text is stored.

### Steps (in this order)

| Step id | Work (bounded, idempotent) | Consistency rule |
|---|---|---|
| `forum` | I-13 then I-14 (see BR-7). | Each reply is handled in one transaction. A thread is processed in bounded transactional chunks (see the decision log under "Forum tombstone semantics"). |
| `memberships` | For each I-9 membership (page by document-id prefix and by `uid` field): null A-5 `ownerRef` values that match its `memberRef` in that team; remove that `memberRef` from A-14 `knowledgeMemberRefs` arrays in that team (system kept); then delete the membership. Then I-10 and I-11 (invitations by email and by `resolvedUid`). | `ownerRef` nulling precedes deletion, so the `memberRef` is still available. |
| `conversations_owned` | I-5 owned conversations, including their participant index at `participantUid` (existing BR-29 semantics). | One transaction per conversation. |
| `participant_bindings` | I-8 discovery, then I-7 (BR-9): clear participant fields, re-encrypt the payload without `participantNotes`, and delete the matching I-6 index. | One transaction per owner document. |
| `locators` | I-6 (own subtree). | |
| `personal_data` | I-1, I-2, I-3, I-4. | |
| `survey_participations` | I-12. | |
| `actor_audit` | A-1 to A-13 (single-field equality queries; A-13 `assessedBy` is three nested paths). | Null only the actor field, never the record. |
| `verify_data` | Re-run every inventory query (BR-5). Any remaining match causes the appropriate idempotent cleanup for that row to be re-run while the persisted step stays `verify_data` (D-VERIFY-BACK, approved option a). The sweep is bounded per run and resumes on later runner iterations or requests. | Must observe zero matches for the uid before the step advances. |
| `auth_delete` | Delete the Firebase Auth user. `user-not-found` counts as success (retry-safe). | BR-6. |
| `final_sweep` | Re-run the inventory queries once more after Auth deletion. Any match is an operator-visible failure (see Partial failure). | Set record `status: "completed"` with `expireAt`. |

### Transitions

- `(none) → in_progress/forum` on a successful start (BR-2).
- `in_progress/<step> → in_progress/<next step>` after a step's last bounded
  batch completes. The step field advances only after the step's verification query
  returns zero.
- `in_progress/auth_delete → auth_deleted` after the Auth user is deleted
  (or confirmed absent).
- `auth_deleted → completed` after `final_sweep` finds zero matches.
- Any state → `in_progress/<step>` is never reversed. The record is never removed
  by product logic while in progress.
- **Verification keeps the step forward-only (D-VERIFY-BACK, approved option a).** No
  backward step transition exists. When `verify_data` finds residual matches, the
  persisted step stays `verify_data`, the runner re-runs the appropriate idempotent
  cleanup for those rows, and the step advances to `auth_delete` only when the sweep
  finds zero matches covered by the erasure inventory.

## Erasure workflow, authentication ordering and fencing (BR-4 to BR-6)

**Start (BR-2).** `POST /api/me/erasure` with body `{ confirmation: string }`
(the exact account email, normalized). The server verifies the token (with
`checkRevoked`), requires the recent-auth window (BR-3), compares the normalized
confirmation with the verified email, and creates `accountErasures/{uid}` in one
transaction. If the record already exists, the call returns the current state and
does not create a second record.

**Continue (same endpoint).** While `in_progress`, the same endpoint continues
from the stored step. It does not require a fresh sign-in (see BR-3, "Resume is not
re-authorization").

**Bounded work per request.** A request processes at most 10 Firestore batches
of at most 100 writes each, and stops after 20 seconds of wall time, whichever comes
first. It then returns `{ status: "in_progress", step }`. The client calls the same
endpoint again until `completed`. Limits are constants in the erasure module and are
verified against the deployment timeout (see Operational requirements).

**Auth deletion (BR-6).** Auth deletion is performed only in step `auth_delete`,
after `verify_data` returns zero. This ordering is required because:

1. the person must still be able to authenticate to resume every data step;
2. deleting Auth first would leave data erasable only by an operator.

After `auth_delete`, the verifier rejects the uid's tokens (`getUser` fails), so
no new request can run for the uid. The `final_sweep` then removes any residue from
in-flight requests (BR-4).

## Concurrency and fencing (BR-4)

**Enforcement seam.** `verifyIdToken` (`src/features/auth/server/verify-identity.ts`)
is the one verifier for every protected route. The fence lives in the same module
(`src/features/auth/server/erasure-fence.ts`), so auth does not depend on
account-erasure, and account-erasure depends on auth. The seam:

1. verifies the token with `checkRevoked: true` (unchanged);
2. reads `accountErasures/{uid}`;
3. if a record exists in `in_progress`, rejects the request with
   `erasure_in_progress`, except for the erasure endpoint, which is allowed by an
   explicit option (`allowDuringErasure`);
4. if a record exists in `auth_deleted` or `completed`, rejects the request
   (`invalid_token`, as verification fails once Auth is gone; the record check is
   defence in depth).

**Writes.** Verification alone does not close a race: a request that verified
before the record existed can still be writing. Therefore every person-owned write
must read `accountErasures/{uid}` inside the same Firestore transaction as the write,
and refuse with `erasure_in_progress` if the record exists. Firestore transactions track
reads of documents that do not exist, so a transaction that read "no record" fails to
commit if the record is created before it commits. This is Firestore transaction
semantics. Verification has two parts, kept separate:
(1) automated repository tests prove the fence read is inside each transaction and that a
refused write does not mutate state, using the existing test infrastructure;
(2) a manual Firestore Emulator run, performed against the local emulator only, proves the
commit-ordering race. Its result must be recorded before final closeout (see Operational
requirements, item 11). Writes that are not transactional must be converted before they can be fenced (BR-4(b)).

**Write-surface enumeration.** Every server write surface that creates or mutates
person-owned data, or stamps the actor uid, must consult the fence. Verification
status is recorded for each; "not yet verified" items are a task requirement, not a
claim.

| # | Surface | Writes | Status |
|---|---|---|---|
| W-1 | `PUT/DELETE /api/me/profile` (`set-own-profile`, `delete-own-profile`) | `userProfiles` | Transactional (`user-profile-store.ts` `runTransaction` for set; delete is a plain `delete()` at `user-profile-store.ts:65`: convert). |
| W-2 | `PUT/DELETE /api/me/skills/[treeId]` | `skillProfiles` | Transactional (`skill-profile-store.ts` `runTransaction`). |
| W-3 | `DELETE /api/me/skills` (`delete-own-skill-profile`) | `skillProfiles` | Plain `delete()` at `skill-profile-store.ts:85`: convert. |
| W-4 | `PUT/DELETE /api/me/role-target` | `userDevelopment/*/roleTarget` | Transactional for set (`role-target-store.ts:44`); clear: verify. |
| W-5 | `POST/PATCH/DELETE /api/me/goals*` | `userDevelopment/*/goals` | Update transactional (`goal-store.ts:110`); create and delete: verify. |
| W-6 | `POST /api/me/conversations`, `PATCH /api/me/conversations/[id]`, `DELETE`, complete, invite, change participant, shared goals, participant notes (`PUT`), participation accept | `userDevelopment/*/conversations`, `conversationParticipations` | Section and snapshot writes are transactional per the development-conversations SPEC (TASKS notes); **verify each route**. |
| W-7 | `POST /api/teams/[teamId]/forum/threads` (`create-thread.ts`) | `forumThreads` | Verify (uses a collection `add`; convert if plain). |
| W-8 | `POST /api/teams/[teamId]/forum/threads/[threadId]/replies` (`create-reply.ts:33`) | `forumReplies` | **Non-transactional**: `collection.add(record)` at `create-reply.ts:33`, membership read outside it. Convert. |
| W-9 | `DELETE` thread and reply | `forumThreads`, `forumReplies` | Verify. |
| W-10 | `PUT/DELETE /api/teams/[teamId]/skill-contribution` | `teamMemberships.skillContribution` | Transactional (`skill-contribution-store.ts:48-65`). |
| W-11 | `POST /api/teams/[teamId]/access-requests` | `teamAccessRequests` | Verify. |
| W-12 | `POST /api/teams/[teamId]/challenges` (anonymous) | `challenges` | Verify. Fenced even though anonymous, so no new content is created during erasure. |
| W-13 | Survey response submission (`submit-survey-response.ts`) | `surveyResponses`, `surveyParticipations` | Verify; the participation and response must be one transaction (existing behaviour); add the fence read. |
| W-14 | Roadmap writes by a lead (`create-roadmap-item`, `update-roadmap-item`) | `roadmapItems` (actor stamps) | Transactional (`create-roadmap-item.ts`, `update-roadmap-item.ts`). |
| W-15 | Team skill progress writes (`report-team-skill-progress.ts`, `update-team-skill-progress.ts`, `start-`/`stop-team-skill-tracking.ts`) | `skillProgress` (actor stamps) | Mixed: `report-team-skill-progress.ts:80` and `update-team-skill-progress.ts:37` use `.update` outside a transaction; convert. |
| W-16 | Invitation resolution on read (`resolve-invitations.ts`, via `get-teams-overview.ts`) | `teamMemberships`, `teamInvitations` | Verify; it runs only after `verifyIdToken`, but its writes must read the fence. |
| W-17 | Admin writes that stamp the admin's uid (surveys, skill trees, role definitions, roadmap, team management) | various | Stamps are performed by an admin who is verified through the seam, so the fence applies to an erased admin. Verify each write transaction. |
| W-18 | Demo tooling (`src/features/demo-team/`) | many | Not an HTTP write. Refuses a `--presenter-uid` that has a record or no current Auth user (BR-20). |

The enumeration is the complete list of routes and stores found by repository
search. "Verify" means the task must read the code path and either confirm the
transaction includes a fence read or convert it. A write that cannot be converted
is a blocking finding for that task, not an accepted gap.

## Reads denied or degraded

- While `in_progress`, every protected route for the erased uid is denied
  (`erasure_in_progress`), except the erasure endpoint. Reads that come only from the
  person's own data are denied with the same error.
- Other people's reads of team data continue. During progress they may still show
  the erased person's authored forum content or display name until their step
  completes. This is a transitional degradation, not a new exposure, and it ends
  when `completed` is reached (BR-16).
- After `completed`, the uid cannot authenticate, so no read by the erased person
  exists.

## Confirmation and recent-authentication semantics (BR-2, BR-3)

**Recent authentication.** The server reads the token's `auth_time` (through
`VerifiedIdentity.verifiedAuthTime`, additive, optional for other callers) and
requires `now - auth_time <= 300 seconds`. Starting an erasure fails with
`recent_auth_required` otherwise. The window is a chosen parameter of this SPEC.

**Mechanism.** The client's confirmation step re-enters the account password and
calls `signInWithEmailAndPassword` immediately before `POST /api/me/erasure`. A new
sign-in produces a token with a fresh `auth_time`. Refreshing an existing token does
not change `auth_time` (Firebase semantics; verified in deployment review, see
Operational requirements). Possession of an old bearer token is therefore not
sufficient.

**Resume is not re-authorization.** Continuing an erasure already in progress
requires a valid, non-revoked token but not a fresh sign-in. The erasure was
authorized at start, and its only effect is deletion, so a stale token cannot create
or expand the effect. This keeps the UI loop usable after the 5-minute window.

**Typed confirmation.** The person types the account email. The server compares the
normalized input with the verified email and returns `confirmation_mismatch` on
difference.

**Consequences shown before confirmation (BR-2).** The UI states, in plain terms:

- all DevPulse personal data will be deleted (skill levels, goals, role target,
  profile name, self-assessment, survey participation records);
- team memberships will be removed, including any lead role;
- development conversations the person owns will be deleted, and participants lose
  them. Participants are not notified;
- forum posts and replies by the person will be removed; forum threads will be
  shown as erased where other people replied;
- the Firebase sign-in account will be deleted;
- the action cannot be undone and has no grace period.

Exact copy is owned by the UI copy module and is reviewed against the product copy
rules (`docs/UI-UX.md`).

### Decision log: TASK-013 start/resume contract (approved 2026-10-29)

- **Operation semantics (unchanged).** No record: start, after recent authentication and a matching confirmation. `in_progress` (including a resumable failed step): resume, with no fresh sign-in and no confirmation. `completed`: return `{status: "completed"}` and never restart. `auth_deleted` or a malformed record: fail closed. Only the exact approved operation can create a record.
- **Terminal result is operation-level only.** `{status: "completed"}` is the idempotent result of the operation. It does not imply that the HTTP route is reachable after completion. The fence treats a terminal record as `invalid_token` before the operation runs, and that is intentional. The fence is not weakened, and there is no terminal bypass of `allowDuringErasure`.
- **Production-not-ready refusal (temporary; superseded 2026-11-02).** While `PRODUCTION_HANDLERS_READY` is `false`, the endpoint refuses with HTTP 503 `erasure_unavailable` before any record is created, before any fence is active, and before any runner step. A user who calls the endpoint early is not stranded. TASK-038 sets the flag to `true` in the same change that wires the full handler chain, and must verify that the flag is `true` only when that chain exists. The flag is `true` in the reviewed state (owner decision 2026-11-02, VERIFICATION.md "TASK-038 closure"). Deployment is held until TASK-045 is recorded; the flag does not authorize deployment.
- **Failed execution contract.** A resumable operational failure (a failed or interrupted step, an unclassified runner error, or a store error during a step) returns HTTP 503 `erasure_unavailable`. It means that erasure did not complete, that the state remains resumable where the state machine permits, and that retrying the same endpoint may resume later. It is not a client validation error. The persisted minimal `errorCode` stays internal and is never exposed. The public code is added to the closed API vocabulary.
- **Other HTTP statuses.** `recent_auth_required` is 403. `confirmation_mismatch` is 400. A malformed body is 400 `invalid_request`. The shared auth refusals keep their statuses (401, 403 `erasure_in_progress`, 503 `auth_unavailable`).
- **Fence bypass allow-list.** `allowDuringErasure` is passed only by `src/features/account-erasure/server/start-erasure.ts`, which is the start/resume operation for this endpoint, and only as the literal `true`. No ordinary protected route may pass it. The guard test enforces this.

### Decision log: TASK-017 nullable inviter (approved 2026-10-29)

- A preserved `teamInvitations` record whose inviter was erased keeps its business data and has `invitedBy: null` (A-10). It is not deleted merely because the inviter was erased.
- `invitedBy: null` is a valid post-erasure state. Any other missing, empty, or non-string inviter value remains malformed and is rejected.
- The null grants and removes no authorization. Visibility is unchanged: the admin list is still app-admin only, and a pending invitation still resolves by its pending status and email.
- Admin presentation carries no inviter identity: the list DTO has `invitedBy: null`, and the admin UI never rendered the inviter. No erased-user marker, `deletedBy`, or other attribution is added.
- The erasure step matches an invitation by its stored normalized email, by a document id ending in `__${normalizedEmail}` (I-11), and by `resolvedUid`. The normalized email is not stored as a new field. A historical email that the person no longer uses cannot be linked and is a documented limitation.
- Membership audit: a membership granted from a preserved invitation whose inviter was erased records `grantedBy: null`, consistent with A-11.
- The earlier TASK-017 sentence that the invitation read path stays unchanged is superseded narrowly by the TASKS.md dated amendment. The historical text stays as written.

## Forum tombstone semantics (BR-7, D3)

### Decision log: TASK-009 survey paths (approved 2026-10-28)

Authenticated survey operations and public anonymous submission are different authorization surfaces, so they follow different fence rules.

- **Authenticated survey resolve (`GET /api/surveys/{surveyId}` with a token for an authenticated survey).** The fence keeps its centralized semantics. A genuine missing, invalid, revoked, or disabled token keeps the existing `sign_in_required` (D-AUTHFAIL). `erasure_in_progress` returns 403. `auth_unavailable` returns 503. A successful verification follows the existing resolve behavior. The two fence outcomes never collapse into `sign_in_required`. This is not an exception to D-AUTHFAIL.
- **Public anonymous survey submission.** A genuinely public submission stays available anonymously. A request that carries a token of a fenced uid is accepted exactly as the same request without a token. The token is verified only to establish identity, and a fenced or unavailable result yields no identity. The exception is valid only because the public path requires no identity, stores no uid or other authenticated identity, grants no extra authorization from the token, and performs no person-owned write on behalf of the uid. Regression coverage: `submit-survey-response.test.ts` ("accepts a public submission carrying a token whose erasure is in progress…" and "…when the fence record cannot be read…").
- **Replaced statement.** The earlier statement "the fence blocks new survey submissions for the uid" is superseded by the following semantics. Authenticated and non-public survey operations remain subject to the erasure fence. Public anonymous survey submission may continue anonymously. A supplied fenced token must not be used to attach identity or grant extra rights.

### Decision log: chunked forum erasure (approved 2026-10-28)

The earlier wording "each thread or reply is handled in one transaction" is superseded for threads. Approved semantics:

- Forum thread erasure may process an unbounded thread in bounded transactional chunks, because a Firestore transaction is limited to 500 writes and replies are capped at 500.
- Each chunk preserves its invariants atomically in its own transaction. Each chunk's fence and state checks are read inside that chunk's transaction (BR-4(b)); chunking does not weaken write atomicity for any single mutation.
- Retries re-check the invariant from current data and are idempotent. The process is resumable from persisted state.
- Other people's reply content is preserved. Replies authored by the erased person lose authored content and identity. Tombstones do not retain `authorUid`. `authorTag` remains derived, so it disappears when `authorUid` is gone.
- The erased-thread placeholder semantics (BR-7) are unchanged.
- No whole-thread single-transaction requirement remains.

### Replies authored by the erased person (I-14)

- The reply is converted to the existing tombstone shape: `teamId`, `threadId`,
  `createdAt`, `deletedAt` (erasure time), `deletedBy: "erased"`. No `ciphertext`,
  `iv`, `authTag`, `keyVersion`, or `authorUid`.
- `deletedBy: "erased"` is the erased-actor marker. It is not a uid and the DTO never
  exposes it. This keeps `isValidForumReply` unchanged (it requires a non-empty
  string).
- Reader DTO is the existing tombstone DTO: `{ body: null, authorTag: null,
  isOwnReply: false, isDeleted: true }`, rendered at the reply's position.

### Threads authored by the erased person (I-13)

Decision rule, applied in the `forum` step, per thread:

1. Count replies in the thread that are not tombstones and not authored by the erased
   person.
2. If the count is zero, the thread and its own tombstone replies are physically
   deleted. (Physical deletion is allowed because the observable invariant holds;
   no other person's content is removed.)
3. If the count is at least one, the thread becomes an **erased-thread placeholder**
   (a new shape). Its title, body, ciphertext, `authorUid`, and any `authorTag` are
   removed. Its `teamId`, `threadId`, and `createdAt` remain, so the replies by others
   keep their position.

**Decision (approved 2026-10-28): tombstone ownership after identity removal.** Once
identity is removed, a tombstone has no owner for this rule. Its `deletedBy` marker is not
an author link and is not an attribution field. Step 2 therefore deletes the whole thread,
including tombstones of any member, when no other member has active content. Step 3 keeps
the placeholder when another member has active content. No `deletedBy`, historical
`authorUid`, or other attribution is added to tombstones to tell them apart. The rule never
deletes another member's active content.

**Erased-thread placeholder shape (stored).** `{ teamId, createdAt, erasedAt, status:
"erased" }`. The shape is a new forum contract, approved in principle by D3. It is
validated by a new `isErasedForumThread` predicate that is distinct from active
threads. Only the erasure step may create it.

**Reader DTO for the placeholder.** `{ threadId, status: "erased", createdAt,
replies: [...] }`. It has no `title`, `body`, `authorTag`, `isOwnThread`, or author
identity. Replies by others keep their own DTO, including their `authorTag`, which is
derived from their authorship and not from the erased uid.

**Operations on a placeholder.** Creating a reply returns not-found (`thread_not_found`
or the existing equivalent). Deleting a reply by its own author is allowed. Deleting
the placeholder thread is an app-admin action (existing `delete-thread` rule for
admins). The thread's own author no longer exists.

**Why no authorUid is retained.** No hidden retained `authorUid` is kept to support
the tombstone. The placeholder and tombstones are sufficient without it.

**authorTag.** `authorTag` is derived at read time from `(teamId, authorUid)`
(`author-tag.ts`) and never stored. Removing `authorUid` from I-13 and I-14 removes
every input from which the erased person's tag can be derived by the application.
After erasure, no record exists from which the erased person's tag can be recomputed,
because `authorUid` is gone. An app admin who knows the uid can still compute the
tag for any uid, but there is no remaining record to match it against.

**Pre-existing item (not blocking, not in scope).** The unkeyed derivation of
`authorTag` means an app admin, who can read `teamMemberships`, can compute any
member's tag and correlate that member's posts while they exist. This predates
erasure. Erasure satisfies its invariant without changing it. A broader forum-identity
policy decision (for example, a keyed derivation or a per-team secret) is required to
change it, and it is out of scope here.

## Conversation consequences (BR-8, BR-9, D4, D2 exception)

### Owned conversations (I-5)

Deleted with the owner document, including owner notes, next steps, participant notes
inside the payload, and shared goal snapshots. The participant index at the
participant's uid is removed by the existing owner-delete semantics (BR-29 of the
development-conversations SPEC). A participant who previously accepted loses access.
No notification (D4).

### Participant bindings in others' conversations (I-7, D2 exception)

This is an **explicit, erasure-specific override** of the development-conversations
SPEC's completed-conversation immutability (BR-20: participant notes are frozen once
the conversation is completed). The override exists only for irreversible erasure.
It creates no general edit or delete capability for completed participant notes.
Maintainers must not read BR-20 as preventing account erasure (see Cross-feature
compatibility).

For each conversation found by I-8, in one owner-document transaction:

1. Verify that `participantUid == uid`. If it does not match, skip (already changed).
2. Remove the plain participant fields: `participantUid`, `participantMemberRef`,
   `participantState`, `participantInvitedAt`, `participantAcceptedAt`.
3. Decrypt the payload server-side, remove `participantNotes`, and re-encrypt it with
   the current key version. Owner content (title, owner notes, next steps, shared goal
   snapshots, the owner's own fields) is kept byte-for-byte in content terms.
4. Update the stored key-check fields to match the re-encrypted payload.
5. Delete the matching participant index (I-6) in the erased person's subtree if it
   exists.

**Owner-authored content is never rewritten as participant-authored.** The owner's
shared goal snapshots are the owner's own goals, so they stay with the owner
document. The erased person did not author them.

**Neutral presentation.** After step 2, the conversation DTO's participant block is
`{ state: "removed" }`. It has no uid, memberRef, notes, or invitation timestamps. The
owner sees the participant removed. The owner may invite a new participant through the
normal flow. *(Amended 2026-10-29, see "Decision log: TASK-020 neutral presentation
amendment": the block is `{ state: "none" }` with the existing no-participant copy, and
no historical marker is persisted.)*

**Undecryptable payload (malformed).** If decryption fails, step 3 cannot prove
`participantNotes` is removed. Step 2 is **not** performed in that case: the whole
transaction fails closed and the record stops with `errorCode:
"payload_unreadable"`. The erasure stays in progress. Operator procedure is in
Operational requirements. The erasure must not claim completion in this state.

### Participant index in the erased person's subtree (I-6)

Deleted in `locators`. Discovery does not depend on it (I-8 is authoritative), so a
missing or malformed index does not hide a binding.

## Membership and lead consequences (BR-10, D2)

- Every membership found by I-9 is deleted in `memberships`. This ends membership
  access, ends any lead role on that membership, and removes the skill-contribution
  consent (`skillContribution`) on it.
- `memberRef` is destroyed with the membership. Roadmap `ownerRef` values that matched
  it are nulled before deletion (A-5), so no dangling link remains.
- Conversations owned by others keep their participant binding until I-7 is applied;
  I-7 clears `participantMemberRef` as well.
- Team skill coverage is recomputed. A removed contributor can change a covered state;
  this is expected and documented.
- This is not a self-leave capability. No route exists for a person to remove
  their own membership outside erasure. The admin membership model is unchanged.

## Survey consequences (BR-11, D6)

- `surveyParticipations` are deleted (I-12). This includes participations in open
  authenticated surveys.
- Anonymous `surveyResponses` remain (P-1). They are not joined, inferred, or deleted.
- While erasure is in progress, the fence refuses every authenticated or non-public survey
  operation for the uid (W-13). Authenticated survey resolve and authenticated survey submission
  return `erasure_in_progress` (403), never `sign_in_required` or `unauthenticated`.
- Public anonymous survey submission remains available anonymously, even when the request carries
  a token of a uid whose erasure is in progress (approved 2026-10-28; see "Decision log: TASK-009
  survey paths"). A supplied fenced token must not be used to attach identity, grant extra
  authorization, or write a person-owned record. Its result is identical to the same request
  without a token.
- After `auth_delete`, no token verifies.
- A new account created after erasure is a new identity with a new uid. It may respond
  to an open survey, as any new account may. This is inherent to account creation and
  is not an erasure defect (see Explicit non-goals).

## Audit-field anonymization (BR-12, D5)

- The actor fields in A-1 to A-13 are set to null, or to the erased-actor marker in
  `forumReplies.deletedBy` only.
- Business records are not deleted for that reason.
- Readers must tolerate a null actor field. Each affected domain validator must accept
  null for that field (implementation task requirement; no validator may accept a uid
  shape that could not be the erased-actor marker).
- Admin erasure is not blocked by superadmin registry membership (D5; the start revokes the privilege atomically, see the superadmin start rule). See Operational
  requirements for the allow-list consequence.

## Invitations and email (BR-13)

**Current email is the matching key.** The verified token's email, normalized with
`normalizeEmail` (`src/features/teams/domain/normalize-email.ts`), matches
`teamInvitations.email`. The document id uses the normalized email (`teamId__normalizedEmail`); the task verifies that the stored `email` field is normalized the same way before the query relies on it.
The query uses the existing `teamInvitations (email, status)` index for each status.

**Scope of deletion.** Every invitation whose normalized email equals the erased email,
in any status (pending, accepted, canceled), plus every invitation whose `resolvedUid`
equals the uid. Deleting an accepted invitation removes the record of acceptance, which
is person-linked.

**Historical email addresses are not covered.** If Firebase Auth email changed, earlier
invitations under the old address cannot be reliably linked to the person from the
repository. The SPEC does not promise their deletion. This is a documented limitation,
not a silent gap.

**Effect on other users.** A pending invitation disappears from the team administration
view. It would otherwise have granted membership to a new sign-up with the same email,
which is the reason for deleting it. No other person's access changes.

**Re-registration.** A new sign-up with the same email creates a new uid. Remaining
invitations for other teams are unaffected by erasure; any invitation for the same email
that an admin creates after erasure is a new, ordinary invitation.

## Platform-log limitation (BR-19, D9)

- The repository does not establish which hosting, Firebase, or platform logs contain
  uid or email, their retention, or whether application code can erase them.
- Erasure does not claim to delete platform logs. Those logs are recorded as
  EXTERNAL (E-1).
- Application logs produced by this feature contain only status, step, and error code
  (AE-SI-12).
- The deployment verification item in Operational requirements records the log
  behaviour for the environment.
- No repository document makes an absolute deletion promise that conflicts with this
  limitation (checked: `docs/PRODUCT.md`, `docs/SECURITY.md`, `docs/UI-UX.md`,
  `docs/ARCHITECTURE.md`). The conversation SPEC's "permanently delete" wording applies to
  conversations only. The UI copy for erasure must not claim deletion from provider logs.

## Malformed and stale data behaviour (BR-16)

- Deletion selects documents by raw field presence (`uid`, `authorUid`, `participantUid`,
  actor fields) and by document-id prefix, never by a validated shape. A malformed
  record with the uid is still found and removed.
- Forum deletion never requires decryption: the placeholder and the tombstone are
  written from plain fields only.
- Owned conversation deletion reads plain fields only (existing BR-29 semantics), so it
  works on malformed content.
- Participant binding erasure requires decryption (I-7 step 3). An undecryptable payload
  fails closed (see Conversation consequences). This is the only case that can stop an
  erasure for a reason other than infrastructure failure.
- Orphaned participant index (owner document missing): removed in `locators`. Harmless
  because the owner document is gone.
- Stale binding (owner document says `participantUid` differs from the index): the
  owner-document value is authoritative; the index is removed.
- Degraded reads during progress: see "Reads denied or degraded".

## Partial failure and retry (BR-15)

| Failure | Record after failure | Person's access | Recovery |
|---|---|---|---|
| A data step fails (Firestore error, timeout) | `in_progress/<step>`, `errorCode` set | Erasure endpoint only (Auth still exists; sign-in works) | Client re-calls the endpoint; the step is retried. Each step is idempotent. |
| Process stops mid-step | `in_progress/<step>` | Same | Same. Steps re-query, so already-processed documents are not found again. |
| Auth deletion fails transiently | `in_progress/auth_delete`, `errorCode` | Same | Re-call retries `deleteUser`. `user-not-found` counts as success. |
| Auth deleted, `final_sweep` or completion write fails | `auth_deleted`, `errorCode` | None (verification fails) | No user recovery is possible. Operator procedure re-runs `final_sweep` (Operational requirements). Residual data can exist only through an in-flight race that the transactional fence should prevent; the procedure is the backstop. |
| Payload unreadable (I-7) | `in_progress/participant_bindings`, `errorCode: payload_unreadable` | Same | Operator procedure. Must not be reported as complete. |
| Auth deleted, but the status write to `in_progress/auth_delete` or `auth_deleted` did not persist (`deleteUser` succeeded) | `in_progress/auth_delete` (or `auth_deleted`), `errorCode` | None: the Auth user is gone, so the person has no valid token and resume returns `invalid_token` | Operator procedure (Operational requirement 8b). It only finalizes the approved state machine. It does not restore Auth, read content, or roll back data. |
| Auth deletion first (rejected alternative) | — | Person cannot authenticate to resume | Rejected. See Authentication ordering. |

**Rules.**

- No step is reported complete until its verification query returns zero matches.
- No rollback or restoration of already-erased personal data exists. A partial
  erasure is never undone, and the SPEC does not invent recovery (D7).
- Erasure is not atomic across Firestore and Auth, and no response claims that it is
  (D8).
- The error codes are a fixed enum: `payload_unreadable`, `store_unavailable`,
  `auth_unavailable`, `verification_failed`, `unexpected`. No free text.

## Completion criteria (BR-17)

Erasure is complete only when:

1. `final_sweep` returns zero matches for the inventory queries (I-1 to I-14, A-1 to
   A-13, with I-15 excluded), with one narrow exception: the four membership-instance rows
   A-5 (`roadmapItems.ownerRef`), A-14 (`teamSystems.knowledgeMemberRefs`, added 2026-11-05), I-7
   `participantMemberRef`, and I-9 `memberRef` are not re-queried after membership destruction. They are discharged by the transactional cleanup
   invariant in "Decision log: BR-17(1) membership-instance rows (approved 2026-11-02)". **Superseded 2026-11-08:** these rows
   are no longer excluded from the verification sweep. The per-membership counts run while the person's memberships still
   exist, and any match routes back to its owning step. The membership step deletes a membership only after its A-5, A-14 and
   A-15 references are cleared in the same transaction (see "Decision log: BR-17 completion guarantee (2026-11-08)"). Every
   other inventory row, including every uid-, e-mail-, collection-group- and actor-addressable row,
   still requires zero matches at `final_sweep`;
2. the Auth user is confirmed absent (deleted or `user-not-found`);
3. the record is `status: "completed"` with `expireAt`.

On completion, the erasure response returns `{ status: "completed" }`. The client signs
the person out, shows a neutral "account erased" screen, and does not offer recovery.

## Terminal state and TTL (BR-6, AE-SI-5)

- After completion, `accountErasures/{uid}` remains only as the fence. It is needed
  because a request that verified before Auth deletion, or one already in a transaction,
  must not write after completion. The fence blocks it.
- The record expires by a Firestore TTL policy on `expireAt` (set to `completedAt` plus
  24 hours; this exceeds the longest request budget). Expiry is safe because the uid
  cannot authenticate (AE-A1).
- The TTL policy is deployment configuration, not in this repository (see Operational
  requirements). Until it is configured, the record persists; it still contains only the
  allowed fields.

## Cross-feature compatibility (D2 exception)

The completed-conversation immutability contract (development-conversations BR-20) is
overridden **only** by account erasure, as recorded in BR-9. The following must hold:

- Other conversation writes continue to reject completed-conversation participant
  notes.
- The override is implemented by one erasure-owned function, so a static guard can flag
  any other writer that clears or rewrites `participantNotes`.
- Maintainers are told in the development-conversations SPEC that BR-20 does not prevent
  account erasure. That SPEC's "Account-erasure flow covering both subtrees" non-goal and
  "no erasure flow, known limitation" statements are superseded by this SPEC once
  implemented (task requirement).

## Cross-feature static guard implications

- A registry module (`src/features/account-erasure/server/inventory.ts`) lists every
  collection and field in the inventory. A guard test fails if a collection or field
  that contains a uid, `authorUid`, `participantUid`, `memberRef`, `email`, or an actor
  name is not in the registry or in the allow-list of preserved fields.
- The guard lists the only writers allowed to change `participantNotes` on a completed
  conversation: the erasure function.
- The guard lists the only writers allowed to create an erased-thread placeholder.
- The fence read is required in every person-owned write transaction. The guard checks
  that each write surface in W-1 to W-18 reads `accountErasures`, or is listed as
  deliberately excluded with a reason.
- Import rule: `src/features/auth/server/` may import the fence module it owns, but
  must not import `account-erasure`. `account-erasure` may import `auth`.

## Firestore rules and index implications

- `firestore.rules`: add `match /accountErasures/{document=**} { allow read, write:
  if false; }`, following the existing deny-block convention. Placed before the
  catch-all, with a rules test in `firestore-deployment-config.test.ts`.
- `firestore.indexes.json`:
  - **AE-IDX-1 (required).** Collection-group index on `conversations` for `participantUid`
    (`queryScope: COLLECTION_GROUP`), for I-8.
  - **AE-IDX-2 (verify).** Single-field equality queries for `uid`, `authorUid`,
    `participantUid`, `createdBy`, `updatedBy`, `archivedBy`, `resolvedBy`, `deletedBy`,
    `grantedBy`, `roleUpdatedBy`, `invitedBy`, `resolvedUid`, `email` rely on automatic
    single-field indexes. The task must confirm no field exemption exists for them.
  - Document-id prefix queries (memberships, access requests, survey participations) use
    `__name__` range queries, which need no composite index.
- TTL on `accountErasures.expireAt` is configured at the Firestore project level, not in
  this repository (Operational requirements).

## Migration and backfill

- No existing data needs migration. The new fence record is created only by erasure.
- The erased-thread placeholder and the `"erased"` actor marker are new shapes. Readers
  must accept them; existing data never contains them.
- Legacy memberships without a `uid` field are covered by the document-id prefix
  (I-9), so no backfill is required.
- Null actor fields are a valid state for readers after erasure. Validators must accept
  them (A-rows).

## Demo Team implications (BR-20)

- Demo fixtures are not real identities. The demo tooling creates no Auth users
  (verified).
- The demo CLI takes a real `--presenter-uid`. Before writing, it must check that the
  uid has a current Auth user and no `accountErasures` record. It refuses otherwise
  (`invalid-presenter-uid` or a new refusal code, chosen in the task).
- Demo data written under a real presenter uid is person-owned and is erased with that
  person. Operators must not run the demo against an erased or erasing uid.

## Operational requirements (BR-21, D5, D9)

1. **Superadmin registry (superseded 2026-11-06).** The former `APP_ADMIN_EMAILS` allow-list is not read by the
   application any longer, so this operator step no longer applies to admin status. Admin status is the registry record
   `superadmins/{uid}`. Erasure removes an erased superadmin's record (`superadmin-record-erasure`), and a **new** sign-up
   can never become superadmin without an explicit grant by an active superadmin.
2. **Firestore TTL.** Configure a TTL policy on `accountErasures.expireAt` in the
   Firebase project. The field is written only on completion.
3. **Indexes.** Deploy `AE-IDX-1` before the first erasure. Verify `AE-IDX-2`.
4. **Auth permissions.** Confirm the Admin SDK service account can call `deleteUser` in
   each environment (not previously exercised by the repository).
5. **Token claims.** In deployment review, confirm that `auth_time` is present in ID
   tokens, that a token refresh does not change it, and that a fresh password sign-in
   does. This is a repository-external Firebase behaviour that the repository cannot test
   offline.
6. **uid non-reuse (AE-A1).** Confirm in deployment review that Firebase does not reuse
   a deleted uid for the environment.
7. **Request budget.** Confirm the deployment's request timeout exceeds the 20-second
   budget with margin. Otherwise lower the budget constant.
8. **Operator procedure for stuck records.** There is no worker. A record stuck in
   `in_progress/participant_bindings` (`payload_unreadable`) or in `auth_deleted` (failed
   `final_sweep`) requires an operator to inspect the record (status, step, error code
   only) and re-run the step through a reviewed, non-product script or a repeated
   authenticated call where possible. The procedure is written in the operations
   runbook; it does not expose content.

   **8a. Stuck in `in_progress/participant_bindings` (`payload_unreadable`).** Operator
   inspects status, step, and error code only. The binding cannot be cleared without
   decrypting the payload, so the record stays stopped until the payload is repaired
   through a reviewed procedure. The erasure is never reported complete.

   **8b. Auth-deleted stuck state (reconciled 2026-10-28).** This covers a record in
   `auth_deleted`, and a record in `in_progress/auth_delete` where `deleteUser`
   succeeded but the status write did not persist. In both cases the erased person
   has no valid token, so they cannot resume. The approved recovery is an
   operator-run, reviewed, non-product script, under the same operator Admin SDK
   access class assumed by item 8:
   - allowed scope: only records in these two states, and only after the operator
     confirms the Auth user is absent (`user-not-found`);
   - allowed actions: run the registry verification queries (counts only) and the
     approved step handlers for any non-zero row; when every row is zero, write
     `status: "completed"` with `completedAt` and `expireAt` (the BR-17 criteria);
   - forbidden: recreating or restoring the Auth identity; any new product endpoint;
     any new privileged app role or admin capability; reading or returning document
     content; rolling back erased data; any action on a record in another state;
   - the operator's own log may hold the record identifier, step, and outcome, but
     application logs never do (AE-SI-12).
   The procedure creates no product capability. A security sign-off of this procedure
   is recommended before the first real use.
9. **Platform logs (E-1).** Record each environment's log content and retention for
   uid and email in the deployment checklist. Erasure makes no claim about them.
10. **Demo.** The demo CLI refusal (BR-20) is verified before any demo run against a
    real presenter.
11. **Manual Firestore Emulator race proof (D-EMU, 2026-10-28).** Before final feature
    closeout, an operator runs the transaction-race proof against the local Firestore
    Emulator only. The proof: a transaction that begins before creation of the erasure
    fence must not commit a protected person-linked write after that fence is created.
    The result (date, commands, pass/fail, emulator version) is recorded in
    `docs/features/account-erasure/VERIFICATION.md`. No real Firebase project is used.
    Closeout is blocked until that record exists.

## Explicit non-goals

- A general self-leave-team capability (D2).
- Export or download of one's own data.
- Configurable retention policies.
- Legal-hold administration (no legal hold exists; D9).
- Admin-triggered erasure of another person, and bulk erasure.
- Account merge, or recovery after erasure.
- Notifications to every affected user (D4).
- A global redesign of forum anonymity or the `authorTag` derivation (D3; recorded as a
  pre-existing item).
- Historical reconstruction of anonymous survey ownership (D6).
- Deletion of provider or platform logs (E-1).
- Preventing a new sign-up under the same email from becoming a new account.

## Business requirements (BR-*)

- **BR-1 Self-only.** The erasure endpoint acts only on the verified caller's uid
  (AE-SI-1). It accepts no uid in path, body, or query.
- **BR-2 Start.** `POST /api/me/erasure` with the typed email creates the record in one
  transaction. A second start returns the existing state. Preconditions: recent
  authentication (BR-3) and a matching confirmation.
- **BR-3 Recent authentication.** `auth_time` within 300 seconds, required only at start.
  Continuation requires a valid token, not a fresh sign-in (see "Resume is not
  re-authorization").
- **BR-4 Fence.** (a) `verifyIdToken` reads the record and rejects in-progress requests
  except the erasure endpoint. (b) Every person-owned write transaction reads the record
  and refuses while it exists. Ordinary admin removal of a membership (team-management BR-29) is such a write for the
  removed member: its final transaction reads `accountErasures/{targetUid}` (decision 2026-11-02, below), and a pre-cleanup
  read of the same record refuses before any binding is cleared. (c) Non-transactional writes in the enumeration are
  converted before the feature is complete.
- **BR-5 Verification.** Each step ends with a zero-match query over the inventory. The
  `verify_data` step re-runs every query.
- **BR-6 Auth ordering.** Auth deletion is the final step that needs the person's
  authentication. A terminal fence record with TTL protects against in-flight writes.
- **BR-7 Forum.** Replies become tombstones (`deletedBy: "erased"`). Threads are deleted
  if no other person replied; otherwise they become erased-thread placeholders. No
  authorUid is retained. Placeholder DTO has no title, body, author, or authorTag.
- **BR-8 Owned conversations.** Deleted with their participant index (D4). No
  notification.
- **BR-9 Participant bindings (D2 exception).** Participant fields and `participantNotes`
  are removed from others' conversations, including completed ones. Owner content is
  kept. The override applies only to erasure.
- **BR-10 Memberships.** All memberships are deleted. Roadmap `ownerRef` values that
  matched them are nulled first. `memberRef` and `skillContribution` go with them.
- **BR-11 Surveys.** `surveyParticipations` are deleted. Anonymous responses are kept.
- **BR-12 Audit.** Actor fields A-1 to A-13 are nulled, or set to the erased-actor marker
  in `forumReplies.deletedBy`. Records are kept.
- **BR-13 Invitations.** Deleted by normalized current email and by `resolvedUid`.
  Historical emails are a documented limitation.
- **BR-14 Bounded.** At most 10 batches of 100 writes and 20 seconds per request. The
  client re-calls until completed.
- **BR-15 Retry and partial failure.** Idempotent steps; error codes from a fixed enum;
  no rollback; no claim of atomicity.
- **BR-16 Degraded reads.** Other people's reads may show the erased person's data until
  their step completes. The erased person's own protected reads are denied during
  progress.
- **BR-17 Completion.** Final sweep zero, Auth absent, record `completed` with `expireAt`.
  The client signs out and shows a neutral screen.
- **BR-18 Post-erasure presentation.** Neutral removed-participant block; erased
  tombstones and placeholders; no former identity. The erased person cannot sign in
  again with those credentials (the account no longer exists).
- **BR-19 Platform logs.** Recorded as EXTERNAL. Not claimed. Application logs carry
  status, step, and error code only.
- **BR-20 Demo.** The demo CLI refuses an erasing or erased presenter uid.
- **BR-21 Operations.** Items in "Operational requirements" are deployment gates.
- **BR-22 Non-goals.** The list above applies.

## Malformed and concurrency tests (required, not exhaustive)

- Fence: a request with a valid token during `in_progress` is rejected, except the
  erasure endpoint. A write transaction started before record creation fails to commit
  after it.
- Forum: a thread with no other replies is deleted; one with other replies becomes a
  placeholder; the placeholder DTO exposes no author data and no `authorTag`.
- Conversations: an owned conversation is deleted with its index; a participant binding
  is cleared, the notes are removed, and the owner's content is intact; an undecryptable
  payload stops with `payload_unreadable` and does not report completion.
- Memberships: `ownerRef` is nulled before the membership is deleted; a legacy membership
  without a `uid` field is removed by document-id prefix.
- Invitations: matching is by normalized email and `resolvedUid`; no other invitation is
  deleted.
- Auth: `user-not-found` on retry counts as success; the final sweep runs after Auth
  deletion.
- Recent auth: a token with an old `auth_time` cannot start an erasure.
- Logs: no uid, email, or content appears in logged output for this feature.

## Open items recorded (not blocking)

- Pre-existing forum `authorTag` correlation by app admins (see Forum tombstone
  semantics).
- Historical email addresses in invitations.
- Operational verification of `auth_time` behaviour, uid non-reuse, Auth permissions,
  TTL, and platform logs (Operational requirements).

## Documents to update when implemented

- `docs/SECURITY.md`: add `AE-SI-1` to `AE-SI-13` as numbered invariants, and replace the
  "no account erasure" known limitation.
- `docs/DATA-MODEL.md`: add `accountErasures`, the erased-thread placeholder, the
  erased-actor marker, and the removed-participant DTO.
- `docs/features/development-conversations/SPEC.md`: record the erasure override of BR-20
  and supersede "no erasure flow" statements.
- `docs/features/individual-skill-self-assessment/SPEC.md`,
  `docs/features/personal-development-goals/SPEC.md`,
  `docs/features/member-identity-and-team-roles/SPEC.md`,
  `docs/features/team-forum/SPEC.md`: supersede the "no account erasure" limitation.
- `docs/ARCHITECTURE.md`: record the `verifyIdToken` fence and the added read as an
  intentional cost.

### Decision log: TASK-006 persistence boundary (approved 2026-10-28, scope stop recorded)

- **Decision.** The AST scanner is retired as the enforcement mechanism for the inventory invariant. The approved direction is a constrained typed persistence boundary (typed descriptors for approved collections, locators, identity-bearing fields and query shapes) combined with a simple import/use boundary for raw Firestore SDK access. Enforcement must not depend on recognising equivalent TypeScript syntax.
- **Invariant kept (SUPERSEDED for TASK-006 enforcement on 2026-10-29; see "Decision log: TASK-006 narrowed invariant").** Every erasure-relevant person-linked persistence locator is represented by the approved inventory and production code cannot introduce an unregistered raw persistence surface inside the protected boundary. The repository-wide boundary this wording required is not in this feature's approved scope. The inventory semantics (I-, A-, P-, E- rows, `memberRef` kinds, invitation document-ID email, subtree ownership, D2 participant and owner locators, the C1 `levels.<treeId>` domain-keyed map) are unchanged. `normalizedEmail` and other rejected fields are not reintroduced.
- **Scope finding (why implementation is stopped).** Measured on 2026-10-28: 75 non-test production files call `.collection(` or `collectionGroup(`, about 229 call sites. Only 25 of those files import the Firestore SDK directly; 50 reach Firestore through the shared `getFirestoreDb()` accessor in `src/lib/firebase/admin.ts`. An import-only boundary therefore cannot close the invariant, because any file holding the handle can issue an unregistered call. A closed boundary requires routing the person-linked call sites through typed descriptors, which is a repository-wide persistence migration. The approved direction says to stop in that case.
- **Status (historical, superseded 2026-10-29 by "Decision log: TASK-006 narrowed invariant").** TASK-006 was BLOCKED on this architecture. No production code was changed for this architecture. The historical STOP evidence in VERIFICATION.md is unchanged. TASK-012 stays blocked until TASK-006 is Done.

### Decision log: TASK-006 narrowed invariant (approved 2026-10-29)

- **Scope of the guarantee.** TASK-006 is an **inventory-completeness and change-control gate for the current known erasure-relevant persistence surfaces**. It records, for every currently known person-linked collection, locator, document-ID encoding, identity-bearing field, ownership relationship and query shape, one inventory row (I-, A-, P-, E- rows). It does **not** prove that arbitrary future TypeScript cannot introduce an unregistered Firestore surface.
- **Superseded wording.** The stronger "cannot introduce an unregistered raw persistence surface" invariant (decision log "TASK-006 persistence boundary", where the AST scanner is described as "retired as the enforcement mechanism"; the scanner is kept below as a demoted tripwire, not deleted) is superseded for TASK-006. Enforcing it would require a repository-wide persistence migration (about 229 Firestore call sites in 75 files) and a persistence wrapper, which are outside this feature's approved scope. The AST scanner ("TASK-006 AST scanner", "final-cycle review: STOP") is demoted to a change-detection tripwire and is not claimed as proof of whole-program coverage.
- **Change-control rule (required, not statically proven).** Any new or changed DevPulse-controlled persistence that stores or locates person-linked data must be evaluated against this inventory **in the same change**. A new or changed collection, document-ID encoding, locator, identity-bearing field, ownership relationship, query shape, or collection-group requirement must update `src/features/account-erasure/server/inventory.ts` and its verification when it is erasure-relevant. Code review checks this. The tripwire catches only the common literal forms.
- **Mechanically enforced (reliable, simple properties only).** The row set matches the SPEC exactly once per id; A-5, I-7 `participantMemberRef` and I-9 `memberRef` are `memberRef` kinds and generate no uid equality query; every field name has one kind; sweep shapes per locator; the registry is non-empty and the allow-list has no stale entries.
- **Demoted tripwires (defense-in-depth, not security proofs).** The AST tripwire in `inventory-guard.ts`, its approved C1 dynamic-key exceptions (`APPROVED_DYNAMIC_KEYS`, `APPROVED_DYNAMIC_FIELD_PATHS`) and the file-exact scope-guard allow-lists in other features. Each reports only the shapes its tests name.
- **Status.** Reconciliation, classification and the independent review are recorded in VERIFICATION.md "TASK-006 narrowed invariant (2026-10-29)".

### Decision log: TASK-020 neutral presentation amendment (approved 2026-10-29)

- **Amends** "Neutral presentation" (step 2 of the erasure procedure) and BR-18. The historical text above is kept as written.
- **Superseded wording.** The sentence that the conversation DTO's participant block is `{ state: "removed" }` after step 2 is superseded. After a successful participant-binding cleanup, the owner's DTO participant block is the existing neutral no-participant state: `{ state: "none", displayName: null }`, the same state an owner sees for a conversation that never had a participant. The UI shows the existing no-participant copy and offers the normal invite flow.
- **Persisted state.** No data change. The owner document keeps the five binding fields `null`, and the participant index entry is removed. No new persisted marker, key, or historical field records that a participant was erased, removed, or by whom (`removedParticipant`, `participantWasErased`, `erasedParticipant`, `deletedParticipantUid`, historical uid, email, or memberRef, `deletedBy`, erasure reason, or any equivalent).
- **Presentation.** The DTO and UI do not distinguish why the participant is absent. The presentation must not claim that the participant erased their account, that the owner removed them, that an admin removed them, or any other historical reason.
- **Scope.** Ordinary owner-removal behaviour in D2 is not changed. This amendment applies only to the erasure outcome. The state after a successful cleanup is the owner-visible result of TASK-019, which keeps owner content, completed status, and readability.
- **Rationale.** Erasure removes person-linked state. It does not create new historical metadata whose only purpose is to remember that an erased person once held the participant role. Inferring the erased identity from other records to improve the presentation is also out of scope.
- **Supersedes** the TASK-020 blocked decision options (a) and (b). Option (c) was chosen.


## Decision log: BR-17 completion guarantee (2026-11-08)

**Owner decision.** The completion guarantee takes precedence over the 2026-11-02 BR-17(1) deferral wherever the
membership-instance `memberRef` rows contain personal data that must be erased. Erasure must not report completion while
in-scope personal data remains. Records needed to preserve other people's data or referential integrity are not deleted
indiscriminately: A-5 and I-7 are detached (`ownerRef` and the binding fields are cleared), A-14 removes only the erased
`memberRef` from a system's knowledge list, and A-15 participations are deleted.

**Enforced by:**

- `verification-sweep.ts` no longer defers the per-membership rows. It counts them and routes any match to the owning step, so
  `complete` is false while such a row remains. The `deferredRowIds` report field is removed.
- `membership-erasure.ts` deletes a membership only in the transaction that found its roadmap, knowledge and participation
  references already cleared. Its emulator suite is `membership-erasure.emulator.test.ts`.
- The forum adapter (`erasure-adapters-forum.ts`) converts stored Firestore timestamps to `Date` before validation. Without
  this, the forum step could not read a stored reply and erasure could not complete. Covered by the D-EMU suite.

**Residual limit.** After the membership is deleted, a uid-addressed sweep cannot rediscover a `memberRef`-keyed row, because
the link from uid to `memberRef` no longer exists. That is why the guarantee rests on the transactional invariant above rather
than on a post-deletion query. Retaining the `memberRef` mapping after deletion was rejected in the 2026-11-02 decision.

## Decision log: BR-17(1) membership-instance rows (approved 2026-11-02)

**Owner decision (option a).** BR-17(1) is amended narrowly for three residual rows whose discoverability depends on the
membership-instance `memberRef`: A-5 (`roadmapItems.ownerRef`), I-7 `participantMemberRef`, and I-9 `memberRef`.

**Rationale.** The approved privacy model destroys the membership-instance `memberRef` when the membership is removed. A
later global sweep cannot rediscover that value without retaining historical identity state or another durable marker. Both
are rejected. For these rows, the requirement is a transactional cleanup invariant instead of a post-deletion zero:

1. Before a membership instance is destroyed, every cleanup operation that depends on its `memberRef` re-checks and clears
   the memberRef-linked data inside a transaction that also protects the destruction.
2. The membership is deleted only after that cleanup has run under that protected boundary, in the same transaction.
3. A retry re-runs the same decision from current data. It never deletes the membership while a dependent reference remains.

**Scope is exact.** The amendment covers only A-5, I-7 `participantMemberRef`, and I-9 `memberRef`. It does not skip final
verification for any uid-addressable, e-mail-addressable, collection-group-discoverable, personal-data or actor-audit row.
Rows that remain discoverable after membership deletion keep the zero-residual requirement. Trusting an earlier cleanup
merely because it ran is not allowed.

**No new persistence.** No residual record, history, or marker is added for these rows.

**Final invariant (2026-11-02, owner decision (a) with approved coordination).** The membership-instance rows are guaranteed
at the membership-destruction boundary through transactional coordination, because the destroyed `memberRef` cannot be
reconstructed for a later global sweep. The coordination is:

- A-5 `roadmapItems.ownerRef`. Every roadmap transaction that introduces a new owner reads the target membership inside
  the same transaction (the owner-resolution query) and writes that exact membership document with its own unchanged
  `memberRef`. The membership-erasure transaction reads the same membership and queries the roadmap items, then deletes
  the membership in that transaction. Either ordering conflicts: an assignment that commits first invalidates the erasure's
  read, and the erasure retries and clears it; a deletion that commits first makes the assignment's read stale, and the
  assignment refuses.
- I-7 `participantMemberRef`. The binding is discovered by `participantUid` (uid-addressable, final-swept). An invitation
  that writes a binding and the invitee's participation index reads the invitee's erasure record in the same transaction,
  so no invitation commits for an erasing person after its record exists.
- I-9 `memberRef`. The membership document is itself the row, and it is uid-addressable. No path recreates a membership for
  an erasing uid: membership creation paths are fenced on the target uid (TASK-030), and the remaining membership writes
  (role update, member-ref materialization) use an update that fails on a missing document, so they cannot recreate it.

Only the coordination on these three rows is new. Every other row keeps the zero-residual requirement at final sweep.

## Decision log: ordinary removal and the target-person fence (owner decision, 2026-11-02)

Ordinary admin `removeTeamMember` is NOT exempt from BR-4(b). The fence subject is the uid of the member whose membership is
removed. It is not the admin's uid, a memberRef, or a caller-selected uid. Covers BR-4(b), BR-10 and BR-17 as follows:
- **BR-4(b).** The destruction's final transaction reads `accountErasures/{targetUid}` with `tx.get` in the same transaction
  as the membership delete and the roadmap clears. A pre-check transaction reads the same record before each round's binding
  cleanup, so a fenced removal writes nothing. An unreadable or malformed record rejects and the transaction aborts (fail closed).
  Any helper that uses an ordinary read inside a transaction does not count; `assertNoErasureRecordInTransaction` takes the
  transaction itself.
- **BR-10.** No authority changes. The erased person gains no authority, and admin authorization is the existing app-admin check.
- **BR-17.** Erasure's own membership step does NOT call the ordinary removal boundary. Its path is recorded in the decision above
  (erasure clears A-5 in its final transaction and discovers I-7 by `participantUid`). The two paths share the membership
  instance invariant, not one helper. The ordinary boundary's residual is stated in VERIFICATION (binding cleanup in a round
  happens after that round's pre-check, and may run for a conversation whose owner is later fenced).
- **Refusal.** A fenced removal returns `erasure_in_progress`. No membership, roadmap or binding write occurs in that call.
- **Residual (stated, not hidden).** A round's pre-check and its binding clears are separate transactions. A fence that appears
  between them stops the membership delete and the roadmap clears (the final transaction re-reads the fence), but the binding
  clears already committed in that round remain. Those clears only remove this membership's references, which erasure would
  also remove, so the residual is limited to the approved neutral clears.

## Decision log: owner-cleanup capability replaces the unfenced delete option (owner decision, 2026-11-02)

The `unfenced?: true` option on `deleteConversation` is removed. Ordinary callers always run the owner transaction, which reads
the owner's erasure record. The erasure owner cleanup deletes through `deleteConversationForErasure`, which accepts only an opaque
`ErasureOwnerCleanupCapability`. The capability is minted only by the three approved erasure modules: `account-erasure/server/conversations-erasure.ts` (owner delete and locators), `account-erasure/server/production-erasure-handlers.ts` (the erasure binding step), and `account-erasure/server/membership-destruction-adapter.ts` (ordinary removal's binding cleanup, 2026-11-02 lifecycle decision). A static test pins these modules exactly, and a static
test enforces that. The option cannot be requested by boolean, spread, alias, or string mode. D2 owner semantics, the TASK-019
erasure-only completed-conversation exception, encryption, and participant-note cleanup are unchanged.

## Decision log: BR-17(1) membership-instance reasoning covers every membership destruction (owner decision, 2026-11-02)

The membership-instance invariant of the amendment above is not tied to account erasure. Membership destruction has two
legitimate paths: erasure-driven removal and ordinary admin removal (`team-management` BR-29, amended the same day). Both
use the same destruction primitives in two different ways, and the SPEC states both precisely (review I-1, 2026-11-02):
- Ordinary admin removal runs the bounded destruction boundary (`src/features/account-erasure/server/membership-destruction.ts`):
  each memberRef-dependent reference (A-5 roadmap `ownerRef`, I-7 participant bindings) is cleared before the membership
  delete, and the delete is conditioned on those references being gone, in one transaction.
- Erasure keeps its own membership step (`membership-erasure.ts`): it clears A-5 in its final transaction, and it does not
  count bindings there. I-7 is discovered by `participantUid` and cleared by the uid-addressed bindings step, which runs
  after membership removal. That is why the erasure path does not need the binding count. Membership creation paths that introduce a reference touch
the target membership in the same transaction (roadmap owner assignment; invitation and replacement of a participant), so
the conflict holds in both orders. The transactional argument therefore does not rely on erasure being the only membership
deletion path. No new durable history is introduced.

## Decision log: teamProjectParticipations erasure coverage, A-15 (owner decision, 2026-11-06)

Source: `docs/features/team-experience-redesign/TASKS.md`, TASK-004, and the owner's approval to pull the participation part of TASK-012 forward. A-15 is registered before any participation write path exists. `teamProjects` (TASK-003) stores no actor uid or `memberRef`, so it is recorded as a non-person-owned collection in `ALLOWED_UNREGISTERED_COLLECTIONS`, not as a registry row. The approval covers only the local erasure integration and its tests, not the rest of TASK-012.

- **Policy:** DELETE. A participation's `memberRef` is the only link to a person, and it is destroyed with the membership, so the record has no remaining meaning.
- **Order:** in the `memberships` step, after the A-5 and A-14 steps and before the membership delete, in both the erasure orchestrator and the destruction orchestrator. Every read precedes the first queued write.
- **Scope:** the query is scoped to the membership's `teamId`, so a participation in another team is never touched.

## Decision log: teamSystems erasure coverage, A-13 and A-14 (owner decision OQ-1, approved 2026-11-05)

Source: `docs/features/team-system-overview/SPEC.md`, OQ-1. The owner approved the two policies below for the new `teamSystems`
collection.

- **A-13 `teamSystems` `createdBy`, `updatedBy`, `assessedBy` — ANONYMIZE.** Each field is set to `null`. `assessedBy` is stored
  inside each assessment map, so it is three closed targets (`availability.assessedBy`, `maintainability.assessedBy`,
  `security.assessedBy`). The assessment value, note, `assessedAt` and the system record are kept. No replacement uid is written.
  Run by the `actor_audit` step as a single-field equality per target (one document per batch).
- **A-14 `teamSystems` `knowledgeMemberRefs` — DETACH.** The erased membership's `memberRef` is removed from each system's array in
  that team. Other entries keep their order, the system record is kept, and a list that becomes empty stays as `[]`.
  Discovered by `array-contains` on `teamId` and `knowledgeMemberRefs`, and run in the `memberships` step transaction that also
  deletes the membership. The membership is not deleted while any system in the team still names its ref.
- **Coordination (extends the BR-17(1) membership-instance invariant to A-14).** The team-system write that adds a knowledge ref
  touches the target membership in the same transaction (`touchMembership`, unchanged `memberRef`). The erasure transaction and the
  ordinary removal boundary both read the systems in their own transaction, so either ordering conflicts. A-14 is therefore a
  membership-instance row in the BR-17 completion exception. This is an interpretation of the approved policy, which
  depends on the existing convention for memberRef rows; the owner should confirm it.
- **Ordinary removal.** `membership-destruction.ts` (ordinary admin `removeTeamMember`) detaches A-14 in the same final transaction,
  so no removed membership's ref remains on a system.
- **Readers.** A null `createdBy`, `updatedBy` or `assessedBy` is valid for `teamSystems` (the record stays readable). Editing an
  erased-creator system keeps `createdBy` null; the editing member is never stamped as creator.
- **Registry.** `inventory.ts` holds A-13 and A-14. The verification sweep counts A-13 by field equality (sum of the three nested
  paths) and A-14 per membership (deferred, like A-5). The actor-audit target list grows by five closed entries.
- **Known limitation, unchanged by this decision.** A team with more than 501 memberships can have a valid knowledge ref outside the
  read slice. See `docs/features/team-system-overview/SPEC.md`, "Known limitations".

## Decision log: personal role workspace inventory, I-17 and I-18 (approved 2026-11-10, first increment)

Source: `docs/features/personal-role-workspace/SECURITY-REVIEW.md` §11.3 and `docs/SECURITY.md` (PR-SI-1, PR-SI-5, PR-SI-7).

- **I-17** `userDevelopment/{uid}/responsibilities/*` (owner subtree, DELETE, paged). **I-18** `userDevelopment/{uid}/achievements/*`
  (owner subtree, DELETE, paged). Both run in the `personal_data` step, after the goal subtree. They are path-only deletions: no
  decryption and no `ENCRYPTION_KEY`, so a key failure cannot block or change them.
- Identifiers: the earlier draft proposed I-16 and I-17. I-16 is already the superadmin registry row, so the personal records use I-17
  and I-18. The W-rows for the write fence are W-19 to W-21 (personal responsibilities, achievements and evidence selection).
- Evidence snapshots are covered by the existing I-5 row (they live in the owner conversation document). No new row. The I-7
  re-encryption must preserve `sharedEvidence` byte-for-byte and fail closed on a key error. This is a required test for the evidence
  step, which is not yet implemented.
- Not covered by this log, and blocked: `roleAssignments/{uid}`, its history, and the `assignedBy` actor row. See §11.3 of the packet.

## Decision log: team-owned skills inventory, I-19 and A-17 (approved 2026-11-11, docs/features/team-owned-skills)

- **I-19** `teamSkillAssessments/{uid}__{skillId}`: a person's private team-skill ratings, one document per (person,
  team skill). DELETE, located by the stored `uid` field (`uidField`), deleted in batches by the `personal_data` step.
- **A-17** `teamSkills/{skillId}`: `createdBy` and `updatedBy` of a team-owned skill definition. ANONYMIZE, cleared by the
  `actor_audit` step. The definition itself is team configuration and is kept.
- No P-row and no new erasure step. Team-owned skill definitions follow the team lifecycle, not the person.
