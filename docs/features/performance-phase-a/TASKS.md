# Performance Phase A — Low-Risk Latency Improvements — Tasks

Specification: [SPEC.md](./SPEC.md) (Status: Approved, BR-1 through BR-18)

## Status
Ready: 0  In Progress: 0  Done: 4

## Task dependency

`TASK-001`, `TASK-002`, and `TASK-003` touch three disjoint files
(`list-team-members.ts`/`list-team-access-requests.ts`,
`get-org-skill-progress-overview.ts`, and `TeamDetail.tsx`/its dynamic-import
boundary, respectively) and share no runtime, type, or test dependency on
one another — there is **no implementation dependency between them**; each
is independently implementable and independently reviewable.

For workflow purposes (one task `In Progress` at a time, per
`docs/DEVELOPMENT.md`), the recommended — not architecturally required —
execution order is:

```
TASK-001 → TASK-002 → TASK-003 → TASK-004 (final review)
```

`TASK-004` is a genuine dependency: it audits the combined diff of the other
three and cannot start meaningfully until all three are `Done`.

## Tasks

### TASK-001 — Parallelize Firebase Auth identity lookups

**Status:** Done
**Covers:** BR-1, BR-2, BR-3, BR-4, BR-5, BR-6, BR-7, BR-8
**Depends on:** None

**Goal**
Replace the sequential, one-at-a-time `for` loop over Firebase Auth Admin
`getUser(uid)` calls in `listTeamMembers` and `listTeamAccessRequests` with
a concurrent `Promise.all`-based lookup, so N members'/requesters' identity
lookups are no longer unnecessarily serialized, while every existing output,
ordering, and error-isolation guarantee stays exactly as it is today
(SPEC → AD-1, "Decided, final").

**Files likely modified**
- `src/features/teams/server/list-team-members.ts`
- `src/features/teams/server/list-team-access-requests.ts`

**Tests likely modified/added**
- `src/features/teams/server/list-team-members.test.ts`
- `src/features/teams/server/list-team-access-requests.test.ts`

**Implementation constraints (locked by SPEC, not open for reinterpretation)**
- Retain the individual `getUser(uid)` call per identifier — do **not**
  adopt the Admin SDK's batch `getUsers()` (SPEC → AD-1: no ordering
  guarantee, throws above 100 identifiers, collapses per-item failure
  isolation).
- Replace the `for` loop with a `Promise.all` over the `uids`/`candidates`
  array; each lookup keeps its own `try`/`catch`, mapped to `null`/excluded
  on failure rather than propagating.
- Output array order must match the input order (`uids`/`candidates`
  order), independent of which lookup's promise settles first — use a
  positional `.map()` into `Promise.all`, then filter, not a result-order
  derived from resolution timing.
- `requireAppAdmin` remains the first, strictly sequential, blocking step —
  unchanged; no identity lookup may begin before it resolves successfully.
- Introduce no new upper bound on team size or request count.
- No authorization, DTO (`TeamMember`, `PendingAccessRequest`), or
  Firestore-query-shape change of any kind.

**Security / privacy invariants**
`requireAppAdmin`'s admin gate is unchanged and untouched by this task; no
new data is exposed; no DTO field is added, removed, or renamed. No
additional considerations beyond what SPEC → "Security invariants" already
states for A/B.

**Behavior that must remain unchanged**
- Identical `members`/`requests` array contents and order for identical
  underlying Firestore data.
- A single failing `uid` lookup excludes only that entry; every other
  lookup still succeeds and is still included.
- Identical `unauthenticated`/`forbidden`/`read_failed` error classification
  for the surrounding operation.

**Validation commands**
- `pnpm test -- src/features/teams/server/list-team-members.test.ts`
- `pnpm test -- src/features/teams/server/list-team-access-requests.test.ts`
- `pnpm typecheck`
- `pnpm lint`

**Testing approach (structural, not wall-clock)**
Use deferred/controllable promises (or an invocation-order log) as the
`getUser` test double to prove:
- a later lookup is invoked before an earlier one's promise has
  resolved/rejected (no artificial serialization) — never an elapsed-time
  assertion;
- ordering is preserved for a multi-item input regardless of resolution
  order;
- 0 items → 0 lookups; 1 item → unchanged single-lookup behavior; a mix of
  succeeding/failing lookups → only the failing ones excluded, others
  present in order;
- `requireAppAdmin`/the auth gate is still called, and must still resolve,
  before any lookup is attempted — an unauthenticated/non-admin caller
  triggers zero `getUser` calls.

**Acceptance checklist**
- [ ] BR-1 through BR-8 all hold, verified by the tests above.
- [ ] No test asserts real elapsed time; concurrency is proven structurally.
- [ ] Every pre-existing test in both touched test files remains green.
- [ ] `requireAppAdmin` is unchanged and still gates every lookup.
- [ ] No `getUsers()` batch API is introduced anywhere in the diff.

