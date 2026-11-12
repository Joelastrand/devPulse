# DevPulse — Routes

Source of truth: `app/` (Next.js App Router) and the navigation configuration in `src/components/nav/AppShell.tsx`,
`src/features/teams/components/TeamRouteNav.tsx` and `src/components/nav/PersonalNav.tsx`. Route groups are
`(public)`, `(survey)` and `(app)`; the group names do not appear in URLs.

## 1. Public pages

| Route | File | Access | Notes |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` | Anyone | Signed out: landing page with the public top bar. Signed in: the authenticated home (`AuthenticatedHome`) in the app shell. Fails closed to the signed-out view until auth state is known |
| `/sign-in` | `app/(public)/sign-in/page.tsx` | Anyone | Firebase Auth sign-in |
| `/sign-up` | `app/(public)/sign-up/page.tsx` | Anyone | Firebase Auth sign-up |
| `/public/teams/[teamId]` | `app/(public)/public/teams/[teamId]/page.tsx` | Anyone | Only for teams whose visibility is `public`; backed by `GET /api/public/teams/[teamId]` |
| `/survey/[surveyId]` | `app/(survey)/survey/[surveyId]/page.tsx` | Anyone with the link; `authenticated`-mode surveys require sign-in | Survey participation. Only generated links lead here; there is no public survey directory |

## 2. Authenticated pages (app shell)

All pages under `app/(app)/` render inside `AppShell` and `TeamContextProvider`. Data is loaded client-side through
gateways that call the API routes; the server decides access.

### Sidebar (signed in)

Built in `navGroupsFor()` in `AppShell.tsx`:

| Group | Label | Route | Visible to |
| --- | --- | --- | --- |
| workspace | Hjem | `/` | Signed in |
| workspace | Team | `/teams` | Signed in |
| personal ("Min utvikling") | Ferdigheter | `/me/skills` | Signed in |
| personal | Mål | `/me/goals` | Signed in |
| personal | Samtaler | `/me/conversations` | Signed in |
| administration ("Administrasjon") | Team | `/admin/teams` | Superadmins only |
| administration | Roller | `/admin/roles` | Superadmins only |
| administration | Superadministratorer | `/admin/superadmins` | Superadmins only |
| account ("Konto") | Min profil | `/me/profile` | Signed in |
| account | Slett kontoen din | `/me/erasure` | Signed in |

Signed-out navigation shows Hjem, Logg inn and Opprett konto (`PublicHeader`). Sign-out lives only in the account menu.

### Personal pages

| Route | File | Purpose |
| --- | --- | --- |
| `/me/skills` | `app/(app)/me/skills/page.tsx` | Own skill self-assessment and personal radar |
| `/me/goals` | `app/(app)/me/goals/page.tsx` | Personal development goals (owner-only) |
| `/me/conversations` | `app/(app)/me/conversations/page.tsx` | Development conversations list |
| `/me/conversations/[conversationId]` | `app/(app)/me/conversations/[conversationId]/page.tsx` | One conversation (owner or accepted participant) |
| `/me/profile` | `app/(app)/me/profile/page.tsx` | Display name |
| `/me/erasure` | `app/(app)/me/erasure/page.tsx` | Start account erasure (requires recent sign-in) |

### Team pages

`/teams` (`app/(app)/teams/page.tsx`) lists teams the person can see, with a request-access action for non-members.
`/teams/[teamId]` is the team overview. Its tab bar (`TeamRouteNav`) shows five tabs, in this order:

| Tab label | Route | File |
| --- | --- | --- |
| Oversikt | `/teams/[teamId]` | `app/(app)/teams/[teamId]/page.tsx` |
| Roadmap | `/teams/[teamId]/roadmap` | `.../roadmap/page.tsx` |
| Kompetanseplan | `/teams/[teamId]/competence-plan` | `.../competence-plan/page.tsx` |
| Teamkompetanse | `/teams/[teamId]/competence` | `.../competence/page.tsx` |
| Systemoversikt | `/teams/[teamId]/systems` | `.../systems/page.tsx` |

Pages reached from the overview or from elsewhere, not from the tab bar:

| Route | File | Purpose |
| --- | --- | --- |
| `/teams/[teamId]/results` | `.../results/page.tsx` | Survey history, trends and the competence ladder (linked from Oversikt, "Se resultater og trender") |
| `/teams/[teamId]/surveys` | `.../surveys/page.tsx` | Team survey workspace for administrators (linked from team administration) |
| `/teams/[teamId]/settings` | `.../settings/page.tsx` | Team settings, including team visibility |
| `/teams/[teamId]/forum/[threadId]` | `.../forum/[threadId]/page.tsx` | Forum thread. Returns `notFound` unless `FEATURE_FORUM_ENABLED=true` |

Retired and redirecting:

| Route | Behaviour |
| --- | --- |
| `/teams/[teamId]/skills` | Server redirect to `/teams/[teamId]/competence` (`app/(app)/teams/[teamId]/skills/page.tsx`) |
| `/results` | Client redirect (`ResultsRedirect`): to `/teams/[teamId]` if the person has exactly one team membership, otherwise to `/teams` |

Access: team pages require a genuine membership of an active team. Admin actions on the competence and plan pages are
checked again in the server operation (superadmin or `teamadmin`).

### Administrative pages (superadmin only)

| Route | File | Purpose |
| --- | --- | --- |
| `/admin/teams` | `app/(app)/admin/teams/page.tsx` | Team list and creation |
| `/admin/teams/[teamId]` | `app/(app)/admin/teams/[teamId]/page.tsx` | Team administration: members, invitations, access requests, surveys, challenges, skills |
| `/admin/roles` | `app/(app)/admin/roles/page.tsx` | Organizational role definitions and assignments |
| `/admin/skills` | `app/(app)/admin/skills/page.tsx` | Skill tree catalog (`skillTrees`). Not in the sidebar; linked from `/admin/teams` |
| `/admin/superadmins` | `app/(app)/admin/superadmins/page.tsx` | Superadmin registry |

## 3. API routes

All routes are under `app/api/`. Each handler is a thin delegate: it reads the path, query and bearer token, then calls one
feature server operation. Authorization lives in that operation.

| Group | Routes | Caller |
| --- | --- | --- |
| Session | `GET /api/me` (`isAdmin` only), `GET/PUT /api/me/profile` | Signed in |
| Personal | `/api/me/skills`, `/api/me/skills/[treeId]`, `/api/me/goals`, `/api/me/goals/[goalId]`, `/api/me/responsibilities`, `/api/me/responsibilities/[recordId]`, `/api/me/achievements`, `/api/me/achievements/[recordId]`, `/api/me/role-assignment` | Owner only |
| Conversations | `/api/me/conversations`, `/api/me/conversations/[conversationId]`, `.../participation`, `.../participation/accept`, `.../participant-notes`, `.../evidence-sources`, `.../selectable-members`, `/api/me/conversations/create-options` | Owner, or accepted participant where noted |
| Erasure | `POST /api/me/erasure` | Signed in, recent sign-in required |
| Roles (reference) | `GET /api/roles` | Signed in |
| Surveys (public) | `/api/surveys/[surveyId]`, `/api/surveys/[surveyId]/responses` | Anyone with the link, subject to mode |
| Public teams | `GET /api/public/teams/[teamId]` | Anyone (public teams only) |
| Team member | `/api/teams`, `/api/teams/[teamId]/members`, `.../assignable-members`, `.../access-requests`, `.../visibility`, `.../current-survey`, `.../results`, `.../surveys/[surveyId]/results`, `.../roadmap-items`, `.../roadmap-items/[treeId]`, `.../skills`, `.../skills/[treeId]`, `.../skill-needs`, `.../skill-needs/[treeId]`, `.../skill-contribution`, `.../skill-coverage`, `.../team-skills`, `.../team-skills/[skillId]`, `.../team-skills/[skillId]/level`, `.../team-skills/[skillId]/manual`, `.../team-skills/aggregate`, `.../team-skills/manual`, `.../competence-plans`, `.../competence-plans/[planId]`, `.../projects`, `.../projects/[projectId]/...`, `.../systems`, `.../systems/[systemId]`, `.../challenges`, `.../forum/threads/...` | Team members, with per-route rules (see `docs/SECURITY.md`) |
| Team admin | `/api/teams/[teamId]/team-skills` writes, `/api/teams/[teamId]/competence-plans` writes, `.../projects` writes | Superadmin or `teamadmin` of an active team |
| Team member write | `/api/teams/[teamId]/systems` writes (`writeTeamSystem`) | Any genuine member of an active team. An app admin who is not a member cannot write |
| Superadmin | `/api/admin/teams`, `/api/admin/teams/[teamId]`, `.../members`, `.../members/[uid]`, `.../member-refs`, `.../invitations`, `.../access-requests`, `.../access-requests/[uid]`, `.../skills`, `.../skills/[treeId]`, `.../surveys`, `.../surveys/[surveyId]` (+ `open`, `close`, `draft`, `duplicate`), `.../challenges` (+ `[challengeId]`, `archive`, `resolve`), `/api/admin/teams/seed-legacy`, `/api/admin/skills`, `/api/admin/skills/[treeId]`, `/api/admin/skills/overview`, `/api/admin/roles`, `/api/admin/roles/[roleId]` (+ `archive`), `/api/admin/role-assignments/lookup`, `/api/admin/users/[uid]/role-assignment`, `/api/admin/superadmins`, `/api/admin/superadmins/[uid]` | Superadmin only |

Two team-skill API groups are easy to confuse:

- `/api/teams/[teamId]/skills` and `.../skills/[treeId]` operate on the **skill tree** catalog (`skillTrees`,
  `skillProgress`): member read and self-report of progress on a tree.
- `/api/teams/[teamId]/team-skills...` operates on the **team-owned** catalog (`teamSkills`) used by the Teamkompetanse
  page. This is the current team competence system.

## 4. Route and API hygiene

- `app/(app)/layout.tsx` wraps all authenticated pages. Unknown paths fall through to Next.js 404.
- There is no `src/app/` directory, despite the layout suggested in the earlier README.
- Retired API routes (`competence-areas`, `profile-settings`, `skill-levels`) are deleted from the tree. A repository search
  finds no remaining references to them.
