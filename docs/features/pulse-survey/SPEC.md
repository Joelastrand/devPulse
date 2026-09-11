# Recurring Developer Pulse Survey

## Status
Approved — Phase 1 implemented (TASK-001 through TASK-004 Done; see
[TASKS.md](./TASKS.md)).

## Problem
Teams and organizations currently have no lightweight, recurring signal for
sustainable workload, delivery flow, and morale (see `docs/PRODUCT.md`).
This feature delivers the first version of that signal: a short, anonymous,
recurring pulse survey that respondents can submit to, with responses stored
securely for future team-level insight.

## User outcome
A developer can, without logging in, submit a short (three-question) pulse
survey for the current week and receive confirmation that it was recorded.
Their answers are stored encrypted; DevPulse does not persist or
intentionally associate any respondent identity with a response.
No results/dashboard are shown yet — that is Phase 2.

## Scope
- A public (unauthenticated) submission form/page for the current survey
  period.
- Exactly three fixed questions (see Key concepts), each answered on a 1-5
  scale, all required.
- A self-declared team selection (from a predefined list) attached to the
  submission.
- Automatic, server-derived weekly survey period — no admin action needed to
  "open" or "close" a period.
- Server-side validation of the submission.
- Server-side application-level encryption of the sensitive answer content
  before persistence to Firestore.
- A confirmation state after successful submission.

## Out of scope
- Authentication, login, or any per-user identity (Phase 2).
- Team dashboard, aggregation, or any display of results (Phase 2).
- Minimum-response-threshold enforcement for display (not applicable — no
  aggregate is exposed by this feature; will apply when the dashboard
  feature is built).
- Admin-managed survey instances, scheduling, or reminders.
- Free-text/comment fields (Phase 3 `AnonymousChallenge`).
- Duplicate-submission detection/prevention (impossible without identity;
  see Edge cases).
- Firestore-backed `Team` *management* (admin create/disable, membership,
  invitations, access requests) — out of scope for this feature. The team
  list *itself* became Firestore-backed as of
  `docs/features/team-management/SPEC.md` TASK-006 (see Architecture
  decisions); this feature still has no authenticated identity or
  membership concept of its own.
- Real KMS-based key management (ARCHITECTURE.md open question; this
  feature uses a server-only environment variable instead).

## Key concepts
- **Survey period**: the current recurring interval a response belongs to,
  computed server-side as the current ISO week (UTC), e.g. `2026-W36`. Not
  supplied by the client.
- **Pulse questions** (fixed for this feature, 1-5 scale each):
  1. Flow / delivery satisfaction
  2. Stress / sustainable workload
  3. Fun / motivation
- **Team list**: as of `docs/features/team-management/SPEC.md` TASK-006,
  the currently `active` teams in the Firestore `teams` collection
  (`src/features/teams/server/list-active-teams.ts`), superseding the
  original static, application-defined array described below. It is
  exposed to the survey UI to populate the selection control, but any
  submitted `teamId` is always re-validated server-side against that same
  authoritative active-team source, read fresh at submission time, before
  a response is accepted. Not a managed/authorized-access concept yet (see
  Security and privacy) — the survey still has no per-user identity or
  membership check.

## Actors and access
- **Anonymous respondent**: any visitor, no authentication. Can view the
  survey form for the current period and submit one or more responses.
- **Team lead / Admin**: N/A for this feature (no viewing capability is
  introduced here; Phase 2).

## User stories
1. As an anonymous respondent, I want to answer three short questions about
   my week so that my team's wellbeing/delivery signal can eventually be
   seen in aggregate.
2. As an anonymous respondent, I want to indicate which team I'm on so that
   my (anonymous) answer can later be aggregated at the team level.
3. As an anonymous respondent, I want confirmation that my submission was
   recorded so that I know I don't need to retry.
4. As the system, I want to reject invalid submissions and store nothing
   sensitive in plaintext, so that survey data stays trustworthy and secure.

## Behavioral requirements
- **BR-1**: Any visitor, without authentication, can load the pulse survey
  submission form for the current period.
- **BR-2**: The form presents exactly three questions — Flow/delivery
  satisfaction, Stress/sustainable workload, Fun/motivation — each requiring
  a single answer on a 1-5 scale.
- **BR-3**: The form requires selecting exactly one team from the
  application-defined team list before submission is accepted.
- **BR-4**: The survey period is computed server-side (current UTC ISO
  week) at submission time; the server never accepts a client-supplied
  period value.
- **BR-5**: On submission, the server validates: all three answers present
  and within 1-5, and the `teamId` is a member of the authoritative,
  server-side allowed team set (as of TASK-006, the Firestore `active`
  teams, re-read fresh at submission time — never the page-load-time
  selector snapshot). If any check fails, the server rejects the request
  and persists nothing.
- **BR-6**: On a valid submission, the server encrypts the three answer
  values server-side using authenticated encryption, with a fresh
  cryptographically random nonce/IV generated per encryption operation,
  before writing to Firestore. The persisted response contains the
  encrypted payload, the metadata required to decrypt it (at minimum the
  nonce/IV and a key/algorithm version identifier), and no identity field
  (no `userId`, `email`, `employeeId`, `displayName`, IP address, session
  ID, or equivalent).
