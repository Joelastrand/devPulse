# Role profiles (organizational roles) — Specification

## Status

**Current contract, approved 2026-11-11** (role simplification). This document supersedes the 2026-10-27 specification,
which described roles as skill-expectation profiles with personal target roles and comparisons. That model is withdrawn:
its requirements are not in force, and no code or data implements them. The previous text is in git history
(commit `e420baa` and earlier).

## Purpose

DevPulse records one **organizational role** per person, for information only: the title and description of the job
role an administrator has assigned to them. An organizational role describes a position. It defines no skill
requirements, expected levels, targets, comparisons or development paths, and it grants no application permission.

## Concepts

| Concept | Meaning |
| --- | --- |
| Organizational role (`roleDefinitions/{roleId}`) | Shared catalogue entry: a **title** (required, 1–80 characters) and a **description** (required, 1–500 characters). Lifecycle: active or archived. |
| Role assignment (`roleAssignments/{uid}`) | The formal assignment of one organizational role to one person. Zero or one per person. Stores the stable `roleId`, never a title. |
| Application permission | Unrelated. Team roles, team administration and app-administrator status are never derived from an organizational role, and an assignment never changes them. |

## Organizational roles (admin)

- Admins create a role with a title and a description. Both are required. Each field is trimmed; a value that is empty after
  trimming is refused. The title is 1–80 code points; the description is 1–500 code points.
- Admins edit the title and/or the description. The description cannot be cleared. An empty edit body is refused.
- Admins archive and restore roles. Archive and restore are idempotent. An archived role cannot be edited.
- At most 50 roles exist (`ROLE_DEFINITION_LIMIT`). The list window is 50 raw documents, with a truncation flag.
- Role documents have no skill, level, tree or target field. An unknown field, including the obsolete `expectations`, makes
  a document malformed. Malformed documents are never shown and never repaired.

## Formal role assignment

- Each person has **zero or one** active organizational role, stored at `roleAssignments/{uid}` with `roleId`,
  `createdAt`, `createdBy` and, after a change, `updatedAt` and `updatedBy`.
- Only an authorized application administrator (the superadmin registry, `requireAppAdmin`) can assign, change, remove or
  look up assignments.
- An administrator **cannot assign or remove their own role** (`self_assignment`, `403`).
- A new assignment must reference an **active** role. An archived or missing role is refused (`role_archived` `409`,
  `role_not_found` `404`). Nothing is written on a refusal.
- **Existing assignments to a role that is later archived are kept as stored.** The person is not silently given another
  role. On the personal view, an assignment to an archived role shows the empty state. On the admin view, the assignment
  is marked as archived and can be changed or removed.
- Assigning a role to a person who already has one **changes** the assignment (one document per person, the creation
  record is kept).
- Removing an assignment deletes only that person's document. The shared role definition is never changed.
- Writes run in a transaction fenced on the **target** person's account-erasure record. While the person's erasure is in
  progress, assignment changes are refused (`erasure_in_progress`).
- An assignment grants **no application permission**. No authorization path, team-admin check, superadmin check, skill
  calculation or goal rule reads it.

## Personal view (`/me/skills?vy=rolle`, "Min rolle")

- The person sees the title and description of their assigned active role.
- Without an assignment, or when the assigned role is archived or unreadable, the section shows a concise empty state
  (`Du har ingen organisatorisk rolle tildelt ennå.`).
- The personal view reads only its own assignment: the subject is the verified token's uid. No uid, role id or audit field
  is returned.
- Responsibilities and contributions in the same view are independent of the assignment.

## Administrator workflow

The assignment controls sit in the existing team administration page (`/admin/teams/[teamId]`), in a section that lists
each member's organizational role with assign/change and remove controls. The role catalogue is maintained on `/admin/roles`.
No separate administration area is introduced.

## Independence from other features

- Skills and skill assessments (`skillProfiles`, `skillProgress`) do not read roles. There are no expected levels and no
  role-based gap or comparison.
- Personal goals (`userDevelopment/{uid}/goals`) are created without any role prefill. Goal creation depends on no role.
- Responsibilities and contributions do not depend on the assignment.
- Team skills, team skill needs and the team matrix do not read roles.

## API surface

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/roles` | Any signed-in person | Active roles, title and description only (allow-list). |
| `GET /api/admin/roles` | Admin | Role list with lifecycle fields. |
| `POST /api/admin/roles` | Admin | Create a role (`name`, `description`). |
| `PATCH /api/admin/roles/{roleId}` | Admin | Edit `name` and/or `description`. |
| `POST /api/admin/roles/{roleId}/archive` | Admin | Archive or restore (`archived`). |
| `PUT /api/admin/users/{uid}/role-assignment` | Admin | Assign or change (`roleId`). |
| `DELETE /api/admin/users/{uid}/role-assignment` | Admin | Remove the assignment. |
| `POST /api/admin/role-assignments/lookup` | Admin | Role id per uid, at most 100 uids. |
| `GET /api/me/role-assignment` | Signed-in person | Own title and description, or `none`. |

## Persistence and security

- Server-only through the Admin SDK for both collections. `firestore.rules` denies every client read and write to
  `roleDefinitions` and `roleAssignments`.
- Errors and logs never contain role titles, descriptions, role ids or uids.
- Static guards: the role-profiles scope guard, the personal-role-workspace guard (the workspace reads the assignment only
  through `/api/me/role-assignment`) and the account-erasure fence guard (W-4 is the assignment write).

## Account erasure

- I-4: `roleAssignments/{uid}` is deleted by the `personal_data` erasure step (document id = uid).
- A-18: `createdBy` and `updatedBy` of other people's assignments are anonymized by the `actor_audit` step, so an erased
  administrator is no longer named. The assignments of other people are kept.
- `roleDefinitions` actor fields (A-3) are unchanged.

## Legacy cleanup (completed 2026-11-11)

Obsolete data was removed from the private test project `devpulse-ac26e` by `scripts/cleanup-role-expectations.mjs`:
the `userDevelopment/{uid}/roleTarget` document (one) and the `expectations` field of role definitions (three). A second
dry run reports nothing to clean. The backup was written outside the repository before the write. The script is kept for
the record and is idempotent.

## Acceptance criteria

1. Admins create a role with a required title and a required description, and cannot store an empty description.
2. Admins archive and restore roles; archived roles cannot be edited or newly assigned.
3. Admins assign, change and remove formal roles; a self-target is refused; nothing is written on a refusal.
4. A person sees their own assigned active role's title and description, or the empty state.
5. No assignment changes any permission, and no code path reads an assignment for authorization.
6. No skill expectation, expected level, target role, comparison or role-based goal prefill exists.
7. Account erasure removes the person's assignment and keeps the shared role definition.
8. `firestore.rules` denies client access to both collections.

## Open questions

- Copy review of the Norwegian strings before release.
- Whether existing role documents without a description (created before the description became required) should be
  edited by an administrator or migrated. They are currently not shown in lists, because the parser refuses them.
