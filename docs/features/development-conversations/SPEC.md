# Development conversations (D2)

## Status

**Implemented (closeout 2026-10-21, TASK-036).** The behaviour is built and verified under TASK-001 to TASK-035.
Closeout is complete only when the independent `/review-change development-conversations TASK-036` passes **and** the product owner's approval of the final invariant 21 and 25 wording is recorded (recorded 2026-10-21; see the closeout record). The review does not supply that approval. Deployment,
seeding and Firebase verification have not been performed. See "Closeout record (2026-10-21)" at the end.
The status text below is the planning-time record (2026-10-14) and is kept as history.

Draft v2 — planned, not built. Planned 2026-10-14 from the post-D1 repository
state (D1 commit `a13b175`, closed out 2026-10-14). Review pass 2026-10-14
resolved OQ-1…OQ-5, CL-5 and CL-18 (see "Decisions locked by review"). Nothing
is approved for implementation until the product owner accepts the locked
decisions. No `TASKS.md` exists and none may be created until approval and
`/split-tasks`. Amended 2026-10-14 for CL-27 (the BR-51 `keyCheck` field and the
BR-53 classification it requires). Amended 2026-10-19 for TASK-029 review finding I-1: the
owner's selector read moves to a D2-owned route (see "Amendment 2026-10-19", which supersedes the
selector-source clauses of repository finding 8, BR-8, AD-11 and the TASK-029 selector decision).

Every decision below is **Locked**. No "recommended" or open alternative remains
in the behavioural model. Items marked **Approval** are the product owner's
sign-off on the locked text, and **Closeout** items are documentation edits
that land with the feature.

## Problem

D1 gives a person a private place for development goals, but there is no way to
prepare for, hold, or record a development conversation with another person,
such as a team lead or a colleague they have chosen to work with. Today that
conversation happens outside DevPulse, with nothing to refer back to and no
explicit control over what the other person sees.

## User outcome

A signed-in person can create a development conversation (`Samtale`), write
notes, optionally attach snapshots of up to five of their own goals, and
optionally invite **one** teammate they choose. The invited teammate sees only an
invitation until they accept. After acceptance both parties see the same
content. The owner can change the participant, remove the participant, complete
the conversation (which freezes content), or delete it. Nobody else — including
team leads and app admins — can see it.

## Scope

- Person-initiated conversations at `/me/conversations` ("Samtaler"): create,
  list, view, edit while open, complete, delete.
- Optional single participant, same team only, by opaque `memberRef`, who must
  accept an invitation before seeing any content.
- Participant may write one section (`participantNotes`) and may accept,
  decline, leave.
- Optional goal snapshots: up to 5 of the owner's D1 goals, copied at the time
  they are selected.
- Application-layer encryption of named free-text fields (CL-18).
- Owner-subtree persistence plus a participant-subtree index.
- Personal navigation extended with `Samtaler`.
- A D2 static scope guard.

## Out of scope

Each exclusion is deliberate. D2 is not a performance-management subsystem.

- Performance reviews, appraisal, ratings, scores, rankings, productivity or
  activity tracking, "on track" or progress percentages, competence inference.
- Manager- or lead-initiated conversations; lead, manager or admin access of any
  kind; any private section visible to one party only.
- More than one participant; cross-team participants; mentors or guests from
  outside the owner's team (ROADMAP "mentors" wording is future scope, CL-2).
- Live goal reads by a participant; editing of a D1 goal by anyone else.
- C1 `skillProfiles` levels or skill names with levels, C2 coverage, roadmap
  items, `skillProgress`. D2 reads none of them.
- Role expectations, `roleDefinitions`, role profiles (separate future feature).
- Notifications, email or push; calendar integration, reminders, scheduling.
- Comments, replies, threads, reactions, attachments, co-editing, read receipts,
  last-viewed data.
- Account-erasure implementation (known limitation).
- Demo Team fixtures; migration; search over content.

## Key concepts

- **Conversation** — one document `userDevelopment/{ownerUid}/conversations/{conversationId}`.
  It is the **only authority** for content, participant state and status.
- **Owner** — the verified-token uid that created the conversation.
- **Participant** — at most one other person in the owner's team, bound to the
  conversation by `participantUid`, `participantMemberRef` and `participantState`
  (`pending` or `accepted`).
- **Participation index** — `userDevelopment/{participantUid}/conversationParticipations/{conversationId}`
  with exactly `{ ownerUid, invitedAt }`. A locator only; it grants nothing alone.
- **Binding** — `participantMemberRef` stored on the conversation. Access requires
  the participant's *current* membership of `teamId` to carry the same `memberRef`
  (BR-21, CL-23).
- **Owner section** — `title`, `plannedFor`, `ownerNotes`, `nextSteps`,
  `sharedGoals`; written only by the owner.
- **Participant section** — `participantNotes`; written only by an accepted,
  eligible participant.
- **Goal snapshot** — `{ goalTitle, treeId | null, targetDate | null, status,
  capturedAt }`, a copy taken when the owner selects a goal. It never updates.
- **Access end** — any event after which the participant no longer has access
  (decline, leave, removal, cancelled invitation, ineligibility, completion-time
  withdrawal of a pending invitation). An access end never deletes or hides
  owner content (CL-21).
- **Recovery item** — `{ conversationId }` for an owner document that cannot be
  shown (BR-33).

Code constants (never configurable by request, setting or environment variable):

| Constant | Value |
|---|---|
| `CONVERSATION_LIMIT` | 100 owned conversations per owner, any status, malformed included |
| `PARTICIPATION_LIMIT` | 100 participation index entries per participant, pending included |
| `READ_WINDOW` | 100 items; each list reads `READ_WINDOW + 1` raw |
| `TITLE_MAX_CODE_POINTS` | 100 (also ≤ 400 UTF-8 bytes) |
| `NOTE_MAX_BYTES` | 4096 UTF-8 bytes for `ownerNotes` and `participantNotes` |
| `NEXT_STEPS_MAX_ITEMS` | 10 |
| `NEXT_STEP_MAX_CODE_POINTS` | 200 (also ≤ 800 UTF-8 bytes) |
| `SHARED_GOALS_MAX` | 5 |
| `CONVERSATION_BODY_MAX_BYTES` | 32768 (streamed cap, see BR-40) |

## Repository findings (verified 2026-10-14)

1. **D2 meaning is settled.** `docs/features/personal-development-goals/SPEC.md`
   "Label resolution (2026-10-11)", `docs/PRODUCT.md` "Future capabilities" and
   `docs/ROADMAP.md` (lines 310, 372) define D2 as check-ins/conversations, a
   two-party development interaction, sharing with leads or mentors, and `Samtaler`.
   The earlier "D1/D2 = role expectations" wording is historical and superseded.
2. **Role expectations are separate and unscheduled** (`docs/DATA-MODEL.md`,
   `docs/ROADMAP.md`). D2 does not use `roleDefinitions`.
3. **`checkIns` does not exist** (`docs/DATA-MODEL.md` line 136). D2 creates no
   `checkIns` collection.
4. **Leads have no personal-development access.** F0 `role: "lead"` (ARCHITECTURE
   member identity), C2's single capability (SECURITY 22/33), D1 SI-4 (SECURITY 40).
5. **Owner-subtree pattern.** `userDevelopment/{uid}/goals` is D1's subcollection
   and the reserved root for per-owner development data. The deny-only rule
   `match /userDevelopment/{document=**}` is recursive (`firestore.rules`), so
   `conversations` and `conversationParticipations` are covered. **No rules change.**
6. **`authorizeTeamAccess` is not an eligibility check.** It returns `"admin"` for an
   app admin with no membership (`authorize-team-access.ts`). D2 uses its own
   membership read (precedent: `resolveSurveyForParticipation`,
   `src/features/surveys/server/resolve-survey-for-participation.ts`).
7. **`memberRef` is the sanctioned client handle.** Granted fresh on every grant
   (`grant-team-membership.ts`, `generateMemberRef`), destroyed with the membership,
   unchanged by role changes (SECURITY 24–28). `resolveMemberRef`
   (`src/features/teams/domain/member-ref.ts`) resolves a ref against the team's
   already-read memberships, fails closed on malformed, cross-team or duplicate
   matches, and needs **no two-field query**.
8. **Selector source (superseded 2026-10-19).** The generic `GET /api/teams/[teamId]/assignable-members`
   (`list-assignable-members.ts`) is gated by `authorizeTeamAccess`, which admits an app admin who is not a member
   and an ordinary member of a disabled team. D2 does not use it for the owner's selector. The D2-owned read
   `GET /api/me/conversations/[conversationId]/selectable-members` (Amendment 2026-10-19) applies the BR-9 owner
   predicate instead. The server still re-checks the real membership on every invitation (BR-9).
9. **Name resolver.** `getDisplayNames(uids)` (`src/features/profiles/server/get-display-names.ts`)
   is the server-side name lookup used by the roster and planning selectors.
10. **Encryption helper.** `src/lib/encryption/encryption.ts`: AES-256-GCM,
    random 12-byte IV, key from `ENCRYPTION_KEY` read per call, `keyVersion`
    constant `"v1"`, **no key-version dispatch and no additional authenticated data**.
    It throws on missing/invalid key and on tampered payload. `ENCRYPTION_KEY` is
    already a runtime requirement for forum, anonymous challenges and surveys
    (`docs/DEVELOPMENT.md` env table); rotation is deferred (ARCHITECTURE).
11. **D1 owner store has a read by id.** `getDefaultGoalStore().get(ownerUid, goalId)`
    returns **raw, unvalidated** data or `undefined` (`goal-store-types.ts`).
    D1's static guard (`personal-goals-scope-guard.test.ts`) keeps an exact importer
    allow-list for the store module; a new importer needs an approved guard edit (CL-5).
12. **Personal navigation.** `src/components/nav/PersonalNav.tsx` renders
    `Ferdigheter · Mål`. `PersonalNav.test.tsx` line 46 asserts "has no Samtaler,
    role or placeholder entries", which D2 must change deliberately.
    `SiteHeader.test.tsx` line 212 asserts no `Samtaler` in the header; the header
    does not change in D2, so that test stays.
13. **Body-size precedent.** D1 reads request bodies as bytes with a streamed cap
    (`goal-request-body.ts`, `GOAL_BODY_MAX_BYTES = 4096`). D2 follows the pattern.
14. **Length/date precedent.** D1 target dates: `YYYY-MM-DD`, real calendar date,
    years 2020–2100 (`goal-target-date.ts`). D2 reuses the same rule as its own copy.
15. **Local env file.** `.env.local` (containing a real `ENCRYPTION_KEY`) is
    git-ignored by `.gitignore` (`.env*`). Not committed. It is not reproduced here.
16. **SECURITY numbering.** Invariants run 1–54 (`docs/SECURITY.md`). The mapping
    below is provisional and is assigned at closeout.
17. **Historical or superseded wording:** F0/C1/C2 "D1/D2" role-expectation text;
    `DATA-MODEL.md` `roleDefinitions (D1/D2)`; PRODUCT/UI-UX older "D2 = role
    expectations" paragraphs; ROADMAP "sharing with leads or mentors" (broader
    than this SPEC, see CL-2).

## Actors and access

