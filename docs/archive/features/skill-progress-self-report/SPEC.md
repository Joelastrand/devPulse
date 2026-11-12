# Member Skill Progress Self-Report (Phase 8)

## Status
Approved — reviewed and approved by the product owner (2026-09-19),
including the independent-review correction to BR-4 (member self-report
now requires an `active` team, matching this codebase's established
member-originated-write pattern). Produced by `plan-feature`, revised
during an independent approval review. Task planning proceeds via
`split-tasks` → `TASKS.md`.

**Revision note (permission-UI correction).** BR-10's original text had the
stage-mutation control render unconditionally "for any authorized viewer of
the page (member or admin per `authorizeTeamAccess`)," deferring
write-eligibility enforcement to the server alone — the same posture
`ChallengeSubmissionPanel` originally had, before its own composition gap
(an app-admin-only viewer seeing a submission form the server would always
reject) was fixed. The identical gap existed here: an app-admin-only viewer,
or a genuine member of a disabled team, saw the stage select and "Lagre"
button even though `reportTeamSkillProgress` would always reject their
submission (BR-1, BR-4). This is now corrected: `getTeamSkillProgress`
(`docs/features/team-skill-tree/SPEC.md`) additionally returns
`canReportProgress: boolean`, re-derived independently of
`authorizeTeamAccess`'s broader read-authorization result using the exact
membership-then-team-status semantics `reportTeamSkillProgress` itself
requires. `TeamSkillSection` renders the stage select and "Lagre" button
only when `canReportProgress` is `true` for that viewer; a non-capable
viewer still sees the full read-only stage list. BR-10 below reflects this
corrected behavior — no product decision changed (a non-member/disabled-team
caller could never actually report progress before this fix either); only
the UI's visibility now matches the server's existing authorization exactly.
`reportTeamSkillProgress`'s own authorization is unchanged and remains the
sole write-authorization boundary.

## Problem
Team Skill Tree (Phase 7, `docs/features/team-skill-tree/SPEC.md`) let an
app admin define a SkillTree and record which stage a team has reached, but
kept **every** write app-admin-only as a deliberate v1 scope-minimization
decision — not one this codebase's own precedent otherwise argues for (see
that SPEC's "Purpose" and "Authorization model"). That SPEC's own "Open
questions" #1 named this exact gap: a team's own members have no way to
report their own progress; an app admin must do it for them, even though
the admin is often not close to the team's day-to-day work and has to be
asked or told before a tracked stage reflects reality.

## User outcome
A real member of a team can set that team's current stage on any SkillTree
the team is already tracking, without needing an app admin to do it for
them — the same way a real member can already submit an Anonymous
Challenge or start a Forum thread without admin involvement.

## Scope
- A **second, additive write path** for `skillProgress.currentNodeId`:
  `reportTeamSkillProgress`, usable by a real team member.
- `/teams/[teamId]`'s existing read-only Kompetanseområder section gains a
  control, per already-tracked tree, to set the current stage.

## Out of scope
- **Tree definitions** (`createSkillTree`/`updateSkillTree`/
  `listSkillTrees`) — remain app-admin-only, unchanged.
- **Starting or stopping tracking** (`startTeamSkillTracking`/
  `stopTeamSkillTracking`) — remain app-admin-only, unchanged. Self-report
  only ever updates the stage of a tree the team is *already* tracking; a
  member cannot bring a new tree into scope for their team.
