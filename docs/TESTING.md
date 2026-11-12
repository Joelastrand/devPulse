# DevPulse — Testing

## 1. Layers and commands

| Layer | Runner | Files | Command | Notes |
| --- | --- | --- | --- | --- |
| Unit, domain and component tests | Vitest 5, jsdom where needed | `src/**/*.test.ts(x)`, `app/**/*.test.ts(x)`, `scripts/**/*.test.ts` (about 617 files) | `pnpm test` | Default run. Firebase is mocked or injected in most tests |
| Firestore emulator suites | Vitest | `src/**/*.emulator.test.ts` (7 files) | `pnpm test` with the emulator env set | `describe.skipIf`: they skip unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set |
| Browser verification | Playwright (`browser/playwright.config.ts`) | `browser/*.spec.ts` (9 specs) | `pnpm verify:browser` | Needs a running app and `DEVPULSE_VERIFY_BASE_URL`. Excluded from Vitest |
| Static checks | TypeScript, ESLint | — | `pnpm typecheck`, `pnpm lint` | 2026-11-11: typecheck passed; lint exit 0 with 0 errors and 19 warnings (unused disable directives, exhaustive-deps) |

Focused runs (Vitest accepts a path or name filter):

```bash
pnpm test src/features/team-owned-skills
pnpm test src/features/account-erasure/server/inventory.test.ts
pnpm exec vitest run src/features/surveys -t "minimumResponses"
```

`pnpm test` runs once (`vitest run`). Use `pnpm exec vitest` for watch mode.

## 1a. Verification tiers

Routine implementation uses the quick or standard tier. The full suite is for milestones and releases. Claude Code must not run
the whole suite after every small change. Each command is implemented by `scripts/test-tier.mjs`, which calls the local
binaries directly so it works the same on Windows and POSIX.

Selection is explicit. Name the files the current task owns:

```bash
pnpm test:quick --files src/features/team-systems/components/SystemList.tsx src/features/team-systems/server
pnpm test:standard --files src/features/team-systems
pnpm test:quick --files-from scratch/task-files.txt   # one path per line
pnpm test:quick --changed                             # every working-tree change; intentional only
```

`--files` accepts source files, test files and directories. A directory adds the test files under it. The runner prints
the selection before it runs: each test file, each source file (whose related tests Vitest picks by import graph), and the
security guards. A quick or standard run without `--files` or `--changed` fails. There is no silent default.

| Command | Includes | Use it when | Typical wall time (measured) |
| --- | --- | --- | --- |
| `pnpm test:quick --files <paths>` | The selected test files, the Vitest `related` tests of the selected source files (import graph), and the 51 security guard files. One Vitest process | Every implementation step for the current task. It is task-scoped feedback only and **not** complete verification | One component plus guards: about 25–70 s (depends on load) |
| `pnpm test:standard --files <paths>` | quick, plus every test in each feature folder that the selection touches, `pnpm typecheck`, and ESLint on the selected files | Before reporting a task done | Not measured as a whole. Typecheck alone is about 9 s |
| `pnpm test:full` | Entire Vitest suite (emulator suites skip unless `FIRESTORE_EMULATOR_HOST` is set, and the runner warns), `pnpm typecheck`, `pnpm lint` | Milestones, architecture changes, release readiness | 9 min 23 s wall time on a 16-core Windows machine (see §5 "Measured runs") |
| `pnpm test:emulator` | Only `*.emulator.test.ts` suites (8 files, including the erasure race suite) against the Firestore emulator | Changes to persistence, erasure, registry, rules, or transactions. Required before a release | About 37 s (run with the emulator already listening) |

Security-sensitive selection is automatic. The guard list is in `SECURITY_GUARD_PATTERNS` in `scripts/test-tier.mjs` and runs on
every quick and standard run, whatever the selection. It is not chosen by filename proximity, because the static guards read source
text and no import edge connects them to the code they protect. When you add a security guard, add its pattern to that list.

Task-scoped runs do not prove that unrelated code still works. Before a milestone or release, run `pnpm test:full` and
`pnpm test:emulator`. Browser verification (`pnpm verify:browser`) is required for UI changes to pages the browser specs cover, and it
needs a running app. Emulator verification is required for persistence, erasure, the superadmin registry, Firestore rules and
transactions.

Emulator rules:

- `test:emulator` **fails** when no emulator answers at `FIRESTORE_EMULATOR_HOST` (default `127.0.0.1:8080`). Without this check the
  suites would skip and report a pass.