| Actor | Can create | Can read | Can write | Notes |
|---|---|---|---|---|
| Owner | Yes (own) | Everything in own conversations | Owner section, participant, goal snapshots (open only), status, delete | Verified uid only |
| Invitee, pending | No | Pending view only (BR-14) | Accept or decline | No content, no notes, no goals |
| Accepted participant, eligible | No | Everything (BR-22) | `participantNotes` (open only); leave | Requires BR-21 |
| Accepted participant, ineligible | No | Nothing | Leave only | Access ended; see CL-21 |
| Team lead (not owner or participant) | No | No | No | Role confers nothing |
| Team member (not owner or participant) | No | No | No | Membership confers nothing |
| App admin (not owner or participant) | No | No | No | No admin route |
| Rejoined member | No | Only after a fresh invitation | No | Old binding dead (CL-23) |
| Unauthenticated | No | No | No | `401` |

## User stories

1. As a person, I want to prepare notes for a development conversation so that I
   can use them when we meet.
2. As a person, I want to invite one colleague I choose, so that nobody else sees
   the conversation.
3. As an invitee, I want to see only that I have been invited and by whom until I
   accept, so that I decide with the facts in front of me.
4. As a person, I want to share selected goals as they are at that moment, so that
   the other person sees a clear copy without my goal list.
5. As a participant, I want to leave at any time and have my own notes removed, so
   that I can always withdraw what I wrote.
6. As a person, I want to remove a participant, so that their access ends and their
   notes are removed.
7. As a person, I want to complete a conversation, so that its content is frozen.
8. As a person, I want the consequences of every sharing action stated before I
   confirm it.

## Behavioral requirements

### Initiation, creation, lifecycle

- **BR-1 Initiation.** Only the signed-in person creates a conversation. No lead,
  manager, mentor or admin can create, request or create on someone's behalf.
- **BR-2 Create.** `POST /api/me/conversations` takes `{ title, plannedFor?, teamId? }`
  and creates an `open` conversation with `status: "open"`, no participant and
  empty optional sections. `teamId` must be one of the owner's active memberships
  (BR-9) and is **immutable** after creation. A conversation without `teamId`
  can never have a participant.
- **BR-3 Team link.** `teamId` is the team in which a participant must be an
  eligible member. Existing owner access does not depend on team membership
  (BR-32).
- **BR-4 Lifecycle.** `status` is `open` or `completed`. The only transition is
  `open → completed` (BR-28). No draft, scheduled, cancelled or reopen state.
- **BR-5 Delete.** The owner may hard-delete a conversation in any status (BR-29).
  "Delete" is the only way to end a conversation without completing it. The copy
  and API never use "cancel" for it.
- **BR-6 Date.** `plannedFor` is `null` or `YYYY-MM-DD`: a real calendar date,
  year 2020–2100, past and future allowed, no time, no time zone, editable while
  `open`, frozen after completion. It is a label, not a schedule or reminder.

### Participant invitation and eligibility

- **BR-7 Cardinality.** Zero or one participant.
- **BR-8 Selection.** The owner selects a participant only by `participantMemberRef`
  from the owner's selectable-member read for `teamId` (`GET /api/me/conversations/[conversationId]/selectable-members`,
  Amendment 2026-10-19; the generic team endpoint is not used). That read is discovery only. The server reads the same
  bounded membership set (≤ 500, see BR-36), resolves the ref with `resolveMemberRef`, and
  rejects unknown, stale, cross-team, duplicate, self or ineligible refs with the
  same `invalid_participant`. If the list is truncated, members beyond 500 cannot be
  selected; the UI states this.
- **BR-9 Eligibility.** A candidate is eligible only if all hold: (a) exact
  `teamMemberships/{candidateUid}__{teamId}` exists; (b) `teams/{teamId}.status` is
  `active`; (c) candidate uid ≠ owner uid. `role`, lead status and app-admin status
  neither qualify nor disqualify. Eligibility is checked for the **owner** too:
  the owner must hold an active genuine membership of `teamId` at creation (BR-2)
  and at each invitation or replacement (BR-10).
- **BR-10 Invitation.** Setting a participant (`PATCH` with `participantMemberRef`)
  writes, in one transaction: `participantUid`, `participantMemberRef`,
  `participantState: "pending"`, `participantInvitedAt` on the owner document, and
  the index `userDevelopment/{candidateUid}/conversationParticipations/{conversationId}`
  with `{ownerUid, invitedAt}`. Allowed only while `open`. Replacing an existing
  participant (BR-16) performs the removal effects of BR-16 for the old one in the
  same transaction.
  Clarified 2026-10-17 (TASK-014): a successful invitation also advances the owner document's `updatedAt`, because it
  is a conversation mutation; rejected invitations change nothing, including `updatedAt`. Precedence: the participant
  is resolved and checked for eligibility (BR-8, BR-9) and the participation cap (BR-37) before the transaction, and
  the transaction then checks completion. So an invalid or ineligible selection returns `invalid_participant` even on a
  completed conversation, and a valid selection returns `conversation_completed`. Membership is not re-read at commit
  time: BR-21 is re-derived at every participant read and write, so a candidate who is removed after resolution gets no
  access, and the owner sees `unavailable` (BR-42). Commit-time freshness is therefore not required by BR-48, which
  re-reads the owner document for owner-initiated writes.
- **BR-11 Pending maximum.** Only one invitation can be pending per conversation;
  a pending invitation counts toward `PARTICIPATION_LIMIT` of its invitee.
- **BR-12 Pending invitations do not expire** in v1. The owner may withdraw a
  pending invitation at any time (BR-16); the invitee may decline (BR-17).
- **BR-13 Withdrawn at completion.** Completing a conversation with a pending
  invitation withdraws it in the same transaction (BR-16 effects, no content).
  No access can be created after completion.
- **BR-14 Pending view.** A pending invitee's `GET` returns only the pending DTO
  (BR-41). Any other caller, including an invitee whose invitation has gone,
  receives `conversation_not_found`.
  Clarified 2026-10-17 (TASK-015): the pending view depends only on the caller's index entry, the canonical plain owner
  shape and envelope structure, the caller's current membership with its memberRef binding, the team status and the
  roster-level owner name. It does not decrypt and needs no key probe, so an unreadable ciphertext does not by itself
  hide a structurally valid pending invitation. A completed conversation that still names a pending participant is not
  canonical (BR-13) and returns `conversation_not_found`.
- **BR-15 Accept.** `POST …/participation/accept` re-checks, in the transaction:
  the index exists for the caller; the owner document's `participantUid` is the
  caller; `participantState` is `pending`; BR-9 and BR-21 hold for the caller. It
  then sets `participantState: "accepted"` and `participantAcceptedAt`. Failure
  returns `conversation_not_found` (uniform).
  Clarified 2026-10-17 (TASK-016 review): a successful accept also advances the owner document's `updatedAt`, as a
  successful invitation does (BR-10). It reads no payload and needs no key, so it works during a key outage.

### Removal, replacement and leave (access ends)

- **BR-16 Owner removal or replacement (open or completed).** The owner may remove
  the participant (`participantMemberRef: null`) at any time, including after
  completion. A replacement is allowed only while `open`. Removal effects, in one
  transaction: delete the participation index at the old participant's path;
  clear `participantUid`, `participantMemberRef`, `participantState`,
  `participantInvitedAt`, `participantAcceptedAt`; **delete `participantNotes`**.
  Owner content (`title`, `plannedFor`, `ownerNotes`, `nextSteps`, `sharedGoals`)
  is unchanged. Access ends immediately. A replacement additionally writes the new
  pending invitation (BR-10).
- **BR-17 Self-leave or decline.** `DELETE …/participation` by the participant ends
  access (pending decline, accepted leave, or leave while ineligible). Effects equal
  BR-16 removal, and are allowed in `open` and `completed`. If the owner document
  does not name the caller, the call deletes only a stale index entry and returns
  `204` with no other effect. A caller with no index entry receives
  `conversation_not_found`.
  Clarified 2026-10-17 (TASK-016 review): a pending decline (`participantState: "pending"`) clears the binding, deletes
  the index and never probes, decrypts or rewrites the encrypted payload, so it works during a key outage. An accepted
  leave decrypts and re-encrypts the payload to delete `participantNotes` (IMPL-1). Both advance the owner document's
  `updatedAt`. A stale-index cleanup changes no owner document, so it does not advance `updatedAt`.
- **BR-18 Ineligibility is not removal.** When BR-21 fails for an accepted
  participant, access ends at once, but **nothing is deleted or hidden**. The
  owner sees `participant.state: "unavailable"` with the participant's notes still
  present, and the participant can still leave (BR-17), which deletes their notes.
  The owner's removal (BR-16) deletes them. (CL-21.)

### Owner content and participant writes

- **BR-19 Owner writes.** Only the owner writes owner sections, through
  `PATCH /api/me/conversations/[conversationId]`. The body is a strict allow-list:
  `title`, `plannedFor`, `ownerNotes`, `nextSteps`, `sharedGoalIds`,
  `participantMemberRef`, `status`. Unknown keys → `invalid_input` (code only: no field name is returned).
  A named key replaces that field whole. Absent keys are unchanged.
- **BR-20 Participant write.** Only an accepted, eligible participant writes
  `participantNotes`, through `PUT …/participant-notes` with body `{ notes }`.
  The value replaces the previous value (last write wins, no history). Empty string
  clears it. The participant writes no other field, and the owner cannot write
  `participantNotes`.
- **BR-21 Access check (participant).** Every participant read and write re-derives,
  in the same request: (a) the index exists at the caller's path and has a string
  `ownerUid`; (b) the owner document at that path exists and parses as valid;
  (c) its `participantUid` equals the caller and `participantState` is `accepted`
  (for content) or `pending` (for the pending view and for accept only); (d) `teams/{teamId}.status`
  is `active`; (e) `teamMemberships/{caller}__{teamId}` exists **and** its
  `memberRef` equals `participantMemberRef` on the owner document. Any failure ⇒
  `conversation_not_found` (BR-22 applies to leave only). The membership read
  never trusts `role`; it does not use `authorizeTeamAccess` (D2-SI-2).
- **BR-22 Full visibility after acceptance.** Once accepted and eligible, the
  participant sees every section: `title`, `plannedFor`, `ownerNotes`, `nextSteps`,
  `sharedGoals`, `participantNotes` (labelled as their own). The owner sees every
  section. No section is visible to one accepted party and hidden from the other
  (D2-SI-6). The participant sees the **current** owner content, not a version at
  acceptance time.
- **BR-23 Acceptance reveals earlier content.** Everything already written in the
  conversation becomes visible at acceptance, including `ownerNotes` written before
  the invitation. The pre-invitation copy states this (BR-38).

### Goal snapshots

