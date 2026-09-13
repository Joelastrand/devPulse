# DevPulse — UI/UX Direction

## Purpose / Status

This document defined the long-term UI/UX direction for **Phase 3 —
Product UX, Localization and Application Shell** (see `docs/ROADMAP.md`).
It is a design-direction reference, not a feature spec: it did not by
itself authorize implementation. Phase 3 implementation work went through
`plan-feature` → `split-tasks` → `implement-task` in the normal way,
producing `docs/features/product-ux-shell/SPEC.md` and `TASKS.md`, which
remain authoritative for the exact behavioral requirements that were
implemented.

**Status: implemented (Phase 3, `docs/features/product-ux-shell/`,
TASK-001 through TASK-011 Done).** This document remains the direction
reference the feature was built against; see `docs/PRODUCT.md` and
`docs/features/product-ux-shell/SPEC.md` for what is actually implemented
today, and treat any wording below as historical intent where it differs
from `SPEC.md`'s recorded implementation decisions.

## Product experience principles

- Coherence over novelty: make the already-implemented product (survey,
  teams, results, admin) feel like one considered application, not a
  collection of separately built screens.
- Calm, operational tone — DevPulse surfaces sensitive-adjacent
  organizational signal; it should never feel like a dashboard optimized
  for engagement or gamified individual metrics (see "Privacy-aware
  design" below).
- Restraint before decoration: prefer clarity, whitespace, and hierarchy
  over visual flourish.
- Every screen has a considered state for loading, empty, success,
  validation error, authorization failure, and infrastructure failure —
  no screen ships with only the "happy path" designed.

## Language

- **User-facing application language is Norwegian.** All UI copy —
  labels, navigation, buttons, form fields, empty/error/success states —
  is written in Norwegian.
- **Technical repository content stays English** unless a specific string
  is explicitly called out otherwise: code, identifiers, comments, commit
  messages, `docs/` content (including this file), API contracts/field
  names, and log output all remain English. Only rendered, user-facing UI
  text is localized.
- No i18n framework/library choice is made by this document — that is an
  implementation decision for Phase 3 task planning.

## Navigation

Auth-aware header/navigation, driven by resolved auth and admin state:

- **Signed out**: Hjem, Logg inn, Opprett konto
- **Signed in**: Hjem, Team, Logg ut
- **Signed in, app admin**: the signed-in set, plus Admin

**Updated by `docs/features/managed-surveys/SPEC.md` (TASK-013):** the
original Phase 3 nav set above included a "Pulsundersøkelse" entry linking
to the single static public survey. That survey concept is retired —
surveys are now admin-managed instances discovered via a team page or a
shared `/survey/{surveyId}` link, never a generic nav entry — so the nav
set no longer includes it, in either signed-out or signed-in state.

Admin visibility in the UI must be derived from **server-derived admin
state** (the caller's own `isAdmin` boolean, as already returned by the
server per `docs/ARCHITECTURE.md` / `docs/features/team-management/
SPEC.md`), never from a client-side check against `APP_ADMIN_EMAILS` or
any other client-evaluated allow-list — that list is server-only and must
never reach the browser (unchanged invariant, `docs/SECURITY.md`,
`docs/DEVELOPMENT.md`). The UI only ever renders based on what the server
already told this caller about themselves.

### Primary flows

- **Survey participation**: a generated `/survey/{surveyId}` link (shared
  externally, or discovered on a team's own page) — never a Home/nav entry
  point (`docs/features/managed-surveys/SPEC.md` — BR-38/BR-39).
- **Primary authenticated flow**: `/teams` → `/teams/[teamId]`
- **Admin flow**: `/admin/teams` → `/admin/teams/[teamId]`, which also
  manages that team's surveys (create, open, close, delete/archive).
- **After successful sign-in**, prefer continuing to `/teams` rather than
  a generic landing page — that is where a signed-in user's next
  meaningful action almost always is.
- `/results` remains the existing thin compatibility redirect
  (`docs/features/team-management/SPEC.md` BR-33/BR-34); Phase 3 does not
  reintroduce it as a rendering page.

## Layout and hierarchy

- A single, consistent application shell (header/nav + content region)
  wraps every authenticated and public page; no page invents its own
  competing chrome.
- Page-level hierarchy: a clear page header (title +, where relevant, a
  primary action) above the page's own content, consistent across
  `/teams`, `/teams/[teamId]`, `/admin/teams`, and `/admin/teams/[teamId]`.
- Admin surfaces are visually distinguishable from member-facing surfaces
  (e.g. a distinct admin-area heading/context), so it's always clear
  whether the current screen is acting with admin scope.

## Components

Reusable UI primitives are introduced only where recurring usage across
screens actually justifies them — not speculatively ahead of need. At
minimum, the following need a consistent, shared treatment across the
application, since each already recurs across `/teams`, results, and
admin screens:

- Buttons (primary/secondary/destructive, with a disabled/pending state)
- Forms and form fields (label, input, validation-error message)
- Cards/panels (team entry, result panel, admin list row)
- Page headers
- Alerts/banners (success, error, informational)
- Empty states
- Loading states

## Interaction states

Every screen that fetches or mutates server data defines, at minimum:

- **Loading** — visible feedback while a request is in flight; never a
  blank/frozen screen.
- **Empty** — a real, designed state (e.g. no teams yet, no pending
  requests), not just an absence of content.
- **Success** — confirmation appropriate to the action (e.g. submission
  confirmation, "invitation sent").
- **Validation error** — field- or form-scoped, actionable, in Norwegian.
- **Authorization failure** — a non-sensitive, generic "you don't have
  access" state (e.g. the existing `/teams/[teamId]` non-member
  treatment) — never a state that leaks *why* or *whether* a resource
  exists beyond what the server already discloses.
- **Infrastructure failure** — a generic failure state distinct from
  validation/authorization failure, with no internal error detail exposed
  to the user.

## Auth UX

- Sign-in / sign-up / email verification reuse the existing Firebase
  Authentication flows (`docs/features/results-dashboard/SPEC.md`); Phase
  3 restyles and localizes these, it does not change the underlying auth
  mechanism.
- After sign-in, continue to `/teams` (see Navigation above) rather than
  back to `/` or a marketing-style landing page.
- An unverified account is told clearly, in Norwegian, that verification
  is required before team access — mirroring the existing "no team
  available" treatment, not a new authorization pathway.

## Teams UX

- `/teams`: every active team's name plus the caller's own relationship
  to it (admin, member, request pending, request rejected, none) — a
  clear, scannable list, with a single obvious "request access" action
  where relevant. Never another user's relationship, another team's
  member count, or any team's result data (unchanged,
  `docs/features/team-management/SPEC.md` BR-11).
