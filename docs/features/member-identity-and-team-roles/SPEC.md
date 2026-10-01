# Member Identity & Team Roles (F0)

## Status
Approved and implemented (TASK-001 through TASK-008). Product owner decisions
incorporated (lead assignment requires an `active` team; a stored lead is an
effective lead only on an `active` team; no moderation system; opaque member
reference deferred to Skills Planning, see "Follow-up constraints for A–D").
Reconciled against the as-built code at closeout.

Foundation feature **F0** of the *Team & Personal Development* initiative
(F0 → A → B → C1 → C2 → D1 → D2). It builds the two primitives later
features need and nothing else: a self-set display name, and an optional
`lead` marker on a team membership.

## Problem
1. DevPulse has no way to show a person by name. Today a member's e-mail is
   resolved live from Firebase Auth for **app admins only**
   (`listTeamMembers`); teammates cannot see each other at all, and the
   Forum deliberately shows only a pseudonymous `authorTag`. Future features
   (roadmap owner, team lead, mentor, check-in participant) need a
   human-readable member reference that is **not** an e-mail address.
2. DevPulse has only two authorization roles: global app admin (server
   allow-list) and team member. There is no per-team lead, so later
   features have nothing to attach "lead may X" to.

## User outcome
- Any signed-in user can set, change or remove their own **display name**.
- Members of a team can see a read-only roster of that team by display name
  (with a neutral fallback), with leads marked.
- An app admin can mark any real team member as **lead** (several allowed)
  and unmark them, and sees display name + e-mail in the admin member list.
- Server code has one function, `resolveTeamRole`, answering
  `admin | lead | member | denied`, ready for later features to use.
- **Nothing else changes.** Lead carries no new permissions in F0.

## Scope
- `userProfiles/{uid}` (display name) and its server operations, API, and a
  small "Min profil" page.
- Optional `role: "lead"` on `teamMemberships` plus admin assign/unassign.
- `resolveTeamRole` wrapping `authorizeTeamAccess` (contract unchanged).
- Additive display fields on the admin member list.
- A collapsed, read-only, uid-free team roster on `/teams/[teamId]`.
- One header link ("Min profil").
- Closeout documentation (`DATA-MODEL`, `ARCHITECTURE`, `SECURITY`, `UI-UX`).

## Out of scope
`roadmapItems`, Skills Planning, Team Roadmap, `skillDefinitions`,
individual skill assessments, Skill Matrix, professional role definitions
(`roleDefinitions`/`userRoles`), development goals, journal, check-ins,
mentors, radial charts, team aggregation, Demo Team changes, navigation
refactor, general RBAC/permission framework, lead-only *capabilities*
of any kind, admin editing/clearing another user's display name, avatars,
display-name uniqueness, account-deletion flow, migration of existing data,
feature flag (see "Rollout").

## Key concepts
- **Display name**: a user-chosen, non-unique, non-authoritative label.
  Never an identifier, never evidence for authorization, never a substitute
  for, or derived from, e-mail.
- **Team role** (`teamMemberships.role`): *team authorization role*. Exactly
  `"lead"` or absent (= ordinary member). Lives on the membership document,
  scoped to one team.
- **Professional role** (future `roleDefinitions`, e.g. "Senior Developer"):
  a job/expectation profile. **Never** represented by, stored in, or
  conflated with team role. Different collection, different field names
  (`role` here is always qualified as *team role*; future code must name the
  other `professionalRole*`). F0 creates no professional-role concept.
- **Team roster**: member-facing list of a team's members by display name.
  Contains no `uid`, e-mail or other identifier (see BR-14).
- **Effective role**: output of `resolveTeamRole`:
  `admin | lead | member | denied`.

## Actors and access

| Action | Self | Member of team | Lead | App admin | Non-member / signed-out |
|---|---|---|---|---|---|
| Read own display name | ✓ | – | – | – | ✗ (401) |
| Set/change/remove own display name | ✓ | – | – | – | ✗ (401) |
| Read team roster (names, lead marks) | – | ✓ own team | ✓ own team | ✓ any existing team | ✗ (403) |
| See a member's e-mail | – | ✗ | ✗ | ✓ (existing admin list) | ✗ |
| See a member's `uid` | – | ✗ | ✗ | ✓ (existing admin list) | ✗ |
| Assign / remove lead | – | ✗ | ✗ | ✓ | ✗ |
| Edit another user's display name | ✗ | ✗ | ✗ | ✗ | ✗ |

"Lead" and "member" rows are identical by design: **lead confers no
additional permission in F0.** A lead also does **not** gain any app-admin
right.

