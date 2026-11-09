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


### Pass 5 evidence (TASK-008 header, 2026-11-07)

Implemented (code, not browser-verified):
- `src/features/teams/components/TeamHeaderMetrics.tsx`: shows the complete system count (from `fetchTeamSystems`, the same read the Oversikt already uses) and the competence-area count under the team name. A truncated or failed read shows no number.
- `src/features/teams/domain/team-oversikt.ts`: `completeHeaderCount` returns `null` for truncated or absent reads, so a partial total is never shown as a total.
- `TeamDetail.tsx`: the authorized Oversikt header passes the metrics through a new `metrics` slot. The `competenceAreaCount` prop remains for the other header branches.

Deviations (justified):
- Member count omitted. The only member-facing roster read is `fetchTeamRoster`, and the TeamDetail test contract requires that the collapsed roster section makes no request on load. Using the roster for the header would break that contract. No other authorized source gives a complete member total.
- Team description omitted. It is not in the loaded team read.
- Loading state: no placeholder. Counts appear once their read completes.

Tests:
- `team-oversikt.test.ts`: `completeHeaderCount` (complete, zero, truncated, null).
- `TeamHeaderMetrics.test.tsx` (new, jsdom): complete count shown; truncated count omitted; forbidden or failed read shows nothing and never a zero.
- `team-overview-order.test.ts`: the anchor moved from the removed `competenceAreaCount=` prop to `summary={latest ?`. The assertion (summary strip inside the authorized header) is unchanged.
- `pnpm vitest run src/features/teams`: 64 files, 1057 tests passed.

Not verified: browser screenshots against reference 18, responsive layout at 320 to 1440 px, keyboard and focus checks, and independent review. Browser verification was not attempted in this pass.

