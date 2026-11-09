# Superadmin registry — tasks

Status values: `Ready` / `In Progress` / `Done`. `Done` means implemented in the repository and covered by the checks in
`VERIFICATION.md`. It does **not** mean activated in any environment. Production activation is a separate, owner-approved
operation (`BOOTSTRAP.md`).

| ID | Task | Status | Evidence |
| --- | --- | --- | --- |
| SR-T1 | Firestore registry domain and operations: grant by verified Auth e-mail, revoke, list, last-superadmin protection, idempotent grant | Done | `src/features/superadmins/**`, `superadmin-operations.test.ts` |
| SR-T2 | Durable docs: remove `APP_ADMIN_EMAILS` as the authority; document the registry and implemented vs. activated status | Done | `docs/SECURITY.md` (SR-SI), `docs/DATA-MODEL.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, team-management and teamadmin SPEC/TASKS, `.env.local.example` |
| SR-T3 | Superadmin management HTTP API: `GET/POST /api/admin/superadmins`, `DELETE /api/admin/superadmins/[uid]` | Done | `app/api/admin/superadmins/**`, `superadmin-routes.test.ts` (route-level lockout, authorization and target tests) |
| SR-T4 | `/admin/superadmins` page: list, add existing verified user by e-mail, revoke after confirmation, loading/success/error states, Norwegian copy, admin navigation entry | Done | `app/(app)/admin/superadmins/page.tsx`, `components/AdminSuperadmins.tsx`, `AdminSuperadmins.test.tsx`, `nav/AppShell.tsx` |
| SR-T5 | Firestore rules: client access to `superadmins` and `superadminRegistry` denied | Done (rules text) | `firestore.rules`, `firestore-registry-rules.test.ts`. Emulator run **not** performed (no Java). |
| SR-T6 | Erasure consistency: revoke and erasure fence in one transaction; failed fence keeps privilege; last superadmin refused (409) with Norwegian copy | Done | `account-erasure/server/erasure-start-atomic.ts`, `start-erasure.test.ts`, `run-erasure-flow.test.ts`, `account-erasure/copy.ts` |
| SR-T7 | Owner bootstrap script: Auth UID resolution, project guard, dry run by default, explicit `--apply --confirm`, refuses a second initial superadmin, idempotent | Done (code and unit tests) | `scripts/bootstrap-superadmin.ts`, `scripts/bootstrap-superadmin.test.ts`, `BOOTSTRAP.md` |
| SR-T8 | Bootstrap script executed against any Firebase project | **Not started, by design** | Requires explicit owner approval. Not executed in this change. |
| SR-T9 | Firestore emulator verification (registry, concurrency, last-superadmin, erasure integration, client rules denial) | **Blocked** | Java runtime not installed (`java` not on PATH). See `VERIFICATION.md`. |
| SR-T10 | Authenticated browser verification of `/admin/superadmins` | **Blocked** | Requires a real Firebase Auth session and a seeded superadmin. Not performed. |
| SR-T11 | Production cutover: deploy registry rules and code, run bootstrap, verify, then remove `APP_ADMIN_EMAILS` from deployments | **Not started, by design** | Owner-approved, per environment. See `BOOTSTRAP.md`. |
| SR-T12 | Show account e-mail next to each superadmin in the list | Ready (follow-up, not in scope) | The list shows UIDs and grant times only, so no contact data is exposed. Adding e-mails needs a privacy review. |
