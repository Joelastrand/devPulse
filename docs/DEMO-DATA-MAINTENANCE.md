# Demo-data maintenance

Status: the workflow exists for the demo team's rating update. A read-only preview was run on 2026-11-17. **No live write has been performed by this workflow.** The preview found that the target state is already present (see "Current preview").

## Why demo data lives in `devpulse-nve`

The confirmed product decision is that DevPulse uses the existing Firebase project `devpulse-nve` for its current demo and test data, so the demo accounts and the demo team are available to authorized users of the deployed application. A separate Firebase project is not used, and existing demo data is not migrated away from `devpulse-nve`.

Preserved identifiers:

- Project: `devpulse-nve` (Firestore region `europe-north2`, per the existing environment).
- Demo team: `8yB2bS8Jav69TCfDETON` (`SIMULATED_CONTRIBUTION_TEAM_ID` in `src/features/team-skills/domain/skill-contribution.ts`). It is the only team the maintenance tool accepts.
- Ten fictional, disabled demo accounts (`demo-member-01` to `demo-member-10`, the `SIMULATED_CONTRIBUTION_UIDS`). Maintenance never enables them and never creates Auth accounts or memberships.

## Which records may be updated

Only the approved records of the demo team. Today this means the assessments listed in `RATING_CHANGES` (`src/features/demo-team/teamkompetanse/rating-update.ts`): 20 level changes on existing `teamSkillAssessments/{uid}__{skillId}` documents of the fictional members. The tool updates the sealed `level` envelope and `updatedAt` only. It never creates or deletes a document, and it never touches memberships, consent or Auth.

Real-user records are excluded by construction: every target uid must be one of the ten fixed fictional uids, and the team must be the demo team.

## Architecture of the existing demo data

- Seeding and maintenance code: `src/features/demo-team/` (fixtures, plans, runners, writers, CLIs). Each CLI runs with a `preflight` (read-only) mode first; the write modes repeat every gate.
- Competency assessments: stored as encrypted envelopes (AES-256-GCM v2, record-specific AAD, HKDF key separation). Writes use `sealAssessmentLevel` from `src/features/team-owned-skills/server/assessment-level-codec.ts`. Plaintext levels are never persisted.
- Consent: the simulated-consent records are read and checked (`consent.identical === 10`). The maintenance tool never writes consent.
- Aggregates: computed from stored assessments on read, under the existing k ≥ 3 suppression and simulated-data disclosure. The maintenance tool does not change either rule.

## How to preview (read-only)

The preflight reads the team, the Auth flags of the fictional uids, the catalog and the planned assessments. It performs no writes and prints only category strings and counts.

```
node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs --env-file-if-exists=.env.local src/features/demo-team/teamkompetanse/rating-update-cli.ts --mode preflight --project devpulse-nve --team 8yB2bS8Jav69TCfDETON
```

The report includes `planDigest`. That 16-hex-digit digest identifies the exact approved batch: the project, the team, and each approved (uid, skill, from, to) in list order. It contains no envelopes and no secrets.

## How write confirmation works

1. `--mode write` is never the default. Running without `--mode` prints usage and exits with code 2.
2. A write must also pass `--confirm <planDigest>`, with the digest printed by a preflight of the same batch. The check runs before any read or write. A missing digest returns `confirmation-required`; a different digest returns `confirmation-mismatch`. Neither touches the database (tests: `rating-update.test.ts`, "controlled write gate").
3. A write still repeats every preflight gate inside one Firestore transaction. Each planned record must be either already at its target (`identical`) or an approved update (`update`), with nothing `conflict` or `unreadable`. Then only the approved `update` records are changed. A run where every record is already at its target is a successful zero-write run.
4. After a write, every record is classified again. The run is `ok` only if all 109 planned records are `identical`.

The gate cannot be satisfied by copying a digest from another project or team, because the digest includes both.

## How to approve a specific update

1. Run the preflight above and read the report: `expectedUpdates`, `assessments` counts, `blockers` and `planDigest`.
2. If a write is wanted, record the approval for that specific digest in the change log, and only then run the write command with the digest. An approval of one digest does not approve a different batch.

## How to verify production visibility

Visibility is a property of the existing read paths and the signed-in account, not of the Firestore documents alone. Verify with:

- Code inspection (verified by reading, not by a live request): the aggregate route (`app/api/teams/[teamId]/team-skills/aggregate/route.ts`) delegates to `src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts`, which requires a genuine member of an active team (`requireGenuineMemberWith`), uses `SKILL_COVERAGE_MIN_CONTRIBUTORS` as the suppression threshold, and fails closed on a suspect rating. The maintenance tool does not change any of them.
- The authorized UI: sign in with an authorized account (not a fictional demo account) and open the team's competence page. A browser check is required before claiming visibility; none was run for this document.

## How to recover from a partial failure