- **BR-24 Selection.** The owner may set `sharedGoalIds` (≤ 5, unique, each a
  canonical goal id) only while `open`. The server reads each id through D1's
  owner store with the verified owner uid (`get(ownerUid, goalId)`, CL-5). An
  unknown id, malformed id, duplicate, or read of an absent goal rejects the whole
  request with `invalid_goal_selection`. A **malformed stored goal** is a selected raw
  D1 goal whose D2 snapshot projection (`title`, `status`, `treeId`, `targetDate`,
  validated by D2's snapshot rules in CL-5 and TASK-008) is missing, malformed or
  incompatible with the snapshot contract; it also rejects with
  `invalid_goal_selection`. Failure of any other D1 storage invariant (`createdAt`,
  `updatedAt`, `completedAt`, unknown raw keys) does not by itself make the projection
  invalid, so such a goal is selectable when its projection is valid. An operational
  read failure rejects with `persistence_failed`, never `invalid_goal_selection`.
  Nothing is written.
- **BR-25 Snapshot content.** Each selected goal yields exactly
  `{ goalTitle, treeId | null, targetDate | null, status, capturedAt }`, where
  `goalTitle` is the goal's title, `treeId` the D1 `treeId` if present, `targetDate`
  the D1 date if present, `status` the D1 status at capture, and `capturedAt` the
  server time at capture. Snapshots are stored **only** inside the encrypted
  `sharedGoals` array (CL-18). The request never carries title, status, or date.
- **BR-26 Snapshot semantics (canonical).** A snapshot is a copy. It does not change
  when the D1 goal is edited, completed, reopened or deleted, and it persists after
  those events until the owner changes the set. No goal id is stored, so no
  participant-visible pointer to D1 exists. Area name is resolved at read from the
  global SkillTree catalog, and shows "area unavailable" if the tree is missing or
  invalid (BR-45).
- **BR-27 Snapshot revocation.** While `open`, setting `sharedGoalIds` replaces the
  whole set atomically; a removed snapshot is gone from the next read for both
  parties, with no history kept. After completion, `sharedGoalIds` may only be
  `[]` (clear). Any non-empty set is rejected with `conversation_completed`. Precedence
  (clarified 2026-10-17, TASK-013): a non-empty selection is validated through BR-24 first, so an
  invalid selection returns `invalid_goal_selection` even on a completed conversation; a valid
  selection then returns `conversation_completed`. An empty clear has no selection to validate and
  is checked only against the transactional status. Clearing
  is revocation, not a content change. A participant removal (BR-16) also ends
  access to all snapshots.

### Completion, deletion and historical access

- **BR-28 Completion.** Only the owner completes, through
  `PATCH` with `status: "completed"`, with no participant consent. The transaction
  sets `status: "completed"` and `completedAt`, and withdraws any pending invitation
  (BR-13). After completion, these are frozen: `title`, `plannedFor`, `ownerNotes`,
  `nextSteps`, participant identity (may be removed, not replaced or added), and
  `sharedGoals` (clear only, BR-27). `participantNotes` is frozen against writes
  (BR-20). Completing an already completed conversation returns `invalid_transition`.
- **BR-29 Delete.** The owner's `DELETE` is a Firestore transaction that deletes the
  owner document and, if `participantUid` is readable, the index at that path. It
  reads only plain fields (no decryption), so it works on malformed content. An
  orphaned index (owner document already absent) is inert: BR-21 fails and
  BR-17 removes it on the participant's next leave. No tombstone.
- **BR-30 Historical access.** The owner reads a completed conversation always. A
  participant reads it only while BR-21 holds, which requires active team
  membership with a matching binding. There is no historical exception for former
  members.
- **BR-31 Team status effects.** A disabled team ends participant access (BR-21(d))
  and nothing else. Owner access is unaffected. Reactivation restores participant
  access automatically if the binding still matches (state-based, no event). The
  owner keeps the ability to remove the participant at any time.
- **BR-32 Owner membership changes.** An owner who leaves the team keeps full access
  to their conversations, may still edit while open, complete and delete. The owner
  cannot add or replace a participant without an active membership (BR-9).

### Reads, lists and recovery

- **BR-33 Owner list and recovery.** `GET /api/me/conversations` reads
  `userDevelopment/{uid}/conversations` with `orderBy createdAt desc`,
  `limit(READ_WINDOW + 1)`. `truncated = raw > READ_WINDOW`. Each valid document is
  decrypted and mapped to the owner summary. A document that is structurally invalid,
  has an unknown status, or whose payload fails authenticated decryption appears as
  `{ conversationId }` (recovery item, delete-only). Documents without `createdAt`
  are found by a bounded `select("createdAt")` scan of the subcollection
  (`limit(READ_WINDOW + 1)`, modelled on D1 BR-58; pattern reuse, not an import).
- **BR-34 Participant list.** The same response includes the caller's
  participations: `userDevelopment/{caller}/conversationParticipations`,
  `orderBy invitedAt desc`, `limit(READ_WINDOW + 1)`. Each index entry is verified
  with BR-21 (pending or accepted) before it is shown. Entries that fail are omitted
  with no placeholder, and no malformed index entry is revealed.
- **BR-35 Detail.** `GET …/[conversationId]` returns the owner view for the owner,
  the participant view for a verified accepted participant (BR-21), the pending
  view for a verified pending invitee (BR-14), and otherwise `conversation_not_found`.
  An owner-side undecryptable document returns `conversation_not_found` on detail;
  it is recoverable in the list (BR-33).
- **BR-36 Bounded reads.** Every read is a point read or a `limit(READ_WINDOW + 1)`
  subcollection query. The owner list performs one decrypt per window item. The
  participant list performs at most `READ_WINDOW + 1` index reads, then per entry
  one owner document read, one membership read and one team read, deduplicated per
  team within the request (accepted cost, see the known limitations). No `collectionGroup`, no
  unbounded `getAll`, no list without a limit.
- **BR-37 Caps.** Create is rejected with `conversation_limit` when the owner's
  total count (`count()` aggregation over all owned documents, any status,
  malformed included) is already `CONVERSATION_LIMIT`. Invitation is rejected with
  `invalid_participant` when the candidate's index count (any status) is already
  `PARTICIPATION_LIMIT`. Both counts are count-then-create, so a small overshoot
  under concurrency is accepted (as in D1). Deleting a conversation frees capacity.

### Presentation, validation and copy

- **BR-38 Privacy copy.** Before inviting, the UI states, in Norwegian: who can see
  the conversation; that the invitee sees only the invitation until accepting; that
  on acceptance everything in the conversation becomes visible, including notes
  written before the invitation; that the participant sees the current version of
  owner content; that the participant can leave at any time and their notes are then
  deleted; that if they leave the team they lose access; and that no lead or admin can
  see it. Before sharing goals, the UI states that snapshots are copies taken now,
  that they do not update, and that changing the set changes what the participant
  sees. Before completion, the UI states that content becomes read-only for both
  parties, and that a pending invitation is withdrawn. Before deletion, the UI states
  that the conversation and any participant access are removed and nothing is kept.
- **BR-39 Input rules.** Titles and next steps: NFC-normalised and trimmed, no
  control or line/paragraph separator characters, code-point and UTF-8 byte caps
  (constants). Notes: plain text, UTF-8 byte cap, no Markdown or HTML parsing.
  Every stored text field is inert text. Next steps: 0–10 non-empty items.
  Invalid input → `invalid_input` (code only: no field name is returned, see Stable errors).
- **BR-40 Body size.** Conversation request bodies are read as bytes with a streamed
  cap of `CONVERSATION_BODY_MAX_BYTES` (32 KiB, the sum of the maximum encoded
  fields plus JSON overhead). A body over the cap is rejected with
  `payload_too_large` before parsing.
- **BR-41 Pending DTO.** `{ conversationId, state: "pending", teamName, invitedAt,
  ownerDisplayName }`. `ownerDisplayName` is resolved server-side with
  `getDisplayNames` for the owner uid **only if** the owner holds an active genuine
  membership of `teamId` (the same name-only, same-team rule as the roster,
  invariant 21). Otherwise it is `null` and the UI shows the neutral "En kollega".
  No title, section, goal, plannedFor, status or any other content is returned.
  Clarified 2026-10-17 (TASK-015): `teamName` is required and never `null`. A missing or malformed team name, and a
  failed team or owner-name read, return `persistence_failed`, and the result never distinguishes missing from malformed.
  Team data corruption is not evidence that the invitation is absent, so it is not `conversation_not_found`.
- **BR-42 Owner DTO.** `{ conversationId, title, status, plannedFor, teamId | null,
  participant: { state: "none" | "pending" | "accepted" | "unavailable",
  displayName: string | null }, ownerNotes, nextSteps, participantNotes, sharedGoals:
  [{ goalTitle, areaName, targetDate, status, capturedAt }], createdAt, updatedAt,
  completedAt }`. `displayName` comes from `getDisplayNames` for the participant uid
  when the participant has an active membership (otherwise `null`). `"unavailable"`
  applies when a participant is bound but BR-21 fails. The owner DTO carries **no**
  `memberRef`, uid, e-mail or membership id.
- **BR-43 Participant DTO.** `{ conversationId, title, status, plannedFor, teamName,
  ownerDisplayName, ownerNotes, nextSteps, participantNotes, sharedGoals (as BR-42),
  createdAt, updatedAt, completedAt }`. `participantNotes` is the caller's own text.
  `ownerDisplayName` follows the BR-41 rule. No owner uid, no participant uid, no
  `memberRef`, no e-mail, no membership id.
- **BR-44 List DTOs.** Owner summary: `{ conversationId, title, status, plannedFor,
  participant: { state, displayName }, sharedGoalCount, createdAt, updatedAt }`.
  Participant summary: `{ conversationId, state: "pending" | "accepted", title | null,
  teamName, invitedAt }` where `title` is `null` while pending. Recovery item:
  `{ conversationId }`. Name lookups are batched per list, bounded by ≤ 101 uids.
- **BR-45 Area names.** A snapshot's `areaName` is the catalog name for its `treeId`,
  read at response time from the global SkillTree catalog (org-wide, not personal).
  A missing or invalid tree gives `areaName: null` and the UI shows "area unavailable".
  The catalog read is bounded and performed by D2's own minimal reader (D1 pattern).
- **BR-46 Forbidden fields.** No DTO, error or stored field contains a score, rating,
  rank, progress percentage, "on track" state, level, performance or manager/lead/
  admin marker, read receipt, last-viewed time, activity count, another party's uid,
  e-mail, membership id or `memberRef` (owner or participant), or any admin/lead
  flag.

### Failure and concurrency

- **BR-47 Stable errors.** Table in "Stable errors". Responses never reveal whether
  an id exists for someone else, whether a candidate is a member elsewhere, whether a
  candidate is a lead or admin, or any Firestore, encryption or stack detail.
- **BR-48 Transactions.** Every lifecycle transition (invite, replace, remove,
  accept, decline, leave, complete, delete) and every write that touches both the
  owner document and an index is one Firestore transaction. Each transaction
  re-reads the owner document and, for participant-initiated writes, the caller's
  membership and team, and checks preconditions inside the transaction.
- **BR-49 Section writes.** Owner section writes are last-write-wins per field.
  Participant `participantNotes` writes are last-write-wins. No write touches the
  other role's section.
- **BR-50 Race outcomes.** (1) Complete vs participant write: whichever commits
  first wins; the loser sees `conversation_completed`. (2) Revoke vs participant
  write: the write transaction re-reads the binding; if it fails, the write fails
  with `conversation_not_found` and cannot recreate `participantNotes`. (3) Accept
  vs owner replacement or removal: the accept transaction re-reads
  `participantUid` and `participantState`; the loser fails with
  `conversation_not_found`. (4) Snapshot change vs completion: the goal reads
  happen before the transaction; the transaction re-checks `status` and fails with
  `conversation_completed` if completed. (5) Delete vs any write: the write
  transaction re-reads the document; a deleted document yields
  `conversation_not_found`. (6) Invite vs delete: the invite transaction fails
  with `conversation_not_found` if the owner document is gone.

### Security-relevant data rules

- **BR-51 Encrypted content.** The `content` payload encrypted with the existing
  helper is exactly `{ title, ownerNotes, nextSteps, participantNotes, sharedGoals }`
  (CL-18). Plain fields are exactly sixteen keys: `teamId`, `participantUid`,
  `participantMemberRef`, `participantState`, `participantInvitedAt`,
  `participantAcceptedAt`, `plannedFor`, `status`, `completedAt`, `createdAt`,
  `updatedAt`, `ciphertext`, `iv`, `authTag`, `keyVersion`, `keyCheck`. Plain fields
  are never free text.
  - **`keyCheck` (CL-27).** Plaintext, non-secret structural metadata, present in every
    canonical conversation document. Its exact derivation: HMAC-SHA-256 with the
    decoded 32-byte configured `ENCRYPTION_KEY` as the HMAC key and the UTF-8 bytes of
    the fixed context `devpulse.d2.conversation-key-check.v1` as the message. The
    stored value is the standard padded base64 of the 32-byte output. The context is
    versioned, so changing it changes every stored `keyCheck`. Its only purpose is to
    detect a configured-key mismatch before a document is classified (BR-53). It is
    not the key, not a reversible encoding of the key, not a hash of user content, not
    an authorization token, not an identity or `memberRef`, and it grants no access.
    Its only inputs are the configured key and the fixed context: no title, note,
    goal, participant, uid, `memberRef`, `teamId`, `conversationId` or ciphertext is
    an input. It is identical in every document written under the same key, so it
    reveals only that documents share a key. It is never returned in any DTO, error or
    log. Its stored form is validated without any key (canonical base64, exactly 32
    decoded bytes). Only the codec compares it with the configured key (TASK-003).
    AES-GCM authentication still decides whether each payload is readable. `keyCheck`
    is never a replacement for it.
- **BR-52 Plaintext rule.** No title, note, next step, goal title or snapshot text
  is written to Firestore outside the encrypted payload, logged, or placed in an
  error body.
- **BR-53 Key outage and key mismatch are not malformed documents.** Before any list
  or detail decryption, the codec verifies the configured key inside the request in
  two steps. (1) A probe: one `encrypt` of a fixed probe value whose output is
  discarded and never stored. It detects a missing or invalid key. (2) For each
  document about to be decrypted, the stored `keyCheck` is compared with the value
  derived from the configured key (BR-51). Each stored document then falls into
  exactly one class:
  1. **Malformed document.** The plain shape, envelope or `keyCheck` form is invalid
     (checked without any key). Malformed under BR-33: recovery item, delete-only.
  2. **Configured-key mismatch.** The `keyCheck` is structurally valid but does not
     match the configured key. Operational failure: `persistence_failed` for the whole
     request. It is not malformed, not `unreadable_payload`, not a recovery item and
     not a delete candidate.
  3. **Authentication failure.** The `keyCheck` matches, but AES-GCM authentication
     fails for this document. `unreadable_payload`, eligible for owner recovery
     (BR-33).
  4. **Missing, invalid or underivable key.** There is no configured key, the key is
     invalid, or the expected `keyCheck` cannot be derived. Operational failure:
     `persistence_failed` for the whole request. Not malformed, not
     `unreadable_payload`, not a recovery item.
  5. **Malformed decrypted payload.** The `keyCheck` matches and authentication
     succeeds, but the decrypted payload fails the content rules. Malformed under
     BR-33 (payload semantics). It is not a key outage.

  A key outage or mismatch never produces recovery items or a partial list. Delete
  (BR-29) never decrypts or compares `keyCheck`, so it stays available during a key
  outage.

## Edge cases and failure behavior

- Participant's team disabled → access ends (BR-31); owner sees `unavailable`
  with notes still present (BR-18).
- Participant removed from team, later re-added → new `memberRef` (grant
  primitive); the stored binding no longer matches, so access does not return
  (BR-21(e), CL-23). The owner must invite again.
- Participant's role changes (lead promotion/demotion) → memberRef unchanged;
  access unaffected (BR-9).
- Participant is also an app admin → treated as the membership only (BR-9).
- Owner leaves team → owner unaffected (BR-32). Participant access depends only on
  the participant's own membership.
- Owner is removed from the team then later re-added → owner access was never
  team-scoped; nothing changes.
- Participant deletes their Firebase account → `verifyIdToken` fails; no access.
  Index and binding stay until the owner removes the participant or the conversation
  is deleted (no erasure flow, known limitation).
- Owner invites self → `invalid_participant`.
- Snapshot's tree removed → `areaName: null` (BR-45).
- Index present, owner document missing → participant sees `conversation_not_found`
  and the entry is omitted from the list (BR-34). Orphan cleared on leave (BR-17).
- Owner document names the caller, but the index is missing → participant cannot
  locate it (`conversation_not_found`). Owner removal re-syncs the state and deletes
  the index if present. The owner sees "accepted/pending" until then (a known,
  narrow inconsistency documented here; no event can heal it automatically).
- Index says `ownerUid` A, owner document under A names a different participant →
  BR-21(c) fails; `conversation_not_found`.
- Owner document undecryptable (tag failure) → owner list recovery item; participant
  side `conversation_not_found`.
- **Encryption key unavailable** (missing or invalid `ENCRYPTION_KEY`) → every
  conversation request returns `persistence_failed` (500). The list never converts
  a key outage into recovery items (BR-53).
- Window exceeded → only a window is examined; caps (BR-37) make it unreachable
  except under concurrency overshoot.

## Security and privacy

Feature-specific implications of `docs/SECURITY.md`. Proposed invariants,
numbered D2-SI-1…D2-SI-18 here. Provisional mapping to SECURITY 55–72, assigned
at closeout from the then-current file (**Closeout**).

- **D2-SI-1 Verified subject.** Every request derives the caller uid from the verified
  token. No path, query or body carries `uid`, `ownerUid`, `participantUid`, or a
  membership id. The `teamId` in a body is a choice of team, not an authority: it is
  checked against the owner's real membership (BR-2, BR-9).
- **D2-SI-2 Authorization.** Content is accessible only to the owner, or to a
  participant passing BR-21 (index + authoritative owner document + active team +
  current genuine membership + matching binding). `authorizeTeamAccess`,
  `resolveTeamRole`, `requireAppAdmin` and `isAppAdmin` are never used for D2 access.
  `memberRef` is an equality check on an authorization established independently
  by the verified uid and a genuine membership read; it grants nothing alone (CL-23).
- **D2-SI-3 Explicit consent.** No participant content is returned before an accept
  that re-checks BR-15. Participation starts only with the owner's choice and the
  invitee's acceptance.
- **D2-SI-4 Narrow participant model.** At most one participant, from the owner's team,
  by opaque reference. No lead-initiated, admin-initiated, cross-team or
  role-derived participant. Role, lead status and admin status are never inputs.
- **D2-SI-5 Explicit sharing.** Participants receive only owner-selected snapshots.
  They never read D1 goals or goal ids. No C1 level, skill profile, C2 output,
  roadmap item or `skillProgress` enters D2. D2 never writes these.
- **D2-SI-6 No hidden content.** After acceptance, both parties see every owner and
  participant section (BR-22). No owner-only, participant-only, lead-only or
  admin-only section or field exists. Server-side metadata (`ownerUid`, `participantUid`,
  states, timestamps) is administrative state, not assessment content.
- **D2-SI-7 Single-writer sections.** Owner writes owner sections; participant writes
  `participantNotes`. No write crosses roles (BR-19, BR-20, BR-49).
- **D2-SI-8 Access ends are immediate and independent of content.** Decline, leave,
  removal, replacement, withdrawal, team disablement and ineligibility end access on
  the next request. Only the participant's own leave and the owner's removal delete
  `participantNotes` (CL-21). Ineligibility never deletes or hides content.
- **D2-SI-9 Completion freezes content, never access.** After completion the owner
  can still remove the participant, the participant can still leave, the owner can
  clear snapshots and delete. What is frozen is content and additions (BR-28, BR-27).
- **D2-SI-10 Historical access equals current eligibility.** No exception keeps a former
  member able to read a conversation (BR-30).
- **D2-SI-11 Application-layer encryption.** Named free-text fields are encrypted with
  the existing AES-256-GCM helper on the server (CL-18). This is **not** end-to-end
  encryption and **not** zero-knowledge: the server, and anyone with the
  `ENCRYPTION_KEY`, can decrypt, and both accepted parties receive plaintext through
  the API by design. No plaintext free text is stored, logged or returned in error
  bodies (BR-51, BR-52).
- **D2-SI-12 Bounded reads and bodies.** Every read is bounded (BR-36). Every body is
  capped (BR-40). No `collectionGroup` query, no export, no unbounded history.
- **D2-SI-13 Malformed data and key outage.** A malformed owner document (including a
  missing or structurally invalid `keyCheck`) is visible to the owner only as
  `{ conversationId }`, delete-only. A malformed index entry is invisible. A missing,
  invalid or mismatched encryption key is never treated as a malformed document or a
  recovery candidate (BR-53, CL-27). No ciphertext, key identifier, `keyCheck`,
  decryption error text or stored field name is returned.
- **D2-SI-14 DTO minimisation.** DTOs are explicit allow-lists (BR-41…BR-44). The owner
  never sees the participant's `memberRef` or uid. Names are shown only by the
  roster rule (BR-41/BR-42/BR-43, invariant 21): an active same-team membership,
  name only, no lookup key.
- **D2-SI-15 Failure suppression.** Missing, inaccessible, non-participant, ineligible,
  unbound and foreign ids all return `conversation_not_found`. `invalid_participant`
  does not distinguish member-elsewhere, lead, admin, cross-team, self, cap or stale.
  `invalid_goal_selection` does not distinguish malformed from absent.
- **D2-SI-16 Non-interference.** D2 writes no `userDevelopment` goal, no `skillProfiles`,
  `teamSkillNeeds`, `roadmapItems`, `skillProgress`, `userProfiles` or membership
  document. It reads membership only for BR-9/BR-21, and D1 goals only for BR-24.
- **D2-SI-17 No performance or surveillance surface.** No score, rating, rank, progress,
  activity, read receipt, last-viewed time, lead dashboard, team aggregate or
  cross-conversation summary. No notifications (CL-24).
- **D2-SI-18 No admin or lead route.** No admin endpoint, no lead endpoint, no
  support or recovery path. Operational support, if ever needed, is a separate SPEC.

Logging: no title, note, goal title, uid, `memberRef`, index path or conversation id
is logged. Errors log the stable code only.

Known, accepted limitations (to record in SECURITY at closeout): no account-deletion
flow, so content can outlive a deleted Firebase account; operators with Admin SDK
access can read and decrypt content (not a product entitlement); the key is a single
environment key with no rotation (no key-version dispatch), so key loss makes
content unrecoverable and rotation requires a separate migration; the ciphertext
carries no additional authenticated data, so an operator with database write access
could move ciphertext between documents undetected (accepted residual risk); an
ineligible participant's notes remain visible to the owner until removal (CL-21);
a team membership removal does not itself delete participant notes; name display
follows the roster rule; no invitation rate limit beyond the participant cap; the
participant list verifies each entry with up to three point reads (owner document,
membership, team, deduplicated per team), so one list call costs up to about three
hundred point reads at the window limit, a bounded but non-trivial cost. The owner list
verifies each bound participant with an index read and an owner read per item (BR-21),
and shares the team status and membership reads for the request (one memo per call, raw
reads only; every item still makes its own binding decision), so its worst case at the
owner cap is about seven hundred point reads (six hundred from the owner reads, plus up to one hundred profile
reads inside the single display-name call) and about two hundred query-returned documents (see
`docs/features/development-conversations/TASKS.md`, TASK-023). These are operation counts, not an exact billing figure.

## Architecture decisions

| ID | Decision | Status |
|---|---|---|
| AD-1 | Module `src/features/development-conversations/` with `domain/`, `server/`, `client/`, `components/`, `copy.ts`. Imports: `auth` verification, `lib/encryption`, `lib/firebase/admin`, `components/ui`, the **D1 goal store module** (CL-5), `profiles/server/get-display-names`, the pure `teams/domain` membership helpers and the `skill-trees` pure predicate. Imports nothing from `skill-profiles`, `team-skills`, `roadmap`, `results`, `forum`, `surveys`, `challenges`, or `authorizeTeamAccess`. | Locked |
| AD-2 | Persistence: `userDevelopment/{ownerUid}/conversations/{conversationId}` (owner) plus `userDevelopment/{participantUid}/conversationParticipations/{conversationId}` (index). | Locked |
| AD-3 | Conversation ids: Firestore auto ids, validated as path segments by `^[A-Za-z0-9_-]{1,128}$` with no `.`, `/` or `__`; a malformed id on a content route returns `conversation_not_found`. | Locked |
| AD-4 | Participant authorization re-derives BR-21 on every request. No cached, session or client-held decision. | Locked |
| AD-5 | Encrypted payload per BR-51, using the existing helper (CL-18), via one codec module: `encodeContent`, `decodeContent`, with explicit failure classes. | Locked |
| AD-6 | Snapshot set replaced atomically on each `sharedGoalIds` write (BR-24/27). | Locked |
| AD-7 | Name display via `getDisplayNames` only under the roster rule (BR-41…BR-43), in one new call site inside D2's server module. This is **not** a new by-uid endpoint; no route exposes it. | Locked (Approval; invariant 21 wording at closeout) |
| AD-8 | Personal navigation gains `Samtaler` by an additive change to the shared `PersonalNav` component and its test; the header is unchanged. | Locked |
| AD-9 | Indexes: none (see Index impact). | Locked |
| AD-10 | Rules: no change; recursive deny rule covers both subcollections. | Locked |
| AD-11 | Selection and validation of a participant use a D2-owned, owner-only, discovery-only read (`GET /api/me/conversations/[conversationId]/selectable-members`, Amendment 2026-10-19) and the write path's `resolveMemberRef` re-check. Both read the same bounded `teamMemberships where teamId ==` window (no new query shape, index or rule). The generic team endpoint is not used. **Amended 2026-10-19 (TASK-029 I-1, Option B).** | Locked (amended) |
| AD-12 | Participant list verification dedupes team and membership reads per request. | Locked |

## Test boundaries

| Boundary | Covers |
|---|---|
| Server operations with fake owner/index store, fake membership and team reader, fake D1 goal store, fake clock and fake encryption key: create, list, detail, owner patch, participant notes, accept, decline, leave, replace, remove, complete, delete | BR-1…BR-32, BR-33…BR-37, BR-47…BR-50 |
| Authorization matrix: owner, pending invitee, accepted eligible, accepted ineligible, lead, member, lead+admin, non-member admin, former member, rejoined member, unrelated user, unauthenticated | BR-1, BR-9, BR-14, BR-21, BR-35, D2-SI-2…4, D2-SI-10 |
| Access-ends vs content: removal, leave, ineligibility, withdrawal, completion-time withdrawal, replacement; notes deleted only on leave and removal | BR-16…BR-18, BR-28, D2-SI-8 |
| Completion freezes content, not access: removal after completion, leave after completion, snapshot clear after completion, delete | BR-27, BR-28, D2-SI-9 |
| Index and authority matrix: missing index, orphan index, stale index pointing at another participant, index without `ownerUid`, owner document missing, owner names caller but index missing | BR-17, BR-21, BR-34, D2-SI-2 |
| Persistence adapter (Firestore double): path shape, transaction atomicity of owner and index writes, `count()` caps, `select("createdAt")` scan, window limits, delete without decryption | BR-29, BR-33, BR-36, BR-37, BR-48 |
| Codec: encrypt and decrypt round-trip; tampered ciphertext throws mapped failure; configured-key mismatch against a stored `keyCheck` → `persistence_failed`, never an authentication failure; missing key → `persistence_failed`; `keyCheck` derivation vector and domain separation; stored document contains no plaintext substring | BR-51, BR-52, BR-53, D2-SI-11, D2-SI-13 |
| Route handlers (`app/api/me/conversations/**`): auth, body allow-lists, unknown keys, body cap (`payload_too_large`), stable codes, no uid/ownerUid/participantUid in path, query or body | BR-2, BR-19, BR-20, BR-40, BR-47, D2-SI-1 |
| DTO allow-lists: owner, participant, pending, list summaries, recovery; forbidden-field scan | BR-41…BR-46, D2-SI-14 |
| Name rule: owner name shown only with an active same-team membership; `null` otherwise | BR-41, BR-43 |
| Failure suppression: identical `conversation_not_found` across cases; `invalid_participant` and `invalid_goal_selection` uniform | BR-8, BR-24, BR-47, D2-SI-15 |
| Selectable-member read (Amendment 2026-10-19): owner eligibility matrix (genuine owner; app-admin non-member; app-admin with removed membership; ordinary member of a disabled team; app-admin member of a disabled team; ordinary non-member; non-owner; no team; completed; malformed owner; key and read failures), bounded window and raw-slot semantics, malformed and duplicate-ref rows, exact DTO keys, no uid or e-mail, names only after owner eligibility, no generic-endpoint fallback, PATCH still revalidating | I-1, BR-8, BR-9, BR-41, AD-11, D2-SI-2, D2-SI-14, D2-SI-15 |
| Concurrency (fake transactions): each race in BR-50 | BR-48…BR-50 |
| Goal snapshot: selection from owner's goals only; malformed and absent goals rejected whole; snapshot survives goal edit, completion, reopen and deletion; no goal id stored | BR-24…BR-26 |
| Non-interference: no `skillProfiles`, `teamSkillNeeds`, `roadmapItems`, `skillProgress`, `userProfiles` or membership write; no D1 goal write | D2-SI-5, D2-SI-16 |
| Static scope guard `development-conversations-scope-guard.test.ts` (change detection, not a security boundary): allowed importers, collection names, forbidden concepts, DTO key sets, no `collectionGroup` | D2-SI-16, D2-SI-17 |
| D1 guard amendment test: the single approved D2 importer of the goal store is added to D1's allow-list and no other file | CL-5 |
| Client and UI: pending view, accepted view, owner editor, participant notes, goal selector limit, completed lock, removal and delete confirmations, privacy copy, forbidden-term absence, keyboard and labels | BR-38, BR-41, D2-SI-6 |
| `PersonalNav` test: `Samtaler` present with exact `aria-current`; no other nav change | AD-8 |
| Firestore rules test (emulator): owner, participant and anonymous client access denied on both subtrees | AD-10, D2-SI-1 |

## Acceptance criteria

- [ ] An owner creates an open conversation with a title and no participant; no `teamId` is required.
- [ ] A `teamId` is accepted only when the owner holds an active genuine membership, and cannot change afterwards.
- [ ] A candidate who is not an eligible genuine member, is the owner, is in an inactive team, or is an app admin without membership, is rejected with `invalid_participant`.
- [ ] The owner's invitation writes the pending state and the index in one transaction.
- [ ] A pending invitee receives only the pending DTO; no title, section, goal, date or content is returned.
- [ ] Acceptance requires the invitee's explicit request and re-checks BR-15; after acceptance the invitee sees every section.
- [ ] A participant writes only `participantNotes`; an owner-section write from a participant is rejected.
- [ ] The owner writes no `participantNotes`.
- [ ] Goal snapshots are copies: editing, completing, reopening or deleting the D1 goal does not change them; no goal id appears in any stored or returned field.
- [ ] Owner removal and participant leave delete `participantNotes` and the index in one transaction; the participant's next request returns `conversation_not_found`.
- [ ] Ineligibility ends access without deleting or hiding content: the owner sees `unavailable` and the notes; the participant sees nothing; the owner removal then deletes the notes.
- [ ] Completion withdraws a pending invitation and freezes owner content, participant notes and goal additions.
- [ ] After completion the owner can still remove the participant, clear snapshots and delete; the participant can still leave.
- [ ] A participant removed and re-added (new `memberRef`) cannot read or write without a new invitation.
- [ ] A lead or app admin who is not the owner or a bound participant gets `conversation_not_found`, indistinguishable from an unrelated user.
- [ ] A completed conversation stays readable by the owner; the participant reads it only while BR-21 holds.
- [ ] Each list reads at most `READ_WINDOW + 1` raw items and sets `truncated` correctly.
- [ ] A malformed owner document appears only as `{ conversationId }`; a malformed index entry is never shown; a key outage or configured-key mismatch yields `persistence_failed`, never recovery items.
- [ ] A body above 32 KiB is rejected with `payload_too_large` before parsing.
- [ ] No DTO, error or log contains a uid, e-mail, membership id, `memberRef`, title, note or goal title outside the caller's authorized view. The owner name appears only under the roster rule.
- [ ] No title, note, next step, goal title or snapshot text is stored outside the encrypted payload.
- [ ] No `skillProfiles`, `teamSkillNeeds`, `roadmapItems`, `skillProgress`, `userProfiles` or D1 goal document is written by D2.
- [ ] No score, rating, rank, progress, read receipt, last-viewed or activity field exists.
- [ ] `firestore.indexes.json` and `firestore.rules` are unchanged.
- [ ] The repository's `package.json` checks (lint, typecheck, tests) pass when run, and the actual `git diff` is inspected.

## Open questions

None. Every decision required for implementation is locked in this SPEC. The
review's OQ-1…OQ-5 are resolved as recorded in "Decisions locked by review" and
CL-19…CL-26.

## Decisions locked by review

These supersede the earlier draft's OQ and CL text.

- **OQ-1 Acceptance is required.** Locked (BR-14, BR-15, D2-SI-3). The alternative
  of immediate access is rejected: it places a person into content without consent.
- **OQ-2 Ineligibility and departure.** Locked as **CL-21**. A loss of access never
  deletes or hides content. Only two acts delete `participantNotes`: the participant's
  own leave (BR-17) and the owner's removal (BR-16). Ineligibility keeps the notes
  visible to the owner until one of those acts. Rationale: this keeps "access ended"
  separate from "content disappeared", avoids a hidden-content state that conflicts
  with D2-SI-6, and gives the participant a direct way to withdraw their own words
  (BR-17 works while ineligible). The rejected alternative (withhold from both)
  creates a state where the owner cannot see text they already read and cannot
  explain its absence.
- **OQ-3 Owner-private notes.** Locked as **CL-22**: none. The former "preparation"
  and "discussion" sections are merged into one `ownerNotes` field, shown to an
  accepted participant. UI labels say so. The name "preparation notes" is retired
  because it implied privacy the system does not provide.
- **OQ-4 `memberRef` as binding.** Locked as **CL-23**. `memberRef` is an equality
  check between the value stored when the owner invited the participant and the
  participant's current membership value. It proves nothing about identity and
  authorizes nothing alone (BR-21, D2-SI-2). Membership removal destroys the
  reference and a new grant creates a new one, so a rejoined member does not inherit
  access. A role change does not change it, so role changes do not change access.
  Closeout: invariant 25 keeps its "grants nothing" meaning and gains the sentence
  "it may serve as an equality check on an authorization established independently"
  (Approval).
- **OQ-5 Notifications and expiry.** Locked as **CL-24**: no notifications and no
  invitation expiry in v1. Pending invitations stay until the owner withdraws or the
  invitee declines (BR-12). Cost accepted: an invitation can go unseen.
- **CL-5 D1 goal read.** Locked. D2's single snapshot module reads D1 goals through
  `getDefaultGoalStore().get(ownerUid, goalId)`, validates the raw result with D2's
  own snapshot validator, and never imports D1 domain, client or route code. The
  snapshot validator checks only the projection the snapshot carries (`title`,
  `status`, `treeId`, `targetDate`; BR-24, BR-25). It does not re-run D1's complete
  BR-35 storage invariants, so D2 never duplicates the D1 parser. The snapshot is
  immutable copied data, not a live D1 goal, so D1 recovery classification and D2
  snapshot selectability are intentionally distinct. A D1 goal that D1 classifies as
  recovery-only may still be selectable here when its projection is valid. This does
  not claim that the underlying D1 document is valid. This requires one approved edit
  to D1's **static guard test** allow-list. It is a test-file change to a committed D1 file. D1 production code, API, persistence and
  behaviour are unchanged. If that guard edit is refused, the fallback is an
  additive D1 export of a validated owner-scoped read. That is a production change
  to D1 and needs its own approval (**Approval**).
- **CL-18 Encryption.** Retained with explicit conditions. Operational soundness:
  the key already exists in every deployment that runs the forum, challenges or
  surveys, so no new environment variable is introduced. Key requirements: a
  single `ENCRYPTION_KEY`, base64, 32 bytes, read per call. Field boundary: all
  free text (title, owner notes, next steps, participant notes, and the whole
  snapshot array, which contains goal titles) is encrypted. Structural fields
  (ids, team, participant identifiers, state, status, dates, timestamps) are plain.
  Failure and recovery: BR-53 and D2-SI-13. Terminology: application-layer
  encryption at rest on the server (D2-SI-11), not end-to-end. Burden: one codec
  module and one test set, justified by sensitivity of text shared with a second
  person. Known inconsistency: D1 goal titles stay plaintext (D1 residual, accepted
  there); D2 copies are encrypted. D1 is not changed to match.
- **CL-19 Pending DTO.** Locked (BR-41): invitation metadata and the owner's
  roster-level name only. The title, sections, goals and date stay hidden until
  acceptance. The alternatives were: no owner name (rejected: an invitee cannot make
  an informed choice from an anonymous invitation) and the owner's title (rejected:
  private content before consent).
