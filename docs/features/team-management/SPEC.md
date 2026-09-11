# Team Management (Multi-Team Membership and Admin)

## Status
Approved — implemented (TASK-001 through TASK-011 Done; see
[TASKS.md](./TASKS.md)).

## Problem
Phase 2 (`docs/features/results-dashboard/SPEC.md`) authorizes access with a
static, server-only, deploy-time mapping of one Firebase-verified email to
one `teamId` (`TEAM_ASSIGNMENTS`), and the team list itself
(`ALLOWED_TEAM_IDS`) is a static, code-defined array. This does not scale:
a user can belong to at most one team, a new team requires a code change
and redeploy, there is no admin capability at all, and there is no
self-service way for a legitimate user to gain access without someone
editing source. This feature replaces that static model with a durable,
Firestore-backed, `uid`-based multi-team membership model and a minimal
admin capability, without weakening any existing survey privacy/security
guarantee.

## User outcome
An authenticated user can belong to zero, one, or many teams; can browse
the list of teams and request access to ones they don't belong to; and, if
recognized as a member (directly, via an admin invitation, or via an
approved access request), can see that team's closed-period results and
trend exactly as Phase 2 already provides. A global app admin can create
teams, invite people by email, and approve or reject access requests — all
server-side, `uid`-based, and without ever gaining unrestricted access to
raw individual survey responses.

## Scope
- A Firestore-backed `teams` collection, admin-managed (create,
  disable/re-enable), replacing the static `ALLOWED_TEAM_IDS` array as the
  single authoritative team list for both the public survey and the
  authenticated app.
- A Firestore-backed `teamMemberships` collection keyed by Firebase `uid`
  (never email), supporting many memberships per user and many members per
  team.
- A global app-admin role, established via a server-only email allow-list
  (env config) checked against the caller's Firebase-**verified** email —
  no custom claims, no "first user becomes admin," no client-supplied role.
- Server-side authorization helpers distinguishing authenticated,
  app-admin, team-member, and non-member, used by every new protected
  route (`src/features/teams/server/`).
- `/teams`: authenticated users see every active team's name and their own
  relationship to it (member / admin / request pending / request rejected
  / none); can open teams they belong to or administer; can request access
  to others.
- `/teams/[teamId]`: authorized members/admins see that team's
  closed-period results and trend, reusing the existing aggregation domain
  logic unchanged; unauthorized users see a non-sensitive "request access"
  state and the server never queries that team's protected data for them.
- `/results` becomes a thin client-side compatibility redirect to `/teams`
  or, for a user with exactly one membership, straight to their
  `/teams/[teamId]`.
- An admin area: create team, list teams (including disabled), inspect a
  team's membership/pending invitations/pending access requests, invite a
  member by email, approve/reject access requests, remove a membership.
- An email-based invitation flow, resolved server-side into a `uid`-based
  membership the next time a Firebase-authenticated user with a matching,
  **verified** email is seen by a team-scoped request (or immediately, if
  an account with that verified email already exists at invite time). No
  outbound email delivery.
- An in-app access-request flow (`teamAccessRequests`), with duplicate
  active requests prevented by a deterministic per-(uid, team) document.
- The public pulse-survey team selector becomes dynamic: server-provided
  from the Firestore `teams` collection's `active` set, replacing the
  static `ALLOWED_TEAM_IDS` array; submission validation checks the
  submitted `teamId` against that same authoritative set, server-side,
  exactly as strictly as today.
- Firestore Security Rules updated with explicit per-collection deny
  blocks for the four new collections, for documentation/defense-in-depth
  clarity (the existing catch-all deny-all rule already covers them).
- Migration of `src/features/results/server/get-dashboard.ts`'s team
  resolution from the static email map to a per-`teamId` authorization
  check, since a user may now belong to more than one team.

## Out of scope
- Outbound email delivery for invitations or access-request notifications
  — in-app pending state only.
- Slack or any other external notification channel.
- Organization hierarchy, billing, SSO/SAML.
- A team-level admin role or a general custom role editor — global
  app-admin plus plain membership is the complete role model for this PoC
  (see Architecture decisions).
- Raw individual survey-response admin tooling of any kind — admin access
  never implies raw-response access; this feature does not add any new
  raw-response read path for anyone, admin included.
- Any change to Phase 1 anonymous-submission identity/dedup behavior —
  submission stays unauthenticated, identity-free, and dedup-free; only
  the source of the valid-`teamId` set changes (BR-31/BR-32).
- A dedicated audit-log product — minimal accountability fields
  (`invitedBy`, `grantedBy`, `resolvedBy`, timestamps) on the documents
  that already need them, nothing more.
- Hard/destructive team deletion or cascading deletion of survey data —
  only a reversible `active`/`disabled` status.
- Rate limiting or abuse controls on invitations, access requests, or the
  (already-out-of-scope, still-public) Phase 1 submission endpoint.
- A general team chat/messaging feature — access requests are a single-
  purpose, structured, in-app workflow, not messaging.