**Explicit non-goals**
- Do not adopt `getUsers()` or any other batch identity-lookup API.
- Do not add a Firestore query `.limit()` to either operation's membership/
  request read.
- Do not touch `/admin/teams`, `/admin/teams/[teamId]`'s other sections, or
  any other admin endpoint.
- Do not change `requireAppAdmin` itself.

**Completion notes**
Both operations' sequential `for...of` loop over `getUser(uid)` was replaced
with `candidates.map(async (candidate) => { try {...} catch { return null }
})` fed into `Promise.all`, then filtered — identical shape in both files.
Added to each focused test file: a zero-identities case, a concurrency proof
(deferred promises + an invocation-order log, resolved deliberately out of
input order, proving both that later lookups start before an earlier one
resolves and that output order still matches input order), and an explicit
"one of several concurrent lookups fails" case. The concurrency test was
confirmed RED against the original sequential implementation before the
production change, then GREEN after. Verified: focused tests (21/21 passed,
`pnpm exec vitest run` scoped to both files), `pnpm typecheck` (clean),
`pnpm lint` (clean), full `pnpm test` (2348/2348 passed — run incidentally
while scoping the focused command, not required by this task but confirms
no regression elsewhere), `git diff --check` (clean). Diff limited to the
four files above; no other file touched.

---

### TASK-002 — Parallelize org SkillProgress overview reads

**Status:** Done
**Covers:** BR-9, BR-10, BR-11, BR-12
**Depends on:** None

**Goal**
In `getOrgSkillProgressOverview`, run the three independent reads
(`skillTrees`, `skillProgress`, `teams`) concurrently via `Promise.all`,
constructed and issued only *after* `requireAppAdmin` has already resolved
successfully — never combined with `requireAppAdmin` in the same
concurrent group (SPEC → AD-2, "Decided, final").

**Files likely modified**
- `src/features/skill-trees/server/get-org-skill-progress-overview.ts`

**Tests likely modified/added**
- `src/features/skill-trees/server/get-org-skill-progress-overview.test.ts`

**Implementation constraints (locked by SPEC, not open for reinterpretation)**
- `const admin = await requireAppAdmin(...)` remains a strict, sequential,
  blocking first step; on failure, return immediately with **zero** reads
  attempted.
- Only after `admin.ok` is confirmed, construct and await
  `Promise.all([treesReader.listOrderedByCreatedAt(...),
  progressReader.listOrderedByUpdatedAtDesc(...), teamsReader.listAll()])`.
- **Explicitly forbidden**, and must not appear anywhere in the
  implementation:
  ```ts
  Promise.all([
    requireAppAdmin(...),
    readSkillTrees(...),
    readSkillProgress(...),
    readTeams(...),
  ])
  ```
  Authorization is a strict prerequisite, never a sibling of the protected
  reads.
- Preserve every existing query shape and limit exactly:
  `LIST_SKILL_TREES_LIMIT` (500), `LIST_ORG_SKILL_PROGRESS_LIMIT` (2000),
  and the unbounded `teams.get()` read — none of these bounds change in
  this task (bound changes are an explicit Phase A exclusion).
- Preserve the existing validation/join/ordering/truncation logic
  byte-for-byte — only the three reads' concurrency changes.
- If any one of the three reads rejects, the whole operation still returns
  `{ ok: false, error: "read_failed" }` with no partial `trees` field,
  regardless of which read failed or whether the other two had already
  settled.

**Security / privacy invariants**
`requireAppAdmin` is unchanged; this operation still performs no
`authorizeTeamAccess`-shaped check (unchanged, by design — Phase 9's own
SPEC). No DTO (`OrgSkillProgressTreeView`/`OrgSkillProgressTeamEntryView`)
change. No new Firestore bound introduced.

**Behavior that must remain unchanged**
- Identical output (trees, ordering, included/excluded entries) for
  identical underlying `skillTrees`/`skillProgress`/`teams` data.
- Identical `read_failed` fail-closed behavior on any single read failure.
- Every existing `org-skill-progress-overview/SPEC.md` BR-1–BR-27 behavior.

**Validation commands**
- `pnpm test -- src/features/skill-trees/server/get-org-skill-progress-overview.test.ts`
- `pnpm typecheck`
- `pnpm lint`

**Testing approach (structural, not wall-clock)**
Use reader test doubles plus an invocation-order log or deferred promises
to prove:
- zero reads are invoked unless/until `requireAppAdmin` has already
  resolved successfully (an unauthenticated/non-admin caller triggers zero
  reader calls);
- all three reads are already invoked before any of their promises has
  settled — e.g. resolve them out of their declared order and confirm all
  three were called beforehand;
- exactly one reader rejecting, tested once per position (mirroring the
  three existing `read_failed` tests already in the file), still yields
  `{ ok: false, error: "read_failed" }` with no partial `trees` field.