- **BR-7**: A persisted response is identified by a randomly generated
  document ID that carries no identity, semantic, or otherwise
  correlatable information, and is associated with a `teamId` and the
  coarse (weekly-period-level) survey period — with no respondent identity
  and no additional correlation metadata (e.g. IP, user agent, session ID,
  or a precise timestamp).
- **BR-8**: After a successful submission, the respondent sees a
  confirmation. No individual answers or aggregate results are displayed by
  this feature.
- **BR-9**: The system accepts multiple submissions for the same period
  without attempting to detect, block, or deduplicate them.
- **BR-10**: The encryption key material is read from a server-only
  environment variable at request time and is never sent to the browser,
  stored in Firestore, committed to git, or written to logs. Only the
  non-secret key/algorithm version identifier (not the key material
  itself) may be persisted alongside a response, to support future key
  rotation and migration.

## Edge cases and failure behavior
- Missing or out-of-range answer (e.g. 0, 6, non-numeric, absent) → reject
  with a generic validation error; nothing persisted.
- `teamId` missing, or not present in the authoritative server-side allowed
  set → reject with a generic validation error; nothing persisted.
- Malformed request body / wrong content type → reject with a generic 4xx
  error; nothing persisted; request body not logged.
- Encryption key unavailable (missing/misconfigured env var) → the request
  fails closed (error response); the system must never fall back to storing
  plaintext answers.
- Firestore write failure after successful encryption → the request
  reports failure to the client; no partial/inconsistent success state is
  reported.
- Same respondent submits again in the same period (no way to detect this
  without identity) → succeeds each time; this is accepted, documented
  behavior, not a bug, for this feature.
- Submission arriving right at a weekly period boundary → period is
  whatever the server computes at the moment the server processes the
  request; no special handling needed.

## Security and privacy
- Invariants 1/3/4 (no plaintext sensitive storage, application-level
  encryption, server-side only): the three answer values are the sensitive
  payload; they are encrypted server-side using authenticated encryption,
  with a fresh random nonce/IV per operation, before the Firestore write,
  together with the minimal metadata (nonce/IV, key/algorithm version)
  needed to decrypt now and support key rotation later (BR-6).
- Invariant 5 (key handling): the encryption key material comes from a
  server-only environment variable for this feature; it must never reach
  `NEXT_PUBLIC_*` config, the browser bundle, Firestore, or logs (BR-10).
  Only the non-secret key/algorithm version identifier — never the key
  material itself — may be persisted. Real KMS-based key management remains
  an explicit open item in `docs/ARCHITECTURE.md`, unchanged by this
  feature.
- Invariant 6 (no identity in anonymous responses): enforced by BR-6/BR-7 —
  DevPulse does not persist or intentionally associate any respondent
  identity with a response. The server must not accept or derive any
  identity field into the stored response, including incidental metadata
  (IP, user agent, session cookie), and the Firestore document ID itself is
  randomly generated and carries no identity, semantic, or correlatable
  information.
- Invariant 7 (participation stored separately from response content): this
  feature introduces no participation/completion tracking at all, because
  there is no authenticated identity yet to link it to. The invariant is
  trivially satisfied (nothing to conflate); real participation tracking is
  deferred to Phase 2.
- `teamId` is self-declared and not verified as belonging to the actual
  respondent (no authentication exists yet); however every submitted
  `teamId` is validated server-side against the authoritative,
  application-defined allowed team set before acceptance (BR-3, BR-5). The
  UI-exposed list is for convenience only and is never trusted as the
  source of truth. **This self-declared value must not be treated as
  authorization evidence** once Phase 2 introduces real team
  membership/authorization — that is a distinct, future server-side check
  per `docs/ARCHITECTURE.md`.
- Correlation risk: the persisted shape is deliberately minimal (see
  Architecture decisions → Persisted response shape) — a randomly generated
  document ID carrying no identity/semantic/correlatable information,
  `teamId`, the coarse weekly period, the encrypted answer payload, and the
  required encryption metadata. No IP, user agent, session ID, precise
  timestamp, or other unnecessary correlation metadata is stored. A
  "team of one" (or otherwise very small team) submitting is still visible
  as *a submission exists*, but no aggregate/content is exposed by this
  feature at all, so this feature does not itself leak individual answers.
  Minimum-response-threshold suppression (invariant 11/12) must be enforced
  when the future dashboard/aggregation feature exposes any aggregate.
- Invariant 14 (no sensitive content in logs): the API handler must not log
  the request body, parsed answers, or any error payload containing them.

## Architecture decisions
- New vertical slice: `src/features/pulse-survey/` (domain types, runtime
  validation, DTOs/mappers, server operation(s), the submission
  component(s)), per `.claude/rules/architecture.md`.
- Firebase Admin SDK is introduced as a new dependency by this feature
  (not currently installed); initialization is centralized under
  `src/lib/firebase/`, server-only.