- Any new Firestore client-SDK read/write path — the deny-all rule is
  preserved without exception for every collection this feature adds.

## Key concepts
- **Team**: a Firestore `teams` document with a permanent, server-derived
  `teamId` and a mutable display `name`. `status` is `active` (visible for
  discovery, joinable, a valid public-survey destination) or `disabled`
  (hidden from discovery and from the public survey selector, but still
  fully visible/manageable to its existing members and to any app admin —
  disabling never deletes or hides previously stored results).
- **App admin**: a Firebase-verified identity whose verified email appears
  in a server-only allow-list. Global, not per-team. Can do everything a
  member can for any team, plus create/disable teams and manage
  membership, invitations, and access requests for any team. Does **not**
  thereby gain access to raw individual survey responses (unchanged
  invariant 17) — admin access is still bounded to the same
  aggregate/trend surface a member sees.
- **Team membership**: a `teamMemberships` document linking one Firebase
  `uid` to one `teamId`. The sole basis (together with app-admin status)
  for authorizing access to that team's protected results. Never
  email-keyed.
- **Invitation**: an admin-initiated, email-addressed, pending grant of
  membership, stored server-side, resolved into a `uid`-based membership
  only against a currently Firebase-**verified** matching email — never
  auto-linked to a different or later-changed email.
- **Access request**: a non-member's in-app request to join a team,
  resolved by an app admin into either an approval (creates membership) or
  a rejection (creates no membership). At most one active/most-recent
  request exists per (uid, team) pair.

## Actors and access
- **Anonymous pulse-survey respondent**: unchanged — picks from the
  dynamic active-team list, no authentication, no identity.
- **Authenticated, verified user, no memberships**: can view `/teams`
  (names + own relationship only), can request access to any active team.
- **Authenticated, verified user, member of one or more teams**: as above,
  plus can open each team they belong to and see its results/trend.
- **App admin**: as a member/verified user, for every team, plus the admin
  area (create/disable teams, manage membership, invitations, access
  requests for any team). Never gains raw-response access.
- **Non-member viewing a team they don't belong to**: sees only a
  non-sensitive "request access" state; the server never computes or
  returns that team's aggregate/trend/count for them.
- **Unauthenticated visitor**: sees only the public pulse-survey form
  (unchanged) and a sign-in prompt on any team-management page; no team
  names or data are returned pre-authentication.

## User stories
1. As an app admin, I want to create a team so that its members have
   somewhere to see their results.
2. As an app admin, I want to invite someone to a team by email so that
   they gain access without me editing source code.
3. As an authenticated user, I want to see the list of teams and request
   access to one I'm not a member of, so that I don't need an admin to
   proactively find me.
4. As an app admin, I want to approve or reject a pending access request
   so that I control who joins each team.
5. As a member of more than one team, I want to open each team's own
   results page, so that I'm not limited to a single team like before.
6. As a non-member, I want to be told I don't have access and be offered a
   way to request it, without ever having the team's actual results
   queried or shown to me.
7. As the system, I want every authorization decision to be re-derived
   server-side from verified identity and Firestore-backed membership on
   every request, so that removing someone's membership takes effect
   immediately and no client-supplied value can grant access.
8. As a developer with an old `/results` bookmark, I want to land
   somewhere useful (my team, or the team list) rather than a broken or
   stale page.

## Behavioral requirements

**Teams (admin-managed)**
- **BR-1**: An app admin can create a team by providing a name; the server
  assigns a stable, opaque, permanent `teamId` (Firestore-generated,
  independent of the mutable `name`) and persists a `teams` document with
  that `teamId` and `status: "active"`.
- **BR-2**: Only an app admin can create, disable, or re-enable a team.
- **BR-3**: A `disabled` team is excluded from the public pulse-survey
  team selector and from the discovery/request-access view non-members see
  on `/teams`, but remains fully accessible (results + admin management)
  to its existing members and to any app admin.
- **BR-4**: Creating, disabling, or re-enabling a team never modifies or
  deletes any previously stored `SurveyResponse` document.

**App-admin identity**
- **BR-5**: The server determines app-admin status only when **all** of
  the following hold for the caller's Firebase ID token: (a) the token is
  present and passes revocation-checked verification (`verifyIdToken`,
  reused unchanged from Phase 2 — `checkRevoked: true`), (b) the decoded
  token carries an `email`, (c) that email is Firebase-**verified**
  (`emailVerified === true`), and (d) the normalized (trimmed, lowercased)
  email matches an entry in the server-only `APP_ADMIN_EMAILS` allow-list
  — never from any client-supplied role, header, claim, or request body
  field.
- **BR-6**: An account whose email is on the admin allow-list but is not
  yet Firebase-verified, or whose token fails revocation-checked
  verification, is not treated as an app admin.

**Membership and authorization**
- **BR-7**: A user may hold zero, one, or many `teamMemberships`
  documents, each linking their Firebase `uid` (never email) to one
  `teamId`.