## User stories
1. As a user, I want to set my display name so teammates see a name, not my
   e-mail.
2. As a user, I want to remove my display name so I can withdraw it.
3. As a team member, I want to see my team's roster by name and who the
   leads are so I know who is on the team.
4. As an app admin, I want to mark one or more members as lead and revert
   it so later features can rely on a team-level role.
5. As an app admin, I want to see each member's name and e-mail so I can
   identify them.
6. As a developer of later features, I want `resolveTeamRole` so I can
   authorize by `admin | lead | member | denied` without re-deriving it.
7. As an existing user/team, I want everything to keep working untouched.

## Behavioral requirements

### Display name
- **BR-1** A signed-in caller may read only **their own** profile
  (`GET /api/me/profile` → `{displayName: string | null}`). The `uid` is
  derived solely from the verified ID token; no `uid` is accepted in path,
  query or body. No endpoint returns another user's profile by `uid`.
- **BR-2** A signed-in caller may create/replace their own display name
  (`PUT /api/me/profile`, body `{displayName}`), idempotently.
  `createdAt` is preserved on update; `updatedAt` is server-clock.
- **BR-3** A caller may remove their display name
  (`DELETE /api/me/profile`), which **hard-deletes** the profile document.
  Deleting when none exists succeeds (idempotent).
- **BR-4** Normalisation then validation, in this order: Unicode **NFC**
  normalise → trim leading/trailing whitespace → collapse every internal
  run of whitespace to one space. Then valid only if **all** hold: length
  2–50 Unicode code points; contains at least one letter or number
  (`\p{L}`/`\p{N}`); contains no control, format, private-use, surrogate or
  unassigned code points (`\p{C}`), no line/paragraph separators, and thus
  no newlines, zero-width characters or bidirectional override/isolate
  controls. Everything else Unicode (letters incl. non-Latin scripts,
  combining marks, apostrophes, hyphens, emoji) is allowed. Non-string,
  missing, empty, whitespace-only or over-long input → `invalid_input`,
  nothing written. The **normalised** value is what is stored and returned.
- **BR-5** Display names are **not unique**; no uniqueness check, reserved
  word list or e-mail-shape check exists. (Impersonation residual risk:
  see "Security and privacy".)
- **BR-6** The display name is rendered strictly as inert text everywhere
  (never HTML/Markdown-parsed, never `dangerouslySetInnerHTML`), and is
  never used as a key, route segment, or authorization input.
- **BR-7** A user with no profile is fully functional; every existing flow
  behaves exactly as before.

### Name resolution and the roster
- **BR-8** `GET /api/teams/[teamId]/members` returns the team roster to a
  caller for whom `authorizeTeamAccess` is `member` or `admin`, re-derived
  from fresh server-side state on every call. `denied` → 403; a failed
  authorization read → 500 (never collapsed into 403).
- **BR-9** Each roster entry is exactly `{displayName: string | null,
  isLead: boolean, isSelf: boolean}`. `isSelf` is computed server-side from
  the verified identity. `isLead` is an **effective** lead: a stored
  `role: "lead"` (BR-17) on a team whose status is exactly `"active"` —
  the same definition `resolveTeamRole` uses (BR-27), so a dormant lead on
  a disabled team is not marked. Entries are ordered deterministically: leads first,
  then by `displayName` (locale-aware, case-insensitive, nulls last), then
  stable by membership creation time.
- **BR-10** A roster member without a valid profile has
  `displayName: null`; the UI shows the neutral fallback **"Medlem uten
  navn"**. The fallback is never derived from e-mail, `uid`, authorTag or
  any other identity-bearing value, and no Firebase Auth lookup is made for
  the roster.
- **BR-11** The roster is scoped to the `teamId` whose membership the caller
  was authorized for; a caller authorized for Team X can never obtain Team
  Y's roster or any name of a person who is only in Team Y.
- **BR-12** A caller whose membership has been removed is denied on their
  very next call (no cached state).
- **BR-13** Roster reads are bounded: memberships are read with a documented
  cap of 500 (the query asks for 501 so truncation can be detected; at most
  500 entries are returned) and profiles are fetched in batches of ≤ 100
  document refs (five batches at the maximum). If
  a team exceeds the cap the roster is truncated deterministically (by membership
  document order, which needs no composite index) and the
  response flags `truncated: true` (UI states it; never claims completeness).
