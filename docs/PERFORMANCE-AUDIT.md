# DevPulse performance and data-architecture audit

Status: **audit only**. No dependencies were installed, no application code changed, no data written, no commits made.
Date of inspection: 2026-11-16. Working tree contained many unrelated uncommitted changes; they were left untouched.

Labels used throughout:

- **MEASURED**: produced by a tool run in this audit (a grep count, a test run). Values are exact for the stated scope.
- **CODE-CONFIRMED**: read directly from the repository source.
- **INFERRED**: derived from code by reasoning or arithmetic. Not timed.
- **NOT VERIFIED**: not measured. Stated as a gap, with a reproducible command where one exists.

---

## 1. Executive summary

DevPulse is a client-fetch application. Server Components render shells, and almost all data is loaded by client components on mount through about 31 `*-gateway.ts` modules that call about 95 `app/api` route handlers. There is no TanStack Query, SWR, React Query, `unstable_cache`, `revalidate`, `React.cache`, or `use cache` anywhere in the source (MEASURED: grep, zero hits). There is one `next/dynamic` import (MEASURED).

The main findings, in priority order:

1. **Every protected request is a serial chain of Firebase round trips** before the handler runs: token verification with revocation check, then the erasure-fence read, then `getUser`, then the superadmin registry read (CODE-CONFIRMED, `src/features/auth/server/verify-identity.ts`). Two of those four steps are independent and could run in parallel. This is the largest backend latency item that applies to every route. It is security-critical code, so it needs a security review before change.
2. **Team pages re-fetch the team overview on every tab.** Eight call sites render `TeamPageHeader` without a `name` prop (the team tab pages and the roadmap, projects and systems components), and each one fetches `/api/teams` on mount (CODE-CONFIRMED). A tab visit therefore costs an extra overview request on top of its own content requests. The count is INFERRED, not measured.
3. **The Teamkompetanse aggregate is uncached and read-heavy by design.** It scans up to 501 membership documents, then does one exact `getAll` read per opted-in member per active skill, bounded at 20,000 reads (CODE-CONFIRMED, `src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts`). It also hits a hard **scalability cliff at 501 memberships**: above that, the result is always `incomplete` (CODE-CONFIRMED). This is a product correctness limit more than a speed problem, and it needs a product decision.
4. **Recharts is statically imported on routes that do not need it at first paint.** Three client trees import it statically: the home dashboard (`HomePanels` → `TrendChart`), Teamkompetanse (`TeamCompetenceWorkspace` → radar and bar charts), and the personal skill overview (`SkillOverview` → `PersonalRadar`). Only one chart (`LazyTrendChart` in `TeamResultsView`) is lazy-loaded (CODE-CONFIRMED). Bundle size is NOT VERIFIED.
5. **No loading boundaries.** There is no `loading.tsx` in `app/`, and Suspense appears only in `src/features/roadmap/components/RoadmapPage.tsx` (MEASURED: find and grep). Every page waits for client effects before showing data.
6. **Data-access patterns are mostly bounded.** Most list reads use `.limit()`. The exceptions are the skill-progress read in the roadmap (`listSkillProgress`, which has no limit) and the team-level scans noted above (CODE-CONFIRMED).

**Recommendation in one sentence:** do not adopt TanStack Query now. Take the Next.js-first and targeted fixes first (dedupe the overview fetch, parallelize independent auth reads after review, lazy-load Recharts, add route-level loading states), then measure with a production build. Reconsider a **selective** TanStack Query pilot only if those measurements show that repeated client fetches on tab switches remain a real cost. See sections 8 and 15.

---

## 2. Current architecture map

### 2.1 Stack (CODE-CONFIRMED, `package.json`)

| Item | Version or fact |
| --- | --- |
| Next.js | 16.3.4 (App Router, root `app/` directory) |
| React | 19.2.8 |
| Firebase client | `firebase` ^12.18.0 |
| Firebase Admin | `firebase-admin` ^14.3.0 |
| Charts | `recharts` ^3.10.1 |
| Client data library | none (no TanStack Query, SWR, or React Query) |
| Tests | Vitest 5, Testing Library, Playwright (browser suite), emulator tier |

Note: the repository has no `src/app` directory. Routes live in `app/`, and feature code lives in `src/features/<feature>/`. (CODE-CONFIRMED.)

### 2.2 Layout tree (CODE-CONFIRMED)

- `app/layout.tsx`: root HTML shell, fonts, theme init script, skip link.
- `app/(app)/layout.tsx`: wraps all authenticated routes in `TeamContextProvider` and `AppShell`. `AppShell` persists across navigations.
- `app/(public)/layout.tsx`, `app/(survey)/layout.tsx`: separate shells for public and survey pages.
- No route-level `loading.tsx`, `error.tsx`, or `template.tsx` files exist (MEASURED: `find app -name loading.tsx` returns nothing).

### 2.3 Server and client boundaries (MEASURED, grep counts)

- Files containing `"use client"`: **136**.
- Files containing the string `"use server"`: **2**, both in `src/features/*/domain/*-content-codec.ts`. I did not confirm whether these are directives or text; no Server Action file under `app/` was found. Mutations are carried by `app/api` route handlers.
- Client gateways that call `fetch`: **31** files under `src/features/*/client/`.
- `app/api` route handler files: **95**.
- `useEffect` calls in `src`, excluding tests: **69** (43 files). `useMemo` and `useCallback` calls: **7**.

### 2.4 Auth gate on the client

- `src/features/auth/client/use-auth-gated-resource.ts` is used by **38** source files. It waits for a Firebase ID token, then runs a generation-guarded effect. This is the common pattern for every client read (CODE-CONFIRMED).
- `AppShell` (`src/components/nav/AppShell.tsx`) fetches `own-admin-status` once per shell mount, then renders the signed-in navigation immediately. Admin entries appear only after a successful read (CODE-CONFIRMED). This fails closed, which is the correct security behaviour.

### 2.5 Server data access

