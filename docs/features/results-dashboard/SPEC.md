# Team Results Dashboard and Trends

## Status
Approved — Phase 2 implemented (TASK-001 through TASK-005 Done; see
[TASKS.md](./TASKS.md)). Not yet deployment-ready: see "Deployment
readiness" below.

**Superseded (as of `docs/features/team-management/SPEC.md` TASK-011):**
the static single-team authorization path this document describes
(`TEAM_ASSIGNMENTS`, `resolveTeamForUser`, `get-dashboard.ts`, the `GET
/api/results` route) has been retired from the codebase. `/results` is now
a thin client-side compatibility redirect to `/teams`/`/teams/[teamId]`
rather than a page that renders results itself, and all team-scoped
authorization now goes through `authorizeTeamAccess` against Firestore
`teamMemberships`. This document is preserved as a historical record of
what Phase 2 implemented and why — it is not rewritten to describe the
current model. See `docs/features/team-management/SPEC.md` for the
current, Firestore-backed authorization model and its successor endpoint
(`GET /api/teams/[teamId]/results`).

## Problem
DevPulse can currently only accept anonymous pulse survey responses (Phase
1) — nobody can see the resulting signal yet. Teams and organizations have
no way to observe their own wellbeing/delivery signal over time, which is
the entire point of running the survey (`docs/PRODUCT.md`).

## User outcome
A developer whose email has been pre-assigned to a team can create an
account, verify it, sign in, and see that team's most recently completed
period's pulse averages plus how those averages have moved over the last
12 completed periods — without ever seeing another team's data, any
individual's answers, or anything about the still-in-progress period.

## Scope
- Firebase Authentication (email/password) — sign-up and sign-in, with
  required email verification before an account's team is resolved.
- A minimal, **server-verifiable** team-assignment mechanism suitable for
  this PoC phase: a static, server-only configuration mapping specific,
  Firebase-verified email addresses to a `teamId` from the existing
  application-defined team list. No self-service team selection, no
  runtime admin UI/API.
- A protected team dashboard (auth + team assignment required) that shows,
  for the signed-in user's own team, **only closed-period results**:
  - The most recently closed period's per-dimension mean (Flow, Stress,
    Fun) and response count — shown only when that count meets the
    configured minimum threshold.
  - A trend view of the same per-dimension aggregate across the most
    recent 12 **closed** periods.
- The current (open) survey period exposes no aggregate, count, or
  threshold-state of any kind — to no one, under any request.
- Server-side computation of aggregates by decrypting and validating the
  relevant stored `SurveyResponse` documents at request time, restricted to
  closed periods (introduces the first authorized decryption/reporting
  path in the codebase).
- Server-side enforcement that a user can only ever see their own team's
  data, derived solely from their verified identity's static assignment —
  never from a client-supplied team ID.

## Out of scope
- Any change to the Phase 1 anonymous submission flow — it remains public,
  unauthenticated, identity-free, and dedup-free. This feature only adds a
  new, separate authenticated *read* surface.
- Any self-service or admin UI/API for managing team assignments (static
  config only, edited via code/config change and redeploy).
- Any exposure, in any form (aggregate, count, or threshold-met/not-met
  signal), of the current/open survey period's data. This is a hard
  exclusion, not a deferred one.
- An "admin" role, org-wide configuration, or any cross-team view.
- SSO/OAuth sign-in providers (email/password only for this feature).
- `AnonymousChallenge` free-text reporting (Phase 3 per `docs/ROADMAP.md`).
- `SurveyParticipation` tracking or any identity-linked deduplication of
  submissions — still not introduced by this feature (see Security and
  privacy for why this leaves a documented residual risk).
- A managed, Firestore-backed `Team` collection (the static team list
  remains authoritative, as in Phase 1).
- Persisted/cached aggregates (`SurveyAggregate` documents) — closed-period
  aggregates are computed on demand and are structurally immutable (see
  Architecture decisions), so no snapshot storage is needed.
- Rate limiting or abuse controls on the Phase 1 submission endpoint.
- Trend windows other than the fixed most-recent-12-closed-periods (no
  custom date range picker, no "all history" view).

## Key concepts
- **Team assignment** (replaces free-form self-declaration): a static,
  server-only, deploy-time configuration mapping one specific
  **Firebase-verified email address** to one `teamId` from the existing
  `ALLOWED_TEAM_IDS` list. Not user-selectable and not writable from any
  application code path — realized the same way `ALLOWED_TEAM_IDS` itself
  is: static, application-defined config. A user's team is resolved by
  looking up their verified email in this mapping at request time; there
  is no "select your team" UI action.