- A preflight or a write that reports blockers writes nothing (preflight never writes; a write that fails a gate returns before the transaction or inside it).
- A write that reports `post-write-verification-failed` has run its transaction. Do not re-run blindly. Run the preflight, read the `assessments` counts, and compare them with the change log before deciding anything.
- A repeated write is safe: records already at their target are `identical` and are not written again.

## Prohibited operations

- Any write to a project other than `devpulse-nve`, or to a team other than `8yB2bS8Jav69TCfDETON`.
- Any write to a record outside the approved list, and any write that creates or deletes a document.
- Any change to Auth accounts, memberships, roles, custom claims, consent records, Firestore security rules or superadmin status.
- Enabling, impersonating or modifying a fictional demo account.
- Storing plaintext business data, or bypassing the encryption helpers.
- A collection-wide or wildcard update.
- Adding a filename exemption for a new `rating-update*` or similar script. New controlled tools need their own reviewed entry in `CONTROLLED_DEMO_MAINTENANCE_FILES` (`src/features/team-skills/team-skills-cross-cutting.test.ts`), with the write gate asserted by that guard.

## Demo-team guard

`src/features/team-skills/team-skills-cross-cutting.test.ts` keeps the purpose it had before: demo-team code must not name C2 team-skill or skill-profile data outside the approved exceptions. Two maintenance tools are exempt by exact path (`CONTROLLED_DEMO_MAINTENANCE_FILES`), and the guard asserts that each one contains the write gate and the fixed project and team. Any other file, including a lookalike name in the same directory, is still flagged.

## Current preview (2026-11-17, read-only)

Command: the preflight above, run with the project's `.env.local` loader.

