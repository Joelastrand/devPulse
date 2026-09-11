# Team Management — Tasks

Specification: [SPEC.md](./SPEC.md)

## Status
Ready: 0  In Progress: 0  Done: 11

## Task graph

```mermaid
flowchart LR
    T1[TASK-001 admin identity + teams CRUD]
    T2[TASK-002 memberships + authorizeTeamAccess]
    T3[TASK-003 per-team results endpoint]
    T4[TASK-004 invitations]
    T5[TASK-005 access requests]
    T6[TASK-006 dynamic survey team source + seed]
    T7[TASK-007 /teams overview]
    T8[TASK-008 /teams/[teamId] page]
    T9[TASK-009 admin: teams list/create/disable]
    T10[TASK-010 admin: team detail]
    T11[TASK-011 retire/redirect old path]

    T1 --> T2
    T1 --> T6
    T1 --> T9
    T2 --> T3
    T2 --> T4
    T2 --> T5
    T4 --> T10
    T5 --> T7
    T5 --> T10
    T9 --> T10
    T3 --> T8
    T7 --> T8
    T3 --> T11
    T6 --> T11
    T7 --> T11
    T8 --> T11
```

## Tasks

### TASK-001 — App-admin identity + `teams` collection CRUD

**Status:** Done
**Covers:** BR-1, BR-2, BR-4, BR-5, BR-6, BR-35 (teams), BR-36
**Depends on:** None

**Outcome**
A server-only `isAppAdmin(identity)` check exists, driven entirely by the
`APP_ADMIN_EMAILS` allow-list and a revocation-checked verified ID token
(never client-supplied). An app admin can create a team (server assigns an
opaque, Firestore-generated `teamId`, independent of `name`) and
disable/re-enable it via a new admin-only API surface; a non-admin caller
is rejected on every one of these operations. Creating/disabling a team
never touches `pulseSurveyResponses`.

**Implementation notes**
- New feature root `src/features/teams/` per `.claude/rules/architecture.md`.
- Reuse `verify-identity.ts` unchanged (including `checkRevoked: true`);
  `isAppAdmin` normalizes (trim + lowercase) both the caller's email and
  each allow-list entry before comparing.
- `APP_ADMIN_EMAILS` is a new server-only env var (comma-separated); add it
  to `.env.local.example` with the same documentation style as
  `TEAM_ASSIGNMENTS`'s local-setup note.
- `teams/{teamId}`: `{ name, status: "active" | "disabled", createdAt,
  createdBy }`, `teamId` from Firestore's auto-generated document ID
  (SPEC → Architecture decisions → "Team identifier scheme"). Do not
  derive `teamId` from `name`.
- Firestore rules: add an explicit `match /teams/{document=**} { allow
  read, write: if false; }` block to `firestore.rules` (the catch-all
  already denies it; this is documentation/defense-in-depth parity with
  `pulseSurveyResponses`, per SPEC).
- Do not touch `TEAM_ASSIGNMENTS`, `ALLOWED_TEAM_IDS`, `/results`, or
  `/api/results` — this task is purely additive (Migration strategy point 1).

**Verification**
- Domain/server tests: allow-list matching requires valid + revocation-
  checked + verified-email + normalized-match, all four independently
  (BR-5, BR-6); create/disable/re-enable succeed only for an admin caller
  and never mutate `pulseSurveyResponses` (BR-1, BR-2, BR-4).
- A test asserting the admin allow-list itself is never present in any
  handler's response payload (BR-36).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
Establishes the app-admin trust boundary the rest of the feature depends
on — get this task's tests solid before building on it. No raw survey
data is reachable from this task's code paths.

**Documentation impact**
`docs/DATA-MODEL.md` (add `Team`, Firestore-backed), `docs/DEVELOPMENT.md`
(new `APP_ADMIN_EMAILS` env var, new `firestore.rules` block).

**Acceptance criteria**
- [x] An app-admin caller can create a team; it is `active` immediately.
- [x] A non-admin caller cannot create, disable, or re-enable a team.
- [x] Team creation/disable/re-enable never reads or writes
      `pulseSurveyResponses`.
- [x] `APP_ADMIN_EMAILS` contents never appear in a response payload.
- [x] `firestore.rules` explicitly denies client-SDK access to `teams`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation note (deviation)**
Also added `listTeams` (admin-only, returns every team including
disabled) — not explicitly named by a SPEC `BR-*`, but the smallest
supporting work needed to satisfy the task title's "CRUD" and to unblock
TASK-009, which depends on this task and explicitly assumes an
all-teams-including-disabled read exists with "no new server logic" of
its own. Covered by `src/features/teams/server/list-teams.ts` and its
tests (admin-only, generic `read_failed` on a Firestore error).

---

### TASK-002 — `teamMemberships` + `authorizeTeamAccess` + admin member management

**Status:** Done
**Covers:** BR-3 (member-of-disabled-team access), BR-7, BR-8, BR-9, BR-10, BR-16, BR-29, BR-35 (teamMemberships)
**Depends on:** TASK-001

**Outcome**
A user can hold memberships in multiple teams. A single server helper,
`authorizeTeamAccess(identity, teamId)`, returns `"admin" | "member" |
"denied"` and is the one place every future protected team-scoped
operation asks "can this caller see this team" — including correctly
returning `"denied"` for a nonexistent or `disabled`-and-non-member
`teamId` (BR-16). An app admin can list a team's members (with email
resolved live from Firebase Auth, never persisted) and remove one.

**Implementation notes**
- `teamMemberships/{compositeId}` (`${uid}__${teamId}` used only as a
  uniqueness key; `uid`/`teamId` also stored as separate fields — see
  SPEC → Architecture decisions → "Firestore collections"). No composite
  index needed (both queries are single-field).
- `authorizeTeamAccess` must read the `teams` document (for `status`) as
  well as membership — a `disabled` team with no caller membership is
  `"denied"` even if the caller was previously a member (BR-16 covers
  "exists but disabled and caller has no membership"; an existing member
  of a disabled team still resolves `"member"`, per BR-3).
- Member-list email resolution uses `getAdminAuth().getUser(uid)` per
  member — do not persist email on the membership document (SPEC →
  Security and privacy → "Admin visibility of member/requester emails").
- Firestore rules: explicit deny block for `teamMemberships/{document=**}`.

**Verification**
- `authorizeTeamAccess` matrix: admin/member/denied, including nonexistent
  `teamId`, disabled team + non-member, disabled team + existing member.
- Removing a membership then re-checking `authorizeTeamAccess` for the
  same caller/team returns `"denied"` (BR-9's "next request" guarantee,
  exercised as two sequential calls).
- Member-list test confirms email comes from Firebase Auth lookup, not a
  stored field.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
This task's `authorizeTeamAccess` is the authorization boundary invariants
8/9/10 depend on for every later protected endpoint — no client-supplied
`teamId`, role, or membership claim may ever substitute for it.

**Documentation impact**
`docs/DATA-MODEL.md` (add `TeamMembership` as Firestore-backed, replacing
its current "conceptual only" status), `docs/ARCHITECTURE.md`
(authorization model: `authorizeTeamAccess` generalization).

**Acceptance criteria**
- [x] A user with memberships in two teams is authorized `"member"` for
      both, independently.
- [x] `authorizeTeamAccess` returns `"denied"` for a nonexistent `teamId`
      (see Implementation note below — including for an app admin);
      `"denied"` for a disabled team with no membership; `"member"` for an
      existing member of a disabled team; `"admin"` for an app admin on an
      existing team (active or disabled).
- [x] Removing a membership causes the very next authorization check for
      that (uid, team) to return `"denied"`.
- [x] An app admin can list a team's members and remove one; a non-admin
      cannot.
- [x] `firestore.rules` explicitly denies client-SDK access to
      `teamMemberships`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (deviations/decisions)**
- **BR-16 ambiguity resolved toward the stricter reading**: this task's
  own acceptance-criteria draft above ("`admin` for any app admin") read
  as unconditional, but SPEC.md's actual BR-16 text — "A `teamId` that
  does not exist, **or** that exists but is disabled and the caller has no
  membership/admin status, resolves to the same non-member treatment" —
  parses as two independent clauses: a nonexistent `teamId` is `"denied"`
  unconditionally (no membership/admin carve-out is stated for that
  clause), while a `disabled`-but-existing team is `"denied"` only absent
  membership or admin status. Implemented `authorizeTeamAccess` to check
  team existence/status **before** the admin short-circuit, so a
  nonexistent `teamId` is `"denied"` for every caller including an app
  admin — there is nothing to administer. A malformed/unrecognized
  `status` value is treated identically (fail closed for everyone).
  `authorize-team-access.test.ts` covers both the nonexistent-team-denies-
  admin case and the disabled-team-admin-succeeds case explicitly, so this
  decision is pinned by an executable test, not just prose. Resolved per
  "SPEC.md owns requirements" (the primary source) over this task's own
  paraphrase (the secondary one) — not a deviation from SPEC, a
  disambiguation of it.
- **`requireAppAdmin` extracted** (`src/features/teams/server/
  require-app-admin.ts`): TASK-002 added two more admin-gated operations
  (`listTeamMembers`, `removeTeamMember`), which would have brought the
  duplicated `verifyIdToken` → `isAppAdmin` preamble (flagged as a
  Suggestion in TASK-001's review) to five call sites. Extracted a single
  `requireAppAdmin(idToken, deps): Promise<{ok:true, identity} |
  {ok:false, error:"unauthenticated"|"forbidden"}>` and updated
  `create-team.ts`, `set-team-status.ts`, and `list-teams.ts` to use it.
  Behavior-preserving: all of TASK-001's existing tests (including its
  route tests) pass unchanged with no edits, confirming identical external
  behavior/status codes/error shapes. Revocation checking, the
  `emailVerified` requirement, and `APP_ADMIN_EMAILS`'s server-only status
  are all unchanged — `requireAppAdmin` only recomposes the existing
  `verifyIdToken`/`isAppAdmin` calls, adding no new logic. This is
  deliberately narrow (admin-only gate) and separate from
  `authorizeTeamAccess` (the three-way admin/member/denied decision) —
  not a general auth framework.
