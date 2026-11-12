# Account erasure: operations runbook and deployment checklist

Status: prepared under TASK-044 (2026-11-02). This runbook describes operator actions. Nothing in it is a product capability.

Deployment status (owner decision, 2026-11-02): HELD. The three states are separate:
- `PRODUCTION_HANDLERS_READY = true`: code-level account-erasure readiness has passed (the reviewed state).
- TASK-045 (this runbook's operator gate): Ready. Production/operator readiness has NOT passed.
- Deployment: NOT AUTHORIZED while TASK-045 is incomplete. No one deploys this code, runs the checks below against a real
  Firebase project, or changes Firebase configuration until TASK-045 is complete and its evidence is recorded.
The D-EMU PASS (owner-provided, local emulator) is code-level evidence. It does not satisfy TASK-045.
The source of each rule is `SPEC.md` ("Operational requirements (BR-21, D5, D9)", BR-21, and "Partial failure and retry (BR-15)"). Evidence fields are blank
for the operator to fill in. None of these items is marked as passed by this document.

Rules for every procedure in this file:

- Inspect status, step and error code only. Never read or export document content, e-mail addresses, or payloads.
- The operator's own log may hold the record identifier, step and outcome. Application logs never do (AE-SI-12).
- Do not claim that a provider's logs are erased. Erasure makes no claim about platform logs (item 9).

## Checklist

Actions in sections 1 to 3 (row 1 included) against a real Firebase project are performed only under the TASK-045 operator gate, and never against production before it. Rows 2 to 10 are recorded only under that gate, per environment. Row 11 (D-EMU) runs on a local emulator and is governed by its own gate.

Each row: owner role, and an evidence field the operator fills in. "Evidence" means a dated record in the operator's own
deployment log, with the command output or screenshot reference. No row is complete until its evidence field is filled.

| # | Item | Owner role | Evidence (operator fills in) |
| --- | --- | --- | --- |
| 1 | Superadmin registry: confirm the erased account's `superadmins/{uid}` record is absent after erasure, and that no `superadminRegistry/control` count is off by one | Platform operator | |
| 2 | Firestore TTL policy on `accountErasures.expireAt` | Platform operator | |
| 3 | Deploy `AE-IDX-1` before the first erasure; verify `AE-IDX-2` | Platform operator | |
| 4 | Admin SDK service account can call `deleteUser` in each environment | Platform operator | |
| 5 | Token claims: `auth_time` present; refresh does not change it; fresh sign-in does | Security reviewer | |
| 6 | uid non-reuse for the environment (AE-A1) | Security reviewer | |
| 7 | Request timeout exceeds the 20-second budget with margin | Platform operator | |
| 8 | Stuck-record procedure (8a, 8b below) reviewed and signed off before first real use | Security reviewer | |
| 9 | Platform log content and retention for uid and e-mail, per environment | Security reviewer | |
| 10 | Demo CLI refusal (BR-20) verified before any demo against a real presenter | Demo owner | |
| 11 | Manual Firestore Emulator race proof (D-EMU), recorded in VERIFICATION.md | Operator (local emulator) | |

## 1. Superadmin registry (replaces the former APP_ADMIN_EMAILS step)

Superseded 2026-11-06. The application no longer reads `APP_ADMIN_EMAILS`, so removing an address from an env allow-list does
not change admin status. Admin status is the Firestore record `superadmins/{uid}`.

- Starting an erasure for an active superadmin revokes that record and creates the erasure fence in one transaction. The
  last active superadmin cannot start an erasure (`last_superadmin`, HTTP 409). Nothing is changed in that case.
- The erasure step removes the erased account's own registry record and keeps `superadminRegistry/control.activeCount` exact.
- Operator check after an admin erasure: the `superadmins/{uid}` document for that uid is absent, and the control count
  equals the number of `active: true` records. Evidence: a read-only console check, with the date.
- Not claimed: a fresh sign-up cannot become superadmin without an explicit grant by an active superadmin.

## 2. Firestore TTL on `accountErasures.expireAt`

Configure a TTL policy on the `accountErasures` collection, field `expireAt`, in the Firebase project. The field is written
only on completion (`expireAt` is completion plus 24 hours). The repository cannot hold this policy (TASK-008 recorded it as an
operator action); it must be configured in the Firebase project. Evidence: the policy listing for the environment.

## 3. Indexes

Deploy the collection-group field override `AE-IDX-1` (a `fieldOverrides` entry in `firestore.indexes.json` for collection group `conversations`, field `participantUid`, `queryScope: COLLECTION_GROUP`) before the first erasure.
Verify `AE-IDX-2`: no field exemption exists for the uid-bearing fields listed in SPEC "Firestore rules and index implications". The index is repository
configuration in `firestore.indexes.json`. Its deployment is an operator action. Evidence: the deployed index state for the
environment, and the date.

## 4. Auth permissions

Confirm that the Admin SDK service account in each environment can call `deleteUser`. The repository has not exercised this
call against a real project. The check runs only under the TASK-045 gate, uses a disposable test account created for that
purpose, and never touches a production project or production data. Evidence: the result of that check in a non-production
environment, with the date.

## 5. Token claims (`auth_time`)

Confirm in deployment review that an ID token carries `auth_time`, that a token refresh does not change it, and that a fresh
password sign-in does. This is Firebase behaviour that the repository cannot test offline. The recent-authentication window
is 300 seconds (BR-3). Evidence: the observed claim values for one test account in the operator's own environment.

## 6. uid non-reuse (AE-A1)

Confirm in deployment review that Firebase does not reuse a deleted uid in the environment. Erasure relies on this. Evidence:
the review record and the date.

## 7. Request budget

Confirm that the deployment's request timeout exceeds the 20-second erasure budget (`REQUEST_WALL_BUDGET_MS`) with margin.
If it does not, lower the budget constant through a reviewed change. Evidence: the configured timeout for the route.

## 8. Operator procedure for stuck records

Precondition for 8a and 8b: TASK-038 is Done, `PRODUCTION_HANDLERS_READY` is true with the owner decision recorded, and the security sign-off in item 8 is signed.

There is no worker. A record that stops in one of the states below requires an operator to inspect it and re-run the step
through a reviewed, non-product script, or through a repeated authenticated call where that is possible. Inspect status,
step and error code only.

### 8a. Stuck in `in_progress/participant_bindings` (`payload_unreadable`)

The operator inspects status, step and error code. The binding cannot be cleared without decrypting the payload, so the
record stays stopped until the payload is repaired through a reviewed procedure. The erasure is never reported complete.

### 8b. Auth-deleted stuck state (SPEC review flag)

This covers a record in `auth_deleted`, and a record in `in_progress/auth_delete` where `deleteUser` succeeded but the status
write did not persist. In both cases the erased person has no valid token, so they cannot resume. The approved recovery is an
operator-run, reviewed, non-product script, under the same operator Admin SDK access class as item 8.

- Allowed scope: only records in these two states, and only after the operator confirms that the Auth user is absent
  (`user-not-found`).
- Allowed actions: run the registry verification queries (counts only) and the approved step handlers for any non-zero row.
  When every row is zero, write `status: "completed"` with `completedAt` and `expireAt`, the BR-17 criteria.
- BR-17(1) amendment, dated 2026-11-02 (SPEC decision log "Decision log: BR-17(1) membership-instance rows (approved 2026-11-02)"). For A-5 (`roadmapItems.ownerRef`),
  I-7 `participantMemberRef` and I-9 `memberRef`, the membership-instance `memberRef` is destroyed by membership removal. These
  rows are not re-queried after membership destruction. The step handlers clear them transactionally before the membership is
  deleted. The operator's zero check covers every other row.
- Forbidden: recreating or restoring the Auth identity; any new product endpoint; any new privileged app role or admin
  capability; reading or returning document content; rolling back erased data; any action on a record in another state.
- The operator's own log may hold the record identifier, step and outcome. Application logs never do (AE-SI-12).

The procedure creates no product capability. SPEC recommends a security sign-off before the first real use; this runbook treats
that sign-off as a gate for 8b (flagged for SPEC review). Evidence: the signed-off review and the date.

## 9. Platform logs (E-1)

Record, for each environment, the log content and retention for uid and e-mail address. Erasure makes no claim about these
logs. Do not write "deleted from logs" in any user-facing text. Evidence: the per-environment log configuration record.

## 10. Demo refusal (BR-20)

The demo CLI refuses a presenter uid that has an `accountErasures` record (erasing or erased), or that has no current Auth
user (`presenter-erasure-record`, `presenter-not-found`). Verify this refusal before any demo run against a real presenter.
Evidence: the refusal output for a test uid in a non-production environment, and the date.

## 11. Manual Firestore Emulator race proof (D-EMU)

Before final feature closeout, an operator runs the transaction-race proof against the local Firestore Emulator only. The
proof: a transaction that begins before the erasure fence is created must not commit a protected person-linked write after
that fence exists. No real Firebase project is used. The exact commands are in VERIFICATION.md, section "D-EMU manual gate: updated procedure (2026-11-02)".
The owner-provided result is recorded in VERIFICATION.md, section "D-EMU manual gate: owner-provided result (PASS)". Row 11
evidence stays blank until the operator records the date, commands and emulator version.

Mapping to TASK-044 items: rows 1 to 10 are TASKS items 1 to 10. TASKS item 11 (the historical e-mail limitation) has no checklist
row. It is recorded under "Documented limitations" below, with an owner role and an evidence field. Checklist row 11 is the
D-EMU gate (SPEC item 11), a different item that happens to share the number.

## Documented limitations

- Historical e-mail addresses in invitations cannot be linked to the person, and are not erased. This is the documented
  limitation of the invitation step (SPEC "Invitations and email (BR-13)"). Owner role: Security reviewer. Evidence: ______ (blank,
  the reviewer fills in the date and the sign-off reference).
- Provider backups and retention of Firestore and Firebase Auth data are not claimed as erased (SPEC E-2). Owner role: Platform
  operator. Evidence: ______ (blank).
- Client-side caches in the erased person's browser are not claimed as erased (SPEC E-3). Owner role: Security reviewer.
  Evidence: ______ (blank).
- Invitation matching by document-id suffix reads the keys of the invitation collection once per cleanup call. Its cost is
  recorded in VERIFICATION.md (TASK-038). Owner role: Security reviewer. Evidence: ______ (blank).