- **BR-14** **No member-facing response in F0 contains any `uid`, e-mail, or
  value from which one can be computed.** Reason: Forum `authorTag` is
  `SHA-256(teamId:authorUid)` — a roster carrying `uid`s would let a member
  re-identify Forum authors. Any later feature that needs to reference a
  member must introduce a non-`uid` reference and be security-reviewed for
  this; F0 deliberately provides none.
- **BR-15** No endpoint exists that lists or searches profiles across teams
  or the organisation, or looks one up by `uid`/name/e-mail.

### Team role
- **BR-16** A `teamMemberships` document may carry optional
  `role: "lead"` with paired optional `roleUpdatedAt` (Date) and
  `roleUpdatedBy` (acting admin `uid`). **Absent `role` ≡ ordinary member.**
  The only stored value is `"lead"`; "member" is never stored.
- **BR-17** Reading a team role is fail-safe toward least privilege: the
  membership is `lead` only if `role === "lead"` exactly; any other value
  (missing, `"member"`, `"admin"`, wrong type, unknown string) is an
  ordinary member — never `denied`, never elevated. `roleUpdatedAt/By`
  are never consulted for authorization.
- **BR-18** `PATCH /api/admin/teams/[teamId]/members/[uid]`, body
  `{role: "lead" | "member"}`, is **app-admin-only** (`requireAppAdmin`).
  `"lead"` sets `role`, `roleUpdatedAt`, `roleUpdatedBy`; `"member"` deletes
  `role` and sets `roleUpdatedAt`/`roleUpdatedBy`. Both are idempotent.
  Anything else → `invalid_input`.
- **BR-19** The target must be a **real, current membership** of exactly that
  team (document `teamMemberships/{uid}__{teamId}` exists and validates via
  `isValidMembershipFor`); otherwise `not_a_member`, with no document
  created. The read-check-write happens in one Firestore transaction so a
  concurrent removal can never leave a role on a missing/recreated
  membership. App-admin status of the **target** is irrelevant.
- **BR-20** Multiple leads per team are allowed; zero leads is valid; no
  minimum, maximum or "primary" lead exists.
- **BR-21** Removing a membership (existing `removeTeamMember`, unchanged)
  ends lead status, because the role lives on that document. Every
  membership-granting path (`applyMembershipGrant`: invitation, access
  request approval, admin grant) writes a fixed record with **no** `role`,
  so a removed-then-re-added person is an ordinary member and a
  grant can never carry or preserve a role.
- **BR-22** Team lifecycle. **Assigning** lead (`role: "lead"`) requires the
  owning team's status to be exactly `"active"`, verified server-side by a
  fresh read of `teams/{teamId}.status` inside the same transaction as
  BR-19; a `disabled` team, or a missing/malformed status, →
  `team_disabled` and nothing is written (fail closed; this also applies to
  re-assigning an already-lead member). **Removing** lead (`"member"`) is
  allowed regardless of team status (it only reduces privilege). An
  existing `role` is never altered by a team being disabled or
  re-enabled: the stored role stays untouched while the team is disabled
  (dormant — not an effective lead, BR-27) and is effective again on
  re-activation, with no write. Lead on a disabled team grants
  nothing (BR-28); all team-lifecycle semantics stay those of
  `authorizeTeamAccess` (BR-27). A nonexistent team has no membership →
  `not_a_member`.
- **BR-23** Members cannot assign or remove lead for themselves or others;
  there is no self-service path and no client-supplied role is ever trusted.

### `resolveTeamRole`
- **BR-24** `resolveTeamRole(identity, teamId)` returns
  `{ok: true, role: "admin" | "lead" | "member" | "denied"}` or
  `{ok: false, error: "read_failed"}` (never collapsed into `"denied"`).
- **BR-25** It **wraps** `authorizeTeamAccess` and reuses its decision
  verbatim for `admin`/`denied`; for `member` it additionally reads the
  caller's membership document and maps it with BR-17, and confirms the
  team status is `"active"` before returning `lead` (BR-27). Precedence:
  app admin ⇒ `"admin"` even if the same identity also holds a lead
  membership. A lead is never `"admin"`.
- **BR-26** `authorizeTeamAccess` — signature, return type, semantics,
  tests — and every existing caller are **unchanged**. No existing
  operation switches to `resolveTeamRole` in F0. The roster authorizes with
  `authorizeTeamAccess` and derives each entry's `isLead` from that member's
  own membership document via BR-17 and the team's `active` status (BR-9); `resolveTeamRole` has no production
  caller in F0 and is exercised by tests, ready for A–D.
