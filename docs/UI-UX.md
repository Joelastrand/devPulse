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
- **Signed in**: Hjem, Team, Min profil, Logg ut
- **Signed in, app admin**: the signed-in set, plus Admin

**Updated by `docs/features/member-identity-and-team-roles/SPEC.md` (F0):**
signed-in users also get a **Min profil** link (to `/me/profile`, see
"Profile UX" below), placed right after Team and before Admin; it is never
shown to a signed-out visitor or before the first auth event.

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

### Shared primitives (added at UI-refresh closeout)

**Added at the App-Wide UI/UX Refresh closeout
(`docs/features/ui-refresh/SPEC.md` — TASK-001 through TASK-010),
documenting the conventions that shipped**, in the same format as "Forum
UX"/"Skill Tree UX" above — this section describes the as-built refresh,
not a pre-implementation direction. It extends, rather than replaces, the
"Components" list above.

- Body text renders in Geist Sans (the application's already-configured
  typeface, now actually applied); Geist Mono remains configured for future
  monospace use, unused today.
- The standard single-line text input, textarea, and simple single-select
  patterns share one visual/focus/label/error treatment
  (`src/components/ui/TextField.tsx`, `TextArea.tsx`, `Select.tsx`) — every
  migrated control keeps its own existing validation/submission behavior
  and gains `aria-invalid`/`aria-describedby` wiring to its own error
  state. A control with genuinely different semantics (`SurveyResponseForm`'s
  1–5 radio scale, the survey-creation access-mode radio group) is
  deliberately left native, not forced into these primitives.
- A calm, operational Badge primitive (`src/components/ui/Badge.tsx`)
  presents an existing status/relationship value as visible text — never
  color alone, never a gamified "chip." Shipped sites: the team
  active/disabled label (`AdminTeams`), a team's relationship
  (`TeamsOverview`), challenge status (`ChallengeList`,
  `AdminChallengeList`), and the disabled-team label in
  `OrgSkillProgressOverview`. It is not applied to the SkillTree
  stage/progression path (see "Skill Tree UX" — progression path), which
  states its positional state as plain text.
- `PageShell` gained a `"wide"` width token (`max-w-6xl`), applied only to
  `/admin/teams`, `/admin/teams/[teamId]`, and `/admin/skills` — the three
  list/section-dense admin surfaces. Every public, auth, and
  survey-participation page keeps its existing, narrower width.
  `SiteHeader`'s own outer bound matches the same `"wide"` token on every
  route, so the header remains one coherent outer shell bound.
- Exactly three creation forms sit behind an explicit `aria-expanded`
  toggle, extending `SkillTreeCorrectionForm`'s already-shipped open/close
  precedent: admin team creation, SkillTree creation, and survey creation.
  Every other form (challenge submission, Forum thread/reply creation,
  member invitation, access-request actions) stays always-visible — this
  refresh did not generalize the toggle pattern beyond those three.
- `/teams/[teamId]` groups its already-rendered sections into two
  presentation-only zones — "Resultater" and "Teamaktivitet" — with no
  change to fetch order, generation guards, or any capability computation.

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

### Member roster (F0)

**Added by `docs/features/member-identity-and-team-roles/SPEC.md`.** As-built:

- `/teams/[teamId]` shows, inside the "Teamaktivitet" zone and only to a
  caller who may view the team (member or app admin), a **"Medlemmer"**
  section that is **collapsed by default**. A single "Medlemsliste" toggle
  (`aria-expanded`/`aria-controls`, keyboard-operable) opens it; the
  roster is fetched **lazily on the first expand** only, so the page makes no
  roster request on load. Collapsing and re-expanding reuses the loaded list;
  it is not live — a page reload or the retry action refreshes it.
