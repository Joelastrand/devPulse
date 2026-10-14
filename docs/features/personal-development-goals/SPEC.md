# Personal development goals (D1)

## Status

Product-owner decisions D1-P1 … D1-P19 approved 2026-10-11. Clarifications
CL-1 and CL-2 approved 2026-10-11 and incorporated normatively (BR-25,
BR-36a…BR-36e, BR-26, BR-33, BR-56). Open question OQ-1 (owner reachability of
malformed/overflow goals) resolved 2026-10-11 by product-owner option (a)
plus a technical query design (BR-57…BR-63). No open product decisions
remain. **Implemented** (closed out 2026-10-14; TASK-001–018 Done): owner-only private goals, simple `active`/`completed` lifecycle, optional SkillTree link and target date; no D2 features (check-ins, sharing), role profiles or role expectations. Requirements below are the approved text and are unchanged.

## Label resolution (D1/D2) — dated amendment, 2026-10-11

The repository used "D1/D2" ambiguously:

- `docs/ROADMAP.md` (Team & Personal Development initiative, "D1/D2 — Role
  expectations") and `docs/PRODUCT.md` / `docs/DATA-MODEL.md` associated D1/D2
  with `roleDefinitions` and role expectations.
- The C1 and C2 planning associated D1/D2 with goals, progress and
  check-ins.

The product-owner decision of 2026-10-11 resolves this:

| Label | Meaning |
|---|---|
| **D1** | Person-owned development goals (this feature), `/me/goals`, and the minimum personal navigation supporting `/me/skills` + `/me/goals` |
| **D2** | Check-ins / conversations, any two-party development interaction, any sharing with leads or mentors, `Samtaler` navigation |
| Role expectations | A **separate future feature, currently unscheduled**: `roleDefinitions`, current/target professional role, role-profile administration, manager development views, organisation development analytics. It is **neither implemented nor cancelled.** |

Historical statements in the F0, C1 and C2 specs and in the ROADMAP/PRODUCT
text remain historically accurate and are **not** rewritten; they are
reconciled by dated pointers at D1 closeout (see "Documentation impact").

## Problem

C1 lets a person self-assess skills, but there is nowhere to record what they
actually intend to work on. People who want to grow have no private place in
DevPulse to write down a handful of development goals and mark them done.
Adding such a place must not create a lead/admin view, a score, or a
surveillance surface over individuals.

## User outcome

A signed-in person can keep a short, private list of their own development
goals — optionally tied to a skill area — mark them complete or reopen them,
and delete them. Nobody else, in any role, can see or influence them. Personal
development navigation (`Ferdigheter · Mål`) ties the two personal pages
together.

## Scope

- Person-owned goals at `/me/goals`: create, list, edit, complete, reopen,
  permanently delete.
- Optional relation of a goal to one existing SkillTree (development topic
  only).
- Optional `Måldato` (personal planning aid).
- Status-based progress only (`active` / `completed` + `completedAt`).
- Server-mediated persistence at `userDevelopment/{uid}/goals/{goalId}`.
- API: `GET/POST /api/me/goals`, `PATCH/DELETE /api/me/goals/[goalId]`.
- Personal navigation: global header entry `Min utvikling`; shared page-level
  nav `Ferdigheter · Mål` on `/me/skills` and `/me/goals`.
- Deny-only Firestore rule for `userDevelopment/{document=**}`.
- D1 static scope guard.

## Out of scope

Non-goals (each is a deliberate exclusion, not a deferral promise):

D2 check-ins; conversations; sharing of any kind (per goal or whole plan);
mentors; lead/admin goal access; manager development views; manager-authored
goals; manager-private notes; performance reviews; employee ranking; employee
scoring; compensation/promotion use; `roleDefinitions`; role expectations;
current/target professional roles; role-profile administration; numeric
progress (percentage, score, on-track); target skill levels; automatic skill
inference; automatic goal generation; roadmap integration; challenge
integration; `teamSkillNeeds` integration; `skillProgress` integration;
notifications; assignments; organisation analytics; journal/progress entries;
descriptions/notes; attachments/evidence; AI coaching/recommendations;
**account-erasure implementation**; archive state; Demo Team fixtures; a `/me`
index route; `Samtaler` or role navigation entries or placeholders.

## Key concepts

- **Goal** — one document under `userDevelopment/{uid}/goals/{goalId}`.
- **Owner** — the Firebase uid of the verified ID token. The only subject.
- **Status** — `active` or `completed`. The only progress representation.
- **Area** — an existing SkillTree referenced by an optional `treeId`;
  meaning is *development topic* only.
- **Raw window** — the first `GOAL_READ_WINDOW + 1 = 101` documents the list
  query returns; see BR-30…BR-35.
- **Goal cap** — `GOAL_LIMIT = 100` goals per owner (business/abuse bound).
- **Recovery item** — `{ goalId }` for an owner document that cannot be shown as
  a goal; delete-only (BR-57…BR-63).
- **Recovery scan** — a second bounded, id-ordered, projection-only owner query
  that finds documents the createdAt-ordered list query cannot return (BR-58).

Constants (code constants, never configurable by request, setting or env var):
`GOAL_LIMIT = 100`, `GOAL_READ_WINDOW = 100`, `GOAL_TITLE_MIN = 1`,
`GOAL_TITLE_MAX = 100`, `GOAL_BODY_MAX_BYTES = 4096`.

## Repository findings (verified 2026-10-11)

1. `docs/SECURITY.md` invariants 31–36 govern C1/C2; invariant 31 is the
   owner-only precedent. D1 adds new proposed invariants (below) and must not
   weaken 1–36.
2. `normalizeDisplayName` (`src/features/profiles/domain/display-name.ts`):
   NFC → trim → reject `[\p{C}\p{Zl}\p{Zp}]` → collapse `\s+` → code-point
   length → require `[\p{L}\p{N}]`. Its bounds (2–50) are profile-specific.
3. `isValidPlanDate` (`src/features/roadmap/domain/roadmap-dates.ts`):
   `YYYY-MM-DD`, real calendar date, year 2020–2100.
4. The bounded-count precedent is `create-reply.ts`: a Firestore
   `.count()` aggregation read before the write, a cap compare, no
   transaction-enforced lock (`thread_full`).
5. The raw-window precedent is `readSkillCatalog`: `limit(window + 1)`, invalid
   window documents are dropped and keep their slot, no refill,
   `truncated = raw.length > window`.
6. `isValidSkillTree` (`src/features/skill-trees/domain/skill-tree.ts`) is the
   existing validity rule for catalog documents; the C1 catalog seam
   (`skill-profiles/server/skill-catalog.ts`) deliberately duplicates the
   candidate-mapping rather than sharing it. D1 follows this C2/C1 pattern.
7. **Every existing collection is a top-level collection.**
   `userDevelopment/{uid}/goals/{goalId}` is the repository's **first
   subcollection**. It is a new pattern, not an existing convention (see
   AD-1).
8. Existing owner routes (`app/api/me/skills`) are thin: bearer token →
   `verifyIdToken` → server module; no uid in path/query/body; `Authorization:
   Bearer`; stable error-code JSON.
9. `SiteHeader` marks the active link by **exact** `pathname === href`; the
   header currently has `Min profil` (`/me/profile`) and `Mine ferdigheter`
   (`/me/skills`). No page-level personal nav exists.
10. No member-facing SkillTree catalog endpoint exists (see CL-1).
11. `firestore.indexes.json` needs no entry for D1 (single-field order only).

## Actors and access (authorization matrix)

Goal authorization has exactly one input: **the verified-token uid equals the
`{uid}` path segment.** `authorizeTeamAccess`, `resolveTeamRole` and
`isAppAdmin`/`requireAppAdmin` are never consulted. No API accepts another
subject's uid.

| Actor | Create | Read | Edit / complete / reopen | Delete |
|---|---|---|---|---|
| Owner (any account state with a valid token) | Yes | Yes | Yes | Yes |
| Teammate (same team) | No | No | No | No |
| Team lead of the owner's team | No | No | No | No |
| Lead who is also app admin | No | No | No | No |
| App admin, non-member | No | No | No | No |
| Former member of the owner's team | No | No | No | No |
| Unrelated authenticated user | No | No | No | No |
| Unauthenticated | `401` | `401` | `401` | `401` |

"No" for a non-owner is **structural**: a non-owner has no endpoint that can
name the owner. A non-owner calling any D1 route only ever addresses their
*own* subtree. Joining, leaving or rejoining a team has no effect on goals.

## User stories

1. As a signed-in person, I want to record a development goal with a short
   title so that I remember what I want to work on.
2. As a person, I want to optionally link a goal to a skill area so that I can
   relate it to the competency catalog.
3. As a person, I want to optionally set a *Måldato* so that I can plan for
   myself without any deadline being tracked.
4. As a person, I want to mark a goal completed and reopen it so that my list
   reflects reality.
5. As a person, I want to edit a goal's title, area and date.
6. As a person, I want to permanently delete a goal I no longer want.
7. As a person, I want assurance that my teammates and leads get no goal
   access through DevPulse, and a reminder not to put confidential
   information in a title.
8. As a person, I want to move between `Ferdigheter` and `Mål` with a clear
   personal navigation.

## Behavioral requirements

### Ownership and access

- **BR-1** The subject of every goal operation is the uid of the verified ID
  token. No path segment, query parameter, header or body field selects
  another subject; a request body containing `uid`, `ownerUid`, `teamId`,
  `memberRef`, `email` or any non-allow-listed key is rejected (BR-22).
- **BR-2** A goal is readable and writable only by its owner. No other actor in
  the authorization matrix has any access.
- **BR-3** Goal authorization never calls `authorizeTeamAccess`,
  `resolveTeamRole`, `isAppAdmin` or `requireAppAdmin`, and never reads
  `teams`, `teamMemberships`, `teamInvitations` or `teamAccessRequests`.
- **BR-4** There is no sharing, consent record, team-scoped visibility, lead
  reader, admin reader, teammate reader, per-goal or whole-plan share. Team
  membership (joining, leaving, rejoining, role) has no effect on goals.
- **BR-5** Unauthenticated, malformed-token or unverifiable-token requests get
  `401 unauthenticated` from every route and read nothing.

### Domain model

- **BR-6** A valid persisted goal contains **exactly** these fields and no
  others: `title`, `status`, `createdAt`, `updatedAt`, optional `treeId`,
  optional `targetDate`, and `completedAt` **iff** `status == "completed"`.
- **BR-7** The following are never persisted: `uid`, `ownerUid`, e-mail,
  `displayName`, `teamId`, `memberRef`, any lead/admin actor, score, rank,
  percentage, C1 level, target skill level, `areaName`/tree name, role,
  sharing/consent, notes, description, journal, history, `schemaVersion`.
- **BR-8** `title` is the **only** user-authored free text. D1 has no
  description, notes, journal, evidence or attachments.
- **BR-9** Title normalisation (single canonical contract, applied on create
  and on any title change): NFC → trim (edges) → reject any code point in
  `[\p{C}\p{Zl}\p{Zp}]` (control, format, private-use, surrogate, unassigned,
  line/paragraph separators) → collapse inner whitespace runs (`\s+`) to one
  space → length 1–100 **Unicode code points** (`Array.from`, not UTF-16 units)
  → at least one `[\p{L}\p{N}]`. The normalised value is what is stored and
  echoed. Non-string input is invalid. An inner newline/tab is *rejected*, not
  turned into a space (same order as `normalizeDisplayName`).
- **BR-10** The title normaliser is implemented as a **goal-domain-local
  function** with the documented contract of BR-9 and a **parity test** against
  `normalizeDisplayName` over a shared fixture table (differing only in length
  bounds). Goal domain code does not import from `src/features/profiles/`.
  (D1-P19; extracting a shared primitive is permitted only if a later review
  justifies it, and is not required by D1.)
- **BR-11** A title is inert text: rendered as React text content only, never
  via `dangerouslySetInnerHTML`, never interpreted as HTML or Markdown, never
  auto-linked.
- **BR-12** `targetDate` is optional, a plain `YYYY-MM-DD` string validated
  with the same rule as `isValidPlanDate` (real calendar date, year 2020–2100),
  implemented goal-locally with a parity test (same no-cross-feature-import
  rationale as BR-10). Past dates are accepted. A future date is not required.
  No overdue state, styling, warning, sort or deadline interpretation exists.
  UI label: `Måldato`.
- **BR-13** `treeId` is optional. When present it is a non-empty string that
  was, at the time it was set, the id of a valid SkillTree. It means
  *development topic* only (not target level, role expectation, team
  requirement, `teamSkillNeeds`/roadmap relation or performance expectation).
- **BR-14 Timestamp semantics.** Timestamps are *application-clock* instants
  from the injected server clock (AD-6), **not** `FieldValue.serverTimestamp()`
  sentinels: the server module reads the clock once per operation (inside the
  PATCH transaction callback, so a retry re-reads it), converts it to a
  `Date`, and the Admin SDK persists it as a Firestore `Timestamp`
  (millisecond precision is sufficient). A client can never supply
  `createdAt`, `updatedAt` or `completedAt`. On create `createdAt` and
  `updatedAt` are the same instant. `updatedAt` changes only when a real write
  happens (BR-16…BR-18). `createdAt` is never changed. The DTO serialises each
  timestamp as `date.toISOString()` (UTC, millisecond, `Z`). A stored value
  that is not a `Timestamp`/`Date` (string, number, null, missing) is
  malformed (BR-35).

### Lifecycle

- **BR-15 Create** — status `active`, `completedAt` absent, `createdAt ==
  updatedAt == now`. `goalId` is an opaque, server-generated random Firestore
  auto-ID; a client never chooses it.
- **BR-16 Complete** — `active → completed` sets `completedAt = now` and
  `updatedAt = now` (subject to BR-64). Completing an already-completed goal is a **no-op**: no
  write, `completedAt` preserved, `updatedAt` unchanged, success response.
- **BR-17 Reopen** — `completed → active` removes `completedAt` and sets
  `updatedAt = now` (subject to BR-64). Reopening an already-active goal is a **no-op**.
- **BR-18 Edit** — a PATCH changes only the supplied fields. If the resulting
  document is identical to the stored one, no write occurs and the current DTO
  is returned (`updatedAt` unchanged). Otherwise `updatedAt = now` (subject to
  BR-64). A title or
  date edit on a completed goal preserves `completedAt`.
- **BR-64 Clock-regression rule.** The lifecycle domain helper evaluates a
  change in this order: (1) determine the resulting document; (2) if it is
  semantically identical to the stored goal (BR-16…BR-18 no-op, including a
  title that normalises to the stored title), return the no-op result
  (`changed: false`, goal, `updatedAt` and `completedAt` untouched) **whatever
  the supplied `now` is** — no timestamp is written, so clock order is
  irrelevant; (3) otherwise, if `now < goal.createdAt`, the whole change is
  **rejected atomically** with the stable, content-free domain failure
  `clock_regressed`: no field is applied, `updatedAt` and `completedAt` are not
  set, the original goal is untouched, no timestamp is clamped
  (`max(createdAt, now)` is not used) or manufactured; (4) otherwise (`now >=
  createdAt`, equality allowed) the changed goal is built with `updatedAt = now`
  (and `completedAt = now` on completion). Every successfully changed goal is
  therefore readable under BR-35 (`updatedAt >= createdAt`, `completedAt >=
  createdAt`), which is not weakened. No global clock monotonicity is assumed
  and a new goal is never compared with another request's timestamp (create,
  BR-15, uses one `now` for both timestamps). The failure carries no title, raw
  field or goal content. The operation/API mapping of `clock_regressed` is
  defined by the PATCH operation task, not by the domain.
