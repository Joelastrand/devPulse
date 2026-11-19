# DevPulse — Known limitations (verified)

Only items verified in the repository, or recorded in the repository's own operational documents, appear here. This is not
a feature roadmap.

## 1. Privacy and security gaps

### 1.1 Accepted residual risk: k = 3 differencing cases A1–A4 (product-owner decision)

**Status: accepted residual risk, not a fixed defect.** The product owner has explicitly accepted the residual privacy risk
of k = 3 team competence aggregation as a final product decision for the current scope. k = 3 stays. No further
differencing protections, cohort-stability mechanisms or stricter thresholds are planned, and no further approval is needed
for k = 3. The decision does not authorize raw individual assessments, and it does not bypass consent or access controls.
The full statement is in [`SECURITY.md` §12](SECURITY.md#12-accepted-residual-risk-vs-implemented-guarantees).

The categorical coverage view (`/api/teams/[teamId]/skill-coverage` through `src/features/team-skills/`, with the
skill-needs section and the consent panel rendered in the team subpages) is active and is not retired because of this risk.
Its product usefulness is evaluated separately when necessary. Four cases are recorded as expected-to-fail regression tests
in `src/features/team-skills/server/teamkompetanse-leak-regression.test.ts` (`it.fails`, labelled A1–A4 in the archived D1
proposal). They remain expected-fail and are not described as fixed:

- A single contributor's withdrawal from a cohort of exactly three does not change the published state.
- A threshold sweep over `requiredCoverage` recovers the exact contributor count at or above each level.
- A five-member team where every member contributes is published as covered or as a gap.
- A single opt-in that completes a cohort of three changes the published state on the next read.

Each case states the required safe behaviour, and the current code violates it. The tests pass only because they are marked
as expected to fail. The coverage view must not be described as protected against differencing over time. The automatic
profile (`get-team-owned-skill-aggregate.ts`) has no equivalent case in this file, and it is not proven free of the same
class of issue.

### 1.2 Operator and Admin-SDK access

The Admin SDK bypasses Firestore rules. Converted business content is encrypted at the application layer, so an operator
without `ENCRYPTION_KEY` reads ciphertext only. An operator who can read the key can decrypt it. Plaintext business content
still listed in §1.2a is readable by anyone with operator access to the project. This is an accepted residual risk. It was
stated in the archived invariants 53 and 48, and the encryption pass narrowed it but did not remove it.

### 1.2a Plaintext business content and v1 rows (status after the final encryption pass)

Every active collection that stores company business content is encrypted at the application layer, with the v2 record
envelope or a v2 envelope per value. The per-collection status, the envelope contexts, the plaintext exceptions and the tests
are the coverage matrix in [`DATA-MODEL.md`](DATA-MODEL.md) §11. No business-content collection is known to be plaintext.

- **Plaintext exceptions are metadata only**, each with its reason in [`DATA-MODEL.md`](DATA-MODEL.md) §11.2: identifiers and
  document keys, authorization metadata (`teamMemberships`, `superadmins`, `accountErasures`, team `status`/`visibility`),
  accountability and erasure uids, lifecycle timestamps, the survey threshold and access mode, and the two keyed blind indexes
  (`teamInvitations.emailIndex`, `roadmapItems.ownerRefIndex`).
- **Keyed lookup, not searchable plaintext.** Invitation matching and roadmap owner erasure use HMAC blind indexes. Their key is
  derived from `ENCRYPTION_KEY` per purpose. An operator who can read the key can compute the index of a known address, so the
  index does not hide a guessable address from that operator. This is the accepted cost of matching without storing the address.
- **Invitation expiration is not implemented.** No expiry exists in the teams code, so there is no expiration behaviour to
  secure or test.
- **Plaintext technical metadata inside converted records:** document ids, `teamId`, `treeId`, `skillId`, `criteriaVersion`,
  `updatedBy`/`createdBy` audit ids, lifecycle flags and timestamps. Erasure and team queries depend on them.
- **Team skill requirement and progress are sealed but their document keys are not.** The team and tree ids in a
  `teamSkillNeeds` or `skillProgress` id show which teams track which areas to an operator. The level, coverage and stage are
  sealed.
- **Personal skill map keys:** the tree id of each personal level is a plaintext map key, so the set of skills a person rated
  is visible to an operator. The rating itself is encrypted.
- **Operator access:** the Admin SDK bypasses Firestore rules, and anyone holding `ENCRYPTION_KEY` can decrypt every v2 record.
  Application-level encryption protects against a reader of raw Firestore data who lacks the key. It does not protect against
  operator access to the application key.
- **Legacy seed script:** the old `scripts/seed-demoteam.mjs` has been removed (it predated the envelope). The active demo seeder
  (`src/features/demo-team`, `pnpm seed:demo-team`) seals every converted collection it writes, including roadmap plans,
  progress, needs, surveys, teams, skill trees and challenges.
- **No data migration is provided.** The product owner confirmed the test data is disposable and was cleared. Any remaining
  plaintext test record is refused by the readers, not repaired.

Cryptographic limitations of the current `v2` record envelope:

- **Associated data is bound.** Every converted record is sealed with its record context as AAD, so moving a ciphertext to
  another record fails authentication. The v1 helper (`encrypt`/`decrypt`, no AAD) is no longer used for any write.
- **Key id, not key rotation.** `keyId: "k1"` is written and checked, but no key-rotation job exists. A new key needs a new
  key id, a re-encryption job and a rollout plan.
- **Key separation.** The record subkey is derived with HKDF-SHA-256 and a key-id label. The `keyCheck` is an HMAC under that
  subkey with its own label. The master key is used for no other purpose inside the record envelope.
- **Key checks reveal equality.** A stored `keyCheck` lets an operator with Firestore read access tell that two records were
  sealed under the same key. It does not reveal the key or any content.
- **Key location.** The key is read from the server environment. Its custody and rotation are operator responsibilities.

### 1.3 Logging coverage

Whether every module keeps uids, e-mails and free text out of logs was not fully traced in the 2026-11-11 audit.

### 1.4 Invariant re-verification

The archived invariants 1–72 (`docs/archive/SECURITY-2026-11-11.md`) were not all re-traced line by line in the rewrite.
The current `docs/SECURITY.md` states which controls were checked.

## 2. Operational limitations

### 2.1 Account erasure is not operationally deployed

- Code: `PRODUCTION_HANDLERS_READY = true` (`src/features/account-erasure/server/production-erasure.ts`).
- Operations: `docs/operations/account-erasure-runbook.md` records deployment as **held**. The operator gate (TASK-045) is
  incomplete. The D-EMU result is local-emulator evidence only.
- Do not describe account erasure as available in any deployed environment until that gate is complete.

### 2.2 Superadmin bootstrap has not been executed

`docs/operations/superadmin-bootstrap.md` is marked "prepared, not executed". It has not been run against an emulator or a
real project. No owner record can be assumed to exist until it is.

### 2.3 Browser verification was not run in this audit

Nine Playwright specs exist in `browser/` and run only through `pnpm verify:browser`. They require a running app and the
browser emulator setup. They were not run during the 2026-11-11 documentation rebuild, so no browser-level claim is verified
by this audit.

The 2026-11-12 encryption verification pass did not run them either. Blockers: (1) the repository's `.next` directory is
locked by another running `next dev` process, so a second dev server cannot start in this checkout; (2) a copy of the tree in a
scratch folder failed to start under Turbopack, because its `node_modules` links point back to the checkout; (3) the
`DEVPULSE_VERIFY_EMAIL` and `DEVPULSE_VERIFY_PASSWORD` variables were not set, and the specs need them for sign-in. The product
workflows (teams, invitations, roles, skill trees, surveys, competence plans, projects, roadmap) therefore have no browser-level
evidence yet. Several of them also have no Playwright spec at all, so writing one is part of that work.

### 2.4 Resolved: motion-audit failure

The full `pnpm test` run on 2026-11-11 had one failure: `src/components/ui/motion-audit.test.ts`, which requires every
`transition-colors` class to name a `duration-` token on the same line. It was fixed by adding `duration-micro` to the
rating-control className in `TeamSkillRatingControl.tsx`. The focused run of the audit and the team-owned-skills component
tests passed (36 of 36). The full suite was not re-run after this one-token change.

### 2.5 No CI configuration

The repository has no `.github/` or other CI configuration. Checks run only when a developer runs them.

### 2.6 Forum behind a UI flag

The forum thread page returns `notFound` unless `FEATURE_FORUM_ENABLED=true`. The forum API routes stay active regardless of
the flag. The flag is not a security control.

## 3. Product scope as implemented

- **System records (`teamSystems`)**: any genuine member of an active team can edit system attributes
  (`writeTeamSystem`). Whether this is the intended policy is a product decision to confirm; the code and its SPEC agree.
- **Survey thresholds** are set per survey and can be set low by the administrator. The product has no global minimum.
- **Demo data** (`DEMO_MINIMUM_RESPONSES = 5` in `src/features/demo-team/fixtures.ts`) is synthetic and not a policy value.

## 4. Technical debt

- **Teamkompetanse membership-scan ceiling (code-confirmed, no scaling solution approved).** The team-owned competence
  aggregate (`src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts`) reads the team's memberships with a
  scan limit of `TEAM_SKILL_COHORT_SCAN_MAX = 500` (`src/features/team-skills/domain/skill-coverage-policy.ts`), asking for
  501 documents to detect overflow. A team with **501 or more memberships** gets `availability: "incomplete"` and no rows,
  whatever the number of opted-in members. The aggregate is then never shown for that team.
  - Separately, `TEAM_OWNED_AGGREGATE_MAX_READS = 20000` bounds the per-person rating reads: opted-in members × active skills.
    When opted-in members × active skills exceeds 20,000, the result is also `incomplete`. With the 100-skill team maximum the budget binds at 200 opted-in
    members; with 23 skills the membership scan binds first.
  - The limits are cost bounds, not privacy thresholds. The privacy rules are unchanged: each shown level needs at least
    `SKILL_COVERAGE_MIN_CONTRIBUTORS = 3` contributors, and a suspect rating suppresses its skill.
  - The aggregate is read-only and uncached by design. Caching the decrypted, cross-person result would need a privacy
    review, and any precomputed version must still enforce k ≥ 3 at read time.
  - No scaling solution has been approved. Options (paging the scan with a documented completeness rule, or a precomputed
    aggregate) change privacy and consistency behaviour and need a product and security decision first. See
    `docs/PERFORMANCE-AUDIT.md` §5.2 and P1-5.
- **Two skill concepts.** Skill trees (`skillTrees`, `skillProgress`, personal skills, roadmap references) and the
  team-owned competence catalog (`teamSkills`) coexist. Routes are named `skills` for the tree endpoints
  (`/api/teams/[teamId]/skills`), which is easy to confuse with the team-owned `team-skills` endpoints. See `ROUTES.md` §3.
- **Legacy naming.** `gateLead` in `src/features/team-competence-plan/server/competence-plans.ts` checks superadmin or
  `teamadmin` authority. The name is a leftover of the retired `lead` role; behaviour is correct.
- **Retired collection name.** The `teamCompetenceAreas` collection is not used by the application. The reset script that
  once listed it for clearing has been removed.
- **Historical references in code.** Most comments and some test titles cite the archived feature specifications at
  `docs/archive/features/...`. These point to history, not to current requirements.
- **Test volume.** About 617 Vitest files, 7 emulator suites (skipped without an emulator), and 9 Playwright specs. Some guard
  tests read source text rather than behaviour. They detect drift but are not authorization.
- **Retired one-off scripts.** The competence-plan migration and the role-expectation cleanup were removed from the repository.
  The plaintext-write risk they carried is recorded in `DATA-MODEL.md` §10; their code remains in git history.
  The 2026-11-16 demo rating-update tool is **not** retired: it is retained as a gated maintenance tool with a digest-confirmed
  write path and a read-only preflight (`docs/DEMO-DATA-MAINTENANCE.md`). Its approval for any write remains open.
- **Demo conversation seeder has no CLI equivalent.** `scripts/seed-demoteam-conversations.ts` is still hardcoded to the legacy
  project id. Porting it into `src/features/demo-team` is an open task before it can target `devpulse-nve`.

## 5. Documentation

- The 82 feature files that described the previous build (SPEC, TASKS, VERIFICATION and proposals) are archived under
  `docs/archive/features/`. They are historical evidence, not current requirements.
- `CLAUDE.md`, `AGENTS.md` and `.claude/skills/` still describe the feature workflow (`docs/features/<id>/SPEC.md` and
  `TASKS.md`). That workflow is unchanged, but no feature currently has a live SPEC or TASKS file.
- **Admin-initiated account deletion is not supported.** Account erasure is self-only (AE-SI-1, BR-22). No superadmin endpoint or UI deletes another account; this is deferred and needs an explicit decision that amends AE-SI-1 and BR-22 (see `docs/SECURITY.md`, §10). Superadmin user management offers listing, search, details, disable and re-enable only.

## Phase 2D.7 open items (2026-11-17)

- **Production UI and API visibility of the demo team is unverified.** The read-only Firestore checks cover the assessment category only. No authorized production browser or API session was used. See `docs/DEMO-DATA-MAINTENANCE.md`, "Phase 2D.7".
- **Account-switch invalidation is covered at the gateway level.** The early `account_changing` signal is tested in `auth-client.identity.test.ts`. A component-level suite for the full ten-scenario list is not written yet.
- **Emulator tests for the demo-data update tool were not run in this phase.**

## Personal tasks (Mine oppgaver)

Full list in [`PERSONAL-TASKS.md`](PERSONAL-TASKS.md) §12. Summary:

- Drag-and-drop (dnd-kit) is implemented. Reordering is off while a search or filter is active, and while another move is unconfirmed;
  the status select remains available in those states. Touch dragging on a real device was not verified (only the emulator browser run).
- Cross-column drag shows the target column highlight, not a live reflow of the cards in the target column while dragging.
- The screen-reader announcement texts (pick-up, over, drop, cancel) are defined and wired, but their live-region text was not captured in
  the browser run; only the instructions and the cancel behaviour were verified.
- History search covers only the loaded pages (the board is bounded, so history is paged in memory).
- No optimistic concurrency token: field edits are last-write-wins per task. Positions are transactional.
- Browser verification ran against the local Firebase emulators on an isolated copy, not the deployed application. It is not production evidence.
- The demo seed was written once to `devpulse-nve` with approval (see [`DEMO-DATA-MAINTENANCE.md`](DEMO-DATA-MAINTENANCE.md)). Those
  records are visible in the deployed app only after the `/tasks` route is deployed.
- Dependency: the three `@dnd-kit` packages are approved for this feature only; any other drag library needs a new approval.
