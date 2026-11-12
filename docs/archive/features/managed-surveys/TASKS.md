# Managed Surveys & Survey-Based Insights — Tasks

Specification: [SPEC.md](./SPEC.md)

## Status
Ready: 0  In Progress: 0  Done: 14

## Task graph

```mermaid
flowchart LR
    T1[TASK-001 survey domain/lifecycle]
    T2[TASK-002 createSurvey + surveys collection]
    T3[TASK-003 teamSurveyState + openSurvey]
    T4[TASK-004 closeSurvey]
    T5[TASK-005 resolveSurveyForParticipation]
    T6[TASK-006 submitSurveyResponse transaction]
    T7[TASK-007 /survey/[surveyId] route + UI]
    T8[TASK-008 sign-in continuation]
    T9[TASK-009 admin survey management]
    T10[TASK-010 team-page current-survey discovery]
    T11[TASK-011 survey-instance results/aggregation]
    T12[TASK-012 results/history UI]
    T13[TASK-013 Home/nav auth-aware cleanup]
    T14[TASK-014 retire old runtime + doc sync]

    T1 --> T2
    T1 --> T5
    T1 --> T6
    T2 --> T3
    T2 --> T5
    T2 --> T6
    T3 --> T4
    T5 --> T7
    T6 --> T7
    T7 --> T8
    T2 --> T9
    T3 --> T9
    T4 --> T9
    T2 --> T10
    T3 --> T10
    T4 --> T10
    T4 --> T11
    T6 --> T11
    T11 --> T12
    T10 --> T13
    T7 --> T14
    T8 --> T14
    T9 --> T14
    T10 --> T14
    T12 --> T14
    T13 --> T14
```

## Tasks

### TASK-001 — Survey domain: access mode, derived lifecycle, answer validation

**Status:** Done
**Covers:** BR-3, BR-4, BR-8, BR-9
**Depends on:** None

**Outcome**
A pure, framework-free domain module exists for the new `Survey` concept:
the canonical `Survey` persisted-document type, the `SurveyAccessMode`
type (plus a runtime validator for it and for the survey-creation input
shape), the `effectiveLifecycle(survey, now)` function (the single
authoritative derivation of `"scheduled" | "open" | "closed"` from
`openedAt`/`closedAt`/`endAt`, including `endAt`'s automatic/live
enforcement — per SPEC → "Survey lifecycle"), and the fixed three-question
1-5 answer validation (adapted from the existing `src/features/
pulse-survey/domain/validation.ts` shape, but survey-scoped rather than
team-selection-scoped — no `teamId` field, since `teamId` is never
client-supplied for the new model). Every later task imports this module
rather than re-deriving the `Survey` shape, lifecycle, or answer-shape
logic itself.

**Implementation notes**
- New feature root `src/features/surveys/domain/` per
  `.claude/rules/architecture.md`.
- The canonical `Survey` type mirrors SPEC's Firestore schema exactly:
  `{surveyId, teamId, title?, accessMode, startAt?, endAt?, openedAt?,
  closedAt?, archivedAt?, createdAt, createdBy}` — this is the one place
  the shape is declared; TASK-002 onward import it rather than inlining
  their own object-shape annotations for "a survey document."