- **BR-19 Delete** — permanent hard delete, no tombstone, no archive. Deleting
  frees cap capacity. The UI requires explicit confirmation (BR-52).
- **BR-20** There is no archive state in D1; one may be added later as an
  additive feature.
- **BR-21 Status-only progress** — no percentage, progress/on-track score,
  derived progress, self-assessment delta, skill history, target-level delta
  or journal/progress entry exists anywhere (storage, DTO, UI).

### API contract

All routes live under `app/api/me/goals/`, use `Authorization: Bearer
<idToken>` (same extraction as `app/api/me/skills`), are thin, and delegate to
server modules. Every success **and** error response carries `Cache-Control:
no-store`.

| Route | Purpose | Success |
|---|---|---|
| `GET /api/me/goals` | List own goals + skill options | `200` |
| `POST /api/me/goals` | Create | `201` + DTO |
| `PATCH /api/me/goals/[goalId]` | Edit / complete / reopen | `200` + DTO |
| `DELETE /api/me/goals/[goalId]` | Delete | `200 {ok:true}` |

No action routes (`/complete`, `/reopen`) exist. Methods other than the above
on these paths return `405` (framework default).

- **BR-22 Strict request allow-lists.** `POST` body keys ⊆ `{title, treeId,
  targetDate}` with `title` required. `PATCH` body keys ⊆ `{title, treeId,
  targetDate, status}`, at least one key required. `treeId` / `targetDate` in
  `PATCH` accept a string to set or `null` to remove; in `POST`, absent (or
  `null`, treated as absent) means none. `status` accepts exactly `"active"`
  or `"completed"`. Any unknown key, a non-object body, invalid JSON, an empty
  `PATCH`, a wrongly typed value, or a body over `GOAL_BODY_MAX_BYTES` (4096)
  returns `400`. `DELETE` and `GET` never read a body. `Content-Type` is not
  relied upon: the body is read as text and parsed as JSON, and the size cap is
  enforced on the bytes actually read (not only on `Content-Length`).