- **Fail-closed validation at the two new Firestore read boundaries**:
  `isValidTeamStatus` (`domain/team.ts`) and `isValidMembershipFor`/
  `extractMemberUid` (`domain/team-membership.ts`) replace what would
  otherwise be unchecked `as Team`/`as TeamMembership` casts.
  `authorizeTeamAccess` and `listTeamMembers` both treat a malformed/
  unexpected document as absent (denied / excluded), never throwing and
  never defaulting to allow.

---

### TASK-003 — Per-team results endpoint (new protected route, server half)

**Status:** Done
**Covers:** BR-14, BR-15
**Depends on:** TASK-002

**Outcome**
A new server operation and API route resolve, for one specific
`teamId`, the caller's most recently closed period's aggregate plus the
12-closed-period trend — authorized via `authorizeTeamAccess`, not the
static email map. For a `teamId` the caller is not authorized for, the
server returns a generic denial without ever querying
`pulseSurveyResponses` for that team. The existing `/api/results` route,
`get-dashboard.ts`, and `TEAM_ASSIGNMENTS` are completely untouched by
this task (Migration strategy point 1: coexistence).

**Implementation notes**
- New server operation (e.g. `src/features/results/server/
  get-team-results.ts`) takes `(idToken, teamId)`, calls
  `authorizeTeamAccess`, and — only on `"admin"`/`"member"` — reuses
  `computePeriodAggregate` and `listPrecedingClosedPeriods` exactly as
  `get-dashboard.ts` does today (no changes to that aggregation domain
  logic).
- New route, e.g. `app/api/teams/[teamId]/results/route.ts`, thin per
  `.claude/rules/nextjs-react.md`; `teamId` comes from the URL path but is
  never trusted without `authorizeTeamAccess` succeeding first (item 9).
- Denial response must be indistinguishable in shape between "team
  doesn't exist" and "exists, no access" (BR-16, reused from TASK-002).

**Verification**
- Server API contract tests: authorized member/admin gets the same
  aggregate shape Phase 2 already produces; denied caller gets no
  aggregate/count/trend data and the Firestore query is never issued for
  that team (assert via a spy/fake collection that denial short-circuits
  before any read).
- Open-period-always-empty and threshold-suppression behavior verified
  identically to the existing `get-dashboard.test.ts` cases (same
  underlying domain logic, new entry point).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
Directly implements invariants 8/9/10 for the new route. No raw response
content is returned by this task, matching the unchanged aggregation
boundary.

**Documentation impact**
None expected beyond what TASK-002 already covers (this task reuses,
rather than changes, the aggregation contract).

**Acceptance criteria**
- [x] An authorized (member or admin) caller gets the correct
      closed-period aggregate + trend for the requested `teamId`.
- [x] A denied caller's request never triggers a
      `pulseSurveyResponses` read for that team.
- [x] The open/current period is never present in any response, for any
      caller.
- [x] `/api/results`, `get-dashboard.ts`, and `TEAM_ASSIGNMENTS` are
      unmodified by this task's diff.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- `get-team-results.ts` redeclares `ResultsQueryRecord` and a
  `GetTeamResultsCollection` interface rather than importing
  `get-dashboard.ts`'s `ResultsCollection` — that interface's
  `listForTeamAndPeriods(teamId: TeamId, ...)` is typed to the static
  `TeamId` union (`"platform" | "web-app" | ...`), which cannot accept an
  arbitrary Firestore-backed opaque `teamId`. The widened interface is a
  thin query-seam type variant only (same shape, same default Firestore
  query, `teamId: string` instead of `TeamId`) — it duplicates no
  decrypt/validate/threshold/trend logic; `computePeriodAggregate` and
  `listPrecedingClosedPeriods` are imported and reused unchanged, and
  `get-dashboard.ts` itself was not modified (empty diff, confirmed).
  This mirrors the established per-operation `getDefaultCollection()`
  pattern already used throughout TASK-001/TASK-002 (`create-team.ts`,
  `list-team-members.ts`, etc.) rather than introducing a new shared
  abstraction.
- The tiny `groupByPeriod` helper is duplicated (not imported) from
  `get-dashboard.ts` since it is unexported there and that file was not
  to be modified; it is a plain period-keyed `Map` builder, not
  aggregation/decrypt/threshold logic.
- Denial (`"forbidden"`) is returned for every unauthorized case —
  non-member, cross-team, nonexistent `teamId`, and a malformed
  `teams`/`teamMemberships` document surfaced through
  `authorizeTeamAccess`'s existing fail-closed behavior — with an
  identical response shape in all cases (`{ status: "forbidden" }`, HTTP
  403), so no case leaks a distinguishing signal about *why* access was
  denied or whether the team exists (BR-16, reused from TASK-002).

**Post-review fix (review-change finding, Important)**
`authorizeTeamAccess` previously let a Firestore read failure (team
status or membership) escape as an unhandled rejection, which
`getTeamResults` did not catch — the only production caller of
`authorizeTeamAccess` at the time. Fixed by changing
`authorizeTeamAccess`'s return type from a bare `TeamAccessLevel` to
`AuthorizeTeamAccessResult` (`{ok: true, access: TeamAccessLevel} |
{ok: false, error: "read_failed"}`), matching the `{ok, error}` shape
already used by `GetTeamResultsResult`/`ListTeamMembersResult`/
`RequireAppAdminResult`. Both Firestore reads inside
`authorizeTeamAccess` are now wrapped in `try/catch`; a read failure
never resolves to `"denied"` (so a genuine denial stays distinguishable
from an infrastructure failure for every future caller, not just this
one) and never reaches `pulseSurveyResponses`. `getTeamResults` maps
`{ok: false}` to the same `"read_failed"` result already used for its
own results-query failure. No internal error detail is included in
either result. Tests added for both read-failure sites (team-status,
membership), at both the `authorizeTeamAccess` and `getTeamResults`
boundaries, asserting `read_failed`, zero `pulseSurveyResponses`
queries, no leaked error text, and no logging. All prior TASK-002/
TASK-003 authorization tests updated to the new result shape and still
pass unchanged in behavior.

---

### TASK-004 — Team invitations (domain/server)

**Status:** Done
**Covers:** BR-17, BR-18, BR-19, BR-20, BR-21, BR-22, BR-30 (invitations half), BR-35 (teamInvitations)

**Depends on:** TASK-002

**Outcome**
An app admin can invite an email to a team. If a Firebase-verified account
with that email already exists, membership is created immediately; if
not, a pending, idempotent `teamInvitations` record is stored and later
resolved into membership the next time a signed-in user with that exact
verified email is seen by a team-scoped request. Cancel is supported. An
admin can list a team's pending invitations.

**Implementation notes**
- `teamInvitations/{compositeId}` (`${teamId}__${normalizedEmail}`) per
  SPEC → Architecture decisions → "Firestore collections". Normalize
  (trim + lowercase) before every store/match.
- Resolution ("resolve my pending invitations") should be a small,
  reusable server function called from any team-scoped request path
  (this task provides the function; TASK-007/TASK-008 call it) — look up
  by `email == normalizedCallerEmail AND status == "pending"`, and only
  proceed if the caller's token has `emailVerified === true`.
- Add the new composite index (`email` ascending, `status` ascending) to
  `firestore.indexes.json`, mirroring the existing
  `pulseSurveyResponses` entry (`docs/DEVELOPMENT.md`).
- Firestore rules: explicit deny block for `teamInvitations/{document=**}`.
- Re-inviting while `status: "pending"` is a no-op success, not an error
  (BR-19). Inviting an existing member is rejected (BR-22) — check
  `teamMemberships` directly, not just invitation state.

**Verification**
- Immediate-membership-if-account-exists path, pending-if-not path
  (BR-18).
- Re-invite idempotency, cancel-then-never-auto-resolves, already-member
  rejection (BR-19, BR-21, BR-22).
- Resolution only fires for a verified matching email, never an
  unverified one (BR-20).
