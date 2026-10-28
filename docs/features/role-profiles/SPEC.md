# Role profiles (Rolleprofiler)

## Status

Approved (product planning) — 2026-10-27. The product owner approved the recommended option for PO-1, PO-2 and
PO-3, and approved the eleven planning-gap decisions PG-1 to PG-11 the same day. PG-12 (cross-feature static guard
ownership, 2026-10-27) was discovered by the implementation milestone gate after TASK-009 and approved as Option A the
same day; it is recorded below and does not change the product scope. All are recorded under
"Product-owner decisions" and "Planning-gap decisions" below. This approval covers the product scope and this
SPEC's requirements only. It is **not** an implementation or review approval: nothing in this document is
implemented, `TASKS.md` exists (31 tasks, all `Ready`), and no task has started.

Historical context: "role expectations" / `roleDefinitions` was an unscheduled future feature
(`docs/ROADMAP.md`, `docs/PRODUCT.md`, `docs/DATA-MODEL.md`). This SPEC replaces that unscheduled
placeholder with a concrete, smaller proposal. The earlier model (one current role plus one target role,
admin-assigned or self-selected, and a "professional role" concept) is **revalidated and narrowed** here;
it is not adopted by default.

## Problem

A person who self-assesses their skills (C1, `/me/skills`) and keeps development goals (D1, `/me/goals`)
has no reference point for what a professional role normally expects. They cannot easily see which skill
areas matter for the role they are growing towards, nor turn that into a goal. Organizations have no
DevPulse place to describe typical expectations for a role, and the existing skill catalog (SkillTree) has
no notion of role.

## User outcome

- An app admin can maintain a short, org-wide list of roles with the skill areas and expected levels that
  are normally expected for each.
- A signed-in person can optionally pick one role they are developing towards, see for each expected skill
  area how their own self-assessment compares, and choose to create an ordinary personal goal from an
  expectation.
- Nobody else (lead, teammate, admin) learns which role a person selected or how it compares with them.

## Scope

- Org-wide **role definitions**: name, optional description, and 0–20 expected skill levels, each keyed to an
  existing SkillTree (`treeId`). Managed only by app admins; archive and restore; no hard delete.
- **One optional target role per person**, self-selected, owner-only, changeable and clearable.
- **Live, owner-only comparison** between the person's own C1 levels and the target role's expectations.
- **Create personal goal from an expectation**: a user-initiated shortcut into the existing D1 goal form,
  creating an ordinary D1 goal.
- Minimal navigation: a section on the existing `/me/skills` page and one admin page.

## Out of scope

- A **current role** (job title, primary role, or any admin-assigned or self-declared current role).
  Not part of v1 (PO-1, approved 2026-10-27). Future scope needs separate product and privacy approval.
- Any **lead or teammate role-definition proposal, approval or suggestion workflow** (PO-2, approved
  2026-10-27). Role definitions are mutated by app admins only.
- Multiple target roles, role families, role levels or ladders.
- Required vs. optional per expectation, weights, priorities, or any "gap" score.
- Any numeric or categorical summary of the comparison (count, percentage, readiness, "ready",
  "promotion ready", ranking, overall score, ordering by status).
- Automatic goal creation, notifications, assignments, reminders or manager tasks.
- Any lead, manager, teammate or admin view of a person's target role or comparison; team-level role
  coverage or aggregates of target roles; workforce or hiring planning.
- Using role expectations in `teamSkillNeeds`, C2 coverage, `roadmapItems` or `skillProgress`.
- Sharing role or comparison data in D2 conversations (see "D2 interaction").
- Performance assessment or performance reviews of any person, manager ratings or any manager-authored
  assessment, ranking or comparison between people, readiness or promotion scoring, and compensation.
- Succession planning, external HRIS or job-title integration, mentor matching and AI recommendations.
- Automatic goal creation from role data (see "D1 goal integration").
- Sharing of role, target-role or comparison data in D2 conversations or anywhere else (see "D2 interaction").
- Demo Team role data, synthetic target roles or any seeding (PO-3, approved 2026-10-27; see "Demo Team").
- Per-person history of selected roles.

## Key concepts

- **Role definition**: an org-wide, admin-maintained reference description of a professional role's typical
  skill-area expectations. It is not an employee record and says nothing about any individual.
- **Expectation**: one entry in a role definition: "for skill area `treeId`, the normal expected level is
  `expectedLevel`". Not a requirement on any person.
- **Target role**: the single role a person has chosen to develop towards. Personal, optional, owner-only.
  It is development-oriented state, not authoritative HR or job-title data. DevPulse is not a system of
  record for employment, job title or grade (PO-1, approved 2026-10-27).
- **Comparison**: a live, per-request view of one person's C1 levels against the expectations of their
  target role. Never stored.
- **Team role** (`teamMemberships.role`, lead or member) and **professional role** are different things.
  Any code for this feature must name the concept `roleDefinition`/`targetRole` and never reuse the team
  `role` field (see `docs/features/member-identity-and-team-roles/SPEC.md`, "Key concepts").

## Actors and access

- **Unauthenticated**: no access.
- **Signed-in person (owner)**: may read active role definitions; may select, change or clear their own
  target role; may read their own comparison; may create their own goals from an expectation.
- **Ordinary teammate**: may read active role definitions (org-wide reference only). No access to any other
  person's target role or comparison.
- **Team lead**: same as ordinary teammate. No role-definition mutation authority, no proposal or approval
  workflow (PO-2), and no access to any person's target role or comparison. Lead status never widens access.
- **App admin**: may manage role definitions (create, edit, archive, restore) and read them including
  archived ones. No access to any person's target role or comparison. App-admin status never widens personal
  access.
- **Role-definition administrator**: not a distinct actor. The app-admin check (`requireAppAdmin`) is the
  only authority; no second admin system is introduced.

## User stories

1. As an app admin, I want to define a role with the skill areas and expected levels normally expected so
   that people can use it as a development reference.
2. As an app admin, I want to rename, re-describe, change or archive a role so that the list stays current
   without losing references.
3. As a person, I want to optionally choose a role I am developing towards so that the comparison is about
   my own development direction.
4. As a person, I want to see for each expected skill area whether my self-assessment meets the expectation
   or is a development opportunity, so that I can decide what to work on.
5. As a person, I want to create a personal goal from an expectation so that a role expectation can become a
   development intention I own.
6. As a person, I want to clear my target role at any time so that I can stop the comparison without
   anyone being told.

## Behavioral requirements

Role definitions (admin-managed, org-wide)

- **BR-1**: Role definitions are created, edited, archived and restored only by an app admin, through
  server-side admin routes (PO-2, approved 2026-10-27). No team lead, teammate or person can change a role
  definition, and no proposal, suggestion or approval workflow exists. App-admin status grants no access
  to any person's target role or comparison (BR-10, BR-13).
- **BR-2**: A role definition has a `name` (trimmed, 1–80 characters, required), an optional `description`
  (plain text, at most 500 characters), and 0–20 `expectations`. Each expectation is an existing SkillTree
  `treeId` and an `expectedLevel` integer in `2–4`. A `treeId` may appear at most once per role. Level 1 is
  rejected (same rule as C2 `requiredLevel`).