- **BR-23 Error semantics.**

  | Status | `error` | When |
  |---|---|---|
  | 400 | `invalid_request` | non-JSON, non-object, unknown key, empty PATCH, wrong type, oversize body, invalid `status` value |
  | 400 | `invalid_title` | BR-9 violated (create, or PATCH with `title`) |
  | 400 | `invalid_target_date` | BR-12 violated |
  | 401 | `unauthenticated` | BR-5 |
  | 404 | `goal_not_found` | PATCH on a missing, foreign-structure, shape-invalid or **unreadable (malformed)** goal id |
  | 404 | `skill_not_found` | create / **changed** `treeId` that is unknown or invalid (BR-38) |
  | 409 | `goal_limit` | create when current count ≥ 100 (BR-34) |
  | 500 | `persistence_failed` | any storage failure; no partial result. On `PATCH` it can also follow a committed write whose response-area read failed (BR-40); an identical retry is a no-op |
  | 500 | `clock_regressed` | `PATCH` rejected by BR-64 (server clock earlier than `createdAt`); nothing written, content-free |

  Validation order: authenticate → body shape/allow-list → field validity
  (title, date, status) → goal existence (PATCH) → SkillTree check → cap
  (POST) → write.
- **BR-24 DTO (explicit construction, field by field — never a spread of a
  stored document).** A goal DTO is exactly:
  `{ id, title, status, treeId: string|null, areaName: string|null,
  areaAvailable: boolean, targetDate: string|null, createdAt, updatedAt,
  completedAt: string|null }`, timestamps as ISO-8601 strings. When `treeId` is
  `null`, `areaName` is `null` and `areaAvailable` is `true` (nothing is
  unavailable). No `uid`, team field, C1 level, actor, e-mail or display name
  is ever returned.
- **BR-25 `GET` response** (canonical envelope, exactly these five keys):
  `{ goals: GoalDto[], recoveryItems: GoalRecoveryDto[], truncated: boolean,
  skillOptions: { treeId, name }[], skillOptionsTruncated: boolean }`. `goals`
  holds only valid goals (BR-24); `recoveryItems` holds only delete-only
  recovery items (BR-57) and is never mixed into `goals`; see CL-1 for
  `skillOptions`. No separate endpoint for malformed documents exists.
- **BR-26 `DELETE` is idempotent.** A missing, never-existing, shape-invalid or
  foreign goal id (structurally missing under the caller's path) returns the
  identical `200 {ok:true}`. A malformed stored document owned by the caller is
  deleted (delete never validates content).
- **BR-27a Goal-id shape.** A path `goalId` is *shape-valid* only if **both**
  hold: it matches `^[A-Za-z0-9_-]{1,128}$`, **and** it does not match the
  reserved form `^__.*__$` (ids Firestore reserves, e.g. `__x__`, `__foo__`; `_`,
  `-` and `_a` remain valid). Both conditions form the addressability rule
  (BR-63). A shape-invalid id is treated exactly as a missing
  one (PATCH `404 goal_not_found`, DELETE `200 {ok:true}`) **without any
  Firestore access**, so `/`, `.`/`..`, `__x__` and oversized ids never reach
  the SDK.
- **BR-27** Foreign and missing goal ids are indistinguishable: `PATCH` returns
  the same `404 goal_not_found` with the same body and headers; `DELETE`
  returns the same success. No timing- or message-based difference is
  specified or relied on.
- **BR-28** Error bodies contain only `{ error }` (a stable code). Titles, ids,
  tree names and stored content never appear in error bodies.
- **BR-29** `PATCH` runs read-validate-write inside one Firestore transaction on
  the single goal document, so a status transition and its `completedAt` are
  atomic and a concurrent complete/reopen cannot produce a document violating
  BR-6. Two concurrent edits of *different* fields both apply (only supplied
  fields are written); the same field is last-write-wins (accepted).

### List semantics, read window and malformed documents

- **BR-30 Query.** The list query is exactly `collection("userDevelopment")
  .doc(ownerUid).collection("goals").orderBy("createdAt", "desc").limit(101)`
  via the Admin SDK. Single-field order only: **no composite index**. Firestore
  appends an implicit `__name__` ordering in the **same direction as the last
  `orderBy` (descending)**, so equal-`createdAt` documents are cut at the
  window boundary by document id **descending**; that is the deterministic
  window-membership rule. The in-memory order of BR-31 (id ascending among
  ties) is a *presentation* order applied after the cut and never changes
  window membership. A document whose `createdAt` field is absent is **not
  returned by this query at all** (it occupies no raw slot of *this* query) but
  is still counted by BR-34 and is discovered by the separate recovery scan
  (BR-58); a `createdAt` of a non-timestamp type is returned (Firestore orders
  by type), is not a `GoalDto`, and becomes a recovery item (BR-35, BR-59).
- **BR-31 Response order** (in memory, after validation): `createdAt`
  descending, then `id` ascending. Status does not affect server order; the UI
  may group completed goals (BR-48) preserving this order. No sort by
  `targetDate`, proximity or status.
- **BR-32 Window.** The first 100 raw documents form the candidate window; a
  101st document is only a truncation probe and is never returned.
  `truncated = listRawCount > 100 || scanRawCount > 100`, where `listRawCount`
  is the number of documents the BR-30 query returned (max 101) and
  `scanRawCount` the number the BR-58 scan returned (max 101), valid or not.
  Five quantities are distinct: *raw count* (per-query result size, ≤ 101),
  *returned count* (valid `GoalDto`s, ≤ 100, may be lower), *recoveryItems
  count* (≤ 200, BR-59), the *business cap* (BR-34, 100, measured by `count()`
  over **all** documents) and *defensive overflow* (`truncated`, raw > 100 in
  either bounded read).
- **BR-33 Malformed documents.** A raw document that fails the readability
  contract (BR-35) is **never a `GoalDto`**, is reported only as a delete-only
  recovery item (BR-57, BR-59) and **keeps its raw-window slot**. There is **no
  refill** past the raw window. A malformed document is never repaired,
  rewritten, normalised, logged by content, or exposed with any content.
  Consequently a window with malformed documents may return fewer than 100
  goals, and `truncated` reflects raw overflow, not valid overflow. The
  per-operation behavior for malformed data is fixed once in BR-56.
- **BR-34 Goal cap.** Create counts the owner's current goals with a Firestore
  `.count()` aggregation on the owner's `goals` subcollection (the `create-reply`
  precedent) *before* writing; `count >= 100` → `409 goal_limit` and no write.
  The count includes malformed documents and documents lacking `createdAt`
  (it counts every document in the subcollection); a `count()` failure → `500
  persistence_failed`, no write. Deleting a
  goal (or recovery item) frees capacity; the owner always has a UI path to
  delete a counted document (BR-60). **The cap is a pragmatic business/abuse bound, not a
  security boundary and not a strict transactional invariant**: concurrent
  creates may overshoot it by a small amount; no counter document, query lock or
  transaction-enforced count is introduced. Unexpected overflow is surfaced to
  the user through `truncated` (BR-32).
- **BR-35 Readability contract** (applied to every stored document on list and
  on PATCH; the document is *readable* only if **all** hold):
  1. data is a plain object; keys ⊆ `{title, status, createdAt, updatedAt,
     treeId, targetDate, completedAt}` — **any unknown persisted key makes the
     document unreadable** (fail closed; a stored unknown key never reaches a
     `GoalDto` because the DTO is built field by field and the document
     becomes a content-free recovery item, BR-57);
  2. `title` is a string that is **already in normalised form**: BR-9 applied to
     it returns the identical string;
  3. `status` is exactly `"active"` or `"completed"`;
  4. `createdAt` and `updatedAt` are valid timestamps (Date/Timestamp) and
     `updatedAt >= createdAt`;
  5. `completedAt` is present **iff** `status == "completed"`, and when present
     is a valid timestamp `>= createdAt`;
  6. `treeId`, if present, is a non-empty string (an unavailable tree is *not*
     a readability failure — BR-39); an empty string or non-string makes the
     document unreadable;
  7. `targetDate`, if present, satisfies BR-12.

  A raw `null` for an optional key is treated as unreadable (writers use field
  deletion, never `null`).

