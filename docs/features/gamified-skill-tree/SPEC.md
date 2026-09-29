# Gamified Skill Tree UI

## Status
Approved — produced from repository discovery (current components, DTOs,
copy, and prior specs, cited below) and formally reviewed. Coordinator
decisions locked: positional state wording (no "Fullført") and a
vertical-only v1 layout.

## Problem
The Skill Tree feature (Phases 7–9) works, but its progression is rendered as
a plain decimal `<ol>` with a "(Nåværende steg)" text suffix. The deferral in
`docs/features/ui-refresh/SPEC.md` ("Out of scope" — the gamified Skill Tree
progression path) reserved the redesign of the stage list / current-stage
marker for this later feature. Teams see their progress as a flat list
rather than a journey.

## User outcome
A member viewing `/teams/[teamId]`, and an admin viewing
`/admin/teams/[teamId]`, sees each tracked SkillTree as a clear visual
progression path — earlier steps, the team's current step, and coming steps —
that is more engaging than the plain list while staying calm, team-scoped,
and workplace-appropriate.

## Scope
- A presentational progression-path component that renders one existing
  ordered SkillTree plus the team's `currentNodeId`.
- Pure derivation of per-stage visual state from `nodes` + `currentNodeId`.
- Adoption on two surfaces: `TeamSkillSection` (`/teams/[teamId]`) and
  `TeamSkillTrackingSection`'s tracked rows (`/admin/teams/[teamId]`).
- Norwegian copy for the path; tests; `docs/UI-UX.md` closeout.

## Out of scope
SkillTree/SkillProgress schema changes; progress history; completion
timestamps; individual/per-user progress; endorsements; scoring, XP, points,
achievements, streaks, leaderboards, rankings, rewards; branching paths,
prerequisites, node dependencies; drag/drop or clickable nodes; new roles,
approval workflow, notifications, analytics; new endpoints, gateways,
fetches, Firestore queries or collections; new packages/icons/animation;
Demo Team; Performance Phase B; Phase 10; Forum work; any change to
authoring (`/admin/skills` creation/correction/catalog) or to the cross-team
overview (see BR-11, BR-12).

## Key concepts
- **Path**: the visual rendering of one tree's ordered stages for one team.
- **Stage state** (derived, never stored): `earlier`, `current`, `upcoming` —
  purely positional relative to the team's *current* position. Displayed as
  "Tidligere steg", "Nåværende steg", "Kommende steg". "Fullført" is
  deliberately not used: `SkillProgress` stores only `currentNodeId`, keeps
  no history, and permits backward movement, so durable completion cannot be
  proven. The path describes the current position only.
- **Team-level**: the path always describes the *team's* position. It never
  describes a person.

## Existing model constraints (repository truth)
- `SkillTreeNodeView { nodeId, label, order }`; `nodeId` is `node-<index>`
  and `order === index`, both immutable (`domain/skill-tree.ts`). Trees have
  2–20 stages; labels are 3–100 characters, admin-authored, untrusted text.
- `TeamSkillView { treeId, name, nodes, currentNodeId }` (member surface) and
  `AdminSkillTreeEntry { treeId, name, nodes }` + a separate
  `currentNodeId: string | null` (admin surface) are structurally compatible:
  both reduce to `{ name, nodes: SkillTreeNodeView[], currentNodeId }`.
- Node order in the DTO is not relied on: both existing consumers
  (`TeamSkillSection`, `TeamSkillTrackingSection`) already sort a copy by
  `order` ascending on the client (`nodes.slice().sort(...)`), and valid
  records have `order === index`. The path does the same; no server or
  normalization change.
- `currentNodeId: null` means "tracked, not yet started".
- Admins (Phase 7) and members (Phase 8) may set `currentNodeId` to any stage,
  including earlier ones. No history exists.
- `canReportProgress` is server-derived; `TeamSkillSection` renders the
  report `<select>`/button only when it is true.
- No icon library exists; `public/` holds only unused Next boilerplate SVGs.

## Actors and access
Unchanged. Members and app admins see the path wherever they already see the
stage list today; the path adds no data and no capability. Mutation controls
(member Phase 8 report; admin start/update/stop) are unchanged and remain
the only mutation paths.

## User stories
1. As a team member, I want to see my team's position in a skill area as a
   visual path so that the team's progress is easy to grasp at a glance.
2. As an app admin viewing a team, I want the same path above the existing
   controls so that I see what the team sees while I adjust it.
3. As a user on a phone, I want the path to be readable without sideways
   scrolling, even for a 20-stage tree.
4. As a user who cannot rely on color, I want every state stated in text.

## Behavioral requirements

**Derivation**
- BR-1. Stage state is derived only from the `nodes` sorted by `order`
  ascending and `currentNodeId`. Given `currentNodeId` at index N: stages with
  index < N are `earlier`, index N is `current`, index > N are `upcoming`.
