# DevPulse App-Wide UI/UX Refresh

## Status
Approved — produced from a read-only discovery/planning report (route
inventory, shared-primitive inventory, and confirmed prior-discovery
findings, all cited against the actual repository at the time of planning),
reviewed by the product owner, with the owner decisions below locked before
this document was written. Task planning proceeds via `split-tasks` →
`TASKS.md`.

## Problem
DevPulse's screens are functionally complete and behaviorally consistent
(every list/loading/empty/error state already goes through the shared
`LoadingState`/`EmptyState`/`Alert` primitives — confirmed, no ad hoc
equivalent exists anywhere), but the actual visual presentation has drifted
in small, confirmed ways that undercut the "polished, credible for
workplace/team use" impression the product needs, especially for company
demonstrations:

- Twelve components hand-roll near-identical input/textarea/select styling
  rather than sharing one treatment (confirmed: `Grep '<(input|textarea|
  select)\b'` across `src/**/*.tsx` returns exactly `TeamSkillSection.tsx`,
  `AdminTeamDetail.tsx`, `TeamSkillTrackingSection.tsx`,
  `SkillTreeCorrectionForm.tsx`, `SkillTreeCreationForm.tsx`,
  `ReplyForm.tsx`, `CreateThreadForm.tsx`, `ChallengeSubmissionPanel.tsx`,
  `SignInForm.tsx`, `SurveyResponseForm.tsx`, `AdminTeams.tsx`,
  `SignUpForm.tsx`).
- No shared status/Badge treatment exists — every status (team active/
  disabled, challenge open/resolved, skill tracked/not-started) is rendered
  as plain, undifferentiated text (confirmed: `AdminTeams.tsx:255`,
  `OrgSkillProgressOverview.tsx:81-85`, `TeamSkillTrackingSection.tsx:
  186-188`, `ChallengeList.tsx:54`).
- `PageShell` (`src/components/ui/PageShell.tsx:15-19`) caps every route,
  admin included, at the same `max-w-3xl` (768px) — the three admin
  surfaces (`/admin/teams`, `/admin/teams/[teamId]`, `/admin/skills`), which
  contain genuinely list/section-dense content, get no more room than a
  short auth form.
- The application loads and configures Geist Sans/Mono
  (`app/layout.tsx:7-15`, wired into Tailwind's own `--font-sans`/
  `--font-mono` theme tokens in `app/globals.css:8-13`) but never actually
  renders it — `app/globals.css:22-26` hardcodes `body { font-family:
  Arial, Helvetica, sans-serif; }`, so the configured typeface is inert.
- `/admin/teams` and `/admin/skills` are flat lists with no summary/
  hierarchy above list level (confirmed: `AdminTeams.tsx:199-283`,
  `AdminSkills.tsx:96-106`, `SkillTreeCatalogList.tsx:52-93`).
- A handful of form controls lack `aria-invalid`/`aria-describedby`
  wiring to an adjacent validation error even though two sibling forms
  (`ChallengeSubmissionPanel.tsx:136-141`, `CreateThreadForm.tsx:117-119,
  133-135`) already do this correctly.

None of this reflects a missing product capability — it is a presentation
consistency problem across an otherwise complete application.

## User outcome
Every existing screen — public, authenticated, and admin — reads as one
considered application: consistent form controls, a readable status
treatment, a typeface that's actually applied, and admin surfaces that use
the space their content actually needs. Nothing a user can already do
changes; nothing a user could not already do becomes possible.

## Scope
- Activate the already-configured Geist Sans typeface as the application's
  actual rendered body font; leave Geist Mono configured and available,
  unused unless a later need arises.
- Introduce the minimum compatible shared form-control primitive(s)/styles
  the confirmed duplication justifies (standard text input, textarea,
  simple single-select) and migrate the controls whose semantics are
  already a good fit — not a mechanical rewrite of every input in every
  file (see "Non-goals" and BR-6/BR-7).