- `SurveyAccessMode` gets a runtime validator (`isValidSurveyAccessMode`,
  mirroring the existing `isValidTeamStatus` fail-closed pattern —
  unrecognized/missing/malformed values return `false`, never throw) —
  TASK-002's creation input (accessMode required + valid; title optional
  string; `startAt`/`endAt` optional valid timestamps) is validated
  through this module, per `.claude/rules/typescript.md` ("validate
  untrusted runtime data before treating it as a TypeScript type").
- `effectiveLifecycle` takes only `{openedAt?, closedAt?, endAt?}` (a
  narrow slice of the full `Survey` type, not the whole entity — a
  function should only depend on the fields it actually uses) and `now`,
  matching the SPEC's exact derivation — `closed` if `closedAt` is set OR
  `endAt` has passed (this is `endAt`'s fully automatic/live enforcement,
  BR-8 — no separate "manual" variant of this rule exists anywhere); else
  `open` if `openedAt` is set; else `scheduled`. No `startAt` involvement
  (SPEC → "Why `status=open` with a future `startAt` is not a
  contradiction").
- No Firestore, no server-only import here — this module has no I/O and is
  reused identically by server operations (TASK-002 onward) and, if
  needed, admin/team UI display logic (never duplicated per-component).
- Answer validation: exactly 3 integers, 1-5, same rule as
  `pulse-survey/domain/validation.ts` — do not weaken or extend it.
- Do not touch `src/features/pulse-survey/` in this task — it is retired
  wholesale later (TASK-014), not incrementally edited now.

**Verification**
- `effectiveLifecycle`: every combination of set/unset `openedAt`/
  `closedAt`/`endAt` against a fixed `now`, including `endAt` in the past
  with `closedAt` unset (→ `closed`), `openedAt` set with a future
  `startAt`-shaped scenario not applicable (no `startAt` param at all,
  confirming it can't leak in), and `closedAt` set with `endAt` still in
  the future (`closedAt` wins, `closed`).
- `isValidSurveyAccessMode`: accepts exactly `"public"`/`"authenticated"`;
  rejects any other string, `undefined`, and non-string values, never
  throwing.
- Answer validation: valid 3×[1-5] accepted; out-of-range, wrong count,
  non-integer, missing field all rejected.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
No additional considerations — pure, no-I/O domain logic with no identity
or persistence involved.

**Documentation impact**
None expected yet (doc sync happens once the feature is fully built —
`docs/DATA-MODEL.md`/`docs/ARCHITECTURE.md` updates are TASK-014's job).

**Acceptance criteria**
- [x] `effectiveLifecycle` matches the SPEC's derivation for every
      documented case, including the `endAt`-wins-over-unset-`closedAt`
      case and the `startAt`-never-gates case.
- [x] Answer validation rejects every documented invalid shape.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/domain/survey.ts`: `SurveyAccessMode`,
  `isValidSurveyAccessMode`, `SurveyLifecycle`, `Survey`,
  `SurveyLifecycleFields`, `effectiveLifecycle`, and `isValidSurvey` (a
  fail-closed validator for a fully-hydrated candidate `Survey` object —
  callers map a raw Firestore document, `doc.id` → `surveyId` plus
  `Timestamp` fields → `Date`, into this candidate shape and validate it
  through `isValidSurvey` rather than an unchecked cast; this module has
  no Firestore dependency itself).
- `src/features/surveys/domain/create-survey-input.ts`:
  `CreateSurveyInput` + `validateCreateSurveyInput` — deliberately excludes
  `teamId` (the admin page's own route scope, resolved server-side by
  TASK-002, never part of this request-body shape). Accepts `startAt`/
  `endAt` as a `Date` instance or an ISO-8601-parseable string.
- `src/features/surveys/domain/answers.ts`: `SurveyAnswers` +
  `validateSurveyAnswers`, adapted from `pulse-survey/domain/validation.ts`
  with the `teamId` field removed (unchanged 3×[1-5] integer rule).
- **Deviation/decision not spelled out verbatim in SPEC**: SPEC doesn't
  state an explicit `startAt`/`endAt` ordering rule, but does list "invalid
  start/end combinations" as a required creation-time invariant. Added the
  minimal, uncontroversial rule implied by "an optional availability
  window": when both are present, `endAt` must be strictly after
  `startAt` (a zero/negative-length window is rejected). No other
  creation-time invariant beyond required+valid `accessMode` and
  optional-string `title` was found in SPEC, so none else was added.
- Tests: `survey.test.ts` (`isValidSurveyAccessMode`, `effectiveLifecycle`
  table-driven cases including the endAt boundary instant and the
  startAt-never-gates case, `isValidSurvey` including fail-closed
  malformed/mismatched-id/invalid-timestamp cases),
  `create-survey-input.test.ts`, `answers.test.ts` — 47 new tests total.
- Verification: `pnpm test` (797/797 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds) — all run after the change.
- No Firestore, persistence, API routes, UI, `teamSurveyState`,
  `SurveyResponse`/`SurveyParticipation`, or team-status checks were
  introduced — confirmed via `git status`/`git diff` inspection; only
  `src/features/surveys/domain/` is new.

---

### TASK-002 — `surveys` collection + `createSurvey` (admin-only)

**Status:** Done
**Covers:** BR-1, BR-2, BR-11, BR-34 (server-side half), BR-41 (creation half)
**Depends on:** TASK-001

**Outcome**
An app admin can create a survey for a specific `teamId` (access mode
required, title/`startAt`/`endAt` optional); the server assigns an opaque
Firestore-generated `surveyId`, persists a `surveys/{surveyId}` document in
the `scheduled` state, and returns the `surveyId`. Creation is rejected for
a non-admin caller and for a `disabled` team, regardless of what `teamId`
the client supplies — authorization and team-active status are both
re-verified server-side on every call, never trusted from the request.

**Implementation notes**
- New `src/features/surveys/server/create-survey.ts`, reusing
  `requireAppAdmin`/`isAppAdmin` (`src/features/teams/server/`) unchanged —
  do not re-implement admin checking.
- Validate the request body through TASK-001's `isValidSurveyAccessMode`
  plus a shape check for optional `title`/`startAt`/`endAt` before
  treating any of it as trusted input — reuse TASK-001's validators rather
  than re-implementing ad hoc checks here.
- Read the target team's `status` fresh (via the existing `teams` reads
  already used by `authorizeTeamAccess`/`list-teams`) before creating;
  reject if not `active` (SPEC → BR-41's creation clause).
- `surveys/{surveyId}`: `{teamId, title?, accessMode, startAt?, endAt?,
  createdAt, createdBy}` — no `openedAt`/`closedAt`/`archivedAt` field
  written at creation (all three start absent, per TASK-001's
  `effectiveLifecycle` reading "absent" as `scheduled`).
- `surveyId` = Firestore's auto-generated document ID (same scheme
  `teamId` already uses) — never client-supplied, never derived from
  `title`/`teamId`.
- Add an explicit `match /surveys/{document=**} { allow read, write: if
  false; }` block to `firestore.rules` (documentation/defense-in-depth
  parity with every existing collection — the catch-all already denies
  it). No new entry needed in `firestore.indexes.json` — querying `surveys`
  by `teamId` (later tasks) is a single-field, auto-indexed query.

**Verification**
- Server tests: non-admin caller rejected; admin caller succeeds and the
  persisted document has no `openedAt`/`closedAt`; `accessMode` and
  optional fields persist exactly as submitted; a client-supplied
  `surveyId`/lifecycle-shaped field in the request body is ignored, not
  trusted.
- A test asserting creation for a `disabled` team is rejected.
- A direct Firebase client-SDK read/write attempt against `surveys` is
  denied (Firestore rules test, mirroring the existing pattern for
  `teams`/`teamMemberships`).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
Establishes the `surveys` collection's server-only write boundary and the
team-active precondition (BR-41) at the very first write path — get this
solid before any later task builds on it (SPEC → "Team disable
semantics").

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] An app admin can create a survey; it persists `scheduled` with an
      opaque `surveyId`.
- [x] A non-admin caller cannot create a survey for any team.
- [x] Creating a survey for a `disabled` team is rejected.
- [x] `firestore.rules` denies client-SDK access to `surveys`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/server/create-survey.ts`: `createSurvey(idToken,
  teamId, input, deps)`. `teamId` is always the caller's trusted
  server/route scope — `CreateSurveyInput` (TASK-001) has no `teamId`
  field, so there is nothing in the request body that could override it;
  a `teamId`/`surveyId`/`createdBy`/lifecycle-shaped field present in
  `input` is simply never read.
- Order of checks: `requireAppAdmin` (reused unchanged) →
  `validateCreateSurveyInput` (TASK-001, reused unchanged) → fresh
  `teams/{teamId}.status` read, validated through `isValidTeamStatus`
  (TASK-001's `teams` domain module, reused unchanged) → persist. A
  missing team document and a malformed/unrecognized status both fail
  closed to `team_not_found` (mirrors `authorizeTeamAccess`'s treatment of
  the same field); a validly-read `"disabled"` status returns
  `team_disabled` — both reject before any Firestore write to `surveys`.
- `SurveyRecord` (persisted-only shape, no `surveyId` field — mirrors the
  existing `Team`/`TeamRecord` split): `{teamId, title?, accessMode,
  startAt?, endAt?, createdAt, createdBy}`. No `openedAt`/`closedAt`/
  `archivedAt` written at creation. `surveyId` = Firestore's
  auto-generated `.add()` document id. `createdAt` = `deps.now ?? new
  Date()`; `createdBy` = the verified admin's `uid` — both always
  server-derived, never taken from `input`.
- `firestore.rules`: added an explicit `match /surveys/{document=**} {
  allow read, write: if false; }` block (existing collections' blocks and
  the final catch-all are otherwise unchanged). Added a matching static
  assertion to `src/lib/firebase/firestore-deployment-config.test.ts`
  (the existing regex-based rules-shape test already used for
  `pulseSurveyResponses`) rather than an emulator-based rules test, since
  that is this repository's actual existing convention for verifying a
  collection's deny-all block.
- `firestore.indexes.json` unchanged — `createSurvey` only ever calls
  `.add()`, no query.
- Tests (`create-survey.test.ts`, 20 cases): admin success (minimal and
  fully-populated input), exact persisted shape assertion (including a
  negative check for `surveyId`/lifecycle fields and for
  respondent-identity/response-shaped fields), server-generated
  `surveyId` not derived from title/teamId, server-derived `createdBy`
  even when the request tries to supply one, `teamId`/`surveyId`/
  lifecycle-field injection attempts all ignored, unauthenticated/
  non-admin rejection (with zero writes and, for unauthenticated, zero
  team-status reads), non-object/invalid-`accessMode` input rejection
  (validated before any team-status read), valid future `startAt` alone,
  invalid `endAt <= startAt` ordering rejection, nonexistent-team and
  malformed-status-team rejection (`team_not_found`), disabled-team
  rejection (`team_disabled`), team-status-read failure and
  Firestore-write failure both mapping to `persistence_failed`, and no
  console logging on any path.
- Verification: `pnpm test` (818/818 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds, no new routes as expected).
- No deviation from SPEC/TASKS. Scope confirmed via `git status`/`git
  diff`: only `src/features/surveys/server/create-survey.{ts,test.ts}`,
  `firestore.rules` (additive), and the one new rules-shape test are new/
  changed — no `teamSurveyState`, `openSurvey`/`closeSurvey`,
  `SurveyResponse`/`SurveyParticipation`, routes, UI, or
  `firestore.indexes.json` changes were introduced.

---

### TASK-003 — `teamSurveyState` coordination + `openSurvey`

**Status:** Done
**Covers:** BR-5, BR-6, BR-41 (opening half)
**Depends on:** TASK-001, TASK-002

**Outcome**
An app admin can open a `scheduled` survey, moving it to `open`
(`openedAt` set to the server's own time). Opening is rejected if the
team already has another genuinely-open survey, enforced race-safely via
the `teamSurveyState/{teamId}` coordination document (SPEC → "One open
survey per team") rather than a query — two concurrent open attempts for
the same team can never both succeed. A stale `activeSurveyId` pointer
(left behind by a survey that auto-expired via `endAt` without an explicit
close) is self-corrected in the same transaction, not treated as a false
conflict. Opening is also rejected if the team is `disabled`.

**Implementation notes**
- New `src/features/surveys/server/open-survey.ts` and
  `src/features/surveys/domain/team-survey-state.ts` (or similar) for the
  `teamSurveyState` document shape/helpers.
- One Firestore transaction: read `teamSurveyState/{teamId}` (missing ⇒
  `activeSurveyId: null`); if set, read the referenced
  `surveys/{activeSurveyId}` and compute `effectiveLifecycle` — only a
  genuinely `open` result blocks the new open; a stale/expired pointer is
  overwritten, not treated as a conflict (SPEC → "`endAt` auto-expiry and
  stale-pointer recovery"). Re-check the target survey's own team is
  `active` in the same transaction (BR-41).
- Fail-closed on malformed/dangling state, mirroring the existing
  `isValidTeamStatus`/`isValidMembershipFor` convention (never trust
  unchecked Firestore data): if `activeSurveyId` is a non-`null`,
  non-string value, or references a `surveys` document that no longer
  exists (e.g. hard-deleted per TASK-009), treat it exactly like a missing
  pointer — no conflict, safe to overwrite — never throw and never block
  the open on an un-interpretable coordination document.
- `teamSurveyState/{teamId}`: `{activeSurveyId: string | null,
  updatedAt}`, deterministic ID = `teamId`. Add the same client-SDK deny
  block to `firestore.rules`. No composite index — a direct document get,
  never a query (SPEC → "Firestore/index implications").
- `teamSurveyState` is write-side coordination only — do not build any
  read path that trusts it as "the current survey" (that's TASK-010's
  job, which queries `surveys` by `teamId` directly).

**Verification**
- Server tests: opening a `scheduled` survey sets `openedAt`; opening
  while another survey for the same team is genuinely open is rejected;
  opening while the team is `disabled` is rejected.
- **Concurrency test**: two simulated concurrent `openSurvey` calls for
  two different `scheduled` surveys of the same team resolve to exactly
  one succeeding — never both, never neither (the SPEC's explicit
  admin-A/admin-B scenario).
- A test where `teamSurveyState.activeSurveyId` points at a survey whose
  `endAt` has since passed (but was never explicitly closed) — opening a
  different survey for that team succeeds, self-correcting the pointer.
- A test where `teamSurveyState.activeSurveyId` references a nonexistent
  survey document (dangling pointer) and a test with a malformed
  `activeSurveyId` value (non-string) — both fail closed to "no conflict,"
  never an unhandled error and never a false block.
- Firestore client-SDK denial test for `teamSurveyState`.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
This is the one-active-survey-per-team invariant's authoritative
enforcement point (SPEC review finding: "not a plain query"). Get the
concurrency test genuinely exercising two racing transactions (not just
two sequential calls) — a sequential-only test would not actually prove
the race-safety claim.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] Opening a `scheduled` survey succeeds and sets `openedAt`.
- [x] Opening while the team already has a genuinely open survey fails.
- [x] Two concurrent open attempts for the same team resolve to exactly
      one active survey.
- [x] A stale pointer to an `endAt`-expired survey never blocks a new open.
- [x] A dangling (nonexistent-survey) or malformed `activeSurveyId` fails
      closed to "no conflict," never an unhandled error.
- [x] Opening for a `disabled` team is rejected.
- [x] Firestore rules deny client-SDK access to `teamSurveyState`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/domain/team-survey-state.ts`: `TeamSurveyState`
  type (`{activeSurveyId: string | null, updatedAt: Date}`, no redundant
  `teamId` field — the deterministic document ID already is the `teamId`,
  per SPEC's exact persisted shape) and `readActiveSurveyId`, a fail-closed
  reader mirroring `isValidTeamStatus`/`isValidMembershipFor`'s
  "missing/malformed ⇒ no grant" convention: a missing document, a missing
  field, an explicit `null`, or any non-string/empty-string value all
  return `null` ("no active pointer"), never throwing.
- `src/features/surveys/server/open-survey.ts`: `openSurvey(idToken,
  teamId, surveyId, deps)`. `teamId` is always the caller's trusted
  route scope (mirrors `createSurvey`); the survey's own persisted
  `teamId` is cross-checked against it once fetched (`wrong_team` on
  mismatch), so a `surveyId` belonging to another team is rejected rather
  than silently acted on under the wrong scope.
- One Firestore transaction (via an injected minimal `OpenSurveyDb`/
  `OpenSurveyTransaction` seam — plain string document paths, not
  `DocumentReference`s, so a test fake never needs any `firebase-admin`
  dependency) performs, in order, with every read completed before any
  write (matching Firestore's own transaction requirement and letting a
  detected write conflict retry the whole decision with fresh reads):
  fetch + `isValidSurvey`-validate the target survey (fail-closed:
  nonexistent or malformed ⇒ `survey_not_found`, no distinguishing
  detail) → confirm `survey.teamId === teamId` (`wrong_team`) → confirm
  `effectiveLifecycle(survey, now) === "scheduled"` (`not_scheduled`
  otherwise — covers an already-open, already-closed, or archived-and-
  therefore-closed target survey, since `archivedAt` never participates
  in `effectiveLifecycle`) → re-read `teams/{teamId}.status` fresh via
  `isValidTeamStatus` (`team_not_found` / `team_disabled`) → read
  `teamSurveyState/{teamId}`'s `activeSurveyId` via `readActiveSurveyId`
  (fail-closed) → if set, fetch the referenced survey and re-derive *its*
  `effectiveLifecycle`; only a genuinely `"open"` result blocks the new
  open (`team_already_has_open_survey`) — a dangling pointer (no such
  survey), a malformed pointer, or a pointer to a survey that's since
  closed (explicitly or via passed `endAt`) is treated as no conflict and
  silently self-corrected in the same transaction, never a false block or
  a thrown error. On success: `tx.update(surveys/{surveyId},
  {openedAt: now})` and `tx.set(teamSurveyState/{teamId},
  {activeSurveyId: surveyId, updatedAt: now})`, both in the same
  transaction. `now`/the verified admin's identity are always
  server-derived (`deps.now ?? new Date()`, `requireAppAdmin`'s verified
  `uid` — unused in the persisted shape here since `teamSurveyState`/
  `surveys.openedAt` carry no audit-identity field per SPEC's exact
  schema); no client-supplied timestamp or lifecycle value is ever
  accepted.
- Concurrency guarantee: the production `getDefaultDb()` adapter wraps a
  real Firestore `Transaction` (`db.runTransaction`), which already
  provides Firestore's own optimistic-concurrency-with-automatic-retry
  behavior — this is what makes two concurrent `openSurvey` calls for the
  same team resolve to exactly one success, not a query-then-write
  approach (never implemented here).
- `firestore.rules`: added an explicit `match /teamSurveyState/{document=**}
  { allow read, write: if false; }` block, plus a matching static
  assertion in `src/lib/firebase/firestore-deployment-config.test.ts`
  (mirrors the existing `surveys`/`pulseSurveyResponses` pattern).
  `firestore.indexes.json` unchanged — the coordination check is a direct
  document `get`, never a query, exactly as SPEC's "Firestore/index
  implications" specifies.
- Tests (`open-survey.test.ts`, 17 cases) use an in-memory transactional
  Firestore fake (`createInMemoryFirestore`) that models real Firestore
  transaction semantics — every document read during an attempt is
  versioned, and a commit is rejected and the whole callback retried with
  fresh reads if any read document's version changed since (a concurrent
  transaction committed first) — rather than a fake that merely tracks
  "already written". The concurrency test launches two `openSurvey` calls
  for two different `scheduled` surveys of the same team via `Promise.all`
  against the *same* fake store: it asserts exactly one succeeds, the
  other fails with `team_already_has_open_survey`, exactly one survey
  document ends up with `openedAt` set, `teamSurveyState`'s pointer
  matches the winner, and — to prove a genuine conflict-and-retry
  occurred rather than two independent single-attempt transactions — that
  the fake recorded more transaction attempts than there were `openSurvey`
  calls (the losing call's first attempt genuinely reads the
  pre-conflict, "no active survey" state, matching the SPEC's exact
  admin-A/admin-B race scenario, and only its retry, seeing the winner's
  now-committed pointer, correctly rejects). Other cases: basic
  scheduled-survey open; rejection while another survey is genuinely
  open (no write attempted); stale-`endAt`-expired-pointer self-heal;
  dangling-pointer self-heal; malformed (non-string) `activeSurveyId`
  self-heal; disabled-team rejection; nonexistent/malformed-team-status
  fail-closed to `team_not_found`; nonexistent survey; malformed survey
  record (missing `createdAt`) fail-closed to `survey_not_found`;
  wrong-team rejection; already-open and already-closed target-survey
  rejection (`not_scheduled`); unauthenticated/non-admin rejection with
  zero transaction attempts; a thrown transaction error mapped to
  `persistence_failed` rather than propagating; no console logging on any
  path.
- Verification: `pnpm test` (836/836 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds, no new routes — expected,
  this task adds no route handler).
- No deviation from SPEC/TASKS. Scope confirmed via `git status`/`git
  diff`: only `src/features/surveys/domain/team-survey-state.ts`,
  `src/features/surveys/server/open-survey.{ts,test.ts}`,
  `firestore.rules` (additive), and the one new rules-shape test are
  new/changed for this task; `firestore.indexes.json` untouched; no
  `closeSurvey`, submission, `SurveyParticipation`/`SurveyResponse`,
  `/survey/[surveyId]`, UI, or aggregation code was introduced — TASK-004
  and later were not started.

**Post-review fix — cross-team coordination validation**
A `review-change` pass on this task found an Important gap: when
`teamSurveyState/{teamId}.activeSurveyId` names a structurally valid,
existing survey, `openSurvey` re-derived only its `effectiveLifecycle`
and never checked that the referenced survey's own `teamId` actually
matched the coordinating `teamId`. Since this document is only ever
written by `openSurvey` itself (always after confirming that exact
match), this state cannot arise from any current code path — but as the
sole serialization point for BR-6, it must still fail closed rather than
trust or silently repair inconsistent persisted data.

Fixed in `src/features/surveys/server/open-survey.ts`
(`decideAndApplyOpen`): once the referenced survey passes TASK-001's
`isValidSurvey`, its `teamId` is now compared against the coordinating
`teamId` *before* re-deriving its lifecycle. A mismatch returns a new
`"invalid_coordination_state"` outcome immediately — no write of any
kind occurs (the requested survey is never opened, the coordination
pointer is neither cleared nor repointed, neither survey document is
touched). This is deliberately **not** treated as "no conflict, self-heal"
(unlike a genuinely dangling or malformed pointer, which remains
unchanged and still self-heals exactly as before) — a well-formed
cross-team reference is a positive signal of coordination-state
corruption, not an absence of information, so silently overwriting it
would erase evidence of that corruption rather than surface it.

Two tests added to `open-survey.test.ts` (19 cases total, up from 17):
a cross-team `activeSurveyId` pointing at another team's genuinely-open
survey rejects with `invalid_coordination_state` and commits zero writes
(asserted via a new `totalCommittedWrites` counter on the in-memory
transactional fake, not just via the returned error); and the same
rejection holds when the wrongly-referenced survey is merely `scheduled`
(not open) for its own team, proving the mismatch itself — not the
referenced survey's lifecycle — is what triggers the failure. All
pre-existing dangling-pointer, malformed-(non-string)-pointer,
same-team-open-conflict, and concurrency tests were re-run unchanged and
continue to pass, confirming self-heal behavior and one-open-survey-per-
team transaction serialization are unaffected.

Verification re-run after the fix: `pnpm test` (838/838 passed),
`pnpm typecheck` (clean), `pnpm lint` (clean), `pnpm build` (succeeds, no
new routes). `firestore.indexes.json` unchanged; `firestore.rules`
unchanged by this fix (no new collection introduced). No TASK-004+ file
or behavior was introduced.

---

### TASK-004 — `closeSurvey`

**Status:** Done
**Covers:** BR-7
**Depends on:** TASK-001, TASK-002, TASK-003

**Outcome**
An app admin can explicitly close an `open` survey at any time (even
before a set `endAt`), setting `closedAt` to the server's current time.
Closing is idempotent (a second close is a no-op, not an error) and
terminal (no reopen action exists anywhere in this feature). Closing also
clears a matching `teamSurveyState.activeSurveyId` pointer in the same
transaction.

**Implementation notes**
- New `src/features/surveys/server/close-survey.ts`.
- One Firestore transaction: set `closedAt = now` (skip if already set —
  idempotency, not an error); if `teamSurveyState/{teamId}.activeSurveyId`
  currently equals this `surveyId`, clear it to `null` in the same
  transaction (defensive no-op otherwise — SPEC → "Close").
- No "reopen" operation is implemented anywhere by this or any later task
  (SPEC Non-goals) — do not add one speculatively.
- `endAt`'s *automatic* closing effect needs no code here at all — it's
  already fully handled by TASK-001's `effectiveLifecycle`, recomputed
  live wherever it's read (this task only implements the *manual* close
  action).

**Verification**
- Server tests: closing an `open` survey sets `closedAt`; closing an
  already-closed survey is a no-op, not an error; closing clears a
  matching `teamSurveyState` pointer and leaves a non-matching one
  untouched.
- No reopen operation exists (a negative test/type-level check that no
  such function is exported).
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
No additional considerations beyond what TASK-002/003 already established
— this task only adds the manual-close half of an already-designed
mechanism.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] Closing an open survey sets `closedAt` and stops it being answerable
      (verified once TASK-006 exists; this task verifies the persisted
      state and pointer-clearing in isolation).
- [x] Closing twice is idempotent.
- [x] A matching `teamSurveyState` pointer is cleared on close.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/server/close-survey.ts`: `closeSurvey(idToken,
  surveyId, deps)`. Deliberately takes **no `teamId` parameter** — unlike
  `createSurvey`/`openSurvey`, which are scoped to a trusted route
  `teamId`, `closeSurvey` derives `teamId` solely from the fetched,
  validated survey record (`survey.teamId`), since there is no admin-page
  route context that needs to pre-scope a close action and no request-body
  value to ever mistakenly trust instead (satisfies "derive `teamId` from
  the persisted survey, never from untrusted request-body data").
- One Firestore transaction (`decideAndApplyClose`, via the same
  path-string-keyed `CloseSurveyDb`/`CloseSurveyTransaction` seam pattern
  `open-survey.ts` established — a local, per-operation interface, not a
  new shared abstraction), in order: fetch + `isValidSurvey`-validate the
  target survey (fail-closed: nonexistent or malformed ⇒
  `survey_not_found`) → compute `effectiveLifecycle(survey, now)` →
  `"scheduled"` ⇒ reject `not_open` (a survey that was never opened has no
  "open → closed" transition to perform; not treated as idempotent) →
  `"open"` ⇒ `tx.update(surveys/{surveyId}, {closedAt: now})` → read
  `teamSurveyState/{survey.teamId}`'s `activeSurveyId` (TASK-003's
  `readActiveSurveyId`, reused unchanged) and, only if it equals exactly
  this `surveyId`, `tx.set(teamSurveyState/{survey.teamId},
  {activeSurveyId: null, updatedAt: now})` — a defensive no-op for every
  other value (`null`, a different survey's id, or a dangling/malformed
  pointer), never repaired or reinterpreted. Both writes (survey +
  coordination) happen in the same transaction, so there is no window where
  one commits without the other.
- **Idempotency is derived from `effectiveLifecycle`, not the raw
  `closedAt` field** — a deliberate, documented decision beyond this task's
  literal "skip if already set" phrasing: a survey whose `endAt` has passed
  but whose `closedAt` was never explicitly written is *already*
  `effectiveLifecycle === "closed"` (BR-9), so `closeSurvey` treats it as
  idempotent exactly like an explicitly-closed survey — it does **not**
  write `closedAt = now` in that case. Writing `now` there would record a
  later, inaccurate instant than when the survey actually stopped being
  answerable, which is exactly what SPEC's "Sorting/display date" section
  warns against for the equivalent lazy-backfill case; that backfill
  (`closedAt = endAt`) is explicitly framed there as a *read*-path concern
  for whichever later task implements it (likely TASK-011), so it is not
  implemented here — out of scope for a manual close action. In both the
  explicitly-closed and closed-via-`endAt` cases, the coordination-pointer
  check/clear step still runs (self-heal), so a repeat `closeSurvey` call
  can still correct a stale pointer left over from an earlier bug or a
  survey that auto-expired before anyone ever called `closeSurvey` on it.
- **Coordination validation is a pure string-equality check, not a
  re-derivation** — a deliberate, simpler design than `openSurvey`'s: since
  `closeSurvey` already has the exact survey being closed (fetched and
  validated as belonging to `survey.teamId`), an `activeSurveyId` that
  equals its `surveyId` can only ever legitimately name this same survey —
  there is no cross-team ambiguity to interpret the way `openSurvey` must
  resolve for a *different* referenced survey. So every non-matching value
  (`null`, another survey's id, a malformed non-string value, or a dangling
  id referencing no document) is uniformly a no-op, and none of them are
  ever fetched, reinterpreted, or "repaired" — satisfying "fail closed on
  malformed/inconsistent coordination state" and "do not silently repair
  ambiguous/corrupt cross-team state" without needing a distinct
  `invalid_coordination_state` outcome the way TASK-003's post-review fix
  needed for `openSurvey`.
- **No `closedBy`/audit field is written** — TASK-001's canonical `Survey`
  schema (`src/features/surveys/domain/survey.ts`) has no such field; one
  was not added, since the approved schema is the authority here and this
  task does not change it. The verified admin identity is still required to
  reach the transaction at all (via `requireAppAdmin`), just not persisted.
- **Closing is not gated on the owning team's `active` status** — a
  deliberate reading of SPEC's "Team disable semantics," confirmed against
  BR-41/BR-42: those sections state the creation/opening precondition
  explicitly ("Creating or opening a survey for a `disabled` team is
  rejected") and separately state that disabling a team affects only
  *answerability*, never stored lifecycle state — closing is neither
  "opening" nor "answering," and an admin must still be able to close an
  already-open survey for a team they've since disabled (administrative
  cleanup). No `teams/{teamId}` read of any kind occurs in this
  transaction — confirmed by a test closing a survey whose team is
  `disabled`.
- `firestore.rules`/`firestore.indexes.json`: unchanged by this task — both
  `surveys` and `teamSurveyState` already carry their deny-all client-SDK
  blocks from TASK-002/TASK-003 (the `teamSurveyState` rule comment already
  anticipated "read and written exclusively inside openSurvey's/
  closeSurvey's Firestore transactions"), and `closeSurvey` performs only
  direct document `get`/`update`/`set` calls, never a query — no composite
  index was needed or added.
- Tests (`close-survey.test.ts`, 20 cases): open → closed success;
  matching/non-matching/null/malformed/dangling `teamSurveyState` pointer
  handling (each its own case, including a case proving another team's
  `teamSurveyState` document is never read or written); idempotent
  already-explicitly-closed (closedAt unchanged) with and without a stale
  pointer to self-heal; idempotent closed-via-`endAt`-only (closedAt stays
  unset, never backfilled to `now`, pointer still cleared); rejection of a
  `scheduled` (never-opened) survey (`not_open`, zero writes); missing and
  malformed survey (`survey_not_found`); closing a `disabled`-team's survey
  still succeeds; unauthenticated/non-admin rejection with zero transaction
  attempts; a thrown transaction error mapped to `persistence_failed`; no
  console logging on any path; a check that no `reopenSurvey`-shaped export
  exists. **Concurrency test**: `closeSurvey(survey-1)` raced against
  `openSurvey(team-42, survey-2)` via `Promise.all` against one shared
  in-memory transactional fake (the same versioned-optimistic-concurrency
  fake `open-survey.test.ts` uses — `CloseSurveyDb`/`OpenSurveyTransaction`
  are structurally identical, so one fake store satisfies both), proving
  both operations serialize against the same `teamSurveyState/team-42`
  document: regardless of which interleaving wins, the close always
  succeeds, the coordination pointer never ends up pointing at the
  now-closed `survey-1`, and `totalAttempts` exceeds the number of calls
  (proving a genuine conflict-and-retry, not two independent
  single-attempt transactions).
- Verification: `pnpm test` (858/858 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds, no new routes — expected,
  this task adds no route handler).
- No deviation from SPEC beyond the two explicitly-documented decisions
  above (effectiveLifecycle-based idempotency; no team-status gate on
  close). Scope confirmed via `git status`/`git diff`: only
  `src/features/surveys/server/close-survey.{ts,test.ts}` are new for this
  task; `firestore.rules`/`firestore.indexes.json` untouched by this task
  (their working-tree diffs predate it, from TASK-002/003); no
  `resolveSurveyForParticipation`, submission, `/survey/[surveyId]`, admin
  UI, or results/history code was introduced — TASK-005 and later remain
  `Ready`/untouched.

**Post-review test hardening**
- Addressed a review Suggestion on atomicity test rigor: added a regression
  test to `close-survey.test.ts` proving the `closedAt` write and the
  `teamSurveyState` pointer-clear commit as one atomic transaction, not two
  independent writes. Reuses the existing in-memory transactional fake,
  instrumented only to record each committed transaction attempt's write
  paths (`commits: string[][]`); asserts exactly one commit touched either
  path and that it contains both. Verified to genuinely fail against a
  spiked two-`runTransaction` version of `closeSurvey` (reverted after
  confirming). No production code changed; TASK-005+ untouched.

**Post-`Done` debug fix — real Firestore read-before-write ordering**
While implementing TASK-006, `decideAndApplyClose` was found to call
`tx.update(surveyPath(surveyId), {closedAt: now})` *before* the later
`tx.get(teamSurveyStatePath(survey.teamId))` within the same transaction
attempt. Real Firestore transactions require every read to execute before
any write in a single attempt; the in-memory test fake didn't enforce that
rule, so this passed every existing test while a live Firestore backend
would have thrown.

Fixed in `src/features/surveys/server/close-survey.ts` by reordering
`decideAndApplyClose` into an explicit read phase (fetch + validate the
survey; if its lifecycle isn't `scheduled`, also fetch
`teamSurveyState/{teamId}`), a decision phase (compute `shouldSetClosedAt`
and `shouldClearPointer` from data already in hand, touching Firestore
nowhere), then a write phase (apply `closedAt` and/or the pointer-clear
only after every read above has completed). No lifecycle, authorization,
result/error, or coordination-cleanup semantics changed — the `scheduled`
→ `not_open`/zero-writes case, the idempotent explicitly-closed and
`endAt`-closed cases (no `closedAt` rewrite, no backfill), every
non-matching/null/malformed/dangling pointer case, and the disabled-team
close-still-allowed case are all identical to before, and every pre-existing
test (including the atomic two-write test and the `openSurvey`-vs-
`closeSurvey` concurrency test above) continues to pass unchanged.

`close-survey.test.ts`'s in-memory fake was hardened so its `tx.get` now
throws (mirroring real Firestore's own error) if any write has already
been staged in the current attempt — this is what actually would have
caught the original defect, not just a source-order read. Two tests were
added: one confirming `closeSurvey`'s real read/write ordering now passes
cleanly against this stricter fake, and one exercising the fake's guard
directly with the exact write-then-read shape of the original bug,
confirming it throws — proof the hardened fake would have failed the
pre-fix code, not merely that the current code happens to pass.

Verification re-run after the fix: `pnpm test` (928/928 passed),
`pnpm typecheck` (clean), `pnpm lint` (clean), `pnpm build` (succeeds, no
new routes). `firestore.rules`/`firestore.indexes.json` unchanged by this
fix. `openSurvey`/`submitSurveyResponse` and their tests re-run unchanged
and unaffected (54/54 passed together). No TASK-007+ file or behavior was
introduced; TASK-004 remains `Done`, TASK-006 remains `Done`, TASK-007
remains `Ready`.

---

### TASK-005 — `resolveSurveyForParticipation` (public + authenticated read)

**Status:** Done
**Covers:** BR-10, BR-12, BR-13, BR-14, BR-15, BR-16 (read half), BR-19 (read half), BR-41 (discovery half)
**Depends on:** TASK-001, TASK-002

**Outcome**
A single server operation resolves everything `/survey/{surveyId}` needs
to decide what to render, for both access modes, from `surveyId` and an
optional caller identity: not-found, not-yet-started, closed,
sign-in-required (`authenticated`, signed out), forbidden (`authenticated`,
signed in but not an actual team member), or answerable (with the safe
metadata approved for exposure — title, team name, lifecycle/availability,
access mode — and nothing else). Public and authenticated modes share one
code path up to the point their authorization requirements diverge, per
SPEC → "share as much... logic as possible."

**Implementation notes**
- New `src/features/surveys/server/resolve-survey-for-participation.ts`.
- Resolve the survey; nonexistent → not-found (no distinguishing detail
  between never-existed/mistyped/deleted).
- Compute `effectiveLifecycle` (TASK-001) and re-check the owning team's
  `active` status (reuse the existing team-status read seam) — a
  `disabled` team's survey resolves the same as an unanswerable one
  (BR-41), never as a distinct "team disabled" signal to the caller.
- For `public`: no identity check — safe metadata + lifecycle state is
  always returned once the survey/team checks above pass.
- For `authenticated`: no identity → return exactly "sign in required,"
  no title/team-name/lifecycle (BR-13 — this is the one branch that must
  *not* share the "return safe metadata" path with `public`, since nothing
  is safe to reveal pre-auth here). With identity → verify the Firebase ID
  token and check an actual `teamMemberships` record (BR-16) for the
  survey's `teamId` (resolved from the survey record only, never a
  client-supplied value) — not authorized → forbidden, revealing nothing
  beyond what step 3 already would have; authorized → same safe metadata
  as `public`.
- Never include `createdBy`, `archivedAt`, or any `teamSurveyState`
  reference in the returned shape, for either access mode or outcome
  (SPEC → "Response minimization, made explicit").
- This task does not render anything — it is the server contract
  TASK-007 consumes.

**Verification**
- Server tests, one boundary, both access modes: not-found; `scheduled`;
  `closed` (including `endAt`-expired-but-`closedAt`-unset); `disabled`
  team (both modes; verify it resolves identically to unanswerable, not
  as a distinguishable "team disabled" signal); `public` + `open` →
  answerable with exactly the approved fields; `authenticated` + signed
  out → sign-in-required only, asserting the response contains no
  title/team-name/lifecycle field; `authenticated` + signed in +
  non-member → forbidden; `authenticated` + signed in + actual member +
  `open` → answerable; `authenticated` + app-admin-only (no membership) →
  forbidden (BR-16 regression).
- Cross-team regression: an identity authorized for Team A's surveys
  cannot resolve Team B's `authenticated` survey as answerable.
- Archived-survey regression: a survey with `archivedAt` set resolves
  identically to a plain `closed` survey (no distinguishing "archived"
  outcome) — `effectiveLifecycle` never reads `archivedAt` at all, so
  there is no separate code path to diverge here; this test exists to
  keep that guarantee from silently regressing later.
- A test asserting the returned shape never contains `createdBy`,
  `archivedAt`, or a `teamSurveyState`-shaped field under any outcome.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
This is the read-side authorization boundary the public route
(TASK-007) will render from directly — no client-supplied `teamId`,
`uid`, `accessMode`, or role is ever trusted; every decision is re-derived
from the survey record and verified identity. Get the "signed-out
authenticated survey reveals nothing" case and the "app-admin alone is
insufficient" case solid here, since TASK-007 will not re-derive
authorization itself.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] Every documented outcome (not-found/scheduled/closed/sign-in-
      required/forbidden/answerable) is produced correctly for both
      access modes.
- [x] A signed-out visitor to an `authenticated` survey never receives
      title/team-name/lifecycle data.
- [x] An app admin with no membership resolves as forbidden for an
      `authenticated` survey of a team they don't belong to.
- [x] A `disabled` team's survey never resolves as answerable, for either
      access mode.
- [x] The returned shape never includes `createdBy`, `archivedAt`, or
      `teamSurveyState` data.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/server/resolve-survey-for-participation.ts`:
  `resolveSurveyForParticipation(surveyId, idToken, deps)`. Accepts no
  `teamId`/`accessMode` parameter at all — both are derived exclusively
  from the fetched, `isValidSurvey`-validated survey record (reusing
  TASK-001's `isValidSurvey`/`effectiveLifecycle` unchanged), so there is
  nothing in the call signature a caller could use to override them.
- Outcome shape mirrors `authorizeTeamAccess`'s "never collapse an
  infrastructure failure into an authorization decision" convention:
  `{ok: true, status: "not_found" | "sign_in_required" | "forbidden"}` (no
  `survey` payload — nothing safe to attach) or `{ok: true, status:
  "scheduled" | "closed" | "answerable", survey: SafeSurveyParticipationView}`
  (`{surveyId, title?, teamName?}` — deliberately no `accessMode` field:
  every rendering distinction TASK-007 needs is already carried by
  `status` itself, so exposing `accessMode` separately would be the "only
  if the client genuinely needs it" case SPEC allows but doesn't require,
  and this task found no such need) or `{ok: false, error: "read_failed"}`
  for a thrown Firestore read at any step.
- Order of operations, matching the SPEC's own divergence point: fetch +
  validate the survey (invalid/missing → `not_found`, before anything
  access-mode-specific) → if `accessMode === "authenticated"`: no token or
  a token that fails `verifyIdToken` (invalid/expired/revoked) →
  `sign_in_required` immediately, with **zero** team/membership reads (see
  privacy test asserting `calls.team === 0`/`calls.membership === 0`) —
  this is the one branch that does not share the "resolve team + lifecycle"
  path with `public`, per SPEC's explicit callout. A verified identity is
  then checked against `teamMemberships/{uid}__{teamId}` — **not**
  `authorizeTeamAccess`, whose `"admin"` result would incorrectly grant an
  app-admin-without-membership eligibility to participate (BR-16, the
  exact pitfall the task brief called out) — not an actual member →
  `forbidden`, again with zero team-status/name read. Only once a caller is
  authorized (unconditionally for `public`, or an actual member for
  `authenticated`) is `teams/{teamId}` read at all, to compute
  `{active, name}` fail-closed (`resolveTeamContext`: a missing document, a
  missing/malformed `status`, or any status other than `"active"` all
  collapse to `active: false`, uniformly with a validly-read `"disabled"` —
  never a distinguishable signal, per BR-41/"Team disable semantics"; a
  missing/malformed `name` field similarly omits `teamName` from the DTO
  rather than fabricating one).
- Availability derivation (`deriveAvailability`): `"scheduled"` if
  `effectiveLifecycle` is `"scheduled"` (team status is irrelevant — it was
  never answerable regardless); `"answerable"` only if `"open"` **and**
  `team.active`; `"closed"` for every other combination — this is also
  where an `open`-lifecycle survey whose team is disabled/missing/malformed
  lands, deliberately in the same bucket as a genuinely `closed` survey (a
  test asserts a disabled-team result and an explicitly-closed result
  produce the identical `status`, proving no distinguishable "team
  disabled" signal exists).
- `SafeSurveyParticipationView` never includes `createdBy`, `archivedAt`,
  `accessMode`, or anything `teamSurveyState`-shaped — confirmed by an
  archived-survey test (resolves identically to a plain closed survey, with
  no `archivedAt` on the DTO) and a dedicated privacy test asserting the
  serialized DTO never contains the survey's `createdBy` value or the
  caller's own `uid`.
- Tests (`resolve-survey-for-participation.test.ts`, 30 cases): general
  (valid public/authenticated-member open survey resolves; unknown
  `surveyId` never resolves survey data; minimal-DTO key-set assertion);
  public (no token required; membership never checked even if a token is
  supplied; only approved fields exposed, explicitly asserting the absence
  of response-count/results/admin/member-shaped properties); authenticated
  (signed-out → `sign_in_required` with zero team/membership reads and no
  extra response keys; non-member → `forbidden`; app-admin-without-
  membership → `forbidden`, BR-16 regression; wrong-team membership →
  `forbidden`; cross-team regression — Team A membership cannot resolve
  Team B's survey; invalid/revoked token → `sign_in_required`); lifecycle
  (scheduled; open→answerable; exactly-at-`endAt` boundary→closed;
  after-`endAt`-with-`closedAt`-unset→closed; explicitly closed; archived-
  but-closed→identical to plain closed, no `archivedAt` leak); team status
  (active→answerable; disabled→closed, both access modes; missing team
  document→fails closed to closed with `teamName` omitted; malformed
  `status` field→fails closed; disabled-vs-explicitly-closed produce the
  same `status`); persistence/read failure (survey/team/membership read
  failure each map to `{ok: false, error: "read_failed"}`, never the raw
  error); privacy (no `createdBy`/`teamSurveyState`/respondent-uid in the
  serialized DTO; no `APP_ADMIN_EMAILS`-derived value leaked in a
  `forbidden` result).
- Verification: `pnpm test` (889/889 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds, no new routes — expected,
  this task adds no route handler or UI).
- No deviation from SPEC/TASKS. Scope confirmed via `git status`/`git
  diff`: only `src/features/surveys/server/resolve-survey-for-
  participation.{ts,test.ts}` are new for this task; `firestore.rules`/
  `firestore.indexes.json` untouched by this task (their working-tree
  diffs predate it, from TASK-002/003); no `submitSurveyResponse`,
  `SurveyResponse`/`SurveyParticipation` persistence, `/survey/[surveyId]`
  route/UI, or any TASK-006+ behavior was introduced.

---

### TASK-006 — Survey submission transaction (`submitSurveyResponse`)

**Status:** Done
**Covers:** BR-17, BR-18, BR-19, BR-20, BR-21, BR-22, BR-23, BR-24, BR-41 (submission half)
**Depends on:** TASK-001, TASK-002

**Outcome**
A respondent (anonymous for `public`, authenticated-and-actually-a-member
for `authenticated`) can submit the fixed three-question answer set to an
`open` survey. The entire authorization/lifecycle/dedup decision and both
writes happen inside one Firestore transaction, re-reading all state
fresh at commit time (SPEC → "Survey submission contract," Phase A/Phase
B). `SurveyResponse` never contains any identity field; for `authenticated`
mode, a `SurveyParticipation` record is written in the same transaction to
prevent a second accepted submission from the same identity, sharing no
field with the response it accompanies.

**Implementation notes**
- New `src/features/surveys/server/submit-survey-response.ts`.
- Phase A (outside the transaction, no persistence side effect): validate
  the three answers (TASK-001); if a token is present, verify it
  (identity only — authorization is re-checked inside the transaction).
- Phase B (one Firestore transaction): re-read the survey fresh; compute
  `effectiveLifecycle`; not `open` → abort. Re-read the owning team's
  `status` fresh; not `active` → abort (BR-41). For `public`: proceed. For
  `authenticated`: re-read `teamMemberships/{uid}__{teamId}` fresh (not an
  actual member → abort, forbidden); re-read
  `surveyParticipations/{uid}__{surveyId}` fresh (exists → abort,
  "already submitted"). Encrypt (reuse
  `src/lib/encryption/encryption.ts` unchanged — do not redesign or
  re-implement encryption) inside the transaction, immediately before the
  write, with a fresh IV. Write `surveyResponses/{random id}` and, for
  `authenticated`, `surveyParticipations/{uid}__{surveyId}` — both in the
  same transaction, no partial-success path to handle.
- `surveyResponses/{responseId}`: `{surveyId, teamId, ciphertext, iv,
  authTag, keyVersion, submittedAt}` — no identity field, no IP, no user
  agent. `surveyParticipations/{uid}__{surveyId}`: `{uid, surveyId}` only
  — **no `submittedAt`** (SPEC → "Consistency vs. unlinkability
  tradeoff" — this is deliberate, not an oversight; do not add it back for
  convenience).
- Add the same client-SDK deny block to `firestore.rules` for both
  `surveyResponses` and `surveyParticipations`. No composite index for
  either (single-field/direct-get reads only).
- Response payload: success/failure only — never the generated
  `SurveyResponse` or `SurveyParticipation` document ID (SPEC → step 10).
- Do not log a `uid` and a generated response ID together in the same log
  entry, on any path, including failure/duplicate-rejection paths (SPEC →
  "Security and privacy" → Invariant 14 addendum).

**Verification**
- Server tests: valid `public` submission persists a `SurveyResponse` with
  no identity field; valid `authenticated` submission persists both
  documents with no shared field between them; a second `authenticated`
  submission from the same `uid` for the same survey is rejected; a
  `public` survey accepts unlimited repeat submissions (explicit
  regression: "anonymous public mode does not promise deduplication").
- Rejections: non-`open` lifecycle (including `endAt`-expired); `disabled`
  team; `authenticated` submission with a valid token but no actual
  membership (including an app-admin-only identity — explicit BR-16
  regression); a client-supplied `teamId`/`accessMode` in the request body
  is ignored, never trusted.
- **Race tests** (using the in-memory transactional fake, not real
  Firestore — simulate concurrent state changes between this
  transaction's read and commit), each its own named scenario: a
  submission racing a concurrent explicit close never commits; a
  submission racing `endAt` passing mid-flight (a passive, time-based
  transition rather than a concurrent write — a distinct trigger even
  though it exercises the same `effectiveLifecycle` recomputation) never
  commits; a submission racing the owning team being disabled mid-flight
  never commits; a submission racing a concurrent membership removal
  never commits; two simultaneous submissions from the same authenticated
  `uid` never both succeed.
- **Retry/timeout test**: simulate a successful commit whose response was
  lost in transit (client never saw success) followed by a client retry
  with the same answers — for `authenticated` mode, the retry is rejected
  as a duplicate (finds the already-created `SurveyParticipation`), never
  creating a second `SurveyResponse`.
- A test asserting no persisted `SurveyResponse` or `SurveyParticipation`
  ever contains `uid`, `email`, or any other identity field beyond the
  intentional `uid` on `SurveyParticipation` itself, and that no response
  payload ever returns a generated document ID.
- A direct Firebase client-SDK read/write attempt against
  `surveyResponses`/`surveyParticipations` is denied.
- `pnpm lint`, `pnpm typecheck`.

**Security / privacy**
This is the highest-priority write path in the feature (SPEC → "Consistency
vs. unlinkability tradeoff"). The race tests above are not optional
polish — they are the actual proof that the submit-vs-close,
membership-revocation, and duplicate-submission races are closed by
construction, not by convention. Reuse the existing encryption primitives
exactly as-is; do not introduce a new key-management approach or
plaintext fallback path.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] A valid submission to an `open` survey succeeds for both access
      modes, encrypting the answers with the existing encryption boundary.
- [x] `SurveyResponse` never contains `uid`, `email`, or any identity
      field, for either access mode.
- [x] A second `authenticated` submission from the same identity for the
      same survey is rejected; `public` submissions are never deduplicated.
- [x] A submission to a non-`open` survey, a `disabled` team's survey, or
      from a non-member `authenticated` identity (app-admin-only included)
      is rejected.
- [x] The submit-vs-close race, the `endAt`-crossing-mid-flight race, the
      team-disabled-mid-flight race, the membership-revocation race, and
      the duplicate-submission race are each covered by a named test
      proving they cannot commit against stale state.
- [x] A retry after a lost-in-transit successful commit never creates a
      second `authenticated` response.
- [x] No response payload or log entry ever pairs a `uid` with a generated
      document ID.
- [x] Firestore rules deny client-SDK access to both new collections.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/domain/survey-participation.ts`: `SurveyParticipationRecord`
  (`{uid, surveyId}`) and `participationDocId(uid, surveyId)` — a
  deterministic `{uid}__{surveyId}` id, mirroring `teamMemberships`'s own
  `membershipDocId` scheme, so the duplicate check is a direct document
  get/create needing no query or composite index.
- `src/features/surveys/server/submit-survey-response.ts`:
  `submitSurveyResponse(surveyId, rawAnswers, idToken, deps)`. Accepts no
  `teamId`/`accessMode`/`uid`/`role` parameter at all — both `teamId` and
  `accessMode` are read exclusively from the survey document fetched fresh
  inside the transaction.
- **Phase A** (outside the transaction, no persistence side effect):
  `validateSurveyAnswers` (TASK-001, reused unchanged) — invalid →
  `invalid_submission`, nothing read/written. If `idToken` is present,
  `verifyIdToken` is called for identity only; an invalid/revoked token
  yields `identity: null`, treated identically to no token at all (mirrors
  `resolveSurveyForParticipation`'s same precedent) — authorization itself
  is always decided in Phase B, never here.
- **Phase B** (`decideAndApplySubmission`, one Firestore transaction, all
  reads before any write — required by real Firestore transactions and
  what lets a detected conflict retry the whole decision with fresh reads):
  fetch + `isValidSurvey`-validate the survey (nonexistent/malformed →
  `invalid_submission`, no distinguishing detail, mirroring Phase 1's
  `submitPulseSurvey` posture) → `effectiveLifecycle(survey, now) !==
  "open"` → `survey_unavailable` → fresh `teams/{teamId}.status` read,
  `isValidTeamStatus`-validated; anything other than a validly-read
  `"active"` (disabled, missing, or malformed) also → `survey_unavailable`
  — deliberately the same single bucket as a non-open lifecycle, so a
  disabled/missing/malformed owning team is never a distinguishable signal
  from an ordinary closed survey (BR-41, mirroring TASK-005's identical
  fold) → for `public`: proceed directly to encryption; for
  `authenticated`: `identity === null` → `unauthenticated`; fresh
  `teamMemberships/{uid}__{teamId}` read validated via
  `isValidMembershipFor` (never `authorizeTeamAccess`, so an app-admin
  identity with no real membership is `forbidden` exactly like any other
  non-member — BR-16) → not an actual member → `forbidden`; fresh
  `surveyParticipations/{uid}__{surveyId}` existence check → exists →
  `already_submitted`. Only after every read passes: `encrypt()` (reused
  unchanged from `src/lib/encryption/encryption.ts`, fresh IV per attempt)
  → write `surveyResponses/{random id}` (id from `db.newResponseId()`,
  Firestore's own auto-generated id, never derived from `uid`/`surveyId`)
  and, for `authenticated` only, `surveyParticipations/{uid}__{surveyId}`
  — both `tx.set` calls in the same transaction, so they commit together
  or neither does.
- **Persisted shapes, exactly as approved**:
  `surveyResponses/{responseId}`: `{surveyId, teamId, ciphertext, iv,
  authTag, keyVersion, submittedAt}` — no `uid`/`email`/any identity field,
  for either access mode. `surveyParticipations/{uid}__{surveyId}`:
  `{uid, surveyId}` only — no `submittedAt`, no `responseId`, no field
  joining it to the response it accompanied (BR-18); confirmed by a test
  asserting the response and participation records share no key besides
  `surveyId` itself.
- **Duplicate-prevention/atomicity**: the participation existence check and
  both writes happen in the same transaction, so Firestore serializes any
  two conflicting attempts against the shared
  `surveyParticipations/{uid}__{surveyId}` document — exactly one commits;
  the other's retry re-reads and finds the just-created participation,
  rejecting as `already_submitted`. This provides strict exactly-once
  *acceptance* per (uid, surveyId) — not a claim of exactly-once *delivery*
  to the client: a client that retries after an uncertain network result
  (its own successful commit's response was lost in transit) finds its own
  already-created participation and is correctly rejected as a duplicate,
  never creating a second response (tested explicitly, distinct from the
  true-concurrency test).
- **Race safety**: submit-vs-close, team-disabled-mid-flight, and
  membership-removal-mid-flight are each proven with a genuine in-memory
  transactional fake (`open-survey.test.ts`/`close-survey.test.ts`'s own
  versioned-optimistic-concurrency model, extended here with an
  `onFirstRead` hook that injects a concurrent external mutation the first
  time a given path is read — the triggering read still observes the
  stale pre-mutation snapshot, but the version bump it causes forces that
  attempt's commit to conflict and retry with fresh reads, which then
  observe the mutated state) — each test asserts more transaction attempts
  occurred than calls made, proving a genuine conflict-and-retry rather
  than a lucky first read. `endAt`-crossing is proven differently, by
  design: `now` is captured once per `submitSurveyResponse` call (mirroring
  `openSurvey`/`closeSurvey`'s own established convention, not a per-retry
  clock read), so "endAt passing mid-flight" is exercised as "the
  authoritative check uses the server's actual time at the moment
  `submitSurveyResponse` runs, not an earlier belief that the survey was
  open" — the test explicitly probes the earlier "looked open" state first
  (documenting the contrast) before asserting the real call, with `now`
  already past `endAt`, rejects.
- **Error contract**: `invalid_submission` (bad answers, or nonexistent/
  malformed survey), `survey_unavailable` (non-open lifecycle or
  non-active team), `unauthenticated` (authenticated mode, no/invalid
  identity), `forbidden` (authenticated mode, valid identity but not an
  actual member), `already_submitted`, `encryption_failed`,
  `persistence_failed` (any thrown Firestore error, at any read or at the
  transaction level) — never a raw Firestore/Firebase error, token, or
  document id.
- **Privacy**: the success result is exactly `{ok: true}` — no generated
  `responseId`/`participationId` ever returned, confirmed by a test
  asserting `Object.keys(result)` is exactly `["ok"]`. No `console.*` call
  exists on any path (success, every rejection, or failure) — confirmed by
  a test spying on `console.log`/`warn`/`error` across all of them.
- `firestore.rules`: added explicit `match /surveyResponses/{document=**}`
  and `match /surveyParticipations/{document=**}` deny-all blocks
  (mirroring `pulseSurveyResponses`/`surveys`/`teamSurveyState`'s existing
  blocks exactly), plus two matching static assertions in
  `src/lib/firebase/firestore-deployment-config.test.ts`. No change to
  `firestore.indexes.json` — every read in this task is a direct document
  `get` (survey by id, team by id, membership by deterministic id,
  participation by deterministic id) and every write is a `set` against an
  id already known at write time; no query of either new collection exists
  in this task.
- Tests (`submit-survey-response.test.ts`, 35 cases): public mode (valid
  submission persists an encrypted, anonymous response; no plaintext
  answers; no respondent identity or `SurveyParticipation` even when a
  token is supplied; repeated submissions all succeed independently;
  closed/`endAt`-expired/scheduled/disabled-team/missing-or-malformed-team
  all rejected with no write; nonexistent and malformed survey both
  `invalid_submission` with no distinguishing detail; a structurally
  invalid answer payload is rejected before any Firestore call at all);
  authenticated mode (actual-member success with a response/participation
  pair sharing no field; no token; invalid/revoked token; no membership;
  wrong-team membership; app-admin-without-membership, BR-16 regression;
  a client-supplied teamId/accessMode has no parameter to be smuggled
  through in the first place; sequential duplicate rejected; two different
  members' own submissions never interfere with each other; lost-in-transit
  retry never creates a second response; true-concurrency duplicate test
  proving exactly one of two simultaneous same-uid submissions succeeds,
  with `totalAttempts` asserted greater than the call count); races
  (submit-vs-close, team-disabled-mid-flight, membership-removal-mid-flight
  — each asserting zero writes and more transaction attempts than calls;
  `endAt`-crossing via the server-time-at-call-time argument above);
  failure cases (survey/team/membership read failure each map to
  `persistence_failed`; missing/invalid `ENCRYPTION_KEY` maps to
  `encryption_failed` with zero writes; a thrown `runTransaction` itself
  maps to `persistence_failed`); privacy (no `uid`/`email` in a persisted
  response; no answers/`responseId`/`submittedAt`/ciphertext in a persisted
  participation; no generated id in the success result; no logging on any
  path).
- Verification: `pnpm test` (926/926 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds, no new routes — expected,
  this task adds no route/API handler).
- No deviation from SPEC/TASKS. Scope confirmed via `git status`/`git
  diff`: only `src/features/surveys/domain/survey-participation.ts` and
  `src/features/surveys/server/submit-survey-response.{ts,test.ts}` are
  new for this task, plus the additive `firestore.rules` blocks and their
  matching deployment-config test assertions; `firestore.indexes.json`
  untouched; no `/survey/[surveyId]` route/UI, sign-in continuation, admin
  survey UI, team current-survey UI, aggregation/history, or any TASK-007+
  behavior was introduced.
- **Residual note, out of this task's scope**: while implementing this
  task's own read-then-write transaction ordering, `close-survey.ts`
  (TASK-004, already `Done`) was observed to call `tx.update` on the
  survey document *before* a later `tx.get` on `teamSurveyState` within
  the same transaction attempt — real Firestore transactions require every
  read to happen before any write, so this could throw against a live
  Firestore backend even though it passes against the in-memory test fake
  (which doesn't enforce that ordering). This is a pre-existing condition
  in already-`Done` code, not something this task touches or introduces;
  flagging it here for a future `debug`/dedicated-task pass rather than
  fixing it under TASK-006's scope. **Resolved** — see TASK-004's own
  "Post-`Done` debug fix" note.

**Post-`Done` review fix — stale `now` reused across a transaction retry
(endAt race)**
A `review-change` pass on this task found a Blocking gap: `now` (the
authoritative server time used to compute `effectiveLifecycle`) was
captured **once** in `submitSurveyResponse`, outside `db.runTransaction`,
and the same value was reused by every retry Firestore performs for that
call. Unlike the survey/team/membership/participation documents (all
genuinely re-read fresh on a retry), a survey's `endAt` boundary is never
itself a Firestore write — it's a pure comparison against the caller's own
`now` — so a retry triggered by *any* unrelated conflicting write could
still evaluate the survey as `"open"` using the stale, pre-`endAt` instant,
even though real server time had since passed `endAt`. Confirmed
empirically with a throwaway scratch reproduction (written, run, and
deleted before this fix — no trace left in the tree): a simulated
first-attempt-then-retry sequence incorrectly committed a response on the
retry.

Fixed in `src/features/surveys/server/submit-survey-response.ts`: `deps.now`
changed from a frozen `Date` to a callable clock,
`SubmitSurveyResponseClock = () => Date` (default: `() => new Date()`,
real wall-clock time). `submitSurveyResponse` now calls this clock *inside*
the object literal passed to `db.runTransaction`'s callback — i.e., fresh
on every invocation of that callback, once per Firestore transaction
attempt including retries — rather than hoisting a single captured value
above the call. Calling a clock is not a Firestore operation, so this has
no effect on `decideAndApplySubmission`'s read-before-write ordering
(unchanged, re-confirmed: every `tx.get` still precedes every `tx.set`).
No other semantics changed: public/authenticated authorization, membership
checks, participation deduplication, `SurveyResponse`/`SurveyParticipation`
shapes, encryption placement/freshness, team-active checks, the error
contract, and Firestore rules/indexes are all untouched.

`submit-survey-response.test.ts`'s `baseDeps` helper was updated to supply
`now: () => NOW` (a fixed-value clock) instead of a raw `Date` — this alone
kept all 34 other tests passing unchanged, since a function that always
returns the same instant is the deterministic equivalent of "time doesn't
move" for every test that isn't specifically about time moving. The one
`endAt`-crossing test was replaced with a genuine retry-based regression
test: a `sequencedClock(beforeEndAt, afterEndAt)` clock is combined with
the existing `onFirstRead` hook mechanism (already used for the other
three mid-flight races) to force a real version conflict on the survey
document after attempt 1's read, provoking a real Firestore-style retry;
attempt 1's clock call returns a still-open instant, attempt 2 (the
retry)'s clock call returns a past-`endAt` instant. Verified this new test
fails against a temporarily-reverted, hoisted-`now` version of
`submitSurveyResponse` (restored byte-identical immediately after
confirming) — `{ok: true}` with a committed response, instead of the
required `{ok: false, error: "survey_unavailable"}` with zero writes — and
passes against the fixed code. The three other genuine mid-flight races
(submit-vs-close, team-disabled-mid-flight, membership-removal-mid-flight)
and the true-concurrency duplicate-submission test were re-run in
isolation and are unaffected by the clock change.

Verification re-run after the fix: `pnpm test` (928/928 passed),
`pnpm typecheck` (clean), `pnpm lint` (clean), `pnpm build` (succeeds, no
new routes). `firestore.rules`/`firestore.indexes.json` unchanged by this
fix. No TASK-007+ file or behavior was introduced.

---

### TASK-007 — `/survey/[surveyId]` route + UI

**Status:** Done
**Covers:** BR-10, BR-12, BR-13 (UI half), BR-20 (UI half)
**Depends on:** TASK-005, TASK-006

**Outcome**
`/survey/[surveyId]` exists as one route serving both access modes (SPEC →
"Generated survey URL semantics"). It renders, purely from TASK-005's
resolved outcome, one of: not-found, not-yet-started, closed,
sign-in-required (with a link into the existing sign-in flow), forbidden,
or the answer form — and, on submit, calls TASK-006's operation and shows
success/validation-error states. No lifecycle, access-mode, or membership
logic is duplicated in this component — it renders states, it does not
decide them.

**Implementation notes**
- `app/survey/[surveyId]/page.tsx` as a Server Component resolving via
  TASK-005 server-side (`.claude/rules/nextjs-react.md` — prefer
  server-side loading for sensitive data), mirroring how
  `/teams/[teamId]/page.tsx` establishes its shell server-side before a
  client-side authorized component takes over. The submit form itself is
  a small Client Component (needs interaction state), calling TASK-006's
  operation via a thin API route.
- New `src/features/surveys/components/` (e.g. `SurveyParticipationView`,
  a `SurveyResponseForm` reusing the existing 1-5 radio-group pattern from
  `PulseSurveyForm.tsx` for visual consistency — but as new code; do not
  import from `src/features/pulse-survey/`, which is retired later).
- Reuse `src/components/ui/` primitives (`Button`, `Card`, `Alert`,
  `EmptyState`, `LoadingState`, `PageHeader`, `PageShell`) — no new
  component system (`docs/UI-UX.md`).
- Norwegian copy in a new `src/features/surveys/copy.ts`, following the
  established copy-module convention (`docs/features/product-ux-shell/
  SPEC.md`).
- Internal state values (`"public"`, `"scheduled"`, etc.) never appear in
  rendered text — map each to its Norwegian, non-technical message.
- Sign-in-required state links to `/sign-in` with the survey URL as the
  continuation target — but the actual return-to-survey redirect
  mechanics are TASK-008's job; this task only needs the outbound link to
  exist and be plausible (e.g. `/sign-in` with no continuation yet, or a
  placeholder query param TASK-008 formalizes) so it isn't blocked
  waiting on TASK-008.

**Verification**
- Component/UI tests: each of TASK-005's resolved outcomes renders the
  correct distinct state, in Norwegian, using shared primitives; the form
  is only rendered for the `answerable` outcome; submitting calls
  TASK-006's operation and shows success or a validation-error state;
  after `closed`/`not-found`, no residual form is rendered.
- Accessibility/responsive spot-check per `docs/UI-UX.md` (labels, focus,
  no color-only signaling, no page-level horizontal scroll at ~360-400px).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security / privacy**
This component must render exactly what TASK-005 returns and nothing
more — do not add any client-side authorization/lifecycle branching that
could disagree with the server's decision (`.claude/rules/security.md` —
never rely on UI filtering for authorization).

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] `/survey/{surveyId}` renders every documented state correctly for
      both access modes, in Norwegian.
- [x] The form is never rendered except for the `answerable` outcome.
- [x] A successful submission shows a confirmation state; a rejected one
      shows a validation/error state without echoing internal detail.
- [x] The route is usable at common phone widths with no page-level
      horizontal scroll.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `app/survey/[surveyId]/page.tsx`: a thin Server Component (mirrors
  `/teams/[teamId]/page.tsx`'s shell-only role) rendering `PageShell`
  (`center`, `width="lg"`) + `Card` (`elevated`/`lg`, matching `/sign-in`
  and `/pulse-survey`'s existing auth/survey-form panel treatment) around
  the one new client component, `SurveyParticipationView`. No
  server-side data fetching happens in the page itself — unlike the
  brief's original "Server Component resolving via TASK-005 server-side"
  phrasing, TASK-005's identity-dependent outcome (a signed-in caller's
  Firebase ID token only exists client-side, exactly like every other
  authenticated read in this codebase — `TeamDetail`, `TeamsOverview`) is
  resolved by the client, through a new thin read route, precisely
  mirroring how `/teams/[teamId]/page.tsx` itself only establishes the
  shell before `TeamDetail` (a Client Component) does the actual
  resolution — the "Server Component" in both cases is the outer shell,
  not the data-dependent read.
- Two new thin route handlers, following this repo's established
  thin-route-delegates-to-feature-operation pattern exactly
  (`app/api/teams/[teamId]/results/route.ts`): `GET
  /api/surveys/[surveyId]` (delegates to TASK-005's
  `resolveSurveyForParticipation`; every non-`read_failed` outcome —
  including `sign_in_required`/`forbidden`, which are legitimate
  application states here, not HTTP errors — returns `200`, since
  `resolveSurveyForParticipation` itself already is the authorization/
  response-minimization boundary) and `POST
  /api/surveys/[surveyId]/responses` (delegates to TASK-006's
  `submitSurveyResponse`; maps its error contract to HTTP status exactly
  as `/api/pulse-survey`'s existing convention: `invalid_submission`→400,
  `survey_unavailable`/`already_submitted`→409, `unauthenticated`→401,
  `forbidden`→403, `encryption_failed`/`persistence_failed`→500). Both
  extract an optional bearer token (mirroring `/api/teams/[teamId]/
  results/route.ts`'s `extractBearerToken`) — a missing/malformed header
  is never itself rejected here, since `public` surveys need none and
  both server operations already resolve a missing/invalid identity
  correctly on their own.
- `src/features/surveys/client/`: `survey-participation-gateway.ts`
  (`fetchSurveyParticipation`) and `submit-survey-response-gateway.ts`
  (`submitSurveyResponse`), each a thin `fetch` wrapper mirroring
  `team-results-gateway.ts`'s exact shape-validation-before-trust
  convention — an unrecognized/malformed response body always falls back
  to `read_failed`, never a fabricated success or a thrown error reaching
  the component.
- `src/features/surveys/components/`: `SurveyParticipationView` (the
  route's one state-rendering component — not-found/sign-in-required/
  forbidden/scheduled/closed/answerable/read-failed, each mapped to
  Norwegian copy, never an internal value) and `SurveyResponseForm` (the
  `answerable`-only submission form, new code copying `PulseSurveyForm`'s
  visual 1-5 radio-group structure verbatim but with no team selector —
  `teamId` is never client-supplied for this model — and no import from
  `src/features/pulse-survey/`, which TASK-014 retires wholesale).
  `SurveyParticipationView` renders exactly what the gateway returns and
  nothing else — no client-side lifecycle/access-mode/membership branching
  exists anywhere in this component (`.claude/rules/security.md`).
- **Auth-gated loading pattern, and a real deviation found while wiring
  it up**: initially mirrored `TeamDetail`/`TeamsOverview`'s "hoisted
  `async function` referenced from the inline `useAuthGatedResource`
  callback, closing over the hook's destructured `isCurrentGeneration`
  return value" shape — this reliably tripped a new-to-this-codebase
  ESLint diagnostic (`react-hooks/immutability`, part of the React
  Compiler ruleset bundled with `eslint-config-next` 16.3.4 on this
  toolchain) with "variable is accessed before it is declared," even
  though `TeamDetail`/`TeamsOverview` use the identical shape without
  tripping it. Root-caused by comparing against
  `ResultsRedirect.tsx` (`src/features/results/components/
  ResultsRedirect.tsx`), the one existing `useAuthGatedResource` consumer
  that instead uses the hook's **third callback parameter**
  (`(token, generation, isCurrentGeneration) => {...}`) rather than
  destructuring the hook's return value — switching
  `SurveyParticipationView` to that same shape (it never needed
  `isCurrentGeneration` outside the initial-load callback, unlike
  `TeamDetail`'s reused-for-a-second-action-handler case) resolved the
  diagnostic cleanly with no behavior change. No existing component was
  modified; this is purely how the new one is written. Flagging this
  here since it's a real, reproducible toolchain quirk future tasks
  adding a new `useAuthGatedResource` consumer may hit again.
- A `public` survey is never gated on auth state resolving to a
  non-`null` value first — unlike `TeamDetail`'s "`null` token is a
  terminal signed-out state," `SurveyParticipationView` always calls
  `fetchSurveyParticipation` with whatever token (or none) the auth
  subscription's first emission provides, since a `public` survey must
  answer identically regardless of sign-in state (BR-12) and the server
  is the sole authority on which outcome that produces.
- Sign-in continuation: the `sign_in_required` state's outbound link is
  `` /sign-in?continue=${encodeURIComponent(`/survey/${surveyId}`)} `` —
  exactly the "outbound link only, plausible query param" scope this task
  calls for. `app/sign-in/page.tsx`/`SignInForm.tsx` were **not**
  modified — they do not yet read or validate this parameter at all
  (still hardcoded to `/teams` on success); wiring the actual
  continuation/redirect and its open-redirect allow-list validation is
  TASK-008's job, per SPEC and per this task's own explicit scope note.
  Deliberately **not** implemented here, and not tested here, despite
  appearing in this task's originating request's test list: doing so
  would have started TASK-008 (BR-40), which this task was explicitly
  told not to begin.
- Already-submitted handling: `resolveSurveyForParticipation` (TASK-005)
  has no "already submitted" outcome — only `submitSurveyResponse`
  (TASK-006) can discover this, at submit time. `SurveyResponseForm`
  distinguishes the `already_submitted` submission error from every other
  rejection with its own Norwegian copy and `role="status"` (a
  non-alarming confirmation of the caller's own prior action, not an
  error — SPEC → "Edge cases" — "not a privacy leak"), rather than folding
  it into the generic `role="alert"` error state.
- Privacy: `SurveyParticipationView`/`SurveyResponseForm` only ever read
  `surveyId`/`title`/`teamName` from the gateway's typed result — there is
  no response-count, admin, or member field anywhere in
  `SurveyParticipationFetchResult`/`SurveyParticipationSummary` for a
  component to accidentally render, and no test had to merely assert an
  absence of copy that the type system already makes unreachable.
- Tests: `survey-participation-gateway.test.ts` (9 cases — token
  forwarding, URL-encoding, every known status shape, and
  malformed-body/network-failure fallback to `read_failed`),
  `submit-survey-response-gateway.test.ts` (6 cases — token forwarding,
  every known error mapping, unrecognized-error and network-failure
  fallback), `app/api/surveys/[surveyId]/route.test.ts` (6 cases —
  token extraction, every outcome's HTTP status/body, no logging),
  `app/api/surveys/[surveyId]/responses/route.test.ts` (10 cases —
  token extraction, request-body-injection-is-a-no-op since the route
  only ever reads `answers`, malformed JSON, every error→status mapping,
  minimal success body, no logging), `SurveyResponseForm.test.tsx` (9
  cases — three-question rendering with no team selector, completeness
  gating, public vs. authenticated header forwarding, success/
  already-submitted/generic-error states, pending/`aria-busy`, no
  leftover English), `SurveyParticipationView.test.tsx` (18 cases —
  loading state with zero fetches, public resolution with no token,
  every one of the seven outcomes rendered distinctly with no residual
  form/heading where inappropriate, fallback title, read-failure,
  unmount unsubscribe, no leftover English, plus an "auth/route races"
  group: a stale result after sign-out is ignored, no state update after
  unmount, and a route change from one `surveyId` to another discards
  the first survey's late-arriving result) — 58 new tests total.
- Verification: `pnpm test` (986/986 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean — including the `react-hooks/immutability`
  diagnostic above, resolved rather than suppressed), `pnpm build`
  (succeeds; the route manifest lists `/survey/[surveyId]`,
  `/api/surveys/[surveyId]`, and `/api/surveys/[surveyId]/responses` as
  new dynamic routes). Additionally smoke-tested with `pnpm dev`: `GET
  /survey/test-survey-id` returns `200` and server-renders the
  `SurveyParticipationView`'s initial "Laster undersøkelse…" loading
  state with no server-side crash — full interactive state coverage
  (answering, submitting, sign-in-required, forbidden, etc.) relies on
  the component/gateway tests above rather than a live Firebase
  emulator, which this environment does not have wired up for
  interactive browser testing.
- No deviation from SPEC/TASKS beyond the two explicitly-documented
  decisions above (client-side resolution behind a thin read route,
  rather than the page.tsx Server Component itself calling
  `resolveSurveyForParticipation`; and the `react-hooks/immutability`
  callback-shape fix). Scope confirmed via `git status`/inspection: only
  `app/survey/[surveyId]/page.tsx`, `app/api/surveys/[surveyId]/
  route.{ts,test.ts}`, `app/api/surveys/[surveyId]/responses/
  route.{ts,test.ts}`, and `src/features/surveys/{copy.ts,client/,
  components/}` are new for this task; `firestore.rules`/
  `firestore.indexes.json` are untouched by this task (their
  working-tree diffs predate it, from TASK-002/003/004/006); no sign-in
  continuation (`app/sign-in/`, `app/sign-up/`), admin survey management,
  team-page current-survey UI, or results/history code was introduced —
  TASK-008 and later remain `Ready`/untouched.

---

### TASK-008 — Sign-in continuation / return-to-survey

**Status:** Done
**Covers:** BR-40
**Depends on:** TASK-007

**Outcome**
Signing in from an `authenticated` survey's sign-in prompt returns the
user to the exact originating `/survey/{surveyId}` URL. The continuation
parameter is validated against a narrow `/survey/{surveyId}`-shaped
allow-list — anything else (an external URL, an unrelated internal route,
a malformed value) is ignored in favor of the existing `/teams` default,
never followed.

**Implementation notes**
- Extend `app/sign-in/page.tsx`/`SignInForm.tsx` to accept a continuation
  query parameter, validated with a small helper (e.g. a regex like
  `^/survey/[^/]+$`) before ever being used as a redirect target — reject
  silently to the existing `/teams` default on anything that doesn't
  match, never partially trust a near-match.
- `/sign-up` should carry the same continuation value through to its own
  post-verification sign-in step if the existing sign-up→sign-in flow
  requires it — check current behavior in `SignUpForm.tsx` before
  assuming a pass-through is needed.
- This task only touches `src/features/auth/` and `app/sign-in/`,
  `app/sign-up/` — it does not touch survey domain/server code.

**Verification**
- Tests: a valid `/survey/{surveyId}`-shaped continuation value redirects
  there after sign-in; an external URL, a `//`-prefixed value, an
  unrelated internal route, and a malformed value all fall back to
  `/teams`, never redirecting to the supplied value.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security / privacy**
This is an open-redirect-prevention boundary — the allow-list check must
be the actual gate (not merely "looks same-origin"), since this session's
security review specifically narrowed it from same-origin to this exact
shape.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] Signing in via an `authenticated` survey's prompt returns the user
      to that exact survey URL.
- [x] Every non-`/survey/{surveyId}`-shaped continuation value falls back
      to `/teams` rather than being followed.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/auth/domain/continuation.ts` (new): a pure, no-I/O module —
  `isValidSurveyContinuationPath` (the allow-list check, `^/survey/
  [A-Za-z0-9_-]+$` — a single path segment, no `/`/`?`/`#` or other
  URL-meta characters permitted inside the id, so a value that only
  *starts* with `/survey/` but then smuggles a query string, fragment, or
  extra segment is rejected, not partially trusted) and
  `resolveSignInDestination(continuation)` (returns `{path,
  isSurveyContinuation}` — `DEFAULT_SIGN_IN_DESTINATION` = `{path:
  "/teams", isSurveyContinuation: false}` for anything that doesn't
  validate, including `undefined`/`null`/a non-string/an empty string).
  Takes only the first value of a repeated-key array (mirrors
  `URLSearchParams.get()`), never concatenates or otherwise combines
  multiple values. The function never re-decodes its input — it validates
  exactly the single already-decoded string Next.js's `searchParams`
  hands over, which is what makes a double-encoded value
  (`%252Fsurvey%252Fabc`, still literally containing `%` after Next's one
  decode) fail the pattern rather than requiring special-case handling.
- `app/sign-in/page.tsx`: now `async`, accepting Next 16's `searchParams:
  Promise<{[key: string]: string | string[] | undefined}>` prop (the
  route is consequently `ƒ`/dynamic in the build's route manifest instead
  of `○`/static — an expected, harmless consequence of reading a
  request-time value on a login page, not a regression). Reads `continue`
  and forwards it **unvalidated** to `SignInForm` as a `continuation`
  prop — this page never itself decides what's a valid destination; that
  stays the domain module's single source of truth, called once, at
  render time, only inside `SignInForm`.
- `src/features/auth/components/SignInForm.tsx`: accepts the new optional
  `continuation` prop (`string | string[] | null`, defaulting to
  `undefined` — the exact "no continuation" case). Only on a successful
  sign-in does it call `resolveSignInDestination(continuation)` and
  render the existing success `Alert`'s link with the resolved
  `destination.path` and a destination-appropriate Norwegian label
  (`continueToSurveyLabel`, "Fortsett til undersøkelsen", added to
  `authCopy` alongside the existing `continueLabel`, "Fortsett til Team").
  No behavior changed on the `idle`/`submitting`/`error` paths — a failed
  sign-in never reaches this code at all, so an invalid *or valid* survey
  continuation is equally never followed on failure (existing
  `SignInForm.test.tsx` "shows a Norwegian error message" case, re-run
  unchanged, plus a new explicit regression test asserting zero links
  render after a failure even with a valid continuation supplied).
- **No redirect framework, no `router.push`/`router.replace`.** The
  existing pattern (`SignInForm.tsx`, pre-dating this task) is
  "show a success confirmation with a link to click," not an automatic
  client-side navigation — TASK-008 preserves that exact interaction
  pattern for both the default and continuation cases (`.claude/rules/
  nextjs-react.md`/SPEC's "do not introduce a general redirect framework
  unless truly necessary" reading), only generalizing the link's `href`
  and label from a hardcoded `/teams` to the validated destination. The
  security property this task actually needs — an external/malformed
  continuation is never reachable via any interactive element the page
  renders — holds for this pattern exactly as it would for a
  `router.push`-based one, and is what the new tests assert directly
  (every rejected-shape test asserts the rendered link's `href` is
  `/teams`, never the supplied value).
- **Sign-up (`app/sign-up/page.tsx`, `SignUpForm.tsx`) — confirmed out of
  scope, not modified.** Checked current behavior first, per this task's
  own implementation note: `SignUpForm` shows a static "check your email"
  success message and performs no navigation and no automatic sign-in
  afterward (Firebase's own hosted email-verification link is the next
  step, entirely outside this app's pages); there is no existing
  sign-up→sign-in link or redirect anywhere in the app for a continuation
  value to ride along on. Since there is no actual "post-verification
  sign-in step" in this codebase's current flow for a value to pass
  through, adding a pass-through mechanism here would be unused,
  speculative scope (SPEC's own task note explicitly allows this
  conclusion: "check current behavior... before assuming a pass-through
  is needed").
- Tests: `continuation.test.ts` (30 cases — every documented valid/invalid
  shape from this task's brief, including the double-encoded and
  nested-`continue=` cases, plus `resolveSignInDestination`'s
  undefined/null/repeated-key handling); `SignInForm.test.tsx` (+4 cases —
  valid survey continuation redirect-on-success; a table of
  external-URL/protocol-relative/unrelated-internal-route/malformed
  values all falling back to `/teams`, asserting the rendered link's
  `href` is never the supplied value; sign-in failure with a valid
  continuation supplied still renders zero links); `app/sign-in/
  page.test.tsx` (updated to `async`/`await` the now-`async` page
  function directly, rather than rendering it synchronously — the
  existing two tests are unchanged in intent; +2 new tests exercising the
  real `searchParams` → `SignInForm` → success-link wiring end-to-end,
  for both a valid survey continuation and an external-URL rejection).
- Verification: `pnpm test` (1025/1025 passed — see note below on this
  machine's default full-parallel run), `pnpm typecheck` (clean), `pnpm
  lint` (clean), `pnpm build` (succeeds; route manifest shows `/sign-in`
  as `ƒ`/dynamic, `/survey/[surveyId]` and `/api/surveys/...` unchanged
  from TASK-007). **Environment note, not a code defect**: this machine's
  default `vitest run` (no worker cap) spawns one worker per test file
  (90 files) and intermittently times out 1-2 unrelated, pre-existing
  `userEvent`-based tests in `SignInForm.test.tsx`/`SignUpForm.test.tsx`
  under that load (real-timer interaction tests racing CPU contention,
  not a logic failure — `SignUpForm.test.tsx` was not touched by this
  task and shows the identical flake); every file, including both of
  those, passes consistently in isolation and the full suite is
  consistently 1025/1025 green under `vitest run --maxWorkers=4`.
- Scope confirmed via `git status`/diff inspection: only
  `src/features/auth/domain/continuation.{ts,test.ts}` (new),
  `app/sign-in/page.{tsx,test.tsx}`,
  `src/features/auth/components/SignInForm.{tsx,test.tsx}`, and
  `src/features/auth/copy.ts` changed for this task. `app/sign-up/`,
  `SignUpForm.tsx`, `firestore.rules`, `firestore.indexes.json`, and all
  survey domain/server/UI code are untouched (the `firestore.rules`/
  `firestore-deployment-config.test.ts`/`docs/ROADMAP.md` working-tree
  diffs predate this task, from TASK-002/003/004/006). No TASK-009+ file
  or behavior was introduced.

---

### TASK-009 — Admin survey management (delete/archive + admin UI)

**Status:** Done
**Covers:** BR-33, BR-34 (UI half), BR-35, BR-36, BR-37
**Depends on:** TASK-002, TASK-003, TASK-004

**Outcome**
`/admin/teams/[teamId]` gains a survey-management section: an app admin
can create a survey for that team (via TASK-002), see its list (active +
a separate archived section), open/close it (via TASK-003/TASK-004), and
delete (zero responses) or archive (one or more responses) a closed one.
The delete-vs-archive choice is always server-determined by response
count — never a free client choice.

**Implementation notes**
- New `src/features/surveys/server/delete-or-archive-survey.ts`: reads
  the survey's response count (a lightweight existence/count check against
  `surveyResponses` filtered by `surveyId`) and the survey's
  `effectiveLifecycle`; rejects unless `closed`; branches to a genuine
  Firestore delete (zero responses) or setting `archivedAt` (one or more)
  — the client never selects which.
- New `src/features/surveys/server/list-team-surveys.ts` (admin-only,
  `requireAppAdmin`): lists a team's surveys with title/fallback, access
  mode, start/end, derived lifecycle, the `/survey/{surveyId}` link, and
  response count only where the threshold gate (TASK-011) permits it —
  this task's list itself does not compute aggregates; it can call
  TASK-011's per-survey count-or-suppressed helper once that task exists,
  or return `"unavailable"` for the count until then if sequenced before
  TASK-011 lands (implementer's choice — does not block this task).
- Extend `AdminTeamDetail.tsx` with a new survey-management section,
  reusing the existing admin per-row action-state pattern
  (`AdminTeams.tsx`/`AdminTeamDetail.tsx`'s existing
  pending/error-per-row convention) — do not invent a new pattern.
- Creating a survey from this page always targets the page's own
  `teamId` — the server re-verifies admin authorization independently of
  the supplied `teamId` (already enforced by TASK-002; this task just
  never offers a team picker in the UI).
- Explicit confirmation UI for the destructive delete action; a lighter
  affordance for archive (mirrors the existing team disable/re-enable
  treatment, `docs/UI-UX.md` → Admin UX).

**Verification**
- Server tests: delete succeeds only for a `closed`, zero-response survey;
  archive is the only option once any response exists; both are rejected
  for a `scheduled`/`open` survey; `listTeamSurveys` is admin-only and
  never returns `createdBy`... (accountability field is fine to include
  here per SPEC, but never encrypted payloads/raw responses/participation
  identities).
- UI tests: create/open/close/delete/archive each show loading/pending/
  error/success states; the delete confirmation is distinct from
  archive's.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security / privacy**
Delete/archive's `closed`-required precondition prevents a survey from
ever being hidden from active views while still technically answerable
via a bookmarked link (SPEC → BR-37) — do not relax this precondition for
UI convenience. This precondition also makes a "response arrives
concurrently with delete" race structurally impossible, not merely
handled: TASK-006 already blocks submission to anything not `open` (BR-20),
so once a survey is `closed` its response count can never change again —
there is no window where a genuinely zero-response survey could gain a
response between this task's count-check and its delete. No additional
race-guarding code is needed here beyond that existing lifecycle gate; the
implementer should not add a defensive transaction for this specific race,
since none exists.
`AdminTeamDetail.tsx`'s new section must render exactly what
`listTeamSurveys`/`createSurvey`/`openSurvey`/`closeSurvey`/
`deleteOrArchiveSurvey` return — it must not compute `effectiveLifecycle`,
`accessMode` eligibility, or any authorization decision itself
(`.claude/rules/security.md` — never rely on UI filtering for
authorization), mirroring TASK-007's same discipline for the public route.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] An app admin can create, open, close, delete (zero-response), and
      archive (has-response) a survey for their team from
      `/admin/teams/[teamId]`.
- [x] Delete/archive are unavailable while a survey is `scheduled`/`open`.
- [x] The delete-vs-archive choice is never client-selectable.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/server/list-team-surveys.ts`: `listTeamSurveys(idToken,
  teamId, deps)`, admin-only (`requireAppAdmin`, reused unchanged). Queries
  `surveys` by `teamId` (single-field, auto-indexed — no new index needed),
  validates each raw document via TASK-001's `isValidSurvey` and excludes a
  malformed one from the result rather than failing the whole read (mirrors
  `listTeamInvitations`'s established convention), and derives each entry's
  `lifecycle` via `effectiveLifecycle` (never a separately stored field).
  Returned shape (`AdminSurveyListEntry`): `{surveyId, title?, accessMode,
  lifecycle, startAt?, endAt?, openedAt?, closedAt?, archived, createdBy,
  createdAt}` — deliberately excludes `archivedAt` itself (a boolean
  suffices), and never includes `ciphertext`/`iv`/`authTag`/`keyVersion`,
  any `surveyParticipations` data, or the `teamSurveyState` coordination
  document. **Response-count aggregation is out of this task's scope**
  (TASK-011 owns it, per TASKS.md's own note that this list may return no
  count until then) — no `responseCount`/`unavailable` placeholder field was
  added at all, since nothing in this task's UI reads or displays one;
  adding an unused field would be speculative. `createdBy` is included for
  admin accountability, per SPEC's explicit allowance. Sorted newest-created
  first, computed in memory (no composite index needed for a
  `where`+`orderBy` on different fields).
- `src/features/surveys/server/delete-or-archive-survey.ts`:
  `deleteOrArchiveSurvey(idToken, teamId, surveyId, deps)`, admin-only. Takes
  a trusted `teamId` (mirrors `createSurvey`/`openSurvey`, unlike
  `closeSurvey`'s deliberately-`teamId`-less design) and cross-checks it
  against the fetched, `isValidSurvey`-validated survey's own `teamId`
  (`wrong_team` on mismatch) — a survey belonging to another team can never
  be mutated through this team's admin route, even though every app admin
  already manages every team (no team-level admin role) and this is
  therefore defense-in-depth against a route/UI bug rather than a privilege
  boundary between admins. Rejects (`not_closed`) unless
  `effectiveLifecycle(survey, now) === "closed"` (BR-37) — computed before
  any response-count read, so a `scheduled`/`open` survey's response count
  is never even queried. Response existence is checked via a plain
  `surveyResponses.where("surveyId","==",surveyId).limit(1)` query (an
  existence check, not a count or any decrypted read) — zero responses →
  hard `delete()` of the `surveys/{surveyId}` document; one or more →
  `update({archivedAt: now})`. Idempotent for an already-archived survey
  (`survey.archivedAt !== undefined` short-circuits before any
  response-count read or further write, mirroring `closeSurvey`'s
  already-in-target-state precedent). **No transaction was added** — SPEC's
  own "Security/privacy" note for this task explains why none is needed:
  `submitSurveyResponse` (TASK-006) already refuses any submission to a
  non-`open` survey (BR-20), so once a survey is `closed` its response count
  can never change again; there is no window between this function's
  existence check and its delete/archive write where a concurrent
  submission could land, so a defensive transaction here would guard
  against a race that structurally cannot occur.
- Both new operations reuse TASK-001's `isValidSurvey`/`effectiveLifecycle`
  and the same local `toCandidateSurvey`/`toDateOrUndefined` raw-Firestore-
  to-candidate mapping helper `open-survey.ts`/`close-survey.ts` already
  duplicate locally per this codebase's established "one seam per
  operation, no shared abstraction" convention (not extracted into a third
  shared module, consistent with that explicit precedent).
- Four new thin admin route handlers, following the existing
  thin-route-delegates-to-feature-operation pattern exactly: `GET`/`POST
  /api/admin/teams/[teamId]/surveys` (list / create, delegating to
  `listTeamSurveys`/TASK-002's `createSurvey`), `DELETE
  /api/admin/teams/[teamId]/surveys/[surveyId]` (delegating to
  `deleteOrArchiveSurvey`), `POST .../surveys/[surveyId]/open` (delegating
  to TASK-003's `openSurvey`), `POST .../surveys/[surveyId]/close`
  (delegating to TASK-004's `closeSurvey` — the route's own `teamId` path
  segment is deliberately never passed to `closeSurvey`, which takes none,
  by that task's own already-`Done` design). Every route extracts a bearer
  token and trusted path params, delegates entirely, and maps each typed
  result to an HTTP status without ever re-deriving authorization or
  lifecycle logic itself.
- `src/features/surveys/client/admin-survey-gateway.ts` (new): thin
  `fetch` wrappers (`fetchAdminSurveys`, `createAdminSurvey`,
  `openAdminSurvey`, `closeAdminSurvey`, `deleteOrArchiveAdminSurvey`),
  mirroring `admin-team-detail-gateway.ts`'s shape-validation-before-trust
  convention — an unrecognized/malformed response body or a network failure
  always falls back to a generic `"read_failed"`/`"unknown"`, never a
  fabricated success or a thrown error reaching the component.
- `src/features/surveys/copy.ts`: added an `admin` section to `surveysCopy`
  (not `teamsCopy`, since the survey-management copy is owned by the
  surveys feature, consistent with `docs/features/product-ux-shell/
  SPEC.md`'s feature-owned copy-module convention) covering every
  lifecycle/access-mode label, the create form, and the link/open/close/
  remove actions — no internal enum value (`"public"`, `"scheduled"`, etc.)
  is ever rendered directly.
- `src/features/teams/components/AdminTeamDetail.tsx`: extended (not a new
  route/portal) with an "Undersøkelser" section, composing the surveys
  feature's gateway functions directly into its existing
  `loadTeamDetail`/`loadForGeneration` flow and per-row action-state
  pattern — mirrors `TeamDetail.tsx`'s established precedent of a
  consuming feature calling another feature's gateway/domain functions
  directly rather than through a new cross-feature component boundary.
  `fetchAdminSurveys` was added to the existing `Promise.all` alongside the
  team/members/invitations/requests reads, sharing the same
  unauthenticated/forbidden/read_failed folding logic. A create form
  (access-mode radio group with no pre-selected default — the submit
  button stays disabled until one is chosen, per SPEC's explicit "no silent
  default" decision — plus optional title/start/end fields) creates via
  TASK-002. Each survey row shows its Norwegian lifecycle/access-mode
  labels, its stable `/survey/{surveyId}` link (a plain `<Link>`, with a
  "Kopier lenke" button using `navigator.clipboard` and a transient,
  `role="status"` "Lenke kopiert" confirmation for accessible copy
  feedback), and exactly one lifecycle-appropriate action button
  (open/close/remove) — never more than one competes for the same row, so
  a single per-survey `SurveyRowActionState` (mirroring the existing
  `RowActionState` convention) suffices, with one added phase
  (`confirming_removal`) for the destructive remove action's required
  explicit two-step confirmation (`docs/UI-UX.md` → "Admin UX"): since the
  client never knows in advance whether a removal will delete or archive
  (server-determined, BR-37), the confirmation prompt explicitly describes
  both possible outcomes rather than committing to either label. Every
  button whose label could be ambiguous across rows carries an
  `aria-label` naming the specific survey (falling back to the fixed
  Norwegian placeholder title for an untitled survey), kept in sync with
  its current pending/idle text so the accessible name never diverges from
  what's visually shown. Post-mutation, every handler re-fetches via the
  same `loadForGeneration`/`isCurrentGeneration` guard already used for
  members/invitations/requests — no optimistic lifecycle mutation, no new
  staleness mechanism. Survey-related local state is reset in the same
  `useAuthGatedResource` callback that already resets invite/member/
  invitation/request state on every auth or `teamId` change.
- Tests: `list-team-surveys.test.ts` (10 cases: lifecycle derivation,
  scheduled/closed/archived handling, newest-first sort, malformed-row
  exclusion, no encrypted/participation-shaped leakage, unauthenticated/
  forbidden/read-failure rejection with zero queries, no logging);
  `delete-or-archive-survey.test.ts` (16 cases: delete-zero-response,
  archive-with-responses, idempotent already-archived, `scheduled`/`open`
  rejection with zero response-count reads, wrong-team rejection,
  nonexistent/malformed survey, unauthenticated/forbidden, every
  read/write failure path, no logging); four new route test files (happy
  path, token/param forwarding, every error→status mapping, malformed
  JSON); `admin-survey-gateway.test.ts` (17 cases: request shape, URL
  encoding, every known/unrecognized error, network failures); `
  AdminTeamDetail.test.tsx` (+22 cases covering: empty state; active/
  archived rendering with lifecycle/access-mode/link; create-form
  access-mode-required gating; public and authenticated creation with
  optional start/end dates; creation failure preserving form input;
  copy-link with accessible feedback; open/close actions with authoritative
  refresh; explicit two-step remove confirmation and cancel; remove once
  confirmed; mutation-failure leaves state unchanged with no refetch;
  same-survey repeated-click reentrancy guard; two-survey action-state
  independence; stale open-survey result after a team-route change; stale
  open-survey result after sign-out).
- Verification: `pnpm test` (1120/1120 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds; route manifest shows the
  four new `/api/admin/teams/[teamId]/surveys...` routes, all `ƒ`/dynamic,
  alongside the unchanged existing routes).
- No deviation from SPEC/TASKS beyond the explicitly-documented decisions
  above (no transaction for delete/archive; no `responseCount` field this
  task; `teamId`-scoped `deleteOrArchiveSurvey` as a fresh design choice,
  unlike `closeSurvey`'s existing team-less contract). `firestore.rules`/
  `firestore.indexes.json` untouched by this task — no new collection was
  introduced, and every read here is either a single-field `where` query
  (auto-indexed) or a direct document get/update/delete. TASK-010 and
  later were not started; scope confirmed via `git status`/diff
  inspection.

---

### TASK-010 — Team-page current-survey discovery

**Status:** Done
**Covers:** BR-30, BR-31, BR-32, BR-41 (discovery half)
**Depends on:** TASK-002, TASK-003, TASK-004

**Outcome**
`/teams/[teamId]` gains a "Pågående undersøkelse" section: for a team the
caller is authorized for (unchanged `authorizeTeamAccess`), it shows the
team's current (`scheduled`/`open`, and team-`active`) survey if one
exists — title/fallback, availability, access mode, start/end where set,
and a link to `/survey/{surveyId}` — or a non-sensitive empty state.

**Implementation notes**
- New `src/features/surveys/server/get-current-team-survey.ts` — a
  member/admin-scoped read (reuses `authorizeTeamAccess`, not
  `requireAppAdmin`), deliberately separate from TASK-009's admin-only
  `listTeamSurveys` rather than reusing it directly, so this read's
  authorization boundary is exactly "team member or admin," never
  admin-only.
- Query `surveys` by `teamId` and compute `effectiveLifecycle` for each to
  find the one that's `scheduled`/`open`, additionally checking the
  team's own `active` status (BR-41) — if the team is `disabled`, this
  section shows the empty state, not a stale "current survey" card.
- Extend `TeamDetail.tsx` with the new section, reusing existing
  primitives and the shared `useAuthGatedResource` pattern already used
  there.
- Never render response/result content in this section — that stays the
  existing closed-survey results section (TASK-012), unchanged in its own
  authorization boundary.

**Verification**
- Server tests: returns the team's current survey when one exists;
  returns the empty-state result when none does, including when the team
  is `disabled` (even if a `scheduled`/`open` survey document still
  exists); a non-member/non-admin caller gets the same denial
  `TeamDetail` already has for results.
- UI tests: loading/empty/loaded states render correctly; the link target
  matches `/survey/{surveyId}` exactly.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security / privacy**
No additional considerations beyond the existing `authorizeTeamAccess`
boundary this task reuses unchanged. `TeamDetail.tsx`'s new section must
render exactly what `get-current-team-survey.ts` returns — it must not
independently compute `effectiveLifecycle`, availability, or `accessMode`
eligibility itself, mirroring TASK-007's same discipline.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] `/teams/[teamId]` shows the team's current survey with a working
      `/survey/{surveyId}` link, or a non-sensitive empty state.
- [x] A `disabled` team never shows a current survey as available.
- [x] A non-member/non-admin caller sees no survey data.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `src/features/surveys/server/get-current-team-survey.ts`:
  `getCurrentTeamSurvey(idToken, teamId, deps)`. Authorization reuses
  `authorizeTeamAccess` unchanged (the same "team member or admin" boundary
  `getTeamResults` already uses for viewing results) — never
  `requireAppAdmin`, and never TASK-005/006's narrower "actual membership
  for participation" check (that boundary answers "may I answer this
  survey," not "may I view this team's page"); `authResult.access ===
  "denied"` maps to `forbidden`, an `authorizeTeamAccess` read failure maps
  to `read_failed`, an invalid/missing token maps to `unauthenticated` —
  identical error-mapping convention to `getTeamResults`.
- After authorization, the team's own `status` is read fresh a second time
  (a deliberate second Firestore read, not reused from
  `authorizeTeamAccess`'s internal read — each operation owns its own read
  seam per this codebase's established "one seam per operation" convention,
  mirroring `resolveSurveyForParticipation`'s identical pattern of reading
  team status itself rather than sharing a read across function
  boundaries). A validly-read `"active"` status is required for any survey
  to be shown; anything else (missing, malformed, or a validly-read
  `"disabled"`) fails closed to the same non-sensitive `{ok: true, survey:
  null}` empty state — never a distinguishable "team disabled" signal
  (BR-41) — and short-circuits before `surveys` is ever queried for that
  team.
- Once the team is confirmed active, `surveys` is queried by `teamId`
  (single-field, auto-indexed — no new index needed) and every raw document
  is validated via TASK-001's `isValidSurvey`/`effectiveLifecycle` (reused
  unchanged, local `toCandidateSurvey`/`toDateOrUndefined` mapping helpers
  duplicated per the same established per-operation convention
  `list-team-surveys.ts`/`resolve-survey-for-participation.ts` already use —
  not extracted into a third shared module). A malformed document is
  silently excluded, never surfaced as a partial/fabricated row.
- **Current-survey selection (an ordinary implementation choice SPEC leaves
  open, documented rather than assumed)**: a genuinely `open` survey always
  wins over any `scheduled` one (the only one actually answerable right
  now); by BR-6's one-open-survey-per-team invariant at most one can ever
  exist, so there is no further tie to break in that case. SPEC explicitly
  allows multiple `scheduled` surveys for the same team ("One open survey
  per team" — "an admin can freely create several ahead of time"); among
  those, `pickCurrentSurvey` picks the one with the earliest `startAt`
  (falling back to the earliest `createdAt` when `startAt` is unset) as
  "next up." No behavioral requirement specifies a tie-break, so this is a
  deterministic, documented default rather than a new domain rule — a
  future task can revisit it without any contract change if real usage
  shows a different ordering is more useful.
- Returned `CurrentTeamSurveyView`: `{surveyId, title?, accessMode,
  lifecycle: "scheduled" | "open", startAt?, endAt?}` — deliberately
  excludes `createdBy`, `archivedAt`, and anything `teamSurveyState`-shaped
  (mirrors `resolveSurveyForParticipation`'s `SafeSurveyParticipationView`
  minimization discipline); no response-count-shaped field exists at all,
  since this task is discovery-only (TASK-011 owns aggregation).
- New thin route: `GET /api/teams/[teamId]/current-survey` (mirrors
  `/api/teams/[teamId]/results/route.ts` exactly) — extracts the bearer
  token and trusted path `teamId`, delegates entirely to
  `getCurrentTeamSurvey`, maps `unauthenticated`→401, `forbidden`→403,
  `read_failed`→500, and `{ok: true, survey}` (including a `null` survey,
  the empty state) →200. No lifecycle/authorization logic in the route.
  Deliberately a separate endpoint from `/api/teams/[teamId]/results` —
  survey discovery and protected results stay separate server contracts,
  per this task's own explicit instruction.
- `src/features/surveys/client/current-team-survey-gateway.ts`
  (`fetchCurrentTeamSurvey`): a thin `fetch` wrapper mirroring
  `team-results-gateway.ts`/`survey-participation-gateway.ts`'s established
  shape-validation-before-trust convention — a malformed body or network
  failure always falls back to `read_failed`, never a fabricated empty
  state.
- `src/features/surveys/copy.ts`: new `teamCurrent` section (section title,
  empty/error/fallback-title copy, the answer-link label, start/end
  labels). Lifecycle (`"scheduled"`/`"open"`) and access-mode labels are
  deliberately *reused* from the existing `admin.lifecycleLabels`/
  `admin.accessModeLabels` rather than duplicated — the same Norwegian term
  means the same thing to a team member as to an admin (SPEC → "use
  consistent terms").
- `src/features/teams/components/TeamDetail.tsx`: extended (not a new
  component file) with a `CurrentSurveySection`/`CurrentSurveyCard` pair,
  composing the surveys feature's gateway function directly — mirrors
  `AdminTeamDetail.tsx`'s established precedent of a consuming feature
  calling another feature's gateway/domain functions directly rather than
  through a new cross-feature component boundary. Fetched via
  `Promise.all([fetchTeamResults(...), fetchCurrentTeamSurvey(...)])` inside
  the existing `resolveViaResults` step — the two are independent server
  contracts (per this task's own instruction), so neither read blocks the
  other, and both land in the same `isCurrentGeneration`-guarded state
  write as the existing results data (no second auth subscription, no new
  staleness mechanism — reuses the existing generation guard unchanged).
  `resolveViaResults` is only ever reached for a caller the overview didn't
  already report as a known denial, so a definitively-denied caller never
  triggers a current-survey fetch either (mirrors the existing "never
  queried for a denied caller" principle, now applied to survey discovery
  too). If the results read itself resolves to `forbidden`/
  `unauthenticated`, the parallel current-survey result is discarded
  unconditionally — a denied caller never sees survey data regardless of
  what that parallel read happened to return.
- **Error isolation**: a current-survey-specific failure (a genuine
  `read_failed`, or the rare `forbidden`/`unauthenticated` race where
  membership is revoked between the two parallel reads) renders only the
  survey section as a distinct error (`CurrentSurveySectionState:
  "unavailable"`) — it never fails the whole `TeamDetail` load, and never
  fabricates "ingen pågående undersøkelse" for an infrastructure failure.
  Conversely, a *results* read failure (`results_unavailable`) does not
  suppress the current-survey section — it renders independently alongside
  the results-unavailable alert, confirming the two server contracts stay
  genuinely separate end-to-end.
- The `/survey/{surveyId}` link reuses `encodeURIComponent` on `surveyId`
  (TASK-007's same safe-encoding convention) and is the exact same canonical
  route used for external sharing — `TeamDetail` never decides answerability
  itself; following the link always re-enters TASK-005/006's own
  authorization/lifecycle checks.
- Dates are rendered via a small local `formatSurveyDate` helper
  (`toLocaleDateString("nb-NO", {day: "numeric", month: "short", year:
  "numeric"})`, e.g. "1. aug. 2026") — no existing shared date-formatting
  utility existed anywhere in the codebase to reuse (confirmed by search);
  this one is local to `TeamDetail.tsx`, not a new shared abstraction, since
  no second call site exists yet.
- Tests: `get-current-team-survey.test.ts` (18 cases: authorization
  delegation and its three error mappings; team-disable fail-closed
  behavior with zero `surveys` queries; empty/scheduled/open selection;
  open-beats-scheduled; earliest-startAt and earliest-createdAt tie-breaks
  among several scheduled surveys; malformed-document exclusion; a
  cross-team-leak defense-in-depth check; a minimal-DTO privacy assertion);
  `app/api/teams/[teamId]/current-survey/route.test.ts` (9 cases: token/
  param forwarding, every outcome's HTTP status/body including the `null`-
  survey 200 case, no logging); `current-team-survey-gateway.test.ts` (10
  cases: token forwarding, URL encoding, every known status, malformed-body/
  network-failure fallback); `TeamDetail.test.tsx` (+25 cases across two new
  describe blocks: open/scheduled/empty/error rendering, start/end date
  display, fallback title, link target, no response-count leakage, no
  fetch for an already-denied caller, no leftover English, section renders
  alongside a results-unavailable error, a forbidden/unauthenticated race
  never fabricates the empty state, plus stale-sign-out/team-route-change/
  unmount race protection specific to the current-survey fetch) — all 17
  pre-existing `TeamDetail.test.tsx` cases re-run unchanged and still pass.
- Verification: `pnpm test` (1170/1170 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds; route manifest lists `GET
  /api/teams/[teamId]/current-survey` as a new dynamic route alongside the
  unchanged existing routes).
- No deviation from SPEC/TASKS beyond the one explicitly-documented,
  non-behavioral tie-break decision above (current-survey selection among
  several `scheduled` surveys). `firestore.rules`/`firestore.indexes.json`
  are untouched by this task — no new collection was introduced, and every
  read here is either a single-field `where` query (auto-indexed) or a
  direct document get, exactly as SPEC's "Firestore/index implications"
  anticipated for this task. Scope confirmed via `git status`/diff
  inspection: only `src/features/surveys/server/get-current-team-survey.
  {ts,test.ts}`, `app/api/teams/[teamId]/current-survey/route.{ts,test.ts}`,
  `src/features/surveys/client/current-team-survey-gateway.{ts,test.ts}`,
  `src/features/surveys/copy.ts`, and `src/features/teams/components/
  TeamDetail.{tsx,test.tsx}` are new/changed for this task. No
  survey-instance results/aggregation, chart/history migration, Home/nav
  changes, admin lifecycle changes, or response-count UI was introduced —
  TASK-011 and later were not started and remain `Ready`/untouched.

**Post-review fix — explicit teamId cross-check and deterministic multi-open tie-break**
A `review-change` pass on this task found two Important gaps in
`get-current-team-survey.ts`, both defense-in-depth issues in a read path
that had never had a reason to be exercised incorrectly, but should still
fail closed and behave definedly rather than trust an assumption:

1. **Cross-team leak**: the function relied entirely on `listRawForTeam`'s
   query already scoping by `teamId`, with no application-level check that
   each returned, structurally-valid `Survey`'s own persisted `teamId`
   actually matched the requested one — unlike `close-survey.ts`/
   `delete-or-archive-survey.ts`, which perform this exact cross-check as
   defense-in-depth. The accompanying test also didn't actually exercise
   this: its fake pre-filtered by `teamId` itself, so it would have passed
   even with zero cross-team protection in the production code.
2. **Non-deterministic multi-open selection**: `pickCurrentSurvey` used
   `.find()` to pick the first `open` candidate, so if persisted state were
   ever corrupted into having two `open` surveys for one team (BR-6
   prevents this in valid state, but this is a read path, not the
   transactional write path that enforces it), the result would depend on
   `listRawForTeam`'s unspecified return order — unlike the already-
   deterministic `scheduled`-survey tie-break.

Fixed in `src/features/surveys/server/get-current-team-survey.ts`:
- After `isValidSurvey` validation, an explicit `survey.teamId === teamId`
  filter now excludes any structurally-valid survey belonging to another
  team — treated exactly like a malformed document (excluded, never
  eligible), not a hard failure of the whole read, mirroring
  `listTeamSurveys`'s established "invalid → excluded" convention. This is
  the chosen fail-closed behavior for *that document* specifically; a
  genuinely-scoped survey elsewhere in the same result set still resolves
  normally.
- `pickCurrentSurvey` now applies the same deterministic tie-break shape to
  both the `open` and `scheduled` cases via a shared `compareByInstant`
  comparator: earliest primary instant (`openedAt` for `open`, `startAt` for
  `scheduled`), then earliest `createdAt`, then `surveyId` as a final,
  arbitrary-but-stable tie-break. This is purely defensive handling of an
  invalid state for the `open` case (BR-6 still governs valid state; no new
  product rule was introduced) — documented in `pickCurrentSurvey`'s own
  doc comment.

Four tests added/changed in `get-current-team-survey.test.ts` (21 cases
total, up from 18): a mixed cross-team-and-same-team result set resolves to
only the genuinely-scoped survey (never fails the whole read); an
all-cross-team result set resolves to the empty state, not a leaked survey;
two genuinely-open surveys resolve to the earliest `openedAt` regardless of
listing order (asserted in both orderings); two open surveys sharing the
same `openedAt`/`createdAt` resolve via the `surveyId` tie-break. All four
were verified to genuinely fail under the pre-fix code (reverted locally,
confirmed failing with the exact wrong survey selected in each case, then
restored) — proof the fix, not merely the current code, is what the tests
exercise. Every pre-existing case (including the scheduled-survey tie-break
tests) re-ran unchanged and continues to pass.

No change to `authorizeTeamAccess` usage, the team-active check,
`effectiveLifecycle` reuse, the DTO shape, the API route, the gateway, the
`TeamDetail` UI, stale-generation handling, `firestore.rules`/
`firestore.indexes.json`, or the results feature. TASK-011 was not started.

Verification re-run after the fix: `pnpm test` (1173/1173 passed), `pnpm
typecheck` (clean), `pnpm lint` (clean), `pnpm build` (succeeds, no route
manifest change — this fix touches server logic only).

---

### TASK-011 — Survey-instance results/aggregation (server)

**Status:** Done
**Covers:** BR-25, BR-26, BR-27, BR-28 (data half), BR-42 (BR-8 is owned by TASK-001; this task only adds the `closedAt` backfill described under SPEC → "Results/history model," a consumer of BR-8, not its authoritative implementation), BR-43 - BR-48 (per-survey `minimumResponses`, added to this task's scope by the pre-implementation expansion below)
**Depends on:** TASK-004, TASK-006

**Pre-implementation scope expansion — per-survey result threshold**
Before implementation began, an approved product change replaced the
single global result-publication threshold (`MIN_RESPONSE_THRESHOLD = 5`,
SPEC's original "stays 5" Non-goal) with a per-survey, immutable
`minimumResponses` field (integer, `[3, 20]`, default `5` in the admin
creation form only). This directly changes the aggregation privacy
boundary that TASK-011 owns, so **TASK-011 was expanded, before its own
implementation started, to also own**:
- The domain model extension (`Survey.minimumResponses`,
  `isValidMinimumResponses`, `DEFAULT_MINIMUM_RESPONSES`/
  `MINIMUM_RESPONSES_MIN`/`MINIMUM_RESPONSES_MAX` — added to TASK-001's
  already-`Done` `src/features/surveys/domain/survey.ts`).
- Survey creation (`CreateSurveyInput`/`validateCreateSurveyInput` —
  TASK-001's `create-survey-input.ts` — and `createSurvey`'s persisted
  `SurveyRecord` — TASK-002's `create-survey.ts`).
- The admin survey-creation UI (TASK-009's `AdminTeamDetail.tsx` creation
  form and survey-row display, plus `list-team-surveys.ts`'s
  `AdminSurveyListEntry` and the `admin-survey-gateway.ts` client types).
- This task's own original scope: survey-instance aggregation, now keyed
  by each survey's own `minimumResponses` instead of a global constant.

This is **not** a rewrite of TASK-001/002/009's history — those tasks did
not originally implement `minimumResponses`; this note records the
approved pre-TASK-011 product change and TASK-011's resulting extension,
consistent with `docs/features/managed-surveys/SPEC.md`'s own "Per-survey
result threshold" section (added by this same change) and its updated
Non-goals entry. TASK-001/002/009 remain `Done` and their own
"Implementation notes (actual)" are left describing what those tasks
actually built at the time — the `minimumResponses` additions to their
files are attributed here.

**Outcome**
A team's results are computed per closed survey instance instead of per
calendar period: for each of a team's most recent 12 `closed` surveys, the
server returns either a published aggregate (mean + exact count, at/above
*that survey's own* `minimumResponses`) or a suppressed state (below
threshold — no count, including for an app admin). A survey whose
lifecycle is `scheduled`/`open` never appears. A survey that's `closed`
only via `endAt` (never explicitly closed) gets its `closedAt` lazily
backfilled to `endAt` the first time this read observes it, so
sorting/display has a reliable date. Every survey now persists its own
`minimumResponses` (required, `[3, 20]`, immutable after creation),
validated independently server-side at creation and again on every read
that treats a document as a `Survey` — a malformed/missing value fails
closed (the survey is excluded, never defaulted to 5).

**Implementation notes**
- Domain (`src/features/surveys/domain/survey.ts`): added
  `DEFAULT_MINIMUM_RESPONSES = 5`, `MINIMUM_RESPONSES_MIN = 3`,
  `MINIMUM_RESPONSES_MAX = 20`, `isValidMinimumResponses` (integer, finite,
  in-range — fail-closed, never throws), a required `minimumResponses:
  number` field on `Survey`, and `isValidSurvey` now requires
  `isValidMinimumResponses(record.minimumResponses)`. Every existing
  caller of `isValidSurvey` (open/close/submit/resolve/list/delete-or-
  archive/get-current-team-survey — all TASK-002 through TASK-010, already
  `Done`) automatically inherits this stricter validation with no code
  change of their own, since they all go through the same shared
  validator — only their test fixtures needed a `minimumResponses` field
  added.
- Creation (`create-survey-input.ts`/`create-survey.ts`): `minimumResponses`
  added as a required field to `CreateSurveyInput`, validated via
  `isValidMinimumResponses` before any team-status read (mirrors
  `accessMode`'s existing validate-before-side-effects ordering), and
  persisted exactly as validated onto `SurveyRecord` — no fallback to
  `DEFAULT_MINIMUM_RESPONSES` anywhere in this path.
- Admin UI (`AdminTeamDetail.tsx`/`list-team-surveys.ts`/
  `admin-survey-gateway.ts`/`copy.ts`): a numeric `<input type="number"
  min={3} max={20}>` pre-filled with `"5"`, labeled "Minste antall svar"
  with the hint "Resultater vises først når minst dette antallet personer
  har svart." — the `min`/`max` attributes are a usability aid only, never
  trusted as validation (the server independently re-validates). Each
  survey row now also shows its configured threshold ("Minst N svar") —
  safe to show, since the threshold itself is not sensitive (SPEC →
  "Per-survey result threshold").
- Aggregation (this task's original scope): `src/features/results/domain/
  aggregation.ts` gained `computeSurveyAggregate(surveyId, candidates,
  minimumResponses)` — a **new function**, not a modification of
  `computePeriodAggregate`/`MIN_RESPONSE_THRESHOLD` (both left completely
  unchanged, still backing the old calendar-period path until TASK-014
  retires it wholesale). `computeSurveyAggregate` takes `minimumResponses`
  as a **mandatory parameter with no default** — this is what "retires the
  global constant from the publication decision" for the new model without
  touching the old one, so the codebase never has two competing threshold
  systems deciding the same kind of question. As an optimization (not a
  behavior change), a survey whose raw candidate count already falls below
  `minimumResponses` is never decrypted at all.
- New sibling server operation `src/features/results/server/
  get-team-survey-results.ts` (`getTeamSurveyResults`) — deliberately a
  **new file**, not an in-place edit of `get-team-results.ts`/its route,
  so the existing calendar-period-scoped `/teams/[teamId]` results UI
  (TeamDetail.tsx, TrendChart/TrendTable/PeriodSummary — all still wired
  to the old operation) keeps working and all its existing tests keep
  passing until TASK-012 does the actual UI/route swap. This mirrors the
  established pattern of a "(server)"-only task producing an operation a
  later "UI"-titled task wires up (e.g. TASK-005 → TASK-007).
  `getTeamSurveyResults` reuses `authorizeTeamAccess` unchanged (admin or
  member — the exact same boundary `getTeamResults` already uses), queries
  `surveys` by `teamId`, filters to `effectiveLifecycle === "closed"`
  (excluding, not erroring on, a malformed survey — including one with an
  invalid `minimumResponses`), lazily backfills `closedAt = endAt` for an
  `endAt`-only-closed survey (best-effort — a write failure never fails
  the read), sorts chronologically ascending with a deterministic
  `surveyId` tie-break for identical instants, takes the most recent 12,
  queries `surveyResponses` by `surveyId` (`where("surveyId","in",[...])`,
  no composite index needed), groups responses strictly by their own
  `surveyId` (never by `teamId` alone — so a response can never cross
  survey or team boundaries), and calls `computeSurveyAggregate` once per
  survey with that survey's own `minimumResponses`. Deliberately does
  **not** read the owning team's `active`/`disabled` status at all (BR-42)
  — unlike TASK-005/006's answerability checks.
- `SurveyResultEntry` (the new DTO, replacing `PeriodAggregateResult` for
  this path): `{surveyId, title?, date, minimumResponses, status:
  "insufficient"} | {..., status: "published", mean, count}` — below
  threshold, `minimumResponses` is present (not sensitive) but `mean`/
  `count` are entirely absent (never a suppressed placeholder value);
  never `createdBy`, encrypted payloads, or any `SurveyParticipation`
  data.

**Verification**
- Domain tests (`survey.test.ts`, `create-survey-input.test.ts`,
  `aggregation.test.ts`): `isValidMinimumResponses`/`isValidSurvey` accept
  3/5/20 and every in-range integer, reject <3, >20, decimals, missing,
  `null`, numeric strings, `NaN`, `Infinity` — never throwing;
  `validateCreateSurveyInput` mirrors the same matrix and never defaults a
  missing value; `computeSurveyAggregate` threshold matrix at
  minimumResponses = 3 (2 suppressed/3 published), 5 (4 suppressed/5
  published), 10 (9 suppressed/10 published), plus the
  never-decrypts-below-threshold optimization and the
  raw-count-met-but-decrypted-count-dropped-below-threshold case.
- Server tests (`create-survey.test.ts`): 3/5/20 accepted and persisted
  exactly; below 3, above 20, decimal, and missing all rejected before any
  team-status read; persisted value equals the validated input exactly.
- Server tests (`get-team-survey-results.test.ts`, new): below-threshold
  survey suppressed (no count) for every caller including app admin;
  at/above-threshold survey publishes mean + exact count;
  `scheduled`/`open` surveys never appear; two surveys for the same team
  with different thresholds each use only their own; `closedAt` backfilled
  exactly once for an `endAt`-expired survey (idempotent on repeat reads,
  and a backfill write failure never fails the read); most-recent-12
  window and chronological ordering (including irregular 3-week/6-week
  gaps and >12 surveys); deterministic ordering for identical instants; a
  malformed/out-of-range `minimumResponses` survey is excluded entirely,
  never defaulted; responses from another survey or another (structurally
  cross-team) survey document never contribute; a disabled team's past
  results remain visible (BR-42); no raw response/identity/participation
  content ever returned; `read_failed` on a query failure at either step.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all run after
  the change (see Verification results below).

**Security / privacy**
The threshold/suppression logic is reused (`decodeCandidate`/
`computeMean`, unchanged), not redesigned — the actual privacy-sensitive
change is the *re-keying to per-survey minimumResponses*, kept to the
narrowest possible surface: a new function
(`computeSurveyAggregate`) alongside the untouched
`computePeriodAggregate`, never a shared/parameterized rewrite of both.
The results-viewing authorization boundary (`authorizeTeamAccess`, "admin
or member") is reused completely unchanged — this task does not touch,
narrow, or re-derive who may view results at all, only how the underlying
data is keyed, thresholded, and aggregated. A malformed/missing
`minimumResponses` fails closed by exclusion (the same "malformed →
excluded" convention already established for every other malformed-survey
case in this feature), never by assuming a safe-sounding default value —
this is deliberately stricter than "assume the most private option" would
be, since assuming *any* value here is itself the thing SPEC's "fail
closed" instruction rules out.

**Documentation impact**
`docs/features/managed-surveys/SPEC.md` updated in the same change that
expanded this task (Non-goals, Terminology, a new "Per-survey result
threshold" section, "Response-count behavior," the `surveys` persisted
shape in two places, "Admin creation/management flow," BR-43–BR-48, the
testing-strategy table, and acceptance criteria). `docs/SECURITY.md`
invariants 11/12 updated to describe the per-survey model instead of a
single global "5". `docs/DATA-MODEL.md`'s `SurveyAggregate` note updated
to reference the per-survey threshold. `docs/ARCHITECTURE.md`/
`docs/UI-UX.md` were reviewed and found to contain no threshold-specific
text that the per-survey change makes factually stale (both already
referred to "the minimum threshold in docs/SECURITY.md" generically, or to
suppression *display* rules that are unchanged) — left as-is, per this
task's explicit "update only where factually stale" scope; the full
feature-closeout documentation sweep remains TASK-014's job.

**Acceptance criteria**
- [x] Results are computed per closed survey instance, never per calendar
      period.
- [x] Below-threshold surveys never reveal a count to any caller.
- [x] `scheduled`/`open` surveys never appear in the results/history read.
- [x] An `endAt`-expired, never-explicitly-closed survey's `closedAt` is
      reliably backfilled and used for ordering/display.
- [x] A disabled team's past results/history remain visible to its
      existing members/admins, unaffected by the disable.
- [x] Survey has required persisted `minimumResponses`; allowed values are
      integers 3–20; default admin form value is 5; server independently
      validates it; it is immutable after creation (no edit operation
      exists); a missing/malformed value fails closed (excluded), never
      defaulted.
- [x] Every survey uses only its own persisted `minimumResponses`; no
      global hardcoded threshold controls the new aggregation's
      publication decision; an app admin has no threshold bypass.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- Files changed: `src/features/surveys/domain/survey.ts` (+test),
  `src/features/surveys/domain/create-survey-input.ts` (+test),
  `src/features/surveys/server/create-survey.ts` (+test),
  `src/features/surveys/server/list-team-surveys.ts` (+test),
  `src/features/surveys/client/admin-survey-gateway.ts` (+test),
  `app/api/admin/teams/[teamId]/surveys/route.ts` (+test type only —
  behavior already generically mapped `invalid_*` → 400),
  `src/features/surveys/copy.ts`,
  `src/features/teams/components/AdminTeamDetail.tsx` (+test),
  `src/features/results/domain/aggregation.ts` (+test),
  `src/features/results/server/get-team-survey-results.ts` (new, +test).
  Six other survey test files
  (`open-survey.test.ts`, `close-survey.test.ts`,
  `resolve-survey-for-participation.test.ts`,
  `submit-survey-response.test.ts`, `get-current-team-survey.test.ts`,
  `delete-or-archive-survey.test.ts`) each had one line added to their
  shared valid-survey test fixture (`minimumResponses: 5`) so their
  already-`Done` tests keep passing against the now-stricter
  `isValidSurvey` — no production code in those files changed.
- No route or client gateway was added for `getTeamSurveyResults` in this
  task — deliberately deferred to TASK-012, which wires the UI and needs
  the route/gateway to consume it (see "Implementation notes" above for
  why this keeps the existing results UI/tests untouched in the
  meantime).
- Verification: `pnpm test` — 1235/1235 passed. `pnpm typecheck` — clean.
  `pnpm lint` — clean. `pnpm build` — succeeds; route manifest unchanged
  (this task adds no route handler).
- No deviation from the expanded scope. TASK-012 remains `Ready` and was
  not started; nothing in `app/survey/`, `TeamDetail.tsx`'s results
  section, `TrendChart.tsx`/`TrendTable.tsx`/`PeriodSummary.tsx`, or
  `get-team-results.ts`/its route was touched.

**Post-review fix — BR-26 stale wording and response-level teamId cross-check**
A `review-change` pass on this task found two Important gaps, both fixed
here without reopening scope beyond them:

1. **BR-26 stale wording** (`docs/features/managed-surveys/SPEC.md`): BR-26
   still read "...at or above the configured threshold (5)", contradicting
   this same task's own "Per-survey result threshold" section and
   BR-46/BR-47. Reworded to "...at or above that survey's own persisted
   `minimumResponses`" — no other BR was touched, and the historical "stays
   5" references (Non-goals, "Per-survey result threshold"'s own framing)
   were left as-is since they are already explicitly marked as superseded
   history, not current-state claims.
2. **Response-level `teamId` cross-check** (`get-team-survey-results.ts`):
   responses were grouped into a survey's candidate set purely by their own
   `surveyId` field, read via an unchecked `as RawSurveyResponseDoc` cast —
   the response's own persisted `teamId` (present per TASK-006's
   `SurveyResponseRecord`) was never read or compared against the owning
   survey's `teamId`. Unreachable via any current write path (`surveyId` is
   opaque, unique, and immutably bound to one team at creation; every
   `SurveyResponse` write derives `teamId` from a freshly-read survey in
   the same transaction) — but this removed a defense-in-depth layer this
   same feature applies everywhere else for exactly this class of risk
   (this file's own `survey.teamId !== teamId` survey-document check,
   `open-survey.ts`'s cross-team pointer check, `get-current-team-survey.ts`'s
   post-review fix).

   Fixed in `src/features/results/server/get-team-survey-results.ts`:
   `listResponsesForSurveyIds` now returns raw, unvalidated `unknown[]`
   (the unchecked cast is gone); a new `isValidRawSurveyResponse` guard
   validates each raw document's shape (`surveyId`, `teamId`, and all four
   encrypted-payload fields present and correctly typed); and a new
   `surveysById` lookup (built from the already-resolved `windowed` survey
   list) lets each response be matched to the exact survey it names and
   checked against that survey's own `teamId`. A response that is
   structurally malformed, names no survey in this batch, or has a
   `teamId` that disagrees with its named survey's `teamId` is **excluded**
   — the same "malformed → excluded, never a hard read failure" policy
   `decodeCandidate` (`results/domain/aggregation.ts`) already applies to
   undecryptable ciphertext, now applied one layer earlier to the
   document's own shape, so there remains exactly one corruption policy for
   this operation. An excluded response never reaches `computeSurveyAggregate`
   for that survey, so it can never inflate a response count past a
   survey's `minimumResponses` or shift its published mean.

   Four tests added to `get-team-survey-results.test.ts` ("response-level
   teamId cross-check (post-review fix)", 27 cases total, up from 23): a
   matching-`surveyId`/mismatched-`teamId` response at `minimumResponses: 3`
   (2 genuine + 1 wrong-team) stays `insufficient`; the same shape at
   `minimumResponses: 5` (4 genuine + 1 wrong-team) stays `insufficient`;
   5 genuine + 1 wrong-team still publishes with `count: 5`, never `6`; and
   a response missing `teamId` entirely is excluded rather than counted or
   crashing. All four were verified to genuinely fail against a
   temporarily-reverted, pre-fix version of the grouping loop (restored
   byte-identical immediately after confirming) — the mismatched-`teamId`
   cases incorrectly published (`status: "published"`) and the count-
   inflation case returned `count: 6` instead of `5`, exactly the bug this
   fix closes. All pre-existing tests, including the earlier survey-level
   cross-team test, re-ran unchanged and continue to pass.

   No change to `minimumResponses` range/default, `createSurvey`, the
   admin UI, `authorizeTeamAccess` usage, the `SurveyResultEntry` DTO
   shape, `computeSurveyAggregate`'s aggregation math, backfill/date/
   ordering behavior, the old period-scoped path, `firestore.rules`, or
   `firestore.indexes.json` — confirmed via `git status`/diff inspection
   (neither Firestore config file changed; every new/changed line is
   confined to `get-team-survey-results.{ts,test.ts}` and this SPEC.md/
   TASKS.md pair).

Verification re-run after the fix: `pnpm vitest run --maxWorkers=4` (full
suite) — 1239/1239 passed. `pnpm typecheck` — clean. `pnpm lint` — clean.
`pnpm build` — succeeds, route manifest unchanged (no new/changed route).
TASK-012 was not started; `Ready: 3  In Progress: 0  Done: 11` is
unchanged.

---

### TASK-012 — Results/history UI (chart + table)

**Status:** Done
**Covers:** BR-28 (UI half), BR-29
**Depends on:** TASK-011

**Outcome**
`/teams/[teamId]`'s results section renders the team's survey-instance
history: the existing accessible `TrendTable` and the Recharts
`TrendChart`, both built from the same TASK-011 result array (no separate
fetch), each closed survey shown in true chronological order with its
actual date, a suppressed survey rendered as a gap in the chart (never
zero) and as a non-quantified row in the table.

**Implementation notes**
- Adapt (not replace) `TrendChart.tsx`/`TrendTable.tsx`/`PeriodSummary.tsx`
  to key/label by `surveyId` + resolved date instead of `period` string —
  reuse the existing `buildTrendSeries`/`connectNulls={false}`
  suppression-safe mapping and the fixed `[1, 5]` Y-axis domain unchanged.
- X-axis stays categorical (evenly spaced by occurrence, not
  time-proportional) — labeled with each survey's actual date; a relative
  "X uker siden" label is computed client-side from the current date at
  render time, never persisted or fetched.
- Do not add a new chart library — Recharts only, exactly as already
  adopted.
- `TeamDetail.tsx` wires this into the same page as TASK-010's "Pågående
  undersøkelse" section (two separate sections of one page).

**Verification**
- Component tests: a suppressed survey renders as a chart gap and a
  non-quantified table row, never a zero or a value-looking row; the
  chart and table are demonstrably built from the one fetched array (no
  additional network call from the chart); chronological ordering matches
  the server's.
- Accessibility spot-check (labels, `aria-hidden` chart + visible
  heading/description, no color-only signaling) per `docs/UI-UX.md`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security / privacy**
No additional considerations — this task renders only what TASK-011
already authorized and returned; no client-side computation may derive,
estimate, or interpolate a value the server withheld.

**Documentation impact**
`docs/UI-UX.md` — note the categorical-axis decision as durable UI
direction if it isn't already covered by the existing Charts section
(small addition, folded into TASK-014's broader doc sync if not done
here).

**Acceptance criteria**
- [x] The results view shows the team's actual closed surveys in
      chronological order, with real dates.
- [x] A suppressed survey never renders as zero or as visually
      indistinguishable from a real published value, in chart or table.
- [x] The chart and table are built from one fetched array, no separate
      chart-only request.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- **API switch**: `GET /api/teams/[teamId]/results` (`app/api/teams/
  [teamId]/results/route.ts`) now calls TASK-011's `getTeamSurveyResults`
  instead of the retired calendar-period `getTeamResults`, serializing each
  `SurveyResultEntry`'s `date` (a `Date`) to an ISO string and passing every
  other field through unchanged — no duplicated authorization/threshold
  logic in the route itself. The route path/shape (`{status, teamId,
  results}`) is unchanged from the task brief's "preserve the existing
  route" instruction; only the payload's `current`/`trend` fields were
  replaced by a single `results` array (BR-28's actual-instance history
  fully replaces the old always-empty-`current` + 12-period-`trend` split,
  since a survey-instance history has no separate "current period" slot —
  the latest *eligible* entry is just the array's last element).
- **Client gateway** (`src/features/results/client/team-results-gateway.ts`):
  replaced `PeriodAggregateResult`-based types with a new
  `SurveyResultSummary` DTO (dates as ISO strings, mirroring
  `CurrentTeamSurveySummary`'s own transport convention) and a
  from-scratch shape validator (`isSurveyResultSummary`) that fails closed
  on a missing/blank `surveyId`, invalid `date`, non-integer
  `minimumResponses`, unrecognized `status`, or (for `"published"`) a
  malformed `mean`/`count` — falling back to `"read_failed"` rather than
  ever fabricating a published/insufficient result from malformed data.
- **Latest/current result** (`PeriodSummary.tsx`, kept as the existing
  file/component name per this task's own "adapt, not replace"
  instruction): now takes `result: SurveyResultSummary | null` — `null`
  renders the approved empty state ("Ingen avsluttede undersøkelser
  ennå."); a published entry shows its date (`formatSurveyDate`), optional
  title, per-dimension means, and exact count; an insufficient entry shows
  only the threshold-safe message ("Resultatet vises når minst N personer
  har svart.") — never a count, never "`x av N`". The latest entry is
  computed in `TeamDetail.tsx` as `results[results.length - 1] ?? null`
  (results are chronological ascending per BR-28, so the last element is
  always the most recent) — never derived from `CurrentSurveySection`'s
  independent `scheduled`/`open` discovery (TASK-010), keeping the two
  read boundaries the SPEC requires to stay separate.
- **History table** (`TrendTable.tsx`): renders one row per actual
  `SurveyResultSummary`, keyed by `surveyId` (not a period string), with an
  actual-date column ("Dato") replacing "Periode"; an empty array renders a
  non-sensitive "Ingen avsluttede undersøkelser ennå." message instead of a
  table, rather than an empty `<table>`. A suppressed row shows only the
  threshold-safe message across a spanned cell — no count, no fake
  aggregate.
- **Trend chart** (`TrendChart.tsx`): `buildTrendSeries` now maps
  `SurveyResultSummary[]` (plus an explicit `now`, defaulting to `new
  Date()`) into rows keyed by `surveyId`, each carrying both the
  authoritative formatted date (`formatSurveyDate`, used as the X-axis
  `dataKey`/tick label — categorical, evenly spaced by occurrence, unchanged
  from the existing non-time-proportional axis approach) and a secondary
  `relative` label (`formatRelativeSurveyDate`, e.g. "2 uker siden"),
  surfaced only via the tooltip's `labelFormatter` alongside the actual
  date — never replacing it, never persisted. Suppressed entries remain a
  `null`/gap per dimension (`connectNulls={false}`), never zero; the Y-axis
  domain and per-dimension line/dash styling are unchanged.
- **New presentation helper** (`src/features/results/domain/
  format-survey-date.ts`): `formatSurveyDate` (e.g. "10. jan. 2026",
  `Intl.DateTimeFormat("nb-NO", ...)`) and `formatRelativeSurveyDate` (pure,
  takes `now` explicitly rather than reading the clock itself — "i dag", "1
  dag siden", "N dager/uker/måneder siden"). No new date library — plain
  `Date`/`Intl`, per the task brief's "do not over-engineer date libraries"
  guidance.
- **Copy** (`src/features/results/copy.ts`): removed all
  period/week-based wording ("Sist avsluttede periode", "Trend (siste N
  avsluttede perioder)", the "Periode" column) in favor of
  "Siste undersøkelse"/"Siste undersøkelser", a "Dato" column, and a shared
  `insufficientMessage(minimumResponses)` helper used by both the
  latest-summary and history-table suppressed states, so the exact same
  Norwegian wording is never duplicated or allowed to drift between the two.
- **TeamDetail.tsx**: consumes the new `results: SurveyResultSummary[]`
  field (replacing `current`/`trend`) in its `"authorized"` state; the
  current-survey section (TASK-010) and its independent failure/race
  handling are completely untouched — the two sections still fail and load
  independently, exactly as before.
- **Old period-scoped code left in place for TASK-014**: `src/features/
  results/server/get-team-results.ts` (+ its test), `src/features/results/
  domain/aggregation.ts`'s `computePeriodAggregate`/`MIN_RESPONSE_THRESHOLD`
  (only the new `computeSurveyAggregate`, already added by TASK-011, is
  used by the active path), and `src/features/pulse-survey/domain/
  period.ts` are now unreferenced by any active results code path but were
  not deleted — TASK-014 owns final retirement per this task's scope
  exclusions.
- **Tests**: `app/api/teams/[teamId]/results/route.test.ts` rewritten for
  the new payload shape (including an explicit "never includes count/mean
  for an insufficient entry" assertion and an empty-results-array case);
  `team-results-gateway.test.ts` rewritten with malformed-entry cases
  (missing date, non-numeric count, incomplete `mean`, invalid date string,
  a stray field on an otherwise-insufficient entry never reclassifying it
  as published); new `PeriodSummary.test.tsx` and `TrendTable.test.tsx`
  (neither existed before this task) covering the empty/published/
  suppressed states and an explicit privacy assertion (threshold 5, would-be
  count 4, asserting "4 svar"/"4 av 5" never appear); `TrendChart.test.tsx`
  rewritten for the new `SurveyResultSummary`-based data, the
  `relative`-label tooltip behavior, and irregular/suppressed-gap rendering;
  `TeamDetail.test.tsx` updated throughout (all `current`/`trend` fixtures
  replaced with `results` arrays) — the existing current-survey-section and
  auth/route-race tests were otherwise left behavioral-unchanged, confirming
  TASK-010's independent contract survived this swap untouched. New
  `format-survey-date.test.ts` covers both helpers directly.
- **Docs**: `docs/UI-UX.md`'s "Charts" section gained one bullet recording
  the categorical-axis-for-irregular-occurrences decision and the
  secondary/non-persisted relative-label rule as durable UI direction
  (previously only implicit in the managed-surveys SPEC).
- Verification: `pnpm test` — 1272/1272 passed. `pnpm typecheck` — clean.
  `pnpm lint` — clean. `pnpm build` — succeeds; route manifest unchanged
  (no new route added or removed).
- No deviation from SPEC/TASKS. Scope confirmed via `git status`/`git
  diff`: no `firestore.rules`/`firestore.indexes.json` change from this
  task (the working-tree `firestore.rules` diff predates it, from
  TASK-002/003); no recurrence/scheduling, threshold-editing, raw-response
  UI, migration script, or new chart library was introduced; TASK-013 and
  TASK-014 were not started.

---

### TASK-013 — Home/nav auth-aware cleanup

**Status:** Done
**Covers:** BR-38, BR-39
**Depends on:** TASK-010

**Outcome**
Home (`app/page.tsx`) becomes auth-aware: a signed-out visitor sees
"Logg inn"/"Opprett konto" and an explanation of DevPulse; a signed-in
visitor never sees either action, and instead sees relevant next actions
(e.g. "Mine team"). Home and the site header no longer link to a single
static public survey — that concept no longer exists once surveys are
admin-managed instances discovered via `/survey/{surveyId}` links (team
page or external sharing), not a generic Home CTA.

**Implementation notes**
- `app/page.tsx` becomes a small Client Component (or delegates to one)
  subscribing to the existing `observeIdToken`/`useAuthGatedResource`
  pattern already used by `SiteHeader.tsx` — reuse that pattern, don't
  invent a second one.
- Remove the "Svar på undersøkelsen" (→ `/pulse-survey`) and adjust "Se
  resultater" CTAs from `app/page.copy.ts`/`page.tsx`; signed-out Home
  keeps only "Logg inn"/"Opprett konto" plus explanatory copy (privacy/
  anonymity framing per `docs/UI-UX.md`); signed-in Home offers "Mine
  team" (→ `/teams`) and no sign-in/sign-up actions.
- Team results/survey discovery is still not directly navigable from
  signed-out Home (unchanged posture) — this task does not add a
  survey-search or team-list to Home.
- Depends on TASK-010 only in sequencing spirit (the new discovery path
  should exist before the old CTA is fully removed) — no direct code
  import between the two.

**Verification**
- Component tests: signed-out Home shows sign-in/sign-up, no team/survey
  data; signed-in Home never shows sign-in/sign-up, shows "Mine team";
  neither state links to `/pulse-survey`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security / privacy**
Presentation only — this task grants no new capability and must not let
Home expose any protected team/result metadata to a signed-out visitor.

**Documentation impact**
None expected yet (TASK-014).

**Acceptance criteria**
- [x] Home never shows "Logg inn"/"Opprett konto" to a signed-in visitor.
- [x] Home and the header no longer link to `/pulse-survey`.
- [x] Relevant tests, `pnpm lint`, `pnpm typecheck` pass.

**Implementation notes (actual)**
- `app/page.tsx`: converted to a `"use client"` component using the exact
  `observeIdToken` subscription already established by `SiteHeader.tsx`
  (via the shared `useAuthGatedResource` hook — no new pattern) to derive a
  single `isSignedIn` boolean. No `fetchOwnAdminStatus`-style follow-up
  read is needed here — Home's action row depends only on signed-in/out,
  never on admin status. Before the first `observeIdToken` emission,
  `isSignedIn` starts `false`, so Home fails closed to the signed-out
  action set exactly like `SiteHeader`'s own documented "loading renders as
  signed-out" convention — never a momentary "Mine team" flash for a
  visitor who turns out to be signed out.
- `app/page.copy.ts`: removed `actions.answerPulse` (→ `/pulse-survey`) and
  `actions.viewResults` (→ `/results`) entirely — neither survives in
  either auth state, per the task's own implementation notes ("signed-out
  Home keeps only Logg inn/Opprett konto... signed-in Home offers Mine
  team... and no sign-in/sign-up actions" — no CTA in either state was
  specified to link to `/results`, so it was dropped rather than kept for
  one state only). Added `actions.myTeams` (`"Mine team"` → `/teams`).
  Title/description/privacy-note copy is unchanged and renders
  unconditionally in both auth states — it is generic product framing, not
  protected data, so gating it on auth state would be unnecessary
  complexity beyond what BR-38/BR-39 ask for.
- `src/components/nav/SiteHeader.tsx`: removed the `/pulse-survey` link
  from both the signed-in and signed-out/loading nav-link sets (BR-39
  applies to the header, not just Home). `src/components/nav/copy.ts`: 
  removed the now-unused `pulseSurvey` copy key.
- The `/pulse-survey` route and `src/features/pulse-survey/` themselves are
  untouched — only the nav entry points into it were removed, per this
  task's scope; the route's actual retirement is TASK-014's job.
- Tests: `app/page.test.tsx` rewritten around the same
  `observeIdToken`-mocking pattern `SiteHeader.test.tsx` already uses
  (fail-closed-before-first-emission, signed-out, signed-in cases; a
  regression asserting no `/pulse-survey` or `/results` link survives in
  either state). `src/components/nav/SiteHeader.test.tsx`: updated the
  signed-in/signed-out expected link sets, replaced the aria-current test's
  now-removed `/pulse-survey` target with `/sign-in`, and added a
  regression asserting no `<a href="/pulse-survey">` exists in the nav in
  either auth state.
- No new capability, no auth/authorization change, no protected
  metadata exposed to a signed-out visitor — presentation-only, exactly as
  scoped.
- Verification: `pnpm test` (1277/1277 passed), `pnpm typecheck` (clean),
  `pnpm lint` (clean), `pnpm build` (succeeds; `/` remains in the route
  manifest, no new routes). Confirmed via `git diff` that only
  `app/page.tsx`, `app/page.copy.ts`, `app/page.test.tsx`,
  `src/components/nav/SiteHeader.tsx`, `src/components/nav/SiteHeader.test.tsx`,
  and `src/components/nav/copy.ts` changed for this task; `firestore.rules`/
  `firestore.indexes.json` untouched by this task (their working-tree
  diffs predate it). TASK-014 was not started — no deletion of
  `src/features/pulse-survey/`, `app/pulse-survey/`, or
  `app/api/pulse-survey/` occurred.

---

### TASK-014 — Retire old period-based runtime + documentation sync (closeout)

**Status:** Done
**Covers:** (no new BRs — closeout/retirement only; regression coverage for BR-1 through BR-42 as a whole)
**Depends on:** TASK-007, TASK-008, TASK-009, TASK-010, TASK-012, TASK-013

**Outcome**
The old, superseded period-based survey runtime is deleted — not adapted,
not kept alongside the new model — and durable documentation is
synchronized to reflect the now-implemented feature. This task contains
no new product behavior; it only removes what's been fully superseded and
brings docs in line with what TASK-001 through TASK-013 actually built.

**Implementation notes**
- Delete: `src/features/pulse-survey/` in its entirety (`domain/period.ts`,
  `domain/validation.ts`, `server/submit-pulse-survey.ts`,
  `components/PulseSurveyForm.tsx`, and their tests), `app/pulse-survey/
  page.tsx`, `app/api/pulse-survey/route.ts`.
- Remove the `pulseSurveyResponses` collection's rule block from
  `firestore.rules` and its `(teamId, period)` composite index from
  `firestore.indexes.json` (the collection itself has no real data to
  migrate, per this session's explicit clarification — nothing to
  export/preserve).
- Confirm TASK-011 already fully replaced
  `src/features/results/domain/aggregation.ts`'s period-shaped surface
  and `get-team-results.ts`'s `(teamId, periods[])` read — this task
  double-checks no dead period-shaped code remains, it does not redo that
  adaptation.
- Do not touch `src/features/teams/` (Team, TeamMembership,
  `authorizeTeamAccess`, invitations, access requests), `src/features/
  auth/` beyond TASK-008's already-landed change, `src/lib/encryption/`,
  or `src/components/ui/` — everything outside the retired
  pulse-survey/period surface is preserved as-is.
- Add a superseded-note to `docs/features/pulse-survey/SPEC.md` and
  `docs/features/results-dashboard/SPEC.md` pointing at this feature,
  mirroring exactly how `results-dashboard/SPEC.md` already carries one
  pointing at `team-management/SPEC.md` — do not rewrite either spec's
  historical content.
- Update `docs/PRODUCT.md` (survey instances / configurable access
  replacing the always-on weekly survey; renumbered future phases),
  `docs/ARCHITECTURE.md` (lifecycle-derivation pattern, the
  `authorizeTeamAccess` + actual-membership refinement, `SurveyParticipation`
  now implemented — update its "Open questions" entry accordingly),
  `docs/DATA-MODEL.md` (replace the `Survey`/`SurveyResponse`/
  `SurveyParticipation` rows with the concrete implemented shapes),
  `docs/UI-UX.md` (admin survey-management surface, categorical-axis
  chart decision, if not already captured by TASK-012), `docs/
  DEVELOPMENT.md` (new collections/indexes/rules actually deployed, retire
  any now-obsolete local-setup step referencing the old model).
- Re-walk the `docs/SECURITY.md` feature review checklist explicitly (no
  new invariant number expected — this phase is the first concrete
  implementation of invariants 7 and 17's participation/admin-eligibility
  distinctions) and record the walk-through's outcome in this task's
  completion notes.
- Full cross-feature regression pass: every acceptance criterion in
  `docs/features/pulse-survey/SPEC.md`, `docs/features/
  results-dashboard/SPEC.md`, `docs/features/team-management/SPEC.md`, and
  `docs/features/product-ux-shell/SPEC.md` that is still applicable
  (team/membership/admin/auth/UI-shell behavior — everything except the
  now-retired period/pulse-survey-specific ones) still passes.

**Verification**
- Full automated suite (`pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm build`) passes with the old code removed.
- A search of the codebase confirms no remaining import of
  `src/features/pulse-survey/` or `pulseSurveyResponses` outside this
  task's own deletions.
- Manual (or automated, if feasible) end-to-end check: create → open →
  submit (both access modes) → close → results published/suppressed
  correctly → archive/delete, against a real or emulated Firestore
  project, deploying the updated `firestore.rules`/`firestore.indexes.json`.
- Every one of BR-1 through BR-42's acceptance criteria (SPEC.md) is
  re-confirmed against the final, fully-integrated state — not just each
  task's own narrower tests in isolation.

**Security / privacy**
This task is a deletion/documentation pass, not a place to introduce new
behavior — if anything discovered here looks like a missing security
behavior rather than dead code, stop and route it back through `debug` or
`plan-feature` rather than patching it inline in a closeout task.

**Documentation impact**
`docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`,
`docs/SECURITY.md` (checklist re-walk, no new invariant expected),
`docs/UI-UX.md`, `docs/DEVELOPMENT.md`, `docs/features/pulse-survey/
SPEC.md` and `docs/features/results-dashboard/SPEC.md` (superseded-notes
only, historical content preserved).

**Acceptance criteria**
- [x] `src/features/pulse-survey/`, `app/pulse-survey/page.tsx`, and
      `app/api/pulse-survey/route.ts` no longer exist.
- [x] `pulseSurveyResponses`'s rule block and composite index are removed
      from `firestore.rules`/`firestore.indexes.json`.
- [x] `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`,
      `docs/UI-UX.md`, `docs/DEVELOPMENT.md` reflect the now-implemented
      feature; `docs/SECURITY.md`'s checklist has been explicitly
      re-walked.
- [x] `docs/features/pulse-survey/SPEC.md` and `docs/features/
      results-dashboard/SPEC.md` carry a superseded-note, unchanged
      otherwise.
- [x] Every BR-1 through BR-42 acceptance criterion in SPEC.md passes
      against the final integrated state (via each owning task's own
      automated coverage, re-run together as part of the full suite below
      — no live/emulated Firestore end-to-end run was performed; see
      "Implementation notes (actual)").
- [x] Full automated suite (`pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm build`) passes.

**Implementation notes (actual)**
- Deleted (all previously tracked in git): `app/pulse-survey/page.tsx`,
  `app/api/pulse-survey/route.{ts,test.ts}`, `src/features/pulse-survey/`
  in its entirety (`domain/period.{ts,test.ts}`,
  `domain/validation.{ts,test.ts}`, `server/submit-pulse-survey.{ts,test.ts}`,
  `components/PulseSurveyForm.{tsx,test.tsx}`, `copy.ts`), and the old
  calendar-period results path:
  `src/features/results/server/get-team-results.{ts,test.ts}`. Confirmed
  by `git status`/`git diff` that no other file was deleted.
- `src/features/results/domain/aggregation.ts`: removed
  `computePeriodAggregate`, `PeriodAggregateResult`,
  `ComputePeriodAggregateDeps`, `MIN_RESPONSE_THRESHOLD`, and the
  `pulse-survey/domain/period` import; `computeSurveyAggregate` (TASK-011)
  and its types are the only aggregation surface left. Removed the
  corresponding `describe("computePeriodAggregate", ...)` block from
  `aggregation.test.ts` (the `computeSurveyAggregate` describe block is
  unchanged).
- `firestore.rules`: removed the `pulseSurveyResponses` deny block (the
  `surveys`/`teamSurveyState`/`surveyResponses`/`surveyParticipations` deny
  blocks, added by TASK-002/003/006, and the final catch-all deny were
  already present and are unchanged). Two now-dangling comment references
  to "pulseSurveyResponses above" (in the `teams` and `surveyResponses`
  blocks) were reworded to reference the pattern generically rather than a
  since-deleted block. `firestore.indexes.json`: removed
  `pulseSurveyResponses`'s `(teamId, period)` composite index; the
  `teamInvitations`/`teamAccessRequests` indexes are unchanged, and no new
  index was needed for `surveys`/`surveyResponses` (single-field queries,
  per SPEC's "Firestore/index implications"). Updated
  `firestore-deployment-config.test.ts` to drop the now-obsolete
  `pulseSurveyResponses` deny-block assertion; its four survey-collection
  deny-block assertions (added by TASK-002/003/006) and the "no
  unconditional allow anywhere" test are unchanged and still pass.
- Final active protected results path confirmed by reading
  `app/api/teams/[teamId]/results/route.ts` and
  `src/features/results/server/get-team-survey-results.ts`: `GET
  /api/teams/[teamId]/results` → `getTeamSurveyResults` →
  `authorizeTeamAccess` → each of the team's closed `Survey` instances
  (`effectiveLifecycle(survey, now) === "closed"`, cross-checked against
  the queried `teamId`) → that survey's own `surveyResponses` (queried by
  `surveyId`, cross-checked against the survey's own `teamId`) →
  `computeSurveyAggregate` against `survey.minimumResponses` (never a
  global/default) → a privacy-safe `SurveyResultEntry[]` DTO (`surveyId`,
  optional `title`, `date`, `minimumResponses`, and only `{mean, count}`
  once published) → `TeamDetail.tsx` → `PeriodSummary`/`TrendChart`/
  `TrendTable`. No dead period-shaped code remained to remove beyond
  `get-team-results.ts` and `aggregation.ts`'s period surface above.
- `/pulse-survey`: route removed, no compatibility redirect added (not
  requested by SPEC — BR-39 retires the concept outright). Confirmed
  absent from the `pnpm build` route manifest (see below).
- `/results`: left untouched — confirmed (via `ResultsRedirect.tsx` and
  `app/results/page.tsx`) it is Team Management's own compatibility
  redirect (`docs/features/team-management/SPEC.md` BR-33/BR-34), unrelated
  to the retired period/pulse-survey runtime; still present in the route
  manifest as a static route.
- Full grep sweep for `pulseSurveyResponses`, `/pulse-survey`,
  `/api/pulse-survey`, `periodKey`, `currentPeriod`, `computePeriodAggregate`,
  `MIN_RESPONSE_THRESHOLD`, `listPrecedingClosedPeriods`,
  `getCurrentSurveyPeriod`, `isPeriodClosed`, and `getTeamResults`: every
  remaining hit (after the deletions/edits above) is a comment in
  `src/features/teams/` (`seed-legacy-teams.ts`, `legacy-team-seed.ts`),
  `src/features/surveys/` (`survey.ts`, `answers.ts`, `copy.ts`,
  `SurveyResponseForm.tsx`), `SiteHeader.tsx`/`.test.tsx`, or a historical
  feature doc (`docs/features/team-management/`, `product-ux-shell/`,
  `results-dashboard/TASKS.md`, `pulse-survey/TASKS.md`) explaining lineage
  or describing a past phase's own contract as it was at the time —
  classified **historical/justified**, none **dead** (no remaining code
  path imports or calls a retired module). Two stale docstrings that
  described a *still-consumed* function (`listActiveTeams` in
  `list-active-teams.ts`; a "pulse-survey team selector" comment in
  `list-teams.ts`) as if pulse-survey were still a live consumer were
  updated to reflect the actual current-only consumer (`/teams` overview),
  since those were misleading about *live* behavior rather than purely
  historical. `app/api/teams/[teamId]/results/route.ts` and
  `get-current-team-survey.ts` each had one comment referencing the
  now-deleted `getTeamResults`/its retirement timing, reworded to be
  accurate post-deletion.
- Security/privacy regression (checked against existing automated
  coverage, re-run as part of the full suite — no new behavior was
  introduced by this task, so no new tests were added): public surveys
  answerable anonymously, authenticated surveys require actual
  `teamMemberships`, an app admin without membership is rejected
  (BR-16, `submit-survey-response.test.ts`/`resolve-survey-for-
  participation.test.ts`), `SurveyResponse` contains no `uid`/`email`
  (`submit-survey-response.test.ts`), `SurveyParticipation` contains no
  `responseId` (`submit-survey-response.test.ts`), public repeat
  submissions succeed independently, authenticated duplicate prevention is
  transactional/atomic (`open-survey.test.ts`-style concurrency fake reused
  in `submit-survey-response.test.ts`), each survey's own
  `minimumResponses` is authoritative with no cross-survey pooling and no
  global-threshold leakage (`get-team-survey-results.test.ts` "threshold
  matrix" and "no global threshold leaks" cases), no exact count/aggregate
  is ever returned below threshold, an app admin gets no threshold bypass
  (`get-team-survey-results.test.ts`), a `scheduled`/`open` survey never
  exposes results (BR-27), client Firestore access remains denied for
  every collection (`firestore-deployment-config.test.ts`), and no raw
  response is ever exposed to a client. `docs/SECURITY.md`'s feature
  review checklist (11 items) was explicitly re-walked against this final
  state: every item holds, with no new invariant number needed — this
  phase is the first concrete implementation of invariants 7 and 17's
  participation/admin-eligibility distinctions, both already stated before
  this feature existed.
- Secret/logging sweep: no `console.*` calls in `src/` or `app/`; no raw
  error detail, decrypted answers, tokens, or emails found in any changed
  file; no `.env*`, service-account, or other credential file touched; no
  `.next/`, `node_modules/`, or `*.tsbuildinfo` path staged (confirmed via
  `git status --short`).
- **Deviation from the literal verification checklist**: "manual (or
  automated) end-to-end check... against a real or emulated Firestore
  project" was not performed — this environment has no live/emulated
  Firebase project available, and provisioning one is outside this task's
  scope (`CLAUDE.md` — no infrastructure changes without an explicit
  request). Every behavior that check would exercise is instead covered by
  each owning task's own Firestore-transaction-faithful in-memory
  transactional fakes (the same pattern `open-survey.test.ts`/
  `close-survey.test.ts`/`submit-survey-response.test.ts` already
  established and verified against real Firestore's read-before-write
  transaction rule — see TASK-004's "Post-`Done` debug fix"), re-run
  together here as part of the full suite. This is a real, disclosed gap
  in end-to-end deployment verification, not a silently skipped
  requirement.
- Verification: `pnpm test` (1191/1191 passed across 98 files), `pnpm
  typecheck` (clean), `pnpm lint` (clean), `pnpm build` (succeeds; route
  manifest confirms `/pulse-survey` and `/api/pulse-survey` are absent and
  `/survey/[surveyId]`, `/api/surveys/[surveyId]`,
  `/api/surveys/[surveyId]/responses`, `/api/admin/teams/[teamId]/surveys*`,
  `/api/teams/[teamId]/current-survey`, and `/api/teams/[teamId]/results`
  are present; `/results` remains present as a static route).
- Scope confirmed via `git status --short`/`git diff --stat`: this task's
  own changes are the deletions listed above plus `firestore.rules`,
  `firestore.indexes.json`, `firestore-deployment-config.test.ts`,
  `aggregation.ts`/`aggregation.test.ts`, seven `docs/*.md` files, two
  historical `docs/features/*/SPEC.md` superseded-notes,
  `list-active-teams.ts`/`list-teams.ts` (comment-only), and this
  feature's own `SPEC.md`/`TASKS.md`. No `src/features/teams/` behavior,
  `src/features/auth/` behavior, `src/lib/encryption/`, or
  `src/components/ui/` file was touched, per the task's own "do not touch"
  list. No new product behavior was introduced.
