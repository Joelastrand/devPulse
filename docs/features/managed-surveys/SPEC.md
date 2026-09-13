# Managed Surveys & Survey-Based Insights

## Status
Approved — Phase 4 implemented (TASK-001 through TASK-014 Done; see
[TASKS.md](./TASKS.md)). Two architecture/security/product review passes
were completed during planning (all Blocking/Important/High findings
resolved at spec level; see the transaction design in "Survey submission
contract," "One open survey per team," "Consistency vs. unlinkability
tradeoff," and "Team disable semantics" — the last of these corrected a
real conflict with an existing invariant, `docs/features/team-management/
SPEC.md` BR-32). TASK-014 retired the runtime this feature supersedes
(the static `/pulse-survey` page and the calendar-period-scoped results
aggregation path) and synchronized durable documentation; see
`docs/ROADMAP.md` Phase 4.

## Problem
DevPulse's survey model is still the one Phase 1 shipped: a single,
always-on public survey page (`/pulse-survey`), an implicit server-computed
weekly calendar period as the only notion of "when," and a self-declared,
unverified `teamId` chosen by the respondent from a dropdown. Phase 2/3 added
authenticated results on top of that model without changing it. This no
longer matches what organizations actually need:

- Every team is forced onto the same fixed weekly cadence; a team that wants
  to survey every 3 weeks and one that wants every 6 weeks cannot both be
  served by "the current calendar week."
- There is no way to require participants to be signed-in, verified team
  members for a given survey — participation access is not configurable at
  all, it is always "anyone with the page URL, unauthenticated."
- There is no admin-visible record of "surveys we've actually run" — only an
  implicit, always-open current period and 12 implicit preceding periods,
  regardless of whether anyone actually ran a survey in a given week.
- The Home page and site header are inconsistent for a signed-in user (the
  header shows "Logg ut" while Home still offers "Logg inn"/"Opprett konto"
  as primary actions), and Home links to one static survey that no longer
  exists as a concept once surveys become admin-managed instances.

## Goals
- Replace the implicit, calendar-period-driven survey model with explicit,
  admin-managed survey instances, each belonging to exactly one team.
- Make participation access an explicit, per-survey choice: `public`
  (anonymous, link-only) or `authenticated` (signed-in, server-verified team
  member), never a global or inferred setting.
- Give every survey a stable, opaque, generated URL
  (`/survey/{surveyId}`) usable for both access modes, so sharing/embedding a
  survey link never depends on knowing its access mode in advance.
- Let each team run surveys on its own cadence, with no fixed global
  schedule and no fabricated "empty period" entries.
- Make results and history survey-instance-based: a team's trend reflects
  the surveys it actually ran, in chronological order, at their actual
  irregular dates.
