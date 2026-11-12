# Superadmin registry — owner bootstrap and production cutover

Status: **prepared, not executed.** Nothing in this document has been run against any Firebase project. The bootstrap script
has been checked by unit tests and by reading the code. It has not been run against an emulator or a real project, and the
CLI's refusal paths have not been exercised end to end.

This document is for the owner's review. It is the only place the exact bootstrap command and its expected output are
recorded. Do not run any step here without an explicit owner approval for that environment.

## Why a bootstrap is needed

The superadmin registry is the single authority for global administration (`docs/SECURITY.md`, SR-SI). It starts empty.
Once the registry is the authority, no one is a superadmin until a first record exists, and only an existing active superadmin
can add another. The bootstrap creates that first record, once, for the owner account.

## Prerequisites (per environment)

1. **Code deployed** containing the registry, the `/admin/superadmins` page and the bootstrap script.
2. **Firestore rules deployed** with the `superadmins` and `superadminRegistry` deny blocks (`firestore.rules`). The Admin SDK
   is not subject to these rules; the deny blocks keep client SDK access closed.
3. **The owner's account exists** in Firebase Authentication, with a **verified** e-mail address and **not disabled**. The script
   never creates an Auth user. If the account is missing, the script refuses.
4. **A service-account credential** available to the script: either the server variables `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (the same ones the app uses), or Application Default Credentials. Do not
   commit it, and do not paste it into a shared channel.
5. **The configured project matches the target.** `FIREBASE_PROJECT_ID` (or `NEXT_PUBLIC_FIREBASE_PROJECT_ID`) in the
   `.env.local` used for the run must equal the `--project` value. The script refuses any other project before it uses a
   credential.
6. **No other active superadmin exists** in that environment. If one does, the script refuses (`initial_superadmin_exists`).
   The bootstrap is for an empty registry only.

## Command

Run from the repository root, with the environment's `.env.local` (never a file that points at another project):

Dry run (default; reads the registry and Auth, writes nothing):

```text
node --env-file=.env.local scripts/bootstrap-superadmin.ts --project <firebase-project-id> --email astrand.joel@gmail.com
```

Apply (writes exactly one record and sets the count to 1). Both `--apply` and `--confirm` are required, and `--confirm` must
repeat the project id:

```text
node --env-file=.env.local scripts/bootstrap-superadmin.ts --project <firebase-project-id> --email astrand.joel@gmail.com --apply --confirm <firebase-project-id>
```

Re-running the apply command after success is safe: it reports `NO CHANGE` and writes nothing.

## Expected output

The script prints `project:` and `mode:` lines, then one outcome line.

| Situation | Output line | Exit code |
| --- | --- | --- |
| Dry run, empty registry, account verified | `DRY RUN: would grant superadmin to uid <uid>. Re-run with --apply --confirm <project> to write.` | 0 |
| Apply, empty registry | `GRANTED: superadmin granted to uid <uid>.` | 0 |
| Apply again, owner already the only active superadmin | `NO CHANGE: uid <uid> is already the only active superadmin.` | 0 |
| Account not found | `REFUSED: target_not_found` | 1 |
| Account not verified | `REFUSED: target_unverified` | 1 |
| Account disabled | `REFUSED: target_disabled` | 1 |
| Another active superadmin exists | `REFUSED: initial_superadmin_exists` | 1 |
| Count and records disagree, or count unreadable | `REFUSED: registry_inconsistent` | 1 |
| `--project` does not match configured project | `bootstrap-superadmin: --project (...) does not match the configured project. Refusing.` (stderr) | 2 |
| `--apply` without matching `--confirm` | `bootstrap-superadmin: --apply requires --confirm with the same project id. Nothing written.` (stderr) | 2 |
| `FIREBASE_PROJECT_ID` unset | `bootstrap-superadmin: FIREBASE_PROJECT_ID is not set; ...` (stderr) | 2 |

The `uid` shown is the Firebase Auth UID resolved from the e-mail. No e-mail address is written to the registry.

## What is written

- `superadmins/<uid>`: `uid`, `active: true`, `grantedAt`, `grantedByUid: null`, `revokedAt: null`,
  `revokedByUid: null`, `updatedAt`.
- `superadminRegistry/control`: `activeCount: 1`, `updatedAt`.

`grantedByUid: null` marks the record as the bootstrap grant (no granting superadmin). UID-typed fields only ever hold a UID
or null, because the erasure inventory (A-16) treats them as person references.

## Cutover sequence (requires explicit owner approval per environment)

Each step is separate. Stop after any step that fails.

1. Confirm the target environment and project id with the owner.
2. Deploy the code and the Firestore rules to that environment (a separate, approved deployment).
3. Run the **dry run** command. Expect `DRY RUN: would grant ...` and the owner's uid.
4. Run the **apply** command with `--confirm`. Expect `GRANTED: ...`.
5. Sign in as the owner in the app and open `/admin/superadmins`. Confirm the owner is listed as an active superadmin.
6. Only then remove `APP_ADMIN_EMAILS` from that environment's deployment configuration. The code does not read it, so this
   step only removes an unused value. It is a deployment change and needs its own approval.

Rollback: there is no automatic rollback. To remove a mistaken first superadmin, an existing superadmin must revoke it through
`/admin/superadmins`. If no superadmin remains, the registry must be repaired by an authorized operator in the Firebase console,
with the count kept exact. This is a last resort and should be reviewed by the owner first.

## Not done in this change

- The script has not been executed, and no shared or production Firebase project has been written.
- The bootstrap CLI has not been run against the emulator or any project. The registry rules and transactions were verified
  on the local emulator (see VERIFICATION.md), but not the CLI wiring.
- `APP_ADMIN_EMAILS` has not been removed from any `.env` file or deployment.
