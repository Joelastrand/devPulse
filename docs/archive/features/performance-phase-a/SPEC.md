# Performance Phase A — Low-Risk Latency Improvements

## Status
Approved

## Problem

The completed performance audit (see conversation record; no separate audit
document exists in the repository) found that DevPulse's admin and team
detail pages carry avoidable latency and client-bundle weight that is
independent of the larger authentication/authorization request-fan-out
architecture:

- `listTeamMembers` and `listTeamAccessRequests`
  (`src/features/teams/server/list-team-members.ts`,
  `src/features/teams/server/list-team-access-requests.ts`) each resolve
  every member's/requester's email via a **sequential**, one-at-a-time
  Firebase Auth Admin `getUser(uid)` call inside a `for` loop. On
  `/admin/teams/[teamId]`, a team with N members or pending requests pays N
  serial Firebase Auth round trips before that section can render.
- `getOrgSkillProgressOverview`
  (`src/features/skill-trees/server/get-org-skill-progress-overview.ts`)
  issues three genuinely independent Firestore reads (`skillTrees`,
  `skillProgress`, `teams`) as three separate sequential `await`s, even
  though none of the three depends on another's result — the join happens
  entirely in memory afterward.
- `TrendChart` (`src/features/results/components/TrendChart.tsx`), which
  wraps the `recharts` charting library (the single largest client-JS chunk
  in a production build, confirmed at ~388KB), is imported statically and
  unconditionally into `TeamDetail.tsx`, so its full bundle weight loads for
  every authorized `/teams/[teamId]` view — including a team with zero
  closed survey results, where `TrendChart` already renders nothing.

None of these require any change to `verifyIdToken`, `authorizeTeamAccess`,
`requireAppAdmin`, or the request-fan-out shape of any page — they are
narrow, independently safe optimizations to code that already exists,
correcting sequential execution of work that has no actual ordering
dependency, and deferring a large, conditionally-unnecessary client bundle.

## User outcome

- An app admin viewing `/admin/teams/[teamId]` sees the member list and
  pending-access-request list resolve without waiting on each member's/
  requester's identity lookup one at a time.
- An app admin viewing `/admin/skills`'s cross-team overview section sees it
  fetch its three independent data sources concurrently rather than in
  series.
- A team member/admin viewing `/teams/[teamId]` does not pay for loading
  `recharts` when their team has no closed survey results to chart, and
  loads it efficiently (with a visible, accessible loading state) when there
  is something to chart.

No visitor-observable behavior, authorization decision, DTO shape, ordering
guarantee, or error classification changes anywhere in this phase.

## Scope

- **A** — Parallelize per-uid Firebase Auth email resolution in
  `listTeamMembers`.
- **B** — Parallelize per-uid Firebase Auth email resolution in
  `listTeamAccessRequests`.
- **C** — Run `getOrgSkillProgressOverview`'s three independent reads
  (`skillTrees`, `skillProgress`, `teams`) concurrently, strictly after
  `requireAppAdmin` has already succeeded.
- **D** — Code-split `TrendChart` out of `TeamDetail`'s eagerly-loaded
  client bundle via `next/dynamic`, skip loading/mounting it entirely
  when there are no results to chart, and wrap it in a small, chart-local
  error boundary (see AD-6) so a chunk-load or render failure never affects
  the rest of `/teams/[teamId]`.

## Out of scope