- **BR-8**: On every protected team-scoped request, the server authorizes
  access solely from (a) app-admin status (BR-5) or (b) an existing
  `teamMemberships` document for the caller's verified `uid` and the
  requested `teamId` — never from any client-supplied role, membership
  claim, or team identifier alone.
- **BR-9**: Removing a `teamMemberships` document revokes that user's
  access to that team's protected data starting with their very next
  request; no cached or session-based authorization state exists anywhere
  in the system.
- **BR-10**: A user authorized for one team cannot obtain another team's
  results through any request parameter — every request's authorization is
  re-derived per-`teamId`, regardless of the caller's other memberships.

**`/teams` overview**
- **BR-11**: An authenticated, verified user can load `/teams` and see
  every `active` team's name plus their own relationship to it (`admin`,
  `member`, `request pending`, `request rejected`, or `none`) — never
  another user's relationship, another team's member count, or any team's
  results/aggregate data.
- **BR-12**: A user who is a member of, or an app admin for, a team can
  open that team's page from `/teams`; a user with no relationship (or a
  pending/rejected request) sees a "request access" affordance instead.
- **BR-13**: An unauthenticated visitor loading `/teams` is prompted to
  sign in; no team name or relationship data is returned before
  authentication.

**`/teams/[teamId]`**
- **BR-14**: For a team the caller is a member of, or an app admin, the
  page shows that team's most recently closed period's aggregate and
  12-closed-period trend, computed exactly as Phase 2 already does
  (server-side; decrypt+validate before threshold; open period always
  empty) — the aggregation domain logic itself is unchanged.
- **BR-15**: For a team the caller is not authorized for, the server never
  queries or returns that team's aggregate, count, or trend data for any
  period, regardless of the requested `teamId`; the client sees only a
  non-sensitive "request access" state.
- **BR-16**: A `teamId` that does not exist, or that exists but is
  `disabled` and the caller has no membership/admin status, resolves to
  the same non-member treatment as any other unauthorized team.

**Invitations**
- **BR-17**: An app admin can invite a person to a specific team by email;
  the server normalizes the address (trim + lowercase) before storing or
  matching it.
- **BR-18**: If the invited email already belongs to an existing,
  Firebase-**verified** account, the server creates the `teamMemberships`
  document immediately (no pending state); otherwise it stores a pending
  `teamInvitations` document.
- **BR-19**: Re-inviting the same normalized email to the same team while
  a pending invitation already exists is idempotent — it does not create a
  second invitation.
- **BR-20**: A pending invitation is resolved into a `teamMemberships`
  document the next time a signed-in user with a matching,
  Firebase-**verified** email makes a team-scoped request; an unverified
  matching email never triggers resolution.
- **BR-21**: An app admin can cancel a pending invitation; a canceled
  invitation is never subsequently auto-resolved into membership, even if
  a matching verified email is later seen.
- **BR-22**: Inviting an email that already has an active membership for
  that team is rejected as a no-op ("already a member"); no duplicate
  invitation or membership is created.

**Access requests**
- **BR-23**: A signed-in, verified, non-member viewing an active team's
  page can submit an access request for that team.
- **BR-24**: While a pending access request exists for a given (uid, team)
  pair, submitting another request for the same pair is a no-op — it does
  not create a second pending request.
- **BR-25**: A previously rejected access request (or one whose resulting
  membership was later removed) can be resubmitted, resetting it to
  pending.
- **BR-26**: Only an app admin can approve or reject a pending access
  request.
- **BR-27**: Approving a pending access request atomically creates the
  corresponding `teamMemberships` document and marks the request
  `approved` with a resolver identity and timestamp; rejecting marks it
  `rejected` with a resolver identity and timestamp and creates no
  membership.
- **BR-28**: A user who already holds membership in a team cannot create a
  new access request for it (rejected as a no-op).

**Admin membership management**
- **BR-29**: An app admin can view a team's full member list — each
  member's current email resolved on demand from Firebase Auth, never
  from a persisted/stale copy — and remove any member's `teamMemberships`
  document.
- **BR-30**: An app admin can view a team's pending invitations and
  pending access requests.

**Public survey / dynamic team list**
- **BR-31**: The pulse-survey submission form's team selector is populated
  server-side from the `active` teams in the `teams` collection, replacing
  the previous static list; this remains unauthenticated and as publicly
  visible as today.
- **BR-32**: The pulse-survey submission endpoint validates a submitted
  `teamId` against that same authoritative `active`-teams source at write
  time, server-side; an unrecognized or `disabled` `teamId` is rejected
  exactly as an invalid `teamId` is today. No other aspect of Phase 1
  submission (anonymity, encryption, absence of identity fields, unlimited
  resubmission) changes.

**`/results` compatibility**
- **BR-33**: Visiting `/results` while authenticated and verified with
  exactly one team membership redirects to that team's
  `/teams/[teamId]`.