- Start the emulator with `firebase emulators:start --only auth,firestore --project demo-devpulse-verify` (`firebase-tools` is not a
  repository dependency; see `DEVELOPMENT.md` §5). Use a `demo-` project only.
- Quick and standard never start the emulator and never need it. The emulator-dependent security guards (superadmin registry,
  erasure race) skip there, so the emulator tier must run before a release.

Flaky-test investigation: find the cause first. Check cleanup (`afterEach(cleanup)`), fake-timer restoration, unawaited async work, and
shared mocks. Do not raise a timeout globally or add retries to hide a defect. A test that fails only under full-suite load is still a
test defect until shown otherwise.

Adding a test: test the behaviour at the lowest boundary that can detect the defect (domain, server, then component). Do not repeat
the same assertion in another layer. Security tests need the negative path: unauthenticated, cross-team, invalid payload,
below-threshold, and plaintext-persistence prevention.

## 2. Test setup

- `vitest.config.ts`: `node` environment, a setup file that makes erasure fences default to not-in-erasure
  (`test/erasure-fence-default.ts`), and an alias that replaces `server-only` with a no-op (`test/server-only-mock.ts`).
- Worker count is capped at 50% of cores to keep jsdom tests stable.
- Tests use synthetic, obviously fictional fixtures. Real employee or wellbeing data is never used (`.claude/rules/tests.md`).

## 3. What is covered

Evidence is the test file names and their `describe` blocks. Coverage percentages were not measured.

- **Authorization:** `verify-identity*.test.ts`, `recent-auth.test.ts`, `teams/domain/team-authority.test.ts`,
  `genuine-membership` tests, superadmin operation tests (`superadmins/server/superadmin-operations.test.ts`).
- **Team competence:** `team-owned-skills` aggregate and manual-assessment tests, `team-skills` consent and coverage tests,
  `team-competence-plan/server/competence-plans.test.ts`.
- **Surveys and results:** `surveys/**` and `results/**` tests for thresholds, lifecycle and answer validation.
- **Personal data:** `personal-goals`, `personal-role-workspace`, `skill-profiles`, `development-conversations` server tests.
- **Erasure:** a large suite under `src/features/account-erasure/`, including the inventory guard and emulator suites.
- **Encryption storage boundary:** each converted collection has storage-boundary tests. Codec tests (`*-codec.test.ts`,
  `*-content-codec.test.ts`) use the shared assertions in `src/lib/encryption/storage-boundary-assertions.ts`, which check that:
  no business value is in the persisted payload; the envelope is v2; an authorized read decrypts; a tampered envelope is
  refused; an envelope moved to another record is refused; and a missing `ENCRYPTION_KEY` throws (no plaintext fallback).
  Store-level tests use a Firestore double that records the exact payloads: `role-profiles/server/role-store.storage.test.ts`
  (transactional read-modify-reseal), `team-skills/server/skill-needs-write-store.test.ts`, `team-owned-skills/server/team-skill-store.storage.test.ts`.
  Covered collections and their test files are listed in [`DATA-MODEL.md`](DATA-MODEL.md) §11.1. Forum threads, replies and survey
  responses are covered by `forum/domain/forum-content-storage.test.ts` (binding of each value to its record) and the
  create and read suites.
- **Known test gaps:** the invitation write path has no Firestore-double test; its payload is covered by the codec test
  (`teams/domain/team-invitation-content-codec.test.ts`) and its flows by the fake-store suites. Invitation expiration has no
  tests because it is not implemented.
- **UI:** component tests for the navigation shell, team pages and forms. These verify states and labels, not the
  browser-level layout.

## 4. Security and architecture guards

Guards are static checks. They detect drift in source text. They are **not** authorization and do not replace server tests.

| Guard | Protects |
| --- | --- |
| `src/features/account-erasure/server/inventory.test.ts` (with `inventory-guard.ts`) | Every uid-bearing path is listed in the erasure inventory |
| `src/features/superadmins/firestore-registry-rules.test.ts` | `firestore.rules` denies the superadmin collections |
| `src/features/personal-role-workspace/personal-role-workspace-repo-guard.test.ts` | Personal records are not imported by team or aggregate code (PR-SI-2) |
| `src/features/personal-role-workspace/personal-role-workspace-scope-guard.test.ts` | Scope of the personal workspace (PR-SI-2) |
| `src/features/personal-goals/personal-goals-scope-guard.test.ts` | Goals have no team or uid-parameterised reader (SI-3, SI-4) |
| `src/features/skill-profiles/skill-profiles-scope-guard.test.ts` | Skill profiles are read only by their owner and the consent-gated aggregate |
| `src/features/team-skills/team-skills-scope-guard.test.ts` | The coverage policy constant is the only source of the threshold |
| `src/features/role-profiles/role-profiles-scope-guard.test.ts`, `d2-boundary.test.ts`, `cross-feature-regression.test.ts` | Role-profile boundaries and no skill or goal reads |
| `src/components/ui/motion-audit.test.ts` | Motion rules in the UI primitives |