Explicitly excluded from this phase (all belong to a separately gated
Performance Phase B, or are rejected outright — see "Performance Phase B
boundary" and "Security and privacy" below):

- Consolidating or reducing `verifyIdToken` calls.
- Any `authorizeTeamAccess` caching, memoization, or reuse across requests.
- Composed/aggregating page-level server endpoints.
- Any Server Component data-loading redesign.
- Any session-lived or cross-request authorization caching.
- Disabling or weakening `checkRevoked`.
- Redesigning `TeamDetail`'s overview→batch fetch concurrency.
- Any change to `SiteHeader`'s `/api/me` behavior.
- Adding `.limit()` bounds to any currently-unbounded Firestore query
  (`listActiveTeams`, `getTeamSurveyResults`'s survey/response reads,
  `listTeamChallengesForMember/Admin`, `getOrgSkillProgressOverview`'s
  `teams` read, etc.).
- Any pagination.
- Any change to Team Forum's encrypted-payload/schema shape, or to which
  fields `listTeamThreads` decrypts.
- Changing the `dev` npm script (e.g. adding `--turbopack`).
- Any product/feature work, including Phase 10 (`org-forum-overview`).
- Introducing a Firebase Admin SDK batch-lookup API (`getUsers()`) — see
  "Architecture decisions" for why this was evaluated and rejected for A/B.

## Key concepts

- **Sequential N+1 lookup**: a loop that awaits one external call (here,
  `getUser`) per item, one at a time, when the calls have no dependency on
  each other.
- **Independent read**: a data read whose inputs and execution do not depend
  on another read's result or completion.
- **Code-splitting / dynamic import**: deferring a JavaScript module's
  network fetch until the component that needs it actually renders, via
  Next.js's `next/dynamic`.
- **Behavior-preserving optimization**: a change to *how* work executes
  (ordering, concurrency, loading timing) that does not change *what* any
  caller observes (return value, error classification, rendered output).

## Actors and access

No new actor and no access change. Unchanged from the operations already in
place:

- A, B: app admin only (via `requireAppAdmin`, unchanged).
- C: app admin only (via `requireAppAdmin`, unchanged; `getOrgSkillProgressOverview`
  performs no `authorizeTeamAccess`-shaped check, unchanged).
- D: any caller already authorized to view `/teams/[teamId]`'s results
  section (unchanged from today's `TeamDetail`/`authorizeTeamAccess` gate).

## User stories

1. As an app admin, I want `/admin/teams/[teamId]`'s member list and
   pending-access-request list to resolve without serialized per-person
   identity lookups, so the page renders faster for teams with many members
   or requests.
2. As an app admin, I want `/admin/skills`'s cross-team overview to fetch
   its three independent data sources concurrently, so the overview section
   isn't held up by three round trips run one after another.
3. As a team member/admin, I want `/teams/[teamId]` to avoid loading
   charting library code when my team has no results to chart, and to load
   it with visible feedback when there is something to chart, so the page's
   initial JavaScript payload is smaller for the common "no chart needed"
   case.

## Behavioral requirements

### A — `listTeamMembers`

- **BR-1**: For a given set of raw `teamMemberships` documents, the returned
  `members` array contains the same entries, in the same order (the order
  `uids` is derived in today, from the Firestore query result), regardless
  of whether identity lookups execute sequentially or concurrently.
- **BR-2**: A `uid` whose `getUser` lookup fails (rejects, for any reason —
  e.g. a deleted account) is excluded from the result exactly as today,
  without causing the overall operation to fail and without preventing any
  other `uid`'s lookup from succeeding.
- **BR-3**: No new upper bound on team size (e.g. an identifier-count cap
  from a batch lookup API) is introduced. Any team size that succeeds today
  continues to succeed.
- **BR-4**: `requireAppAdmin` continues to run, and must succeed, before any
  identity lookup begins — unchanged from today.

### B — `listTeamAccessRequests`

- **BR-5**: Mirrors BR-1 for `listTeamAccessRequests`'s `requests` array —
  same entries (`uid`, `email`, `createdAt`), same order, regardless of
  lookup concurrency.
- **BR-6**: Mirrors BR-2 — a failing `uid` lookup excludes only that
  request, never the whole result.
- **BR-7**: Mirrors BR-3 — no new team/request-count cap is introduced.
- **BR-8**: Mirrors BR-4 — `requireAppAdmin` still gates every identity
  lookup.

### C — `getOrgSkillProgressOverview`

- **BR-9**: `requireAppAdmin` completes successfully before any of the
  three reads (`skillTrees`, `skillProgress`, `teams`) is invoked. If
  `requireAppAdmin` fails (`unauthenticated` or `forbidden`), none of the
  three reads is ever attempted.
- **BR-10**: Once `requireAppAdmin` has succeeded, the three reads may
  execute concurrently; none is required to wait for another's completion
  before starting.
- **BR-11**: If any one of the three reads fails (rejects), the operation
  returns `{ ok: false, error: "read_failed" }` and never returns a
  partial or raw result alongside it — unchanged from today, regardless of
  which read failed or whether the others had already settled.
- **BR-12**: For identical underlying `skillTrees`/`skillProgress`/`teams`
  data, the validation, join, ordering (`createdAt` ascending for trees,
  `name` then `teamId` ascending for teams within a tree), and truncation
  behavior already specified in
  `docs/features/org-skill-progress-overview/SPEC.md` (BR-1 through BR-27)
  produce byte-identical output, regardless of the three reads' concurrency.

### D — `TrendChart` code-splitting

- **BR-13**: For any given `results` input, `TrendChart`'s rendered output —
  including rendering nothing for `results.length === 0` — is unchanged
  from today's behavior once the component has loaded and rendered.
- **BR-14**: The `recharts` library and the module(s) that import it are not
  part of `/teams/[teamId]`'s eagerly-loaded (initial) client bundle; they
  load only when a `TrendChart` render is actually about to happen.
- **BR-15**: When an authorized team view has zero results
  (`result.results.length === 0`), no chart-related module fetch is
  triggered at all — not merely an early return after the module has
  already loaded. The visual outcome (nothing rendered where the chart
  would be) is identical to today's.
- **BR-16**: While the chart module is loading for a non-empty-results view,
  the chart's section shows a visible, accessible loading indication
  (reusing the application's existing loading-state UI primitive) — never a
  blank gap, consistent with `docs/UI-UX.md`'s "Loading" interaction-state
  requirement.
- **BR-17**: No change to `computeSurveyAggregate`, `getTeamSurveyResults`,
  `PeriodSummary`, or `TrendTable` — the data `TrendChart` receives, and
  every other section of `/teams/[teamId]`, is byte-identical to today.
- **BR-18**: A failure to load or render the dynamically-imported chart
  module (e.g. a chunk-fetch network error, or an error thrown while
  rendering `TrendChart` once loaded) is isolated to the chart's own
  section: it does not remove, replace, or blank any other already-rendered
  content on `/teams/[teamId]` (team heading, current-survey section,
  `PeriodSummary`, `TrendTable`, challenges, forum, skills), does not
  trigger any page-level/global error state, and does not cause any
  additional data fetch (sensitive or otherwise) beyond what already
  happened before the chart attempted to load.

## Edge cases and failure behavior

- **A/B**: zero members/requests → empty result array, zero `getUser`
  calls attempted (unchanged). Exactly one member/request → identical
  single-lookup behavior. A mix of succeeding and failing lookups → only
  the failing `uid`(s) excluded, all others present, in original order.
- **C**: `requireAppAdmin` fails → zero reads attempted (BR-9). Exactly one
  of the three reads fails → whole operation is `read_failed`, regardless
  of which one, and regardless of whether the other two had already
  resolved successfully in the interim (BR-11). All three succeed → normal
  join proceeds exactly as today.
- **D**: A team with zero closed survey results → no `recharts` chunk
  fetched, section renders nothing (matches today's `TrendChart` internal
  `results.length === 0` early return, now reached without ever loading the
  module). A team with results → chart module loads, a loading indication
  is shown briefly, then the chart renders identically to today's output.
  A chart-module load/render failure (e.g. a network error fetching the
  chunk, or a rendering exception once it loads) is a new failure mode that
  did not exist when the module was bundled eagerly. Per BR-18, it is
  isolated to the chart's own section via a small, chart-local error
  boundary (see AD-6) — already-rendered content on the rest of the page
  remains visible and interactive, and no global/page-level error state is
  triggered. This extends, to a render-time failure, the same "a section's
  own failure never hides another section" convention `TeamDetail.tsx`
  already applies to fetch failures across results/current-survey/
  challenges/forum/skills. The exact fallback copy/markup is left to
  implementation, constrained by AD-6's requirements (chart-local, no data
  fetching, no auth logic, no product logic, no retry framework required).

## Security and privacy

- No authorization decision, actor, or access boundary changes anywhere in
  this phase. `requireAppAdmin` (A, B, C) and `authorizeTeamAccess`
  (upstream of D, unchanged) run exactly as they do today, with `checkRevoked`
  preserved unmodified.
- No new data is returned to any caller who would not already receive it
  today; no DTO field is added, removed, or renamed.
- **Firebase Admin SDK batch lookup (`getUsers()`) was evaluated and
  rejected for A/B**: inspecting `firebase-admin@14.3.0`'s own
  implementation and type definitions shows `getUsers()` (1) provides no
  ordering guarantee ("the nth entry in the result list is not guaranteed
  to correspond to the nth entry in the input parameters list" — SDK
  doc comment), which would require additional re-ordering logic to match
  today's guaranteed order, and (2) throws entirely for more than 100
  identifiers in one call, introducing an unreviewed team-size ceiling that
  does not exist today. Using it would also collapse today's per-`uid`
  failure isolation (one bad lookup excludes only that entry) into a single
  batch call whose own transient failure could plausibly drop the whole
  list. Per this phase's behavior-preservation requirement, `Promise.all`
  over the existing per-`uid` `getUser` call is used instead — see
  "Architecture decisions."
- D introduces no new data exposure: `TrendChart` receives exactly the same
  `results` data it does today, from the same already-authorized fetch; only
  *when* its own code loads changes, not what it is given or shown.
- Bundle-splitting a UI library does not touch `docs/SECURITY.md`'s
  encryption, aggregation-threshold, or team-isolation invariants.

## Architecture decisions

- **AD-1 (Decided, final)**: A and B use `Promise.all` over the existing
  per-`uid` `getUser` call (each wrapped in its own try/catch, mapped to
  `null` on failure and filtered afterward) rather than the SDK's batch
  `getUsers()`. Reconfirmed directly against the installed
  `firebase-admin@14.3.0` source/type definitions: `getUsers()`'s own doc
  comment states "there are no ordering guarantees; in particular, the nth
  entry in the result list is not guaranteed to correspond to the nth entry
  in the input parameters list," and it "throws a `FirebaseAuthError`" for
  more than 100 identifiers in one call. Per-`uid` `getUser` has neither
  limitation: it preserves exact input order (via `Array.map`/`Promise.all`
  positional semantics) and isolates each identity's failure independently,
  with no team/request-count ceiling. This decision is final —
  `implement-task` must not re-evaluate `getUsers()` for A or B.
- **AD-2 (Decided, final)**: C's three reads (`skillTrees`, `skillProgress`,
  `teams`) run via `Promise.all`, constructed and issued only *after*
  `requireAppAdmin`'s own `await` has resolved successfully — never before,
  and never for a caller who fails that check. Explicitly forbidden as an
  anti-pattern: including `requireAppAdmin(...)` itself as one of the
  `Promise.all` entries (e.g. `Promise.all([requireAppAdmin(...), read1(),
  read2(), read3()])`) — this would start protected reads concurrently with,
  not strictly after, authorization, and must never appear in the
  implementation. `requireAppAdmin` remains a sequential, blocking
  prerequisite; only the three already-authorized reads become concurrent
  with each other.
- **AD-3 (Decided)**: D uses Next.js `next/dynamic` to load `TrendChart` on
  demand from its existing call site in `TeamDetail.tsx` (`TrendChart`'s own
  file, exports, and every other consumer are unaffected — it has exactly
  one call site today). The call site additionally gates on
  `result.results.length > 0` before rendering the dynamically-imported
  component at all, so an empty-results view never triggers the chunk
  fetch (BR-15) — `TrendChart`'s own internal `results.length === 0` guard
  remains as defense-in-depth, not the sole mechanism.
- **AD-4 (Decided)**: The dynamic-import loading fallback reuses the
  existing `LoadingState` UI primitive (`src/components/ui/LoadingState.tsx`),
  consistent with `docs/UI-UX.md`'s established loading-state convention,
  rather than introducing a new one.
- **AD-5 (Decided, resolved)**: The dynamic import uses Next.js's documented
  named-export pattern directly at the `TeamDetail.tsx` call site —
  `dynamic(() => import(".../TrendChart").then((mod) => mod.TrendChart),
  { ssr: false, loading: () => <LoadingState ... /> })` — verified against
  this repository's installed Next.js (`16.3.4`) lazy-loading documentation,
  which documents exactly this named-export form. `ssr: false` is used
  because `TeamDetail` is already a Client Component (`"use client"`) with
  no server-rendered data for this content to begin with, and the
  installed docs confirm `ssr: false` is valid (only) inside a Client
  Component. This does **not** change `TrendChart.tsx`'s existing named
  export, add a default export, move survey/result fetching, or introduce
  a generic/reusable lazy-loading abstraction — it is a single `dynamic()`
  call at one existing call site. `implement-task` may choose whether the
  `dynamic()` call is written inline in `TeamDetail.tsx` or in a small
  colocated wrapper file; it may not choose a different mechanism (e.g.
  `React.lazy` directly, a third-party lazy-loading library, or a generic
  "LazyChart" abstraction reused elsewhere). `TrendChart.test.tsx`, which
  imports and mocks `TrendChart`/`recharts` directly, is unaffected since
  `TrendChart.tsx` itself is not modified.
- **AD-6 (Decided, resolved)**: A small, chart-local error boundary **is**
  required, and is permitted as part of Optimization D, to satisfy BR-18.
  Technical basis (verified against this repository's installed Next.js
  documentation and package exports, not assumed): `next/dynamic` is
  documented as "a composite of `React.lazy()` and `Suspense`." Suspense
  alone only covers the *pending* (loading) state — a chunk-load failure or
  an exception thrown while rendering the loaded component is not
  swallowed by Suspense; per Next.js's own error-handling documentation,
  such an error "bubble[s] up to the nearest parent error boundary."
  This repository has no existing `error.tsx`/`global-error.tsx` or any
  other error-boundary convention anywhere in `app/` or `src/` (confirmed
  by inspection), so without a local boundary, a chart failure would
  propagate past `TeamDetail` with nothing to catch it, risking the entire
  `/teams/[teamId]` results view rather than only the chart section —
  violating BR-18. The installed Next.js version (`16.3.4`) ships a
  first-party, dependency-free primitive for exactly this — `catchError`
  from `next/error` (`node_modules/next/error.d.ts`) — "a counterpart to
  `error.js` that provides granular control of error boundaries at the
  component level," used to wrap "any part of your component tree." This
  phase specifies its use (or, only if it proves technically unsuitable at
  implementation time, an equivalent minimal hand-rolled class-component
  error boundary — no third-party dependency either way) as the mechanism,
  constrained to:
  - wraps only the dynamically-imported `TrendChart` region — chart-local,
    nothing else on the page;
  - contains no data fetching of any kind;
  - contains no authentication/authorization logic;
  - contains no product/business logic;
  - renders a minimal, non-interactive fallback (e.g. a short static
    message) — no retry affordance, telemetry/error-reporting call, or new
    dependency is required by this phase;
  - never affects the rendering of any sibling section (BR-18).

## Test boundaries

| Boundary | Covers |
|---|---|
| `listTeamMembers` (server/application) | BR-1, BR-2, BR-3, BR-4 |
| `listTeamAccessRequests` (server/application) | BR-5, BR-6, BR-7, BR-8 |
| `getOrgSkillProgressOverview` (server/application) | BR-9, BR-10, BR-11, BR-12 |
| `TrendChart` (component) | BR-13 |
| `TeamDetail` (component, `/teams/[teamId]`'s authorized/results-unavailable states) | BR-14, BR-15, BR-16, BR-17, BR-18 |
| Production build output (`pnpm build`) | BR-14 (bundle-composition confirmation) |

## Measurement requirements

Live Firebase/Firestore latency was not measured during the audit, so this
phase defines **structural before/after mechanics**, not millisecond
targets:

- **A/B**: *Before* — N per-`uid` `getUser` calls are serialized (each
  awaited before the next begins). *After* — no per-`uid` lookup is
  unnecessarily serialized (all N begin without waiting for a sibling to
  resolve). Output array and error/exclusion semantics unchanged
  (BR-1–BR-8). Verifiable automatically via a test double that proves
  concurrent invocation (see "Testing requirements").
- **C**: *Before* — three independent Firestore reads execute serially
  after `requireAppAdmin` succeeds. *After* — all three begin concurrently,
  and only after `requireAppAdmin` has already succeeded (BR-9, BR-10). Any
  read failure still fails the whole operation closed (BR-11). Verifiable
  automatically via reader test doubles that record invocation timing
  relative to `requireAppAdmin` and to each other.
- **D**: *Before* — `recharts` is part of the eager client dependency graph
  for every authorized `/teams/[teamId]` view, chart-bearing or not.
  *After* — the chart module loads only when `TrendChart` is actually about
  to render (non-empty results), never for an empty-results view (BR-14,
  BR-15). Chart behavior, once rendered, is identical (BR-13, BR-17).
- What can be validated automatically (in `pnpm test`): concurrency-vs-
  serialization proof for A/B/C (via deferred-promise/barrier test doubles,
  never wall-clock timing assertions); `TrendChart`'s unchanged rendered
  output for a given input; that an empty-results `TeamDetail` render does
  not invoke the dynamic import loader.
- What requires production-build artifact inspection (not automatable in
  `pnpm test`): confirming `recharts` is no longer part of `/teams/[teamId]`'s
  initial/eager chunk set in `pnpm build`'s output (`.next/static/chunks`),
  by comparing chunk composition before and after this phase's change,
  the same way the initial audit identified `recharts`' chunk by content
  inspection.

## Testing requirements

Tests must prove concurrency and behavior preservation, never wall-clock
duration. No test may assert "completed in < X ms" or rely on real timers.
Prefer dependency spies, deferred promises ("barriers"), or call-order
recording to prove one operation starts before a sibling operation resolves.

### A/B (`listTeamMembers`, `listTeamAccessRequests`)

- Ordering is preserved for a multi-item input (result order matches input
  `uid` order, independent of which lookup's promise settles first).
- Zero items → empty result, zero lookups attempted.
- One item → single-lookup behavior unchanged.
- Multiple items, all succeeding → all present, in order.
- Multiple items, some lookups failing → only the failing ones excluded;
  others present, in order.
- A concurrency proof: using deferred/controllable promises for `getUser`,
  assert that a second (or later) lookup is invoked before an earlier one's
  promise has been resolved/rejected — demonstrating no artificial
  serialization, without asserting on real elapsed time.
- `requireAppAdmin` (or the equivalent auth gate) still resolves, and is
  still called, before any identity lookup is attempted; an
  unauthenticated/non-admin caller triggers zero `getUser` calls.

### C (`getOrgSkillProgressOverview`)

- `requireAppAdmin` must resolve successfully before any of the three reads
  is invoked — provable via call-order recording (e.g. a shared invocation
  log array) rather than timing.
- All three reads start without waiting for a sibling's completion —
  provable via deferred promises: start all three, resolve them out of
  their declared order, and confirm all three were already invoked before
  any had resolved.
- Exactly one read rejecting (in each of the three positions, one test per
  position, mirroring the three existing `read_failed` tests already in
  `get-org-skill-progress-overview.test.ts`) still yields
  `{ ok: false, error: "read_failed" }` with no partial `trees` field.
- `requireAppAdmin` failing (`unauthenticated`/`forbidden`) still yields
  zero reads attempted — extend the existing authorization test block with
  an explicit "no reader is called" assertion if not already implied.
- Every existing query/bound/ordering/inclusion-exclusion test in
  `get-org-skill-progress-overview.test.ts` remains green unchanged — this
  phase does not alter query shape, limits, validation, or join logic.

### D (`TrendChart` / `TeamDetail`)

- `TrendChart.test.tsx`'s existing behavior/tests (mocked `recharts`,
  suppression-safe row mapping, empty-input → renders nothing) remain green
  unchanged.
- `TeamDetail.test.tsx`'s existing "authorized" tests (which render
  `TrendChart` with real, non-empty result data today) continue to pass —
  updated only as needed to accommodate the dynamic import resolving
  asynchronously (e.g. via existing `findBy*`/`waitFor` async query
  patterns already used elsewhere in that file), never by weakening what
  they assert.
- A new/updated test confirms that when `result.results.length === 0`,
  `TeamDetail`'s render does not trigger the `TrendChart` dynamic import at
  all (e.g. via a module-level mock/spy on the dynamic import boundary).
- A new test proves BR-18's failure isolation: force the dynamically-loaded
  chart module (or its render) to reject/throw — e.g. mock the dynamic
  import's loader to return a rejected promise, or mock `TrendChart` itself
  to throw during render — and assert that (a) the chart-local error
  boundary's fallback renders in the chart's place, and (b) every sibling
  section already present (team heading, current-survey, `PeriodSummary`,
  `TrendTable`, challenges, forum, skills) remains rendered and unaffected,
  with no page-level/global error state. This must not use a wall-clock
  assertion — a deliberately-controlled rejected promise/thrown error is
  sufficient.
- `pnpm build` succeeds.
- Build/client chunk composition is inspected using the available Next.js
  build output (`.next/static/chunks`, the same manual chunk-content
  inspection technique the original audit used, since no new bundle
  analyzer is introduced) to confirm `recharts` is no longer part of the
  chunk(s) loaded eagerly for `/teams/[teamId]`.

## Security invariants

Explicitly preserved, unmodified by this phase:

- Firebase Auth verification behavior (`verifyIdToken`), including
  `checkRevoked`.
- `requireAppAdmin`'s admin gate (A, B, C).
- `authorizeTeamAccess`'s team-scoped authorization (unchanged upstream of
  D).
