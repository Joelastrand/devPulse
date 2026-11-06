# Team Experience Redesign — Verification

Specification: [SPEC.md](./SPEC.md) · Tasks: [TASKS.md](./TASKS.md)

## Status

Implementation in progress. TASK-001 is partially implemented; no task is Done. Quality gate rows reflect runs made on the TASK-001 change set only.

Status values: `passed`, `failed`, `not_verified`, `blocked`.

## Reference images

All six images were opened and inspected during planning (2026-11-05):

| Reference | File | Target |
|---|---|---|
| 17 | `docs/design/references/17-system-overview-form.png` | Existing System Overview form (context only) |
| 18 | `docs/design/references/18-system-overview-.png.png` | Team Oversikt |
| 19 | `docs/design/references/19-system-overview-roadmap.png.png` | Team Roadmap |
| 20 | `docs/design/references/20-system-overview-competense-plan.png.png` | Kompetanseplan |
| 21 | `docs/design/references/21-system-overview-team-competense.png.png` | Teamkompetanse |
| 22 | `docs/design/references/22-me-skills.png.png` | `/me/skills` |

Known deviations, to be confirmed in the visual comparison:
- **Ref 21:** shows `12 medlemmer har bidratt`, numeric averages (3.8/4.0), a radar series of team averages and a trend chart. These are **not reproduced** (BR-26, D2).
- **Ref 22:** shows a `Teamgjennomsnitt (Demoteam)` radar series and a trend chart. The team-average series is **not reproduced** (D2). The trend chart is **not reproduced** (SECURITY invariant 35).
- **Ref 22:** the sharing toggle is shown ON. The default is **OFF** until D1 is decided (BR-24).
- **Ref 18–20:** demo values (`12 medlemmer`, `5 systemer`, sample projects) are illustrative and are replaced by real data.

## Requirement traceability

| Requirement | Module (planned) | Test (planned) | Browser | Visual ref | Status |
|---|---|---|---|---|---|
| BR-1, BR-2 Oversikt counts | `src/features/teams/components/TeamOverview*` | TASK-008 tests | — | 18 | not_verified |
| BR-3, BR-4 Neste steg, states | same | TASK-008 tests | — | 18 | not_verified |
| BR-5 old-to-new mapping | SPEC appendix | — | — | — | not_verified |
| BR-6–BR-8 project CRUD, participation | `src/features/team-projects/server` | TASK-003/004 tests | — | 19 | not_verified |
| BR-9 effective status | `src/features/team-projects/domain` | TASK-002 tests | — | 19 | not_verified |
| BR-10, BR-11 Gantt 3/6 months, mobile | `src/features/team-projects/components` | TASK-002/005 tests | Playwright (planned) | 19 | not_verified |
| BR-12, BR-13 participation view | same | TASK-004/005 tests | — | 19 | not_verified |
| BR-14 legacy roadmap not reinterpreted | `src/features/roadmap` | TASK-003 tests | — | — | not_verified |
| BR-15–BR-17 Kompetanseplan | Kompetanseplan components | TASK-006 tests | — | 20 | not_verified |
| BR-18 catalog management | catalog server | TASK-007 tests | — | — | not_verified |
| BR-19, BR-20 My skills | `src/features/skill-profiles` | TASK-009 tests | — | 22 | not_verified |
| BR-21–BR-23 sharing control/dialog | `src/features/team-skills` (C2) | TASK-010 tests | — | 22 | not_verified |
| BR-24 default-on | — | blocked on D1 | — | 22 | blocked |
| BR-25 categorical coverage | `get-team-skill-coverage` | TASK-011 tests | — | 21 | not_verified |
| BR-26 numeric/radar/trend | — | blocked on D2 | — | 21, 22 | blocked |
| BR-27 chart text alternatives | TASK-011 components | TASK-011 tests | axe (planned) | 21 | not_verified |
| BR-28 legacy compatibility | — | TASK-013 tests | — | — | not_verified |
| BR-29 account erasure | `src/features/account-erasure` | TASK-012 tests | — | — | not_verified |
| BR-30 shared header and nav | `src/features/teams/components/TeamRouteNav.tsx`, `TeamPageHeader.tsx`; adopted by `RoadmapPage.tsx` and `TeamSystemsPage.tsx`. Oversikt (`TeamDetail.tsx`) keeps its own identity/summary header for TASK-008. | Focused vitest on team, roadmap, team-systems and teams routes: 842 of 844 passed in the final run; the 2 remaining failures were 5s timeouts under parallel load and `SystemMatrix.test.tsx` passed 14/14 when run alone with a 20s timeout. | keyboard not run in a browser; independent review not run | Oversikt header not yet unified | not_verified |

## Quality gates

| Command | Exit code | Result | Status |
|---|---|---|---|
| `pnpm typecheck` | 0 | tsc --noEmit clean (after TASK-001 changes) | passed |
| `pnpm lint` | 0 | 0 errors, 6 warnings (5 pre-existing in other tests, none in TASK-001 code after suppression) | passed |
| `pnpm test` | — | Focused: src/features/teams, roadmap, team-systems, app/(app)/teams → 1852 passed. Full suite not run yet. | not_verified |
| `pnpm build` | — | not run | not_verified |
| `pnpm verify:browser` | — | not run | not_verified |

## Responsive, accessibility and visual checks

| Check | Viewports | Status |
|---|---|---|
| No horizontal page overflow | 320, 360, 768, 1024, 1280, 1440 px | not_verified |
| Light and dark themes | per route | not_verified |
| Keyboard operation of tabs, Gantt toggle, dialogs, save | desktop | not_verified |
| axe check per route | desktop | not_verified |
| Screenshot comparison to references 18–22 | 1440 px | not_verified |

## TASK-002 evidence (project domain)

| Check | Command / scope | Exit / result | Status |
|---|---|---|---|
| Unit tests | `pnpm exec vitest run src/features/team-projects` | 2 files, 27 tests passed | passed |
| Related tests | `vitest run` on `src/features/teams/components/TeamPageHeader.test.tsx`, `TeamRouteNav.test.tsx`, `src/features/roadmap/domain` | 12 files passed (with the team-projects run above, 186 passed in the combined run) | passed |
| Typecheck | `pnpm typecheck` | exit 0 | passed |
| Lint | `pnpm exec eslint src/features/team-projects` | exit 0 | passed |

Coverage: plan-date validation and end-before-start (incl. year boundary), all-issues reporting, title bound, effective status at start-date boundary and midnight Oslo boundary, completed stays completed, passed end date does not imply completion, team ownership and same-team product link, 3- and 6-month window construction (year and leap-February crossing), bar positioning from real dates, clipping, out-of-window and reversed ranges (null), today marker inside/outside window.

