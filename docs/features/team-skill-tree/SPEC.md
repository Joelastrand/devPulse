# Team Skill Tree (Phase 7 — Skill / Capability Trees, v1 slice)

## Status
Approved and implemented — produced by `plan-feature`, revised after an
independent `review-change` planning review, approved after two independent
approval checks (the first of which failed on residual "capability"
technical-terminology wording, subsequently fixed; the second of which
passed all 16 approval conditions), and delivered through TASK-001 through
TASK-008 (`TASKS.md`), all `Done`. See `TASKS.md` for per-task outcomes and
`docs/ROADMAP.md` → "Phase 7" for the shipped-feature summary.

**Revision note (planning-review remediation pass).** An independent
planning review found six defects in the original draft: (1) the approval
gate was prose only, with no structural mechanism preventing `TASK-001`
from being picked up as an ordinary `Ready` task; (2) the SPEC overstated
"admin-only progress writes" as logically required by `docs/PRODUCT.md`'s
individual-performance non-goal, when it is actually an independent scope
decision; (3) grouping `startTeamSkillTracking` with genuine cleanup
operations under one disabled-team exemption was inconsistent with this
codebase's own creation-vs-management distinction; (4) full tree
immutability was disproportionately costly for ordinary typo correction on
shared, multi-team reference data; (5) `listSkillTrees` had no server-side
bound at all; (6) technical vocabulary mixed "skill" (domain/collections)
with "capability" (routes/UI). Product-owner decisions resolving all six
are recorded inline below and applied throughout this document. BR numbers
are preserved where the underlying requirement survived unchanged, even if
reworded; genuinely new requirements are appended as BR-31 and up, per this
repository's stable-numbering convention (see `docs/features/team-forum/
SPEC.md`'s identical precedent).

### Owner decisions (this revision)
1. **Team-level, never individual-level** — unchanged from the original
   draft; independently re-verified as well-grounded (see "Purpose").
2. **Strictly linear, 2-20-stage model** — unchanged; independently
   re-verified as well-grounded.
3. **Progress writes remain app-admin-only for v1** — kept, but now
   documented accurately as a deliberate scope-minimization decision, not
   as something `docs/PRODUCT.md`'s "not an individual employee
   performance monitoring system" non-goal logically requires. That
   non-goal grounds "no individual-level data" (point 1); it does not, by
   itself, forbid a real team member from writing team-level data — this
   codebase's own precedent (Anonymous Challenges, Team Forum: real member
   creates team-scoped content, admin moderates) argues the opposite
   default. Admin-only is kept anyway because it is the strictly more
   conservative choice for a v1 (fewer writers, smaller surface, and
   nothing about it forecloses adding member-initiated updates later as a
   pure addition). See "Authorization model."
4. **Technical vocabulary standardized on "skill"** across feature/domain
   terminology, TypeScript types, Firestore collections, and API route
   naming. "Capability" is retired from every *technical identifier* in
   this document (routes, operation names, collection names). Natural
   Norwegian UI copy (e.g. "Kompetanseområder") is localization, not a
   competing technical identifier, and is unaffected.
5. **Disabled-team semantics split by creation vs. management**, mirroring
   `submitChallenge`/`createSurvey`'s existing precedent rather than
   `resolveChallenge`/`archiveChallenge`/`deleteChallenge`'s: viewing
   remains allowed; `startTeamSkillTracking` (a creation-shaped action)
   **now rejects a disabled team**; `updateTeamSkillProgress` and
   `stopTeamSkillTracking` (both act on an *already-existing* record)
   **remain unaffected by team status**, exactly as before.
6. **Cosmetic correction of an existing SkillTree is now allowed**: an app
   admin may correct a tree's `name` and/or its existing nodes' `label`
   text. Node count, order, and every `nodeId` remain immutable — no
   operation can add, remove, reorder, or reassign a node's identity. See
   "Cosmetic tree correction" for the exact contract.
7. **SkillTree deletion remains out of v1** — unchanged.
8. **`listSkillTrees` gains an explicit, server-enforced `limit(500)`**,
   ordered by `createdAt` ascending for determinism. See "Firestore
   query/index requirements."
9. **Zero composite indexes re-derived, not assumed**, after every change
   in this revision — see "Firestore query/index requirements."
10. Both review Suggestions are applied: an explicit residual-risk line for
    admin-authored free text (see "Accepted residual risks"), and an
    explicit `skillProgress` query-failure test requirement (see
    `TASKS.md` TASK-004).

**Feature id note**, unchanged from the original draft: `docs/ROADMAP.md`
labels this phase "Skill / Capability Trees" and `docs/PRODUCT.md` speaks
of "Skill/capability trees for **teams and sections**." This document
scopes a deliberately smaller v1 — a **team-scoped** capability-maturity
tracker, not a "sections" or individual-person system. No "section"
concept exists anywhere in this codebase's data model or code today. The
feature id is `team-skill-tree`, mirroring `team-forum` (not
`developer-forum`)'s identical narrowing convention.

## Purpose / product outcome
DevPulse currently senses team wellbeing/delivery health (pulse surveys),
lets a member raise anonymous friction (Anonymous Challenges), and gives a
team an attributed discussion channel (Team Forum). None of these let a
team track **where it stands on a specific technical or organizational
capability** against a shared, admin-defined progression like the one
`docs/PRODUCT.md` already sketches: *Container fundamentals → Evaluate
alternatives → Build competence → Proof of concept → Pilot → Production
rollout → Monitoring and operations → Mature production capability*.

This feature lets an app admin define such a progression once (a
**SkillTree**: a named, ordered sequence of stages) and reuse it across any
number of teams, and lets an app admin record which stage a specific team
has reached for a tree it is tracking. A team's members/admins can see
their own team's progress, in context — never another team's.

**The single most consequential design decision in this document**: this
is **team-level, not individual/person-level**, data — there is no "a
person's skill level" anywhere in this feature's model. This is required
by existing, resolved product policy, independently verified against the
actual repository text:

- `docs/DATA-MODEL.md` already defines the (not-yet-implemented) concept
  as *"`SkillProgress` — **A team/section's** progress against a
  SkillTree"* — never a person's.
- `docs/PRODUCT.md` → "Non-goals": *"DevPulse is **not** an individual
  employee performance monitoring or ranking system,"* and *"does not
  surface individual wellbeing scores to anyone."* A per-person skill
  rating would be exactly the individual-performance data point this
  project has already ruled out.

> *Closeout note (2026-10-05):* the "per-person skill rating" sentence above is historical
> wording. Individual Skill Self-Assessment (C1) narrowed it, for self-reported,
> owner-only, development-oriented data only — see "Non-goals" below and
> `docs/features/individual-skill-self-assessment/SPEC.md`.

Because there is no individual-level data anywhere in this feature, an
entire class of investigation questions (self-assessment vs. manager
override of *a person's* level, behavior when a user leaves a team,
cross-team behavior for a multi-team user, peer-visible *employee*
capability exposure) does not arise — the data model that would raise them
is the one thing this document deliberately does not build.

**A separate, narrower question — who may write a *team's* (not a
person's) progress record — is not settled by the non-goals above, and
this document does not claim it is.** The individual-vs-team-level
non-goals only constrain *what kind of data* this feature stores; they say
nothing about *which authorized actor* may update a team-level record.
This codebase's own precedent for team-scoped content actually argues the
opposite default: Anonymous Challenges and Team Forum both let a real team
member create team-scoped content, with an app admin only moderating
afterward. **v1 nonetheless keeps progress writes app-admin-only**, as an
explicit, independent scope-minimization decision — the smallest, most
conservative v1 surface, not something the non-goal itself compels. See
"Authorization model" and "Open questions" for the full reasoning and what
a future member-write extension would need to add.

## Scope
- An app admin can define a **SkillTree**: a name plus an ordered list of
  2-20 named stages (**SkillNode**s), in one creation operation.
- An app admin can correct an existing SkillTree's `name` and/or its
  nodes' `label` text — cosmetically only; node count/order/identity
  cannot change (see "Cosmetic tree correction").
- An app admin can start tracking an existing SkillTree for a specific
  team (rejected if the team is disabled), set/change that team's current
  stage at any time, and stop tracking it.
- Any member or admin of a team can see, read-only, every SkillTree that
  team is tracking: the full ordered stage list and which stage the team
  has currently reached (or "not started").
- A non-member sees no skill content for a team they don't belong to.

## Explicit v1 behavior
- SkillTree definitions are **org-wide, admin-managed reference data** —
  not owned by any one team.
- A SkillTree's `nodes` array **count, order, and every node's `nodeId`
  are immutable after creation** — no operation can add, remove, reorder,
  or reassign a node's identity, ever. Only the tree's `name` and each
  node's `label` **text** may later be corrected (see "Cosmetic tree
  correction").
- A team's progress against a SkillTree is one pointer: `currentNodeId`,
  which an app admin sets directly to any node in that tree's list (moving
  it backward is allowed).
- Tracking is **admin-initiated per team**, not automatic: `startTeamSkill
  Tracking` is required before a tree has any effect on a team, and is
  rejected for a `disabled` team (Owner decision 5).
- Every write in this feature (create tree, correct tree, start/update/
  stop tracking) is **app-admin-only**. No team member, of any role, can
  perform any of them — self-assessment does not exist in v1 (see
  "Purpose").

## Non-goals
- **Individual/per-person skill assignment, self-assessment, or
  manager override of a person's level.** Ruled out by existing product
  policy (see "Purpose"), not merely unbuilt for convenience.
  *Clarification (2026-10-03, Team Skill Planning):* this excludes assigning a
  *skill or level* to a person; team maturity and skill tracking remain
  team-level. `docs/features/team-skill-planning/SPEC.md` later added one
  narrow exception — an optional responsible team member on a separate
  roadmap plan (`roadmapItems`), as planning metadata only: no authorization,
  no individual performance meaning, no `uid`/e-mail exposed. `skillProgress`
  is unchanged and never becomes per-person.
  *Closeout cross-reference (2026-10-05, Individual Skill Self-Assessment C1):* the
  blanket "per-person skill rating" wording in this document is historical. C1
  (`docs/features/individual-skill-self-assessment/SPEC.md`, approved A1) deliberately
  narrowed it for one category only: a **self-reported, person-owned, owner-only,
  development-oriented** self-assessment now exists in `skillProfiles`. Manager, lead,
  admin or team rating, ranking, scoring and monitoring remain prohibited, and
  `skillProgress` is still team-level. See `docs/PRODUCT.md` (Non-goals clarification).
- **Member-initiated (non-admin) progress writes.** Kept out of v1 as an
  independent scope-minimization decision, *not* one the individual-
  performance non-goal itself mandates — see "Purpose" and "Open
  questions" for what adding this later would require.
- **Section-scoped or org-wide (multi-team) skill trees.** No
  "section" concept exists in this codebase yet.
- **Arbitrary tree branching or nesting.** v1 models a single, strictly
  linear sequence of stages, capped at 20 nodes.
- **Structural editing of a SkillTree** — adding, removing, or reordering
  nodes, or changing any `nodeId`. **Cosmetic correction (name/label text
  only) is now supported** — see "Cosmetic tree correction." This is a
  narrower non-goal than the original draft's "no edit of any kind,"
  revised per Owner decision 6.
- **Deleting a SkillTree.** No delete operation exists anywhere in v1.
- **A numeric or boolean level model.** Progress is always "which named
  stage, in a fixed admin-defined sequence."
- **Comments, evidence, or free text** attached to a tree, a node, or a
  team's progress, beyond the tree's own `name`/node `label`s.
- **Progress history / an audit trail of past stage changes.**
- **A member-facing tree catalog / browse-all-trees page.**
  `listSkillTrees` is admin-only in v1.
- **Cross-team comparison, ranking, or leaderboard views.**
- **Search, filter, or sort** beyond `listSkillTrees`'s fixed
  `createdAt`-ascending order (Owner decision 8) — and **no true
  pagination**: a hard `limit(500)` stands in for it (see "Firestore
  query/index requirements").
- **Rate limiting / anti-abuse tooling.** Every write is app-admin-only.

## Terminology
- **SkillTree**: an admin-defined, org-wide, named capability progression
  — an ordered, count/order-immutable list of 2-20 **SkillNode**s. Not
  owned by any team. Its `name` and its nodes' `label` text may be
  cosmetically corrected after creation (Owner decision 6).
- **SkillNode**: one named stage within a SkillTree's fixed order.
  Identified by a `nodeId` that is stable for the life of the tree
  (`node-<zero-based index>`) — permanently so, since node count/order/
  identity can never change by any operation this feature exposes.
- **SkillProgress**: exactly one team's tracking record against exactly
  one SkillTree — `currentNodeId` (the stage that team has reached, or
  `null` for "tracked but not yet started") plus bookkeeping fields.
- **Tracking**: the admin action of creating a SkillProgress record for a
  `(teamId, treeId)` pair via `startTeamSkillTracking`.
- **Cosmetic correction**: an admin action (`updateSkillTree`) that
  changes a SkillTree's `name` and/or its existing nodes' `label` text
  only — never their count, order, or `nodeId`s.

## Data model
Two collections, following this codebase's established "server-only,
Admin-SDK-only, deny-all client rule, opaque generated ID" pattern.
Neither contains sensitive free text — see "Privacy/security model."

```
skillTrees/{treeId}
    name: string                // trusted client-provided, validated
                                 // (3-100 trimmed chars); may be
                                 // cosmetically corrected later
    nodes: {
      nodeId: string             // server-assigned at creation
                                  // ("node-0", "node-1", ...); IMMUTABLE
      label: string              // trusted client-provided, validated
                                  // (3-100 trimmed chars); may be
                                  // cosmetically corrected later
      order: number               // trusted server-derived (= array
                                   // index at creation); IMMUTABLE
    }[]                           // 2-20 entries; count/order IMMUTABLE
    createdAt: Timestamp          // trusted server-derived
    createdBy: string             // trusted server-derived (acting
                                   // admin's uid) — never returned by any
                                   // API response
    updatedAt?: Timestamp         // trusted server-derived; absent until
                                   // the first cosmetic correction, then
                                   // always present alongside updatedBy
    updatedBy?: string            // trusted server-derived (acting
                                   // admin's uid at last correction) —
                                   // never returned by any API response;
                                   // always present iff updatedAt is
