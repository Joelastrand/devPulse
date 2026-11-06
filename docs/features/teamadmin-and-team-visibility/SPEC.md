# Superadmin, Teamadmin and Team Visibility

Status: **Implementation in progress — not accepted.** See `TASKS.md` and `docs/SECURITY.md`
(invariants TA-SI-1 … TA-SI-8) for the state of each rule.

This feature replaces the stored team `lead` as the team editing authority with an
owner-approved model: a global **superadmin**, a team-scoped **teamadmin**, and a **team member**,
plus a per-team **public/private visibility**. It supersedes the use of "team lead" as an editing
authority in `docs/features/member-identity-and-team-roles/SPEC.md` (BR-16, BR-24–28) and the lead
capability of `docs/features/team-skill-needs-and-matrix/SPEC.md` (invariant 33).

## Roles

| Role | Source of truth | Grants |
| --- | --- | --- |
| Superadmin | `APP_ADMIN_EMAILS` allow-list (existing `isAppAdmin`, verified email only) | Global admin: `/admin/teams`, create/disable teams, assign/revoke teamadmin, change visibility, teamadmin actions in any team |
| Teamadmin | `teamMemberships/{uid}__{teamId}.role === "teamadmin"`, written only by a superadmin | Team-scoped writes (below) and team visibility, on an `active` team only |
| Member | Any other genuine membership | Private team pages, authorized team-shared reads, own competence profile and consent, own roadmap/planning as today |
| Anonymous | No token | Public read of a `public`, `active` team's name only |

- Superadmin assignment stays with the existing trusted mechanism (the env allow-list). No persisted
  superadmin field exists and none is accepted from a client.
- A teamadmin cannot assign or revoke teamadmin, promote themselves, or administer another team.
- Superadmin status never widens personal data: personal self-assessments (`skillProfiles`), goals,
  role targets and development conversations keep their owner-only rules (invariants 31, 37–40,
  56, RP-SI-3).

## Teamadmin capabilities (server-enforced)

Writes that were lead-only are now teamadmin-or-superadmin, each re-checked inside its write
transaction on an `active` team:

- Team projects (create/update/archive/restore) — `writeTeamProject`
- Project participation — `writeProjectParticipation`
- Team competence catalog — `manage-competence-areas`
- Competence plans — `competence-plans`
- Team skill needs (C2) — `upsertSkillNeed`, `deleteSkillNeed`; `canManageNeeds` on the list response

The `canEdit` flags on the matching read responses are derived from the same rule
(`resolveTeamRole` → `canAdministerTeamScope`); they only hide controls.

Not changed in this task (see Open decisions): team systems and team roadmap items remain writable by
any genuine member as their existing SPECs define; teamadmin-only management of ordinary membership,
invitations and access requests remains superadmin-only on the existing admin routes.

## Legacy `lead` data and migration (no data changed)

- Persisted `teamMemberships.role: "lead"` documents **grant nothing** after this change. They are
  read as `member`. Nothing is migrated automatically, so no existing user is silently elevated.
- Effect: teams that had leads lose lead-only write access until a superadmin assigns `teamadmin`.
  This is intended but must be communicated to the owner before deployment.
- **Migration (not executed, requires owner approval):** a superadmin re-assigns teamadmin via the
  existing `/admin/teams` role control. An optional bulk conversion of `role: "lead"` → `"teamadmin"`
  is a shared-data migration and is NOT prepared or run by this change.
- Stored `role` values are never written by a client; the write path only accepts `teamadmin|member`.

## Team visibility

- New field `teams/{teamId}.visibility`: `"private" | "public"`. Missing or malformed ⇒ `private`
  (fail closed; existing teams therefore stay private without a migration).
- New teams are created `private` (`createTeam`).
- Audit: `visibilityUpdatedAt` only. No actor uid is stored, so account erasure gains no new linkage.
- Changing visibility: superadmin or teamadmin of the team, `active` team, one transaction
  (`setTeamVisibility`). A no-op when the value is unchanged. The UI requires confirmation before a
  team becomes public.

### What becomes public (current implementation)

Only the team **name** and team id. Everything else is private. Which further fields may be published
(roadmap, systems, skill coverage, projects, roster) is a **product decision not yet made**; each would
need an explicit public projection, its own privacy review, and — for any competence data — the
existing D1/D2 consent rules and the k = 5 threshold (invariant 34). Until approved, the public
response never includes them.

## Public read path

- `GET /api/public/teams/[teamId]` — no authentication read or required. Returns exactly
  `{ team: { teamId, name } }` built field by field from `getPublicTeam`. Anything other than an
  active, public team (private, disabled, malformed, missing) is the same `404 not_found`. Responses
  are `Cache-Control: no-store`.
- Page: `/public/teams/[teamId]` in the `(public)` route group (signed-out layout). It renders only
  the public projection and never sends a token.
- Existing `/teams/[teamId]` and all private team APIs are unchanged and still require authentication.

## Team settings API

- `GET /api/teams/[teamId]/visibility` — member, teamadmin or superadmin: `{visibility, canAdminister}`.
  A caller with no relationship gets `403 forbidden`.
- `PUT /api/teams/[teamId]/visibility` — body exactly `{visibility}`; authorized server-side.

## Admin UI (`/admin/teams`)

- The per-member control that previously set `lead` now sets `teamadmin` (server-authoritative;
  disabled only for a non-active team, as before). Copy is Norwegian and states that only superadmin
  can change the role.
- The team admin page shows the visibility panel (current status, explanation, confirmation before
  public, error and success states).

## Open decisions (owner)

1. Which team fields, if any beyond the name, may be shown on a public team page.
2. Whether team systems and team roadmap writes should become teamadmin-only (today: any genuine
   member, unchanged).
3. Whether teamadmins should manage ordinary membership, invitations and access requests (currently
   superadmin only; "where approved" is undefined).
4. Whether to bulk-convert legacy `role: "lead"` documents to `teamadmin` (shared-data migration).
5. Whether visibility may be changed on a disabled team (currently refused).