- Introduce a small shared Badge/status-text primitive and apply it only
  where it improves scanning of an existing status/relationship value.
- Add one additional `PageShell` width token, `"wide"`, and apply it to the
  three admin surfaces only; raise `SiteHeader`'s own outer width bound to
  match it, so the site-wide header stays the single coherent outer shell
  bound for every route (no per-route header-width branching).
- Move exactly three creation forms — admin team creation, SkillTree
  creation, survey creation — behind an explicit, `aria-expanded` toggle
  action, extending `SkillTreeCorrectionForm`'s already-existing
  open/close precedent; no other form's visibility behavior changes.
- Give `TeamDetail` a presentation-only two-zone visual grouping
  ("Resultater" / "Teamaktivitet") over its already-rendered sections, with
  zero change to fetch order, generation guards, or any capability
  computation.
- Restyle Forum surfaces for visual consistency, only as already rendered
  when `FEATURE_FORUM_ENABLED` is `"true"`.
- Close the confirmed `aria-invalid`/`aria-describedby` gaps on migrated
  form controls; associate the `minimumResponses` hint with its input;
  surface a visible failure indication for a failed clipboard-copy action.
- Where genuinely derivable from data a page's existing component state
  already holds after its existing fetch (no new request), add a small
  visual summary (e.g. an active/disabled count) to `/admin/teams` and/or
  `/admin/skills`.
- A full responsive/accessibility consistency sweep across every touched
  surface.