### SkillTree dependency

- **BR-36** D1 may read SkillTree catalog documents **only** to (a) validate a
  new or changed `treeId` and (b) resolve the human-readable area name of
  stored `treeId`s (and, per CL-1, to list valid options). D1 **never writes**
  SkillTree data.
- **BR-37** The catalog access is a **D1-local seam**
  (`src/features/personal-goals/server/…`), following the C1/C2 practice of
  duplicating the narrow candidate-mapping rather than sharing. It uses
  `isValidSkillTree` for validity. D1 does not import any module from
  `src/features/skill-profiles/`.
- **BR-38** On create, or on a PATCH that **changes** `treeId` to a different
  non-null value, the tree is read by document id; unknown or invalid →
  `404 skill_not_found`, no write.
- **BR-39** On list, distinct stored `treeId`s are gathered and resolved in **one
  bounded batch** (document-id `getAll`, chunked at the repository precedent
  size; ≤ 100 distinct ids because of the cap) — no N+1 reads. A stored
  `treeId` that is missing or invalid yields DTO `areaName: null,
  areaAvailable: false`; the goal is **not** deleted, mutated or repaired, and
  is still returned.
- **BR-40** Re-saving a goal **without changing** `treeId` (including a title,
  date or status PATCH, or a PATCH repeating the same `treeId`) never performs
  the BR-38 check and therefore never fails because its referenced tree later
  became unavailable. Setting `treeId: null` removes the relation and always
  succeeds. The catalog read for a status-only PATCH response uses BR-39
  semantics.
- **BR-41** A SkillTree read failure on list (options or name resolution)
  yields `500 persistence_failed` (no partial result), consistent with C1.
- **BR-36a Catalog contract — selector DTO (CL-1, approved).** The catalog
  option DTO is exactly `{ treeId: string, name: string }`, built field by
  field. `treeId` is the document id; `name` is the validated tree `name`. No
  node data, `createdBy`/`updatedBy`, timestamps, C1 level, team maturity,
  `teamSkillNeeds`, roadmap state or membership data is returned, and the
  catalog path reads nothing but `skillTrees` documents. SkillTree data is
  reference data only. No separate selector endpoint exists: options are
  returned by `GET /api/me/goals` (BR-25).
- **BR-36b Catalog window.** One query: `collection("skillTrees")
  .orderBy("createdAt","asc").limit(501)` (the C1 catalog convention: 500 + 1
  probe; D1-local constant `SKILL_OPTIONS_WINDOW = 500`). The first 500 raw
  documents are the candidate window; the 501st is only a truncation probe and
  is never returned. Ties at the boundary are cut by Firestore's implicit
  `__name__` ascending. `skillOptionsTruncated = rawCount > 500`.
- **BR-36c Catalog validity and presentation.** Each raw document is mapped to
  a candidate (`createdAt`/`updatedAt` `Timestamp → Date`; a D1-local copy of
  the C1 candidate mapping, not imported) and kept only if `isValidSkillTree`
  holds. An invalid/malformed window document is dropped and **keeps its slot**
  (no refill). Presentation order is `name` ascending (code-point comparison
  via a D1-local comparator), ties by `treeId` ascending; presentation order
  never affects window membership.
- **BR-36d Window ≠ existence.** The selector window defines only which
  options are *offered*. It never decides whether a tree *exists*: validation
  of a new/changed `treeId` (BR-38) and name resolution of stored `treeId`s
  (BR-39) are always direct document-id reads, independent of the window. A
  valid tree outside the window is accepted on POST/PATCH when its id is
  submitted and resolves to its name in `areaName`; it is merely not offered.
  The edit form MUST always include the goal's currently linked tree (when
  `areaAvailable`) as a selectable option even if absent from `skillOptions`,
  so editing never silently unlinks it. When `skillOptionsTruncated`, the UI
  shows a notice that not all areas are listed.
- **BR-36e Catalog failure.** A catalog-window or name-resolution read failure
  is `500 persistence_failed` for the whole `GET` (BR-41).
- **BR-56 Malformed-document behavior (CL-2, approved; single canonical
  table).** "Malformed" means *fails BR-35*. Cases: invalid title, invalid
  status, invalid/wrong-type timestamp, `completedAt`/status mismatch, invalid
  `treeId` shape, invalid `targetDate`, unknown persisted key. Every case
  behaves identically:

  | Operation | Behavior |
  |---|---|
  | `GET` list | never a `GoalDto`; reported only as a `{ goalId }` recovery item in `recoveryItems` (BR-57, BR-59); consumes its raw slot (if returned by the BR-30 query); no refill; may contribute to `truncated`; no content, no failure reason |
  | `PATCH` | `404 goal_not_found`; no repair, no partial normalisation, no overwrite; the failed invariant is never exposed |
  | `DELETE` | deleted from the owner-scoped path without parsing content (`200 {ok:true}`); idempotent; missing/foreign ids indistinguishable |
  | cap count (POST) | counted (BR-34) |
  | logging | never by content (BR-54); at most a fixed code |

  Malformed data is uneditable and unshown, but the owner is given its opaque
  id as a delete-only recovery item (OQ-1, resolved; BR-57…BR-63), so every
  counted document is reachable for deletion (BR-60).

### Owner recovery of malformed and overflow documents (OQ-1, resolved)

Product-owner decision, option (a), approved 2026-10-11: the owner has an
in-product recovery path for malformed goal documents, via a separate minimal
delete-only DTO, never a `GoalDto`.

- **BR-57 `GoalRecoveryDto`.** Exactly `{ goalId: string }`, built field by
  field. `goalId` is the document id. A recovery item never exposes: `title`
  or any raw title, `treeId`, `targetDate`, `status`, `createdAt`, `updatedAt`,
  `completedAt`, unknown persisted fields, raw Firestore data, parse/validation
  failure details or reason, `uid`, `ownerUid`, e-mail, `displayName`,
  `teamId`, `memberRef`, a C1 level or internal error text. `recoveryItems` is
  sorted by `goalId` ascending (code-point comparison) so order carries no
  stored-content information, and contains each id at most once and never an id
  present in `goals`. The recovery DTO exists solely so the owner can call the
  existing `DELETE /api/me/goals/[goalId]` (BR-26).
- **BR-58 Recovery scan (technical, not a product change).** Firestore
  excludes documents lacking `createdAt` from an `orderBy("createdAt")` query
  (BR-30), so the list query alone can never reveal them. A second query is
  therefore part of `GET`: `collection("userDevelopment").doc(ownerUid)
  .collection("goals").select("createdAt").limit(101)` via the Admin SDK — no
  `orderBy` (Firestore's default `__name__` ascending order, deterministic
  window membership), field-mask projection of `createdAt` only (no title or
  other stored content is read by this query), **no composite index**, owner
  path only, no `collectionGroup`, one query (no N+1), no unbounded scan. The
  first 100 raw documents are the scan window; the 101st is only a truncation
  probe and is never examined. Within the window, a document whose `createdAt`
  field is **absent** yields a recovery item; a document whose `createdAt` is
  present is ignored by the scan (the BR-30 query owns it). Design comparison
  (decided): (B) dropping `orderBy` from the canonical query was rejected
  because it would replace the approved "newest 100" window with an arbitrary
  id-ordered window; (C) `count()`-based discovery returns no ids; (A) the
  separate bounded scan is the smallest design that keeps the approved list
  semantics. A scan failure is `500 persistence_failed` for the whole `GET`
  (BR-41 semantics).
- **BR-59 Classification and union.** For each raw document in the BR-30
  window (first 100): not addressable (BR-63) → neither; else readable (BR-35)
  → `goals`; otherwise → a recovery item. For each addressable document in the
  BR-58 scan window with absent `createdAt` → a recovery item. The two sources are disjoint by construction
  (`createdAt` present vs absent; the union is deduplicated by id defensively
  because the reads are not atomic). Malformed documents consume raw slots, are
  not refilled and count toward the cap. `recoveryItems.length ≤ 200` (≤ 100
  from each window). No auto-repair, no normalisation write, no diagnostics to
  the client.