```

`updatedAt`/`updatedBy` are a deliberate, explicit addition in this
revision — introduced because a SkillTree is no longer a strict
write-once record once cosmetic correction exists, and every other
mutable collection in this codebase (`skillProgress`, `challenges`)
already carries equivalent bookkeeping for the same internal-
accountability reason. Both are optional and paired: a tree that has
never been corrected has neither field; a tree corrected at least once has
both. `isValidSkillTree` (TASK-001) enforces this pairing, mirroring
`isValidChallenge`'s established paired-optional-fields convention for
`resolvedAt`/`resolvedBy`.

```
skillProgress/{teamId}__{treeId}     // deterministic composite key, mirrors
                                      // teamMemberships/{uid}__{teamId} and
                                      // teamSurveyState/{teamId}
    teamId: string              // trusted server route scope
    treeId: string               // trusted server route scope
    currentNodeId: string | null // client-provided (admin only), validated
                                  // against the tree's own node list on
                                  // every write; null = tracked, not
                                  // started
    updatedAt: Timestamp          // trusted server-derived
    updatedBy: string             // trusted server-derived (acting
                                   // admin's uid) — never returned by any
                                   // API response
```

**No `SkillNode` collection** — nodes are embedded as an ordered array on
their parent `skillTrees` document (unchanged rationale from the original
draft: nodes have no independent lifecycle, so a separate collection/query
would add cost for nothing this feature needs). **No `SkillProgress`
history/audit collection. No coordination document.**

`treeId` is a Firestore auto-generated document ID (`.add()`), never
client-supplied or content-derived. `nodeId` values are server-assigned at
tree-creation time (`node-0`, `node-1`, ...) and are **permanently
immutable** — no operation this feature exposes, including cosmetic
correction, can ever change a node's `nodeId`, its position, or the total
node count. This is what makes `skillProgress.currentNodeId` a stable,
unambiguous reference for the life of the tree.

## Lifecycle semantics

### SkillTree lifecycle
A SkillTree, once created, exists in exactly one of two observable states:
**never corrected** (no `updatedAt`/`updatedBy`) or **corrected at least
once** (both present, reflecting only the most recent correction — no
history of prior corrections is kept). There is no archive/disable/delete
state — see "Non-goals." Node count/order/identity is invariant across
both states.

### Cosmetic tree correction
`updateSkillTree(idToken, treeId, name, nodeLabels[], deps)` — the
smallest safe operation that can correct a tree's display text without
ever being able to touch its structural identity:

- Requires **app admin** (`requireAppAdmin`).
- Fetches and runtime-validates the existing `skillTrees/{treeId}`
  (`isValidSkillTree`, TASK-001) — missing/malformed → `tree_not_found`.
- Validates `name` and `nodeLabels` with the **same validators creation
  uses** (`validateSkillTreeName`, `validateSkillNodeLabels` — 3-100 trimmed
  chars per label, 2-20 total) → `invalid_input` otherwise, nothing read
  further or written.
- **Requires `nodeLabels.length === existingTree.nodes.length` exactly** —
  a different length is rejected with a distinct outcome, `node_count_
  mismatch`, before anything is written. This is the one check that exists
  specifically to reject an attempted node insertion/removal.
- Builds the new `nodes` array by **positional replacement only**:
  `existingTree.nodes.map((node, i) => ({...node, label: nodeLabels[i]}))`
  — every node's `nodeId` and `order` are always copied unchanged from the
  already-fetched existing record; **the request body itself has no field
  capable of expressing a `nodeId`, an insertion, a removal, or a reorder**
  (`nodeLabels` is a plain `string[]`, not an array of node objects) — this
  is a structural guarantee, not merely a validated one.
- `.update()` `skillTrees/{treeId}`: `{name, nodes, updatedAt: now,
  updatedBy: caller.uid}` — `createdAt`/`createdBy` are never touched.
- Returns `{ok: true}`.
- Fail-closed on any Firestore error → `persistence_failed`.

**Request body whitelist**: `{name: string, nodeLabels: string[]}` only —
never `treeId` (route-scoped), never a `nodes` array of objects, never a
`nodeId`, never `updatedAt`/`updatedBy`/`createdAt`/`createdBy`, never any
`skillProgress`-shaped field. A request carrying any of these has no
effect — the operation's own signature and Firestore write set have no
path for them to reach, regardless of what the client sends.

**Why full-replace, not partial-merge.** The caller resubmits both `name`
and the complete `nodeLabels` array (even to fix one label) rather than a
partial `{label, index}`-style patch. This avoids an entire class of
partial-update ambiguity (what does omitting a field mean? what if two
concurrent partial updates target different labels?) for a feature with no
concrete need for partial correction — mirrors this codebase's general
preference for the smallest unambiguous contract over a more flexible one
with no identified use.

**Existing `skillProgress` documents remain valid, with no migration.**
Because `nodeId`/`order`/count are never touched, any `skillProgress.
currentNodeId` referencing this tree before a correction resolves to the
identical node (same `nodeId`) after it — only that node's `label` text
may read differently. No `skillProgress` document is read, written, or
needs to change as a result of `updateSkillTree`.

### SkillProgress lifecycle, per `(teamId, treeId)` pair

| State | Reached by | Who | Reversible? |
|---|---|---|---|
| *(not tracked)* | Initial state; also reached by `stopTeamSkillTracking` | N/A | N/A |
| *tracked, not started* (`currentNodeId: null`) | `startTeamSkillTracking` | App admin only | Yes — `updateTeamSkillProgress` moves it to any stage; `stopTeamSkillTracking` returns to *(not tracked)* |
| *tracked, at stage N* | `updateTeamSkillProgress` | App admin only | Yes — freely settable to any other stage, forward or backward; `stopTeamSkillTracking` returns to *(not tracked)* |

- **Idempotency**: `startTeamSkillTracking` on an already-tracked pair is a
  no-op success that does **not** reset `currentNodeId`. `stopTeamSkill
  Tracking` on a not-currently-tracked pair is a no-op success, not an
  error.
- **Restart is unambiguous**: stopping tracking deletes the
  `skillProgress` document entirely; a later `startTeamSkillTracking` for
  the same pair creates a fresh document with `currentNodeId: null` — the
  identical initial state as the very first time that pair was tracked.
  There is no residual state anywhere (no history collection) that could
  make a restart's initial stage ambiguous.
- **No monotonicity constraint**: `updateTeamSkillProgress` accepts any
  node in the tree, including one earlier in the sequence than the current
  value.
- **Concurrent `updateTeamSkillProgress` calls** resolve via ordinary
  last-writer-wins (no transaction) — see "Edge cases and concurrency" for
  why this is accepted, not fixed.
- **Deleting `skillProgress` on `stopTeamSkillTracking` is a genuine,
  intentional loss of the current-stage pointer** — nothing else in this
  document or the existing product docs expects that value retained once
  tracking stops (v1 has no history/audit feature for it to belong to; see
  "Non-goals").

### Disabled-team interaction (Owner decision 5)
Split by whether the operation *creates* a new tracking relationship or
*manages an already-existing* one — mirroring this codebase's own
established distinction (`submitChallenge`/`createSurvey` block new
creation on a disabled team; `resolveChallenge`/`archiveChallenge`/
`deleteChallenge` do not gate existing-data management):

- **`startTeamSkillTracking`** (creation-shaped): fresh-reads
  `teams/{teamId}.status` and **rejects a `disabled` team**
  (`team_disabled`), exactly like `submitChallenge`/`createSurvey`. A
  missing or status-malformed team fails closed as `team_not_found`
  (unchanged from the original draft).
- **`updateTeamSkillProgress`** and **`stopTeamSkillTracking`**
  (management of an already-existing `skillProgress` record): **neither
  reads `teams/{teamId}.status` at all** — both remain fully available on
  a disabled team, mirroring `resolveChallenge`/`archiveChallenge`/
  `deleteChallenge`'s identical posture.
- **Reading** (`getTeamSkillProgress`): unaffected by team status either
  way, as in the original draft.

## Authorization model
Two boundaries — every write is admin-only; the one read operation uses
the existing broader member/admin viewing boundary:

- **Definitions** (`createSkillTree`, `updateSkillTree`, `listSkillTrees`):
  `requireAppAdmin` — the same boundary every other admin-only management
  action in this codebase already uses. Not team-scoped at all.
- **Team tracking management** (`startTeamSkillTracking`,
  `updateTeamSkillProgress`, `stopTeamSkillTracking`): `requireAppAdmin`.
  No team-membership check of any kind — unchanged posture, app admin ≠
  needing real membership.
- **Reading** (`getTeamSkillProgress`): `authorizeTeamAccess` must resolve
  to `"admin"` or `"member"` for the requested `teamId`; `"denied"` is
  rejected.

**On the admin-only-writes decision specifically** (Owner decision 3, see
also "Purpose"): this is recorded here as a deliberate, independently
chosen v1 scope boundary — the strictly more conservative of two
legitimate options — not as a conclusion `docs/PRODUCT.md`'s non-goals
compel. Nothing about this choice is structurally incompatible with a
future feature adding a second, member-scoped write path (e.g. a
member-initiated proposal an admin approves) — that would be a pure
addition to this authorization model, not a rework of it. See "Open
questions."

Every operation re-derives `teamId`/`treeId` from the caller's trusted
route scope; every `updateTeamSkillProgress` call re-validates the
supplied `nodeId` against a fresh server-side read of the target tree's
own `nodes` list; every `updateSkillTree` call re-validates `nodeLabels`'
length against a fresh server-side read of the existing tree's own node
count — no client-supplied value is ever trusted as structurally valid
merely because the client supplied it.

## Privacy/security model
This feature's data is **organizational/technical reference data, not
personal or sensitive data**. Cross-referencing `docs/SECURITY.md` rather
than restating it:

- **Invariants 1-6 (application-level encryption for sensitive/anonymous
  content) do not apply.** There is no anonymous-identity concept in this
  feature at all, and its only free text (a tree's `name`/node `label`s)
  is short, admin-authored, and attributed (`createdBy`/`updatedBy`
  persisted) — the same trust/sensitivity class as `teams.name` or
  `surveys.title`, neither of which is encrypted. See "Accepted residual
  risks" for the acknowledged (low-probability) exposure this still
  leaves.
- **Invariant 10 (individual wellbeing scores never shown as individual
  employee data) is satisfied architecturally**: this feature's data
  model has no field, anywhere, capable of representing a person's own
  skill level.
- **Invariants 8/9 (server-side team authorization; no cross-team
  leakage)**: `getTeamSkillProgress` requires `authorizeTeamAccess` for
  the requested team, exactly like every other team-scoped read in this
  codebase.
- **Invariant 17 (admin access ≠ automatic raw-response access)**: not
  meaningfully in tension here — an app admin already has full read/write
  authority over this entire feature's dataset by design, the same as
  their authority over `teams`/`surveys` metadata.
- **Invariant 16 (data minimization/retention from the start)**: addressed
  by scope — no history log, no per-person field. `createdBy`/`updatedBy`
  on both collections are persisted for internal accountability only and
  are never returned by any API response.

## Server operations
All server-only (`"server-only"` import, Firebase Admin SDK), one function
per operation with an injectable dependency seam for testing. **No
operation in this feature requires a Firestore transaction** — every write
is a single document create/update/delete with no cross-document invariant
to protect against a race (see "Edge cases and concurrency" for the one
accepted last-writer-wins exception).

- **`createSkillTree(idToken, name, nodeLabels[], deps)`**
  - `requireAppAdmin` → reject otherwise.
  - Validate `name` (3-100 trimmed chars) and `nodeLabels` (2-20 entries,
    each 3-100 trimmed chars) → `invalid_input` otherwise.
  - Build `nodes = nodeLabels.map((label, i) => ({nodeId: `node-${i}`,
    label, order: i}))`.
  - `.add()` to `skillTrees`: `{name, nodes, createdAt: now, createdBy:
    caller.uid}` — no `updatedAt`/`updatedBy` field written at all
    (absent, not `null`, until a first correction).
  - Return `{ok: true, treeId}`.
  - Fail-closed on any Firestore error → `persistence_failed`.

- **`updateSkillTree(idToken, treeId, name, nodeLabels[], deps)`** — see
  "Cosmetic tree correction" above for the full contract; summarized here
  for operation-list completeness: `requireAppAdmin` → fetch + validate
  existing tree (`tree_not_found`) → validate `name`/`nodeLabels` format
  (`invalid_input`) → validate `nodeLabels.length === existing nodes.length`
  (`node_count_mismatch`) → positional-replace labels only, preserving
  `nodeId`/`order` → `.update()` with `updatedAt`/`updatedBy` set →
  `{ok: true}`. Fail-closed → `persistence_failed`.

- **`listSkillTrees(idToken, deps)`**
  - `requireAppAdmin` → reject otherwise.
  - Query `skillTrees` with `.orderBy("createdAt", "asc").limit(500)` (Owner
    decision 8 — see "Firestore query/index requirements") → map each to
    `SkillTreeView`.
  - Returns `{ok: true, trees: SkillTreeView[]}`. If more than 500
    `skillTrees` documents exist, this returns exactly the 500
    oldest-created and silently omits the rest — the response is never
    accompanied by a total count or any other signal implying it is
    exhaustive (BR-6).

- **`startTeamSkillTracking(idToken, teamId, treeId, deps)`**
  - `requireAppAdmin` → reject otherwise.
  - Fetch `skillTrees/{treeId}`; missing → `tree_not_found`.
  - Fetch `teams/{teamId}.status` fresh, validated via `isValidTeamStatus`
    (reused unchanged from `src/features/teams/domain/team.ts`); missing/
    malformed → `team_not_found`; `"disabled"` → **`team_disabled`**
    (Owner decision 5 — new in this revision); `"active"` → proceed.
  - Fetch `skillProgress/{teamId}__{treeId}`; if it already exists → return
    `{ok: true}` unchanged, no write.
  - Otherwise `.set()` `skillProgress/{teamId}__{treeId}`: `{teamId,
    treeId, currentNodeId: null, updatedAt: now, updatedBy: caller.uid}`.
  - Fail-closed on any Firestore error → `persistence_failed`.

- **`updateTeamSkillProgress(idToken, teamId, treeId, nodeId, deps)`**
  - `requireAppAdmin` → reject otherwise.
  - Fetch `skillProgress/{teamId}__{treeId}`; missing → `not_tracked`.
  - Fetch `skillTrees/{treeId}`; missing → `tree_not_found` (defensive —
    unreachable in v1 since trees are never deleted).
  - Confirm `nodeId` is present in the tree's own `nodes` list → otherwise
    `invalid_input`.
  - `.update()` `skillProgress/{teamId}__{treeId}`: `{currentNodeId:
    nodeId, updatedAt: now, updatedBy: caller.uid}`. **No `teams/{teamId}`
    read of any kind** (Owner decision 5 — unaffected by team status).
  - Fail-closed on any Firestore error → `persistence_failed`.

- **`stopTeamSkillTracking(idToken, teamId, treeId, deps)`**
  - `requireAppAdmin` → reject otherwise.
  - `.delete()` `skillProgress/{teamId}__{treeId}` unconditionally —
    idempotent by construction. **No `teams/{teamId}` read of any kind.**
  - Fail-closed on any Firestore error → `persistence_failed`.

- **`getTeamSkillProgress(idToken, teamId, deps)`**
  - `authorizeTeamAccess(identity, teamId)` → `"admin"`/`"member"`
    required; `"denied"` → `forbidden`; a `read_failed` from the check
    itself is never collapsed into `forbidden`.
  - Query `skillProgress` where `teamId == teamId` (single-field, no
    composite index).
  - For each result: validate the record (fail-closed — skip a malformed
    one) → fetch its `skillTrees/{treeId}` by direct document `get`;
    missing/malformed → skip this record too → map to
    `TeamSkillProgressView` (`treeId`, `name`, `nodes`, `currentNodeId`) —
    never `createdBy`/`updatedBy`/`updatedAt`/`createdAt`.
  - Returns `{ok: true, skills: TeamSkillProgressView[]}`.

Error contracts follow this codebase's existing convention: a discriminated
result type distinguishing a genuine authorization/validation outcome from
`{ok: false, error: "read_failed" | "persistence_failed"}` for an
infrastructure failure.

## API/DTO contracts
Routes are thin delegates, each reading only the exact whitelisted body
field(s) named below. **Route namespace is `/skills`, not `/capabilities`**
(Owner decision 4 — technical identifiers use "skill" throughout):

| Route | Method | Delegates to | Request body | Auth error mapping |
|---|---|---|---|---|
| `/api/admin/skills` | GET | `listSkillTrees` | — | `unauthenticated`→401, `forbidden`→403, else→500 |
| `/api/admin/skills` | POST | `createSkillTree` | `{name, nodeLabels}` only | `unauthenticated`→401, `forbidden`→403, `invalid_input`→400, `persistence_failed`→500 |
| `/api/admin/skills/[treeId]` | PATCH | `updateSkillTree` | `{name, nodeLabels}` only | `unauthenticated`→401, `forbidden`→403, `tree_not_found`→404, `invalid_input`→400, `node_count_mismatch`→400, `persistence_failed`→500 |
| `/api/admin/teams/[teamId]/skills` | POST | `startTeamSkillTracking` | `{treeId}` only | `unauthenticated`→401, `forbidden`→403, `tree_not_found`→404, `team_not_found`→404, `team_disabled`→400, `persistence_failed`→500 |
| `/api/admin/teams/[teamId]/skills/[treeId]` | PATCH | `updateTeamSkillProgress` | `{nodeId}` only | `unauthenticated`→401, `forbidden`→403, `not_tracked`→404, `tree_not_found`→404, `invalid_input`→400, `persistence_failed`→500 |
| `/api/admin/teams/[teamId]/skills/[treeId]` | DELETE | `stopTeamSkillTracking` | — | `unauthenticated`→401, `forbidden`→403, `persistence_failed`→500 |
| `/api/teams/[teamId]/skills` | GET | `getTeamSkillProgress` | — | `unauthenticated`→401, `forbidden`→403, else→500 |

Response DTOs (client-facing; the gateway rebuilds each item from only
these fields):

```ts
type SkillNodeView = {
  nodeId: string;
  label: string;
  order: number;
};

