# Team Roadmap (Feature B)

## Status
**Implemented** — TASK-001 through TASK-013 are done (closeout 2026-10-04);
Revision 2 (narrow re-review `PASS WITH SUGGESTIONS`, no open decisions) is what
was built. The durable documents (`ROADMAP.md`, `UI-UX.md`, `ARCHITECTURE.md`,
`PRODUCT.md`, and Feature A's BR-37) were reconciled with the as-built behavior;
`SECURITY.md`, `DEVELOPMENT.md` and `DATA-MODEL.md` needed no change. The text
below is the historical specification and is kept as written, including its
rationale.

*History:* Revision 2 applied the Revision 1 review (CHANGES REQUIRED) and
**closed OQ-1 through OQ-5** (see "Decisions resolved from open questions").
*Clarification after the TASK-001 review:* legacy completed plans with
`completedAt === null` are readable but read-only in B v1 (BR-23a); no other
requirement changed.

*As-built clarification (TASK-010/TASK-012 reviews):* when the archived-inclusive
read is `truncated`, `Områder uten plan` is withheld (fail-closed): absence of a
plan cannot be proven from an incomplete response, and the server's
`already_planned` check is only a backstop. This refines BR-18; it is intentional,
not a defect. See `docs/ARCHITECTURE.md` → "Team Roadmap".

## Problem
Feature A (`docs/features/team-skill-planning/SPEC.md`) lets a team plan a
target stage, priority, optional dates, optional owner and status *inside*
each *Kompetanseområde* row of `/teams/[teamId]`. That answers "what are we
planning for this competency area?" but there is no place that answers, across
areas: what is the team **currently** planning, and when? Which plans are
active, upcoming, overdue, completed or undated? Planning data exists in
`roadmapItems`; nothing presents it as a roadmap.

Feature B answers **"What is the team currently planning across competency
areas, and when?"** It does **not** answer "what were all previous versions of
the plan?" (D8).

## User outcome
A team member (or app admin reading) opens one dedicated Roadmap page for a
team and sees every current competency-area plan together, as a grouped
**list** or a lightweight **target-quarter timeline**, filtered by
status/priority, and can edit any plan, or create one for a tracked area that
has none, with exactly the same controls and server rules as in
*Kompetanseområder*. Both surfaces always show the same canonical server state.

## Goals
- One cross-area view of the **current** plan, in list and timeline form.
- Reuse Feature A's editor, gateway, routes and validation; no second write
  path.
- No new persistence, index, rule or migration.

## Scope
- Route `/teams/[teamId]/roadmap` and route-based `Oversikt · Roadmap`
  navigation (D1).
- List view and timeline view over the existing `roadmapItems`, one view
  switch, shared filters (status, priority, `Vis arkiverte`).
- Editing/archiving/restoring/creating through the **existing** Feature A
  editor, gateway and `PATCH`/`POST` routes (D6, D7, D25).
- One additive, derived, non-persisted read-DTO field: `completedAt` (D16).
- A team-level plan count line (no per-person metrics).
- A small behavior-preserving extraction of `RoadmapPlanningScope` state
  (D6).
- Documentation updates (see "Documentation impact").

## Out of scope
- Any persisted history / event log / "Historikk" UI, and any reconstruction
  of prior phases (D8).
- Multiple plans per competency area, phases, sequential plan persistence,
  new IDs, migrations (D14).
- A `replanned`/`paused`/`cancelled` status; new statuses (D7).
- Challenge links or challenge-derived context (D15).
- Lead-specific behavior, lead-only or admin write rights; changes to
  `authorizeTeamAccess` or `resolveTeamRole` (D17, D18).
- Gantt chart, calendar grid, board view, drag-and-drop, dependencies,
  notifications, export, recurring plans, free text on plans, comments.
- A three-tab team shell; splitting `TeamDetail`; moving *Kompetanseområder*
  out of it.
- Individual skills, matrix, gap analysis (C1/C2); roles, goals, check-ins
  (D1/D2).
- Per-owner anything: filter, sort, count, summary (invariant 30).
- Server `today`, a `Nå` marker, `currentLabel` (D16, D26).
- Demo Team fixture changes; Firestore index/rules changes; deploys; seeds.

## Key concepts
- **Plan** — one `roadmapItems` document (exactly one per team + competency
  area/tree).
- **Roadmap page** — the cross-area surface presenting the *current canonical
  roadmap*; **Kompetanseområder** stays the compact per-area surface. Both
  read/write the same plans.
- **Current-state metadata** — `updatedAt`, `completedAt`. This is **not**
  history and must never be described as history (D8).
- **Target-quarter timeline** — a lightweight vertical schedule grouping plans
  by the calendar quarter of `targetDate`. It is **not** a Gantt chart.
- **Sort anchor (sorting only)** — where used, ordering inside a timeline
  group uses named fields (`targetDate`, `startDate`, `completedAt`) explicitly
  listed in BR-9. There is no "anchor date" in classification.

## Repository findings (code vs. docs)
Verified by reading the implementation (`src/features/roadmap/**`,
`app/api/teams/[teamId]/roadmap-items/**`, `TeamDetail`, `SiteHeader`,
`authorizeTeamAccess`, demo fixtures):

1. **No team tab navigation exists.** Docs (Feature A BR-37) speak of tabs
   `Oversikt · Kompetanse · Roadmap`. In code `/teams/[teamId]` is **one
   scrolling page** (`TeamDetail`) with *Kompetanseområder*, *Forum* (flag
   `FEATURE_FORUM_ENABLED`), challenges and roster as **sections**. `SiteHeader`
   is the only nav. No tab component exists in `src/components/ui`.
   `TeamDetail` renders `RoadmapPlanningScope` in **two** render branches
   (member and admin-reading); a nav integration touching one must touch both.
2. **The roadmap read already serves B.** `GET …/roadmap-items` returns
   `RoadmapItemView` sorted by `compareRoadmapPlans`. With `?archived=true` it
   returns archived **and** non-archived plans in one response (archived
   plans are filtered in memory, not in the query). Query: `where teamId ==` +
   `limit(501)`, no `orderBy` → **no composite index**. The defensive 501
   bound applies **before** in-memory archived filtering, so archived
   documents count toward it.
3. **Feature A reads in two requests.** `RoadmapPlanningScope` fetches the base
   read on mount and a second archived-inclusive read only when "Vis arkiverte"
   is switched on. B needs the single-request mode (D5/D6) without changing A.
4. **Only one DTO gap for B:** `completedAt` is persisted but not in
   `RoadmapItemView`. A current-stage label and a server "today" are **not**
   needed (D16, D26).
5. **No history exists.** The persisted record has `createdAt/By`,
   `updatedAt/By`, `completedAt`, `archivedAt/By`. Prior target/date/status/
   owner values are overwritten. `updatedBy` is internal, never returned.
6. **Doc/code differences:** (a) A BR-37 lists tab navigation, board views,
   multi-plan history and challenge links as B-owned expectations;
   `docs/ROADMAP.md` lists only "route/tab with timeline/list views and fuller
   roadmap experience". B v1 supersedes BR-37 (see "Documentation impact").
   (b) Nothing in code or product docs needs the one-plan invariant relaxed.
   (c) `canEdit:false` conflates non-member admin, disabled team and lost
   membership; B keeps the contract unchanged (D17).
7. **Editor reuse is feasible but coupled.** `AreaPlanEditor` needs a
   `PlanningArea {treeId,name,currentNodeId,nodes}` and `PlanningActions`
   (`token`, `teamId`, `refresh()`, `owners`, `loadOwners()`).
   `RoadmapPlanningScope` owns the state but exposes it only through a render
   prop shaped for `TeamSkillSection`. Untracked plans already use a
   synthetic `PlanningArea` (`currentNodeId: null`, `nodes: []`) with
   `targetLocked`.
8. **Skill trees are never deleted**; "missing tree" is only malformed data,
   already handled by the DTO (`areaName: null`, `targetAvailable:false`).
9. **Challenges** share no field with roadmap items; they are anonymous.
10. **Existing anchor:** the *Kompetanseområder* section heading in
    `TeamSkillSection` has `id="team-skill-section-heading"`. No other anchor
    exists (D1).
11. **Demo Team** has 3 plans: active+dated (`demo-skill-testing`),
    planned+undated (`demo-skill-observability`), completed with target
    reached (`demo-skill-delivery`), no owner.
12. **`compareRoadmapPlans`** (`roadmap/domain/roadmap-sort.ts`) orders:
    non-archived first; status active < planned < completed; priority high <
    medium < low; `targetDate` asc (absent last); `startDate` asc (absent
    last); area name (`nb`, unresolved last); `treeId`. Owner is never a key.

## Actors and access
| Actor | Read roadmap page | Edit |
|---|---|---|
| Member of an active team | yes | yes (`canEdit:true`) |
| Member of an inactive team | yes (existing `authorizeTeamAccess`) | no |
| Team lead | same as member | same as member (no extra, no less) |
| App admin, not a member | yes (read-only) | no |
| App admin who is also a member of an active team | yes | yes, **as a member** |
| Non-member / unknown team | no (`forbidden`) | no |
| Signed out | sign-in prompt | no |

Authorization is unchanged. `canEdit` is server-derived and only hides
controls. **B adds no route, no write path and no authorization rule.** A team
lead is an ordinary active team member for roadmap purposes (D18).

## User stories
1. As a team member, I want one page showing all our current competency plans
   so that I see the team's direction across areas.
2. As a team member, I want a timeline so that I see what is overdue, what is
   scheduled for which quarter, and what has no date yet.
3. As a team member, I want to filter by status and priority so that I can
   focus on what is active or important.
4. As a team member, I want to change a plan (target, dates, priority, status,
   owner, archive/restore) from the roadmap so that I do not have to hunt for
   the area row.
5. As a team member, I want to create a plan for a tracked area that has none,
   from the roadmap.
6. As a team member, I want plans of areas we stopped tracking to stay visible
   and clearly marked so that nothing silently disappears.
7. As an app admin, I want to read a team's roadmap without being able to
   change it unless I am a genuine member.
8. As any viewer, I want the roadmap usable on a phone, by keyboard and
   without relying on colour.

## Behavioral requirements

### Route and navigation
- **BR-1** `/teams/[teamId]/roadmap` renders the Roadmap page via a thin
  `app/teams/[teamId]/roadmap/page.tsx` (`PageShell`, same pattern as
  `app/teams/[teamId]/page.tsx`); page logic lives under
  `src/features/roadmap/components/`. `teamId` comes from the URL only; every
  read is authorized server-side. Because the view is read from search
  params, the client component using `useSearchParams` must be wrapped in
  `<Suspense>` if the current Next conventions require it (implementer reads
  `node_modules/next/dist/docs/` per `AGENTS.md`).
- **BR-2** Route-based navigation `<nav aria-label>` with exactly two links:
  **Oversikt** → `/teams/[teamId]` and **Roadmap** → `/teams/[teamId]/roadmap`.
  The current route's link has `aria-current="page"`; the other has none. On
  any other team sub-route (e.g. `/teams/[teamId]/forum/[threadId]`) or an
  unknown path the Roadmap link is **not** marked current (match the exact
  pathname, not a prefix). The nav renders on the Roadmap page and in the
  **authorized states of `TeamDetail` in both render branches** (member and
  admin-reading), not in access-denied/request states. It is implemented as a
  small shared component (location chosen by the implementer per
  `architecture.md`, e.g. `src/features/teams/components/`); team
  context/header follows existing patterns without copying `TeamDetail`.
  *Kompetanse* is not a separate destination; it remains a section of Oversikt.
  Forum behavior is untouched (flag-gated section of Oversikt).
- **BR-3** The Roadmap page offers a link "Åpne Kompetanseområder" to
  `/teams/[teamId]#team-skill-section-heading` (the **existing** heading id; no
  new anchor is introduced). `TeamDetail`'s *Kompetanseområder* section gets a
  link "Se roadmap" to the Roadmap route, in both render branches.
- **BR-4** Page states: signed out → existing `SignInPrompt`; loading →
  `LoadingState`; `forbidden`/unknown team → neutral "no access" alert with a
  link to `/teams/[teamId]`; roadmap read failure → error `Alert` with retry;
  zero plans → `EmptyState` (and `Områder uten plan` still renders when
  eligible areas exist, BR-18). The team-name heading uses the existing
  teams-overview read **as a best-effort dependency**; if it fails or the team
  is not found in it, a generic heading is used (never a team id) and the
  roadmap is unaffected.

### Read strategy (canonical, single request)
- **BR-5** On page load the page performs **one** roadmap GET with archived
  inclusion (`GET …/roadmap-items?archived=true`) and keeps the complete
  response (archived and non-archived) in page state. `Vis arkiverte` is
  **purely client-side visibility state**: toggling it never triggers a
  roadmap GET. After a successful mutation the page refetches the **same**
  archived-inclusive read and renders from refreshed server state; there are no
  optimistic updates. The existing 501 defensive bound (and `truncated`
  notice, BR-27) applies before in-memory archived filtering, so archived
  documents count toward it.
- **BR-6** Feature A's behavior (base read + lazy archived read on toggle) is
  unchanged. The extraction (D6) must support B's single-request mode as an
  option without altering A's observable requests or output.

### Skills read dependency
- **BR-7** The existing team skills read (`fetchTeamSkills`-equivalent in
  `skill-trees-gateway`) is a **required page-level dependency** of the
  Roadmap page, loaded alongside the roadmap read, not only for creation. It
  supplies: tracked areas eligible for `Områder uten plan`, target options
  (`PlanningArea.nodes`), `currentNodeId`, and everything tracked-plan
  editing/retargeting needs. Current-stage and target data is never inferred
  from the roadmap DTO.
- **BR-8** Failure behavior (single deterministic rule): if the roadmap read
  succeeds but the skills read fails, the page **still renders all plans**
  (list/timeline/filters/counts work) but **every mutation control is
  absent** — no edit/plan affordance, no archive/restore, no `Områder uten plan`
  creation — and a scoped `Alert` explains that planning data could not be
  loaded, with a retry action that refetches only the skills read. No data is
  inferred or defaulted. The page is read-only for this state; it never
  silently fails. If the roadmap read fails, BR-4's read-failure state applies
  regardless of skills. While skills are loading, mutation controls are
  absent and a loading indicator is scoped to that part.

### List view
- **BR-9a (list)** List = cards grouped by status — *Pågår* (`active`),
  *Planlagt* (`planned`), *Fullført* (`completed`, disclosure BR-16) — each
  ordered by `compareRoadmapPlans` (reused unchanged; for non-archived plans of
  one status it yields priority → target date → start date → area name →
  `treeId`). Archived plans (when visible) form a final separate section
  *Arkiverte*, also in `compareRoadmapPlans` order, never mixed in.
  Empty groups are not rendered.
- **BR-10a (list card)** Primary line: competency area (or "Ukjent område"
  when `areaName` is `null`), target stage label (or the existing
  `targetUnavailable` text), status (text), priority (text). Secondary:
  period (`DD.MM.YYYY – DD.MM.YYYY` / "Fra …" / "Til …" / "Ingen dato", with
  labelled "Startdato"/"Måldato"), owner (A's presentation: name / "Deg" /
  ordinal / "Ansvarlig er ikke lenger tilgjengelig" when unavailable /
  nothing when none), and text indicators: "Målet er nådd" (`targetReached`),
  "Måldato passert" (`overdue`), "Arkivert", "Følges ikke" (untracked),
  "Sist oppdatert <date>", and "Fullført <date>" (from `completedAt`) on
  completed plans **when `completedAt` is non-null** (never "Fullført null").
  No current-stage label is required in the list.
- **BR-11a (list states)** Overall no-plan state: `EmptyState` explaining that
  plans are created for tracked competency areas (BR-4/BR-18). Filtered empty
  state: when plans exist but none match the filters, an "ingen treff" message
  with a clear-filters action; this is distinct from the no-plan state.
- **BR-12a (edit affordance)** Each card has a "Planlegg"/"Rediger" button
  (only when `canEdit` and the skills read succeeded, **and the plan is not a
  legacy read-only plan, BR-23a**) that expands the existing `AreaPlanEditor`
  inline (D6): button with `aria-expanded`/`aria-controls`.

### Timeline view
- **BR-9 (timeline classification — first-match precedence)** The timeline is a
  **lightweight vertical target-quarter timeline, not a Gantt chart**. Every
  included roadmap item (i.e. every item passing the active filters and the
  archived-visibility rule) is classified into **exactly one** group by
  first-match, evaluated in this order:
  1. `archived === true` → **Arkiverte** (present only when `Vis arkiverte` is on)
  2. else `status === "completed"` → **Fullførte**
  3. else `overdue === true` → **Forfalt**
  4. else has `targetDate` → **target-quarter group** (calendar quarter of
     `targetDate`, e.g. "4. kvartal 2026")
  5. else has `startDate` (and no `targetDate`) → **Kun startdato**
  6. else → **Uten dato**

  Consequences (all normative): an archived plan never also appears in
  overdue/completed/quarter/start-only/undated groups; a completed plan never
  appears in a dated/undated group; an overdue incomplete plan never also
  appears in its target quarter. Quarter grouping uses `targetDate`, **never**
  `startDate`. A long-running plan is intentionally grouped by its **target**
  quarter (known tradeoff). No date is ever invented. The classification is an
  **exhaustive, mutually exclusive partition** of the included items.
  Group display order: Forfalt, target quarters ascending, Kun startdato, Uten
  dato, Fullførte, Arkiverte; empty groups are not rendered. `Fullførte` and
  `Arkiverte` follow the disclosure/visibility rules (BR-16, BR-17).
- **BR-10 (timeline ordering)** Deterministic order inside each group, reusing
  `compareRoadmapPlans` as the tie-break base:
  | Group | Order |
  |---|---|
  | Forfalt | `targetDate` asc → `compareRoadmapPlans` |
  | Target quarter | (quarters asc) → `targetDate` asc → `compareRoadmapPlans` |
  | Kun startdato | `startDate` asc → `compareRoadmapPlans` |
  | Uten dato | `compareRoadmapPlans` |
  | Fullførte | `completedAt` desc (absent last) → `compareRoadmapPlans` |
  | Arkiverte | `compareRoadmapPlans` |

  This is the only timeline-specific comparator logic; it lives in one pure
  helper (`groupRoadmapTimeline`, with a `quarterOf` helper) in
  `roadmap/domain/` and composes `compareRoadmapPlans` rather than copying its
  rules. Dates are ISO `YYYY-MM-DD` strings compared lexicographically; quarter
  = calendar quarter of `targetDate` (Jan–Mar = 1. kvartal …). Group
  membership never depends on the current date (overdue comes from the
  server-derived `overdue` flag).
- **BR-11** Each timeline row shows the same facts as a list card in compact
  form and **always as text**: period (with labelled dates), status, priority,
  target, indicators. Plans with target+start, target only, start only and no
  dates are all supported. No decorative range bar and no `Nå` marker in v1.
- **BR-11b** A completed plan is never overdue (it is classified by rule 2); a
  plan whose target is reached but not completed shows "Målet er nådd" and
  stays in its normal group (never auto-completes); an untracked plan appears
  in its normal group with "Følges ikke".
- **BR-11c** Timeline rows use the same edit affordance and the same single
  editor as the list (BR-12a).

### View switching, filters, summary
- **BR-12** A single labelled control switches **Liste | Tidslinje** (real
  buttons with `aria-pressed`, or radio semantics). Default **Liste**.
- **BR-13** View mode is **navigational/shareable state**: `?view=timeline`
  selects the timeline; absent or any other value falls back safely to list.
  Switching view updates the URL by **replacement** (no history entry per
  toggle) if this matches the repository's current Next navigation
  conventions. The view is not persisted in `localStorage` or on the server.
  **Filters are transient interaction state**: not in the URL, not in
  `localStorage`, not persisted; they are shared by both views and reset on
  reload. Completed-section expansion is also transient (BR-16).
- **BR-14** Filters, exactly three:
  - **Status** — single-select: Alle (default) / Pågår / Planlagt / Fullført.
  - **Prioritet** — single-select: Alle (default) / Høy / Middels / Lav.
  - **Vis arkiverte** — toggle, default off; purely client-side (BR-5).
  Filters apply in memory over the already-loaded response. Status and
  priority filters also apply to archived plans once archived visibility is on
  (status filter matches the plan's `status` regardless of archived).
  There is **no** owner, area, tracking-state or text filter and **no** owner
  sorting or owner metrics. Excluding owner-based filtering/sorting is
  **deliberate**: owner is coordination metadata, not a performance dimension.
- **BR-15** A one-line **plan count** summary, labelled as plan counts (e.g.
  "Planer: 2 pågår · 1 planlagt · 1 fullført"), is derived in memory from the
  **unfiltered, non-archived** items and **does not change** with
  interactive filters or `Vis arkiverte`. Counts are mutually exclusive status
  counts only. If overdue is shown it must be an explicit subset of active/
  planned (e.g. "2 pågår, derav 1 forfalt"), never a peer category; omitting
  overdue is acceptable. No completion rate, velocity, productivity or
  maturity score, no owner counts or owner completion figures. Counts are
  client-derived and not persisted.
- **BR-16 (completed disclosure)** The *Fullført* section (list) / *Fullførte*
  group (timeline) is an explicit disclosure: a `<button>` with
  `aria-expanded` and `aria-controls`, **collapsed by default**. Filtering is
  applied **before** counts, so the header shows the **filtered** completed
  count. When the status filter is explicitly **Fullført**, the section is
  automatically expanded (and expanded by default) so matching results are not
  hidden; the user may still collapse it. Expanded/collapsed state is
  page-level transient state **shared** between list and timeline; it is not in
  the URL or `localStorage`.
- **BR-17 (archived visibility)** Archived plans are hidden by default and
  included by `Vis arkiverte`, filtered client-side from the already-loaded
  response. They always appear in a **separate final** archived section/group,
  never participate in other groups (BR-9), and are restorable using the
  existing semantics when editable. Completed-and-archived plans appear **only**
  in the archived group (precedence rule 1).

### Editing, replanning and creation
- **BR-18 (Områder uten plan)** A minimal section `Områder uten plan` lets the
  user create a plan for a tracked competency area that has none, using the
  **existing create contract** (`POST …/roadmap-items`, existing validation and
  existing editor create path). No new endpoint, persistence model or
  validation. **Eligibility** = tracked competency areas (from the skills
  read) **minus every `treeId` represented by any roadmap item in the
  archived-inclusive response — active, completed, and archived alike**
  (computed from the complete response, independent of `Vis arkiverte` and of
  the filters). An area whose canonical plan is archived therefore does **not**
  appear here; the user restores it via `Vis arkiverte`, which preserves the
  one-plan-per-team/tree invariant and avoids `plan_archived` create failures.
  The section is absent when `canEdit` is false, the skills read failed
  (BR-8), or no area is eligible.
- **BR-19 (replanning)** Replanning is the existing in-place edit (D7): target
  (tracked areas only, strictly ahead), priority, status, start/target date,
  owner, archive/restore, with the same server validation and error codes as
  Feature A. B adds no endpoint, field, status or client-side rule that A
  lacks. Reopening a completed plan is the status select. Archived plans
  accept only restore, unchanged. Previous values are overwritten (D8).
- **BR-20** No optimistic updates. After a successful write the page refetches
  the canonical archived-inclusive read (BR-5); a failed refetch is reported
  separately from the write (existing A notices) and keeps the previous state.
- **BR-21** The Roadmap page and *Kompetanseområder* stay consistent because
  both mutate through the same server operations and each refetches on mount;
  there is no shared client cache.

### Untracked, archived, completed
- **BR-22** Plans with `tracking.state === "not_tracked"` are shown in place
  with "Følges ikke" and an explanation: the area still exists, the team no
  longer tracks it, the target is locked (`targetLocked`, using A's synthetic
  `PlanningArea`), other fields stay editable, archive/restore remain
  available (subject to BR-8).
- **BR-23** Completed plans stay visible (BR-16) and are not treated as
  archived; archive is independent of status.
- **BR-23a (legacy completed plan — read-only, B v1)** A plan with
  `status === "completed"` and `completedAt === null` (legacy data; the read
  tolerates it, the DTO carries `completedAt: null`) is **readable but
  read-only** in Feature B v1. It stays visible, classified completed, in
  *Fullført*/*Fullførte* (BR-10: `completedAt` absent sorts last), and omits the
  "Fullført <date>" detail (never "Fullført null"). It renders **no** edit,
  archive or restore control, and B never sends a `PATCH` for it. A short
  non-alarming text (e.g. "Eldre fullført plan – kan ikke endres") may state
  the read-only state; it is not conveyed by colour alone. The rule is
  **item-specific**: completed plans with a valid `completedAt` keep full
  edit/reopen/archive behavior (BR-19), and `canEdit` keeps its page/team-level
  meaning and is neither redefined nor overloaded — legacy eligibility is an
  additional per-item rule. The mutation parser stays strict (such a plan
  would be rejected as `not_found`); no timestamp is synthesized, no parser
  tolerance is added to create/update/Demo Team preflight, and there is no
  migration or backfill. A legacy plan that is also archived is likewise
  read-only (no restore from B).

### History / change visibility
- **BR-24** B v1 persists and shows **no history** (D8). Only current-state
  metadata: "Sist oppdatert <date>" (`updatedAt`) and "Fullført <date>"
  (`completedAt`). No UI, heading, tooltip or copy may call these "historikk",
  "endringslogg" or imply prior values are available; help text states that
  the roadmap shows the **current** plan.

### Failure behavior and privacy
- **BR-25** Independent failures: roadmap read failure never blanks the page
  chrome; skills read failure → BR-8; owner-list failure keeps the editor
  usable with A's existing "kunne ikke laste" behavior; team-name failure →
  generic heading (BR-4); mutation failure uses A's error copy and refetches
  except on `persistence_failed`/`request_failed` (A's rule).
- **BR-26** Anti-surveillance (D19): no individual metric of any kind; no
  per-owner filter/sort/count/summary, no "who is behind", no owner
  completion/overdue figures, ranking, leaderboard or productivity/team
  performance score. Owner is shown only as A shows it and grants nothing.
- **BR-27** Names, labels, dates render as inert text; `memberRef` is never
  rendered or placed in a URL, `aria-*`, `data-*` or log; no UID/email.
  When the read reports `truncated`, show a notice that the list may be
  incomplete (reuse A's pattern).
- **BR-28** `canEdit` keeps its existing contract and is **not** expanded. If
  `canEdit === false`: the roadmap is read-only, mutation controls (including
  `Områder uten plan`) are absent per existing UI convention, and the UI makes
  no claim about *why* (no inactive-team-specific banner).

### Responsive and accessibility
- **BR-29** Below `sm`: single column of stacked cards; timeline rows stack
  facts vertically; no required horizontal scroll (down to 360 px); filters
  wrap; readable date text.
- **BR-30** Accessibility: view switch and filters are native, labelled,
  keyboard-operable with visible focus; current view exposed programmatically
  (`aria-pressed`/radio); status, priority, overdue, reached, archived,
  untracked and every date/status/priority meaning is available as **text**
  (never colour/position alone); dates `DD.MM.YYYY` with explicit label or
  `<time datetime>`; timeline is semantic headings + lists (group heading,
  `<ol>`), reading order = group order; disclosures (completed, edit) are
  buttons with `aria-expanded`/`aria-controls`, focus returns to the trigger on
  close; live regions announce load/refresh/error once; heading levels
  continue the page outline (h1 page title, h2 groups).
- **BR-31** Norwegian copy lives in `roadmap/copy.ts` (extended, not
  duplicated); *Kompetanseområde*, never *Ferdighet*.

## Edge cases and failure behavior
- No plans and no eligible areas ⇒ empty state; `Vis arkiverte` still works.
- All plans archived and hidden ⇒ the main view is empty but `Områder uten plan`
  must **not** list those areas (BR-18); an explanatory hint points to
  `Vis arkiverte`.
- Plan with `areaName: null` / `targetAvailable:false` ⇒ "Ukjent område" /
  existing unavailable text; sorted last by `compareRoadmapPlans`.
- Owner `unavailable` ⇒ A's "Ansvarlig er ikke lenger tilgjengelig".
- Overdue requires `targetDate`; overdue + start-only is impossible.
- Stale write (archived/removed elsewhere) ⇒ A's `archived`/`not_found` copy +
  refetch.
- Permission loss/inactive team mid-session ⇒ write returns `forbidden`/
  `team_disabled`; A's copy and refetch (`canEdit` flips false).
- Legacy completed plan with absent/`null` `completedAt`: returned by the read
  with `completedAt: null` (explicit read-only exception; a *malformed*
  `completedAt` is still skipped), displayed read-only per BR-23a; strict
  create/update/preflight parsing is unchanged.
- Malformed documents skipped by the server (existing); a client parse failure
  of any item fails the read to `read_failed` (existing gateway behavior).
- Auth identity change ⇒ state discarded (epoch/key pattern from A).

## Security and privacy
Feature-specific implications of `docs/SECURITY.md` (23–30):
- **No new persistence, route or write path** ⇒ no new Firestore surface; rules
  unchanged (client access denied).
- Read DTO stays an allow-list built field by field; the only addition,
  `completedAt`, is a plan timestamp with no actor. Tests assert the exact key
  set. `updatedBy`/`completedBy`/`archivedBy` stay internal.
- Owner is coordination metadata; invariant 30 is carried into B explicitly
  (BR-14, BR-26) — the filter set is closed.
- **Anonymity boundary:** the Roadmap page renders no forum `authorTag`, no
  anonymous challenge author/participant identity, no UID/email, no internal
  membership identifier. B introduces no join between plans and forum/challenge
  identity. Counts are over plans, not people.
- App admin gets read access through the existing path only.
- Logs: no plan content, names or refs (unchanged).

## Architecture decisions

| ID | Decision |
|---|---|
| **D1** Route/nav | `/teams/[teamId]/roadmap`; route-based `Oversikt · Roadmap` (two links, exact-path `aria-current`). *Kompetanse* remains a section of Oversikt (anchor `#team-skill-section-heading`, existing). No three-tab shell/`TeamDetail` refactor. Supersedes A BR-37's conceptual `Oversikt · Kompetanse · Roadmap`. **OQ-2 resolved.** |
| **D2** Views | Both list and timeline with a switch. |
| **D3** Default | List; `?view=timeline` for timeline; invalid ⇒ list. |
| **D4** Timeline form | Lightweight vertical target-quarter timeline, first-match partition (BR-9). Rejected: Gantt, calendar grid. |
| **D5** Read + filters | One archived-inclusive GET (`?archived=true`) held in page state; `Vis arkiverte` and status/priority filters are client-side; refetch the same read after writes. Filters = status, priority, show-archived only; single-select; transient. |
| **D6** Editing seam | Reuse the existing `AreaPlanEditor`, `PlanningActions`, gateway/routes, validation, owner loading and canonical refetch. Extract `RoadmapPlanningScope`'s state/actions into a small reusable planning hook/controller (conceptually `useRoadmapPlanning(...)`; the exact symbol is the implementer's choice) exposing roadmap items, `canEdit`, `refresh()`, `owners`/`loadOwners`, and a mode option for single archived-inclusive read. `RoadmapPlanningScope` becomes a thin wrapper with unchanged behavior. No broad `TeamDetail`/component refactor; the editor is not duplicated. |
| **D7** Replanning | = existing in-place edit; no new status/endpoint. |
| **D8** History | **No persisted history in B v1 (OQ-1 resolved).** In-place update overwrites previous target, dates, status, owner; B does not reconstruct prior phases. `updatedAt`/`completedAt` are current-state metadata, never history. |
| **D9** Future-history constraints (non-binding for B) | If history is ever added: (a) generated by the shared server mutation layer; (b) Feature A and B mutations have identical history semantics; (c) no UID/email exposure; (d) current `memberRef` must not casually become permanent historical identity; (e) retention is undecided. No schema, path or event taxonomy is decided here. |
| **D10** Mutations | B adds no mutation logic; A and B share the same server operations. |
| **D11** Completed | Visible; collapsed disclosure; filtered count; auto-expands for status filter `Fullført`; transient shared state. |
| **D12** Archived | Hidden by default; client-side reveal; final separate group; restore there. |
| **D13** Untracked | In place with "Følges ikke"; target locked. |
| **D14** One plan per team/tree | **Keep** — one `roadmapItems` document per team + tree. No multi-plan history, phases or sequential persistence. The Roadmap page presents the current canonical roadmap. No migration or persistence redesign. |
| **D15** Challenges | **Defer.** A roadmap/challenge relationship is not automatically deanonymising, but cross-feature links create a potential correlation surface around an anonymous feature and give insufficient B-v1 value. Deferred on scope, privacy and anonymity-boundary grounds. B must not expose or correlate forum `authorTag`, anonymous challenge identity, UID/email or internal membership identifiers. |
| **D16** Data model / DTO | `roadmapItems` unchanged. **Only additive read-DTO field: `completedAt: string \| null`** (already persisted; used for completed presentation/ordering; no actor). **Removed from Rev 1:** `currentLabel` (editor gets current stage from the skills read; `targetReached` suffices for the indicator) and envelope `today`. Gateway parser and shared `toRoadmapItemView` updated for `completedAt`. |
| **D17** `canEdit` | Existing contract unchanged; `false` ⇒ read-only without claiming a reason; no inactive-team banner. |
| **D18** Lead/admin | **OQ-3 resolved:** no lead-specific behavior. Lead = ordinary active member: no extra write permission, lead-only controls/filters, managerial analytics or approval workflow. App-admin behavior unchanged (read-only unless genuine member). |
| **D19** Anti-surveillance | Team-level plan counts only; closed filter set; no owner dimension. |
| **D20** Mobile | Stacked, vertical, no horizontal scroll. |
| **D21** Accessibility | BR-30. |
| **D22** Query/index | One archived-inclusive GET + existing skills read + owner/assignable-member load only as the existing editor does (lazy) + best-effort teams-overview read for the name. **No new Firestore query pattern, index or rule; no migration; no backfill; no persistence change.** |
| **D23** Demo Team | No fixture changes. The existing three plans demonstrate target-quarter, undated and completed. Overdue, archived, start-only, untracked and unavailable-owner are covered by tests. No synthetic members, no fixed `memberRef`. |
| **D24** Migration | None. |
| **D25** Create from Roadmap | **OQ-4 resolved:** minimal creation via `Områder uten plan` with the existing create contract; eligibility excludes every `treeId` of any plan including archived (BR-18). |
| **D26** `today` / `Nå` | **OQ-5 resolved:** no server `today` in the DTO and no `Nå` marker. Overdue stays server-derived; grouping needs no authoritative today. |
| **D27** Route architecture | Thin `app/teams/[teamId]/roadmap/page.tsx`; logic in `src/features/roadmap/`; no shared team shell; `Suspense` for search params if Next requires (BR-1); generic heading if team-name read fails (BR-4). Team name uses the existing teams-overview read (best effort). |

## Decisions resolved from open questions
- **OQ-1 — Resolved:** no persisted history in B v1 (D8, D9).
- **OQ-2 — Resolved:** route-based `Oversikt · Roadmap`; Kompetanse remains on
  Oversikt (D1).
- **OQ-3 — Resolved:** no lead-specific UX or permissions (D18).
- **OQ-4 — Resolved:** include minimal creation through `Områder uten plan`
  using the existing create contract, excluding every `treeId` already
  represented by any plan including archived (D25, BR-18).
- **OQ-5 — Resolved:** no server `today` and no `Nå` marker (D26).

## Domain / data model implications
- `RoadmapItemRecord`: **no change.**
- `RoadmapItemView`: + `completedAt` (`string | null`) only. List envelope
  unchanged.
- New pure helpers (client-safe, `src/features/roadmap/domain/`):
  `roadmap-timeline.ts` (`quarterOf`, `groupRoadmapTimeline`),
  `roadmap-filter.ts` (`filterRoadmapItems`, `summarizeRoadmapItems`,
  eligibility helper for `Områder uten plan`).
- New components: `RoadmapPage`, view switch, list view, timeline view,
  filters, `Områder uten plan`, team navigation, route page. Reusable planning
  hook per D6.
- Dependency direction stays `roadmap → teams/skill-trees/profiles`;
  `TeamDetail` only gains the nav and a link (both render branches).

## API / read / write implications
- **No new route.** Reads: `GET /api/teams/[teamId]/roadmap-items?archived=true`
  (once per load/refetch), existing team skills read, assignable-members
  (lazy, first editor open, as A), teams overview (name, best effort).
  Writes: existing `POST …/roadmap-items` and `PATCH …/roadmap-items/[treeId]`
  only; no `DELETE`.
- The additive `completedAt` does not change status codes or the error model.

## Test boundaries
| Boundary | Covers |
|---|---|
| Server read contract (`listRoadmapItems`, route): exact allow-listed keys incl. `completedAt`, **no** `currentLabel`/`today`; unchanged auth matrix; no uid/audit leakage | BR-24, BR-27, D16 |
| Gateway parser: `completedAt` parsed fail-safe; malformed ⇒ `read_failed` | D16 |
| Domain `groupRoadmapTimeline`/`quarterOf`: precedence (archived+completed+overdue combos), partition (each item exactly once, none lost), quarter by `targetDate`, start-only, undated, ordering per BR-10, overdue not in quarter | BR-9, BR-10 |
| Domain filter/summary/eligibility: status/priority single-select, archived visibility, count line over unfiltered non-archived, no owner dimension, eligibility excludes archived-plan areas | BR-14, BR-15, BR-18 |
| Component `RoadmapPage`: states, single archived-inclusive GET and no GET on toggle, refetch after write (same read), skills-failure read-only mode, `?view` handling, filters transient, completed disclosure + `Fullført` auto-expand, archived final group, `canEdit:false`, text-only meaning, no memberRef | BR-1–BR-30 |
| Editor reuse regression: Feature A `RoadmapPlanning`/`RoadmapPlanEditor` tests pass unchanged | BR-6, D6 |
| `TeamDetail`: nav + "Se roadmap" in both render branches; forum flag and layout unchanged; `aria-current` correctness incl. forum sub-route | BR-2, BR-3 |
| Route page test | BR-1 |
| Guard test: no new route methods, no new Firestore collection/field in `src/features/roadmap` | D14, D16 |

Per project rules: tests at server/API contract and domain boundaries first;
UI behavior second.

## Acceptance criteria
Each is objectively checkable.

**Route and navigation**
- [ ] `/teams/[teamId]/roadmap` renders the Roadmap page; signed-out shows the
      sign-in prompt.
- [ ] A nav with exactly `Oversikt` (→ `/teams/[teamId]`) and `Roadmap`
      (→ `/teams/[teamId]/roadmap`) appears on the Roadmap page and in both
      authorized `TeamDetail` branches; the current link has
      `aria-current="page"`; on `/teams/[teamId]/forum/[threadId]` Roadmap is
      not `aria-current`.
- [ ] "Åpne Kompetanseområder" targets `#team-skill-section-heading`, which
      exists; "Se roadmap" exists in `TeamDetail`.

**Views and filters**
- [ ] Default is list; `?view=timeline` shows the timeline; an invalid `view`
      value shows the list; toggling replaces rather than pushes history (if
      conventions permit); view is not in `localStorage`.
- [ ] Filters are only status, priority, `Vis arkiverte`; status and priority
      are single-select with "Alle" default; they are not in the URL or
      `localStorage` and reset on reload; no owner filter/sort/metric exists.
- [ ] Status and priority filters also filter archived plans once
      `Vis arkiverte` is on.

**Read strategy**
- [ ] Page load issues exactly one roadmap GET with `archived=true`; toggling
      `Vis arkiverte` issues zero roadmap GETs and hides/shows archived items.
- [ ] After a successful write the same archived-inclusive GET is refetched and
      rendering uses its result; no optimistic update occurs.
- [ ] Feature A's request pattern (base + lazy archived) and all Feature A
      tests are unchanged and pass.
- [ ] With the roadmap read succeeding and the skills read failing: all plans
      render, no edit/archive/restore/create control is present, a scoped
      alert with retry (skills only) is shown; no stage/target data is
      inferred.

**List**
- [ ] Items are grouped Pågår/Planlagt/Fullført/Arkiverte (archived only when
      visible), ordered by `compareRoadmapPlans`; empty groups hidden.
- [ ] Each card shows area (or "Ukjent område"), target label, status and
      priority as text, period, owner per A rules, and indicators as text:
      "Målet er nådd", "Måldato passert", "Arkivert", "Følges ikke",
      "Sist oppdatert", "Fullført <date>" for completed.
- [ ] Zero plans shows the no-plan state; plans-but-no-match shows "ingen treff"
      with clear-filters; they are different states.

**Timeline**
- [ ] Classification follows BR-9 first-match precedence; each included item
      appears in exactly one group (property-style test: concatenated groups
      are a permutation of the included items).
- [ ] An archived item never appears in another group; a completed item never
      appears in a dated/undated group; an overdue incomplete item appears in
      Forfalt only.
- [ ] Quarter groups are by `targetDate` (a plan with an earlier `startDate` in
      another quarter stays in its target quarter); target-only and
      target+start are covered.
- [ ] Start-only items are in `Kun startdato`; no-date items in `Uten dato`;
      no invented dates.
- [ ] Ordering inside every group matches BR-10 (tested with ties).
- [ ] No Gantt/horizontal scale; no `Nå` marker.

**Completed and archived**
- [ ] Fullført/Fullførte is collapsed by default, a button with
      `aria-expanded`/`aria-controls`, header shows the **filtered** count;
      status filter `Fullført` auto-expands it; expansion is shared between
      list and timeline and is not persisted.
- [ ] Archived plans are hidden by default, shown in a final separate group when
      enabled, restorable when editable; archived+completed appears only as
      archived.

**Count line**
- [ ] Count line uses status counts over unfiltered non-archived items, does not
      change with filters/`Vis arkiverte`, is labelled as plan counts, shows no
      rates/scores/owner figures; any overdue figure is an explicit subset.

**Editing and creation**
- [ ] Edit, archive, restore and create use the existing editor, routes and
      validation (no new endpoint); an edit on the roadmap is visible in
      Kompetanseområder after navigation and vice versa.
- [ ] `Områder uten plan` lists exactly tracked areas minus all `treeId`s of
      any plan (active, completed, archived); an area with only an archived
      plan is **not** listed; creating uses the existing create contract;
      one plan per team/tree remains true.
- [ ] Untracked plans are visible, labelled "Følges ikke", with a locked
      target; restore works as in A.
- [ ] `canEdit:false` ⇒ read-only, no mutation controls, no claimed reason; no
      lead-specific controls anywhere; app-admin behavior unchanged.
- [ ] Legacy completed plan (`completedAt === null`) is visible, completed,
      without a date and never "Fullført null"; it has no edit/archive/restore
      control and B sends no `PATCH` for it (BR-23a); completed plans with a
      valid `completedAt` remain editable; `canEdit` unchanged.

**Contract and scope**
- [ ] `RoadmapItemView` gains only `completedAt` (ISO string or `null`, no
      actor); no `currentLabel`; no `today`.
- [ ] No page text claims history; "Sist oppdatert"/"Fullført" are present as
      current-state metadata only.
- [ ] No challenge/forum data or links; no `memberRef`, UID or email in the
      DOM, URL, `aria-*` or `data-*`.
- [ ] Demo fixtures untouched; no migration, backfill, index, rule or new
      collection/route method.

**Responsive and accessibility**
- [ ] At ≤ 360 px there is no horizontal page scroll in either view.
- [ ] Keyboard-only: switch, filters, disclosures, editor, archive/restore are
      operable; focus visible and returned to the trigger on close; all
      meanings are text; timeline is headings + ordered lists.

**Quality and docs**
- [ ] `pnpm` typecheck, lint, tests and build pass (actual scripts per
      `package.json`); diff inspected.
- [ ] Documentation reconciliation items below are done at closeout.

## Documentation impact
At B implementation closeout reconcile:
- `docs/ROADMAP.md` — B delivered state; nav and history decisions.
- `docs/UI-UX.md` — replace "There is no Roadmap route…" with the Roadmap page,
  nav, views, filters, accessibility.
- `docs/ARCHITECTURE.md` — Feature B surface (route, no new persistence,
  additive `completedAt`, planning-hook extraction, single archived-inclusive
  read).
- `docs/PRODUCT.md` — replace the "later, separate feature" line.
- `docs/features/team-skill-planning/SPEC.md` — a **dated reconciliation note**
  on **BR-37** recording that B v1 supersedes it: (1) two-link route-based
  navigation `Oversikt · Roadmap` instead of three tabs (Kompetanse remains a
  section of Oversikt); (2) no board view in B v1; (3) no persisted/multi-plan
  history in B v1; (4) no challenge links in B v1.
- `docs/SECURITY.md` / `docs/DEVELOPMENT.md` — modify only if implementation
  actually changes something they govern (not expected).
- `docs/DATA-MODEL.md` — no update expected (persistence unchanged).

## Risks and tradeoffs
- **No history (accepted):** replanning overwrites prior target, dates, status
  and owner; B cannot show what changed. Mitigation: explicit copy; D9
  constraints for any later feature.
- **Nav wording drift from A BR-37:** two links, not three tabs; recorded in the
  closeout note.
- **State extraction from `RoadmapPlanningScope`** touches Feature A code;
  mitigated by unchanged A tests and a behavior-preserving wrapper.
- **Two surfaces, one editor:** consistency via refetch-on-mount and no shared
  client cache; a stale tab can show old state until refresh (server rules
  protect writes).
- **Skills dependency:** a skills failure makes the page read-only (BR-8);
  chosen over partial editing to avoid inferring target/current data.
- **`canEdit:false` is ambiguous** (admin vs. inactive vs. lost membership);
  accepted, same as A.
- **Target-quarter grouping:** a long-running plan sits under its target
  quarter, not the current one; mitigated by status text and period on every
  row.
- **Client-side filtering and the 501 bound:** archived documents count toward
  the bound; the `truncated` notice covers overflow.
- **Count line** could be misread as performance; it is plan-level and labelled
  as plan counts.
- **Quarter-of-date helper** is a calendar-quarter computation on ISO strings;
  covered by tests.

## Open questions
None. OQ-1 through OQ-5 are resolved (see "Decisions resolved from open
questions").