**Acceptance checklist**
- [x] BR-9 through BR-12 all hold, verified by the tests above.
- [x] No test asserts real elapsed time; concurrency and auth-ordering are
      proven structurally.
- [x] Every pre-existing test in `get-org-skill-progress-overview.test.ts`
      remains green, including every query/bound/ordering/inclusion-
      exclusion test.
- [x] The forbidden `Promise.all([requireAppAdmin(...), ...])` pattern does
      not appear anywhere in the diff.

**Explicit non-goals**
- Do not add, remove, or change any Firestore query `.limit()` or `.where()`
  clause.
- Do not add an `authorizeTeamAccess` check to this operation.
- Do not touch `list-skill-trees.ts`, `get-team-skill-progress.ts`, or any
  other Skill Tree operation.
- Do not change the `OrgSkillProgressTreeView`/`OrgSkillProgressTeamEntryView`
  DTO shape.

**Completion notes**
The three sequential `try { await ... } catch { return read_failed }` blocks
for `treesReader.listOrderedByCreatedAt`, `progressReader.listOrderedByUpdatedAtDesc`,
and `teamsReader.listAll` were replaced with a single
`try { [rawTrees, rawProgress, rawTeams] = await Promise.all([...]) } catch { return read_failed }`,
constructed and issued only after `requireAppAdmin`'s own `await` had already
resolved successfully (unchanged, strictly sequential, blocking first step).
Exact same three reader calls, arguments, and limits; no query/bound/
validation/join/ordering/DTO change. The forbidden
`Promise.all([requireAppAdmin(...), ...])` pattern does not appear anywhere.

Added to `get-org-skill-progress-overview.test.ts`, a new
`concurrency (BR-9/BR-10)` describe block: (1) a deferred-promise
authorization-gate proof — zero reader calls while `requireAppAdmin`'s
`verifyToken` is unresolved, all three called once it resolves successfully;
(2) explicit zero-reader-call assertions for an unauthenticated caller and
for an authenticated non-admin; (3) a three-way concurrency proof — deferred
promises for all three readers, an invocation-order log confirming all three
are invoked before any has resolved, then resolved deliberately out of
declared order, with the resulting DTO asserted byte-identical to the
existing join/DTO shape. No test asserts elapsed time; all use deferred
promises/microtask-flushing, mirroring TASK-001's established pattern.

RED evidence: the three-way concurrency test was run against the
pre-TASK-002 sequential implementation first and failed as expected —
`invoked` was `["trees"]` instead of `["trees", "progress", "teams"]`,
because the sequential implementation was still awaiting the first read's
unresolved promise and had not yet called the other two. The three
authorization-gate/zero-reads tests passed even before the change, since
`requireAppAdmin` already gated all reads correctly. After the production
change, GREEN: all 44 tests in the focused file passed
(`pnpm exec vitest run` scoped to the file), including every pre-existing
query/bound/ordering/inclusion-exclusion/failure test. `pnpm typecheck`
clean, `pnpm lint` clean, full `pnpm test` (2352/2352 passed, run
incidentally — not required by this task but confirms no regression
elsewhere), `git diff --check` clean. Diff limited to
`get-org-skill-progress-overview.ts` and its focused test file; TASK-001's
four files untouched.

---

### TASK-003 — Lazy-load and isolate TrendChart

**Status:** Done
**Covers:** BR-13, BR-14, BR-15, BR-16, BR-17, BR-18
**Depends on:** None

**Goal**
Code-split `TrendChart` out of `TeamDetail`'s eagerly-loaded client bundle
via `next/dynamic` at its existing call site, keep the empty-results skip
gate, add an accessible chart-local loading fallback, and wrap the
dynamically-loaded component in a small chart-local error boundary so a
chunk-load or render failure is isolated to the chart region only (SPEC →
AD-3 through AD-6, all "Decided").

**Files likely modified**
- `src/features/teams/components/TeamDetail.tsx` (the `dynamic()` call, the
  `result.results.length > 0` render gate, and the error-boundary wrapper
  wiring)
- Optionally a small new file for the error-boundary wrapper (e.g.
  colocated next to `TrendChart.tsx`) — SPEC → AD-6 leaves the exact file
  location to implementation; inlining it in `TeamDetail.tsx` is equally
  acceptable.

**Files that must NOT be modified**
- `src/features/results/components/TrendChart.tsx` — its named export and
  public data contract (`{ results }`) are unchanged; only *how* it is
  loaded changes, never the component itself (SPEC → AD-5).

**Tests likely modified/added**
- `src/features/teams/components/TeamDetail.test.tsx` — existing
  "authorized" tests adjusted only as needed for the dynamic import's
  async resolution (existing `findBy*`/`waitFor` patterns already used
  elsewhere in the file), plus new tests for the empty-results skip and
  the failure-isolation behavior.