- Server-side-only Firestore access via the Admin SDK; `firestore.rules`'
  client-SDK deny-all is untouched.
- Application-level encryption/decryption behavior (none of A/B/C/D touch
  any encrypted collection).
- The survey aggregation minimum-response threshold (untouched — D changes
  only chart-module loading timing, never the data `TrendChart` receives).
- Team isolation (no cross-team data exposure introduced by any of A–D).
- Every existing DTO shape (`TeamMember`, `PendingAccessRequest`,
  `OrgSkillProgressTreeView`/`OrgSkillProgressTeamEntryView`,
  `SurveyResultSummary`) is unchanged.
- The chart-local error boundary introduced under AD-6 is not a new attack
  surface or data path: per its own constraints, it performs no data
  fetching, no authentication/authorization logic, and no product logic —
  it only decides what to render in place of a failed chart, using data
  (or the absence of data) already present in the component tree.

No security control is weakened for performance anywhere in this phase.

## Performance Phase B boundary

Performance Phase B is a separate, not-yet-planned effort that remains
explicitly out of scope here. It is expected to investigate:

- Reducing the 7–9 independent authenticated API calls per page load found
  on `/teams/[teamId]` and `/admin/teams/[teamId]`.
- Reducing repeated `verifyIdToken(checkRevoked=true)` calls within one
  logical page load.