- Preserve every existing privacy/security invariant (anonymity, encryption,
  minimum response threshold, team isolation, admin ≠ raw-response access)
  under the new model, and explicitly document where the new model changes
  *how* those invariants are enforced (e.g. "closed period" becomes "closed
  survey").
- Fix the signed-in-user experience on Home and in navigation so a
  signed-in user is never offered "Logg inn"/"Opprett konto", and so public
  survey discovery happens only through a generated survey link, never a
  generic "the pulse survey" entry point.

## Non-goals
- Survey question/dimension configurability. The fixed three-question
  Flow/Stress/Fun, 1-5 scale set (`docs/features/pulse-survey/SPEC.md`) is
  unchanged by this phase — only *when*, *for whom*, and *how a respondent
  reaches* that fixed question set changes.
- An automatic recurrence/scheduling engine (e.g. "every 3 weeks,
  automatically"). Optional `startAt`/`endAt` plus explicit admin
  open/close actions are sufficient for this phase — see "Flexible cadence."
- Reopening a closed survey. A closed survey is terminal; running another
  occurrence means creating a new survey instance.
- CAPTCHA or other active anti-abuse/anti-bot tooling for public surveys —
  documented as a future option in the threat model, not built here.
- Email/Slack/notification delivery when a survey opens or closes (admins
  already have this capability pattern rejected in `docs/features/
  team-management/SPEC.md` for invitations; unchanged reasoning applies).
- Survey templates, cross-team survey comparison views, or paginated
  results history beyond a fixed most-recent-window (see "Results/history
  model").
- An automatic recurrence/scheduling *engine* for the threshold or anything
  else, and a threshold-editing operation once a survey exists — see
  "Per-survey result threshold" for the one exception to this phase's
  original "stays 5" framing: an approved pre-TASK-011 product change
  replaced the single global threshold with a per-survey, immutable-after-
  creation value. That value's *validation rules* (range, default) are
  fixed for this phase exactly like every other creation-time field; only
  *changing an existing survey's* threshold remains out of scope.
- Any AnonymousChallenge, forum, or skill-tree capability (Phases 5-7).
- Migrating existing `pulseSurveyResponses` data or preserving the
  period/`ALLOWED_TEAM_IDS`-era runtime model for compatibility — per the
  explicit project-state clarification for this planning session, there is
  no real survey data to preserve; superseded runtime code is retired, not
  adapted (see "Migration/cleanup implications").

## Users / actors
- **Anonymous respondent (public survey)**: opens a `public` survey's
  generated URL directly; no account, no sign-in, no team-membership check.
  Can submit once or repeatedly (no dedup is possible or attempted — see
  "Abuse/duplicate-response threat model").
- **Authenticated team member (authenticated survey)**: an authenticated,
  Firebase-verified user holding an actual `teamMemberships` record for the
  survey's owning team. Must sign in (if not already) before the form is
  ever rendered; can submit at most once per survey instance (see BR-22).
- **App admin**: creates and manages every team's surveys (create, open,
  close, delete/archive) from that team's admin page — exactly as app
  admins already manage teams, invitations, and access requests. An app
  admin is **not** automatically an eligible respondent for an
  `authenticated` survey of a team they don't actually hold membership in
  (BR-16) — administering surveys and answering them are different
  capabilities, mirroring "admin access does not imply raw-response access"
  (`docs/SECURITY.md` invariant 17) applied to *participation*, not just
  *results*.
- **Team member (result viewer)**: unchanged from `docs/features/
  team-management/SPEC.md` — a member or admin of a team can view that
  team's survey-instance-based results/history on `/teams/[teamId]`.
- **Unauthenticated visitor (product routes)**: sees Home, sign-in, sign-up
  — never any team name, survey metadata, or result data before
  authentication (unchanged posture from `docs/features/team-management/
  SPEC.md` BR-13, now also applied to an `authenticated` survey's
  pre-sign-in state — see BR-13 below).

## Terminology
- **Survey**: the persisted survey instance — one admin-created occurrence
  of the fixed pulse question set, owned by exactly one team, with its own
  access mode and lifecycle. This is a new meaning for the term "Survey":
  `docs/DATA-MODEL.md` currently uses "Survey" for the static, non-persisted
  fixed question set. This phase promotes "Survey" to mean the persisted,
  Firestore-backed instance; the fixed question/dimension definitions
  themselves remain an implicit code-level constant with no separate named
  entity (there was never any product need to name them separately from
  "the survey"). "SurveyInstance" was considered and rejected as a name —
  "Survey" alone is what every part of this spec, and the admin/team UI,
  needs to say; there is no second "Survey" concept left to disambiguate
  from once the old period-based reading is retired.
- **SurveyAccessMode**: `"public" | "authenticated"` — who may open and
  submit a given survey. Persisted on the survey, fixed at creation (BR-3),
  never inferred from URL shape, team state, or auth state.
- **Derived lifecycle**: `"scheduled" | "open" | "closed"` — a survey's
  current answerability state, computed identically everywhere from
  `openedAt`, `closedAt`, and `endAt` (see "Survey lifecycle"). Not a
  separately stored status field.
- **SurveyResponse**: one anonymous, encrypted answer set submitted to
  exactly one Survey. Identical in spirit to the existing
  `pulseSurveyResponses` record, keyed by `surveyId` instead of `teamId` +
  calendar `period`.
- **SurveyParticipation**: a record that one authenticated identity (`uid`)
  has submitted to one `surveyId`, used only for authenticated-mode
  duplicate-submission prevention (BR-21/BR-22) — never linked to the
  `SurveyResponse` document it corresponds to (BR-18). Does not exist for
  `public` surveys.
- **Results/history**: the set of a team's `closed` surveys and their
  published (or suppressed) aggregates, replacing "12 closed calendar
  periods" with "this team's actual closed survey instances."
- **`minimumResponses`**: the per-survey result-publication threshold — an
  integer in `[3, 20]`, required at creation (default `5` in the admin
  creation form only, never assumed by the server), immutable afterward.
  Replaces the single global `MIN_RESPONSE_THRESHOLD` for the publication
  decision (see "Per-survey result threshold" — an approved product change
  made just before TASK-011, which owns its implementation).

## Current-state summary
(Confirmed by inspecting `src/features/pulse-survey/`, `src/features/
results/`, `src/features/teams/`, and the relevant `docs/features/*/SPEC.md`
files.)

- **Survey concept**: not persisted. `getCurrentSurveyPeriod()`
  (`src/features/pulse-survey/domain/period.ts`) derives the current UTC ISO
  week (`"2026-W36"`) from wall-clock time; every team is always "in" the
  same current period, always open, with no admin action of any kind.
- **Public submission**: `/pulse-survey` (`app/pulse-survey/page.tsx`) is
  one static page. `PulseSurveyForm` presents the fixed 3-question set and a
  free-choice `<select>` of every currently `active` Firestore team (`src/
  features/teams/server/list-active-teams.ts`) — the respondent picks their
  own team; it is validated server-side only for *existing/active*, never
  for *belonging to the respondent* (there is no respondent identity at
  all). `POST /api/pulse-survey` → `submitPulseSurvey` validates, encrypts
  (AES-256-GCM, fresh IV, `src/lib/encryption/encryption.ts`), and persists
  to Firestore `pulseSurveyResponses`: `{teamId, period, ciphertext, iv,
  authTag, keyVersion}` — no identity field, no precise timestamp.
- **Results**: `GET /api/teams/[teamId]/results` → `getTeamResults` resolves
  the caller's `authorizeTeamAccess` level, then computes the *current*
  (always-empty, per BR-6 of `results-dashboard`) plus the 12 *closed*
  periods immediately preceding it (`listPrecedingClosedPeriods`), via
  `computePeriodAggregate`: decrypt-and-validate every candidate response
  for that `teamId`+`period`, suppress below `MIN_RESPONSE_THRESHOLD = 5`.
  `TeamDetail.tsx` renders this as `PeriodSummary` (the latest closed
  period) + `TrendChart`/`TrendTable` (the 12-period trend), each period
  keyed and labeled by its period string, not an actual date.
- **Team ownership/authorization**: fully current and *not* superseded by
  this phase — `docs/features/team-management/SPEC.md`'s Firestore `teams`,
  `teamMemberships`, and `authorizeTeamAccess` (admin/member/denied,
  server-side, `uid`-based) are reused as-is; this phase's authenticated
  survey participation is layered on top of `authorizeTeamAccess`, refined
  to require actual `member`/`admin`-via-membership, not merely
  app-admin-by-allow-list (see "Authorization model").
- **Home/nav**: `app/page.tsx` (Home) always renders "Logg inn"/"Opprett
  konto" plus "Svar på undersøkelsen" (linking to the static `/pulse-survey`)
  and "Se resultater", regardless of auth state — `SiteHeader.tsx` is
  already correctly auth-aware (BR-4 of `product-ux-shell`), so this is a
  genuine, confirmed Home-only regression relative to the header, not a
  misreading of already-fixed behavior.
- **Chart**: `TrendChart.tsx` (Recharts `LineChart`) already renders a
  suppressed period as `null` (gap, `connectNulls={false}`), never `0` —
  this suppression-safe pattern is reused, only its X-axis semantics change
  (survey occurrence + date, not period string).

## Target product model
A **Survey** is a persisted, team-owned instance with an explicit
**SurveyAccessMode** and an explicit, derived lifecycle. An app admin
creates it from that team's admin page, choosing access mode and optionally
a title and availability window, then explicitly opens and closes it.
Every survey — public or authenticated — is reachable at one opaque URL
shape, `/survey/{surveyId}`; the destination itself resolves what the
visitor is allowed to do, based only on server-side state (never inferred
from the URL). A team's results become the set of its own closed survey
instances, shown in actual chronological order with real dates, not a fixed
12-calendar-period grid. Different teams run surveys at whatever cadence
their admin chooses; nothing in the system assumes simultaneous or
equally-spaced surveys across teams, or even within one team.

## Survey lifecycle
Three derived states, computed the same way everywhere (server enforcement,
admin UI, team UI) from three optional timestamps plus one hard rule:

```
effectiveLifecycle(survey, now) =
    "closed"     if survey.closedAt is set
                 OR (survey.endAt is set AND now >= survey.endAt)
    "open"       else if survey.openedAt is set
    "scheduled"  otherwise
```

- **`scheduled`**: created, not yet answerable. `startAt`/`endAt`, if set,
  are informational (displayed as the planned window) — they do **not**
  themselves open or close a survey. This deliberately keeps lifecycle
  transitions entirely explicit/admin-driven (no background scheduler is
  needed this phase — "optional start/end timestamps plus manual admin
  control are sufficient" per product direction), while still letting
  `endAt` act as a hard, always-enforced closing boundary once a survey
  *is* open (see below) — no live "auto-open" job is required because
  opening is exactly the one transition that must be race-checked against
  the one-open-survey-per-team invariant (BR-6), and a passively-elapsing
  timestamp cannot provide that check by itself.
- **`open`**: answerable, subject to `accessMode` (see below). Reached only
  via an explicit app-admin "open"/"start" action, which sets `openedAt` to
  the server's own current time (never client-supplied) and is rejected if
  the team already has another currently-`open` survey (BR-6) — see "One
  open survey per team" below for the race-safe mechanism; it is not a
  plain `where teamId == X and status == "open"` query.
- **`closed`**: not answerable; existing responses and results/history are
  preserved untouched. Reached either by an explicit app-admin "close"
  action (`closedAt` set, works at any time, even before a set `endAt`) or
  automatically, the instant the server's current time reaches a set
  `endAt` — computed live on every read, no write/background job needed,
  exactly the same "no new persisted field, always recomputed" pattern
  `isPeriodClosed` already used for calendar periods. Closing is terminal:
  there is no "reopen" action in this phase (Non-goals).

**Why three states, not four.** A "draft" state (survey created but not
yet visible/committed) was considered and rejected: creation is a single
atomic admin action (fill form → submit → persisted), with no multi-step
"save for later, still editing" flow anywhere in this spec — so a
just-created survey is already fully-formed, just not yet answerable,
which is exactly what `scheduled` already means. Adding a fourth state
with no distinct enforcement behavior would be an unjustified extra state
(`.claude/rules/typescript.md` — avoid abstractions without a concrete
current need), not a missing one.

**Why `status=open` with a future `startAt` is not a contradiction.**
Because `startAt` is deliberately never part of `effectiveLifecycle`'s
computation (informational only, per `scheduled` above), a survey that's
genuinely `open` (an admin explicitly opened it) is answerable regardless
of what `startAt` says — there is no state where the persisted fields
imply two different answerability answers at once. This is a narrower
design than "answerable requires `startAt <= now`" (the more literal, also
reasonable reading of "optional start time"): the alternative was
considered and rejected because it would turn "open" into two different
concepts (an admin's action vs. actual answerability), needing separate
handling — for a benefit (preventing an admin from contradicting their own
stated plan) `docs/features/pulse-survey/SPEC.md`'s "manual admin control
is sufficient" direction doesn't ask for. If a survey is opened before its
own planned `startAt`, that's a deliberate admin override, not a bug — the
admin UI should stop displaying the original `startAt` as a "planned
start" once `openedAt` is actually set, to avoid showing both at once (see
"UI/UX requirements").

**Server time only.** Every lifecycle/answerability decision —
`openedAt`, `closedAt`, the `endAt` comparison, the one-open-survey-per-team
check — uses the server's own clock (the Firestore Admin SDK server
timestamp, or the Node.js server process's own time at the authoritative
operation) exclusively. A client/browser-supplied timestamp is never
accepted, trusted, or compared against for any authorization or
answerability decision, anywhere in this feature.

Edge cases:
- A `scheduled` survey with a past `startAt` that the admin never opened
  stays `scheduled` forever (informational-only, by design) — the team
  page's empty state (BR-31) simply shows no current survey.
- An admin opens a survey while its own `endAt` (set at creation) is
  already in the past → the derived lifecycle is `closed` immediately
  (the `endAt` clause wins); the open action still records `openedAt` for
  audit purposes, but the survey is never actually answerable. Documented,
  accepted admin-error case — the create/open UI should surface this before
  it happens (implementation detail, not a server-side hard block, since
  it's an accepted, non-destructive mistake with no privacy impact).
- Concurrent "open" clicks (e.g. two admin tabs) for the same team →
  resolved by the "One open survey per team" mechanism below; the second
  call fails with "already open" (either this survey by a racing duplicate
  click, or a different survey that won the race), not a silently
  duplicated open.

### One open survey per team
A plain `surveys` query (`where teamId == X and openedAt != null and
closedAt == null`) is **not** the enforcement mechanism — a query-based
check, re-run inside a transaction, still has to combine an equality filter
with an "absence" condition Firestore doesn't index cleanly, and gives no
single document for Firestore's transaction machinery to serialize
conflicting writes against. Instead, this uses a dedicated coordination
document, the same established pattern this codebase already uses for
every other one-of-a-kind invariant (`teamMemberships/{uid}__{teamId}`,
`teamAccessRequests/{uid}__{teamId}`, `teamInvitations/{teamId}__{email}` —
all deterministic, single-purpose documents Firestore transactions can
read-then-write atomically):

```
teamSurveyState/{teamId}
    activeSurveyId: string | null
    updatedAt
```

- **Open** (`openSurvey`, one Firestore transaction): read
  `teamSurveyState/{teamId}` (a missing document is treated as
  `activeSurveyId: null`, the same "missing ⇒ no grant" convention
  `isValidMembershipFor` already uses). If `activeSurveyId` is set, read
  that referenced `surveys/{activeSurveyId}` document too and compute its
  derived lifecycle (BR-9) — **the pointer is never trusted by its mere
  presence**, only by re-deriving the survey it names. If that survey is
  genuinely still `open` → abort, "team already has an open survey." If it
  isn't (already closed — explicitly or via a passed `endAt` the pointer
  hasn't caught up to yet), the conflict is stale: proceed, and update
  `activeSurveyId` to the survey being opened now. Otherwise (no prior
  active pointer): proceed. Either way, in the same transaction, set
  `surveys/{surveyId}.openedAt = now` and `teamSurveyState/{teamId}.
  activeSurveyId = surveyId`.
- **Close** (`closeSurvey`, one Firestore transaction): set
  `surveys/{surveyId}.closedAt = now`; if `teamSurveyState/{teamId}.
  activeSurveyId` currently equals this `surveyId`, clear it to `null` in
  the same transaction (a defensive no-op if it doesn't — e.g. already
  cleared, or a self-heal already overwrote it).
- **Concurrent opens** (the review's exact scenario — admin A opens survey
  X, admin B opens survey Y, for the same team, at the same time): both
  transactions read `teamSurveyState/{teamId}`; Firestore serializes
  conflicting transactions against the same document, so exactly one
  commits first, sets `activeSurveyId` to its own survey, and the other's
  transaction is retried by Firestore, re-reads the now-updated document,
  sees a genuinely active pointer, and aborts with "already open." Exactly
  one survey becomes active — never both, never neither.
- **`endAt` auto-expiry and stale-pointer recovery**: because auto-expiry
  is a pure computation (no write — see "Survey lifecycle"), `
  activeSurveyId` can legitimately point at a survey that has since
  auto-expired without anyone explicitly closing it. This is never treated
  as a bug to fix with a background job — it is corrected, lazily, the
  next time it matters: either the next `openSurvey` attempt for that team
  (which re-derives the pointed survey's actual lifecycle before trusting
  it, above) or, opportunistically, the first read of that survey after
  `endAt` passes (see "Results/history model" → the same lazy `closedAt`
  backfill described there also applies here: once something reads the
  survey and observes it's auto-expired, it can persist `closedAt = endAt`
  at that point, after which `teamSurveyState`'s own pointer is
  irrelevant to that survey either way).
- **`teamSurveyState` is write-side coordination only** — nothing reads it
  to answer "what's this team's current survey." Team-page discovery
  (BR-30) and the admin survey list (BR-33) continue to query `surveys` by
  `teamId` (a single-field, auto-indexed query) and compute each survey's
  own derived lifecycle directly — exactly one is ever genuinely `open` at
  a time, by construction of the mechanism above, so this read path never
  needs to trust or consult the coordination document at all.
- **Multiple `scheduled` surveys are allowed** for the same team — the
  restriction (BR-6) is on `open` only, so an admin can freely create
  several ahead of time (e.g. planning a quarter's worth) without
  conflict. If a second `scheduled` survey's own `startAt` becomes due
  while another survey is already `open`, nothing happens automatically —
  `startAt` never auto-opens (see "Survey lifecycle"), so the newly-due
  survey just continues sitting `scheduled` until an admin explicitly
  tries to open it, at which point the ordinary BR-6 conflict check
  applies (rejected, since the team already has an open survey) exactly as
  it would for any other open attempt.

### Team disable semantics
**Corrected in this review pass** — the first draft treated survey
lifecycle and team `active`/`disabled` status as fully independent, but
that contradicts an existing, already-implemented invariant: the current
pulse-survey submission endpoint re-validates the submitted `teamId`
against the *active*-teams set at write time and rejects a `disabled`
team's `teamId` exactly like an invalid one
(`docs/features/team-management/SPEC.md` BR-32). The new model must
preserve this, not weaken it merely because submission is now scoped by
`surveyId` instead of a self-declared `teamId`.

BR-41 and BR-42 (below) state the exact rule; both are listed with the
rest of the numbered requirements under "Behavioral requirements," not
here, to keep one authoritative location for every BR.

- **Submission** (BR-19-BR-24): the submission transaction (see "Survey
  submission contract") additionally reads `teams/{teamId}.status` fresh,
  in the same transaction as the survey/membership/dedup reads, and aborts
  identically to a closed-lifecycle rejection if it is not `active`. This
  closes the "team disabled while a submission is in flight" race the same
  way the close-race is closed — by re-deriving from a fresh transactional
  read, never a stale pre-read.
- **Creation/opening**: creating or opening a survey for a `disabled` team
  is rejected — mirrors BR-3/22's existing "no new grants into a disabled
  team" posture for invitations/access requests (`docs/features/
  team-management/SPEC.md`). An admin must re-enable the team first.
- **Discovery**: `resolveSurveyForParticipation` (backing `/survey/
  {surveyId}`) and the team-page "Pågående undersøkelse" section (BR-30)
  both apply the same BR-41 check, so a visitor is never shown an
  answerable-looking form for a survey that would then be rejected at
  submit time — the UI and the enforcement boundary agree.
- **Results/history are unaffected**: viewing a disabled team's *past*
  closed surveys and their results remains available to its existing
  members/admins, unchanged — `docs/features/team-management/SPEC.md`
  BR-3's "remains fully accessible... to its existing members" describes
  *viewing already-collected data*, not *accepting new submissions*; this
  phase preserves that distinction rather than blurring it.

## Survey access modes
`SurveyAccessMode = "public" | "authenticated"`, persisted on the survey,
chosen explicitly at creation (BR-1), immutable afterward (BR-3). No
pre-selected default in the creation UI — the admin must actively choose one
before the create action is enabled (explicit product decision, this
session — see "UI/UX requirements").

- **`public`**: no account, no Firebase sign-in, no team-membership check.
  Anyone possessing the URL can open and submit.
- **`authenticated`**: the survey still gets the same kind of URL; opening
  and submitting require a Firebase-verified identity holding actual
  membership in the survey's owning team (BR-16).

## Generated survey URL semantics
- Every survey, of either access mode, is created with an opaque,
  server-generated `surveyId` — reusing this codebase's established
  approach for opaque IDs (a Firestore auto-generated document ID, the same
  scheme `teamId` already uses), never a sequential or derived value.
- URL shape: `/survey/{surveyId}`, identical for both access modes — there
  is no `/public-survey`/`/private-survey` split and no encoding of
  `teamId`, access mode, or any identity information in the path.
- The destination page resolves everything server-side from `surveyId`:
  existence, owning team, access mode, and derived lifecycle. The URL
  itself carries no authorization information — mere possession of a
  `public` survey's URL is sufficient to answer it (a capability-like link,
  scoped only to that one survey's public answering/submission surface),
  while possession of an `authenticated` survey's URL grants nothing until
  identity + membership are verified server-side.

## Public survey flow
1. Visitor opens `/survey/{surveyId}`.
2. Server resolves the survey; if it doesn't exist, renders the generic
   not-found state (see "Error/loading/empty states").
3. If it exists and `accessMode === "public"`: render the fixed
   question form directly, regardless of sign-in state, gated only by
   derived lifecycle (`scheduled` → "not started yet", `open` → the form,
   `closed` → "this survey has ended").
4. Submission (`open` only) is validated and encrypted server-side exactly
   as today's Phase 1 flow, with `teamId` derived from the survey record
   (never client-supplied) — see "Survey submission contract."
5. No identity is collected or required at any step.

**What's safe to expose pre-submission (`public` mode)**: the survey's
title (if set), its owning team's name, and its derived lifecycle/
availability state. This matches — and is no more exposed than — the
existing precedent: today's public `/pulse-survey` selector already shows
every active team's name to a fully anonymous visitor
(`docs/features/team-management/SPEC.md` BR-31). It never exposes response
count, aggregate content, member lists, or any other team's data or
survey's existence.

## Authenticated survey flow
1. Visitor opens `/survey/{surveyId}`.
2. Server resolves the survey; if it doesn't exist, generic not-found.
3. If it exists and `accessMode === "authenticated"` and the visitor is
   signed out: render only "sign in to continue" — no team name, survey
   title, or other metadata is revealed pre-authentication (mirrors the
   existing invariant that an unauthenticated `/teams` visitor sees zero
   team data, `docs/features/team-management/SPEC.md` BR-13).
4. Visitor signs in (or signs up, verifies, then signs in) via the existing
   Firebase Authentication flow; on success, they are returned to the exact
   same `/survey/{surveyId}` URL (see "Authorization model" for the
   redirect mechanism).
5. Server verifies the Firebase ID token and checks actual membership
   (BR-16) in the survey's owning `teamId` (resolved from the survey
   record, never the client). Not authorized → a non-sensitive "you don't
   have access to this survey" state, structurally identical to `/teams/
   [teamId]`'s existing non-member treatment — never confirming or denying
   the survey's title/team beyond what step 3 already would have.
6. Authorized → render the form, gated by derived lifecycle exactly as the
   public flow (steps 3-4 above).
7. Submission requires the same verified identity + membership check again,
   server-side, at submit time (never trusting the earlier page-load
   check) — plus the authenticated-only duplicate check (BR-21/BR-22).

**What's safe to expose pre-submission (`authenticated` mode)**: while
signed out, nothing beyond "this survey requires signing in" (step 3) —
no title, team name, or lifecycle state, since an unauthenticated visitor
today already sees zero team metadata anywhere in the product
(`docs/features/team-management/SPEC.md` BR-13), and this phase does not
carve out a new exception to that for surveys. Once signed in and
authorized (step 5), the same information as the `public` flow becomes
visible (title, team name, lifecycle/availability) — never response
count or aggregate content, exactly as `public` mode.

## Authentication vs anonymity distinction
Authentication, for an `authenticated` survey, answers exactly one
question: *may this identity access and submit this survey?* It must never
answer *which identity submitted these specific answers* — that remains
undefined, on purpose, for every survey regardless of access mode.

- The `SurveyResponse` document is identical in shape whether the survey
  was `public` or `authenticated`: no `uid`, no `email`, no other identity
  field (BR-17). The encrypted answer payload plus `surveyId`/`teamId`/
  `submittedAt` is all that's ever written.
- Authenticated-mode duplicate prevention (BR-21/BR-22) is implemented as a
  **separate** `SurveyParticipation` document — `{uid, surveyId}` **only**
  (deliberately *no* `submittedAt` or any other field — see "Consistency
  vs. unlinkability tradeoff" below) — written in the same Firestore
  transaction as the response (see "Survey submission contract"), but with
  **no shared identifier, foreign key, or content field** joining it to the
  specific `SurveyResponse` document it accompanied (BR-18). An app admin
  (or anyone else, at the application level — no query, API, or UI in this
  system ever performs or enables this join) can see *that* uid X submitted
  to survey Y (necessary for the duplicate check to exist at all) but has
  no application-level path to recover *which* of survey Y's responses is
  uid X's.
- This is a deliberate, narrow exception to "no participation tracking
  exists" (Phase 1-3's posture) — introduced *only* for `authenticated`
  surveys, where a real identity already exists for access-control purposes
  regardless; `public` surveys remain exactly as identity-free and
  dedup-free as Phase 1 (BR-23).

**Consistency vs. unlinkability tradeoff — made explicit, not hidden.**
Writing `SurveyResponse` and `SurveyParticipation` in the same Firestore
transaction (chosen for a real product reason: it makes "at most one
accepted response per identity per survey" an actual guarantee, not a
best-effort check with a race window) has one unavoidable consequence:
Firestore itself stamps both documents with the *same* internal commit
timestamp (`createTime`/`updateTime`, metadata the Firestore Admin SDK
exposes on every document read, separate from and in addition to any field
this application chooses to store). This is not an application-level field
and nothing in this application ever reads or exposes it — but it is
still, in principle, a correlation signal available to anyone with direct
Firestore Admin SDK or console access, i.e. outside every code path this
application itself provides.

Two design choices bound this residual risk rather than ignoring it:
- `SurveyParticipation` stores no `submittedAt` (or any other field) that
  could be compared against `SurveyResponse.submittedAt` — the two
  documents share no *content* to match, only Firestore's own internal
  write-time metadata, which requires raw datastore access this
  application never grants to anyone (not even an app admin — the entire
  application-level read/write surface for both collections is exactly
  what BR-17/BR-18/BR-25-BR-27 already describe, and neither collection is
  ever returned raw to any client, `docs/SECURITY.md` invariant 10).
- An alternative that avoids even this residual, raw-datastore-only signal
  was considered and rejected: writing the two documents as fully separate,
  independently-timed operations (accepting the response first, recording
  participation as a decoupled follow-up). This would remove the shared
  commit-timestamp metadata entirely, at the cost of a real, user-facing
  regression — a rare partial failure (response accepted, participation
  write fails afterward) would either let the same identity submit twice
  (undermining BR-22) or require a compensating rollback with its own
  failure modes. Given raw Firestore access is already the outer edge of
  this codebase's trust boundary everywhere else (the entire Admin-SDK-only
  architecture, `docs/ARCHITECTURE.md`), and the decoupled alternative
  trades a real, always-available guarantee (exactly-once, enforced for
  every caller through every code path) for closing a channel only
  reachable by that same already-maximally-trusted operator, the
  transactional design is kept.
- **Realistic guarantee, stated precisely**: this design provides strict
  exactly-once duplicate prevention and complete *application-level*
  unlinkability (no query, API, admin screen, or log in this system can
  ever join a response to its submitter) — but not information-theoretic
  unlinkability against an operator with direct, raw Firestore access
  outside the application. That narrower residual is accepted, for the
  reasons above, as equivalent to (not beyond) this codebase's existing
  server-only trust boundary.

## Admin creation/management flow
From `/admin/teams/[teamId]` (the team's own admin page — creation is
always scoped to one team, never a free-standing "pick any team" form):

1. App admin fills in: access mode (no default — see "Survey access
   modes"), the survey's `minimumResponses` (pre-filled with `5`, the admin
   may change it within `[3, 20]` before submitting — see "Per-survey
   result threshold"), optional title, optional `startAt`/`endAt`.
2. Submits → server creates the survey (`scheduled`, BR-1/BR-4), returns
   its `surveyId`; the admin page immediately shows the survey with its
   `/survey/{surveyId}` link (copyable).
3. Admin explicitly opens it when ready (BR-5/BR-6) — independent of any
   `startAt` shown.
4. Admin explicitly closes it whenever they choose (BR-7) — independent of
   any `endAt` shown, which also closes it automatically regardless (BR-8).
5. Once closed, the admin can delete it (only if it has zero responses,
   BR-35) or archive it (if it has any responses, BR-36) — see "Delete/
   close/archive semantics."
6. The team's admin page lists every survey (active + a separate archived
   section), each with its access mode, dates, derived lifecycle, link, and
   response count where privacy rules permit (BR-26/BR-33).

Only an app admin can perform any of the above, for any team (mirrors the
existing team/invitation/access-request admin model exactly — no team-level
admin role is introduced by this phase either, consistent with `docs/
features/team-management/SPEC.md`'s "no team-level admin role" decision).

## Team-page survey discovery
`/teams/[teamId]` (member/admin-authorized, existing page) gains a
"Pågående undersøkelse" section:
- If the team has a survey whose derived lifecycle is `scheduled` or
  `open`, show its title (or a fallback label), availability state, access
  mode (in Norwegian, non-technical phrasing — see "UI/UX requirements"),
  start/end info where set, and a link to `/survey/{surveyId}` — the exact
  same URL used for external sharing (BR-30).
- If none, a non-sensitive "no current survey" empty state (BR-31).
- This section never renders response/result content itself — that stays
  the existing closed-survey results section, unchanged in its own
  authorization boundary (BR-32).

## Survey submission contract
Conceptually `POST /api/surveys/{surveyId}/responses` (exact route naming
is implementation detail for task planning, consistent with how prior
specs in this repo leave endpoint naming to implementation).

**Two phases.** Everything that touches Firestore happens inside **one
Firestore transaction**, re-reading all state fresh at that point — nothing
authorization- or lifecycle-relevant is ever decided from an earlier
page-load read. Work with no persistence side effect happens first, outside
the transaction, so transaction retries (see below) never redo it:

**Phase A — outside the transaction:**
1. Parse and structurally validate the three answers (unchanged 1-5
   integer rule). Invalid → reject, nothing persisted.
2. If the request carries a Firebase ID token, verify it (identity only —
   *authorization* is re-checked inside the transaction, not here).

**Phase B — inside one Firestore transaction:**
3. Re-read the `surveys/{surveyId}` document fresh (not the survey state
   from any earlier read). Nonexistent → abort, generic rejection, no
   distinguishing detail (mirrors Phase 1's `invalid_submission` posture).
4. Compute derived lifecycle (BR-9) from this fresh read. Not `open` →
   abort, nothing persisted (BR-20) — this is what makes the "submit
   arrives while admin closes it" race safe: if a concurrent `closeSurvey`
   transaction (or an `endAt` that has since passed) commits before this
   read, this check sees it and aborts; if this transaction's read
   happened first, Firestore's transaction semantics abort *this*
   transaction and retry it from Phase B's start if a conflicting write
   lands before it commits — so the survey document a submission is ever
   actually persisted against is always the one current at commit time, not
   at request-start time.
5. Read `accessMode` and `teamId` from this same fresh document — never
   from the request body (BR-19). Re-read `teams/{teamId}.status` fresh, in
   the same transaction; not `active` → abort, treated identically to a
   closed-lifecycle rejection (BR-41/BR-42, "Team disable semantics") — for
   *either* access mode, not just `authenticated`.
6. If `public`: no further authorization check (BR-23) — go to step 8.
7. If `authenticated`: re-read `teamMemberships/{uid}__{teamId}` fresh
   (closes the "membership removed while the submission is in flight"
   race — a revoked membership is visible to this read even if an earlier
   page-load check saw it as valid); not an actual member → abort,
   forbidden. Re-read `surveyParticipations/{uid}__{surveyId}` fresh; if it
   already exists → abort, "already submitted" (BR-22) — this is also what
   makes two near-simultaneous submit clicks from the same identity safe:
   Firestore serializes conflicting transactions against the same document,
   so only one can observe "no participation yet" and commit.
8. Encrypt the validated answers server-side with authenticated encryption
   and a fresh nonce/IV (unchanged encryption boundary) — done here, inside
   the transaction, immediately before the write, so a retried transaction
   (step 4's race) always encrypts against the survey state it's actually
   about to commit against, not a stale one. A fresh IV per attempt means a
   retry never reuses ciphertext.
9. Write the `SurveyResponse` document (BR-24); for `authenticated` mode,
   also write the `SurveyParticipation` document (`{uid, surveyId}` — see
   "Authentication vs anonymity distinction" for why it deliberately has no
   `submittedAt`) in the **same transaction** — both commit together or
   neither does; there is no partial-success state to handle (Firestore
   transactions are all-or-nothing), so this closes the "one write succeeds,
   the other fails" case by construction rather than by a compensating
   cleanup step.
10. Return only minimal success/failure information — no echoed answer
    content, no internal error detail, and **no generated document ID**
    (neither the `SurveyResponse` nor, for `authenticated` mode, the
    `SurveyParticipation` ID is ever returned to the client — there is no
    product need for the client to know either, and returning one would
    hand a client-side log/URL/analytics tool a value that could later be
    used to probe or correlate, however indirectly) — unchanged posture
    from Phase 1's `submitPulseSurvey`, extended to the new participation
    write.

A client retry after a network timeout (the transaction actually committed
server-side, but the response was lost in transit) is safe by construction
for `authenticated` mode: the retry re-enters at step 7, finds the
just-created `SurveyParticipation`, and is rejected as a duplicate — it
never doubles the response. For `public` mode, a retry is indistinguishable
from any other repeat submission (BR-23) — accepted, per the documented
threat model.

## Results/history model
Results become survey-instance-based. For a team's closed surveys, the
server computes the same per-dimension mean + response count Phase 2/3
already compute, scoped to `surveyId` instead of `teamId`+`period`
(BR-25). The trend/history view shows the team's most recent 12 `closed`
surveys, oldest first, in actual chronological order (BR-28) — continuing
the existing "12" window size as a reasonable, already-established default,
now applied to survey occurrences instead of calendar periods (adjustable
in a later phase if real usage shows a different window is more useful;
not reconsidered here). A survey that's still `scheduled`/`open` never
appears in this view, exactly as the current/open calendar period never
does today (BR-27).

**Sorting/display date**: `closedAt` — the instant a survey actually
concluded — is the authoritative field for both ordering the history and
labeling each point/row (e.g. "10. jan. 2026"), not `createdAt` (when the
admin made it) or `openedAt` (when it started answering). This needs one
explicit rule to be reliable: a survey auto-closed purely by its `endAt`
passing (see "Survey lifecycle") may never have had `closedAt` explicitly
written — closing that way is a pure computation, not a write. So the
first operation that reads such a survey and observes `effectiveLifecycle
=== "closed"` while `closedAt` is still unset **lazily persists
`closedAt = endAt`** (the moment it actually stopped being answerable —
not `now`, which would be later and inaccurate) at that point. This keeps
`closedAt` reliably populated for every genuinely closed survey without
any background job, mirrors the same lazy-correction principle already
used for `teamSurveyState`'s stale pointer, and means the history view
never has to special-case "closed via endAt, never explicitly closed."

**Chart and table share one DTO.** Exactly as the existing `TrendChart`/
`TrendTable` pair already does (`docs/features/product-ux-shell/SPEC.md`
BR-19), the survey-instance chart and the accessible table are both built
from the same already-fetched result array — no separate fetch for the
chart, and no risk of the two ever disagreeing about which surveys are
suppressed or what a period's exact date/count is.

**Chart X-axis decision**: categorical (evenly spaced by survey occurrence,
oldest → newest), not a true time-proportional scale. A genuinely
time-scaled axis was considered and rejected for this phase: with
irregular, sometimes multi-month gaps between a team's surveys, a
proportional axis would compress most points into a sliver of the chart
whenever one gap dominates, and the chart is a supplementary visualization
— the accessible `TrendTable` (unchanged suppression/accessibility
guarantees) remains the source of truth for exact dates. Each point is
labeled with its actual date (e.g. "10. jan. 2026"); a relative label
("9 uker siden") is computed client-side from the current date at render
time — never persisted, per the brief's own explicit requirement — and
shown as secondary, non-load-bearing context. The chart continues to
render a suppressed (below-threshold) survey as a `null` gap (unchanged
`buildTrendSeries`/`connectNulls={false}` pattern), never a zero.

## Flexible cadence
No global or per-team fixed cadence is stored or assumed anywhere. A
survey's only temporal anchors are its own optional `startAt`/`endAt` and
its actual `openedAt`/`closedAt`. Two teams' surveys need no relationship
to each other in time; one team's own surveys need no fixed spacing between
them. This falls directly out of the lifecycle model above — there is no
"current period" concept left to be shared or fixed-width, so nothing
further needs to be built to support flexible cadence this phase (Non-goals
— no scheduler).

## Response-count behavior
When a closed survey's aggregate is published (at/above its own
`minimumResponses`), the exact response count is shown alongside it, e.g.
"12 svar" — unchanged from the existing `PeriodSummary`/`TrendTable`
posture, now labeled per survey instead of per period. Below threshold, no
count of any kind is shown (not "2 av 5", not "4 svar mangler én") — only a
non-sensitive message that may name the configured threshold itself, e.g.
"Resultatet vises når minst 5 personer har svart." (see "Per-survey result
threshold" for why naming the threshold is safe).

## Per-survey result threshold
**Approved product change, made just before TASK-011 — TASK-011 was
expanded to own this change because it directly changes the aggregation
privacy boundary** (see `TASKS.md`'s own record of this expansion). The
original planning session's Non-goal ("stays 5") is superseded by this
decision: the privacy/result-publication threshold is no longer one global
hardcoded value. Every survey instead persists its own `minimumResponses`.

- **Type/range**: integer, `>= 3` and `<= 20`. Not a float, not `0`/`1`/`2`,
  not `> 20`.
- **Default**: `5` — a UI/form default only (the admin creation form
  pre-fills this value); the server never assumes it for a missing or
  invalid persisted value.
- **Set at creation, immutable afterward**: `minimumResponses` is part of
  `CreateSurveyInput` (required, validated server-side exactly like
  `accessMode`) and is persisted exactly as validated. There is no
  threshold-edit operation anywhere in this feature, in this phase or any
  planned one — the value is deliberately immutable for a survey's entire
  lifetime, because changing it later could retroactively expose results
  that were previously suppressed (a survey that collected 4 responses
  under `minimumResponses: 5` must never become publishable merely because
  an admin later lowers the threshold to 3 — the responses were collected
  under one stable privacy contract, and that contract does not change
  after the fact).
- **Server-authoritative, always**: the admin creation UI's `min`/`max`
  input attributes are a usability aid only, never a security control —
  `validateCreateSurveyInput` (domain layer) independently re-validates
  every submitted value, and `isValidSurvey` (the same domain validator
  every persisted-survey read already goes through) re-validates it again
  on every read. A persisted survey with a missing, non-integer, or
  out-of-range `minimumResponses` is **malformed** — it fails closed
  exactly like a missing `createdAt` or an invalid `accessMode` (excluded
  from admin/team lists, never resolved as answerable, never included in
  results/history) — never defaulted to `5` or `3`.
- **No admin bypass**: an app admin's aggregation read goes through the
  exact same per-survey `minimumResponses` check as any other authorized
  caller — `docs/SECURITY.md` invariant 17 (admin access ≠ raw/below-
  threshold data access) applies identically to the per-survey model.
- **The threshold itself is not sensitive** the way a below-threshold
  response count is: it may be shown in admin survey management and on
  team-facing result/history UI (e.g. "Resultater vises når minst 5
  personer har svart."), because knowing *how many responses are needed*
  reveals nothing about *how many have actually been received*. Showing it
  must never be paired with the actual count while suppressed (no "3 av
  5").
- **No legacy/migration handling**: because there is no real survey data
  yet, there is no optional/legacy `minimumResponses` field, no fallback
  to `5` for a persisted survey that predates this change, and no dual
  aggregation path. `MIN_RESPONSE_THRESHOLD`
  (`src/features/results/domain/aggregation.ts`) remains as the threshold
  for the old, calendar-period-scoped `computePeriodAggregate` (retired
  wholesale by TASK-014, not incrementally edited by this change) — it is
  retired *from the publication decision* for the new survey-instance
  aggregation (`computeSurveyAggregate`, which takes a mandatory
  per-survey `minimumResponses` parameter with no default at all), so the
  codebase never has two competing threshold systems deciding the same
  kind of publication question.

## Behavioral requirements

**Survey entity & lifecycle**
- **BR-1**: An app admin can create a survey for a specific `teamId` by
  providing an access mode (`public` | `authenticated`) and, optionally, a
  title, `startAt`, and `endAt`; the server assigns an opaque,
  server-generated `surveyId` and persists a `surveys` document owned by
  that team. Only an app admin can create a survey — never a plain member,
  even for their own team.
- **BR-2**: The server never accepts a client-supplied `surveyId` or
  lifecycle/status value; survey creation is authorized the same way every
  other admin team-management action already is (`requireAppAdmin`).
- **BR-3**: A survey's `accessMode` is fixed at creation and is never
  changed afterward.
- **BR-4**: A newly created survey starts `scheduled` regardless of whether
  `startAt`/`endAt` were provided.
- **BR-5**: An app admin can explicitly open a `scheduled` survey, setting
  `openedAt` to the server's current time; this is the only way a survey
  becomes `open` — a set `startAt` never opens a survey by itself.
- **BR-6**: Opening a survey is rejected if the team already has another
  survey whose derived lifecycle is currently `open` — enforced via the
  `teamSurveyState/{teamId}` coordination document within one Firestore
  transaction (see "One open survey per team"), not a plain query, so two
  concurrent open attempts for the same team can never both succeed.
- **BR-7**: An app admin can explicitly close an `open` survey at any time;
  this sets `closedAt` to the server's current time. Closing is idempotent
  and terminal — no "reopen" action exists.
- **BR-8**: A set `endAt` is enforced automatically and live (no background
  job): once the server's current time reaches or passes it, the survey's
  derived lifecycle is `closed` everywhere, even if `closedAt` was never
  explicitly set.
- **BR-9**: A survey's derived lifecycle is computed identically everywhere
  it's used (submission enforcement, admin UI, team UI) from `openedAt`,
  `closedAt`, and `endAt` — never a separately stored status field that
  could drift from them.

**Access modes & URL**
- **BR-10**: Every survey, of either access mode, is reachable at
  `/survey/{surveyId}` — one URL shape, no per-access-mode namespace.
- **BR-11**: `surveyId` is opaque (contains no team/identity/access-mode
  information) and is not sequential or derivable from another valid
  `surveyId`.
- **BR-12**: For a `public` survey, `/survey/{surveyId}` renders the form
  directly while signed out — no account, sign-in, or membership check.
- **BR-13**: For an `authenticated` survey, `/survey/{surveyId}` while
  signed out never renders the form or reveals the survey's team, title, or
  any other metadata beyond "sign in to continue"; the visitor is directed
  to sign in and returned to the exact same URL afterward.
- **BR-14**: After sign-in, the server verifies the Firebase identity and
  actual membership (BR-16) in the survey's owning team before rendering
  the form — never trusting a client-supplied `uid`, `teamId`, or
  `accessMode`.
- **BR-15**: A user authorized for one team's surveys cannot answer another
  team's `authenticated` survey merely by knowing its `surveyId` —
  authorization is re-derived from the caller's verified identity and the
  survey's own persisted `teamId` on every request.
- **BR-16**: App-admin status alone does not make an identity an eligible
  respondent for an `authenticated` survey — authenticated participation
  requires an actual `teamMemberships` record for the survey's team,
  distinct from the broader admin-or-member authorization
  `authorizeTeamAccess` grants for *viewing results*.

**Anonymity**
- **BR-17**: A `SurveyResponse` document never contains `uid`, `email`, or
  any other stable identity field, regardless of the survey's access mode.
- **BR-18**: For `authenticated` surveys, `SurveyParticipation` documents
  store only `{uid, surveyId}` — no `submittedAt` or any other field — and
  carry no identifier or other join path linking them to the specific
  `SurveyResponse` document they accompany (see "Authentication vs
  anonymity distinction" → "Consistency vs. unlinkability tradeoff" for the
  residual, raw-datastore-only risk this does and does not close).

**Submission**
- **BR-19**: The server resolves a submission's `teamId` and `accessMode`
  solely from the persisted survey record — never from the request body.
- **BR-20**: A submission to a survey whose derived lifecycle is not `open`
  is rejected server-side, regardless of what the client's own rendering
  showed.
- **BR-21**: For `authenticated` surveys, a submission is rejected unless
  the request carries a Firebase ID token verifying an identity with actual
  membership in the survey's team, re-checked from a fresh read at commit
  time (not an earlier page-load check); on acceptance, the server records
  a `SurveyParticipation` keyed by `(uid, surveyId)` in the same Firestore
  transaction as the response write.
- **BR-22**: For `authenticated` surveys, a second submission attempt from
  a `uid` that already has a `SurveyParticipation` for that `surveyId` is
  rejected — at most one accepted response per authenticated identity per
  survey, enforced by the same transaction's fresh read (not a best-effort
  check with a race window — see "Survey submission contract").
- **BR-23**: For `public` surveys, the server performs no
  duplicate-submission detection of any kind — repeated submissions from
  the same visitor all succeed independently, exactly as Phase 1.
- **BR-24**: On acceptance (either mode), the server validates the fixed
  three-question 1-5 answer set, encrypts it server-side with authenticated
  encryption and a fresh nonce/IV, and persists a `SurveyResponse` carrying
  `surveyId`, the server-derived `teamId`, the encrypted payload + its
  decryption metadata, and `submittedAt` — no identity field, no IP
  address, no user agent, no session identifier.

**Results / history**
- **BR-25**: A team's results are computed per closed survey instance: mean
  per dimension + response count from that survey's own `SurveyResponse`
  documents only.
- **BR-26**: An aggregate is published for a closed survey only when its
  response count is at or above that survey's own persisted
  `minimumResponses` (see "Per-survey result threshold" — never a global
  constant); otherwise every caller, including an app admin, sees an
  "insufficient responses" state revealing neither the aggregate nor the
  actual count.
- **BR-27**: No aggregate, response count, or threshold-met/not-met signal
  is ever returned for a `scheduled` or `open` survey, to any caller, under
  any request.
- **BR-28**: The results/history view shows the team's most recent 12
  `closed` surveys, oldest first, in actual chronological order — never a
  fabricated entry for a period with no survey, never an omission of an
  actual occurrence for falling outside a fixed cadence.
- **BR-29**: The trend chart renders each closed survey as one categorical,
  evenly-spaced point in chronological order, labeled with its actual date;
  it never implies elapsed real time is proportional to on-screen distance,
  and a suppressed survey renders as a gap/null, never zero or visually
  indistinguishable from a real published value.

**Team-page discovery**
- **BR-30**: `/teams/[teamId]` shows a "Pågående undersøkelse" section for
  the team's current (`scheduled`/`open`) survey, if any: title/fallback,
  availability, access mode, start/end where set, and a link to
  `/survey/{surveyId}`.
- **BR-31**: If the team has no `scheduled`/`open` survey, the section
  shows a non-sensitive "no current survey" empty state.
- **BR-32**: The team-page survey section reveals nothing about
  responses/results beyond what the existing closed-survey results section
  already discloses to that caller.

**Admin management**
- **BR-33**: `/admin/teams/[teamId]` lists that team's surveys (title/
  fallback, access mode, start/end, derived lifecycle, `/survey/{surveyId}`
  link, response count where BR-26 permits) and lets an app admin create,
  open, close, and delete/archive a survey for that team.
- **BR-34**: Creating a survey from the admin team page always targets that
  page's own `teamId`; the server independently re-verifies app-admin
  authorization for the action regardless of the `teamId` supplied.
- **BR-35**: An app admin can permanently delete a survey that (a) has zero
  `SurveyResponse` documents and (b) whose derived lifecycle is `closed`.
- **BR-36**: An app admin can archive a survey that (a) has one or more
  `SurveyResponse` documents and (b) whose derived lifecycle is `closed`;
  archiving hides it from active team/admin survey views but never deletes
  a response or removes it from results/history (BR-25-BR-29).
- **BR-37**: The delete-vs-archive choice (BR-35/BR-36) is determined
  solely by whether the survey has any responses — never a free client
  choice between the two. Neither action is available on a `scheduled` or
  `open` survey — an admin must close it first (BR-7), so a survey can
  never end up hidden from active views while still technically
  answerable via a bookmarked or previously-shared `/survey/{surveyId}`
  link (a "ghost" open-but-hidden state this precondition rules out by
  construction).

**Home / navigation**
- **BR-38**: The Home page shows "Logg inn"/"Opprett konto" only when the
  visitor is signed out; a signed-in visitor never sees either action on
  Home.
- **BR-39**: Home and the site header no longer link to one static public
  survey; public participation happens only through a generated
  `/survey/{surveyId}` link (reached via a team page or shared externally).

**Authentication continuity**
- **BR-40**: After sign-in triggered by opening an `authenticated` survey
  while signed out, the user is returned to the exact originating
  `/survey/{surveyId}` URL. The continuation parameter is validated
  against a narrow `/survey/{surveyId}`-shaped allow-list (not merely
  "same-origin") — any other value, including an external URL or an
  unrelated internal route, is rejected in favor of the existing `/teams`
  default rather than followed.

**Team disable interaction** (see "Team disable semantics")
- **BR-41**: A survey's answerability requires *both* its own derived
  lifecycle being `open` (BR-9) *and* its owning team's `status` being
  `active`, re-checked fresh at the point of use (in the same transaction
  as the submission itself, and in `resolveSurveyForParticipation`/the
  team-page discovery read) — a survey belonging to a `disabled` team is
  never answerable, for either access mode, regardless of what the
  survey's own `openedAt`/`closedAt`/`endAt` say. Creating or opening a
  survey for a `disabled` team is rejected the same way.
- **BR-42**: Disabling a team does not itself rewrite any of its surveys'
  `openedAt`/`closedAt`/`endAt`/`archivedAt` fields, and does not hide its
  already-collected results/history from existing members/admins — only
  BR-41's *answerability* is affected, not stored lifecycle state or past
  results. Re-enabling the team later restores exactly the lifecycle state
  its surveys had before, with no side effect to undo.

**Per-survey result threshold** (see "Per-survey result threshold" —
approved pre-TASK-011 product change)
- **BR-43**: A survey's `minimumResponses` is required at creation, must be
  an integer in `[3, 20]`, and is validated independently server-side
  (`validateCreateSurveyInput`) regardless of what the admin creation UI's
  `min`/`max` input attributes allow — a missing or out-of-range value is
  rejected, never defaulted.
- **BR-44**: The admin survey-creation form pre-fills `minimumResponses`
  with `5`; this is a UI default only and carries no authority — the
  server never assumes `5` for a missing/invalid value.
- **BR-45**: `minimumResponses` is immutable once a survey is created —
  there is no threshold-edit operation anywhere in this feature.
- **BR-46**: A team's survey-instance results/history computes each
  survey's publication decision solely from that survey's own persisted
  `minimumResponses` — never a global constant, and never another survey's
  value, even for the same team.
- **BR-47**: A persisted survey with a missing, non-integer, or
  out-of-range `minimumResponses` fails closed: it is excluded from
  results/history and from admin/team survey listings exactly like any
  other malformed survey document — never treated as if it were `5` or any
  other value.
- **BR-48**: An app admin's results/history read is subject to the exact
  same per-survey `minimumResponses` suppression as any other authorized
  caller — app-admin status never bypasses a survey's own threshold.

## Edge cases and failure behavior
- Nonexistent `surveyId` → the same generic not-found treatment regardless
  of whether it never existed, was mistyped, or belongs to a since-hard-
  deleted (zero-response) survey — no distinguishing signal (answers
  question 34).
- Archived `surveyId` (still exists, `closed`, just hidden from active
  admin/team-page views, BR-36) → `/survey/{surveyId}` behaves exactly
  like any other `closed` survey ("this survey has ended") for anyone with
  the direct link — archiving is deliberately scoped to discovery/listing
  visibility only, not to the direct URL, so no special-case "archived"
  state is needed at this route; it would add a distinction with no
  privacy or product benefit over the existing `closed` treatment.
- A `closed`-via-`endAt` survey whose admin never explicitly clicked
  "close" → treated as `closed` everywhere (BR-8/BR-9); the admin UI shows
  it as closed too (same derivation), so there's no stale "still open"
  admin view.
- An authenticated user's membership is revoked between page-load and
  submit → the submit-time re-check (BR-14's "never trusting the earlier
  page-load check") rejects it, mirroring the existing `/teams/[teamId]`
  "next request is denied" posture (`docs/features/team-management/
  SPEC.md` — Edge cases).
- An authenticated user attempts a second submission after their first
  succeeded → rejected per BR-22, with a message that only confirms *their
  own* prior submission (not a privacy leak — see "Threshold/privacy
  behavior" for why revealing someone their own action is not the same as
  revealing content).
- A public survey receives many rapid submissions from the same
  visitor/script → all succeed independently (BR-23); see "Abuse/
  duplicate-response threat model" for the accepted, documented tradeoff.
- Firestore write failure while persisting a `SurveyResponse` (and, for
  `authenticated` mode, its paired `SurveyParticipation`) → the request
  reports failure; no partial success (one document written, the other
  not) is left as a silently-accepted result — both writes happen in one
  transaction/batch (implementation detail, but the atomicity requirement
  itself is not optional).
- Two admins race to open the same `scheduled` survey, or to open two
  different `scheduled` surveys for the same team, simultaneously → the
  transactional check (BR-6) admits exactly one opening; the other's
  request fails with a generic "could not open" result, not a duplicated
  open state.
- A team is disabled (`docs/features/team-management/SPEC.md` BR-2/BR-3)
  while it has an `open` survey → **corrected in this review pass** (see
  "Team disable semantics" below): the survey's own lifecycle field is
  *not* rewritten (no automatic `closedAt`, so results/history are
  unaffected), but it stops being *answerable* immediately — the next
  submission attempt, and the next `resolveSurveyForParticipation` read,
  both re-check the owning team's `active` status and treat a `disabled`
  team's survey as unavailable, exactly mirroring the existing precedent
  that a disabled team is rejected at pulse-survey submission time
  (`docs/features/team-management/SPEC.md` BR-32). Results/history for a
  disabled team's past surveys remain visible to its existing
  members/admins, unchanged (BR-3's "remains fully accessible... to its
  existing members" applies to *viewing*, not to *new submissions*).
- A survey is archived while a team member has its results page open → per
  the existing pattern (`docs/features/team-management/SPEC.md` — Edge
  cases, "team disabled while viewing"), their current view is unaffected;
  their next request reflects the archived state (hidden from the
  "current survey" section; unaffected in results/history, since
  archiving never removes a survey from BR-25-BR-29).

## Security and privacy
No additional requirements beyond what's already made explicit throughout
this spec (BR-16 through BR-24 and BR-26/BR-27 in particular) and
"Authorization model"/"Abuse/duplicate-response threat model" below — this
section exists to cross-reference `docs/SECURITY.md` explicitly rather than
restate it:
- Invariants 1/3/4/5 (application-level encryption, server-side only, keys
  never leave the server): unchanged mechanism, reused as-is (BR-24).
- Invariant 6 (no identity in anonymous responses): BR-17.
- Invariant 7 (participation stored separately from response data): BR-18
  — the one place this phase actually *introduces* participation tracking,
  built from the start as a separate, unlinked record, not retrofitted.
- Invariants 8/9 (server-side team authorization, no cross-team leakage):
  BR-14, BR-15, BR-19, reusing `authorizeTeamAccess` and adding the
  narrower "actual membership" check (BR-16) on top for participation
  specifically — results *viewing* authorization (admin-or-member) is
  unchanged.
- Invariants 10/11/12 (no individual scores; configurable minimum
  threshold, currently 5): BR-25-BR-27, unchanged threshold value.
- Invariant 14 (no sensitive content in logs): unchanged posture, applies
  identically to the new submission/results/participation server
  operations — none of them may log answer content, decrypted values, or
  `SurveyParticipation` identities on any failure path. One new,
  feature-specific rule this phase adds: an application log line may
  reference `uid` and `surveyId` together (e.g. "rejected duplicate
  submission for uid X, survey Y" — this only restates the
  `SurveyParticipation` relation that already exists and is intentional),
  but must **never** log a generated `SurveyResponse` document ID
  alongside a `uid` in the same entry — doing so would recreate, in log
  storage, exactly the join the Firestore design deliberately avoids (see
  "Consistency vs. unlinkability tradeoff"). Since no `responseId` is ever
  returned to the client either (step 10, "Survey submission contract"),
  this is a case of not letting an internal implementation value leak into
  a place its whole design tries to avoid.
- Invariant 17 (admin ≠ raw-response access): unchanged, and BR-16
  additionally establishes that admin status ≠ *participation eligibility*
  either — a narrower, new application of the same underlying principle.
- **No new external dependency or data processor**: this feature introduces
  no third-party survey/analytics service, no client-side tracking script,
  and no external response-processing pipeline. Recharts (already adopted,
  `docs/features/product-ux-shell/SPEC.md`) remains purely local
  visualization over data the server already authorized and returned to
  this caller — unchanged from its existing role, not extended to send
  data anywhere.

## Delete/close/archive semantics
Explicitly decided in this planning session (see the "Duplicate
prevention"/"Concurrent open surveys"/"Delete semantics"/"Access-mode
default" decisions recorded at the top of this planning conversation):

- **Close** (BR-7): stops new submissions; preserves every existing
  response and the survey's place in results/history untouched; terminal
  (no reopen).
- **Delete** (BR-35): permitted **only** while the survey has zero
  `SurveyResponse` documents **and** is already `closed` — e.g. an admin
  created it by mistake and closes it immediately without ever opening it.
  Removes the survey document entirely. Never available once any response
  exists — there is nothing to "delete around" (no responses to
  accidentally destroy), so this path carries no additional audit/privacy
  risk. Requiring `closed` first (rather than allowing delete straight from
  `scheduled`) is a deliberate, uniform precondition shared with archive
  (below), not an arbitrary restriction — see BR-37. Because a
  `SurveyParticipation` document is only ever written in the same
  transaction as its corresponding `SurveyResponse` (never independently —
  "Survey submission contract"), zero responses transitively means zero
  participations too for that survey; deleting it can never leave an
  orphaned `SurveyParticipation` behind.
- **Archive** (BR-36): the *only* removal-like action available once a
  survey has one or more responses, and only once it's already `closed`.
  Hides the survey from the team's "current survey" view (BR-30) and from
  the admin's default/active survey list, but changes nothing about its
  stored responses or its results/history entry (BR-25-BR-29) — mirrors
  the existing `Team` `active`/`disabled` reversible-only pattern
  (`docs/features/team-management/SPEC.md` — no hard delete of a team with
  data either). Requiring `closed` first prevents a survey from ever being
  simultaneously "hidden" (archived) and "still answerable" (open) —
  states that would otherwise contradict each other from a bookmarked or
  previously-shared link's perspective.
  This phase does not add an "unarchive" action; if that proves useful, it
  is a small, low-risk future addition (an admin-only status flip with no
  data implications), not designed here to avoid speculative scope.
- The choice between delete and archive is never a free admin choice
  (BR-37) — it's determined solely by response count, so an admin can
  never accidentally destroy real response data via the "delete" action,
  and can never be blocked from cleaning up a genuinely empty mistake.

## UI/UX requirements
- Access-mode choice: no radio pre-selected; the create action stays
  disabled until the admin picks one (explicit decision, this session — no
  silent security/product default). Norwegian copy follows the brief's
  given example closely:

  > **Hvem kan svare?**
  > ( ) Alle med lenken — Alle som har lenken kan svare anonymt uten å
  >     logge inn.
  > ( ) Kun medlemmer av teamet — Deltakeren må logge inn og være medlem av
  >     teamet.

  Exact final wording lives in the relevant feature's copy module
  (`docs/features/product-ux-shell/SPEC.md`'s established localization
  approach — plain TypeScript copy constants, no i18n library), not
  hardcoded inline.
- Internal/technical values (`"public"`, `"authenticated"`, `"scheduled"`,
  `"open"`, `"closed"`) are never shown to a user — every user-facing
  surface (admin list, team-page card, availability messages) uses
  Norwegian, non-technical phrasing, consistent with `docs/UI-UX.md`.
- Once a survey is actually `open` (`openedAt` is set), the admin/team UI
  shows it as started — it does not continue to display the original
  `startAt` as a still-pending "planned start," which would otherwise read
  as contradicting the "Åpen" state next to it (see "Survey lifecycle" →
  "Why `status=open` with a future `startAt` is not a contradiction").
- Reuses the existing shared primitives (`Button`, `Card`, `Alert`,
  `EmptyState`, `LoadingState`, `PageHeader`, `PageShell` —
  `src/components/ui/`) and the shared `useAuthGatedResource` auth-gating
  hook (`src/features/auth/client/`) for every new authenticated
  surface, per `docs/UI-UX.md` and `.claude/rules/architecture.md` — no new
  component system.
- Admin survey management follows `docs/UI-UX.md`'s existing "Admin UX"
  guidance: operational density and clarity over illustrative layout, dense
  scannable rows, explicit confirmation for the destructive "delete"
  action (archive, being reversible-in-spirit for the data itself, needs a
  clear but lighter affordance — mirrors the existing team
  disable/re-enable treatment).
- No individual-performance/gamification pattern is introduced anywhere in
  this feature (unchanged `docs/PRODUCT.md` non-goal, `docs/UI-UX.md`
  "Privacy-aware design").
- Home becomes auth-aware (BR-38/BR-39): signed-out Home explains DevPulse
  and privacy/anonymity and offers "Logg inn"/"Opprett konto"; signed-in
  Home offers relevant next actions (e.g. "Mine team") and never the
  signed-out actions. Team results remain not directly navigable from
  signed-out Home (unchanged posture — survey participation happens only
  via a generated survey link, never a generic Home CTA).

## Accessibility requirements
- Every new form control (survey creation, access-mode choice, date
  inputs) has a real, associated `<label>`, consistent with `docs/
  UI-UX.md`'s existing accessibility rules.
- The access-mode choice is a real `<fieldset>`/radio group with a legend,
  not two independently-labeled buttons — keyboard-operable, with a
  visible focus state on each option.
- Lifecycle/availability state (scheduled/open/closed) is never conveyed by
  color alone — paired with explicit Norwegian text, consistent with the
  existing chart-suppression accessibility posture (`TrendChart`'s
  `aria-hidden` + visible heading/description pattern is reused for the
  survey-instance chart unchanged).
- The results/history accessible `TrendTable` remains the authoritative,
  non-chart rendering of survey-instance data (unchanged role).

## Responsive requirements
Every new/changed screen in scope — `/survey/[surveyId]`, the team-page
"Pågående undersøkelse" section, and the admin team page's survey
management section — works at common phone widths (~360-400px) with no
page-level horizontal scrolling, consistent with every existing screen's
requirement (`docs/UI-UX.md`); the admin survey list and any table/chart
scroll only within their own container if they must.

## Error/loading/empty states
- **`/survey/{surveyId}`**: distinct states for not-found (invalid/unknown
  ID), not-yet-started (`scheduled`), closed, sign-in-required
  (`authenticated`, signed out), forbidden (`authenticated`, signed in but
  not an actual member), loading, submitting, success, and validation
  error — each in Norwegian, reusing the shared `Alert`/`LoadingState`
  primitives.
- **Team-page survey section**: loading, empty ("no current survey"), and
  loaded-with-a-current-survey states.
- **Admin survey management**: loading, empty ("no surveys yet"), per-row
  pending/error states for create/open/close/delete/archive (mirroring the
  existing `AdminTeams`/`AdminTeamDetail` per-row action-state pattern
  exactly), and a distinct confirmation state for the destructive delete
  action.
- None of these states ever reveal more than the corresponding server
  response already discloses (unchanged posture from `docs/features/
  team-management/SPEC.md` BR-16, `product-ux-shell` BR-16).

## Security/privacy requirements
See "Security and privacy" above — no additional requirements beyond what
is already made explicit in the Behavioral requirements and that section.

## API/server-boundary implications
New server operations (exact route paths are implementation detail for
task planning, following this repo's established pattern of thin route
handlers delegating to feature server operations):
- `createSurvey` (admin-only; BR-1-BR-4)
- `openSurvey` (admin-only; BR-5/BR-6, transactional)
- `closeSurvey` (admin-only; BR-7/idempotent)
- `deleteOrArchiveSurvey` (admin-only; BR-35-BR-37, branches on response
  count server-side)
- `listTeamSurveys` (admin-only, for the admin team page; also usable,
  narrowed to non-sensitive fields, for the team-page "current survey"
  section — or a dedicated narrower read, at task planning's discretion)
- `resolveSurveyForParticipation(surveyId, identity?)` — the server-side
  read backing `/survey/{surveyId}` itself: resolves not-found / lifecycle
  state / access-mode / authorization outcome, without ever returning
  protected team data (BR-12-BR-16)
- `submitSurveyResponse(surveyId, rawAnswers, idToken?)` — the submission
  contract described above (BR-19-BR-24)
- `getSurveyResults` (or an adapted `getTeamResults`) — survey-instance-
  scoped aggregation or (BR-25-BR-29), replacing the period-scoped version

All of the above are server-only (`"server-only"` import, Firebase Admin
SDK), following `.claude/rules/security.md` and the existing pattern in
`src/features/results/server/`, `src/features/teams/server/`. `/survey/
[surveyId]/page.tsx` should be a Server Component performing this
resolution server-side (`.claude/rules/nextjs-react.md` — "prefer
server-side loading for authenticated or sensitive data"), consistent with
how `/teams/[teamId]/page.tsx` already delegates rendering to a
client-side authorized component only after establishing the shell
server-side.

**Response minimization, made explicit**: `resolveSurveyForParticipation`'s
return shape is limited to exactly what "Public survey flow"/"Authenticated
survey flow" already approve for exposure (title, team name, derived
lifecycle/availability, access mode) — it never includes `createdBy`,
`archivedAt`, the `teamSurveyState` coordination document, or any other
internal/administrative field, for *either* access mode and regardless of
authorization outcome. `getSurveyResults` returns only the per-survey
date/count-or-suppressed/aggregate-or-suppressed shape "Results/history
model" describes — never `createdBy`, encrypted payloads, or any
`SurveyParticipation` data. `listTeamSurveys` (admin-only) may reasonably
surface `createdBy` for accountability (the same pattern `teams`/
`teamInvitations`/`teamAccessRequests` already use for `invitedBy`/
`grantedBy`/`resolvedBy`), but even there never returns encrypted payloads,
raw responses, or any specific `SurveyParticipation` document's identity.

The sign-in flow needs a continuation target (BR-40) — `/sign-in`
currently always continues to a hardcoded `/teams` link (`SignInForm.tsx`).
**Hardened in this review pass**: rather than accepting any same-origin
relative path (a broader mechanism than this feature actually needs, and
one more thing a future bug could widen into an open redirect), the
continuation parameter is validated against a narrow allow-list shape —
it must match `^/survey/[^/]+$` (this feature's one actual destination) or
be absent (defaulting to `/teams`, the existing behavior); any other value
is rejected/ignored in favor of the `/teams` default rather than followed.
This is strictly narrower than "same-origin," closing not just external
open-redirect targets but also any accidental reachability of another
internal route this feature never intended the sign-in continuation
mechanism to expose.

## Firestore/index implications
New collections (server-only via Firebase Admin SDK; each needs the same
explicit `allow read, write: if false` client-SDK deny block every existing
collection already has in `firestore.rules`, for the same
documentation/defense-in-depth reason):
- `surveys/{surveyId}`: `{teamId, title?, accessMode, minimumResponses,
  startAt?, endAt?, openedAt?, closedAt?, archivedAt?, createdAt,
  createdBy}` — `minimumResponses` is required (not optional), an integer
  in `[3, 20]`, and immutable after creation (see "Per-survey result
  threshold").
- `surveyResponses/{responseId}`: `{surveyId, teamId, ciphertext, iv,
  authTag, keyVersion, submittedAt}` — replaces `pulseSurveyResponses`
  (see "Migration/cleanup implications"); random document ID, same
  no-identity/no-correlation-metadata posture as today.
- `surveyParticipations/{uid}__{surveyId}` (deterministic composite ID,
  mirroring `teamMemberships`'s own `{uid}__{teamId}` pattern):
  `{uid, surveyId}` — **no `submittedAt`**, deliberately (see
  "Authentication vs anonymity distinction" → "Consistency vs.
  unlinkability tradeoff"). A deterministic ID means the duplicate check
  (BR-22) is a direct document read/transactional-create, needing no query
  or composite index at all.
- `teamSurveyState/{teamId}` (deterministic ID = `teamId`):
  `{activeSurveyId: string | null, updatedAt}` — the one-open-survey-per-
  team coordination document (see "One open survey per team"). No
  personal or sensitive data; write-side coordination only, never read by
  any results/discovery path.

Indexes: querying `surveyResponses` by `surveyId` (single-field, or `in`
across up to the trend window's surveys for the history view) needs no
composite index — a strict improvement over today's `(teamId, period)`
composite requirement, since the new model no longer needs to combine two
equality filters for this read. Querying `surveys` by `teamId` for the
admin team page and team-page discovery (single-field) is likewise
auto-indexed. The one-open-survey-per-team check needs **no index at
all**: it's a direct document get on `teamSurveyState/{teamId}` (plus, on
the rare conflict-detected-then-found-stale path, a direct document get on
the one `surveys/{activeSurveyId}` it names) — not a query — by
construction of the coordination-document design above.

## Migration/cleanup implications
Per this session's explicit project-state clarification (no real survey
data, no real users/teams/responses to preserve): **this is a clean
replacement, not a staged migration** — unlike `docs/features/
team-management/SPEC.md`'s deliberate coexistence period (which existed
because that phase couldn't rule out real data). Retired, not adapted,
once the new model is implemented:
- `pulseSurveyResponses` Firestore collection (replaced by
  `surveyResponses`) and its `(teamId, period)` composite index.
- `src/features/pulse-survey/` in its entirety: `domain/period.ts`
  (`getCurrentSurveyPeriod`, `isPeriodClosed`, `listPrecedingClosedPeriods`
  — the calendar-period concept itself is retired, not merely its call
  sites), `domain/validation.ts` (superseded by survey-scoped submission
  validation), `server/submit-pulse-survey.ts`, `components/
  PulseSurveyForm.tsx`, and their tests.
- `app/pulse-survey/page.tsx` and `app/api/pulse-survey/route.ts` (no
  single static public survey remains — BR-39).
- `src/features/results/domain/aggregation.ts`'s period-shaped surface
  (`computePeriodAggregate` taking a `period` string) and `src/features/
  results/server/get-team-results.ts`'s `(teamId, periods[])` read —
  replaced by survey-instance-scoped equivalents; the underlying
  decrypt-validate-threshold-mean *logic* is reused, only its keying
  changes.
- `PeriodAggregateResult`'s `period: string` field becomes a `surveyId`
  (+ resolved date for display) — a type-level rename/reshape, not a new
  concept.
- Nothing about `src/features/teams/` (Team, TeamMembership,
  `authorizeTeamAccess`, invitations, access requests) is retired — all of
  it is reused as-is or extended (BR-16), per "Current-state summary."
- `docs/features/pulse-survey/SPEC.md` and `docs/features/
  results-dashboard/SPEC.md` are **not rewritten** — they remain the
  historical record of what Phases 1/2 implemented and why (unchanged
  documentation norm, `docs/DEVELOPMENT.md`). A superseded-note is added to
  each once this phase actually implements its replacement (implementation
  time, not this planning pass), mirroring exactly how `results-dashboard/
  SPEC.md` already carries a superseded-note pointing at `team-management/
  SPEC.md`.

## Documentation impact
Tracked here for implementation time (this planning session updates only
`docs/ROADMAP.md`, per the explicit scope rule for this session):
- `docs/PRODUCT.md`: describe survey instances / configurable access
  replacing the always-on weekly survey; note `AnonymousChallenge`/forum/
  skill-tree phases are renumbered (5-7).
- `docs/ARCHITECTURE.md`: document the new lifecycle-derivation pattern,
  the `authorizeTeamAccess` + actual-membership-for-participation
  refinement (BR-16), and the `SurveyParticipation`/`SurveyResponse`
  separation as now-implemented (today's "future/not implemented" language
  for `SurveyParticipation` becomes "implemented, authenticated-mode
  only").
- `docs/DATA-MODEL.md`: replace the `Survey`/`SurveyResponse`/
  `SurveyParticipation` rows with the concrete, now-implemented shapes
  above; update the "Notes" section's "SurveyParticipation... is not
  implemented" framing.
- `docs/SECURITY.md`: re-walk the feature review checklist (no new
  invariant *number* is expected — this phase is the first concrete
  implementation of already-stated invariants 7 (participation stored
  separately from response data) and 17 (admin ≠ raw-response access,
  extended here to admin ≠ participation eligibility) — but the checklist
  should still be explicitly re-walked at implementation time, not
  assumed. `docs/ARCHITECTURE.md`'s "Open questions" entry on
  `SurveyParticipation`'s storage mechanism (currently "future/not
  implemented") should be resolved to point at this feature's concrete
  design once built.
- `docs/UI-UX.md`: note the new admin survey-management surface and the
  survey-instance chart's categorical-axis decision as durable UI
  direction, if implementation surfaces anything not already covered by
  the existing Admin UX/Charts sections.
- `docs/DEVELOPMENT.md`: new Firestore collections/indexes/rules once
  actually deployed (mirrors how `team-management`'s new collections were
  documented there).

## Testing strategy
| Boundary | Covers |
|---|---|
| Domain: lifecycle derivation (`effectiveLifecycle` from `openedAt`/`closedAt`/`endAt`) | BR-8, BR-9, BR-20, BR-27 |
| Domain: survey/access-mode/answer validation | BR-1, BR-3, BR-24 |
| Server: `createSurvey` (admin-only, no client-controlled `surveyId`/status) | BR-1, BR-2, BR-3, BR-4 |
| Server: `openSurvey` (`teamSurveyState` coordination doc; two concurrent opens for the same team resolve to exactly one active survey; stale pointer past a survey's `endAt` is self-corrected, not a false conflict) | BR-5, BR-6 |
| Server: `closeSurvey` (idempotent, terminal, `endAt` auto-close, clears a matching `teamSurveyState` pointer) | BR-7, BR-8 |
| Server: `deleteOrArchiveSurvey` (response-count-gated branch; rejected while lifecycle is `scheduled`/`open`) | BR-35, BR-36, BR-37 |
| Server: `resolveSurveyForParticipation` (not-found / lifecycle / access-mode / auth outcomes, no pre-auth metadata leak) | BR-12, BR-13, BR-14, BR-15, BR-16 |
| Server: `submitSurveyResponse` (single-transaction: fresh lifecycle/membership/dedup reads, server-derived teamId/accessMode, encryption, no response↔participation link; a `closeSurvey`/membership-removal committed concurrently causes an in-flight submission to abort, never to commit against stale state) | BR-17 - BR-24 |
| Server: survey-instance results/aggregation (per-survey threshold suppression, closed-only, reused decrypt/validate logic, `closedAt` lazily backfilled for an `endAt`-auto-expired survey, sort/display date, chart+table share one DTO) | BR-25, BR-26, BR-27, BR-28, BR-29 |
| Server: team-scoped survey listing (admin + team-page current-survey read) | BR-30, BR-31, BR-32, BR-33, BR-34 |
| Client: `/survey/[surveyId]` states (public form, sign-in-required, forbidden, not-started, closed, not-found, success, validation error) | BR-12, BR-13, BR-20 |
| Client: sign-in same-origin continuation target | BR-40 |
| Client: admin survey management (create/open/close/delete/archive states) | BR-33 - BR-37 |
| Client: team-page "Pågående undersøkelse" section | BR-30, BR-31, BR-32 |
| Client: results/history trend (survey-instance chart + table, suppression-safe, categorical axis, chronological order) | BR-25, BR-28, BR-29 |
| Client: Home auth-aware states | BR-38, BR-39 |
| Security: negative paths — cross-team authenticated submission, app-admin-without-membership submission, client-supplied `teamId`/`accessMode`/`surveyId` on any write, duplicate authenticated submission, direct Firestore client-SDK access to all four new collections (including `teamSurveyState`) | BR-14 - BR-19, BR-21, BR-22, `.claude/rules/tests.md` |
| Security: concurrency — two simultaneous `openSurvey` calls for the same team resolve to exactly one active survey; a submission racing a concurrent `closeSurvey`/membership-removal/team-disable never commits against stale state; two simultaneous submissions from the same authenticated identity never both succeed | BR-6, BR-14, BR-20, BR-21, BR-22, BR-41 |
| Server: team-disable interaction (submission rejected for a disabled team's survey regardless of its own lifecycle; creation/opening rejected for a disabled team; existing results/history unaffected) | BR-41, BR-42 |
| Server/domain: per-survey `minimumResponses` (creation validation range/default/immutability; results/history threshold matrix at 3/5/10; each survey uses only its own threshold; malformed threshold fails closed/excluded; app admin gets no bypass) | BR-43 - BR-48 |

## Acceptance criteria
- [ ] An app admin can create a survey for a team with an explicitly chosen
      access mode (no pre-selected default), obtaining a
      `/survey/{surveyId}` link immediately.
- [ ] A `public` survey's link renders the form to a signed-out visitor and
      accepts an anonymous submission while `open`.
- [ ] An `authenticated` survey's link never renders the form or any
      survey/team metadata to a signed-out visitor; after signing in, a
      visitor who is not an actual member of the survey's team sees a
      non-sensitive "no access" state, never the form.
- [ ] An actual team member can open and submit an `authenticated` survey
      exactly once; a second attempt is rejected without revealing
      anything about other respondents.
- [ ] An app admin with no membership in a team cannot submit that team's
      `authenticated` survey merely by virtue of being an app admin.
- [ ] No `SurveyResponse` document, for either access mode, ever contains
      `uid`, `email`, or any other identity field; no `SurveyParticipation`
      document shares any field with the `SurveyResponse` it accompanied.
- [ ] Opening a second survey for a team that already has one `open`
      survey fails; two admins opening two different surveys for the same
      team at the same time still results in exactly one active survey,
      never both and never neither.
- [ ] Closing a survey immediately stops new submissions while leaving all
      existing responses and its results/history entry unchanged.
- [ ] A survey with zero responses can be deleted; a survey with one or
      more responses can only be archived, never deleted, and archiving
      never removes a response or its results/history entry. Neither
      action is available while the survey is still `scheduled`/`open`.
- [ ] A submission that begins while a survey is `open`, racing a
      concurrent admin close, either commits cleanly against the still-open
      state or is rejected outright — never partially persisted, and never
      accepted against a survey the server had already closed by the time
      of the actual write.
- [ ] A submission to an otherwise-`open` survey whose owning team has been
      disabled is rejected, for both access modes, without changing the
      survey's own `openedAt`/`closedAt`; the team's existing members/admins
      can still view that survey's already-collected results.
- [ ] Creating or opening a survey for a `disabled` team is rejected.
- [ ] A team's results/history view shows only its actual closed surveys,
      in true chronological order, with no fabricated empty entries and no
      data for any `scheduled`/`open` survey.
- [ ] A closed survey's aggregate is shown only at/above that survey's own
      persisted `minimumResponses`; below threshold, no caller — including
      an app admin — sees the actual count.
- [ ] Every survey persists its own `minimumResponses` (integer, `[3,
      20]`), required and independently validated at creation, immutable
      afterward; a missing/invalid persisted value fails closed (excluded
      from results/history and survey listings), never defaulted to 5.
- [ ] The trend chart never renders a suppressed survey as zero or as
      visually indistinguishable from a real published value.
- [ ] A direct Firebase client-SDK read/write attempt against `surveys`,
      `surveyResponses`, or `surveyParticipations` is denied under every
      authentication state.
- [ ] Signing in from an `authenticated` survey's sign-in prompt returns
      the user to that exact survey URL, and the continuation target is
      validated same-origin (not an open redirect).
- [ ] Home never shows "Logg inn"/"Opprett konto" to a signed-in visitor.
- [ ] `pnpm lint`, `pnpm typecheck`, and the full automated test suite
      pass once implemented.

## Open questions
None blocking for this planning session — the decisions this brief
explicitly flagged as needing an answer (access-mode default, delete
semantics, authenticated-mode duplicate prevention, one-open-survey-per-
team) were all resolved explicitly during this planning conversation and
are recorded throughout this spec. Non-blocking, left to task planning:
- Exact Firestore index shape for the one-open-survey-per-team
  transactional check ("Firestore/index implications").
- Exact route naming for the new server operations (this repo's
  established convention of leaving route naming to implementation).
- Whether a browser-local (`localStorage`) completion marker is worth
  adding for `public` surveys as a pure UX convenience (never a trust
  mechanism) — low-stakes, can be decided at task-planning time or skipped
  entirely without affecting any behavioral requirement above.
- Whether to add an "unarchive" action later, if real admin usage shows
  the lack of one is a genuine friction point (not designed here — see
  "Delete/close/archive semantics").

## Abuse/duplicate-response threat model
A `public` survey cannot simultaneously guarantee zero identity collection,
frictionless anonymous access, and cryptographically reliable
one-person-one-response semantics — this phase does not pretend otherwise.
For `public` surveys, protections are explicitly layered and classified:

- **UX-level** (convenience only, never trusted as identity or
  authorization evidence): a browser-local (`localStorage`) "you already
  answered this survey on this device" marker is a reasonable, low-cost
  addition a task can add — it prevents an *accidental* repeat submission
  from the same browser, nothing more. It must never be read server-side,
  never influence any authorization/threshold decision, and must be
  understood to do nothing against a different browser, a private window,
  or a second device.
- **Operational**: server-side request-size limits and rate limiting on
  the submission endpoint are reasonable, standard protections against
  scripted/automated abuse — this phase documents them as appropriate but,
  consistent with `docs/features/pulse-survey/SPEC.md`'s and `docs/
  features/team-management/SPEC.md`'s own prior "rate limiting is out of
  scope" decisions, does not mandate a specific implementation this
  session; a future security-focused task may add this without requiring a
  new planning pass, since it changes no behavioral contract above.
  CAPTCHA/other active bot-mitigation is explicitly deferred further (see
  Non-goals) — not because it's unimportant, but because it's a
  higher-cost, higher-friction tool that should only be reached for if
  real abuse is observed, not built speculatively. **Forward-looking
  constraint on that future work**: if/when rate limiting is implemented,
  it may use a requester's IP only transiently (e.g. an in-memory or
  short-TTL counter scoped to a rate-limit window) — it must never persist
  an IP-to-response or IP-to-participation correlation into Firestore or
  into any durable log, since that would reintroduce exactly the durable
  respondent-identity store this spec's abuse model explicitly rules out
  above ("IP addresses are explicitly never used as a durable respondent
  identity"). This binds that future decision now so it isn't quietly
  reopened when rate limiting is eventually built.
- **Strong identity-based**: only available in `authenticated` mode
  (BR-21/BR-22, this phase) — a `public` survey, by product design, has no
  identity to check against, ever. An organization that needs reliable
  one-response-per-person semantics for a given survey should choose
  `authenticated` mode for it; that tradeoff is the entire reason the
  access mode is configurable per survey rather than global.
- **No hidden account creation**: a `public` survey never silently creates
  an account, session, or any other identity-shaped record for the
  respondent as a side effect of submitting — "no account required" (BR-12)
  means exactly that, not "an invisible one is created for you."
- **IP addresses** are explicitly never used as a durable respondent
  identity and never stored in a `SurveyResponse` or `SurveyParticipation`
  document — consistent with every existing privacy invariant. If
  infrastructure/platform request logs incidentally capture IP addresses
  by default, that is a separate, operational logging concern outside this
  application's own data model, not application response data, and is not
  addressed or changed by this feature.
- **Known-value-injection residual risk** (unchanged mechanism, inherited
  from `docs/features/results-dashboard/SPEC.md` → "Residual risk"):
  exactly as today, a participant in a `public` survey could submit
  known-value responses and, once the survey closes and its aggregate
  publishes, algebraically infer something about the remaining
  respondents' answers. This phase does not newly introduce this risk (it
  already exists today) and does not attempt to solve it (solving it would
  require identity for public surveys, which contradicts the whole point
  of offering a `public` access mode) — carried forward as an explicitly
  accepted, documented, non-blocking limitation, exactly as it already is.
  **One timing nuance worth naming, identified in this review pass**:
  moving from a universally-known calendar-week boundary to per-survey
  `startAt`/`endAt` changes *what an attacker needs to know* to time the
  attack, not the attack's fundamental mechanism or severity. In the old
  model, "when does the period close" required no survey-specific
  information at all (every team shared the same week). In the new model,
  if an admin sets a public survey's `endAt`, that timestamp is part of
  the already-approved "safe to expose pre-submission" metadata (see
  "Public survey flow"), which means it hands a precise close-time to
  exactly the same class of participant already capable of this attack —
  a mild sharpening of an already-accepted risk, not a new one, and not
  severe enough to withdraw `endAt` from the already-documented public
  metadata (doing so would only obscure the close time, not prevent the
  underlying attack, since a close is also directly observable by the
  form simply becoming unavailable). No mitigation is added here beyond
  naming it explicitly, consistent with the existing risk's
  already-accepted, non-blocking status.

## Data model
See "Firestore/index implications" for exact persisted shapes. Summary of
the three new entities and their relationships:

```
surveys/{surveyId}
    teamId, title?, accessMode, minimumResponses, startAt?, endAt?,
    openedAt?, closedAt?, archivedAt?, createdAt, createdBy

surveyResponses/{responseId}          (random id, no identity)
    surveyId, teamId, ciphertext, iv, authTag, keyVersion, submittedAt

surveyParticipations/{uid}__{surveyId}   (authenticated mode only)
    uid, surveyId                        (deliberately no submittedAt)

teamSurveyState/{teamId}              (write-side coordination only)
    activeSurveyId: string | null, updatedAt
```

`surveyResponses.surveyId` and `surveyParticipations.surveyId` both
reference `surveys/{surveyId}`, but `surveyResponses` and
`surveyParticipations` share **no** field with each other (BR-18) — the
only way to know "this uid submitted to this survey" is the existence of a
`surveyParticipations` document; there is no application-level path from
that document to any specific `surveyResponses` document (see
"Consistency vs. unlinkability tradeoff" for the narrow, raw-datastore-only
residual this does not close). `teamSurveyState.activeSurveyId` references
`surveys/{surveyId}` too, but only as a write-time hint — never trusted as
authoritative without re-deriving the referenced survey's own lifecycle
(see "One open survey per team").

**Why `surveyParticipations`' deterministic `{uid}__{surveyId}` ID is not
itself a privacy problem**: unlike `SurveyResponse` (anonymous by design —
its whole purpose is to carry answer content with no identity attached),
`SurveyParticipation` is *intentionally* identity-linked — recording "this
uid participated in this survey" is its entire reason to exist (BR-21/
BR-22). Its privacy property comes from three things holding
simultaneously, not from the document itself being anonymous: it is
server-only (denied to the client SDK, "Firestore rules"), it carries no
response *content*, and it is never joined to a specific `SurveyResponse`
document by any field, query, or code path this application provides
("Consistency vs. unlinkability tradeoff"). A deterministic ID here is the
same, already-established pattern `teamMemberships/{uid}__{teamId}` uses
for the same reason (`docs/features/team-management/SPEC.md`) — appropriate
specifically because this collection's content is meant to be
identity-linked, unlike `surveyResponses`, whose document ID is random for
the opposite reason.

## Authorization model
Layered directly on the existing, unchanged `authorizeTeamAccess`
(`src/features/teams/server/authorize-team-access.ts`, `"admin" | "member"
| "denied"`, `docs/features/team-management/SPEC.md`):

- **Survey creation/management** (create/open/close/delete/archive): app
  admin only — `requireAppAdmin`, reused unchanged, exactly as team/
  invitation/access-request management already works.
- **Results viewing** (`/teams/[teamId]`'s survey-instance results):
  `authorizeTeamAccess(identity, teamId) !== "denied"` — unchanged, admin
  or member both see results, exactly as today.
- **Authenticated survey participation** (the one place this phase
  narrows the existing model, BR-16): requires an actual `teamMemberships`
  record for `(uid, teamId)` — **not** merely
  `authorizeTeamAccess(...) === "admin"` on app-admin grounds alone. An app
  admin who also happens to hold real membership in that team can still
  participate (their membership, not their admin status, is what
  authorizes it) — this is a narrower check specifically for "am I allowed
  to answer this," layered next to, not replacing, the existing broader
  "am I allowed to view this team's results" check.
- Every one of these checks is re-derived server-side, from verified
  identity and Firestore state, on every request — never a client-supplied
  role, `teamId`, `accessMode`, or `surveyId` ownership claim (unchanged
  posture, `.claude/rules/security.md`).