- **BR-34**: Visiting `/results` in any other state (signed out, zero
  memberships, more than one membership) redirects to `/teams`.

**Firestore access**
- **BR-35**: None of `teams`, `teamMemberships`, `teamInvitations`, or
  `teamAccessRequests` is readable or writable via the Firebase client SDK
  under any authentication state; all reads/writes happen server-side via
  the Firebase Admin SDK, exactly like every existing collection.
- **BR-36**: The `APP_ADMIN_EMAILS` allow-list's contents are never sent
  to the client in any form (API response, page markup, client bundle, or
  `NEXT_PUBLIC_*` config) — a caller can only ever learn their **own**
  resulting `isAdmin` boolean, never the list itself or any other
  identity's admin status.

## Edge cases and failure behavior
- Missing/expired/invalid ID token on any new endpoint → rejected with a
  generic auth error, mirroring the existing dashboard endpoint; no
  team/admin data is resolved or returned (BR-8).
- Caller's email is on the admin allow-list but unverified → treated as a
  plain (non-admin) authenticated user, not as an app admin (BR-6).
- Two teams created with the same `name` → both succeed with distinct,
  independently stable, opaque `teamId`s (names are display-only and not
  required to be unique); nothing in this feature enforces name
  uniqueness, since `teamId`, not `name`, is the authorization key.
- Access request or invitation targeting a `disabled` team → rejected;
  admin must re-enable the team first (consistent with BR-3's "no new
  grants into a disabled team" posture — re-enabling is a normal
  BR-2 action).
- Two concurrent access-request submissions for the same (uid, team) →
  resolved via a transactional read-modify-write on the deterministic
  request document, so at most one pending request ever exists (BR-24).
- Concurrent approval and a duplicate request for the same pending access
  request → the transactional write on the single deterministic document
  means one operation's effect is fully applied before the other reads it;
  no lost update, no duplicate membership.
- Admin invites an email, then that person's account email changes before
  they ever sign in with the invited address → the invitation remains
  pending under the original (now-orphaned) email indefinitely; it is
  never auto-relinked to the new email. Documented, accepted limitation —
  an admin can cancel and re-invite the new address.
- Team is disabled while a user is actively viewing its results → their
  current page reflects what was already loaded; their *next* request
  re-evaluates BR-3/BR-16 and is treated as a non-member request if they
  hold no membership, or continues to succeed if they are a member/admin.
- Removing a member's `teamMemberships` document while their browser tab
  is open → their next request (not their current, already-rendered view)
  is denied (BR-9); no server-push/forced client refresh is introduced.
- Requesting access to a nonexistent `teamId` → identical response to
  requesting access to an existing team the caller has no relationship to
  (BR-16); no distinguishing existence signal beyond what `/teams`'s own
  listing already discloses for active teams.
- Firestore read/write failure during any new admin or membership
  operation → the request reports failure to the client; no partial state
  (e.g., invitation created but membership not) is left without the
  originating operation itself failing.
- `GET /teams` or `/teams/[teamId]` for a user with a pending invitation
  they haven't yet triggered resolution for → invitation resolution runs
  as part of that same request (BR-20) before the relationship/authorization
  is computed, so the newly created membership is reflected immediately in
  that response.

## Security and privacy
- **Invariants 8/9 (server-side authorization; no cross-team access)**:
  generalized from Phase 2's single static mapping to a per-request,
  per-`teamId` check (`authorizeTeamAccess`) against Firestore membership
  or app-admin status — never a client-supplied team identifier, role, or
  membership claim (BR-8, BR-10).
- **Invariant 17 (admin ≠ raw-response access)**: app-admin status
  extends *which teams'* aggregates an identity may view and *whether*
  they may manage membership/invitations/requests — it adds no new read
  path to individual/raw `SurveyResponse` content anywhere. The aggregation
  boundary (`get-dashboard`'s successor) is unchanged and still only ever
  returns computed aggregates (BR-14).
- **Identity forgery**: exactly as Phase 2, all identity (`uid`, `email`,
  `emailVerified`) comes only from `verifyIdToken` (Firebase Admin SDK,
  `checkRevoked: true`, reused unchanged) — never a client-supplied value.
  This is reused for app-admin determination too (BR-5/BR-6), so a revoked
  or disabled Firebase account loses both member and admin authorization
  on its very next request.
- **Duplicate/race conditions**: invitation, membership, and access-request
  documents all use deterministic IDs plus transactional read-modify-write
  for state transitions, so duplicate invitations, duplicate active
  requests, and an approval racing a duplicate request are prevented by
  construction rather than by best-effort application logic (BR-19, BR-22,
  BR-24, BR-27).
- **Team enumeration / team names as public-within-app information**: team
  `name`s are treated as non-sensitive — visible to any authenticated user
  on `/teams` regardless of membership (explicit product decision, item 3)
  and to any anonymous visitor via the public survey selector (BR-31),
  matching the exposure level `ALLOWED_TEAM_IDS` already has today. Only
  a team's *results* (aggregate/trend/count) are protected.
- **Admin visibility of member/requester emails**: an app admin can see a
  team's member and requester email addresses, resolved on demand from
  Firebase Auth (`getUser`/`getUserByEmail`) rather than a persisted copy
  (BR-29) — a deliberate, data-minimizing choice: this data is necessary
  for an admin to manage who has access, is never more current than the
  underlying Firebase Auth record, and is never retained by DevPulse
  itself beyond the invitation's own pending state (see Data minimization
  below).