Deviation: SPEC BR-9 asks to reuse an existing roadmap effective-status resolver. None exists in `src/features/roadmap/domain`; the rule is implemented in `team-project.ts`. Not yet exercised by any UI or route (TASK-003/005).

## TASK-003 evidence (project CRUD)

Implemented: `src/features/team-projects/server/write-team-project.ts` (create, update, archive, restore; lead-only, active team, re-checked inside the transaction; erasure fence via `runFencedTransaction`; no actor uid stored), `list-team-projects.ts` (any non-denied role reads; `canEdit` only for `lead`; archived excluded by default; bounded at 200 with `truncated`; malformed stored records fail closed), `http.ts`, and routes `app/api/teams/[teamId]/projects/` (GET, POST), `[projectId]` (PATCH), `[projectId]/archive` and `[projectId]/restore` (POST). `firestore.rules`: deny-only `teamProjects` block. `docs/DATA-MODEL.md`: TeamProject row.

| Check | Command / scope | Result | Status |
|---|---|---|---|
| Server tests | `pnpm exec vitest run src/features/team-projects` | 4 files, 58 tests passed (includes write and list gateway tests) | passed |
| Typecheck | `pnpm typecheck` | exit 0 | passed |
| Lint | `pnpm exec eslint src/features/team-projects "app/api/teams/[teamId]/projects"` | exit 0 | passed |
| Route handler tests | — | not written | not_verified |
| Emulator / Firestore integration | — | not run (no safe emulator run in this session) | not_verified |

Acceptance: lead-only writes on an active team — passed (tests). Cross-team project id — not_found, passed (tests). Archived excluded from default lists — passed (tests). **Product association — deferred by owner decision D8** (not a failing check): writes reject `productId`; a stored non-null `productId` makes `parseStoredTeamProject` return null, so the read fails closed (domain test added).

Session update (product decision): `pnpm exec vitest run src/features/team-projects` → 4 files, 63 tests passed (includes 5 new `parseStoredTeamProject` tests). Route-handler tests and Firestore emulator integration remain `not_verified` gaps; no shared Firebase data was used.

Decisions (conservative, backward compatible):
- No `createdBy`/`updatedBy`/`archivedBy` stored on projects, because `teamProjects` is not yet in the erasure inventory (TASK-012). Adding actor fields before that would create an erasure gap.
- Archive and restore are idempotent; an archived project cannot be edited until restored (`project_archived`).
- Title max length 200 is a repository choice, not a product requirement.
- The lifecycle status is stored as `planned | completed`; `Pågår` is derived.

## TASK-003 erasure correction and TASK-004 evidence

- **Correction:** the erasure inventory tripwire (`src/features/account-erasure/server/inventory.test.ts`, "finds no unregistered uid-bearing field name and no unregistered collection") failed on `teamProjects` after TASK-003. TASK-003 was marked Done without running it. It now passes: `teamProjects` is allow-listed in `inventory-allow-list.ts` with the reason that the collection stores no uid-bearing or memberRef field.
- **TASK-004 domain** (`src/features/team-projects/domain/team-project-participation.ts`): validation, inclusive interval overlap as an informational flag, fail-closed stored parsing, no utilization/capacity field. Tests: `team-project-participation.test.ts`.
- **Command:** `pnpm exec vitest run src/features/team-projects src/features/account-erasure/server/inventory` → 6 files, 145 tests passed. `pnpm typecheck` → exit 0. `eslint` on the touched team-projects files and the allow-list → exit 0.
- **Not verified:** server gateway, routes, Firestore rules for participations (not implemented).

## Participation erasure subwork (A-15, owner-approved pull-forward from TASK-012, 2026-11-06)

- **Implemented:** registry row A-15 in `inventory.ts`; `SPEC_ROW_IDS` in `inventory.test.ts` extended to A-15; sweep counter `teamProjectParticipations|perMembership|memberRef` in `erasure-adapters-sweep.ts`; `participationIdsOf` / `deleteParticipation` in `membership-erasure.ts` (step, after A-5 and A-14, before the membership delete), `membership-destruction.ts` (final transaction), and both Firestore adapters (`erasure-adapters-team.ts`, `membership-destruction-adapter.ts`); owning step `memberships` in `verification-sweep.ts`; empty stubs added to three existing fakes so they keep their scenarios.
- **Tests:** `membership-erasure-participation.test.ts` (3 tests: ordering and deletion, team and member scoping, no-participation case). The erasure suite passes 495 tests.
- **Gaps (closed in TASK-004 evidence below):** dedicated A-15 destruction-orchestrator test added. Firestore emulator run still not performed.
- **Tripwire:** `inventory.test.ts` passes with no rule weakened. `teamProjects` is in the allow-list as non-person-owned, not participations.
- **Commands:** `pnpm exec vitest run src/features/team-projects src/features/account-erasure` → 42 files, 575 tests passed. `pnpm typecheck` → exit 0. `eslint src/features/account-erasure/server src/features/team-projects` → exit 0.

## TASK-004 evidence (participation gateway, routes, rules)

- **Gateway:** `src/features/team-projects/server/write-project-participation.ts` (create, update, remove as soft archive). Lead-only writes on an active team; the member must hold a current same-team membership (`invalid_member` otherwise); the project must belong to the team and not be archived for create or update; a participation of another team or another project is `not_found`; the erasure fence runs first in the same transaction; the member membership is touched for erasure coordination; no uid is stored and responses carry the allow-listed view only (`overlapsOther` is informational).
- **Read:** `src/features/team-projects/server/list-project-participations.ts`. Any non-denied role reads; a malformed stored record fails the whole read (`read_failed`); cross-team records are rejected by the parser.
- **Routes:** `app/api/teams/[teamId]/projects/[projectId]/participations/route.ts` (GET, POST 201) and `.../[participationId]/route.ts` (PATCH, DELETE). Path ids are validated; codes map through `http.ts`.
- **Rules:** `firestore.rules` denies all client access to `teamProjectParticipations`.
- **Tests:** `write-project-participation.test.ts`, `list-project-participations.test.ts`, `app/.../participations/participations-routes.test.ts`. Cover authorized and unauthorized roles, cross-team projects and members, removed members, invalid dates and merged-range validation, overlap as a flag only, archived projects and records, malformed stored records, erasure-fence refusal, and the allow-listed response keys.
- **A-15 destruction test:** `membership-destruction.test.ts` now has a `project participation (A-15)` block: participations are deleted in the final transaction before the membership delete, other teams and members are untouched, and a write budget of 1 drains them over rounds before the membership delete.
- **Commands (run in this pass):** `pnpm exec vitest run src/features/team-projects src/features/account-erasure` and the participation route test, all passing (639 tests across the combined run of erasure, team-projects and route tests); `pnpm typecheck` exit 0; `eslint` on the touched files exit 0.
- **Not verified (recorded as not_verified):** Firestore emulator integration of the participation transactions and `in`/equality queries; a live route-handler run through Next.js. The route tests call the exported handlers with mocked gateways.