- A server-only encryption helper lives under `src/lib/encryption/`
  (shared infrastructure, per `.claude/rules/architecture.md`), used by the
  pulse-survey server operation.
- **Superseded by `docs/features/team-management/SPEC.md` TASK-006 and
  TASK-011**: the team list was originally a small, application-defined
  static configuration (`ALLOWED_TEAM_IDS`/`isAllowedTeamId`/`TeamId`,
  formerly `src/features/pulse-survey/domain/teams.ts`). As of TASK-006,
  the runtime source for both the selector and submission-time validation
  is the Firestore `teams` collection's `active` set
  (`src/features/teams/server/list-active-teams.ts`), read server-side via
  the Firebase Admin SDK and never exposing membership/admin/invitation
  data. TASK-011 deleted `ALLOWED_TEAM_IDS`/`isAllowedTeamId`/`TeamId` and
  their module entirely — the four legacy team identifiers now live as a
  private, inlined literal list in
  `src/features/teams/domain/legacy-team-seed.ts`, used only by the
  one-time legacy seed migration that gives them stable Firestore document
  IDs. Nothing outside that seed migration reads them.
- Survey period uses ISO week (UTC), computed server-side; exact string
  format is an implementation detail for task planning.
- **Encryption contract** (architecture-level; implementation choices below
  this are left to task planning): the answer payload is protected with
  authenticated encryption (confidentiality + integrity), a fresh
  cryptographically random nonce/IV is generated per encryption operation
  and never reused, and each encrypted record carries the metadata needed
  to decrypt it and to support future key rotation/migration — at minimum a
  key/algorithm version identifier and the nonce/IV. The specific
  algorithm, library, and exact metadata field names are implementation
  detail for task planning.
- **Persisted response shape (conceptual)**: `teamId`, the coarse (weekly)
  survey period, the encrypted answer payload, and the encryption metadata
  required to decrypt it (nonce/IV, key/algorithm version) — no identity
  field, no IP/user agent/session ID, and no timestamp more precise than
  the period itself. The Firestore document ID is randomly generated and
  must carry no identity, semantic, or otherwise correlatable information
  (i.e. not derived from `teamId`, period, or any request metadata). Exact
  field names and the final collection schema remain an implementation
  detail for task planning, consistent with `docs/DATA-MODEL.md` guidance
  not to invent final schema prematurely.

## Test boundaries
| Boundary | Covers |
|---|---|
| Server API contract (submission endpoint: request validation, response shape, error cases) | BR-1, BR-3, BR-4, BR-5, BR-6, BR-7, BR-9, BR-10 |
| Domain: period computation | BR-4 |
| Domain: answer/team validation | BR-2, BR-3, BR-5 |
| Domain: encryption helper (authenticated encryption, fresh nonce per operation, key/algorithm version metadata) | BR-6, BR-10 |
| UI: submission form and confirmation state | BR-1, BR-2, BR-3, BR-8 |

## Acceptance criteria
- [ ] An unauthenticated request with three valid answers (1-5) and a valid
      team identifier succeeds and the respondent sees a confirmation.
- [ ] A request with a missing or out-of-range answer is rejected and
      nothing is persisted.
- [ ] A request with a `teamId` that is missing or not present in the
      authoritative server-side allowed set is rejected and nothing is
      persisted.
- [ ] The persisted response contains no identity field (userId, email,
      employeeId, displayName, IP, session id, or equivalent) and no other
      unnecessary correlation metadata (user agent, precise timestamp);
      persisted fields are limited to a random document ID, `teamId`,
      coarse period, encrypted payload, and required encryption metadata.
- [ ] The Firestore document ID for a persisted response is randomly
      generated and is not derived from `teamId`, period, or any other
      identity/semantic/correlatable value.
- [ ] The persisted response's answer values are encrypted using
      authenticated encryption with a fresh nonce/IV per submission (two
      submissions with identical answers do not produce identical
      ciphertext), and the required key/algorithm version metadata is
      present.
- [ ] The encryption key material never appears in client-served
      code/bundles, in any Firestore document, or in application logs (only
      the non-secret key/algorithm version identifier may be persisted).
- [ ] Two submissions in the same period (simulating the same respondent)
      both succeed independently, with no dedup error.
- [ ] The survey period used for persistence is computed server-side and is
      unaffected by any client-supplied period value.
- [ ] No survey answer content appears in logs for either a successful or a
      failed submission request.

## Open questions
None blocking. Deferred (non-blocking) items are tracked above: final
Firestore schema (Architecture decisions), static-to-managed team list
migration (Architecture decisions), and KMS provider selection
(`docs/ARCHITECTURE.md`, unchanged).

Additional non-blocking risks accepted at Phase 1 closeout:
- The public submission endpoint (`app/api/pulse-survey/route.ts`) has no
  explicit request body size limit configured; it relies on platform/
  runtime defaults. Acceptable given the endpoint's small, fixed request
  shape; revisit if abuse/DoS risk increases.
- Firestore security rules remain deferred while all Firestore access
  stays server-only through the Firebase Admin SDK (see
  `docs/ARCHITECTURE.md` open questions).