- **Invitation email retention**: the invited email is necessarily
  persisted in a pending `teamInvitations` document (nothing else can
  resolve a not-yet-existing account into a future membership) but is not
  duplicated into `teamMemberships` once resolved — the membership
  document is `uid`-only (BR-7).
- **Deleted/deactivated team**: only a reversible `disabled` status exists
  (BR-3); no hard delete, so no destructive/irreversible admin action
  exists in this feature, and no `SurveyResponse` data is ever deleted by
  a team-management action (BR-4).
- **No client-SDK access introduced**: all four new collections stay
  covered by the existing deny-all Firestore rule; explicit per-collection
  blocks are added for documentation/defense-in-depth clarity only, not a
  behavior change (BR-35).
- Invariant 14 (no sensitive content in logs): unchanged — none of the new
  server operations log survey content; they also must not log invitation
  emails, requester identities, or admin allow-list contents on failure
  paths, consistent with the existing pulse-survey/results handlers.
- Invariant 6/7 (anonymous responses stay identity-free; participation
  separate from response content): unchanged — this feature does not touch
  `SurveyResponse` shape or Phase 1 submission's identity-free design; only
  the source of valid `teamId`s changes (BR-31/BR-32).

## Architecture decisions
- **Team identifier scheme (revised in this design review)**: `teamId` is
  a stable, server-generated, **opaque** identifier (a Firestore
  auto-generated document ID), created independently of the team's `name`
  and never derived from it. `name` is a separate, freely admin-editable
  display field with no effect on `teamId`, authorization, document
  identity, or existing `/teams/[teamId]` links — renaming a team cannot
  break a bookmark, a membership record, or an in-flight authorization
  check, because nothing about authorization ever depended on `name` in
  the first place. An earlier draft of this spec proposed a name-derived
  slug as `teamId`, with the rename hazard mitigated only by freezing the
  slug at creation time; this opaque-ID approach is strictly simpler and
  removes the coupling entirely rather than just freezing it, so the
  slug-as-id draft is superseded. A display-only `slug` field is
  deliberately **not** added in this feature — nothing in scope needs a
  prettier URL than the opaque ID, and it can be layered on later, purely
  for display/URL convenience, without ever touching `teamId`, membership,
  or authorization.
- **Continuity with the existing static team list**: because Phase 2 has
  never been exercised against a real Firebase project with live data
  (`TEAM_ASSIGNMENTS` ships empty; see results-dashboard SPEC's
  "Deployment readiness"), there is no real historical `SurveyResponse`
  data whose `teamId` values must be preserved. As a precaution, the
  one-time seed migration (see Migration strategy) still creates one
  `teams` document per existing `ALLOWED_TEAM_IDS` entry (`platform`,
  `web-app`, `mobile`, `data-platform`), using an **explicitly assigned**
  document ID equal to that exact legacy string (Firestore allows
  specifying a document ID instead of auto-generating one) and `name` set
  to the same string initially, so any pre-existing
  `pulseSurveyResponses.teamId` value (real or from local testing)
  continues to resolve correctly. This is the only place a `teamId` is
  chosen to equal a specific string rather than auto-generated — it is
  still fully opaque and stable from that point on; it is simply chosen
  once, at migration time, to match pre-existing data, never derived from
  `name` on every creation.