- **CL-20 Owner name visibility.** Locked (AD-7, BR-41…BR-43): owner and participant
  names are visible to each other only while both have active same-team
  memberships. This is the roster rule of invariant 21 applied to the team, not a
  profile directory. Closeout: state it in invariant 21's wording.
- **CL-25 Completion and pending invitation.** Locked (BR-13): completion withdraws a
  pending invitation in the same transaction, so no access can start after completion.
- **CL-26 Snapshot clear after completion.** Locked (BR-27): clearing is allowed,
  adding and changing are not. This keeps revocation possible after freezing.
- **CL-27 Configured-key check.** Locked (product and security decision, 2026-10-14;
  an intentional change to BR-51). A wrong or misconfigured server key must not make
  valid conversations look corrupt. A configured-key mismatch and a per-document
  authentication failure are different outcomes. BR-51 gains one plain field,
  `keyCheck`, so the codec detects a mismatch before a document is classified
  (BR-53). Rejected: accepting the risk (the earlier option b), because a key
  misconfiguration would then offer delete-only recovery for the whole list. This
  preserves CL-18: application-layer AES-256-GCM on the server, not end-to-end and not
  zero-knowledge. No new environment variable is introduced.
- **Cross-team and mentors.** Locked (CL-2). Same team only in v1. The ROADMAP
  "mentors" wording is broader future scope and is reconciled at closeout.
