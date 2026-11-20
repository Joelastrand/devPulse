# DevPulse — Product (current implementation)

Source of truth: the code in `app/` and `src/features/`. This document describes what the application does today. It is
not a roadmap. Interface language is Norwegian (Bokmål); the English names below are for orientation, and the Norwegian
labels are given where the UI uses them.

## 1. Purpose and users

DevPulse is an internal application for team competence, delivery and development. It gives individuals a private place
to track their own skills, goals and development conversations, and gives teams a shared, privacy-protected view of their
competence and delivery. The product is built around the rule that team-level views must not expose individuals.

Users:

- **Person (any signed-in user):** manages own skills, goals, conversations and profile. Can see teams they belong to.
- **Team member:** sees team competence, roadmap, systems, projects, surveys and forum for their teams.
- **Team administrator (`teamadmin`):** maintains a team's competence catalog, collaborative levels, competence plans,
  projects and team settings for that team.
- **Superadmin:** creates and manages teams, the organizational roles, the skill-tree catalog and the superadmin registry.
  Holds team-admin rights on every team. Superadmin status does not grant access to raw individual data.

## 2. Feature inventory

### Hjem (signed-in home, `/`)

A compact personal dashboard. Every value comes from an existing read the viewer may already make; no metric is derived
beyond counting and ordering. Each section loads and fails on its own.

- **Dette er viktig nå:** at most three items. The next open development conversation (with a link to it), and open
  tasks that are overdue or due within seven days, with a text label (`Forfalt`, `Forfaller`). Undated tasks marked high
  priority appear with a `Høy prioritet` label. When every source loaded and nothing qualifies, a single calm message is
  shown. A failed source is shown as a read error, never as "nothing to do".
- **Min utvikling:** three counts with a link each: open-status goals (`/me/goals`), open conversations
  (`/me/conversations`) and open tasks (`/tasks`). A failed or loading read shows no number.
- **Mine team:** every team the viewer is a member of, with its relationship label and a link to its overview. A link to
  `/teams` appears only with more than three teams. Teams without access are requested on `/teams`, not on Home.
- **Siste nytt fra teamet:** for the first member team only, named explicitly. It shows the date of the latest published
  survey and a link to its results. It never shows values. A suppressed latest survey is described as having too few
  answers. The full trend chart is on the team results page, not on Home.

Home no longer shows the large trend chart, the four navigation cards, the team illustration, the name greeting, or the
generic "Neste steg" panel. The sidebar remains the navigation to Mål, Ferdigheter, Samtaler and Team.

**Home V2 layout:** a green-tinted priority surface; three metric cards under a plain section heading (the first card has a
leading accent); a team list and a team update card. A decorative wave sits behind the content on wide screens only, and
card waves are hidden from assistive technology. Every colour is a semantic token, so light and dark mode follow the theme.

**Shell:** there is no desktop top bar. Sign-out (`Logg ut`) and `Min profil` sit in the sidebar `Konto` group. On mobile
the same group is in the Meny drawer, next to a compact top bar that opens the drawer.

### Accounts and profile

- Sign up and sign in with Firebase Auth (email, verified e-mail required for admin status and erasure).
- Display name on `/me/profile`.
- **Account erasure** on `/me/erasure`: self-service, irreversible removal of a person's data, with a recent sign-in
  required. Code is complete; operational deployment is held (see `KNOWN-LIMITATIONS.md`).

### Personal development (`Min utvikling`)

- **Ferdigheter** (`/me/skills`): self-assessment against the skill-tree catalog, and a personal radar of the person's own
  levels. Unassessed skills are not drawn as zero. Radar needs at least three assessed skills.
- **Mål** (`/me/goals`): private development goals with a title and optional target date. Owner-only.
- **Samtaler** (`/me/conversations`): development conversations owned by one person and private to them. A conversation has
  no team. The owner may invite one colleague who shares at least one active team with them. The participant sees content only
  after explicitly accepting. Either side can end access, and access also ends when the shared team no longer holds for both.
  Choosing the colleague in the UI is not available yet (colleague picker, A2.2).