- **Visible attribution.** A member's update is recorded exactly like an
  admin's — `updatedBy: uid`, never returned by any API response. No
  pseudonym, display name, or "who updated this" text is shown to
  teammates. (Product decision, this planning session — see "Owner
  decisions.")
- **Forward-only restriction.** A member may set the stage to any node in
  the tree, forward or backward — identical to the existing admin
  contract. (Product decision, this planning session.)
- **Per-team/per-tree opt-in toggle.** Self-report is available on every
  tree a team already tracks, for every real member, unconditionally — no
  new admin-managed setting. (Product decision, this planning session.)
- **Section-scoped or org-wide (cross-team) skill trees** — separately
  deferred in Phase 7's Open Questions #2, unaffected by this feature.
- **Structural tree editing, deletion, progress history/audit trail** —
  unaffected, unchanged from Phase 7.
- Comment, voting, reaction, or ranking/leaderboard features — unchanged
  non-goal from Phase 7.
- Rate limiting / anti-abuse tooling — not requested; matches this
  codebase's existing posture for real-membership-gated writes (Anonymous
  Challenges, Team Forum).

## Owner decisions (this planning session)
1. **No visible attribution.** A member's stage update is internal-
   bookkeeping-only (`updatedBy`), identical in shape and exposure to an
   admin's update. This keeps the feature's data model unchanged from
   Phase 7 and avoids re-opening Team Forum's `authorUid`/`authorTag`
   design question, which Phase 7's Open Questions #1 raised as a
   possibility but did not mandate.
2. **Same direction contract as admin**: forward or backward, freely.
   Restricting members to forward-only was considered and rejected as
   unnecessary complexity for a v1 with no reported abuse pattern to guard
   against — an admin can always correct a stage either way regardless,
   via the unchanged admin path.
3. **Always on, no opt-in toggle.** Every real member of a team may report
   progress on every tree that team already tracks. A per-team/per-tree
   enablement flag was considered and rejected for v1: it would add new
   persisted state and admin UI with no concrete requirement driving it
   (CLAUDE.md scope discipline).
4. **`reportTeamSkillProgress` requires an `active` team, rejecting
   `team_disabled` otherwise** — added during independent approval
   review, correcting the original draft's BR-4, which incorrectly
   exempted this operation from team-status gating by analogy to
   `updateTeamSkillProgress` (an app-admin operation covered by Phase 7's
   separate creation-vs-management split, itself only ever applied to
   admin-only operations). Every existing member-originated write in
   this codebase (`submitChallenge`, `createThread`, `createReply`)
   requires an `active` team, including `createReply`, whose target (an
   existing thread) it does not itself create — the same shape as this
   operation's target (an already-tracked `skillProgress` record). No
   product rationale was offered for this feature being the sole
   exception to that established pattern, so it is not introduced as
   one.