- `/teams/[teamId]`: for an authorized member/admin, a "Pågående
  undersøkelse" (current survey) section — the team's `scheduled`/`open`
  survey, if any, with its title/fallback label, availability state,
  access mode, and a link to `/survey/{surveyId}` — above the team's
  closed-survey results (see "Results UX"); for a non-member, only the
  non-sensitive request-access state — the page must never attempt to
  render result or current-survey content it isn't authorized to have
  fetched (`docs/features/managed-surveys/SPEC.md` — BR-30/BR-31/BR-32).

## Results UX

- Emphasize the **most recently closed survey's aggregate** and the
  **12-survey trend** as the primary content of a team's results view —
  the survey-instance-based successors to the original closed-period
  aggregate and 12-period trend (`docs/features/managed-surveys/SPEC.md`
  → "Results/history model"). A survey that's still `scheduled`/`open`
  never appears here — that's the separate "Pågående undersøkelse" section
  above (see "Teams UX").
- An "insufficient responses" survey is shown as a distinct, honest state
  — not a zero, not a blank, not merged visually with a genuinely
  low-but-published value; the message may name the survey's own
  configured threshold (e.g. "vises når minst 5 personer har svart"),
  never the actual count.

## Admin UX

- Admin UI (`/admin/teams`, `/admin/teams/[teamId]`) prioritizes
  **operational clarity over visual decoration** — it is a small,
  frequently-used operational tool (create/disable teams, invite, approve
  or reject access requests, remove members), not a marketing surface.
  Dense, scannable lists and clear primary actions beat large illustrative
  layouts here.
- Every admin action that changes state (disable a team, cancel an
  invitation, remove a member, approve/reject a request) has an explicit
  confirmation or clearly-labeled irreversible-vs-reversible affordance,
  consistent with the underlying model (e.g. team disable is reversible;
  see `docs/features/team-management/SPEC.md`).