- **Team lifecycle.** Locked (BR-31, BR-32): team disablement ends participant access
  only; reactivation restores it automatically when the binding still matches (no
  event needed, as the access check is state-based).

## Stable errors

All errors are JSON `{ error: "<code>" }`. No stack, Firestore text or key detail.

| Code | HTTP | When |
|---|---|---|
| `unauthenticated` | 401 | Missing or invalid bearer token |
| `conversation_not_found` | 404 | Missing, malformed id, foreign, non-participant, ineligible, unbound, stale index, or any access failure (all identical) |
| `invalid_input` | 400 | Failed validation or unknown key; code only, no field name is returned (TASK-023) |
| `payload_too_large` | 413 | Body over `CONVERSATION_BODY_MAX_BYTES` |
| `invalid_goal_selection` | 400 | Any `sharedGoalIds` entry malformed, duplicated, absent or invalid; nothing written |
| `invalid_participant` | 400 | Unknown, stale, cross-team, ineligible, self, duplicate, cap-exceeded or non-active-team ref (identical); on the selectable-member read, a conversation without `teamId` (Amendment 2026-10-19) |
| `conversation_completed` | 409 | Write attempted on a completed conversation, except the allowed actions in BR-16, BR-17, BR-27, BR-29 |
| `invalid_transition` | 409 | Completing an already completed conversation |
| `conversation_limit` | 409 | Owner's total count at `CONVERSATION_LIMIT` |
| `persistence_failed` | 500 | Firestore, encryption-key (missing, invalid, or mismatched with a stored `keyCheck`) or unexpected failure; no detail |