- **Open vs. closed survey period**: the current server-computed period
  (`getCurrentSurveyPeriod`) is always **open**; every earlier period is
  **closed**. This is derived purely by comparing period strings — no new
  "status" field is stored. Only closed periods are ever eligible to have
  any aggregate published; the open period never is, for anyone.
- **Dashboard aggregate**: for one **closed** period and one team, the mean
  of each of the three fixed pulse dimensions plus the response count,
  computed server-side, on demand, from `SurveyResponse` documents that
  were **successfully decrypted and schema-validated** — published only
  when that count meets the minimum response threshold. Never computed or
  exposed for the open period, in any form, regardless of the true
  response count (including zero).
- **Minimum response threshold**: the existing, configurable threshold
  (`docs/SECURITY.md` invariant 12, initially **5**), now understood
  explicitly as a count of **response documents that decrypted and
  validated successfully** — not verified unique respondents. Phase 1
  intentionally has no participation/dedup identity linkage, so this
  threshold cannot by itself guarantee five distinct people answered (see
  Security and privacy).
- **Trend window**: the most recent 12 **closed** survey periods. The open
  period is never included, even as a 13th/partial data point.

## Actors and access
- **Anonymous respondent**: unchanged from Phase 1 — can still submit
  without authentication. Cannot view any dashboard.
- **Authenticated developer**: can sign up and sign in; must verify their
  email before any team is resolved for their account. Is recognized as a
  member of a team only if their verified email appears in the static
  team-assignment mapping — never by self-selection. Can view only their
  own team's closed-period results (most recent closed period + 12-closed-
  period trend). Cannot view any other team's data, and cannot view the
  open period's data (nobody can).
- **Admin**: N/A for this feature. Team assignment is static config edited
  by whoever manages deployment, not a runtime admin role.

## User stories
1. As a visitor, I want to create an account and verify it so that I can
   access my team's results.
2. As a developer whose email has been pre-assigned to a team, I want to
   be automatically recognized as a member of that team once I verify my
   email and sign in, so that team membership can't be freely
   self-selected by anyone.
3. As a signed-in team member, I want to see my team's most recently
   completed period's pulse averages, so that I know how my team's last
   full period actually went.
4. As a signed-in team member, I want to see how my team's averages have
   moved over the last several completed periods, so that I can spot
   trends, not just a single snapshot.
5. As a signed-in team member, I want to be unable to see another team's
   results, so that team-level data stays scoped to the people it belongs
   to.
6. As the system, I want to withhold any period's aggregate until it is
   both closed and at/above the minimum response threshold, and to never
   expose any data about the still-open period, so that repeated
   observation of the dashboard can't be used to infer individual answers
   or submission timing.

## Behavioral requirements
- **BR-1**: A visitor can create an account using email and password via
  Firebase Authentication.