- **BR-27** Team `disabled`/nonexistent semantics are inherited unchanged
  from `authorizeTeamAccess` (nonexistent or malformed status ⇒ `denied`
  for everyone incl. admin; a member of a disabled team stays a member).
  A stored `role: "lead"` is only an **effective** lead while the team's
  status is exactly `"active"`: on a disabled team (or if the status
  cannot be read as `"active"`) a stored lead resolves to `"member"`
  — never `lead`, never `denied`. The stored role is untouched and
  becomes effective again on re-activation (BR-22).
- **BR-28** Lead confers **no** permission in F0: no existing or new
  operation grants anything because of `lead`. The only observable effects
  of `lead` are the marker in the roster/admin list and the return value of
  `resolveTeamRole`.

### Admin member list
- **BR-29** `GET /api/admin/teams/[teamId]/members` (existing,
  app-admin-only) gains, **additively**, per member: `displayName: string |
  null` and `role: "lead" | "member"`. Existing fields `uid` and `email` and
  existing exclusion/failure behaviour are unchanged. `role` is the
  **stored** role (`membershipRoleOf`), not the effective one. Names come
  from one batched profile read; because a name is presentation, a failed
  profile read degrades every name to `null` instead of failing the list.
  E-mail remains visible to admins only, and this admin DTO (which carries
  `uid`) is never reused for the member-facing roster.

### UI
- **BR-30** **Min profil** (`/me/profile`): signed-in users get a form with
  label "Visningsnavn", help text stating who can see the name (other
  members of teams they belong to and administrators, not their e-mail
  address; not unique; changeable or removable at any time), "Lagre" and
  "Fjern visningsnavn" actions (the latter only while a name exists, stating
  that it removes only the name, not the account or memberships), and
  loading/pending/success/validation-error/generic-error/retry states;
  signed-out users get the existing sign-in prompt. After a save the field
  shows the server's canonical value. The client only checks "not empty" —
  no length or character rules and no maxLength attribute (the server counts code
  points). A new header link "Min profil" appears for signed-in users only.