Leave or decline with no participation returns `conversation_not_found`
(BR-17). Owner removal when no participant is set is an idempotent no-op returning
the current owner DTO.

## Test strategy

Follow D1's seams and fakes (`fake-goal-store` pattern). Cover the matrix above.
Required behaviour: owner and participant authorization matrix; cross-user
isolation; lead and admin without explicit access; non-member admin invitation
rejection; sharing and revocation (removal, replacement, leave, decline, withdrawal,
delete, snapshot clear); ineligibility without content deletion; completion freezing
content but not access; index and authority inconsistencies; eligibility (membership
missing, team inactive, memberRef mismatch after rejoin, self, cap); lifecycle;
malformed persistence; key outage versus malformed document; bounded reads and
truncation; body cap; DTO allow-lists and forbidden-field scans; hidden-content
prohibition (both parties see all sections; every section appears in both DTOs);
C1/D1 non-interference; Firestore rules deny; scope guard; route allow-lists;
privacy copy; forbidden terms; navigation `aria-current`; encryption codec.

All test data is synthetic and labelled as such (invariant 15). The encryption test
key is a generated test value, never the environment key.

## Firestore rules impact

None. `firestore.rules` denies `userDevelopment/{document=**}` recursively, which
includes both new subcollections. A rules test proves it; the rules file is not
edited. Rules deployment remains a separate explicit step.

## Index impact

No composite or collection-group index. Query mapping:

| Query | Shape | Index |
|---|---|---|
| Owner list | `conversations` subcollection, `orderBy createdAt desc`, `limit(101)` | single-field, automatic |
| Owner recovery scan | `conversations` subcollection, `select("createdAt")`, `limit(101)` | none (no order) |
| Owner count | `conversations` `count()` | none |
| Participant list | `conversationParticipations` subcollection, `orderBy invitedAt desc`, `limit(101)` | single-field, automatic |
| Participant count | `conversationParticipations` `count()` | none |
| Point reads and transactions | by document id | none |

`firestore.indexes.json` is unchanged. No query filters on encrypted content and no
field is queried by a value, so encryption does not interact with indexing.

## Demo Team decision

None in v1. No synthetic or presenter conversation data is seeded. Conversations are
sensitive development content (invariant 15). The presenter creates them through the
UI if needed.

## Migration decision

None. D1 is unchanged. D2 reads existing goals through the store and writes only new
subcollections.

## Documentation impact

At closeout (not in planning):

- `docs/PRODUCT.md`: D2 delivered; single consent-first participant; the decisions in
  this SPEC's review section; "mentors" wording reconciled as future.
- `docs/ROADMAP.md`: mark D2 delivered; keep role expectations separate; reconcile
  "mentors" as future cross-team scope.
- `docs/ARCHITECTURE.md`: D2 section (module boundaries, two-subtree pattern, binding
  check, encryption scope); personal navigation paragraph.
- `docs/DATA-MODEL.md`: rows for `userDevelopment/{uid}/conversations` (personal,
  sensitive, encrypted fields) and `…/conversationParticipations` (locator); replace
  the `checkIns` "does not exist" note with a pointer.
- `docs/UI-UX.md`: `Samtaler` section, privacy copy rules, dated pointers for the
  stale "no Samtaler" statements.
- `docs/SECURITY.md`: D2-SI-1…18 as the next free invariant numbers (provisional
  55–72, assigned from the then-current file); invariant 21 wording (CL-20);
  invariant 25 wording (CL-23); known limitations list above; checklist entries.
- `docs/DEVELOPMENT.md`: `ENCRYPTION_KEY` requirement now also applies to conversation
  routes (no new variable).
- D1 SPEC: dated pointer only, if at all. D1 behaviour is unchanged.

## Dependencies and config impact

- **No new dependency.**
- **No new environment variable.**
- **Existing runtime dependency made explicit:** the conversation routes require
  `ENCRYPTION_KEY`, as forum, challenges and surveys already do. A deployment without
  it cannot serve conversations (fail closed, `persistence_failed`). This is an
  operational requirement that already applies to existing features, not a new key.
- No new route family beyond the API table; no admin route.
- Changes to committed D1-area files, all approved in this SPEC (**Approval**):
  1. `src/features/personal-goals/personal-goals-scope-guard.test.ts`: one allow-list
     entry for the D2 snapshot module (CL-5). Test only.
  2. `src/components/nav/PersonalNav.tsx` and `PersonalNav.test.tsx`: add the
     `Samtaler` link and change the test that asserts its absence (AD-8). Shared
     navigation component, additive. D1 behaviour is unchanged on D1 pages.

## API surface

All routes require `Authorization: Bearer`, derive the caller uid from the verified
token, and reject any uid, owner, participant or membership id in path, query or body.

| Method and path | Purpose | Actor |
|---|---|---|
| `GET /api/me/conversations` | Owner list and participation list (each bounded, BR-33/34) | Signed-in person |
| `POST /api/me/conversations` | Create `{ title, plannedFor?, teamId? }` | Owner |
| `GET /api/me/conversations/create-options` | Teams the caller may choose for a new conversation: `{ items: [{ teamId, name }], truncated }`, bounded. Discovery only (see the create-options contract below) | Signed-in person, self only |
| `GET /api/me/conversations/[conversationId]/selectable-members` | Owner-only selector for the conversation's team: `{ members: [{ memberRef, displayName, ordinal, isSelf }], unavailableCount, truncated }`. Discovery only, no authority (Amendment 2026-10-19) | Owner with a genuine active team membership, no admin bypass |
| `GET /api/me/conversations/[conversationId]` | Owner, participant or pending view | Owner, bound accepted participant, pending invitee |
| `PATCH /api/me/conversations/[conversationId]` | Owner fields: `title`, `plannedFor`, `ownerNotes`, `nextSteps`, `sharedGoalIds`, `participantMemberRef` (set or `null`), `status: "completed"` | Owner (see BR-16, BR-19, BR-24…BR-28 for state rules) |
| `PUT /api/me/conversations/[conversationId]/participant-notes` | Body `{ notes }`, replaces `participantNotes` | Accepted eligible participant, `open` only |
| `POST /api/me/conversations/[conversationId]/participation/accept` | Accept a pending invitation | Pending invitee |
| `DELETE /api/me/conversations/[conversationId]/participation` | Decline (pending), leave (accepted or ineligible) | Participant |
| `DELETE /api/me/conversations/[conversationId]` | Hard delete | Owner (works on malformed content) |

Unknown body keys → `invalid_input`. Bodies over the cap → `payload_too_large`.

**Participant route contract (TASK-024, reviewed 2026-10-18).**
- Success bodies: `POST …/participation/accept` returns `200 { state: "accepted" }`. It mirrors the pending DTO's `state`
  and carries no content (D2-SI-3). `PUT …/participant-notes` returns `200 { ok: true }`, as the owner PATCH does.
  `DELETE …/participation` returns `204` with no body for a decline, a leave and a stale-index cleanup.
- No-body routes (accept, DELETE participation): an absent or empty body, or `{}`, is accepted. Any key is `invalid_input`
  without the key name. The 32 KiB streamed cap applies first and returns `payload_too_large`.