## Key concepts
- **Self-report**: a real team member's own write of `skillProgress.
  currentNodeId` for a tree their team already tracks, via
  `reportTeamSkillProgress` — distinct from an app admin's `updateTeamSkill
  Progress`, but writing the identical field on the identical document.
- All other terms (**SkillTree**, **SkillNode**, **SkillProgress**,
  **Tracking**, **Cosmetic correction**) are unchanged from
  `docs/features/team-skill-tree/SPEC.md` → "Terminology."

## Actors and access
| Actor | Can do |
|---|---|
| App admin | Everything from Phase 7, unchanged: create/correct trees, list catalog, start/update/stop team tracking. |
| Real team member (`teamMemberships/{uid}__{teamId}` exists) | **New**: report (set) the current stage for any tree their team already tracks. Cannot start/stop tracking, cannot define/correct trees. |
| Non-member, non-admin | No skill content or data, unchanged. |

An app admin who is *also* a real member of a team gets both capabilities
independently — admin status and real membership are evaluated separately,
exactly as `submitChallenge`/`createThread` already establish for other
member-gated writes in this codebase.

## User stories
1. As a real team member, I want to set my team's current stage on a tree
   we're tracking, so that our recorded progress reflects reality without
   needing to ask an app admin to do it.
2. As an app admin, I want my existing tree-management and team-tracking
   controls to keep working exactly as before, so that Phase 8 doesn't
   change how I manage SkillTrees or start/stop tracking for a team.

## Behavioral requirements

**New member write path**
- **BR-1**: A caller with a genuine, fresh-read `teamMemberships/{uid}__
  {teamId}` record for the requested `teamId` may call
  `reportTeamSkillProgress(idToken, teamId, treeId, nodeId, deps)` to set
  that team's `currentNodeId` for `treeId`. App-admin status alone, without
  a real membership record, is **not** sufficient — mirrors
  `submitChallenge`/`createThread`'s established BR-1 posture for
  member-gated writes.
- **BR-2**: `reportTeamSkillProgress` accepts any `nodeId` present in the
  target tree's own `nodes` list, forward or backward — no monotonicity
  constraint, identical to `updateTeamSkillProgress`'s existing contract
  (Owner decision 2).
- **BR-3**: `reportTeamSkillProgress` rejects a `(teamId, treeId)` pair
  that has not first been started via `startTeamSkillTracking`
  (`not_tracked`) — a member cannot bring a new tree into scope for their
  team.
- **BR-4** *(revised during independent approval review — see "Owner
  decisions" #4 below)*: `reportTeamSkillProgress` **is** gated on the
  owning team's `active`/`disabled` status: a fresh-read `teams/{teamId}.
  status` other than `"active"` (including missing/malformed) is
  rejected `team_disabled`, zero writes. This mirrors this codebase's
  established, consistent precedent for every existing
  **member-originated** write — `submitChallenge`, `createThread`, and
  `createReply` all reject a non-`active` team, including `createReply`,
  which — like this operation — writes into an *already-existing*
  resource (a thread) it did not itself create. The original draft's
  justification (mirroring `updateTeamSkillProgress`'s Owner-decision-5
  posture) compared against the wrong reference class: Phase 7's
  creation-vs-management split governs *app-admin* operations on this
  feature's own tracking lifecycle, not the separate, already-
  established product pattern for *member*-originated writes, which
  this feature's new write path actually belongs to.
- **BR-5**: The acting member's `uid` is persisted as `updatedBy` on the
  `skillProgress` document — identical field, identical semantics,
  identical never-returned-by-any-API-response posture as an admin
  performing the same write (Owner decision 1). No new field is
  introduced to distinguish a member-authored update from an admin-
  authored one.
- **BR-6**: `reportTeamSkillProgress` rejects a `nodeId` not present in
  the target tree's own `nodes` list (`invalid_input`), re-validated
  against a fresh server-side read of the tree on every call — never
  trusted merely because the client supplied it.
- **BR-7**: A caller authorized (as a real member) for Team A cannot
  report progress for Team B via any `teamId` value it supplies —
  `reportTeamSkillProgress` re-derives the caller's own membership fresh
  from `teamMemberships/{uid}__{teamId}` for the exact requested `teamId`
  on every call, never trusting an earlier check or a client-supplied
  relationship.

**Unchanged admin paths**
- **BR-8**: `createSkillTree`, `updateSkillTree`, `listSkillTrees`,
  `startTeamSkillTracking`, `updateTeamSkillProgress`, and
  `stopTeamSkillTracking` remain app-admin-only
  (`requireAppAdmin`), with behavior, validation, and error contracts
  byte-for-byte unchanged from `docs/features/team-skill-tree/SPEC.md`.
  This feature adds exactly one new operation and modifies none of the
  existing six.
- **BR-9**: `getTeamSkillProgress`'s response DTO (`TeamSkillProgressView`)
  is unchanged — still never includes `updatedBy`, `createdBy`,
  `updatedAt`, or `createdAt`, regardless of whether the most recent write
  to a given `skillProgress` document was made by an admin or a member.

**UI**
- **BR-10** *(revised — see "Revision note (permission-UI correction)"
  above)*: `/teams/[teamId]`'s existing read-only Kompetanseområder section
  gains, for each already-tracked tree, a control to set the current stage
  to any node in that tree — rendered only for a viewer the server reports
  as `canReportProgress: true` (a genuine, fresh-read `teamMemberships`
  record on a currently `active` team — the same membership-then-team-status
  semantics `reportTeamSkillProgress` itself requires, re-derived
  independently of `authorizeTeamAccess`'s broader read-authorization
  result). A viewer for whom this is `false` — an app-admin-only viewer with
  no real membership, or a genuine member of a disabled team — sees the
  read-only stage list without the mutation control at all, never merely a
  disabled one. This is UI-visibility only: `reportTeamSkillProgress` remains
  the sole write-authorization boundary, and a caller who somehow submits
  without genuine team membership (e.g. a membership revoked between page
  load and submission) still receives the existing generic
  authorization-failure treatment from the server's `forbidden` response —
  never a distinct message that would reveal *why*.
- **BR-11**: The existing `/admin/teams/[teamId]` skill-tracking section
  (start tracking, set/advance stage, stop tracking) is visually and
  behaviorally unchanged — an app admin continues to have full write
  access via the unmodified admin route/operation, regardless of their
  own team membership.
- **BR-12**: The current-stage indicator and its accessible marking
  (`aria-current="step"` plus visible text, never color alone) are
  unchanged from Phase 7 and apply identically after either an admin's or
  a member's update.

**Firestore / infrastructure**
- **BR-13**: No new Firestore collection, field, or composite index is
  introduced. `reportTeamSkillProgress` reads/writes the identical
  `skillProgress/{teamId}__{treeId}` document shape Phase 7 already
  defined.
- **BR-14**: `PATCH /api/teams/[teamId]/skills/[treeId]` delegates to
  `reportTeamSkillProgress`, accepting only `{nodeId}` in the request
  body — identical whitelist discipline to the existing admin route.

## Edge cases and failure behavior
- **A real member who is also an app admin** uses the new member route for
  their own team → succeeds as a member (their `uid` is recorded via the
  member path); their separate app-admin capabilities are unaffected and
  evaluated independently.
- **A member's team membership is revoked between page load and
  submission** → `reportTeamSkillProgress` re-reads `teamMemberships`
  fresh at call time and rejects (`forbidden`) — never trusts an earlier
  page-load-time check, mirroring `submitSurveyResponse`'s established
  re-derivation-at-both-times pattern.
- **A member reports progress on a tree their team hasn't started
  tracking** → `not_tracked` (BR-3), identical outcome/shape to the same
  scenario via the existing admin path.
- **A member reports progress on a disabled team** → `team_disabled`
  (revised BR-4), zero writes — unlike the existing admin path
  (`updateTeamSkillProgress`, unaffected by team status per Phase 7
  Owner decision 5), because this is a *member*-originated write, and
  every existing member-originated write in this codebase requires an
  `active` team (see "Owner decisions" #4). The admin and member paths
  are deliberately no longer symmetric on this one dimension.
- **Two different real members, or a member and an admin, call their
  respective operations for the same `(teamId, treeId)` pair
  concurrently** → both writes succeed (no transaction); ordinary
  last-writer-wins determines the final value — this **extends, not
  changes**, Phase 7's existing accepted residual risk #1 (concurrent
  admin writes already resolved this way; adding a second class of caller
  does not introduce a new race, only a second source of the same
  already-accepted race).
- **A non-member, non-admin calls `reportTeamSkillProgress` directly**
  (bypassing the UI) → `forbidden`, zero writes — identical posture to
  every other member-gated write in this codebase.
- **A malformed or missing `treeId`** → `tree_not_found`, defensive,
  mirroring `updateTeamSkillProgress`'s identical existing check.

## Security and privacy
Cross-referencing `docs/SECURITY.md` rather than restating it — this
feature changes *who may write*, never *what is stored* or *what is
exposed*:

- **Invariant 10** (no individual employee data): unaffected —
  `skillProgress.currentNodeId` remains exactly as team-level as it was
  under admin-only writes; adding a second class of authorized writer
  does not make the stored value about any one person. `updatedBy` is
  bookkeeping metadata (which authenticated account most recently wrote
  the team-level value), not a displayed or aggregated individual data
  point — never returned by any API response (BR-5), same as today.
- **Invariants 8/9** (server-side team authorization; no cross-team
  leakage): `reportTeamSkillProgress` uses the same fresh, server-side
  `teamMemberships` re-derivation pattern `submitChallenge`/`createThread`
  already establish — never a cached or client-asserted relationship
  (BR-7).
- **Invariant 17** (admin access ≠ automatic raw-response access): not
  implicated — this feature has no raw/sensitive response data of any
  kind (unchanged from Phase 7).
- **No new sensitive-data class, no new encryption boundary.** A tree's
  `name`/node `label`s remain the only free text in this feature
  (unchanged, non-encrypted, per Phase 7's existing accepted residual
  risk). `skillProgress` itself carries no free text at all.
- **No new participation/attribution-tracking collection.** Unlike
  `SurveyParticipation`, there is no dedup requirement here — a member
  reporting progress twice simply overwrites `currentNodeId` again
  (BR-2), which is the intended behavior, not a race to prevent.

## Architecture decisions
- **New server operation, not a merged/dual-authorization rework of the
  existing one.** `reportTeamSkillProgress` is added as a new file
  (`src/features/skill-trees/server/report-team-skill-progress.ts`)
  alongside the unmodified `update-team-skill-progress.ts` — mirroring
  this codebase's existing submit-vs-manage split (Anonymous Challenges'
  `submitChallenge` vs. `resolveChallenge`/`archiveChallenge`; Team
  Forum's `createThread` vs. delete). Keeping the operations separate
  keeps each one's authorization boundary singular (one operation, one
  authorization rule) and each one's tests independent, rather than
  branching one operation's internals on caller type.
- **Reuse, don't reinvent, the membership-check seam.** The fresh
  `teamMemberships/{uid}__{teamId}` read and validation
  (`isValidMembershipFor`, `membershipDocId`, both already in
  `src/features/teams/domain/team-membership.ts`) are reused unchanged —
  the same primitives `submitChallenge`/`createThread`/`createReply`
  already depend on.
- **Reuse, don't reinvent, the team-status-gating seam.** The fresh
  `teams/{teamId}.status` read and validation (`isValidTeamStatus`,
  already in `src/features/teams/domain/team.ts`) are reused unchanged —
  the same primitive `submitChallenge`/`createThread`/`createReply`
  already depend on for their own, identically-shaped `team_disabled`
  rejection (revised BR-4 — see "Owner decisions" #4).
- **Reuse the node-membership validator.** The "is this `nodeId` present
  in this tree's own `nodes` list" check that `updateTeamSkillProgress`
  already performs is extracted or duplicated at implementation-task
  discretion (a small pure function) so both operations enforce the
  identical rule from one source of truth — a normal implementation
  decision, not a product/architecture decision this SPEC needs to
  settle.
- **New route**: `PATCH /api/teams/[teamId]/skills/[treeId]`, under the
  existing member-facing `/teams/...` namespace (matching
  `GET /api/teams/[teamId]/skills`'s existing sibling route), distinct
  from the unchanged admin route `PATCH /api/admin/teams/[teamId]/skills/
  [treeId]`.

## Data model
**Unchanged.** No new collection, no new field, no new document shape.
`reportTeamSkillProgress` writes the identical `skillProgress/{teamId}__
{treeId}` shape `docs/features/team-skill-tree/SPEC.md` → "Data model"
already defines:

```
skillProgress/{teamId}__{treeId}
    teamId: string
    treeId: string
    currentNodeId: string | null
    updatedAt: Timestamp   // trusted server-derived
    updatedBy: string      // trusted server-derived — the acting
                            // caller's uid, admin or member alike; never
                            // returned by any API response
