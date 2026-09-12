# Product UX, Localization and Application Shell (Phase 3)

## Status
Approved — implemented (TASK-001 through TASK-011 Done; see
[TASKS.md](./TASKS.md)). Feature-level user review and a security/privacy
regression review both completed; see TASKS.md's TASK-011 closeout note.

## Problem
The implemented product (pulse survey, auth, teams, team results, admin) is
functionally complete through `docs/features/team-management/SPEC.md`, but
it was built incrementally across three separate vertical slices, each with
its own ad hoc English copy, its own inline Tailwind styling, and its own
bespoke loading/empty/error handling. The site header ignores auth/admin
state entirely, nothing localizes the UI to Norwegian, and there is no
shared set of UI primitives, so the screens don't yet read as one considered
application (`docs/ROADMAP.md` Phase 3, `docs/UI-UX.md`). This feature turns
that direction into an implementable specification, without changing any
authentication, authorization, anonymity, aggregation, or privacy behavior.

## User outcome
A user of any existing DevPulse flow — public survey, sign-in/up, `/teams`,
team results, admin — sees a consistent, Norwegian-language, auth-aware
application with one navigation/shell, consistent buttons/forms/cards/
alerts, well-defined loading/empty/error/authorization/infrastructure-
failure states, a responsive layout, and accessible markup — with none of
the underlying behavior, data, or privacy guarantees changed.

## Scope
- Norwegian-language UI copy across every existing user-facing screen (home,
  pulse survey, sign-in, sign-up, `/teams`, `/teams/[teamId]`,
  `/admin/teams`, `/admin/teams/[teamId]`, `/results` redirect's own visible
  text), via a lightweight, in-repo string-module localization approach (no
  new i18n dependency, no locale-prefixed routing).
- An auth-aware, admin-aware site header/navigation with the label sets
  defined in `docs/UI-UX.md`.
- A minimal, new server-only "own admin status" read (extends the existing
  app-admin trust boundary; adds no new Firestore access) so the header can
  show/hide the Admin link from server-derived state only — never a
  client-side `APP_ADMIN_EMAILS` check.
- A shared application shell (consistent page container/header hierarchy)
  applied to every existing page.
- A small set of reusable UI primitives under `src/components/ui/` (button
  variants, form field, card/panel, page header, alert/status message,
  empty state, loading state) and their adoption across existing
  components, replacing duplicated inline Tailwind class strings — no
  visual redesign beyond consolidating conventions already in consistent
  use.
- Consistent loading/empty/success/validation-error/authorization-failure/
  infrastructure-failure states across every existing data-fetching screen,
  using the primitives above.
- Post-sign-in continuation to `/teams` (relabeled link; still an explicit
  "Continue" action, not an automatic redirect — see Architecture
  decisions).
- Consolidating internal navigation onto `next/link`'s `Link` component
  (currently inconsistently mixed with plain `<a href>`).
- Adoption of exactly one chart library (Recharts) for the team-results
  trend view, additive to — not replacing — the existing accessible HTML
  trend table.
- Responsive behavior and accessibility improvements (semantic headings,
  labels, keyboard access, focus states, contrast, no color-only signaling)
  across the screens above.
- Extracting the duplicated client-side "auth-state + stale-response guard"
  pattern (currently repeated verbatim in `TeamsOverview`, `TeamDetail`,
  `AdminTeams`, `AdminTeamDetail`, `ResultsRedirect`) into one shared hook
  under `src/features/auth/client/`.

## Out of scope
- Any change to authentication, authorization, team isolation, anonymity,
  encryption, aggregation, or the minimum response threshold — every
  existing `docs/features/*/SPEC.md` behavioral requirement continues to
  hold unchanged.
- Any new product capability from a later roadmap phase (`AnonymousChallenge`,
  forums, skill trees).
- Any new Firestore collection, field, index, or query pattern beyond the
  one minimal admin-status read described above (which itself needs no
  Firestore read at all — see Architecture decisions).