- Notes: a `notes` value over `NOTE_MAX_BYTES` (4096 UTF-8 bytes, BR-39) is `invalid_input`. A whole body over the 32 KiB cap is
  `payload_too_large` (BR-40), and it is checked before parsing.
- Detail `GET` dispatch (BR-35): the caller's own owner document first, then the accepted participant view (BR-21), then the
  pending view (BR-14). Only an authoritative `conversation_not_found` from one view moves to the next. A `persistence_failed`
  from any view is returned as is and never falls through, so an operational failure is never shown as a pending invitation.

**Create-options route contract (TASK-027 amendment, 2026-10-18).** The create form needs the teams it may offer, and
the teams overview cannot supply them (it hides a genuine membership behind app-admin visibility and carries no team
status). This route is a narrow D2-owned read that answers that one question.

- **Subject.** Only the verified bearer-token uid. No uid, email, memberRef, team id, admin flag or other request input
  is read. Missing or invalid bearer → `unauthenticated` (401).
- **Predicate.** A team is returned only when all hold for the caller's own membership documents: (a)
  `teamMemberships/{uid}__{teamId}` exists, its `uid` is the caller, its `teamId` is the id in the document id, and the
  id is a valid team path segment; (b) `teams/{teamId}.status` is exactly `"active"`; (c) `teams/{teamId}.name` is a
  non-blank string. Role, lead status and app-admin status neither qualify nor disqualify. This is the same
  membership-and-status rule that `create` re-checks (BR-2, BR-9), applied to a bounded window.
- **Bounded read.** One query `teamMemberships where uid == caller`, `limit(READ_WINDOW + 1)`, with no `orderBy`. Raw
  count above `READ_WINDOW` sets `truncated = true`, and only the first `READ_WINDOW` raw rows are examined. Every raw
  row in the window consumes a slot, whether valid or not; there is no refill. Team documents for the valid rows are read
  in one batch of at most `READ_WINDOW` point reads. No `collectionGroup`, no unbounded read, no app-admin team scan.
- **Malformed data (fail closed).** A malformed membership row, a mismatched id, a missing or disabled team, or a team
  without a non-blank name is omitted and never widens the result. Nothing about the omission is returned.
- **Operational failure.** A failed query or team batch read returns `persistence_failed` (500). It never returns an
  empty list, and never `invalid_input`.
- **Ordering.** Items sort by `name`, then `teamId`, by JavaScript string comparison (code-unit order). Deterministic, no locale collation.
- **Response.** `{ items: [{ teamId, name }], truncated }`, with exactly these keys. No team status, membership role,
  lead status, admin status, uid, email, memberRef, membership document id, timestamp or authorization reason.
- **No authority.** The response grants nothing. A returned team id is still re-checked by `POST /api/me/conversations`
  on every create. A team absent from the response is not proof that create would reject it, and a team present is not
  proof that create will accept it. The browser never treats the list as authorization.
- **Truncation.** `truncated: true` means teams beyond the window may exist. The UI says that the choice may be
  incomplete. It does not claim the caller has no other teams.
- **Stable errors.** Only `unauthenticated` (401) and `persistence_failed` (500). No new code.

## DTOs

Defined in BR-41…BR-44: pending DTO, owner DTO, participant DTO, list summaries and
recovery item. The list envelope is `{ owned: { items, truncated }, participating:
{ items, truncated } }`, where `owned.items` mixes summaries and recovery items
(`{ conversationId }` only). Mixed-items order (product-owner decision, 2026-10-17): all valid owner summaries
come first, in `createdAt desc` order with the window's deterministic tie-break; recovery items follow, in the
deterministic order of the owner-list recovery merge. Recovery items are never interleaved into raw-window positions,
and no `createdAt` or other metadata is added to a recovery item for ordering. `truncated` is derived from the bounded
raw owner window (BR-33) and is unchanged by this rule.

## Bounded-read and query semantics

Per BR-33, BR-34, BR-36, BR-37. Owner list: one subcollection query, `limit(101)`,
`createdAt desc`. Owner recovery: one `select` scan, `limit(101)`. Owner list, per bound
participant: one index read and one owner read (BR-21, conversation-specific), and the team
status and membership reads are memoized per request by team and by (uid, team). Participant list:
one subcollection query, `limit(101)`, `invitedAt desc`, followed by per-entry
verification reads deduplicated per team and membership. Name lookups are one
`getDisplayNames` call per list, bounded by 101 uids. Detail: point reads. The
assignable-member read used for selection is bounded at 500 (existing). Snapshot
reads: up to 5 point reads. Catalog reads: bounded, D2-local.

## Malformed-data semantics

BR-33 (owner recovery), BR-34 (participant omission), BR-35 (detail), BR-53 (key
outage). No malformed content, failure reason or field name is returned to anyone.

## Concurrency semantics

BR-48 to BR-50. Transactions for all lifecycle and cross-subtree writes, targeted
re-reads inside transactions, last-write-wins within a section and role.

## UI, routes and navigation

- `/me/conversations`: list with a "Ny samtale" disclosure, the owner list, the
  participation list, the truncated message, delete-only recovery items.
- `/me/conversations/[conversationId]`: owner editor, participant view, or pending
  view with accept and decline. Forbidden or absent shows the same "not found" copy.
- Personal navigation: `Ferdigheter · Mål · Samtaler` (`<nav aria-label="Personlig
  utvikling">`, exact `aria-current`). Header unchanged (`Min utvikling`).
- Labels (Norwegian): `Samtaler`, `Ny samtale`, `Tittel`, `Dato for samtalen`,
  `Notater (synlige for deltakeren etter aksept)`, `Neste steg`, `Notater fra deltakeren`,
  `Dine notater`, `Del mål`, `Inviter en kollega`, `Godta invitasjon`, `Avslå`,
  `Forlat samtalen`, `Fjern deltaker`, `Fullfør samtale`, `Slett samtale`,
  `Venter på svar`, `Akseptert`, `Ikke lenger tilgjengelig`, `En kollega`,
  `Området er ikke tilgjengelig`. Forbidden UI words: score, rating, vurdering,
  rangering, prestasjon, ytelse, "på sporet", "dele utviklingsprofil", "avlys".

## Privacy UX

Per BR-38. Every sharing action states its effect before confirmation. Owner view
shows the participant's state and what is visible. Participant view shows the owner's
name and team, and leave is always available. No "share development profile" control
exists.

## Performance and surveillance boundary

D2 is a two-party development record. It has no score, rating, rank, progress
percentage, activity or read metric, cross-person aggregate, lead dashboard, or link
into C2 coverage, roadmap or team skill views (D2-SI-17, BR-46). No feature may show
how often or how recently someone took part in a conversation.

## Role-expectation boundary

Role expectations (`roleDefinitions`, role profiles, expectations for a role or
person) are separate and unscheduled. D2 does not read or write them, does not tag
conversations with a role, and does not use role profiles.

## Notification decision

None (CL-24).

## Scheduling and calendar decision

None. `plannedFor` is a date label (BR-6). No reminders, invitations or time of day.

## Explicit future work

- Lead- or manager-initiated check-in requests, with their own privacy notice and
  consent design.
- More than one participant, group conversations, cross-team participants and
  mentors from outside the team (own SPEC).
- Owner-private notes, if product wants them (own SPEC; CL-22).
- Notifications and invitation expiry (CL-24).
- Live goal references with per-goal revocable consent (own SPEC).
- Encryption key rotation with a key-version dispatch and re-encryption migration.
- Account-erasure flow covering both subtrees.
- Role expectations (`roleDefinitions`), a separate SPEC.
- Export, print or report of conversations.
- Batched participant-list verification if the per-entry read cost (see the known
  limitations) proves material.

## Review changes (2026-10-14 review of v1)

Objective defects corrected in this version, for traceability:

- Pending invitation exposed no owner identity, so an invitee could not decide
  informedly; BR-41 now includes the roster-level owner name.
- The v1 "unavailable hides notes" rule created a hidden-content state; replaced
  by CL-21.
- Completion froze removal and leave; BR-16, BR-17 and BR-27 now keep access-ending
  actions available after completion.
- Team binding was only set at creation, while the v1 edge case said invitation;
  BR-2, BR-9 and BR-10 now state creation and each invitation.
- `teamId` was missing from PATCH while a participant could be added later;
  BR-2 makes it immutable and required before any participant.
- Owner DTO returned the participant's `memberRef`; removed (BR-42).
- "Preparation notes" implied privacy the system does not provide; merged into
  `ownerNotes` (CL-22).
- Participation index used `createdAt` and held no owner identifier in a
  documented form; now `{ ownerUid, invitedAt }` (BR-34).
- The encrypted-field list and the plain-field list did not cover snapshot titles;
  BR-51 now places the whole snapshot array inside the encrypted payload.
- The v1 said "no new environment variable" but omitted that conversation routes
  depend on `ENCRYPTION_KEY`; now explicit in the Dependencies section and
  D2-SI-13.
- A key outage would have been treated as a malformed document, enabling
  destructive recovery deletes; BR-53 separates the two.
- Body size and field byte limits were not defined; BR-39 and BR-40 now define them.
- `plannedFor` range and format were unspecified; BR-6 now uses the D1 rule.
- The D1 guard edit was described as "test-only explanation"; it is now an explicit,
  approved dependency (CL-5).
- Duplicate Demo Team section and an incorrect `checkIns` cross-reference were removed.

## Amendment 2026-10-19: owner selector source (TASK-029 review finding I-1)

**Status: Locked.** Product-owner decision 2026-10-19, Option B: a D2-owned, owner-only, discovery-only selector read.

**Supersedes.** The TASK-029 selector-source decision ("Decision 1": the owner's selector reads the generic
`GET /api/teams/[teamId]/assignable-members`), and the selector-source clauses of repository finding 8, BR-8 and
AD-11 as they stood in v2. Those clauses now read as this amendment.

**Why.** The generic endpoint is gated by `authorizeTeamAccess` (`authorize-team-access.ts`). That gate admits an app
admin with no membership, and an ordinary member of a disabled team. D2 owner eligibility for an invitation or
replacement (BR-9, BR-10) requires an active team and a genuine membership, with no admin bypass. So the teammate roster
reached callers that the owner write refuses. The generic endpoint keeps its app-admin semantics for
team-skill-planning (BR-4), so it is not changed. Its isolation from D2 is intentional.

**Rules.**

1. **Route.** `GET /api/me/conversations/[conversationId]/selectable-members`. No other method.
2. **Subject.** The verified bearer uid only. A missing or invalid bearer is `unauthenticated` (401). No path, query or
   body value is read, as with the create-options read.
3. **Conversation.** A `conversationId` outside the AD-3 grammar is `conversation_not_found`, with no read. The caller's
   own owner document is read by point read. A missing document, a document outside the caller's owner subtree, or a
   document that fails the owner classification (plain shape, envelope and authenticated payload, BR-33, BR-53) is
   `conversation_not_found`. A key failure is `persistence_failed`. The participant index is not read.
4. **Ownership.** The point read in the caller's own owner subtree is the ownership test. Participants, pending
   invitees, team leads, team members and app admins are not owners and receive `conversation_not_found`.
5. **Team.** The conversation must have a `teamId`. Without one the result is `invalid_participant` (400), as the PATCH
   gives for a participant on a conversation with no team (BR-2). No team read is made.
6. **Completed.** A completed conversation returns `conversation_completed` (409) before any team read. The write path
   refuses every candidate there (BR-10 precedence), so no candidate list is offered.