- BR-2. Two semantically distinct cases:
  (a) `currentNodeId === null` is the legitimate "tracked, not yet started"
  state: every stage is `upcoming` ("Kommende steg"), no stage has
  `aria-current`, and the summary uses the existing "Ikke startet" string.
  (b) A non-null `currentNodeId` matching no node is invalid data and a
  defensive presentation fallback only: every stage renders `upcoming`, no
  `aria-current`, no throw, no invented current stage, and no "Ikke startet"
  claim (the summary line is omitted). The two share stage rendering but
  are not equivalent domain data; no server/data correction is in scope.
- BR-3. Derived state is never persisted, cached across renders, or
  accumulated. When `currentNodeId` moves backward (admin update or member
  self-report), the next render recomputes purely from the new position: a
  stage after the new current stage is `upcoming`, never `earlier`. No
  history is implied, stored, or inferred.
- BR-4. Stage order in the path exactly follows `order` ascending
  regardless of input array position. The component never mutates the
  caller's `nodes` array (it sorts a copy). Labels are rendered in full as ordinary React text (never truncated with hidden
  overflow, never HTML-parsed).

**Component**
- BR-5. One reusable presentational component (working name
  `SkillProgressPath`) accepts `nodes`, `currentNodeId` and the tree name (used only for the
  list's accessible name, BR-17) — nothing else. It is not aware of member/
  admin roles or `canReportProgress`.
  It performs no fetch, has no Firebase/auth/server import, holds no
  identity, performs no auth/membership/persistence/error mapping, and
  exposes no callback or mutation. Existing domain/gateway
  types (`SkillTreeNodeView`) are reused; no parallel model is introduced.
- BR-6. Nodes are non-interactive: no button, link, `tabIndex`, click handler,
  or `role` implying interaction. Existing `<select>`/buttons stay the only
  controls.

**Surfaces**
- BR-7. `/teams/[teamId]` (`TeamSkillSection`): each tracked tree renders the
  path in place of the decimal `<ol>`. Loading/error/empty states, the
  `canReportProgress` gating, self-report behavior, error messages and the
  post-report refetch/remount mechanics are unchanged.
- BR-8. `/admin/teams/[teamId]` (`TeamSkillTrackingSection`, tracked rows):
  the path replaces the decimal `<ol>`. The stage `Select`, "Stopp sporing",
  start-tracking group, `teamDisabled` handling and all row action/error
  states are unchanged; the session-derived `tracking` state is unchanged.
- BR-9. Each path shows a compact, team-scoped summary line: when started,
  the team's current step label and position ("steg N av M"); when not
  started, the existing "Ikke startet" string.
- BR-10. Copy states team scope. The path/summary never uses "din/ditt/du/
  min" or individual framing; wording prefers existing terms ("Nåværende
  steg", "Ikke startet", "Kompetanseområder") plus "Teamets …" for the
  summary. New per-state labels are positional ("Tidligere steg",
  "Kommende steg"), not achievement language ("Fullført", "Oppnådd").
- BR-11. The cross-team overview (`OrgSkillProgressOverview`) is unchanged: a
  one-line-per-team text list is the right density for many teams × many
  trees, and a path per team would add noise.
- BR-12. The SkillTree catalog and creation/correction forms
  (`SkillTreeCatalogList`, `SkillTreeCreationForm`, `SkillTreeCorrectionForm`)
  are unchanged: they define taxonomy, not progress.

**Responsive**
- BR-13. The path is vertical-only at every breakpoint (a horizontal variant
  is not part of v1): one row per stage (marker + label + state text). No horizontal scrolling of the page or of the
  path. It works for 2, 4–8 and 20 stages and for 100-character Norwegian
  labels (which wrap; `break-words`, `min-w-0`).

**Accessibility**
- BR-14. The path is a real ordered list (`<ol>` of `<li>`; explicit
  `role="list"` if list styling is removed). The `current` stage's `<li>`
  carries `aria-current="step"`; no other stage does.
- BR-15. Every stage shows its state as visible text (`Tidligere steg` /
  `Nåværende steg` / `Kommende steg`) in addition to marker shape and
  styling; no state depends on color, opacity, or icon shape alone. Contrast
  meets the existing UI-refresh palette conventions in light and dark mode.
- BR-16. The connector/rail and marker decoration are `aria-hidden` and
  purely CSS. The accessible content is order, label and state text.
- BR-17. Each tree's list has an accessible name from the tree name; the
  existing `aria-label` patterns on adjacent controls are preserved.

**Invariants**
- BR-18. No change to any server, API route, gateway, domain type, Firestore
  rule/query/collection, environment variable, or authorization logic. No
  new fetch, request, or state beyond render-time derivation. No new
  dependency, icon, image, animation, or canvas/SVG framework.
- BR-19. No motion is required to understand progress; v1 ships static. Any
  transition, if later added, must respect `prefers-reduced-motion`.
- BR-20. No gamification concept is introduced: no points/XP/achievements/
  streaks/leaderboards/rankings/rewards, and the shared `Badge` primitive is
  not used for stage states.

## Visual-state semantics (locked)
Example A → B → C → D: `current = C` ⇒ A, B `earlier`; C `current`; D
`upcoming`. Then `current = B` ⇒ A `earlier`; B `current`; C, D `upcoming`.
`null` ⇒ all `upcoming`. `earlier` means only "before the team's current
step"; it is not a claim that the team completed or ever held that step.

## UX behavior
(Illustrative, non-normative styling; the normative contract is the BRs.)
Per tracked tree, inside the existing `Card`: tree name; summary line; the
vertical path (filled marker with step number for `earlier`, emphasized
marker plus bold label for `current`, outlined marker for `upcoming`; solid
rail up to the current step, dashed after); then the unchanged controls.
Visual styling reuses existing Tailwind tokens, Geist and `Card`; markers are
CSS-drawn numerals (no icons).

## Edge cases and failure behavior
- 2 stages / 20 stages / long labels: BR-13.
- `currentNodeId` first or last stage: only `upcoming` or only `earlier`
  neighbors respectively (BR-1).
- Unknown `currentNodeId` (BR-2b), empty `nodes` (should not occur): render
  without fabricating a position; no crash.
- Post-report refetch: existing remount-by-key behavior stays; the path
  simply re-renders from the fresh `currentNodeId`. A failed report leaves
  the path untouched (it depends only on props).

## Security and privacy
No additional requirements. The feature adds no data, requests, or
authorization behavior: `verifyIdToken(checkRevoked=true)`, server-side
authorization, `canReportProgress` derivation, disabled-team semantics,
app-admin-alone non-reporting, deny-all client Firestore and team-level (not
individual) modeling are untouched. Copy must not imply individual
assessment (BR-10). The path receives only already-authorized DTO fields.

## Performance
Pure render-time derivation over ≤20 nodes per tree; no fetch, no effect, no
extra state, no new bundle dependency. The `TeamDetail`/`AdminTeamDetail`
request topology (`Promise.all`) is unchanged.

## Data / API impact
None.

## Architecture decisions
- The component and its derivation live in `src/features/skill-trees/
  components/` (feature-owned; two real consumers justify one component,
  per `.claude/rules/architecture.md`). Derivation is a small pure function
  exported alongside for direct unit testing.
- Copy: one new `skillProgressPathCopy` in `copy.ts`; existing per-surface
  copy keys stay for their remaining uses.
- Vertical-only layout at all breakpoints guarantees no overflow at 20
  stages with long labels and avoids breakpoint-specific semantics.
- Cross-team overview intentionally text-only (BR-11).

## Test boundaries
| Boundary | Covers |
|---|---|
| Pure derivation function (unit) | BR-1, BR-2, BR-3, BR-4 (incl. unsorted input, no input mutation) |
| `SkillProgressPath` render/rerender (RTL) | BR-3, BR-4, BR-5, BR-6, BR-9, BR-10, BR-13 (long labels/20 nodes render fully), BR-14, BR-15, BR-16, BR-17 |
| `TeamSkillSection` (existing suite updated) | BR-7, BR-18 |
| `TeamSkillTrackingSection` (existing suite updated) | BR-8, BR-18 |
| Unchanged-surface suites still green; diff review | BR-11, BR-12, BR-18, BR-19, BR-20 |

Tests assert semantics (roles, `aria-current`, text, order), not Tailwind
classes. Backward recomputation is tested by rerendering C → B.

## Acceptance criteria
- [ ] Derivation table (middle/first/last/null/unknown/backward/unsorted) verified; input `nodes` not mutated.
- [ ] Both surfaces render the path; decimal `<ol>` removed there.
- [ ] Member controls appear/hide exactly as before for every
      `canReportProgress`/team-status case; admin controls unchanged.
- [ ] Only the current stage has `aria-current="step"`; all states have
      visible text; decoration is `aria-hidden`; nodes are non-interactive.
- [ ] No horizontal overflow mechanism introduced; 20-stage and long-label
      cases render in full.
- [ ] No diff in `app/api/**`, `server/`, `domain/`, `client/`, package
      files, or unchanged surfaces (overview, catalog, forms).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass;
      `docs/UI-UX.md` updated.

## Residual risks / accepted limitations
- Admin tracked state remains session-derived (Phase 7 decision); the path
  inherits that.
- Vertical rail with 20 stages is tall; accepted over horizontal scrolling.
- Visual result is verified by code-level/semantic tests, not screenshots
  (consistent with the UI refresh's method).

## Open questions
None.