- A full visual brand identity/design system beyond consolidating
  already-established conventions (color palette, button/card shapes) into
  shared primitives.
- Multi-locale support or a language switcher — Norwegian is the only
  user-facing language; English remains for code/docs/API only
  (`docs/UI-UX.md`).
- Picking a different testing/visual-regression tool — existing `vitest`/
  `@testing-library/react` conventions are reused unchanged.
- Rewriting `PulseSurveyForm`, `SignInForm`, `SignUpForm`, `TeamsOverview`,
  `TeamDetail`, `AdminTeams`, `AdminTeamDetail`'s existing data-fetching/
  mutation logic — only their presentation (copy, primitives, styling) and
  the shared auth-gating hook extraction change; their server calls,
  gateways, and behavior contracts are untouched.

## Key concepts
- **Application shell**: the shared header/navigation + page container
  wrapping every route, replacing each page's currently duplicated
  `flex flex-1 justify-center ...` wrapper markup.
- **UI primitive**: a small, reusable presentation component under
  `src/components/ui/` (e.g. `Button`, `Card`, `Alert`, `PageHeader`,
  `EmptyState`, `LoadingState`) with no business logic, per
  `.claude/rules/architecture.md`.
- **Copy module**: a plain TypeScript module of Norwegian string constants
  for one feature/shared area (e.g. `src/features/teams/copy.ts`), imported
  by that area's components — the localization mechanism for this feature
  (see Architecture decisions).
- **Own admin status**: a caller's own `isAdmin` boolean, already promised
  never to leak any other identity's status or the `APP_ADMIN_EMAILS` list
  itself (`docs/features/team-management/SPEC.md` BR-36); this feature adds
  the minimal read that exposes exactly that value to the header.

## Actors and access
Unchanged from existing specs — this feature changes no actor's access.
For UI-observable purposes only:
- **Anonymous visitor**: sees the public survey and auth pages in
  Norwegian, with the "signed out" nav set.
- **Authenticated, non-admin user**: sees the "signed in" nav set (no
  Admin link).
- **App admin**: sees the "signed in" nav set plus Admin — driven by the
  new server-derived own-admin-status read, never a client-side allow-list
  check.

## User stories
1. As a Norwegian-speaking developer, I want the entire application in
   Norwegian so that I don't have to read English UI to answer a pulse
   survey or check my team's results.