7. **Owner eligibility (the exact predicate).** `readGenuineActiveMembership(callerUid, teamId)`, the existing BR-9 helper,
   must succeed. It requires (a) `teams/{teamId}.status` to be exactly `"active"` and (b) the caller's exact
   `teamMemberships/{callerUid}__{teamId}` document to exist with its `uid` and `teamId` fields matching. Refusal of
   either part is `conversation_not_found`, the code the Stable errors table uses for ineligibility. A read failure is
   `persistence_failed`.
8. **No bypass.** App-admin status does not qualify or bypass. Lead status, `role`, e-mail and display name are not
   read for this decision and do not grant access. That refuses an app admin with no membership, an app admin whose
   membership was removed, an app admin who is a member of a disabled team, an ordinary member of a disabled team and an
   ordinary non-member. `authorizeTeamAccess`, `resolveTeamRole`, `requireAppAdmin` and `isAppAdmin` are not used on
   this path (D2-SI-2).
9. **Member discovery.** After rule 7 succeeds, one query runs: `teamMemberships where teamId == teamId`, `limit(501)`,
   with no `orderBy` and no composite index. This is the query shape the write path already uses (BR-8, BR-36), so no
   new index, rule or collection is needed. Each row is returned as its document id and its raw data.
10. **Raw window and truncation.** Only the first 500 raw rows are examined. `truncated` is `true` when a 501st row
    exists. Every raw row in the first 500 consumes a slot, whether offered or not, and there is no refill. Rows beyond
    500 are never read. Members beyond the window cannot be selected (BR-8), and the UI states it.
11. **Malformed rows.** A row is offered only if all of these hold: (a) its `uid` is a non-empty string; (b) its document
    id is exactly `{uid}__{teamId}`; (c) its `uid` and `teamId` fields match; (d) its `memberRef` is a valid member
    reference; and (e) that `memberRef` is held by exactly one row in the window. A row that fails any test is omitted
    and counted in `unavailableCount`. Nothing about it is returned. Rows that share a `memberRef` are all omitted
    (fail closed, as the write path treats an ambiguous ref).
12. **Candidate eligibility.** An offered row is the candidate's exact membership document for this team, and the team
    was found active in rule 7 for the same team document. Candidate-side eligibility is therefore the BR-9 (a) and (b)
    predicate, read from the window's own exact documents rather than from one extra point read per candidate, which
    keeps the read bounded. Role, lead status and app-admin status are not read. The owner's PATCH (BR-8 to BR-10)
    still re-resolves the chosen ref and re-checks the owner and the candidate, so a candidate who fails there is
    refused there.
13. **Self.** The caller's own membership, when offered under rule 11, is included with `isSelf: true`. It takes part in
    ordinal ranking so that ordinals match the whole team's roster. The browser hides it. The write path still refuses
    self (BR-8). Self is not an error in this read.
14. **Display names.** Names are read only after rule 7 succeeds, and only for offered uids. They come from the D2 roster
    name seam in `participant-presentation.ts`, which is the single `getDisplayNames` call site (IMPL-4). A missing or
    invalid profile gives `displayName: null`, and the browser shows the neutral fallback (BR-41). A name read failure is
    `persistence_failed`, and no partial roster is returned.
15. **Ordinal.** Ordinals are computed per response with the pure arrangement rule `arrangeAssignableMembers`. It groups
    by normalised name, assigns `ordinal` 1…n only inside a group of at least two offered members, and ranks by
    membership `createdAt` and then by `memberRef`. `createdAt` is a ranking input and is never returned. Ordinals are
    presentation only.
16. **Response DTO.** Exactly `{ members: [{ memberRef, displayName, ordinal, isSelf }], unavailableCount, truncated }`.
    `memberRef` is a non-empty string. `displayName` is a string or `null`. `ordinal` is an integer of at least 1 or
    `null`. `isSelf` is a boolean. `unavailableCount` is a non-negative integer and counts only omitted rows (rule 11).
    `truncated` is a boolean. No uid, e-mail, role, lead or admin flag, membership document id, `teamId`, team status,
    timestamp, auth claim or refusal reason is returned. The response carries `Cache-Control: no-store`.
17. **memberRef.** An opaque, team-scoped selection handle. It is not authorization. The owner's PATCH re-resolves it. It
    is not rendered, logged, placed in a URL or stored by the browser, and the browser does not put it in the DOM.
18. **Response authority.** The response creates no access, pending invitation, index entry or participant state, and
    no write follows from it. A member in the list is not proof that PATCH will accept it, and an absent member is not
    proof that PATCH will refuse it.
19. **Operational failure.** A failed key probe, owner read, team read, membership read, membership list read or
    display-name read is `persistence_failed` (500). The read never returns an empty list, a partial list or a
    fallback. It never calls another route, and it returns no raw detail.
20. **Coherence.** The read is read-only and needs no transaction. The order is: owner check (rule 7), then window
    (rule 9), then names (rule 14). Each request reads the team document once and the caller's membership once. The
    reads are not atomic together. That is acceptable because the result grants nothing and the write re-checks.
21. **PATCH unchanged.** `PATCH` with `participantMemberRef` keeps its independent validation: `resolveParticipantRef`,
    BR-8 to BR-10, BR-37 and BR-48. No write rule changes, and no write path calls the new read.
22. **Generic endpoint unchanged.** `GET /api/teams/[teamId]/assignable-members` and its app-admin semantics are not
    changed. D2 never calls it, and D2 has no fallback to it.
23. **Fetch timing.** The browser requests the list only when the conversation is `open` and has a `teamId` (BR-8, BR-16).
    Completed, pending and participant views request no list. The server refusal is the security boundary, and the
    timing is not.
24. **Stable errors.** `unauthenticated` (401), `conversation_not_found` (404), `invalid_participant` (400, no team link),
    `conversation_completed` (409) and `persistence_failed` (500). No new code is introduced.
25. **Infrastructure.** No Firestore rule, index, environment variable, encryption, migration or seed change.

**Superseded TASK-029 detail.** The browser has no path to the generic endpoint for D2 selection. Its gateway method is
`fetchSelectableMembers(idToken, conversationId)`, and it reads only this route. A refused read shows the neutral
unavailable state and never a roster or a "no teammates" message.

## Unresolved decisions

None in the behavioural model. Items awaiting the product owner's acceptance of the
locked text: the decisions in "Decisions locked by review", the D1 guard test edit
(CL-5), and the encryption retention with its conditions (CL-18). Security wording
for invariants 21 and 25 (CL-20, CL-23) is a closeout approval.

## Files created or modified by planning

- Created: `docs/features/development-conversations/SPEC.md` (this file, v2).
- Not created: `TASKS.md`.
- Not modified: any other document, code, test, rule, index or config file.

## Implementation readiness

**PASS WITH SUGGESTIONS** for `/split-tasks`, conditional on product-owner approval of
the locked decisions and on the closeout approvals listed above. Required before
splitting:

1. Approve the locked decisions (OQ-1…OQ-5 as CL-19…CL-26, CL-5, CL-18).
2. Approve the D1 guard test edit and the `PersonalNav` change as the only D1-area
   edits.
3. Approve the invariant 21 and 25 wording plan for closeout.

After approval, run `/split-tasks development-conversations`.

## Recommended next command

After approval: `/split-tasks development-conversations`.

## Closeout record (2026-10-21, TASK-036)

Dated record, added at closeout. The sections above are the planning-time text and are not rewritten.

- **Status.** Implemented. Feature tasks TASK-001 to TASK-035 are Done. TASK-036 (documentation closeout) is In
  Progress until its independent review.
- **Implementation decisions resolved at closeout.**
  - **IMPL-1 (removal and leave re-encrypt).** Resolved. Removal and accepted leave decrypt and re-encrypt the payload to
    delete `participantNotes`, and an undecryptable payload returns `persistence_failed` or `conversation_not_found` with
    no write. Pending withdrawal and completion never decrypt. Implemented in TASK-016, TASK-018 and TASK-019.
  - **IMPL-2 (static rules tests, no emulator).** Confirmed. The rules and deployment checks are static tests
    (`src/lib/firebase/firestore-user-development-rules.test.ts`, `src/lib/firebase/firestore-deployment-config.test.ts`).
    No emulator and no dependency were added. The D2 test doubles are in-memory fakes, not emulators. The "Firestore rules
    test (emulator)" row in "Test boundaries" is superseded by this resolution.
  - **IMPL-3 (D1 guard amendment).** Resolved. Collection-reference entries landed in TASK-005 and importer entries in
    TASK-008, as TASKS.md records.
  - **IMPL-4 (`getDisplayNames` single call site).** Resolved. Within the D2 feature, `getDisplayNames` is called only from
    `src/features/development-conversations/server/participant-presentation.ts` (checked by grep on 2026-10-21). Enforced by
    the D2 static scope guard (TASK-034).
- **Invariant numbering.** SECURITY.md assigns D2-SI-1…18 to invariants 55–72 (checked against the then-current file, which
  ended at 54). Invariant 21 (CL-20) and invariant 25 (CL-23) received the closeout wording above. The wording was applied
  as TASK-036 scope as candidate wording; its approval status is stated in "Product-owner approval" below.
- **Product-owner approval (recorded 2026-10-21).** The product owner explicitly approved the current final closeout wording
  of invariant 21 (CL-20) and invariant 25 (CL-23) in `docs/SECURITY.md`, as it stood after the TASK-036 repair. The approval
  is a product-owner decision, not an independent review result. The independent `/review-change development-conversations
  TASK-036` did not supply, grant or imply it, and that review is still required before TASK-036 can be Done.
- **Previously pending (historical).** Until this record, product-owner approval was pending. The first closeout entry above and the
  TASK-036 repair record in `TASKS.md` both stated that approval had not been given. Those statements are kept as written. This
  record supersedes them for approval status only.
- **Approved changed surfaces (final inventory, relative to the planning base `a13b175`).** Nothing outside these surfaces is part
  of D2.
  - D2 feature: `src/features/development-conversations/`, `app/api/me/conversations/`, `app/me/conversations/`, and
    `docs/features/development-conversations/`. All are new files.
  - D1 guard test (CL-5, TASK-008): `src/features/personal-goals/personal-goals-scope-guard.test.ts`. Test-only edit.
  - Personal navigation (AD-8, TASK-032): `src/components/nav/PersonalNav.tsx`, `PersonalNav.test.tsx`, `copy.ts`.
  - Encryption helper (TASK-003, approved amendment): `src/lib/encryption/encryption.ts` and `encryption.test.ts`. This
    surface belongs to TASK-003, not to TASK-035 or TASK-036. The TASK-035 closure note recorded it as a suggestion.
  - Durable docs changed at closeout: `docs/SECURITY.md`, `docs/PRODUCT.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
    `docs/DATA-MODEL.md`, `docs/UI-UX.md`, `docs/DEVELOPMENT.md`, and this SPEC and TASKS.md.
  - `firestore.rules` and `firestore.indexes.json` are unchanged. The D1 SPEC is unchanged; it has no dated pointer.
- **Known limitations.** Recorded in `docs/SECURITY.md` after invariant 72 (no account-deletion flow; operator access; no key
  rotation; no additional authenticated data; ineligible notes visible to the owner until removal; membership removal does not
  delete notes; roster-rule name display; no invitation rate limit beyond the cap; per-entry read cost).
- **Deployment and manual verification (not performed).** No deployment, seeding or Firebase access has happened. The rules
  deployment is a separate explicit step (see "Firestore rules impact"). Because the rules tests are static, live Firestore
  rule behaviour and the `ENCRYPTION_KEY` value of any environment remain unverified in-session. Both need manual checks
  before any deployment.