## TASK-007 evidence (team competence catalog assignments)

- **Location:** `src/features/team-competence-catalog/` (new feature). It is deliberately not in the C2 `team-skills` module, whose scope guards (`team-skills-scope-guard.test.ts`, `team-skills-cross-cutting.test.ts`) restrict its write boundary and importers. The catalog itself is not duplicated: names come from `skillTrees`.
- **Domain** (`domain/competence-area.ts`): record shape (`teamId`, `treeId`, `status` active/inactive/archived, `sortOrder` 0–99, timestamps), fail-closed stored validation, terminal archive, strict body parsers (assign, status, order).
- **Gateway** (`server/manage-competence-areas.ts`): assign, set status and reorder run in one transaction. The lead decision is made in the transaction (membership role exactly `lead`, then team `active`); app-admin status is never consulted. Archive keeps the document and never deletes. Reorder is an exact permutation of the non-archived set. The list uses `resolveTeamRole`: any non-denied role reads, `canEdit` only for a lead.
- **Privacy:** stored records and responses carry no uid, actor, rating, level, count or member data. No write touches `skillProfiles`, `skillProgress` or `teamSkillNeeds`.
- **Routes:** `app/api/teams/[teamId]/competence-areas/` (GET, POST 201), `.../[treeId]/` (PATCH), `.../order/` (PUT). Codes map through `competence-area-http.ts`.
- **Rules and erasure:** `firestore.rules` denies all client access to `teamCompetenceAreas`. The collection is allow-listed as non-person-owned in `inventory-allow-list.ts` (no uid-bearing or memberRef field). The inventory tripwire passes.
- **Tests:** `domain/competence-area.test.ts` (validator, transitions, parsers), `server/manage-competence-areas.test.ts` (authorization, team isolation, archive without delete, reorder permutation, fail-closed reads, no rating keys), `app/.../competence-areas/competence-areas-routes.test.ts` (status mapping, parse failure, allow-listed body).
- **Commands (run in this pass):** `pnpm exec vitest run src/features/team-competence-catalog "app/api/teams/[teamId]/competence-areas" src/features/account-erasure/server/inventory src/features/team-skills` → 28 files, 760 tests: 757 passed, 3 failed. The 3 failures are the `TeamRouteNav` navigation guard (pre-existing TASK-001 working-tree state, see below) and two C2 component timeouts that pass when run alone. The inventory tripwire passes. `pnpm typecheck` → exit 0 (full run, after all code edits). `eslint` on the new and touched files → exit 0. The TASK-004 suites (`src/features/team-projects`, `src/features/account-erasure`, participation route test) passed in an earlier run of this pass (639 tests).
- **Decision recorded:** archive is terminal in this slice (no restore action is in the approved task list). Restoring an archived area would need a new decision.
- **Not verified:** Firestore emulator run of the transactional queries (`where teamId ==`, the membership `in` lookup is not used here); browser check of the team competence-area UI (no UI was in TASK-007 scope).

### Repository guard observed (not caused by TASK-007)

- `team-skills-cross-cutting.test.ts` > "team navigation exposes only the approved destinations" fails on `src/features/teams/components/TeamRouteNav.tsx`, which is modified in the working tree by the in-progress TASK-001 work (adds `competence` and `competence-plan` tab links). The guard expects only `roadmap` and `systems` links. The guard was not weakened. TASK-001 must reconcile the nav with the guard, or the guard must be changed by an approved decision.
- `TeamSkillNeedsSection` component tests time out at 5 s under full-suite load and pass when run alone (66/66). This is load-related, not a regression.

## TASK-001 status

Still In Progress. Not verified in this pass:
- Independent review: not run.
- Browser verification (Oversikt, Roadmap, Kompetanseplan, Teamkompetanse, Systemoversikt; 404 checks, keyboard, responsive): not run.
- Oversikt (`TeamDetail`) still has its own header (TASK-008).

## Known gaps
- No implementation exists yet. Nothing in this file is evidence of working behavior.
- Blocked: D1 and D2 (see SPEC, "Decisions").

## TASK-005 evidence (project roadmap UI)

- **Route:** `app/(app)/teams/[teamId]/roadmap/page.tsx` now renders `TeamProjectRoadmap` (`src/features/team-projects/components/`). The competence-stage list component (`src/features/roadmap/components/RoadmapPage.tsx`) is no longer routed; it stays in place for TASK-006 to reuse for legacy records.
- **Domain:** `src/features/team-projects/domain/project-roadmap-view.ts` (Gantt rows from real dates, member participation rows, Norwegian date labels). Geometry reuses `timeline-geometry.ts` (TASK-002).
- **Client:** `client/team-projects-gateway.ts` (thin `fetch` for the TASK-003/004 APIs and `assignable-members`; field-by-field response parsing) and `client/use-team-project-roadmap.ts` (independent project, member and participation reads; stale responses dropped).
- **UI:** `components/TeamProjectRoadmap.tsx` (header, 3/6-month toggle, create/edit/archive/restore, archived list, loading/empty/error states), `ProjectGantt.tsx` (desktop timeline with month headers, today marker, clipping; narrow-screen project cards from the same rows), `ProjectForm.tsx` (create and edit; client checks reuse `validateProjectFields`), `ParticipationPanel.tsx` (planned intervals by member, with text alternative and overlap flag as text).
- **No metrics:** participation shows only planning intervals. No utilization, capacity, productivity or performance value is computed or rendered (asserted in a test).
- **Authorization in UI:** create, edit, archive and restore controls render only when the server returns `canEdit` (lead). Members see a read-only note. The server enforces the same rule on every write.
- **Tests run in this pass:** `pnpm exec vitest run src/features/team-projects "app/(app)/teams/[teamId]/roadmap" src/features/team-skills/team-skills-cross-cutting.test.ts src/features/teams/components/TeamRouteNav.test.tsx` → 12 files, 279 tests, all passed. Covers: loading, empty, error with retry, 3- and 6-month geometry from real dates (asserted numerically), window switching, clipping, today marker, lead versus member controls, client-side title validation, create payload, server refusal shown in the form, archive and restore, archived projects excluded from bars, participation by member with unnamed fallback and overlap text, participation and member-read failures handled independently.
- **Lint:** `eslint` on the touched files → exit 0.
- **Typecheck:** superseded by the final gate below (exit 0).
- **Known deviations and assumptions:**
  - Participation is read per active project (`GET .../projects/[projectId]/participations`), so the page makes one request per active project. A team-wide participation read would avoid that; it is not added here.
  - The participation view shows only active projects, because archived projects are not read for participation.
  - The today marker and window anchor use the planning calendar date (Europe/Oslo) read once when the view opens.
  - Project creation and editing is an inline form, not a dialog. The spec's approved interactions are all present.