- Exact Firebase project: `devpulse-nve` (checked against `FIREBASE_PROJECT_ID`; the value itself was not printed).
- Exact team: `8yB2bS8Jav69TCfDETON`.
- Records checked: 109 planned assessments (the demo team's fictional members, all ratings).
- Result: `identical` 109, `update` 0, `conflict` 0, `unreadable` 0. `blockers` empty; `ok: true`.
- `expectedUpdates`: 20 (the approved changes). Because all 20 target values are already stored, **a write would change 0 records.**
- `planDigest`: `d31ef7e4eb4cc9b6`.
- Expected production UI effect: none from a write. The stored levels already equal the approved targets.
- Records that failed validation: none.

Open question: the preflight cannot say when the 20 target values were stored. The classifier compares levels, not `updatedAt`. Whether they were written by an earlier run or seeded from the updated fixture needs a separate, read-only check of `updatedAt` on those 20 documents, which was not run.

Proposed command for the approved batch, **not executed**, and it currently changes zero records:

```
node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs --env-file-if-exists=.env.local src/features/demo-team/teamkompetanse/rating-update-cli.ts --mode write --project devpulse-nve --team 8yB2bS8Jav69TCfDETON --confirm d31ef7e4eb4cc9b6
```

Explicit approval is required before running even this. Because it would write nothing, the more useful decision is whether the live state (109 identical) is the desired state.

## Phase 2D.7 (2026-11-17): read-only verification and maintenance safeguards

**No live Firebase write was performed in this phase.** Only the read-only preflight and a read-only metadata query were run against `devpulse-nve`.

### Read-only findings

- Preflight (`--mode preflight`, same command as above): `identical` 109, `update` 0, `conflict` 0, `unreadable` 0, `blockers` empty, `ok: true`, `planDigest` `d31ef7e4eb4cc9b6`, `expectedUpdates` 20. The state matches the earlier preview.
- Metadata query of `teamSkillAssessments` where `teamId == 8yB2bS8Jav69TCfDETON` (IDs, field names and timestamps only; the sealed `level` envelope was not read or printed): 109 documents, all with `level`, `createdAt`, `updatedAt`, `uid`, `skillId`, `teamId` and `criteriaVersion`. Field sets are identical across all documents.
- Timestamps: `createdAt` is `2026-10-01T09:00:00Z` on all 109. `updatedAt` takes exactly two values: `2026-10-01T09:00:00Z` on 89 documents and `2026-11-16T09:00:00Z` on 20 documents.
- The 20 documents with `updatedAt = 2026-11-16T09:00:00Z` are exactly the 20 `RATING_CHANGES` pairs (uid and skill), with no extras and no missing targets.
- Inference limits: the timestamps show that the 20 documents were last written on 2026-11-16 and that the others were not. They do not show who wrote them, and they do not show when the intended values were first written.
- **Conclusion: no update is needed.** The 20 target values already match the plan, and a write would change 0 records.

### Maintenance tool safeguards (reviewed; behaviour unchanged)

- Project and team are fixed constants in the CLI; an argument mismatch fails before any Firebase call.
- A write requires `--confirm <planDigest>`. The digest binds the project, team and each approved (uid, skill, from, to) in order. Possession of a digest is checked only against the batch it was computed from; it is not treated as authorization.
- A write repeats every gate inside one Firestore transaction (`tx.get` then `tx.update`). A record changed after preview is classified again inside the transaction and fails closed if it is `conflict` or `unreadable`. This is the optimistic-concurrency condition.
- Writes change only `level` (sealed through `sealAssessmentLevel`) and `updatedAt`. Documents are never created or deleted; `uid`, `teamId`, `skillId`, `criteriaVersion` and `createdAt` are kept.
- Auth is read (`getUser`) only to check the fictional accounts' disabled flag. Nothing is written to Auth, memberships, roles, claims or consent.

### Exact-path guard decision

`CONTROLLED_DEMO_MAINTENANCE_FILES` (`src/features/team-skills/team-skills-cross-cutting.test.ts`) lists exactly `rating-update.ts` and `rating-update-cli.ts`. There is no wildcard. Lookalike files are still flagged by the guard. The guard asserts the write gate and the fixed project and team. **Kept as it is**: it is already as narrow as the two-file need allows.

### Production visibility (levels from the five-level model)

| Level | Status |
| --- | --- |
| 1. Documents exist | Verified (read-only query, 109 documents) |
| 2. Schema and team references valid | Verified for `teamSkillAssessments` (fields present, `teamId` matches, preflight `unreadable` 0) |
| 3. Encrypted data decodes through approved server paths | Verified by the preflight classifier (`openAssessmentDocument`, 109 decoded, 0 unreadable) |
| 4. Authorized production API returns the data | **Not verified.** Needs an authenticated request as a genuine member of the team; no authorized browser or token session was used |
| 5. Deployed UI displays the data | **Not verified.** See the browser blocker below |

Other demo categories (team metadata, projects, systems, roadmap, surveys, competence plans) were not checked in this phase; only the assessment category was in scope of the read-only checks run.

### Browser and emulator status

- Production browser verification: **not run.** No authorized presenter session was available to this run, and signing in as a fictional account is prohibited. Nothing from the UI was verified.
- Emulator verification of the update tool: the emulator tests (`rating-update.emulator.test.ts`) were not run in this phase. Use `pnpm test:emulator` for this before any future write change.

## Personal task demo seed (presenter account, 2026-11-18)

Status: **live write performed once, with the explicit approval of 2026-11-18 (Phase 3B).** The fresh preflight matched the approved
plan exactly, the gated write created the 24 records, and a read-only re-run showed 24 skips. **No further production write is
authorised.** A future run would need a new approval and a fresh preflight. Result is recorded below.

- Dataset: 24 fictional personal tasks (`src/features/personal-tasks/demo/demo-dataset.ts`): Backlog 10, Pågår 6, Blokkert 3, Fullført 5.
  Three completed within seven days of the reference date, two older (history). One overdue active task. Ids `kanban-demo-01`…`24`.
- Project: `devpulse-nve`. Owner: presenter uid `koEwzQcj5Uc0hnjTgZBLithgkYB3`. Any other value is refused before any Firebase call.
- Preflight (read-only), run on 2026-11-18: ordinary tasks of the owner 0; planned 24; create 24, skip 0, conflict 0; history 2;
  `planDigest` `bde06402be2198ef`; result ok.

Preview command (read-only):

```
pnpm seed:personal-tasks-demo -- --mode preflight --project devpulse-nve --owner koEwzQcj5Uc0hnjTgZBLithgkYB3
```

Write command (**run once**, see the result below; not to be re-run without a new approval):

```
pnpm seed:personal-tasks-demo -- --mode write --project devpulse-nve --owner koEwzQcj5Uc0hnjTgZBLithgkYB3 --confirm <planDigest>
```

Write rules: refused without `--confirm` before any read; the digest must match the plan rebuilt inside the transaction; any conflict
refuses the whole run; only missing records are created, with the approved codec and the erasure fence; a second run creates nothing.
Re-running after a partial failure: run a preflight first and compare the counts. The seed never updates, deletes, touches Firebase Auth,
memberships or consent, and never touches the presenter's ordinary tasks.

### Live write result (Phase 3B, executed)

- Project `devpulse-nve`, presenter uid `koEwzQcj5Uc0hnjTgZBLithgkYB3`. Ordinary personal tasks of the presenter: 0 (not read or changed).
- Fresh preflight before the write: planned 24; create 24, skip 0, conflict 0; status counts backlog 10, doing 6, blocked 3, done 5; history 2.
  Digest `bde06402be2198ef`, which matched the approved value exactly.
- Write: `--mode write --confirm bde06402be2198ef`. Result: **24 records created**, post-write verification passed, 0 rejected.
- Read-only re-run after the write: create 0, **skip 24**, conflict 0, ordinary tasks 0. The digest now reads `632cd699280ed69b`. This is
  expected: the digest covers the planned actions, which are all `skip` now. No other record was read as changed, and nothing was deleted.
- Decrypted task content was not printed. The seed made no Firebase Auth, membership, consent, team or rules change.
- Production visibility: the records exist in Firestore. They appear in the deployed application only after the `/tasks` route and API are
  deployed and tested through an authorised session. That deployment has **not** happened (no deployment was authorised).