2. As a signed-in user, I want the header to reflect that I'm signed in
   (and, if I'm an app admin, to see an Admin link) so that I don't need to
   guess what's available to me or navigate through URLs I already happen
   to know.
3. As a user of any screen, I want a clear, consistent loading/empty/error
   state so that I always know whether something is still loading,
   genuinely empty, or broken.
4. As a signed-in user who just signed in, I want to land on `/teams` so
   that I reach my next likely action without an extra click through a
   compatibility redirect.
5. As a team member viewing my team's results, I want a clear visual trend
   alongside the existing numbers so that I can spot a shift over the last
   12 periods at a glance, without the chart ever implying a suppressed
   period had a real, low value.
6. As a developer extending this codebase later, I want a small set of
   shared UI primitives and one shared auth-gating hook so that new screens
   don't re-invent the same button styles, alert markup, or auth-state-
   guard logic a fifth time.
7. As the system, I want every existing authorization/anonymity/
   aggregation/threshold guarantee to keep holding exactly as before, so
   that a UI-only phase cannot regress privacy.

## Behavioral requirements

**Localization**
- BR-1: Every user-facing string on every existing screen (home, pulse
  survey, sign-in, sign-up, `/teams`, `/teams/[teamId]`, `/admin/teams`,
  `/admin/teams/[teamId]`, `/results`'s own visible "Redirecting…" text) is
  rendered in Norwegian.
- BR-2: Norwegian strings live in per-feature/shared-area copy modules
  (plain TypeScript constants), not inline in JSX, and not scattered as ad
  hoc literals — every component under `src/features/*/components/` and
  `src/components/` sources its user-facing text from its area's copy
  module.
- BR-3: No repository content outside rendered UI text changes language —
  code identifiers, comments, commit messages, `docs/`, API field
  names/contracts, and log output remain English.

**Navigation and admin visibility**
- BR-4: The site header shows exactly: Hjem, Pulsundersøkelse, Logg inn,
  Opprett konto when signed out; Hjem, Pulsundersøkelse, Team, Logg ut when
  signed in (non-admin); the signed-in set plus Admin when the caller is an
  app admin.
- BR-5: The header's signed-in/admin state is derived only from (a) the
  client's own Firebase ID token presence (`observeIdToken`, existing) for
  sign-in state, and (b) a new server-derived own-admin-status read for the
  Admin link — never a client-side check against `APP_ADMIN_EMAILS` or any
  other allow-list, and never a client-supplied role/flag.
- BR-6: "Logg ut" signs the current user out via the existing Firebase
  client SDK sign-out call and returns the header to the signed-out state
  without requiring a full page reload for the header itself to update.
- BR-7: Every existing internal navigational link (header nav, team list,
  admin team list, sign-in/sign-up cross-links, results-redirect
  continuation) uses `next/link`'s `Link` component rather than a plain
  `<a href>`.

**Application shell and primitives**
- BR-8: Every existing route (`/`, `/pulse-survey`, `/sign-in`, `/sign-up`,
  `/teams`, `/teams/[teamId]`, `/admin/teams`, `/admin/teams/[teamId]`,
  `/results`) renders inside one shared page-shell primitive (consistent
  outer container + page-header treatment), replacing each page's
  currently hand-duplicated wrapper markup.
- BR-9: A shared `Button` primitive (primary/secondary/destructive
  variants, with a disabled/pending state) replaces every existing inline
  button `className` string that already matches one of these three
  visual variants.
- BR-10: A shared `Card`/panel primitive replaces the three currently
  near-duplicate "bordered rounded box" treatments (list-row card,
  result-summary panel, auth/survey-form panel).
- BR-11: A shared `Alert`/status-message primitive (success/error/info
  variants, `role="status"`/`role="alert"` as appropriate) replaces every
  existing inline status/error paragraph.
- BR-12: A shared `EmptyState` primitive and a shared `LoadingState`
  primitive replace every existing ad hoc "No X yet" / "Loading X…"
  paragraph.
- BR-13: Admin screens (`/admin/teams`, `/admin/teams/[teamId]`) use the
  same shared primitives as member-facing screens (no separate component
  system), styled for operational density rather than illustrative layout,
  per `docs/UI-UX.md` → Admin UX.

**Shared client infrastructure**
- BR-14: A shared client-side auth-gating hook guarantees that a
  superseded auth state (sign-out, account switch, token refresh) or
  component unmount discards any in-flight async result belonging to the
  previous state — the same guarantee `TeamsOverview`, `TeamDetail`,
  `AdminTeams`, `AdminTeamDetail`, and `ResultsRedirect` each individually
  implement today, now provided by one shared implementation all five
  (plus the header's own admin-status read) adopt.

**Interaction states**
- BR-15: Every screen that fetches server data (all five existing
  client-side auth-gated components, the header's own admin-status read,
  and the server-rendered pulse-survey page) renders a distinct state for:
  loading, empty (where applicable), success, validation error,
  authorization failure, and infrastructure failure — reusing BR-11/BR-12's
  primitives, in Norwegian.
- BR-16: An authorization-failure state (e.g. non-member viewing a team,
  non-admin viewing an admin page) never reveals more than the existing
  server responses already disclose (unchanged from
  `docs/features/team-management/SPEC.md` BR-15/BR-16) — this feature only
  restyles/relocalizes these states; it does not change what information
  they contain.

**Auth UX**
- BR-17: After a successful sign-in, the confirmation state's continuation
  link points to `/teams` (not `/results`).
- BR-18: Sign-in/sign-up/email-verification behavior itself (Firebase
  Authentication calls, required-verification gating of team resolution)
  is unchanged; only copy, styling, and the BR-17 link target change.

**Results UX and charts**
- BR-19: The team-results view (`/teams/[teamId]`, authorized state)
  renders the existing accessible HTML trend table unchanged in its
  data/logic, plus a new chart (Recharts) visualizing the same 12-period
  trend per dimension, sourced from the exact same `PeriodAggregateResult[]`
  data already returned to the client — no new data is fetched for the
  chart.
- BR-20: The chart never renders a `suppressed`/`insufficient`/
  `not_available` period as a zero value, as a point visually identical to
  a real low value, or in any way from which the true underlying count
  could be inferred — such periods are shown as a distinct, explicit
  gap/marker state in the chart, mirroring the table's existing "Not
  enough responses yet" / "Not available" treatment.
- BR-21: The most-recently-closed-period summary (`PeriodSummary`) keeps
  its existing non-chart presentation — a single period's numbers don't
  benefit from charting; only the 12-period trend view gains a chart.

**Responsive and accessibility**
- BR-22: Every screen in scope renders without page-level horizontal
  scrolling at common phone widths (~360–400px), with the header/nav
  collapsing to a usable form and the trend table/chart scrolling only
  within their own container if they must.
- BR-23: Every form control across every screen in scope has a properly
  associated `<label>`; heading levels form one logical hierarchy per
  page; every interactive control is reachable and operable by keyboard
  with a visible focus state; no state (error, status, chart series) is
  communicated by color alone.

## Edge cases and failure behavior
- The new own-admin-status read fails (network/infrastructure error) → the
  header treats the caller as non-admin for that render (Admin link
  hidden) rather than failing the whole header/page; it does not retry
  automatically or show an error state in the header itself. A genuine
  admin whose status read transiently failed simply doesn't see the Admin
  link until the next successful check — never a false positive.
- A caller signs out while the admin-status read is in flight → the shared
  hook's generation guard (BR-14) discards the stale result exactly as the
  existing components already do for other in-flight reads.
- A period's chart point is `insufficient`/`not_available` immediately
  adjacent to a `published` one → the chart's gap/marker treatment must
  remain visually distinct at every width, including the smallest
  supported viewport (BR-22).
- Norwegian copy for a not-yet-covered edge-case message (e.g. a network
  failure inside a primitive) still exists in the relevant copy module —
  no path falls back to an untranslated English string load-bearing for
  the user (an English identifier inside an internal error *code* is fine;
  user-visible text is not).
- A browser with JavaScript disabled or blocked cannot use any
  client-rendered screen (`/teams`, `/teams/[teamId]`, `/admin/teams`,
  `/admin/teams/[teamId]`, auth forms) — unchanged from today; not
  addressed by this feature (no SSR-with-hydration-fallback strategy is
  introduced).

## Security and privacy
- No change to any `docs/SECURITY.md` invariant: this feature touches only
  presentation, copy, and one minimal, non-sensitive, own-status-only
  server read.
- The new own-admin-status read reuses `isAppAdmin`/`requireAppAdmin`'s
  existing verified-token + `APP_ADMIN_EMAILS` allow-list check
  (`docs/features/team-management/SPEC.md` BR-5/BR-6) completely
  unchanged; performs no Firestore read (the same property `isAppAdmin`
  already has); returns only the caller's own `{isAdmin: boolean}`, never
  the allow-list, another identity's status, or any team/result data —
  directly implementing the already-approved BR-36 guarantee, not
  introducing a new one.
- Invariant 17 (admin ≠ raw-response access) is unaffected — the Admin nav
  link only makes an already-authorized admin's existing admin routes
  easier to find; it grants no new capability.
- The chart (BR-19/BR-20) renders only data the server already authorized
  and returned for this caller (`PeriodAggregateResult[]`, unchanged) — no
  client-side computation derives, estimates, or interpolates a value the
  server withheld. BR-20 directly implements `docs/SECURITY.md` invariants
  10–12 (never imply an individual score exists; never reveal a
  below-threshold count) in a new rendering surface.
- Localization touches only rendered string literals — no user input,
  survey content, or identity data is newly rendered, logged, or persisted
  anywhere as a result of this feature.

## Architecture decisions
- **Localization mechanism (decided, per product-direction confirmation)**:
  lightweight in-repo Norwegian copy modules, one per feature/shared-
  component area (e.g. `src/features/teams/copy.ts`,
  `src/components/ui/copy.ts`), imported directly by components — no i18n
  library, no `[locale]` route segment. Chosen because `docs/UI-UX.md`
  requires exactly one fixed user-facing language with no switcher; a
  routing-level i18n framework would force restructuring every existing
  route for a capability nothing in scope needs.
- **Chart library (decided, per product-direction confirmation)**:
  Recharts, added as a new `dependencies` entry. Used only by a new
  results-feature chart component consuming the existing
  `PeriodAggregateResult[]` — no other part of the codebase depends on it,
  keeping the "one chart library" constraint (`docs/UI-UX.md`) trivially
  satisfied. Exact chart type (line vs. bar per dimension) and the precise
  suppressed-period marker treatment (BR-20) are left to task planning/
  implementation, within the constraint that a suppressed value is never
  visually indistinguishable from a real one.
- **New minimal server read**: a new server operation (e.g.
  `src/features/teams/server/get-own-admin-status.ts`) and a thin route
  (e.g. `GET /api/me`), reusing `verifyIdToken` + `isAppAdmin` exactly as
  `requireAppAdmin` already does, returning `{isAdmin: boolean}` only. Not
  reusing `GET /api/teams` for this purpose: that endpoint's `relationship`
  field only signals `"admin"` on *existing* team entries, which is empty
  — and therefore silently wrong — for an app admin with zero active/
  related teams; not a reliable general-purpose "am I admin" signal. The
  new endpoint performs no Firestore read at all (same property
  `isAppAdmin` already has), so it adds negligible cost.
- **Shared auth-gating hook**: the `observeIdToken` + monotonic-generation
  stale-response-guard pattern, currently duplicated verbatim across
  `TeamsOverview`, `TeamDetail`, `AdminTeams`, `AdminTeamDetail`, and
  `ResultsRedirect`, is extracted into one hook (e.g.
  `useAuthGatedResource` under `src/features/auth/client/`, alongside the
  existing `observeIdToken`) that each of those five components — plus the
  new `SiteHeader` client logic — adopts. Placed under the `auth` feature
  (which already owns `observeIdToken`) rather than `src/lib/`, since the
  pattern is specifically about auth-state gating, not generic
  infrastructure (`.claude/rules/architecture.md`). This is a
  behavior-preserving refactor: every component's own fetch/mutation
  logic, error handling, and rendered result stay exactly as they are
  today.
- **`SiteHeader` becomes a small Client Component boundary**: today it's a
  Server Component explicitly documented as "deliberately not auth-aware"
  because no server-side session exists to read. This feature makes it
  (or a thin client wrapper it renders) subscribe to `observeIdToken` plus
  the new own-admin-status read, using the shared hook above — the same
  established pattern every other authenticated surface in this codebase
  already uses. No server-side session is introduced.
- **UI primitives location**: `src/components/ui/` (already the
  designated location per `.claude/rules/architecture.md`, currently
  empty). Primitives are added only for the kinds already recurring three
  or more times in the current implementation (`Button`, `Card`, `Alert`,
  `EmptyState`, `LoadingState`) plus a `PageHeader`/page-shell pair — not
  speculatively beyond that.
- **No visual redesign**: the existing Tailwind conventions (zinc/red
  palette, `rounded-full` buttons, `dark:` variants via
  `prefers-color-scheme`, `focus-visible:outline`) are preserved as-is
  inside the new primitives — this feature consolidates duplication, it
  does not restyle.
- Consistent with `docs/UI-UX.md` → "Inspiration": Linear/Culture
  Amp/Vercel inform restraint and information density in task-level
  implementation choices; no interface is copied.

## Test boundaries
| Boundary | Covers |
|---|---|
| Server: own-admin-status operation (verified-token + allow-list; no other identity/list leaked) | BR-5 |
| Client: shared auth-gating hook (generation-guard: sign-out/account-switch/unmount discards stale results) | BR-14 |
| UI: `SiteHeader` nav-set rendering per auth/admin state (signed out / signed in / admin) | BR-4, BR-5, BR-6 |
| UI: internal navigation uses `next/link`'s `Link` (no plain `<a>` for in-app routes) | BR-7 |
| UI: shared primitives (`Button`, `Card`, `Alert`, `EmptyState`, `LoadingState`, page shell) render/variant contract | BR-8, BR-9, BR-10, BR-11, BR-12, BR-13 |
| UI: each existing screen's loading/empty/success/validation-error/authorization-failure/infrastructure-failure states | BR-15, BR-16 |
| UI: Norwegian copy present per screen (no residual untranslated user-facing string) | BR-1, BR-2, BR-3 |
| UI: sign-in success continuation target | BR-17 |
| UI: results trend chart (renders from existing data only; suppressed-period marker distinct from a real value; no new fetch) | BR-19, BR-20, BR-21 |
| Accessibility: label association, heading order, keyboard operability, focus visibility, no color-only signaling (spot-checked per screen) | BR-23 |
| Responsive: no page-level horizontal scroll at ~360–400px width (spot-checked per screen) | BR-22 |
| Regression: every existing `docs/features/*/SPEC.md` acceptance criterion still passes unchanged | Security and privacy section |

## Acceptance criteria
- [ ] Every existing screen's user-facing text renders in Norwegian; no
      English string is user-visible outside a technical identifier.
- [ ] The header shows exactly the signed-out / signed-in / signed-in-admin
      link sets defined in BR-4, driven only by the client's own token and
      the new own-admin-status read — never a client-evaluated
      `APP_ADMIN_EMAILS` check.
- [ ] A non-admin authenticated user never sees an Admin link, including
      immediately after sign-in and after a token refresh.
- [ ] Every route in scope renders inside the shared page shell using the
      new `src/components/ui/` primitives; no page retains its own
      duplicated wrapper/button/card/alert markup for a case a primitive
      already covers.
- [ ] Every internal navigational link in scope uses `next/link`'s `Link`.
- [ ] Every existing client-fetching screen shows a distinct, Norwegian
      loading/empty/error/authorization-failure state as applicable, using
      the shared primitives.
- [ ] Signing in successfully shows a continuation link to `/teams`.
- [ ] The team-results trend view shows both the existing accessible table
      and a new Recharts-based chart, sourced from the same already-fetched
      data, with no additional network request.
- [ ] No period ever shown as `insufficient` or `not_available` in the
      table is rendered by the chart as a zero or as visually
      indistinguishable from a real published value.
- [ ] Every screen in scope is usable at a ~360–400px viewport width with
      no page-level horizontal scrolling.
- [ ] Every form control has an associated label; tab order reaches every
      interactive control; focus is visibly indicated; no state relies on
      color alone.
- [ ] The full existing automated test suite (`pnpm lint`, `pnpm
      typecheck`, `pnpm test`, `pnpm build`) passes, and every existing
      `docs/features/*/SPEC.md` acceptance criterion continues to hold (no
      authorization, anonymity, aggregation, or threshold behavior
      changed).

## Open questions
None blocking. The two decisions that would otherwise have blocked
planning — localization mechanism and chart-library adoption — were
confirmed during planning; see Architecture decisions. Non-blocking
implementation-detail items left to task planning:
- Exact Recharts chart type (line vs. bar) and its precise
  suppressed-period marker visual treatment (must satisfy BR-20; exact
  shape is task-level).
- Exact copy-module file layout (one file per feature vs. finer-grained) —
  implementation detail, as long as BR-2's "one authoritative Norwegian
  source per area, not scattered literals" holds.
- Exact new-endpoint path/name for the own-admin-status read (`GET
  /api/me` used above as illustrative) — naming is task-level detail.