- `/admin/teams/[teamId]` also manages that team's surveys, in the same
  dense, operational style: a creation form (access mode required, no
  pre-selected default; `minimumResponses` pre-filled `5`; optional title/
  start/end), a list of active surveys with their access mode, dates,
  derived lifecycle, copyable `/survey/{surveyId}` link, and response count
  where privacy rules permit, plus a separate archived section. Once
  closed, a survey with zero responses can be deleted; a survey with any
  responses can only be archived (never deleted) — this distinction is
  surfaced as a clear, labeled affordance, not a single ambiguous "remove"
  action (`docs/features/managed-surveys/SPEC.md` — BR-35/BR-36).

## Charts

- Phase 3 selects **one** chart library for result/trend visualization
  and uses it consistently; do not introduce multiple charting libraries
  across the application.  The specific library is an implementation
  decision for Phase 3 task planning, not decided by this document.
- Charts must never encode a **suppressed** (below-threshold) value as
  zero, as a missing/absent point that looks identical to "actually
  zero," or in any way that lets a viewer infer the true underlying count
  — suppressed periods are visually and semantically distinct from a
  published low value (directly implements `docs/SECURITY.md` invariants
  10–12).
- Charts render only the aggregate/trend data the server already returned
  for this caller — no client-side computation derives, estimates, or
  interpolates a value the server withheld.
- A trend/history axis over irregular, admin-scheduled occurrences (e.g.
  survey instances, `docs/features/managed-surveys/SPEC.md` — "Chart X-axis
  decision") stays **categorical** (evenly spaced by occurrence, oldest to
  newest), not time-proportional — a genuinely time-scaled axis would
  compress most points into a sliver whenever one gap between occurrences
  dominates. Each point is labeled with its actual date; a relative label
  (e.g. "2 uker siden") may be computed client-side from the current date at
  render time as secondary, non-load-bearing context, but is never persisted
  or treated as the primary label.

## Accessibility

- Semantic headings (a single logical heading hierarchy per page, not
  styled `div`s standing in for headings).
- Every form control has a real, associated label.
- All interactive controls are keyboard-accessible (tab order, Enter/
  Space activation, no mouse-only interaction).
- Visible focus states on every interactive element.
- Sufficient color contrast for text and meaningful UI states.
- Never rely on color alone to convey meaning (e.g. status, validation
  error, chart series) — pair color with text, icon, or pattern.

## Responsive behavior

- Every screen in scope (public survey, auth, `/teams`, `/teams/
  [teamId]`, `/admin/teams`, `/admin/teams/[teamId]`) works at common
  phone widths as well as desktop — navigation collapses sensibly, no
  horizontal scrolling of the page itself, tables/charts scroll within
  their own container if they must.

## Privacy-aware design

Phase 3 is presentation only; it must express, never weaken, the
existing privacy model (`docs/SECURITY.md`, `docs/ARCHITECTURE.md`):

- Never imply that individual wellbeing scores exist or could be viewed —
  no per-person breakdowns, no "drill into an individual" affordance,
  anywhere.
- Never reveal a below-threshold count, even approximately (no "almost
  enough," no visual hinting at the true count) — an insufficient period
  is a flat, non-quantified state.
- Never expose raw/individual survey responses in any UI, admin included.
- Admin screens never imply or provide raw survey-response access — an
  app admin's UI is scoped to the same aggregate/trend surface a member
  sees, plus team/membership management (unchanged invariant 17).
- Avoid gamification and individual-performance visual patterns
  (leaderboards, streaks, per-person scores/badges, ranking) — these cut
  directly against `docs/PRODUCT.md`'s non-goals.

## Out of scope for Phase 3

- Any change to authentication, authorization, anonymity, aggregation, or
  privacy rules/thresholds — Phase 3 is UI/UX, localization, and
  application-shell work only (unchanged, `docs/ROADMAP.md`).
- New product capabilities (`AnonymousChallenge`, forums, skill trees —
  Phases 4–6).
- Any new Firestore collection, field, or query pattern.
- A final visual/brand identity system beyond what's needed for a
  coherent Phase 3 (a distinct branding pass may follow later, but is not
  required to satisfy this direction).
- Picking the specific chart library, i18n mechanism, or component
  library — these are implementation decisions for Phase 3 task planning,
  guided by, but not decided in, this document.

## Inspiration

Directional inspiration only — never a pixel-copy requirement:

- **Linear** — navigation, information hierarchy, restraint.
- **Culture Amp** and comparable employee-survey products — how to
  present survey-style aggregate results without individualizing them.
- **Vercel** — admin/settings UI clarity and operational density.