- **Not verified:**
  - Browser screenshots against reference 19 at 320, 360, 768, 1024, 1280 and 1440 px: **not_verified**. Blocker: the browser harness requires the owner's test account and a team with project data. Creating fixture projects writes to Firebase data that is not an approved fixture; no write was made.
  - Mobile horizontal page overflow: **not_verified** (requires a browser layout check).
  - Keyboard order and focus behaviour in a real browser: **not_verified**. Controls are native buttons and a labelled form, asserted only through the accessible roles in tests.
  - Independent review: **not run**.

## Navigation guard reconciliation (TASK-001, this pass)

- The guard `team-skills-cross-cutting.test.ts` > "team navigation exposes only the approved destinations" rejected `competence` and `competence-plan`. Both are approved SPEC BR-30 tabs (`Kompetanseplan`, `Teamkompetanse`), so the guard's explicit allow-list was outdated. The allow-list now names exactly the five approved sub-routes (`roadmap`, `systems`, `competence-plan`, `competence`, plus the bare Oversikt base). Any other sub-route still fails.
- A new guard self-test proves that the pattern accepts the four approved sub-routes and rejects unapproved ones (`skill-needs`, `competence-plan/extra`, `competence-x`, `forum`). The rest of the architecture guard is unchanged.
- Run: `pnpm exec vitest run src/features/team-skills/team-skills-cross-cutting.test.ts src/features/teams/components/TeamRouteNav.test.tsx` → 118 passed.
- TASK-001 remains In Progress (independent review and browser checks not run).

## Final gate of this pass (team-experience-redesign)

