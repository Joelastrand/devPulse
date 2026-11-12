# Role profiles (organizational roles) — Tasks

Specification: [SPEC.md](./SPEC.md) (current contract, approved 2026-11-11).

## Status

The previous 31-task plan (2026-10-27, skill-expectation roles and personal target roles) is **withdrawn** and superseded
by the role simplification. Its tasks are in git history and are not in progress. No task in this file is `Ready`.

**Ready: 0  In Progress: 0  Done: 7** (role simplification, 2026-11-11)

## Done (2026-11-11)

- **RS-1 Legacy data cleanup.** `scripts/cleanup-role-expectations.mjs` removed one `userDevelopment/{uid}/roleTarget`
  document and the `expectations` field of three role definitions on `devpulse-ac26e`. Dry run, backup before write,
  verification, and an idempotent second dry run were recorded. Obsolete code, tests and copy were removed.
- **RS-2 Simplified role model.** Roles are a required title (1–80) and a required description (1–500). Malformed and
  legacy documents (any unknown field, including `expectations`) are refused. The admin create/edit contract and client
  types match.
- **RS-3 Formal role assignment.** `roleAssignments/{uid}` with domain validation, a server-only Admin SDK store (fenced
  on the target uid), and operations for admin assign/change, remove, batch lookup, and the person's own read.
  Authorization: `requireAppAdmin`; self-assignment refused; archived and missing roles refused; nothing written on refusal.
- **RS-4 Routes.** `PUT`/`DELETE /api/admin/users/{uid}/role-assignment`, `POST /api/admin/role-assignments/lookup`,
  `GET /api/me/role-assignment`. `firestore.rules` denies client access to `roleAssignments`.
- **RS-5 Admin workflow.** The team administration page has an "Organisatoriske roller" section: each member's role,
  assign/change and remove, with pending, success and neutral error states. The role catalogue stays on `/admin/roles`.
- **RS-6 Personal display.** `/me/skills?vy=rolle` shows "Min rolle" with the title and description, or the empty state.
  Responsibilities and contributions are unchanged. The home next-step card points to the role section.
- **RS-7 Account erasure.** I-4 is `roleAssignments/{uid}` (document id = uid, DELETE, `personal_data`); A-18 anonymizes
  the administrator's `createdBy`/`updatedBy` on assignments (`actor_audit`). The `roleTarget` subtree row is removed.

## Open

- **RS-8 Radar guard (owner decision needed).** The owner-approved C1 radar (2026-11-10) was deleted with the earlier
  uncommitted role work. `skill-profiles-cross-cutting.test.ts` still expects exactly that file to import `recharts`, and
  it now fails. Either restore a personal radar that shows only the person's own levels, or amend the approved decision.
  No code was restored without that decision.
- **RS-9 Legacy descriptions.** Role documents created before the description became required are malformed under the new
  parser and are hidden from lists. An administrator must edit them. Their number was not verified: a read-only check of `roleDefinitions` failed on credential parsing, and no write was attempted to find out.
- **RS-10 Copy review.** The Norwegian copy for the new role and assignment screens needs review before release.
- **RS-11 Documentation of older records.** Historical verification logs for the withdrawn model are kept as records and
  are not current contract.