- **BR-60 Reachability invariant (normative; stated for addressable ids, BR-63
  — every document D1 itself creates).** (i) *Fully visible at or below
  the cap:* if the owner has N ≤ 100 documents, every document with a BR-63
  addressable id appears in exactly one of `goals` or `recoveryItems`
  (documents with `createdAt` are all inside the BR-30 window of ≤ 100 raw
  documents; documents without it are all inside the BR-58 window of N ≤ 100).
  (ii) *Cap escape:* if `POST` returns `409 goal_limit` (count ≥ 100), the owner
  has an in-product path to delete at least one counted document, and the owner
  is never locked at the cap solely because counted documents are malformed or
  invisible. (iii) *Drain under arbitrary overshoot:* the cap is
  non-transactional (BR-34), so N may exceed 100. For N > 100 `truncated` is
  `true`, and at least one visible deletable item always exists: if any
  document has `createdAt`, the BR-30 query returns ≥ 1 raw documents of which
  at least min(raw, 100) ≥ 1 are shown (as goals or recovery items); if none
  has `createdAt`, all N documents lack it and the first 100 by id are shown by
  the BR-58 scan as recovery items. Each successful delete of a shown item
  lowers N by exactly 1, so after at most N − 100 delete-and-refetch cycles
  N ≤ 100 and (i) applies: every document, including those previously beyond
  both windows, has become visible. Hence documents beyond the raw windows
  never become permanently unreachable. Neither `collectionGroup`, an
  unbounded read, a counter document nor an admin/support endpoint is
  required. The owner may satisfy (iii) by deleting recovery items first.
- **BR-61 Recovery UI contract.** When `recoveryItems.length > 0` the goals
  page renders a separate recovery region (not inside the goal list) with
  neutral Norwegian copy whose meaning is: "Et lagret mål kan ikke vises. Du
  kan slette det og opprette målet på nytt." (plural form for several items).
  The copy claims nothing about why a document became malformed or who caused
  it, and does not suggest recovery without deletion. Each item offers exactly
  one action: **delete** (no edit, complete, reopen, title, skill, target date,
  raw data or repair control). The accessible name of each delete control is
  unique without visual context (for example `Slett lagret mål som ikke kan
  vises (2 av 3)`); the opaque `goalId` is not displayed. Delete uses the same
  permanent-delete confirmation as BR-52 (permanent, cannot be undone,
  `Slett permanent` / `Avbryt`, focus managed), which names no title because
  none exists. Deletion calls the existing `DELETE /api/me/goals/[goalId]`;
  after success the client refetches the canonical `GET`; a failure is shown
  as `role="alert"`. The recovery region is shown regardless of whether
  `goals` is empty (the BR-48 empty state applies only when both `goals` and
  `recoveryItems` are empty).
- **BR-62 Recovery privacy and logging.** The existence and opaque id of a
  malformed document may be revealed to its owner; **no malformed content is
  revealed.** This is compatible with owner-only authorization because the
  uid comes only from the verified token, both queries are scoped to the
  caller's own goals collection, and no cross-user list exists; foreign
  malformed documents remain inaccessible. Recovery classification and the
  scan never log the raw document, title, request body or malformed field
  values, and never return parser diagnostics to the client (BR-54).
- **BR-63 Addressable ids.** A document whose id is not BR-27a shape-valid
  cannot be addressed by `PATCH`/`DELETE`. Such a document can only be created
  outside D1 (D1 always writes a 20-character auto-ID). It is treated as
  non-addressable: it is never a `GoalDto` and never a recovery item (an item
  whose delete cannot work would mislead), it consumes its raw slot, and it
  counts toward the cap. This is an accepted operator-only limitation (known
  limitation 5); BR-60 is scoped to addressable ids.

### C1 independence

- **BR-42** D1 does not read `skillProfiles`, does not display C1 levels, does
  not persist C1 levels, and does not change the C1/C2 skill-profile
  importer allow-lists. `/me/skills` remains the self-assessment surface and
  its behavior is unchanged except for the shared personal nav (BR-46).

### Persistence and Firestore

- **BR-43** Goals live only at `userDevelopment/{uid}/goals/{goalId}`; `uid`
  comes only from the verified token; `goalId` is a random opaque auto-ID. The
  parent `userDevelopment/{uid}` document is never created or required. No
  `collectionGroup("goals")` query exists anywhere. All access is server-side
  through the Firebase Admin SDK; browsers never access goal documents.
- **BR-44** `firestore.rules` gains an explicit deny-only block
  `match /userDevelopment/{document=**} { allow read, write: if false; }`
  placed **before** the catch-all, with the standard documentation comment. The
  catch-all stays. The deny rule is defence in depth and **not** the owner
  authorization mechanism (the path + server check is).
- **BR-45** No new composite index, migration, backfill, dependency or
  environment variable.

### Navigation and UI

- **BR-46 Global header.** The signed-in header entry `Mine ferdigheter` is
  replaced by `Min utvikling` linking to `/me/skills`, marked
  `aria-current="page"` when the pathname is exactly `/me/skills` **or**
  `/me/goals`. `Min profil` (`/me/profile`) remains a separate entry (account
  settings, not development navigation), active only on `/me/profile`. No
  separate global link for goals. Signed-out/loading headers are unchanged.
- **BR-47 Page-level nav.** `/me/skills` and `/me/goals` render one shared
  component: `<nav aria-label="Personlig utvikling">` containing a list of
  exactly `Ferdigheter` (`/me/skills`) and `Mål` (`/me/goals`). The entry whose
  href equals the current pathname **exactly** carries `aria-current="page"`;
  the other carries none. No `Samtaler`, role or placeholder entries. No `/me`
  index route.
- **BR-48 Goals page `/me/goals`** (title `Mål`) covers these states, each
  with accessible semantics:
  1. **Loading** — a status region (`role="status"`) with loading text.
  2. **Empty** — (no goals and no recovery items) empty state with a create
     affordance.
  3. **Populated** — active goals first, completed goals in a separate
     collapsed-by-default disclosure labelled with the completed count
     (grouping is presentation only, no archive semantics, order per BR-31).
  4. **Create** and **edit** — native form: `Tittel` (required, visible label,
     inline validation message), `Ferdighetsområde` (native `<select>`, first
     option `Ingen`), `Måldato` (native `<input type="date">`, optional).
  5. **Complete / Reopen** — a button per goal; the status is also expressed
     in text (`Aktivt` / `Fullført`), not by colour alone.
  6. **Delete** — see BR-52.
  7. **Unavailable stored area** — text `Ferdighetsområdet er ikke lenger
     tilgjengelig` when `treeId !== null && areaAvailable === false`; edit stays
     possible (BR-40) and the select offers `Ingen` and valid options.
  8. **Goal limit** — `409 goal_limit` shown as an `role="alert"` message; the
     create form's content is preserved.
  9. **API/general error** — `role="alert"` with a retry for the load error.
  10. **Truncated** — when `truncated`, a notice that not all stored goals are
      shown and that deleting goals reveals more.
  11. **Recovery** — when `recoveryItems.length > 0`, the delete-only region of
      BR-61.
- **BR-49 Privacy copy (exact meaning, Norwegian wording finalised in the copy
  module).** The page states: goals are personal; teammates and team leads
  do not get access to goals through DevPulse; do not put sensitive or
  confidential information in a title. The copy never claims encryption,
  anonymity, that operators can never access data, or that inference is
  impossible.
- **BR-50 Forbidden UI.** No chart, percentage, score, ranking, leaderboard,
  overdue styling or wording, performance/appraisal language, lead/admin view,
  or `Samtaler` placeholder. A copy test asserts the absence of a fixed
  forbidden-term list (e.g. `score`, `poeng`, `ranking`, `rangering`,
  `ytelse`, `prestasjon`, `forsinket`, `overskredet`, `leder`, `administrator`
  other than in the explicit privacy sentence naming team leads).
- **BR-51 Accessibility.** All controls are native and keyboard-operable;
  every input has a visible label; the personal nav is a labelled `<nav>`
  with `aria-current`; loading/status/error use `role="status"`/`role="alert"`;
  no meaning relies on colour alone; layout is responsive using the existing
  `PageShell`/`PageHeader`/`Card`/`Button`/`TextField`/`Select`/`Alert`/
  `EmptyState`/`LoadingState` conventions.