- `pnpm typecheck` (`tsc --noEmit`) → exit 0. Before this pass it failed with 2 type errors in `app/api/teams/[teamId]/competence-areas/competence-areas-routes.test.ts` (a fixture's `status` widened to `string`). The fixture now uses `"active" as const`. No assertion changed.
- `pnpm lint` → exit 0, 0 errors, 7 warnings (pre-existing warnings in `TeamPageHeader.test.tsx` and other files; none in TASK-005 files).
- `pnpm test` (full suite) → exit 0: 559 files passed, 1 skipped; 9735 tests passed, 2 skipped, 0 failed.
- **Guard fixes made in this pass, both required by approved routes:** `app/route-groups.test.ts` now lists `/teams/[teamId]/competence` and `/teams/[teamId]/competence-plan` (the approved BR-30 tabs). The raw-colour allow-list test flagged `TeamProjectRoadmap.tsx`; its raw `zinc` classes were replaced with existing design tokens, and the raw-palette test passes.

### Item 6: C2 and other timeouts under full-suite load (evidence)

- First full run in this pass: 8 failed, 9727 passed (7 files). Five failures were `Test timed out in 5000ms` (`SurveyAnswerControls` ×2, `RoadmapPage.create`, `RoadmapPage.verification`, `TeamDetail`). One was an `AuthenticatedHome` heading miss under load. The other two were the route-list guard and the raw-palette guard, both fixed as described above.
- The same five files, run in isolation: 5 files, 185 tests, all passed.
- The C2 `TeamSkillNeedsSection` tests did not fail in either full run of this pass.
- Second full run after the fixes: all green (see above).
- Conclusion: the timeouts are a resource and concurrency issue under full-suite parallel load (the 5 s default timeout), not a logic regression. No timeout was raised and no test was disabled. Follow-up: consider raising the per-test timeout only after profiling the slow setup in these files, or running them with fewer workers.

### Remaining decisions and blockers (not implemented in this pass)

- **TASK-009 (`/me/skills`):** the existing page already covers the Alle/Vurdert/Ikke vurdert filter, counts, unrated-stays-unrated, and no team averages. Two parts are unresolved and were not invented:
  1. **Personal radar (BR-20)** conflicts with `docs/features/individual-skill-self-assessment/SPEC.md` BR-29 ("no radar or any chart"). The owner must decide whether the newer requirement supersedes BR-29 for the private profile.
  2. **Private role direction section** has no approved data model in the repository. Only copy mentions a "målrolle" comparison; the role-profiles feature is separate. The owner must define the model and whether it is private-only.
- **TASK-006 (Kompetanseplan):** blocked on decisions the SPEC does not settle: the milestone shape (title, completion), the "target stage" enum (which of the existing stage values), and the erasure classification of the new `teamCompetencePlans`-style records (whether a creator uid is stored, which would need an inventory entry). These are security and data-model choices, so I stopped rather than guess.
- **TASK-005 browser verification:** not run. The harness needs an owner test account and a team with project data. Creating fixture projects would write to Firebase data that is not an approved fixture.
- **TASK-001:** still In Progress (independent review and browser checks not run).

## TASK-006 evidence (Kompetanseplan)

Owner decisions OD-3, OD-4, OD-5 (SPEC.md) applied. Files: `src/features/team-competence-plan/` (domain, server gateway, client gateway, hook, components, copy); `app/(app)/teams/[teamId]/competence-plan/page.tsx`; `app/api/teams/[teamId]/competence-plans/` (`route.ts`, `[treeId]/route.ts`, `competence-plans-routes.test.ts`); `firestore.rules` (deny-only `teamCompetencePlans`); `src/features/account-erasure/server/inventory-allow-list.ts` (non-person-owned entry with reason); `docs/DATA-MODEL.md` (row added).

Behaviour: a lead of an active team creates or replaces one plan per assigned, non-archived competence area (target stage from the four existing levels, priority, optional archive, up to 20 milestones with optional target date and status). Members read plans read-only. Progress is completed milestones out of total. A roadmap competence-stage record (legacy) is shown read-only, unchanged, from the existing roadmap read.

Tests executed (vitest):
- `src/features/team-competence-plan` (domain, gateway, component): 40 passed.
- `app/api/teams/[teamId]/competence-plans`: 7 passed.
- `src/features/account-erasure/server/inventory*` and `erasure-static-guards`: 84 passed.
- `pnpm typecheck`: exit 0. `pnpm exec eslint` on the changed paths: exit 0.

Not verified: browser and visual comparison to reference 20 (not run); emulator / Firestore integration (not run); independent review (not run). Route tests mock the server layer and check HTTP mapping only; authorization is covered by the gateway tests.

## TASK-009 evidence (My Skills, partial)

Done:
- OD-1: no radar or chart exists on `/me/skills` (grep for `Radar` / `recharts` in `skill-profiles` and `team-skills` returns nothing).
- OD-2: the private role direction is the existing `RoleTargetSection` (owner-only, role-profiles BR-8/BR-10; erasure inventory I-4 subtree DELETE). No new model added.
- Sharing control: `src/features/team-skills/components/OwnCompetenceSharing.tsx` lists the caller's member teams (`relationship: "member"`) and renders one `SkillContributionPanel` per team with `wording="sharing"`. Label "Del kompetanse med teamet", state text, withdraw label. The state is the existing C2 record and endpoint; OFF until the owner opts in. `SkillContributionPanel` gained an optional `wording` prop (default unchanged).
- Tests: `SkillContributionPanel.test.tsx` adds two tests (sharing label and OFF by default; opt-in through the existing write, then re-read).

Not done:
- Competence-card redesign of the `SkillProfilePage` row list. The page keeps its existing overview and filter list.
- Browser and visual comparison to reference 22.
- Independent review.

Test notes: `TeamSkillNeedsSection.a11y.test.tsx` ("renders the panel and the needs content ... duplicate-key warning") exceeded vitest's 5 s timeout when the file runs as a whole. Run alone with `-t` it passes (28 s file import under jsdom). It is a timing issue in a heavy render. It was not confirmed as pre-existing because the baseline was not re-run.

## Full suite and blocker (TASK-006 / TASK-009 pass)

Full `pnpm test` run (before the fixes below): 9,768 passed, 16 failed, 2 skipped (9,786 total).
- Fixed in this pass (my changes): `app/(app)/teams/[teamId]/competence-routes.test.tsx` and `app/(app)/me/skills/page.test.tsx` (the pages now render auth-backed client components; the tests stub those components). `src/lib/theme/raw-palette.test.ts` (the sharing control used raw `zinc-*` colours; now theme tokens, count matches). `src/features/team-skills/server/participation-boundary.test.ts` (a comment carried the persisted field name; reworded). Re-run of these files: 8 files, 73 tests passed.
- Timing only: `AuthenticatedHome.test.tsx` (5), `SignInForm.test.tsx` (2), `SkillTreeCreationForm.test.tsx` (2), `TeamSkillNeedsSection.a11y.test.tsx` (1). Each file passes when run alone; the full run exceeded the 5 s per-test timeout under load. Not re-run in full after the fixes.
- **Blocked, needs owner decision:** `src/features/skill-profiles/skill-profiles-cross-cutting.test.ts` > "C1 production code contains no C2, sharing, history, ranking or aggregate identifiers" fails on `app/(app)/me/skills/page.tsx: sharing`. The guard is change-detection for C1, and C1 is documented as providing no sharing (SECURITY invariant 31). OD-6 puts the C2 sharing control on `/me/skills`. Both cannot hold without a decision. Options: (a) approve an explicit change to C1 scope documentation and the static guard for the C2 participation control on this page; (b) move the control to another route. I have not renamed the component or edited the guard to make it pass.

## Pass 2 evidence (owner decision applied, 2026-11-06)

### C1/C2 boundary (TASK-009 composition exception, Option A)

- Guard narrowed, not removed: `src/features/skill-profiles/skill-profiles-cross-cutting.test.ts` now permits one exact composition (`APPROVED_C2_COMPOSITION`: file `app/(app)/me/skills/page.tsx`, specifier `…/team-skills/components/OwnCompetenceSharing`, identifier `OwnCompetenceSharing`, exactly one import and one JSX use). Every other C1 → C2 import or reference is rejected by negative fixtures.
- Docs: `docs/features/individual-skill-self-assessment/SPEC.md` (new section "C2 participation control composition exception"); `docs/SECURITY.md` invariant 31 clarifies that the control is C2-owned under invariant 32 and reads no `skillProfiles` content.
- Tests covered: the approved control is permitted on `/me/skills`; unapproved C1 → C2 dependencies fail; no C1 file other than the page imports `team-skills`.
- `OwnCompetenceSharing.test.tsx` (new, 5 tests): member-only teams, one independent panel per team, OFF by default (opt-in shown, no withdraw), no-team state makes no request, read failure shows an alert and no control, distinct heading ids per team. Found and fixed: `SkillContributionPanel` used one fixed heading id for every team panel; it now uses `useId`.
- Not verified by these tests: runtime authorization of the endpoints beyond the existing C2 gateway and route tests; notice-version invalidation and team isolation are covered by the existing `SkillContributionPanel` and `team-skills` server tests, not re-tested here.

### TASK-011 Teamkompetanse (categorical coverage view)

- `src/features/team-skills/components/TeamCompetenceCoverage.tsx` (client) uses the existing `fetchSkillCoverage` gateway. Route `app/(app)/teams/[teamId]/competence/page.tsx` renders it under the shared header.
- States: `covered` → Dekket; `gap` → Behov for utvikling; `insufficient_data` → Ikke nok grunnlag (with the k = 5 explanation); `area_unavailable` → Området kan ikke vises. Needs show the required level by name only.
- Deviation: REQ label "Delvis dekket" has no backing state in the server contract, so it is not shown. No partial state was invented.
- Deviation: the reference donut is not implemented (it would show per-status area counts; the acceptance criteria forbid counts).
- Radar and "Utvikling over tid" panels are rendered as disabled, explained panels (`aria-disabled="true"`), with no chart element (D2).
- Tests: `TeamCompetenceCoverage.test.tsx` (8 tests): labels and explanations, no digits/percentages/averages in the table, level by name, empty, incomplete, forbidden, retry, disabled panels with no SVG or canvas. Route test `competence-routes.test.tsx` updated to check the view receives the team id.
- Not verified: visual comparison to reference 21 (browser not run).

### Gates (this pass)

- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0, 0 errors, 9 warnings (pre-existing mock-helper `exhaustive-deps` pattern; 2 of them are in the new test files and follow the same pattern as the existing tests).
- Targeted suites after the last change: `src/features/team-skills`, `src/features/skill-profiles`, `src/features/account-erasure`, `src/features/teams`, `app/(app)/me/skills`, `app/(app)/teams/[teamId]`, `src/lib/theme/raw-palette.test.ts`: all passing (2,628 tests in the first group; 22 in the second).
- `pnpm test` (full suite), run after the final code change → exit 0: 565 files passed, 1 skipped; 9,801 tests passed, 2 skipped, 0 failed.
- Earlier full run in this pass had 1 failure (`raw-palette.test.ts`): my new `me/skills` wrapper and coverage component used raw `zinc-*` classes. Fixed with design tokens; the rerun is green.

### Not done in this pass (kept visible)

- TASK-009: the reference-22 competence-card redesign of the row list is not done. The page keeps the existing overview and select-based editor, which the existing 1,900 lines of tests depend on. Browser and visual comparison to reference 22: not run (no browser verification infrastructure used here).
- TASK-010: the owner's "accessible dialog" requirement is not implemented. The current disclosure is a `<details>` element. Dialog focus test: not written.
- TASK-001, TASK-005, TASK-006: browser and visual verification, and independent review, still not run.
- TASK-008, TASK-012, TASK-013, TASK-014: not started in this pass.

## TASK-008 evidence (Oversikt, results route, BR-5)

Scope of this pass: the survey history, current-survey card, period summary, trend table and trend chart moved out of the Oversikt (`TeamDetail`) into a new route `/teams/[teamId]/results`. Oversikt keeps the identity header, the five-tab nav, the four KPI cards, `Neste steg`, and a link to the results route. No data was deleted; the results read still runs on Oversikt only as the authorization decision for the page.

Implemented:
- `app/(app)/teams/[teamId]/results/page.tsx` (thin server page: shared `TeamPageHeader`, back link `Tilbake til Oversikt`, `TeamResultsView`). Not a sixth tab (SPEC: five tabs only).
- `src/features/teams/components/TeamResultsView.tsx` (client): loads `fetchTeamResults` and `fetchCurrentTeamSurvey` through the existing gateways, with loading, signed-out, forbidden, error and section-level survey-error states. The lazy `TrendChart` and its error boundary moved here unchanged.
- `TeamDetail.tsx`: removed the moved blocks and the current-survey read; added the `Se resultater og trender` link. The results read stays for the authorization decision and for the summary strip in the header.
- Norwegian copy in `teams/copy.ts` (`results`).

Tests (run by this pass):
- `src/features/teams/components/TeamResultsView.test.tsx`: 7 tests (loading, loaded blocks, forbidden, error, signed-out, survey read failure isolated, empty results and no chart). 7 passed.
- `app/(app)/teams/[teamId]/results/results-route.test.tsx`: 3 tests (shared header and teamId, back link, encoded teamId). 3 passed.
- `TeamDetail.test.tsx`: obsolete survey, trend, chart and zone assertions removed (their behaviour now lives in the results-view tests above). Readiness waits changed to the team heading. New test: Oversikt links to `/teams/{id}/results` and renders no survey history, trend table or chart. 90 passed.
- `team-overview-order.test.ts`: source-order expectations updated to the new layout. 5 passed.
- `src/lib/theme/raw-palette-allowlist.json`: `TeamDetail.tsx` count lowered from 18 to 8 (raw colour classes moved with the blocks). The new view uses design tokens only.
- `pnpm exec vitest run src/features/teams "app/(app)/teams" src/lib/theme`: 1135 passed, 1 failed. The failure is `raw-palette.test.ts`: `src/features/team-skills/components/SharingExplanationDialog.tsx` is an untracked file outside this task that is not in the allow-list. Not changed here.

Gates:
- `pnpm typecheck`: exit 0.
- `pnpm exec eslint src/features/teams "app/(app)/teams"`: exit 0, 0 errors.

Not verified (kept visible):
- Browser and visual comparison against reference 18: not run.
- Identity layout against reference 18: the reference shows a description line and member, system and competence-area counts. The current data sources provide only the team name, so no description or counts were added (no invented metrics). The existing identity block (team image, name, latest-result summary) is unchanged.
- Keyboard and responsive checks on the results route and Oversikt: not run in a browser.
- Independent review: not run.

## Pass 3 evidence (palette regression, TASK-008 identity, full gates)

Code completion, not final acceptance.

- Raw-palette regression fixed: `SharingExplanationDialog.tsx` now uses design tokens (`bg-text-primary/30` scrim, `bg-surface-elevated`, `rounded-surface`, `shadow-elevated`, `text-text-primary`, `text-text-secondary`), matching `team-systems/ExplanationDialog.tsx`. The allow-list was not changed. `src/lib/theme/raw-palette.test.ts`: 1 passed (vitest exit 0).
- TASK-008 identity: the header shows the already-loaded competence-area count (`TeamHeading`, `teamsCopy.detail.competenceAreas`), with no extra read; omitted when the skill read fails. This supersedes the "no counts added" note above for the competence-area count only. Team description is not in the team data model, and member and system counts would need a new read, so they are not shown. Recorded as not supported.
- TASK-008 Oversikt still calls `fetchTeamResults` for the authorization decision and the header summary strip. Survey history, trend and ladder components are not in the Oversikt render tree (see the TASK-008 evidence above).
- `team-overview-order.test.ts` anchor changed to the `competenceAreaCount` prop (the source-order intent is unchanged).
- `app/route-groups.test.ts`: `/teams/[teamId]/results` added to the expected route list.
- New focused test: competence-area count shown on success and absent on skill read failure (`TeamDetail.test.tsx`).

Gates (run this pass, exit codes from the commands):
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (0 errors, 10 warnings).
- `pnpm test`: exit 0. 570 files passed, 1 skipped; 9802 tests passed, 2 skipped.
- `pnpm build`: exit 0.

Not done in this pass (kept visible):
- TASK-008: visual comparison to reference 18, keyboard and responsive checks, and independent review are not run.
- TASK-009 My Skills visual redesign (header, status pill, card styling, responsive layout): not started in this pass.
- TASK-012 erasure inventory audit: not started in this pass.
- TASK-013 legacy compatibility checks: not started in this pass.
- TASK-014 browser, emulator and independent review checks: not run; recorded as `not_verified`.

## Pass 4 evidence (TASK-009 My Skills, code level)

Code completion, not final acceptance. No browser or visual comparison was run.

Implemented in `src/features/skill-profiles/components/SkillProfilePage.tsx`:
- Assessment status pill: the assessed count (`assessedOfAll` / `assessedOfShown`) is a text-only `Badge` with a success tone when every skill is assessed, and an info tone otherwise. `StatusBadge` was not used because its decorative icon is an SVG and the privacy test forbids SVG on this page.
- Filter options (`Alle`, `Vurdert`, `Ikke vurdert`) render as chips. The radio inputs stay visible, and the selected chip has `font-medium` plus a stronger border, so the state is not conveyed by colour alone.
- Page header, responsive three-panel grid, the four-level scale, saving, reset and the private role-direction and sharing panels are unchanged.

Not included (reference 22 elements not supported by the approved decisions): radar chart and "Din kompetanseprofil" (OD-1, D2), "Gjennomsnittlig nivå" average (no approved calculation), the "Teamets gjennomsnitt" series (D2, SECURITY invariant 35), and the "Utvikling over tid" chart (no approved trend data on this page).

Tests:
- `SkillProfilePage.layout.test.tsx`: 4 passed, including 2 new tests (pill tone for partial and complete assessment, selected filter chip).
- `src/features/skill-profiles` and `app/(app)/me/skills` with `src/lib/theme`: 548 passed (26 files).
- `raw-palette-allowlist.json`: `SkillProfilePage.tsx` count lowered from 30 to 28 (the guard's intended shrink; no new raw classes).
- `pnpm exec tsc --noEmit`: exit 0. `npx eslint src/features/skill-profiles "app/(app)/me/skills"`: exit 0.

Not verified: visual comparison to reference 22 in a browser (`not_verified`); keyboard and responsive checks in a browser (`not_verified`); independent review (`not_verified`).

## Pass 4 evidence (TASK-012 erasure inventory audit)

Audit of every collection introduced or modified by this feature, checked against `src/features/account-erasure/server/inventory.ts` and `inventory-allow-list.ts`. No code or registry change was needed.

| Collection | Person-linked fields found in server code | Classification | Evidence |
| --- | --- | --- | --- |
| `teamProjectParticipations` | `memberRef` only; no actor uid stored (`write-project-participation.ts`) | A-15 DELETE via membership step and sweep counter | inventory row A-15; membership-destruction tests |
| `teamProjects` | none written (no `createdBy`/`updatedBy`/`archivedBy`/`memberRef`) | allow-listed, reason recorded | `list-team-projects.ts` allow-listed response; allow-list entry |
| `teamCompetenceAreas` | none | allow-listed, reason recorded | allow-list entry |
| `teamCompetencePlans` (incl. embedded milestones) | none | allow-listed, reason recorded | allow-list entry |
| `teamSkillNeeds` | none (`SkillNeedRecord`: teamId, treeId, requiredLevel, requiredCoverage, timestamps) | P-4 PRESERVE | inventory row P-4; `skill-need.ts` |
| Sharing participation (C2 `skillContribution`) | field on `teamMemberships` (`noticeVersion`, `consentedAt`) | I-9 DELETE of the membership doc, which already carries `uid` and `memberRef` | inventory row I-9; `skill-contribution.ts` |

Result: all new user-linked records are registered or explicitly allow-listed. The erasure guards are unchanged.

Tests run this pass:
- `src/features/account-erasure`, `src/features/team-projects`, `src/features/team-competence-plan`, `src/features/team-skills`: 76 files, 1367 tests passed (exit 0), including the inventory tripwire (`inventory.test.ts`).

Not verified: emulator-backed erasure runs against Firestore (`not_verified`; no emulator run was performed in this pass, and shared Firebase was not touched).

## Pass 4 evidence (TASK-013 compatibility, TASK-014 gates)

Gates run this pass (exit codes from the commands themselves):
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (0 errors, 3 warnings reported as potentially fixable; the warnings were not introduced by this pass's files).
- `pnpm test`: exit 0. 570 files passed, 1 skipped; 9804 tests passed, 2 skipped.
- `pnpm build`: exit 0.

TASK-013 compatibility, mapped to existing regression tests (no new tests were needed for these):
- Existing team routes: `app/route-groups.test.ts` (now lists `/teams/[teamId]/results`); route tests under `app/(app)/teams`.
- System inventory and qualitative attributes: `src/features/team-systems` tests (in the full suite).
- Skill editing: `src/features/skill-profiles` and `app/(app)/me/skills` tests (548 passed, Pass 4).
- Team authorization: `src/features/teams` tests (`TeamDetail.test.tsx` denied, request-access and results-forbidden cases).
- Survey and results behaviour: `src/features/results`, `src/features/teams/components/TeamResultsView.test.tsx`.
- Account erasure: `src/features/account-erasure` tests and the inventory tripwire (1367 passed, Pass 4).

Not verified (`not_verified`): browser and visual checks across these routes; emulator-backed Firestore checks; independent review. Shared Firebase was not touched.

## Final acceptance pass (2026-11-06): evidence and blockers

Scope: independent review capability, browser checks, emulator checks, TASK-013 audit. No task is marked accepted in this section. Shared Firebase was not used or written to. No commit, push or deploy.

### Independent review

- A fresh general-purpose reviewer agent (no access to this session's reasoning, read-only brief covering the authorization, private-assessment, consent, k=5, persistence, erasure, accessibility and test-gap areas). Result: see "Review findings" below once recorded. Until that section is filled, independent review is `not_verified`.

### Browser (unauthenticated only)

- Environment: `pnpm dev` could not bind to port 3000 or 3001 in this session because those ports are already served by other processes. The checks ran against the existing server on `http://localhost:3001`. Playwright runs from the local `@playwright/test` package with bundled Chromium (`browser/` harness not used).
- Routes: `/teams/demo-team`, `/roadmap`, `/competence-plan`, `/competence`, `/systems`, `/results`, `/me/skills`, at 320 and 1440 px.
- Result: all 14 loads returned HTTP 200 with no redirect. Each team route rendered the sign-in gate ("Logg inn for å se dette teamet"), with no team data. Horizontal overflow 0 px at both widths. Console errors: none. Screenshots: `scratchpad/shots/` (not committed).
- `pnpm verify:browser` (the owner's harness) was NOT run. It needs `DEVPULSE_VERIFY_EMAIL` and `DEVPULSE_VERIFY_PASSWORD` for the owner's test account on the configured Firebase project. That is shared Firebase, which this pass must not touch. `not_verified`.
- Authenticated visual comparison to references 18–22, keyboard order, dialog focus trap and restoration, and axe checks: `not_verified`. Blocker: no fixture-mode or Auth-emulator wiring exists in the app (client Auth and the server Admin SDK point at the configured project), so authenticated pages cannot be rendered without the owner's account.

### Firestore emulator

- Java: `java` is not on PATH. The Adoptium JRE 21 at `C:\Program Files\Eclipse Adoptium\jre-21.0.13.9-hotspot` works when added to PATH for the session. firebase-tools 15.29.0.
- Command: `firebase emulators:start --only firestore --project demo-devpulse` (127.0.0.1:8080). Emulator ready, no errors in its log.
- Client deny rules (unauthenticated REST against the emulator): GET and POST on `teamProjects`, `teamProjectParticipations`, `teamCompetenceAreas`, `teamCompetencePlans` all return HTTP 403 `PERMISSION_DENIED`. The emulator cites `firestore.rules` line 188 (`teamProjects`) as the denying rule. `passed` for deny-only client access on these four collections.
- D-EMU race test (`src/features/auth/server/erasure-fence.race.emulator.test.ts`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `DEVPULSE_EMULATOR_PROJECT=demo-devpulse`): **FAILED in this session**. Case 1 (the fenced write must not commit after a concurrent fence create) times out at 5 s and again at 60 s. The `afterAll` hook also times out at 10 s. Case 2 (unrelated uid still commits) passes. The emulator log shows no error. The timeout is inside the test callback: it awaits a non-transactional `create` on `accountErasures/{uid}`, which the transaction has already read. This looks like a harness deadlock, not a fence defect, but it is unconfirmed. The VERIFICATION.md D-EMU section records an owner-provided PASS. This run does not reproduce it, so the owner must check the emulator version and test revision used for that PASS. The proof test was not changed.
- Other emulator-backed checks in this feature (project CRUD, participation writes, sharing opt-in and opt-out, notice-version invalidation, membership and account erasure against the emulator): `not_verified`. No feature-level emulator integration suite exists; adding one is a new task.

### TASK-013 legacy compatibility audit

Requirements: BR-17 (competence-stage records readable and shown unchanged in Kompetanseplan), BR-28 (personal assessments, team needs, competence plans, roadmap records, survey records, System Overview records readable; no destructive migration).

| Legacy shape | Test evidence | Status |
| --- | --- | --- |
| Personal assessments | `skill-profiles/server/read-skill-levels-batch.test.ts` ("never writes or repairs"), `skill-profile-batch-read.test.ts` ("leaves stored documents unchanged") | passed (read and no-write) |
| System Overview three legacy attributes | `team-systems/domain/team-system-record.test.ts` ("legacy three-attribute documents remain readable") | passed |
| Team needs | `team-skills/server/skill-needs-store.test.ts`, `list-skill-needs.test.ts` | passed for read; legacy-shaped fixture not confirmed in the audit |
| Survey records | `results/client/team-results-gateway.test.ts` (parses published entries and rejects malformed ones) | partial (parsing, no explicit legacy-shape fixture) |
| Competence-stage roadmap records in Kompetanseplan | `CompetencePlanSection.test.tsx` ("shows existing roadmap competence steps read-only") covers rendering only. The hook had no test. | gap at hook level, closed for this pass (see below) |
| Roadmap records, no write on read | `roadmap/server/list-roadmap-items.test.ts` ("depends on a store with no write method") | passed |
| No migration code on read | No migration code added by this feature (grep for migration in feature code finds comments only) | passed (static) |

Regression test added this pass: `src/features/team-competence-plan/client/use-competence-plans.test.tsx` (3 tests, jsdom). It covers: a failed legacy roadmap read keeps the plans visible and sets `legacyFailed`; archived legacy records are excluded and non-archived ones pass through unchanged with no plan write; a forbidden plan read is an error even when the legacy read succeeds. Result: 3 passed (`pnpm exec vitest run src/features/team-competence-plan/client/use-competence-plans.test.tsx`). `eslint`: 0 errors, 1 `exhaustive-deps` warning (test mock helper, same pattern as existing tests).

TASK-013 status after this audit: its acceptance criteria are only partly evidenced (the survey-record and team-needs legacy shapes are not explicit fixtures). It stays `Ready`. A dedicated legacy-fixture suite for the six shapes is a follow-up.

### Gates (this pass)

- `pnpm typecheck`: exit 0 (run after the new test file was added).
- Other gates (`pnpm lint`, full `pnpm test`, `pnpm build`) were not re-run in this pass. The last full run recorded above (Pass 4) predates the new test file. The new file's own lint and test results are recorded above.

### Review findings (independent read-only reviewer, 2026-11-06)

Reviewer: fresh general-purpose agent, read-only, no edits or test runs. Files it read are listed in its report. Verdict on mandatory areas: authorization, team isolation, erasure, k=5 coverage and sharing defaults were found sound.

| # | Severity | File | Finding | Disposition |
| --- | --- | --- | --- | --- |
| 1 | Medium | `team-projects/server/list-project-participations.ts`, `write-project-participation.ts`, `domain/team-project-participation.ts` | The participation `note` is returned to every team member; validation checks only length and type. A lead could write an evaluative remark about a named member. | **Open, owner decision.** Not changed. Options: make the note lead-only on read, or record it as team-visible planning text and add a test or invariant. SPEC says "non-evaluative" but does not define visibility. |
| 2 | Low | `teams/components/TeamOversiktSummary.tsx` | `activeProjects` and `systemsAttention` mapped a forbidden read to "unavailable" instead of the forbidden state. No `0` was shown. | **Fixed.** Both cards now map `forbidden` the same way as `priorityPlans`. `TeamOversiktSummary` tests: 5 passed. |
| 3 | Low | `team-projects/server/write-team-project.ts` | Comments conflicted with the allow-list about erasure coverage of `teamProjects`. | **Fixed.** Both comments now point to `inventory-allow-list.ts`. Erasure inventory tripwire passes. |
| 4 | Low | `team-skills/components/SharingExplanationDialog.tsx` | The background is not inert while the dialog is open, so pointer or virtual-cursor focus can reach content behind it. | **Open.** Not changed in this pass. Recommended: `inert` on the app root while open. Needs a browser check to confirm. |
| 5 | Low | `teams/components/TeamDetail.tsx` | Oversikt still has its own header (already recorded in TASK-001). | Known gap, unchanged. |
| 6 | Low (test gap) | `team-skills/components/SkillContributionPanel.tsx`, `set-own-skill-contribution.ts` | The server-side check of the notice version was not read by the reviewer. No UI test asserts that opt-in is sent only on an explicit click. | **Open.** Needs a server test for a stale or forged notice version and a click-only opt-in test. |

Also added this pass: the hook regression test (`use-competence-plans.test.tsx`) listed under TASK-013 above.

### Gates after these fixes

- `pnpm typecheck`: exit 0 (after all three code edits).
- `pnpm exec vitest run src/features/team-projects src/features/account-erasure/server/inventory src/features/teams/components`: exit 0.
- Full `pnpm test`, `pnpm lint` and `pnpm build` were not re-run after these edits. The last full-suite result recorded in this file is from Pass 4 and predates them.