```

## Lifecycle / state transitions
Unchanged from Phase 7's `SkillProgress` lifecycle table
(`docs/features/team-skill-tree/SPEC.md` → "Lifecycle semantics"). This
feature adds no new state and no new transition — it adds a second
authorized actor for the existing *tracked, not started* ↔ *tracked, at
stage N* transition (`updateTeamSkillProgress`'s row), leaving the
*(not tracked)* transitions (`startTeamSkillTracking`/
`stopTeamSkillTracking`) exactly as admin-only as before.

## Server operations
- **`reportTeamSkillProgress(idToken, teamId, treeId, nodeId, deps)`**
  (new)
  - `verifyIdToken` → reject `unauthenticated`.
  - Fresh-read `teamMemberships/{uid}__{teamId}`; missing/invalid
    (`isValidMembershipFor`) → `forbidden`. **No app-admin check of any
    kind** — admin status neither grants nor is required for this
    operation.
  - Fresh-read `teams/{teamId}.status` (validated via
    `isValidTeamStatus`); anything other than `"active"` (including a
    missing team or a malformed/unrecognized status) → **`team_disabled`**
    (revised BR-4 — see "Owner decisions" #4). This ordering — membership
    before team status — mirrors `submitChallenge`/`createThread`/
    `createReply` exactly, so a non-member of a disabled team still gets
    `forbidden`, never learning the team's status.
  - Fetch `skillProgress/{teamId}__{treeId}`; missing, **malformed, or
    with a persisted `teamId`/`treeId` not matching the requested scope**
    (validated via `isValidSkillProgress`, mirroring
    `updateTeamSkillProgress`'s identical existing handling exactly) →
    `not_tracked`, zero writes — never normalized or rewritten.
  - Fetch `skillTrees/{treeId}`; missing **or malformed** (validated via
    `isValidSkillTree`, mirroring `updateTeamSkillProgress`'s identical
    existing handling) → `tree_not_found` (defensive, unreachable in
    practice since trees are never deleted or structurally corrupted by
    any operation this codebase exposes).
  - Confirm `nodeId` is present in the tree's own `nodes` list →
    otherwise `invalid_input`.
  - `.update()` `skillProgress/{teamId}__{treeId}`: `{currentNodeId:
    nodeId, updatedAt: now, updatedBy: caller.uid}` — always performed,
    even when `nodeId` equals the record's current value (see
    "Concurrency/idempotency behavior" for why this is not treated as a
    no-op).
  - Return `{ok: true}`. Fail-closed on any Firestore error →
    `persistence_failed`.
- All six Phase 7 operations: **unchanged**, not reproduced here — see
  `docs/features/team-skill-tree/SPEC.md` → "Server operations."

## API/DTO contracts
| Route | Method | Delegates to | Request body | Auth error mapping |
|---|---|---|---|---|
| `/api/teams/[teamId]/skills/[treeId]` | PATCH | `reportTeamSkillProgress` (new) | `{nodeId}` only | `unauthenticated`→401, `forbidden`→403, `team_disabled`→400, `not_tracked`→404, `tree_not_found`→404, `invalid_input`→400, `persistence_failed`→500 |

Every other route from `docs/features/team-skill-tree/SPEC.md` →
"API/DTO contracts" is unchanged. `TeamSkillProgressView` (the DTO
`getTeamSkillProgress` returns) is unchanged — see BR-9.

**Permission-UI correction (added after initial delivery).**
`GET /api/teams/[teamId]/skills`'s response gains one additive, top-level
sibling field alongside the unchanged `skills` array:
`canReportProgress: boolean` (see "Revision note (permission-UI correction)"
above and BR-10). This is an envelope-level addition, not a
`TeamSkillProgressView` field — BR-9's "DTO unchanged" claim still holds for
every item in `skills`. The gateway (`fetchTeamSkills`) requires this field
to be strictly boolean; a missing or non-boolean value fails the whole
response closed to `read_failed` rather than defaulting to a permissive
value.

## UI/UX behavior
- **`/teams/[teamId]`**: the existing read-only Kompetanseområder section
  (Phase 7) gains, per already-tracked tree, a stage-setting control
  (e.g. a select or per-stage action) available to any authorized viewer
  of the page, submitting via the new route. Follows this feature area's
  existing conventions: semantic ordered list (never graphical), current
  stage marked by both text and `aria-current="step"`, generic
  authorization/infrastructure-failure states on rejection, no optimistic
  local update — a successful submission refreshes from the server's
  response.
- **`/admin/teams/[teamId]`** and **`/admin/skills`**: unchanged in every
  respect.
- No comment, voting, reaction, free-text note, or ranking/leaderboard
  control is added — unchanged non-goal.

## Accessibility behavior
Unchanged conventions from Phase 7 apply to the new control: keyboard-
operable, visible focus state, an associated accessible label, and the
same text-plus-`aria-current` current-stage marking (never color alone).

## Error/failure behavior
`reportTeamSkillProgress` fails closed on any Firestore error
(`persistence_failed`), validates all input before any write, and returns
the same discriminated-result-type shape this codebase's other operations
use — unchanged conventions from Phase 7.

## Firestore query/index requirements
**No new query, no new index.** `reportTeamSkillProgress` performs only
document-level `get`/`update` operations by deterministic/known ids
(`skillProgress/{teamId}__{treeId}`, `skillTrees/{treeId}`,
`teamMemberships/{uid}__{teamId}`) — identical operation shape to
`updateTeamSkillProgress`, which Phase 7 already established requires no
index. `firestore.rules`' existing deny-all blocks for `skillTrees`,
`skillProgress`, and `teamMemberships` already cover every collection this
feature touches — no rules change is needed.

## Concurrency/idempotency behavior
- **Same business end state, not a no-op**: calling `reportTeamSkillProgress`
  twice with the same `nodeId` leaves `currentNodeId` unchanged across
  both calls, but **each call still performs a real `.update()`**,
  refreshing `updatedAt`/`updatedBy` every time. This is a narrower
  notion of "idempotent" than this codebase otherwise uses the term for
  this feature — `startTeamSkillTracking`/`stopTeamSkillTracking`
  (Phase 7 — "Lifecycle semantics") are idempotent in the stronger,
  no-write sense (zero writes on a repeat call); this operation is not,
  and an implementer must not skip the write for a same-`nodeId` call on
  the mistaken assumption that it should.
- **Concurrent calls (any mix of member/admin callers) to the same pair**:
  last-writer-wins, no transaction — accepted, extending Phase 7's
  existing accepted residual risk #1 rather than introducing a new one
  (see "Edge cases and failure behavior").

## Bounded-list behavior
N/A — this feature adds a single-document write operation, no new list or
query.

## Accepted residual risks
1. **(Extends Phase 7's residual risk #1)** Concurrent
   `reportTeamSkillProgress`/`updateTeamSkillProgress` calls from any mix
   of members and admins resolve via ordinary last-writer-wins, with no
   transaction serializing them across the two operations.
2. **A single real member can unilaterally change the team's one shared,
   canonical displayed skill stage, with no peer/admin confirmation step,
   no history, and no visible attribution in v1.** This is a genuinely
   different risk shape from Team Forum/Anonymous Challenges, and is
   **not** mitigated the same way those features are: those let a
   member *add new content* (a thread, a reply, a challenge) that sits
   alongside everyone else's; this feature lets a member *overwrite the
   team's one existing shared value* that every other member/admin sees
   as "the" current stage. Accepted anyway, explicitly, as a v1 scope
   decision (see "Owner decisions" #1-#3 and the deliberate absence of
   history/confirmation from "Out of scope"): an app admin can always
   correct the value back via the unchanged `updateTeamSkillProgress`
   path, and the value is always simply overwritable again by any other
   authorized caller — but nothing records *that* a change happened,
   *who* made it beyond internal-only `updatedBy` bookkeeping, or *what*
   the value was before.
3. **`updatedBy` does not distinguish a member-authored update from an
   admin-authored one** in its stored shape — both are simply "some
   authorized caller's uid." This is intentional (Owner decision 1), not
   an oversight; since neither is ever returned by any API response, no
   product surface depends on this distinction existing.

## Test boundaries
| Boundary | Covers |
|---|---|
| `reportTeamSkillProgress` server tests | BR-1 through BR-7 — including: real-member success and exact persisted-shape assertion, exercised for a forward move, a backward move, **and a same-node (re-report identical stage) call, the last asserting `updatedAt`/`updatedBy` still refresh even though `currentNodeId` is unchanged** (see "Concurrency/idempotency behavior"); non-member/non-admin-only rejection (zero writes); an app-admin-and-real-member succeeding via this path with their own uid recorded; **rejection with `team_disabled` and zero writes against a disabled team, with a fresh `teams` read proven to occur (revised BR-4)**; `not_tracked` on an untracked pair; **`not_tracked` on a malformed persisted `skillProgress` document, and on one whose persisted `teamId`/`treeId` doesn't match the requested scope, each with zero writes** (mirrors `updateTeamSkillProgress`'s identical existing coverage); **`tree_not_found` on a malformed persisted `skillTrees` document**, in addition to a missing one; foreign `nodeId` rejection (`invalid_input`); cross-team rejection via a supplied foreign `teamId`; a request-body `teamId`/`treeId`/`updatedBy` override proven to have no effect; membership revoked between an earlier check and this call still rejected (fresh-read, not cached) |
| `getTeamSkillProgress` regression test | BR-9 — a `skillProgress` document most recently written by a member returns the identical DTO shape (no `updatedBy`/`updatedAt`) as one most recently written by an admin |
| Existing Phase 7 operation regression tests | BR-8 — `createSkillTree`/`updateSkillTree`/`listSkillTrees`/`startTeamSkillTracking`/`updateTeamSkillProgress`/`stopTeamSkillTracking`'s existing test suites continue to pass unmodified, proving no existing behavior changed |
| API route test | New `PATCH /api/teams/[teamId]/skills/[treeId]` route — auth/session wiring, status-code mapping (BR-14), and that only `{nodeId}` reaches `reportTeamSkillProgress` |
| Component test | The new team-page stage-setting control: loading/success/validation-error/authorization-failure/infrastructure-failure states; keyboard operability; current-stage marker unchanged after a member's own update |
| Privacy/DTO-shape regression test | `TeamSkillProgressView`'s full serialized shape still never contains `createdBy`/`updatedBy`/`createdAt`/`updatedAt` after a member-authored update, run against the actual TypeScript types/DTOs |

## Acceptance criteria
- [ ] A real team member can set their team's current stage on a tree the
      team already tracks, via `/teams/[teamId]`.
- [ ] A non-member, non-admin caller cannot report progress for any team,
      via the UI or the route directly.
- [ ] A real team member cannot report progress for a disabled team
      (`team_disabled`, zero writes; revised BR-4).
- [ ] An app admin's existing tree-management and team-tracking
      capabilities (`/admin/skills`, `/admin/teams/[teamId]`) are
      unchanged in behavior and test coverage.
- [ ] `getTeamSkillProgress`'s response DTO never includes `updatedBy`,
      `createdBy`, `updatedAt`, or `createdAt`, regardless of who most
      recently wrote the record.
- [ ] No new Firestore collection, field, or composite index exists after
      this feature ships.
- [ ] All BR-1 through BR-14 covered by the tests in "Test boundaries."
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Open questions
None. The three decisions Phase 7's Open Questions #1 flagged as needing
resolution before this could be built (attribution, direction, and
enablement scope) are resolved above under "Owner decisions" and require
no further product input before task planning.

## Approval gate
**Approved** (see "Status" above). `split-tasks` may now run; see
`TASKS.md` for the resulting task breakdown and per-task `Depends on`
sequencing.