## Out of scope
- **The gamified Skill Tree progression path.** A separate, later feature
  owns any redesign of the ordered-stage representation, current/past/
  future stage visual model, node visualization, stage geometry, or any
  gamification. This refresh may apply shared typography, spacing, `Card`
  treatment, form-control styling, and Badge/status styling *around* Skill
  surfaces, but the stage list/current-stage marker itself (`TeamSkillSection
  .tsx`'s `<ol>`/`TrackedSkillRow`, `TeamSkillTrackingSection.tsx`'s
  identical pattern, `OrgSkillProgressOverview.tsx`'s per-team stage label)
  is not touched structurally or visually beyond what shared typography/
  spacing/Card/Badge treatment already implies.
- **SkillTree schema/data-model changes** — none.
- **Demo Team / data seeding** — none.
- **Any Forum product, flag, or authorization change** — `FEATURE_FORUM_ENABLED`
  semantics, default-hidden behavior, server-only parsing location
  (`src/features/forum/server/is-forum-enabled.ts`), standalone-thread-page
  gating, every Forum API route, and Forum authorization/encryption/
  persistence/pseudonymization are all unchanged.
- **Challenge or SkillProgress authorization changes** — `canSubmit`
  (`src/features/challenges/server/list-team-challenges.ts`) and
  `canReportProgress` (`src/features/skill-trees/server/
  get-team-skill-progress.ts`) semantics are unchanged; this refresh only
  ever *presents* their already-resolved boolean value.
- **New APIs, new Firestore reads/writes, new environment variables,
  encryption changes, or auth changes** — none.
- **A notification system, analytics, a component library, an icon
  library, or an animation library** — none adopted.
- **Performance Phase B** and **Phase 10 / org-forum-overview** — untouched,
  unaffected.
- **Deployment** — this feature does not deploy anything.

## Owner decisions (locked before this document was written)
1. **`PageShell` wide variant is a token, not a numeric prop**: add
   `"wide"` to the existing `PageShellWidth` union
   (`sm | lg | 2xl | 3xl | wide`), materially wider than `"3xl"`, chosen
   from Tailwind's existing `max-w-*` scale at implementation time. No
   arbitrary numeric/pixel width prop is introduced anywhere.
2. **A Badge/status-text primitive is included**, calm/operational in
   treatment, always rendering status as text, never color alone, and
   explicitly not a gamified/decorative chip system.
3. **Progressive disclosure is limited to exactly three forms**: admin team
   creation, SkillTree creation, survey creation. Challenge submission,
   Forum thread/reply creation, member invitation, access-request actions,
   and every other small single-field form stay always-visible.
4. **Geist Sans is adopted fully**; the Arial/Helvetica body override is
   removed. Geist Mono's existing configuration is preserved, unused unless
   a genuine future need arises — no second font family is added.
5. **`AdminTeamDetail.tsx` (1430 lines) is never one implementation task.**
   Its refresh is split along its existing section boundaries into at
   least three independently reviewable tasks (members/invitations/access-
   requests; surveys; challenges/skills) — see `TASKS.md`.

## Key concepts
- **Form-control primitive**: a small set of shared, styled wrapper
  components/styles for the standard single-line text input, textarea, and
  simple single-select patterns already duplicated across 12 files — not a
  mandate to migrate every interactive control in the application (radio
  groups, number-with-constraint inputs, and other semantically-distinct
  controls are explicitly preserved as-is where migrating them would weaken
  their existing semantics; see BR-6/BR-7).
- **Badge**: a small shared component pairing a short status word/phrase
  with a calm visual treatment (never color alone) — not a "chip"/pill
  aesthetic implying gamification.
- **Progressive disclosure** (this feature's scope): an explicit toggle
  action that reveals/hides a creation form, extending
  `SkillTreeCorrectionForm.tsx`'s (`docs/features/team-skill-tree/
  SPEC.md` — "Cosmetic tree correction") already-shipped open/close
  precedent — not a new interaction pattern invented for this feature.
- **Resultater / Teamaktivitet**: this feature's two presentation-only
  visual zones grouping `TeamDetail`'s already-rendered sections — not a
  new data concept, route, or fetch boundary. Exact Norwegian casing/
  wording is finalized at implementation time against existing copy-module
  conventions (`src/features/teams/copy.ts` and siblings).

## Actors and access
Unchanged from every existing feature this refresh touches. This feature
introduces no new actor, role, or access boundary — every surface remains
reachable by exactly the same caller population, under exactly the same
server-side authorization, as before this feature.

## User stories
1. As any user of DevPulse, I want every form field to look and behave
   consistently, so that the application reads as one coherent product
   rather than a set of separately built screens.
2. As an app admin, I want `/admin/teams`, `/admin/teams/[teamId]`, and
   `/admin/skills` to use the screen space their content actually needs,
   so that dense list/section content is easier to scan.
3. As a team member or admin viewing `/teams/[teamId]`, I want the page's
   sections visually grouped by what they're about (results vs. team
   activity), so that a dense page is easier to read at a glance.
4. As a person giving or watching a company demonstration of DevPulse, I
   want the application to look polished and credible, so that it's taken
   seriously as a workplace tool.
5. As a keyboard/screen-reader user, I want every migrated form control's
   validation error to be programmatically associated with its field, so
   that I know which field is invalid without relying on sighted scanning.

## Behavioral requirements

**Typography**
- **BR-1**: Body content is rendered in the already-configured Geist Sans
  typeface (via the existing `--font-sans` theme token already wired in
  `app/globals.css`'s `@theme inline` block), replacing the current
  explicit `Arial, Helvetica, sans-serif` body declaration. No other font
  family is introduced.
- **BR-2**: Geist Mono's existing configuration (`--font-geist-mono`/
  Tailwind's `--font-mono` token) remains present and unmodified for future
  monospace use; this feature introduces no new use of it, since none is
  currently justified by existing content.

**Shared layout primitives**
- **BR-3**: `PageShell` gains one additional width token, `"wide"`,
  materially wider than the existing `"3xl"` default, drawn from Tailwind's
  existing `max-w-*` scale. No numeric/pixel width prop is introduced. Like
  every existing `PageShell` width, `"wide"` is a maximum — content renders
  narrower automatically on a narrower viewport; it is not a fixed width.
- **BR-4**: `SiteHeader`'s own outer width bound is raised to match the new
  `"wide"` `PageShell` token, so the site-wide header remains the single
  coherent outer shell bound for every route, regardless of that route's
  own `PageShell` width. No route-specific header-width logic exists
  anywhere. This changes only the *magnitude* of a relationship that
  already exists and already ships today, not its kind: the header's
  current `max-w-3xl` bound (`SiteHeader.tsx:96`) is already wider than
  Home's own `"2xl"` (672px), and wider still than sign-in's, sign-up's,
  and survey-participation's own `"sm"`/`"lg"` (384px/512px) — every one of
  these pages already renders its own narrower, independently-centered
  content beneath a wider header today. Raising the header's bound to
  `"wide"` does not introduce a new header/content-width relationship for
  any page to reconcile; it changes the specific width value on both sides
  of a relationship every route already has.
- **BR-5**: `PageShell width="wide"` is applied to exactly `/admin/teams`,
  `/admin/teams/[teamId]`, and `/admin/skills`. No public, auth, or
  survey-participation page's width changes.

**Form-control primitives**
- **BR-6**: A minimum, compatible set of shared form-control primitives/
  styles is introduced for the standard single-line text input, textarea,
  and simple single-select patterns already duplicated across the 12 files
  named in "Problem." A control whose semantics are already
  well-suited to a specialized presentation (see BR-7) is not forced into
  these primitives merely for the sake of using them everywhere.
- **BR-7**: `SurveyResponseForm`'s radio-based 1–5 answer scale keeps its
  existing native `<fieldset>`/`<legend>`/radio-input structure and
  semantics unchanged; it is not migrated to the new text-style form-control
  primitive.
- **BR-8**: Every text input/textarea/select control that is migrated to a
  shared primitive preserves its existing validation rules, submission
  behavior, and error-message wording exactly — the primitive changes only
  visual/focus treatment and label/error wiring, never behavior.
- **BR-9**: Every migrated form control exposes `aria-invalid` reflecting
  its current validation state and, where a field-specific error or
  description exists, `aria-describedby` pointing at it — matching
  `ChallengeSubmissionPanel`/`CreateThreadForm`'s existing correct pattern
  — while keeping a real, visible, associated `<label>` on every control.

**Badge/status primitive**
- **BR-10**: A small shared Badge/status-text primitive is introduced and
  applied only where it improves scanning of an already-existing status or
  relationship value — confirmed candidates are: team active/disabled
  (`AdminTeams.tsx`), a team's relationship label (`TeamsOverview.tsx`),
  challenge open/resolved status (`ChallengeList.tsx`), and skill-tracking
  not-started/disabled labels (`TeamSkillTrackingSection.tsx`,
  `OrgSkillProgressOverview.tsx`). The primitive always renders status as
  visible text and never conveys meaning by color alone. Not every muted
  label in the application is mechanically converted to a Badge.
- **BR-11**: The Badge primitive is never applied to the SkillTree
  stage/progression list itself — the ordered stage `<ol>`, the
  current-stage marker/text, and per-node presentation in
  `TeamSkillSection.tsx`, `TeamSkillTrackingSection.tsx`, and
  `OrgSkillProgressOverview.tsx` remain visually and structurally exactly
  as they are today, beyond whatever incidental typography/spacing/Card
  treatment this refresh applies uniformly.

**Progressive disclosure**
- **BR-12**: Admin team creation (`AdminTeams.tsx`), SkillTree creation
  (`SkillTreeCreationForm.tsx`), and survey creation (inside
  `AdminTeamDetail.tsx`) each move behind an explicit toggle action with
  `aria-expanded` reflecting open/closed state and a clear accessible name
  describing the action; the existing list/content each form currently
  sits above becomes the page's default-visible surface.
- **BR-13**: Challenge submission (`ChallengeSubmissionPanel.tsx`), Forum
  thread creation (`CreateThreadForm.tsx`), Forum reply creation
  (`ReplyForm.tsx`), member invitation, and every access-request action in
  `AdminTeamDetail.tsx` remain always-visible — their mount/visibility
  behavior does not change.
- **BR-14**: Opening or closing one of the three progressive-disclosure
  forms in BR-12 triggers no additional network request and changes no
  validation or business rule the form already enforces. A Cancel action
  closes the form without submitting. Unmounting the collapsed form is
  acceptable (matching `SkillTreeCorrectionForm.tsx`'s existing precedent)
  and does not discard any already-submitted server state.

**`TeamDetail` visual hierarchy**
- **BR-15**: `TeamDetail`'s already-rendered sections are grouped,
  presentation-only, into two visual zones — a results zone (current
  survey, period summary, trend chart/table) and a team-activity zone
  (challenges, forum when enabled, skills) — using spacing/visual grouping
  rather than `Card`s nested inside `Card`s. Exact Norwegian zone labels
  are finalized at implementation time against existing copy-module
  conventions.
- **BR-16**: `TeamDetail`'s existing data-fetch order, `Promise.all`
  composition, generation-guard behavior (`useAuthGatedResource`,
  `isCurrentGeneration`), and every capability computation (`canSubmit`,
  `FEATURE_FORUM_ENABLED`, `canReportProgress`) are unchanged by BR-15;
  the visual grouping reorders or regroups only already-rendered output,
  never the underlying fetch/state logic.
- **BR-17**: No presentation change introduced by this feature ever reveals
  a mutation control to a viewer for whom the server-computed capability
  (`canSubmit: false`, `canReportProgress: false`) or the resolved
  `FEATURE_FORUM_ENABLED` value would hide it today. A non-capable viewer
  continues to see read-only content only — never a disabled-but-visible
  control, and never a control that was merely restyled into appearing
  differently.

**Forum visual consistency**
- **BR-18**: Forum UI (`ThreadList.tsx`, `ThreadDetail.tsx`,
  `CreateThreadForm.tsx`, `ReplyForm.tsx`, `DeleteConfirmation.tsx`)
  receives visual-consistency styling only for what it already renders when
  `FEATURE_FORUM_ENABLED === "true"`. The flag's semantics, default-hidden
  behavior, server-only parsing location
  (`src/features/forum/server/is-forum-enabled.ts`), the standalone
  thread-page's `notFound()` gating, every Forum API route, and every
  Forum authorization/encryption/persistence/pseudonymization behavior are
  unchanged.

**Admin summary content**
- **BR-19**: A visual summary element (e.g. an active/disabled team count,
  a tracked-SkillTree count) may be added to `/admin/teams` and/or
  `/admin/skills` only when it is computable entirely from data the page's
  existing component state already holds after its existing fetch. No new
  API call, gateway function, or Firestore read is introduced to produce
  a summary; where the existing state cannot support a useful summary, none
  is added.

**`AdminTeamDetail` task granularity**
- **BR-20**: `AdminTeamDetail.tsx`'s visual refresh is delivered as
  multiple independently reviewable tasks split along its existing section
  boundaries (members/invitations/access-requests; surveys;
  challenges/skills) — see `TASKS.md` — never as one task covering the
  entire file.

**Accessibility**
- **BR-21**: The survey-creation form's existing `minimumResponses` hint
  text is associated with its input via `aria-describedby`.
- **BR-22**: A failed clipboard-copy action (the existing survey-link
  "copy" affordance in `AdminTeamDetail.tsx`) surfaces a visible,
  non-sensitive failure indication to the user, instead of failing
  silently; no internal error detail is exposed.
- **BR-23**: Every existing `LoadingState`/`EmptyState`/`Alert` usage and
  its current role semantics (`role="status"` / `role="alert"`) is
  preserved exactly across every surface this feature touches. No domain
  error message, error code, or failure-category distinction changes.

**Responsive behavior**
- **BR-24**: Every surface this feature touches remains fully usable at
  common phone widths, tablet widths, and desktop widths, with no
  page-level horizontal scrolling introduced. `TrendTable`'s existing
  container-scoped `overflow-x-auto` pattern remains the only place
  horizontal scrolling is permitted, unchanged.

**Performance and platform invariants**
- **BR-25**: `TeamDetail`'s existing `next/dynamic`/`ssr:false` lazy import
  of `TrendChart` and its `catchError` chart-local failure boundary remain
  structurally unchanged. No code path introduced by this feature causes
  `recharts` to be imported eagerly anywhere in `TeamDetail`'s module
  graph.
- **BR-26**: This feature introduces no new npm dependency (no component
  library, icon library, or animation library), no new Firestore read or
  write, no new API route, no new environment variable, and no change to
  `verifyIdToken`, team/challenge/skill/forum authorization, survey
  anonymity, aggregation thresholds, encryption, or Firestore rules/
  schemas. UI visibility is never treated as, or substituted for, security
  authorization anywhere in this feature.

## Edge cases and failure behavior
- **A progressive-disclosure form is opened, then the caller's auth state
  changes or the route navigates away before submission** — the existing
  generation-guard/stale-response-discard behavior of the parent component
  (`AdminTeams`, `AdminSkills`/`SkillTreeCreationForm`,
  `AdminTeamDetail`'s survey creation) is unaffected by BR-12's toggle; the
  toggle only ever controls mount/visibility, never the submission
  handler's own correctness.
- **A wide-`PageShell` admin page is viewed at a narrow browser width** —
  behaves exactly like every existing `PageShell` width: content shrinks
  below the `"wide"` maximum on a narrower viewport, never overflowing or
  requiring page-level horizontal scroll (BR-3, BR-24).
- **A narrow-content page (sign-in, sign-up, survey participation, Home) is
  viewed at a normal desktop width, where the header now spans materially
  more of the viewport than that page's own centered content does** — not
  a new relationship to design for (see BR-4): each of these pages already
  renders narrower than the header's own bound today, before this feature.
  No per-route compensation, alternate header treatment, or narrower
  header variant is introduced for these pages.
- **`FEATURE_FORUM_ENABLED` is `false` (the default)** — none of BR-18's
  visual work is ever rendered or reachable; this feature adds no new way
  to observe Forum UI while the flag is disabled.
- **A viewer for whom `canSubmit`/`canReportProgress` is `false`** — sees
  exactly the same absence of a mutation control as before this feature
  (BR-17); the surrounding restyled read-only content is the only visible
  change.
- **A Badge-eligible status value this feature didn't anticipate** (e.g. a
  future new challenge/team status) — is not required to render via the
  Badge primitive; BR-10 names the confirmed current candidates, not an
  open-ended requirement to badge every future status value.

## Security and privacy
This feature is presentation-only. Cross-referencing `docs/SECURITY.md`
rather than restating it:

- No invariant in `docs/SECURITY.md` is implicated by a visual/typography/
  layout change — this feature touches no encryption, no aggregation
  threshold, no anonymous-identity boundary, and no Firestore access
  pattern.
- **Invariant 8/9 (server-side team authorization; no cross-team leakage)**:
  unaffected — every capability this feature presents (`canSubmit`,
  `canReportProgress`, `FEATURE_FORUM_ENABLED`, `authorizeTeamAccess`'s
  broader read result) continues to be computed exactly where it is today;
  this feature never computes, caches, or re-derives any of them
  client-side (BR-16, BR-17, BR-18, BR-26).
- **The recurring "UI visibility is not authorization" principle**
  (already established by the `canSubmit`/`canReportProgress` fixes this
  session): explicitly reaffirmed as BR-26's closing sentence — this
  feature must never be the place that principle is quietly weakened while
  "just" restyling a control.
- No real employee or wellbeing data is touched, sampled, or used as a
  fixture by any task in this feature.

## Architecture decisions
- **New primitives live in `src/components/ui/`**, alongside `Button`,
  `Card`, `Alert`, `EmptyState`, `LoadingState`, `PageHeader`, `PageShell`
  — matching this codebase's existing "shared primitive" location
  convention (`.claude/rules/architecture.md` — `src/components/ui/` for
  reusable presentation primitives with no business logic).
- **No new top-level layout mechanism** — `PageShell`'s existing
  width-token API is extended in place (BR-3), not replaced or
  parallel-implemented.
- **No new state-management or data-fetching pattern** — every task in
  this feature composes existing gateway/state shapes unchanged; a task
  that finds it needs a new fetch or state shape to achieve a purely
  visual goal has exceeded this feature's scope and must stop and report
  rather than proceeding (BR-19, BR-26).

## Test boundaries
| Boundary | Covers |
|---|---|
| `src/components/ui/*.test.tsx` (new/extended primitives) | BR-1 through BR-11 (primitive-level behavior: token acceptance, label/aria wiring, status-as-text rendering) |
| Component tests per touched surface (`*.test.tsx` siblings of every file in "Expected file areas") | BR-8, BR-9, BR-12 through BR-19, BR-21, BR-22 — role/accessible-name/visibility/`aria-expanded`/`aria-invalid`/`aria-describedby` assertions, never Tailwind class-string assertions |
| `TeamDetail.test.tsx` | BR-15, BR-16, BR-17, BR-25 — section presence/grouping by content, capability-gated presence/absence unchanged, no new fetch call count |
| Full regression (`pnpm test`) | BR-23, BR-26 — no existing behavioral test elsewhere in the repository regresses |

## Acceptance criteria
- [ ] Body text renders in Geist Sans; no page's rendered body font is
      Arial (BR-1, BR-2).
- [ ] `PageShell` accepts `width="wide"`; only `/admin/teams`,
      `/admin/teams/[teamId]`, `/admin/skills` use it (BR-3, BR-5).
- [ ] `SiteHeader`'s outer bound matches the new wide token on every route
      (BR-4).
- [ ] The 12 files named in "Problem" use the new form-control primitive(s)
      for their compatible controls only; `SurveyResponseForm`'s radio
      scale is unchanged (BR-6, BR-7, BR-8).
- [ ] Every migrated control has `aria-invalid`/`aria-describedby` wired to
      its own error state (BR-9).
- [ ] A Badge primitive exists and is used only at the confirmed candidate
      sites, never on the SkillTree stage list (BR-10, BR-11).
- [ ] Admin team creation, SkillTree creation, and survey creation are
      behind a toggle with `aria-expanded`; every other form's visibility
      is unchanged (BR-12, BR-13, BR-14).
- [ ] `TeamDetail` visually groups into two zones with no fetch/generation-
      guard/capability change (BR-15, BR-16, BR-17).
- [ ] Forum styling only ever renders when the flag is already enabled;
      no Forum API/authorization/flag file is touched (BR-18).
- [ ] Any admin summary added uses only already-loaded state, with no new
      request (BR-19).
- [ ] `AdminTeamDetail.tsx`'s refresh spans at least three separate tasks
      (BR-20).
- [ ] `minimumResponses` hint is `aria-describedby`-linked; a failed
      clipboard copy shows a visible failure state (BR-21, BR-22).
- [ ] Every existing loading/empty/error state and its role semantics is
      unchanged (BR-23).
- [ ] Every touched surface remains usable at phone/tablet/desktop widths
      with no new page-level horizontal scroll (BR-24).
- [ ] `TrendChart` remains lazy (`next/dynamic`, `ssr:false`) with its
      `catchError` boundary intact; `recharts` is not imported eagerly
      (BR-25).
- [ ] No new dependency, API route, Firestore access, environment
      variable, or authorization change exists anywhere in the diff
      (BR-26).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.

## Open questions
None. The five owner decisions this planning pass required were resolved
before this document was written (see "Owner decisions"); the exact
Tailwind `max-w-*` token for `"wide"`, exact Norwegian zone labels, and
exact Badge visual treatment are implementation-time choices within the
constraints BR-3/BR-10/BR-15 already fix, not open product questions.

## Approval gate
**This SPEC is Approved** (see "Status" above). `split-tasks` may now run;
see `TASKS.md` for the resulting task breakdown and per-task `Depends on`
sequencing.