- `src/features/results/components/TrendChart.test.tsx` — must remain
  green, unmodified (regression check only; this file is not expected to
  need changes since `TrendChart.tsx` itself doesn't change).
- Optionally a new small test file if the error-boundary wrapper is
  extracted into its own file.

**Implementation constraints (locked by SPEC, not open for reinterpretation)**
- Use Next.js `next/dynamic` with the documented named-export resolution
  form: `dynamic(() => import(".../TrendChart").then((mod) =>
  mod.TrendChart), { ssr: false, loading: () => <LoadingState ... /> })`.
- `ssr: false` (valid here since `TeamDetail` is already `"use client"`).
- Reuse the existing `LoadingState` UI primitive
  (`src/components/ui/LoadingState.tsx`) for the loading fallback — no new
  loading-state component.
- The call site gates rendering the dynamically-imported component on
  `result.results.length > 0`, so an empty-results view never triggers the
  chunk fetch at all (`TrendChart`'s own internal
  `results.length === 0` guard stays as defense-in-depth, not the sole
  mechanism).
- Wrap only the dynamically-imported `TrendChart` region in a chart-local
  error boundary, using Next.js's first-party `catchError` (from
  `next/error`, already present in the installed `next@16.3.4` — no new
  dependency) — or, only if `catchError` proves technically unsuitable at
  implementation time, an equivalent minimal hand-rolled class-component
  boundary (still no third-party dependency). **Do not reopen whether a
  boundary is necessary** — SPEC → AD-6 has already established, from
  `next/dynamic`'s documented `React.lazy()` + `Suspense` composition and
  this repository's total absence of any existing `error.tsx`/boundary
  convention, that Suspense alone does not catch a chunk-load or render
  failure and a local boundary is required.
- The boundary/fallback: chart-local only; no data fetching; no
  authentication/authorization logic; no product/business logic; a
  minimal, non-interactive fallback (e.g. a short static message); no
  retry affordance, telemetry/error-reporting call, or new dependency
  required.
- No generic/reusable "lazy chart" or "lazy-loading" abstraction — a single
  `dynamic()` call at the one existing call site.
- No change to how/where survey results are fetched (`loadTeamDetail`/
  `resolveViaResults` in `TeamDetail.tsx` are otherwise untouched).
- No Server/Client Component boundary change beyond what `dynamic()` itself
  requires (none — `TeamDetail` is already `"use client"`).

**Security / privacy invariants**
`authorizeTeamAccess` and the existing results-fetch flow upstream of
`TrendChart` are unchanged. The error boundary performs no data fetching,
authentication, or authorization work and introduces no new data exposure
— `TrendChart` receives exactly the same `results` data it does today.

**Behavior that must remain unchanged**
- `TrendChart`'s rendered output for any given `results` input — including
  rendering nothing for `results.length === 0` — is unchanged once loaded.
- `PeriodSummary`, `TrendTable`, and every other `/teams/[teamId]` section
  (current-survey, challenges, forum, skills) render identically to today.
- `computeSurveyAggregate`/`getTeamSurveyResults` are untouched.