- Reducing repeated `authorizeTeamAccess` reads of the same
  `teams/{teamId}`/`teamMemberships/{uid}__{teamId}` documents within one
  page load.
- Potentially composing page-level server operations to verify identity and
  authorize access once per page load.

Phase B requires runtime measurement against a real environment and a
dedicated security review before any implementation, given it touches
`docs/ARCHITECTURE.md`'s decided "no cached/session-based authorization
state" invariant. **Phase A must not introduce any shortcut, cache, shared
mutable state, or request-scoped context that would make Phase B's future
authorization-consolidation design harder to implement correctly, or that
silently changes what Phase B would otherwise need to re-verify.** In
particular, A/B/C's concurrency changes touch no authorization code path
(`requireAppAdmin`/`authorizeTeamAccess` are called exactly once each,
before any of the parallelized work, exactly as today), so they carry no
directional risk toward Phase B's later work.

## Acceptance criteria

- [ ] `listTeamMembers` no longer serializes its per-`uid` `getUser` calls,
      while BR-1 through BR-4 all hold (verified by tests).
- [ ] `listTeamAccessRequests` no longer serializes its per-`uid` `getUser`
      calls, while BR-5 through BR-8 all hold (verified by tests).
- [ ] `getOrgSkillProgressOverview`'s three reads execute concurrently,
      strictly after `requireAppAdmin` succeeds, while BR-9 through BR-12
      all hold (verified by tests), and every pre-existing test in
      `get-org-skill-progress-overview.test.ts` remains green.