- **BR-31** `/teams/[teamId]` gains a collapsed, read-only "Medlemmer"
  section (independent fetch on first expand, independent loading/error
  state — a roster failure never affects any other section, and adds no
  request to `TeamDetail`'s existing initial `Promise.all`). It shows
  display name or fallback, "Teamlead" as **visible text** (never colour
  alone), and "Deg" for `isSelf` (both may appear on one row). Hidden for callers who cannot view the
  team (existing behaviour).
- **BR-32** `/admin/teams/[teamId]` member rows show display name (when set)
  as primary text with e-mail secondary, a "Teamlead" text marker, and a
  toggle action "Gjør til teamlead" / "Gjør til vanlig medlem" using the
  existing per-row pending/error pattern (the row's two mutations block each
  other); the existing remove action is unchanged. The marker shows the
  **stored** role: on a disabled team it reads as a stored, currently
  inactive role, promotion is disabled in the UI (a hint only — the server
  rejects it with `team_disabled` regardless) while demotion and removal
  stay available. Members without a name show "Medlem uten navn" with the
  e-mail as the admin identity line. No new page and no navigation refactor.
- **BR-33** All new copy is Norwegian, in per-feature copy modules.

### Backwards compatibility
- **BR-34** No migration, backfill or rewrite of any existing document.
  Existing memberships without `role` behave exactly as today; existing
  users without a profile behave exactly as today; existing API routes
  keep their status codes and response shapes (additive fields only, see
  BR-29); `skillProgress`, forum, surveys, challenges, invitations and
  access requests are untouched.

## Edge cases and failure behavior
- Whitespace-only, `"  "`, single character, 51 code points, zero-width
  space, `U+202E` (RLO), newline, tab-only → `invalid_input`.
  `"Zoë"` in NFC vs NFD → stored identically (NFC). 50 astral/emoji code
  points accepted (limit counts code points, not UTF-16 units).
- Two members with the same name, or a name equal to another's e-mail or to
  "Admin" → allowed (BR-5); the lead/admin marker is system-rendered, never
  derived from the name.
- Membership exists but user never set a name → "Medlem uten navn".
  Several unnamed members are indistinguishable to teammates (accepted).
- Membership of a user whose Firebase Auth account was deleted still appears
  in the **roster** as unnamed (no Auth lookup) but is excluded from the
  **admin list** (existing behaviour). Accepted, documented inconsistency.
- Profile deleted while someone has the roster open → the next load (page
  reload or retry) shows the fallback; the loaded list is not live.
- Corrupt profile document (wrong type, invalid name) → treated as absent
  (`displayName: null`); never thrown, never partially exposed.
- Concurrent role change + removal → transaction: either role is applied to
  the existing membership or `not_a_member`; removal always wins by deleting
  the document.
- Firestore failure → `persistence_failed`/`read_failed`/500; no partial
  write; no content echoed in errors or logs.
- Assigning lead to an app admin who is also a member → allowed (team
  active); effective role remains `admin` (BR-25).
- Team disabled after someone became lead → role untouched; re-enabling
  needs no action. Assigning a *new* lead on that disabled team →
  `team_disabled`; un-assigning still works.

## Security and privacy
Feature-specific implications of `docs/SECURITY.md`:

- **First member-visible identity data.** Display name is personal data. It
  is intentionally visible to same-team members and to app admins, and to
  nobody else. E-mail is **never** a fallback or co-exposed for non-admins.
- **Forum unlinkability (critical).** `authorTag` is a pure function of
  `(teamId, authorUid)`. Therefore no member-visible response may expose a
  `uid`, membership document id (`{uid}__{teamId}`), or per-member stable
  value derived from it (BR-14). The roster's ordering must not use `uid`
  (BR-9). Tests assert that roster/profile responses contain only the
  documented keys.
- **Authorization** is server-side, from verified identity and fresh
  Firestore state on each call. `uid` in a URL is used only by the
  admin-only role route and is never authorization evidence; profile
  endpoints take no `uid`.
- **Not a directory.** No list/search/by-uid profile read; roster only for a
  team the caller belongs to; bounded (BR-13, BR-15).
- **Team boundary / org boundary.** Roster scoped by the authorized
  `teamId`; Team X membership yields nothing about Team Y (BR-11). A
  person's single global name is visible in every team they belong to —
  by design (the user is told so on the profile page).
- **Former members** lose roster access immediately (BR-12) — but names they
  already saw remain with them (unavoidable, accepted).
- **Lead is not an admin.** Lead grants nothing (BR-28). App-admin rights
  are unchanged, still derived only from `APP_ADMIN_EMAILS` + verified
  e-mail (`docs/ARCHITECTURE.md`). A lead being able to escalate by editing
  their own membership is impossible: no client write path exists, rules
  deny all client access.
- **Impersonation.** Free-text, non-unique names can imitate a colleague.
  Accepted residual risk in F0; mitigated because authority markers (lead)
  are system-rendered and names confer no authority. Moderation of display
  names is out of scope for F0.
- **Logging.** Display names are personal data: never logged; errors do not
  echo the submitted name.
- **Encryption.** `userProfiles` is **not** application-encrypted, matching
  the existing posture for `teams.name`/`surveys.title`-class short
  structured text that must be readable/sortable server-side; it contains
  no sensitive free text, only a self-chosen label. (Recorded explicitly
  per invariant 16.) Stronger protection for future individual
  development data is decided in C/D, not here.
- **Retention/erasure.** The user can hard-delete their name at any time
  (BR-3). Name persists otherwise until deleted. **No account-deletion
  flow exists**, so an orphaned `userProfiles` document can outlive a
  deleted Firebase account; this is acknowledged here and is one of the
  items that must be resolved before C/D are production-ready (J9). Not
  solved in F0.
- **Audit.** Role changes record the last actor/time on the membership
  (`roleUpdatedBy/At`); history is not retained (accepted, minimal).
- **Invariants added to `docs/SECURITY.md` at closeout** (19–22): (a) member-visible responses never contain another member's
  `uid`/e-mail; (b) display name is never an identifier nor authorization
  evidence and is never e-mail-derived; (c) profile data is readable only
  by its owner, same-team members (roster) and app admins (admin list) —
  no cross-team/org directory; (d) team role is read fail-safe to least
  privilege and never client-supplied.

Anonymity correlation check: F0 adds no timestamp/metadata to any anonymous
collection (surveys, challenges). `roleUpdatedAt` exists only on
memberships, which are already identity-keyed. No new correlation path into
`surveyResponses`/`challenges`.

## Architecture decisions
- **Slices.** New `src/features/profiles/` (domain: `display-name.ts`
  normalise/validate, `user-profile.ts` record validator; server: get/set/
  delete own profile, `getDisplayNames` batched reader; client
  gateway; components: `ProfileForm`; `copy.ts`). Team-role logic stays in
  `src/features/teams/` (domain: `membershipRoleOf` added beside
  `team-membership.ts`; server: `resolve-team-role.ts`,
  `set-team-member-role.ts`, `list-team-roster.ts`; client + components:
  roster section, admin row changes). `teams` → `profiles` is a one-way
  import of the batched name reader only; `profiles` never imports `teams`.
- **`userProfiles/{uid}`**: document id = Firebase `uid`; fields
  `displayName`, `createdAt`, `updatedAt`. No stored `uid`/e-mail/other
  fields. Admin-SDK-only; `firestore.rules` gets the standard deny block
  (plus a rules test like its siblings in `firestore-deployment-config.test.ts`).
  Rationale for a separate collection (not a field on memberships): a name
  is per-person, not per-team; one write updates it everywhere; a future
  account-erasure deletes one document.
- **`teamMemberships`**: optional `role`, `roleUpdatedAt`, `roleUpdatedBy`.
  Stored on the existing document; `isValidMembershipFor` and
  `extractMemberUid` unchanged; `TeamMembershipRecord` gains optional
  fields. Canonical "member" = absent field.
- **Indexes**: none. Roster uses `where("teamId","==")` (single-field,
  automatic) and `getAll` for profiles. No change to `firestore.indexes.json`.
- **`resolveTeamRole`**: new file `teams/server/resolve-team-role.ts`;
  calls `authorizeTeamAccess` (same deps seam) then, only when the result is
  `member`, re-reads the caller's membership and — only for a stored lead —
  the team status (an effective lead needs an `active` team). The extra
  reads occur only for callers of the new function. No refactor of
  `authorizeTeamAccess`.
- **Write path for profile**: Firestore transaction (read existing → set
  preserving `createdAt`). Delete is a plain document delete.
- **Routes** (thin delegates, bearer-token extraction as in siblings):
  `app/api/me/profile/route.ts` (GET/PUT/DELETE),
  `app/api/teams/[teamId]/members/route.ts` (GET),
  `app/api/admin/teams/[teamId]/members/[uid]/route.ts` (adds PATCH beside
  existing DELETE; DELETE unchanged). Existing `app/api/me/route.ts` is
  unchanged.
- **Pages**: `app/me/profile/page.tsx` (+ `PageShell`). `SiteHeader` gets one
  link; existing tests extended.
- **Rollout** — *no feature flag* (recommended; see "Rollout").
- Existing decision preserved: admin check remains `requireAppAdmin`; F0
  adds no new env var.

## Authorization matrix

| Operation | Verified identity | Extra check | Denied result |
|---|---|---|---|
| `GET/PUT/DELETE /api/me/profile` | required (`verifyIdToken`, revocation-checked) | `uid` = token `uid` only | 401 |
| `GET /api/teams/[teamId]/members` | required | `authorizeTeamAccess` ∈ {member, admin} | 401 / 403 / 500 on read failure |
| `PATCH /api/admin/teams/[teamId]/members/[uid]` | required | `requireAppAdmin`; target real membership of `teamId` | 401 / 403 / 404-equivalent `not_a_member` / 400 `invalid_input` |
| `GET /api/admin/teams/[teamId]/members` (existing) | required | `requireAppAdmin` (unchanged) | unchanged |
| `resolveTeamRole` (server fn) | passed in | as BR-24–27 | `denied` / `read_failed` |

## Validation
- Display name: BR-4 (normalise then validate; stored value = normalised).
- Role body: exactly `"lead"` or `"member"`; any other type/value rejected.
- Route params (`teamId`, `uid`) are opaque strings used only for lookups;
  empty/blank → `invalid_input`/not found, never a Firestore path error.
- Validators are fail-closed runtime guards, no unchecked casts
  (`.claude/rules/typescript.md`).

## Error handling
Existing conventions: `unauthenticated` (401), `forbidden` (403),
`invalid_input` (400), `not_a_member` (404-equivalent status chosen by the
route task, consistent with sibling routes), `persistence_failed`/
`read_failed` (500). A denied result never reveals whether a team or a
member exists beyond what the caller already may know. UI maps every failure
to a generic Norwegian message; none echoes input or server text.

## Test boundaries
Highest observable boundary first: server operations with injected `*Deps`
(repo convention), then route handlers, then components.

| Boundary | Covers |
|---|---|
| `display-name` domain unit: NFC/trim/collapse, 2–50 code points, astral/emoji, combining marks, non-Latin, `\p{C}`, RLO/ZWSP/newline, letter-or-number rule, non-string | BR-4, BR-5 |
| Profile server ops (get/set/delete own) with fake store and verifier: create, update preserves `createdAt`, idempotent delete, invalid input writes nothing, unauthenticated, corrupt doc ⇒ null, persistence failure, no `uid` parameter accepted, name not in error/log output | BR-1–3, BR-6, BR-7 |
| `resolveTeamRole` with fake collection: admin, admin+lead ⇒ admin, lead, member without `role`, malformed/unknown `role` ⇒ member, non-member ⇒ denied, removed membership ⇒ denied, disabled team member ⇒ member and stored lead ⇒ member (not lead), nonexistent team ⇒ denied, read failure ⇒ `read_failed`; `authorizeTeamAccess` suite unchanged and green | BR-17, BR-24–28 |
| `setTeamMemberRole`: admin-only, non-admin forbidden, lead set/unset, idempotent, multiple leads, target not a member ⇒ `not_a_member` and no document created, concurrent-removal transaction, assign on `disabled`/missing/malformed team status ⇒ `team_disabled` with zero writes (incl. re-assign of existing lead), un-assign on disabled team succeeds, existing lead keeps role across disable→enable (no write), invalid role, persistence failure | BR-16, BR-18–20, BR-22, BR-23 |
| Membership-grant regression: invitation resolution, access-request approval, immediate grant never write `role`; remove then re-grant ⇒ member | BR-21, BR-34 |
| `listTeamRoster`: member ok, same-team second member, admin non-member ok, cross-team denied, removed member denied, non-member denied, unnamed ⇒ null, corrupt profile ⇒ null, leads first/ordering, `isSelf`, response keys exactly `{displayName,isLead,isSelf}` (**no uid/e-mail**, asserted by deep key check), no Auth lookup performed, truncation flag, batch size ≤ 100, read failure ⇒ 500 | BR-8–15, BR-10 |
| `listTeamMembers` (admin) regression + additive fields; e-mail only for admin | BR-29 |
| Route handlers: status mapping, bearer extraction, thin delegation, body validation, `DELETE` member route unchanged | BR-1–3, BR-8, BR-18 |
| `firestore.rules` deny-block test for `userProfiles` | Security |
| Components (RTL): `ProfileForm` states and copy, inert rendering of `<script>`-shaped names, roster collapsed/independent failure/fallback/lead text, admin row name + toggle + pending/error, header link only when signed in | BR-6, BR-30–33 |
| Regression suites unchanged & green: auth, teams, skill progress, forum, surveys, challenges | BR-26, BR-34 |

## Acceptance criteria
- [x] A user with no profile and memberships without `role` see identical
      behaviour to before (existing suites green, no data rewrite).
- [x] A user can set, change and remove their display name; normalisation
      and validation match BR-4 at the server boundary.
- [x] No endpoint returns another user's profile by `uid`; no list/search
      profile endpoint exists.
- [x] Roster shows names/fallback and lead text to same-team members and
      admins only; response bodies contain no `uid`/e-mail (test-asserted).
- [x] Cross-team and removed-member access is denied on the next call.
- [x] An admin can mark/unmark multiple leads; a non-member target is
      rejected; removing membership ends lead status; re-adding gives a
      plain member.
- [x] `resolveTeamRole` returns the four roles per BR-24–27; unknown
      `role` values resolve to `member`.
- [x] `authorizeTeamAccess` and all existing callers are unmodified; lead
      grants no new capability anywhere.
- [x] `userProfiles` has a deny-all rule and a test; no new index.
- [x] `listTeamMembers` response is additive; existing gateway parser and
      tests still pass.
- [x] Display names never appear in logs or error messages.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass;
      `DATA-MODEL.md`, `ARCHITECTURE.md`, `SECURITY.md`, `UI-UX.md` updated
      at closeout.
- [x] No diff touches Demo Team, roadmap, skills, forum, surveys or
      challenges code.

## Rollout
- **Additive and migration-free.** No backfill, no destructive step, no
  data rewrite; deploy order is irrelevant (old code ignores new fields;
  new code treats absence as today's behaviour). Rules file gains one deny
  block (redundant with the catch-all, added per repo convention; deploying
  rules is not a prerequisite for safety).
- **No feature flag (recommended).** Repo precedent (`FEATURE_FORUM_ENABLED`)
  hides an *unfinished/iterating* UI; F0's data and auth layer is fully
  backward-compatible, and exposure is **opt-in by the user** — no name is
  visible until that person sets one, and the new roster shows only
  "Medlem uten navn", leads, and the caller's own name until then. A flag
  would add a fail-closed code path and tests without reducing risk. If the
  product owner prefers a soft launch, the roster section alone may be
  flagged; the server contract would not change.
- **Order with later features:** F0 merges before A; A/B/C/D each state
  where they start using `resolveTeamRole` and a non-`uid` member reference.

## Dependencies
- Depends on: existing `verifyIdToken`, `authorizeTeamAccess`,
  `requireAppAdmin`, `teamMemberships`, UI primitives.
- Required by: A (owner display, lead permissions), B, C1/C2 (lead, k-gated
  aggregates), D1/D2 (check-in participants, mentors).
- **Demo Team (future impact, not changed now):** the demo team has only the
  presenter as a real Auth user. F0 needs no seeder change and must not
  cause it to create Auth users. Later demo expansion may add synthetic
  `teamMemberships` (+ optional `role: "lead"`) and `userProfiles` for
  synthetic uids; that works because the roster/`resolveTeamRole` read
  Firestore only, not Auth. Such members would still be absent from the
  admin list (which requires an Auth lookup) — to be addressed in the
  Demo Team follow-up spec. Seed ownership for those documents must be
  added to the manifest then.

## Risks
- **Forum de-anonymisation via any future uid exposure** — mitigated by
  BR-14 and key-assertion tests; must be carried forward as a review item
  for A–D.
- **Abusive/impersonating display names** — moderation out of scope.
- **Roster count/unnamed ambiguity** — cosmetic.
- **Orphaned profiles without account-deletion flow** — documented, deferred
  to C/D readiness.
- **Scope creep via "lead"** — guarded by BR-28 and the out-of-scope list.
- **Terminology drift (team role vs professional role)** — guarded by Key
  concepts and field naming; later specs must use `professionalRole*`.
- **`TeamDetail` growth (828 lines)** — roster is a self-contained
  component with its own fetch.

## Follow-up constraints for A–D
F0 deliberately ships **no** member reference: the roster is display-only
(no selection, no actions), and the only `uid`-addressed operation is
admin-only. An opaque reference is therefore **not needed and not built in
F0** (no speculative identifier infrastructure). Adding one later is
additive: the roster response gains a key; nothing in F0 is renamed.

**Constraint for Skills Planning (A) — must be resolved before `owner` is
implemented** (and inherited by B, C, D mentors/participants/selectors): a
client-visible member reference must be designed, security-reviewed and
specified first. It must:
- not be, contain, or be reversibly/computably derived from a Firebase
  `uid`, and must not make `authorTag` (`SHA-256(teamId:authorUid)`)
  computable or linkable (e.g. not an unkeyed hash of `uid`/`teamId`);
- never be authorization evidence: the server resolves it to a member and
  then performs normal fresh authorization (`authorizeTeamAccess`/
  `resolveTeamRole`, membership re-verified) on every use;
- be scoped to one team (valid only with its `teamId`; useless elsewhere);
- fail closed (unresolvable/stale ⇒ rejection, never a guess), and stop
  resolving when the member leaves the team;
- be stored, if persisted (e.g. roadmap `ownerUid`), as server-side
  identity only, never returned raw to clients.

F0 does not foreclose any of these: the roster's exact-key contract (BR-9,
BR-14) is additive-friendly, and roster ordering/`isSelf` use no `uid`.

## Known limitations (as built)
Documented limitations, not defects:
- **Display-name Unicode.** BR-4 rejects every format code point (`\p{C}`), so
  ZWNJ (used in e.g. Persian names) and ZWJ (emoji sequences) are refused.
  A possible future compatibility question; the rule is unchanged in F0.
- **Admin list vs roster.** The admin list excludes a membership whose
  Firebase Auth account no longer exists (it needs the e-mail lookup); the
  member roster has no Auth lookup and shows such a membership as nameless.
- **Truncation and `isSelf`.** A team above 500 members gets a truncated
  roster (document-id order); the caller's own row can be missing. The UI
  does not compensate with any `uid` lookup.
- **Roster is not live.** It is loaded on first expand and refreshed only by
  a page reload or retry.
- **Extra reads.** `resolveTeamRole` costs one extra membership read for a
  member, plus a team-status read for a stored lead; nothing calls it yet.
- **No lead-only capabilities.** Lead is a marker and a classification; later
  features must opt in explicitly.
- **Account deletion.** No flow exists; an orphaned `userProfiles` document
  can outlive a deleted Firebase account (J9, to be solved before C/D are
  production-ready). `DELETE /api/me/profile` removes only the profile.
- **Display-name moderation** and impersonation: out of scope (see Security).

## Open questions
None. All six draft defaults are resolved by the product owner (lead
assignment on a disabled team changed to: rejected for *new* assignment,
see BR-22).