- **BR-52 Delete confirmation.** Delete opens an explicit confirmation that is
  understandable without visual context: it names the goal title (as inert
  text; a recovery item, BR-61, has no title and names none), states that deletion is permanent and cannot be undone, and offers
  `Slett permanent` and `Avbryt` as native buttons. Focus moves into the
  confirmation and returns to a sensible control on cancel/completion.
- **BR-53** The client uses a gateway module (like
  `skill-profile-gateway.ts`) with a fresh ID token per request; the page never
  reads or writes Firestore.

### Logging

- **BR-54** Goal titles, ids-with-titles, tree names, request bodies and stored
  documents are never written to application logs or error reports. Server
  modules do not log content; any diagnostic carries at most a fixed error
  code. This applies equally to recovery classification and the recovery scan
  (BR-62): no raw document, title, request body or malformed field value is
  logged.

### Demo Team

- **BR-55** No Demo Team fixture data: no presenter goals, no synthetic people,
  no seed-count or reseed change. The presenter creates goals through the UI.

## Spec-level clarifications (approved 2026-10-11)

Both are incorporated normatively above and recorded here once as provenance,
not restated. The resolved open question OQ-1 is recorded under "Open
questions":

- **CL-1 (approved)** — selector options are carried by `GET /api/me/goals` as a
  minimal `{treeId, name}` DTO via the D1-local catalog seam: BR-25,
  BR-36a…BR-36e.
- **CL-2 (approved)** — malformed persisted goals are never `GoalDto`s and
  expose no content; they appear to the owner only as delete-only recovery items
  (BR-57); `PATCH` → `404`; `DELETE` succeeds without parsing; they count toward
  the cap: BR-26, BR-33, BR-56.

## Edge cases and failure behavior

- Title of 100 code points accepted; 101 rejected; a surrogate-pair emoji counts
  as one code point; combining marks are NFC-normalised before counting.
- Title of only punctuation/emoji with no letter or digit → `invalid_title`.
- `targetDate` `"2026-02-30"`, `"2019-12-31"`, `"2101-01-01"`, `"26-1-1"` →
  `invalid_target_date`; `"2020-01-01"` (past) accepted.
- `PATCH {status:"completed"}` twice → second is a no-op, `completedAt`
  unchanged.
- `PATCH {title:"x", status:"active"}` on an active goal → title changes,
  status part no-op, `updatedAt` bumped once.
- `PATCH {treeId:null}` on a goal with an unavailable tree → relation removed.
- Create with 100 existing goals → `409 goal_limit`; after one delete → `201`.
- 101 raw documents → 100 candidates, `truncated:true`; 101 raw documents of
  which 3 malformed (within the first 100) → 97 `goals`, 3 `recoveryItems`,
  `truncated:true`, no refill. 100 raw documents of which 3 malformed → 97
  `goals`, 3 `recoveryItems`, `truncated:false`.
- 100 documents of which 2 lack `createdAt` → 98 in the list query, 2 found by
  the recovery scan as `recoveryItems`, `truncated:false`; `POST` → `409`;
  deleting one recovery item then `POST` → `201`.
- 103 documents, all lacking `createdAt` → the first 100 by id are recovery
  items, `truncated:true`; deleting them and refetching reveals the rest.
- A malformed document with a string-typed `createdAt` → returned by the list
  query (type ordering), a recovery item, not a goal.
- A valid SkillTree outside the 500-tree selector window: not offered, but
  accepted by `treeId` on POST/PATCH and name-resolved on list (BR-36d).
- Foreign goal id on PATCH → `404 goal_not_found`; on DELETE → `200`.
- Two tabs: tab A completes, tab B edits title → both apply; `completedAt`
  retained.
- Expired token mid-session → `401`; the UI follows the existing re-auth
  pattern of `/me/skills`.
- The owner's team membership removed/rejoined/team disabled → goals unchanged
  and still fully accessible to the owner.

## Security and privacy

Feature-specific implications; the policy itself is not restated.

### Proposed security invariants (for reconciliation into `docs/SECURITY.md`)