- **BR-3**: A role with zero expectations may exist (draft) but cannot be selected as a target role
  (BR-8).
- **BR-4**: An expectation means "the normally expected level for this skill area in this role". It is not
  a requirement on any person and has no required/optional flag, weight, priority, due date or history.
  Removing an expectation removes the entry.
- **BR-5**: Archiving hides a role from people's role lists and from selection. A person whose target is an
  archived role sees it marked as archived and no comparison (BR-9 is suspended). Admins can still read and
  restore archived roles. Archiving does not modify any person's stored target.
- **BR-6**: Active role definitions are readable by any signed-in user. The `RoleDto` allow-list is exactly:
  `roleId`, `name`, `description` (optional), `selectable` (boolean, BR-8), and `expectations`, each item being
  `treeId`, `treeName` (or `null`) and `expectedLevel`. `roleId` and `treeId` are opaque catalog identifiers,
  not personal identifiers, and normal client behaviour needs them (PG-8, approved 2026-10-27). No other field
  is returned and no person data is present. Persistence objects are never returned directly. Forbidden in any
  browser DTO: `createdBy`, `updatedBy`, `archivedBy`, user uid, e-mail, `memberRef`, and any other internal
  audit or identity field.
- **BR-7** *(caps)*: At most **50** role definitions in total: active, archived and malformed documents all
  count. Name and description limits per BR-2. The cap is enforced by count-then-create: the create operation
  reads a Firestore `count()` aggregation over the whole `roleDefinitions` collection (no index) and refuses
  with `409` when the count is 50 or more (PG-5, approved 2026-10-27). A small overshoot under concurrent
  creates is accepted (same precedent as D1 goals).

Personal target role (owner-only)

- **BR-8**: A signed-in person may select at most one target role. Selection is optional. A role is
  **selectable** only when it exists, is active, and has at least one expectation whose `treeId` resolves to a
  currently valid, available SkillTree (PG-2, approved 2026-10-27). A role with zero stored expectations, and a
  role whose expectations all fail to resolve, is unselectable. A selection against an unselectable, archived
  or missing role is refused and writes nothing. The eligibility check and the write run in one Firestore
  transaction that reads the authoritative role document with `tx.get` (PG-7). Selection may be replaced or
  cleared at any time. No history of past selections is kept.
- **BR-9**: The comparison (below) is shown only when a target role is selected, is active, and has at least
  one expectation.
- **BR-10**: The target role is readable and writable only by its owner (the verified uid). No uid-based
  read or write exists. No team, lead, admin or membership relation widens access.

Comparison (derived, owner-only, live)

- **BR-11**: For each expectation of the owner's target role, the comparison yields exactly one status:
  - `meets` *(Møter forventningen)*: the owner has a valid C1 level for that `treeId` and it is `>=` the
    expected level;
  - `development_opportunity` *(Utviklingsmulighet)*: the owner has a valid C1 level and it is `<` the
    expected level;
  - `not_assessed` *(Ikke vurdert ennå)*: the owner has no C1 level for that `treeId` (absence of a level is
    never treated as a level);
  - `area_unavailable` *(Ikke tilgjengelig)*: the referenced SkillTree is missing or invalid. Shown as a
    notice; no personal content depends on it.
- **BR-12**: The comparison is computed on every request from the owner's C1 `skillProfiles` document and
  the role definition. Nothing is persisted or cached. It has no numeric value, count, percentage, total,
  average, overall label, readiness label, "gap" count or ordering by status. Rows keep the role's
  expectation order.
- **BR-13**: The comparison is never exposed to anyone other than the owner, and no export, notification or
  aggregate is derived from it.

Development goals

- **BR-14**: From a comparison row with status `development_opportunity` or `not_assessed`, the owner may
  start "Opprett mål". This navigates to the existing D1 goal page, `/me/goals`, with that row's `treeId` as
  the only role-profile input (PG-1 and PG-11, approved 2026-10-27). The title is not prefilled and no title is
  generated from the role or the skill area; the owner types the title in the normal D1 form. Saving uses the
  existing D1 create path and its rules.
- **BR-15**: A goal created this way is an ordinary D1 goal. It stores no role identifier, role name,
  expected level, comparison result or generated title. Changing or clearing the target role later does not
  alter it.
- **BR-16**: Creating a goal is always explicit, user-initiated and one at a time. A missing or unmet
  expectation never creates a goal, assignment, notification or roadmap item.

Other surfaces

- **BR-17**: Development conversations (D2) do not read, copy, snapshot or reference target roles,
  comparisons or role definitions. D2 code and API are unchanged.
- **BR-18**: Role data never feeds team skill planning (`roadmapItems`), skill needs (`teamSkillNeeds`),
  coverage, `skillProgress`, maturity or any team view.

Missing data and compatibility

- **BR-19**: A person with no target role sees the section's empty state. The selector offers the selectable
  roles (BR-8), if any, and there is no comparison. No backfill or migration runs.
- **BR-20**: A stored target that is malformed, or whose referenced role is missing or malformed, is unusable.
  `GET /api/me/role-target` returns the neutral status `unavailable` for it (PG-3, approved 2026-10-27). That
  response carries no `roleId`, name or stored content, and the UI shows a neutral notice. The read performs no
  write. The owner can replace the target, or clear it, without any read of the malformed content.
- **BR-21**: A stored role definition that fails validation is skipped on every read (person and admin lists
  alike) and is never shown with its content. It is not repaired automatically. A by-ID request against it
  returns the same `404` as for a missing role, and admin mutations fail closed (PG-9). A document without a
  Timestamp `createdAt` is malformed.
- **BR-22** *(bounded reads, window)*: Role lists use the canonical read `orderBy createdAt ascending`, with
  document ID ascending as tie-breaker, and `limit(51)` (PG-5, approved 2026-10-27). The first 50 raw documents
  form the window. Malformed documents consume window slots and are omitted from visible results; the window
  is never refilled from later documents. The 51st document is an overflow probe: if it exists, the list
  response carries `truncated: true`. Archived documents are filtered out after windowing. Documents without a
  Timestamp `createdAt` are not returned by the ordered read; they are malformed and still count toward the
  BR-7 cap. With the cap enforced the window covers every document. Expectations per role are at most 20.
  SkillTree names are resolved only for the `treeId`s referenced by the displayed roles or comparison.
- **BR-23**: Errors and logs never contain role names, descriptions, target role identifiers, skill-area
  names, levels or the comparison.

Explicit v1 exclusions (PO-1, PO-2, PO-3, approved 2026-10-27)

- **BR-24**: v1 stores no current, primary or job-title role of any kind: no `currentRole`, `currentRoleId`,
  role family, role level or grade. The only personal role state is the optional target role of BR-7–BR-10.
- **BR-25**: No assignment of any role to a person by an admin, lead, manager or any other person. A target role
  is always self-selected by its owner.
- **BR-26**: No seeded, synthetic or fixture role data and no sample target role in the Demo Team or any other
  environment as part of this feature (PO-3).

## Edge cases and failure behavior