type SkillTreeView = {
  treeId: string;
  name: string;
  nodes: SkillNodeView[];
};

type TeamSkillProgressView = {
  treeId: string;
  name: string;
  nodes: SkillNodeView[];
  currentNodeId: string | null;
};
```

Neither DTO ever includes `createdAt`, `createdBy`, `updatedAt`, or
`updatedBy` in v1.

## UI/UX behavior
- **`/admin/skills`** (renamed from `/admin/capabilities` — Owner decision
  4; the rendered Norwegian heading may still read "Kompetanseområder,"
  which is localization, not the route's technical identifier): a
  creation form (tree name + a dynamic list of stage-label inputs, 2-20,
  add/remove-row controls) and a read-only catalog list of existing trees
  (bounded at 500, oldest-created first — BR-6). Each catalog entry also
  offers a **correction** action for an app admin: a form pre-filled with
  the tree's current `name`/labels, with **no add/remove-row controls at
  all** (the row count is fixed to the existing tree's node count — the UI
  itself cannot submit a different count, mirroring the server operation's
  structural guarantee). A non-admin sees the generic no-permission state.
  Linked from `/admin/teams` (no dedicated admin dashboard/index page
  exists in this codebase to link from instead).
- **`/admin/teams/[teamId]`** gains a "Kompetanseområder" (capability
  areas — UI copy, not a technical identifier) section: a picker to start
  tracking any catalog tree not yet tracked by this team; for each
  already-tracked tree, its ordered stage list with the current stage
  marked and a control to set/advance it to any stage; a "stop tracking"
  action per tree. **The "start tracking" picker is hidden/disabled for a
  disabled team** (mirrors Anonymous Challenges' submission-panel
  precedent, now that `startTeamSkillTracking` genuinely rejects a
  disabled team) — the existing "set stage"/"stop tracking" controls for
  *already-tracked* trees remain available regardless of team status,
  matching the server contract exactly.
- **`/teams/[teamId]`** gains a read-only "Kompetanseområder" section,
  visible to an authorized member/admin: for each tracked tree, its name
  and full ordered stage list rendered as a semantic ordered list (`<ol>`),
  with the current stage marked (e.g. "Nåværende steg") and every other
  stage shown plainly — never a graphical/canvas/SVG rendering. A tree
  with `currentNodeId: null` shows a distinct "ikke startet" state. A
  non-member sees no skill content or data.
- No comment, voting, reaction, free-text, per-person assignment, or
  ranking/leaderboard feature exists anywhere.

## Accessibility behavior
- The stage sequence is always a semantic ordered list (`<ol>`/`<li>`),
  never a graphical diagram.
- The current stage is marked with `aria-current="step"` plus visible text
  — never color alone.
- The tree-creation form's dynamic add/remove-stage-row controls are each
  a real, keyboard-operable, labeled button; the correction form's fixed
  row count needs no add/remove controls at all. Boundary validation
  errors (fewer than 2, more than 20 for creation; a length mismatch for
  correction — structurally impossible to trigger from the correction
  form's own UI, but still defended server-side) are reported as
  associated, accessible error messages.
- Every admin action button is keyboard-operable with a visible focus
  state.

## Error/failure behavior
- Every management operation fails closed on a Firestore error
  (`persistence_failed`) with nothing partially written.
- Every write operation validates all input before any Firestore read or
  write beyond the target-fetch itself.
- A generic infrastructure-failure UI state (no internal error detail
  exposed) is shown for any `persistence_failed`/`read_failed` outcome.

## Firestore query/index requirements
**Re-derived from scratch against the final, revised operation set — not
assumed to still hold from the original draft.** No composite index is
introduced by this feature:

- **`listSkillTrees`**: `skillTrees` with `.orderBy("createdAt", "asc")`
  and `.limit(500)`, no `.where()` clause. A single-field `orderBy` with no
  additional equality/range filter on a different field is auto-indexed by
  Firestore — this is the same category of query as `listActiveTeams`'
  single-field filter, just ordered instead of filtered; `.limit()` never
  triggers an index requirement by itself. **This conclusion is
  independent of the 500 cap added in this revision** — adding `.limit()`
  to an already-index-free query cannot introduce a new index requirement.
- **`getTeamSkillProgress`**: `skillProgress` where `teamId == teamId` — a
  single-field equality filter, auto-indexed. Unchanged from the original
  draft.
- **`updateSkillTree`** (new in this revision): a direct `skillTrees/
  {treeId}` `get()` followed by an `update()` by the same known id — a
  document-level operation, not a query. No index applies.
- Every other operation (`createSkillTree`'s `.add()`;
  `startTeamSkillTracking`/`updateTeamSkillProgress`/
  `stopTeamSkillTracking`'s direct `get`/`set`/`update`/`delete` by
  deterministic or already-known ids) remains a document-level operation,
  unaffected by this revision.

`firestore.rules` gains two additive deny-all blocks, identical in form to
every existing collection's block (unchanged from the original draft):

```
match /skillTrees/{document=**} {
  allow read, write: if false;
}
match /skillProgress/{document=**} {
  allow read, write: if false;
}
```

## Edge cases and concurrency
- **Two admins call `updateTeamSkillProgress` for the same
  `(teamId, treeId)` with different `nodeId` values concurrently** → both
  writes succeed (no transaction); last-writer-wins determines the final
  value — accepted, not fixed with a transaction (unchanged reasoning from
  the original draft: there is no "correct" merged value when two admins
  actively disagree about a team's own current stage).
- **Two admins call `startTeamSkillTracking` for the same pair
  concurrently** → both succeed; the second is a no-op regardless of write
  order, since the initial state is identical either way.
- **`updateTeamSkillProgress` races `stopTeamSkillTracking`** → if the
  delete lands first, the update's fetch finds nothing and returns
  `not_tracked`; if the update lands first, the delete still succeeds
  unconditionally.
- **A team is disabled while an admin has the "start tracking" picker
  open** → the picker's own earlier render is unaffected; the next attempt
  is rejected fresh with `team_disabled` (new behavior in this revision —
  previously this scenario had no rejection path at all).
- **Two admins call `updateSkillTree` on the same tree concurrently with
  different corrections** → both writes succeed (no transaction);
  last-writer-wins on `name`/`nodes`/`updatedAt`/`updatedBy` — accepted for
  the same reason as concurrent progress updates: no transaction serializes
  a plain `.update()`, and there is no "correct" merged correction when two
  admins actively disagree. Node identity is unaffected either way, since
  both writes independently derive their `nodes` array from the same
  positional-replacement rule.
- **A `treeId` referenced by an existing `skillProgress` document no
  longer resolves** (structurally unreachable in v1, since no tree-delete
  operation exists, but defensively handled) → `getTeamSkillProgress`
  excludes that one record; `updateTeamSkillProgress` against it returns
  `tree_not_found`.
- **A malformed `skillProgress` or `skillTrees` document is present** →
  excluded from `getTeamSkillProgress`'s response, never crashes the
  request.
- **More than 500 `skillTrees` documents exist** → `listSkillTrees`
  returns exactly the 500 oldest-created; the 501st-and-later trees are
  invisible to the admin catalog/picker UI until an older tree is somehow
  removed from the returned window (which cannot happen in v1, since no
  delete exists) — an accepted v1 bound, not a pagination mechanism (see
  "Accepted residual risks").

## Accepted residual risks
1. Concurrent `updateTeamSkillProgress` or `updateSkillTree` calls from two
   different admins resolve via ordinary last-writer-wins, with no
   transaction serializing them.
2. No delete exists for a `SkillTree` in v1 — a mistakenly-created or
   now-obsolete tree accumulates in the catalog indefinitely (cosmetic
   correction fixes typos, but cannot remove an unwanted tree entirely).
3. No history/audit trail of past `currentNodeId` values, or of prior
   cosmetic corrections, exists — only the current state is ever visible
   or queryable.
4. `createdBy`/`updatedBy` (acting admin `uid`s, on both collections) are
   persisted but never returned by any API response in v1.
5. **(New in this revision)** A tree's `name` and node `label`s are
   short, admin-typed free text. Nothing architecturally prevents an admin
   from typing something identifying or sensitive into one (e.g.
   referencing a specific person by name in a label) — this cannot be
   prevented by validation alone, and no automated scanning exists or is
   planned for v1. Mitigated only by the fields' intended purpose (short
   taxonomy labels, not narrative text) and their small length bound
   (3-100 chars), which structurally discourages, without preventing,
   this kind of content. Mirrors Anonymous Challenges' identical,
   explicitly accepted residual risk for its own free text.
6. **(New in this revision)** If more than 500 `skillTrees` documents ever
   exist, `listSkillTrees` silently omits the 501st-and-later (oldest-
   first ordering keeps the same 500 visible as the collection grows) —
   accepted since no product scenario in this document produces anywhere
   near that volume, and no pagination exists in v1 to reach the rest.

## Business requirements
BR numbers are preserved from the original draft where the underlying
requirement is unchanged, even if reworded for the operation renames in
Owner decision 4. Six BRs are revised in place (BR-4, BR-6, BR-10, BR-16,
BR-25, and BR-27's UI text) because the underlying requirement itself
changed; five are newly appended (BR-31 through BR-35).

**Tree definitions**
- **BR-1**: Only an app admin (`requireAppAdmin`) may create a SkillTree;
  no other caller may.
- **BR-2**: SkillTree creation (and, per BR-31, cosmetic correction)
  requires a `name` (3-100 trimmed characters) and node labels (each
  3-100 trimmed characters); creation additionally requires 2-20 labels
  total; any other input is rejected with nothing persisted.
- **BR-3**: Each node receives a stable `nodeId` (`node-<zero-based
  index>`) matching its position in the submitted label order at
  creation; node identity and order are fixed from that point on,
  permanently (see BR-4).
- **BR-4** *(revised — see BR-31/BR-32 for the new cosmetic-correction
  behavior this narrows against)*: A SkillTree's `nodes` array **count,
  order, and every node's `nodeId`** are immutable after creation — no
  operation, including cosmetic correction, may add, remove, reorder, or
  reassign a node's identity, in v1.
- **BR-5**: No delete operation exists for a SkillTree in v1.
- **BR-6** *(revised)*: `listSkillTrees` requires `requireAppAdmin` and
  returns each SkillTree's `treeId`, `name`, and full `nodes` list,
  ordered by `createdAt` ascending, bounded to the 500 oldest — **not**
  unfiltered/unpaginated as the original draft stated. If more than 500
  `skillTrees` documents exist, the response is never accompanied by any
  signal implying it is exhaustive.
- **BR-7**: `treeId` is a Firestore auto-generated, opaque document ID —
  never client-supplied or derived from `name`/node content.

**Team skill tracking / management**
- **BR-8**: Only an app admin may start tracking a SkillTree for a team
  (`startTeamSkillTracking`); no team member, of any role, may.
- **BR-9**: Starting tracking for an already-tracked `(teamId, treeId)`
  pair is idempotent — a no-op success that does not reset
  `currentNodeId`.
- **BR-10** *(revised — split from disabled-team behavior, now BR-33)*:
  Starting tracking rejects a nonexistent `treeId` (`tree_not_found`) or a
  nonexistent/malformed-status `teamId` (`team_not_found`). See BR-33 for
  the separate, new disabled-team rejection.
- **BR-11**: Only an app admin may set a team's current stage for a
  tracked tree (`updateTeamSkillProgress`); no team member, of any role,
  may self-report or self-assess in v1 — a deliberate v1 scope decision,
  not one `docs/PRODUCT.md`'s individual-performance non-goal itself
  compels (see "Purpose").
- **BR-12**: `updateTeamSkillProgress` rejects a `nodeId` not present in
  the target tree's own `nodes` list (`invalid_input`), and rejects the
  call entirely if the `(teamId, treeId)` pair has not first been started
  via `startTeamSkillTracking` (`not_tracked`).
- **BR-13**: `updateTeamSkillProgress` accepts any valid `nodeId` in the
  tree, including one earlier than the team's current value — no
  forward-only/monotonic constraint is enforced.
- **BR-14**: Only an app admin may stop tracking a SkillTree for a team
  (`stopTeamSkillTracking`), permanently deleting that team's
  `skillProgress` document; no team member may.
- **BR-15**: Stopping tracking for a `(teamId, treeId)` pair that is not
  currently tracked is idempotent — a no-op success, not an error.
- **BR-16** *(revised)*: Neither `updateTeamSkillProgress` nor
  `stopTeamSkillTracking` is gated on the owning team's `active`/
  `disabled` status. `startTeamSkillTracking`'s disabled-team behavior is
  governed separately by BR-33, **not** exempted.
- **BR-17**: Every management operation re-derives `teamId`/`treeId` from
  the caller's trusted route scope; `updateTeamSkillProgress`'s `nodeId`
  is validated against a fresh server-side read of the tree's own node
  list; never trusted merely because the client supplied it.

**Reading**
- **BR-18**: `getTeamSkillProgress(teamId)` requires `authorizeTeamAccess`
  to resolve to `"admin"` or `"member"` for that `teamId`; `"denied"` is
  rejected.
- **BR-19**: The response includes, for every tree the team is tracking,
  `treeId`, `name`, the full ordered `nodes` list, and the team's own
  `currentNodeId` (or `null`).
- **BR-20**: A caller authorized for Team A cannot receive Team B's
  skill progress via any `teamId` value it supplies.
- **BR-21**: Viewing a disabled team's existing skill progress
  remains available to that team's existing members/admins.
- **BR-22**: The response never includes `updatedBy`, `createdBy`, or any
  other identity-shaped field, under any circumstance.
- **BR-23**: A malformed `skillProgress` document, or one whose `treeId`
  no longer resolves to a valid `skillTrees` document, is excluded from
  the response rather than failing the whole call.

**Firestore / infrastructure**
- **BR-24**: `skillTrees` and `skillProgress` each carry an explicit
  client-SDK deny-all block in `firestore.rules`.
- **BR-25** *(revised)*: No composite Firestore index is introduced by
  this feature — `listSkillTrees`'s `orderBy("createdAt","asc").limit(500)`
  and `getTeamSkillProgress`'s `where("teamId","==",teamId)` are each
  auto-indexed single-field queries; every other operation is a direct
  document `get`/`set`/`update`/`delete`.

**UI**
- **BR-26**: `/admin/skills` lets an app admin create a SkillTree (name +
  2-20 ordered stage labels, one operation) and view the bounded catalog
  (BR-6); a non-admin sees the generic no-permission state.
- **BR-27** *(revised)*: `/admin/teams/[teamId]` gains a skill-
  tracking section: start tracking an untracked catalog tree (its picker
  hidden/disabled for a disabled team — new in this revision), set/
  advance a tracked tree's current stage, and stop tracking a tree —
  visible and actionable to an app admin only; the set-stage/stop-tracking
  controls for already-tracked trees remain available regardless of team
  status.
- **BR-28**: `/teams/[teamId]` gains a read-only skill section,
  visible to an authorized member/admin, showing each tracked tree's
  ordered stage list (a semantic list, never graphical) with the current
  stage marked, or a distinct "not started" state; a non-member sees no
  skill content or data.
- **BR-29**: The current-stage indicator is conveyed by visible text and
  `aria-current="step"` together — never by color alone.
- **BR-30**: No comment, voting, reaction, free-text, per-person
  assignment, or ranking/leaderboard feature exists anywhere in this UI.
  *(2026-10-03: a roadmap plan's owner is planning metadata, not a per-person skill assignment; see `docs/features/team-skill-planning/SPEC.md`.)*

**Cosmetic tree correction (new in this revision)**
- **BR-31**: Only an app admin may cosmetically correct an existing
  SkillTree's `name` and/or its nodes' `label` text (`updateSkillTree`);
  no team member may. The operation persists `updatedAt`/`updatedBy`
  (mirroring `createdAt`/`createdBy`'s existing posture) for internal
  accountability only — neither is ever returned by any API response.
- **BR-32**: `updateSkillTree` rejects a `nodeLabels` array whose length
  differs from the target tree's existing node count
  (`node_count_mismatch`), before anything is written. Every accepted
  correction preserves each existing node's `nodeId` and `order`
  unchanged — the request body has no field capable of expressing a
  `nodeId`, an insertion, a removal, or a reorder in the first place.
- **BR-33** *(new — the disabled-team rejection split out of the original
  BR-10/BR-16)*: `startTeamSkillTracking` rejects a team whose status is
  `disabled` (`team_disabled`), fresh-read at call time — the only
  skill-tracking write operation gated on team status.
- **BR-34**: `/admin/skills` offers a per-tree correction action to an app
  admin: a form pre-filled with the tree's current `name`/labels, whose
  row count is fixed to the existing node count (no add/remove-row
  controls) — the UI itself cannot submit a different node count; a
  non-admin cannot access this action.
- **BR-35**: Every `skillProgress` document referencing a tree remains
  valid — its `currentNodeId` continues to resolve to the identical node
  — after any cosmetic correction to that tree, with no migration
  operation of any kind.

## Testing strategy
| Boundary | Covers |
|---|---|
| Domain validators (`validateSkillTreeName`, `validateSkillNodeLabels`, node-id assignment, `isValidSkillTree` incl. paired `updatedAt`/`updatedBy`, `isValidSkillProgress`) | BR-2, BR-3, BR-4 |
| `createSkillTree`/`updateSkillTree`/`listSkillTrees` server tests | BR-1, BR-2, BR-4, BR-5, BR-6, BR-7, BR-31, BR-32, BR-35 — including: admin success and exact persisted-shape assertions for all three; non-admin rejection for all three; 2/1 and 20/21 node-count boundary at creation; label/name length boundary at both creation and correction; a `nodeLabels` length mismatch at correction (`node_count_mismatch`, zero writes); a correction proving `nodeId`/`order` unchanged (fetch-before/fetch-after `toEqual` on those fields, only `label` differing); an existing `skillProgress` document's `currentNodeId` still resolving correctly against a corrected tree (BR-35); `listSkillTrees` bounded at exactly 500 with a 501-seeded-tree test proving only the 500 oldest-created return, ordered ascending; a client-supplied `treeId`/`nodeId`/`createdBy`/`updatedBy`/`createdAt` override on either write operation proven to have no effect |
| `startTeamSkillTracking`/`updateTeamSkillProgress`/`stopTeamSkillTracking` server tests | BR-8 through BR-17, BR-33 — including: admin success for each; non-admin rejection for each (zero writes); idempotent start on an already-tracked pair; nonexistent tree/team rejection; **start on a disabled team rejected (`team_disabled`, zero writes)** — new in this revision; **update and stop each still succeeding against a disabled team's data, with zero `teams` reads** — explicitly re-verified, not merely assumed, after the disabled-team split; update against a not-yet-tracked pair (`not_tracked`); update with a foreign `nodeId` (`invalid_input`); update accepting a backward-moving `nodeId`; idempotent stop on a not-tracked pair; full lifecycle regression: start → update → update (backward) → stop → start again (restart), asserting the restarted record's `currentNodeId` is `null`, identical to the first-ever start; a request-body `teamId`/`treeId` override proven to have no effect |
| `getTeamSkillProgress` server tests | BR-18 through BR-23 — including: member and admin success; non-member/non-admin rejection; cross-team exclusion; disabled-team viewing continuity; a malformed `skillProgress` record excluded without failing the call; a `skillProgress` record whose `treeId` no longer resolves excluded the same way; returned DTO never contains `updatedBy`/`createdBy`/`updatedAt`/`createdAt`; a "not started" tree included, not dropped; **an explicit `skillProgress` query-failure test asserting a fail-closed `read_failed` outcome, distinct from `authorizeTeamAccess`'s own `read_failed`** — required per this revision's remediation of review Suggestion #2 |
| Firestore rules/config assertions | BR-24, BR-25 — a static assertion that `skillTrees`/`skillProgress` each carry the deny-all block; a check that no new composite index was added for this feature, re-verified after the `listSkillTrees` `orderBy`/`limit` addition |
| API route tests | Thin route handlers delegating to the server operations above, at the finalized `/skills`-namespaced routes — auth/session wiring, status-code mapping, and that only the whitelisted request body field(s) reach each server operation |
| Gateway (client fetch wrapper) shape-validation tests | Malformed/unexpected server response shapes rejected client-side |
| Component tests | Admin tree-creation form (dynamic label rows, boundary validation errors); admin correction form (pre-filled values, fixed row count with no add/remove controls, name-only and label-only correction submissions); admin catalog list (loading/empty/loaded/error, no "showing all" claim beyond the 500 bound); admin team-skill-tracking section (start/set-stage/stop actions; start picker hidden/disabled for a disabled team); team-page read-only section (loading/empty/loaded/"not started" states, current-stage marker with both text and `aria-current`) |
| Privacy/DTO-shape regression tests | The full serialized shape of every response type in this feature never contains `createdBy`/`updatedBy`/`createdAt`/`updatedAt`, run against the actual TypeScript types/DTOs |

## Open questions
None of the items below gate any task in `TASKS.md` — v1 deliberately does
not build the behavior each one would require:

1. **Member self-report / self-assessment of a team's stage.** Deferred
   (see "Purpose," "Authorization model"). Unlike the original draft, this
   document no longer implies the individual-performance non-goal
   forecloses this — it explicitly does not. If wanted later, it needs its
   own product decision about whether/how an update's acting member is
   attributed to fellow team members (mirroring the design work Team
   Forum's `authorUid`/`authorTag` split required), and can be added as a
   second, member-scoped write path alongside the existing admin-only one
   without reworking it.
2. **Section-scoped or org-wide (cross-team) skill data.** Deferred —
   no "section" concept exists in this codebase yet.
3. **Structural editing (node count/order/identity) or deletion of a
   SkillTree.** Deferred (cosmetic correction is now in v1 — see BR-31/
   BR-32; structural changes remain out of scope). If a real need emerges,
   it must address what happens to existing `skillProgress` documents
   whose `currentNodeId` references a node that a structural change would
   remove or renumber — not addressed by this document.
4. **Progress history/trend over time, or a history of past cosmetic
   corrections.** Deferred — v1 cannot answer "when did Team X reach
   Pilot" or "what did this tree's stage 3 used to be called."

## Approval gate
**This SPEC is now Approved** (see "Status" above). `TASK-001`'s
`Depends on` field in `TASKS.md` names this exact prerequisite —
`SPEC.md` Status = `Approved` — which is now satisfied in substance;
`TASKS.md`'s own inline annotation text was not edited as part of this
approval action and may still read as unsatisfied until that file is
next revised. See `TASKS.md` → "Approval gate" for the full mechanism.
