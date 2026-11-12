# Cross-Team Skill Progress Overview

## Status
Approved — reviewed and remediated by an independent approval review
(2026-09-19), with a follow-up index-requirement reconciliation on the same
date. The original draft's `skillProgress` bound query ordered `updatedAt`
**ascending**, which would have silently kept the least-recently-updated
(stalest) records and dropped the most-recently-updated (most currently
relevant) ones once the 2000-record bound was exceeded — inverting this
feature's own purpose of reflecting current tracking state. This review
corrected the order to descending and added an explicit
`FieldPath.documentId()` tiebreaker for deterministic truncation — both
still required exactly as corrected (see BR-20). BR-16 was also tightened
to cover a `skillProgress` record whose tree exists but falls outside the
`LIST_SKILL_TREES_LIMIT` window. Every other reviewed area (scope,
authorization, disabled-team inclusion, malformed-record semantics,
DTO/API/UI contracts, privacy, regression protection) was independently
verified against the actual Phase 7/8 implementation and repository
precedent, and required no change.

**Index-requirement reconciliation**: the approval review's initial
instinct — to declare a composite index for this query rather than assume
none is required "by analogy" to `listSkillTrees`'s different shape — was a
reasonable caution at the time, but a dedicated verification pass (carried
out during TASK-001 implementation, against Firebase's official
documentation on index types) determined that this exact query does
**not** require a user-managed composite index. Firestore's automatic
single-field index on `updatedAt` already applies an implicit final
ordering by `__name__` (document name) in the same direction as the last
explicitly sorted field by default; since this query's explicit
`FieldPath.documentId()` tie-break uses that same default direction
(`desc`, matching `updatedAt desc`) and the query has no `.where()` clause,
no additional index declaration is needed. `firestore.indexes.json` is
therefore unchanged by this feature (see BR-20, "Firestore/index
implications"). No owner decision remains open. See "Open questions" for
the full account.

## Purpose
Team Skill Tree (Phase 7) and Member Skill Progress Self-Report (Phase 8)
let an app admin, or a team's own member, see one team's tracking state
against a `SkillTree` — but there is no way for an app admin to see, in one
place, how every team tracking a given tree compares. An app admin
responsible for a capability across the whole organization (e.g. "container
adoption across every team") today has to open each team's own
`/admin/teams/[teamId]` page one at a time and mentally assemble the
comparison.

This feature adds a **read-only, app-admin-only, cross-team overview**: for
each `SkillTree` that at least one team is tracking, show every tracking
team's current stage side by side. It introduces no new tracking concept,
no new write path, and no data above team level — it is a new *view* over
data Phase 7/8 already persist.

**Explicitly not** a step toward an organizational hierarchy: `docs/
PRODUCT.md`'s "Future capabilities" entry ("section-scoped or org-wide
(multi-team) skill trees") is more ambitious than this feature — it implies
a new grouping concept above `Team`. This feature deliberately takes the
narrower reading: "org-wide" means only "the set of teams an app admin can
already see," using the existing global app-admin model, not a new
`Section`/department entity. See "Non-goals."

## User outcome
An app admin viewing `/admin/skills` can see, for every `SkillTree` at least
one team tracks, a per-team list of which stage each tracking team has
currently reached — without visiting each team's own admin page
individually.

## Scope
- One new read-only server operation, `getOrgSkillProgressOverview`,
  composing the existing `skillTrees`, `skillProgress`, and `teams`
  collections — no new collection.
- One new admin-only API route.
- One new read-only section on the existing `/admin/skills` page.
- Reuses `requireAppAdmin`, `isValidSkillTree`, `isValidSkillProgress`, and
  `isValidTeamStatus` entirely unchanged.

## Out of scope
- **Section/department/organization-hierarchy grouping above `Team`.** No
  such concept exists in this codebase (`team-skill-tree/SPEC.md` — explicit
  non-goal, restated in `docs/PRODUCT.md`'s "Future capabilities"); this
  feature does not introduce one. "Org-wide" means exactly the set of teams
  the existing app-admin model already sees.
- **Member, team-lead, or team-admin access to this overview.** App-admin
  only — see "Authorization model." No new role or authorization concept.
- **Individual/per-person skill progress, proficiency, or performance
  data.** Unchanged non-goal from Phase 7 (`docs/PRODUCT.md` — "not an
  individual employee performance monitoring system").
- **Any write path.** No creating/stopping tracking, no `currentNodeId`
  change, no `SkillTree` create/correct, no bulk mutation, from this
  overview or its API route. `startTeamSkillTracking`,
  `updateTeamSkillProgress`, `stopTeamSkillTracking`,
  `reportTeamSkillProgress`, `createSkillTree`, `updateSkillTree`, and
  `getTeamSkillProgress` are all unchanged.
- **History/timeline/audit trail.** This overview reflects only each
  `skillProgress` document's current `currentNodeId` at read time, exactly
  like every existing read of this data. No new history is introduced.
- **Analytics, scoring, ranking, or leaderboard views.** Unchanged non-goal
  from Phase 7 (`docs/UI-UX.md` — "Avoid gamification... leaderboards...
  ranking").
- **Notifications.**
- **Export** (CSV/PDF/etc.) of the overview.
- **Search/filter** over the overview. Existing UI scale (a bounded
  `SkillTree` catalog, a small, admin-created `teams` set) does not
  demonstrably require it; the existing `/admin/skills` catalog has no
  search either.
- **Cross-team/org-wide developer forum, and real-name/display-name
  attribution for it.** Unrelated future capability
  (`docs/features/team-forum/SPEC.md` — Non-goals); not implemented or
  planned here.
- **Pagination.** See "Firestore query/index requirements" — v1 uses a
  single bounded read per collection, matching `listSkillTrees`' existing
  precedent, not true pagination.

## Key concepts
- **Tracking team**: a team with a valid `skillProgress/{teamId}__{treeId}`
  document for a given tree — i.e., `startTeamSkillTracking` has been called
  for that (team, tree) pair and the record has not since been removed by
  `stopTeamSkillTracking`.
- **Overview entry**: one `SkillTree` plus the list of its current tracking
  teams' stages, as returned by this feature's read operation. Not a
  persisted concept — computed fresh on every call, like `SurveyAggregate`.

No other new terminology is introduced; `SkillTree`, `SkillNode`,
`SkillProgress`, `currentNodeId`, `teamId`, `treeId`, and `TeamStatus` all
keep their exact existing meanings from `docs/features/team-skill-tree/
SPEC.md` and `docs/features/skill-progress-self-report/SPEC.md`.

## Actors and access
| Actor | Access |
|---|---|
| App admin | Can view the full cross-team overview. |
| Team member (any team) | No access — `forbidden`, identical in shape to a non-admin's rejection from `listSkillTrees`/`listTeams`. |
| Unauthenticated caller | `unauthenticated`. |
| Team lead / team-admin role | N/A — no such role exists in this codebase (`docs/features/team-management/SPEC.md` — "a team-level admin role... " is an explicit non-goal); not introduced here. |

## User stories
1. As an app admin, I want to see every `SkillTree` at least one team is
   tracking, with each tracking team's current stage listed side by side,
   so that I can understand adoption of a capability across the
   organization without visiting each team's page individually.
2. As an app admin, I want a `SkillTree` with no tracking teams to be
   omitted from the overview, so that the view only shows trees with actual
   data to compare.
3. As an app admin, I want a disabled team's existing tracking to still
   appear (clearly labeled as disabled), so that the overview reflects the
   same reality every other admin skill-progress view already shows,
   without silently hiding data.

## Behavioral requirements

### Authorization
- **BR-1**: `getOrgSkillProgressOverview` requires the caller to pass
  `requireAppAdmin` (unchanged, reused as-is from `src/features/teams/
  server/require-app-admin.ts`) — an unauthenticated caller receives
  `unauthenticated`; an authenticated non-admin receives `forbidden`,
  identical in shape and content to `listSkillTrees`'/`listTeams`'
  equivalent rejections. No team member, of any role, and no team-lead/
  team-admin concept (none exists) can call this successfully.
- **BR-2**: This operation performs no `authorizeTeamAccess` check of any
  kind, for any team — it is not team-scoped. An app admin's access to it
  does not depend on membership in, or admin status limited to, any
  specific team, exactly like `listTeams`/`listSkillTrees` today.

### Read-only behavior
- **BR-3**: `getOrgSkillProgressOverview` performs Firestore reads only. It
  never creates, updates, or deletes any `skillTrees`, `skillProgress`, or
  `teams` document, directly or indirectly.
- **BR-4**: No API route this feature adds accepts `POST`, `PATCH`, `PUT`,
  or `DELETE` — the one new route is `GET`-only.
- **BR-5**: `createSkillTree`, `updateSkillTree`, `startTeamSkillTracking`,
  `updateTeamSkillProgress`, `stopTeamSkillTracking`,
  `reportTeamSkillProgress`, and `getTeamSkillProgress` are unchanged by
  this feature — same signatures, same behavior, same tests continue to
  pass unmodified.

### Inclusion / exclusion
- **BR-6**: A `SkillTree` appears in the overview if and only if at least
  one *valid* `skillProgress` record exists for it whose referenced team
  also resolves to a valid `teams` document (see "Malformed-record
  semantics"). No minimum team count beyond one is required — a tree
  tracked by exactly one team appears.
- **BR-7**: A `SkillTree` with zero tracking teams (no `skillProgress`
  record references it, or every record that does fails validation) is
  excluded from the overview entirely — it is not shown with an empty team
  list.
- **BR-8**: No suppression threshold (in the sense of `docs/SECURITY.md`
  invariants 11/12, which govern `SurveyAggregate`) applies to this
  feature. `SkillTree`/`SkillProgress` are non-sensitive, non-anonymous,
  team-level reference data (`docs/DATA-MODEL.md`); inventing a minimum-
  team-count suppression rule here would be a new privacy mechanism this
  data has never needed, and the owner decisions for this feature
  explicitly reject it.

### Presentation of team/current-stage data
- **BR-9**: For each included `SkillTree`, the overview lists every one of
  its valid tracking teams with: the team's `teamId`, the team's `name`
  (from its `teams` document), the team's `status` (`"active"` |
  `"disabled"`), and the team's `currentNodeId` for that tree (`string |
  null`).
- **BR-10**: A team entry with `currentNodeId: null` is presented
  identically in meaning to every existing "tracked, not yet started" state
  (`docs/features/team-skill-tree/SPEC.md` — "not started") — never
  rendered as if it were a real stage, never blank/absent.
- **BR-11**: `SkillTree` entries are ordered exactly as `listSkillTrees`
  already orders its catalog: oldest-created first (`createdAt` ascending)
  — the same order an app admin already sees on `/admin/skills`.
- **BR-12**: Within one `SkillTree`'s entry, its tracking teams are ordered
  by `name` ascending (case-sensitive ordinal string comparison), with
  `teamId` ascending as a tiebreaker for two teams sharing a name — a new,
  presentation-only ordering choice with no existing precedent to follow or
  contradict, chosen for scannability (`docs/UI-UX.md` — "dense, scannable
  lists").

### Active/disabled team semantics
- **BR-13**: A tracking team's `disabled` status never excludes its
  `skillProgress` record from the overview. This directly follows existing,
  consistent precedent: `getTeamSkillProgress` (a team's own read) has "no
  `teams/{teamId}.status` gate of any kind... a disabled team's existing
  skill progress remains readable," and every admin per-team view
  (`TeamSkillTrackingSection`) renders an already-tracked tree's stage and
  controls "regardless of `teamDisabled`." No existing read path in this
  codebase filters `SkillProgress` visibility by team status — writing a
  new filter here would be an unprecedented, undocumented restriction, not
  a neutral default.
- **BR-14**: A disabled team's entry is visibly labeled as disabled in the
  API response (`teamStatus: "disabled"`) and in the UI (a "Deaktivert"
  label, matching the existing convention `AdminTeams.tsx`/`copy.ts`
  already use for a disabled team) — never indistinguishable from an active
  team's entry, and never conveyed by color alone (`docs/UI-UX.md` —
  "Accessibility").

### Malformed-record semantics
- **BR-15**: A `skillProgress` document that fails `isValidSkillProgress`
  is excluded from the overview — it contributes no team entry to any tree,
  and never causes the whole operation to fail. (Same fail-closed,
  skip-the-one-bad-record pattern `listSkillTrees`/`getTeamSkillProgress`
  already use for `SkillTree`/`SkillProgress` records.)
- **BR-16**: A `skillProgress` document that is valid but whose `treeId`
  does not resolve to a currently-valid `skillTrees` document — deleted
  (though no delete operation exists in v1), malformed, **or simply
  outside this operation's own `LIST_SKILL_TREES_LIMIT`-bounded tree read
  (BR-20/BR-21) — a legitimate, valid tree that exists beyond the 500
  oldest-created is, from this operation's perspective, indistinguishable
  from one that doesn't resolve at all, and is treated identically** — is
  excluded from the overview. This mirrors `getTeamSkillProgress`'s
  existing behavior exactly ("whose `treeId` no longer resolves to a valid
  `skillTrees` document is excluded from the response").
- **BR-17**: A `skillProgress` document that is valid, and whose `treeId`
  resolves to a valid tree, but whose `teamId` does not resolve to any
  `teams` document, or resolves to a `teams` document that fails the same
  `name`/`status` validation `listActiveTeams` already applies (a
  non-string/blank `name`, or a `status` that fails `isValidTeamStatus`),
  is excluded from the overview. No existing operation previously needed to
  resolve an arbitrary `skillProgress.teamId` against the `teams`
  collection outside an already-authorized route scope, so this is a new
  join — but the validation *pattern* (skip the one bad record, reuse
  existing field-level validators, never fail the whole read) is not new;
  it is applied here for consistency, not invented ad hoc.
- **BR-18**: None of BR-15 through BR-17 ever expose the malformed
  document's raw field values, its Firestore document ID pattern, or any
  detail distinguishing *why* a given tree/team pair is absent — the
  overview simply omits it, exactly as an admin already cannot tell,
  from `listSkillTrees`'s response, whether 500 documents exist and one was
  malformed versus 499 valid documents existing outright.
- **BR-19**: A genuine Firestore read failure (a thrown/rejected read of
  `skillTrees`, `skillProgress`, or `teams`) fails the entire operation
  closed with `read_failed` — distinct from BR-15 through BR-17's per-record
  exclusions, and never returning partial/raw data on that failure. (Same
  distinction `getTeamSkillProgress`/`listSkillTrees` already draw between
  "malformed record → skip" and "read itself failed → fail closed.")

### Bounded query / list behavior
- **BR-20**: `getOrgSkillProgressOverview` reads:
  - `skillTrees`: `.orderBy("createdAt", "asc").limit(LIST_SKILL_TREES_LIMIT)`
    — the exact same bounded, ordered, auto-indexed query `listSkillTrees`
    already runs (constant reused unchanged, value 500).
  - `skillProgress`: `.orderBy("updatedAt", "desc").orderBy(
    FieldPath.documentId(), "desc").limit(LIST_ORG_SKILL_PROGRESS_LIMIT)` —
    a new bounded, ordered query, with no `.where()` (this operation needs
    every team's record for every tree, not one team's).
    **Descending, not ascending** *(corrected during independent approval
    review — the original draft's ascending order was a defect, not a
    stylistic choice)*: this operation's product contract is to reflect
    current tracking state (see "Purpose"/"User outcome" — "understand
    adoption... across the organization"), so when the bound is exceeded,
    the subset that must survive is the
    *most-recently-updated* `LIST_ORG_SKILL_PROGRESS_LIMIT` records. An
    ascending order would instead keep the stalest, least-recently-touched
    records and silently drop the very teams whose tracking is most
    actively current as the collection grows past the bound — inverting
    this feature's own purpose ("understand adoption... across the
    organization"), since the teams an admin most wants visible are
    exactly the ones most likely to be pushed out first under an ascending
    truncation rule. The explicit `FieldPath.documentId()` tiebreaker
    (same direction, appended after `updatedAt`) makes the bound/ordering
    deterministic across calls whenever two records share an identical
    `updatedAt` value (e.g. bulk-seeded or test data) — without it, which
    record lands exactly at the truncation boundary in a tie is
    unspecified and could vary between calls. This two-clause `orderBy`
    shape does **not** require a declared composite index, despite
    combining two `orderBy()` clauses: Firestore's automatic single-field
    index on `updatedAt` already applies an implicit final ordering by
    `__name__` (document name) in the same direction as the last
    explicitly sorted field, and this query's explicit
    `FieldPath.documentId()` tie-break uses that identical default
    direction (`desc`) with no `.where()` clause present — exactly the
    case Firestore's own indexing documentation describes as covered by
    the automatic single-field index, not one of the cases (a `.where()`
    filter combined with `orderBy()` on a different field, or a
    non-default `__name__` direction) that trigger a composite-index
    requirement (see "Firestore/index implications" — verified against
    Firebase's official documentation, not assumed either way by
    analogy). The tie-break clause must still be written explicitly in
    code — this operation must never rely on Firestore's implicit default
    ordering to satisfy the product's determinism contract, since that
    implicit behavior is undocumented at the call site and not something a
    future reader could verify without re-deriving this same index
    research. TASK-001's implementation must explicitly verify, and its
    tests must explicitly prove, that this query requires no new
    user-managed composite index and that `firestore.indexes.json` remains
    unchanged. New constant, value **2000** — a generous, explicit multiple of
    `LIST_SKILL_TREES_LIMIT` chosen to comfortably exceed this
    application's actual current scale (a handful of admin-created teams;
    see `docs/DEVELOPMENT.md` — legacy seed of four teams) while still
    being a real, documented bound rather than an unbounded collection
    scan. A `skillProgress` document missing `updatedAt` entirely (never
    produced by any write path in this codebase —
    `startTeamSkillTracking`/`updateTeamSkillProgress`/
    `reportTeamSkillProgress` all set it unconditionally, but theoretically
    possible from a direct Firestore console edit) is excluded from this
    query's results by Firestore itself, before `isValidSkillProgress` ever
    runs on it; the observable outcome is identical to BR-15's
    validation-level exclusion (the record never appears in the overview
    either way) — noted here only for precision about the exclusion
    mechanism for this one theoretical case, not because it changes any
    behavior.
  - `teams`: unbounded `.get()` (no `.where()`, no `.limit()`) — the exact
    same unbounded pattern `listTeams` (the existing "every team including
    disabled, admin-only" operation) already uses. Not newly introduced by
    this feature; matched for consistency with that existing precedent
    rather than inventing a different bound for the same "every team"
    shape of data.
- **BR-21**: If more than `LIST_SKILL_TREES_LIMIT` `skillTrees` documents
  exist, the overview silently reflects only the 500 oldest-created trees
  — identical in spirit to `listSkillTrees`'s existing BR-6 guarantee. If
  more than `LIST_ORG_SKILL_PROGRESS_LIMIT` `skillProgress` documents
  exist, the overview silently reflects only the 2000
  *most-recently-updated* records — the least-recently-updated records
  beyond that bound are dropped first (BR-20). Neither case is ever
  accompanied by a total count or any signal implying the response is
  exhaustive.
- **BR-22**: No pagination exists in v1 (see "Out of scope"); a caller
  needing data beyond the bound has no way to request a further page. This
  matches `listSkillTrees`'s and `listTeams`'s existing v1 posture for the
  same shape of admin-catalog read.

### DTO minimization
- **BR-23**: The overview's response DTO (`OrgSkillProgressTreeView`, see
  "API/DTO contracts") never includes `createdAt`, `createdBy`, `updatedAt`,
  or `updatedBy` from either a `skillTrees` or a `skillProgress` source
  document — identical exclusion to `SkillTreeView`/`TeamSkillProgressView`
  today.
- **BR-24**: The overview's response DTO never includes any
  `teamMemberships`, `teamInvitations`, or `teamAccessRequests` data, and
  never includes any per-person/individual field of any kind — only
  `teamId`, `teamName`, `teamStatus`, and `currentNodeId` per team entry.
- **BR-25**: The overview's response DTO never includes a raw Firestore
  document ID for `skillProgress` (the `{teamId}__{treeId}` composite key)
  — only the already-decomposed `teamId`/`treeId` fields.

### Regression requirements (Phase 7/8)
- **BR-26**: Every existing `docs/features/team-skill-tree/SPEC.md` and
  `docs/features/skill-progress-self-report/SPEC.md` behavioral requirement
  continues to hold unchanged and continues to pass its existing tests
  unmodified — this feature adds a new operation and route; it does not
  edit `create-skill-tree.ts`, `update-skill-tree.ts`,
  `start-team-skill-tracking.ts`, `update-team-skill-progress.ts`,
  `stop-team-skill-tracking.ts`, `report-team-skill-progress.ts`, or
  `get-team-skill-progress.ts`.
- **BR-27**: `/admin/skills`'s existing creation form and catalog
  (`SkillTreeCreationForm`, `SkillTreeCatalogList`) are visually and
  behaviorally unchanged by this feature's new section being added to the
  same page.

## Edge cases and failure behavior
- **No `SkillTree` is tracked by any team**: the overview returns `{ok:
  true, trees: []}` — a real empty state, not an error (see "UI/UX
  behavior").
- **Every `SkillTree` exists but none has any valid tracking team** (e.g.
  every tree was created but no `startTeamSkillTracking` call has ever
  succeeded): same empty-list result as above — BR-7.
- **A tree has tracking teams, but all of them are disabled**: the tree is
  still included (BR-6/BR-13); every team entry shows `teamStatus:
  "disabled"`.
- **A tree has some malformed `skillProgress` records and some valid
  ones**: the malformed ones are silently skipped (BR-15); the tree still
  appears with only its valid team entries, provided at least one survives.
- **A `skillProgress` record's tree was created after the record, in some
  inconsistent historical state (e.g. a hypothetical future tree-deletion
  feature)**: excluded per BR-16; no such deletion exists in v1, so this is
  a defensive case only, not an expected one.
- **More than 2000 `skillProgress` documents exist**: the 2000
  *most-recently-updated* records are used; the least-recently-updated
  records beyond that bound are silently omitted from the overview
  (BR-20/BR-21) — an unlikely but explicit v1 bound given this
  application's actual scale, deliberately favoring currently-active
  tracking data over stale data when a choice must be made.
- **A genuine Firestore outage during any of the three reads**: the whole
  operation returns `read_failed`; the UI shows the existing generic
  infrastructure-failure treatment (`docs/UI-UX.md`), never a raw error
  detail.
- **A non-admin (including a real team member of every team that has
  tracking data) calls the new route directly**: `forbidden`, identical in
  content/shape to any other admin-only rejection in this codebase — never
  a hint about which trees/teams exist.

## Security and privacy
- **Authorization**: app-admin-only, enforced server-side via the existing,
  unchanged `requireAppAdmin` boundary — no new authorization concept, no
  new role (`docs/SECURITY.md` invariant 8; `.claude/rules/security.md`).
- **Firestore access**: unchanged — `firestore.rules`' existing deny-all
  blocks for `skillTrees`, `skillProgress`, and `teams` already cover every
  collection this feature reads; no rule change is needed (all access is
  server-side via the Firebase Admin SDK, as this feature's server
  operation is too).
- **No individual/member data**: this feature introduces no per-person
  field anywhere — same team-level-only posture as Phase 7/8
  (`docs/DATA-MODEL.md` — `SkillProgress`/`SkillTree` "No" under "Personal
  data?").
- **No survey/challenge/forum data involved**: this feature reads only
  `skillTrees`, `skillProgress`, and `teams` — never `surveyResponses`,
  `challenges`, `forumThreads`, or `forumReplies`. No encryption boundary
  is touched.
- **No new encryption requirement**: `SkillTree`/`SkillProgress` remain
  classified as non-sensitive, unencrypted reference data, exactly as
  `docs/DATA-MODEL.md` already establishes for Phase 7 — this feature
  changes nothing about that classification, and reads no encrypted field.
- **Team A/B cross-team isolation is not a concern for this feature's own
  boundary**: the entire reason invariant 9 (`docs/SECURITY.md` — "a user
  authorized for Team A must not automatically gain access to Team B's
  private results") exists is to protect a *member's* team-scoped view.
  This feature has no member-facing surface at all — an ordinary member of
  any team, including Team A or Team B, receives `forbidden` from this
  operation regardless of their own team memberships (BR-1). The invariant
  is preserved by this feature simply not being reachable by a member, not
  by any new per-team check.
- **Audit identity fields never cross the DTO boundary**: `createdBy`
  (`SkillTree`), `updatedBy` (`SkillTree`, `SkillProgress`), and
  `createdBy` (`Team`) are read internally where needed for validation
  (e.g. `isValidSkillTree` checks `createdBy` is a non-blank string) but
  never appear in `OrgSkillProgressTreeView`/`OrgSkillProgressTeamEntryView`
  or any API response (BR-23).
- **No new abuse/rate-limiting surface**: this is a single admin-only `GET`
  route with no user-supplied parameters (no query string, no body) —
  matches `listSkillTrees`'/`listTeams`'s existing unthrottled posture.

## Architecture decisions
1. **No new Firestore collection.** The overview is computed on demand from
   `skillTrees` + `skillProgress` + `teams`, exactly like `SurveyAggregate`
   is computed on demand rather than persisted (`docs/DATA-MODEL.md`).
   *Resolved — reuse is sufficient; nothing about this feature requires
   materializing a fourth collection.*
2. **Disabled-team inclusion.** Resolved from precedent, not left open: a
   disabled team's tracking data is included, exactly like every other
   existing read of `SkillProgress` (see BR-13).
3. **Missing/malformed-team exclusion.** Resolved from the existing
   fail-closed validation pattern applied to a genuinely new join (see
   BR-17): skip the one affected `skillProgress` record; never fail the
   whole read; reuse `isValidTeamStatus` plus the same inline
   `name`-non-blank check `listActiveTeams` already performs, rather than
   introducing a new `isValidTeam` full-record validator that no other
   caller needs yet (`.claude/rules/typescript.md` — "Avoid abstractions...
   without a concrete current need").
4. **`skillProgress` read shape.** A single bounded, ordered
   (`updatedAt` descending, with a `FieldPath.documentId()` tiebreaker —
   BR-20), `.where()`-free query across the whole collection, joined
   in-memory against the bounded `skillTrees` catalog and the unbounded
   `teams` catalog — the smallest number of Firestore round trips (three
   total, none of them per-record) that can answer "every team's stage for
   every tree," rather than an N+1 per-tree or per-team query pattern.
   Descending order is a deliberate departure from `listSkillTrees`'s
   ascending catalog order, not an oversight: a tree catalog's oldest-first
   order is a stable presentation choice for permanent, never-deleted
   records, whereas this operation's bound-truncation order must instead
   protect the *currently most relevant* records when the bound is
   exceeded (BR-20) — copying `listSkillTrees`'s direction verbatim would
   have silently inverted that intent.
5. **Route placement.** `GET /api/admin/skills/overview`, alongside the
   existing `/api/admin/skills` (catalog/create) and `/api/admin/skills/
   [treeId]` (correction) routes — reusing the same admin-only "skills"
   route family rather than inventing a new top-level admin namespace.
6. **UI placement.** A new read-only section added to the existing
   `AdminSkills` component (`/admin/skills`), below the existing catalog —
   per the owner instruction to prefer extending the existing admin Skill
   Tree surface over a new top-level product area. No new nav entry.

## API/DTO contracts

| Route | Method | Delegates to | Auth error mapping |
|---|---|---|---|
| `/api/admin/skills/overview` | GET | `getOrgSkillProgressOverview` | `unauthenticated` → 401, `forbidden` → 403, `read_failed` → 500 |

```ts
// Server operation result (src/features/skill-trees/server/get-org-skill-progress-overview.ts)
export interface OrgSkillProgressTeamEntryView {
  teamId: string;
  teamName: string;
  teamStatus: "active" | "disabled";
  currentNodeId: string | null;
}

export interface OrgSkillProgressTreeView {
  treeId: string;
  name: string;
  nodes: SkillNodeView[];              // {nodeId, label, order} — unchanged shape
  teams: OrgSkillProgressTeamEntryView[];
}

export type GetOrgSkillProgressOverviewResult =
  | { ok: true; trees: OrgSkillProgressTreeView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };
```

The route is a thin delegate (`.claude/rules/nextjs-react.md`): extracts the
bearer token, calls `getOrgSkillProgressOverview(token)`, maps the result to
`{trees}` (200) or `{error}` (401/403/500) — identical wiring style to `GET
/api/admin/skills`.

## UI/UX behavior
- **Placement**: a new section on `/admin/skills`, below the existing
  "Eksisterende kompetanseområder" catalog — `AdminSkills.tsx` gains a third
  child alongside `SkillTreeCreationForm`/`SkillTreeCatalogList`. No new
  route, no new nav entry (Owner instruction 11; Architecture decision 6).
- **Loading**: a `LoadingState`, consistent with every other section on
  this page.
- **Empty state (no tree has any tracking team)**: a distinct `EmptyState`
  message (e.g. "Ingen kompetanseområder spores av noe team ennå.") — never
  blank, never conflated with a loading or error state.
- **Per-tree rendering**: tree name as a sub-heading, followed by an
  unordered list (`<ul>`) of its tracking teams — each item shows the
  team's name (plus a "Deaktivert" suffix/label for a disabled team,
  conveyed by text, never color alone), and its current stage's `label`
  text (resolved from the tree's own `nodes`, not a raw `nodeId`) or the
  existing "Ikke startet" copy for `currentNodeId: null` — reusing the
  exact Norwegian copy already established in `teamSkillTrackingCopy`/
  `teamSkillSectionCopy` for "not started."
- **Ordering**: trees oldest-created-first (BR-11); teams alphabetical by
  name (BR-12).
- **No editing controls**: this section renders no button, form, or link
  that starts/stops tracking, sets a stage, or edits a tree — it is
  observation-only, even though the viewer (an app admin) already holds
  write permission elsewhere on the same page (Owner instruction 11).
- **Failure state**: a generic `Alert variant="error"` on a `read_failed`
  response, isolated from the creation-form/catalog sections' own
  loading/error state — a failure here never hides or blocks the rest of
  `/admin/skills` (mirrors Team Forum's "a forum read failure never hides
  results" isolation convention, `docs/UI-UX.md` — "Forum UX").
- **Authorization failure**: this section is only ever rendered once
  `AdminSkills` has already confirmed admin access via the page's existing
  `forbidden` handling (the same `fetchAdminSkillTrees`-driven gate); the
  new overview fetch reuses that same established pattern rather than
  performing its own separate sign-in/forbidden UI.
- **Responsive/accessibility**: matches every other list on this page —
  semantic list markup, no horizontal scroll at phone widths, visible focus
  states (not applicable here, since no control is interactive), and no
  color-only signaling for the disabled-team label (`docs/UI-UX.md` —
  "Accessibility").

## Firestore/index implications
- **New collections**: none.
- **New queries**:
  - `skillTrees.orderBy("createdAt", "asc").limit(500)` — already exists
    unchanged (`listSkillTrees`); reused, not duplicated logic, though this
    feature's operation runs its own copy of the same bounded read rather
    than calling `listSkillTrees` itself (avoiding a second, redundant
    `requireAppAdmin` token verification within one request — see
    Architecture decision 4). Single-field `orderBy`, no `.where()` —
    auto-indexed, unchanged conclusion from `docs/features/
    team-skill-tree/SPEC.md`.
  - `skillProgress.orderBy("updatedAt", "desc").orderBy(
    FieldPath.documentId(), "desc").limit(2000)` — **new**, and a
    genuinely different shape from every existing query in this codebase:
    a **two-clause** `orderBy` with no `.where()` clause at all. Every
    existing composite-index case in this codebase
    (`teamInvitations`/`teamAccessRequests`/`forumThreads`/`forumReplies`,
    `docs/DEVELOPMENT.md` — "Firestore rules and indexes") pairs a
    `.where()` equality filter with an `.orderBy()` on a *different*
    field; every existing auto-indexed case (`listActiveTeams`,
    `listSkillTrees`, `getTeamSkillProgress`) has exactly one `orderBy`/
    `where()` clause total. This query has neither shape — re-derived from
    first principles rather than assumed by analogy to either precedent.
    Firestore's own indexing documentation (index-overview page, "Default
    ordering and the `__name__` field") establishes that every index —
    including the automatic single-field index Firestore already
    maintains for `updatedAt` — applies an implicit final ordering by
    `__name__` (document name), defaulting to the *same direction* as the
    last explicitly sorted field; a dedicated (composite) index is
    documented as necessary only to obtain the *non-default* `__name__`
    direction, or to combine a `.where()` filter with an `orderBy()` on a
    different field. This query's `FieldPath.documentId()` tie-break is
    `desc`, matching `updatedAt`'s `desc` — the documented default case —
    and there is no `.where()` clause present. **No user-managed composite
    index is required.** The explicit `FieldPath.documentId()` clause
    remains part of the code (never left implicit) purely because the
    product contract (BR-20's deterministic tie-break) must be verifiable
    and enforced at the call site, independent of whatever Firestore's
    default behavior happens to be — relying on undeclared implicit
    ordering would make the determinism guarantee unverifiable by a future
    reader and fragile to an unannounced platform change.
  - `teams.get()` (unbounded, no `.where()`, no `.orderBy()`) — matches
    `listTeams`'s existing unbounded pattern exactly; no index implication
    beyond what already exists for that operation.
- **Composite-index conclusion**: **no new composite index is required or
  declared.** `firestore.indexes.json` is unchanged by this feature. The
  `skillProgress` query above is the one query shape in this feature not
  already covered by an existing auto-indexed or composite-indexed
  precedent (see above), and — per the reasoning above — is covered by
  Firestore's automatic single-field index on `updatedAt` (whose implicit
  `__name__` tiebreak already matches this query's explicit, same-direction
  `FieldPath.documentId()` clause). TASK-001's implementation must
  explicitly verify this conclusion (not assume it either way) and its
  tests must prove that `firestore.indexes.json` is unchanged and that
  every preexisting index entry is preserved. Every other query this
  feature adds or reuses remains either a direct document `get`, an
  unfiltered collection `get`, or the pre-existing single-field
  `skillTrees.orderBy("createdAt","asc")` query — none of which carry any
  index implication of their own.
- **Firestore rules**: no change. The existing deny-all blocks for
  `skillTrees`, `skillProgress`, and `teams` already cover every collection
  this feature reads; all access continues to happen server-side via the
  Firebase Admin SDK, which bypasses these rules entirely.

## Test boundaries
| Boundary | Covers |
|---|---|
| `getOrgSkillProgressOverview` unit tests | BR-1 through BR-22 — admin gate, read-only guarantee, inclusion/exclusion rules, ordering, disabled-team inclusion, malformed-record skip behavior (each of `skillTrees`/`skillProgress`/`teams` independently), bound/limit behavior — **including a seeded-beyond-2000 test proving the most-recently-updated `skillProgress` records survive truncation and the least-recently-updated ones are dropped (BR-20/BR-21), and a tie-break test proving deterministic inclusion when two records share an identical `updatedAt`** — `read_failed` propagation from each of the three underlying reads |
| DTO/privacy regression test | A dedicated test asserting the full serialized shape of `OrgSkillProgressTreeView`/`OrgSkillProgressTeamEntryView` never contains `createdAt`/`createdBy`/`updatedAt`/`updatedBy` or any membership/invitation/access-request field, run against the actual TypeScript types, not spot-checked example values (BR-23 through BR-25) |
| API route test | Thin `GET /api/admin/skills/overview` handler — auth header extraction, status-code mapping, no additional logic duplicated from `getOrgSkillProgressOverview` |
| Gateway (client fetch wrapper) test | Malformed/unexpected response shapes rejected client-side rather than rendered as valid, mirroring `skill-trees-gateway.test.ts`'s existing conventions |
| Component test | New overview section: loading/empty/loaded/error states, tree ordering, team ordering, disabled-team label rendering, "Ikke startet" rendering, and a check that no interactive control exists anywhere in this section |
| Regression tests | `docs/features/team-skill-tree/SPEC.md` and `docs/features/skill-progress-self-report/SPEC.md`'s existing test suites continue to pass unmodified (BR-26/BR-27) |

## Acceptance criteria
- [ ] BR-1 through BR-27 covered by the tests in "Test boundaries."
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- [ ] No existing Phase 7/8 test file is modified.
- [ ] `git diff` shows no change to `create-skill-tree.ts`,
      `update-skill-tree.ts`, `start-team-skill-tracking.ts`,
      `update-team-skill-progress.ts`, `stop-team-skill-tracking.ts`,
      `report-team-skill-progress.ts`, or `get-team-skill-progress.ts`.
- [ ] `firestore.indexes.json` is unchanged by this feature — no new
      composite index entry is added, and no existing entry changes.
- [ ] `firestore.rules` is unchanged.

## Open questions
None blocking. Every item the Phase 9 discovery/owner-decision prompt
flagged as a potential "surface as an owner decision if precedent doesn't
determine it" case was in fact resolved by existing repository precedent:
disabled-team inclusion (BR-13, from `getTeamSkillProgress`'s and
`TeamSkillTrackingSection`'s established "no team-status gate on reads"
pattern, independently re-verified against both files during this review)
and missing/malformed-team exclusion (BR-17, from the existing fail-closed
per-record validation pattern already used by
`listSkillTrees`/`getTeamSkillProgress`/`listActiveTeams`). The genuinely
new judgment calls this feature introduces — the
`LIST_ORG_SKILL_PROGRESS_LIMIT` bound value (2000), its ordering direction
and tiebreaker, and the team-ordering rule (alphabetical by name) — are
presentation/technical choices with no security or product-policy stakes,
all derivable from this feature's already-approved product intent —
reflecting current tracking state so an admin can "understand adoption...
across the organization" (see "Purpose"/"User stories") — rather than
requiring a fresh owner decision; this review corrected the ordering
direction on that basis (see "Status"). A later reconciliation pass
corrected the initial composite-index declaration to reflect verified
Firestore indexing behavior — also a technical determination with no
security or product-policy stakes (see "Status" — "Index-requirement
reconciliation"). A reviewer who wants a different bound or presentation
ordering can still adjust either without any other part of this spec
changing.

## Approval gate
This SPEC required explicit human review and approval (Status: Draft →
Approved) before `split-tasks` may run against it, per
`docs/AI-WORKFLOW.md`'s standard human checkpoint after `plan-feature`.
That review is this document's own "Status" entry above — approval is now
recorded; `TASKS.md` (a separate, later step) has not been created by this
review.