- **Personal role workspace:** the person's own responsibilities and achievements, and their formal organizational role
  (read-only, owner-only). These records are never aggregated into team or organizational views.

### Teams

- **Team list** (`/teams`, "Mine team"): the person's own teams first, then other active teams they can see under "Andre team". Non-members can request access; a team administrator
  approves or rejects.
- **Team overview** (`/teams/[teamId]`): member roster (names only), current survey, results link and team activity.
- **Teamkompetanse** (`/teams/[teamId]/competence`): the one team competence page. It shows a summary of the calculated
  levels that are visible (count, highest and lowest; suppressed or missing areas are never counted or treated as zero),
  the radar, and one section for `Nivå per område` with a bar-chart or table view and sorting by name or level. The radar
  and bar chart draw the same selected areas (at most eight when more are eligible), and the table lists every area. The
  section and view choice are local, per-user, per-team preferences. Detail, suppression and consent rules are unchanged.
  - Canonical team competence catalog: named skills with four-level criteria, managed by team administrators.
  - Individual self-assessment per skill, shared only if the person opts in.
  - **Automatisk profil:** team level per skill, computed from at least **three** opted-in contributors. Skills below that
    show "insufficient data".
  - **Felles vurdering:** the agreed level per skill, set by a team administrator.
  - Radar of the team profile, and a supporting competence list.
  - Team skill needs and categorical coverage per skill tree, shown in the team subpages. Its privacy defects are open;
    see `KNOWN-LIMITATIONS.md` §1.1.
- **Kompetanseplan** (`/teams/[teamId]/competence-plan`): team development plans with their own title, priority, target
  stage and dated milestones. Plans are independent of the competence catalog: they do not need individual assessments,
  sharing consent or a radar profile. Creating and editing needs superadmin or team-admin rights. The page header holds the
  single primary action (`Ny kompetanseplan`); the overview shows metrics, then next steps, then the 3/6-month timeline.
  Plan details are a collapsible section that is open by default.
- **Roadmap** (`/teams/[teamId]/roadmap`): the team project plan (`Prosjektplan`) and member participation. The page renders
  only `TeamProjectRoadmap`; the competency-area roadmap items (`/api/teams/[teamId]/roadmap-items`) are not shown on this
  route. Project and participation writes are restricted by their server operations. The team project plan can be viewed
  as a `Tidslinje` (Gantt) or a `Liste`. Both views use the same status filter and the same loaded projects. Lead-only
  edit and archive actions sit behind one `Flere handlinger` trigger. The chosen view is a local, per-user, per-team
  preference and holds no project data.
- **Systemoversikt** (`/teams/[teamId]/systems`): team systems with seven attributes (availability, deployability,
  maintainability, observability, reliability, security, testability). Any genuine team member can edit. The page shows
  a summary, then the search, filters and sort. `Oversikt` lists each system with its knowledge-risk band, follow-up
  need and quality attributes as separate fields; `Detaljert tabell` keeps every column. Both views use the same filtered
  and sorted list. Sorting orders only the loaded systems: by name, by the existing knowledge-risk band order, or with
  follow-up needs first. The view choice is a local, per-user, per-team preference. Search, filters and sort are in the
  URL, and the default list has no query string.
- **Team projects:** planned and completed delivery projects, with planned member participation. Writes need team-admin
  rights.
- **Surveys** (`/teams/[teamId]/surveys`, admin workspace): create, schedule, open, close and duplicate pulse surveys.
  Responses are anonymous and encrypted. Results show only when the survey's own minimum response count is reached.
