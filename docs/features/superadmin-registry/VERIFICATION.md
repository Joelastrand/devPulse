# Superadmin registry — verification record

Status: **implemented and repository gates green (local). Firestore emulator VERIFIED for the registry, concurrency, erasure
start and client-rules denial (14 of 14, review pass 2026-11-06). Authenticated browser evidence `NOT PERFORMED`. Not
activated in any environment. Final acceptance is NOT claimed.**

## Gates (current working tree, review pass)

| Gate | Command | Exit | Result |
| --- | --- | --- | --- |
| Typecheck | `pnpm typecheck` | 0 | 0 errors |
| Lint | `pnpm lint` | 0 | 0 errors, 15 warnings (all pre-existing, none in files changed here) |
| Tests | `pnpm vitest run` | 0 | 581 files passed, 3 skipped (emulator suites, no emulator in the normal run); 9934 tests passed, 16 skipped (9950) |
| Build | `pnpm build` | 0 | Routes `/admin/superadmins`, `/api/admin/superadmins`, `/api/admin/superadmins/[uid]` present |

## Firestore emulator run (review pass)

- Java: `java` is not on PATH, but Eclipse Temurin 21 is installed at `C:\Program Files\Eclipse Adoptium\jre-21.0.13.9-hotspot`.
  The run put that `bin` directory on `PATH` for the command only.
- Command: `firebase --config <scratch firebase.json> emulators:exec --only firestore --project demo-devpulse-test "pnpm exec vitest run <the two emulator suites>"`
  with `DEVPULSE_EMULATOR_PROJECT=demo-devpulse-test`. The scratch config (outside the repo) points at the repo's
  `firestore.rules` and uses port 8181, because port 8080 was already held by another local Java process that was not touched.
- Result: exit 0. `superadmin-registry.emulator.test.ts` and `superadmin-registry.client-rules.emulator.test.ts`: 14 of 14 passed.
  Covers grant/revoke with an exact control count, idempotent duplicate grant, last-superadmin refusal, five rounds of concurrent
  revocations never leaving zero superadmins, five rounds of a concurrent erasure start and revoke, a fenced grant refused
  without a write, the atomic erasure start (and its last-superadmin refusal writing nothing), active-only listing, and client
  SDK denial (get, list, write) on `superadmins` and `superadminRegistry`.
- Side effect noted: the emulator overwrites the tracked `firestore-debug.log` in the working directory. It was restored with
  `git checkout -- firestore-debug.log` after the run.
- The two suites each use their own demo project id, because they run in parallel workers against one emulator.

## Review-pass defects fixed

- `bootstrap-superadmin` wrote `grantedByUid: "bootstrap-script"`, a non-UID string in a field the erasure inventory (A-16)
  treats as a UID. It now writes `null` (`buildInitialSuperadminRecord`, unit-tested).
- The bootstrap refuses when `FIREBASE_PROJECT_ID` and `NEXT_PUBLIC_FIREBASE_PROJECT_ID` are both set and disagree.
- Operational docs and comments that named `APP_ADMIN_EMAILS` as the admin source were corrected (erasure runbook, erasure SPEC
  and TASKS, demo-team SPEC and TASKS, role-profiles and member-identity SPEC, the live demo preflight reminder, and component
  comments). Historical TASKS and VERIFICATION records are kept.
| Build | `pnpm build` | 0 | Routes `/admin/superadmins`, `/api/admin/superadmins`, `/api/admin/superadmins/[uid]` present |

## What the repository tests cover (in-memory, not emulator)

- **Registry rules** (`superadmins/domain`): grant, revoke, last-superadmin refusal, count parsing.
- **Registry operations** (`superadmin-operations.test.ts`): verified-target grant, idempotent grant, non-superadmin and
  self-promotion denial, unknown / unverified / disabled targets, invalid input, unauthenticated, read failure, erasure
  refusal, malformed count, revoke, last-superadmin refusal, concurrent revocations (optimistic-version fake).
- **Superadmin HTTP routes** (`app/api/admin/superadmins/superadmin-routes.test.ts`): the real verifier and operations run;
  only the Firebase Admin boundary is stubbed. Covers list/grant/revoke authorization (403 for non-superadmins, 401 without
  a token), a revoked superadmin refused on the next request, idempotent duplicate grant with no write, an unknown e-mail
  creating no account (404), unverified and disabled targets (409), a client `uid` in the body granting nothing (400), last
  superadmin revoke refused (409), two concurrent revocations never removing the last superadmin, and not-superadmin
  targets (409).
- **Page component** (`AdminSuperadmins.test.tsx`): list, confirmation before revoke (no server call until confirmed),
  cancel, success, Norwegian `last_superadmin` copy, and grant-by-e-mail with a non-leaking error.
- **Firestore rules, static** (`firestore-registry-rules.test.ts`): explicit deny-only blocks for `superadmins` and
  `superadminRegistry`, and no allow that names them.
- **Erasure start, atomic** (`start-erasure.test.ts`, in-memory transaction fake): last superadmin refused with no fence;
  revoke and fence in one transaction; a failed fence write keeps the privilege and creates no fence; non-superadmin start
  untouched; malformed count fails closed with no write.
- **Erasure client** (`run-erasure-flow.test.ts`): HTTP 409 `last_superadmin` maps to the Norwegian copy key.
- **Bootstrap core** (`scripts/bootstrap-superadmin.test.ts`): dry run writes nothing; apply grants one initial superadmin by
  Auth UID; idempotent re-run; refuses a second initial superadmin; refuses unknown, unverified, disabled and malformed
  accounts; refuses inconsistent or unreadable registry state.

## What is NOT verified

- **Erasure fence race (`erasure-fence.race.emulator.test.ts`, D-EMU).** Still skipped: it is a separate, owner-gated manual
  procedure in its own VERIFICATION file. This review pass did not run it, and it does not count toward the 14 above.
- **Concurrency under the real emulator** is now covered for the registry and the erasure start (see the emulator run above).
  The in-memory fakes remain for the unit and route tests, and are not described as emulator evidence.
- **Authenticated browser run** of `/admin/superadmins`: requires a real Firebase Auth session and a seeded superadmin. Not done.
- **Bootstrap CLI execution.** The script's dry-run and refusal paths were not executed. An attempt to run them in this
  session was denied by the sandbox permission classifier, and the attempt was not retried. The core logic is covered by
  unit tests; the CLI wiring (`firebase-admin` calls, argument parsing, exit codes) is checked only by typecheck and reading.
- **Production or shared Firebase.** Nothing was deployed, bootstrapped, or written. `APP_ADMIN_EMAILS` still appears in
  the `.env.local.example` comment and in deployment configuration that the app no longer reads.

## Behaviour changes in this change

- Erasure start no longer revokes in one transaction and creates the fence in another. It is one transaction
  (`erasure-start-atomic.ts`). A failed fence leaves the privilege in place (previously it stayed revoked).
- `revokeSuperadminForErasureStart` (the revoke-first function) and its tests were removed; the behaviour now lives in the
  atomic start.
- New routes and page under `/admin/superadmins`; the admin navigation gains a "Superadministratorer" entry.
- `superadmin-registry.test-helper.ts` now holds the shared in-memory registry used by the operations and route tests.