**Validation commands**
- `pnpm test -- src/features/teams/components/TeamDetail.test.tsx`
- `pnpm test -- src/features/results/components/TrendChart.test.tsx`
  (regression — must stay green unmodified)
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build` (then inspect `.next/static/chunks` manually, the same
  content-inspection technique the audit used — no new bundle analyzer —
  to confirm `recharts` is no longer part of `/teams/[teamId]`'s eagerly-
  loaded chunk set)

**Testing approach**
- Empty-results skip: assert that when `result.results.length === 0`,
  `TeamDetail`'s render never triggers the `TrendChart` dynamic import
  (e.g. a module-level mock/spy on the dynamic-import loader that must
  show zero invocations).
- Failure isolation (BR-18): force the dynamic import (or the loaded
  component's render) to reject/throw via a controlled mock, then assert
  (a) the chart-local error boundary's fallback renders in the chart's
  place, and (b) every sibling section already present (team heading,
  current-survey, `PeriodSummary`, `TrendTable`, challenges, forum,
  skills) remains rendered and unaffected, with no page-level/global error
  state. No wall-clock assertion.
- Loading state: while the chunk is pending, the existing `LoadingState`
  primitive is visible in the chart's place (never a blank gap).

**Acceptance checklist**
- [x] BR-13 through BR-18 all hold, verified by the tests above.
- [x] `TrendChart.tsx` itself is unmodified; `TrendChart.test.tsx` remains
      green unchanged.
- [x] `TeamDetail.test.tsx`'s existing "authorized" tests still pass.
- [x] A new test proves the empty-results case never invokes the dynamic
      import.
- [x] A new test proves chart-failure isolation (BR-18).
- [x] `pnpm build` succeeds, and manual `.next/static/chunks` inspection
      confirms `recharts` is no longer part of `/teams/[teamId]`'s eager
      chunk set.
- [x] No new dependency was added to `package.json`.

**Explicit non-goals**
- Do not modify `TrendChart.tsx`'s exports, props, or rendering logic.
- Do not introduce a generic lazy-loading/error-boundary abstraction reused
  elsewhere.
- Do not add a retry button, telemetry call, or error-reporting integration.
- Do not change `TeamDetail`'s overview→batch fetch waterfall or any other
  section's fetch/render logic.
- Do not add a `middleware.ts`, `error.tsx`, or `global-error.tsx` route-
  level file — the boundary is component-local only.

**Completion notes**
`TrendChart` is now loaded via `dynamic<{ results: readonly SurveyResultSummary[] }>(() => import(".../TrendChart").then((mod) => mod.TrendChart), { ssr: false, loading: () => <LoadingState label={resultsCopy.trendChart.loading} /> })`,
declared at `TeamDetail.tsx`'s module scope (`LazyTrendChart`). The call site
gates on `result.results.length > 0` before rendering it at all (empty
results never mount `LazyTrendChart`, so the lazy loader is never invoked —
verified both by DOM absence and by an unchanged module-load invocation
count). It is wrapped in `TrendChartBoundary = catchError(TrendChartFallback)`
(`next/error`'s `catchError`, re-verified against the installed
`next@16.3.4` docs/types before use — stable since 16.3.0, explicitly
documented as callable from Client Components, matching SPEC AD-6 exactly;
no contradiction found, so the locked mechanism was implemented as written).
`TrendChartFallback` renders a minimal `<Alert variant="error">` with a new
`resultsCopy.trendChart.loadError` string — no retry affordance, no
exception detail, no data/auth/product logic. `TrendChart.tsx` itself was
not modified, confirming the approved plan held with no contradiction.

Added `resultsCopy.trendChart.loading`/`loadError` (Norwegian copy,
`src/features/results/copy.ts`) — the only file touched outside
`TeamDetail.tsx`/`.test.tsx`, needed by the new loading/fallback UI.

`TeamDetail.test.tsx`: the one pre-existing synchronous chart-heading
assertion (in "fetches and renders results for a member") was switched to
`findByRole` for the dynamic import's async resolution. Added a
`TeamDetail lazy TrendChart (TASK-003)` describe block: empty-results tests
(no chart heading/loading text rendered; TrendChart module-load invocation
count unchanged, compared before/after rather than asserting an absolute
zero — robust regardless of which earlier test in the file already warmed
the module cache); a loading-state test (deferred module promise, asserts
`LoadingState` shows while surrounding sections remain rendered); and two
failure-isolation tests (module-load failure, render failure) — both assert
the fallback renders with `role="alert"`, no exception text leaks, every
sibling section (results/table/challenges/forum) remains rendered, no
page-level error, and no extra `fetchTeamResults` call. The module-load
failure test narrowly mocks `next/dynamic` (documented as "a composite of
React.lazy() and Suspense") with that exact composition, because a
genuinely rejected loader promise did not reliably propagate through
`next/dynamic`'s own wrapping under jsdom/Vitest (verified via isolated
probes: a bare `React.lazy`+`Suspense`+`catchError` tree correctly isolates
a rejected import in this environment; `next/dynamic`-wrapped, it does not,
almost certainly because Vitest provides no live Next.js App Router runtime
context) — this substitutes none of `TeamDetail.tsx`'s production code,
only `next/dynamic`'s own internal wiring, and only for that one test;
`next/dynamic` itself is exercised unmocked by every other test in the file
plus `pnpm build`. Regression: `TrendChart.test.tsx` untouched, still green.

Verified: focused `TeamDetail.test.tsx` (82/82 passed, stable across 3
repeated runs), focused `TrendChart.test.tsx` (15/15 passed, unmodified),
`pnpm typecheck` (clean), `pnpm lint` (clean), `pnpm build` (succeeded).
Production bundle inspection (Turbopack, `.next/static/chunks` +
`page_client-reference-manifest.js` for `/teams/[teamId]`): `recharts`
appears in exactly one static chunk (360KB), which is absent from that
route's four eagerly-loaded entry-JS files; that chunk is reached only via
a `Promise.all([...].map(t=>e.l(t)))` deferred chunk-load call inside one of
the eager chunks, confirming a genuine lazy/async dependency rather than an
eager one. No `firebase-admin`/server-only content found in any client
chunk. This proves the chunk is *structurally* deferred, not merely small;
it does not by itself prove an empty-results render never fetches it over
the network at runtime — that is what the focused unit test (module-load
invocation count) established instead. Full `pnpm test` run incidentally
(2357/2357 passed, run to confirm no regression elsewhere — not required by
this task). `git diff --check` clean. Diff limited to `TeamDetail.tsx`,
`TeamDetail.test.tsx`, and `src/features/results/copy.ts`; `TrendChart.tsx`
unmodified; TASK-001/TASK-002 files untouched (diff stats confirmed
unchanged).

---

### TASK-004 — Final review

**Status:** Done
**Covers:** Cross-cutting audit of BR-1 through BR-18 (no primary BR
ownership of its own — see "BR mapping" below)
**Depends on:** TASK-001, TASK-002, TASK-003

**Goal**
Confirm, after all three implementation tasks are `Done`, that Performance
Phase A collectively satisfies every behavioral requirement, introduces no
regression, and stays entirely within the approved scope — before the
feature is considered complete.

**Checklist**
- [x] Full BR-1–BR-18 audit against the actual combined diff (not just each
      task's own claim).
- [x] Focused tests for all touched behavior (re-run TASK-001/002/003's
      focused test files together).
- [x] `pnpm test` (full suite).
- [x] `pnpm typecheck`.
- [x] `pnpm lint`.
- [x] `pnpm build`.
- [x] `git diff --check` (whitespace-error check across the full diff).
- [x] Production bundle inspection for Optimization D: confirm `recharts`
      is absent from `/teams/[teamId]`'s eagerly-loaded chunk set in the
      `pnpm build` output.
- [x] Security invariant audit: `verifyIdToken`/`checkRevoked`,
      `requireAppAdmin`, `authorizeTeamAccess`, server-only Firestore
      access, encryption/decryption, the survey aggregation threshold, and
      team isolation are all confirmed unchanged in the diff.
- [x] Scope audit against Phase A's approved exclusions (see "Phase A
      exclusions carried forward" below) — confirm none were introduced.
- [x] Confirmation no Performance Phase B work leaked in (no `verifyIdToken`
      consolidation, no `authorizeTeamAccess` caching, no composed page
      endpoints, no Server Component auth/data redesign, no session/
      cross-request caching, no `TeamDetail` waterfall redesign, no
      `SiteHeader` changes).
- [x] Confirmation no product semantics changed (every DTO, every rendered
      value, every lifecycle/threshold behavior identical to pre-Phase-A).
- [x] Confirmation no Firestore query bound (`.limit()`/`.where()`) was
      added, removed, or changed anywhere in the diff.
- [x] Confirmation no Team Forum encrypted-payload/schema behavior changed,
      and `listTeamThreads`' decryption behavior is untouched.
- [x] Confirmation `verifyIdToken`/`checkRevoked` behavior is byte-for-byte
      unchanged.
- [x] Confirmation `authorizeTeamAccess` behavior is byte-for-byte
      unchanged.

**Implementation notes**
This task performs no new implementation of its own — it is an audit gate.
If any checklist item fails, the responsible task is reopened (moved back
to `In Progress`) rather than this task papering over the gap.

**Security / privacy**
This task's entire purpose is the security/privacy regression check; see
checklist above.

**Documentation impact**
None expected beyond this `TASKS.md`'s own status updates (all four tasks
marked `Done`) — the SPEC itself is not modified by this task.

**Acceptance criteria**
- [x] Every checklist item above is confirmed, with evidence (command
      output, file:line citations) rather than asserted from memory.
- [x] `TASK-001`, `TASK-002`, `TASK-003` are all `Done`.
- [x] No open regression or scope violation remains.

**Completion notes**

Outcome: **PASS**. Reviewed independently from code/tests/diff (`review-change`
workflow), not from TASK-001/002/003's own reports.

*Baseline*: HEAD confirmed `e2e211467614a5f1e92f14589c835099bd0f0fdb` before
and after review; working tree unchanged beyond the 9 tracked Phase A files
plus the untracked `docs/features/performance-phase-a/` directory. SPEC
remains `Approved`, unmodified by this task.

*BR-1–BR-18*: all 18 audited directly against
`list-team-members.ts`/`.test.ts`, `list-team-access-requests.ts`/`.test.ts`,
`get-org-skill-progress-overview.ts`/`.test.ts`, and `TeamDetail.tsx`/
`.test.tsx`. All PASS. Notably verified independently rather than assumed:
`requireAppAdmin`'s `await` fully resolves before `Promise.all` is
constructed in all three server-side files (read at
`get-org-skill-progress-overview.ts:261-284`,
`list-team-members.ts:70-108`, `list-team-access-requests.ts:79-113`); the
forbidden `Promise.all([requireAppAdmin(...), ...])` pattern does not appear
anywhere in the diff; `TrendChart.tsx` is byte-for-byte unmodified
(`git status --short` shows no change to it or its test file).

*TASK-001*: individual per-`uid` `getUser` calls retained (no `getUsers()`
batch API anywhere in the diff, confirmed by grep); `.map()`→`Promise.all`
preserves input order independent of resolution order; each lookup's own
try/catch returns `null` on failure, filtered afterward, so one failing
lookup never rejects the aggregate; pre-existing "rejects an
unauthenticated/non-admin caller and attempts no read" tests (unchanged)
continue to prove zero `getUser` calls for an unauthorized caller; no new
size/concurrency cap introduced; DTOs (`TeamMember`, `PendingAccessRequest`)
unchanged. Concurrency proofs use deferred promises and an invocation-order
log, never wall-clock timing.

*TASK-002*: `get-org-skill-progress-overview.ts:261-284` shows
`requireAppAdmin`'s `await` completes, is checked (`if (!admin.ok) return`),
and only then are the three readers constructed and passed to a single
`Promise.all` — never combined with `requireAppAdmin` in one concurrent
group. A new `concurrency (BR-9/BR-10)` describe block proves (a) zero reads
while the auth gate is pending, all three once it resolves, (b) zero reads
for unauthenticated/non-admin callers, (c) all three readers invoked before
any has settled, resolved out of declared order, with a byte-identical DTO
result. Every pre-existing query/bound/ordering/failure test in the file
(44/44) remains green; `LIST_SKILL_TREES_LIMIT`/`LIST_ORG_SKILL_PROGRESS_LIMIT`
and the unbounded `teams.get()` are untouched.

*TASK-003*: `TeamDetail.tsx` declares `LazyTrendChart` via `next/dynamic` at
module scope (not inside the component body), using the documented
named-export resolution form with `ssr: false` — valid per this
repository's installed Next.js 16.3.4 docs, since `TeamDetail` is already a
Client Component. The render call site gates on
`result.results.length > 0` before mounting `LazyTrendChart` at all. The
chart region is wrapped in `TrendChartBoundary = catchError(TrendChartFallback)`
(`next/error`'s `catchError`, confirmed present and stable since 16.3.0 in
the installed package's `error.d.ts`/`catch-error.js`). `TrendChartFallback`
renders a static `<Alert variant="error">` with no exception detail, no
data/auth/product logic. `TrendChart.tsx` itself is unmodified.

*Chunk-load-failure test-validity verdict*: **sufficient**. The one test
that mocks `next/dynamic` (module-load-failure) was checked against this
repository's actual installed implementation
(`node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js`): production
`next/dynamic` is literally `React.lazy(() => opts.loader().then(convertModule))`
wrapped in `<Suspense fallback={...}>` when `ssr:false` or `loading` is set
(both true here) — the mock reproduces this exact composition. The only
element the mock omits, `BailoutToCSR`, is a no-op in any environment where
`window` is defined (verified by reading
`dynamic-bailout-to-csr.js` — it only throws when
`typeof window === 'undefined'`, i.e. during SSR, which never applies here
since `ssr:false`), so the omission changes nothing observable in this
jsdom/browser code path. The mock is scoped to exactly one test
(`vi.doMock`/`vi.doUnmock` in that test's own body/`afterEach`) and does not
touch `TeamDetail.tsx`'s production loader function or its real `catchError`
boundary. This is corroborated by a second, fully unmocked test proving
`catchError` isolates a real render-time throw through the genuine
`next/dynamic`/`React.lazy`/`Suspense` pipeline, plus a successful
`pnpm build` exercising the real composition end-to-end. Combined, this
satisfies BR-18 without requiring a browser/E2E test.

*Bundle inspection*: fresh `pnpm build` (Turbopack) succeeded. Verified
independently (not merely re-reading TASK-003's claim): `recharts` appears
in exactly one chunk, `static/chunks/432w012ma-k8t.js` (~360KB, matches the
audit's original ~388KB estimate closely enough to confirm the same
dependency). `.next/server/app/teams/[teamId]/page_client-reference-manifest.js`'s
`entryJSFiles` lists exactly four eager entry files for
`/teams/[teamId]`'s page; none of the four contain the string `"recharts"`;
one of them (`3u5s691ztqaur.js`) references the recharts chunk only via a
deferred `Promise.all(["static/chunks/432w012ma-k8t.js"].map(t=>e.l(t)))`
call — Turbopack's lazy-chunk-load primitive — confirming genuine
structural code-splitting, not merely a small chunk. Zero client chunks
contain the strings `"firebase-admin"` or `"server-only"`. This proves
structural chunk separation; it does not by itself prove runtime network
behavior for every browser state — that gap is covered instead by the
focused unit test asserting the `TrendChart` module-load mock's invocation
count is unchanged for an empty-results render.

*Structural performance*: TASK-001/002's serialized-to-concurrent change and
TASK-003's bundle split are each independently confirmed above; no
millisecond target was required or claimed.

*Security/privacy*: `verifyIdToken`, `checkRevoked`, `requireAppAdmin`,
`authorizeTeamAccess`, server-only Firestore access via the Admin SDK,
encryption/decryption, the survey aggregation threshold, team isolation,
and every existing DTO shape are all unchanged in the diff (confirmed by
`git diff` inspection and targeted greps — no occurrence of
`verifyIdToken`/`checkRevoked`/`authorizeTeamAccess`/`getUsers(`/`.limit(`/
`turbopack`/`SiteHeader` in the diff outside of unmodified explanatory test
comments). No new data exposure, no sensitive logging, no client Firestore
access, no client decryption, no auth bypass, no protected read before
required authorization.

*Validation run*: focused suite (10 + 11 + 44 + 82 + 15 = 162/162 passed
across `list-team-members.test.ts`, `list-team-access-requests.test.ts`,
`get-org-skill-progress-overview.test.ts`, `TeamDetail.test.tsx`,
`TrendChart.test.tsx`). Full `pnpm test`: one run hit 69 transient
5000ms-timeout failures across 28 files under 166-parallel-worker
contention on this machine; investigated (re-ran the same focused files
together — 162/162 clean; re-ran the single flagged test in isolation —
passed; re-ran `TeamDetail.test.tsx` alone — 82/82 clean) and confirmed
infrastructure/parallelism flakiness rather than a logic regression before
re-running the full suite, which passed clean at **2357/2357** across 166
files. `pnpm typecheck`: clean. `pnpm lint`: clean. `pnpm build`: succeeded.
`git diff --check`: clean (only CRLF/LF autocrlf informational warnings,
exit 0 — no whitespace errors).

*Scope/leakage audit*: no Phase B pattern (verifyIdToken consolidation,
authorizeTeamAccess caching, composed page endpoints, Server Component
auth/data redesign, session/cross-request caching, TeamDetail waterfall
redesign, SiteHeader changes, new `.limit()`/`.where()` bounds, pagination,
Team Forum encryption/schema changes, `dev` script changes, Phase 10 work,
`getUsers()` adoption) appears anywhere in the diff. `package.json`,
`pnpm-lock.yaml`, `next.config.ts`, and `.claude/` are all unmodified. No
secrets/credentials/environment files touched (grepped the diff for common
secret patterns — no match). `.next/` build artifacts are gitignored and
were not staged.

*Final file list for staging* (still unstaged, per this task's scope):
`src/features/results/copy.ts`,
`src/features/skill-trees/server/get-org-skill-progress-overview.ts`,
`src/features/skill-trees/server/get-org-skill-progress-overview.test.ts`,
`src/features/teams/components/TeamDetail.tsx`,
`src/features/teams/components/TeamDetail.test.tsx`,
`src/features/teams/server/list-team-access-requests.ts`,
`src/features/teams/server/list-team-access-requests.test.ts`,
`src/features/teams/server/list-team-members.ts`,
`src/features/teams/server/list-team-members.test.ts`,
`docs/features/performance-phase-a/SPEC.md`,
`docs/features/performance-phase-a/TASKS.md`.

Commit-readiness: **ready to stage/commit** once the user chooses to do so.
Nothing was staged, committed, pushed, or deployed during this review.

---

## BR mapping

| BR | Owning task |
|---|---|
| BR-1 | TASK-001 |
| BR-2 | TASK-001 |
| BR-3 | TASK-001 |
| BR-4 | TASK-001 |
| BR-5 | TASK-001 |
| BR-6 | TASK-001 |
| BR-7 | TASK-001 |
| BR-8 | TASK-001 |
| BR-9 | TASK-002 |
| BR-10 | TASK-002 |
| BR-11 | TASK-002 |
| BR-12 | TASK-002 |
| BR-13 | TASK-003 |
| BR-14 | TASK-003 |
| BR-15 | TASK-003 |
| BR-16 | TASK-003 |
| BR-17 | TASK-003 |
| BR-18 | TASK-003 |

Every BR (BR-1 through BR-18) has exactly one owning task; no BR is
duplicated or omitted. `TASK-004` re-audits all 18 collectively but owns
none primarily — a cross-cutting regression gate, not a new requirement
owner, per `split-tasks`' "cross-cutting regression checks may reference
multiple tasks without changing primary ownership."

## Phase A exclusions carried forward

None of `TASK-001` through `TASK-004` may introduce any of the following
(SPEC → "Out of scope", reaffirmed here so `implement-task` cannot
reintroduce them piecemeal):

- `verifyIdToken` consolidation.
- `authorizeTeamAccess` caching, memoization, or cross-request reuse.
- Composed/aggregating page-level server endpoints.
- Any Server Component auth/data-loading redesign.
- Session-lived or cross-request authorization caching.
- Disabling or weakening `checkRevoked`.
- Redesigning `TeamDetail`'s overview→batch fetch concurrency/waterfall.
- Any change to `SiteHeader`'s `/api/me` behavior.
- Any new Firestore query `.limit()`/`.where()` bound (on `teams`,
  `surveyResponses`, `challenges`, or any other currently-unbounded query).
- Any pagination.
- Any change to Team Forum's encrypted-payload/schema shape, or to which
  fields `listTeamThreads` decrypts.
- Changing the `dev` npm script (e.g. adding `--turbopack`).
- Any product/feature work, including Phase 10 (`org-forum-overview`).
- Adopting the Firebase Admin SDK's batch `getUsers()` API.