- **Firestore collections** (server-only, Admin SDK; all denied to the
  client SDK per BR-35):
  - `teams/{teamId}`: `{ name, status: "active" | "disabled", createdAt,
    createdBy }`.
  - `teamMemberships/{compositeId}`: `{ uid, teamId, createdAt,
    createdVia: "invitation" | "access_request" | "admin_direct",
    grantedBy }` — `compositeId` (e.g. `${uid}__${teamId}`) is used only as
    a uniqueness key, never parsed back apart; `uid` and `teamId` are also
    stored as separate, queryable fields. Query by `uid` (a user's own
    teams) and by `teamId` (a team's member list) are both single-field
    and need no composite index.
  - `teamInvitations/{compositeId}` (`${teamId}__${normalizedEmail}`):
    `{ teamId, email, status: "pending" | "accepted" | "canceled",
    invitedBy, createdAt, updatedAt, resolvedAt?, resolvedUid? }`. Requires
    a new composite index (`email` ascending, `status` ascending) to
    support the per-request "resolve my pending invitations" lookup
    (BR-20) — add to `firestore.indexes.json` alongside the existing
    `pulseSurveyResponses` index (see `docs/DEVELOPMENT.md`).
  - `teamAccessRequests/{compositeId}` (`${uid}__${teamId}`):
    `{ teamId, uid, status: "pending" | "approved" | "rejected",
    createdAt, resolvedAt?, resolvedBy? }` — deliberately no persisted
    email (resolved on demand per "Admin visibility" above). Requires a
    new composite index (`teamId` ascending, `status` ascending) for the
    admin's pending-requests view.
  - No `users`/profile collection is introduced. Firebase Auth (via the
    Admin SDK) is the single source of truth for identity/email; nothing
    in this feature duplicates it into Firestore except the necessarily
    email-keyed, pending-only `teamInvitations` document.
- **No `users` document, no team-level admin role, no persisted audit
  log**: the smallest role model that satisfies the product is
  {app-admin, member} — team-level admin is evaluated and rejected as
  unnecessary for this PoC (item 9); accountability is limited to
  `invitedBy`/`grantedBy`/`resolvedBy` fields already present on the
  documents that need them.
- **New feature-slice ownership** (`.claude/rules/architecture.md`):
  `src/features/teams/` becomes the owner of: the `teams` domain/server
  CRUD, `teamMemberships`, `teamInvitations`, `teamAccessRequests`
  domain/server logic, the app-admin check, and the `authorizeTeamAccess`
  helper. `src/features/pulse-survey/domain/teams.ts`
  (`ALLOWED_TEAM_IDS`/`isAllowedTeamId`) is retired in favor of reading the
  `teams` feature's active-team set — this was already anticipated as an
  open item in the pulse-survey SPEC. `src/features/teams/domain/
  team-assignments.ts` (`TEAM_ASSIGNMENTS`/`resolveTeamForUser`) is
  retired once `get-dashboard`'s successor is migrated (see Migration
  strategy).
- **`get-dashboard.ts` successor**: the existing aggregation domain logic
  (`computePeriodAggregate`, `listPrecedingClosedPeriods`) is reused
  unchanged; only the resolution step changes from
  `resolveTeamForUser(identity)` (static map, no `teamId` input) to
  `authorizeTeamAccess(identity, teamId)` (Firestore-backed, `teamId` taken
  from the request path and always re-authorized server-side, never
  trusted — item 9). The result is effectively "the same dashboard
  operation, generalized to take an authorized `teamId`."
- **No server-side session**: DevPulse has no session cookie — the client
  holds the Firebase ID token and sends it per request (unchanged, Phase
  2 architecture). Consequently the `/results` → `/teams`(`/[teamId]`)
  redirect (BR-33/BR-34) must happen **client-side**, after the browser
  resolves auth state and calls the new "my teams" endpoint — mirroring
  how `Dashboard.tsx` already does client-side auth-state observation —
  not a Next.js server-side `redirect()`, since no server-rendered request
  carries proof of identity.
- **App-admin bootstrap**: a new server-only env var, e.g.
  `APP_ADMIN_EMAILS` (comma-separated, normalized/lowercased at read
  time), analogous to the existing `TEAM_ASSIGNMENTS` static-config
  pattern already in this codebase. Rejected alternatives: Firebase custom
  claims (adds a claim-management/propagation step for no benefit here,
  since Firestore rules stay fully deny-all regardless of any claim — see
  next point); a one-time bootstrap script (more moving parts than an env
  var for a PoC-scale admin list); "first user becomes admin" (explicitly
  insecure, rejected outright).
- **Firestore Security Rules**: the existing catch-all
  `match /{document=**} { allow read, write: if false; }` already denies
  all four new collections; this feature adds explicit
  `match /teams/{document=**} { allow read, write: if false; }`-style
  blocks (one per new collection) purely for the same
  documentation/defense-in-depth clarity `pulseSurveyResponses` already
  has — not a behavior change (BR-35).
- **Migration strategy**: see the dedicated "Migration strategy" section
  below (sequencing guidance for `split-tasks`, not a task list itself).
- **Code to reuse as-is**: `verify-identity.ts` (identity verification,
  including `checkRevoked: true`), all of `src/features/results/domain/
  aggregation.ts` and `src/features/pulse-survey/domain/period.ts`, the
  encryption boundary, and Phase 1 submission's validation/persistence
  shape (only its team-id source changes, per BR-31/BR-32).
- **Code to retire**: `src/features/teams/domain/team-assignments.ts` (and
  its test), `src/features/pulse-survey/domain/teams.ts`'s static array
  (and its direct usages), the single-team-only shape of `get-dashboard.ts`
  and `app/api/results/route.ts`.
- **Tests that must change**: `get-dashboard.test.ts` and
  `app/api/results/route.test.ts` are superseded by tests for the new
  per-`teamId` endpoint and authorization helper; `team-assignments.test.ts`
  is retired; `submit-pulse-survey`/pulse-survey validation tests gain
  cases for the dynamic active-team source; `Dashboard.test.tsx` is
  superseded by tests for the new `/teams`/`/teams/[teamId]` components.