- [ ] `TrendChart`/`recharts` is no longer part of `/teams/[teamId]`'s
      eagerly-loaded client bundle, confirmed via production build chunk
      inspection, while BR-13 through BR-17 all hold (verified by tests),
      and every pre-existing test in `TrendChart.test.tsx` and
      `TeamDetail.test.tsx` remains green (with only the async-query
      adjustments described under "Testing requirements" if needed).
- [ ] A chart module load/render failure is isolated to the chart's own
      section by a chart-local error boundary (BR-18, AD-6), proven by a
      test that forces the failure and asserts every sibling section
      remains rendered with no page-level/global error state.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.
- [ ] No file outside the four candidates' own implementation/test files
      (and this SPEC/its future TASKS.md) is modified.
- [ ] No security/authorization behavior, DTO shape, or query bound changes
      anywhere in the diff.

## Open questions

None. AD-5 (dynamic-import mechanics) and AD-6 (chart-failure isolation)
are both resolved above with a locked architecture; remaining choices
within them (exact file location for the `dynamic()` call; exact fallback
copy/markup for the error boundary) are implementation-syntax details that
do not change observable behavior and are left to `implement-task` without
reopening the decision. How `split-tasks` divides A–D into individual tasks
is a `split-tasks`-stage decision, not a SPEC-level open question.