- **Results** (`/teams/[teamId]/results`): survey history, trends and the competence ladder, reached from the overview.
  Order on the page: the ongoing survey (when there is one, in a panel), the latest closed survey's title and response
  count, a summary of its three dimension means with the change from the previous published survey, the trend chart
  (`Utvikling over tid`), and the `Siste undersøkelser` history table. The chart is hidden from assistive technology, so it
  has a text summary (how many surveys have a visible result) and a control that opens the history table with every
  authorized value. The history table is collapsed by default; a saved choice is kept. When expanded it shows the five most
  recent surveys in date order, with a `Vis alle (N)` / `Vis færre` control; this limits display only and never the data. `Spørreundersøkelser` (per-question
  results for surveys with their own questions) is collapsed by default; its error state stays visible. A trend with fewer
  than two visible results is described in text as having no development yet. Suppressed results are never shown as
  zero, and the chart leaves a gap for them. The section and view choices are local, per-user, per-team preferences.
- **Challenges:** members submit anonymous free-text challenges. Team admins resolve or archive them.
- **Forum:** threads and replies with authors. Visible only when `FEATURE_FORUM_ENABLED=true`.
- **Team settings** (`/teams/[teamId]/settings`): team visibility (`private` by default, or `public`) and related settings.
- **Public team page** (`/public/teams/[teamId]`): shows a team only when its visibility is `public`.

### Surveys for anonymous participation

- `/survey/[surveyId]` is reached by link only. `public` surveys are answered anonymously. `authenticated` surveys require
  sign-in, and the system records only that a person has answered, not what they answered.

### Administration (superadmin)

- `/admin/teams`: create and manage teams, members, invitations, access requests, survey administration and challenges. The team list is searchable and filterable by status. The Members tab has a name and e-mail search and compact rows, with team-admin status badges and an actions disclosure. Removal asks for confirmation. The Roles tab lists members in compact rows with search and an inline role editor; an organizational role is a job title and grants no DevPulse access. The Invitations tab has the invite form, pending invitations (cancel) and pending access requests (approve or reject) as separate sections. The Surveys tab lists current and archived surveys with lifecycle badges, search and a status filter, and a copy-link action. The Challenges tab shows open challenges by default, with search and a status filter. Resolve is the primary action for open challenges, and archive and delete are in a menu. The Kompetanse tab shows counts of tracked, untracked and final-stage areas, with each tracked area's current stage and progress bar. The stage timeline and stage controls are in "Vis detaljer". Untracked areas are listed compactly with search.
- `/admin/roles`: organizational role definitions and assignments. An assignment grants no application permission. An administrator may assign, change or remove their own organizational role, the same as for any other person.
- `/admin/skills`: the skill-tree catalog (org-wide progressions) and an overview of team progress. Not in the sidebar.
- `/admin/superadmins`: grant and revoke superadmin status. The last active superadmin cannot be revoked.

## 3. Key workflows

1. **Sign in, pick a team:** `/` redirects signed-in users to the shell. Exactly one team membership sends `/results` to that
   team, otherwise to `/teams`.
2. **Assess own skills:** `/me/skills` → assess skills → optionally opt in to sharing on the team competence page.
3. **Team competence review:** `/teams/[teamId]/competence` → automatic profile (≥ 3 contributors per skill) and agreed
   levels → plan development in the Kompetanseplan.
4. **Run a pulse survey:** administrator creates a survey with a minimum response count → opens it (one open survey per
   team) → members answer → results appear once the threshold is reached → administrator closes it.
5. **Start a development conversation:** owner creates a conversation → optionally invites a colleague who shares an active team → the
   invitee accepts before seeing content.
6. **Erase account:** `/me/erasure` after a recent sign-in. Irreversible.

## 4. Known product limitations

Recorded in [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md). Not a feature roadmap.

## 5. Non-goals as the implementation shows them

- No individual scores, rankings or performance ratings are shown to other people, including team administrators and
  superadmins. The only individual-to-team bridge is the consent-gated automatic profile, which is a team level.
- No raw survey responses, free text or challenge content are exposed to any role.
- Organizational roles do not carry skill expectations and do not grant permissions.
- No e-mail-based identity: uids are the only identity key for authorization.