- Firebase Admin is a process-wide singleton: `getFirestoreDb()` returns the same `[DEFAULT]` app on every call (CODE-CONFIRMED, `src/lib/firebase/admin.ts`). Connection reuse is therefore correct within a warm instance.
- Firestore calls appear in about 245 `.get()` sites, 171 `.where(` sites and 105 `.limit(` sites in non-test server code, excluding the demo-team tooling (MEASURED, grep). Most files that read collections use `.where(teamId ==)` as the scoping predicate.
- Encryption: keys are derived per call with `hkdfSync` and not cached (CODE-CONFIRMED, `src/lib/encryption/record-envelope.ts:68`, `src/lib/encryption/encryption.ts:100`). This is cheap but repeated. Its cost is NOT VERIFIED.

### 2.6 Existing performance instrumentation

- No application-level performance instrumentation was found: no `performance.mark`, no Web Vitals reporting, no server timing headers (MEASURED: grep for `performance.mark`, `reportWebVitals`, `Server-Timing`, all zero hits in `src`, `app`).
- Playwright is configured (`browser/playwright.config.ts`, script `verify:browser`) for functional and accessibility checks, not timing (CODE-CONFIRMED).

### 2.7 Loading, Suspense and streaming

- Suspense: one occurrence, `src/features/roadmap/components/RoadmapPage.tsx` (MEASURED).
- Streaming: no page streams data. Pages are server-rendered shells, and data arrives after hydration (CODE-CONFIRMED).

### 2.8 Confirmed versus assumed

| Item | Status |
| --- | --- |
| Client-owned fetching with no server-side data caching | CODE-CONFIRMED |
| No TanStack Query or SWR | CODE-CONFIRMED (no dependency, no import) |
| Chart libraries statically imported on three routes | CODE-CONFIRMED |
| Actual number of requests per page, duplicates, waterfalls at runtime | NOT VERIFIED (see section 4) |
| Browser timings, LCP, INP, CLS, bundle size | NOT VERIFIED (see section 4) |

---

## 3. Route-by-route findings

Route files are the actual `page.tsx` files under `app/`. Team tabs are the seven primary tabs the product brief names, plus the settings and skills pages (MEASURED: file listing).

| Route | Server page | Client data on mount (CODE-CONFIRMED) | Notes |
| --- | --- | --- | --- |
| `/teams` | `app/(app)/teams/page.tsx` | `teams-overview-gateway` | Single overview read. Low risk. |
| `/teams/[teamId]` (Overview) | `TeamDetail` | overview → then results, challenges, skills in parallel | **Sequential waterfall**: overview must finish before the three parallel calls. `TeamDetail` passes the name to its header, so no second overview read happens there. |
| `/teams/[teamId]/competence` (Teamkompetanse) | `TeamPageHeader` + `TeamCompetenceWorkspace` | header overview; then skills, aggregate, manual assessments in parallel | Header re-fetches overview. Imports Recharts statically. |
| `/teams/[teamId]/competence-plan` | `TeamPageHeader` + plan client | header overview + plan reads | Header overview re-fetch. |
| `/teams/[teamId]/skills` | client skills admin | skills reads | Not separately profiled. |
| `/teams/[teamId]/systems` (Systemoversikt) | `TeamPageHeader` + `TeamSystemsPage` | header overview + `/systems` list | Header overview re-fetch. Filtering is client-side (CODE-CONFIRMED). |
| `/teams/[teamId]/roadmap` | `RoadmapPage` (contains Suspense) | header overview + `/roadmap-items` | Header overview re-fetch. `listSkillProgress` has no limit (see 4.2). |
| `/teams/[teamId]/results` | `TeamPageHeader` + `TeamResultsView` | header overview; results, current survey | Only chart that is `next/dynamic`-loaded. |
| `/teams/[teamId]/surveys` | `TeamPageHeader` | surveys list | Header overview re-fetch. |
| `/teams/[teamId]/settings` | `TeamPageHeader` | settings reads | Header overview re-fetch. |
| `/results` | `app/(app)/results/page.tsx` | results gateway | Recharts reached through `TrendChart`. |
| `/me/goals`, `/me/skills`, `/me/profile`, `/me/conversations`, `/me/erasure` | client pages | per-page reads | Personal pages. `SkillOverview` pulls `PersonalRadar` (Recharts) statically. |
| `/me/conversations/[id]` | client page | conversation read | Not profiled. |
| `/admin/*` | client pages | admin gateways | Admin routes are low traffic; not prioritised. |
| `/survey/[surveyId]`, `/public/teams/[teamId]` | server + client | survey / public reads | Public route is authenticated-free by design: any caching there needs its own privacy review. |
| `/` (home) | `app/page.tsx` | `HomePanels` | Imports `TrendChart`, so Recharts is on the home route (CODE-CONFIRMED). |

### 3.1 Header overview duplication (CODE-CONFIRMED)