## 5. Expected-fail tests

These cases describe required safe behaviour that the code does not yet provide. They pass today because they are marked
`it.fails`. When a case starts failing, change `it.fails` to `it`. Do not delete the case.

- `src/features/team-skills/server/teamkompetanse-leak-regression.test.ts` — four cases (A1–A4) for the categorical coverage
  view. See `KNOWN-LIMITATIONS.md` §1.1.

### Last full run (2026-11-12)

`pnpm test`: 629 of 636 files passed, 7 skipped (the `*.emulator.test.ts` suites, which skip without an emulator), 0 failed.
Tests: 10,378 passed, 4 expected-fail, 36 skipped, 0 failed. `pnpm typecheck` passed.

Measured runs (same machine, 2026-11-12, one run each, no other test process started by this work; other Next dev servers and
Firebase emulators from other projects were already running):

| Run | Result | Wall time |
| --- | --- | --- |
| `pnpm test` (before the tier commands) | 636 files: 629 passed, 7 skipped. 10,378 passed, 4 expected-fail, 36 skipped | 9 min 23 s |
| `pnpm test` again, after the task-scoped tier change (no test file changed) | 629 passed, 7 skipped. 10,378 passed, 4 expected-fail, 36 skipped, 0 failed | 3 min 46 s |
| `pnpm test:quick --files <one component>` after merging to one Vitest process | 50 files passed, 3 skipped (guards). 686 passed, 4 expected-fail, 19 skipped | 34 s |
| `pnpm test:standard --files <one feature folder file>` | 55 files passed, 3 skipped. 795 passed, 4 expected-fail, 19 skipped; typecheck and ESLint passed | 59 s |
| `pnpm test:emulator` | 8 files, 44 tests passed | 37 s |
| Security guard set (the quick tier's guard part) | 51 files: 48 passed, 3 skipped (emulator-only). 661 passed, 4 expected-fail, 19 skipped | 11 s |
| `vitest related` for one feature component file (quick tier's changed part) | 2 files, 25 tests passed | 17 s |
| `pnpm typecheck` | passed | 9 s |

The default `pnpm test` was not made faster in this pass. Its time is mostly module import and environment setup. Vitest reports that
`isolate: false` would save about 85 s, but it shares module state between files, so it is a correctness risk rather than a free
change. It was not applied.

Emulator suites, run separately against the local Firestore and Auth emulators with a `demo-` project:
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 DEVPULSE_EMULATOR_PROJECT=demo-devpulse-verify pnpm exec vitest run emulator`
passed 8 files, 44 tests, 0 failed. The 8 files are the 7 `*.emulator.test.ts` files plus `erasure-fence.race.emulator.test.ts`
matched by the same name filter. Because these suites skip in the default run, they had not caught two problems. Three of them
(participation reassignment, membership erasure, erasure-fence race) wrote plaintext business fields into encrypted-only
collections, so their fixtures now seal values with the app's codecs. The participation transaction also read projects without
opening the sealed title, so a reassignment against an encrypted project failed closed; it now opens the title as the list
reader does. Assertions were not weakened.

Tests that are skipped by design (not failing): the emulator suites without an emulator, and one demo CLI smoke test that
runs only on Node 24 or newer (`src/features/demo-team/cli.test.ts`).

## 6. What is not tested here

- **Browser behaviour and visual layout** are verified only by `pnpm verify:browser`. Nothing in this audit ran it.
- **Live Firebase projects** are never exercised by tests. Deployment checks are operator work (`docs/operations/`).
- **Load, abuse and concurrency at production scale** are not tested. The erasure race suite runs only on the emulator.

## 7. Adding tests

- Test observable behaviour at a server, domain or component boundary. Name each test for the behaviour.
- For security-sensitive behaviour, include the negative path: unauthenticated, cross-team, invalid payload, below-threshold,
  and plaintext persistence prevention.
- Do not weaken or skip a valid failing test to make the suite pass. Record a regression as an `it.fails` case only when the
  defect is known and documented.