- Admin-only enforcement on invite/cancel/list-pending.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
Invitation email is the only PII this feature persists ahead of a
verified account existing (SPEC → Security and privacy → "Invitation
email retention") — never copied into `teamMemberships`.

**Documentation impact**
`docs/DATA-MODEL.md` (add `TeamInvitation`), `docs/DEVELOPMENT.md` (new
composite index).

**Acceptance criteria**
- [x] Inviting an email with an existing verified account creates
      membership immediately, no pending record.
- [x] Inviting an email with no matching account creates exactly one
      pending invitation; inviting it again while pending creates no
      second record.
- [x] A signed-in caller with a verified matching email gets membership
      created via the resolution function; an unverified matching email
      does not.
- [x] Canceling a pending invitation prevents any later auto-resolution
      for that (team, email) pair.
- [x] Inviting an already-member's email creates no duplicate
      invitation/membership.
- [x] Only an app admin can invite, cancel, or list pending invitations.
- [x] `firestore.indexes.json` includes the `teamInvitations`
      `(email, status)` composite index; `firestore.rules` denies
      client-SDK access to `teamInvitations`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **Data model implemented exactly per SPEC**:
  `teamInvitations/{teamId}__{normalizedEmail}` — `{ teamId, email,
  status: "pending"|"accepted"|"canceled", invitedBy, createdAt,
  updatedAt, resolvedAt?, resolvedUid? }`. `src/features/teams/domain/
  team-invitation.ts` owns the doc-id builder and three fail-closed
  validators (`isValidPendingInvitationFor`, `readInvitationStatusFor`,
  `isValidPendingInvitationForTeam`) mirroring `team-membership.ts`'s
  established pattern — a malformed/mismatched document is always treated
  as absent/non-pending, never trusted via an unchecked cast.
- **Invitation state machine**: `pending` → `accepted` (via
  `resolveInvitations`, or implicitly skipped when membership is granted
  immediately at invite time because a verified account already exists —
  BR-18 never creates a pending record in that case) or `pending` →
  `canceled` (via `cancelInvitation`, admin-only). A `canceled` or
  `accepted` invitation can be re-invited, which overwrites the
  deterministic document back to a fresh `pending` record (re-inviting
  after cancellation is a normal admin action; nothing in SPEC forbids
  it). Re-inviting while already `pending` is a no-op (`invitation_
  already_pending`, BR-19). `cancelInvitation` is idempotent: canceling a
  nonexistent or already-non-pending invitation succeeds without a write.
- **`createInvitation`** (`src/features/teams/server/create-invitation.ts`)
  order of checks, matching requirement 3/4's ordering: admin gate → email
  normalize/validate → team exists and is `active` (fail closed to
  `team_not_found` for both a missing team and a malformed/unrecognized
  `status`, `team_disabled` for an existing disabled team — never creates
  or revives a team) → Firebase Auth lookup by email (`getUserByEmail`,
  wrapped to return `null` for `auth/user-not-found` and rethrow any other
  error as a controlled `lookup_failed`) → if an account exists, check
  `teamMemberships` first (`already_member` no-op per BR-22, checked
  *before* looking at `emailVerified`) → grant membership immediately only
  if verified (BR-18), via `grantTeamMembership`'s atomic check-and-set
  (see "Race-safe membership grant" below) → otherwise (unverified
  account, or no account at all) fall through to the idempotent
  pending-invitation path (BR-19). Whenever this resolves to an existing
  or newly-created membership (`already_member` or `membership_created`),
  `acceptMatchingPendingInvitation` transitions a matching **currently-
  `"pending"`** `teamInvitations` record to `"accepted"` (with
  `resolvedAt`/`resolvedUid`) — see "Post-review fix: stale pending
  invitation after immediate grant" below.
- **`resolveInvitations`**
  (`src/features/teams/server/resolve-invitations.ts`) takes an
  already-verified `VerifiedIdentity`, not an `idToken` — it's designed to
  be composed into a request path (TASK-007/TASK-008) that has already
  verified the caller's token for its own authorization purposes, avoiding
  a redundant re-verification. An unverified caller returns immediately
  (`{ok:true, membershipsCreated:0}`, not an error — BR-20's "never
  triggers resolution" is a no-op, not a failure). Exact-match
  normalization (`normalizeEmail`) means a different user's invitation, or
  one under the caller's *previous* email, is structurally unreachable —
  the Firestore query itself is scoped to the caller's own normalized
  email, so there is no cross-user resolution path to guard against
  separately.
- **Idempotency/race-handling**: `resolveInvitations` first lists
  candidate `(teamId)` values via a plain query (`email == X AND status ==
  "pending"`), then calls one `resolveOne(teamId, email, uid, now)` per
  candidate. `resolveOne` is the atomic unit — in production it's a single
  Firestore transaction (`runTransaction`) that re-reads both the
  invitation and the membership document *inside* the transaction and only
  then decides: membership already exists → idempotent no-op that also
  tidies up a stale `pending` invitation to `accepted` (handles the case
  where `createInvitation` already granted membership directly and an
  older pending invitation for the same email/team was left behind, e.g.
  from before the account existed) → invitation no longer `pending` (raced
  by a cancel, or already resolved by a concurrent call) → `no_longer_
  pending`, no write → otherwise create the membership (`grantedBy` =
  the invitation's own `invitedBy`, preserving accountability back to the
  original inviting admin) and mark the invitation `accepted`, atomically.
  Firestore's transaction serialization is what makes two concurrent
  resolution attempts for the same (email, teamId) race-safe by
  construction, not by best-effort application logic — exercised in tests
  via a fake `resolveOne` that faithfully reproduces this re-check-inside-
  the-atomic-unit semantics against an in-memory store, including a
  sequential-duplicate-call test proving only one membership is ever
  created.
- **Admin API surface**: `app/api/admin/teams/[teamId]/invitations/
  route.ts` — `GET` (list pending), `POST` (invite, body `{email}`),
  `DELETE` (cancel, body `{email}`) — grouped into one route file per the
  existing `app/api/admin/teams/route.ts` (`GET`+`POST`) precedent, rather
  than inventing an awkward `[email]` URL segment for an address that can
  contain reserved characters. No resolution endpoint was added in this
  task — SPEC's Outcome states TASK-007/TASK-008 call `resolveInvitations`
  directly as part of their own request handling; TASK-004 provides only
  the function.
- **Data minimization**: no `users` collection added; `email` is
  persisted only on the pending `teamInvitations` document (never on
  `teamMemberships`, confirmed by both `create-invitation.test.ts`'s and
  `resolve-invitations.test.ts`'s membership-write assertions, which check
  the exact written shape); no audit-log system; `APP_ADMIN_EMAILS` is
  never included in any result (asserted per-operation, matching TASK-001/
  TASK-002's established test pattern).

**Post-review fix (review-change finding, Important): stale pending
invitation after immediate grant**
`review-change` found that `createInvitation`'s immediate-grant and
already-member paths never touched a pre-existing `teamInvitations`
record for the same (teamId, email): if an admin invited an email while no
account existed (pending record stored), and that email later became a
verified account that was invited again (or independently gained
membership), the membership was correctly created/confirmed but the
earlier record was left `status: "pending"` indefinitely — `listTeam
Invitations` (BR-30) would keep showing that person as pending even
though they were already a member, with nothing in TASK-004's own shipped
scope to ever clean it up (`resolveInvitations` only runs once a later
task wires it into a request path).

Fixed by adding `acceptMatchingPendingInvitation`
(`create-invitation.ts`): whenever `createInvitation` confirms or creates
membership through a verified account, it re-reads the invitation for the
exact (teamId, normalized email) and — only if it's still `"pending"` —
transitions it to `"accepted"` with `resolvedAt`/`resolvedUid` set to the
member's `uid`. Chosen state-transition model: **no new invitation
record is ever created purely to represent an immediate grant** (matches
BR-18's "no pending state" plus the data-minimization posture already
established for this collection — a membership document is itself the
durable grant record); only an *already-existing* `"pending"` record is
transitioned. A `"canceled"` invitation is never silently revived
(BR-21 stays intact — canceled records are left untouched by this cleanup,
distinct from an admin's own deliberate re-invite via the pending-creation
path, which still overwrites a canceled/accepted record back to a fresh
`"pending"` one as before). An already-`"accepted"` record is left
untouched (no duplicate `resolvedAt` overwrite, no regression to
`"pending"`). A failure during this transition is reported as
`persistence_failed` — not swallowed into a false `ok:true` — even though
the membership write that preceded it already succeeded (retrying is
safe: both the membership grant and the invitation transition are
idempotent on retry).

**Post-review fix (review-change finding, Suggestion): `grantedBy`
attribution race**
The same review noted a narrow race: `createInvitation`'s immediate-grant
path previously wrote `teamMemberships` with a plain, non-transactional
`.set()`, which could race against `resolveInvitations`' already-
transactional `resolveOne` writing the same deterministic membership
document for the same (uid, teamId) — whichever write landed last would
silently win, making the `grantedBy` accountability field non-
deterministic under that interleaving (never a duplicate-membership or
authorization issue, only an attribution one).

Fixed by extracting the shared atomic decide-and-write primitive
`applyMembershipGrant` (`src/features/teams/server/
grant-team-membership.ts`): given a membership document's existence as
already read *inside* a transaction, it creates the document only if
absent and returns `"created"` or `"already_member"`. `createInvitation`
now calls the standalone `grantTeamMembership` entry point, which opens
its own dedicated single-document transaction around this primitive;
`resolveInvitations`' `resolveOne` calls `applyMembershipGrant` directly
inside its own larger transaction (which also needs to atomically touch
the invitation document). Both paths now go through the exact same
check-and-set decision, each under a real Firestore transaction against
the same deterministic membership doc id — Firestore's optimistic
concurrency control means whichever transaction commits first is
authoritative (its `grantedBy` sticks) and the other is forced to retry,
re-observe the document as existing, and return `"already_member"`
without overwriting it. `resolveInvitations`' own 14 pre-existing tests
pass unchanged (behavior-preserving refactor); `grant-team-membership.
test.ts` adds direct coverage of the shared primitive, including a test
that two sequential grant attempts for the same (uid, teamId) persist only
the *first* attempt's `grantedBy`, never the second's — and
`create-invitation.test.ts` adds a test proving `createInvitation`
correctly reports `already_member` (not `membership_created`) when the
transactional grant discovers a concurrently-created membership,
simulating `resolveInvitations` having won the race.

---

### TASK-005 — Team access requests (domain/server)

**Status:** Done
**Covers:** BR-23, BR-24, BR-25, BR-26, BR-27, BR-28, BR-30 (access-requests half), BR-35 (teamAccessRequests)

**Depends on:** TASK-002

**Outcome**
A non-member can request access to a team; at most one active request
exists per (uid, team) pair, enforced by a deterministic document ID and
transactional writes. An app admin can approve (atomically creating
membership) or reject a pending request. A previously rejected request
can be resubmitted. An admin can list a team's pending requests.

**Implementation notes**
- `teamAccessRequests/{compositeId}` (`${uid}__${teamId}`), no persisted
  email (SPEC → Architecture decisions → "Firestore collections";
  requester email for admin display is resolved on demand via
  `getAdminAuth().getUser(uid)`, reusing the same pattern TASK-002 used
  for member emails).
- Approve/reject/create-or-reset-to-pending must be a Firestore
  transaction (read-modify-write) on the single deterministic document to
  satisfy BR-24/BR-27's race-freedom guarantee (SPEC → Edge cases →
  concurrent request/approval races).
- Reject a request outright (no-op) if the caller already holds
  membership for that team (BR-28).
- Add the new composite index (`teamId` ascending, `status` ascending) to
  `firestore.indexes.json`.
- Firestore rules: explicit deny block for
  `teamAccessRequests/{document=**}`.

**Verification**
- Duplicate pending-request prevention under concurrent submission
  (simulated via two calls against the same fake/transactional seam).
- Resubmission after rejection resets to pending; already-member request
  is rejected as a no-op.
- Approve creates exactly one membership + marks the request `approved`
  with resolver/timestamp; reject creates no membership.
- Admin-only enforcement on approve/reject/list-pending.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
Transactional writes on a deterministic ID are the concrete mechanism
behind the "prevented by construction" claim in SPEC → Security and
privacy → "Duplicate/race conditions" — the tests here are what makes
that claim verifiable rather than aspirational.

**Documentation impact**
`docs/DATA-MODEL.md` (add `TeamAccessRequest`), `docs/DEVELOPMENT.md`
(new composite index).

**Acceptance criteria**
- [x] A non-member can create exactly one pending request per team; a
      second concurrent/duplicate submission never creates a second one.
- [x] Approving creates exactly one membership and marks the request
      `approved` with `resolvedBy`/`resolvedAt`; rejecting creates no
      membership and marks it `rejected`.
- [x] A rejected request can be resubmitted and returns to `pending`.
- [x] A member cannot create a new access request for their own team.
- [x] Only an app admin can approve, reject, or list pending requests.
- [x] `firestore.indexes.json` includes the `teamAccessRequests`
      `(teamId, status)` composite index; `firestore.rules` denies
      client-SDK access to `teamAccessRequests`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **Data model implemented exactly per SPEC**: `teamAccessRequests/
  {uid}__{teamId}` — `{ teamId, uid, status: "pending"|"approved"|
  "rejected", createdAt, resolvedAt?, resolvedBy? }`, deliberately no
  persisted email (matches `TeamMembership`'s `uid`-only shape, not
  `TeamInvitation`'s email-keyed shape — an access request is always
  created by an already-authenticated `uid`, so there's nothing to match
  a not-yet-existing account against). `src/features/teams/domain/
  team-access-request.ts` owns the doc-id builder and three fail-closed
  validators mirroring `team-invitation.ts`'s established pattern.
- **Creation semantics** (`create-access-request.ts`): `verifyIdToken`
  (revocation-checked) → `emailVerified` gate (`"unverified"`, distinct
  from `"unauthenticated"`) → `authorizeTeamAccess` (reused unchanged) —
  `"admin"`/`"member"` short-circuits to `already_authorized` (BR-28,
  checked *before* any team-status read, so an existing member/admin of a
  *disabled* team is never wrongly told `team_disabled`) → only once
  access is `"denied"` does a direct team-status read run, explicitly
  rejecting `"disabled"` (SPEC edge case) while treating a nonexistent or
  malformed status *identically* to an existing-but-unrelated `active`
  team from that point on — both proceed through the exact same
  `createOrReset` call, so no distinguishing existence signal is ever
  returned for a `teamId` the caller has no relationship to (SPEC → Edge
  cases → "Requesting access to a nonexistent teamId"). This mirrors
  `createInvitation`'s fail-closed team check but deliberately does *not*
  return a distinguishable `team_not_found` error the way `createInvitation`
  does — that task is admin-only (an admin already sees the full team
  list); this one is any-verified-user-initiated, where SPEC explicitly
  forbids a team-existence oracle.
- **Approval/rejection state machine**: `pending` → `approved`
  (`approveAccessRequest`, atomically grants membership) or `pending` →
  `rejected` (`rejectAccessRequest`, never touches `teamMemberships`).
  Both are strict: only a genuinely `"pending"` request transitions;
  `"already_approved"`/`"already_rejected"`/`"not_pending"`/`"not_found"`
  are all no-op outcomes (`ok:true`, never an error — matches the
  established `cancelInvitation`-style "nothing to do" convention).
  Approving an already-`"approved"` request deliberately never re-attempts
  a membership write, even though the membership *might* have since been
  removed by an admin — resurrecting a deliberately-removed membership via
  a stale retry would be worse than leaving it removed; SPEC's BR-25
  resubmission path (via a fresh access request, not a re-approval) is the
  correct way back to membership in that case.
- **Race safety / transaction strategy** — three narrowly-scoped
  transactions, each touching only the documents it needs:
  - `createOrReset` (in `create-access-request.ts`): reads the request
    *and* the membership document together. Two concurrent create calls
    for the same (uid, teamId) converge to exactly one `"pending"`
    document (BR-24). **Post-implementation-review fix**: the first draft
    only read the request document, which left a narrow window where a
    duplicate/racing create call reading *after* a concurrent approval
    committed could reset `status:"approved"` back to `"pending"` (a lost
    update) even though `authorizeTeamAccess`'s own earlier, non-
    transactional pre-check had seen `"denied"` (stale). Reading the
    membership document *inside the same transaction* closes this: if
    membership now exists — regardless of which operation granted it, or
    when — `createOrReset` returns `"already_authorized"` and never
    writes, so a completed approval can never be silently overwritten by
    a racing duplicate request (SPEC → Edge cases → "Concurrent approval
    and a duplicate request for the same pending access request").
  - `approveOne` (in `approve-access-request.ts`): reads the request, and
    — only once it's confirmed `"pending"` — reads the membership document
    and calls the *same* `applyMembershipGrant` primitive TASK-004's
    `resolveInvitations` uses (`grant-team-membership.ts`, reused
    unchanged, not modified for this task). Two concurrent approvals for
    the same request: Firestore's transaction serialization means only
    one commits the `pending→approved` transition and the membership
    write; the other retries, re-observes `"approved"`, and returns
    `"already_approved"` without a second write (no duplicate membership,
    deterministic `grantedBy` attribution — same first-committer-wins
    guarantee TASK-004 established for `createInvitation` vs
    `resolveInvitations`, now extended to a third caller of the same
    primitive).
  - `rejectOne` (in `reject-access-request.ts`): reads only the request
    document — rejection never needs to touch `teamMemberships` at all.
    An approve/reject race converges safely regardless of which commits
    first: whichever loses re-reads the new status and returns a no-op
    outcome rather than corrupting it (tested directly in
    `reject-access-request.test.ts`'s "approve/reject race convergence"
    suite, exercising both orderings against one shared in-memory store).
  - No general transaction framework was added — each of the three
    functions above defines its own minimal, purpose-specific
    `runTransaction` call, matching the granularity already established
    by `resolve-invitations.ts`'s `resolveOne` and
    `grant-team-membership.ts`'s `grantTeamMembership`.
- **Admin API surface**: `GET /api/admin/teams/[teamId]/access-requests`
  (list pending) and `PATCH /api/admin/teams/[teamId]/access-requests/
  [uid]` with body `{status: "approved"|"rejected"}` — mirrors the
  existing team-status PATCH precedent (`app/api/admin/teams/[teamId]/
  route.ts`) rather than inventing new verbs. Non-admin creation:
  `POST /api/teams/[teamId]/access-requests` (new, since no user-facing
  per-team route existed yet outside `GET .../results`).
- **`docs/features/team-management/TASKS.md` requirement 14 (TASK-004
  known suggestion)**: not touched. `create-invitation.ts`'s
  `acceptMatchingPendingInvitation` non-transactional read/write race
  against a concurrent `cancelInvitation` (flagged as a Suggestion in
  TASK-004's second review) remains an accepted, non-blocking, metadata-
  only limitation — this task's own race-hardening work (above) was
  entirely additive to new access-request code and never touched
  invitation logic.
- **Data minimization**: no `users` collection added; no email field on
  `teamAccessRequests` at all (stricter than invitations, per SPEC);
  requester email for admin display is resolved live via
  `getAdminAuth().getUser(uid)`, mirroring `listTeamMembers`'s pattern
  exactly; `APP_ADMIN_EMAILS` never included in any result.

---

### TASK-006 — Dynamic team source for the public pulse survey + legacy seed

**Status:** Done
**Covers:** BR-3 (excluded from public survey selector), BR-31, BR-32

**Depends on:** TASK-001

**Outcome**
The public pulse-survey form's team selector, and the submission
endpoint's `teamId` validation, both read from the Firestore `teams`
collection's `active` set instead of the static `ALLOWED_TEAM_IDS` array.
A one-time seed step creates `teams` documents for the four existing
`ALLOWED_TEAM_IDS` values, using each literal string as an explicitly
assigned document ID, preserving continuity for any pre-existing
`pulseSurveyResponses.teamId` value.

**Implementation notes**
- Add a small, unauthenticated server read (active teams' `{teamId,
  name}`) used by both the survey page (to render the selector) and the
  submission endpoint (to validate the submitted `teamId`) — one
  authoritative source, per BR-31/BR-32.
- **Do not delete** `ALLOWED_TEAM_IDS`/`isAllowedTeamId`/`TeamId` from
  `src/features/pulse-survey/domain/teams.ts` in this task —
  `src/features/teams/domain/team-assignments.ts` (not yet retired) still
  imports from it, and the old `/results` path must keep working
  unmodified (Migration strategy point 1). Only the pulse-survey
  selector/validation stops *reading* from it. Full deletion is
  TASK-011's job.
- Seed step: a one-time, explicitly-triggered script or task-scoped
  utility (not run automatically on every server start) that creates the
  four `teams` documents with `status: "active"` if they don't already
  exist — idempotent, safe to re-run.

**Verification**
- Submission with a `teamId` that is `active` in Firestore succeeds;
  `disabled` or unknown `teamId` is rejected exactly as an invalid
  `teamId` is today (same error shape as the existing invalid-`teamId`
  case in `submit-pulse-survey.test.ts`).
- The public team-list read returns only `active` teams, unauthenticated.
- Seed step creates the four legacy `teamId`s exactly once, is safe to
  re-run, and does not touch any other `teams` document.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
No change to Phase 1 anonymity/dedup-free behavior (Confirmed invariant
9) — only the source of valid `teamId`s changes, still validated
server-side before acceptance.

**Documentation impact**
`docs/features/pulse-survey/SPEC.md` (note the team-list source has moved
to Firestore, without rewriting its historical Phase-1-implemented
content), `docs/DEVELOPMENT.md` (seed-step instructions replacing the
"add a `TEAM_ASSIGNMENTS` entry" local-setup note only once TASK-011 also
retires that note — for now, add the seed step alongside it).

**Acceptance criteria**
- [x] The survey selector reflects Firestore `active` teams, not the
      static array.
- [x] Submitting a `disabled` or unknown `teamId` is rejected; nothing is
      persisted.
- [x] The four legacy team IDs exist as `teams` documents with those
      exact IDs after running the seed step once (and after running it
      twice).
- [x] `ALLOWED_TEAM_IDS`/`isAllowedTeamId` still exist and
      `team-assignments.ts`/old `/results` path still function unmodified.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **Dynamic team source, one authoritative read**:
  `src/features/teams/server/list-active-teams.ts` (`listActiveTeams`) is a
  new, unauthenticated, public server operation — a single-field Firestore
  query (`status == "active"`, no composite index needed) exposing only
  `{teamId, name}`. It is the sole source for both the survey page's
  server-rendered selector (`app/pulse-survey/page.tsx`, now `export const
  dynamic = "force-dynamic"` so a build-time static prerender can never
  freeze the team list — Firestore is read fresh on every request) and
  `submitPulseSurvey`'s submission-time validation
  (`src/features/pulse-survey/server/submit-pulse-survey.ts`, via an
  injectable `ActiveTeamsSource` deps seam defaulting to `listActiveTeams`
  itself, mirroring the codebase's established per-operation
  `getDefaultCollection()`-style seam pattern). A malformed individual
  `teams` document (missing/invalid `status`, non-string or blank `name`)
  is excluded from the result rather than failing the whole read; a
  Firestore read failure fails the entire read closed
  (`{ok:false, error:"read_failed"}`) rather than returning a partial list
  or ever falling back to the old static array.
- **Submission validation split across two layers**: `validateSubmission`
  (pulse-survey domain) now only checks *shape* — `teamId` is a non-empty
  string — since the actual "is this currently an active team" check
  requires an async Firestore read and is no longer a domain-layer concern.
  `submitPulseSurvey` performs that check immediately after structural
  validation and before period computation/encryption/persistence (order
  preserved exactly, per SPEC's requirement 10), re-reading
  `listActiveTeams` fresh on every call — never a cached/page-load-time
  snapshot. This directly closes the TOCTOU window: a team active when the
  selector rendered but disabled/removed before submission is rejected at
  submission time. A disabled, nonexistent, or malformed `teamId` all
  resolve to the exact same `invalid_submission` result as any other
  invalid submission (BR-32's "rejected exactly as an invalid teamId is
  today") — no distinguishing signal. A Firestore failure *during* team
  validation is reported as a new, distinct `team_validation_failed` error
  (mapped to HTTP 500 in `app/api/pulse-survey/route.ts`, alongside
  `persistence_failed`/`encryption_failed`), so an infrastructure failure
  is never conflated with, or silently treated as, a valid rejection — and
  in both cases no `pulseSurveyResponses` write is attempted.
- **Legacy seed migration**: `src/features/teams/domain/legacy-team-seed.ts`
  derives `LEGACY_TEAM_SEEDS` directly from the existing
  `ALLOWED_TEAM_IDS` (`src/features/pulse-survey/domain/teams.ts`) —
  `{teamId, name}` pairs where `name` equals the legacy `teamId` string
  itself, per SPEC's Architecture decisions ("name set to the same string
  initially") — rather than re-typing the four literal IDs a second time,
  so the two lists cannot drift. `src/features/teams/server/
  seed-legacy-teams.ts` (`seedLegacyTeams`) is app-admin-gated (via the
  existing `requireAppAdmin`, same trust boundary as every other admin
  operation) and, for each legacy id, checks existence before writing:
  an existing document — active or disabled — is left completely
  untouched (never overwritten, never silently re-enabled), and only a
  missing id is created as `active`. Each legacy id's own outcome
  (`"created" | "already_exists" | "failed"`) is reported individually, so
  a single write failure is never masked by an overall success, without
  leaking raw Firestore error text. This is a plain read-then-write
  (non-transactional) rather than a Firestore-transaction- or
  `.create()`-based race-safe primitive: correctness here only needs
  "safe to re-run sequentially" (the acceptance criterion), not
  concurrent-invocation safety, for a rarely-run, explicitly-triggered,
  admin-only, one-time migration — deliberately not the heavier pattern
  TASK-004/005 use for hot, multi-actor paths (invitations, access
  requests).
- **Explicit trigger, no new tooling**: exposed as
  `POST /api/admin/teams/seed-legacy` (admin-gated, thin route mirroring
  the existing `app/api/admin/teams/route.ts` pattern) rather than a
  standalone script — the repo has no existing TS script-runner
  infrastructure (no `ts-node`/`tsx` dependency, no `scripts/` directory),
  and adding one for a single one-time seed would be the "broad migration
  framework" SPEC explicitly says not to build. Nothing calls this route
  automatically; it must be invoked manually by an app admin (see
  `docs/DEVELOPMENT.md` — Local Firebase setup, step 10).
- **Static source retirement, scoped exactly to this task**:
  `ALLOWED_TEAM_IDS`/`isAllowedTeamId`/`TeamId`
  (`src/features/pulse-survey/domain/teams.ts`) are **not** deleted —
  `legacy-team-seed.ts` reads `ALLOWED_TEAM_IDS` for the seed migration,
  and `src/features/teams/domain/team-assignments.ts` (not yet retired)
  still imports `isAllowedTeamId`/`TeamId` for the old `/results` path,
  per Migration strategy point 1 (coexistence). Only the pulse-survey
  selector and submission validation stopped *reading* from them.
  `TEAM_ASSIGNMENTS`, `resolveTeamForUser`, `get-dashboard.ts`, and
  `/api/results` are untouched by this task's diff (confirmed: no changes
  outside `app/api/pulse-survey/`, `app/pulse-survey/`,
  `src/features/pulse-survey/`, and new/existing files under
  `src/features/teams/`). Full deletion remains TASK-011's job.
- **No Firestore rules/index changes needed**: the `teams` collection's
  explicit deny block already existed from TASK-001 (`listActiveTeams` and
  `seedLegacyTeams` both use the Admin SDK, which bypasses rules entirely,
  same as every other server operation); the single-field `status`
  equality query needs no new composite index (see `docs/DEVELOPMENT.md`).

---

### TASK-007 — `/teams` overview page

**Status:** Done
**Covers:** BR-3 (excluded from non-member discovery), BR-11, BR-12 (open-link behavior), BR-13, BR-23 (submit request from UI)

**Depends on:** TASK-005

**Outcome**
An authenticated, verified user loads `/teams` and sees every active
team's name plus their relationship to it (`admin`, `member`, `request
pending`, `request rejected`, or `none`), with a working "request access"
action for `none`/`rejected`. An unauthenticated visitor is prompted to
sign in and sees no team data. Loading this page also triggers pending
invitation resolution (TASK-004's resolution function) before relationships
are computed.

**Implementation notes**
- New `GET /api/teams` (or equivalent) server operation: for the caller,
  resolve invitations (TASK-004), then compute
  `{teamId, name, relationship}` for every `active` team plus any
  `disabled` team the caller has a relationship to (so an existing member
  doesn't lose visibility of a team an admin disabled).
- Client-side auth-state handling mirrors the existing
  `Dashboard.tsx`/`observeIdToken` pattern (`.claude/rules/nextjs-react.md`
  — Server Components by default, `"use client"` only where needed for
  the token-driven fetch).
- "Request access" action calls TASK-005's create-request operation.

**Verification**
- UI states: signed out, verified user with 0/1/many teams, admin, and
  each relationship value including pending/rejected.
- Requesting access from this page results in the same server state
  TASK-005's own tests already verify (integration through the UI layer,
  not re-testing the transactional logic itself).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
No team's protected results data is fetched or rendered by this page —
only names and the caller's own relationship (BR-11).

**Documentation impact**
`docs/PRODUCT.md` (multi-team membership, `/teams` surface).

**Acceptance criteria**
- [x] A verified user sees every active team's name and their own
      relationship only.
- [x] An unauthenticated visitor sees a sign-in prompt and no team data.
- [x] "Request access" on a `none`/`rejected` team creates/resets a
      pending request and the UI reflects `pending` afterward.
- [x] A pending invitation for the signed-in verified email resolves into
      a visible membership on this page's load.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **Overview DTO**: `getTeamsOverview` (`src/features/teams/server/
  get-teams-overview.ts`) returns `{teamId, name, relationship}[]` —
  `relationship` is one of `"admin" | "member" | "request_pending" |
  "request_rejected" | "none"`. No `status`, member/invitation/
  access-request identity, or result/aggregate data is ever included
  (asserted directly by a dedicated DTO-shape test). Order of operations
  matches SPEC's edge case exactly: `resolveInvitations` (TASK-004, reused
  unchanged) runs first, then `listActiveTeams` (TASK-006, reused
  unchanged) supplies the base active-team set, then the caller's own
  `teamMemberships`/`teamAccessRequests` documents (queried by `uid`,
  single-field, no new composite index needed) are read to compute each
  team's relationship. `isAppAdmin` (reused unchanged) makes every team
  `"admin"` for an app-admin caller, taking priority over any
  membership/request state.
- **Disabled-team visibility, scoped narrowly**: beyond the active set, an
  entry is added only for a team the caller has an actual
  `teamMemberships` or `teamAccessRequests` document for (so an existing
  member or requester never loses visibility of a team an admin has since
  disabled) — not for every disabled team merely because the caller is an
  app admin. That full-catalog "every team including disabled" view stays
  TASK-009's admin-only `listTeams` operation; overloading `/teams` with it
  here would blur the two surfaces SPEC keeps separate.
- **Fail-closed on malformed data**: a malformed membership/access-request
  document (missing/non-string `teamId`) is skipped rather than crashing or
  granting a relationship; a malformed or missing extra team document
  (invalid `status`, blank `name`, or deleted `teams` doc) is excluded from
  the result entirely, mirroring `listActiveTeams`'s established per-
  document validation pattern. A genuine Firestore read failure — active
  teams, the caller's own membership/request query, an extra team lookup,
  or invitation resolution itself — fails the whole result closed as
  `read_failed`, never a partial or stale list.
- **Route**: `GET /api/teams` (`app/api/teams/route.ts`), thin per
  `.claude/rules/nextjs-react.md` — identity comes only from the verified
  bearer token; `getTeamsOverview` owns all authorization/computation.
- **Request-access integration**: reuses TASK-005's existing `POST /api/
  teams/[teamId]/access-requests` endpoint unchanged — no new server logic
  was added for this action. The client gateway
  (`src/features/teams/client/teams-overview-gateway.ts`) only forwards the
  call and narrows the response shape; after any outcome (`created`,
  `already_pending`, or `already_authorized`) the UI re-fetches the whole
  overview from the server rather than guessing the resulting relationship
  client-side (`already_authorized` in particular could mean either
  `member` or `admin`, which only the server knows).
- **UI**: `TeamsOverview` (`src/features/teams/components/
  TeamsOverview.tsx`), a client component mirroring `Dashboard.tsx`'s
  `observeIdToken`-driven fetch pattern exactly, rendered from the new
  `/teams` page (`app/teams/page.tsx`, kept thin). States covered: loading,
  signed out, unauthenticated (server-reported), read failure, zero active
  teams, and each relationship value with a "Request access" action shown
  only for `none`/`request_rejected`. No link to `/teams/[teamId]` was
  added — that page does not exist yet (TASK-008) and SPEC's own task
  ordering does not ask TASK-007 to add navigation groundwork toward it, so
  a dead link was avoided.
- **Navigation**: added a `/teams` entry to `SiteHeader`'s static nav
  alongside the existing pulse-survey/results/sign-in links.

### TASK-008 — `/teams/[teamId]` page

**Status:** Done
**Covers:** BR-12 (open behavior), BR-14 (UI), BR-15 (UI), BR-16 (UI)

**Depends on:** TASK-003, TASK-007

**Outcome**
An authorized member/admin opens `/teams/[teamId]` and sees that team's
closed-period aggregate + trend (reusing `PeriodSummary`/`TrendTable`). An
unauthorized caller (non-member, nonexistent team, or disabled team with
no relationship) sees only a non-sensitive "request access" state — the
results endpoint is never called for a denied caller.

**Implementation notes**
- Reuses TASK-003's endpoint and TASK-007's request-access UI pattern —
  do not duplicate the request-access component.
- Denial and nonexistent-team states render identically (BR-16); do not
  add a distinguishing UI signal beyond what `/teams`'s own listing
  already discloses.

**Verification**
- Authorized member/admin sees correct results; denied caller sees only
  the request-access state and no network call to the results endpoint
  fires for that state (or, if it does, asserts a denial response with no
  aggregate data — pick one and test it explicitly).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
This is the user-visible enforcement point for BR-15's "never queried for
a denied caller" — verify it at the UI/network boundary, not just the
server unit level already covered by TASK-003.

**Documentation impact**
None expected beyond TASK-007's `docs/PRODUCT.md` update.

**Acceptance criteria**
- [x] An authorized member/admin sees the same aggregate/trend shape
      Phase 2 already produces, scoped to the requested team only.
- [x] A denied caller sees only a request-access state, never
      results/aggregate/count data, for a nonexistent or unauthorized
      `teamId`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **No new metadata endpoint**: per SPEC's "prefer reusing `/teams`
  overview" guidance, `TeamDetail` (`src/features/teams/components/
  TeamDetail.tsx`) resolves the team's name and the caller's relationship
  by calling the existing, unchanged TASK-007 `fetchTeamsOverview` gateway
  and finding the entry for the route's `teamId`, and calls the existing,
  unchanged TASK-003 gateway (`src/features/results/client/
  team-results-gateway.ts`, new but a thin `fetch` wrapper mirroring
  `dashboard-gateway.ts`/`teams-overview-gateway.ts` exactly — no new
  server logic) for the authoritative result. See "Post-review fix" below
  for exactly which overview states skip that call versus fall through to
  it.
- **Race between the overview read and the results read**: if the results
  endpoint returns `"forbidden"` despite the overview call moments earlier
  showing `"member"`/`"admin"` (membership removed in between — SPEC edge
  case), the component fails closed to the denied state rather than
  trusting the now-stale overview relationship.
- **Generation guard extended to route changes**: `TeamDetail` mirrors
  `TeamsOverview`'s auth-generation-ref pattern, with `teamId` added to the
  data-loading effect's dependency array — a route change from one team to
  another tears down the previous `observeIdToken` subscription (bumping
  the generation, exactly like a sign-out/account-switch/token-refresh
  would) before starting a fresh load for the new team, so a slow response
  for team A can never render on team B's page. This does not rely on
  Next.js route-instance reuse/unmount behavior for the guarantee (TASK-008
  outcome note). Covered by `TeamDetail.test.tsx`'s
  "ignores team A's stale result once the route has changed to team B".
- **Request-access affordance reused, not duplicated**: `TeamDetail` calls
  the same `requestTeamAccess` gateway function `TeamsOverview` already
  uses (TASK-005's endpoint, unchanged) and shares its error-message
  mapping via the new `src/features/teams/components/
  request-access-messages.ts` (extracted from `TeamsOverview.tsx`,
  behavior-preserving — `TeamsOverview.test.tsx` passes unchanged) rather
  than re-implementing a second request-access component.
- **`/teams` navigation**: `TeamsOverview` now links a team's name to
  `/teams/[teamId]` when the caller's relationship is `"admin"` or
  `"member"` (BR-12's "can open that team's page from `/teams`"); a
  `"none"`/pending/rejected relationship still renders as plain text, no
  link, no client-derived authorization query parameter.
- **Results states**: `PeriodSummary`/`TrendTable` (Phase 2 components) are
  reused unchanged, so insufficient-data, published-with-count, and the
  12-period trend render with identical semantics to the Phase 2 dashboard.

**Post-review fix (review-change finding, Blocking): absent overview entry
was wrongly treated as a known denial**
`review-change` found that the original gating rule — call the results
endpoint only when the `/teams` overview's entry for this `teamId` has
relationship `"admin"`/`"member"`, otherwise render denied — was wrong for
one reachable case: `getTeamsOverview` deliberately does not enumerate
every `disabled` team for an app admin (that full catalog is TASK-009's
job), so an app admin with no `teamMemberships` document for a disabled
team got **no overview entry at all** and the old code treated that
absence as a known denial, never calling the results endpoint — even
though `authorizeTeamAccess` would correctly authorize them as `"admin"`.
This violated BR-3/BR-14 for that actor (fail-safe direction — under-
authorization, not a leak — but still a real, reachable defect).

Fixed by distinguishing a *known* negative relationship
(`"none"`/`"request_pending"`/`"request_rejected"`, reported by the trusted
backend) — which still skips the results call, unchanged — from an
*absent* overview entry, which is now treated as **ambiguous, not denied**:
`loadTeamDetail` falls through to the same `resolveViaResults` path used
for `"admin"`/`"member"`, always asking the authoritative
`GET /api/teams/[teamId]/results` → `getTeamResults` → `authorizeTeamAccess`
chain before rendering anything as denied. The overview never substitutes
for that server decision in either direction: a known-negative relationship
only ever *skips* an unnecessary request (an optimization), and an absent
entry now always *asks* rather than assuming. `resolveViaResults` is shared
by both the known-`"admin"`/`"member"` path and the ambiguous no-entry path
(passing the overview's `name` when known, `undefined` otherwise —
`TeamHeading` already falls back to a generic "Team" label), so there is no
duplicated ok/unauthenticated/forbidden/read_failed mapping. A `forbidden`
response from this fallback renders the exact same non-sensitive
denied/request-access state as a known denial (BR-16 — no distinguishing
existence signal), and no access-request can be submitted until that
authoritative call has resolved (the request-access button only ever
renders from the `"denied"` result, which for the ambiguous case is only
reached after the results call comes back `forbidden`). The existing
generation-ref/`teamId`-dependency race guard required no changes — it
already wraps the whole `loadTeamDetail` call, so the added fallback fetch
is covered by the same single check.

Tests added/changed (`TeamDetail.test.tsx`): a genuine `"none"`-relationship
case with a real team name (previously untested — the reviewer's low-cost
gap); the old "absent entry never calls results" test was replaced with
three tests — an app-admin-with-no-membership absent-entry case that
renders authorized results, a non-admin absent-entry case that falls back
to `forbidden` → denied, and a nonexistent-team case rendering the
identical non-sensitive denied state; a route-change race for the new
ambiguous-fallback results request (team A's late-resolving *authorized*
fallback result must never render on team B); and the optional
post-request-access account-switch race test (parity with
`TeamsOverview.test.tsx`'s equivalent). `authorizeTeamAccess`,
`getTeamResults`, `getTeamsOverview`, and the TASK-005 access-request
server logic were not touched — this was a client-only gating fix.

---

### TASK-009 — Admin area: teams list, create, disable/re-enable

**Status:** Done
**Covers:** BR-1 (UI), BR-2 (UI), BR-3 (UI)

**Depends on:** TASK-001

**Outcome**
An app admin has a UI to create a team, see every team (including
disabled ones), and disable/re-enable a team. A non-admin cannot reach
this UI's actions (server-enforced, not just hidden client-side).

**Implementation notes**
- Establishes the admin-area shell/layout TASK-010 extends.
- Client calls TASK-001's server operations directly; no new server logic
  in this task beyond what TASK-001 already provides.

**Verification**
- UI test: admin can create/disable/re-enable; a non-admin's attempt is
  rejected server-side even if the UI were bypassed (assert against the
  API, not just component rendering).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
No additional considerations beyond TASK-001 — this task only adds a UI
surface over already-authorized server operations.

**Documentation impact**
None expected.

**Acceptance criteria**
- [x] An app admin can create a team from the UI and see it appear,
      `active`.
- [x] An app admin can disable and re-enable a team from the UI.
- [x] The admin UI is unreachable/inert for a non-admin caller, and the
      underlying API rejects a non-admin request regardless of UI state.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **Route**: `/admin/teams` (`app/admin/teams/page.tsx`), kept thin —
  renders only `AdminTeams` (`src/features/teams/components/AdminTeams.tsx`).
  No broader admin-portal shell/layout was introduced beyond this single
  page; TASK-010 can add its own team-detail route alongside this one
  without requiring a shared layout to already exist.
- **Reuses TASK-001 unchanged**: a new client gateway
  (`src/features/teams/client/admin-teams-gateway.ts`) is a thin `fetch`
  wrapper around the existing, unmodified `GET`/`POST /api/admin/teams` and
  `PATCH /api/admin/teams/[teamId]` routes (`listTeams`/`createTeam`/
  `setTeamStatus`, all still gated by `requireAppAdmin` →
  `APP_ADMIN_EMAILS`). No new server logic, no new admin-authorization
  path, and no client-side admin check of any kind — a non-admin caller
  gets `{status:"forbidden"}` from `listTeams` itself and the UI renders a
  generic "you don't have permission" message that never confirms or
  denies allow-list membership.
- **Data minimization**: `GET /api/admin/teams`'s response includes each
  `Team`'s `createdAt`/`createdBy` on the wire (TASK-001's unchanged
  shape), but `admin-teams-gateway.ts`'s response parser explicitly maps
  each entry down to `{teamId, name, status}` before it ever reaches the
  component — not just left unrendered, actually dropped at the gateway
  boundary. The UI shows name, status, and `teamId` (the last one for
  admin/debug/future-navigation purposes, per TASK-009's own scope note) —
  no member lists, invitations, access requests, or survey data, all of
  which stay TASK-010's job.
- **Create UX**: a single name input + submit button. The server generates
  the opaque `teamId` (`createTeam`, unchanged) — the client never predicts
  or fabricates it; on success the component re-fetches the authoritative
  list (`loadForGeneration`) rather than optimistically inserting a
  client-built row. The submit button is `disabled` while a create is
  in-flight (mirrors `PulseSurveyForm`'s established `disabled={... ||
  status === "submitting"}` convention) plus a state-level reentrancy guard
  in the handler itself, so a rapid repeated submit cannot fire a second
  request.
- **Disable/enable UX**: each row's action button is a single explicit,
  state-dependent label ("Disable team" / "Enable team"), with the disable
  variant styled distinctly (red-bordered/red-text) from the neutral enable
  styling, as the accidental-click safeguard — no generic confirm-modal
  framework was introduced (none exists elsewhere in the repo to reuse, and
  SPEC/TASKS explicitly said not to build one just for this). Both
  directions re-fetch the authoritative list after the mutation rather than
  optimistically flipping the row's status client-side, and both are
  `disabled` while their own per-team action is pending (mirrors
  `TeamsOverview`'s per-team `actionStates` map pattern).
- **Stale-request protection**: `AdminTeams` mirrors `TeamsOverview`'s
  `generationRef` guard exactly — every async operation (initial list load,
  post-create refresh, post-status-change refresh) is applied only if the
  generation it started under is still current; sign-out, account switch,
  token refresh, and unmount each bump the generation first. Covered by
  dedicated tests: a stale create result is ignored after sign-out and
  after an account switch (asserting the *new* account's own, unrelated
  list is what actually renders — not a residual trace of the old
  account's attempted create), and a stale status-update result is ignored
  after an account switch.
- **No admin nav entry added**: `SiteHeader` is deliberately not
  auth-aware (existing comment, unchanged) and `APP_ADMIN_EMAILS` never
  reaches the client to conditionally decide whether to show a link — per
  SPEC's own allowance, a direct `/admin/teams` route is sufficient for
  this PoC rather than building auth-aware navigation or exposing any
  signal about admin status in shared nav.
- **Gateway error handling**: `GET /api/admin/teams` uses a `{teams}` /
  `{error}` body contract (not the `{status}` shape `dashboard-gateway.ts`/
  `team-results-gateway.ts` use); `admin-teams-gateway.ts` validates the
  parsed body's own fields regardless of HTTP status code (same
  trust-the-semantic-body principle as those gateways, adapted to this
  endpoint's actual contract), rejects a malformed team entry (e.g. an
  invalid `status` value) by failing the whole result to `"read_failed"`
  rather than rendering a partial list, and never surfaces raw
  fetch/JSON-parse error text.

---

### TASK-010 — Admin area: team detail (invitations, membership, access requests)

**Status:** Done
**Covers:** BR-17 (UI), BR-19 (UI), BR-21 (UI), BR-26 (UI), BR-27 (UI), BR-29 (UI), BR-30 (UI)

**Depends on:** TASK-004, TASK-005, TASK-009

**Outcome**
From a team's admin detail view, an app admin can invite a member by
email, see and cancel pending invitations, see and remove members, and
see and approve/reject pending access requests.

**Implementation notes**
- Reuses TASK-009's admin shell; calls TASK-004/TASK-005's server
  operations directly, adding no new server logic.
- Member/requester emails are resolved live per TASK-002/TASK-005's
  on-demand pattern — do not cache or store them client-side beyond the
  page's own render.

**Verification**
- UI test per action (invite, cancel invite, remove member,
  approve/reject request), each asserting the underlying server state
  change already covered by TASK-004/TASK-005's own tests.
- Non-admin cannot reach or effect any of these actions.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
Confirms BR-29's "admin sees member/requester emails, resolved live, not
persisted" holds through the UI layer too.

**Documentation impact**
None expected.

**Acceptance criteria**
- [x] An app admin can invite a member by email and see it as an
      immediate membership or a pending invitation, matching TASK-004's
      behavior.
- [x] An app admin can cancel a pending invitation, remove a member, and
      approve/reject a pending access request, each reflected immediately
      in the view.
- [x] A non-admin cannot reach or effect any team-detail admin action.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass (also verified
      `pnpm build`).

**Implementation notes (decisions)**
- **No new server logic**: `app/admin/teams/[teamId]/page.tsx` renders
  `AdminTeamDetail` (`src/features/teams/components/AdminTeamDetail.tsx`),
  which calls the existing, unmodified TASK-004/TASK-005 admin routes
  (`GET`/`POST`/`DELETE .../invitations`, `GET .../access-requests`,
  `PATCH .../access-requests/[uid]`) and the existing TASK-002 member
  routes (`GET`/`DELETE .../members[/uid]`) through a new thin gateway
  (`src/features/teams/client/admin-team-detail-gateway.ts`, one
  fetch-wrapper function per endpoint, mirroring
  `admin-teams-gateway.ts`'s per-operation-gateway/trust-the-body-over-
  status-code conventions exactly). No new API route, server operation, or
  Firestore read/write was added.
- **Team name/status without a new endpoint**: rather than add an admin
  "get one team" endpoint, `AdminTeamDetail` reuses the existing,
  unmodified TASK-009 `fetchAdminTeams` (full admin catalog, including
  disabled teams) and finds the entry matching the route's `teamId` —
  mirroring TASK-008's `TeamDetail` decision to reuse the `/teams`
  overview rather than add per-team metadata. A `teamId` with no matching
  entry (e.g. deleted between page-list and navigation) renders a
  dedicated `"not_found"` state rather than a fabricated view.
- **Combined load, fail-closed**: `loadTeamDetail` fetches the team
  catalog, members, pending invitations, and pending access requests in
  parallel; any `"unauthenticated"`/`"forbidden"` from any of the four
  short-circuits to that state (never a partial admin view for a caller
  who fails one check but not another), and any other non-`"ok"` result
  fails the whole load to `"read_failed"` — no section is ever rendered
  from a stale or partially-successful read.
- **Actions re-fetch the authoritative view, never optimistic updates**:
  invite/cancel-invitation/remove-member/approve/reject each call their
  existing, unmodified server operation and then re-run the full
  `loadTeamDetail` load on success — mirroring `AdminTeams`'s and
  `TeamDetail`'s established convention. This is what makes "immediate
  membership or pending invitation" (BR-18's outcome, surfaced without any
  new outcome-specific UI branching) and each action's "reflected
  immediately" acceptance criterion hold: the member/invitation/request
  actually moves between sections because the server is re-queried, not
  because the client guessed the new state.
- **Generation guard extended to route changes**: `AdminTeamDetail` mirrors
  `AdminTeams`'s/`TeamDetail`'s `generationRef` pattern, with `teamId` in
  the effect's dependency array (`TeamDetail`'s established route-change
  guard) — every async result (initial load, post-action refresh) is
  applied only if its generation is still current, and each of the three
  action kinds (member/invitation/request) has its own per-row pending-
  state map so one row's in-flight action never blocks another's.
- **Non-admin enforcement is server-side, not UI-hidden**: as with
  TASK-009, no client-side admin check exists anywhere in this component —
  a non-admin caller gets `{status:"forbidden"}` from every one of the
  four list calls (each independently re-deriving admin status via the
  existing `requireAppAdmin`), and the generic "you don't have permission"
  message never confirms or denies `APP_ADMIN_EMAILS` membership.
- **Admin catalog linked to detail**: `AdminTeams` (TASK-009) now links
  each team's name to `/admin/teams/[teamId]` — the only change to that
  existing component in this task, behavior-preserving otherwise (its own
  22 tests pass unchanged).

**Post-review fix (review-change finding, Important): Approve/Reject pending-label mismatch**
`review-change` found that Approve and Reject shared one plain `{status:
"pending"}` guard per request — correctly preventing both from firing at
once — but only the Approve button's label was conditional
(`"Working…"`); Reject always rendered the literal text `"Reject"`. If an
admin clicked **Reject**, the Approve button switched to `"Working…"`
while Reject stayed unchanged, showing the busy indicator on the button
the admin did not click. No wrong mutation occurred (the correct request
was still sent and reflected after refresh), but the in-flight feedback
was misleading.

Fixed by widening `requestActions`' state to record *which* operation is
pending: `RequestActionState = {status:"idle"} | {status:"pending",
action:"approve"|"reject"} | {status:"error", message}` (a request-
specific type, kept separate from the plain `RowActionState` still used
by `memberActions`/`invitationActions`, which only ever have one possible
action per row). `handleResolveRequest` now stores `action: status ===
"approved" ? "approve" : "reject"` alongside `"pending"`; the JSX derives
`isApprovePending`/`isRejectPending` from that field so each button shows
its own pending label ("Approving…" / "Rejecting…") only when it is
itself the in-flight action, while the other button is disabled (the
existing shared per-`uid` guard, unchanged) but never relabeled. No
authorization logic was touched, no optimistic membership/request state
was introduced, and the existing guard/refresh/error-handling behavior is
otherwise identical — this was purely a label-derivation fix.

Tests added (`AdminTeamDetail.test.tsx`): both directions (Approve
pending → Reject stays `"Reject"`; Reject pending → Approve stays
`"Approve"`), a same-request concurrency test proving Reject cannot fire
while Approve is pending (via the real disabled button, not just the
handler's reentrancy check), a cross-request independence test (two
pending access requests; one's in-flight approval never disables or
relabels the other's controls), and one stale-mutation-race regression
test — an in-flight `removeAdminTeamMember` call for team A that resolves
only after the route (`teamId` prop) has changed to team B, asserting the
stale result triggers no post-mutation refresh for team A and leaves team
B's already-rendered view untouched (proves the existing `generationRef`/
`isCurrentGeneration` mechanism, reused unchanged, correctly covers this
component's per-row mutation state, not just its initial load).

**Accepted, out-of-scope follow-up (review-change finding, Suggestion)**
`review-change` also observed that `approveAccessRequest`
(`src/features/teams/server/approve-access-request.ts`, TASK-005,
unmodified) never re-checks the team's `active`/`disabled` status before
granting membership — unlike `createInvitation`, which does. A request
created while a team was active, then approved after that team was
disabled in the interim, still succeeds today. This is pre-existing
TASK-005 server behavior, outside TASK-010's UI-only scope; per the
review's explicit instruction it was **not** touched here (no changes to
`approve-access-request.ts`, access-request domain/server behavior, or
disabled-team authorization semantics). Recorded as an accepted,
non-blocking gap for a possible future task, not fixed in TASK-010.

---

### TASK-011 — Retire the old single-team path

**Status:** Done
**Covers:** BR-33, BR-34

**Depends on:** TASK-003, TASK-006, TASK-007, TASK-008

**Outcome**
`/results` becomes a thin client-side redirect: a user with exactly one
membership lands on their `/teams/[teamId]`; every other state (signed
out, zero, or multiple memberships) lands on `/teams`. The old static
single-team model — `TEAM_ASSIGNMENTS`, `resolveTeamForUser`,
`ALLOWED_TEAM_IDS`/`isAllowedTeamId`, `get-dashboard.ts`, and the old
`GET /api/results` route — plus their tests, are removed. This task must
not start until TASK-003 and TASK-008 (the new protected route, server
and UI) are verified working — per SPEC → Migration strategy point 3 —
including a real-Firebase-project check at the same deployment-readiness
bar `docs/features/results-dashboard/SPEC.md` used, not just the
automated suite.

**Implementation notes**
- `/results`'s redirect must be client-side (no server session exists to
  redirect from server-side — SPEC → Architecture decisions → "No
  server-side session"): resolve auth state, call the "my teams" data
  TASK-007 already fetches, then `router.replace()` accordingly.
- Delete: `src/features/teams/domain/team-assignments.ts` (+ test),
  `src/features/results/server/get-dashboard.ts` (+ test),
  `app/api/results/route.ts` (+ test), the now-unused
  `ALLOWED_TEAM_IDS`/`isAllowedTeamId`/`TeamId` in
  `src/features/pulse-survey/domain/teams.ts`, and `Dashboard.tsx`'s
  single-team rendering path (superseded by TASK-008's page) if it isn't
  already replaced.
- Do not remove any Firestore data (`pulseSurveyResponses` is untouched;
  this task only removes application code and static config).

**Verification**
- Redirect test: exactly-one-membership → `/teams/[teamId]`; zero/many/
  signed-out → `/teams`.
- Confirm the deleted modules/routes are no longer imported/reachable
  anywhere (`pnpm typecheck`/`pnpm build` catches dangling references).
- Full existing suite still passes after deletion (no orphaned tests
  referencing removed modules).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`.

**Security / privacy**
No new surface — this task only removes the now-superseded static
authorization path. Confirm no remaining code path still trusts
`TEAM_ASSIGNMENTS` or the static team array for any authorization
decision after this task.

**Documentation impact**
`docs/PRODUCT.md`, `docs/ARCHITECTURE.md` (remove the "Phase 2 static
mapping" as the *current* model, point to this feature), `docs/ROADMAP.md`
(mark this feature's phase), `docs/DEVELOPMENT.md` (remove the
`TEAM_ASSIGNMENTS` local-setup step, keep/finalize the seed-step
instructions from TASK-006), `docs/features/results-dashboard/SPEC.md`
(add a note pointing to this feature as its successor, without rewriting
its historical "Phase 2 implemented model" content — do not delete that
SPEC).

**Acceptance criteria**
- [x] `/results` redirects correctly in all four membership/auth states.
- [x] `TEAM_ASSIGNMENTS`, `resolveTeamForUser`, `ALLOWED_TEAM_IDS`,
      `isAllowedTeamId`, `get-dashboard.ts`, and the old `/api/results`
      route no longer exist in the codebase.
- [x] No remaining code path authorizes team access via the static email
      map or static team array.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, and the full test suite
      pass with no orphaned references.

**Implementation notes (decisions)**
- **`/results` redirect**: `ResultsRedirect`
  (`src/features/results/components/ResultsRedirect.tsx`, rendered from
  the now-thin `app/results/page.tsx`) is a client component — there is no
  server session to redirect from (SPEC → Architecture decisions → "No
  server-side session"). It resolves auth state via the existing
  `observeIdToken`, then reuses the existing, unchanged TASK-007
  `fetchTeamsOverview` gateway (no new server logic) and calls
  `router.replace()` (`next/navigation`'s `useRouter`, App Router client
  navigation) accordingly. Mirrors this feature's established
  `generationRef`/`isCurrentGeneration` stale-result guard
  (`TeamsOverview`/`TeamDetail`/`AdminTeamDetail`): a slow overview
  response for a superseded identity (e.g. a fast account switch right
  after page load) can never fire a redirect meant for the previous
  account — verified by a dedicated test using a genuinely deferred
  promise.
- **BR-33's "team membership" resolved to relationship `"member"`
  specifically, not `"admin"`**: BR-33 says "exactly one team membership";
  SPEC's own Key Concepts section defines "Team membership" precisely as a
  `teamMemberships` document, distinct from the separately-defined "App
  admin" concept. `getTeamsOverview` (TASK-007, unchanged) reports an app
  admin's relationship to every team as `"admin"`, never `"member"`, even
  with zero actual `teamMemberships` documents — so counting `"admin"`
  toward "membership" would make the single-membership redirect
  essentially unreachable for any admin with more than one active team,
  and would be reading the SPEC's own precise vocabulary loosely. Resolved
  by filtering the overview to `relationship === "member"` only and
  redirecting to that team's `/teams/[teamId]` only when exactly one such
  entry exists; every other case (0, 2+, `"admin"`-only, pending/rejected,
  signed out, or a read failure) redirects to `/teams` (BR-34). Covered by
  a dedicated test: an app admin with a single `"admin"`-relationship team
  and no `"member"` entries redirects to `/teams`, not that team's page.
- **Deleted** (working tree, via `git rm`, plus every file each one's own
  tests referenced): `src/features/teams/domain/team-assignments.ts` (+
  test), `src/features/results/server/get-dashboard.ts` (+ test),
  `app/api/results/route.ts` (+ test), `src/features/results/components/
  Dashboard.tsx` (+ test, superseded by `ResultsRedirect`), and
  `src/features/results/client/dashboard-gateway.ts` (+ test — `Dashboard.
  tsx`'s only caller, dead once `Dashboard.tsx` was removed). Also deleted
  `src/features/pulse-survey/domain/teams.ts`
  (`ALLOWED_TEAM_IDS`/`isAllowedTeamId`/`TeamId`) once it became fully
  unreferenced (see next point) — a stricter reading of this task's own
  acceptance criteria than the SPEC's Architecture-decisions note ("Code
  to retire" lists only `team-assignments.ts`), but exactly what this
  task's own acceptance criteria explicitly demand ("`ALLOWED_TEAM_IDS`,
  `isAllowedTeamId`... no longer exist in the codebase").
- **`ALLOWED_TEAM_IDS` fully removed, not retained**: the only remaining
  production reader of `ALLOWED_TEAM_IDS` was `legacy-team-seed.ts`
  (TASK-006's one-time seed constant). Rather than leave the whole
  `pulse-survey/domain/teams.ts` module alive solely for that one
  dependency (which would have left `ALLOWED_TEAM_IDS`/`isAllowedTeamId`
  "existing in the codebase," failing this task's acceptance criterion
  literally), the four legacy team id strings (`"platform"`, `"web-app"`,
  `"mobile"`, `"data-platform"`) are now a small private, inlined constant
  directly inside `legacy-team-seed.ts` itself — `LEGACY_TEAM_SEEDS`'s
  output is byte-for-byte unchanged (verified by its existing test, updated
  only to stop importing the deleted module). `submit-pulse-survey.test.ts`
  similarly inlines the same four literals locally (test-only, not
  production code) to keep proving its "legacy static list membership
  doesn't grant/deny authorization" cases without importing a deleted
  module.
- **No new authorization surface**: `getTeamResults`
  (`src/features/results/server/get-team-results.ts`, TASK-003, already
  the sole per-team results endpoint) and `authorizeTeamAccess` (TASK-002)
  were not modified by this task — removing the old path deletes a
  parallel, now-fully-redundant authorization surface rather than
  introducing any new one, matching SPEC's Migration strategy point 3.
- **Stale comments referencing deleted files updated, not silently left
  dangling**: `get-team-results.ts`, `auth-client.ts`, `PeriodSummary.tsx`,
  `TeamsOverview.tsx`, `app-admin.ts`, `seed-legacy-teams.ts`, and
  `app/api/admin/teams/seed-legacy/route.ts` each had a doc comment naming
  a now-deleted construct (`get-dashboard.ts`, `GET /api/results`,
  `Dashboard.tsx`, `TEAM_ASSIGNMENTS`, `ALLOWED_TEAM_IDS`) as if it were
  still current; each was reworded to either name the correct current
  equivalent or explicitly mark the reference as historical
  ("now-retired", "formerly"), consistent with this task's own
  "no orphaned references" bar — no behavior change, comments only.
- **Firestore rules/indexes untouched**: the `pulseSurveyResponses`
  `(teamId, period)` composite index remains required (now documented
  against `get-team-results.ts`, the query shape is unchanged); no
  Firestore rule was loosened or added — this task only removed
  application code and updated prose, per its own "do not remove any
  Firestore data" note.
- **`SiteHeader`'s existing `/results` nav link is left pointing at
  `/results`** (not changed to `/teams` directly) — visiting it now lands
  the user on the compatibility redirect, which immediately forwards them
  to the correct destination; this satisfies "existing navigation no
  longer points users to a retired `/results` experience" without an
  unnecessary nav-copy change beyond this task's scope.
- **Out of scope, deliberately not touched**: TASK-004's invitation
  accept-vs-cancel metadata race, TASK-005's approve-access-request-on-
  disabled-team observation (recorded under TASK-010's post-review note
  above), and the known-value-injection residual risk
  (`docs/features/results-dashboard/SPEC.md`) are all unrelated to this
  migration/retirement task and were not touched.