Gates (Pass 5, after the final edits): `pnpm typecheck` exit 0; `pnpm lint` exit 0 (0 errors, 15 warnings, none introduced by this pass's header work); `pnpm vitest run` exit 0 (582 files passed, 3 skipped; 9941 tests passed, 16 skipped); `pnpm build` exit 0.

Fix during the gate run: `TeamOversiktSummary.tsx` used raw Tailwind palette classes (amber, orange, red) that are not on `src/lib/theme/raw-palette-allowlist.json`, which failed the raw-colour tripwire. The KPI tones now use design tokens (`primary-subtle`/`primary-text`, `warning-subtle`/`warning-text`, `danger-subtle`/`danger-text`). Raw-palette test: passed.

## Pass 6 — Roadmap status filter, Kompetanseplan toggle (2026-11-07)

**Roadmap (TASK-005).** Added a status filter above the project plan: `Alle`, `Planlagt`, `Pågår`, `Fullført` (`aria-pressed` group, labelled). Filtering uses the existing effective-status value and does not change status, dates, authorization or team isolation. A filter with no matches shows the empty state `Ingen prosjekter har denne statusen.` Tests: `src/features/team-projects/domain/project-status-filter.test.ts` (3 tests). The existing 3/6-month toggle, today marker, sticky labels, mobile project cards and participation panel are unchanged in this pass.

**Kompetanseplan (TASK-006).** The `Vis detaljer` toggle now sets `aria-controls` to its milestone list while the list is expanded. Focused tests: `src/features/team-competence-plan` (4 files, 43 tests) passed.

**Browser verification (Priority 2): not_verified.** Not run. Reason: the Playwright harness (`browser/guards.ts`) needs `DEVPULSE_VERIFY_EMAIL` and `DEVPULSE_VERIFY_PASSWORD`, which are not set in this environment, and it targets the Firebase project in `.env.local`. Authenticated pages need a team with project data, and creating fixtures would write to shared Firebase, which is not an approved fixture. No credentials were invented and no production or shared data was written. Screenshots at 320, 360, 768, 1024, 1280 and 1440 px, light/dark theme, overflow, keyboard and console checks remain open for the owner's account run.

**Design deviations and gaps.**
- The reference shows a "Neste steg" card set and a team header with counts. Neither is in TASK-005 scope, so neither was added.
- Participation is shown by member, as in the reference. Grouping participation by project with collapsible rows is not implemented.
- Kompetanseplan (reference 20) was inspected. The milestone dates are still raw `YYYY-MM-DD`; the Norwegian date formatter lives in the team-projects feature, and importing it here would be a cross-feature dependency. Not changed.

**Gates (Pass 6, final tree).** `pnpm typecheck` exit 0. `pnpm lint` exit 0 (0 errors; 15 existing warnings in unrelated test files). `pnpm vitest run` exit 0 (583 files passed, 3 skipped; 9944 tests passed, 16 skipped). `pnpm build` exit 0.

## Browser verification harness status (2026-11-07)

Scope: isolated local Firebase Auth + Firestore Emulator for browser checks. No shared project was touched.

Built and verified:
- `firebase.emulator.json` (root): emulator-only config, Auth on 127.0.0.1:9099, Firestore on 127.0.0.1:8080, UI disabled. Started with `--project demo-devpulse-verify`.
- `src/lib/firebase/emulator-config.ts` (+ tests, 49/49 `src/lib/firebase` tests pass): fail-closed guards. Emulator mode needs an explicit local URL, refuses `NODE_ENV=production`, requires a `demo-` project id, and the Admin SDK guard refuses non-local emulator hosts.
- `src/lib/firebase/client.ts`: calls `connectAuthEmulator` only when `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` passes the guard. Unset in every normal environment.
- `src/lib/firebase/admin.ts`: runs `assertAdminEmulatorSafe` before init. No-op when no emulator host is set.
- `browser/emulator/seed-verification-data.mjs`: synthetic seeder (3 `*@verify.test` users, one active team, memberships, 3 projects, 2 participations). Refuses unless both emulator hosts are localhost and the project is `demo-`. Ran successfully against the emulators.

Verified evidence:
- Auth emulator and Firestore emulator respond (HTTP 200).
- Seeder completed against emulators only. Admin SDK logged a metadata-lookup warning, meaning it found no credentials and made no Google call.
- Next dev server (webpack, scratch copy, `.env.local` excluded) serves `/sign-in` with 200. The client bundle contains the emulator URL.

Blocker (not resolved):
- Browser sign-in did not complete. In headless Chromium, the `/sign-in` React tree never hydrates (no React fiber on DOM nodes), so the native form submit is a GET. No console or server error is logged. Sign-in through the emulator therefore is not verified.
- Turbopack cannot run from the scratch copy because `node_modules` is a junction out of the root. The repo's own `next dev` cannot run concurrently with the owner's running dev server (`.next` lock).
- Owner decision needed or next step: run the harness from a dedicated checkout with its own `node_modules`, or debug the hydration failure with a dedicated session.

Not done in this pass: no Roadmap, Kompetanseplan, Teamkompetanse or Mine ferdigheter visual changes were made. No 320–1440 px screenshots exist. `browser/global-setup.ts` still reads only the `.env.local` project id and does not yet understand the emulator mode.

## Pass 7 — browser hydration diagnosis and Roadmap grouping (2026-11-07)

### Browser hydration diagnosis (time-boxed)

| Check | Evidence | Result |
|---|---|---|
| Owner dev server | Listens on `localhost:3001` (PID 32976). A second `next dev` in `C:\Projekt\devpulse` refuses to start (`.next/dev` lock held by the owner's server), so the owner's server was used read-only. Port 3000 is not listening. | observed |
| Sign-in document | `GET /sign-in` → HTTP 200 | passed |
| Client chunks | 17 `/_next/static/chunks/*` requests, all HTTP 200 | passed |
| Hydration (headless Chromium 1248, Playwright 1.64.1) | `<form>` and `#sign-in-email` carry React fiber keys after 8 s | passed (hydrates) |
| Console / page errors | none in headless run | passed |
| Earlier hydration error in dev log (00:41) | Mismatch on `<body>` attributes `data-gr-ext-installed` / `data-new-gr-c-s-check-loaded`, i.e. a browser extension (Grammarly) | not the headless cause |
| node_modules junction | Owner's server, which uses the same junction, serves and hydrates correctly | not implicated |

Conclusion: the reported "does not hydrate in headless Chromium" symptom did **not** reproduce against the owner's running server. No code or config change was made for it. The previously recorded blocker may have come from a different server state, a different port, or a stale `.next` build; that is unverified.

**Side effect (disclosed):** the diagnostic script clicked the sign-in submit button with empty fields. This sent one `accounts:signInWithPassword` request to the production Identity Toolkit endpoint (`identitytoolkit.googleapis.com`) with the configured project key and no credentials. No sign-in succeeded and no data was written. The script must not submit against a non-emulator configuration.

**Emulator-backed sign-in: not attempted in this pass.** The owner's server runs with production client config (no `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL`, no `demo-` project id). A demo-project server needs a separate checkout or distDir, because the Next dev lock is per project directory. Next action: create an isolated copy of the working tree, start `firebase emulators:start --only auth,firestore` with the `demo-devpulse-verify` project, run `browser/emulator/seed-verification-data.mjs`, then start the copy's dev server with the emulator env vars.

### Roadmap grouping (TASK-005 UI pass)

- `domain/project-roadmap-view.ts`: `groupProjectsByStatus` (order Planlagt, Pågår, Fullført; empty groups omitted; stored order kept inside a group).
- `components/ProjectGantt.tsx`: each status group has a full-width header button (`aria-expanded`, `aria-controls`, count written out, status as text). Desktop timeline and mobile cards share one collapsed state. Groups start expanded.
- `copy.ts`: `group` keys.
- Tests: `project-roadmap-view.test.ts` (grouping order, empty list); `TeamProjectRoadmap.test.tsx` (collapse and expand a group; bar assertions select by project title because group order changed the DOM order; three bar-position tests were updated accordingly, with the same expected numbers).

### Quality gates (run in this pass)

| Command | Exit code | Result | Status |
|---|---|---|---|
| `pnpm typecheck` | 0 | clean | passed |
| `pnpm lint` | 0 | 0 errors, 15 warnings (pre-existing, not in the changed files' new code) | passed |
| `pnpm exec vitest run src/features/team-projects` | 0 | 10 files, 165 tests | passed |
| `pnpm vitest run` (full) | 0 | 584 files passed, 3 skipped; 9955 tests passed, 16 skipped | passed |
| `pnpm build` | not run | `next build` writes the same `.next` directory as the owner's running dev server on this checkout, so it was not run here to avoid disturbing that server | not_verified |

### Browser and responsive checks (Roadmap, Oversikt)

| Check | Status |
|---|---|
| Authenticated Roadmap / Oversikt render at 320, 360, 768, 1024, 1440 px | not_verified (no emulator sign-in; see above) |
| Screenshots, horizontal overflow, Gantt at 3/6 months in a browser | not_verified |
| Console errors on authenticated pages | not_verified |
| Unauthenticated `/sign-in` renders and hydrates | passed (diagnostic above, headless, owner's server) |

### Not done in this pass

- Kompetanseplan (reference 20), Teamkompetanse (reference 21) and Mine ferdigheter (reference 22) were not changed. Roadmap participation layout was not changed.
- No task was marked Done. No commit, push, deploy, stash or reset was performed.

## Pass 8 — Projects API 500, accessibility, responsive fixes, authenticated browser review (2026-11-07)

Approved scope: read-only authenticated browser verification with a temporary, isolated session for the owner's account (project `devpulse-ac26e`, owner UID verified before minting). Tokens stayed in memory only; the browser context was closed and credentials discarded. No Firestore writes, no rule changes, no commits.

### Root cause: `/api/teams/demo-team/projects` returned HTTP 500 (`read_failed`)

- Confirmed with a temporary live diagnostic (since deleted): the Admin read returned 7 documents, and the membership and role resolution succeeded. Every row then failed `parseStoredTeamProject` because `projectId` was `""`.
- Cause: stored project documents do not contain a `projectId` field. The production read store returned `doc.data()` only, so the gateway's identifier was missing. Writes never store one either; the document id is the only identifier.
- Why tests missed it: the fixture in `list-team-projects.test.ts` writes `projectId` into every stored row, which real documents never have.
- Fix: `mapTeamProjectDocs` (`list-team-projects.ts`) takes the id from `doc.id` and is used by the default store. The participations loader already used `doc.id`.
- Regression tests (`list-team-projects.test.ts`): a stored document whose only identifier is its document id is read; the id comes from the document, not from a stored field.
- Live verification after the fix (read-only, temporary diagnostic, deleted): `listTeamProjects` for demo-team returned `ok` with 7 projects.
- Did not change Firestore data, security rules or superadmin permissions.

### CSP: no violation in this repository

- The `style-src` "Applying inline style violates…" messages came from a different, stale dev server on `localhost:3000` that sends a nonce-based CSP. The repository's dev server on `localhost:3001` sends no CSP header, and its run logged no CSP messages.
- No CSP is defined in this repository (`next.config.ts`, `app/`, `src/`). Production CSP is not covered by this evidence; it is an open item for deployment review.
- Gantt bar positioning was not affected in the repository's own app.

### Accessibility and responsive fixes

- Teamkompetanse coverage table (`TeamCompetenceCoverage.tsx`): the horizontally scrollable container is a named region (`Dekning per kompetanseområde`) with `tabIndex={0}`. Axe `scrollable-region-focusable` was flagged at 320 px and is cleared. Test added (`TeamCompetenceCoverage.test.tsx`).
- Trade-off: the region is a tab stop at every width, even where nothing scrolls. Tab order: reached after 8 presses on the page at 320 px.
- Roadmap participation grid and Gantt timeline (`ParticipationPanel.tsx`, `ProjectGantt.tsx`): same treatment, labelled with distinct copy keys (`planScrollRegion`, `participationScrollRegion`) so they do not duplicate the section headings.
- Roadmap at 320 px had a 351 px scroll width: the shared `Section` action wrapper used `shrink-0`. Changed to `max-w-full` (`src/components/ui/Section.tsx`), so the action wraps. The project card title now has `min-w-0` (`ProjectGantt.tsx`), which stops the status pill overflowing its card at 320 px.
- Minor: the "Utenfor valgt periode" label is now on a `bg-surface` background, so the today marker no longer runs through the text. The participation grid corner cell reads "Medlem" (reference 19) instead of repeating the section heading.

### Authenticated browser review (after all changes, final pass)

Run: 7 views × 5 widths (320, 360, 768, 1024, 1440), 35 captures, all clean. Screenshots: `.verify-output/design-review-2026-11-07/` (git-ignored); summary in `summary.json` in the same folder.

- Horizontal page overflow: none at any width.
- Axe (WCAG 2.0/2.1 A and AA) at 320 and 1440: no violations.
- Console errors and failed requests: none (the earlier 500s are gone).
- Roadmap Gantt: 5 bars and 7 project rows at 768 px and wider; the 6-month toggle keeps the same bar count (bar geometry for 3 vs 6 months was not measured per bar; see gaps). Status filter "Pågår" leaves 3 rows and 3 bars. Group header toggles collapse and expand (`aria-expanded` changes true → false → true). At 320–360 px the mobile cards show the same 7 projects.
- Keyboard: Tab from the top of Teamkompetanse at 320 px reaches the coverage region after 8 presses.
- Demoteam roster: the roster is `TeamRosterSection` on the team Oversikt page (`/teams/demo-team`); it is in the Oversikt capture. `/me/goals` was checked by screenshot (`06-personal-goals-*.png`); no text-based detector was used for the result.

### Reference comparisons (references 18–22 in `docs/design/references/`)

- **19 Roadmap:** the layout structure matches (plan with 3/6-month toggle, grouped plan, participation below). Differences: the reference header shows description and counts, ours shows only the team name; the reference uses one colour per project, ours uses a single neutral tone for most bars; the participation grid in the reference shows member bars, ours shows mostly empty rows in the current demo window. Changed: label background over the today marker; "Medlem" column header.
- **20 Kompetanseplan:** not matched. The reference is a Gantt plan with stage bars and a detail list. Our page is still the interim competence-stage list (TASK-006, Ready, not started). Every area card reads "Kompetanseområdet er ikke tilgjengelig" because demo-team has 5 competence plans but no `competenceAreas` documents (`competence-areas` returns 0 areas; plan `treeId`s do not match). This is seed data, not code: fixing it requires writing to shared Firebase data, which was not approved.
- **18 Oversikt:** not matched. The reference is a summary dashboard (KPI tiles, current projects, competence donut, challenges, next steps). Ours is the older dense layout with plan editing, forms and visibility controls. This is TASK-008, which has not started.
- **21 Teamkompetanse, 22 Mine ferdigheter:** not compared in this pass. Coverage region fix applied to 21; no design change.

### Quality gates (this pass, final code)

- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0, 0 errors, 18 warnings. One warning is in a changed file (`TeamCompetenceCoverage.test.tsx`, line 12, `react-hooks/exhaustive-deps` on a mock) and was present before this pass.
- `pnpm test` (full Vitest suite): exit 0. 584 test files passed, 3 skipped; 9,958 tests passed, 16 skipped.
- Focused runs (team-projects, Section, team-skills): 61 files and 982 tests passed before the last label/copy edits; the full suite covers them after those edits.

### Remaining gaps

- Oversikt (TASK-008) is not redesigned; reference 18 is not matched.
- Kompetanseplan (TASK-006) is not started; reference 20 is not matched. Competence areas for demo-team are missing (seed data), so every plan card falls back to "unavailable".
- Production CSP and headers are not covered by this evidence.
- 3- vs 6-month bar geometry was not measured per bar; only bar counts were checked.
- Mine ferdigheter (22) and Teamkompetanse (21) design comparisons are not done.
- Independent review and owner acceptance are not done. No task is marked Done.

## Pass 6 evidence (redesign session, 2026-11-07)

**Blocked: Demoteam competence-area repair (session item 1).** Not performed. Reason: no working Firebase Admin credential in this environment. The `FIREBASE_PRIVATE_KEY` in `.env.local` is stored as a one-line value with literal `
` separators, and firebase-admin rejects it (`ERR_OSSL_UNSUPPORTED` after normalisation). The key was not printed, edited or replaced. No Firebase writes were made. The repo's demo-team seed (`src/features/demo-team/fixtures.ts`, `plan.ts`) writes no `teamCompetenceAreas` or `teamCompetencePlans` documents, so the five plans were not created by this repository. Needed to unblock: a valid service-account key in `.env.local` (owner action) and the owner's read of `teamCompetencePlans` and `teamCompetenceAreas` for `demo-team`. Browser verification also needs `DEVPULSE_VERIFY_EMAIL` and `DEVPULSE_VERIFY_PASSWORD`, which are unset here.

**TASK-006 (Kompetanseplan), code change only.** Added a derived card status (`Ikke startet` / `Pågår` / `Fullført` / `Ingen steg ennå`) from milestone counts (`src/features/team-competence-plan/domain/plan-presentation.ts`), and Norwegian milestone dates (`15. jan. 2027`) instead of raw ISO strings. Tests: `plan-presentation.test.ts` (7 tests); feature folder 5 files / 50 tests pass. Not done: the reference-20 layout (timeline with 3/6-month switch, goals side panel, team-needs ranking, detail cards with action rows), and any browser or screenshot check. TASK-006 stays as it was, not Done.

**TASK-008 (Oversikt).** No change in this pass. The earlier KPI cards and Neste steg are present; the browser comparison with reference 18 was not run (no authenticated session).

**Gates (this pass):** `pnpm typecheck` exit 0. `pnpm lint` exit 0 (0 errors; 18 warnings repo-wide, none in files changed here). `pnpm exec vitest run src/features/team-competence-plan` 5 files, 50 tests passed.

## Pass 7 evidence (recovery and implementation, 2026-11-07)

**Correction to Pass 6.** The "malformed key" finding was wrong. The key in `.env.local` is valid. My earlier normaliser was faulty. The Demoteam seed's own loader (`scripts/seed-demoteam.mjs`: `FIREBASE_PRIVATE_KEY.split("\n").join("
").trim()`) produces a PEM that `crypto.createPrivateKey` accepts, and the Admin SDK connects with it. The key was not printed or changed.

**Competence-area repair: performed (approved scope).** Root cause: the five seeded plans (`teamCompetencePlans/demo-team__<treeId>`) reference five existing `skillTrees` docs, but `teamCompetenceAreas` had **zero** documents, so every plan resolved to "Kompetanseområdet er ikke tilgjengelig". Repair: five create-only writes, `teamCompetenceAreas/demo-team__{treeId}` with `status: "active"`, `sortOrder` 0–4 and the six persisted keys, for `demoteam-typescript-frontend`, `demoteam-appsec`, `demoteam-test-automation`, `demoteam-cloud-platform`, `demoteam-system-architecture`. A dry run preceded the write. Rerun: all five report "exists, left unchanged". Read-back: shape, types and doc-id match on all five. This was checked against the persisted shape in `competence-area.ts`, not by running the app's own parser. Nothing else was written: no plans, skill trees, consent, assessments, permissions or superadmin records.

**Browser authentication: not recovered in this pass.** The repository has no custom-token verification script. Searches for `createCustomToken`, `signInWithCustomToken` and the owner UID found only the seed scripts. The previous session's method is therefore not in the repo. No token was minted, printed or stored. The browser flow (localhost:3001, Playwright) was not run, so there are no browser-verified results for this pass.

**TASK-006 Kompetanseplan, code changes:**
- `domain/plan-presentation.ts`: derived card status (Ikke startet / Pågår / Fullført / Ingen steg ennå) and Norwegian date labels.
- `domain/plan-timeline.ts`: 3- or 6-month window (passed in, never read from the clock), bars spanning each plan's dated steps, clipped to the window, markers per step, and the next open steps (earliest first, archived excluded).
- `components/CompetencePlanOverview.tsx`: timeline card with a 3/6-month toggle (`aria-pressed`), month columns, status-plus-count bar labels, mobile notice, "Neste steg" and "Teamets behov" (ranked by priority) side cards. Uses only plan data: no member data, averages or invented metrics.
- `CompetencePlanSection.tsx`: overview placed above the card list, which now has a visible "Detaljer og tiltak" heading. Milestone dates are Norwegian.
- Tests: `plan-presentation.test.ts` (7), `plan-timeline.test.ts` (8), `CompetencePlanOverview.test.tsx` (5), and the existing section test queries scoped to the details list.
- Not done: the reference-20 visual match (layout fidelity, spacing, the goals checklist, dark theme) and any browser or screenshot check at 320–1440 px. TASK-006 status is unchanged.

**TASK-008 Oversikt:** no change in this pass; the existing KPI cards and Neste steg remain. Reference-18 comparison is still open.

**Gates (this pass):**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (0 errors; 3 warnings in the repo, none in files changed here).
- `pnpm test`: exit 0. 587 test files passed, 3 skipped; 9,978 tests passed, 16 skipped.
- `pnpm build`: not run. It would touch the same `.next` directory as the owner's dev server on 3001.

**Still open:** browser authentication (the previous custom-token method must be re-located or re-approved), browser and screenshot checks for references 18–22, and the Teamkompetanse and Mine ferdigheter visual work.

## Pass 8 evidence (2026-11-07): Oversikt, parser check, authenticated capture

**Competence-area parser check (real gateways, read-only).** A temporary vitest file (deleted after the run) called the real `listCompetenceAreas` and `listCompetencePlans` with the app's own Firestore read path and a stubbed token verifier for the approved owner UID. Result: 5 areas, all `active` and named. 5 plans, each resolving to an active named area: `demoteam-appsec` 4 steps, `demoteam-cloud-platform` 2, `demoteam-system-architecture` 2, `demoteam-test-automation` 3, `demoteam-typescript-frontend` 3. The root cause of the "ikke tilgjengelig" state was the empty `teamCompetenceAreas` collection, and the repair is in Pass 7.

**Authenticated visual capture (approved custom-token scope).** A temporary helper outside the repo (`scratchpad/visual/run.cjs`) checked project, UID and email with the Admin SDK, minted an in-memory custom token, and signed in through the Firebase web SDK in an isolated Playwright context on localhost:3001. The token was not printed, persisted or put in a URL, and the context was closed afterwards. No Firebase writes, no admin actions.
- Captures: 5 pages x 5 widths (320, 360, 768, 1024, 1440), full-page PNGs in `scratchpad/visual/shots/`: `01-oversikt`, `02-roadmap`, `03-kompetanseplan`, `04-teamkompetanse`, `05-mine-ferdigheter`.
- Horizontal overflow: 0 px on every captured page and width.
- Console errors: 0. Failed requests (status 400 or above): 0.
- Viewed directly: Oversikt at 1440 and Kompetanseplan at 1440. The 320–1024 captures and the Roadmap, Teamkompetanse and Mine ferdigheter captures were not yet compared visually.

**Oversikt (TASK-008), code change.** The KPI row and "Neste steg" sit as before. "Utfordringer" (open challenges and the submission form) moved into the same two-column row beside Neste steg, above the activity zone. Reference 18 places the challenges panel there. The layout contract tests were updated to match (`TeamDetail.test.tsx`, `team-overview-order.test.ts`); this amends the earlier "decision B" placement, which put challenges beside competency needs. Tests: `src/features/teams`, 64 files / 1,057 tests passed.
- Reference 18 gaps still open: "Aktuelle prosjekter" and "Teamets kompetanse (aggregert)" donut panels are not shown (no extra reads were added, so no fabricated data). The team header shows system and area counts; the member count and description are not shown (documented deviation). Mobile and tablet were not yet reviewed visually.

**Kompetanseplan (TASK-006), code change.** The timeline card no longer stretches to the side column's height (`self-start`). Visual check at 1440 with the five real plans: month columns, bars, progress labels and step markers render, and the Neste steg and Teamets behov panels show Norwegian dates and priorities.
- Gaps against reference 20: no "Mål for kompetanseutvikling" goals checklist (no goal data exists in the plan model); the bar label uses plan status, not a per-step timeline; mobile (320–768) layout not yet reviewed visually. TASK-006 is therefore In Progress.

**Gates (this pass):**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (0 errors; 18 warnings, none in changed files).
- `pnpm test`: exit 0. 587 files passed, 3 skipped; 9,978 tests passed, 16 skipped.
- `pnpm build`: not run. It would touch `.next`, which the owner's dev server on 3001 is using.

**Remaining gaps:** mobile and tablet review of Oversikt and Kompetanseplan; visual comparison of Roadmap (19), Teamkompetanse (21) and Mine ferdigheter (22); the goals checklist and aggregate panels of references 18 and 20; an isolated `pnpm build` run.

## Pass 9 evidence (2026-11-07): acceptance review, references 18–22

**Capture.** Authenticated custom-token flow, isolated context, read-only: 5 pages x 5 widths (320, 360, 768, 1024, 1440). 25 full-page PNGs in `scratchpad/visual/shots/`. Results: 0 console errors, 0 failed requests (400+), 0 px horizontal overflow on all 25 captures, sign-in gate not shown.

**Changes in this pass.**
- Oversikt KPI cards: two columns from 360 px (previously one column, which made the landing page about 8,700 px tall at 360).
- Kompetanseplan timeline card: `self-start` (no stretch to the side column).
- Team projects Gantt (Roadmap): label column `w-56` → `w-64`, status badge and Rediger/Arkiver on one wrapping line. Team-projects tests: 10 files / 167 tests passed.

**Reference comparison.**
- **18 Oversikt:** matches the structure (KPI row; Neste steg and Utfordringer side by side). Differs: "Aktuelle prosjekter" and "Teamets kompetanse (aggregert)" panels not shown. Project data is loaded only inside the KPI summary as counts; turning it into a list is possible without new reads, but it is not implemented. The aggregate panel needs D2 (averages). Header shows system and area counts, no member count or description (documented deviation).
- **19 Roadmap:** geometry verified at 1440 px (today line at 7 nov, bars at the correct months, 3/6 toggle). Differs: the real page keeps per-row Rediger/Arkiver (required functionality) and a Gantt per member below the plan; the reference is more compact. Row density was improved; no legend.
- **20 Kompetanseplan:** structure matches (timeline with 3/6 toggle, status labels, priority ranking, next steps). Intentional difference: the "Mål for kompetanseutvikling" goals checklist is not shown. The plan model has no goals; milestones are steps, not goals. Using them as goals would be a new data model, so this needs a product decision.
- **21 Teamkompetanse:** intentional difference. The reference shows numeric averages, a radar chart, an averaged level bar chart and a trend line. These are forbidden by the current privacy rules and are blocked by D2 (radar, averages, trends) and D1. The real page shows categorical coverage per area with the k-anonymity threshold text. Correct for the privacy model; no averages are shown.
- **22 Mine ferdigheter:** intentional difference for the same reasons (averages, radar, trend, sharing toggle, role-direction panel). The real page keeps private self-assessments with the consent text. Skill cards remain a single long column (11 cards at 1440). Not changed in this pass.

**Acceptance decisions (TASKS status).**
- **TASK-006:** stays In Progress. Functional criteria met with real data (five plans render, dates and statuses correct, 3/6 switch works, 360 px mobile readable). Not done: keyboard navigation was not exercised in the browser; mobile captures at 320, 768, 1024 were not reviewed visually. The goals checklist is a documented intentional difference pending a product decision.
- **TASK-008:** stays In Progress. Open: project list and aggregate panel (aggregate needs D2), 768/1024 review.

**Gates (this pass):**
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0 (0 errors; 18 warnings, none in changed files).
- `pnpm test`: exit 0. 587 files passed, 3 skipped; 9,978 tests passed, 16 skipped.
- `pnpm build`: not run (would touch `.next` used by the running dev server).

**Product decisions needed:** D1 (default sharing), D2 (averages, radar, trends), and a decision on whether goals come from an existing source.

## Pass 9 evidence (2026-11-07)

**Changed files (this pass):** `src/features/team-competence-plan/components/CompetencePlanSection.tsx` (milestone goals checklist),
`src/features/team-competence-plan/copy.ts` (`checklistHeading`), `src/features/team-competence-plan/components/CompetencePlanOverview.tsx`
(timeline breakpoint `sm`→`lg`, two-column split `lg`→`xl`), `src/features/teams/components/TeamOversiktProjects.tsx` (new compact
project list), `src/features/teams/components/TeamOversiktProjects.test.tsx` (new, 8 tests), `src/features/teams/components/TeamOversiktSummary.tsx`
(reuses the existing projects read; renders the list), and the TASKS.md status lines for TASK-006 and TASK-008.

**Quality gates (run in this pass):**
- `pnpm typecheck`: exit 0 (after the final code change set, before the 1024 px breakpoint edit; the breakpoint edit is CSS-only).
- `pnpm lint`: exit 0, 0 errors, 18 warnings (pre-existing; none introduced by this pass's files were checked individually).
- `pnpm test`: exit 0, 588 files passed, 3 skipped; 9986 tests passed, 16 skipped.
- `src/features/team-competence-plan`: 7 files, 63 tests passed after every change, including the breakpoint edits.

**Authenticated browser check (read-only, isolated context, localhost:3001, custom-token sign-in, token never printed or stored):**
- Readiness-gated capture: 25 of 25 screenshots taken after the page showed content and no loading text, 0 console errors, 0 failed requests, 0 px horizontal overflow (run before the 1024 px breakpoint edit).
- Kompetanseplan keyboard (1440 px): Enter on "Vis steg" expanded the plan (checklist list count 0 → 1); focus outline style `solid`; checklist rows show glyph plus status text, e.g. "✓ … (Fullført)", "◐ … (Pågår)", "… (Planlagt)"; Space on "3 måneder" set `aria-pressed=true` and rendered 5 timeline rows.
- Visually inspected after readiness: Kompetanseplan 1440 and 320 px; Oversikt 1440 and 320 px (project list present, KPI cards, Neste steg, Utfordringer and roster section preserved); Oversikt 768 px and Kompetanseplan 768 px.
- Defects found and fixed in this pass: (1) Kompetanseplan at 768 px: the 6-column timeline was too narrow (month headers wrapped, bar labels cut). Fixed by moving the timeline to `lg`. (2) Kompetanseplan at 1024 px: the two-column layout left the timeline about 350 px wide, so month labels overlapped. Fixed by moving the two-column split to `xl`.

**Not verified / open (blocks Done for TASK-006 and TASK-008):**
- Re-capture after fixes (1) and (2) is pending: the last two capture attempts failed. The sign-in succeeded, but the `/teams` list returned "Noe gikk galt under lasting av team" (a server-side error on the authorized teams read). The API responds normally to unauthenticated requests (401 in about 0.02 s), so the error is inside the authorized read. Its cause could not be determined from here (no server log access in this session). Re-run `run.cjs` once the teams read works, then inspect 768 and 1024 px for Kompetanseplan, and 360, 768 and 1024 px for Oversikt.
- Teamkompetanse (reference 21) and Mine ferdigheter (reference 22) were captured in the earlier run but not visually inspected in this pass.
- Roadmap timeline geometry (reference 19) was not re-checked in this pass.
- Mobile keyboard flow for the checklist (320 px) was not exercised; only the desktop keyboard path was.

**D1 Option B:** unchanged. The proposal remains `D1-OPTION-B-PROPOSAL.md`. No consent records, notice versions, Firebase rules, shared Firebase data or superadmin permissions were modified.

## Pass 10 evidence: authenticated teams-read diagnosis (2026-11-07)

**Failing requests (read-only diagnostic, status only):** `GET /api/me` → 503 `{"error":"auth_unavailable"}`; `GET /api/teams` → 503
`{"status":"auth_unavailable"}`. The `/teams` page shows "Noe gikk galt under lasting av team" as a result.

**Path:** `src/features/auth/server/verify-identity.ts`. A fence read that throws maps to `auth_unavailable` (fail closed, D-AUTHFAIL).
The 401 path is excluded: the custom-token session has no email claim, so it would return `invalid_token`, not 503.

**Root cause (verified):** the Admin SDK reads of `accountErasures/{owner uid}` and of `teamMemberships` (by uid) both fail with
`code=8 RESOURCE_EXHAUSTED: Quota exceeded` on the configured Firebase project. Admin Auth lookup succeeds, so the credential is valid.
The probe was re-run and still fails. The application behaves as designed (fails closed); no application defect was found.

**Contributing factor:** this session's repeated authenticated capture runs (roughly 25 page loads each, plus retries and diagnostics)
very likely consumed the project's daily Firestore read quota. This is an inference, not verified from usage data.

**Not done:** no quota change, no shared-data write, no rules change, no emulator switch. Those need the owner's decision.
Resume the authenticated checks after the quota resets (Firestore quotas reset daily). Then run `diag2.cjs` (status check), then the
readiness-gated capture, then the 360/768/1024 px Oversikt and 768/1024 px Kompetanseplan inspections.

**Status:** TASK-006 and TASK-008 remain In Progress. Their open items are the post-fix tablet checks and the 360 px Oversikt check.

**Quota status check (final acceptance attempt, 2026-11-07):** one read-only status check. Firestore still returns `RESOURCE_EXHAUSTED: Quota exceeded` for both the fence read and the membership query. Authenticated browser checks were not run. TASK-006 and TASK-008 remain In Progress.

## Pass 11 evidence (2026-11-07): Kompetanseprofil radar, collaborative composition, settings shell

Scope: implementation slice listed in TASKS.md (IMP-R1, IMP-R2, IMP-S1, IMP-T1). Not a completion record; TASK-006 and
TASK-008 remain In Progress.

**Commands and results (automated, no Firebase calls):**

- `node_modules/.bin/vitest run src/features/team-competence-profile app/route-groups.test.ts src/features/team-skills`
  → 33 files, **725 passed**, 4 expected-to-fail (the team-skills regression cases A1–A4, unchanged).
  - New feature folder: 4 test files, 46 tests (radar domain model, collaborative composition, radar component, settings
    section).
- `node_modules/.bin/tsc --noEmit` → **0 errors** (after two fixes: a redundant status comparison in the radar component,
  and a comparison against a type that cannot be `0` in a domain test; the test now asserts the exact value list).
- `node_modules/.bin/eslint` on the new feature folder, the settings route and `app/route-groups.test.ts` → **no findings**.

**Fixes made during verification (recorded for traceability):**
- Component tests needed `// @vitest-environment jsdom` and explicit `cleanup`, matching the existing component tests.
- The route registry test failed on the new page URL; the expected list was updated (IMP-T1).

**What these checks show:**
- Radar: 3, 4 and 5 axes render one point per axis; partial and missing values never become zero; target-only axes keep
  their target; the table and summary match the chart data; invalid input shows an error and no chart; no average,
  contributor count or decimal wording appears; no string names anonymity.
- Collaborative composition: archived and inactive areas are excluded, their needs are ignored, unset values stay null, and
  stored invalid values pass through so the radar model rejects them.
- Settings section: automatic is the checked default; collaborative is disabled with the reason; no fetch is made; no save
  control exists.
- k = 5: the team-skills suite passes unchanged, so the current contract's behaviour is verified as unchanged.

**Not verified in this pass (explicitly deferred):**
- Browser checks at 320, 360, 768, 1024 and 1440 px; light and dark mode; axe. No browser was run.
- The Recharts stroke values use CSS variables (`var(--chart-1)`, `var(--text-secondary)`) on SVG attributes. Confirm in a
  browser before any radar is wired into a page.
- Teamadmin-only gating of the settings page (see BLK-8).

**Not done (blocked):** the list in TASKS.md, BLK-1 to BLK-8.

## Pass 12 evidence (2026-11-07): radar offline verification and rendering fixes

Scope: IMP-R1 radar component, verified offline. TASK-006 and TASK-008 remain In Progress. The radar is **not mounted** on any page (BR-26 and D2 still in force; see SPEC "Owner decisions (2026-11-07)", R-1 pending).

**Defects found and fixed (actual rendering defects):**
1. Missing values were drawn at the chart centre. Recharts 3.10.1 maps a nullish value to radius 0 (`lib/polar/Radar.js`, `radius = isNullish(pointValue) ? 0 : …`), so `connectNulls` cannot create a gap. Fix: `GapAwareRadarShape` in `KompetanseprofilRadar.tsx` draws a closed polygon only when every axis has a value; with a gap it draws open polylines per run (no closing edge across a gap) and a dot for a lone value.
2. Angle labels were clipped at 320 px (left and right labels outside the SVG). Fix: `outerRadius` 72% → 60%.

**Automated checks (no Firebase calls):**
- `vitest run src/features/team-competence-profile` → 5 files, 51 tests pass (includes the new `radar-gaps.test.ts`, 5 run-splitting cases).
- `tsc --noEmit` → 0 errors (after replacing a `null` return with `<g />` to satisfy the Recharts shape type).
- `eslint` on the changed component and the new test → no findings.

**Offline browser checks (isolated Vite bundle of the component with synthetic fixtures, in the scratchpad; Playwright Chromium; not in the repo):**
- Axis counts 3, 4, 5 and 8: label count, table row count and axis count all equal (40 of 40 matrix cells pass: 4 axis counts × 2 themes × 5 widths).
- Widths 320, 360, 768, 1024 and 1440 px: no horizontal page overflow; no angle label outside the SVG (0 clipped at every width after fix 2).
- Missing values: no vertex at the centre (0 hits in all cells); the `Ikke satt` cell count matches the fixtures.
- Team polygon stroke resolves to `rgb(11,107,99)` in light and `rgb(95,195,181)` in dark (`--chart-1`). Target stroke resolves to `rgb(80,97,107)` in light and `rgb(181,197,193)` in dark (`--text-secondary`). The target is dashed `4px, 3px` in every cell.
- Network: the only host requested is the local bundle server. No Firebase or Google host was contacted.
- Console: no errors or warnings.
- Screenshots: light at 320 px reviewed visually before the fix (clipped side labels were seen). After the fix, label clipping was re-measured with bounding boxes at all five widths (0 clipped); no new screenshot was reviewed after the fix.

**Not verified:** axe (not run in this pass); keyboard focus inside the table scroll region at 320 px; a real page in the app shell (the radar is not mounted anywhere).

## Pass 13 evidence (2026-11-07): radar approval, Teamkompetanse unavailable state, accessibility

Scope: owner approvals R-1 to R-4 recorded in SPEC.md ("Owner decisions (2026-11-07)", approved product direction). Security changes for k = 3 remain pending formal review and are **not applied**: `SKILL_COVERAGE_MIN_CONTRIBUTORS` = 5, SECURITY invariant 34 and the notice version are unchanged.

**Integration decision:** the radar is not mounted with values. No approved data source yields numeric team levels to Teamkompetanse (the page reads categorical coverage only; invariant 35). Showing the radar with target-only data would state that team levels are "not set" for every area, which is not true, so the Teamkompetanse "Radar" panel shows an honest unavailable state with no values (`TeamCompetenceCoverage.tsx`, DisabledPanels). The trend panel stays disabled (D2).

**Defect fixed (accessibility):** Recharts' default accessibility layer added a focusable `<svg role="application">` with no accessible name, which was a separate tab stop. Fix: `accessibilityLayer={false}` on `RadarChart`. The visible table is the text alternative. Keyboard check after fix: one tab stop, the table region (`role="region"`, named), in both themes.

**Automated checks:**
- `vitest run src/features/team-skills src/features/team-competence-profile app/route-groups.test.ts` → 34 files, 730 passed, 4 expected-fail (the team-skills regression cases A1–A4, unchanged).
- `tsc --noEmit` → 0 errors.

**Offline browser checks (isolated harness, synthetic fixtures, no Firebase, only the local host requested, no console errors):**
- axe-core 4.14.0 on each axis case (3, 4, 5, 8) × light/dark × 320, 360, 768, 1024, 1440 px → 40 cells, **0 violations**. Page-level rules (`landmark-one-main`, `page-has-heading-one`) are excluded because the harness page has no `<main>` or `<h1>`. Those rules belong to the real app shell, which was not run offline.
- Keyboard: one tab stop per radar, focus outline visible (`2px solid`) in both themes.
- Matrix from Pass 12 re-run after the change: 40 of 40 cells pass (axis and row counts, no centre vertex, no overflow). Angle labels: 0 clipped at every width.

**Not verified:** the real Teamkompetanse page in the app shell (needs signed-in Firebase data; not run, quota rule); the real `<main>`/`<h1>` landmarks; native-speaker review of the new Norwegian unavailable-state copy (G4).

## Pass 14 evidence (2026-11-07): on-demand numeric aggregation, collaborative validation, BR-4

Scope: preparatory and internal work only. Nothing numeric is exposed by any route, k is still 5, no persistence was added,
and no Firebase call was made.

**Code (new unless noted)**
- `src/features/team-skills/domain/team-level.ts`: `deriveTeamLevel(levels, minContributors)`. Integer
  `floor((2·sum + n) / (2·n))`. Returns a level or `insufficient_data`. Throws on malformed levels or a threshold below 3.
- `src/features/team-skills/server/get-team-skill-coverage.ts`: internal numeric operation `createGetTeamSkillLevels`
  (not routed), in the approved coverage module. Same authorization, eligibility (`eligibleUids`) and fail-closed reads as
  coverage. Output keys are `treeId`, `areaName`, `targetLevel`, `state`, `level` only. Its runtime export is outside the
  C1 guard's approved set (see "Not verified").
- `src/features/team-skills/domain/collaborative-level-input.ts`: accepts an integer 1–4 or explicit `null`.
- `src/features/team-skills/server/decide-collaborative-level-write.ts`: teamadmin or superadmin of an active team,
  authorization before validation. No persistence.
- Removed during consolidation, to keep existing boundaries: the separate numeric reader
  `server/get-team-competence-levels.ts` (a second personal-data reader, which the C1/C2 guards forbid) and the
  `team-competence-profile` collaborative modules (a cross-feature import into C2 server code, which the C2 guard forbids).
  Their logic now lives in the files above.
- Unchanged in substance: `radar-model.ts` (`isTeamLevel` stays private).
- Docs: `individual-skill-self-assessment/SPEC.md` BR-4 and D2 amended (team-level mean exception, k=3 gated, no zero);
  `AMENDMENT-A-DRAFT.md` §A.00 (on-demand design); `G1-PRE-REVIEW-REPORT.md` superseding note.

**Tests (this pass, all passing)**
- `team-level.test.ts`: 31. Exhaustive comparison with an independent reference for all sequences of 3–5 levels; order
  independence; rounding cases; k=2/3 boundaries; k=5 pinned; invalid input throws.
- Numeric operation tests, appended to `src/features/team-skills/server/get-team-skill-coverage.test.ts`: 20 tests.
  Authorization (signed out, non-member, disabled team); eligibility (non-contributors and stale notice version excluded);
  opt-out visible on the next read; threshold; response shape allow-list; incomplete cohort; read failures return
  `read_failed` with no partial rows, including a malformed stored level.
- `src/features/team-skills/server/decide-collaborative-level-write.test.ts`: 23. Teamadmin and superadmin accepted;
  member, non-member and disabled team refused; invalid values rejected; read failure reported.
- Focused run after consolidation: the team-skills, team-competence-profile and skill-profiles suites, 57 files, 1,241
  tests passing and 1 failing (the C1 export check below).

**Gates (this pass)**
- `pnpm typecheck`: exit 0.
- `eslint` on all changed and new files: exit 0.
- Full `pnpm test` (earlier in this pass, before the BR-4 doc edit): 10,100 passing. 14 failing, all in scope guards (see
  below). No behavioural test failed.

**Not verified**
- One C1 guard assertion fails by design: `skill-profiles-scope-guard.test.ts` ("passes on the real tree: store, batch
  module, identifiers, re-exports and client boundary") reports `unapproved export createGetTeamSkillLevels` in
  `get-team-skill-coverage.ts`. The guard's approved runtime exports are `getTeamSkillCoverage` and
  `createGetTeamSkillCoverage` only. Concrete reason the factory stays exported: its tests inject fakes, and reaching the
  numeric operation through `createGetTeamSkillCoverage` would need a derivation switch that widens the active
  operation's result type. Proposed smallest reviewer-approved exception: add `createGetTeamSkillLevels` to
  `approvedRuntime` in `skill-profiles-scope-guard.test.ts`. Status: `blocked on reviewer`.
- No browser, responsive, dark-mode or axe check of any numeric UI (none exists yet).
- No emulator or Firestore run.
- The stale module comment in `self-assessed-level.ts` ("nothing may average") is unchanged and should be aligned with BR-4.

## Pass 15 evidence (2026-11-07): C1 export approval, pure radar mapping

Scope: the owner approved adding `createGetTeamSkillLevels` to the C1 `approvedRuntime` set. The approval covers the internal
factory export only. It does not authorize numeric API publication, k = 3 activation or any route. k stays 5.

**C1 guard verification (before the allow-list edit)**
- `createGetTeamSkillLevels` is defined in `src/features/team-skills/server/get-team-skill-coverage.ts` (the approved module).
- It reads personal levels only through `deps.readLevels`, which is the `readSkillLevelsBatch` adapter in production.
- Consumers: its own test file only (`get-team-skill-coverage.test.ts`). No `app/` route or other module imports it.
- The categorical operation `getTeamSkillCoverage` / `createGetTeamSkillCoverage` and its response contract are unchanged.

**Code (new)**
- `src/features/skill-profiles/skill-profiles-scope-guard.test.ts`: `approvedRuntime` gains exactly `createGetTeamSkillLevels`.
  No other allow-list or check changed.
- `src/features/team-competence-profile/domain/automatic-profile.ts`: `buildAutomaticAxes(rows)`. Value rows give the integer
  team level; `insufficient_data` and `area_unavailable` give `teamLevel: null`; `area_unavailable` is labelled
  «Område ikke tilgjengelig». Targets are passed through (null stays null). Row order is kept. A non-integer or out-of-range
  level is passed through unchanged, so `buildRadarModel` returns `invalid` (no coercion).
- `src/features/team-competence-profile/domain/automatic-profile.test.ts`: synthetic fixtures; mapping, null-not-zero, label,
  field allow-list, order, invalid levels, and radar results for 3, 4, 5 and 8 axes with missing values, plus too-few,
  too-many and empty.

**Gates (run in this pass, actual results)**
- C1 scope guard plus `team-competence-profile/domain`: 4 files, 71 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0, 0 errors, 18 warnings; none in the files changed in this pass.
- Affected suites (`team-skills`, `team-competence-profile`, `skill-profiles`): 58 files, 1255 tests passed, 4 expected fail.
- Full `pnpm test`: 597 files passed, 3 skipped; 10126 tests passed, 4 expected fail, 16 skipped. 0 failures. The 14 scope-guard
  failures recorded in Pass 14 are resolved by the approved export.

**Not done (by design)**
- No route, no GET endpoint, no numeric API publication, no k = 3 change, no SECURITY.md, notice, consent, Firebase rules or
  shared-data change. No Firebase call. No browser, responsive or axe check (no numeric UI is wired).

**Next activation boundary (minimum, after approvals)**
1. G1 independent security review and G2 privacy/legal review of the on-demand design (AMENDMENT-A-DRAFT.md §A.00, §A.14).
2. SECURITY.md invariants 34–36 amended after items 1–2.
3. G5 notice bump and transition (owner plus legal), G4 Norwegian copy review, G3 UI-UX amendment.
4. A reviewed route (approved GET endpoint) that calls `createGetTeamSkillLevels` and a DTO allow-list test. The route
   needs its own guard entry in `APPROVED_ROUTE_FILES`, and the endpoint stays inactive until step 1–3 are recorded.
5. Wire `buildAutomaticAxes` into the existing `KompetanseprofilRadar` on Teamkompetanse, then browser, responsive and axe checks.
6. Switch the threshold to k = 3 (G7 decision record retiring old test A3), then rerun the full gates.

Collaborative persistence (BLK-1, BLK-2) remains a separate track and is not changed by this pass.

## Collaborative profile slice evidence (2026-11-08, implementation turn)

Scope: the collaborative (Felles) Teamkompetanse workflow, BLK-1 and BLK-2 in TASKS.md. Owner direction (2026-11-08):
implement now; gates are recorded per activation, not as a reason to withhold local work.

- Server (already in the working tree before this turn): `src/features/team-competence-profile/server/collaborative-profile.ts`,
  routes `app/api/teams/[teamId]/profile-settings` (GET any genuine member; PUT mode teamadmin only) and
  `.../profile-settings/levels/[treeId]` (PUT level 1–4 or `null`, teamadmin only, active areas only), deny-only rules for
  `teamProfileSettings` and `teamCollaborativeLevels`.
- Client added this turn: `client/collaborative-gateway.ts` (thin fetch wrappers, field-by-field parsing, fail-safe to
  `read_failed`), `client/use-collaborative-team-data.ts`, `components/ProfileModeControl.tsx`,
  `components/TeamSettingsCompetenceProfile.tsx` (live, was read-only), `components/CollaborativeCompetenceProfile.tsx`
  (Teamkompetanse panel: automatic path or collaborative radar), `components/CollaborativeLevelEditor.tsx`,
  `components/CompetenceAreaManager.tsx` (status change; add a catalog area). Copy in `copy.ts` (Norwegian).
- Pages: `app/(app)/teams/[teamId]/competence/page.tsx` renders the panel; `settings/page.tsx` renders the live mode control.
- Member sharing controls, Teamoversikt and remaining redesign work: not part of this slice.

Gate status for this slice (recorded, not claimed as complete):
- G3 (UI-UX amendment) and G4 (Norwegian copy review): NOT done. The Norwegian strings are authored but not reviewed.
- G1, G2, G5 apply to numeric automatic publication only. The collaborative path reads no member data; it is not gated
  by them for local implementation. Production activation of the collaborative mode is a separate release decision.
- Browser and visual checks of the new controls: not run in this turn (`not_verified`).
- Independent review of this slice: not run (`not_verified`).

Checks run in this turn: `pnpm typecheck` exit 0; focused Vitest over `src/features/team-competence-profile` and the competence
route test: 12 files, 142 tests passed; `eslint` on the touched files: 0 errors (one pre-existing warning in an untouched test).