`TeamPageHeader` (`src/features/teams/components/TeamPageHeader.tsx`) fetches `/api/teams` through `fetchTeamsOverview` whenever no `name` prop is supplied. Eight call sites omit the prop (`app/(app)/teams/[teamId]/{competence,competence-plan,results,settings,surveys}/page.tsx`, `RoadmapPage`, `TeamProjectRoadmap`, `TeamSystemsPage`), so each one triggers an overview request on mount. The overview is the same for every tab (the caller's team list), so these calls are **repeated, identical requests** within a session. The exact number of extra requests per tab visit is INFERRED from the code; NOT VERIFIED at runtime.

### 3.2 Overview waterfall (CODE-CONFIRMED)

`loadTeamDetail` (`src/features/teams/components/TeamDetail.tsx`) awaits `fetchTeamsOverview` before deciding whether to call the authoritative results endpoint. The comment documents why: the overview is never the authorization decision, and an absent entry is ambiguous. The wait is a real serial step, so Overview incurs at least two sequential round trips before any team data arrives. The chart and card data then arrive after the parallel block.

This ordering is a deliberate security choice. Any optimization must keep the results endpoint as the decision, so the fix is to **start the three parallel calls at the same time as the overview**, then discard their data if the overview denies, not to skip the results call.

---

## 4. Baseline performance measurements

### 4.1 What was attempted and why results are missing

| Measurement | Status | Reason |
| --- | --- | --- |
| Production build and per-route JavaScript sizes | NOT VERIFIED | Dev servers were running on ports 3000 and 3001, sharing the `.next` directory. A production build in place would overwrite the output they use. The brief forbids interrupting development processes. |
| LCP, INP, CLS, long tasks, memory | NOT VERIFIED | No browser profile was taken. Development-mode timing would not be valid under the brief. |
| Route transition times | NOT VERIFIED | Same as above. |
| Firestore read counts per request | NOT VERIFIED | No emulator run instrumented reads. |
| Backend latency per endpoint | NOT VERIFIED | No timed requests were run against the emulator. |
| Duplicate requests per tab switch | INFERRED | Derived from section 3.1 code paths. |

Live Firebase was not used, as the brief requires.

### 4.2 Measured facts that are available

- **Test status, quick tier on one file** (MEASURED, `pnpm test:quick --files src/features/roadmap/components/RoadmapPage.verification.test.tsx`): 57 files ran, 1 file failed, **3 tests failed**, 767 passed, 4 expected-fail, 19 skipped. Duration 61.5 s. The failures were:
  - two responsive-structure guard tests (`wraps filters and view switch… (list)` and `… (timeline)`). The offending element is the team navigation `<nav aria-label="Teamnavigasjon">` with `overflow-x-auto`, which is shared navigation, not roadmap code;
  - one mid-session permission test (`TASK-012 — mid-session permission loss`).

  This is the **pre-existing Roadmap overflow guard issue** the brief asks to record separately. It is not attributed to this audit. Caveat: the working tree has many uncommitted changes, so I did not verify whether these failures also occur on a clean checkout (NOT VERIFIED).
- **Count of client `"use client"` files**: 136 (MEASURED, grep).
- **Count of API route handlers**: 95 (MEASURED, file listing).
- **Count of Recharts-importing source files**: 5 (MEASURED, grep). Static importers are listed in section 6.

### 4.3 Commands to reproduce the missing measurements

Run these on a machine where the dev servers can be stopped, or in a separate clone so `.next` is not shared:

```text
pnpm build                                  # per-route sizes printed in the build table
pnpm start                                  # then profile with Chrome DevTools or Playwright tracing
```

For route timing and Web Vitals, use the Playwright browser suite with a trace, or add a temporary `web-vitals` probe in a local branch. Both are local-only and must not use live Firebase. For backend timing, run the emulator tier (`pnpm test:emulator`) with timers added around `verifyIdToken` and the aggregate function in a local branch.

---

## 5. Firebase and backend performance findings

### 5.1 Auth verification chain (CODE-CONFIRMED)

`verifyIdToken` (`src/features/auth/server/verify-identity.ts`) runs these steps for every protected request:

1. `verifyIdToken(token, checkRevoked = true)`: a network call to Firebase Auth to check revocation.
2. Erasure fence read: a Firestore read (`readErasureFenceFromFirestore`).
3. `getUser(uid)`: a network call to Firebase Auth for the live account (email, verification, disabled flag).
4. `decideAccess`, which reads the superadmin registry from Firestore when the domain step needs it.

Steps 2 and 3 depend only on `decoded.uid`. They are independent and could run in parallel. The fail-closed mapping must be preserved: a fence failure must still yield `auth_unavailable`, and `getUser` failure must still map as it does now.

**Cost estimate (INFERRED, not timed):** a protected request pays at least three sequential network round trips (steps 1–3) before the handler starts, plus the registry read in step 4 for non-superadmin callers when the domain check needs it. Parallelizing steps 2 and 3 removes one round trip in the common path.

**Security considerations:** this is a P0-adjacent area. The change must not alter any decision, only its timing. It requires `security-review` and emulator tests (`pnpm test:emulator`). The brief forbids authentication changes without approval, so this is a recommendation only.

### 5.2 Teamkompetanse aggregate (CODE-CONFIRMED, `src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts`)

Order per request:

1. Verify token (section 5.1).
2. Transaction: read team status, membership, and the list of active team skills up to `TEAM_SKILLS_PER_TEAM_MAX + 1` = 101 documents.
3. Membership scan: `listMembershipsForCoverage(teamId, 501)`. If more than 500 are returned, the result is `incomplete` with no rows.
4. Filter to opted-in contributors (`optedInContributors`).
5. Budget check: `uids × skills > 20000` gives `incomplete`.
6. Batch read: `readTeamSkillRatingsBatch` issues `db.getAll` on exact document IDs `teamSkillAssessments/{uid}__{skillId}`, in chunks of 300 (`GET_ALL_CHUNK`).
7. Derive levels per skill, suppress skills with suspect ratings or fewer than `SKILL_COVERAGE_MIN_CONTRIBUTORS = 3` contributors.

The function is documented as **read-only and uncached**. That is the correct privacy posture for decrypted cross-person data (section 10).

**Read-count model (INFERRED from the constants above, assuming every member is opted in and the skill count is S):**

| Members (M) | Membership scan reads | Rating reads (M × S) | Result |
| --- | --- | --- | --- |
| 10 | 10 | 10 × S (for S = 23: 230) | Available. Total about 240 reads. |
| 100 | 100 | 100 × S (23: 2,300) | Available. Total about 2,400 reads. |
| 500 | 500 | 500 × S (23: 11,500) | Available, under the 20,000 budget. Total about 12,000 reads. |
| 501 or more | 501 (scan stops) | not performed | **Always `incomplete`.** About 501 reads and no rows. |

Which limit binds depends on the number of active skills S. The scan cap is 500 memberships; the read budget is 20,000 ÷ S opted-in members. At 23 skills the budget allows about 869 members, so the **500-membership scan cap is the binding limit**. At 40 skills the two limits meet at 500. At the 100-skill maximum the budget binds at 200 opted-in members. The effective ceiling is therefore 500 memberships for teams with up to 40 active skills, and lower above that.

Per-read cost is NOT VERIFIED against current Firestore pricing. Latency is NOT VERIFIED. The scan cap also counts non-opted-in memberships, so a team with 501 total memberships fails even if few have opted in.

### 5.3 Systemoversikt (CODE-CONFIRMED, `src/features/team-systems/server/list-team-systems.ts`)

- `listSystems(teamId, limit)`: `where("teamId", "==", teamId).limit(limit)`. Bounded.
- `listMembershipsByRefs(teamId, refs)`: `where teamId ==` plus `where memberRef in [...refs]`. The `in` operator has a per-query value limit in Firestore. Whether `refs` can exceed that limit depends on the caller; the caller was not inspected in full (NOT VERIFIED).
- Decryption: system documents are opened with `openTeamSystemDocument`, which runs AES-GCM decryption per document. Cost per document is NOT VERIFIED.
- Competency-risk calculations and filtering run in the client (CODE-CONFIRMED by the presence of client filter components). Their cost at hundreds of systems is NOT VERIFIED.

### 5.4 Roadmap (CODE-CONFIRMED, `src/features/roadmap/server/list-roadmap-items.ts`)

- `listRoadmapItems`: `where teamId ==`, `limit(501)`, first 500 processed, `truncated` flag. Bounded and documented.
- `listSkillProgress(teamId)`: `where teamId ==` with **no limit**. Its size grows with the number of people and skills. This is an unbounded read and the most important roadmap backend item (P1 in section 11).
- `listMemberships(teamId, limit)`: bounded.
- `resolveCanEdit`: two sequential reads (membership, then team status). These are independent and could be parallel. The cost is small (two document reads), so this is a quick win only.
- Mutation refresh: after a successful write, the client refetches the list. Whether it refetches the whole tree is NOT VERIFIED.

### 5.5 Repeated document reads across tabs (INFERRED)

Each team tab re-reads `teams/{teamId}` status and the caller's membership on the server, because `authorizeTeamAccess` and `resolveCanEdit` run per request. This is correct for security (section 10) and is a cost the cache design must keep.

### 5.6 Other notes

- Sequential awaits in server handlers are common, but most are dependent (a membership read must precede a role decision). I did not find large independent batches left sequential, other than the auth chain (5.1) and `resolveCanEdit` (5.4).
- Document sizes and payload sizes were not measured.
- Serverless cold-start behaviour was not measured. Admin initialization is lazy and singleton, so the cost is paid once per warm instance (CODE-CONFIRMED).

---

## 6. Frontend and bundle findings

### 6.1 Recharts placement (CODE-CONFIRMED)

| Chart | Used by | Loading |
| --- | --- | --- |
| `TrendChart` | `HomePanels` (home), `TeamResultsView` (lazy), `results/copy.ts` and `TrendTable` | Static on home; lazy on team results |
| `PersonalRadar` | `SkillOverview` (personal skills), `personal-radar.ts` | Static |
| `KompetanseprofilRadar` | `TeamCompetenceWorkspace` (Teamkompetanse) | Static |
| `TeamLevelBarChart` | `TeamCompetenceWorkspace` | Static |

Recharts is therefore loaded eagerly on the home, personal skills, and Teamkompetanse routes. Whether these charts are on the first-paint path is NOT VERIFIED without a build. A `next/dynamic` wrapper for the chart component (not the whole page) is the lowest-risk change. It should be measured against the production build first.

### 6.2 Client rendering and state

- `TeamCompetenceWorkspace` runs three parallel reads on mount (CODE-CONFIRMED). Rendering cost for 23 competency bars is NOT VERIFIED. Recommendation: do not memoize speculatively; profile with React DevTools first.
- Only 7 `useMemo`/`useCallback` calls exist across the source (MEASURED). This means there is little speculative memoization to remove, and the project already avoids most of it.
- React Compiler: not configured in `next.config` or `package.json` (CODE-CONFIRMED). It is not relevant until there is a measured rerender problem.
- Virtualization: not justified. The largest lists are capped by server limits (500 roadmap items, 100 team skills, 500 memberships), and no list was measured as slow.

### 6.3 Shared layout

`AppShell` and `TeamContextProvider` persist across navigations (CODE-CONFIRMED), so the shell itself is not remounted per tab. Its single admin-status fetch runs once per shell mount, which is good. Repeated sidebar rendering was not profiled (NOT VERIFIED).

### 6.4 Third-party cost

Firebase client SDK and Recharts are the two large dependencies. Their bundle contribution is NOT VERIFIED without a production build.

---

## 7. Next.js optimization opportunities

Checked against the actual configuration, not as a generic checklist:

| Opportunity | Status in repo | Assessment |
| --- | --- | --- |
| Server Components for initial data | Not used. Pages render shells only. | Real opportunity for read-only, team-scoped first paint, but it changes the auth model for those reads. Requires a privacy review. |
| Streaming and Suspense | One Suspense boundary (roadmap) | Add route-level `loading.tsx` for team routes. Low risk, no security effect. |
| `loading.tsx` | None | Quick win. Shows a skeleton during route transitions. |
| Route prefetching | Default `Link` prefetch | Not measured. Prefetching team tabs would trigger server requests only if their page code loads data on the server, which it does not, so prefetch cost is code-chunk only. |
| Dynamic imports | One (`LazyTrendChart`) | Extend to the Recharts components listed in 6.1. |
| Request memoization (`React.cache`) | Not used | Only useful for server-side duplicate reads within one request. None found in server components; not needed now. |
| `unstable_cache` / `use cache` | Not used | Must not be used for decrypted private data (section 10). |
| Route revalidation (`revalidate`) | Not used | Not applicable to private authenticated data. |
| Server Actions | Not used. All mutations are route handlers. | Keep route handlers. They are the established authorization boundary and are fully tested. |
| Router Cache | Default behaviour | Not measured. Client-side router cache applies to RSC payloads of server pages, which are shells. Low value. |

---

## 8. TanStack Query versus alternatives

### 8.1 The real problem to solve

The evidence points to three client-side costs, none yet measured in time:

1. Repeated identical overview requests across team tabs (3.1). Solvable with a per-session deduplication layer.
2. Serial round trips on the server for each request (5.1). Solvable on the server, independent of client library.
3. Eager chart code on routes that do not need it (6.1). Solvable with dynamic imports.

A general client query library addresses (1) and partly (2) through caching and deduplication, but (2) is server latency that no client cache removes, and (3) is a bundling problem.

### 8.2 Options evaluated

| Criterion | A: Keep existing gateways and hooks | B: Selective TanStack Query | C: Broad TanStack Query | D: SWR | E: Next.js-first, no client library |
| --- | --- | --- | --- | --- | --- |
| Expected speed gain | Small; fixes (1) by a targeted shared-fetch helper | Medium for tab switches; no gain on server latency | Medium, same ceiling as B | Medium, similar to B | Medium for first paint; addresses (2) and (3) |
| Network reduction | Good for overview if deduplicated | Good; automatic dedup | Good | Good | Limited to server fetches |
| User experience | Unchanged | Faster tab return with stale-while-revalidate | Same as B, broader | Same as B | Better first paint with `loading.tsx` |
| Cache consistency risk | None added | Medium: a second cache alongside auth state | High: many caches to keep consistent | Medium | None added |
| Security and privacy | Preserved | Needs per-user, per-team key discipline and cleanup on sign-out | Same, across more data | Same as B | Preserved |
| Bundle impact | None | Adds roughly the library size on client routes (NOT VERIFIED) | Same, larger | Smaller than TanStack | None |
| Migration cost | Low | Medium: one pilot feature | High: 31 client gateway files, plus the 38 files that use `useAuthGatedResource` | Medium | Low to medium |
| Testing requirements | Existing gateway tests | New cache tests plus existing | Large | Medium | Existing plus loading states |
| Maintainability | Good: one pattern | Two patterns during migration | Single pattern, larger surface | Two patterns | Good |
| Long-term scalability | Limited by server latency | Good for client reads | Good | Good | Good for server latency |

### 8.3 Decision matrix (score 1 = poor, 5 = strong, equal weight)

| Criterion | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| Performance gain (measured-ready) | 2 | 3 | 3 | 3 | 4 |
| Security and privacy | 5 | 3 | 2 | 3 | 5 |
| Complexity (higher = simpler) | 5 | 3 | 1 | 3 | 4 |
| Migration risk (higher = lower risk) | 5 | 3 | 1 | 3 | 4 |
| **Total** | **17** | **12** | **7** | **12** | **17** |

A and E tie on score. E is preferred because it also addresses the server-latency item (5.1) and the chart bundle item (6.1), which A does not. Option B is a reasonable **later** step, not a now step. Option C is not recommended. Option D is not better than B for this application's needs.

These scores are judgement, not measurements. They should be revisited after the production build and browser traces exist.

---

## 9. Recommended target architecture

Next.js-first, with a narrow client-side dedupe layer that does not become a second cache of private data:

1. **Server:** parallelize independent auth reads (5.1) after security review. Keep every authorization decision in route handlers. Keep all private data uncached on the server.
2. **Routes:** add `loading.tsx` for each team route group and the home route, so tab switches show structure immediately.
3. **Client, targeted:** a per-page-visit overview dedupe. Two options, both small:
   - a module-level promise cache keyed by the **current ID token's `uid`**, cleared on sign-out and on auth change. It holds only the overview (team names and relationships), never the team data; or
   - lift the overview fetch to `AppShell`, which already runs once per session, and pass the result down through the existing `TeamContextProvider`.
   The second option is simpler and avoids any new cache. It needs review of how `TeamContext` handles account switches.
4. **Charts:** `next/dynamic` for the Recharts components in `HomePanels`, `SkillOverview` and `TeamCompetenceWorkspace`, with a loading placeholder that keeps layout size stable (CLS).
5. **Teamkompetanse:** keep the aggregate uncached. Decide the product answer for teams above 500 memberships (section 11, item P1).

---

## 10. Security and cache-isolation design

These rules apply to any future caching, including a TanStack Query pilot.

- **Private by default.** Decrypted business data (survey results, system records, skill levels, roadmap plans, member lists) is never placed in a shared server cache, a CDN cache, or a browser cache that outlives the session.
- **No cross-user cache.** A server-global `QueryClient` or module-level data cache must not hold per-person or per-team data. Any per-session client cache is keyed by `uid` and `teamId` and cleared on sign-out.
- **Keys are not authorization.** Query keys such as `['team', teamId, 'systems']` are only addresses. The server re-authorizes every request. A cache hit never replaces the call.
- **Membership and permission changes.** Revoked membership, a disabled team, consent withdrawal, and erasure must invalidate any client cache, and the server must still refuse on the next request. The existing `TeamContext` and `AppShell` generation guards are the pattern to extend.
- **Account erasure.** Erasure fences (`erasure-fence.ts`) must still block requests from a cached client. Any client cache must be cleared on erasure completion.
- **Overview as a decision.** The overview is used to skip requests only. The results endpoint remains the authorization decision (section 3.2). Any dedupe layer must not turn an overview entry into an access grant.
- **Teamkompetanse privacy.** The aggregate uses `k >= 3` suppression (`SKILL_COVERAGE_MIN_CONTRIBUTORS`) and a suspect-rating fail-closed rule. Any precomputed or cached aggregate must recompute the k-check at read time or be proven equivalent. Caching it is **not recommended** until that proof exists.

---

## 11. Prioritized improvement backlog

Categories follow the brief: P0 critical, P1 high impact, P2 medium impact, P3 optional.

### P0 — critical

None found in performance terms. The auth chain (P1 below) is a latency issue, not a correctness or security defect. No privacy or correctness regression was observed in the inspected paths.

### P1 — high impact

**P1-1. Overlapping and duplicated overview requests on team tabs**
- Problem: five team tabs refetch `/api/teams` on mount through `TeamPageHeader` (3.1).
- Evidence: CODE-CONFIRMED. Request count INFERRED.
- Proposed solution: lift the overview to `AppShell`/`TeamContext`, or dedupe per `uid`.
- Expected benefit: one fewer request per tab visit; faster header display.
- Complexity: low to medium. Quick win.
- Security: the overview remains non-authoritative; cleared on sign-out.
- Regression risk: medium; header name must still update on team switch.
- Measure: count `/api/teams` requests on a 7-tab navigation in Playwright network logs (before and after). Target: one per session.

**P1-2. Overview-first waterfall on Overview tab**
- Problem: the three parallel data calls wait for the overview (3.2).
- Evidence: CODE-CONFIRMED.
- Proposed solution: start the results, challenges, and skills calls in parallel with the overview, then apply the overview decision before rendering. The results endpoint remains the decision.
- Expected benefit: removes one sequential round trip on the most-visited team page.
- Complexity: medium. Must preserve the TASK-008 and BR-3/BR-14 decision logic.
- Security: must keep the denial path identical; a denied team must not render the data it fetched.
- Regression risk: medium-high (existing tests cover the decision).
- Measure: time from navigation to first team card, production build, emulator.

**P1-3. Serial auth chain on every protected request**
- Problem: at least three sequential Firebase calls before the handler (5.1).
- Evidence: CODE-CONFIRMED. Latency INFERRED.
- Proposed solution: run the fence read and `getUser` in parallel after `verifyIdToken`, preserving all fail-closed mappings.
- Expected benefit: removes one round trip from every protected request.
- Complexity: low in code, high in review burden.
- Security: must pass `security-review` and the emulator tier. Requires explicit approval because it touches authentication.
- Regression risk: medium; error precedence must be unchanged.
- Measure: `verifyIdToken` wall time, emulator, before and after.

**P1-4. Unbounded skill-progress read in the roadmap**
- Problem: `listSkillProgress` reads every progress document for a team with no limit (5.4).
- Evidence: CODE-CONFIRMED. Size INFERRED from schema.
- Proposed solution: a bounded read with a documented cap and a `truncated` flag, the same pattern as the roadmap items.
- Expected benefit: bounds read cost as teams grow.
- Complexity: medium. Must keep roadmap progress correct above the cap.
- Security: no privacy effect if the cap is non-silent.
- Regression risk: medium.
- Measure: reads per roadmap load, emulator, at 10 and 100 people.

**P1-5. Teamkompetanse 500-membership ceiling**
- Problem: the aggregate becomes `incomplete` above 500 memberships, regardless of opt-in count (5.2).
- Evidence: CODE-CONFIRMED.
- Proposed solution: a **product and privacy decision**, not a performance fix. Options include paging the scan with a documented completeness rule, or a precomputed aggregate that still enforces k at read time.
- Expected benefit: removes a hard capacity cliff.
- Complexity: high.
- Security: any change must keep `k >= 3` and the suspect fail-closed rule.
- Regression risk: high.
- Measure: aggregate read count and latency at 100, 500, and 501 memberships on the emulator.
- Action: the 500-membership ceiling is **not recorded** in `docs/KNOWN-LIMITATIONS.md` (MEASURED: grep for the constant and for "cohort scan" finds no match). Record it there, as a stated limit, when the product decision is made.

### P2 — medium impact

**P2-1. Lazy-load Recharts on home, personal skills, and Teamkompetanse**
- Problem: Recharts is static on three routes (6.1).
- Evidence: CODE-CONFIRMED. Bundle effect NOT VERIFIED.
- Proposed solution: `next/dynamic` around each chart component with a sized placeholder.
- Expected benefit: smaller initial JavaScript on those routes.
- Complexity: low.
- Security: none.
- Regression risk: low; watch CLS.
- Measure: production build route sizes before and after; CLS in a trace.

**P2-2. Route-level `loading.tsx` for team and home routes**
- Problem: no loading boundaries (2.7).
- Evidence: MEASURED (absence).
- Proposed solution: skeleton files per team route group.
- Expected benefit: perceived speed on transitions.
- Complexity: low.
- Security: none.
- Regression risk: low.
- Measure: time to first skeleton paint in a trace.

**P2-3. Parallelize `resolveCanEdit` reads**
- Problem: membership and team status are read sequentially (5.4).
- Evidence: CODE-CONFIRMED.
- Proposed solution: `Promise.all`, preserving the same `false` default on any failure.
- Expected benefit: one round trip on roadmap and systems reads.
- Complexity: low.
- Security: identical outcome required, including the `catch`.
- Regression risk: low.
- Measure: handler time on emulator.

**P2-4. Verify `in` query limits in systems membership reads**
- Problem: `listMembershipsByRefs` uses `in` with a caller-supplied list (5.3).
- Evidence: CODE-CONFIRMED that the operator is used. The caller's maximum list size is NOT VERIFIED.
- Proposed solution: confirm the bound, or chunk the query.
- Complexity: low.
- Regression risk: low.

### P3 — optional

**P3-1. Selective TanStack Query pilot** (section 12). Only if P1-1 is done and tab-switch timings still show repeated cost.

**P3-2. Server Components for team read-only first paint.** Requires a privacy design per route. Not proposed now.

**P3-3. Precomputed Teamkompetanse aggregate.** Only with a proof that k-suppression still holds at read time. See P1-5.

**P3-4. Encryption key derivation cache.** HKDF is cheap; a cache would hold key material in memory. Not recommended without a measured cost.

### Quick wins versus architectural changes

- Quick wins: P1-1 (if done as a lift to `AppShell`), P2-1, P2-2, P2-3.
- Architectural or review-gated: P1-2, P1-3, P1-4, P1-5, P3-2, P3-3.

---

## 12. Recommended pilot (for later, not implemented)

If a client-side query library is adopted in a later phase, the best pilot is the **team overview and team header** (`/api/teams` via `TeamPageHeader`). It is the most-repeated read in the application (section 3.1), it is the least sensitive (team names and relationships, no decrypted business data), and it has a small, well-tested gateway (`teams-overview-gateway.ts`).

Proposed pilot shape, for approval only:

1. **Integration boundary:** `fetchTeamsOverview` remains the gateway; a query hook wraps it.
2. **Query key:** `['teams-overview', uid]`. No team identifier is needed for the overview list. `uid` is the identity boundary.
3. **Query function:** the existing gateway call with the current ID token.
4. **Freshness:** `staleTime` of about 30 seconds for membership-sensitive state. Not a global value, per the brief.
5. **Invalidation:** on sign-out, on account switch, after any team membership or access-request mutation, and on erasure.
6. **Authentication and permissions:** the query is never a decision. The server still authorizes each team route.
7. **Tests:** cache-clear on sign-out, account-switch isolation, key separation by `uid`, and the existing overview contract tests.
8. **Before-and-after benchmark:** count `/api/teams` requests across the seven-tab walk-through on the production build, and time to first header paint.
9. **Rollback:** revert the hook to the direct gateway call; no data migration is involved.

Why not start with systems or the Teamkompetanse aggregate: systems hold decrypted records with more edit flows, and the aggregate is privacy-sensitive and uncached by design.

Do not implement this pilot until P1-1 has been measured and approved.

---

## 13. Benchmark methodology

Required before any architectural change is approved:

1. **Production build.** Stop dev processes that share `.next`, or build in a separate clone. Run `pnpm build`, record per-route sizes, then `pnpm start`.
2. **Emulator fixtures.** Use the emulator tier (`pnpm test:emulator`) and the existing seed commands (`seed:demo-team`, `seed:demo-teamkompetanse`, and related). Never use live Firebase. Do not create real accounts.
3. **Synthetic cohorts.** Use seed scripts to create 10, 100, and 501 memberships for benchmark teams in the emulator only. Do not reuse the live demo team `8yB2bS8Jav69TCfDETON`.
4. **Browser traces.** Playwright tracing or Chrome DevTools on the production server, for the ten user journeys in the brief. Record LCP, INP, CLS, long tasks, and request counts.
5. **Server timing.** Temporary timers around `verifyIdToken`, `authorizeTeamAccess`, and the aggregate function, on a local branch that is not committed.
6. **Repetition.** Run each journey at least five times and report the median and range.
7. **Reporting.** Each result carries one of the four labels from the top of this document.

---

## 14. Risks and limitations

- **No runtime measurements.** This audit contains no MEASURED timings for LCP, INP, CLS, route transitions, bundle sizes, or Firestore read latency. All performance statements about runtime are INFERRED or NOT VERIFIED.
- **Dev servers were running.** A production build was not run in place to avoid disrupting them. A clean clone or stopped servers are needed.
- **Pre-existing test failures.** Three tests in `RoadmapPage.verification.test.tsx` fail in the current working tree (section 4.2). Not attributed to this audit. Not verified on a clean checkout.
- **Working tree.** The repository has many uncommitted changes. Some measured counts (for example, the 136 client files) reflect that tree.
- **Firestore pricing.** No cost figures are given. Pricing was not verified against current published rates.
- **Scaling claims.** The 500-membership ceiling and read-count model are arithmetic from constants, not load tests. No load test against live Firebase was run, as required.
- **Caching claims are conservative.** Recommendations to cache are limited to non-private data. Any broader caching requires the isolation proof in section 10.

---

## 15. Go/no-go recommendation for TanStack Query

**Decision: NO-GO now. Revisit selectively later, after the measurements in section 13 exist.**

Reasons:

1. The largest measurable-in-principle costs are server round trips (auth chain, overview waterfall) and bundle placement (Recharts). A client query library does not remove either.
2. The one clear client-side repetition (team overview on every tab) can be fixed with a small, auditable change, without adding a second cache of authenticated state.
3. The privacy and cache-isolation requirements (section 10) add real complexity, and a broad migration would touch about 31 gateways.
4. No production-build or browser measurement exists yet to show that tab-switch repetition is a significant cost.

Conditions to change this to **selective GO** (pilot in section 12):

- P1-1 has been done and tab switches still show measurable repeated-fetch cost in production-build traces; and
- the cache-isolation tests in section 10 are written and reviewed first.

**Broad adoption (Option C) is a no-go** at any point in the next 12–24 months unless the application grows many more client-side interactive reads than it has today.

### Answer to the final question

The best 12–24 month performance architecture is **Next.js-first**: shorten server round trips (reviewed auth parallelism), add route-level loading states, and load charts only where used. Keep the gateway and hook pattern with one narrow dedupe for the team overview. Consider a selective TanStack Query pilot for the overview only after measurements justify it. Do not adopt it broadly. The biggest long-term capacity issue is not client caching; it is the Teamkompetanse 500-membership ceiling and its scan model, which needs a product and privacy decision.

---

## Phase 1 — Implementation and measured results

Status: measured on unauthenticated routes only. Authenticated application performance is **NOT VERIFIED**. Sources: scratchpad runs `baseline-public.json` (measured 2026-11-16 17:46Z) and `after-public.json` (measured 2026-11-16 18:42Z). Method: `measure.mjs`, headless Chromium, cold load, 5 runs per route, median reported, service workers blocked, no live Firebase.

### 1.1 Baseline and after measurements (MEASURED, production build, unauthenticated)

| Route | Load ms (base → after) | JS requests (base → after) | JS KB (base → after) | Requests (base → after) | API requests | FCP ms (base → after) | LCP ms (base → after) | CLS (base → after) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/sign-in` | 231 → 222 | 20 → 19 | 1042.2 → 669.2 | 28 → 26 | 0 / 0 | 100 → 156 | 100 → 156 | 0 / 0 |
| `/sign-up` | 113 → 177 | 19 → 18 | 1037.0 → 664.1 | 26 → 25 | 0 / 0 | 68 → 124 | 68 → 124 | 0 / 0 |
| `/` | 218 → 211 | 19 → 18 | 1037.0 → 664.1 | 27 → 25 | 0 / 0 | 80 → 124 | 80 → 124 | 0 / 0 |
| `/teams` | 137 → 190 | 20 → 19 | 1044.9 → 673.7 | 28 → 26 | 0 / 0 | 72 → 88 | 152 → 236 | 0 / 0 |
| `/teams/demo-team/competence` | 445 → 233 | 25 → 22 | 1152.5 → 724.9 | 33 → 30 | 0 / 0 | 100 → 148 | 484 → 260 | 0.0001 / 0.0001 |
| `/teams/demo-team/results` | 141 → 224 | 24 → 22 | 1104.6 → 725.5 | 35 → 30 | 0 / 0 | 84 → 140 | 176 → 248 | 0 / 0 |

Each value is the median of 5 runs. Only medians were persisted, so minimum, maximum and per-run spread are NOT VERIFIED.

### 1.2 Percentage changes and interpretation

- **Initial JavaScript (MEASURED):** down about 34–37% on the measured routes (`/` −36%, competence −37%, results −34%, sign-in −36%). This is the clearest measured effect. Attribution to lazy-loaded Recharts is INFERRED: the chunk lists (`js-baseline-*.txt`, `js-after2-*.txt`) differ, but Recharts-containing chunks were not identified by name in this phase.
- **Load time (MEASURED, not meaningful):** route changes range from about −3% to +62%. With five runs and no persisted spread, these cannot be separated from noise. The competence improvement (445 → 233 ms) is driven by a baseline outlier. **No load-time improvement is demonstrated.**
- **LCP (MEASURED, mixed):** competence 484 → 260 ms; `/teams` 152 → 236 ms and results 176 → 248 ms are worse. These differences are the same order of magnitude as the load-time noise. **Not a verified improvement.**
- **Request counts (MEASURED):** 1–5 fewer requests per route (about −7% to −14%). These are static asset requests on unauthenticated routes.
- **`/api/teams` requests (NOT VERIFIED):** the benchmark recorded 0 API requests on every route, because no authenticated session existed. The effect of TeamContext deduplication on `/api/teams` count is unmeasured.
- **CLS:** 0 to 0.0001 on every route in both versions. No layout-shift regression is visible on these routes.

### 1.3 Known measurement limitations

1. **No authenticated route was measured.** Every route in the table renders the public or redirect path for an anonymous visitor. These numbers say nothing about team-tab navigation, Teamkompetanse data loading, Systemoversikt, Roadmap or Home for a signed-in user. Measuring them needs an emulator-seeded account. That was not run, and live Firebase was not used.
2. **The baseline build cannot be re-served.** `scratchpad/next-baseline` has no `.next` directory. An earlier copy into `scratchpad/build-baseline` failed with `cp: cannot create regular file … No such file or directory`. The baseline JSON is the only surviving record of the baseline numbers. The baseline build came from the working tree at that time, which holds many unrelated uncommitted changes, so it is not a clean copy of the original code. Provenance of the baseline build is NOT VERIFIED.
3. **The first after-run wrote nothing.** `measure.mjs` failed on a mangled Windows path (`C:\c\Users\…`). That run recorded `jsCount: 0` on every route (redirect-only responses) and must be disregarded. The valid after-run is the 18:42Z run.
4. **Measurement server was stopped.** Port 3100 was not listening when this section was written, so the numbers cannot be re-checked against a running server.
5. **Medians only.** Per-run data was not persisted, so min/max and significance cannot be computed.
6. **Headless Chromium LCP/CLS** is a lab proxy, not field data.

### 1.4 Security review results (CODE-CONFIRMED)

- **memberRef generation (`src/features/teams/domain/member-ref.ts`):** uses `globalThis.crypto.getRandomValues` (a CSPRNG in Node and in browsers), not `Math.random`, and has no fallback. It emits 16 bytes = 128 bits, encoded as 26 characters from the same 32-character alphabet, with the final character zero-padded. Compared with `HEAD`, the alphabet, match pattern, bit-packing loop and output format are unchanged. The only change is `node:crypto.randomBytes` → Web Crypto. The format is therefore compatible with stored values and needs no migration. The module no longer imports `node:crypto`, so it bundles for the browser. The format tests in `member-ref.test.ts` pass (section 1.5).
- **TeamContext overview cache (`src/components/nav/TeamContext.tsx`):** scoped to the provider instance (a React ref), not module-global. Keyed by the full ID token. Cleared on sign-out (`observeIdToken` with `null`). Failed reads are not kept. It holds only the team-name display list. Every protected endpoint still authorizes independently, so a cached overview is never an authorization decision.
- **Open item (INFERRED, not changed in this phase):** keying by the full token causes a cache miss on every Firebase token refresh (about hourly), costing one extra `/api/teams` read on the next team-tab mount. A smaller key, the Firebase `uid`, would avoid that, but it needs a client-side token decode that this phase did not add. Proposed, not implemented.

### 1.5 Test results

Run after the benchmark processes had ended.

- `pnpm test:quick --files` on the two TeamContext files, member-ref, materialize-member-refs, RoadmapPage.verification and AppShell: **59 files passed, 3 skipped; 863 tests passed, 4 expected-fail, 19 skipped.** Task-scoped quick feedback, not complete verification.
- `pnpm test:standard --files` on the same six test files: **147 files passed, 3 skipped; 2487 tests passed, 4 expected-fail, 19 skipped.** Task-scoped, not the full suite.
- `pnpm typecheck` (`tsc --noEmit`): **passed, no output.**
- ESLint on changed nav, teams and roadmap source files: **no output, but NOT VERIFIED as a pass**, because the exit code was masked by a pipe. Rerun without a pipe is required.
- Roadmap responsive guard tests and the mid-session permission-loss test (`TASK-012`) **passed in this run**. They failed in the earlier run recorded in section 4.2. No timeout was changed. The cause of the earlier failure was not isolated (NOT VERIFIED), so treat it as load-dependent until reproduced.
- Full `pnpm test:standard`, `pnpm test:full` and `pnpm test:emulator` were **not run** in this phase. Results: NOT VERIFIED.

### 1.6 Remaining performance bottlenecks (INFERRED unless stated)

1. Authenticated team pages are unmeasured. The server-side auth chain and the Teamkompetanse aggregate (section 5) are the likely largest costs.
2. Initial JavaScript on the public shell is still about 665 KB. What remains in that budget is not yet attributed.
3. The token-keyed overview cache causes one extra `/api/teams` read per token refresh (section 1.4).
4. The Teamkompetanse 500-membership ceiling (section 5.2) is the largest capacity risk. It is a product and privacy decision, not a caching problem.

### 1.7 Answers to the phase questions

1. **Did DevPulse become measurably faster?** Not demonstrated for user-perceived timing. Initial JavaScript on the measured public routes fell by about 34–37% (MEASURED). Load-time and LCP changes are within noise, and no authenticated route was measured.
2. **Largest verified improvement:** the initial JavaScript reduction on the public routes (MEASURED). Attribution to lazy-loaded Recharts is INFERRED.
3. **Did overview deduplication preserve authentication and authorization behavior?** Code review shows the cache is display-only, cleared on sign-out, and that the server authorizes each request (CODE-CONFIRMED). Unit tests in `TeamContext.overview.test.tsx` pass. No authenticated browser test was run, so the in-browser tab-navigation request count is NOT VERIFIED.
4. **Is Web Crypto memberRef generation fully compatible?** Yes for format, alphabet, length, entropy and stored-value compatibility (CODE-CONFIRMED, tests pass). A cross-browser matrix was not run.
5. **Are charts still functional?** Roadmap and chart-related unit tests pass. Visual verification in a signed-in browser was not performed (NOT VERIFIED).
6. **Are all standard tests green?** The scoped standard run is green. The full `pnpm test:standard` suite was not run, so the full-suite answer is NOT VERIFIED.
7. **Is any security-related issue unresolved?** The token-keyed cache key is a cost and correctness issue, not a confirmed security issue. The mid-session permission-loss test passes now, but the root cause of its earlier failure is unverified.
8. **What should be optimized next?** Measure authenticated routes with an emulator-seeded account, then attribute the remaining public-shell JavaScript. Only then decide on any caching change.
9. **Is TanStack Query still unnecessary?** Nothing in this phase changes the decision in section 15. Repeated client fetches were not measured as a significant cost, so the decision stays NO-GO.
