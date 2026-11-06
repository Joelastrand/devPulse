# Tasks — Superadmin, Teamadmin and Team Visibility

Status values: `Ready` / `In Progress` / `Done`. `Done` means implemented and covered by the automated checks recorded
below. It does not mean the feature is accepted (see Acceptance).

## TA-001 Domain types and authorization policy — Done
- `MembershipRole` is `teamadmin | member`; `membershipRoleOf` classifies only exact `teamadmin` (legacy `lead` ⇒ member).
- `domain/team-authority.ts`: `canAdministerTeam`, `canAdministerTeamScope`, `effectiveTeamVisibility`, `isTeamVisibility`.
- `resolveTeamRole` returns `admin | teamadmin | member | denied` plus `canAdminister` (role and active status).

## TA-002 Persistence and API authorization — Done
- Team-admin writes (projects, participations, competence catalog and plans, skill needs) re-check `canAdministerTeam`
  inside their transactions on an `active` team. `canEdit`/`canManageNeeds` derive from the same rule.

## TA-003 Superadmin teamadmin assignment — Done
- `setTeamMemberRole` accepts `teamadmin | member` behind `requireAppAdmin`. Other roles are rejected.

## TA-004 `/admin/teams` management UI — Done (component-tested)
- The member role control sets `teamadmin` (Norwegian copy). The visibility panel is mounted on the admin team page.
- Not browser-tested (see TA-010).

## TA-005 Team visibility settings — Done
- `setTeamVisibility` / `readTeamVisibilitySettings`; routes `GET|PUT /api/teams/[teamId]/visibility`;
  `TeamVisibilitySettings` with confirmation before a team becomes public. Mounted on `/teams/[teamId]` and `/admin/teams/[teamId]`.

## TA-006 Public read endpoints and projections — Done
- `getPublicTeam`; route `GET /api/public/teams/[teamId]` returns `{team: {teamId, name}}` only; `no-store`.

## TA-007 Public team page rendering — Done (component-tested)
- `/public/teams/[teamId]` (the `(public)` group) renders only the projection and sends no token.

## TA-008 Remaining lead-only guard migration — Done; systems and roadmap intentionally unchanged
- Systems and roadmap writes remain member-writable as their SPECs define. Recorded as an open decision in SPEC.md.
- Membership and invitation management stays superadmin-only (open decision).

## TA-009 Security, erasure and regression tests — Done
- Domain policy tests, visibility decision and write tests, public projection tests, component tests for the confirmation
  flow, fixture migration `lead` → `teamadmin`, and a deliberate update of the C2 scope guard (TA-SI-4).
- Erasure: `visibility` stores no actor uid (TA-SI-8). Erasure suites pass unchanged.

## TA-010 Full verification — Done for automated checks; browser checks NOT run
Recorded on this working tree (uncommitted, on top of existing uncommitted changes):
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0, 0 errors (existing warnings only).
- `pnpm test` — exit 0: 575 test files passed, 1 skipped; 9843 tests passed, 2 skipped.
- `pnpm build` — exit 0; `/api/public/teams/[teamId]`, `/api/teams/[teamId]/visibility` and `/public/teams/[teamId]` built.
- NOT run: Playwright/browser checks of `/admin/teams`, the team settings panel and the public page; a live Firestore
  emulator run of the transactions.

## Acceptance

Not accepted. Open: owner decisions in SPEC.md ("Open decisions"); browser verification; the legacy-lead migration
(not executed, owner approval required; existing leads currently have no team-admin rights).
