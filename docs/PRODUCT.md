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

### Accounts and profile

- Sign up and sign in with Firebase Auth (email, verified e-mail required for admin status and erasure).
- Display name on `/me/profile`.
- **Account erasure** on `/me/erasure`: self-service, irreversible removal of a person's data, with a recent sign-in
  required. Code is complete; operational deployment is held (see `KNOWN-LIMITATIONS.md`).

### Personal development (`Min utvikling`)

- **Ferdigheter** (`/me/skills`): self-assessment against the skill-tree catalog, and a personal radar of the person's own
  levels. Unassessed skills are not drawn as zero. Radar needs at least three assessed skills.
- **Mål** (`/me/goals`): private development goals with a title and optional target date. Owner-only.
- **Samtaler** (`/me/conversations`): development conversations owned by one person. The owner may invite one eligible
  team member as participant. The participant sees content only after explicitly accepting. Either side can end access.
- **Personal role workspace:** the person's own responsibilities and achievements, and their formal organizational role
  (read-only, owner-only). These records are never aggregated into team or organizational views.

### Teams

- **Team list** (`/teams`): active teams the person can see. Non-members can request access; a team administrator
  approves or rejects.
- **Team overview** (`/teams/[teamId]`): member roster (names only), current survey, results link and team activity.
- **Teamkompetanse** (`/teams/[teamId]/competence`): the one team competence page.
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
  sharing consent or a radar profile. Creating and editing needs superadmin or team-admin rights.
- **Roadmap** (`/teams/[teamId]/roadmap`): planned, active and completed items per competency area, with target, priority
  and dates. Writes are restricted by the roadmap server operations.
- **Systemoversikt** (`/teams/[teamId]/systems`): team systems with seven attributes (availability, deployability,
  maintainability, observability, reliability, security, testability). Any genuine team member can edit.
- **Team projects:** planned and completed delivery projects, with planned member participation. Writes need team-admin
  rights.
- **Surveys** (`/teams/[teamId]/surveys`, admin workspace): create, schedule, open, close and duplicate pulse surveys.
  Responses are anonymous and encrypted. Results show only when the survey's own minimum response count is reached.
- **Results** (`/teams/[teamId]/results`): survey history, trends and the competence ladder, reached from the overview.
- **Challenges:** members submit anonymous free-text challenges. Team admins resolve or archive them.
- **Forum:** threads and replies with authors. Visible only when `FEATURE_FORUM_ENABLED=true`.
- **Team settings** (`/teams/[teamId]/settings`): team visibility (`private` by default, or `public`) and related settings.
- **Public team page** (`/public/teams/[teamId]`): shows a team only when its visibility is `public`.

### Surveys for anonymous participation

- `/survey/[surveyId]` is reached by link only. `public` surveys are answered anonymously. `authenticated` surveys require
  sign-in, and the system records only that a person has answered, not what they answered.

### Administration (superadmin)

- `/admin/teams`: create and manage teams, members, invitations, access requests, survey administration and challenges.
- `/admin/roles`: organizational role definitions and assignments. An assignment grants no application permission.
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
5. **Start a development conversation:** owner creates a conversation → optionally invites an eligible team member → the
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
