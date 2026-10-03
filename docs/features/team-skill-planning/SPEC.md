# Team Skill Planning (A)

## Status
**Implemented** — TASK-001 through TASK-012 are done (closeout 2026-10-03);
the approved revision 3 (2026-10-01, decisions D1–D13) is what was built. The
durable documents (`DATA-MODEL.md`, `ARCHITECTURE.md`, `SECURITY.md` invariants
23–30, `UI-UX.md`, `DEVELOPMENT.md`, `ROADMAP.md`, `PRODUCT.md`) were
reconciled with the as-built behaviour at closeout; see "Closeout notes (as
built)" at the end of this file. Planned against commit `72f5580` (F0 closed).

First product feature of the *Team & Personal Development* initiative
(F0 → **A** → B → C1 → C2 → D1 → D2). A introduces the **roadmap-item** model
that B (Team Roadmap) later visualises, and the **opaque member reference**
that F0 deferred (`member-identity-and-team-roles/SPEC.md` — "Follow-up
constraints for A–D").

### Revision 3 notes (product-owner decisions applied)
- D5b changed: duplicate display names are disambiguated by a **presentation
  ordinal only** (`Alex (1)`, `Alex (2)`); the join-month suffix is withdrawn;
  no join date/month is ever exposed.
- D12: legacy-membership preparation is **admin-only** (member-callable
  alternative removed).
- D13: untracked-plan editing rule fixed (see "Tracking vs plan existence").
- Deterministic document id is explicitly **never authorization proof**
  (see "Document id is not authorization").
- Decision table ("Open questions") replaced by the approved "Decisions".

### Revision 2 notes (what changed vs revision 1, after reading the skipped sources)
1. **Per-person-assignment policy conflict found.** `docs/UI-UX.md` ("Skill
   Tree UX", last bullet) and `team-skill-tree/SPEC.md` (non-goal + BR-30)
   say no per-person assignment exists anywhere in the Kompetanseområder
   surface. Revision 1 claimed "no contradiction"; wrong. A's *owner* is an
   explicit, reviewed exception → product decision D3 + doc amendments.
2. **memberRef lifecycle redesigned**: no write-on-GET. Generated at grant
   (`applyMembershipGrant`, the single shared grant primitive) + one explicit,
   admin-only, idempotent materialisation mutation for legacy/seeded
   memberships (rev. 1 had lazy writes inside a GET).
3. **Owner resolution no longer uses a two-field equality query.** The repo
   declared a composite index for the analogous `teamId`+`status` equality
   query, so "no index" is unproven for `teamId`+`memberRef`. Resolution now
   reads the team's memberships by `teamId` only (≤501) and matches in memory.
4. **One roadmap item per (team, competency area)** is now a *domain
   invariant*, enforced by a deterministic document id
   `roadmapItems/{teamId}__{treeId}` (mirrors `skillProgress`). Rev. 1's
   "many items, UI-only guard" is withdrawn. Consequences: no `itemId`, no
   item cap, routes addressed by `treeId`.
5. **Duplicate-name disambiguation** no longer uses a ref-derived suffix
   (rev. 3: ordinal only).
6. **Unnamed members are assignable** (rev. 1 forbade it).
7. **"Former member" claim replaced by truthful `unavailable`.**
8. **Demo Team**: no fixed refs, no synthetic members; items unassigned.
9. **Inactive-team matrix made exact**; admin writes remain out (D2), now
   with a full option comparison.
10. Verified-and-unchanged: membership doc id `{uid}__{teamId}`, SkillTree
    immutability/no deletion, SkillProgress hard-delete, `authorizeTeamAccess`
    semantics, grant/removal paths (see "Current-state evidence").

## Problem
1. A team can record *where it is* on an organisation-defined competency area
   (`SkillProgress.currentNodeId`) but not where it wants to go, by when, how
   important it is, or who drives it.
2. `SkillTree` (org-wide structure) and `SkillProgress` (current stage) cannot
   carry team planning without corrupting their meaning.
3. Naming a responsible person needs a member reference that is **not** a
   Firebase `uid`: Forum `authorTag = SHA-256(teamId:authorUid)` means any
   client-visible `uid` de-anonymises forum posts (SECURITY inv. 19–20).

## Goals
- A team member can record, per tracked Kompetanseområde: target stadium,
  priority, optional period, optional responsible teammate, and status.
- Everyone on the team sees the same plan beside the current stage.
- Edits are lightweight and reversible; nothing happens automatically.
- No person is scored, ranked or assessed.
- One model B can later visualise.

## Non-goals
Dedicated Roadmap route/tabs/timeline (B); challenge links; free text on
items; individual skills/self-assessment/matrix/gaps/role profiles/goals/
journal/check-ins/mentors (C/D); scores, rankings, per-person aggregates;
lead-only capabilities; `resolveTeamRole`/`authorizeTeamAccess` changes;
history/audit log; notifications; recurring plans; dependencies; multiple
owners; admin write path (D2); multiple plans per area (B, if needed);
roster changes; account deletion; any migration, Firebase operation, deploy
or seed write *during planning*.

## Key concepts
- **Kompetanseområde** — a `SkillTree` the team tracks (team-level maturity
  path). Not an individual *Ferdighet*. Code/Firestore say "skill".
- **Stadium** — a SkillTree node (`nodeId = "node-<index>"`). UI term
  "stadium"/"steg" as already used.
- **Roadmap item / plan** — the single planning record of one team for one
  Kompetanseområde (`roadmapItems/{teamId}__{treeId}`). Planning data only.
- **Current stage** — `SkillProgress.currentNodeId`; never copied.
- **Target stage** — `targetNodeId`, a `nodeId` of *that* tree.
- **Status** — `planned | active | completed` (stored, manual).
  **Archived** — orthogonal flag (`archivedAt`).
- **Derived indicators** — `targetReached`, `overdue`: per-read, never stored.
- **`memberRef`** — opaque random team-scoped handle of one *membership*.
  Not an identity, never authorization evidence.
- **Owner (ansvarlig)** — `ownerRef`: planning metadata only.

## Current-state evidence (verified in code, not from summaries)
| Statement | Evidence | Result |
|---|---|---|
| Membership doc id is `{uid}__{teamId}` | `membershipDocId` in `domain/team-membership.ts` | ✓ never client-visible; unchanged |
| One shared grant primitive | `applyMembershipGrant(tx, ref, exists, record)` in `grant-team-membership.ts`, used by `resolveInvitations`, `approveAccessRequest`, and `grantTeamMembership` (called by `createInvitation` for immediate grants); existing doc ⇒ `already_member`, no write | ✓ single place to add `memberRef` |
| Only one membership deleter | `removeTeamMember` (`.delete()` of the doc, app-admin only); no other membership delete exists | ✓ removal = doc gone; rejoin = fresh `set` via grant |
| Demo presenter membership is **not** created through the grant primitive | `demo-team/fixtures.ts` + `plan.ts` write the fixture record; manifest class `C` (create-only); preflight `classifyMembership` checks only `isValidMembershipFor` + `grantedBy === "demo-seed"` | ✓ an extra `memberRef` field cannot create a CONFLICT; the presenter membership will have no ref until materialised |
| App-admin team access | `authorizeTeamAccess`: invalid/missing team status ⇒ `denied` for everyone incl. admin; valid status (`active` **or** `disabled`) ⇒ admin `"admin"`, member `"member"` | ✓ |
| Disabled team | member keeps read access; member self-report (`reportTeamSkillProgress`) requires fresh membership **and** `active`; admin `updateTeamSkillProgress`/`stopTeamSkillTracking` have no team-status seam at all | ✓ |
| SkillTree immutability | `update-skill-tree.ts` copies each node's `nodeId`/`order` unchanged, only `name`/`label` replaceable; nodes `node-<i>`, 2–20 | ✓ |
| No SkillTree/stage deletion | the only `.delete()` in `skill-trees/` is `stopTeamSkillTracking`; admin routes: tree create, correct, list, overview | ✓ |
| SkillProgress hard-deleted | `stopTeamSkillTracking` deletes the doc, no tombstone; restart creates `currentNodeId: null` | ✓ |
| Current stage non-monotonic | `reportTeamSkillProgress` accepts any node of the tree | ✓ |
| `resolveTeamRole` unused | wraps `authorizeTeamAccess`; no production caller | ✓ |
| `setTeamMemberRole` | one transaction, `tx.update` only (never creates), membership + team-status reads; must not clear `memberRef` | ✓ pattern reused |
| Roster | field-by-field `{displayName,isLead,isSelf}`; memberships read via `teamId ==` limit 501 | ✓ pattern reused; unchanged |
| Index precedent | `teamAccessRequests` (`teamId`==,`status`==) and `teamInvitations` (`email`==,`status`==) both **declared composite** | ⇒ avoid multi-equality queries |
| Navigation | header nav only (`Hjem, Team, Min profil, Logg ut, Admin`); `/teams/[teamId]` is one page plus a `forum/[threadId]` sub-route; **no per-team tab navigation exists** | ✓ A inline; tabs are B's |
| UI kit | no dialog primitive; inline open/close forms precedent (`AdminTeams`, `SkillTreeCorrectionForm`) | ✓ inline form |
| Skill list order | `getTeamSkillProgress` returns doc-id order, unsorted | A orders only its own rendering |
| Per-person assignment policy | `UI-UX.md` (~line 420, Skill Tree UX bullet "no … per-person assignment …"); `team-skill-tree/SPEC.md` non-goal + BR-30. (`PRODUCT.md`/`ROADMAP.md` "no per-person data" lines concern the org overview, to be checked at closeout) | **Deliberate exception (D3, approved) → closeout reconciliation** |
| Id composite collision | `skillProgress.test.ts`: `a__b`+`c` ≡ `a`+`b__c` is an accepted, unreachable edge case (real ids never contain `__`) | same accepted limitation for `roadmapItems`; field consistency checks make it fail closed |
| `ROADMAP.md`/`PRODUCT.md` | no mention of A–D | see "Documentation impact" |

## Actors and access
Write predicate **W** = fresh genuine `teamMemberships` document for the
caller **and** fresh `teams.status === "active"` (identical to
`reportTeamSkillProgress`). Read predicate **R** = `authorizeTeamAccess` ∈
{member, admin}.

| Action | Active-team member | Disabled-team member | App admin (non-member) | Non-member / signed-out |
|---|---|---|---|---|
| Read plan + derived indicators | ✓ | ✓ | ✓ | ✗ |
| List assignable members | ✓ | ✓ (read only) | ✓ (not listed as a member) | ✗ |
| Create plan | ✓ | ✗ | ✗ | ✗ |
| Edit target/priority/dates/status | ✓ | ✗ | ✗ | ✗ |
| Assign / change / clear owner | ✓ | ✗ | ✗ | ✗ |
| Archive / restore | ✓ | ✗ | ✗ | ✗ |
| Materialise legacy member refs | ✗ | ✗ | ✓ (admin-only op) | ✗ |
| See any `uid`/e-mail | ✗ | ✗ | only via existing admin list | ✗ |

Lead = ordinary member. Owner = no permission. `resolveTeamRole` is not
called (W already is the SkillProgress write predicate; calling it would add
reads for a distinction A never uses).

### Exact inactive-team behaviour (every operation)
| Operation | `active` team | `disabled` team | invalid/missing team |
|---|---|---|---|
| Read plans, read assignable list | ✓ | ✓ | denied (`forbidden`) |
| Create | ✓ | ✗ `team_disabled` | ✗ (`team_disabled`, fail closed) |
| Edit target / priority / dates | ✓ | ✗ | ✗ |
| Change status | ✓ | ✗ | ✗ |
| Assign / change owner | ✓ | ✗ | ✗ |
| **Clear** owner | ✓ | ✗ | ✗ |
| Archive / restore | ✓ | ✗ | ✗ |
| Materialise refs (admin) | ✓ | ✓ (metadata only, grants nothing) | ✗ (unknown team) |

Rationale: no member-facing planning write is allowed on a dormant team, with
**no** "reduces privilege" carve-outs (unlike F0 lead-removal, nothing here
reduces privilege; uniformity keeps it testable). A stored lead remains a
stored lead; it is never an effective writer because lead is not consulted
at all. Re-enabling restores edit ability with no write.

### Editing-model comparison (D1/D2)
| Option | Collaboration | Authz complexity | Consistent with SkillProgress | Inactive team | Admin expectation |
|---|---|---|---|---|---|
| A. Active members write; admin read-only | team self-organises | lowest: reuse W | identical to Phase 8 member write | rejected for all | admin cannot fix a plan (needs B/admin tool) |
| B. Members + admin write | same + support | + admin branch, + `createdBy` of non-member | admin precedent exists (Phase 7 admin writes) but on *admin pages*, not team page | admin allowed on disabled? precedent says yes → inconsistent with members | admin can fix anything; but team-owned plan edited by non-member |
| C. Effective lead + admin; members read-only | hierarchy | `resolveTeamRole`, first lead capability, zero-lead teams stuck | diverges (members set stage, can't plan) | lead inert, admin only | admin override |
| D. Lead only + admin override | as C | as C | diverges | as C | as C |
| E. Members write + admin write **only on an admin page**, active team only | team-owned + support | new admin UI/endpoint | mirrors Phase 7/8 split exactly | admin gated like members | admin covered |

**Decision (D1/D2, approved): A** — all genuine members of an active team
create/edit; app admin is read-only for roadmap planning (E is a possible
later addition). F0 introduced lead *identity* only; making lead the first
capability is a separate product decision (C/D). **Two separate capabilities
in the authorization model:** (1) roadmap *editing* = predicate W (members
only, never admin); (2) member-ref *preparation* = `requireAppAdmin`
infrastructure operation (never members). Neither implies the other.

## User stories and journeys
1. As a member, I set a target stadium for an area we track so the team shares
   an ambition.
2. As a member, I set priority and optional dates.
3. As a member, I name a responsible teammate or leave it open.
4. As a member, I see current vs target stage and am told (as text) when the
   target is reached or the date has passed — nothing changes by itself.
5. As a member, I mark the plan active/completed, archive and restore it.
6. As an admin, I read a team's plans; I run the one-off ref preparation when
   a team's members predate refs.
7. As any member, I never learn another member's `uid`/e-mail; forum
   anonymity is intact.
8. As B's developer, I get one model to visualise.

**Journey 1 — plan an area.** Member opens `/teams/[teamId]` → Kompetanse-
områder → area row shows "Ingen plan ennå" + "Planlegg" → inline form (target
stadium above current, priority, optional dates, optional ansvarlig) →
"Lagre" → section refetches and shows the plan line.
**Journey 2 — reach target.** Someone sets the current stage ≥ target via the
existing "Sett stadium" control → plan line shows "Målet er nådd" → a member
sets status "Fullført" (manual).
**Journey 3 — replan.** Completed plan → "Rediger" → choose a new target above
current, status back to Planlagt/Pågår → save (in place).
**Journey 4 — owner leaves.** Admin removes membership → plan shows "Ansvarlig
er ikke lenger tilgjengelig" → a member assigns someone else or clears.
**Journey 5 — legacy team.** Admin opens `/admin/teams/[teamId]`, sees
"Klargjør medlemsvelger" (some members lack a ref), runs it once; members now
appear in the owner selector.

## Domain model

### One plan per (team, competency area) — domain invariant
Decision (D6, approved): **at most one roadmap item per `(teamId, treeId)`,
ever**, including archived ones. Enforced by the document id
`roadmapItems/{teamId}__{treeId}` and a transactional create that fails if the
document exists. No query, no race window (a concurrent double-create has one
winner). Compared:

| Strategy | Race-safe | History | Complexity | Verdict |
|---|---|---|---|---|
| Random id + "query for open item" in transaction | relies on phantom protection of query reads — not demonstrated in repo | yes | medium | rejected |
| **Deterministic id `{teamId}__{treeId}`** (precedent: `skillProgress`, `teamMemberships`, `teamSurveyState`) | **yes, by construction** | no (one mutable item + archive) | lowest | **chosen (D6)** |
| Deterministic "current" doc + historical records | yes | yes | high (two shapes, copy-on-archive) | overengineered for A |

A does not need multiple records per competency: replanning is in-place edit;
the team's achieved stage is in `SkillProgress`. B, if it needs sequential
phases/history, relaxes the invariant by introducing items with random ids
alongside; existing deterministic documents stay valid because **no code may
parse ids — it reads `teamId`/`treeId` fields**. Cost recorded: B cannot show
two concurrent plans for one area without that change.

### Document id is not authorization
`{teamId}__{treeId}` is a **uniqueness/storage mechanism only**. It is never
parsed and never authorization proof. Every operation independently
validates: verified identity (token); team access (R for reads, W for writes,
re-derived from fresh `teams`/`teamMemberships`); the **route** `teamId`; the
stored document's `teamId` field; the referenced `treeId` (route/body → tree
exists); and that `targetNodeId` ∈ that tree's nodes.
Consistency rule (fail closed): the server computes the path from the route
`(teamId, treeId)` only; a loaded document is accepted only if
`doc.teamId === route teamId` **and** `doc.treeId === route treeId` **and**
`docId === roadmapItemDocId(doc.teamId, doc.treeId)`. Any mismatch ⇒ treated
as absent (list: skipped; PATCH: `not_found`; create over a mismatching
existing doc: `already_planned`, no write). Cross-team/cross-tree mismatches
never yield data. The `a__b`+`c` ≡ `a`+`b__c` composite collision is the same
accepted, unreachable edge case as `skillProgress` and fails closed through
the field checks.

Archive semantics under this invariant: an archived plan **occupies** the
area's slot. Creating when an archived plan exists → `plan_archived` (409);
the UI offers "Gjenopprett plan" (then normal edit). No create-over-archive
overwrite → no silent data loss.

### Source of truth
| Information | Source | In roadmap item? |
|---|---|---|
| Competency structure/labels | `skillTrees` | ids only |
| Current stage | `skillProgress.currentNodeId` | **no** |
| Tracking exists | `skillProgress/{teamId}__{treeId}` valid | no (derived) |
| Target, priority, dates, status | `roadmapItems` | yes |
| Owner identity | `teamMemberships.memberRef` ↔ `ownerRef` | ref only |
| Owner name | `userProfiles` via membership→uid, server-side | **no** |
| Team active/disabled | `teams.status` | no |
| `targetReached`, `overdue`, tracking state, `targetAvailable` | derived per read | no |
| Last editor | `updatedBy` uid | server-only |

### Target-stage integrity
Verified: `nodeId`s are immutable, trees cannot be deleted/restructured, only
labels change. Write rules (create, and any change of `targetNodeId`):
1. Team tracks the tree: `skillProgress/{teamId}__{treeId}` exists and passes
   `isValidSkillProgress` with matching `teamId`/`treeId`, else `not_tracked`.
2. The tree exists and passes `isValidSkillTree`, else `tree_not_found`.
3. `targetNodeId` must be a string equal to a `nodeId` **of that exact tree**
   (membership test on `tree.nodes`, never a shape/regex test). A well-formed
   id of another tree, a stale id or any malformed value → `invalid_input`.
4. If `currentNodeId` is non-null it must be a node of the same tree (else
   `not_tracked`, fail closed); the target's `order` must be **strictly
   greater** than the current node's `order` (`null` current = below
   `node-0`) → else `target_not_ahead`.
Target is re-validated only when it is being set; other edits never touch
it. Label corrections are invisible to the stored data (only `nodeId` is
stored; the label is read live). Defensive reads: a missing tree/node ⇒
`targetAvailable:false`, `targetLabel:null`, and no target-derived indicator
(`targetReached` key omitted); the date/status-derived `overdue` remains
independently derivable. An unresolvable tree gives `areaName:null`; the plan
survives (never hidden/archived/deleted, no fallback name, no stored name).
Editable only to pick a new target or archive. Never thrown, never silently
deleted.

### Tracking vs plan existence (decision D13, approved "C")
| Model | Verdict |
|---|---|
| A. plan may exist/be created without tracking | no current stage to validate target against |
| B. creating a plan starts tracking | hidden cross-feature write; tracking start is admin-only and gated on team status |
| **C. creating/retargeting requires tracking; never creates it** | **chosen (D13)** |
| D. cascade-delete plans when tracking stops | fan-out write from an admin SkillProgress op into roadmap |

Tracking stopped → the plan **stays untouched**. Derived DTO
`tracking: {state:"tracked", currentNodeId} | {state:"not_tracked"}`
(discriminated union — never `currentNodeId:null`, which already means "not
started"). When `not_tracked`: no current stage, no `targetReached`,
`overdue` still derives from dates.
**Exact editing rule while `not_tracked` (simplest consistent rule):** every
field **except `targetNodeId`** stays editable under the normal write
predicate W — priority, status (all transitions), `startDate`/`targetDate`,
owner (set/change/clear), archive/restore. Only a change of `targetNodeId`
is rejected (`not_tracked`), because there is no current stage to validate
it against. Re-saving an unchanged target is not a retarget. Create is
rejected (`not_tracked`). Restart of tracking (same `treeId`) reattaches
naturally (current becomes `null` again; target must be re-validated only if
changed). **Presentation:** such a plan has no tracked-area row, so it is
shown in a compact list at the bottom of the section ("Plan for område
teamet ikke lenger følger"): area name, target label (read-only), priority,
status, dates, owner; the same inline form is offered **without** the target
select, plus "Arkiver"/"Gjenopprett". No automatic tracking start, no
deletion/archival of the plan when tracking stops.

### Dates
`startDate?`/`targetDate?`: ISO calendar dates `YYYY-MM-DD` strings, no time,
no timezone, stored as strings, year 2020–2100, real calendar dates,
`startDate ≤ targetDate` when both present (merged result validated on
PATCH). All four combinations (none/start/target/both) valid. `overdue` =
`targetDate` < today (server clock, `Europe/Oslo` calendar date, one product
constant) and status ≠ `completed`; per read, no job. Client never supplies
"now". No named periods/quarters in A.

### Priority
`high | medium | low` (UI `Høy / Middels / Lav`), required, default `medium`
on create. Purely team planning metadata about a competency area — never a
score of, or attached to, a person; no numbers, weights, per-person priority.

### Status and archive (precise)
| State | Meaning | Visible by default | Editable |
|---|---|---|---|
| `planned` | agreed, not started | ✓ | ✓ |
| `active` | being worked on | ✓ | ✓ |
| `completed` | team declares done (manual; `completedAt` set) | ✓ (collapsed under "Fullførte" toggle after the open ones) | ✓ (replanning in place) |
| archived (`archivedAt` set; **orthogonal**, status retained) | retired from view; slot still occupied | ✗ (only via "Vis arkiverte") | only restore |

Transitions among `planned/active/completed` are all allowed, deliberately
including `completed → planned/active`: the model is *one mutable plan per
area*, so replanning after completion **is** reopening (target must still be
set above current if changed). `completedAt` set on entering `completed`,
removed on leaving. Archive sets `archivedAt/archivedBy`; restore removes
both and keeps the stored status. `{archived:true}` on an archived plan and
`{archived:false}` on a non-archived plan are idempotent no-ops (success, no
write). Any edit other than restore on an archived
plan → `archived` (409). `paused`/`cancelled` are not introduced (paused ≈
planned later; cancelled ≈ archived; B may add). **Completion boundary:**
reaching target is an indicator only; completing never writes SkillProgress;
SkillProgress changes never write the plan. No hidden cross-feature writes.

### Replanning
All plan fields mutable in place; `createdAt/By`, `updatedAt/By` kept; no
history/event log (accepted; additive later).

### Presentation sort (pure `compareRoadmapPlans`; storage order never relied on)
Plans (server response order): non-archived before archived; status rank
`active` < `planned` < `completed`; priority `high` < `medium` < `low`;
`targetDate` ascending, absent last; `startDate` ascending, absent last;
area name (`Intl.Collator("nb",{sensitivity:"accent"})`; an unresolved
`areaName: null` sorts **after** all resolvable named areas); `treeId`.
A's Kompetanseområder rendering orders **areas with a non-archived plan first,
in that order, then areas without a plan by area name (`nb`), then `treeId`**;
the existing `getTeamSkillProgress` contract is untouched. B may sort
differently. Owner is never a sort key or filter.

## Firestore model
Server-only (Admin SDK); `firestore.rules` standard deny block + rules test;
no client access.

### Collection / path
**Top-level `roadmapItems/{teamId}__{treeId}`**, fields carry `teamId` and
`treeId`. Matches `skillProgress`/`challenges`/`forumThreads` (top-level,
team-filtered); sub-collection under `teams` has no repo precedent and needs
collection-group queries for admin/B views. The id is derived from two
non-person identifiers, so it leaks no identity.

### Fields
| Field | Type | Req | Source of truth | Validation | Client-visible | Mutable | Notes |
|---|---|---|---|---|---|---|---|
| (doc id) | `{teamId}__{treeId}` | – | deterministic | never parsed by code | no (area addressed by `treeId`) | no | uniqueness mechanism |
| `teamId` | string | ✓ | route/authz | equals authorised team and doc-id prefix | implicit | no | |
| `treeId` | string | ✓ | SkillTree id | tree exists at create | ✓ | no | |
| `targetNodeId` | string | ✓ | SkillTree node | ∈ that tree; ahead of current when set | ✓ | ✓ | |
| `priority` | enum | ✓ | item | exact | ✓ | ✓ | not a person score |
| `status` | enum | ✓ | item | exact | ✓ | ✓ | |
| `startDate`,`targetDate` | `YYYY-MM-DD` | – | item | as above | ✓ | ✓ (null clears → `FieldValue.delete()`) | |
| `ownerRef` | string (`memberRef`) | – | `teamMemberships.memberRef` | resolves to exactly one **current** membership of this team at write time | via `owner` object | ✓ (null clears) | no uid/name/e-mail stored |
| `completedAt` | Date | – | server | iff status `completed` | derived | server-managed | |
| `archivedAt`,`archivedBy` | Date, uid | paired | server | paired-optional | `archived` boolean only | via archive/restore | `archivedBy` server-only |
| `createdAt`,`updatedAt` | Date | ✓ | server clock | | ✓ | `updatedAt` ✓ | |
| `createdBy`,`updatedBy` | uid | ✓ | verified token | | **never** | `updatedBy` ✓ | internal accountability only |

Not stored: current stage, display name, e-mail, owner `uid`, labels, free
text, scores. Invalid documents are treated as absent on read (repo
convention). Not encrypted (structured, non-sensitive, like `skillProgress`);
free text in B would need fresh classification.

### Query shapes and index analysis
All shapes are either document `get`/`create`/`update` by deterministic id, or
**one equality filter on one field, no `orderBy`, no inequality, `limit`** —
served by Firestore's automatic single-field indexes (same class as
`skillProgress`/`surveys`/`forumReplies.count` in `docs/DEVELOPMENT.md`).
| Operation | Reads/writes |
|---|---|
| GET plans | `roadmapItems.where("teamId","==",T).limit(501)`; `skillProgress.where("teamId","==",T)` (existing shape); `skillTrees/{treeId}` gets for referenced trees; only if any plan has an owner: `teamMemberships.where("teamId","==",T).limit(501)` + `userProfiles` `getAll` ≤100/batch. Presentation sort in memory. Archived filtered in memory (no `archivedAt` query). |
| GET assignable | `teamMemberships.where("teamId","==",T).limit(501)` + profiles `getAll` batches |
| POST create | one transaction: gets of `teams/T`, caller membership, `skillProgress/T__tree`, `skillTrees/tree`, `roadmapItems/T__tree` (must not exist), and — only when `ownerRef` given — the membership query above; then `tx.create`. |
| PATCH | one transaction: gets of `teams/T`, caller membership, `roadmapItems/T__tree`; + progress/tree gets only if `targetNodeId` changes; + membership query only if `ownerRef` set to a new value; then `tx.update` |
| POST admin materialise | one transaction: `teamMemberships.where("teamId","==",T).limit(501)`; `tx.update` per membership lacking a ref |
**Deliberately avoided:** `teamId == AND memberRef ==` (two-field equality).
Firestore can merge single-field indexes for it, but the repo declared a
composite for the analogous `teamId`+`status` query, so it is treated as
unproven; matching `memberRef` in memory over the ≤501 team memberships
(roster-proven pattern) removes the question. **No change to
`firestore.indexes.json`.** `roadmapItems` deny block + deployment-config
test only. If an index were ever needed it must be documented explicitly and
added with the feature (never during planning).

## Opaque member reference (A0)

### Schema
Optional field `memberRef` on `teamMemberships/{uid}__{teamId}`: string, 26
chars Crockford base32 lowercase = 128 bits of `crypto.randomBytes(16)`. Not
a hash/HMAC of anything. Written only by (a) `applyMembershipGrant` at grant
and (b) the admin materialisation mutation. Never in the roster, the admin
member list (it gets only `hasMemberRef: boolean`), or any other response
except the assignable-members and plan DTOs.

### Materialisation options compared
| | A. grant-time + explicit backfill | B. lazy update-only | C. separate mapping collection |
|---|---|---|---|
| Hidden writes from GET | none | **yes** (selector open / read) | none |
| New members | ref at grant, no extra step | ref at first planning read | needs second write at grant |
| Legacy/seeded members | explicit, auditable admin op, one transaction | automatic | explicit or lazy + new collection |
| Blast radius | edit one shared function (`applyMembershipGrant`) + one new op; grant tests asserting exact record (`toEqual(record())`) get the extra field | none on grant | new collection storing `uid` ↔ ref: a second place `uid` lives; removal must delete it or stale mapping remains (rejoin hazard) |
| Failure mode | legacy member not selectable until prepared (visible, fail-closed) | surprising writes, transaction per read | stale mappings |
| Repo fit | grant primitive is the single place; `seed-legacy-teams` is the precedent for an explicit idempotent admin op | no precedent for write-on-read | no precedent |
**Decision (D12, approved): A.** One ops consequence: each pre-existing team
needing owner assignment needs a one-time **admin-only** "Klargjør
medlemsvelger" before its legacy members appear. Ordinary members can never
invoke materialisation. No mandatory global migration precedes deploying A.

### Answers to the review questions
1. **What gives a legacy membership a ref?** The explicit admin mutation
   `POST /api/admin/teams/[teamId]/member-refs` (`requireAppAdmin`). New
   memberships: `applyMembershipGrant` generates at grant.
2. **Kind of operation:** grant-time write + explicit preparation mutation.
   **Never a GET.**
3. **Can opening an owner selector write?** No. The selector's GET is
   read-only; members lacking a ref are omitted and counted
   (`unavailableCount`).
4. **N per-membership transactions?** No: one transaction per team.
5. **100+ memberships without a ref:** one transaction reads the team's
   memberships (`teamId ==`, limit 501) and updates only those lacking a ref
   (≤500 writes, within the Firestore transaction write limit). Atomic: all
   updates commit or none (no partial unsafe state; failure ⇒
   `persistence_failed`, retry is safe because the op is idempotent). If the
   team has >500 memberships, `truncated:true`, the first 500 (query order)
   are processed and the rest remain unprepared (and unlisted) — a
   documented limitation inherited from the roster bound; the roster and
   assignable endpoints are bounded identically.
6. **Concurrency:** both callers' transactions read; the loser retries,
   sees refs and is a no-op. A removed membership is never recreated
   (`tx.update` on a document read in the same transaction; removal conflicts
   and retries). Grant: `applyMembershipGrant` already runs inside the grant
   transaction.
7. **Uniqueness:** 128-bit CSPRNG (collision ≈ 2⁻¹²⁸). In materialisation the
   transaction holds all of the team's refs and regenerates on in-team
   collision; at grant time no extra read is made (negligible, and
   resolution fails closed on any duplicate match: `invalid_owner`).
   Meaningless without `teamId`.
8. **Demo preflight:** unaffected. Classification uses only
   `isValidMembershipFor` + `grantedBy`; presenter membership is class `C`
   (never rewritten). The presenter simply has no ref until an admin
   materialises `demo-team`.
9. **In the F0 roster?** **No** — roster builds `{displayName,isLead,isSelf}`
   field by field; test asserts exact keys.
10. **Team A ref reveals/selects same user in Team B?** No: independent random
    per membership; always resolved as `(teamId, ref)` against that team's
    memberships; unknown there → `invalid_owner`.
11. **Old ref after removal resolves to a rejoined membership?** No: removal
    deletes the document; rejoin runs a fresh grant ⇒ new random ref.

### Lifecycle
Survives displayName change and lead/member change (`setTeamMemberRole`
updates only role fields; test must prove `memberRef` survives). Team
deactivation: persists; reads resolve; **new assignment rejected** (W).
Member leaves: doc deleted ⇒ ref gone. Rejoin: new ref, old plan owners stay
unavailable. Admins see the same refs in the same DTOs as members (no
admin-only ref contract). Not reusable across teams.

### Resolution
Server: `(teamId, ownerRef)` → scan of the team's ≤501 memberships for exactly
one equal `memberRef` → its `uid` (never leaves the server) → `userProfiles`
name. Zero or ≥2 matches → unresolved. Never auth evidence: every use is
preceded by normal authorization (R or W).

### Assignable-members contract (separate from roster; F0 roster DTO not reused)
`GET /api/teams/[teamId]/assignable-members` → `{members:[{memberRef,
displayName, ordinal, isSelf}], unavailableCount, truncated}`.
- All **current members that have a ref**, named or unnamed (D5).
  An app admin without membership is not listed.
- `displayName`: `string | null`; `null` = no name → the client renders the
  neutral fallback **"Medlem uten navn"** (never e-mail, never uid).
- `ordinal`: `number | null` (presentation only, see below).
- Order: see the deterministic ordering below (no `uid`/ref in output).
- `unavailableCount` = members without a ref (non-identifying count).
- No `uid`, e-mail, doc id, join date/month, role/lead, audit field.

### Duplicate-name disambiguation (D5b, approved: ordinal only)
Earlier revisions used a ref-derived `#xxxx` suffix (withdrawn: stable
per-person tag) and then a join-month suffix (withdrawn by D5b: would expose
join timing). Final rule:
- A **duplicate group** = ≥2 listed members whose rendered name is equal
  after normalisation (NFC, trim, case-insensitive); all unnamed members
  render as "Medlem uten navn" and form one group (a real member literally
  named so joins it).
- Only members **in a duplicate group** get `ordinal = 1..n`; everyone else
  `ordinal: null`. Rendered `Alex (1)`, `Alex (2)`; unnamed:
  `Medlem uten navn (1)`.
- **Deterministic server-side ordering inside a group** (ordinal = rank):
  (1) membership `createdAt` ascending (missing/invalid sorts last),
  (2) final stable tie-breaker: internal `memberRef` ascending (lexicographic).
  `createdAt` and `memberRef` are used **only server-side to rank**; neither
  value, nor any function of it other than the rank itself, is ever returned.
  The ordinal is a rank, not derived from uid/e-mail, and no `uid` or
  membership doc id is used at all. Documented residual: ordinals correlate
  with relative join order among same-named members, and may renumber when a
  same-named member joins or leaves — the ordinal is **not identity**.
- Overall list order: normalised name (`nb` collator, unnamed last), then the
  same in-group ordering ⇒ ordinals ascend within a name; deterministic for a
  given data state.
- Computed **per response**, never stored. The plan DTO's `owner` uses the
  identical function over the same set (current members with a ref), so the
  selector and the plan line agree.
- The API **never accepts** an ordinal or name as identifier; assignment uses
  `memberRef` (option value only, never rendered as text). The caller's own
  entry additionally shows "Deg".
- No e-mail/uid fallback anywhere. A stable `memberRef` per team is intended
  (same person ⇒ same ref) and must stay unlinkable to forum `authorTag`.

### Owner eligibility (D5)
Every current member with a ref is assignable, including unnamed ones
(shown "Medlem uten navn" (+ ordinal)). A missing display name is not a
missing membership; tying assignability to profile completeness would
introduce authorization-like semantics based on a presentation field and an
asymmetric "may self-assign but nobody else may assign you" rule. Help text
nudges naming ("Be teammedlemmer sette visningsnavn under Min profil").
Impersonation by non-unique names is the inherited F0 risk.

### Owner semantics and removal (truthful)
Owner = planning metadata, optional, removable (`ownerRef: null`), grants no
read/write/admin/lead capability. Only current members can be **newly**
assigned (BR-22). Because membership deletion leaves the plan's `ownerRef`
untouched, a later read cannot tell "membership removed" from "ref never
valid". Server writes only validate-at-write refs, so under normal operation
an unmatched ref was valid once; but the system **does not claim to know
why**. Therefore: DTO `owner:{state:"unavailable"}`, copy **"Ansvarlig er ikke
lenger tilgjengelig"** — no claim of "former team member" (the earlier
"Tidligere teammedlem" wording is withdrawn). No tombstone, no cascade
update, no snapshot of name/uid/e-mail. `removeTeamMember` is **unchanged**:
no cross-feature cleanup, no fan-out over `roadmapItems`. Rejoin does not
resurrect ownership. The plan stays readable and editable (assign someone
else or clear). Re-saving an unchanged unavailable `ownerRef` is not
re-validated; clearing always works (when W holds).

## Behavioral requirements

### Member reference (A0)
- **BR-1** `memberRef` = 128 bits CSPRNG, never derived from `uid`, `teamId`,
  e-mail or any input.
- **BR-2** `memberRef` is written only by `applyMembershipGrant` (inside its
  grant transaction) and by `materializeMemberRefs`; the latter uses
  `update` only inside one transaction that read the memberships, never
  creates a membership, never overwrites a valid ref. Grant paths otherwise
  keep F0 BR-21 semantics (no `role`; existing doc ⇒ `already_member`, no
  write).
- **BR-3** `POST /api/admin/teams/[teamId]/member-refs`: `requireAppAdmin`;
  team must exist (any valid status); idempotent; response `{materialized,
  alreadyHad, truncated}`; `unauthenticated` 401 / `forbidden` 403 /
  `team_not_found` 404 / `persistence_failed` 500.
- **BR-4** `GET /api/teams/[teamId]/assignable-members`: R; read-only (no
  write of any kind); exact keys per contract; `denied` 403, read failure 500.
- **BR-5** The F0 roster, `authorizeTeamAccess`, `resolveTeamRole`,
  `removeTeamMember`, `setTeamMemberRole` contracts and the admin member list
  (except additive `hasMemberRef`) are unchanged; `memberRef` appears in no
  roster/admin-list field.
- **BR-6** Removal makes a ref unresolvable on the next call; rejoin yields a
  different ref; a ref resolves only within its own team.
- **BR-7** Ordinal and ordering rules as specified (D5b); ordinal is
  presentation-only, never accepted as an identifier, never exposes join
  date/month, uid, e-mail or ref text.

### Reading
- **BR-8** `GET /api/teams/[teamId]/roadmap-items[?archived=true]`: R; returns
  `{items, canEdit, truncated}`; `canEdit` is server-derived W.
- **BR-9** Item DTO, field by field:
  `{treeId, areaName: string|null, targetNodeId, targetLabel: string|null,
  targetAvailable, tracking: {state:"tracked", currentNodeId|null} |
  {state:"not_tracked"}, priority, status, startDate|null, targetDate|null,
  owner, targetReached?: boolean, overdue: boolean, archived, createdAt,
  updatedAt}`. No `uid`, e-mail, doc id, audit actor, raw document.
  - `areaName`: live tree name; `null` iff the current SkillTree cannot be
    resolved (missing/malformed). Never a fallback, never stored; the plan is
    never hidden because of it.
  - `targetAvailable`: `true` iff tree and target node resolve; else `false`
    with `targetLabel:null`.
  - `targetReached` is target-derived and **optional**: present only as a
    `boolean` when derivable; **key omitted** when not derivable
    (`not_tracked`, unresolvable tree, missing/stale target node, current node
    not in the tree). Never `null`; never stored.
  - `overdue` is date/status-derived (BR-12 rule: `targetDate` < Europe/Oslo
    today and status ≠ completed), always present, independent of tree/target
    availability and tracking; never stored.
  - `owner`: `null` when there is no `ownerRef` **or the persisted `ownerRef`
    is non-string**; `{state:"current", memberRef, displayName|null,
    ordinal|null, isSelf}` for a string ref uniquely resolving to current
    eligible membership of this team; `{state:"unavailable"}` for a persisted
    **string** ref that cannot (stale, malformed, duplicate, other-team).
    `ownerRef` is planning metadata, never authorization.
- **BR-10** `currentNodeId`/tracking from a fresh SkillProgress read;
  `areaName`/`targetLabel` live from the tree; none stored.
- **BR-11** Archived excluded unless requested; invalid documents and
  documents failing the id/field consistency rule ("Document id is not
  authorization") skipped; reads bounded ≤500
  (limit 501, `truncated`); read never writes.
- **BR-12** Items sorted by `compareRoadmapPlans` server-side.

### Writing
- **BR-13** `POST /api/teams/[teamId]/roadmap-items`: body allow-list
  `{treeId, targetNodeId, priority?, status?, startDate?, targetDate?,
  ownerRef?}`; extra keys/non-object/bad JSON → 400 `invalid_request`.
  Defaults `medium`, `planned`.
  The 201 `{item}` is built from the state validated inside the create
  transaction (a snapshot; GET is the live view). After a successful commit
  no presentation failure may produce `persistence_failed`; an owner whose
  display names cannot be read degrades to `{state:"unavailable"}`.
- **BR-14** `PATCH /api/teams/[teamId]/roadmap-items/[treeId]`: allow-list
  `{targetNodeId, priority, status, startDate, targetDate, ownerRef,
  archived}`; `null` clears dates/owner; `archived` (boolean) must be the only
  key when present; ≥1 key. `teamId`/`treeId` immutable. Missing doc →
  `not_found` (also for a doc whose stored `teamId` mismatches).
- **BR-15** Every write runs in one transaction with fresh reads of the
  caller's membership (genuine) and `teams.status === "active"` (W);
  otherwise `forbidden` / `team_disabled`, zero writes. `teamId` only from
  the route; client `uid`/role/owner never trusted.
- **BR-16** Create: target-integrity rules (1–4), doc must not exist
  (`already_planned`; archived → `plan_archived`), `tx.create` makes
  concurrent creates single-winner.
- **BR-17** Dates validated on the merged result; priority/status exact enums.
- **BR-18** `targetNodeId` change re-runs rules 1–4 (so is rejected with
  `not_tracked` while untracked); an unchanged target and all other fields
  need no tree/progress, so they stay editable while untracked.
- **BR-19** `ownerRef` set/changed must match exactly one current membership
  of this team (in-memory match over the team's ≤501 memberships read in the
  transaction) else `invalid_owner` (one code for unknown/stale/malformed/
  other-team/duplicate); admins-without-membership have no ref.
- **BR-20** Status transitions per table; `completedAt`, `archivedAt/By`,
  `updatedAt/By`, `createdAt/By` server-managed, never client-set.
- **BR-21** Archived plan accepts only `{archived:false}` → else `archived`.
- **BR-22** Concurrency: partial-field transactional update; different fields
  merge, same field last-write-wins; no version precondition (small teams,
  reversible fields; no uniqueness race remains because uniqueness is the doc
  id). Archive vs edit decided inside the transaction by BR-21.
- **BR-23** No hard-delete endpoint. No item cap: the number of plans per team
  is bounded by the number of trees (`listSkillTrees` itself caps at 500);
  the 501-limit read is a safety bound only.

### Boundaries
- **BR-24** No planning response carries `uid`, e-mail, membership doc id,
  `createdBy/updatedBy/archivedBy`, or anything from which a `uid` is
  computable (deep key assertions).
- **BR-25** Owner/ref never affects authorization.
- **BR-26** Cross-team isolation: Team X authorisation never yields Team Y
  plans or owners; a Y ref under X → `invalid_owner`.
- **BR-27** No cross-feature writes: roadmap ops never write progress,
  challenges, profiles or memberships; progress/membership operations never
  write plans; the only membership writes are BR-2's.
- **BR-28** No scores, rankings, per-person counts/aggregates; owner is not a
  sort key, filter or grouping; no "who edited".

### UI (exact A scope)
- **BR-29** All UI lives inside the existing `Kompetanseområder` section of
  `/teams/[teamId]`, in each tracked-area row (below `SkillProgressPath`):
  a **Plan** summary line + (when `canEdit`) an **inline expandable form**.
  Plans of untracked areas appear in the compact bottom list (see Tracking).
  A adds **no** route, tab, header/nav entry or modal.
- **BR-30** Plan line shows: `Målstadium`, `Prioritet` (text), `Periode`,
  `Ansvarlig` ("Ikke tildelt" / name or "Medlem uten navn" (+ " (n)" ordinal,
  "Deg") / "Ansvarlig er ikke lenger tilgjengelig"), `Status`, plus text indicators "Målet er nådd"
  (with hint to mark fullført) and "Måldato passert". Completed/archived
  behind toggles. Empty: "Ingen plan ennå".
- **BR-31** Form: target `Select` (stages above current only; omitted for
  untracked plans, whose target is read-only), priority
  `Select`, two `type=date` inputs, owner `Select` from the assignable
  endpoint (fetched on first form open; independent loading/error; shows
  admin hint when `unavailableCount>0`), status `Select` (edit), "Lagre",
  "Avbryt", "Arkiver"/"Gjenopprett". No optimistic update: success refetches.
- **BR-32** Independent failure: roadmap read has its own state beside the
  existing fetches; its failure never blanks other sections and vice versa.
  `TeamDetail` receives wiring only (one fetch + mapper); components live in
  the `roadmap` slice.
- **BR-33** `canEdit:false` ⇒ controls absent (not disabled).
- **BR-34** Responsive: fields stack below `sm`; text wraps; existing
  `Button`/`Select`/`Card` primitives; labelled controls, keyboard operable,
  no colour-only state.
- **BR-35** Norwegian copy in `roadmap/copy.ts`; `Kompetanseområde`, never
  `Ferdighet`. Owner help: "Ansvarlig er en planleggingsmarkering – ikke en
  vurdering av noen." Names/labels as inert text.
- **BR-36** Admin: `/admin/teams/[teamId]` member rows get a minimal "Klargjør
  medlemsvelger" control shown only when any member has `hasMemberRef:false`.
- **BR-37** **B owns** (not in A): `/teams/[teamId]/roadmap`, tab navigation
  (`Oversikt · Kompetanse · Roadmap`), timeline/list/board views, cross-area
  overview, multi-plan history, challenge links, richer replanning flows.

### Compatibility
- **BR-38** No migration of existing documents. Existing memberships behave
  as before; the only mutation of existing documents is the explicit admin
  materialisation. Existing grant tests asserting the exact record are
  updated for the added field. `skillProgress`, forum, surveys, challenges,
  invitations, requests, roster, `authorizeTeamAccess`, `resolveTeamRole`
  behaviour is unchanged.

## Authorization matrix (server)
| Operation | Identity | Check | Denied |
|---|---|---|---|
| `GET …/assignable-members`, `GET …/roadmap-items` | token | R | 401 / 403 / 500 |
| `POST …/roadmap-items`, `PATCH …/roadmap-items/[treeId]` | token | W in transaction | 401 / 403 / 400 `team_disabled` / 404 |
| `POST /api/admin/teams/[teamId]/member-refs` | token | `requireAppAdmin` | 401 / 403 |

## API contracts
Thin handlers, bearer extraction, strict allow-lists, `{error: code}`.
Files: `app/api/teams/[teamId]/assignable-members/route.ts`,
`app/api/teams/[teamId]/roadmap-items/route.ts`,
`app/api/teams/[teamId]/roadmap-items/[treeId]/route.ts`,
`app/api/admin/teams/[teamId]/member-refs/route.ts`.
| Method/path | Request | 200 | Errors |
|---|---|---|---|
| GET assignable-members | – | `{members:[{memberRef,displayName,ordinal,isSelf}],unavailableCount,truncated}` | `unauthenticated` 401, `forbidden` 403, `read_failed` 500 |
| GET roadmap-items | `?archived=true` optional | `{items,canEdit,truncated}` | same |
| POST roadmap-items | BR-13 | 201 `{item}` | `invalid_request` 400, `invalid_input` 400, `target_not_ahead` 400, `invalid_owner` 400, `team_disabled` 400, `not_tracked` 404, `tree_not_found` 404, `already_planned` 409, `plan_archived` 409, 401, `forbidden` 403, `persistence_failed` 500 |
| PATCH roadmap-items/[treeId] | BR-14 | `{item}` | as POST minus create-only + `not_found` 404, `archived` 409 |
| POST admin member-refs | – | `{materialized,alreadyHad,truncated}` | BR-3 |
No raw Firestore documents anywhere; errors/logs never echo names, refs or
submitted values.

## Edge cases
Tracking stopped/restarted; current regresses (indicator clears, no write);
current null (any stage valid); target = current at create → `target_not_ahead`
(after creation equal/above is `targetReached`); owner unavailable;
owner clears name (still current, "Medlem uten navn"); duplicate or all-
unnamed names (ordinals); team of one; team disabled mid-edit
(`team_disabled`, generic message); concurrent create (one `already_planned`);
archive-vs-edit race; corrupt doc skipped; non-string `ownerRef` ⇒ `null`
owner; bad dates (`2026-02-30`, 2019, 2101, start>target); >500 plans/members
(`truncated`); area archived then "Planlegg" ⇒ `plan_archived` → "Gjenopprett";
legacy member without ref (counted, hint); tree label corrected (live label).

## Security and privacy
- First client-visible member handle (`memberRef`): random, per membership,
  team-scoped, no authorization power, fail-closed resolution, destroyed with
  the membership.
- Forum anonymity: no value derivable from `uid`; assignable ordering uses
  name/join time/ref only; roster untouched; regression test asserts
  `authorTag` inputs unreachable.
- Anti-surveillance: team plans about competency areas; no per-person
  metrics/aggregates/ranking, no filter/sort by owner, no "who edited",
  `updatedBy` internal only; owner = planning marker, copy says so.
- **Policy exception (D3, approved):** owner is the first person-linked field
  on the skill surface; it is team-plan metadata (a responsible contact), not
  a person's skill, level, performance or assignment of a skill to a person.
  It grants no authorization, visibility, lead capability or edit right. The
  existing "no per-person assignment" statements must be reconciled at
  closeout (see Documentation impact).
- Duplicate-name ordinal (D5b) exposes no join date/month; it only reveals
  relative order among same-named members' joins (residual, documented).
- Not encrypted (non-sensitive structured data); retention: plans persist
  (no delete); no uid/name/e-mail in `roadmapItems`, so removal/account loss
  leaves no identity there.
- Logging: no names/refs/plan content. Impersonation risk inherited from F0.
- Materialisation writes only `memberRef`; admin-only; idempotent.

### Proposed invariants (to `docs/SECURITY.md` at closeout, 23–30)
23 Roadmap data is team-scoped, server-only; each op re-derives authorization
from verified identity + fresh state; client team/uid/role/owner never proof.
24 A client-visible member reference is CSPRNG output stored on the
membership, never derived from `uid`/`teamId`/e-mail.
25 A member reference is never authentication/authorization evidence; being
referenced grants nothing.
26 A member reference is valid only with its own `teamId`; unknown, stale,
malformed, cross-team or ambiguous refs fail closed.
27 A removed membership cannot be newly assigned; its ref is never
re-associated after rejoin.
28 Member-facing planning responses contain only allow-listed keys — never
`uid`, e-mail, membership doc id or audit fields.
29 The roster stays identifier-free; member selection uses the dedicated
contract.
30 Planning stores team-level intent only: no individual score, ranking,
per-person aggregate, manager note or inferred competence.

## Architecture decisions
- `src/features/roadmap/` (domain: item guard, dates, enums, derived
  indicators, `compareRoadmapPlans`, target validation; server: list/create/
  update with `*Deps`; client gateway; components; copy). Member-reference
  code in `src/features/teams/` (domain `member-ref.ts`; server
  `materialize-member-refs.ts`, `list-assignable-members.ts`; change in
  `applyMembershipGrant`; admin gateway/button). Dependencies:
  `roadmap → teams`, `roadmap → skill-trees` (own thin readers, no widening
  of `skill-trees` exports), `roadmap → profiles`; never the reverse;
  `TeamDetail` composes. (Rule: no cross-feature coupling beyond necessity —
  readers re-declared per the existing per-file seam convention.)
- No `resolveTeamRole`; no `authorizeTeamAccess` change; no feature flag.
- Internal ordering: **A0 (ref + materialisation + assignable endpoint) is a
  security-reviewed prerequisite for the owner field**; plans without owner
  could ship first.

## Demo Team (smallest valid extension; not part of A's core; shipped as TASK-011, no real seed run)
Inspected: fixtures are pure/deterministic; one presenter membership (real
Auth uid, class `C`, not created via the grant primitive); 3 tracked areas
(testing `node-2`, delivery `node-4`, observability `null`) + untracked
secure-dev.
- **A does not require synthetic members or Auth identities.** No fixed
  `memberRef` constants in fixtures (they would bypass the generation model
  and, for the presenter, never be written since `C` skips existing docs).
- Follow-up (TASK-011, shipped): 3 `roadmapItems` with deterministic ids
  `demo-team__demo-skill-<x>`, manifest class **`C` (create-only)**: a missing
  fixture is created; a compatible existing one (valid shape, `teamId
  demo-team`, `createdBy demo-seed`) is skipped and preserved, so presenter
  edits survive a reseed and nothing is silently overwritten; an
  incompatible/unsafe existing document is a conflict (zero writes). Class
  `U` would `set` the fixture again and revert presenter edits; it is not
  used for plans. Plans: testing (active, high, dated, unassigned);
  observability (planned, medium, undated, unassigned); delivery (completed,
  low, reached). **All unassigned.** The presenter (an admin) may run the
  materialise op once and assign themself live — this demonstrates the owner
  UI without seeding any ref. Shipped with manifest entry, collection
  allow-list, preflight/plan tests and the DEVELOPMENT.md count (85 documents,
  8 collections). "Owned by presenter" and "former/unavailable owner" demos are
  explicitly out of scope (need refs/deleted memberships).

## Testing strategy
Server operations with injected `*Deps` first, then routes, then components;
no real Firebase for unit tests; emulator tests (transaction/`tx.create`
semantics, membership query inside transaction) are an **optional separate
integration** classification, not a gate.
| Boundary | Covers |
|---|---|
| Domain: item guard, dates (leap, bounds, start>target), enums, `compareRoadmapPlans` (all tiebreaks, nulls, archived), `targetReached`, `overdue` (Oslo date boundary), ordinal rule (named dups, all-unnamed, NFC/case-equal names, createdAt-then-ref tiebreak, `null` when unique, deterministic across calls, selector/plan-line agreement, no join date/ref/uid in output) | BR-7, 12, 17 |
| `memberRef` generator/guard (length, alphabet, no input dependence, collision regenerate) | BR-1, 2 |
| `applyMembershipGrant`: new membership gets ref; existing ⇒ `already_member` no write; no `role`; remove→grant ⇒ different ref; invitation/approval/direct paths | BR-2, 6, 38 |
| `materializeMemberRefs`: admin-only, idempotent, ≥100 missing in one transaction, never recreates a removed membership, keeps valid refs, in-team collision, truncation, disabled team ok, unknown team 404 | BR-2, 3 |
| `listAssignableMembers`: exact keys deep-checked, no write ever, named+unnamed, `unavailableCount`, ordering without uid, cross-team denied, removed denied next call, admin non-member, duplicates, truncation | BR-4–7, 24, 26 |
| Roadmap read: exact DTO keys, current from SkillProgress only, `not_tracked` union (null≠not started), `targetAvailable:false`, `unavailable` owner, archived default, corrupt/cross-team docs skipped, `canEdit` matrix, sort, truncation, read never writes | BR-8–12, 24, 26 |
| Create/update: authz matrix incl. **every cell of the inactive-team matrix**, lead = member, admin non-member denied, zero writes on denial; target rules 1–4 incl. cross-tree nodeId, stale, malformed, null current, equal/behind; dates; owner (valid, other-team, removed, duplicate-match, malformed, unchanged-unavailable, clear); status transitions + `completedAt`; archive/restore; archived edit; **concurrent double create = one winner**; server-managed fields not client-settable; immutables; partial-field concurrency | BR-13–23, 25–28 |
| Cross-feature: SkillProgress stop/regress/report/start suites unchanged; roadmap never writes progress; progress never writes plans; `removeTeamMember` unchanged (no fan-out) | BR-27, 38 |
| Regression: F0 roster exact keys; `authorizeTeamAccess`/`resolveTeamRole`/`setTeamMemberRole` (ref survives role change)/admin list (additive `hasMemberRef` only); forum `authorTag` unreachable (serialization scan for uid/e-mail/doc-id) | BR-5, 24 |
| Routes: bearer, strict allow-lists, status mapping, no DELETE | BR-3, 13, 14 |
| Rules/config: `roadmapItems` deny block; `firestore.indexes.json` unchanged | Security |
| Components: plan states, indicators as text, owner labels (self/none/unavailable/duplicate), target options above current only, hidden controls when `canEdit:false`, orphan-plan list, independent failure, admin "Klargjør" control, inert rendering | BR-29–36 |
| Demo Team (only if the follow-up task is done): manifest/preflight classification for `roadmapItems`, presenter membership unaffected by `memberRef` | Demo |
Gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then `git diff`.

## Documentation impact (completed at implementation closeout, TASK-012)
- `DATA-MODEL.md`: RoadmapItem row; `TeamMembership.memberRef`.
- `ARCHITECTURE.md`: member-reference + planning boundary; replace "no member
  reference exists" statements.
- `SECURITY.md`: invariants 23–30; amend 20 ("No such reference exists yet");
  checklist items.
- **Mandatory reconciliation (D3):** the current statements that the
  competency surface has no per-person assignment must be reconciled during
  closeout, because A deliberately adds an optional responsible team member
  to roadmap plans (planning metadata only; no authorization, visibility,
  lead capability, performance meaning or ownership-based edit rights; not
  individual competency assessment). Concretely: `UI-UX.md` Skill Tree UX
  bullet "no … per-person assignment …" (~line 420) — amend to state the
  owner exception and add the plan block/form; `team-skill-tree/SPEC.md`
  non-goal + BR-30 — dated pointer note ("a team plan's responsible contact is
  not a per-person skill assignment; see team-skill-planning"), no behavioural
  rewrite. Check the "no per-person data" lines in `PRODUCT.md`/`ROADMAP.md`
  (org overview scope) and leave them unchanged if they remain true for their
  own scope. No other historical feature docs are rewritten.
- `member-identity-and-team-roles/SPEC.md`: one-line pointer that the
  member-reference constraint was resolved by A0.
- `DEVELOPMENT.md`: Firestore rules/indexes section (record the query shapes
  and "no new index"); Demo section only if the demo follow-up ships.
- **`ROADMAP.md`** (owner of phase/initiative tracking): on A's closeout add a
  concise "Team & Personal Development initiative (F0 → A → B → C1/C2 →
  D1/D2)" entry marking F0 and A delivered and B–D planned; **`PRODUCT.md`**
  only a one-line pointer plus the owner-policy nuance (D3). Not rewritten
  during planning.
- `firestore.rules` + deployment-config test; this SPEC reconciled; `TASKS.md`
  via `/split-tasks` later.

## Relationship to challenges
Challenges: anonymous, encrypted free-text friction reports, no submitter
identity, derived lifecycle, admin-managed. Plans: structured, team-owned
competency development intent with optional owner. Different privacy class
and owner; **completely separate in A** (no field, no link). Any
challenge↔plan link is deferred to B or later and needs its own review (a
link field would itself be a correlation vector against challenge anonymity).

## Relationship to B / C / D
- **B** adds route/tabs/timeline/richer replanning over this model; if
  multiple plans per area or history are needed, it relaxes the one-plan
  invariant (random-id items alongside deterministic ones; code never parses
  ids) and may add `paused`/`cancelled`.
- **C2** can create/prefill a plan from a team skill gap: it needs only
  `treeId` + target `nodeId`; no individual field exists in A.
- **D** reuses `memberRef` and the assignable-style contract (new DTOs, same
  resolution rules and review checklist).

## Risks
- **Per-person-assignment policy exception (D3)** — must be explicitly
  accepted and documented.
- Ops step: legacy teams need the one-time admin materialisation before
  owners appear (D12).
- Any member can edit/assign (D1/D3); mitigated by reversibility/archive.
- B needs a model relaxation for multiple plans per area.
- Duplicate-name ordinals are not identity and may renumber when same-named
  members join/leave; they reveal only relative join order (D5b).
- Untracked plans cannot be retargeted until tracking resumes (D13).
- Defensive 501-row read bound (plans, memberships) is a safety bound, not a
  product limit; teams >500 memberships are truncated (inherited roster
  limit).
- `TeamDetail` growth (831 lines): wiring only.
- Archived plans are never purged.
- Grant-record test updates (`toEqual(record())`) across grant suites.
- Inherited: name impersonation, orphan profiles.

## Dependencies
F0; Phase 7/8 skill tree/progress; UI kit; `verifyIdToken`,
`authorizeTeamAccess`, `requireAppAdmin`. Required by B, C2, D.

## Acceptance criteria
- [x] `roadmapItems/{teamId}__{treeId}` holds only the specified fields; no
      owner `uid`, name, e-mail, label, current stage or free text.
- [x] At most one plan per area; concurrent create has one winner; archived
      plan blocks create with `plan_archived`.
- [x] A member creates/edits/archives/restores; refetch shows changes.
- [x] Target must belong to the exact tree and be above current; cross-tree/
      stale/malformed targets rejected.
- [x] Current stage read only from `skillProgress`; `not_tracked` and regress
      behave per spec; no cross-feature writes.
- [x] Every cell of the inactive-team matrix verified; lead/admin non-member
      cannot write.
- [x] No GET performs a write; `memberRef` is created only at grant and by the
      admin materialisation; removal ⇒ unresolvable; rejoin ⇒ new ref.
- [x] Assignable and plan DTOs have exactly the documented keys; roster
      unchanged; duplicates (and all-unnamed) distinguished by ordinal only —
      no e-mail/uid/ref/join-date exposure.
- [x] Doc-id/field/route mismatches fail closed; doc id never used for
      authorization.
- [x] Untracked plans: all fields but `targetNodeId` editable; retarget
      rejected; plan retained and listed in the untracked section.
- [x] Materialisation is admin-only, idempotent, atomic, never recreates a
      membership, never exposes uid.
- [x] Removed owner shows "Ansvarlig er ikke lenger tilgjengelig"; no
      cascade.
- [x] No scores/rankings/per-person aggregates; no new index; deny rule +
      test present.
- [x] UI only inside Kompetanseområder; no route/tab/modal; independent
      failure; Norwegian; keyboard accessible.
- [x] Docs per impact list updated, invariants 23–30 added; typecheck/lint/
      test/build pass; no unrelated diff.

## Decisions (all approved by the product owner, 2026-10-01)
| # | Decision | Encoded as |
|---|---|---|
| D1 | Editing | All genuine members of an **active** team create/edit; lead = member; no lead-only writes in A |
| D2 | App admin | Read-only for planning; admin may only run the separate member-ref preparation op (D12) |
| D3 | Responsible person | Optional single `ownerRef`; any editor may assign any current eligible member; planning metadata only (explicit policy exception; reconcile docs at closeout) |
| D4 | Priority | `high/medium/low` (Høy/Middels/Lav), required, default Middels; never a person score; deterministic sort defined |
| D5 | Unnamed members | Assignable; neutral "Medlem uten navn"; never e-mail/uid fallback |
| D5b | Duplicate names | Presentation ordinal only (`Alex (1)`), server ranking by `createdAt` then internal `memberRef`; no join date/month, no identifier exposed; not accepted by API |
| D6 | One plan per area | Domain invariant: `roadmapItems/{teamId}__{treeId}`; archived plan keeps the slot; `plan_archived` → UI restore |
| D7 | Status | `planned/active/completed`, any manual transition incl. reopen; archive orthogonal; restore keeps status; no paused/cancelled |
| D8 | Completion | Manual; target reached = derived indicator only; no cross-feature writes |
| D9 | Owner removal | Keep `ownerRef`; no cascade; "Ansvarlig er ikke lenger tilgjengelig"; rejoin ⇒ new ref |
| D10 | Roadmap route | Deferred to B; A inside Kompetanseområder only |
| D11 | Cap | No business cap; plans bounded by #SkillTrees; 501-row read bound is a defensive safety bound only |
| D12 | memberRef | CSPRNG at grant; admin-only idempotent atomic team-scoped materialisation for legacy memberships; no GET writes; no mandatory global migration |
| D13 | Tracking | Create/retarget require tracking; never starts tracking; plan survives tracking stop (`not_tracked`); all fields except target editable while untracked |

No unresolved product decision remains.

## Closeout notes (as built, TASK-012)
Documentation was reconciled with the accepted implementation; no approved
decision (D1–D13) was changed. Where the SPEC gave no exact wording, the
implemented neutral copy is authoritative (`src/features/roadmap/copy.ts`).
Operational limits accepted at review (none is a product requirement):
- Admin member-ref preparation reads at most 500 memberships (limit 501) and
  reports `truncated`; it can be re-run. Assignable-member and roadmap reads
  use the same defensive 501-read bound; there is no business cap on plans
  (one per team and area).
- Duplicate display names get presentation-only ordinals, which can renumber
  when membership changes. Malformed or duplicate refs never resolve (fail
  closed), so such an owner reads as unavailable.
- Accepted UI nuances: the reload control can be clicked repeatedly during a
  reload; a failed archive request re-mounts the form; the editor's dirty
  comparison uses the live plan, not a form-open snapshot; a tracked row may
  briefly show "Planlegg" before the roadmap read reconciles; the archived
  toggle has a narrow race window.
- Stopping tracking never deletes or archives a plan (D13); the plan moves to
  the untracked section until tracking restarts.