- **BR-2**: A visitor with an existing account can sign in.
- **BR-3**: A newly created account must verify its email address (via
  Firebase's standard email-verification flow) before the server will ever
  attempt to resolve that account's team.
- **BR-4**: On any protected request, the server resolves the signed-in
  user's team solely by looking up their Firebase-**verified** email
  address in the static, server-only team-assignment mapping. There is no
  user-facing team-selection action, and no client-supplied team
  identifier is ever accepted or trusted as authorization evidence.
- **BR-5**: A signed-in user whose verified email is not present in the
  team-assignment mapping (or whose email is not yet verified) cannot view
  any dashboard/trend content; they see a state indicating no team is
  available to them.
- **BR-6**: The dashboard never exposes any aggregate, response count, or
  threshold-met/not-met signal for the current (open) survey period, to
  any user, regardless of how many responses actually exist for it.
- **BR-7**: For each closed survey period, the dashboard shows the signed-
  in user's team's per-dimension mean and response count for that period
  only if the count of successfully decrypted and schema-valid
  `SurveyResponse` documents for that team/period meets the configured
  minimum threshold; otherwise that period shows an "insufficient
  responses" state that does not reveal the actual count.
- **BR-8**: The dashboard's trend view shows, independently per BR-7, the
  most recent 12 **closed** survey periods — the open period is never
  included.
- **BR-9**: All published aggregates are computed server-side, on demand,
  from the matching closed-period `SurveyResponse` documents. Decrypted
  individual answers are never returned to, or otherwise rendered by, the
  client — only the computed aggregate figures (mean, and count when at or
  above threshold).
- **BR-10**: A user authorized for Team A cannot obtain Team B's dashboard
  or trend data through any request parameter, regardless of what the
  client sends; server-side authorization uses only the requester's own
  resolved team assignment (BR-4).
- **BR-11**: The Phase 1 anonymous submission flow is unchanged by this
  feature: submission remains unauthenticated, dedup-free, and no identity
  field is added to `SurveyResponse` as a result of introducing
  authentication.
- **BR-12**: Once a period is closed, its published aggregate for a given
  team is stable: recomputing it later (e.g. on a subsequent request)
  yields the same result, because Phase 1's submission flow never allows a
  new response to be written into a period other than the server's current
  (open) one.

## Edge cases and failure behavior
- A signed-in user's verified email is not present in the team-assignment
  mapping → no dashboard access; shown a "no team assigned" state (BR-5).
- A signed-in user's email is present in the mapping but not yet
  Firebase-verified → same no-access treatment as above until verified.
- A user's assigned `teamId` (per the static mapping) is no longer present
  in `ALLOWED_TEAM_IDS` (list changed since assignment) → treated as no
  valid team, same as unassigned.
- Any request, however parameterized, for the current/open period's
  aggregate → the server always returns the same fixed "not available yet"
  response — never a count, mean, or even a threshold-met/not-met flag —
  regardless of the true response count, including zero (BR-6).
- A `SurveyResponse` document for a closed period fails to decrypt or
  fails schema validation while computing an aggregate → excluded from
  both the threshold count and the mean for that period; nothing about the
  failure (record id, reason, or content) is logged.
- The same closed period is requested more than once (e.g. before/after a
  new submission attempt elsewhere) → returns an identical result every
  time, since no new `SurveyResponse` can ever be written into a period
  other than the server's current (open) one (BR-12).
- Missing, expired, or invalid Firebase ID token on a protected request →
  rejected with a generic auth error; no team resolution or aggregation is
  attempted.
- Firestore read failure while computing a closed-period aggregate → the
  request reports failure to the client; no partial/fabricated aggregate
  is returned.

## Security and privacy
- **Invariant 8/9 (server-side team authorization; no cross-team
  access)** — fixed in this revision: a user's team is resolved
  exclusively from a static, server-only, deploy-time configuration
  mapping keyed by their Firebase-**verified** email address (BR-3, BR-4),
  never user-selectable and never derived from any client-supplied value.
  This replaces the earlier draft's unrestricted self-declaration, which
  would not have been valid authorization evidence.
- **Email-ownership verification**: Firebase's email/password provider
  allows account creation with any email string without proving ownership.
  This feature therefore requires `emailVerified` (checked from the
  verified ID token) before the team-assignment lookup is trusted (BR-3) —
  otherwise an attacker could sign up claiming a colleague's email address
  and inherit their team assignment.
- **Invariant 10/11/12 (no individual scores; minimum threshold, initially
  5)**: the threshold now doubles as a **publication gate** applied only to
  closed periods (BR-7); the currently open period exposes no aggregate,
  count, or even a threshold-met/not-met signal to anyone (BR-6).
- **Differencing/manipulation risk — resolved for the live/open period**:
  because Phase 1 submission is public, unauthenticated, and permits
  unlimited repeat submissions, a dashboard user could otherwise submit
  known answers and compare the dashboard's aggregate before/after, or
  watch an "insufficient" state flip to "published" at the moment a
  threshold-crossing submission lands, to infer information about other
  respondents' answers or submission timing. This feature closes that
  vector by never exposing *any* data for the open period (BR-6).
  Aggregates are only ever shown for closed periods, whose underlying
  response set can no longer change (BR-12), so repeated observation of a
  closed period yields no new information.
- **Response-count-vs-respondent caveat — explicitly documented, not
  fixed**: the minimum-response threshold counts *successfully decrypted,
  schema-valid response documents*, not verified unique respondents. Phase
  1 intentionally has no participation record or deduplication tied to
  identity (anonymous submission is a deliberate design goal), so nothing
  in this feature, or Phase 1, can distinguish "5 different people" from
  "1 person submitting 5 times." This is an accepted, pre-existing
  limitation of the anonymous submission model (Phase 1 SPEC already
  documents unlimited repeat submissions as intended behavior), not a
  regression introduced here.
- **Residual risk — explicitly flagged, not fixed by this feature**:
  restricting publication to closed, immutable periods removes the
  live/multi-observation differencing vector above, but does not by
  itself prevent a participant from deliberately submitting one or more
  known-value responses into the currently open period and, once that
  period closes and its aggregate is published, algebraically subtracting
  their own known contribution(s) from the published mean/count to infer
  information about the remaining respondents. Fully preventing this would
  require identity-linked deduplication of submissions, which directly
  conflicts with Phase 1's anonymous, unauthenticated submission design and
  is out of scope for this feature. **This risk is explicitly accepted as
  a documented, non-blocking limitation of this PoC phase**, caused by
  Phase 1's anonymous, unauthenticated, non-deduplicated submission model
  — not a gap introduced by this feature. Phase 2 does **not** attempt to
  solve it by introducing respondent identity, participation tracking,
  deduplication, or submission authentication; the accepted Phase 2
  mitigation is limited to: withholding all open/current-period results,
  publishing only closed periods, applying threshold suppression to
  successfully decrypted and validated response documents, never exposing
  exact results for the open period, and requiring Firebase-verified
  identity plus the server-side email-to-team assignment for authorization.
  Revisit only if real-world abuse is observed, and only via a future,
  explicitly scoped feature (e.g. participation-linked dedup, rate
  limiting, or coarser aggregate reporting) — not as a retrofit here.
- Invariant 14 (no sensitive content in logs): unchanged — decrypted
  values, and any decryption/validation-failure detail, are never logged.
- Invariant 17: N/A — this feature introduces no admin role.
- Correlation risk: the team-assignment mapping is a static,
  non-identity-joinable config keyed by email, entirely separate from
  `SurveyResponse`, which remains exactly as identity-free as Phase 1 left
  it (BR-11).
- Password handling is entirely delegated to Firebase Authentication; no
  custom password storage is introduced.

## Architecture decisions
- New feature slices, per `.claude/rules/architecture.md`:
  - `src/features/auth/` — sign-up/sign-in UI, email-verification flow,
    and the server-side verified-identity helper (Firebase ID token
    verification, including the `email_verified` claim).
  - `src/features/teams/` — the static team-assignment configuration
    (verified email → `teamId`) and the server-side resolution function
    used by protected requests.
  - `src/features/results/` — aggregation domain logic (open/closed period
    boundary, decrypt+validate-before-threshold ordering, mean
    computation, trend-window enumeration) and server operation(s), plus
    the dashboard/trend UI components.
- New dependency: `firebase` (client SDK), for browser-side sign-up/
  sign-in and obtaining a Firebase ID token. `firebase-admin` (already a
  dependency since Phase 1) verifies that ID token server-side and reads
  Firestore.
- Session mechanism: the client holds the Firebase-managed ID token and
  sends it with each protected request; the server verifies it via the
  Firebase Admin SDK per request. No custom session cookie/store is
  introduced.
- **No Firestore collection for team membership.** Team assignment is
  realized as a static, server-only configuration mapping (verified email
  → `teamId`), analogous in spirit to `ALLOWED_TEAM_IDS`; edited only via a
  code/config change and redeploy, not a runtime admin UI or API — the
  minimal, server-verifiable mechanism appropriate for this PoC phase.
  Exact placement (e.g. `src/features/teams/domain/team-assignments.ts`)
  is implementation detail.
- Firebase Auth requires email verification before an account's
  team-assignment lookup is trusted; the server checks the verified ID
  token's `email_verified` claim (never a client-asserted flag).
- **Open/closed period boundary**: a period `P` is closed iff it is
  earlier than `getCurrentSurveyPeriod()`'s result at request time; no new
  stored field is needed. The open period is never eligible for
  aggregation or publication — enforced in the aggregation server
  operation itself, not merely hidden in the UI.
- Aggregation remains computed on demand per request (no new
  persisted-aggregate/snapshot collection), restricted to closed periods.
  Immutability (BR-12) follows structurally from Phase 1's rule that a
  submission's period is always the server's current period at write time,
  so a closed period's underlying response set can never change again —
  no caching mechanism is required to make this true.
- Threshold/decryption ordering: for a requested closed team/period, the
  server first attempts to decrypt and schema-validate every candidate
  `SurveyResponse` document for that team/period; only documents that
  succeed count toward both the threshold check and the mean. Failures are
  silently excluded (see Edge cases).
- Trend window: the most recent 12 **closed** periods (current period
  excluded), computed by extending the existing period-computation domain
  logic (`getCurrentSurveyPeriod`) to enumerate the 12 periods immediately
  preceding (and not including) the current one.
- The team list remains the existing static, application-defined
  `ALLOWED_TEAM_IDS` (currently in `src/features/pulse-survey/domain/
  teams.ts`); if both `pulse-survey` and `teams` need it, it is promoted to
  shared infrastructure under `src/lib/` rather than duplicated.
- The Phase 1 submission flow (`src/features/pulse-survey/`) is not
  modified by this feature.

## Test boundaries
| Boundary | Covers |
|---|---|
| Domain: team-assignment resolution (verified + matched email → teamId; unverified/unmatched → no team) | BR-3, BR-4, BR-5, BR-10 |
| Domain: open/closed period boundary computation | BR-6, BR-7, BR-8, BR-12 |
| Domain: aggregation logic (decrypt+validate ordering, threshold suppression, mean computation) | BR-7, BR-9 |
| Domain: trend-window enumeration (12 closed periods) | BR-8 |
| Server API contract: dashboard/trend endpoint (auth, team resolution, open period always empty, closed-period threshold suppression, error cases) | BR-4, BR-5, BR-6, BR-7, BR-8, BR-9, BR-10 |
| UI: sign-up/sign-in + email-verification flow | BR-1, BR-2, BR-3 |
| UI: dashboard + trend display (no-team state, insufficient-responses state, open-period-always-empty state) | BR-5, BR-6, BR-7, BR-8 |

## Acceptance criteria
- [ ] A visitor can sign up with email/password, and must verify their
      email before any team is resolved for their account.
- [ ] A signed-in user whose verified email is not present in the static
      team-assignment mapping sees no dashboard content, and cannot cause
      one to appear via any client-side action or request parameter.
- [ ] A signed-in, verified user whose email is present in the mapping
      sees only their own assigned team's data — never another team's,
      regardless of request parameters.
- [ ] No request, at any time, returns an aggregate, response count, or
      threshold-met/not-met signal for the current/open survey period.
- [ ] For a closed period, the aggregate (mean per dimension + count) is
      shown only when the count of successfully decrypted and
      schema-valid responses meets the configured minimum threshold;
      otherwise an insufficient-responses state is shown that never
      reveals the actual count.
- [ ] The trend view shows up to 12 closed periods (never the open one),
      each independently subject to the threshold rule above.
- [ ] Requesting the same closed period's aggregate twice returns
      identical results.
- [ ] No API response, rendered page, or client-visible payload contains
      any individual response's decrypted answer values — only computed
      aggregates.
- [ ] No decrypted content, decryption/validation-failure detail, or key
      material appears in application logs.
- [ ] The Phase 1 anonymous submission endpoint's behavior and persisted
      `SurveyResponse` shape are unchanged.
- [ ] Relevant automated tests pass at each of the test boundaries above,
      plus `pnpm lint` and `pnpm typecheck`.

## Open questions
None blocking. The known-value-injection residual risk (Security and
privacy → "Residual risk") is explicitly accepted as a documented,
non-blocking PoC limitation — see that section for the accepted Phase 2
mitigation and the explicit decision not to solve it via identity,
participation tracking, deduplication, or submission authentication.

Non-blocking:
- Exact storage form of the static team-assignment mapping (code constant
  vs. environment/config value) — implementation detail for task
  planning, analogous to `ALLOWED_TEAM_IDS`.
- Final placement of the shared team-list constant if both `pulse-survey`
  and `teams` need it.
- Whether "no team assigned" and "email not yet verified" should be
  messaged identically or distinctly in the UI — low-stakes, since both
  states only reveal information about the requester's own account.

## Deployment readiness
All 5 tasks (TASK-001 through TASK-005) are implemented and reviewed, and
the automated test/lint/typecheck/build suite passes. Two things remain
before this feature can be considered deployment-ready against a real
Firebase project, neither of which is exercised by the automated suite:

- **`firestore.rules` and `firestore.indexes.json` must actually be
  deployed** to the target Firebase project (`firebase deploy --only
  firestore:rules,firestore:indexes`; see `docs/DEVELOPMENT.md`). Without
  the deployed rules, the public `NEXT_PUBLIC_FIREBASE_*` web config would
  let a client bypass this feature's server-side team scoping, open-period
  exclusion, and threshold suppression via direct client-SDK Firestore
  access. Without the deployed composite index, `GET /api/results` fails
  closed with a read-failure response against a real project.
- **Live end-to-end verification is still required**: signing in as a
  real, Firebase-verified, team-assigned user and loading `/results`
  against a live Firebase project. TASK-005's manual check was not
  performed in the implementation environment (no `.env`/test Firebase
  project configured there) and was substituted with the full automated
  suite, `next build`, and a `curl` of the server-rendered shell — this
  does not exercise real Firebase Auth, real Firestore reads, or the
  deployed Security Rules/indexes above.

The known-value-injection residual risk documented under "Security and
privacy → Residual risk" remains an explicitly accepted, non-blocking PoC
limitation and is not a deployment blocker.