- It is a read-only, plain list: each row shows the member's display name,
  or **"Medlem uten navn"** when none is set (never an e-mail, `uid` or other
  fallback), plus visible text badges — **"Teamlead"** for an effective lead
  and **"Deg"** for the caller's own row (both can appear on one row). Two
  members with the same name are two rows. Rows have no links, buttons,
  menus, avatars or actions.
- It has its own loading ("Laster medlemmer…"), empty ("Ingen medlemmer å
  vise."), error (generic, with "Prøv igjen") and no-access states, and a
  failure never affects any other section. When the server reports the list
  as truncated, a notice says the list shows only the first members and is
  not complete; there is no pagination or "load more".
- Names are rendered as inert text. The UI reads only `displayName`,
  `isLead` and `isSelf` from the roster endpoint and makes no other request.

## Profile UX (F0)

**Added by `docs/features/member-identity-and-team-roles/SPEC.md`.** As-built:

- **`/me/profile`** ("Min profil", signed-in users; a signed-out visitor gets
  the usual sign-in prompt) holds one field, **"Visningsnavn"**. The help text
  says the name is shown to other members of teams the user belongs to and to
  administrators (not their e-mail address), need not be unique, and can be
  changed or removed at any time — it promises neither secrecy nor anonymity.
- A user with no name sees an **empty field** (never pre-filled from e-mail)
  and a note that others will see "Medlem uten navn". "Lagre" saves; afterwards
  the field and the "Nåværende visningsnavn" line show the **server's
  canonical (normalised) value**, not the raw input. "Fjern visningsnavn"
  (shown only while a name exists, no confirmation dialog) removes only the
  name and states that the account and team memberships are unaffected.
- The client only rejects an empty value; length and character rules are the
  server's (code-point counting), with plain-Norwegian messages and no
  `maxLength` attribute. Save and remove block each other while pending, no
  optimistic state is shown, and there are loading, retry, generic-error and
  session-expired states. Labels, `aria-describedby`, `role="alert"`/
  `"status"` and text (never colour alone) carry the states.

## Forum UX

**Added at Phase 6 closeout (`docs/features/team-forum/SPEC.md` —
TASK-005/TASK-006), documenting the conventions that shipped**, in the same
format as "Teams UX"/"Results UX" above — this section describes the
as-built Team Forum feature, not a pre-implementation direction.

- `/teams/[teamId]` gains a "Forum" section, visible to an authorized
  member/admin alongside the existing results/current-survey/challenges
  sections: a newest-first thread list (title, `authorTag`, date) and a
  "start a new thread" form (title + body). Its own fetch/mutation failures
  are isolated from those other sections — a forum read failure never hides
  results/current-survey/challenges, and vice versa.
- A new `/teams/[teamId]/forum/[threadId]` route (not a client-side panel)
  shows one thread's title, body, `authorTag`, and every one of its replies
  in chronological order, plus a reply-submission form — a real route so a
  thread's own author keeps a durable link to it even after it ages out of
  the list's 200-newest window.
- `authorTag` is shown with a short Norwegian framing prefix ("Medlem
  {authorTag}"), never bare and never styled to resemble a real name or
  email — it identifies authorship *continuity* (recognizing two posts
  share an author) without implying real-world identity.
- A deleted reply renders a fixed, non-identifying placeholder ("Innlegget
  er fjernet") at its original position — conveyed by text, never by color
  or an icon alone, and never simply omitted from the list.
- A thread/reply's own author, or an app admin, sees a "Slett"-style delete
  action; no one else does. Delete always requires an explicit
  confirm/cancel step before it executes — for a thread, the confirmation
  copy states plainly that every reply is also permanently removed, since
  that is literally true (a thread delete is a hard delete, not a
  visibility change). Deleting a reply that's already been removed (e.g. a
  retried request) succeeds silently rather than showing an error — the
  caller's desired end state ("this content is gone") already holds.
  Repeated delete affordances on one page (each reply's own) carry a
  distinguishing accessible name (its posted date) so keyboard/
  screen-reader users can tell rows apart; the visible button label itself
  stays identical across rows.
- Once a thread reports it has reached its reply capacity, the reply form
  is replaced by a disabled, explanatory message rather than continuing to
  accept input that the server will reject — discovered reactively (after
  an actual submission attempt), never pre-computed client-side from a
  locally counted reply list.
- After a successful create-thread submission, the caller is taken to the
  new thread's detail view (focus moves to a success confirmation first, in
  case navigation is slow); after a successful reply, the reply list
  refreshes from the server (never an optimistic local insert) and the
  reply form stays available for another reply.
- A create-thread/create-reply/delete response that resolves after the
  caller has signed out, or after navigating to a different team or thread,
  is discarded rather than applied to the now-stale view — the same
  generation-guard pattern every other mutating section in this application
  uses.
- Thread/reply content is rendered strictly as literal text (ordinary JSX
  interpolation) on every surface — never `dangerouslySetInnerHTML`, never
  passed through a Markdown/HTML parser. Text that looks like HTML or a
  script tag renders as inert, visible characters, never as markup or a
  side effect.
- A cross-team, deleted, or never-existed `threadId` renders the same
  generic "not found" state in every case — never a distinguishing message
  that would let a caller infer which of those three actually occurred.

## Skill Tree UX (Kompetanseområder)

**Added at Phase 7 closeout (`docs/features/team-skill-tree/SPEC.md` —
TASK-005/TASK-006/TASK-007), documenting the conventions that shipped**, in
the same format as "Forum UX"/"Teams UX" above — this section describes the
as-built Team Skill Tree feature, not a pre-implementation direction. Every
rendered heading/label uses the Norwegian "Kompetanseområder" ("skill/
capability areas") as natural-language UI copy; the underlying technical
concept, every route, file, type, and Firestore field is named "skill," not
"capability" — natural-language copy is not a competing technical
identifier (see `docs/features/team-skill-tree/SPEC.md` — Owner decision 4).

- **`/admin/skills`** (app-admin-only; a non-admin sees the generic
  no-permission state): a creation form (tree name + a dynamic list of
  2-20 stage-label inputs, with add/remove-row controls) and a read-only
  catalog of existing trees, bounded to the 500 oldest-created — the
  catalog never claims to show more than that bound (no "showing all
  trees"/total-count text anywhere). Each catalog entry offers a
  correction action: a form pre-filled with the tree's current name/
  labels, with **no add/remove-row controls at all** — its row count is
  fixed to the existing tree's node count, so the UI itself cannot submit
  a different stage count.
- **`/admin/skills`'s read-only cross-team overview** (added at Phase 9
  closeout, `docs/features/org-skill-progress-overview/SPEC.md`): a new
  section below the existing catalog, additive and independently loaded —
  a failure loading it never hides or blocks the creation form/catalog
  above it, and vice versa. For every SkillTree at least one team tracks,
  its name as a sub-heading followed by a semantic list (`<ul>`/`<li>`) of
  its tracking teams — never a canvas/SVG diagram: each team's name, a
  "Deaktivert" text suffix for a disabled team (never color alone, matching
  `AdminTeams.tsx`'s existing convention), and its current stage's label or
  the same "Ikke startet" copy the read-only team view already uses for
  "not started." Observation-only — no button, form, or link that starts/
  stops tracking or sets a stage exists anywhere in this section, even
  though its viewer (an app admin) already holds that permission elsewhere
  on the same page. Tree and team ordering come entirely from the server
  response (trees oldest-created-first, teams alphabetical); nothing here
  is re-sorted client-side.
- **`/admin/teams/[teamId]`** gains a "Kompetanseområder" section
  (app-admin-only): a picker to start tracking any catalog tree not yet
  tracked by this team, and, for each already-tracked tree, its ordered
  stage list with the current stage marked plus controls to set/advance
  the stage (forward or backward) or stop tracking. The start-tracking
  picker is hidden/disabled for a disabled team; the set-stage/
  stop-tracking controls for an already-tracked tree remain available
  regardless of team status, matching the server contract exactly. A
  fresh render of this page reconstructs each tree's actual persisted
  stage from the same team-scoped read the team-facing view uses — it
  does not merely reflect this browser session's own prior actions.
- **`/teams/[teamId]`** gains a read-only "Kompetanseområder" section,
  visible to an authorized member/admin: for each tracked tree, its name
  and full ordered stage list, rendered as a semantic ordered list
  (`<ol>`/`<li>`) — **never** a graphical/canvas/SVG diagram. The current
  stage is marked by both visible text ("Nåværende steg") and
  `aria-current="step"` together, never by color alone. A tree with no
  stage set yet shows a distinct "Ikke startet" state rather than leaving
  the marker absent with no explanation. A non-member sees no skill
  content or data. **Extended by `docs/features/skill-progress-self-report/
  SPEC.md` (Phase 8, TASK-002, corrected by its later "permission-UI
  correction"):** this section is no longer strictly read-only for a viewer
  who may actually use the control — each already-tracked tree also gets a
  "Sett stadium" select plus a "Lagre" button, but only for a viewer the
  server reports as `canReportProgress: true` (a genuine, fresh-read team
  member on a currently active team, independent of `authorizeTeamAccess`'s
  broader read result). An app-admin-only viewer with no real membership, or
  a genuine member of a disabled team, sees the read-only stage list without
  the mutation control at all — never merely a disabled one. A successful
  report re-fetches through the same team-scoped read this section already
  used — never an optimistic/local-only update — so a fresh page load always
  reconstructs the persisted stage, and the currently-shown capability, the
  same way, whether the value was last set by a member or an admin.
- **Progression path (as-built, `docs/features/gamified-skill-tree/SPEC.md`).**
  Supersedes the plain `<ol>` stage lists described for `/teams/[teamId]`
  and `/admin/teams/[teamId]` above: both tracked-tree surfaces render one
  shared, presentational `SkillProgressPath` (vertical at every breakpoint;
  CSS-drawn numbered markers and rail, no icon, image, canvas/SVG, animation
  or dependency). It is a semantic `<ol>` named by the tree name, with the
  stage marker/rail `aria-hidden`. Every stage states its state as visible text —
  "Tidligere steg", "Nåværende steg", "Kommende steg" — and only the current
  stage's `<li>` has `aria-current="step"`. State is purely positional,
  derived at render time from the ordered nodes and the team's
  `currentNodeId`; "Tidligere steg" means only "before the team's current
  step", never a completion claim (no history is stored, and moving the
  stage backward simply re-derives). `currentNodeId: null` shows "Ikke
  startet" with every stage "Kommende steg"; a non-null id matching no stage
  is a defensive fallback (all "Kommende steg", no summary). A summary line
  reads "Teamets nåværende steg: <label> (steg N av M)". Nodes are never
  controls; the existing select/buttons remain the only controls, and
  `canReportProgress`/admin/`teamDisabled` gating is unchanged. The
  cross-team `OrgSkillProgressOverview` and the `/admin/skills`
  catalog/creation/correction surfaces are intentionally unchanged
  (compact text and authoring respectively). The path is team-level only —
  no points, XP, achievements, streaks, rankings or individual framing.
- A tree's name and every stage's label are untrusted, admin-authored
  display strings, rendered as ordinary text on every surface — never
  `dangerouslySetInnerHTML`, never passed through an HTML/Markdown parser.
  Text that looks like HTML or a script tag renders as inert, visible
  characters everywhere this feature displays it.
- No comment, voting, reaction, free-text note, per-person *skill*
  assignment, or ranking/leaderboard control exists anywhere in this
  feature's UI — every surface shows team-level progress only, never an
  individual's. **One narrow, deliberate exception (Team Skill Planning, see
  below):** a roadmap plan may optionally name one team member as its
  responsible contact. That is planning metadata, not a skill, level or
  performance assignment; skill tracking and maturity stay team-level.

### Team skill planning (Feature A, `docs/features/team-skill-planning/SPEC.md`)

Planning lives **inside** the `/teams/[teamId]` *Kompetanseområder* section.
There is no Roadmap route, tab or navigation entry in Feature A (the dedicated
Team Roadmap is Feature B and does not exist). Team surface term:
*Kompetanseområder*; the individual surface remains *Ferdigheter*.

- Each tracked area's row shows its plan below the progress path. With no plan
  the row says "Ingen plan ennå" (and offers "Planlegg" to members). A plan
  line shows target stage, priority (text), period, owner, status and text
  indicators: "Målet er nådd" (informative only — it never changes status;
  completion is marked manually) and "Måldato passert" (overdue). Completed
  plans get a distinct completed presentation. No state relies on colour alone.
- Members of an active team get an inline, expandable create/edit form
  (target stage above the current stage only, priority, two date inputs,
  optional owner, status when editing, "Lagre"/"Avbryt", and
  "Arkiver"/"Gjenopprett"). When the server says the viewer cannot edit
  (`canEdit: false`) the controls are absent, not disabled. No optimistic
  update: a successful save refetches.
- **Owner** is an optional "Ansvarlig" select fed by the assignable-members
  endpoint: "Ikke tildelt", names (duplicates get a presentation ordinal),
  "Medlem uten navn", "Deg", and "Ansvarlig er ikke lenger tilgjengelig" when
  the reference no longer resolves. Help copy states it is a planning marker,
  not an assessment of anyone. No UID/e-mail is shown; there is no filter,
  sort, count or summary by owner.
- **Plans for areas the team no longer tracks** appear in a dedicated section
  at the bottom ("Plan for område teamet ikke lenger følger"). Their target
  is shown read-only (it cannot be changed while untracked); other fields stay
  editable and archive/restore remain available. Restarting tracking returns
  the plan to its normal area row.
- Archived plans are hidden by default and revealed by the existing
  "Vis arkiverte" control, which stays reachable even when the team tracks
  zero areas.
- The roadmap read fails independently of the other sections; text and names
  are rendered as inert text; fields stack on narrow screens.
- Every admin creation/correction/tracking control, and the boundary
  validation errors the creation form's dynamic add/remove-stage-row
  controls can trigger, are keyboard-operable with a visible focus state
  and an associated, accessible error message.

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
- `/admin/teams/[teamId]` member rows (F0, `docs/features/member-identity-and-
  team-roles/SPEC.md`) show the member's display name as the primary line
  (**"Medlem uten navn"** if none) with the e-mail as a separate admin
  identity line, a **"Teamlead"** text marker for the **stored** lead role (on
  a disabled team it reads "Teamlead (lagret rolle, ikke aktiv mens teamet er
  deaktivert)"), and a per-row toggle "Gjør til teamlead" / "Gjør til vanlig
  medlem". A team can have several leads and each row is administered
  independently; nothing replaces or demotes another lead. On a disabled team
  the promote action is disabled in the UI (a hint — the server rejects it
  regardless) while demotion and removal stay available. The row's two
  mutations block each other while one is pending, errors (including
  "team disabled" and "no longer a member") appear in the row, and the list is
  re-read from the server after a change. A short note states that lead is a
  role on the membership that gives no extra access yet; the UI promises no
  capability.
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
  [teamId]`, `/admin/teams`, `/admin/teams/[teamId]`, `/admin/skills`)
  works at common phone widths as well as desktop — navigation collapses
  sensibly, no horizontal scrolling of the page itself, tables/charts
  scroll within their own container if they must. `PageShell`'s `"wide"`
  token (`docs/features/ui-refresh/SPEC.md`) is a maximum, not a fixed
  width — the three admin surfaces that use it still shrink below it on a
  narrower viewport.

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
  Phases 4–7).
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