- **Docs that must change** (tracked here, updated as part of
  implementation, not this planning pass): `docs/PRODUCT.md` (admin role,
  multi-team membership), `docs/ARCHITECTURE.md` (authorization model,
  admin bootstrap, session note above), `docs/SECURITY.md` (no new
  invariants expected, but the feature review checklist should be
  re-walked), `docs/DATA-MODEL.md` (add `TeamMembership` as
  Firestore-backed, add `TeamInvitation`/`TeamAccessRequest`),
  `docs/ROADMAP.md` (mark this feature's phase), `docs/DEVELOPMENT.md`
  (new env var, new indexes/rules, retire the `TEAM_ASSIGNMENTS` local-
  setup step), and the results-dashboard SPEC (add a note pointing to this
  feature as its successor, without rewriting its historical "Phase 2
  implemented model" content — see Problem statement above).

## Migration strategy
Confirmed for this design review — three explicit points:

1. **Coexistence**: the new team-management model (Firestore `teams`,
   `teamMemberships`, `teamInvitations`, `teamAccessRequests`,
   authorization helpers, `/teams`, admin area) is introduced and made
   fully functional *alongside* the existing, completely unmodified
   `/results` page, `/api/results` route, `TEAM_ASSIGNMENTS`, and
   `ALLOWED_TEAM_IDS`. The old path keeps working, unchanged, throughout
   this stage — nothing about it is touched until step 3.
2. **New protected route**: `/teams/[teamId]` — backed by a new per-team
   results endpoint that reuses the existing, unchanged aggregation domain
   logic (see Architecture decisions → "`get-dashboard.ts` successor") —
   becomes the new protected team-results surface, authorized via
   `authorizeTeamAccess` against Firestore membership/app-admin status,
   never via the static email map.
3. **Retirement only after the new flow is proven**: only once
   `/teams/[teamId]` has been verified working end-to-end (including
   against a real Firebase project, per the same deployment-readiness bar
   `docs/features/results-dashboard/SPEC.md` used) does `/results` switch
   to its redirect-only behavior (BR-33/BR-34), and only then are
   `TEAM_ASSIGNMENTS`, `resolveTeamForUser`, `ALLOWED_TEAM_IDS`, and the
   old `/api/results` route — plus their tests — retired. This is a
   staged migration, not a flag-day rewrite.

This sequencing directly drives the task graph below: task splitting must
keep an explicit migration/compatibility task and a final, separately
reviewable retirement task gated on step 3, not a single combined task.

## Confirmed invariants (re-affirmed for this design review)
Each item below was explicitly re-checked against the design above; none
required a change beyond what's already reflected in the relevant section.

1. **No generic messaging/chat feature** — access requests remain a
   single-purpose, structured, in-app workflow with fixed states
   (pending/approved/rejected), not a message thread (see Out of scope).
2. **In-app access-request workflow only** — no notification (email,
   Slack, push) is sent to anyone as part of this feature; state changes
   are only ever visible by loading `/teams`, `/teams/[teamId]`, or the
   admin area (see Scope, Out of scope).
3. **No outbound email provider** — invitations and access requests are
   entirely in-app/pending-state; email is used only for matching (see
   point 6) (see Scope, Out of scope).
4. **No team-level admin role** — global app-admin plus plain membership
   is the complete role model for this PoC (see Architecture decisions →
   "No `users` document, no team-level admin role...").
5. **Membership authorization is based on Firebase `uid`** —
   `teamMemberships` is `uid`-keyed and `uid`-checked; email never appears
   in it (BR-7, BR-8).
6. **Invitation email is used only for matching**, never as long-term
   authorization evidence — it resolves a not-yet-linked invitation to a
   future Firebase-verified sign-in and is never copied into
   `teamMemberships` (BR-18, BR-20; Security and privacy → "Invitation
   email retention").
7. **No `users`/profile collection** — Firebase Auth via the Admin SDK
   remains the sole identity source of truth; nothing in this feature
   introduces a parallel profile store (Architecture decisions →
   "Firestore collections").
8. **Direct Firestore client-SDK access remains denied** for every
   existing and every new collection, with no exception (BR-35).
9. **Phase 1 survey anonymity is unchanged** — submission stays
   unauthenticated, identity-free, and dedup-free; only the source of
   valid `teamId`s moves from a static array to Firestore (BR-31, BR-32).
10. **The existing closed-period aggregation logic is reused unchanged**
    (`computePeriodAggregate`, `listPrecedingClosedPeriods`, the
    open/closed boundary, decrypt-and-validate-before-threshold ordering)
    — only the team-resolution step is replaced (BR-14; Architecture
    decisions → "`get-dashboard.ts` successor").
11. **The accepted known-value-injection residual risk is unchanged** —
    the risk documented in `docs/features/results-dashboard/SPEC.md`
    (Security and privacy → "Residual risk") is not affected by this
    feature: no respondent identity, participation tracking,
    deduplication, or submission authentication is introduced, so that
    accepted Phase 2 limitation carries forward exactly as documented
    there.

## Test boundaries
| Boundary | Covers |
|---|---|
| Domain: `teamId` generation (opaque, independent of `name`) | BR-1 |
| Domain: app-admin allow-list matching (token validity + revocation check + verified email + normalized allow-list match) | BR-5, BR-6, BR-36 |
| Domain: `authorizeTeamAccess` (admin / member / denied) | BR-8, BR-10, BR-14, BR-15, BR-16 |
| Server: team create/disable/re-enable | BR-1, BR-2, BR-3, BR-4 |
| Server: membership create/remove, immediate revocation | BR-7, BR-9, BR-29 |
| Server: invitation create/idempotent re-invite/cancel/resolve (verified-email-only, immediate-if-account-exists) | BR-17–BR-22 |
| Server: access-request create/duplicate-prevention/resubmit/approve/reject (transactional) | BR-23–BR-28 |
| Server: teams-list endpoint (relationship computation per caller) | BR-11, BR-13 |
| Server: per-team results endpoint (authorized vs. denied, reused aggregation) | BR-14, BR-15, BR-16, BR-10 |
| Server: pulse-survey dynamic team source (public list + submission validation) | BR-31, BR-32 |
| Client: `/results` redirect logic (0 / 1 / many memberships, signed out) | BR-33, BR-34 |
| UI: `/teams` overview states (member, admin, pending, rejected, none, signed out) | BR-11, BR-12, BR-13 |
| UI: `/teams/[teamId]` authorized vs. request-access states | BR-14, BR-15, BR-16, BR-23 |
| UI: admin area (create team, invite, approve/reject, remove member) | BR-1, BR-2, BR-17, BR-26, BR-27, BR-29, BR-30 |
| Security: direct Firestore client-SDK access remains denied for all 4 new collections | BR-35 |

## Acceptance criteria
- [ ] An app admin (per the server-only allow-list, verified email) can
      create a team, which appears as `active` and is immediately eligible
      as a public-survey destination and on `/teams`.
- [ ] A non-admin authenticated user cannot create, disable, or re-enable
      a team through any request.
- [ ] A user with no membership and no admin status sees only a
      "request access" state on any team's page, and no request to the
      server for that team returns its aggregate/trend/count.
- [ ] A user with memberships in two different teams can open both teams'
      pages and sees only each team's own data — never mixed or leaked
      cross-team.
- [ ] Removing a user's membership causes their very next request for that
      team to be denied.
- [ ] Inviting an email twice while a pending invitation exists creates no
      duplicate invitation; inviting an already-member's email is rejected
      as a no-op.
- [ ] Submitting a second access request while one is pending for the same
      (uid, team) creates no duplicate request; approving a request
      creates exactly one membership and no orphaned/duplicate document.
- [ ] Rejecting an access request creates no membership and is visibly
      distinguishable from "pending" to the requester.
- [ ] The public pulse-survey form's team selector reflects the current
      `active` teams in Firestore (not the old static array), and
      submitting a `disabled` or unknown `teamId` is rejected exactly as
      an invalid `teamId` is today.
- [ ] Visiting `/results` redirects to `/teams/[teamId]` for a user with
      exactly one membership, and to `/teams` in every other auth/
      membership state.
- [ ] No aggregate, response count, or threshold-met/not-met signal is
      ever returned for the current/open survey period, for any team, to
      any actor including an app admin (unchanged from Phase 2).
- [ ] No API response, rendered page, or client-visible payload contains
      any individual response's decrypted answer values, for any team, to
      any actor including an app admin.
- [ ] A direct Firebase client-SDK read or write attempt against `teams`,
      `teamMemberships`, `teamInvitations`, or `teamAccessRequests` is
      denied under every authentication state.
- [ ] The `APP_ADMIN_EMAILS` allow-list never appears in any client-served
      response, page markup, or client bundle — only a caller's own
      `isAdmin` boolean is ever observable client-side.
- [ ] A caller whose Firebase session has been revoked (e.g. password
      change, account disable) loses both member and admin authorization
      on their next request, even if their previously issued ID token has
      not yet expired.
- [ ] `pnpm lint`, `pnpm typecheck`, and the full automated test suite
      pass.

## Open questions
None blocking. All product-direction items in the originating request were
resolved into explicit decisions above (see Architecture decisions for
rationale on each). Non-blocking items accepted for this PoC phase:
- Exact admin-area page structure/routing (e.g. `/admin/teams` vs. a
  section under `/teams`) is left as implementation detail for task
  planning.
- The invitation-orphaned-by-email-change limitation (Edge cases) is
  explicitly accepted, not solved, in this phase — an admin can cancel and
  re-invite.
- Whether `/teams` should page/paginate as the number of admin-created
  teams grows is deferred; out of scope until real usage suggests it's
  needed.