| ID | Invariant |
|---|---|
| SI-1 | Goals are owner-only. |
| SI-2 | The subject is always the verified-token uid. |
| SI-3 | No uid-parameterised goal reader or writer exists. |
| SI-4 | Team roles and app-admin status never widen goal access. |
| SI-5 | Goals have no team scope and no sharing in D1. |
| SI-6 | D1 never reads `skillProfiles`. |
| SI-7 | D1 never persists C1 levels. |
| SI-8 | D1 never writes SkillTree data. |
| SI-9 | Client Firestore access to `userDevelopment` is denied (explicit deny-only block + catch-all). |
| SI-10 | Goal DTOs are explicit field-by-field allow-lists. |
| SI-11 | No uid, e-mail, displayName, teamId, audit actor or C1 level appears in any goal DTO or error body. |
| SI-12 | Goal titles are potentially sensitive free text (stored unencrypted; UI discourages sensitive content). |
| SI-13 | Titles are inert text only (never HTML/Markdown) and are never logged. |
| SI-14 | Foreign goal ids reveal no owner information (structurally missing under the caller's path). |
| SI-15 | No `collectionGroup` goal query is permitted. |
| SI-16 | Account erasure is a known limitation (no deletion flow). |
| SI-17 | Operator/Admin-SDK access to goals is an accepted residual risk, not a product entitlement. |
| SI-18 | A malformed goal's existence and opaque id may be revealed to its owner only, as a delete-only `{ goalId }` recovery item; no malformed content, failure reason or stored field is ever returned. |

Any future reader of goals other than the owner (leads, mentors, D2) is
**not** authorised by D1 and requires a separately approved privacy/security
design, an updated privacy notice, a deliberate guard allow-list change and a
consent decision. D1 does not weaken invariants 1–36.

### Privacy checklist outcomes

- Anonymous-identity concerns: N/A (goals are attributed to their owner by
  design and anonymous-response separation is untouched).
- Encryption: titles are stored **unencrypted** (approved D1-P7); this is an
  accepted, documented choice, mitigated by copy, minimisation (title only) and
  owner-only access. Encryption keys are not involved.
- Retention: goals live until the owner deletes them; no TTL, no history, no
  tombstone.
- Minimisation: no uid/owner duplicate, no description, no actor fields.

### Threat model

| Threat | Classification | Notes |
|---|---|---|
| IDOR (guessing another user's goal id) | **Prevented** | ids are only ever resolved under `userDevelopment/{callerUid}/goals`; there is no cross-owner addressing |
| Cross-user reads | **Prevented** | no uid-parameterised reader, no `collectionGroup` query, no list-all |
| Foreign goal ids | **Prevented** | BR-27: same 404 / same DELETE success as missing |
| App-admin bypass | **Prevented** | admin status is never consulted (BR-3); no admin route exists |
| Lead-role overreach | **Prevented** | lead status is never consulted; no lead route |
| Enumeration | **Mitigated** | ids are 20-char random auto-IDs under the caller's path; indistinguishable responses; no listing across owners. Nothing is revealed even if an id were guessed |
| Multi-team leakage | **Prevented** | goals have no team field or scope; membership irrelevant |
| Sensitive title content | **Accepted residual risk** | owner may still type sensitive text; mitigated by copy, owner-only access, no logging, no sharing |
| Stored XSS | **Prevented** | text-only rendering, no HTML/Markdown, normalisation rejects control/format chars; static test forbids `dangerouslySetInnerHTML` in D1 |
| Oversized payloads | **Mitigated** | 4096-byte body cap, title ≤ 100 code points, strict allow-list |
| Invalid SkillTree references | **Mitigated** | validated on set/change (BR-38); stored-unavailable rendered gracefully (BR-39); never repaired |
| Lost updates | **Mitigated** | single-document transaction for PATCH; same-field concurrent edits are last-write-wins (accepted) |
| Goal-cap races | **Accepted residual risk** | count-before-create may overshoot slightly; read window still surfaces overflow via `truncated`; not a security control |
| Malformed stored documents | **Mitigated** | BR-33/35/57: never a `GoalDto`, slot kept, content never exposed; the owner gets a delete-only `{goalId}` recovery item (BR-57…BR-62); only operators can create them |
| Orphaned data after account deletion | **Deferred known limitation** | no deletion flow; the per-owner subtree is designed to be erasable in one subtree delete later (AD-1) |
| Operator / Admin SDK access | **Accepted residual risk** | operators with Firestore credentials can read titles; not a product entitlement |

## Architecture decisions

- **AD-1 Persistence layout (D1-P15).** `userDevelopment/{uid}/goals/{goalId}`
  is a **new pattern**: the first subcollection in the repository; every other
  collection is top-level. Reasons: structural owner scoping (the path is the
  ownership boundary); foreign goal ids resolve as missing under the caller's
  path; no `ownerUid` duplication; no `ownerUid + createdAt` composite index;
  future account erasure can target a single owner subtree; no
  `collectionGroup` goal query is permitted. The `userDevelopment` root name is
  also reserved for future per-owner development data (D2 etc.), but D1 defines
  only `goals`.
- **AD-2 Server-mediated persistence (D1-P11).** Next API routes + server
  modules + Firebase Admin SDK; client rules deny-only; no new env var.
- **AD-3 Feature boundary.** New feature directory
  `src/features/personal-goals/` (`domain/`, `server/`, `client/`,
  `components/`, `copy.ts`) and `app/api/me/goals/`, `app/me/goals/page.tsx`.
  It imports from `src/features/auth/server/verify-identity` (token
  verification) and from the generic `src/lib/firebase/` and
  `src/components/ui/` primitives; it imports nothing from `profiles`,
  `skill-profiles`, `team-skills`, `teams`, `roadmap`, `skill-trees/server`
  (only the pure `isValidSkillTree` domain predicate from `skill-trees/domain`).
- **AD-4 Shared personal nav.** One shared component in `src/components/nav/`
  (e.g. `PersonalNav`) plus a `Min utvikling` active-set rule in `SiteHeader`;
  `/me/skills` page gains the component without changing C1 behavior.
- **AD-5 Cap enforcement.** Count-then-create (BR-34), mirroring `thread_full`.
- **AD-6 Time and ids.** Injected clock and id generator in the server module
  for deterministic tests.
- **AD-7 Local-parity normalisers** (BR-10, BR-12) over cross-feature imports.

## Test boundaries

| Boundary | Covers |
|---|---|
| Domain: title normaliser + parity table vs `normalizeDisplayName` | BR-9, BR-10, BR-11 |
| Domain: `targetDate` validator + parity vs `isValidPlanDate` | BR-12 |
| Domain: lifecycle transition function, `completedAt` invariant | BR-6, BR-15…BR-18, BR-21 |
| Domain: readability contract over malformed fixtures (unknown key, bad status, completedAt/status mismatch, bad timestamps, empty treeId, `null` optionals, non-normalised title) | BR-33, BR-35 |
| Server modules with fake store/catalog/clock: owner, teammate, lead, lead+admin, non-member admin, former member, unrelated, unauthenticated | BR-1…BR-5, matrix |
| Server: foreign/missing/shape-invalid id on PATCH and DELETE (no Firestore access for shape-invalid ids) | BR-26, BR-27, BR-27a |
| Server: persistence path scoping, no `ownerUid`/forbidden keys written, exact persisted key set, `completedAt` iff completed | BR-6, BR-7, BR-43 |
| Server: list query shape (`orderBy createdAt desc limit 101`), ordering, tie-break, truncation (either window), malformed keep slot / no refill | BR-30…BR-33 |
| Server: malformed → `recoveryItems` not `goals`; recovery DTO is exactly `{goalId}`; no malformed content leaks (title, treeId, dates, status, unknown keys, raw data, failure reason); `recoveryItems` sorted by id, deduplicated, disjoint from `goals`; non-addressable ids neither goals nor items | BR-25, BR-33, BR-56, BR-57, BR-59, BR-63 |
| Server: recovery scan query shape (`select("createdAt").limit(101)`, no `orderBy`, owner path, no `collectionGroup`, one query); document without `createdAt` is a recovery item; present-`createdAt` documents ignored by the scan; scan failure → `500` | BR-58, BR-59 |
| Server: reachability — fully visible at N ≤ 100; overshoot N > 100 drains by repeated delete-and-refetch (simulated store with mixed valid / malformed / missing-`createdAt` documents); at-cap `409` always has a deletable visible item; recovery deletion frees capacity | BR-34, BR-60 |
| Server: malformed goal `PATCH` → `404 goal_not_found` (no write); malformed goal `DELETE` succeeds without parsing; malformed counts toward cap; foreign malformed goal inaccessible | BR-26, BR-27, BR-56 |
| Server: cap (99→ok, 100→409, delete frees, count includes malformed and missing-`createdAt`) | BR-34, BR-60 |
| Server: SkillTree create/change check, unchanged-tree re-save, unavailable tree DTO, batched resolution (assert one batch call, no per-goal read), catalog failure | BR-36…BR-41, CL-1 |
| Server: selector DTO exactly `{treeId,name}`, catalog window 500+1 with slot-keeping and name/`treeId` ordering, window ≠ existence (valid tree outside window accepted, resolved), catalog/name-resolution failure → `500` | BR-36a, BR-36b, BR-36c, BR-36d, BR-36e |
| Server: PATCH atomicity (transaction), no-op transitions, updatedAt rules | BR-16…BR-18, BR-29 |
| API routes: strict body allow-list, unknown keys, empty PATCH, oversize, types, status codes, `Cache-Control: no-store` on all responses, error bodies content-free, DTO exact keys, no uid/team/C1 leakage, idempotent DELETE | BR-22…BR-28 |
| API routes: `GET` envelope is exactly `{goals, recoveryItems, truncated, skillOptions, skillOptionsTruncated}`; recovery items carry only `goalId` | BR-25, BR-57 |
| Static: `firestore.rules` deny-only block precedes catch-all; deployment-config pin | BR-44 |
| Static scope guard (see below) | SI-3, SI-6, SI-8, SI-9, SI-15, BR-3, BR-7, BR-45 |
| UI (component tests): loading, empty, populated, create, edit, complete, reopen, delete+confirm+cancel, selector (incl. current linked tree always selectable, truncated-options notice), unavailable tree, `Måldato`, goal-limit, general error, truncated, privacy copy, forbidden-term absence, keyboard/labels, `aria-current` | BR-36d, BR-46…BR-53 |
| UI: recovery region is delete-only (no edit/complete/reopen/title/skill/date/raw data/repair), neutral copy, unique accessible names, no `goalId` displayed, BR-52 confirmation, refetch after delete, failure `role="alert"`, shown with empty `goals`, empty state only when both lists empty | BR-48, BR-52, BR-61 |
| UI: header + personal nav (`Min utvikling` active on both pages, `Min profil` separate, exact-path `aria-current`) | BR-46, BR-47 |
| Regression: C1 self-assessment unchanged; C2 coverage unchanged; team roadmap and team skill planning unchanged; header profile/other links valid | BR-42, BR-46 |
| Logging: server modules emit no title/body/malformed-field content on success or failure, including recovery classification and scan (spy on `console`) | BR-54, BR-62 |
| Demo Team: seed counts and fixtures unchanged | BR-55 |

Timestamp fixtures in tests use millisecond precision (BR-14), so exact ISO
assertions are deterministic. This adds no product requirement.

### D1 static scope guard (required)

A new `src/features/personal-goals/personal-goals-scope-guard.test.ts`, modeled
on `skill-profiles-scope-guard.test.ts` (pure scanner functions run over the
real tree and virtual negative fixtures; the guard file is excluded from real
scans). It is **change-detection evidence, not a security boundary** — it does
not prove runtime behavior or authorization correctness, dynamically built
collection names or module paths, unresolvable re-exports/dynamic imports,
path aliases other than `@/`, code outside `src/` and `app/`, or Admin
credential access. Regex scans can be evaded by obfuscation; code review
remains the check.

Required dimensions:

1. **Collection identifier**: the string `userDevelopment` appears only in an
   approved file allow-list (domain constants, store, their tests, rules
   deployment pin).
2. **Importer allow-list**: only listed files (goal routes, their tests,
   page, the personal-goals feature itself) may import
   `personal-goals/server/**`; the store module has a narrower module-level
   importer list.
3. **No `collectionGroup`** call anywhere in `src/` or `app/` that references
   goals/`userDevelopment`, and none within the D1 feature at all.
4. **No client Firestore** (`firebase/firestore`, client SDK helpers) imports in
   D1 files.
5. **No import** from `skill-profiles` (any layer), `teams` authorization
   (`authorizeTeamAccess`, `resolveTeamRole`, `isAppAdmin`, `requireAppAdmin`),
   membership modules, `roadmap`, `skill-trees/server`, `team-skills`; and no
   reference to `skillProgress`, `roadmapItems`, `teamSkillNeeds`,
   `skillProfiles`, `teamMemberships` collection identifiers.
6. **Persisted-key allow-list**: the exported persisted-key tuple equals
   `{title, status, createdAt, updatedAt, treeId, targetDate, completedAt}`;
   forbidden keys (BR-7) never appear as persisted-object keys in the store
   writer.
7. **DTO allow-list**: the exported DTO-key tuple equals BR-24 exactly; the
   exported recovery-DTO-key tuple equals `{goalId}` (BR-57); the exported
   `GET` envelope-key tuple equals BR-25 exactly; the routes build responses
   from DTOs only, and no raw stored field is a key of any response object.
8. **Forbidden concepts** inside D1 sources: tokens for sharing/consent,
   lead/admin reader, ranking/scoring, percentage/progress-score, overdue,
   `dangerouslySetInnerHTML`. Documented limitation: a name-based scan flags
   identifiers and strings only and cannot prove absence of the *behavior*;
   copy-level terms are checked by the UI copy test instead.
9. **No other guard weakened**: the C1/C2 guards' allow-lists are unchanged
   (D1 needs no edit to them) and a test asserts the D1 files do not appear in
   them.

## Acceptance criteria

- [ ] `GET/POST /api/me/goals` and `PATCH/DELETE /api/me/goals/[goalId]` exist
      and no other goal route exists; every response has `Cache-Control:
      no-store`.
- [ ] Only the owner can create/read/edit/complete/reopen/delete; teammate,
      lead, lead+admin, non-member admin, former member and unrelated user
      tests all show no access and no information about the owner.
- [ ] Goal authorization code imports/calls none of `authorizeTeamAccess`,
      `resolveTeamRole`, `isAppAdmin`, `requireAppAdmin` (guard-verified).
- [ ] Persisted documents contain only the BR-6 key set; `ownerUid`/`uid` and
      every BR-7 field are absent (test + guard).
- [ ] Title normalisation, 1–100 code-point bounds, forbidden characters and
      letter-or-digit rule pass the parity table; `targetDate` rules pass.
- [ ] Complete/reopen/edit/delete behave exactly per BR-15…BR-19, including
      no-op idempotence and `completedAt` preservation.
- [ ] Create with 100 existing goals returns `409 goal_limit`; delete restores
      capacity; the read window returns ≤ 100 goals with `truncated` per
      BR-32; malformed documents are never goals, become recovery items and are not
      refilled.
- [ ] List uses one `orderBy("createdAt","desc").limit(101)` query and no
      composite index is added; `firestore.indexes.json` is unchanged.
- [ ] Unknown stored keys, bad status/timestamps/`completedAt` mismatch/bad
      `treeId`/`targetDate` make a document unreadable and never reach a
      `GoalDto`; the owner sees it only as a `{goalId}` recovery item.
- [ ] `GET` returns the five-key envelope of BR-25; a malformed document (with
      or without `createdAt`) is a recovery item with no content; `PATCH` on it
      is `404`; `DELETE` removes it and frees capacity; at `409 goal_limit` the
      owner can always delete a counted document; overflow beyond the windows
      drains by delete-and-refetch (BR-60); the recovery UI is delete-only.
- [ ] New/changed invalid `treeId` → `404 skill_not_found`; a goal whose tree
      later became unavailable still lists (`areaName:null`,
      `areaAvailable:false`), still saves unrelated edits, and can be unlinked.
- [ ] Stored tree names are resolved in one batch (no per-goal read).
- [ ] D1 does not read `skillProfiles` and does not edit the C1/C2 guard
      allow-lists.
- [ ] DTO/response bodies contain no uid, team field, e-mail, displayName,
      actor or C1 level; error bodies contain only `{error}`.
- [ ] Foreign/missing goal ids are indistinguishable (PATCH 404 identical,
      DELETE 200 identical).
- [ ] `firestore.rules` has the deny-only `userDevelopment` block before the
      catch-all; rules/deployment pin test passes; no client Firestore import
      in D1.
- [ ] The D1 static scope guard exists, passes, and its documented
      limitations are stated in the file header.
- [ ] Header shows `Min utvikling` (active on `/me/skills` and `/me/goals`) and
      `Min profil`; `/me/skills` and `/me/goals` render the labelled personal
      nav with exact `aria-current`; no `Samtaler`/role entries.
- [ ] `/me/goals` implements every BR-48 state; delete requires the BR-52
      confirmation; privacy copy meets BR-49 without forbidden claims; the
      forbidden-term copy test passes; keyboard/label/role assertions pass.
- [ ] Titles never appear in logs (BR-54 test).
- [ ] No Demo Team fixture, seed-count, environment-variable, dependency,
      migration or index change.
- [ ] Regression: C1, C2, roadmap and team skill planning test suites and the
      full repository checks (`pnpm` lint, typecheck, tests, build per
      `package.json`) pass.

## Relationship to other features

- **C1 (`individual-skill-self-assessment`)** — independent; shares only the
  personal navigation. `/me/skills` stays the self-assessment surface.
- **C2 (`team-skill-needs-and-matrix`)** — untouched; no `teamSkillNeeds`
  relation.
- **F0 (`member-identity-and-team-roles`)** — D1 reuses the display-name
  *normalisation contract* only semantically (BR-10).
- **Team Skill Tree / Planning / Roadmap** — the only touchpoint is reading the
  SkillTree catalog (BR-36).
- **D2 / role expectations** — future, separate; see label resolution.

## Documentation impact (at implementation closeout, not now)

| Document | Reconciliation needed |
|---|---|
| `docs/PRODUCT.md` | Add D1 personal goals; replace "D1/D2" role-expectation references with the resolved labels; keep role expectations as unscheduled future work; restate non-goals (no performance/ranking use) |
| `docs/ROADMAP.md` | Mark D1 delivered; re-label the old "D1/D2 — Role expectations" entry as a separate unscheduled feature; add D2 = check-ins/conversations (planned) |
| `docs/ARCHITECTURE.md` | Record the new subcollection pattern, the `personal-goals` feature boundary, shared personal nav, and the new owner route family |
| `docs/DATA-MODEL.md` | Add `userDevelopment/{uid}/goals` (personal data, sensitive free text: title, unencrypted); fix the `roleDefinitions (D1/D2)` wording |
| `docs/UI-UX.md` | Add `Min utvikling` header entry, `Ferdigheter · Mål` personal nav, `/me/goals` states and copy |
| `docs/SECURITY.md` | Add SI-1…SI-18 as numbered invariants (37+), checklist items, and known limitations (no account erasure; operator access; title is unencrypted free text; cap race) |
| C1 SPEC/TASKS | Dated pointer: header link renamed `Min utvikling`; shared personal nav added; D1/D2 label resolved |
| C2 SPEC/TASKS | Dated pointer: D1/D2 label resolved; no behavior change |
| F0 SPEC | Pointer only if its D1/D2 wording requires one |
| `firestore.rules` | New deny-only block (implementation task, not this turn) |

## Migrations / dependencies / config

None: no migration, backfill, dependency, environment variable, composite
index or Demo Team change. One new deny-only Firestore rule block.

## Known limitations (accepted)

1. No account-erasure: goals can outlive a deleted Firebase account (the owner
   can delete them while signed in). The owner subtree layout keeps future
   erasure a single-subtree operation.
2. Operators with Firestore Admin credentials can read titles (not a product
   entitlement).
3. Titles are stored unencrypted and the owner can type sensitive text.
4. The 100-goal cap can be slightly overshot under concurrent creates.
5. Malformed stored documents are shown to the owner only as delete-only
   `{goalId}` recovery items and count toward the cap. A document whose id is
   not BR-27a shape-valid (only creatable outside D1) is non-addressable
   (BR-63) and cannot be recovered in-product.
6. When more than 100 goals exist (overflow), only a bounded window is
   examined (newest 100 by `createdAt`, plus the first 100 ids for the recovery
   scan); deleting visible items reveals the rest (BR-60).
7. The scope guard is change-detection, not proof.

## Open questions

No open product decisions remain.

- **OQ-1 — owner reachability of unreadable and overflow goals. RESOLVED
  2026-10-11.** Product-owner decision: option (a), an in-product delete-only
  recovery path via a separate minimal `GoalRecoveryDto` `{ goalId }`, never a
  `GoalDto` (BR-57). Technical resolution of the follow-on problems (no product
  change): documents lacking `createdAt` are found by a bounded `select`
  recovery scan (BR-58); overflow beyond both windows drains by
  delete-and-refetch (BR-60); the at-cap lock is excluded for addressable ids
  (BR-60, BR-63). Normative text: BR-25, BR-32, BR-33, BR-56…BR-63, SI-18.
