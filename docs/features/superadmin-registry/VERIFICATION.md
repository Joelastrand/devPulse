# Superadmin registry — verification record

Status: **repository gates green (local, in-memory); Firestore emulator `not_verified`; not activated in any environment.**

## Actual results (this working tree)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | exit 0, 0 errors |
| Lint | `pnpm lint` | exit 0, 0 errors, 16 warnings (pre-existing react-hooks / unused-var warnings in test files) |
| Tests | `pnpm vitest run` (JSON report) | 2126 files, 9899 tests: 9897 passed, 0 failed, 2 skipped |
| Build | `pnpm build` | exit 0 |

## What the tests cover

- Pure registry rules (`superadmins/domain`): record and count parsing, grant, revoke, last-superadmin refusal.
- Registry operations (`superadmins/server/superadmin-operations.test.ts`): grant by verified target, idempotent grant,
  non-superadmin and self-promotion denial, stale role inside the transaction, unknown / unverified / disabled targets,
  invalid input, unauthenticated, registry read failure (`auth_unavailable`), erasure refusal, malformed count
  (`persistence_failed`), revoke, last-superadmin refusal, concurrent revocations.
- Erasure registry rules: start revoke (non-last, last refused, not-active no-op, concurrent starts), cleanup of the
  I-16 record (absent idempotent, revoked record deleted, active record through the count rule, last refused).
- Erasure start (`start-erasure.test.ts`): last superadmin refused with no fence and no step; revoke runs before the fence
  exists; unavailable revoke stays resumable with no fence.
- Migrated authorization fixtures: UID-based superadmin fakes throughout; non-admin, cross-team and revoked cases kept.

## Important caveat

The concurrency tests use an in-memory store that models Firestore's read-version conflict check. They are **not**
Firestore emulator verification. The emulator-backed race test (`erasure-fence.race.emulator.test.ts`) and any
emulator test for the registry are skipped: Java is not installed here. Emulator status: **not_verified**.

## Known gaps (not done in this increment)

- `/admin/superadmins` UI, the owner bootstrap script, and production cutover documentation: deliberately deferred.
- Revocation at erasure start is committed before the fence. If fence creation then fails, the privilege stays revoked
  and the operation returns `erasure_unavailable` (resumable). This is the safe direction; a re-grant by another
  superadmin is required to restore it.
- `APP_ADMIN_EMAILS` is no longer read by any code path. The variable is still listed in `.env.local.example`. Removing
  it from deployments is a separate, owner-approved step.
- Durable docs (`docs/SECURITY.md` TA-SI section, `docs/DATA-MODEL.md`, team-management and teamadmin SPEC/TASKS) still
  describe the env allow-list in places and must be updated before activation.
- The erasure start error `last_superadmin` (HTTP 409) needs UI copy that tells the user another superadmin must be
  appointed first.