- Target role archived after selection: BR-5 (marked archived, no comparison, owner may change or clear).
- Expectation's SkillTree becomes unavailable: BR-11 `area_unavailable`. SkillTrees have no delete in v1
  (`docs/features/team-skill-tree/SPEC.md`, BR-5), so this is defensive only.
- Owner has C1 levels for some but not all expectation areas: remaining rows are `not_assessed`.
- Owner has no C1 profile at all: every row is `not_assessed`; no error.
- Role selected, then all its expectations removed by an admin: the role has zero expectations, so the
  comparison state is `target_unavailable` with reason `no_expectations`, and the owner sees a notice ("Rollen
  har ingen forventninger ennå"). The stored target is not changed.
- Role selected, then every expectation's SkillTree becomes unavailable: comparison state `target_unavailable`
  with reason `unavailable`. The stored target is not changed.
- Two admins edit the same role concurrently: last write wins (same as SkillTree correction).
- Concurrent target changes by the same person: last write wins; no history.
- Failed persistence: the person sees a neutral error and no partial state; the admin sees a neutral error.
- Goal-creation cap reached (D1, 100 goals): the D1 cap error applies; no role-specific handling.

## Security and privacy

Applicable `docs/SECURITY.md` invariants include 8–10, 31–36 (C1/C2) and 37–54 (D1). Feature-specific
implications:

- The **target role** is personal development intent. Treat it like a C1 level or a D1 goal: owner-only,
  verified-uid subject, server-only Admin SDK access, no uid/email/memberRef in any path, query or body.
- The **comparison** combines a person's C1 levels with a role. It is owner-only and is never stored,
  logged or aggregated. It is not a performance, readiness or ranking signal.
- **Role definitions** are org reference data. They contain no personal data. Admins must not enter person
  names in role names or descriptions; the admin form shows a short notice to that effect. `createdBy` and
  `updatedBy`/`archivedBy` are internal accountability fields and are never returned by any API.
- **New reader of `skillProfiles`.** D1 currently promises that it never reads `skillProfiles` (invariant 42,
  SI-6). This feature introduces the first new reader of C1 levels outside C1 and C2: the owner-only
  comparison. This requires (a) an amendment to the D1 statement scoped to this feature, (b) a new invariant
  stating the comparison is owner-only and derived, (c) an allow-list update in the static scope guard, and
  (d) the same review as invariants 31 and 32–36. It is not a security boundary by itself.
- **Persistence ownership (PG-12; reconciles SI-6 for both collections).** Each collection has one feature owner:
  (i) `roleDefinitions/{roleId}` is owned by role-profiles only. C2/team-skills, D1/personal-goals and D2 never read
  or write it, and the C2 guard forbids the identifier everywhere except the exact owner file(s). (ii)
  `userDevelopment/{uid}/roleTarget/current` is the role-profiles target. It sits under the D1 namespace but is owned
  by role-profiles. D1 goal documents (`userDevelopment/{uid}/goals/{goalId}`) stay owned by personal-goals;
  role-profiles has no access to goal documents, the D1 goal store or D1 routes, and D1 code does not read or write
  the target. (iii) D1 invariant 42 / SI-6 (D1 never reads `skillProfiles`) is unchanged for D1. The owner-only
  comparison reads `skillProfiles` and the target, never goals. (iv) PG-12 authorises no `collectionGroup` use
  (D1 SI-15 and invariant 51 unchanged). Client Firestore access to both collections is denied; the only rules change
  is the already approved `roleDefinitions` deny block. The D1 static guard therefore gains only the role-target file
  entry; its goal entries are unchanged.
- Admin authorization uses `requireAppAdmin` only. App-admin status never grants access to target roles or
  comparisons (invariant 31 pattern).
- No free text is stored in the target document. Role descriptions are admin-written org text and are not
  encrypted, consistent with SkillTree names (no personal data). Goal titles keep their D1 treatment.
- Residual risk to state in the notice: a person's own goal or target can reveal development intent to
  anyone who can see their screen. This is the same accepted posture as D1.
- Re-identification: target roles are per person and never aggregated, so no minimum-threshold rule applies.
  If a future feature aggregates target roles, it needs its own threshold decision.

## Architecture decisions

- **AD-1 Role definition source.** One authoritative collection `roleDefinitions/{roleId}`; `roleId` is an
  opaque, server-generated Firestore document ID. Org-wide, admin-written, readable by signed-in users
  through the server boundary. Fields in "Firestore model".
- **AD-2 Personal target source.** One document `userDevelopment/{uid}/roleTarget/current`, nested under the
  existing D1 owner namespace. The fixed document ID `current` makes "at most one target" structural. It
  stores `roleId` and `updatedAt` only. It sits under the existing `userDevelopment` deny block.
- **AD-3 Comparison is derived.** Live, per request, never persisted (BR-11–BR-13).
- **AD-4 Expectation keys reuse SkillTree identity** (`treeId`). No separate competency catalog.
- **AD-5 Expected-level scale 2–4** (BR-2), following C2's `requiredLevel` precedent so one scale is used
  for team needs and role expectations.
- **AD-6 Archive, not delete**, mirroring SkillTree and challenge handling and avoiding dangling
  selections (BR-5). Restore is included so an accidental archive is recoverable without a database edit.
- **AD-7 No index.** Role lists are a bounded ordered read (`orderBy createdAt`, `limit(51)`, BR-22). Cap
  counting is a `count()` aggregation (BR-7). No name sorting exists, so no collation rule applies. Target reads
  are a single-document `get`, or a transaction `tx.get` for selection (BR-8). No composite index is needed.
- **AD-8 No D2 change, no Demo Team change, no migration** (see the sections below).

## Firestore model

`roleDefinitions/{roleId}` — org-wide reference data (new)

| Field | Type | Notes |
|---|---|---|
| `name` | string | 1–80 chars after trim |
| `description` | string, optional | ≤500 chars, plain text |
| `expectations` | array, 0–20 | each `{ treeId: string, expectedLevel: integer 2–4 }`; `treeId` unique within the array |
| `createdAt` | Timestamp | set on create |
| `createdBy` | string (uid) | internal only; never returned |
| `updatedAt` | Timestamp, optional | set on each edit |
| `updatedBy` | string (uid), optional | internal only |
| `archivedAt` | Timestamp, optional | present ⇔ archived |
| `archivedBy` | string (uid), optional | internal only |

- Document IDs are opaque. The stored document has no `roleId` field; the ID is the identity.
- Hard delete is not offered. Malformed documents are skipped on read (BR-21). Firestore-level deletion
  remains an operator action, outside the product.
- Timestamps: `createdAt` never changes; `updatedAt` is the last edit time; `archivedAt` is set and cleared
  by archive/restore.

`userDevelopment/{uid}/roleTarget/current` — personal, owner-only (new)

| Field | Type | Notes |
|---|---|---|
| `roleId` | string | opaque ID of a `roleDefinitions` document |
| `updatedAt` | Timestamp | last selection/change |

- Clearing deletes the document (hard delete, no tombstone, no history).
- A missing document means "no target role" (BR-19). Malformed content yields the status `unavailable` (BR-20).

Derived, never stored: the comparison (BR-11–BR-12) and the list of active roles.

Indexes: none (AD-7). `firestore.indexes.json` unchanged.

Not stored anywhere: current role, role families, role levels, comparison results, coverage, counts,
selection history, person names in role data.

## API surface

All routes are App Router route handlers under `app/api/`, follow the existing JSON envelope and error
conventions, and derive the subject only from the verified token (admin routes also check `requireAppAdmin`).
Route names are the proposal; they follow the English convention of `/api/admin/skills` and `/api/me/goals`.

Role catalog (admin)

| Method | Route | Authorization | Request DTO | Response DTO |
|---|---|---|---|---|
| GET | `/api/admin/roles` | app admin | — (optional `includeArchived`, default true) | `{ roles: RoleAdminDto[], truncated: boolean }` (window of 50, BR-22) |
| POST | `/api/admin/roles` | app admin | `{ name, description?, expectations[] }` | `RoleAdminDto` (201); `409` `cap_reached` when the BR-7 count is 50 or more |
| PATCH | `/api/admin/roles/[roleId]` | app admin | `{ name?, description?, expectations? }` (replace whole array when present; at least one field required) | `RoleAdminDto`; `409` `role_archived` when archived (writes nothing); `400` for an empty body; `404` for a missing or malformed role |
| POST | `/api/admin/roles/[roleId]/archive` | app admin | `{ archived: boolean }` | `RoleAdminDto`. Idempotent: archiving an archived role, or restoring an active one, returns `200` with no change (PG-6). `404` for a missing or malformed role |

`RoleAdminDto`: `{ roleId, name, description?, expectations: [{ treeId, treeName | null, expectedLevel }], archived, createdAt, updatedAt? }`.
No uid, e-mail or `createdBy`/`updatedBy`/`archivedBy`.

Role catalog (person, read-only)

| Method | Route | Authorization | Request DTO | Response DTO |
|---|---|---|---|---|
| GET | `/api/roles` | signed-in user | — | `{ roles: RoleDto[], truncated: boolean }` (active only, from the 50-document window) |

`RoleDto`: `{ roleId, name, description?, selectable: boolean, expectations: [{ treeId, treeName | null, expectedLevel }] }`.
Allow-list per BR-6 and PG-8. `selectable` is derived per request from the SkillTree seam (BR-8, PG-2) and is `true`
only when the role is active and has at least one expectation whose SkillTree is valid and available.

Personal target role (owner)

| Method | Route | Authorization | Request DTO | Response DTO |
|---|---|---|---|---|
| GET | `/api/me/role-target` | owner (verified uid) | — | Exactly one of: `{ status: "none" }`; `{ status: "unavailable" }`; `{ status: "selected", target: { roleId, name, archived: boolean } }` (PG-3). No write. |
| PUT | `/api/me/role-target` | owner | `{ roleId }` only | `200` `{ status: "selected", target: { roleId, name, archived: boolean } }`. `400` for a malformed body or any other key. `404` `not_found` for a missing or malformed role. `409` `role_not_selectable` for an archived role, a zero-expectation role, or one with no available SkillTree (PG-2, PG-7). Writes nothing on any refusal. |
| DELETE | `/api/me/role-target` | owner | — | `204` (idempotent). Addresses the fixed document and does not read its contents, so it works on an `unavailable` target. |

Derived comparison (owner)

| Method | Route | Authorization | Request DTO | Response DTO |
|---|---|---|---|---|
| GET | `/api/me/role-comparison` | owner | — | Exactly one of: `{ state: "no_target" }`; `{ state: "target_unavailable", reason: "no_expectations" \| "unavailable" }` (no rows); `{ state: "available", target: { roleId, name }, rows: [{ treeId, treeName \| null, expectedLevel, status, ownLevel \| null }] }` (PG-4) |

- `status` ∈ `meets | development_opportunity | not_assessed | area_unavailable` (BR-11). `ownLevel` is the owner's
  own C1 level, `null` when absent or unavailable.
- `reason: "no_expectations"` means the target role is active and valid but stores zero expectations.
  `reason: "unavailable"` means the stored target is malformed, its role is missing, malformed or archived, or no
  expectation resolves to an available SkillTree. No rows are fabricated for either reason, and no raw or
  malformed role data is returned. `area_unavailable` stays a per-row status, used only when the role is
  otherwise comparable and one specific SkillTree is unavailable.
- No totals, counts or ordering by status.

Goal creation: reuses the existing D1 route (`POST /api/me/goals`) unchanged. The UI prefills the request; the
server accepts no role-specific fields.

Error semantics (all routes)

- `401` unauthenticated or invalid token.
- `403` authenticated but not an app admin (admin routes only). No person route returns 403 for ownership;
  the subject is always the token uid.
- `400` malformed body, invalid `treeId` shape, `expectedLevel` outside 2–4, duplicate `treeId`, name or
  description out of range, more than 20 expectations.
- `404` `not_found` for a role or tree that is missing on PUT or admin routes. A malformed role requested by ID
  gets the identical `404` body (PG-9): no validation detail is returned.
- `409` `role_not_selectable` on PUT for an archived, zero-expectation or no-available-SkillTree role (PG-2);
  `409` `role_archived` on admin PATCH of an archived role (PG-6); `409` `cap_reached` on admin POST at the 50-role
  cap. Every `409` body is neutral and carries no role content.
- `500` neutral persistence failure; no internal details, no role or skill content in the message.

Bounded reads: role lists read at most 51 raw documents (window 50, BR-22), expectations ≤20 per role, one `get`
for the target, one `get` for the owner's C1 document, and SkillTree lookups only for referenced IDs. Cap counting
is one `count()` aggregation (BR-7).

## Behavioral boundaries and test boundaries

| Boundary | Covers |
|---|---|
| Domain (pure): role validation, expectation validation, comparison status function | BR-2, BR-3, BR-11, BR-12, BR-21 |
| Server / API contract (route handlers with injected stores) | BR-1, BR-5–BR-10, BR-14–BR-16, BR-19–BR-23 |
| Static scope guard (collection allow-list, importer list, forbidden concepts) | BR-17, BR-18, BR-10 (change detection, not a security boundary) |
| User-visible UI (Ferdigheter section, admin roles page) | BR-6, BR-9, BR-12 (no totals), BR-14 (prefill), copy |

Prefer the API/server boundary for authorization tests (owner vs. lead vs. admin vs. unauthenticated).

## Navigation and UX

Recommended: **no new navigation item.**

- **Person:** a section *Rolleforventninger* on `/me/skills` (Ferdigheter), below the self-assessment overview.
  It shows the target-role selector (empty state: *Ingen rolle valgt*), offering selectable roles only. When a
  target is selected, it shows the comparison rows. *Opprett mål* is a link to `/me/goals?treeId=<treeId>`
  (PG-11); it does not open a form on `/me/skills`. The C1 notice is amended to say that a role comparison is
  private and optional.
  - Alternative (rejected for v1): a separate `/me/roller` page and a fourth personal nav item. It would add
    navigation for one optional feature and split the comparison from the self-assessment it depends on.
- **Admin:** one page `/admin/roles` (*Roller*), linked from the existing admin area next to *Ferdigheter* and
  *Team*. List with active/archived status; create; edit name, description and expectations (skill-area
  picker from the SkillTree catalog, level 2–4 select); archive/restore. A short notice: "Ikke registrer
  personnavn eller personlige opplysninger i rollebeskrivelser."
- **Empty states:** no active roles → "Ingen roller er lagt inn ennå." Role with no expectations → "Rollen har
  ingen forventninger ennå."

Proposed Norwegian terminology (consistent with existing *Ferdigheter*, *Mål*, *Kompetanseområde*):

| Concept | Norwegian UI text |
|---|---|
| Feature / section | *Rolleforventninger* |
| Role definition | *Rolle* |
| Target role selector | *Rolle å utvikle mot* |
| No target selected | *Ingen rolle valgt* |
| Change / clear target | *Endre rolle* / *Fjern valgt rolle* |
| Expectation level | *Forventet nivå* |
| Own level | *Ditt nivå* |
| Status: meets | *Møter forventningen* |
| Status: development opportunity | *Utviklingsmulighet* |
| Status: not assessed | *Ikke vurdert ennå* |
| Status: unavailable | *Ikke tilgjengelig* |
| Create goal from row | *Opprett mål* |
| Privacy notice | *Valgt rolle og sammenligningen er bare synlige for deg. Rollen sier noe om forventninger til en rolle, ikke om deg som person, og brukes ikke i vurdering, lønn eller tildeling av oppgaver.* |
| Archived target | *Rollen er arkivert* |
| Admin page | *Roller* |
| Admin actions | *Ny rolle*, *Rediger*, *Arkiver*, *Gjenopprett* |
| Target unusable (`unavailable`, `target_unavailable`) | *Valgt rolle kan ikke brukes til sammenligning nå.* (approved by the product owner 2026-10-28, unchanged) |
| Role cap reached (admin) | *Det er nådd maksimalt antall roller.* (draft, copy review; release follow-up, not a feature-completion gate) |

The cap-reached string is still a draft. Its copy review is a release follow-up and is not an acceptance criterion of any task.

## D1 goal integration

- A goal created from an expectation is an ordinary D1 goal (BR-14–BR-16): title (user-edited), optional
  `treeId`, optional target date, status `active`.
- No role metadata is copied (no `roleId`, role name, expected level or comparison state). This keeps the
  coupling minimal: removing a role or changing an expectation cannot change an existing goal.
- The D1 SkillTree link is sufficient; no D1 schema, API or rule change is needed.
- No automatic goal creation for gaps (BR-16).

## D2 interaction

**No D2 change in v1.** A person can already choose goals to snapshot into a conversation. Role data is not
offered as a snapshot, note or participant-visible field (BR-17). The D2 scope-guard forbidding
`roleDefinitions` remains in force. Revisit only with its own SPEC, consent design and privacy notice.

## Demo Team

**No Demo Team change in v1** (PO-3, approved 2026-10-27). This feature does not change Demo Team fixtures,
does not seed role definitions, and does not create synthetic target roles or comparisons. No seeding task
belongs in v1. Demo role data may be considered later as a separate demo-refresh scope with its own approval.

## Migration and backward compatibility

- No migration. Existing users have no `roleTarget` document, which means no target role (BR-19).
- No existing `roleDefinitions` data exists, so the catalog starts empty and the person section shows an
  empty state.
- No change to `skillProfiles`, `skillTrees`, `userDevelopment/{uid}/goals`, `teamSkillNeeds`, `roadmapItems` or
  `skillProgress`.
- Future SkillTree deletion (not in v1) would need a rule: expectations referencing the tree become
  `area_unavailable` (BR-11); no data rewrite. Recorded here so a later tree-delete design considers it.

## Firestore rules, indexes and config impact

- `firestore.rules`: add an explicit deny-only block for `roleDefinitions/{document=**}`, matching the
  repository's per-collection convention. `userDevelopment/{document=**}` already covers
  `userDevelopment/{uid}/roleTarget/current`. The final `{document=**}` deny also applies. Rules deployment
  is a separate explicit step, as for D1.
- `firestore.indexes.json`: unchanged (AD-7).
- No environment variable, dependency or runtime configuration change. Admin authorization reuses
  `APP_ADMIN_EMAILS` and `requireAppAdmin`.
- Static guard: a new `role-profiles-scope-guard.test.ts` that pins the collection allow-list
  (`roleDefinitions`, `userDevelopment/{uid}/roleTarget`), importer allow-lists (the new comparison reader of
  `skillProfiles` only), and forbidden concepts (no `teamRole`/`memberRef` reuse, no counts/percentages in
  comparison DTOs). Existing cross-feature guards stay active. Per PG-12 (2026-10-27) they may receive explicit
  file-level role-profiles allow-list entries required by the approved persistence architecture: the C2/team-skills
  guard for the exact `roleDefinitions` owner file, and the D1 guard for the exact role-target persistence file(s)
  under `userDevelopment`. Broad directory exclusions are forbidden and unrelated references must still fail. The D2
  guard is unchanged. This paragraph supersedes the earlier statements that existing guards "stay unchanged" and that
  the D1 guard needs no change (see PG-12).

## Acceptance criteria

- [ ] Only app admins can create, edit, archive or restore role definitions; lead and ordinary member get 403 on every admin route (BR-1).
- [ ] Role validation rejects: empty or >80-char name; description >500 chars; >20 expectations; duplicate `treeId`; level 1, 0, 5 or non-integer (BR-2).
- [ ] A role with zero expectations, or with no available SkillTree, cannot be selected as a target; PUT refuses with 409 `role_not_selectable`, and an archived or missing role gets 409 or 404 (BR-3, BR-8, PG-2). Refusals write nothing.
- [ ] Selection checks eligibility and writes inside one transaction that reads the role with `tx.get`; a concurrent archive cannot produce a committed selection from stale eligibility (BR-8, PG-7).
- [ ] Archived roles disappear from `GET /api/roles` and from the selector; admins still see them with `archived: true` (BR-5).
- [ ] `GET /api/roles` returns only active roles, with no uid, e-mail, `createdBy`, `updatedBy` or `archivedBy` (BR-6, API DTO).
- [ ] No role list returns more than the 50-document window, and `truncated` is set when a 51st document exists; no comparison returns more than 20 rows (BR-22).
- [ ] A person can set, change and clear their own target role; no other actor can read or write it through any route (BR-10).
- [ ] `GET /api/me/role-comparison` returns exactly one status per expectation, with `not_assessed` for missing C1 levels and `area_unavailable` for missing or invalid trees (BR-11).
- [ ] The comparison response contains no totals, counts, percentages, readiness labels or status ordering (BR-12).
- [ ] The comparison is not stored: no new Firestore document or collection is written by any comparison request (BR-12).
- [ ] "Opprett mål" navigates to `/me/goals?treeId=<treeId>` with no other parameter and no automatic POST; the saved goal contains no role identifier, role name, level or generated title (BR-14, BR-15, PG-1, PG-11).
- [ ] No automatic goal, notification or assignment is created by any role action (BR-16).
- [ ] D2 routes, DTOs and persistence are unchanged; D2 guard still passes (BR-17).
- [ ] No team skill planning, need, coverage, progress or roadmap collection is read or written by this feature (BR-18).
- [ ] A person with no `roleTarget` document sees the empty state and no error (BR-19).
- [ ] A malformed target document and a malformed role document are not rendered and do not cause a 500 (BR-20, BR-21).
- [ ] Errors and logs do not contain role names, descriptions, `roleId`s, skill names or levels (BR-23).
- [ ] `firestore.rules` contains an explicit deny-only block for `roleDefinitions`; `firestore.indexes.json` is unchanged.
- [ ] `docs/SECURITY.md`, `docs/DATA-MODEL.md`, `docs/ARCHITECTURE.md`, `docs/UI-UX.md`, `docs/ROADMAP.md`
      and `docs/PRODUCT.md` are updated when implemented: the role-expectations entries are replaced by
      this feature's as-built record, and D1's "never reads `skillProfiles`" statement is scoped.
- [ ] Admin roles page and `/me/skills` section pass a keyboard and screen-reader check (labels, `aria-describedby`, `role="alert"`).
- [ ] No current, primary or job-title role field, route, DTO or UI exists (BR-24).
- [ ] No admin, lead or manager route or UI assigns or reads any person's target role (BR-10, BR-25).
- [ ] No lead or teammate can create, propose, approve or suggest a role definition; each attempt is refused (BR-1, PO-2).
- [ ] App-admin status grants no read of any person's target role or comparison (BR-10, BR-13).
- [ ] No Demo Team fixture, seed script or synthetic target role is added or changed (BR-26, PO-3).

## Product-owner decisions

Each decision keeps its original question, options and recommendation as planning history. The product owner
approved the recommended option on 2026-10-27. That approval is a product decision. It is separate from
implementation and review, which have not started. Nothing below is an open question any more.

**PO-1 — Is a current role part of v1?** *(resolved)*

- Decision: **Option A, target role only** (approved by the product owner, 2026-10-27).
- Consequence: no current, primary or job-title role is stored, assigned or displayed. A person may optionally
  self-select one target role (BR-7–BR-10, BR-24, BR-25). Current role is future scope and needs separate
  product and privacy approval before it can be introduced.
- Status of the decision: product-owner approval only. Implementation and review are not done.

Original question and options:

Why it matters: a current role is closest to an HR job-title fact. If DevPulse stores or assigns it, DevPulse
becomes a partial system of record and invites admin or lead reading of personal job data.
- Option A (recommended): **target role only.** One optional, self-selected development target; no current
  role stored anywhere.
- Option B: self-declared current role plus self-declared target role. Both owner-only, no admin assignment.
  Adds a second selector and a "current vs target" comparison that the target-only comparison does not need.
- Option C: admin-assigned current role. Rejected by default: it makes an admin fact the basis of personal
  development views and requires a separate HR-data privacy decision.
Recommendation: **A.** Revisit B only if the product owner needs "where am I now" in the comparison.

**PO-2 — Who curates role definitions?** *(resolved)*

- Decision: **Option A, app admins only** (approved by the product owner, 2026-10-27).
- Consequence: app admins create, edit, archive and restore role definitions (BR-1, AD-6). Team leads receive
  no role-definition mutation authority. No lead proposal workflow and no open role suggestion workflow exist.
  App-admin status does not grant access to any person's target role or comparison (BR-10, BR-13).
- Status of the decision: product-owner approval only. Implementation and review are not done.

Original question and options:

Why it matters: role expectations are org-level reference data, and the curator decides what every person sees.
- Option A (recommended): **app admins only**, the same authority that curates SkillTrees. No second
  admin system.
- Option B: team leads propose roles for their team, org admins approve. More workflow; leads would shape
  expectations for their own reports.
- Option C: any signed-in person can suggest roles. Rejected by default: no moderation, no owner.
Recommendation: **A.**

**PO-3 — Seed Demo Team roles?** *(resolved)*

- Decision: **Option A, no seeding in v1** (approved by the product owner, 2026-10-27).
- Consequence: no Demo Team fixture change, no sample target role, and no seeding task in v1 (BR-26, "Demo Team").
  Demo role data may be considered later as a separate demo-refresh scope.
- Status of the decision: product-owner approval only. Implementation and review are not done.

Original question and options:

Why it matters: an empty catalog makes the feature invisible in demos; seeding changes presentation data.
- Option A (recommended): **no seeding in v1**; add a separate demo-refresh task later if the presenter needs it.
- Option B: seed two or three roles in this feature's fixtures.
- Option C: seed roles and a sample target for a demo person. Rejected: a sample target is personal data
  shaped as a demo, and comparisons would show only *Ikke vurdert ennå*.
Recommendation: **A.**

Product-owner open questions remaining: **none.**

Decisions already settled by convention (not open): owner-only comparison and target (C1/D1 precedent),
archive instead of delete (SkillTree precedent), 2–4 expected levels (C2 precedent), no index (bounded
reads), no D2 change (D2 scope), no new navigation item (smallest change).

## Planning-gap decisions (PG-1 to PG-12, product owner, 2026-10-27)

These eleven gaps were found by `/split-tasks` as implementation-blocking. The product owner decided each one on
2026-10-27. Each decision below is product-owner approval of the contract it states. It is not implementation or
review. The decisions do not reopen PO-1, PO-2 or PO-3. Each entry lists the sections it amends.

**PG-1 — "Opprett mål" title prefill.** *(resolved)*
- Decision: the prefill is `treeId` only. No title is prefilled or generated. No role name, expected level,
  comparison status or `roleId` enters the goal. The saved object is an ordinary D1 goal. Nothing is created
  automatically.
- Amends: BR-14, BR-15, "D1 goal integration", TASK-015, TASK-024.

**PG-2 — Roles with no valid available SkillTree.** *(resolved)*
- Decision: a role is selectable only when it is active and at least one expectation resolves to a valid,
  currently available SkillTree. Zero stored expectations and "expectations exist, none resolves" are both
  unselectable. A selection against either returns `409` `{ "error": "role_not_selectable" }`. The error is
  neutral and gives no reason. An unselectable role is never silently selected.
- Catalog visibility: an unselectable active role stays in `GET /api/roles` with `selectable: false`. The person
  selector offers selectable roles only. Archived and admin-visibility rules are unchanged.
- Amends: BR-8, BR-19, RoleDto, API, TASK-011, TASK-017, TASK-018, TASK-022.

**PG-3 — Malformed or missing stored target.** *(resolved)*
- Decision: a missing document means no target. A malformed document, or a referenced role that is missing or
  malformed, means the target is unusable. `GET /api/me/role-target` returns exactly one of:
  `{ "status": "none" }`, `{ "status": "unavailable" }`, or
  `{ "status": "selected", "target": { "roleId", "name", "archived": boolean } }`.
- Rules: `unavailable` carries no `roleId`, name or raw content. The GET performs no write and no automatic repair.
  It never returns `500` only because stored data is malformed. `DELETE` addresses the fixed document `current`
  without reading it, so clearing always works.
- Amends: BR-20, API, AD-2, TASK-010, TASK-018, TASK-022.

**PG-4 — Comparison when the target cannot be compared.** *(resolved)*
- Decision: `GET /api/me/role-comparison` returns exactly one of:
  `{ "state": "no_target" }`;
  `{ "state": "target_unavailable", "reason": "no_expectations" | "unavailable" }` with no rows;
  `{ "state": "available", "target": { "roleId", "name" }, "rows": [...] }`.
- `no_expectations`: the target role is active and valid with zero stored expectations.
- `unavailable`: the stored target is malformed, or its role is missing, malformed or archived, or no
  expectation resolves to an available SkillTree.
- No rows are fabricated. The whole target is never converted into `area_unavailable` rows. `area_unavailable`
  stays a per-row status for one unavailable SkillTree in an otherwise comparable role.
- Amends: BR-9, BR-11, API, edge cases, TASK-014, TASK-019, TASK-023.

**PG-5 — Role-list order, window, overflow and cap counting.** *(resolved)*
- Decision: the canonical read is `orderBy createdAt ascending`, then document ID ascending as tie-breaker, with
  `limit(51)`. The first 50 raw documents form the window. The 51st is the overflow probe and sets
  `truncated: true` in `GET /api/admin/roles` and `GET /api/roles`.
- Malformed documents consume window slots and are omitted from visible results. The window is not refilled.
  Archived documents are filtered after windowing.
- Documents without a Timestamp `createdAt` are malformed. They are not returned by the ordered read, so they are
  never shown, but they count toward the cap.
- Cap: create reads `count()` over the whole collection, which counts malformed and archived documents. A count
  of 50 or more returns `409` `cap_reached`. This follows the repository's existing `count()` precedent. The
  BR-7 concurrent overshoot is accepted.
- No name sorting exists, so no collation rule applies. No composite index is needed (single-field ordering and
  `count()` only).
- Amends: AD-7, BR-7, BR-21, BR-22, API, TASK-005, TASK-007, TASK-009.

**PG-6 — Archive, restore and edit idempotency.** *(resolved)*
- Decision: archive of an archived role is a `200` no-op that leaves `archivedAt` and `archivedBy` unchanged.
  Restore of an active role is a `200` no-op. Archive sets `archivedAt` and `archivedBy`; restore clears both.
  Archive and restore do not change `updatedAt`, because they are not edits.
- `PATCH` on an archived role returns `409` `role_archived` and writes nothing. Archived roles are read-only
  except for restore: name, description and expectations cannot change.
- `PATCH` with no fields returns `400` `invalid_input`.
- No hard delete. `createdAt` never changes.
- Amends: BR-5, API, TASK-008, TASK-021.

**PG-7 — Target selection versus concurrent archive; transaction.** *(resolved)*
- Decision: selection runs in `runTransaction`. Inside the callback it reads the authoritative role with
  `tx.get(roleDefinitions/{roleId})`, and reads the referenced SkillTrees it needs with `tx.get`. It validates
  active status and at least one valid available expectation (PG-2). Only then does it `tx.set` the fixed target
  document `{ roleId, updatedAt }`. All reads come before the write.
- A plain `get` inside the callback does not count as transactional. A concurrent archive that commits first
  fails the eligibility check or forces a retry, so no selection commits from stale pre-archive eligibility.
- Archive, restore and `PATCH` remain single-document writes. Archive never deletes an existing target (BR-5).
- Amends: BR-8, AD-2, TASK-006 (the seam accepts a transaction-bound reader), TASK-011, TASK-012.

**PG-8 — `RoleDto` identifiers.** *(resolved)*
- Decision: the public `RoleDto` allow-list is `roleId`, `name`, `description?`, `selectable`, and
  `expectations[].{treeId, treeName | null, expectedLevel}`. `roleId` and `treeId` are not personal identifiers.
- Still forbidden in any browser DTO: `createdBy`, `updatedBy`, `archivedBy`, user uid, e-mail, `memberRef` and
  any other internal audit or identity field. Persistence objects are not exposed directly.
- `RoleAdminDto` is unchanged.
- Amends: BR-6, API, TASK-009, TASK-017.

**PG-9 — By-ID malformed role.** *(resolved)*
- Decision: a malformed role requested by ID gets the same neutral `404` `{ "error": "not_found" }` as a missing
  role. This applies to admin PATCH, archive, and PUT target. No validation detail is returned.
- Admin mutations fail closed against malformed documents. No partial repair happens. No recovery operation exists
  in v1.
- Amends: BR-21, API error semantics, TASK-008, TASK-016, TASK-021.

**PG-10 — Description normalisation.** *(resolved)*
- Decision: `description` is trimmed of leading and trailing whitespace, using `String.prototype.trim` semantics.
  No Unicode normalisation is applied and no internal whitespace changes.
- Length: at most 500 Unicode code points (`Array.from(value).length`). This is the D1 goal-title counting
  convention. The name rule is unchanged except that its 1–80 limit is counted in code points too, which changes
  nothing for BMP text.
- After trimming, an empty description is absent. No empty-string description is stored, and the API DTO omits
  the field. On `PATCH`, a `description` that trims to empty clears the stored field.
- Amends: BR-2, Firestore model, TASK-001, TASK-021.

**PG-11 — Where "Opprett mål" opens the D1 form.** *(resolved)*
- Decision: "Opprett mål" is a link to `/me/goals?treeId=<treeId>`. The only query parameter is `treeId`.
- `app/me/goals/page.tsx` reads the App Router `searchParams` value (Next.js 16: async prop; confirm against
  `node_modules/next/dist/docs/` at implementation). It passes an optional initial `treeId` into `GoalsPage`,
  which opens the existing D1 create form with `treeId` preselected.
- Validation: the value is only a preselection. The existing D1 `treeId` option window (`SKILL_OPTIONS_WINDOW`)
  and "linked outside window" handling apply. A stale or invalid `treeId` gets that existing D1 handling and no
  new error path.
- Nothing is created on load. The page writes no URL state after load. `roleId`, `expectedLevel`, comparison
  status and title are never in the URL or the goal. No inline D1 form is added to `/me/skills`, and no duplicate
  D1 form exists.
- Amends: BR-14, navigation and UX, D1 goal integration, TASK-015, TASK-024.

**PG-12 — Cross-feature static guard ownership for `roleDefinitions` and `userDevelopment`.** *(resolved)*
- Discovery: found by the `implement-feature` milestone gate after TASK-009, on the first full-suite run (3 failing
  assertions out of 7893 passing). This was an implementation-time finding, not a product change. Two earlier
  planning statements were wrong: that existing guards forbidding `roleDefinitions` stay completely unchanged, and
  that the D1 guard needs no change (TASK-013). The C2/team-skills scan forbids the literal `roleDefinitions` across
  production source, and the D1 scan restricts the literal `userDevelopment` to an approved file list. The persistence
  architecture is not in question.
- Decision (Option A, approved 2026-10-27): `roleDefinitions/{roleId}` and `userDevelopment/{uid}/roleTarget/current`
  stay as approved. Existing cross-feature static guards stay active. They may receive explicit file-level
  role-profiles allow-list entries, each for one concrete file that genuinely needs the identifier.
- C2/team-skills guard: exact file entries only. The only production file that needs the literal `roleDefinitions`
  as code is `src/features/role-profiles/server/role-store.ts` (the collection name). Comment-only mentions in
  `domain/role-definition.ts` and `server/role-store-types.ts` are not owners; they are reworded, not allow-listed.
  Any further production owner needs its own narrow amendment with repository evidence.
- D1/personal-goals guard: explicit entries for role-target persistence only. The expected file is
  `src/features/role-profiles/server/role-target-store.ts` (the TASK-010 surface). It is added once the file exists,
  and only if it names the identifier. Its test file gets an entry only if inspection shows it names the identifier.
  The role-profiles static guard test (`src/features/role-profiles/role-profiles-scope-guard.test.ts`) names
  `userDevelopment` as its pinned allow-list; it is a test-only pin entry and grants no runtime access. No other
  role-profiles file gets an entry. The entry is not ownership of D1 goal storage, the D1 goal store, D1 goal routes
  or goal DTOs.
- `collectionGroup`: PG-12 authorises no production `collectionGroup` use. D1 SI-15 and its static scan stay as they
  are, with no role-profiles exception. The role-profiles guard test spells the forbidden token as the pattern
  `collection\s*Group`, so its own text does not trigger the D1 scan. This is a test-text technique only.
- Non-goals: no broad feature-directory exclusion for any guard; unrelated references must still fail; no runtime
  authorization, privacy, API, client-rule (beyond the approved `roleDefinitions` deny block), D2 or D1 goal change;
  no collection rename; no new product behaviour.
- Supersedes: the statements "existing guards that forbid `roleDefinitions` … stay unchanged" (section "Firestore
  rules, indexes and config impact") and "D1 guard: no change" (TASK-013). Both are corrected in place by dated text
  above; the historical record is kept in this entry.
- Amends: "Firestore rules, indexes and config impact", "Security and privacy" (persistence ownership), the static
  guard requirement, TASK-003, TASK-005, TASK-010, TASK-013, TASK-027, TASK-029, TASK-031 and the TASKS.md gap index.

## Open questions

None (product). PG-1 to PG-12 are resolved above. Implementation-level details follow repository conventions and
are recorded in the sections above.

## Planning-update record (2026-10-27)

- Recorded PO-1, PO-2 and PO-3 as product-owner decisions above, with original questions, options and
  recommendations preserved.
- Reconciled the SPEC against the approved decisions:
  - Status changed from Draft to Approved (product planning). Implementation and review are explicitly not approved.
  - Out-of-scope list now names the lead/teammate proposal workflow, performance assessment, manager ratings,
    ranking, readiness/promotion scoring, automatic goal creation, D2 sharing and HRIS/job-title integration.
  - Key concepts and actor rules state that the target role is not HR data and that leads have no role-definition
    authority.
  - BR-1 states the admin-only mutation rule and that app-admin status grants no personal access.
  - BR-24–BR-26 add explicit exclusions: no current role, no admin/lead assignment, no Demo seeding.
  - Demo Team section no longer depends on PO-3.
- Recorded PG-1 to PG-11 as product-owner decisions (section "Planning-gap decisions"), with the amended BR, API,
  DTO, persistence, concurrency and UI wording. Removed the conflicts they resolved: the BR-14 title prefill, the
  `{ target: null }` shapes, the comparison DTO without a state, the unordered sort-by-name, and the non-transactional
  selection read.
- Scope: this SPEC and `TASKS.md` only. No code, tests, rules, indexes, package files, fixtures, other docs or commits.

## Planning-update record (PG-12, 2026-10-27)

- Recorded PG-12 (Option A) with the discovery context, the C2 and D1 file-level policy, the `collectionGroup`
  distinction, the persistence-ownership reconciliation of SI-6 and the superseded statements.
- Corrected the static-guard statement and the TASK-013 D1 statement by dated text, not by rewriting history.
- Scope: this SPEC and `TASKS.md` only. No guard, source, test, rules file, Firebase access, commit or deploy.

## Decision record: C1 privacy notice amendment (2026-10-28)

- **Decision (product/privacy owner, approved 2026-10-28):** keep the Navigation and UX requirement that the C1 privacy notice is amended for role-profiles. The notice is not replaced by the role-profiles notice alone.
- **Approved Norwegian text (C1 notice amendment):** "Dine ferdighetsvurderinger er private. De kan brukes til en valgfri sammenligning med din egen valgte målrolle. Sammenligningen er bare synlig for deg."
- **Meaning:** self-assessments stay private; the comparison is optional and based on the person's own target role; it is owner-only; it grants no access to a lead, teammate, app admin or anyone else; no sharing behaviour, manager, performance or surveillance semantics are introduced; D2 is unchanged.
- **Placement and scope:** the approved text is a separate notice shown directly after the unchanged C1 `privacyNotice` (C2 BR-29 still pins that text). No other C1 copy changes.
- **Guard decision:** the C1 anti-surveillance scan (BR-22) exempts only that exact value. Other comparison, manager, performance or surveillance wording still fails. No directory- or pattern-level exception.
- **Feature state:** TASK-022 carries the implementation. Its independent review passed, and it was closed after the copy approval below.

## Decision record: copy approval (2026-10-28)

- **Decision (product owner, approved 2026-10-28):** the `unavailable` string "Valgt rolle kan ikke brukes til sammenligning nå." (`src/features/role-profiles/copy.ts`, SPEC terminology table) is approved exactly as implemented. No wording change.
- **Basis:** TASK-022's acceptance criterion "Every state listed in the SPEC renders with approved Norwegian copy."
- **Not covered:** the admin cap-reached string "Det er nådd maksimalt antall roller." remains a draft. It has no approved-copy acceptance criterion and is a release follow-up.

## Documentation impact (for implementation, not this planning step)

- `docs/ROADMAP.md`: replace the unscheduled "Role expectations" entry with this feature's entry.
- `docs/PRODUCT.md`, `docs/DATA-MODEL.md`: replace the `roleDefinitions` "does not exist yet" text;
  add `roleDefinitions` and `userDevelopment/{uid}/roleTarget/current`.
- `docs/ARCHITECTURE.md`: add the feature section; amend the D1 statement that D1 never reads `skillProfiles`
  as scoped to this feature.
- `docs/SECURITY.md`: add invariants for owner-only target and comparison, no admin/lead access, the
  new `skillProfiles` reader, and the PG-12 persistence-ownership invariant (`roleDefinitions` owner;
  role-target owner inside `userDevelopment`; no D1 goal access; no `collectionGroup`).
- `docs/UI-UX.md`: add the Rolleforventninger section and the admin roles page.
- `docs/features/personal-development-goals/SPEC.md`: dated pointer only; its history is not rewritten.

## Next step

Product planning remains approved (2026-10-27). PO-1, PO-2, PO-3 and PG-1 to PG-12 are resolved. `TASKS.md` keeps its
31-task split. TASK-001 through TASK-009 are Done. Implementation may resume under `/implement-feature role-profiles`
with the PG-12 guard remediation sequence recorded in `TASKS.md`, then TASK-010.
